using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

namespace TrueReplayer.Services
{
    /// <summary>
    /// The Deck's thread (branch deck; plan .claude/planos/deck-2026-11-19.md, Fase 2): a long-lived STA
    /// thread with its own message loop — off the UI thread, whose WebView2 and XAML bursts and modal loops
    /// would freeze the decks, and alive with the WebView closed. It owns a hidden window (the decks' owner,
    /// which keeps them out of every "find the app's window" — TrueReplayer 2's knock, CoexistenceGuard —
    /// and is the mailbox other threads post to), one DeckWindow per fixed deck, the monitors as last read,
    /// and the app in front (for "only with these apps").
    ///
    /// Fase 3 adds:
    ///   - the passthrough: while the engine clicks (a run, the Clicker, a Teclado game in front) the decks let
    ///     clicks through and the hook brings the user's mouse here (InputHookManager.Deck). The order holds both
    ///     ways — on, the hook takes the user's clicks before the windows let the engine's through; off, the
    ///     windows take clicks again before the hook lets go — so a click of the user's never falls through;
    ///   - what the buttons show: the macro a run runs (and its progress), the Clicker clicking, a recording, the
    ///     TR3 switches, and the failures, kept until the button is pressed again; the tip that says them;
    ///   - stepping aside: under a capture overlay, and around the engine's reads of the screen where Windows does
    ///     not keep the decks out of captures by itself.
    /// </summary>
    public static class DeckHost
    {
        internal readonly struct MonitorInfo
        {
            public readonly IntPtr Handle;
            public readonly DeckNative.RECT Bounds, Work;
            public readonly float Scale;
            public readonly string? DevicePath;
            public readonly bool Primary;
            public MonitorInfo(IntPtr handle, DeckNative.RECT bounds, DeckNative.RECT work, float scale, string? devicePath, bool primary)
            { Handle = handle; Bounds = bounds; Work = work; Scale = scale; DevicePath = devicePath; Primary = primary; }
        }

        /// <summary>What the buttons show of the app: the macro a run runs, the Clicker clicking, a recording, and the TR3 switches.</summary>
        internal sealed record LiveState(string? RunningMacro, bool Clicking, bool Recording, bool ClickerMode, bool Shortcuts, bool Automations, bool Remaps, bool Teclado, string? RecordingMacro = null);

        private const string OwnerClass = AppIdentity.Id + "DeckOwner";
        private const uint WM_RUN = DeckNative.WM_APP + 1;
        private static readonly UIntPtr TimerPass = (UIntPtr)11, TimerProgress = (UIntPtr)12, TimerTip = (UIntPtr)13, TimerCapture = (UIntPtr)14;

        private static Thread? _thread;
        private static IntPtr _owner;
        private static volatile bool _ready;
        private static readonly ConcurrentQueue<System.Action> _queue = new();
        private static readonly Dictionary<string, DeckWindow> _windows = new(StringComparer.Ordinal);
        private static readonly Dictionary<IntPtr, DeckWindow> _byHwnd = new();
        private static readonly DeckNative.WndProc _proc = Proc;
        private static DeckNative.WinEventProc? _fgProc;
        private static IntPtr _fgHook;
        private static List<MonitorInfo> _monitors = new();
        private static string? _frontProcess;
        private static bool _allHidden;
        private static readonly HashSet<string> _hidden = new(StringComparer.Ordinal);
        private static volatile DeckTheme _theme = DeckTheme.Default;
        private static readonly uint _selfPid = (uint)Environment.ProcessId;
        // WDA_EXCLUDEFROMCAPTURE exists from Windows 10 2004; before it the flag reads as WDA_MONITOR, a black
        // box that would blind Wait Image under the deck (Fase 0, probe C) — so nothing is set there.
        private static readonly bool _excludeSupported = Environment.OSVersion.Version.Build >= 19041;
        private static bool _exclude;

        // ── The passthrough ──
        private static volatile bool _passReplay, _passTeclado, _tecladoEnabled;
        private static long _passNetUntil;
        private static bool _passApplied;
        private static volatile InputHookManager.DeckHits _hits = InputHookManager.DeckHits.None;
        private static DeckWindow? _routedOver;
        private static Action<TecladoFront.State>? _onTecladoFront;
        private static System.Action? _onTecladoService;

        // ── What the buttons show ──
        private static volatile LiveState _live = new(null, false, false, false, true, false, false, false);
        private static volatile float _progress;
        private static float _progressDrawn;
        private static string? _runMacro;
        private static readonly Dictionary<string, string> _failures = new(StringComparer.Ordinal);

        // A macro button's press, and the run it started (on the UI thread: MainWindow, WebViewBridge). That run's
        // failure is the deck's to say, over its button — the app's Windows notification would sit over the deck,
        // at the screen's corner, and take its clicks.
        private sealed record DeckRun(string DeckId, int Slot, string Macro, long At);
        private static volatile DeckRun? _deckPress, _deckRunLive, _errorRun;
        private static volatile string[] _shownIds = Array.Empty<string>();
        private static DeckTip? _tip;
        private static DeckWindow? _tipFrom;

        // ── Summoned (Fase 4): the deck the hotkey called, on screen now (the Deck thread's) ──
        private static string? _summoned;

        // ── Stepping aside ──
        private static int _overlays;
        private static volatile bool _captureHidden, _capturesSeeDecks;
        private static int _captures;
        private static long _captureHiddenAt;

        /// <summary>The theme the decks paint with now.</summary>
        internal static DeckTheme Theme => _theme;

        /// <summary>What the buttons show of the app now (the Deck's thread reads it as it draws).</summary>
        internal static LiveState Live => _live;

        /// <summary>How far the running macro is, 0 to 1 (its row over its rows).</summary>
        internal static float Progress => _progress;

        /// <summary>
        /// A button was pressed and let go on it (deck id, slot, the button, and a summoned deck's hotkey — its keys may still
        /// be down, Fase 8). Raised on the Deck thread; MainWindow runs it.
        /// </summary>
        public static event System.Action<string, int, DeckService.Tile, string?>? TileClicked;

        /// <summary>Starts the thread with the theme saved at the last run (the page's comes later, through SetTheme).</summary>
        public static void Start(IReadOnlyDictionary<string, string>? savedTheme, bool animations)
        {
            if (_thread != null) return;
            _theme = new DeckTheme(savedTheme, animations);
            using var started = new ManualResetEventSlim();
            _thread = new Thread(() => Run(started)) { IsBackground = true, Name = "Deck", Priority = ThreadPriority.AboveNormal };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
            // The windows come up on their own: the app does not wait for them past a moment.
            started.Wait(2000);
        }

        /// <summary>Closes the decks and ends the thread (the app's exit).</summary>
        public static void Stop()
        {
            if (_thread == null) return;
            Post(() => DeckNative.PostQuitMessage(0));
            _thread.Join(1000);
            _thread = null;
        }

        /// <summary>The page's theme (theme:colors): the decks paint again with it.</summary>
        public static void SetTheme(IReadOnlyDictionary<string, string> hex, bool animations)
        {
            _theme = new DeckTheme(hex, animations);
            // The icons drawn in the old inks go (Fase 8: the painter's caches kept every theme's).
            Post(() => { foreach (var w in _windows.Values) { w.ForgetPictures(); w.Replace(); } });
        }

        /// <summary>A deck's own show/hide hotkey: for this session.</summary>
        public static void Toggle(string id) => Post(() =>
        {
            if (!_hidden.Remove(id)) _hidden.Add(id);
            RefreshVisibility();
        });

