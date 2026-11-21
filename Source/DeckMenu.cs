using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Vortice.Mathematics;

namespace TrueReplayer.Services
{
    /// <summary>
    /// A deck's menu (branch deck; plan .claude/planos/deck-2026-11-19.md, Fase 6): the button's menu (Record here, a
    /// macro, keys, a text, the icon, the colour, duplicate, delete…) and the deck's own. Like the decks, a layered window
    /// that never takes the foreground (no TrackPopupMenu: that one activates), drawn with Direct2D in the look of the
    /// app's menus — the card, the default border, 12 px rows. A submenu opens beside its row on hover or on a click;
    /// the Colour submenu is a panel of the folders' 24 swatches. It stays inside the monitor's work area (the
    /// menuAnchor rule). The mouse picks; Esc and a press outside close it (the hook brings both: the menu never has
    /// the keyboard). One menu open at a time, on the Deck's thread (DeckHost).
    /// </summary>
    internal sealed class DeckMenu : IDisposable
    {
        public const string ClassName = AppIdentity.Id + "DeckMenu";
        private const float MinW = 180, MaxW = 300, ItemH = 28, SepH = 9, Pad = 4, Radius = 8, TextX = 12, FontSize = 12,
            Swatch = 22, SwatchGap = 4, ChevronW = 16;
        private const int SwatchCols = 6, SubDelayMs = 220;
        private static readonly UIntPtr TimerSub = (UIntPtr)1;

        /// <summary>A row of a menu: a command, a submenu (built when it opens), a separator, or a panel of swatches.</summary>
        internal sealed class Item
        {
            public string Label = "";
            public System.Action? Run;
            public Func<List<Item>>? Submenu;
            public bool Separator, Disabled, Danger, Checked;
            /// <summary>A panel of colours: each swatch, the one marked, and what picking one does.</summary>
            public IReadOnlyList<string>? Swatches;
            public string? SwatchOn;
            public System.Action<string>? Pick;

            public static Item Sep() => new() { Separator = true };
        }

        public IntPtr Hwnd { get; private set; }
        private readonly DeckPainter _painter = new();
        private readonly List<Item> _items;
        private readonly DeckMenu? _parent;
        private DeckMenu? _child;
        private int _childOf = -1, _hover = -1, _hoverSwatch = -1;
        private float _scale = 1f, _wDip, _hDip;
        private int _x, _y, _w, _h;
        private bool _tracking;
        private readonly DeckTheme _theme;
        private readonly DeckHost.MonitorInfo _monitor;
        private readonly bool _exclude;

        public DeckNative.RECT ScreenRect => new(_x, _y, _x + _w, _y + _h);
        public DeckMenu? Child => _child;

        private DeckMenu(IntPtr owner, List<Item> items, DeckHost.MonitorInfo monitor, DeckTheme theme, bool exclude, DeckMenu? parent)
        {
            _items = items;
            _parent = parent;
            _theme = theme;
            _monitor = monitor;
            _exclude = exclude;
            Hwnd = DeckNative.CreateWindowExW(
                DeckNative.WS_EX_LAYERED | DeckNative.WS_EX_NOACTIVATE | DeckNative.WS_EX_TOOLWINDOW | DeckNative.WS_EX_TOPMOST,
                ClassName, AppIdentity.DisplayName + " · Deck", DeckNative.WS_POPUP, 0, 0, 1, 1, owner, IntPtr.Zero, DeckNative.GetModuleHandleW(null), IntPtr.Zero);
            if (Hwnd == IntPtr.Zero) throw new InvalidOperationException($"CreateWindowEx(deck menu): {Marshal.GetLastWin32Error()}");
        }

        /// <summary>
        /// A menu at a point of the screen (the cursor, or a button's corner): below and to the right of it when it fits,
        /// turned the other way when it does not, never past the work area.
        /// </summary>
        public static DeckMenu Open(IntPtr owner, List<Item> items, DeckNative.POINT at, DeckHost.MonitorInfo monitor, DeckTheme theme, bool exclude)
        {
            var menu = new DeckMenu(owner, items, monitor, theme, exclude, null);
            try
            {
                menu.Measure();
                var work = monitor.Work;
                int x = at.X, y = at.Y;
                if (x + menu._w > work.Right) x = at.X - menu._w;
                if (y + menu._h > work.Bottom) y = at.Y - menu._h;
                menu.Place(x, y);
                return menu;
            }
            catch
            {
                // Its window and its painter go with it (Fase 8).
                menu.Dispose();
                throw;
            }
        }

