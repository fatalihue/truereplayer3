using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TrueReplayer.Interop;
using Windows.Foundation;
using Windows.Graphics;
using Windows.System;
using Windows.UI;

namespace TrueReplayer.Services
{
    /// <summary>
    /// The tray panel (Tray board, "A bandeja — um clique abre o painel"): one click on the tray icon
    /// opens it above the taskbar, with the open macro and its Stop, the pinned macros and those with a hotkey, the
    /// three master switches, the Clicker, Settings and Quit, and the notices the window could not show
    /// while it was hidden ("No painel, o que o Windows silenciou"). Native XAML in this process (rule 11
    /// of the plan): it opens with the window hidden and starts no WebView2 process. Made on the first
    /// click, then kept hidden; a click outside or Esc closes it.
    /// </summary>
    internal static class TrayPanel
    {
        /// <summary>One macro row: its name, its hotkey and whether it is the one running.</summary>
        public sealed record MacroRow(string Name, string? Hotkey, bool Running);

        /// <summary>What the panel shows, read from the engine each time it opens and while it is open.</summary>
        public sealed record Snapshot(
            string? Macro, string Line, string? ActionText, string? ActionKey, bool ActionStops,
            IReadOnlyList<MacroRow> Macros,
            bool Shortcuts, bool Automations, int Armed, bool Remaps, int ActiveRemaps, bool Clicker,
            IReadOnlyList<(string Message, DateTime At)> Notices);

        // Wired by MainWindow: where the panel reads from and what its buttons do.
        public static Func<Snapshot>? Read { get; set; }
        public static Action? OnOpenWindow { get; set; }
        public static Action? OnMacroAction { get; set; }
        public static Action<string>? OnRunMacro { get; set; }
        public static Action? OnAllMacros { get; set; }
        public static Action<bool>? OnSetShortcuts { get; set; }
        public static Action<bool>? OnSetAutomations { get; set; }
        public static Action<bool>? OnSetRemaps { get; set; }
        public static Action? OnOpenClicker { get; set; }
        public static Action? OnOpenSettings { get; set; }
        public static Action? OnQuit { get; set; }
        public static Action? OnClearNotices { get; set; }

        private const double PanelWidthDip = 320;
        // The content height the panel was last sized to, to follow it when it changes while open.
        private static double _placedHeightDip;
        private const int MarginDip = 12;

        private static Window? _window;
        private static AppWindow? _appWindow;
        private static IntPtr _hwnd;
        private static bool _visible;
        // When a click outside closed the panel. The click on the tray icon that closes an open panel
        // reaches the icon AFTER the panel lost focus to it: without this, that click would open it again.
        private static long _hiddenByDeactivationAt;
        private static Microsoft.UI.Dispatching.DispatcherQueueTimer? _timer;

        // The parts refreshed in place while the panel is open.
        private static Grid _root = null!;
        private static StackPanel _noticeBox = null!;
        private static TextBlock _noticeTitle = null!;
        private static StackPanel _noticeList = null!;
        private static Border _card = null!;
        private static TextBlock _macroName = null!;
        private static TextBlock _macroLine = null!;
        private static Button _macroAction = null!;
        private static TextBlock _macroActionText = null!;
        private static TextBlock _macroActionKey = null!;
        private static StackPanel _macroList = null!;
        private static ToggleSwitch _shortcuts = null!, _automations = null!, _remaps = null!;
        private static TextBlock _automationsText = null!, _remapsText = null!;
        private static TextBlock _clickerText = null!;
        // The fixed labels, written in the interface's language when it changes (ApplyLabels): the
        // panel is made once, and the language can change while the app runs.
        private static Button _open = null!, _clicker = null!, _settings = null!, _quit = null!;
        private static HyperlinkButton _clear = null!, _allMacros = null!;
        private static TextBlock _macrosCaption = null!, _shortcutsLabel = null!, _automationsLabel = null!, _remapsLabel = null!;
        private static TextBlock _settingsLabel = null!, _quitLabel = null!;
        private static string? _labelsLanguage;
        // Start as no list could be, so the first fill always draws (an empty list draws its own line).
        private static string _macrosKey = "(not drawn yet)", _noticesKey = "(not drawn yet)";
        private static bool _refreshing;

        // The app's theme, from the page (theme:colors): the panel looks like the window it belongs to.
        private static Color? _bg, _card2, _text, _textMuted, _accent, _border;