        /// <summary>The "show/hide every deck" hotkey: for this session.</summary>
        public static void ToggleAll() => Post(() =>
        {
            _allHidden = !_allHidden;
            RefreshVisibility();
        });

        private static void Post(System.Action action)
        {
            if (_thread == null) return;
            _queue.Enqueue(action);
            if (_ready) DeckNative.PostMessageW(_owner, WM_RUN, IntPtr.Zero, IntPtr.Zero);
        }

        // ── The thread ──

        private static void Run(ManualResetEventSlim started)
        {
            try
            {
                Register(OwnerClass);
                Register(DeckWindow.ClassName);
                Register(DeckTip.ClassName);
                Register(DeckMenu.ClassName);
                _owner = DeckNative.CreateWindowExW(DeckNative.WS_EX_TOOLWINDOW, OwnerClass, AppIdentity.DisplayName + " · Deck", DeckNative.WS_POPUP,
                    0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, DeckNative.GetModuleHandleW(null), IntPtr.Zero);
                if (_owner == IntPtr.Zero) throw new InvalidOperationException($"CreateWindowEx(owner): {Marshal.GetLastWin32Error()}");
                _fgProc = OnForeground;
                _fgHook = DeckNative.SetWinEventHook(DeckNative.EVENT_SYSTEM_FOREGROUND, DeckNative.EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _fgProc, 0, 0, DeckNative.WINEVENT_OUTOFCONTEXT);
                ReadMonitors();
                ReadForeground(DeckNative.GetForegroundWindow());
                DeckService.Changed += OnConfigChanged;
                DeckService.MacrosChanged += OnConfigChanged;
                _ready = true;
                SyncNow();
                // The Teclado's game in front lets clicks through too (its keys click); its switch is a button's state.
                _onTecladoFront = _ => OnTeclado();
                _onTecladoService = OnTeclado;
                TecladoFront.Changed += _onTecladoFront;
                TecladoService.Changed += _onTecladoService;
                OnTeclado();
                if (!_excludeSupported) DiagnosticLog.Warn($"Deck: Windows build {Environment.OSVersion.Version.Build} has no WDA_EXCLUDEFROMCAPTURE; the decks step aside while the engine reads the screen");
                // After the first drawing, as in the phases before (Fase 8): signalled before it, the decks' Direct2D start
                // ran alongside the page's first load, and the page's ui:ready came before the load's NavigationCompleted
                // (the ui:ready watchdog, armed then, reloaded the page 8 s later — 3 of ~80 test sessions).
                started.Set();
                Drain();
                while (DeckNative.GetMessageW(out var msg, IntPtr.Zero, 0, 0) > 0)
                {
                    DeckNative.TranslateMessage(ref msg);
                    DeckNative.DispatchMessageW(ref msg);
                }
            }
            catch (Exception ex)
            {
                DiagnosticLog.Error("Deck: the decks' thread stopped", ex);
            }
            finally
            {
                _ready = false;
                started.Set();
                DeckService.Changed -= OnConfigChanged;
                DeckService.MacrosChanged -= OnConfigChanged;
                if (_onTecladoFront != null) TecladoFront.Changed -= _onTecladoFront;
                if (_onTecladoService != null) TecladoService.Changed -= _onTecladoService;
                // Nothing of the decks is left for the hook: no click is routed to a window that is gone, and no hotkey of
                // theirs is taken any more (Fase 8: a summon hotkey kept swallowing its keys for a thread that was gone).
                _hits = InputHookManager.DeckHits.None;
                InputHookManager.SetDeckHits(_hits);
                InputHookManager.SetDeckSummons(new Dictionary<string, InputHookManager.DeckSummonKey>(StringComparer.Ordinal));
                InputHookManager.SetDeckHotkeys(new Dictionary<string, string>(StringComparer.Ordinal));
                PassDone(long.MaxValue);
                if (_fgHook != IntPtr.Zero) DeckNative.UnhookWinEvent(_fgHook);
                try { _menu?.Dispose(); } catch { }
                _menu = null;
                _menus.Clear();
                InputHookManager.SetDeckEscape(false);
                foreach (var w in _windows.Values) { try { w.Dispose(); } catch { } }
                _windows.Clear();
                _byHwnd.Clear();
                try { _tip?.Dispose(); } catch { }
                _tip = null;
                if (_owner != IntPtr.Zero) DeckNative.DestroyWindow(_owner);
                _owner = IntPtr.Zero;
            }
        }

        private static void Register(string cls)
        {
            var wc = new DeckNative.WNDCLASSEXW
            {
                cbSize = (uint)Marshal.SizeOf<DeckNative.WNDCLASSEXW>(),
                lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_proc),
                hInstance = DeckNative.GetModuleHandleW(null),
                hCursor = DeckNative.LoadCursorW(IntPtr.Zero, (IntPtr)32512),
                lpszClassName = cls,
            };
            if (DeckNative.RegisterClassExW(ref wc) == 0)
            {
                int err = Marshal.GetLastWin32Error();
                if (err != 1410) throw new InvalidOperationException($"RegisterClassEx({cls}): {err}"); // 1410: already registered
            }
        }

        private static IntPtr Proc(IntPtr h, uint m, IntPtr w, IntPtr l)
        {
            try
            {
                if (h == _owner)
                {
                    switch (m)
                    {
                        case WM_RUN: Drain(); return IntPtr.Zero;
                        case InputHookManager.WM_DECK_MOVE:
                        {
                            var (x, y) = InputHookManager.TakeDeckMove();
                            RoutedMove(x, y);
                            return IntPtr.Zero;
                        }
                        case InputHookManager.WM_DECK_WHEEL:
                            if (_byHwnd.TryGetValue(w, out var wheeled)) wheeled.RoutedWheel((int)(long)l);
                            return IntPtr.Zero;
                        // Fase 6: Esc closes the menu, or ends the edit; a press outside the menus closes them.
                        case InputHookManager.WM_DECK_ESCAPE:
                            if (_menu != null) CloseMenus();
                            else if (_editing != null) Edit(null);
                            return IntPtr.Zero;
                        case InputHookManager.WM_DECK_MENU_OUT:
                            CloseMenus();
                            return IntPtr.Zero;
                        case DeckNative.WM_TIMER:
                            OnOwnerTimer(w);
                            return IntPtr.Zero;
                        case DeckNative.WM_DISPLAYCHANGE:
                            ReplaceAll();
                            return IntPtr.Zero;
                        case DeckNative.WM_SETTINGCHANGE:
                            if ((uint)(long)w == DeckNative.SPI_SETWORKAREA) ReplaceAll();
                            break;
                    }
                    if (m >= InputHookManager.WM_DECK_BUTTON && m < InputHookManager.WM_DECK_BUTTON + 4)
                    {
                        uint b = m - InputHookManager.WM_DECK_BUTTON;
                        if (_byHwnd.TryGetValue(w, out var pressed))
                            pressed.RoutedButton(down: (b & 1) == 0, right: (b & 2) != 0, DeckNative.LoX(l), DeckNative.HiY(l));
                        return IntPtr.Zero;
                    }
                }
                else if (_byHwnd.TryGetValue(h, out var deck))
                {
                    if (m == DeckNative.WM_DPICHANGED) ReadMonitors();
                    return deck.Proc(m, w, l);
                }
                else if (_menus.TryGetValue(h, out var menu)) return menu.Proc(m, w, l);
            }
            catch (Exception ex)
            {
                // A managed exception must not cross back into user32.
                DiagnosticLog.Warn($"Deck: a window message 0x{m:X} failed: {ex.GetType().Name}: {ex.Message}");
            }
            return DeckNative.DefWindowProcW(h, m, w, l);
        }