        /// <summary>Back over the decks (a window that took the top went under them, and they over this).</summary>
        public void Raise()
        {
            if (Hwnd != IntPtr.Zero) DeckNative.SetWindowPos(Hwnd, DeckNative.HWND_TOPMOST, 0, 0, 0, 0, DeckNative.SWP_NOMOVE | DeckNative.SWP_NOSIZE | DeckNative.SWP_NOACTIVATE);
        }

        // ── Size and place ──

        private bool IsPanel(Item item) => item.Swatches != null;
        private float RowH(Item item) => item.Separator ? SepH
            : IsPanel(item) ? (float)Math.Ceiling(item.Swatches!.Count / (double)SwatchCols) * (Swatch + SwatchGap) + SwatchGap
            : ItemH;

        private void Measure()
        {
            _scale = _monitor.Scale;
            var format = _painter.Format("Segoe UI Variable Small", FontSize, false, true);
            float text = 0;
            foreach (var item in _items)
            {
                if (item.Separator || IsPanel(item)) continue;
                text = Math.Max(text, DeckPainter.Measure(item.Label, format) + (item.Submenu != null ? ChevronW : 0) + (item.Checked ? 14 : 0));
            }
            float panel = _items.Any(IsPanel) ? SwatchCols * (Swatch + SwatchGap) + SwatchGap + 2 * Pad : 0;
            _wDip = Math.Clamp(Math.Max(Math.Max(MinW, text + 2 * TextX + 2 * Pad + 2), panel + 2), MinW, MaxW);
            _hDip = 2 + 2 * Pad + _items.Sum(RowH);
            _w = (int)Math.Ceiling(_wDip * _scale);
            _h = (int)Math.Ceiling(_hDip * _scale);
        }

        private void Place(int x, int y)
        {
            var work = _monitor.Work;
            _x = Math.Clamp(x, work.Left, Math.Max(work.Left, work.Right - _w));
            _y = Math.Clamp(y, work.Top, Math.Max(work.Top, work.Bottom - _h));
            Render();
            DeckNative.SetWindowDisplayAffinity(Hwnd, _exclude ? DeckNative.WDA_EXCLUDEFROMCAPTURE : DeckNative.WDA_NONE);
            DeckNative.ShowWindow(Hwnd, DeckNative.SW_SHOWNOACTIVATE);
            DeckNative.SetWindowPos(Hwnd, DeckNative.HWND_TOPMOST, 0, 0, 0, 0, DeckNative.SWP_NOMOVE | DeckNative.SWP_NOSIZE | DeckNative.SWP_NOACTIVATE);
        }

        /// <summary>The top of a row, in DIP from the window's top.</summary>
        private float RowTop(int index)
        {
            float y = 1 + Pad;
            for (int i = 0; i < index; i++) y += RowH(_items[i]);
            return y;
        }

        // ── Drawing ──

        private Color4 Mix(Color4 a, Color4 b, float k) => new(a.R * k + b.R * (1 - k), a.G * k + b.G * (1 - k), a.B * k + b.B * (1 - k), 1f);

