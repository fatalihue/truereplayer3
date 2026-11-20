using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using Vortice.Mathematics;

namespace TrueReplayer.Services
{
    /// <summary>
    /// One deck on screen (branch deck; plan .claude/planos/deck-2026-11-19.md, Fase 2): a layered popup
    /// that never takes the foreground (WS_EX_NOACTIVATE, MA_NOACTIVATE, PA_NOACTIVATE — the Fase 0 probe
    /// A), always on top, out of Alt+Tab, owned by the Deck thread's hidden window, drawn by Direct2D into
    /// a premultiplied bitmap. It lives on the Deck thread (DeckHost) and nowhere else.
    ///
    /// Sizes are in DIP: the place is kept in DIP from an anchor of a monitor's work area, so a deck stays
    /// where it was put across scales and resolutions. Opacity, collapsing and the edge slide change the
    /// window with UpdateLayeredWindow alone — nothing is drawn again for them.
    ///
    /// Fase 3: a press runs the button (DeckHost.TileClick; a folder opens in the deck's place, with Back
    /// first); a button shows its state — its macro running (a ring and a bar, Stop under the mouse), a TR3
    /// switch on (the wash and the mini-switch), a failure (the dot, and the tip). In the passthrough the
    /// window lets every click through and the hook brings the user's mouse to it instead (Routed*).
    /// </summary>
    internal sealed class DeckWindow : IDisposable
    {
        public const string ClassName = AppIdentity.Id + "Deck";
        // The magnet: a work-area edge pulls at two lines, the edge itself and the 24 DIP a new deck starts at
        // (so a small drag never moves a deck off its margin); another deck pulls at its own edges and 8 DIP past.
        private const float Gap = 6, Pad = 8, HeaderH = 22, PillH = 30, Strip = 4, SnapReach = 12, EdgeMargin = 24, DeckGap = 8, Radius = 12, TileRadius = 8;
        private const int AnimMs = 130, LeaveDelayMs = 700, DragSlopPx = 4, TipDelayMs = 450;
        private static readonly UIntPtr TimerAnim = (UIntPtr)1, TimerLeave = (UIntPtr)2, TimerTip = (UIntPtr)3, TimerWatch = (UIntPtr)4;

        public readonly string Id;
        public IntPtr Hwnd { get; private set; }
        private DeckService.Deck _deck;
        private readonly DeckPainter _painter = new();

        // Where things are, in pixels.
        private float _scale = 1f;
        private DeckNative.RECT _work, _monitorRect;
        private int _w, _h;              // the window's size now (pill or full)
        private int _homeX, _homeY;      // the place, at rest
        private int _hideX, _hideY;      // slid past the edge
        private int _x, _y;              // where it is now (animated)
        private string? _edge;           // the edge it may slide past, or null

        // What the mouse is doing.
        private int _page, _hover = -1, _pressed = -1;
        private bool _inside, _tracking, _dragArmed, _dragging, _pressedHeader;
        private DeckNative.POINT _dragStart, _grab;

        // The passthrough: the window lets every click through, and the hook brings the user's mouse here
        // (Routed*); a press it brought stays the window's until its release comes the same way.
        private bool _routed, _routedPress;

        // The folder open in the deck's place (null: the pages).
        private string? _folder;
        // The labels cut short at the last frame, by slot: the tip says them whole.
        private readonly HashSet<int> _cut = new();

        // What it shows.
        private bool _collapsedNow, _edgeHiddenNow, _shown;
        private byte _alpha = 255, _alphaFrom = 255, _alphaTo = 255;
        private int _fromX, _fromY, _toX, _toY;
        private long _animStart = -1;

        public DeckWindow(DeckService.Deck deck, IntPtr owner)
        {
            Id = deck.Id;
            _deck = deck;
            Hwnd = DeckNative.CreateWindowExW(
                DeckNative.WS_EX_LAYERED | DeckNative.WS_EX_NOACTIVATE | DeckNative.WS_EX_TOOLWINDOW | DeckNative.WS_EX_TOPMOST,
                ClassName, AppIdentity.DisplayName + " · Deck · " + deck.Name, DeckNative.WS_POPUP, 0, 0, 1, 1, owner, IntPtr.Zero, DeckNative.GetModuleHandleW(null), IntPtr.Zero);
            if (Hwnd == IntPtr.Zero) throw new InvalidOperationException($"CreateWindowEx(deck): {Marshal.GetLastWin32Error()}");
            // Away from the mouse from the start: folded, past the edge, at its rest opacity.
            _collapsedNow = deck.Look.Collapse;
            _edgeHiddenNow = deck.Look.EdgeHide;
            _alpha = _alphaTo = RestAlpha;
        }

        public DeckNative.RECT ScreenRect => new(_x, _y, _x + _w, _y + _h);
        public bool Shown => _shown;
        public bool RoutedPress => _routedPress;

        /// <summary>Does a button of this deck run that macro (its ring and its bar follow the run)?</summary>
        public bool RunsMacro(string name) =>
            _deck.Pages.Any(p => p.Tiles.Any(t => t.Action.Kind == "macro" && t.Action.Macro == name))
            || _deck.Folders.Any(f => f.Tiles.Any(t => t.Action.Kind == "macro" && t.Action.Macro == name));

        // ── The config ──

        /// <summary>A new version of this deck (a save, a library change, a theme): laid out and drawn again.</summary>
        public void Update(DeckService.Deck deck, bool excludeFromCapture)
        {
            _deck = deck;
            if (_page >= deck.Pages.Count) _page = 0;
            if (_folder != null && !deck.Folders.Any(f => f.Id == _folder)) _folder = null;
            // A switch that changed while the mouse is away takes effect now; with the mouse on the deck, when it leaves.
            _collapsedNow = deck.Look.Collapse && (_collapsedNow || !_inside);
            _edgeHiddenNow = deck.Look.EdgeHide && (_edgeHiddenNow || !_inside);
            if (!_inside && !_dragging && _animStart < 0) _alpha = _alphaTo = RestAlpha;
            DeckNative.SetWindowDisplayAffinity(Hwnd, excludeFromCapture ? DeckNative.WDA_EXCLUDEFROMCAPTURE : DeckNative.WDA_NONE);
            Layout();
            Render();
        }