        public static bool IsOpen => _visible;

        public static void SetTheme(string bgSurface, string bgCard, string textPrimary, string textSecondary, string? accent, string? border)
        {
            _bg = ColorOf(bgSurface); _card2 = ColorOf(bgCard); _text = ColorOf(textPrimary);
            _textMuted = ColorOf(textSecondary); _accent = ColorOf(accent); _border = ColorOf(border);
            if (_window != null) ApplyTheme();
        }

        private static Color? ColorOf(string? hex) =>
            Controllers.ProfileController.ParseCssHex(hex) is { } c ? Color.FromArgb(c.A, c.R, c.G, c.B) : null;

        /// <summary>The tray icon's click: opens the panel, or closes it when it is open.</summary>
        public static void Toggle()
        {
            if (_visible) { Hide(); return; }
            if (Environment.TickCount64 - _hiddenByDeactivationAt < 400) return;
            Show();
        }

        public static void Hide()
        {
            if (!_visible) return;
            _visible = false;
            _timer?.Stop();
            _appWindow?.Hide();
        }

        public static void Show()
        {
            try
            {
                long t0 = Environment.TickCount64;
                bool first = _window == null;
                Ensure();
                Refresh();
                Place();
                _visible = true;
                _appWindow!.Show(true);
                NativeMethods.SetForegroundWindow(_hwnd);
                _timer!.Start();
                // Measured again once the tree is laid out in the window it is in: a wrapped line or a
                // notice measured before that came out short, and cut the footer off.
                _window!.DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () => { if (_visible) Place(); });
                DiagnosticLog.Info($"[Tray] panel shown in {Environment.TickCount64 - t0} ms{(first ? " (made now)" : "")}");
            }
            catch (Exception ex)
            {
                DiagnosticLog.Error("Tray panel failed to show", ex);
            }
        }

        // ── Making it ────────────────────────────────────────────────────────────

        private static void Ensure()
        {
            if (_window != null) return;
            var w = new Window { Title = AppIdentity.DisplayName };
            w.Content = Build();
            _hwnd = WinRT.Interop.WindowNative.GetWindowHandle(w);
            _appWindow = AppWindow.GetFromWindowId(Win32Interop.GetWindowIdFromWindow(_hwnd));
            // Not in Alt+Tab or on the taskbar, above everything, no caption: a flyout, not a window.
            _appWindow.IsShownInSwitchers = false;
            var presenter = OverlappedPresenter.Create();
            presenter.IsResizable = false;
            presenter.IsMaximizable = false;
            presenter.IsMinimizable = false;
            presenter.IsAlwaysOnTop = true;
            presenter.SetBorderAndTitleBar(true, false);
            _appWindow.SetPresenter(presenter);
            // Owned by the main window. Every finder of "the app's window" skips owned windows — .NET's
            // Process.MainWindowHandle, which TrueReplayer 2 knocks on, and CoexistenceGuard.FindMainWindow,
            // which a second launch of the exe uses — so the panel, of the same window class and on top,
            // can never take the main window's place there and swallow the tray's double-click.
            if (TrayIconService.MainWindow != IntPtr.Zero)
                SetWindowLongPtr(_hwnd, GWLP_HWNDPARENT, TrayIconService.MainWindow);
            try { _appWindow.SetIcon(System.IO.Path.Combine(AppContext.BaseDirectory, AppIdentity.IconFile)); } catch { /* cosmetic */ }
            // A click anywhere else closes it, as every panel of the notification area does.
            w.Activated += (_, e) =>
            {
                if (e.WindowActivationState == WindowActivationState.Deactivated && _visible)
                {
                    _hiddenByDeactivationAt = Environment.TickCount64;
                    Hide();
                    DiagnosticLog.Info("[Tray] panel closed: the focus went elsewhere");
                }
            };
            // Closing it (Alt+F4) only hides it: it is made once.
            _appWindow.Closing += (_, e) => { e.Cancel = true; Hide(); };
            _window = w;
            ApplyTheme();
            // The run's line moves (the loop, the clock): read again twice a second while open.
            _timer = w.DispatcherQueue.CreateTimer();
            _timer.Interval = TimeSpan.FromMilliseconds(500);
            _timer.Tick += (_, _) =>
            {
                if (!_visible) return;
                Refresh();
                // A notice cleared, a list that grew: the panel follows its content's height.
                _root.Measure(new Size(PanelWidthDip, double.PositiveInfinity));
                if (Math.Abs(_root.DesiredSize.Height - _placedHeightDip) > 1) Place();
            };
            // Shown once off-screen so the XAML tree is live and can be measured before the first real show.
            _appWindow.MoveAndResize(new RectInt32(-32000, -32000, 10, 10));
            _appWindow.Show(false);
            _root.UpdateLayout();
            _appWindow.Hide();
        }