        private void Render()
        {
            var t = _theme;
            _painter.Ensure(_w, _h, _scale);
            _painter.Begin();
            try
            {
                _painter.FillRound(0, 0, _wDip, _hDip, Radius, t.Card);
                _painter.StrokeRound(0, 0, _wDip, _hDip, Radius, t.BorderDefault);
                var format = _painter.Format("Segoe UI Variable Small", FontSize, false, true);
                var hover = Mix(t.Text, t.Card, 0.10f);
                var dim = Mix(t.Text, t.Card, 0.45f);
                float y = 1 + Pad;
                for (int i = 0; i < _items.Count; i++)
                {
                    var item = _items[i];
                    float h = RowH(item);
                    if (item.Separator)
                    {
                        _painter.FillRound(1 + Pad + 6, y + SepH / 2f - 0.5f, _wDip - 2 - 2 * Pad - 12, 1, 0, t.BorderSubtle);
                    }
                    else if (IsPanel(item))
                    {
                        for (int s = 0; s < item.Swatches!.Count; s++)
                        {
                            float sx = 1 + Pad + SwatchGap + (s % SwatchCols) * (Swatch + SwatchGap), sy = y + SwatchGap + (s / SwatchCols) * (Swatch + SwatchGap);
                            if (DeckTheme.Parse(item.Swatches[s]) is { } c) _painter.FillRound(sx, sy, Swatch, Swatch, 5, c);
                            bool on = string.Equals(item.Swatches[s], item.SwatchOn, StringComparison.OrdinalIgnoreCase);
                            if (on || (_hover == i && _hoverSwatch == s)) _painter.StrokeRound(sx - 2, sy - 2, Swatch + 4, Swatch + 4, 7, on ? t.Text : t.BorderStrong, 2f);
                        }
                    }
                    else
                    {
                        bool lit = !item.Disabled && (_hover == i || _childOf == i);
                        if (lit) _painter.FillRound(1 + Pad, y, _wDip - 2 - 2 * Pad, h, 4, hover);
                        var ink = item.Disabled ? dim : item.Danger ? t.RecordingFg : t.Text;
                        float tx = 1 + Pad + TextX;
                        if (item.Checked)
                        {
                            _painter.Text("✓", format, 1 + Pad + 2, y, 14, h, ink);
                            tx += 8;
                        }
                        _painter.Text(item.Label, format, tx, y, _wDip - 2 - 2 * Pad - TextX - (tx - (1 + Pad)) - (item.Submenu != null ? ChevronW : 0), h, ink);
                        if (item.Submenu != null) _painter.Text("›", format, _wDip - 1 - Pad - ChevronW, y, ChevronW - 4, h, ink);
                    }
                    y += h;
                }
            }
            finally { _painter.End(); }
            _painter.Present(Hwnd, _x, _y, 255);
        }

        // ── The mouse ──

        /// <summary>The row under a point (DIP), and the swatch when the row is a panel.</summary>
        private (int Row, int Swatch) Hit(float dx, float dy)
        {
            if (dx < 1 || dx > _wDip - 1) return (-1, -1);
            float y = 1 + Pad;
            for (int i = 0; i < _items.Count; i++)
            {
                float h = RowH(_items[i]);
                if (dy >= y && dy < y + h)
                {
                    var item = _items[i];
                    if (item.Separator) return (-1, -1);
                    if (!IsPanel(item)) return (i, -1);
                    int col = (int)((dx - 1 - Pad - SwatchGap / 2f) / (Swatch + SwatchGap)), row = (int)((dy - y - SwatchGap / 2f) / (Swatch + SwatchGap));
                    int s = row * SwatchCols + col;
                    return col >= 0 && col < SwatchCols && s >= 0 && s < item.Swatches!.Count ? (i, s) : (i, -1);
                }
                y += h;
            }
            return (-1, -1);
        }