        private static void OnOwnerTimer(IntPtr id)
        {
            long t = (long)id;
            if (t == (long)(ulong)TimerPass)
            {
                DeckNative.KillTimer(_owner, TimerPass);
                SyncPass();
            }
            else if (t == (long)(ulong)TimerProgress) ProgressTick();
            else if (t == (long)(ulong)TimerTip)
            {
                DeckNative.KillTimer(_owner, TimerTip);
                _tip?.Hide();
                _tipFrom = null;
            }
            else if (t == (long)(ulong)TimerCapture)
            {
                DeckNative.KillTimer(_owner, TimerCapture);
                if (Volatile.Read(ref _captures) == 0 && _captureHidden)
                {
                    _captureHidden = false;
                    RefreshVisibility();
                }
            }
        }

        private static void Drain()
        {
            while (_queue.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception ex) { DiagnosticLog.Warn($"Deck: a posted step failed: {ex.GetType().Name}: {ex.Message}"); }
            }
        }

        private static void OnConfigChanged() => Post(SyncNow);

        /// <summary>A capture overlay is open (an area, a point, a colour): Esc is its own (the hook asks, Fase 8).</summary>
        internal static bool OverlayOpen => Volatile.Read(ref _overlays) > 0;

        /// <summary>The windows follow deck.json: one per fixed deck, drawn again, shown or hidden.</summary>
        private static void SyncNow()
        {
            var config = DeckService.Current;
            _exclude = !config.ShowInCaptures && _excludeSupported;
            _capturesSeeDecks = !_exclude;
            var keep = new HashSet<string>(StringComparer.Ordinal);
            // With the Deck turned off, no window at all: nothing of Direct2D is loaded for decks nobody sees.
            foreach (var deck in config.Enabled ? config.Decks : new List<DeckService.Deck>())
            {
                // A summoned deck has its window too, hidden until the hotkey calls it (Fase 4) — and none while it
                // has no hotkey to be called with, or is off.
                if (deck.Mode != "fixed" && (deck.Mode != "summon" || deck.Hotkey == null || !deck.On)) continue;
                keep.Add(deck.Id);
                // One deck that cannot be made or drawn does not keep the others away (Fase 8).
                try
                {
                    if (!_windows.TryGetValue(deck.Id, out var window))
                    {
                        window = new DeckWindow(deck, _owner);
                        _windows[deck.Id] = window;
                        _byHwnd[window.Hwnd] = window;
                    }
                    // Turned on again (the page's Show): a deck hidden for now (its menu, its hotkey) shows again too.
                    else if (!window.Deck.On && deck.On) _hidden.Remove(deck.Id);
                    window.Update(deck, _exclude);
                    window.SetPassthrough(_passApplied);
                }
                catch (Exception ex) { DiagnosticLog.Warn($"Deck: '{deck.Name}' could not be set up: {ex.GetType().Name}: {ex.Message}"); }
            }
            // The summoned deck left the config, or stopped being one (Fase 8: turned fixed on the page): it closes.
            if (_summoned != null && (!keep.Contains(_summoned) || !(_windows.TryGetValue(_summoned, out var sw) && sw.IsSummonDeck)))
                CloseSummon("config", fromHook: false);
            foreach (var id in _windows.Keys.Where(k => !keep.Contains(k)).ToList())
            {
                var window = _windows[id];
                if (_routedOver == window) _routedOver = null;
                if (_editing == id) Edit(null);
                if (_menuFrom == window) CloseMenus();
                HideTip(window);
                _byHwnd.Remove(window.Hwnd);
                window.Dispose();
                _windows.Remove(id);
                _hidden.Remove(id);
            }
            RefreshVisibility();
        }

        private static void RefreshVisibility()
        {
            var config = DeckService.Current;
            foreach (var deck in config.Decks)
            {
                if (!_windows.TryGetValue(deck.Id, out var window)) continue;
                // A summoned deck shows while it is called, whatever hides the fixed ones (the hotkey is a request); a deck
                // edited on screen shows until the edit ends (Fase 6).
                bool show = (window.IsSummonDeck ? _summoned == deck.Id
                        : _editing == deck.Id || (!_allHidden && !_hidden.Contains(deck.Id) && AppsLetShow(deck)))
                    && config.Enabled && deck.On && _overlays == 0 && !_captureHidden;
                bool was = window.Shown;
                window.SetShown(show);
                if (show && !was)
                {
                    var r = window.ScreenRect;
                    DiagnosticLog.Info($"Deck: '{deck.Name}' shown at ({r.Left},{r.Top}) {r.Width}×{r.Height}");
                }
            }
            // A deck edited on screen that went away (off, the Deck off, a capture overlay): the edit ends with it.
            if (_editing != null && (!_windows.TryGetValue(_editing, out var edited) || !edited.Shown) && _overlays == 0 && !_captureHidden) Edit(null);
            PublishHits();
        }

        private static bool AppsLetShow(DeckService.Deck deck)
        {
            if (deck.ShowWhen.Kind != "apps") return true;
            return _frontProcess != null && deck.ShowWhen.Apps.Any(a => RemapService.NormalizeProcess(a) == _frontProcess);
        }

        private static void ReplaceAll()
        {
            ReadMonitors();
            foreach (var w in _windows.Values) w.Replace();
        }

        private static void RedrawAll()
        {
            foreach (var w in _windows.Values) w.Redraw();
        }

        // ── The passthrough ──

        /// <summary>What the hook knows of the decks on screen: their windows, their rectangles, the passthrough.</summary>
        private static void PublishHits()
        {
            var shown = _windows.Values.Where(w => w.Shown).ToList();
            // A deck that lets the mouse through (keys only) is not the hook's to route to, nor the recorder's to leave out.
            var mouse = shown.Where(w => !w.MouseOff).ToList();
            DeckNative.RECT? summoned = _summoned != null && _windows.TryGetValue(_summoned, out var s) && s.Shown ? s.ScreenRect : null;
            var menus = _menu?.Chain().Select(m => m.ScreenRect).ToArray() ?? Array.Empty<DeckNative.RECT>();
            var hits = new InputHookManager.DeckHits(_owner, _passApplied, mouse.Select(w => w.Hwnd).ToArray(), mouse.Select(w => w.ScreenRect).ToArray(), summoned, menus);
            _hits = hits;
            _shownIds = shown.Select(w => w.Id).ToArray();
            InputHookManager.SetDeckHits(hits);
        }

        /// <summary>A deck moved, changed size or was drawn at a new place (DeckWindow): the hook's picture follows.</summary>
        internal static void Moved()
        {
            if (_ready) PublishHits();
        }

        /// <summary>
        /// The engine starts clicking (a run or the Clicker: ActionExecution's IsReplaying). The decks let clicks
        /// through before it injects anything: this waits for the windows to say so, 50 ms at most.
        /// </summary>
        public static void ReplayStarted()
        {
            _passReplay = true;
            AskPass(wait: true);
        }

        /// <summary>The engine stopped clicking: the decks take clicks again 150 ms later (its last events may still be on their way).</summary>
        public static void ReplayEnded()
        {
            _passReplay = false;
            Post(() => DeckNative.SetTimer(_owner, TimerPass, 150, IntPtr.Zero));
        }

        /// <summary>
        /// A replayed click is about to land on a point (ActionReplayer.BeforePointer, off the UI thread). Over a
        /// deck that still takes clicks — a step tested on its own, outside a run — the decks let clicks through
        /// for a moment, and the click waits for them (50 ms at most).
        /// </summary>
        public static void BeforePointer(int x, int y)
        {
            var hits = _hits;
            if (hits.Hwnds.Length == 0 || !hits.Touches(x, y)) return;
            if (hits.Pass && Interlocked.Read(ref _passDone) >= Interlocked.Read(ref _passAsked)) return;
            Interlocked.Exchange(ref _passNetUntil, Environment.TickCount64 + 1000);
            AskPass(wait: true);
        }

        // Fase 8: each ask for the passthrough has its number, and a sync answers every ask made before it began — a sync
        // already on its way when the ask came (the 150 ms timer, the Teclado) no longer answers it early.
        private static long _passAsked, _passDone;
        private static readonly object _passGate = new();

        private static void AskPass(bool wait)
        {
            if (_thread == null || !_ready) return;
            long ticket = Interlocked.Increment(ref _passAsked);
            Post(SyncPass);
            if (!wait || _hits.Hwnds.Length == 0 || Thread.CurrentThread == _thread) return;
            long until = Environment.TickCount64 + 50;
            lock (_passGate)
            {
                while (Interlocked.Read(ref _passDone) < ticket)
                {
                    long left = until - Environment.TickCount64;
                    if (left <= 0 || !Monitor.Wait(_passGate, (int)left))
                    {
                        if (Interlocked.Read(ref _passDone) < ticket) DiagnosticLog.Warn("Deck: the decks did not let clicks through within 50 ms");
                        break;
                    }
                }
            }
        }

        private static void PassDone(long ticket)
        {
            lock (_passGate)
            {
                if (ticket > Interlocked.Read(ref _passDone)) Interlocked.Exchange(ref _passDone, ticket);
                Monitor.PulseAll(_passGate);
            }
        }

        private static void SyncPass()
        {
            // Read first: what this sync applies answers every ask made up to here.
            long ticket = Interlocked.Read(ref _passAsked);
            long netLeft = Interlocked.Read(ref _passNetUntil) - Environment.TickCount64;
            bool want = _passReplay || _passTeclado || netLeft > 0;
            if (want != _passApplied)
            {
                if (want)
                {
                    // A menu open goes: the engine's clicks would land on it (it never lets clicks through).
                    CloseMenus();
                    // The hook takes the user's clicks first, then the windows let the engine's through…
                    _passApplied = true;
                    PublishHits();
                    foreach (var w in _windows.Values) w.SetPassthrough(true);
                }
                else
                {
                    // …and back the other way: the windows take clicks again, then the hook lets go.
                    foreach (var w in _windows.Values) w.SetPassthrough(false);
                    _passApplied = false;
                    _routedOver = null;
                    PublishHits();
                }
                DiagnosticLog.Info($"Deck: click-through {(want ? "on" : "off")} (run {_passReplay}, Teclado {_passTeclado}, step {netLeft > 0})");
            }
            // A step tested on its own lets clicks through for a second: its end comes back here.
            if (want && !_passReplay && !_passTeclado) DeckNative.SetTimer(_owner, TimerPass, (uint)Math.Max(50, netLeft + 50), IntPtr.Zero);
            PassDone(ticket);
        }

        /// <summary>
        /// The Teclado's switch, or the game in front, changed (the hook's thread, or a save): its passthrough and its button
        /// follow — worked out on the Deck's thread (Fase 8: the two threads that tell of it wrote the flags at once).
        /// </summary>
        private static void OnTeclado() => Post(TecladoNow);

        private static void TecladoNow()
        {
            bool enabled = TecladoService.Current.Enabled;
            bool on = enabled && TecladoFront.Current.GameOn;
            if (on != _passTeclado)
            {
                _passTeclado = on;
                SyncPass();
            }
            if (enabled != _tecladoEnabled)
            {
                _tecladoEnabled = enabled;
                _live = _live with { Teclado = enabled };
                RedrawAll();
            }
        }

        /// <summary>A move the hook brought (WM_DECK_MOVE): to the deck under it, or to the one a routed press holds.</summary>
        private static void RoutedMove(int x, int y)
        {
            foreach (var w in _windows.Values)
            {
                if (!w.RoutedPress || !w.Shown) continue;
                w.RoutedMove(x, y);
                return;
            }
            DeckWindow? over = null;
            foreach (var w in _windows.Values)
            {
                if (!w.Shown || !w.ScreenRect.Contains(x, y)) continue;
                over = w;
                break;
            }
            if (_routedOver != null && _routedOver != over) _routedOver.RoutedLeave();
            _routedOver = over;
            over?.RoutedMove(x, y);
        }

        // ── Summoned (Fase 4) ──

        /// <summary>A summon hotkey was pressed (the hook's thread: never waits). The deck shows where it is called.</summary>
        public static void Summon(string deckId) => Post(() => DoSummon(deckId));

        /// <summary>A key that picks on the summoned deck (the hook's thread): 1–9, 0, the arrows, Enter, Page Up, Page Down.</summary>
        public static void SummonKey(int vk) => Post(() =>
        {
            if (_summoned != null && _windows.TryGetValue(_summoned, out var w)) w.SummonKey(vk);
        });

        /// <summary>The held summon hotkey was let go (the hook's thread): the button under the mouse runs, and the deck goes.</summary>
        public static void SummonRelease() => Post(() =>
        {
            if (_summoned != null && _windows.TryGetValue(_summoned, out var w) && w.Shown) w.SummonRelease();
            else CloseSummon("release", fromHook: true);
        });

        /// <summary>The hook closed the summoned deck (Esc, another key, the hotkey again, a click outside).</summary>
        public static void SummonClose(string why) => Post(() => CloseSummon(why, fromHook: true));

        private static void DoSummon(string deckId)
        {
            var deck = DeckService.Current.Decks.FirstOrDefault(d => d.Id == deckId);
            if (deck == null || !_windows.TryGetValue(deckId, out var window) || !window.IsSummonDeck)
            {
                InputHookManager.DeckSummonEnded(deckId);
                return;
            }
            if (_summoned != null && _summoned != deckId) CloseSummon("another", fromHook: false);
            if (!DeckNative.GetCursorPos(out var cursor)) cursor = new DeckNative.POINT(0, 0);
            // A game holding the cursor in an area (ClipCursor): the deck shows in the middle of it, by keys only — the
            // cursor cannot be taken to the deck's buttons there.
            bool held = DeckNative.GetClipCursor(out var clip)
                && (clip.Left > DeckNative.GetSystemMetrics(DeckNative.SM_XVIRTUALSCREEN)
                    || clip.Top > DeckNative.GetSystemMetrics(DeckNative.SM_YVIRTUALSCREEN)
                    || clip.Width < DeckNative.GetSystemMetrics(DeckNative.SM_CXVIRTUALSCREEN)
                    || clip.Height < DeckNative.GetSystemMetrics(DeckNative.SM_CYVIRTUALSCREEN));
            var at = held ? new DeckNative.POINT(clip.Left + clip.Width / 2, clip.Top + clip.Height / 2)
                : deck.Summon.At == "center" ? Centre(MonitorAt(cursor.X, cursor.Y).Work)
                : cursor;
            bool mouseOff = deck.Summon.KeysOnly || held;
            _summoned = deckId;
            try
            {
                window.PrepareSummon(at.X, at.Y, mouseOff);
                window.SetPassthrough(_passApplied);
                RefreshVisibility();
            }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: '{deck.Name}' could not be summoned: {ex.GetType().Name}: {ex.Message}"); }
            // A deck that cannot show now (a capture overlay open, the engine reading the screen, the Deck off): the hook
            // stops reading keys for it (Fase 8: it kept taking the digits and arrows for a deck nobody saw).
            if (!window.Shown)
            {
                _summoned = null;
                InputHookManager.DeckSummonEnded(deckId);
                DiagnosticLog.Info($"Deck: '{deck.Name}' could not show now: not summoned");
                return;
            }
            DiagnosticLog.Info($"Deck: '{deck.Name}' summoned at ({at.X},{at.Y}){(mouseOff ? ", keys only" : "")}{(held ? " (the cursor is held)" : "")}");
        }

        private static DeckNative.POINT Centre(DeckNative.RECT r) => new(r.Left + r.Width / 2, r.Top + r.Height / 2);

        /// <summary>The summoned deck goes. fromHook: the hook already knows; otherwise it is told, and stops reading keys for it.</summary>
        internal static void CloseSummon(string why, bool fromHook)
        {
            if (_summoned == null) return;
            // Only that deck: the hook may already have another one open (a second hotkey right after the first).
            if (!fromHook) InputHookManager.DeckSummonEnded(_summoned);
            _summoned = null;
            RefreshVisibility();
            DiagnosticLog.Info($"Deck: the summoned deck closed ({why})");
        }

        // ── What the buttons show ──

        /// <summary>
        /// The app's run status (WebViewBridge.PushStatusChange, on the UI thread, at every change): a run of the
        /// open macro, the Clicker, a recording, the end — and an error, which stays on the buttons of the macro
        /// that failed until one of them is pressed again, or the macro runs again.
        /// </summary>
        public static void RunStatus(string status, string? openMacro, bool clicker)
        {
            string? macro = openMacro is { Length: > 0 } m && m != "No Profile" ? m : null;
            // Which run the deck owns is settled here, on the caller's thread: ClaimRunFailure asks right after.
            DeckRun? errorRun = null;
            if (status == "replaying")
            {
                var p = _deckPress;
                _deckRunLive = p != null && !clicker && p.Macro == macro && Environment.TickCount64 - p.At < 5000 ? p : null;
                _deckPress = null;
            }
            else if (status.StartsWith("error:", StringComparison.Ordinal))
            {
                // A run that failed, or a press whose run never started (a data table with no rows).
                errorRun = _deckRunLive ?? (_deckPress is { } p && Environment.TickCount64 - p.At < 5000 ? p : null);
                _deckPress = null;
                _deckRunLive = null;
            }
            else if (status != "recording") _deckRunLive = null;
            _errorRun = errorRun;
            Post(() => ApplyRunStatus(status, macro, clicker, errorRun));
        }

        /// <summary>A deck's macro button was pressed (MainWindow): the run it starts is that button's.</summary>
        public static void MacroPressed(string deckId, int slot, string name) =>
            _deckPress = new DeckRun(deckId, slot, name, Environment.TickCount64);

        /// <summary>
        /// The run that just failed (WebViewBridge.NotifyRunEnded, right after RunStatus, on the UI thread) came from
        /// a press on a deck that is on screen: the deck says it, over the button, and the app's Windows notification
        /// is not shown. False for any other run, and when that deck is not on screen.
        /// </summary>
        public static bool ClaimRunFailure() => _errorRun is { } run && Array.IndexOf(_shownIds, run.DeckId) >= 0;

        private static void ApplyRunStatus(string status, string? macro, bool clicker, DeckRun? errorRun)
        {
            var live = _live;
            if (status.StartsWith("error:", StringComparison.Ordinal))
            {
                string message = status.Substring(6);
                string? who = _runMacro ?? errorRun?.Macro;
                if (who != null)
                {
                    _failures["macro:" + who] = message;
                    bool said = errorRun != null && _windows.TryGetValue(errorRun.DeckId, out var pressedOn) && pressedOn.Shown;
                    DiagnosticLog.Info($"Deck: the buttons of '{who}' show its failure{(said ? $", said over '{errorRun!.DeckId}' slot {errorRun.Slot}" : "")}");
                    if (said) _windows[errorRun!.DeckId].Flash(errorRun.Slot, message);
                }
                _runMacro = null;
                _live = live with { RunningMacro = null, Clicking = false, Recording = false, RecordingMacro = null };
            }
            else if (status == "replaying")
            {
                _runMacro = clicker ? null : macro;
                if (_runMacro != null) _failures.Remove("macro:" + _runMacro);
                _progress = 0;
                _progressDrawn = 0;
                _live = live with { RunningMacro = _runMacro, Clicking = clicker, Recording = false, RecordingMacro = null };
            }
            // The macro being recorded is the open one: its buttons show the recording (Record here, Fase 6).
            else if (status == "recording") _live = live with { Recording = true, RecordingMacro = macro };
            else
            {
                _runMacro = null;
                _live = live with { RunningMacro = null, Clicking = false, Recording = false, RecordingMacro = null };
            }
            if (_live.RunningMacro != null) DeckNative.SetTimer(_owner, TimerProgress, 100, IntPtr.Zero);
            else DeckNative.KillTimer(_owner, TimerProgress);
            RedrawAll();
        }

        /// <summary>The row a run is at (WebViewBridge.PushActionHighlight): the bar is drawn at most 10 times a second.</summary>
        public static void StepProgress(int index, int total)
        {
            if (total > 0) _progress = Math.Clamp((index + 1) / (float)total, 0f, 1f);
        }

        private static void ProgressTick()
        {
            var name = _live.RunningMacro;
            if (name == null)
            {
                DeckNative.KillTimer(_owner, TimerProgress);
                return;
            }
            float p = _progress;
            if (Math.Abs(p - _progressDrawn) < 0.001f) return;
            _progressDrawn = p;
            foreach (var w in _windows.Values) if (w.Shown && w.RunsMacro(name)) w.Redraw();
        }

        /// <summary>The TR3 switches a button shows (TrayIconService.UpdateTrayIcon, after every change of one).</summary>
        public static void SetSwitches(bool clickerMode, bool shortcuts, bool automations, bool remaps) => Post(() =>
        {
            var l = _live;
            if (l.ClickerMode == clickerMode && l.Shortcuts == shortcuts && l.Automations == automations && l.Remaps == remaps) return;
            _live = l with { ClickerMode = clickerMode, Shortcuts = shortcuts, Automations = automations, Remaps = remaps };
            RedrawAll();
        });

        /// <summary>What names a button's action for its failure: the buttons that do the same share it.</summary>
        internal static string? KeyOf(DeckService.Action a) => a.Kind switch
        {
            "macro" => a.Macro == null ? null : "macro:" + a.Macro,
            "keys" => "keys:" + a.Combo,
            "text" => "text:" + a.Text,
            "open" => "open:" + a.Target,
            "tr3" => "tr3:" + a.Command,
            _ => null,
        };

        /// <summary>Why the button's action failed last, until it is pressed again; null when it did not.</summary>
        internal static string? FailureOf(DeckService.Tile tile) =>
            KeyOf(tile.Action) is { } key && _failures.TryGetValue(key, out var message) ? message : null;

        /// <summary>A press that did not do what its button says (MainWindow): the tip says why, over that button, for a moment.</summary>
        public static void Flash(string deckId, int slot, string message)
        {
            DiagnosticLog.Info($"Deck: '{deckId}' slot {slot} said: {message}");
            Post(() => { if (_windows.TryGetValue(deckId, out var w)) w.Flash(slot, message); });
        }

        /// <summary>A button's action failed (it could not open, its keys are not keys): the dot stays until it is pressed again, and the tip says why.</summary>
        public static void Fail(string deckId, int slot, DeckService.Tile tile, string message)
        {
            DiagnosticLog.Info($"Deck: '{deckId}' slot {slot} failed: {message}");
            Post(() =>
            {
                if (KeyOf(tile.Action) is { } key) _failures[key] = message;
                RedrawAll();
                if (_windows.TryGetValue(deckId, out var w)) w.Flash(slot, message);
            });
        }

        /// <summary>The tip over a button (DeckWindow); with autoHideMs, it goes by itself.</summary>
        internal static void ShowTip(DeckWindow from, string text, DeckNative.RECT anchor, int autoHideMs = 0)
        {
            try
            {
                _tip ??= new DeckTip(_owner);
                _tipFrom = from;
                _tipFlash = autoHideMs > 0;
                var monitor = MonitorAt(anchor.Left + anchor.Width / 2, anchor.Top + anchor.Height / 2);
                _tip.Show(text, anchor, monitor, _theme, _exclude);
                DeckNative.KillTimer(_owner, TimerTip);
                if (autoHideMs > 0) DeckNative.SetTimer(_owner, TimerTip, (uint)autoHideMs, IntPtr.Zero);
            }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: the tip could not show: {ex.GetType().Name}: {ex.Message}"); }
        }

        // The tip up is a flash (it goes by itself), not a hover's.
        private static bool _tipFlash;

        /// <summary>The tip goes, when it is that deck's — a flash stays its time when <paramref name="keepFlash"/>.</summary>
        internal static void HideTip(DeckWindow from, bool keepFlash = false)
        {
            if (_tipFrom != from || (keepFlash && _tipFlash)) return;
            _tipFrom = null;
            DeckNative.KillTimer(_owner, TimerTip);
            _tip?.Hide();
        }

        // ── Stepping aside ──

        private sealed class Release : IDisposable
        {
            private System.Action? _release;
            public Release(System.Action release) => _release = release;
            public void Dispose() => Interlocked.Exchange(ref _release, null)?.Invoke();
        }

        private sealed class Nothing : IDisposable
        {
            public static readonly Nothing Instance = new();
            public void Dispose() { }
        }

        /// <summary>
        /// A capture overlay opens (an area, a point, a colour: CaptureOverlayHost): the whole screen is the user's,
        /// so the decks step aside until it closes. Waits for them to be gone, 100 ms at most.
        /// </summary>
        public static IDisposable StepAside()
        {
            if (_thread == null || !_ready) return Nothing.Instance;
            var done = new ManualResetEventSlim();
            Post(() =>
            {
                _overlays++;
                RefreshVisibility();
                done.Set();
            });
            if (Thread.CurrentThread != _thread) done.Wait(100);
            return new Release(() => Post(() =>
            {
                if (_overlays > 0) _overlays--;
                RefreshVisibility();
            }));
        }

        /// <summary>
        /// The engine reads the screen (ScreenCaptureService, PixelColorService: Wait Image, OCR, a colour). Where
        /// Windows does not keep the decks out of captures — before Windows 10 2004, or with "show in captures" on —
        /// they step aside while it reads and come back 300 ms after the last read, so a Wait Image that polls keeps
        /// them away without blinking. Anywhere else nothing happens.
        /// </summary>
        public static IDisposable ForCapture()
        {
            if (!_capturesSeeDecks || _thread == null || !_ready) return Nothing.Instance;
            // Every window of the decks counts (Fase 8): a deck by keys only, a menu, the tip are seen by a capture too.
            if (_shownIds.Length == 0 && _menu == null && !(_tip?.Shown ?? false) && !_captureHidden) return Nothing.Instance;
            Interlocked.Increment(ref _captures);
            var done = new ManualResetEventSlim();
            Post(() =>
            {
                DeckNative.KillTimer(_owner, TimerCapture);
                if (!_captureHidden)
                {
                    _captureHidden = true;
                    CloseMenus();
                    DeckNative.KillTimer(_owner, TimerTip);
                    _tip?.Hide();
                    _tipFrom = null;
                    RefreshVisibility();
                    Interlocked.Exchange(ref _captureHiddenAt, Environment.TickCount64);
                }
                done.Set();
            });
            // The screen composed once without them before it is read.
            if (Thread.CurrentThread != _thread && done.Wait(100) && Environment.TickCount64 - Interlocked.Read(ref _captureHiddenAt) < 100)
                DeckNative.DwmFlush();
            return new Release(() =>
            {
                if (Interlocked.Decrement(ref _captures) == 0) Post(() => DeckNative.SetTimer(_owner, TimerCapture, 300, IntPtr.Zero));
            });
        }

        // ── The app in front ──

        private static void OnForeground(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
        {
            try
            {
                bool changed = ReadForeground(hwnd);
                // Another window came to the front — an app, or TR3 itself (Fase 8: a menu's item brings TR3 forward, and the
                // digits typed there picked on the deck): a summoned deck was for the one it was called over.
                if (_summoned != null && hwnd != IntPtr.Zero && (changed || IsOwnWindow(hwnd))) CloseSummon("front", fromHook: false);
                if (changed) RefreshVisibility();
                foreach (var w in _windows.Values) w.KeepOnTop();
                // The menu and the tip over the decks again (Fase 8: the decks went over them).
                if (_menu != null) foreach (var m in _menu.Chain()) m.Raise();
                _tip?.Raise();
            }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: reading the window in front failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        private static bool IsOwnWindow(IntPtr hwnd)
        {
            DeckNative.GetWindowThreadProcessId(hwnd, out uint pid);
            return pid == _selfPid;
        }

        /// <summary>The process in front, for "only with these apps". The app's own windows change nothing. True when it changed.</summary>
        private static bool ReadForeground(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            DeckNative.GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == 0 || pid == _selfPid) return false;
            var name = RemapService.NormalizeProcess(ProcessName(pid));
            if (name == _frontProcess) return false;
            _frontProcess = name;
            return true;
        }

        private static string? ProcessName(uint pid)
        {
            var h = DeckNative.OpenProcess(DeckNative.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var buffer = new char[1024];
                uint size = (uint)buffer.Length;
                return DeckNative.QueryFullProcessImageNameW(h, 0, buffer, ref size) ? Path.GetFileName(new string(buffer, 0, (int)size)) : null;
            }
            finally { DeckNative.CloseHandle(h); }
        }

        // ── Monitors ──

        private static void ReadMonitors()
        {
            var list = new List<MonitorInfo>();
            DeckNative.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr dc, ref DeckNative.RECT r, IntPtr data) =>
            {
                var mi = new DeckNative.MONITORINFOEXW { cbSize = (uint)Marshal.SizeOf<DeckNative.MONITORINFOEXW>(), szDevice = "" };
                if (DeckNative.GetMonitorInfoW(h, ref mi))
                {
                    float scale = DeckNative.GetDpiForMonitor(h, 0, out uint dpi, out _) == 0 && dpi > 0 ? dpi / 96f : 1f;
                    list.Add(new MonitorInfo(h, mi.rcMonitor, mi.rcWork, scale, DevicePathOf(mi.szDevice), (mi.dwFlags & DeckNative.MONITORINFOF_PRIMARY) != 0));
                }
                return true;
            }, IntPtr.Zero);
            if (list.Count > 0) _monitors = list;
        }

        /// <summary>
        /// The monitor's device path ("\\?\DISPLAY#GSM5B7F#…"), which stays the same across reboots and
        /// across the order Windows numbers the displays in — unlike "\\.\DISPLAY2". The display name when the
        /// path cannot be read.
        /// </summary>
        private static string? DevicePathOf(string displayName)
        {
            var dd = new DeckNative.DISPLAY_DEVICEW { cb = (uint)Marshal.SizeOf<DeckNative.DISPLAY_DEVICEW>(), DeviceName = "", DeviceString = "", DeviceID = "", DeviceKey = "" };
            return DeckNative.EnumDisplayDevicesW(displayName, 0, ref dd, DeckNative.EDD_GET_DEVICE_INTERFACE_NAME) && !string.IsNullOrEmpty(dd.DeviceID)
                ? dd.DeviceID
                : displayName;
        }

        private static MonitorInfo Primary()
        {
            if (_monitors.Count == 0) ReadMonitors();
            var primary = _monitors.FirstOrDefault(m => m.Primary);
            return primary.Handle != IntPtr.Zero ? primary : _monitors.FirstOrDefault();
        }

        /// <summary>The deck's monitor by its device path; the primary one when it is not connected (the saved place is kept).</summary>
        internal static MonitorInfo MonitorFor(string? devicePath)
        {
            if (_monitors.Count == 0) ReadMonitors();
            if (devicePath != null)
                foreach (var m in _monitors)
                    if (string.Equals(m.DevicePath, devicePath, StringComparison.OrdinalIgnoreCase)) return m;
            return Primary();
        }

        internal static MonitorInfo MonitorAt(int x, int y)
        {
            var h = DeckNative.MonitorFromPoint(new DeckNative.POINT(x, y), DeckNative.MONITOR_DEFAULTTONEAREST);
            foreach (var m in _monitors) if (m.Handle == h) return m;
            ReadMonitors();
            foreach (var m in _monitors) if (m.Handle == h) return m;
            return Primary();
        }

        /// <summary>
        /// The edge a deck at this anchor may slide past: only one the work area reaches (no taskbar on it) and
        /// with no monitor beyond (the deck would slide onto it). Left and right first, for the corners.
        /// </summary>
        internal static string? EdgeFor(string anchor, MonitorInfo m)
        {
            bool Free(string edge)
            {
                var b = m.Bounds;
                var w = m.Work;
                (bool reaches, DeckNative.POINT outside) = edge switch
                {
                    "left" => (w.Left == b.Left, new DeckNative.POINT(b.Left - 2, (b.Top + b.Bottom) / 2)),
                    "right" => (w.Right == b.Right, new DeckNative.POINT(b.Right + 1, (b.Top + b.Bottom) / 2)),
                    "top" => (w.Top == b.Top, new DeckNative.POINT((b.Left + b.Right) / 2, b.Top - 2)),
                    _ => (w.Bottom == b.Bottom, new DeckNative.POINT((b.Left + b.Right) / 2, b.Bottom + 1)),
                };
                return reaches && DeckNative.MonitorFromPoint(outside, DeckNative.MONITOR_DEFAULTTONULL) == IntPtr.Zero;
            }
            var order = new List<string>();
            if (anchor.Contains("left")) order.Add("left");
            if (anchor.Contains("right")) order.Add("right");
            if (anchor.StartsWith("top")) order.Add("top");
            if (anchor.StartsWith("bottom")) order.Add("bottom");
            return order.FirstOrDefault(Free);
        }

        /// <summary>The other decks on screen, for the magnet.</summary>
        internal static IEnumerable<DeckNative.RECT> OtherRects(string id) =>
            _windows.Where(kv => kv.Key != id && kv.Value.Shown).Select(kv => kv.Value.ScreenRect).ToList();

        // ── From the windows ──

        /// <summary>A deck moved on screen: its new place goes to deck.json (and to the page, when it is watching).</summary>
        internal static void SavePlace(string id, DeckService.Place place)
        {
            DiagnosticLog.Info($"Deck: moved to {place.Anchor} {place.Dx:0.#},{place.Dy:0.#} on {place.Monitor}");
            DeckService.SetPlace(id, place);
        }

        /// <summary>A button pressed and let go on it (DeckWindow): its last failure is over, and MainWindow runs it.</summary>
        internal static void TileClick(string id, string where, int slot, DeckService.Tile tile, string? held = null)
        {
            DiagnosticLog.Info($"Deck: click on '{id}' {where} slot {slot} ({tile.Action.Kind})");
            if (KeyOf(tile.Action) is { } key && _failures.Remove(key)) RedrawAll();
            try { TileClicked?.Invoke(id, slot, tile, held); }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: a TileClicked handler failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        // ── Fase 6: the edit mode on screen, the menus, and what the decks ask of the app ──

        /// <summary>
        /// What a deck's menu asks of the app, done on the UI thread (MainWindow): "record" (Record here), "page" (the Deck
        /// page at that button, Focus naming what to open there), "iconApp", "iconPicture", "iconCapture" (a picture for
        /// the button). Folder is the folder open in the deck's place (null: the page Page); Slot -1 is the deck itself.
        /// </summary>
        public sealed record DeckRequest(string Kind, string DeckId, string? Folder, int Page, int Slot, string? Focus = null);

        public static event System.Action<DeckRequest>? Requested;
        /// <summary>The deck edited on screen changed (its id, or null): the page's "Edit on screen" follows.</summary>
        public static event System.Action<string?>? EditingChanged;

        private static string? _editing;
        private static DeckMenu? _menu;
        // The deck whose menu is open (Fase 8): it stays as with the mouse on it — no fading, folding nor sliding away.
        private static DeckWindow? _menuFrom;
        private static readonly Dictionary<IntPtr, DeckMenu> _menus = new();

        /// <summary>Is this deck's menu open?</summary>
        internal static bool HasMenu(DeckWindow w) => _menu != null && _menuFrom == w;

        /// <summary>The page's "Edit on screen" (deck:edit): that deck edited on screen, or none.</summary>
        public static void SetEditing(string? deckId) => Post(() => Edit(deckId));

        /// <summary>The deck edited on screen now (the Deck's thread).</summary>
        internal static string? Editing => _editing;

        /// <summary>One deck edited at a time: the one before ends, a summoned deck never is (the page edits it).</summary>
        internal static void Edit(string? deckId)
        {
            if (deckId == _editing) return;
            CloseMenus();
            if (_editing != null && _windows.TryGetValue(_editing, out var was)) was.SetEditing(false);
            bool ended = _editing != null;
            _editing = null;
            if (deckId != null && _windows.TryGetValue(deckId, out var w) && !w.IsSummonDeck)
            {
                // Edited on screen, it is wanted on screen: hidden for now, it stays shown after the edit.
                _hidden.Remove(deckId);
                _editing = deckId;
                w.SetEditing(true);
                DiagnosticLog.Info($"Deck: '{w.Deck.Name}' edited on screen");
            }
            else if (ended) DiagnosticLog.Info("Deck: the edit on screen ended");
            UpdateEscape();
            RefreshVisibility();
            try { EditingChanged?.Invoke(_editing); }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: an EditingChanged handler failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        private static void UpdateEscape() => InputHookManager.SetDeckEscape(_editing != null || _menu != null);

        /// <summary>The menu of a button, or of an empty place, of a deck (its right button, or a click while edited).</summary>
        internal static void OpenTileMenu(DeckWindow from, int slot, DeckService.Tile? tile, DeckNative.POINT at)
        {
            if (MenuRefused(from, slot)) return;
            OpenMenu(from, DeckMenus.ForTile(from, slot, tile, _editing == from.Id), at);
        }

        /// <summary>The deck's own menu (its header's right button).</summary>
        internal static void OpenDeckMenu(DeckWindow from, DeckNative.POINT at)
        {
            if (MenuRefused(from, -1)) return;
            OpenMenu(from, DeckMenus.ForDeck(from, _editing == from.Id), at);
        }

        /// <summary>
        /// No menu, and the tip says why (Fase 8): while the engine clicks (a menu never lets clicks through, and its items
        /// would be clicked by the macro), and on a summoned deck (edited on the Deck page; an item that brings TR3 forward
        /// would leave it summoned over TR3, picking with the keys typed there).
        /// </summary>
        private static bool MenuRefused(DeckWindow from, int slot)
        {
            string? why = _passApplied ? S.DeckTipMenuWaits : from.IsSummonDeck ? S.DeckTipSummonMenu : null;
            if (why == null) return false;
            from.Flash(slot, why);
            return true;
        }

        private static void OpenMenu(DeckWindow from, List<DeckMenu.Item> items, DeckNative.POINT at)
        {
            CloseMenus();
            try
            {
                _menu = DeckMenu.Open(_owner, items, at, MonitorAt(at.X, at.Y), _theme, _exclude);
                _menuFrom = from;
                MenuOpened(_menu);
            }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: the menu could not open: {ex.GetType().Name}: {ex.Message}"); }
        }

        internal static void MenuOpened(DeckMenu menu)
        {
            _menus[menu.Hwnd] = menu;
            PublishHits();
            UpdateEscape();
        }

        internal static void MenuClosed(DeckMenu menu) => _menus.Remove(menu.Hwnd);

        /// <summary>A submenu opened or closed: the hook's picture of the menus follows.</summary>
        internal static void MenusChanged() => PublishHits();

        /// <summary>Every open menu closes (a pick, Esc, a press outside, the passthrough).</summary>
        public static void CloseMenus()
        {
            if (_thread != null && Thread.CurrentThread != _thread) { Post(CloseMenus); return; }
            var menu = _menu;
            var from = _menuFrom;
            _menu = null;
            _menuFrom = null;
            if (menu == null) return;
            menu.Dispose();
            PublishHits();
            UpdateEscape();
            // Its deck settles as the mouse is now: still on it, or gone meanwhile.
            from?.MenuGone();
        }

        /// <summary>A request of a deck's menu to the app (MainWindow, on its thread).</summary>
        internal static void Request(DeckRequest request)
        {
            DiagnosticLog.Info($"Deck: '{request.DeckId}' asks {request.Kind}{(request.Focus != null ? " " + request.Focus : "")} for slot {request.Slot}");
            try { Requested?.Invoke(request); }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: a Requested handler failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        /// <summary>The grid changed by the edit mode's corner, with the place the deck now has (one save).</summary>
        internal static void SaveGrid(string id, int cols, int rows, DeckService.Place place)
        {
            DiagnosticLog.Info($"Deck: '{id}' grid {cols}×{rows}, at {place.Anchor} {place.Dx:0.#},{place.Dy:0.#}");
            DeckService.EditDeck(id, d =>
            {
                d.Grid.Cols = Math.Clamp(cols, 1, DeckService.MaxGrid);
                d.Grid.Rows = Math.Clamp(rows, 1, DeckService.MaxGrid);
                d.Place = place;
                return true;
            });
        }

        /// <summary>A button dragged to another place of what the deck shows (a button there takes its place).</summary>
        internal static void MoveTile(DeckWindow w, int from, int to)
        {
            DiagnosticLog.Info($"Deck: '{w.Id}' button {from} → {to}");
            DeckService.MoveTile(w.Id, w.FolderOpen, Math.Max(0, w.Page), from, to);
        }

        /// <summary>A button dragged onto a page's dot: to that page's first free place.</summary>
        internal static void MoveTileToPage(DeckWindow w, int from, int page)
        {
            DiagnosticLog.Info($"Deck: '{w.Id}' button {from} → page {page + 1}");
            if (!DeckService.MoveTileToPage(w.Id, Math.Max(0, w.Page), from, page)) w.Flash(from, S.DeckTipNoRoom);
        }

        /// <summary>
        /// Files dropped on a deck: an Open button for each, with the file's own icon (a program's, a shortcut's, a
        /// document's), at the place under the drop when it is free, and at the free places after it.
        /// </summary>
        internal static void DropFiles(DeckWindow w, List<string> files, int slot)
        {
            string id = w.Id;
            string? folder = w.FolderOpen;
            int page = Math.Max(0, w.Page);
            // Off the Deck's thread (Fase 8): a program's icon comes from the shell, which may take its time (a network path).
            System.Threading.Tasks.Task.Run(() =>
            {
                try { DropFilesNow(id, folder, page, files, slot); }
                catch (Exception ex) { DiagnosticLog.Warn($"Deck: a drop on '{id}' failed: {ex.GetType().Name}: {ex.Message}"); }
            });
        }

        private static void DropFilesNow(string id, string? folder, int page, List<string> files, int slot)
        {
            int placed = 0;
            foreach (var file in files)
            {
                // Room first (Fase 8): a picture kept for a button that never comes would stay in Deck\images.
                var live = DeckService.Current.Decks.FirstOrDefault(d => d.Id == id);
                var liveTiles = live == null ? null : DeckService.TilesAt(live, folder, page);
                bool hereFree = live != null && liveTiles != null && slot >= 0 && slot < live.Grid.Cols * live.Grid.Rows
                    && !(folder != null && slot == 0) && !liveTiles.Any(t => t.Slot == slot);
                if (live == null || (!hereFree && DeckService.FreeSlot(live, folder, page, slot) < 0))
                {
                    Flash(id, Math.Max(0, slot), S.DeckTipNoRoom);
                    break;
                }
                string? image = DeckImages.FromProgram(file);
                int at = -1;
                bool ok = DeckService.EditDeck(id, d =>
                {
                    var tiles = DeckService.TilesAt(d, folder, page);
                    if (tiles == null) return false;
                    bool here = slot >= 0 && slot < d.Grid.Cols * d.Grid.Rows && !(folder != null && slot == 0) && !tiles.Any(t => t.Slot == slot);
                    at = here ? slot : DeckService.FreeSlot(d, folder, page, slot);
                    if (at < 0) return false;
                    tiles.Add(new DeckService.Tile
                    {
                        Slot = at,
                        Icon = image != null ? new DeckService.Icon { Kind = "image", Path = image } : null,
                        Action = new DeckService.Action { Kind = "open", Target = file },
                    });
                    tiles.Sort((a, b) => a.Slot.CompareTo(b.Slot));
                    return true;
                });
                if (!ok)
                {
                    Flash(id, Math.Max(0, slot), S.DeckTipNoRoom);
                    break;
                }
                placed++;
                slot = at;
            }
            DiagnosticLog.Info($"Deck: {placed} of {files.Count} file(s) dropped on '{id}' became buttons");
        }
    }
}