        public void SetShown(bool show)
        {
            if (show == _shown) return;
            _shown = show;
            if (show)
            {
                Layout();
                Render();
                DeckNative.ShowWindow(Hwnd, DeckNative.SW_SHOWNOACTIVATE);
                KeepOnTop();
            }
            else
            {
                StopTimers();
                _inside = _tracking = _dragArmed = _dragging = false;
                _hover = _pressed = -1;
                // Back at its pages the next time it shows.
                _folder = null;
                DeckHost.HideTip(this);
                if (DeckNative.GetCapture() == Hwnd) DeckNative.ReleaseCapture();
                DeckNative.ShowWindow(Hwnd, DeckNative.SW_HIDE);
            }
        }

        /// <summary>Back on top of other topmost windows (a game or a player that took the top meanwhile).</summary>
        public void KeepOnTop()
        {
            if (_shown) DeckNative.SetWindowPos(Hwnd, DeckNative.HWND_TOPMOST, 0, 0, 0, 0, DeckNative.SWP_NOMOVE | DeckNative.SWP_NOSIZE | DeckNative.SWP_NOACTIVATE);
        }

        /// <summary>The monitors or their work areas changed: the place is worked out again.</summary>
        public void Replace()
        {
            if (!_shown) return;
            Layout();
            Render();
        }

        /// <summary>A button's state changed (a run, a switch, a failure): drawn again.</summary>
        public void Redraw()
        {
            if (_shown) Render();
        }

        /// <summary>
        /// The passthrough (Fase 3). On, the window lets every click through (WS_EX_TRANSPARENT) — the engine's
        /// reach the app under it, and the user's come by the hook (Routed*). Off, it takes its mouse itself again.
        /// </summary>
        public void SetPassthrough(bool on)
        {
            if (on == _routed) return;
            _routed = on;
            long ex = DeckNative.GetWindowLongPtrW(Hwnd, DeckNative.GWL_EXSTYLE).ToInt64();
            ex = on ? ex | DeckNative.WS_EX_TRANSPARENT : ex & ~(long)DeckNative.WS_EX_TRANSPARENT;
            DeckNative.SetWindowLongPtrW(Hwnd, DeckNative.GWL_EXSTYLE, (IntPtr)ex);
            // A press the window had the usual way ends here (its WM_CAPTURECHANGED clears it).
            if (on && DeckNative.GetCapture() == Hwnd) DeckNative.ReleaseCapture();
            _tracking = false;
            // Back to its own mouse with the mouse on it: until a move of its own arms TrackMouseEvent, the window
            // watches for the mouse leaving. TrackMouseEvent cannot be armed now: Windows still has the window under
            // it as the mouse's (until the next move), and would say "left" at once — a press brought by the hook,
            // still waiting for its release, would lose its button.
            if (!on && _inside && _shown) DeckNative.SetTimer(Hwnd, TimerWatch, 100, IntPtr.Zero);
        }

        /// <summary>After the passthrough: the mouse left without a move of the window's own — it is a leave.</summary>
        private void WatchTick()
        {
            if (!_inside || _routed || _tracking || !_shown)
            {
                DeckNative.KillTimer(Hwnd, TimerWatch);
                return;
            }
            if (DeckNative.GetCursorPos(out var p) && !ScreenRect.Contains(p.X, p.Y) && !_routedPress)
            {
                DeckNative.KillTimer(Hwnd, TimerWatch);
                OnLeave();
            }
        }

        // ── Sizes and the place ──

        private float Tile => _deck.Grid.Size switch { "s" => 48f, "l" => 80f, _ => 64f };
        private float HeaderDip => _deck.Look.Header ? HeaderH : 0f;
        private float FullWDip => 2 + 2 * Pad + _deck.Grid.Cols * Tile + (_deck.Grid.Cols - 1) * Gap;
        private float FullHDip => 2 + HeaderDip + 2 * Pad + _deck.Grid.Rows * Tile + (_deck.Grid.Rows - 1) * Gap;
        private float PillWDip => 2 + 10 + 16 + 6 + Math.Min(220f, DeckPainter.Measure(Name, _painter.Format("Segoe UI Variable Small", 11f, false, true))) + 12;
        private string Name => _deck.Name.Length > 0 ? _deck.Name : "Deck";

        private byte RestAlpha => _deck.Look.RestOpacity <= 0 ? (byte)1 : (byte)Math.Round(255 * _deck.Look.RestOpacity / 100.0);

