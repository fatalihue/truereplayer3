using System;
using System.Runtime.InteropServices;

namespace TrueReplayer.Services
{
    /// <summary>
    /// The decks' tip (branch deck; plan .claude/planos/deck-2026-11-19.md, Fase 3): one small window that says
    /// what a button cannot show — why its macro failed, that the macro does not exist, a label cut short, and
    /// for a moment after a press, why the press did nothing. It looks like the app's own tooltip (.app-tip:
    /// the card, the default border, 11 px, at most 260 DIP wide) and behaves like the decks: it never takes
    /// the foreground, and it never takes the mouse either (WS_EX_TRANSPARENT). It sits above the button, or
    /// below it when there is no room, always inside the monitor's work area. One for every deck, on the
    /// Deck's thread.
    /// </summary>
    internal sealed class DeckTip : IDisposable
    {
        public const string ClassName = AppIdentity.Id + "DeckTip";
        private const float MaxW = 260, PadX = 9, PadY = 6, Gap = 6, Radius = 8, FontSize = 11;

        public IntPtr Hwnd { get; private set; }
        private readonly DeckPainter _painter = new();
        private bool _shown;

        public DeckTip(IntPtr owner)
        {
            Hwnd = DeckNative.CreateWindowExW(
                DeckNative.WS_EX_LAYERED | DeckNative.WS_EX_NOACTIVATE | DeckNative.WS_EX_TOOLWINDOW | DeckNative.WS_EX_TOPMOST | DeckNative.WS_EX_TRANSPARENT,
                ClassName, AppIdentity.DisplayName + " · Deck", DeckNative.WS_POPUP, 0, 0, 1, 1, owner, IntPtr.Zero, DeckNative.GetModuleHandleW(null), IntPtr.Zero);
            if (Hwnd == IntPtr.Zero) throw new InvalidOperationException($"CreateWindowEx(deck tip): {Marshal.GetLastWin32Error()}");
        }

        /// <summary>The tip for a button at <paramref name="anchor"/> (screen pixels), on that monitor.</summary>
        public void Show(string text, DeckNative.RECT anchor, DeckHost.MonitorInfo monitor, DeckTheme theme, bool excludeFromCapture)
        {
            float s = monitor.Scale;
            var format = _painter.Format("Segoe UI Variable Small", FontSize, false, false, wrap: true);
            var (tw, th) = DeckPainter.MeasureBox(text, format, MaxW - 2 * PadX - 2);
            float wDip = (float)Math.Ceiling(tw) + 2 * PadX + 2, hDip = (float)Math.Ceiling(th) + 2 * PadY + 2;
            int w = (int)Math.Ceiling(wDip * s), h = (int)Math.Ceiling(hDip * s), gap = (int)Math.Round(Gap * s);

            // Above the button, centred on it; below when the work area ends first; never past the work area.
            var work = monitor.Work;
            int x = anchor.Left + (anchor.Width - w) / 2;
            int y = anchor.Top - gap - h;
            if (y < work.Top) y = anchor.Bottom + gap;
            x = Math.Clamp(x, work.Left, Math.Max(work.Left, work.Right - w));
            y = Math.Clamp(y, work.Top, Math.Max(work.Top, work.Bottom - h));

            _painter.Ensure(w, h, s);
            _painter.Begin();
            try
            {
                _painter.FillRound(0, 0, wDip, hDip, Radius, theme.Card);
                _painter.StrokeRound(0, 0, wDip, hDip, Radius, theme.BorderDefault);
                _painter.Text(text, format, 1 + PadX, 1 + PadY, wDip - 2 - 2 * PadX, hDip - 2 - 2 * PadY, theme.Text);
            }
            finally { _painter.End(); }
            DeckNative.SetWindowDisplayAffinity(Hwnd, excludeFromCapture ? DeckNative.WDA_EXCLUDEFROMCAPTURE : DeckNative.WDA_NONE);
            _painter.Present(Hwnd, x, y, 255);
            if (!_shown)
            {
                DeckNative.ShowWindow(Hwnd, DeckNative.SW_SHOWNOACTIVATE);
                _shown = true;
            }
            DeckNative.SetWindowPos(Hwnd, DeckNative.HWND_TOPMOST, 0, 0, 0, 0, DeckNative.SWP_NOMOVE | DeckNative.SWP_NOSIZE | DeckNative.SWP_NOACTIVATE);
        }

        public void Hide()
        {
            if (!_shown) return;
            _shown = false;
            DeckNative.ShowWindow(Hwnd, DeckNative.SW_HIDE);
        }

        public void Dispose()
        {
            if (Hwnd != IntPtr.Zero)
            {
                DeckNative.DestroyWindow(Hwnd);
                Hwnd = IntPtr.Zero;
            }
            _painter.Dispose();
        }
    }
}