        private static UIElement Build()
        {
            _root = new Grid { Padding = new Thickness(14, 12, 14, 12) };
            _root.KeyDown += (_, e) => { if (e.Key == VirtualKey.Escape) { e.Handled = true; Hide(); } };
            // The switches take the app's accent, as the page's do. Set before they load: a theme
            // resource is looked up when the control is made, and the page's colors are in by the time
            // the first click makes the panel.
            if (_accent is { } accent)
            {
                var brush = new SolidColorBrush(accent);
                foreach (var key in new[] { "ToggleSwitchFillOn", "ToggleSwitchFillOnPointerOver", "ToggleSwitchFillOnPressed", "ToggleSwitchStrokeOn", "ToggleSwitchStrokeOnPointerOver", "ToggleSwitchStrokeOnPressed" })
                    _root.Resources[key] = brush;
            }
            var stack = new StackPanel { Spacing = 10 };
            _root.Children.Add(stack);

            // The header: the name and Open.
            var header = new Grid();
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            header.Children.Add(new TextBlock { Text = AppIdentity.DisplayName, FontSize = 14, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center });
            _open = new Button { Padding = new Thickness(12, 4, 12, 5) };
            _open.Click += (_, _) => { Hide(); OnOpenWindow?.Invoke(); };
            Grid.SetColumn(_open, 1);
            header.Children.Add(_open);
            stack.Children.Add(header);

            // The notices held while the window was hidden, with Clear.
            _noticeBox = new StackPanel { Spacing = 6, Visibility = Visibility.Collapsed };
            var noticeHead = new Grid();
            noticeHead.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            noticeHead.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            _noticeTitle = new TextBlock { FontSize = 13, FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center };
            noticeHead.Children.Add(_noticeTitle);
            _clear = new HyperlinkButton { Padding = new Thickness(6, 2, 6, 2) };
            _clear.Click += (_, _) => { OnClearNotices?.Invoke(); Refresh(); Place(); };
            Grid.SetColumn(_clear, 1);
            noticeHead.Children.Add(_clear);
            _noticeBox.Children.Add(noticeHead);
            _noticeList = new StackPanel { Spacing = 6 };
            _noticeBox.Children.Add(_noticeList);
            stack.Children.Add(_noticeBox);

            // The open macro: its name, its state, and Replay or Stop with the key.
            var cardStack = new StackPanel { Spacing = 2 };
            _macroName = new TextBlock { FontSize = 14, FontWeight = FontWeights.SemiBold, TextTrimming = TextTrimming.CharacterEllipsis };
            _macroLine = new TextBlock { FontSize = 12, TextWrapping = TextWrapping.Wrap, MaxLines = 2, TextTrimming = TextTrimming.CharacterEllipsis };
            cardStack.Children.Add(_macroName);
            cardStack.Children.Add(_macroLine);
            var actionContent = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            _macroActionText = new TextBlock { VerticalAlignment = VerticalAlignment.Center };
            _macroActionKey = new TextBlock { FontSize = 11, Opacity = 0.75, VerticalAlignment = VerticalAlignment.Center };
            actionContent.Children.Add(_macroActionText);
            actionContent.Children.Add(_macroActionKey);
            _macroAction = new Button { Content = actionContent, Margin = new Thickness(0, 8, 0, 0), HorizontalAlignment = HorizontalAlignment.Left };
            _macroAction.Click += (_, _) => OnMacroAction?.Invoke();
            cardStack.Children.Add(_macroAction);
            _card = new Border { CornerRadius = new CornerRadius(8), Padding = new Thickness(12, 10, 12, 12), Child = cardStack };
            stack.Children.Add(_card);

            // The macros with a hotkey (the pinned ones first): a click runs one, as its hotkey would.
            _macrosCaption = Caption();
            stack.Children.Add(_macrosCaption);
            _macroList = new StackPanel { Spacing = 0 };
            stack.Children.Add(_macroList);
            _allMacros = new HyperlinkButton { Padding = new Thickness(6, 2, 6, 2) };
            _allMacros.Click += (_, _) => { Hide(); OnAllMacros?.Invoke(); };
            stack.Children.Add(_allMacros);

            // The master switches, and the Clicker.
            stack.Children.Add(Separator());
            _shortcuts = AddSwitch(stack, out _shortcutsLabel, out _, on => OnSetShortcuts?.Invoke(on));
            _automations = AddSwitch(stack, out _automationsLabel, out _automationsText, on => OnSetAutomations?.Invoke(on));
            _remaps = AddSwitch(stack, out _remapsLabel, out _remapsText, on => OnSetRemaps?.Invoke(on));
            _clicker = new Button { HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new Thickness(8, 6, 8, 6), Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0) };
            var clickerGrid = new Grid();
            clickerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            clickerGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            _clickerText = new TextBlock { Text = S.TrayPanelClicker };   // Refresh writes it from then on
            clickerGrid.Children.Add(_clickerText);
            var chevron = new FontIcon { Glyph = "", FontSize = 12 };
            Grid.SetColumn(chevron, 1);
            clickerGrid.Children.Add(chevron);
            _clicker.Content = clickerGrid;
            _clicker.Click += (_, _) => { Hide(); OnOpenClicker?.Invoke(); };
            stack.Children.Add(_clicker);