        /// <summary>The monitor, the scale, the size and the place at rest (and past the edge), from the deck's Place.</summary>
        private void Layout()
        {
            var monitor = DeckHost.MonitorFor(_deck.Place.Monitor);
            _work = monitor.Work;
            _monitorRect = monitor.Bounds;
            _scale = monitor.Scale;

            float wDip = _collapsedNow ? PillWDip : FullWDip;
            float hDip = _collapsedNow ? PillH : FullHDip;
            _w = (int)Math.Ceiling(wDip * _scale);
            _h = (int)Math.Ceiling(hDip * _scale);

            var (fx, fy) = AnchorFactors(_deck.Place.Anchor);
            double ax = _work.Left + fx * _work.Width, ay = _work.Top + fy * _work.Height;
            int x = (int)Math.Round(ax + _deck.Place.Dx * _scale - fx * _w);
            int y = (int)Math.Round(ay + _deck.Place.Dy * _scale - fy * _h);
            _homeX = Math.Clamp(x, _work.Left, Math.Max(_work.Left, _work.Right - _w));
            _homeY = Math.Clamp(y, _work.Top, Math.Max(_work.Top, _work.Bottom - _h));

            _edge = _deck.Look.EdgeHide ? DeckHost.EdgeFor(_deck.Place.Anchor, monitor) : null;
            int strip = (int)Math.Ceiling(Strip * _scale);
            (_hideX, _hideY) = _edge switch
            {
                "left" => (_monitorRect.Left - _w + strip, _homeY),
                "right" => (_monitorRect.Right - strip, _homeY),
                "top" => (_homeX, _monitorRect.Top - _h + strip),
                "bottom" => (_homeX, _monitorRect.Bottom - strip),
                _ => (_homeX, _homeY),
            };
            if (_edge == null) _edgeHiddenNow = false;
            if (!_dragging && _animStart < 0)
            {
                (_x, _y) = _edgeHiddenNow ? (_hideX, _hideY) : (_homeX, _homeY);
                (_toX, _toY) = (_x, _y);
            }
            _painter.Ensure(_w, _h, _scale);
        }

        private static (double fx, double fy) AnchorFactors(string anchor) => anchor switch
        {
            "top-left" => (0, 0), "top" => (0.5, 0), "top-right" => (1, 0),
            "left" => (0, 0.5), "center" => (0.5, 0.5), "right" => (1, 0.5),
            "bottom-left" => (0, 1), "bottom" => (0.5, 1), _ => (1, 1),
        };

        // ── What the deck shows: its page, or the folder open in its place ──

        private DeckService.Folder? OpenFolder => _folder == null ? null : _deck.Folders.FirstOrDefault(f => f.Id == _folder);

        private List<DeckService.Tile> ViewTiles()
        {
            if (OpenFolder is { } folder) return folder.Tiles;
            return _deck.Pages.Count > 0 ? _deck.Pages[Math.Clamp(_page, 0, _deck.Pages.Count - 1)].Tiles : new List<DeckService.Tile>();
        }

        /// <summary>The button in a slot of what the deck shows; null for an empty slot and for Back (slot 0 of a folder).</summary>
        private DeckService.Tile? TileAt(int slot)
        {
            if (_folder != null && slot == 0) return null;
            int slots = _deck.Grid.Cols * _deck.Grid.Rows;
            if (slot < 0 || slot >= slots) return null;
            return ViewTiles().FirstOrDefault(t => t.Slot == slot);
        }

        // ── Drawing ──

        private void Render()
        {
            if (!_shown || Hwnd == IntPtr.Zero) return;
            var t = DeckHost.Theme;
            _painter.Ensure(_w, _h, _scale);
            _painter.Begin();
            try
            {
                if (_collapsedNow) DrawPill(t);
                else DrawDeck(t);
            }
            finally
            {
                if (!_painter.End()) { _painter.Ensure(_w, _h, _scale); }
            }
            _painter.Present(Hwnd, _x, _y, _alpha);
            DeckHost.Moved();
        }

        private void DrawPill(DeckTheme t)
        {
            float w = _w / _scale, h = PillH;
            _painter.FillRound(0, 0, w, h, h / 2, t.Surface);
            _painter.StrokeRound(0, 0, w, h, h / 2, t.BorderDefault);
            DrawDeckIcon(t, 11, 7, 16);
            _painter.Text(Name, _painter.Format("Segoe UI Variable Small", 11f, false, true), 33, 0, w - 33 - 12, h, t.Text);
        }

        private void DrawDeckIcon(DeckTheme t, float x, float y, float size)
        {
            var icon = _deck.Icon;
            if (icon?.Kind == "emoji" && icon.Value != null)
                _painter.Text(icon.Value, _painter.Format("Segoe UI Emoji", size * 0.9f, true, false), x - 2, y - 2, size + 4, size + 4, t.Text);
            else if (icon?.Kind == "lucide" && (icon.Svg ?? (icon.Name != null && DeckIcons.Svg.TryGetValue(icon.Name, out var s) ? s : null)) is { } svg)
                _painter.Svg(svg, Hex(t.Text), x, y, size);
            else
                _painter.Svg(DeckIcons.Svg["layout-grid"], Hex(t.Text), x, y, size);
        }

        private void DrawDeck(DeckTheme t)
        {
            float w = FullWDip, h = FullHDip;
            _painter.FillRound(0, 0, w, h, Radius, t.Surface);
            _painter.StrokeRound(0, 0, w, h, Radius, t.BorderDefault);

            var folder = OpenFolder;
            if (_deck.Look.Header)
            {
                // A folder shows its own name, and no page dots: it is one grid.
                int pages = folder == null ? _deck.Pages.Count : 1;
                float dotsW = pages > 1 ? pages * 10f : 0f;
                string title = folder != null && folder.Name.Length > 0 ? folder.Name : Name;
                _painter.Text(title, _painter.Format("Segoe UI Variable Small", 11f, false, true), 1 + Pad, 1, w - 2 - 2 * Pad - dotsW, HeaderH, t.Text);
                for (int i = 0; i < pages && pages > 1; i++)
                    _painter.Circle(w - 1 - Pad - dotsW + i * 10f + 5f, 1 + HeaderH / 2f, i == _page ? 3f : 2.5f, i == _page ? t.Text : t.BorderStrong);
            }

            int slots = _deck.Grid.Cols * _deck.Grid.Rows;
            var bySlot = new Dictionary<int, DeckService.Tile>();
            foreach (var tile in ViewTiles()) if (tile.Slot < slots) bySlot[tile.Slot] = tile;

            _cut.Clear();
            for (int slot = 0; slot < slots; slot++)
            {
                var (x, y) = TileOrigin(slot);
                if (folder != null && slot == 0)
                {
                    DrawBack(t, x, y, slot == _hover, slot == _pressed);
                    continue;
                }
                if (!bySlot.TryGetValue(slot, out var tile))
                {
                    // An empty place: only its outline, so the grid reads as a grid.
                    _painter.StrokeRound(x, y, Tile, Tile, TileRadius, t.BorderSubtle);
                    continue;
                }
                DrawTile(t, tile, slot, x, y, slot == _hover, slot == _pressed);
            }
        }