        public IntPtr Proc(uint msg, IntPtr w, IntPtr l)
        {
            switch (msg)
            {
                case DeckNative.WM_MOUSEACTIVATE: return (IntPtr)DeckNative.MA_NOACTIVATE;
                case DeckNative.WM_POINTERACTIVATE: return (IntPtr)DeckNative.PA_NOACTIVATE;
                case DeckNative.WM_MOUSEMOVE:
                {
                    if (!_tracking)
                    {
                        var tme = new DeckNative.TRACKMOUSEEVENT { cbSize = (uint)Marshal.SizeOf<DeckNative.TRACKMOUSEEVENT>(), dwFlags = DeckNative.TME_LEAVE, hwndTrack = Hwnd };
                        _tracking = DeckNative.TrackMouseEvent(ref tme);
                    }
                    var (row, swatch) = Hit(DeckNative.LoX(l) / _scale, DeckNative.HiY(l) / _scale);
                    if (row != _hover || swatch != _hoverSwatch)
                    {
                        _hover = row;
                        _hoverSwatch = swatch;
                        DeckNative.KillTimer(Hwnd, TimerSub);
                        // A row with a submenu opens it after a moment; another row closes the open one after the same moment.
                        if ((row >= 0 && _items[row].Submenu != null && !_items[row].Disabled && row != _childOf) || (_child != null && row != _childOf))
                            DeckNative.SetTimer(Hwnd, TimerSub, SubDelayMs, IntPtr.Zero);
                        Render();
                    }
                    return IntPtr.Zero;
                }
                case DeckNative.WM_MOUSELEAVE:
                    _tracking = false;
                    if (_hover >= 0 && _hover != _childOf) { _hover = -1; _hoverSwatch = -1; Render(); }
                    return IntPtr.Zero;
                case DeckNative.WM_LBUTTONUP:
                case DeckNative.WM_RBUTTONUP:
                {
                    var (row, swatch) = Hit(DeckNative.LoX(l) / _scale, DeckNative.HiY(l) / _scale);
                    if (row < 0) return IntPtr.Zero;
                    var item = _items[row];
                    if (item.Disabled) return IntPtr.Zero;
                    if (IsPanel(item))
                    {
                        if (swatch < 0) return IntPtr.Zero;
                        string color = item.Swatches![swatch];
                        DeckHost.CloseMenus();
                        item.Pick?.Invoke(color);
                        return IntPtr.Zero;
                    }
                    if (item.Submenu != null)
                    {
                        DeckNative.KillTimer(Hwnd, TimerSub);
                        OpenChild(row);
                        return IntPtr.Zero;
                    }
                    DeckHost.CloseMenus();
                    item.Run?.Invoke();
                    return IntPtr.Zero;
                }
                case DeckNative.WM_TIMER:
                    if ((long)w == (long)(ulong)TimerSub)
                    {
                        DeckNative.KillTimer(Hwnd, TimerSub);
                        if (_hover >= 0 && _items[_hover].Submenu != null && !_items[_hover].Disabled) OpenChild(_hover);
                        else if (_child != null && !_child.HasMouse()) CloseChild();
                    }
                    return IntPtr.Zero;
            }
            return DeckNative.DefWindowProcW(Hwnd, msg, w, l);
        }

        /// <summary>Is the cursor on this menu or on one it opened?</summary>
        private bool HasMouse() => DeckNative.GetCursorPos(out var p) && (ScreenRect.Contains(p.X, p.Y) || (_child?.HasMouse() ?? false));

        /// <summary>The submenu of a row, beside it: to the right, or to the left where the right has no room.</summary>
        private void OpenChild(int row)
        {
            if (_childOf == row && _child != null) return;
            CloseChild();
            var items = _items[row].Submenu?.Invoke();
            if (items == null || items.Count == 0) return;
            var child = new DeckMenu(DeckNative.GetWindow(Hwnd, 4) is var owner && owner != IntPtr.Zero ? owner : IntPtr.Zero, items, _monitor, _theme, _exclude, this);
            try
            {
                child.Measure();
                var work = _monitor.Work;
                int overlap = (int)Math.Round(4 * _scale);
                int x = _x + _w - overlap;
                if (x + child._w > work.Right) x = _x - child._w + overlap;
                int y = _y + (int)Math.Round((RowTop(row) - Pad - 1) * _scale);
                child.Place(x, y);
            }
            catch
            {
                child.Dispose();
                throw;
            }
            _child = child;
            _childOf = row;
            DeckHost.MenuOpened(child);
            Render();
        }

        private void CloseChild()
        {
            if (_child == null) return;
            _child.Dispose();
            _child = null;
            _childOf = -1;
            DeckHost.MenusChanged();
            Render();
        }

        /// <summary>This menu and every one it opened, from the deepest.</summary>
        public IEnumerable<DeckMenu> Chain()
        {
            for (var m = this; m != null; m = m._child) yield return m;
        }

        public void Dispose()
        {
            _child?.Dispose();
            _child = null;
            if (Hwnd != IntPtr.Zero)
            {
                DeckNative.KillTimer(Hwnd, TimerSub);
                DeckHost.MenuClosed(this);
                DeckNative.DestroyWindow(Hwnd);
                Hwnd = IntPtr.Zero;
            }
            _painter.Dispose();
        }
    }
}