            // Settings and Quit.
            stack.Children.Add(Separator());
            var footer = new Grid();
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            _settings = IconButton("", out _settingsLabel);
            _settings.Click += (_, _) => { Hide(); OnOpenSettings?.Invoke(); };
            footer.Children.Add(_settings);
            _quit = IconButton("", out _quitLabel);
            _quit.Click += (_, _) => { Hide(); OnQuit?.Invoke(); };
            Grid.SetColumn(_quit, 1);
            footer.Children.Add(_quit);
            stack.Children.Add(footer);
            ApplyLabels();
            return _root;
        }

        /// <summary>
        /// The fixed labels in the interface's language (the engine-tray area), and the names a screen
        /// reader says for them. Again at the first refresh after the language changed.
        /// </summary>
        private static void ApplyLabels()
        {
            _labelsLanguage = S.Language;
            _open.Content = S.TrayPanelOpen;
            _clear.Content = S.TrayPanelClear;
            _macrosCaption.Text = S.TrayPanelMacros;
            _allMacros.Content = S.TrayPanelAllMacros;
            SetLabel(_shortcuts, _shortcutsLabel, S.TrayPanelShortcuts);
            SetLabel(_automations, _automationsLabel, S.TrayPanelAutomations);
            SetLabel(_remaps, _remapsLabel, S.TrayPanelRemaps);
            AutomationProperties.SetName(_clicker, S.TrayPanelClicker);
            SetLabel(_settings, _settingsLabel, S.TrayPanelSettings);
            SetLabel(_quit, _quitLabel, S.TrayPanelQuit(app: AppIdentity.DisplayName));
        }

        private static void SetLabel(Control control, TextBlock label, string text)
        {
            label.Text = text;
            AutomationProperties.SetName(control, text);
        }

        private static TextBlock Caption() => new() { FontSize = 12, Opacity = 0.7, Margin = new Thickness(0, 2, 0, -4) };

        private static Border Separator() => new() { Height = 1, Opacity = 0.18, Background = new SolidColorBrush(Colors.Gray), Margin = new Thickness(0, 2, 0, 2) };

        private static Button IconButton(string glyph, out TextBlock label)
        {
            var content = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            content.Children.Add(new FontIcon { Glyph = glyph, FontSize = 14 });
            label = new TextBlock { VerticalAlignment = VerticalAlignment.Center };
            content.Children.Add(label);
            return new Button { Content = content, Padding = new Thickness(8, 5, 10, 6), Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0) };
        }

        private static ToggleSwitch AddSwitch(StackPanel parent, out TextBlock label, out TextBlock detail, Action<bool> changed)
        {
            var row = new Grid { Padding = new Thickness(8, 0, 0, 0) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var text = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            label = new TextBlock();
            text.Children.Add(label);
            detail = new TextBlock { Opacity = 0.7 };
            text.Children.Add(detail);
            row.Children.Add(text);
            var toggle = new ToggleSwitch { OnContent = "", OffContent = "", MinWidth = 0, HorizontalAlignment = HorizontalAlignment.Right };
            toggle.Toggled += (_, _) => { if (!_refreshing) changed(toggle.IsOn); };
            Grid.SetColumn(toggle, 1);
            row.Children.Add(toggle);
            parent.Children.Add(row);
            return toggle;
        }

        private static void ApplyTheme()
        {
            if (_window == null) return;
            bool dark = _bg is not { } bg || (0.2126 * bg.R + 0.7152 * bg.G + 0.0722 * bg.B) < 128;
            _root.RequestedTheme = dark ? ElementTheme.Dark : ElementTheme.Light;
            _root.Background = new SolidColorBrush(_bg ?? (dark ? Color.FromArgb(255, 32, 32, 34) : Color.FromArgb(255, 250, 250, 250)));
            _card.Background = new SolidColorBrush(_card2 ?? (dark ? Color.FromArgb(255, 44, 44, 48) : Color.FromArgb(255, 240, 240, 242)));
            if (_border is { } b) { _card.BorderBrush = new SolidColorBrush(b); _card.BorderThickness = new Thickness(1); }
            var muted = new SolidColorBrush(_textMuted ?? (dark ? Color.FromArgb(255, 170, 170, 176) : Color.FromArgb(255, 96, 96, 104)));
            _macroLine.Foreground = muted;
            _automationsText.Foreground = muted;
            _remapsText.Foreground = muted;
            // The name and the notices' title in the theme's text color; the rest of the labels keep the
            // light or dark theme's own, so the rows read alike.
            if (_text is { } fg)
                foreach (var tb in new[] { _macroName, _noticeTitle }) tb.Foreground = new SolidColorBrush(fg);
        }

        // ── Filling it ───────────────────────────────────────────────────────────

        private static void Refresh()
        {
            var s = Read?.Invoke();
            if (s == null) return;
            _refreshing = true;
            try
            {
                // The language changed since the labels were written (Settings › General).
                if (_labelsLanguage != S.Language) ApplyLabels();

                // The notices: rebuilt only when they change, the rest in place.
                string noticesKey = string.Join("\n", s.Notices.Select(n => n.At.Ticks + n.Message));
                if (noticesKey != _noticesKey)
                {
                    _noticesKey = noticesKey;
                    _noticeList.Children.Clear();
                    foreach (var (message, at) in s.Notices)
                    {
                        var row = new Grid();
                        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                        row.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap, MaxLines = 3, TextTrimming = TextTrimming.CharacterEllipsis, FontSize = 12 });
                        var time = new TextBlock { Text = at.ToString("HH:mm", S.Culture), FontSize = 12, Opacity = 0.7, Margin = new Thickness(8, 0, 0, 0) };
                        Grid.SetColumn(time, 1);
                        row.Children.Add(time);
                        _noticeList.Children.Add(row);
                    }
                }
                _noticeBox.Visibility = s.Notices.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
                _noticeTitle.Text = S.TrayPanelNotices(n: S.Num(s.Notices.Count), count: s.Notices.Count);

                _macroName.Text = s.Macro ?? S.TrayPanelNoMacro;
                _macroLine.Text = s.Line;
                _macroAction.Visibility = s.ActionText != null ? Visibility.Visible : Visibility.Collapsed;
                _macroActionText.Text = s.ActionText ?? "";
                _macroActionKey.Text = s.ActionKey ?? "";
                AutomationProperties.SetName(_macroAction, s.ActionText ?? "");
                _macroAction.Background = s.ActionStops
                    ? new SolidColorBrush(Color.FromArgb(255, 196, 43, 28))
                    : _accent is { } accent ? new SolidColorBrush(accent) : null;
                if (s.ActionStops || _accent != null) _macroAction.Foreground = new SolidColorBrush(Colors.White);
                else _macroAction.ClearValue(Control.ForegroundProperty);

                // The language too: the empty line and "Running" are written into the rows.
                string macrosKey = S.Language + "\n" + string.Join("\n", s.Macros.Select(m => $"{m.Name}|{m.Hotkey}|{m.Running}"));
                if (macrosKey != _macrosKey)
                {
                    _macrosKey = macrosKey;
                    _macroList.Children.Clear();
                    if (s.Macros.Count == 0)
                        _macroList.Children.Add(new TextBlock { Text = S.TrayPanelMacrosEmpty, FontSize = 12, Opacity = 0.7, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(8, 4, 0, 4) });
                    foreach (var m in s.Macros)
                    {
                        var grid = new Grid();
                        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
                        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                        grid.Children.Add(new TextBlock { Text = m.Name, TextTrimming = TextTrimming.CharacterEllipsis });
                        var side = new TextBlock { Text = m.Running ? S.TrayPanelRunning : m.Hotkey ?? "", FontSize = 12, Opacity = m.Running ? 1 : 0.7, Margin = new Thickness(10, 0, 0, 0) };
                        if (m.Running) side.FontWeight = FontWeights.SemiBold;
                        Grid.SetColumn(side, 1);
                        grid.Children.Add(side);
                        var row = new Button { Content = grid, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new Thickness(8, 5, 8, 5), Background = new SolidColorBrush(Colors.Transparent), BorderThickness = new Thickness(0) };
                        AutomationProperties.SetName(row, m.Name);
                        string name = m.Name;
                        row.Click += (_, _) => { Hide(); OnRunMacro?.Invoke(name); };
                        _macroList.Children.Add(row);
                    }
                }

                _shortcuts.IsOn = s.Shortcuts;
                _automations.IsOn = s.Automations;
                _automationsText.Text = s.Armed > 0 ? S.TrayPanelArmed(n: S.Num(s.Armed), count: s.Armed) : "";
                _remaps.IsOn = s.Remaps;
                _remapsText.Text = s.ActiveRemaps > 0 ? S.TrayPanelActive(n: S.Num(s.ActiveRemaps), count: s.ActiveRemaps) : "";
                _clickerText.Text = s.Clicker ? S.TrayPanelClickerOpen : S.TrayPanelClicker;
            }
            finally { _refreshing = false; }
        }

        // ── Placing it ───────────────────────────────────────────────────────────

        // Above the tray icon, inside the work area of its monitor: the panel's corner sits by the icon,
        // on the side the taskbar is. Measured at the monitor's scale, then sized to its content.
        private static void Place()
        {
            if (_appWindow == null) return;
            var icon = TrayIconService.IconRect();
            var anchor = icon is { } r ? new PointInt32((r.Left + r.Right) / 2, (r.Top + r.Bottom) / 2) : CursorPoint();
            var area = DisplayArea.GetFromPoint(anchor, DisplayAreaFallback.Nearest).WorkArea;
            double scale = ScaleAt(anchor);
            _root.Measure(new Size(PanelWidthDip, double.PositiveInfinity));
            _placedHeightDip = _root.DesiredSize.Height;
            int m = (int)(MarginDip * scale);
            // The CLIENT area is what the content gets: sizing the window from outside left the border
            // (16 × 8 px here) out of it, the text wrapped narrower and the footer fell off the bottom.
            int cw = (int)Math.Ceiling(PanelWidthDip * scale);
            int ch = (int)Math.Ceiling(Math.Max(120, _root.DesiredSize.Height) * scale);
            ch = Math.Min(ch, area.Height - 2 * m);
            _appWindow.ResizeClient(new SizeInt32(cw, ch));
            int w = _appWindow.Size.Width, h = _appWindow.Size.Height;
            int x = Math.Clamp(anchor.X - w + (int)(24 * scale), area.X + m, area.X + area.Width - w - m);
            int y;
            if (anchor.Y >= area.Y + area.Height) y = area.Y + area.Height - h - m;   // taskbar below
            else if (anchor.Y <= area.Y) y = area.Y + m;                              // taskbar above
            else y = Math.Clamp(anchor.Y - h / 2, area.Y + m, area.Y + area.Height - h - m);
            _appWindow.Move(new PointInt32(x, y));
        }

        private static PointInt32 CursorPoint()
        {
            NativeMethods.GetCursorPos(out var p);
            return new PointInt32(p.x, p.y);
        }

        private static double ScaleAt(PointInt32 p)
        {
            try
            {
                IntPtr monitor = MonitorFromPoint(new NativeMethods.POINT { x = p.X, y = p.Y }, 2 /* MONITOR_DEFAULTTONEAREST */);
                if (monitor != IntPtr.Zero && GetDpiForMonitor(monitor, 0, out uint dpi, out _) == 0 && dpi > 0) return dpi / 96.0;
            }
            catch { /* 100 % */ }
            return 1.0;
        }

        private const int GWLP_HWNDPARENT = -8;
        [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
        [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(NativeMethods.POINT pt, uint dwFlags);
        [DllImport("shcore.dll")] private static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);
    }
}