        private (float x, float y) TileOrigin(int slot)
        {
            int c = slot % _deck.Grid.Cols, r = slot / _deck.Grid.Cols;
            return (1 + Pad + c * (Tile + Gap), 1 + HeaderDip + Pad + r * (Tile + Gap));
        }

        /// <summary>A button's face, in screen pixels (the tip's anchor); the whole window while it is a pill.</summary>
        private DeckNative.RECT TileScreenRect(int slot)
        {
            if (_collapsedNow || slot < 0) return ScreenRect;
            var (tx, ty) = TileOrigin(slot);
            return new DeckNative.RECT(_x + (int)Math.Floor(tx * _scale), _y + (int)Math.Floor(ty * _scale),
                _x + (int)Math.Ceiling((tx + Tile) * _scale), _y + (int)Math.Ceiling((ty + Tile) * _scale));
        }

        private void PressTransform(float x, float y, float size, bool pressed)
        {
            if (!pressed) return;
            // The press: a 0.97 scale around the button's centre (the app's buttons do the same).
            var target = _painter.Target;
            var c = new System.Numerics.Vector2(x + size / 2, y + size / 2);
            target.Transform = System.Numerics.Matrix3x2.CreateScale(0.97f, c) * target.Transform;
        }

        private void DrawBack(DeckTheme t, float x, float y, bool hover, bool pressed)
        {
            float size = Tile;
            var before = _painter.Target.Transform;
            PressTransform(x, y, size, pressed);
            _painter.FillRound(x, y, size, size, TileRadius, t.Card);
            _painter.StrokeRound(x, y, size, size, TileRadius, hover || pressed ? t.BorderStrong : t.BorderSubtle);
            float iconBox = size * 26f / 64f;
            _painter.Svg(DeckIcons.Svg["chevron-left"], Hex(t.Text), x + (size - iconBox) / 2f, y + size * 11f / 64f, iconBox);
            DrawLabel(t, S.DeckBack, -1, x, y, size);
            _painter.Target.Transform = before;
        }

        private void DrawTile(DeckTheme t, DeckService.Tile tile, int slot, float x, float y, bool hover, bool pressed)
        {
            float size = Tile, k = size / 64f;
            var before = _painter.Target.Transform;
            PressTransform(x, y, size, pressed);

            var live = DeckHost.Live;
            var a = tile.Action;
            // A TR3 switch: on or off, by the mini-switch's place and fill, and the wash when on (two channels).
            bool? on = a.Kind == "tr3" ? a.Command switch
            {
                "clicker" => live.ClickerMode,
                "teclado" => live.Teclado,
                "remaps" => live.Remaps,
                "automations" => live.Automations,
                "shortcuts" => live.Shortcuts,
                _ => (bool?)null,
            } : null;
            bool isOn = on == true;
            _painter.FillRound(x, y, size, size, TileRadius, isOn ? t.OnFace : t.Card);
            _painter.StrokeRound(x, y, size, size, TileRadius, isOn ? t.OnBorder : hover || pressed ? t.BorderStrong : t.BorderSubtle);

            bool running = a.Kind == "macro" && a.Macro != null && a.Macro == live.RunningMacro;
            bool missing = a.Kind == "macro" && a.Macro != null && !DeckService.IsMacroFound(a.Macro);
            if (running && hover)
            {
                // Under the mouse, a running macro's button says what a press does now: Stop.
                float iconBox = size * 26f / 64f;
                _painter.Svg(DeckIcons.Svg["square"], Hex(t.Text), x + (size - iconBox) / 2f, y + size * 11f / 64f, iconBox);
            }
            else DrawTileIcon(t, tile, x, y, size, missing);

            DrawLabel(t, LabelOf(tile), slot, x, y, size);

            if (running)
            {
                // Running: the fixed ring in the replay ink, and the bar of the steps done.
                _painter.StrokeRound(x, y, size, size, TileRadius, t.ReplayFg, 2f);
                float progress = DeckHost.Progress;
                if (progress > 0)
                {
                    float barW = (size - 18 * k) * Math.Min(1f, progress);
                    _painter.FillRound(x + 9 * k, y + size - 4.5f, barW, 2.5f, 1.25f, t.ReplayFg);
                }
            }
            else if (a.Kind == "tr3" && a.Command == "record" && live.Recording)
                _painter.StrokeRound(x, y, size, size, TileRadius, t.RecordingFg, 2f);
            else if (a.Kind == "tr3" && a.Command == "clicker" && live.Clicking)
                _painter.StrokeRound(x, y, size, size, TileRadius, t.ReplayFg, 2f);

            if (on.HasValue)
            {
                float tw = 14 * k, th = 8 * k, tx = x + size - 6 * k - tw, ty = y + 6 * k;
                if (on.Value)
                {
                    _painter.FillRound(tx, ty, tw, th, th / 2, t.Text);
                    _painter.Circle(tx + tw - th / 2, ty + th / 2, th / 2 - k, t.OnFace);
                }
                else
                {
                    _painter.StrokeRound(tx, ty, tw, th, th / 2, t.BorderStrong);
                    _painter.Circle(tx + th / 2, ty + th / 2, th / 2 - 2 * k, t.BorderStrong);
                }
            }
            else if (DeckHost.FailureOf(tile) != null)
                _painter.Circle(x + size - 9 * k, y + 9 * k, 3 * k, t.RecordingFg);

            _painter.Target.Transform = before;
        }

        private void DrawLabel(DeckTheme t, string? label, int slot, float x, float y, float size)
        {
            if (string.IsNullOrEmpty(label)) return;
            float labelTop = y + size * 42f / 64f, labelH = size < 56 ? 14f : 16f;
            var format = _painter.Format("Segoe UI Variable Small", size >= 80 ? 12f : 11f, true, true);
            _painter.Text(label, format, x + 5, labelTop, size - 10, labelH, t.Text);
            if (slot >= 0 && _painter.TextWidth(label, format) > size - 10) _cut.Add(slot);
        }

        private void DrawTileIcon(DeckTheme t, DeckService.Tile tile, float x, float y, float size, bool missing)
        {
            float iconBox = size * 26f / 64f, iconX = x + (size - iconBox) / 2f, iconY = y + size * 11f / 64f;
            if (missing)
            {
                _painter.Svg(DeckIcons.Svg["triangle-alert"], Hex(t.RecordingFg), iconX, iconY, iconBox);
                return;
            }
            var icon = tile.Icon;
            string? emoji = icon?.Kind == "emoji" ? icon.Value
                : icon == null && tile.Action.Kind == "macro" && tile.Action.Macro != null ? DeckService.MacroEmoji(tile.Action.Macro) : null;
            if (!string.IsNullOrEmpty(emoji))
            {
                float box = size * 30f / 64f;
                _painter.Text(emoji, _painter.Format("Segoe UI Emoji", size * 24f / 64f, true, false), x + 1, y + size * 7f / 64f, size - 2, box, t.Text);
                return;
            }
            if (icon?.Kind == "image" && icon.Path != null)
            {
                float box = size * 30f / 64f;
                var file = Path.Combine(AppIdentity.DocumentsRoot, "Deck", "images", icon.Path);
                if (_painter.Image(file, x + (size - box) / 2f, y + size * 8f / 64f, box, box)) return;
            }

            string svg = icon?.Kind == "lucide" && icon.Svg != null ? icon.Svg
                : icon?.Kind == "lucide" && icon.Name != null && DeckIcons.Svg.TryGetValue(icon.Name, out var known) ? known
                : DeckIcons.Svg[DefaultIcon(tile.Action)];
            if (tile.Color != null && DeckTheme.Parse(tile.Color) is { } swatch)
            {
                // A colour: a chip in it, and the icon in the ink that reads on that swatch (SWATCH_CHECK_INK).
                float chip = size * 30f / 64f, chipX = x + (size - chip) / 2f, chipY = y + size * 8f / 64f;
                _painter.FillRound(chipX, chipY, chip, chip, chip * 7f / 30f, swatch);
                float inner = chip * 20f / 30f;
                _painter.Svg(svg, LightSwatch(tile.Color) ? "rgba(0, 0, 0, 0.72)" : "#ffffff", chipX + (chip - inner) / 2f, chipY + (chip - inner) / 2f, inner);
                return;
            }
            var ink = tile.Action.Kind == "none" ? t.BorderStrong : t.Text;
            _painter.Svg(svg, Hex(ink), iconX, iconY, iconBox);
        }

        /// <summary>The icon of a button that has none of its own: its action's.</summary>
        private static string DefaultIcon(DeckService.Action a) => a.Kind switch
        {
            "macro" => "play",
            "keys" => "keyboard",
            "text" => "type",
            "open" => "external-link",
            "folder" => "folder",
            "tr3" => a.Command switch
            {
                "record" => "circle",
                "stopAll" => "square",
                "clicker" => "mouse-pointer-click",
                "teclado" => "keyboard",
                "remaps" => "arrow-right-left",
                "automations" => "zap",
                "shortcuts" => "command",
                _ => "app-window",
            },
            _ => "plus",
        };

        /// <summary>The text under the icon: the button's own, or what its action says.</summary>
        private string? LabelOf(DeckService.Tile tile)
        {
            if (!string.IsNullOrEmpty(tile.Label)) return tile.Label;
            var a = tile.Action;
            return a.Kind switch
            {
                "macro" => a.Macro,
                "keys" => a.Combo,
                "text" => a.Text is { Length: > 0 } s ? s.Replace('\n', ' ').Replace('\r', ' ') : null,
                "open" => a.Target is { } target ? OpenLabel(target) : null,
                "folder" => _deck.Folders.FirstOrDefault(f => f.Id == a.Folder)?.Name,
                "tr3" => a.Command switch
                {
                    "record" => S.DeckCommandRecord,
                    "stopAll" => S.DeckCommandStopAll,
                    "clicker" => S.DeckCommandClicker,
                    "teclado" => S.DeckCommandTeclado,
                    "remaps" => S.DeckCommandRemaps,
                    "automations" => S.DeckCommandAutomations,
                    "shortcuts" => S.DeckCommandShortcuts,
                    "show" => S.DeckCommandShow,
                    _ => null,
                },
                _ => null,
            };
        }

        private static string OpenLabel(string target)
        {
            if (Uri.TryCreate(target, UriKind.Absolute, out var uri) && (uri.Scheme == "http" || uri.Scheme == "https")) return uri.Host;
            try { var name = Path.GetFileNameWithoutExtension(target.TrimEnd('\\', '/')); return name.Length > 0 ? name : target; }
            catch { return target; }
        }

        private static bool LightSwatch(string hex)
        {
            int n = Convert.ToInt32(hex.Substring(1, 6), 16);
            return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 150;
        }

        private static string Hex(Color4 c) =>
            $"#{(int)Math.Round(c.R * 255):x2}{(int)Math.Round(c.G * 255):x2}{(int)Math.Round(c.B * 255):x2}";

        // ── The tip ──

        /// <summary>What the tip says over a button: its failure, its macro missing, or its label cut short. Null: no tip.</summary>
        private string? TipFor(int slot)
        {
            var tile = TileAt(slot);
            if (tile == null) return null;
            if (DeckHost.FailureOf(tile) is { } failure) return failure;
            var a = tile.Action;
            if (a.Kind == "macro" && a.Macro != null && !DeckService.IsMacroFound(a.Macro)) return S.DeckTipMissing(name: a.Macro);
            return _cut.Contains(slot) ? LabelOf(tile) : null;
        }

        private void ArmTip()
        {
            DeckNative.KillTimer(Hwnd, TimerTip);
            DeckHost.HideTip(this);
            if (_hover >= 0 && !_dragArmed && TipFor(_hover) != null) DeckNative.SetTimer(Hwnd, TimerTip, TipDelayMs, IntPtr.Zero);
        }

        private void ShowHoverTip()
        {
            if (!_inside || _hover < 0 || _dragArmed) return;
            if (TipFor(_hover) is { } text) DeckHost.ShowTip(this, text, TileScreenRect(_hover));
        }

        /// <summary>A press that did not do what its button says: the tip says why, for a moment, over that button.</summary>
        public void Flash(int slot, string message)
        {
            if (!_shown) return;
            DeckNative.KillTimer(Hwnd, TimerTip);
            DeckHost.ShowTip(this, message, TileScreenRect(slot), autoHideMs: 2600);
        }

        // ── The mouse ──

        public IntPtr Proc(uint msg, IntPtr w, IntPtr l)
        {
            switch (msg)
            {
                case DeckNative.WM_MOUSEACTIVATE: return (IntPtr)DeckNative.MA_NOACTIVATE;
                case DeckNative.WM_POINTERACTIVATE: return (IntPtr)DeckNative.PA_NOACTIVATE;
                // In the passthrough the hook brings the mouse (Routed*): what still comes this way is stale.
                case DeckNative.WM_MOUSEMOVE: if (!_routed) OnMove(DeckNative.LoX(l), DeckNative.HiY(l), routed: false); return IntPtr.Zero;
                // A press the hook brought owns the mouse until its release comes the same way.
                case DeckNative.WM_MOUSELEAVE: _tracking = false; if (!_routed && !_routedPress) OnLeave(); return IntPtr.Zero;
                case DeckNative.WM_LBUTTONDOWN: if (!_routed) OnDown(DeckNative.LoX(l), DeckNative.HiY(l), routed: false); return IntPtr.Zero;
                case DeckNative.WM_LBUTTONUP: if (!_routed) OnUp(DeckNative.LoX(l), DeckNative.HiY(l), routed: false); return IntPtr.Zero;
                case DeckNative.WM_MOUSEWHEEL: if (!_routed) OnWheel((short)(((long)w >> 16) & 0xFFFF)); return IntPtr.Zero;
                case DeckNative.WM_CAPTURECHANGED:
                    if (l != Hwnd && !_routedPress && (_dragging || _dragArmed || _pressed >= 0)) { _dragArmed = _dragging = false; _pressed = -1; Render(); }
                    return IntPtr.Zero;
                case DeckNative.WM_TIMER:
                    if ((long)w == (long)(ulong)TimerAnim) AnimTick();
                    else if ((long)w == (long)(ulong)TimerLeave) { DeckNative.KillTimer(Hwnd, TimerLeave); SettleOutside(); }
                    else if ((long)w == (long)(ulong)TimerTip) { DeckNative.KillTimer(Hwnd, TimerTip); ShowHoverTip(); }
                    else if ((long)w == (long)(ulong)TimerWatch) WatchTick();
                    return IntPtr.Zero;
                case DeckNative.WM_DPICHANGED:
                    // Windows suggests a rect; the deck works its place out itself, from the anchor.
                    Layout();
                    Render();
                    return IntPtr.Zero;
            }
            return DeckNative.DefWindowProcW(Hwnd, msg, w, l);
        }

        // The mouse the hook brings in the passthrough (DeckHost), in screen pixels.
        public void RoutedMove(int sx, int sy) => OnMove(sx - _x, sy - _y, routed: true);

        public void RoutedLeave()
        {
            if (!_routedPress) OnLeave();
        }

        public void RoutedButton(bool down, bool right, int sx, int sy)
        {
            // The right button has nothing on a deck yet (its menu comes with the editing on screen, Fase 6).
            if (right) return;
            if (down)
            {
                _routedPress = true;
                if (!_inside) Enter();
                OnDown(sx - _x, sy - _y, routed: true);
            }
            else
            {
                _routedPress = false;
                OnUp(sx - _x, sy - _y, routed: true);
            }
        }

        public void RoutedWheel(int delta) => OnWheel(delta);

        private void OnMove(int px, int py, bool routed)
        {
            if (!routed && !_tracking)
            {
                var tme = new DeckNative.TRACKMOUSEEVENT { cbSize = (uint)Marshal.SizeOf<DeckNative.TRACKMOUSEEVENT>(), dwFlags = DeckNative.TME_LEAVE, hwndTrack = Hwnd };
                _tracking = DeckNative.TrackMouseEvent(ref tme);
            }
            if (!_inside) Enter();

            if (_dragArmed && DeckNative.GetCursorPos(out var cur))
            {
                if (!_dragging && (Math.Abs(cur.X - _dragStart.X) > DragSlopPx || Math.Abs(cur.Y - _dragStart.Y) > DragSlopPx)) _dragging = true;
                if (_dragging)
                {
                    (_x, _y) = Snap(cur.X - _grab.X, cur.Y - _grab.Y);
                    DeckPainter.Move(Hwnd, _x, _y, _alpha);
                    DeckHost.Moved();
                }
                return;
            }
            int hover = _collapsedNow ? -1 : HitTile(px / _scale, py / _scale);
            if (hover != _hover)
            {
                _hover = hover;
                Render();
                ArmTip();
            }
        }

        private void Enter()
        {
            _inside = true;
            DeckNative.KillTimer(Hwnd, TimerLeave);
            _edgeHiddenNow = false;
            if (_collapsedNow && !_dragArmed)
            {
                // The pill opens into the deck, at the same anchor point (it covers where the pill was).
                _collapsedNow = false;
                _animStart = -1;
                DeckNative.KillTimer(Hwnd, TimerAnim);
                Layout();
                Render();
            }
            AnimateTo(_homeX, _homeY, 255);
        }

        private void OnLeave()
        {
            if (_dragArmed || _dragging) return;
            _inside = false;
            DeckNative.KillTimer(Hwnd, TimerTip);
            DeckHost.HideTip(this);
            if (_hover >= 0 || _pressed >= 0) { _hover = -1; _pressed = -1; Render(); }
            if (_deck.Look.Collapse || _edge != null) DeckNative.SetTimer(Hwnd, TimerLeave, LeaveDelayMs, IntPtr.Zero);
            AnimateTo(_homeX, _homeY, RestAlpha);
        }

        /// <summary>The mouse is away and stayed away: fold into the pill, slide past the edge — back at the pages.</summary>
        private void SettleOutside()
        {
            if (_inside || _dragging) return;
            bool folded = false;
            if (_deck.Look.Collapse && !_collapsedNow)
            {
                _collapsedNow = true;
                folded = true;
            }
            if (_folder != null) { _folder = null; folded = true; }
            if (folded)
            {
                Layout();
                Render();
            }
            if (_edge != null)
            {
                _edgeHiddenNow = true;
                AnimateTo(_hideX, _hideY, RestAlpha);
            }
        }

        private void OnDown(int px, int py, bool routed)
        {
            DeckNative.KillTimer(Hwnd, TimerTip);
            DeckHost.HideTip(this);
            float dx = px / _scale, dy = py / _scale;
            _pressedHeader = _collapsedNow || (_deck.Look.Header && dy < 1 + HeaderH);
            if (_pressedHeader)
            {
                // The header (or the pill) moves the deck, unless it is locked.
                if (!_deck.Look.Locked && DeckNative.GetCursorPos(out var cur))
                {
                    _dragArmed = true;
                    _dragStart = cur;
                    _grab = new DeckNative.POINT(cur.X - _x, cur.Y - _y);
                }
                if (!routed) DeckNative.SetCapture(Hwnd);
                return;
            }
            int slot = HitTile(dx, dy);
            if (slot >= 0)
            {
                _pressed = slot;
                if (!routed) DeckNative.SetCapture(Hwnd);
                Render();
            }
        }

        private void OnUp(int px, int py, bool routed)
        {
            // Read before ReleaseCapture: its WM_CAPTURECHANGED comes back into this window.
            bool wasDragging = _dragging, header = _pressedHeader;
            int pressed = _pressed;
            _dragArmed = _dragging = _pressedHeader = false;
            _pressed = -1;
            if (!routed && DeckNative.GetCapture() == Hwnd) DeckNative.ReleaseCapture();
            if (wasDragging)
            {
                DeckHost.SavePlace(Id, PlaceFromScreen());
                return;
            }
            float dx = px / _scale, dy = py / _scale;
            if (header)
            {
                if (!_collapsedNow && _folder == null && _deck.Pages.Count > 1 && HitDot(dx, dy) is int dot and >= 0 && dot != _page) { _page = dot; Render(); }
                return;
            }
            Render();
            int slot = HitTile(dx, dy);
            if (slot >= 0 && slot == pressed) Press(slot);
        }

        /// <summary>A button pressed and let go on it: Back, a folder, or its action (DeckHost).</summary>
        private void Press(int slot)
        {
            if (_folder != null && slot == 0)
            {
                _folder = null;
                Render();
                ArmTip();
                return;
            }
            var tile = TileAt(slot);
            if (tile == null)
            {
                DiagnosticLog.Info($"Deck: click on '{Id}' slot {slot} (empty)");
                return;
            }
            if (tile.Action.Kind == "folder")
            {
                if (tile.Action.Folder != null && _deck.Folders.Any(f => f.Id == tile.Action.Folder))
                {
                    _folder = tile.Action.Folder;
                    DiagnosticLog.Info($"Deck: '{Id}' opened the folder '{_folder}'");
                    Render();
                    ArmTip();
                }
                return;
            }
            DeckHost.TileClick(Id, _folder ?? "page " + _page, slot, tile);
            ArmTip();
        }

        private void OnWheel(int delta)
        {
            int pages = _deck.Pages.Count;
            if (pages <= 1 || _collapsedNow || _folder != null) return;
            _page = (_page + (delta < 0 ? 1 : pages - 1)) % pages;
            Render();
            ArmTip();
        }

        private int HitTile(float dx, float dy)
        {
            int slots = _deck.Grid.Cols * _deck.Grid.Rows;
            for (int slot = 0; slot < slots; slot++)
            {
                var (x, y) = TileOrigin(slot);
                if (dx >= x && dx < x + Tile && dy >= y && dy < y + Tile) return slot;
            }
            return -1;
        }

        private int HitDot(float dx, float dy)
        {
            int pages = _deck.Pages.Count;
            float dotsW = pages * 10f, left = FullWDip - 1 - Pad - dotsW;
            if (dy > 1 + HeaderH || dx < left || dx >= left + dotsW) return -1;
            return Math.Clamp((int)((dx - left) / 10f), 0, pages - 1);
        }

        // ── Moving: the magnet, and the place kept in DIP ──

        /// <summary>A dragged deck near an edge of its work area, or near another deck, settles on it.</summary>
        private (int x, int y) Snap(int x, int y)
        {
            var monitor = DeckHost.MonitorAt(x + _w / 2, y + _h / 2);
            var work = monitor.Work;
            float s = monitor.Scale;
            int reach = (int)Math.Round(SnapReach * s), margin = (int)Math.Round(EdgeMargin * s), gap = (int)Math.Round(DeckGap * s);
            // The nearest line within reach wins; a start line is where the deck's left/top edge may land, an
            // end line where its right/bottom edge may.
            int SnapAxis(int v, int size, List<int> starts, List<int> ends)
            {
                int best = v, bestDist = reach + 1;
                foreach (var line in starts) if (Math.Abs(v - line) < bestDist) { bestDist = Math.Abs(v - line); best = line; }
                foreach (var line in ends) if (Math.Abs(v + size - line) < bestDist) { bestDist = Math.Abs(v + size - line); best = line - size; }
                return best;
            }
            var xStarts = new List<int> { work.Left, work.Left + margin };
            var xEnds = new List<int> { work.Right, work.Right - margin };
            var yStarts = new List<int> { work.Top, work.Top + margin };
            var yEnds = new List<int> { work.Bottom, work.Bottom - margin };
            foreach (var r in DeckHost.OtherRects(Id))
            {
                xStarts.Add(r.Left); xStarts.Add(r.Right + gap); xEnds.Add(r.Right); xEnds.Add(r.Left - gap);
                yStarts.Add(r.Top); yStarts.Add(r.Bottom + gap); yEnds.Add(r.Bottom); yEnds.Add(r.Top - gap);
            }
            x = SnapAxis(x, _w, xStarts, xEnds);
            y = SnapAxis(y, _h, yStarts, yEnds);
            x = Math.Clamp(x, work.Left, Math.Max(work.Left, work.Right - _w));
            y = Math.Clamp(y, work.Top, Math.Max(work.Top, work.Bottom - _h));
            return (x, y);
        }

        /// <summary>Where the deck is now, as a Place: the monitor under its centre, the nearest of the nine anchors, the offset in DIP.</summary>
        private DeckService.Place PlaceFromScreen()
        {
            var monitor = DeckHost.MonitorAt(_x + _w / 2, _y + _h / 2);
            var work = monitor.Work;
            double cx = (_x + _w / 2.0 - work.Left) / Math.Max(1, work.Width), cy = (_y + _h / 2.0 - work.Top) / Math.Max(1, work.Height);
            string col = cx < 1 / 3.0 ? "left" : cx > 2 / 3.0 ? "right" : "";
            string row = cy < 1 / 3.0 ? "top" : cy > 2 / 3.0 ? "bottom" : "";
            string anchor = (row, col) switch
            {
                ("", "") => "center",
                ("", _) => col,
                (_, "") => row,
                _ => row + "-" + col,
            };
            var (fx, fy) = AnchorFactors(anchor);
            double ax = work.Left + fx * work.Width, ay = work.Top + fy * work.Height;
            // The pill and the full deck keep the same anchor point: the offset is the full deck's.
            double dx = (_x + fx * _w - ax) / monitor.Scale, dy = (_y + fy * _h - ay) / monitor.Scale;
            return new DeckService.Place { Monitor = monitor.DevicePath, Anchor = anchor, Dx = Math.Round(dx, 1), Dy = Math.Round(dy, 1) };
        }

        // ── Animations: opacity and the slide, with UpdateLayeredWindow alone ──

        private void AnimateTo(int x, int y, byte alpha)
        {
            _toX = x; _toY = y; _alphaTo = alpha;
            if (!DeckHost.Theme.Animations || !_shown)
            {
                _x = x; _y = y; _alpha = alpha;
                _animStart = -1;
                DeckNative.KillTimer(Hwnd, TimerAnim);
                if (_shown)
                {
                    DeckPainter.Move(Hwnd, _x, _y, _alpha);
                    DeckHost.Moved();
                }
                return;
            }
            _fromX = _x; _fromY = _y; _alphaFrom = _alpha;
            _animStart = Stopwatch.GetTimestamp();
            DeckNative.SetTimer(Hwnd, TimerAnim, 15, IntPtr.Zero);
        }

        private void AnimTick()
        {
            if (_animStart < 0) { DeckNative.KillTimer(Hwnd, TimerAnim); return; }
            double k = Math.Min(1.0, (Stopwatch.GetTimestamp() - _animStart) * 1000.0 / Stopwatch.Frequency / AnimMs);
            double e = 1 - Math.Pow(1 - k, 3); // ease-out
            int x = (int)Math.Round(_fromX + (_toX - _fromX) * e);
            int y = (int)Math.Round(_fromY + (_toY - _fromY) * e);
            bool moved = x != _x || y != _y;
            _x = x;
            _y = y;
            _alpha = (byte)Math.Round(_alphaFrom + (_alphaTo - _alphaFrom) * e);
            DeckPainter.Move(Hwnd, _x, _y, _alpha);
            if (moved) DeckHost.Moved();
            if (k >= 1)
            {
                _animStart = -1;
                DeckNative.KillTimer(Hwnd, TimerAnim);
            }
        }

        private void StopTimers()
        {
            DeckNative.KillTimer(Hwnd, TimerAnim);
            DeckNative.KillTimer(Hwnd, TimerLeave);
            DeckNative.KillTimer(Hwnd, TimerTip);
            DeckNative.KillTimer(Hwnd, TimerWatch);
            // An animation cut short ends where it was going.
            if (_animStart >= 0) { _x = _toX; _y = _toY; _alpha = _alphaTo; }
            _animStart = -1;
        }

        public void Dispose()
        {
            if (Hwnd != IntPtr.Zero)
            {
                StopTimers();
                DeckNative.DestroyWindow(Hwnd);
                Hwnd = IntPtr.Zero;
            }
            _painter.Dispose();
        }
    }
}
