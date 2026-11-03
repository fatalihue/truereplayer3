using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using TrueReplayer.Interop;

namespace TrueReplayer.Services
{
    public class RegionSelectionResult
    {
        // Null when the form was constructed in region-only mode (e.g. configuring a WaitImage
        // search ROI) — only the rect coordinates matter, no reference image is being captured.
        public Bitmap? CroppedImage { get; set; }
        public int ScreenX { get; set; }
        public int ScreenY { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        // Only set in pointPick mode — the colour of the pixel the user clicked on, sampled
        // directly from the in-memory screenshot (no second screen capture). Null for region
        // or recapture flows where a single colour wouldn't be meaningful. Used by the
        // WaitPixelColor eyedropper to fill the target-colour swatch alongside X/Y.
        public Color? PickedColor { get; set; }
    }

    /// <summary>
    /// What a capture's bar says (ScreenCapture board, "A mesma barra em toda captura"): what this
    /// capture is ("Pick the point"), what it is for ("for step 7, Left Click") and, for an area, the
    /// one hint it needs ("Drag around what the step waits for"). The keys come from the mode: a
    /// point names Scroll, Shift, the arrows and Enter; an area has Done Enter.
    /// </summary>
    public sealed record CaptureBar(string Title, string? For = null, string? Hint = null);

    public class ScreenOverlayForm : Form
    {
        private readonly Bitmap _screenshot;
        // The process-wide BufferedGraphics ceiling as it was before this overlay raised it, so
        // Dispose can put it back. Null once restored — see the constructor for the measurement
        // that justifies touching global state at all.
        private Size? _previousMaximumBuffer;
        private readonly bool _regionOnly;
        private readonly bool _pointPick;
        // A point pick that is after the colour (the eyedroppers) shows it in the magnifier's chip;
        // "Pick the point" shows the coordinates alone, as the board draws it.
        private readonly bool _showColor;
        private readonly CaptureBar _bar;
        private readonly TaskCompletionSource<RegionSelectionResult?> _tcs = new();

        // GetSystemMetrics indices for the virtual desktop (all monitors) — Win32 SM_* constants.
        private const int SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77, SM_CXVIRTUALSCREEN = 78, SM_CYVIRTUALSCREEN = 79;

        // ── The area ─────────────────────────────────────────────────────────────
        // An area is drawn, then adjusted, then confirmed: releasing the button no longer ends the
        // capture (the board: "Drag to draw · drag the edges to adjust", "Done Enter"). _sel is the
        // area in form-local pixels; a drag either draws a new one, moves it, or pulls its edges.
        private enum DragKind { None, Draw, Move, Resize }
        [Flags] private enum Edge { None = 0, Left = 1, Top = 2, Right = 4, Bottom = 8 }
        private DragKind _drag;
        private Edge _resizeEdges;
        private Point _dragAnchor;        // where the drag started (Draw: the first corner)
        private Rectangle _selAtDown;     // the area as it was when a Move/Resize started
        private Rectangle _sel;
        private bool _hasSelection;
        // Smaller than this is not an area: a click that barely moved, which a new draw discards and
        // a resize never goes under. The old overlay used the same 10 × 10 floor on release.
        private const int MinSide = 10;
        // The area the capture opened with (a saved region being redrawn). Esc keeps it: the bar
        // says "Keep current Esc" instead of "Cancel Esc".
        private readonly bool _seeded;

        // Live cursor position used to render an "(x, y)" label next to the mouse — like
        // ShareX / Greenshot. Lets the user see the exact coords they'll capture before
        // committing. Updated on every MouseMove regardless of drag state.
        private Point _cursorPoint;
        private bool _hasCursor;
        // Last painted label rect, captured from inside OnPaint after the actual MeasureString
        // ran. Used to invalidate (lastPainted ∪ newApprox) on cursor move so the previous
        // label is cleared. An earlier draft computed this rect twice — once approximated in
        // OnMouseMove, again actually in OnPaint — and the approximation under-estimated the
        // real width, leaving a smeared trail of label pixels along the cursor path. Tracking
        // the truth from OnPaint avoids the divergence.
        private Rectangle _lastCursorLabelRect = Rectangle.Empty;

        // Precision mode — hold Shift to damp cursor movement so a single screen pixel is
        // reachable even on a high-DPI/high-sensitivity mouse. Physical movement is scaled by
        // PrecisionFactor and the cursor is warped back to the damped point, so the pointer
        // (and therefore the sampled pixel) crawls while the hand moves normally.
        //
        // _precisionPos keeps FLOAT precision: at 0.2 a 4-px physical flick is 0.8 px, which
        // would round to zero and be lost every time if the accumulator were integer — the
        // cursor would feel stuck rather than slow. The fractional remainder carries over so
        // slow movement still advances, one pixel at a time.
        private const float PrecisionFactor = 0.2f;   // 5× slower
        private bool _precisionActive;
        private PointF _precisionPos;                 // damped position, client coords, sub-pixel
        private Point _precisionWarp;                 // last point we warped the cursor to
        // Cached virtual-screen origin so the cursor label can show absolute screen coords
        // (matching the values the action will end up storing). The form already uses these
        // to compute its size; reading them once in the ctor avoids re-querying on every paint.
        private readonly int _virtualOriginX;
        private readonly int _virtualOriginY;

        // ── The bar ──────────────────────────────────────────────────────────────
        // It lives on the monitor the cursor is on ("No monitor do cursor") and goes to the bottom
        // edge when the cursor comes near it ("Desce se o cursor chega perto"), so it never covers
        // what is being picked. The form spans the whole virtual desktop, and centring anything in
        // ClientRectangle would put it on the seam between two monitors.
        private readonly List<(Rectangle Bounds, float Scale)> _monitors = new();
        private int _barMonitor;
        private bool _barAtBottom;
        private BarLayout? _barLayout;
        private BarHit _barHover;
        private enum BarHit { None, Bar, Cancel, Done }

        // <paramref name="regionOnly"/>: when true, the overlay returns just the rect coords
        // without producing a cropped Bitmap. Used to configure the search ROI of an existing
        // WaitImage action — no new reference image is being captured.
        //
        // <paramref name="pointPick"/>: when true, a click (or Enter) returns at once as a zero-size
        // "region" — used by Pick Position on click actions to set X/Y from a direct screen click
        // without dragging a rect. The screen is not darkened in this mode (the board).
        //
        // <paramref name="initialRect"/>: when non-null and the rect is large enough, the overlay
        // opens with that region already drawn (in screen-absolute coords). Lets the user see
        // what's currently saved instead of starting blank — they can hit ESC to keep it as-is,
        // adjust its edges, or drag a new selection to overwrite. Ignored in pointPick mode.
        public ScreenOverlayForm(Bitmap screenshot, bool regionOnly = false, bool pointPick = false,
            CaptureBar? bar = null, Rectangle? initialRect = null, bool showColor = false)
        {
            _screenshot = screenshot;
            _regionOnly = regionOnly;
            _pointPick = pointPick;
            _showColor = pointPick && showColor;

            // Virtual screen bounds (all monitors)
            int vx = NativeMethods.GetSystemMetrics(SM_XVIRTUALSCREEN);
            int vy = NativeMethods.GetSystemMetrics(SM_YVIRTUALSCREEN);
            int vw = NativeMethods.GetSystemMetrics(SM_CXVIRTUALSCREEN);
            int vh = NativeMethods.GetSystemMetrics(SM_CYVIRTUALSCREEN);
            _virtualOriginX = vx;
            _virtualOriginY = vy;

            ReadMonitors(vx, vy, vw, vh);
            var cursorAtOpen = new Point(Cursor.Position.X - vx, Cursor.Position.Y - vy);
            _barMonitor = MonitorIndexAt(cursorAtOpen);
            // The pointer may already be where the bar would go (a pick button near the top of the
            // screen): the bar starts at the bottom then, as if it had moved away already.
            var (barMon, barScale) = _monitors[_barMonitor];
            _barAtBottom = cursorAtOpen.Y < barMon.Top + (BarMargin + BarHeight + 32) * barScale;

            // Seed the selection from a previously-saved rect so the user sees what's already
            // there. Same minimum size as a drawn area — anything smaller is treated as "no usable
            // seed" and the overlay opens blank. Converts screen-absolute to form-local by
            // subtracting the virtual origin.
            if (initialRect.HasValue && !pointPick)
            {
                var r = initialRect.Value;
                if (r.Width >= MinSide && r.Height >= MinSide)
                {
                    _sel = new Rectangle(r.X - vx, r.Y - vy, r.Width, r.Height);
                    _hasSelection = true;
                    _seeded = true;
                }
            }

            _bar = bar ?? new CaptureBar(pointPick
                ? (_showColor ? S.CaptureTitlePickColor : S.CaptureTitlePickPoint)
                : regionOnly ? S.CaptureTitleDrawArea : S.CaptureTitleCaptureImage);

            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(vx, vy);
            Size = new Size(vw, vh);
            TopMost = true;
            ShowInTaskbar = false;
            DoubleBuffered = true;
            // DoubleBuffered on a form THIS big is not free by default. The shared
            // BufferedGraphicsContext caches exactly one surface and refuses anything larger than
            // MaximumBuffer, whose default is 225x96 — so every repaint of a virtual-desktop-sized
            // form fell to the temporary manager, which builds and destroys the DIB per frame.
            //
            // Measured on this machine (5120x1440 virtual desktop, allocate + paint the
            // magnifier's dirty rect + Render + dispose, 120 frames): 0.476 ms per frame with the
            // default ceiling against 0.051 ms with it raised — 9.4x, about 26 ms of extra work
            // per second of continuous mouse movement. Real, and worth removing, though well short
            // of the "allocates 8-50 MB per frame" this was originally suspected of: the surface is
            // a DIB section, so untouched pages are never committed and the cost is the churn, not
            // the nominal size. Raising the ceiling is what lets it be cached and reused instead.
            _previousMaximumBuffer = BufferedGraphicsManager.Current.MaximumBuffer;
            BufferedGraphicsManager.Current.MaximumBuffer = new Size(vw, vh);
            Cursor = Cursors.Cross;

            KeyPreview = true;
            KeyDown += OnKeyDown;
            KeyUp += OnKeyUp;
            MouseDown += OnMouseDown;
            MouseMove += OnMouseMove;
            MouseUp += OnMouseUp;
            MouseDoubleClick += OnMouseDoubleClick;
            MouseWheel += OnMouseWheel;
        }

        // The monitors in form-local coords, each with its own scale: the bar is drawn at the DPI of
        // the monitor it sits on, so it reads the same on a 100 % and a 150 % screen. Clipped to the
        // form, as a monitor only partly covered by the captured virtual screen must not push the bar
        // off-canvas.
        private void ReadMonitors(int vx, int vy, int vw, int vh)
        {
            var canvas = new Rectangle(0, 0, vw, vh);
            try
            {
                foreach (var screen in Screen.AllScreens)
                {
                    var b = screen.Bounds;
                    var local = new Rectangle(b.X - vx, b.Y - vy, b.Width, b.Height);
                    local.Intersect(canvas);
                    if (local.IsEmpty) continue;
                    _monitors.Add((local, ScaleAt(new Point(b.X + b.Width / 2, b.Y + b.Height / 2))));
                }
            }
            catch { /* any interop hiccup falls through to the whole canvas below */ }
            if (_monitors.Count == 0) _monitors.Add((canvas, 1f));
        }

        private static float ScaleAt(Point screenPoint)
        {
            try
            {
                IntPtr monitor = MonitorFromPoint(new NativeMethods.POINT { x = screenPoint.X, y = screenPoint.Y }, MONITOR_DEFAULTTONEAREST);
                if (monitor != IntPtr.Zero && GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, out uint dpiX, out _) == 0 && dpiX > 0)
                    return dpiX / 96f;
            }
            catch { /* shcore missing or refused: 100 % */ }
            return 1f;
        }

        private int MonitorIndexAt(Point local)
        {
            for (int i = 0; i < _monitors.Count; i++)
                if (_monitors[i].Bounds.Contains(local)) return i;
            // The dead zones of a staggered layout belong to no monitor: keep the bar where it is.
            return Math.Clamp(_barMonitor, 0, _monitors.Count - 1);
        }

        public Task<RegionSelectionResult?> GetSelectionAsync() => _tcs.Task;

        // ── Reachability ─────────────────────────────────────────────────────────
        // Until 2.28.0 this form had exactly THREE exits and all three were input: Esc, a left
        // click in pointPick mode, and a drag of at least 10x10. It never activated itself, while
        // the flow that opens it minimises the main window 400 ms earlier and hands the foreground
        // to whatever was behind it. A form that is neither focused nor clicked has no way to
        // close — and because every picker holds the GLOBAL exclusive InteractionScope, one that
        // never closes refuses every later capture AND every file picker, and keeps
        // SuppressAllHotkeys true, so all 33 hotkeys and 12 hotstrings die with it. That is the
        // 2026-08-24 incident: 12 silent refusals over 2 min 54 s, ended by killing the process.
        //
        // Three exits are added here, and any ONE of them would have ended it: self-activation on
        // Shown, a right click, and this watchdog. The watchdog is the one that covers the case
        // where the window is not reachable AT ALL — no focus, no input of any kind.
        private System.Windows.Forms.Timer? _reachTimer;
        private int _quietTicks;
        private bool _provenReachable;
        private long _shownAtTicks;
        private string _closeReason = "not closed";

        private const int ReachTickMs = 1000;
        // Twelve quiet seconds. The cost of being wrong is one re-click of the pick button, logged
        // and announced; the cost of NOT closing is the whole app, silently, until it is killed.
        private const int QuietTicksToCancel = 12;

        /// Why this overlay closed — for the host's lifecycle log. Never blank: OnFormClosed runs
        /// for every route out, including Alt+F4 and teardown after a paint exception.
        public string CloseReason => _closeReason;

        /// Asks the overlay to cancel itself from ANOTHER thread. This is the route
        /// <see cref="InteractionScope"/> hands out so a second exclusive claimant can clear a
        /// stuck holder instead of the user killing the process. Posted, not run inline: the form
        /// belongs to its own STA thread. A thread that is not pumping cannot answer, and that is
        /// reported honestly rather than papered over — the claim simply stays refused.
        public void RequestCancel(string reason)
        {
            try
            {
                if (IsDisposed || !IsHandleCreated) return;
                BeginInvoke(new Action(() => CancelAndClose(reason)));
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Capture overlay could not be asked to cancel ({reason}): {ex.Message}");
            }
        }

        // Idempotent, and that is load-bearing for the LOG rather than for the close: Close() raises
        // Deactivate on the way out, so without this guard every successful pick would be recorded
        // as "deactivated" — the reason line would describe the teardown instead of the cause.
        private bool _closing;

        private void CancelAndClose(string reason)
        {
            if (_closing) return;
            _closing = true;
            _closeReason = reason;
            _tcs.TrySetResult(null);
            Close();
        }

        private bool IsForegroundWindow()
            => IsHandleCreated && NativeMethods.GetForegroundWindow() == Handle;

        // Real input arrived, or the window reached the foreground: it is reachable, so the
        // watchdog retires for good. Mouse MOVES deliberately do not land here — a fullscreen
        // overlay collects moves just by existing under the pointer, which says it is painted,
        // not that it can be dismissed. They only reset the quiet counter (see OnMouseMove).
        private void MarkReachable(string how)
        {
            if (_provenReachable) return;
            _provenReachable = true;
            StopReachTimer();
            DiagnosticLog.Info($"Capture overlay is reachable ({how}) — watchdog off.");
        }

        private void StopReachTimer()
        {
            if (_reachTimer == null) return;
            _reachTimer.Stop();
            _reachTimer.Tick -= OnReachTick;
            _reachTimer.Dispose();
            _reachTimer = null;
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            _shownAtTicks = Environment.TickCount64;
            // The opening of an overlay was not logged at all before, which is why the incident
            // produced no line describing it — only the refusals it caused. Bounds and visibility
            // are here because "no full-screen overlay was covering the screen" was the observation
            // nothing in the log could confirm or deny.
            DiagnosticLog.Info(
                $"Capture overlay shown — bounds {Bounds.X},{Bounds.Y} {Bounds.Width}x{Bounds.Height}, " +
                $"visible={Visible}, foreground={IsForegroundWindow()}, pointPick={_pointPick}, regionOnly={_regionOnly}, " +
                $"bar=\"{_bar.Title}{(_bar.For is { Length: > 0 } f ? " · " + f : "")}\".");

            _reachTimer = new System.Windows.Forms.Timer { Interval = ReachTickMs };
            _reachTimer.Tick += OnReachTick;
            _reachTimer.Start();
            _ = SelfActivateAsync();
        }

        // Take the foreground deliberately instead of hoping to inherit it. The full stack
        // (AttachThreadInput + the foreground-lock timeout) is reused rather than a bare
        // SetForegroundWindow, because this call is made from a background process whose main
        // window was just minimised — precisely the situation Windows' focus-steal prevention
        // refuses a naked SetForegroundWindow in.
        private async Task SelfActivateAsync()
        {
            try
            {
                bool ok = await TrueReplayer.Helpers.WindowActivation.ActivateAsync(Handle);
                if (ok) MarkReachable("self-activated");
                else DiagnosticLog.Warn("Capture overlay could not put itself in the foreground — the watchdog will cancel it if nothing reaches it.");
            }
            catch (Exception ex)
            {
                DiagnosticLog.Error("Capture overlay self-activation failed", ex);
            }
        }

        private void OnReachTick(object? sender, EventArgs e)
        {
            if (_provenReachable) { StopReachTimer(); return; }
            if (IsForegroundWindow()) { MarkReachable("foreground"); return; }

            _quietTicks++;
            // Two more attempts, spread out: focus-steal prevention can refuse the first one while
            // the desktop is still settling from the main window's minimise animation.
            if (_quietTicks == 2 || _quietTicks == 5)
            {
                NativeMethods.BringWindowToTop(Handle);
                NativeMethods.SetForegroundWindow(Handle);
                return;
            }
            if (_quietTicks >= QuietTicksToCancel)
            {
                DiagnosticLog.Warn(
                    $"Capture overlay received no input and never reached the foreground for {QuietTicksToCancel}s — " +
                    "cancelling it so the exclusive interaction slot is released and hotkeys come back.");
                CancelAndClose("unreachable");
            }
        }

        // Losing activation cancels, the way every screen picker on this platform behaves — but not
        // on the spot. Gated three ways, because a false cancel here destroys a capture the user
        // was in the middle of:
        //
        //   • only once the form has actually BEEN reachable (one that never got focus cannot lose
        //     it, and the activation dance above can emit a Deactivate of its own while it runs),
        //   • only past a settle window after Shown, and
        //   • only if the window is STILL not in the foreground a moment later.
        //
        // The third is the one that matters. A notification toast, the tail of the main window's
        // minimise animation, or any momentary focus blip raises Deactivate and gives the focus
        // straight back; cancelling on the raw event would throw the capture away for that. The
        // re-check costs 700 ms of nothing and turns "lost focus" into "the user went somewhere
        // else", which is the condition actually worth cancelling on.
        private System.Windows.Forms.Timer? _deactivateTimer;
        private const int DeactivateGraceMs = 700;

        protected override void OnDeactivate(EventArgs e)
        {
            base.OnDeactivate(e);
            if (_closing || !_provenReachable) return;
            if (Environment.TickCount64 - _shownAtTicks < 500) return;
            if (_deactivateTimer != null) return;
            _deactivateTimer = new System.Windows.Forms.Timer { Interval = DeactivateGraceMs };
            _deactivateTimer.Tick += OnDeactivateGraceElapsed;
            _deactivateTimer.Start();
        }

        private void OnDeactivateGraceElapsed(object? sender, EventArgs e)
        {
            StopDeactivateTimer();
            if (_closing) return;
            if (IsForegroundWindow()) return;   // it came back — nothing happened
            DiagnosticLog.Info("Capture overlay lost focus and did not get it back — cancelling.");
            CancelAndClose("deactivated");
        }

        private void StopDeactivateTimer()
        {
            if (_deactivateTimer == null) return;
            _deactivateTimer.Stop();
            _deactivateTimer.Tick -= OnDeactivateGraceElapsed;
            _deactivateTimer.Dispose();
            _deactivateTimer = null;
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            // Guarantee the awaiting caller is always released, even when the form is closed by a
            // route that doesn't hit the ESC / click / drag handlers (Alt+F4, taskkill, the system
            // menu, or teardown after a paint exception). Without this the caller would block forever
            // on .Result. TrySetResult is idempotent, so a normal completion already set is unaffected.
            _tcs.TrySetResult(null);
            StopReachTimer();
            StopDeactivateTimer();
            base.OnFormClosed(e);
        }

        // Constant paint objects, hoisted out of the per-frame path (OnPaint / DrawMagnifier run
        // on every mouse move). Static Font/SolidBrush/Pen are safe here because the form only
        // ever paints on its own UI thread — GDI+ objects are only unsafe under CONCURRENT use.
        // Per-frame geometry (GraphicsPath, Region) and the sampled-pixel swatch (colour changes
        // per state) stay local with their own using.
        private static readonly Color Accent = Color.FromArgb(255, 96, 205, 255); // #60CDFF
        private static readonly SolidBrush OverlayTintBrush = new(Color.FromArgb(100, 0, 0, 0));
        private static readonly Pen SelectionPen = new(Accent, 2f);
        private static readonly SolidBrush HandleFillBrush = new(Color.White);
        private static readonly Pen HandleBorderPen = new(Accent, 1.5f);
        private static readonly Font DimLabelFont = new("Segoe UI", 11f, FontStyle.Regular);
        private static readonly SolidBrush DimLabelBgBrush = new(Color.FromArgb(200, 0, 0, 0));
        // One brush for BOTH drop shadows — disc and chip rings use the same colour.
        private static readonly SolidBrush MagShadowBrush = new(Color.FromArgb(MagShadowAlpha, 0, 0, 0));
        private static readonly SolidBrush MagBackdropBrush = new(Color.FromArgb(235, 18, 18, 18));
        private static readonly Pen MagGridPen = new(Color.FromArgb(35, 255, 255, 255));
        private static readonly SolidBrush MagCrossBrush = new(Color.FromArgb(64, 96, 205, 255));
        private static readonly Pen MagCenterDarkPen = new(Color.FromArgb(170, 0, 0, 0), 3f);
        private static readonly Pen MagCenterLightPen = new(Color.White, 1.5f);
        private static readonly Pen MagBorderPrecisionPen = new(Color.FromArgb(220, 96, 205, 255), 2f);
        private static readonly Pen MagBorderPen = new(Color.FromArgb(140, 255, 255, 255), 1.5f);
        private static readonly Font SlowBadgeFont = new("Consolas", 8f, FontStyle.Bold);
        private static readonly SolidBrush SlowBadgeBgBrush = new(Color.FromArgb(220, 0, 0, 0));
        // Badge foreground AND the chip's coord/HEX text — same accent colour, one brush.
        private static readonly SolidBrush AccentTextBrush = new(Accent);
        // Monospace coords so the chip width stops jumping per-digit as the cursor moves.
        private static readonly Font CoordFont = new("Consolas", 10f, FontStyle.Regular);
        private static readonly Font HexFont = new("Consolas", 10.5f, FontStyle.Bold);
        private static readonly Font RgbFont = new("Consolas", 9f, FontStyle.Regular);
        private static readonly SolidBrush ChipBgBrush = new(Color.FromArgb(225, 0, 0, 0));
        private static readonly SolidBrush RgbTextBrush = new(Color.FromArgb(210, 197, 197, 197));
        private static readonly Pen SwatchBorderPen = new(Color.FromArgb(170, 255, 255, 255), 1f);
        // The bar's colours: a near-black surface that reads on any screen, muted secondary text,
        // key caps drawn like the app's <kbd>, and the accent for the one primary button.
        private static readonly SolidBrush BarBgBrush = new(Color.FromArgb(242, 24, 24, 27));
        private static readonly Pen BarBorderPen = new(Color.FromArgb(56, 255, 255, 255), 1f);
        private static readonly SolidBrush BarMutedBrush = new(Color.FromArgb(255, 161, 161, 170));
        private static readonly SolidBrush BarHintBrush = new(Color.FromArgb(255, 212, 212, 216));
        private static readonly SolidBrush KeyCapBgBrush = new(Color.FromArgb(255, 39, 39, 42));
        private static readonly Pen KeyCapBorderPen = new(Color.FromArgb(255, 82, 82, 91), 1f);
        private static readonly SolidBrush KeyCapTextBrush = new(Color.FromArgb(255, 228, 228, 231));
        private static readonly Pen BarSeparatorPen = new(Color.FromArgb(255, 63, 63, 70), 1f);
        private static readonly SolidBrush GhostButtonBrush = new(Color.FromArgb(255, 52, 52, 58));
        private static readonly SolidBrush GhostButtonHoverBrush = new(Color.FromArgb(255, 72, 72, 80));
        private static readonly SolidBrush AccentButtonBrush = new(Accent);
        private static readonly SolidBrush AccentButtonHoverBrush = new(Color.FromArgb(255, 140, 220, 255));
        private static readonly SolidBrush AccentButtonTextBrush = new(Color.FromArgb(255, 11, 11, 15));
        private static readonly Pen AccentKeyCapPen = new(Color.FromArgb(150, 11, 11, 15), 1f);

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            var g = e.Graphics;

            // Draw screenshot as background, forced 1:1.
            //
            // The two-argument DrawImage(Image, int, int) is the ONLY resolution-dependent
            // overload in GDI+: it draws at the image's "physical size", i.e. scaled by
            // g.DpiX / _screenshot.HorizontalResolution. Every other draw of this same bitmap
            // in this file passes GraphicsUnit.Pixel and is therefore unscaled, and so is
            // everything that READS it — GetPixel in the pick and DrawMagnifier, the magnifier's
            // srcRect, and the ScreenX/ScreenY the form finally reports (cursor point + virtual
            // origin). If the two resolutions ever disagree the user would aim at a stretched
            // background while the coordinate comes out of the unstretched bitmap, so the pick
            // would be silently off by the DPI ratio. Pinning the background to pixels removes
            // the possibility instead of relying on the DC and the bitmap both reporting 96.
            g.DrawImage(_screenshot, new Rectangle(0, 0, _screenshot.Width, _screenshot.Height),
                        new Rectangle(0, 0, _screenshot.Width, _screenshot.Height), GraphicsUnit.Pixel);

            // A point is picked off the screen as it is — no tint (the board: "sem escurecer a
            // tela"), so the colour under the cursor is the colour the step will look for. An area
            // darkens everything but itself, which is what shows its edges against the screen.
            if (!_pointPick)
            {
                g.FillRectangle(OverlayTintBrush, ClientRectangle);
                if (_hasSelection || _drag == DragKind.Draw)
                    DrawSelection(g);
            }

            DrawBar(g);

            // Cursor callout — drawn last so it sits above the overlay tint, the selection and the
            // bar. In an area it shows while there is none yet and while an edge or the area is
            // being dragged: that is when the pixel under the pointer is the one that matters.
            //
            // ShareX-style zoom magnifier for every selection mode — pointPick (Wait Pixel),
            // regionOnly (Click Area / Wait Image search region) and image crop (Wait Image
            // initial capture / recapture). All benefit from pixel-level precision either
            // at the click point or at the rect corner being dragged. The colour lines in the
            // chip are gated to the colour picks inside DrawMagnifier.
            if (_pointPick || !_hasSelection || _drag != DragKind.None)
            {
                DrawMagnifier(g);
            }
        }

        private void DrawSelection(Graphics g)
        {
            var rect = _sel;
            if (rect.Width <= 0 || rect.Height <= 0) return;

            // The clear (un-tinted) area, its border and — once drawn — the handles that adjust it.
            g.DrawImage(_screenshot, rect, rect, GraphicsUnit.Pixel);
            g.DrawRectangle(SelectionPen, rect);
            if (_hasSelection && _drag != DragKind.Draw)
            {
                float side = HandleSide;
                var oldSmoothing = g.SmoothingMode;
                g.SmoothingMode = SmoothingMode.None;
                foreach (var c in HandleCenters(rect))
                {
                    var h = new RectangleF(c.X - side / 2, c.Y - side / 2, side, side);
                    g.FillRectangle(HandleFillBrush, h);
                    g.DrawRectangle(HandleBorderPen, h.X, h.Y, h.Width, h.Height);
                }
                g.SmoothingMode = oldSmoothing;
            }

            // The size, always in view (the board: "400 × 300").
            string label = $"{rect.Width} × {rect.Height}";
            var labelSize = g.MeasureString(label, DimLabelFont);
            float labelX = rect.X + (rect.Width - labelSize.Width) / 2;
            float labelY = rect.Bottom + 6 + HandleSide / 2;
            // Ensure label stays on screen
            if (labelY + labelSize.Height > ClientRectangle.Height)
                labelY = rect.Top - labelSize.Height - 6 - HandleSide / 2;
            g.FillRectangle(DimLabelBgBrush, labelX - 4, labelY - 2, labelSize.Width + 8, labelSize.Height + 4);
            g.DrawString(label, DimLabelFont, Brushes.White, labelX, labelY);
        }

        // The handles sit on the corners and on the middle of each edge, at the scale of the monitor
        // the bar is on (one scale for the whole canvas is enough for an 8-px square).
        private float HandleSide => 8f * _monitors[_barMonitor].Scale;
        private int EdgeGrab => (int)Math.Ceiling(6f * _monitors[_barMonitor].Scale);

        private static IEnumerable<PointF> HandleCenters(Rectangle r)
        {
            float cx = r.X + r.Width / 2f, cy = r.Y + r.Height / 2f;
            yield return new PointF(r.Left, r.Top);
            yield return new PointF(cx, r.Top);
            yield return new PointF(r.Right, r.Top);
            yield return new PointF(r.Right, cy);
            yield return new PointF(r.Right, r.Bottom);
            yield return new PointF(cx, r.Bottom);
            yield return new PointF(r.Left, r.Bottom);
            yield return new PointF(r.Left, cy);
        }

        // Which edges of the area a point grabs: a corner grabs two, an edge one, inside none (the
        // caller moves the area then), outside none. The corners win over the edges they join.
        private Edge EdgesAt(Point p)
        {
            if (!_hasSelection) return Edge.None;
            int t = EdgeGrab;
            var r = _sel;
            if (p.X < r.Left - t || p.X > r.Right + t || p.Y < r.Top - t || p.Y > r.Bottom + t) return Edge.None;
            Edge e = Edge.None;
            if (Math.Abs(p.X - r.Left) <= t) e |= Edge.Left;
            else if (Math.Abs(p.X - r.Right) <= t) e |= Edge.Right;
            if (Math.Abs(p.Y - r.Top) <= t) e |= Edge.Top;
            else if (Math.Abs(p.Y - r.Bottom) <= t) e |= Edge.Bottom;
            return e;
        }

        private static Cursor CursorFor(Edge e) => e switch
        {
            Edge.Left | Edge.Top or Edge.Right | Edge.Bottom => Cursors.SizeNWSE,
            Edge.Right | Edge.Top or Edge.Left | Edge.Bottom => Cursors.SizeNESW,
            Edge.Left or Edge.Right => Cursors.SizeWE,
            Edge.Top or Edge.Bottom => Cursors.SizeNS,
            _ => Cursors.Cross,
        };

        // ── Keys ─────────────────────────────────────────────────────────────────
        // Esc, Enter and the arrows are taken here, before the form's dialog-key handling would
        // read the arrows as focus moves and Enter as an AcceptButton press. Shift stays with
        // KeyDown/KeyUp: it is a modifier the move handler also re-reads live.
        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            Keys key = keyData & Keys.KeyCode;
            if (key is Keys.Escape or Keys.Enter or Keys.Left or Keys.Right or Keys.Up or Keys.Down)
            {
                // A keystroke reached the form, so it holds focus — the watchdog has nothing to guard.
                MarkReachable("key input");
                switch (key)
                {
                    // An area that was there when the capture opened stays as it was: the caller
                    // reads a null as "keep current", the same answer as a cancel.
                    case Keys.Escape: CancelAndClose(_seeded ? "esc (kept current)" : "esc"); break;
                    case Keys.Enter:
                        if (_pointPick) PickPoint(_hasCursor ? _cursorPoint : CurrentClientCursor(), "enter");
                        else Commit("enter");
                        break;
                    case Keys.Left: Nudge(-1, 0); break;
                    case Keys.Right: Nudge(1, 0); break;
                    case Keys.Up: Nudge(0, -1); break;
                    case Keys.Down: Nudge(0, 1); break;
                }
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        private void OnKeyDown(object? sender, KeyEventArgs e)
        {
            MarkReachable("key input");
            // Shift press/release only drives the badge repaint promptly — OnMouseMove reads
            // the live modifier state itself, so a missed key event can't strand the mode.
            // KeyDown auto-repeats while held; SetPrecision no-ops when already active.
            if (e.KeyCode == Keys.ShiftKey)
            {
                SetPrecision(true, PrecisionAnchor());
            }
        }

        private void OnKeyUp(object? sender, KeyEventArgs e)
        {
            if (e.KeyCode == Keys.ShiftKey)
            {
                SetPrecision(false, PrecisionAnchor());
            }
        }

        // One pixel per press (the board: "Arrows 1 px"). The pointer itself moves, so the cross,
        // the magnifier and a drag in progress all follow, and the pixel Enter picks is the one the
        // magnifier shows. The position is read back for the same reason as the precision warp: the
        // OS keeps the cursor inside the monitors, and the canvas's bounding box has dead zones.
        private void Nudge(int dx, int dy)
        {
            var from = _hasCursor ? _cursorPoint : CurrentClientCursor();
            var to = new Point(Math.Clamp(from.X + dx, 0, ClientSize.Width - 1), Math.Clamp(from.Y + dy, 0, ClientSize.Height - 1));
            Cursor.Position = PointToScreen(to);
            var actual = PointToClient(Cursor.Position);
            if (_precisionActive)
            {
                _precisionPos = actual;
                _precisionWarp = actual;
            }
            TrackPointer(actual);
        }

        // Anchor for a keyboard-initiated mode change. Prefers the last point OnMouseMove
        // actually processed so the baseline shares that method's clock: e.Location is the
        // position at message-GENERATION time, while a live Cursor.Position read here is
        // message-HANDLING time. Mixing the two makes the first damped delta include whatever
        // travel happened in between, which shows up as a backward twitch on Shift-press.
        private Point PrecisionAnchor() => _hasCursor ? _cursorPoint : CurrentClientCursor();

        // Live cursor in form-local coords. The form is borderless and positioned exactly at the
        // virtual-screen origin, so this is the inverse of DrawMagnifier's absX/absY conversion.
        private Point CurrentClientCursor()
        {
            var p = Cursor.Position;
            return new Point(p.X - _virtualOriginX, p.Y - _virtualOriginY);
        }

        // Enter/leave precision mode. Anchoring BOTH the float accumulator and the warp
        // reference at the cursor's current pixel is what keeps the transition jump-free:
        // the first damped delta is then measured from where the pointer already is.
        private void SetPrecision(bool on, Point at)
        {
            if (on == _precisionActive) return;
            _precisionActive = on;
            if (on)
            {
                _precisionPos = at;
                _precisionWarp = at;
            }
            InvalidateMagnifier();
        }

        // ── The two ways out with an answer ──────────────────────────────────────

        // A point: Width/Height stay 0 to mark the result as a point rather than a region; callers
        // index off ScreenX/ScreenY. The colour at the point comes straight from the in-memory
        // screenshot — the WaitPixelColor eyedropper consumes it, and even callers that ignore it
        // (Pick Position) pay only one GetPixel call. Guarded against out-of-form coordinates so a
        // fast click on the edge can't throw.
        private void PickPoint(Point loc, string how)
        {
            if (_closing) return;
            Color? pickedColor = null;
            if (loc.X >= 0 && loc.Y >= 0
                && loc.X < _screenshot.Width && loc.Y < _screenshot.Height)
            {
                try { pickedColor = _screenshot.GetPixel(loc.X, loc.Y); }
                catch { /* defensive — bitmap access can race with Dispose on cancel */ }
            }

            _tcs.TrySetResult(new RegionSelectionResult
            {
                CroppedImage = null,
                ScreenX = loc.X + _virtualOriginX,
                ScreenY = loc.Y + _virtualOriginY,
                Width = 0,
                Height = 0,
                PickedColor = pickedColor,
            });
            _closeReason = $"point picked ({how})";
            _closing = true;
            Close();
        }

        // An area: Enter, Done, or a double-click inside it. Nothing to confirm yet is a no-op, so
        // an early Enter does not throw the capture away.
        private void Commit(string how)
        {
            if (_closing || !_hasSelection || _drag != DragKind.None) return;
            var rect = _sel;
            if (rect.Width < MinSide || rect.Height < MinSide) return;

            Bitmap? cropped = null;
            if (!_regionOnly)
            {
                cropped = new Bitmap(rect.Width, rect.Height);
                using var g = Graphics.FromImage(cropped);
                g.DrawImage(_screenshot, 0, 0, rect, GraphicsUnit.Pixel);
            }

            _tcs.TrySetResult(new RegionSelectionResult
            {
                CroppedImage = cropped,
                // Account for virtual screen offset — reuse the origin cached in the ctor.
                ScreenX = rect.X + _virtualOriginX,
                ScreenY = rect.Y + _virtualOriginY,
                Width = rect.Width,
                Height = rect.Height
            });
            _closeReason = $"region selected ({how})";
            _closing = true;
            Close();
        }

        // ── The mouse ────────────────────────────────────────────────────────────

        private void OnMouseDown(object? sender, MouseEventArgs e)
        {
            // In precision mode the pointer is pinned to the damped point, so commit THAT
            // pixel rather than the raw event location: pressing the button can physically
            // nudge the mouse a pixel or two, which is the very error this mode exists to
            // remove. Outside precision mode the two are identical.
            var loc = _precisionActive && _hasCursor ? _cursorPoint : e.Location;

            // A button reached the form: it is on screen and taking input, whatever the foreground
            // window is. Marked before the branch so a right-click counts too.
            MarkReachable("mouse input");

            // Right-click cancels. It used to be a plain no-op, which cost nothing while the form
            // was reliably focusable and cost the whole app when it was not: a click needs no
            // focus, so this is the one manual exit that still works on an overlay Windows refuses
            // to activate. Symmetric with Esc — same "cancelled" answer, same null result.
            if (e.Button == MouseButtons.Right)
            {
                CancelAndClose("right-click");
                return;
            }
            if (e.Button != MouseButtons.Left) return;

            // The bar's buttons, where the bar can be reached (it moves away from the pointer while
            // there is something to pick under it; see UpdateBarPlacement). A press elsewhere on
            // the bar does nothing, rather than picking the pixel the bar covers.
            switch (HitBar(e.Location))
            {
                case BarHit.Cancel: CancelAndClose(_seeded ? "cancel button (kept current)" : "cancel button"); return;
                case BarHit.Done: Commit("done button"); return;
                case BarHit.Bar: return;
            }

            if (_pointPick)
            {
                PickPoint(loc, "click");
                return;
            }

            var edges = EdgesAt(loc);
            if (edges != Edge.None)
            {
                _drag = DragKind.Resize;
                _resizeEdges = edges;
                _selAtDown = _sel;
                _dragAnchor = loc;
            }
            else if (_hasSelection && _sel.Contains(loc))
            {
                _drag = DragKind.Move;
                _selAtDown = _sel;
                _dragAnchor = loc;
            }
            else
            {
                // A press outside the area starts a new one; the old one is gone.
                _drag = DragKind.Draw;
                _dragAnchor = loc;
                _sel = new Rectangle(loc, Size.Empty);
                _hasSelection = false;
            }
            Invalidate();
        }

        private void OnMouseMove(object? sender, MouseEventArgs e)
        {
            // A move says the form is painted under the pointer — enough to hold the watchdog off,
            // not enough to retire it: an unfocusable overlay collects moves and still cannot be
            // dismissed with Esc. Right-click remains its manual exit, and the counter restarts
            // the moment the pointer stops.
            _quietTicks = 0;

            var loc = e.Location;

            // Resync off the live modifier state rather than trusting the key events alone: if
            // the overlay ever misses a KeyUp (focus stolen while Shift is down) the next move
            // leaves precision mode instead of damping the cursor forever. Verified by probe —
            // GetKeyState (what Control.ModifierKeys reads) is refreshed as this thread pumps
            // the mouse messages, so it reports Shift-up on the first move back over the
            // overlay even though the WM_KEYUP itself was never delivered here.
            bool shift = (Control.ModifierKeys & Keys.Shift) != 0;
            if (shift != _precisionActive) SetPrecision(shift, loc);

            if (_precisionActive)
            {
                // Delta is measured from the point we last warped to — which is where the
                // pointer physically sits — so it is exactly the movement the user just made.
                int dx = loc.X - _precisionWarp.X;
                int dy = loc.Y - _precisionWarp.Y;

                // Our own warp raises a MouseMove at precisely _precisionWarp. That yields a
                // zero delta, so the echo cancels itself here — no suppression flag needed.
                if (dx == 0 && dy == 0) return;

                _precisionPos = new PointF(
                    Math.Clamp(_precisionPos.X + dx * PrecisionFactor, 0, ClientRectangle.Width - 1),
                    Math.Clamp(_precisionPos.Y + dy * PrecisionFactor, 0, ClientRectangle.Height - 1));
                loc = Point.Round(_precisionPos);

                // Re-pin the pointer even when the damped target rounded to the SAME pixel:
                // the physical cursor is out at e.Location, and leaving it there would let it
                // drift away from the magnified pixel while the disc stayed put.
                //
                // PointToScreen/PointToClient are used as a matched pair so the round-trip is
                // self-consistent, and the position is READ BACK because the OS confines the
                // cursor to the union of the monitors while this form spans their bounding
                // BOX — on a staggered layout the box contains dead zones the cursor can never
                // enter, and SetCursorPos silently relocates instead of failing. Adopting the
                // requested-but-unreached point as the next baseline would inject a constant
                // phantom delta into every later move and make the cursor creep.
                Cursor.Position = PointToScreen(loc);
                var actual = PointToClient(Cursor.Position);
                if (actual != loc)
                {
                    // The OS refused the target — follow the cursor rather than the request so
                    // the disc keeps showing the pixel actually under the pointer. Re-seat the
                    // accumulator PER AXIS: a refusal is usually one-dimensional (a vertical
                    // edge blocks X while Y is free), and clearing the untouched axis's residue
                    // too would freeze it while the user slid along the edge. Re-seating at all
                    // is correct only here — doing it every frame is what makes damping feel dead.
                    if (actual.X != loc.X) _precisionPos.X = actual.X;
                    if (actual.Y != loc.Y) _precisionPos.Y = actual.Y;
                    loc = actual;
                }
                _precisionWarp = actual;
            }

            TrackPointer(loc);
        }

        // The pointer is at `loc` now — from a move, a damped move or an arrow key. Follows it with
        // the drag in progress, the hover cursor, the bar and the magnifier.
        private void TrackPointer(Point loc)
        {
            // Track cursor for the live "(x, y)" label even when not dragging. Without this
            // the user has no idea where on screen they're about to click in pointPick mode,
            // and in rect mode they can't preview the start point before pressing.
            if (loc == _cursorPoint && _hasCursor && _drag == DragKind.None) return;  // no-op move
            _cursorPoint = loc;
            _hasCursor = true;

            UpdateBarPlacement(loc);

            if (_drag != DragKind.None)
            {
                ApplyDrag(loc);
                // A drag is already a full-form gesture (rect, handles and size label move); a full
                // invalidate is the simplest correct option here.
                Invalidate();
                return;
            }

            UpdateHover(loc);
            // Not dragging — only the cursor coord HUD changed.
            InvalidateMagnifier();
        }

        private void ApplyDrag(Point p)
        {
            var bounds = ClientRectangle;
            switch (_drag)
            {
                case DragKind.Draw:
                    _sel = Rectangle.FromLTRB(
                        Math.Min(_dragAnchor.X, p.X), Math.Min(_dragAnchor.Y, p.Y),
                        Math.Max(_dragAnchor.X, p.X), Math.Max(_dragAnchor.Y, p.Y));
                    break;
                case DragKind.Move:
                {
                    int x = Math.Clamp(_selAtDown.X + p.X - _dragAnchor.X, 0, Math.Max(0, bounds.Width - _selAtDown.Width));
                    int y = Math.Clamp(_selAtDown.Y + p.Y - _dragAnchor.Y, 0, Math.Max(0, bounds.Height - _selAtDown.Height));
                    _sel = new Rectangle(x, y, _selAtDown.Width, _selAtDown.Height);
                    break;
                }
                case DragKind.Resize:
                {
                    // The edges not grabbed stay where they were, and none crosses the opposite one:
                    // an area never turns inside out or gets smaller than the floor.
                    int dx = p.X - _dragAnchor.X, dy = p.Y - _dragAnchor.Y;
                    int l = _selAtDown.Left, t = _selAtDown.Top, r = _selAtDown.Right, b = _selAtDown.Bottom;
                    if ((_resizeEdges & Edge.Left) != 0) l = Math.Clamp(l + dx, 0, r - MinSide);
                    if ((_resizeEdges & Edge.Right) != 0) r = Math.Clamp(r + dx, l + MinSide, bounds.Width);
                    if ((_resizeEdges & Edge.Top) != 0) t = Math.Clamp(t + dy, 0, b - MinSide);
                    if ((_resizeEdges & Edge.Bottom) != 0) b = Math.Clamp(b + dy, t + MinSide, bounds.Height);
                    _sel = Rectangle.FromLTRB(l, t, r, b);
                    break;
                }
            }
        }

        private void UpdateHover(Point loc)
        {
            var hit = HitBar(loc);
            if (hit != _barHover)
            {
                _barHover = hit;
                if (_barLayout != null) Invalidate(Rectangle.Inflate(Rectangle.Ceiling(_barLayout.Bar), 2, 2));
            }
            Cursor wanted;
            if (hit is BarHit.Cancel or BarHit.Done) wanted = Cursors.Hand;
            else if (hit == BarHit.Bar) wanted = Cursors.Default;
            else if (_pointPick) wanted = Cursors.Cross;
            else
            {
                var edges = EdgesAt(loc);
                wanted = edges != Edge.None ? CursorFor(edges)
                    : _hasSelection && _sel.Contains(loc) ? Cursors.SizeAll
                    : Cursors.Cross;
            }
            if (Cursor != wanted) Cursor = wanted;
        }

        private void OnMouseUp(object? sender, MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left || _drag == DragKind.None) return;

            // Same pinning rationale as OnMouseDown — releasing the button must not shift the edge
            // away from the pixel the magnifier was showing.
            var loc = _precisionActive && _hasCursor ? _cursorPoint : e.Location;
            ApplyDrag(loc);
            var kind = _drag;
            _drag = DragKind.None;

            if (kind == DragKind.Draw)
            {
                // A new area waits for Enter or Done; a click that barely moved is not one, and the
                // capture simply carries on.
                _hasSelection = _sel.Width >= MinSide && _sel.Height >= MinSide;
            }
            UpdateHover(loc);
            Invalidate();
        }

        // A double-click inside the area confirms it, the way most capture tools do. Its first
        // press started a Move that went nowhere.
        private void OnMouseDoubleClick(object? sender, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left && !_pointPick && _hasSelection && _sel.Contains(e.Location))
            {
                _drag = DragKind.None;
                Commit("double-click");
            }
        }

        // Invalidate the union of the PREVIOUSLY-PAINTED label rect (captured at the end of
        // OnPaint, so it reflects the real MeasureString width and any edge-flip that happened)
        // and a generous approximation of where the new label will land. Inflated by 8 px on
        // each axis to absorb font-metric drift between the estimate and the actual paint
        // result — the earlier 1-px inflate left a smeared trail when the cursor moved fast
        // across wide-digit coordinate strings. Also used when only the precision badge
        // changed, which repaints in place with no cursor movement at all.
        private void InvalidateMagnifier()
        {
            var newRect = ComputeCursorLabelRect();
            // Union with an empty rect would stretch the dirty region back to the origin, so
            // each side only joins in when it actually covers something.
            Rectangle dirty;
            if (_lastCursorLabelRect.IsEmpty) dirty = newRect;
            else if (newRect.IsEmpty) dirty = _lastCursorLabelRect;
            else dirty = Rectangle.Union(_lastCursorLabelRect, newRect);
            if (dirty.IsEmpty) return;   // nothing painted yet — no cursor seen
            dirty.Inflate(8, 8);
            Invalidate(dirty);
        }

        // Mouse-wheel zoom for the magnifier (PowerToys-style). Scroll up = zoom in (fewer, larger
        // source pixels), down = zoom out. The cursor doesn't move, so a full invalidate repaints
        // the resized disc in place; wheel events are low-frequency so the full repaint is cheap.
        private void OnMouseWheel(object? sender, MouseEventArgs e)
        {
            int prev = _zoomIndex;
            if (e.Delta > 0) _zoomIndex = Math.Max(0, _zoomIndex - 1);
            else if (e.Delta < 0) _zoomIndex = Math.Min(ZoomLevels.Length - 1, _zoomIndex + 1);
            if (_zoomIndex != prev) Invalidate();
        }

        // ── The bar ──────────────────────────────────────────────────────────────

        // Where the bar sits for the pointer at `loc`: on the pointer's monitor, at the top unless
        // the pointer came near it, then at the bottom — and back up when it comes near there. Once
        // an area is drawn and nothing is being dragged, the bar holds still: its Done and Cancel
        // have to be reachable, and nothing under it is being picked.
        private void UpdateBarPlacement(Point loc)
        {
            int monitor = MonitorIndexAt(loc);
            bool bottom = _barAtBottom;
            bool holdStill = !_pointPick && _hasSelection && _drag == DragKind.None;
            if (!holdStill && _barLayout != null && monitor == _barMonitor)
            {
                float s = _monitors[monitor].Scale;
                var near = RectangleF.Inflate(_barLayout.Bar, 24 * s, 32 * s);
                if (near.Contains(loc)) bottom = !_barAtBottom;
            }
            if (monitor == _barMonitor && bottom == _barAtBottom) return;
            var old = _barLayout?.Bar ?? RectangleF.Empty;
            _barMonitor = monitor;
            _barAtBottom = bottom;
            _barLayout = null;   // laid out again on the next paint, where it is drawn
            if (!old.IsEmpty) Invalidate(Rectangle.Inflate(Rectangle.Ceiling(old), 2, 2));
            Invalidate(Rectangle.Inflate(Rectangle.Ceiling(PredictBarRect()), 2, 2));
        }

        private BarHit HitBar(Point p)
        {
            var l = _barLayout;
            if (l == null || !l.Bar.Contains(p)) return BarHit.None;
            if (l.Cancel.Contains(p)) return BarHit.Cancel;
            if (!l.Done.IsEmpty && l.Done.Contains(p)) return BarHit.Done;
            return BarHit.Bar;
        }

        // The bar's rect before the next paint lays it out, for the invalidate when it moves: the
        // last width is a good guess, and the monitor's full width is a safe one.
        private RectangleF PredictBarRect()
        {
            var (mon, s) = _monitors[_barMonitor];
            float h = BarHeight * s;
            float y = _barAtBottom ? mon.Bottom - BarMargin * s - h : mon.Top + BarMargin * s;
            return new RectangleF(mon.X, y, mon.Width, h);
        }

        private const float BarHeight = 44f;
        private const float BarMargin = 20f;

        private sealed class BarLayout
        {
            public RectangleF Bar;
            public RectangleF Cancel;
            public RectangleF Done = RectangleF.Empty;
            // The buttons' words as they were measured, so the paint draws exactly what was laid out.
            public string CancelText = "";
            public string DoneText = "";
            public float Scale;
            public readonly List<(string Text, Font Font, Brush Brush, PointF At)> Texts = new();
            public readonly List<(RectangleF Rect, string Text, bool OnAccent)> Caps = new();
            public readonly List<float> Separators = new();
        }

        // Fonts per scale, made once: the bar is laid out on each paint that touches it.
        private readonly Dictionary<float, BarFonts> _barFonts = new();
        private sealed record BarFonts(Font Title, Font Body, Font Cap, Font Button);
        private BarFonts FontsFor(float s)
        {
            if (!_barFonts.TryGetValue(s, out var f))
            {
                f = new BarFonts(
                    new Font("Segoe UI Semibold", 14f * s, FontStyle.Regular, GraphicsUnit.Pixel),
                    new Font("Segoe UI", 13f * s, FontStyle.Regular, GraphicsUnit.Pixel),
                    new Font("Segoe UI Semibold", 11f * s, FontStyle.Regular, GraphicsUnit.Pixel),
                    new Font("Segoe UI Semibold", 13f * s, FontStyle.Regular, GraphicsUnit.Pixel));
                _barFonts[s] = f;
            }
            return f;
        }

        // The bar, left to right: the title and what it is for; then the keys of a point ("Scroll
        // zoom · Shift slow · Arrows 1 px · Enter pick") or the hint of an area; then Cancel (or Keep
        // current) with Esc, and for an area Done with Enter. Too wide for its monitor, it drops the
        // "for" line first, then the keys or hint — the title and the buttons always stay.
        private BarLayout LayoutBar(Graphics g)
        {
            var (mon, s) = _monitors[_barMonitor];
            var fonts = FontsFor(s);
            float h = BarHeight * s, pad = 14 * s, gap = 8 * s, groupGap = 12 * s;

            float Measure(string text, Font font) => g.MeasureString(text, font, PointF.Empty, StringFormat.GenericTypographic).Width;
            float CapWidth(string text) => Measure(text, fonts.Cap) + 10 * s;

            // The caps are keys and stay as the keycap writes them; the words after them, the hint and
            // the buttons are in the interface's language (i18n/*/engine-capture.ts).
            var keys = new List<(string Cap, string Label)>();
            if (_pointPick)
            {
                keys.Add(("Scroll", S.CaptureKeysZoom));
                keys.Add(("Shift", S.CaptureKeysSlow));
                keys.Add(("Arrows", S.CaptureKeysNudge));
                keys.Add(("Enter", S.CaptureKeysPick));
            }
            string? hint = _pointPick ? null : (_bar.Hint ?? S.CaptureHint);
            string cancelText = _seeded ? S.CaptureKeepCurrent : S.CaptureCancel;
            string doneText = S.CaptureDone;
            bool hasDone = !_pointPick;

            float titleW = Measure(_bar.Title, fonts.Title);
            float forW = _bar.For is { Length: > 0 } ? Measure(_bar.For, fonts.Body) : 0;
            float keysW = 0;
            foreach (var (cap, label) in keys) keysW += CapWidth(cap) + 5 * s + Measure(label, fonts.Body) + groupGap;
            if (keys.Count > 0) keysW -= groupGap;
            float hintW = hint != null ? Measure(hint, fonts.Body) : 0;
            float middleW = keys.Count > 0 ? keysW : hintW;
            float ButtonW(string text, string cap) => 12 * s + Measure(text, fonts.Button) + 6 * s + CapWidth(cap) + 8 * s;
            float buttonsW = ButtonW(cancelText, "Esc") + (hasDone ? gap + ButtonW(doneText, "Enter") : 0);

            float sep = 1 + 2 * groupGap;
            float Total(bool withFor, bool withMiddle) =>
                pad + titleW + (withFor && forW > 0 ? gap + forW : 0)
                + (withMiddle && middleW > 0 ? sep + middleW : 0)
                + sep + buttonsW + pad;
            float maxW = mon.Width - 32 * s;
            bool showFor = true, showMiddle = true;
            if (Total(showFor, showMiddle) > maxW) showFor = false;
            if (Total(showFor, showMiddle) > maxW) showMiddle = false;
            float w = Math.Min(Total(showFor, showMiddle), maxW);

            float x0 = mon.X + (mon.Width - w) / 2f;
            float y0 = _barAtBottom ? mon.Bottom - BarMargin * s - h : mon.Top + BarMargin * s;
            var layout = new BarLayout { Bar = new RectangleF(x0, y0, w, h), Scale = s };
            float cy = y0 + h / 2f;
            float x = x0 + pad;

            float TextY(Font font) => cy - font.GetHeight(g) / 2f;
            layout.Texts.Add((_bar.Title, fonts.Title, Brushes.White, new PointF(x, TextY(fonts.Title))));
            x += titleW;
            if (showFor && forW > 0)
            {
                x += gap;
                layout.Texts.Add((_bar.For!, fonts.Body, BarMutedBrush, new PointF(x, TextY(fonts.Body))));
                x += forW;
            }
            if (showMiddle && middleW > 0)
            {
                x += groupGap;
                layout.Separators.Add(x);
                x += 1 + groupGap;
                if (keys.Count > 0)
                {
                    foreach (var (cap, label) in keys)
                    {
                        float cw = CapWidth(cap);
                        layout.Caps.Add((new RectangleF(x, cy - 10 * s, cw, 20 * s), cap, false));
                        x += cw + 5 * s;
                        layout.Texts.Add((label, fonts.Body, BarMutedBrush, new PointF(x, TextY(fonts.Body))));
                        x += Measure(label, fonts.Body) + groupGap;
                    }
                    x -= groupGap;
                }
                else
                {
                    layout.Texts.Add((hint!, fonts.Body, BarHintBrush, new PointF(x, TextY(fonts.Body))));
                    x += hintW;
                }
            }
            x += groupGap;
            layout.Separators.Add(x);
            x += 1 + groupGap;

            // The buttons sit at the right edge, whatever was dropped before them.
            float bx = x0 + w - pad - buttonsW;
            float bh = 28 * s;
            float cancelW = ButtonW(cancelText, "Esc");
            layout.Cancel = new RectangleF(bx, cy - bh / 2f, cancelW, bh);
            if (hasDone)
                layout.Done = new RectangleF(bx + cancelW + gap, cy - bh / 2f, ButtonW(doneText, "Enter"), bh);
            layout.CancelText = cancelText;
            layout.DoneText = doneText;
            return layout;
        }

        private void DrawBar(Graphics g)
        {
            var oldSmoothing = g.SmoothingMode;
            var oldText = g.TextRenderingHint;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            var l = _barLayout = LayoutBar(g);
            float s = l.Scale;
            var fonts = FontsFor(s);
            var bar = l.Bar;

            using (var path = RoundedRect(bar, 10 * s))
            {
                g.FillPath(BarBgBrush, path);
                g.DrawPath(BarBorderPen, path);
            }
            foreach (var (text, font, brush, at) in l.Texts)
                g.DrawString(text, font, brush, at, StringFormat.GenericTypographic);
            foreach (var (rect, text, onAccent) in l.Caps)
                DrawKeyCap(g, rect, text, fonts.Cap, onAccent, s);
            foreach (float sx in l.Separators)
                g.DrawLine(BarSeparatorPen, sx, bar.Y + bar.Height / 2f - 10 * s, sx, bar.Y + bar.Height / 2f + 10 * s);

            DrawButton(g, l.Cancel, l.CancelText, "Esc", accent: false, hover: _barHover == BarHit.Cancel, fonts, s);
            if (!l.Done.IsEmpty)
                DrawButton(g, l.Done, l.DoneText, "Enter", accent: true, hover: _barHover == BarHit.Done, fonts, s);

            g.SmoothingMode = oldSmoothing;
            g.TextRenderingHint = oldText;
        }

        private void DrawButton(Graphics g, RectangleF r, string text, string cap, bool accent, bool hover, BarFonts fonts, float s)
        {
            // An area's Done is dimmed until there is an area to confirm.
            bool enabled = !accent || (_hasSelection && _sel.Width >= MinSide && _sel.Height >= MinSide);
            Brush fill = accent
                ? (hover && enabled ? AccentButtonHoverBrush : AccentButtonBrush)
                : (hover ? GhostButtonHoverBrush : GhostButtonBrush);
            using (var path = RoundedRect(r, 7 * s))
                g.FillPath(fill, path);
            Brush textBrush = accent ? AccentButtonTextBrush : Brushes.White;
            float tx = r.X + 12 * s;
            float ty = r.Y + r.Height / 2f - fonts.Button.GetHeight(g) / 2f;
            g.DrawString(text, fonts.Button, textBrush, tx, ty, StringFormat.GenericTypographic);
            float tw = g.MeasureString(text, fonts.Button, PointF.Empty, StringFormat.GenericTypographic).Width;
            float cw = g.MeasureString(cap, fonts.Cap, PointF.Empty, StringFormat.GenericTypographic).Width + 10 * s;
            DrawKeyCap(g, new RectangleF(tx + tw + 6 * s, r.Y + r.Height / 2f - 9 * s, cw, 18 * s), cap, fonts.Cap, accent, s);
            if (!enabled)
            {
                using var veil = new SolidBrush(Color.FromArgb(140, 24, 24, 27));
                using var path = RoundedRect(r, 7 * s);
                g.FillPath(veil, path);
            }
        }

        private static void DrawKeyCap(Graphics g, RectangleF r, string text, Font font, bool onAccent, float s)
        {
            using var path = RoundedRect(r, 4 * s);
            if (!onAccent) g.FillPath(KeyCapBgBrush, path);
            g.DrawPath(onAccent ? AccentKeyCapPen : KeyCapBorderPen, path);
            float tw = g.MeasureString(text, font, PointF.Empty, StringFormat.GenericTypographic).Width;
            g.DrawString(text, font, onAccent ? AccentButtonTextBrush : KeyCapTextBrush,
                r.X + (r.Width - tw) / 2f, r.Y + r.Height / 2f - font.GetHeight(g) / 2f, StringFormat.GenericTypographic);
        }

        private static GraphicsPath RoundedRect(RectangleF r, float radius)
        {
            var path = new GraphicsPath();
            float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        // ── The magnifier ────────────────────────────────────────────────────────

        // Magnifier zoom — PowerToys-style mouse-wheel zoom. Each level is (source-pixel count
        // across the disc, on-screen px per pixel); counts are ODD so the centre pixel sits exactly
        // under the cursor. Scrolling up steps toward fewer/larger pixels (more magnification).
        // Index 2 (11 × 13 = 143 px disc) was the original fixed magnifier. The disc size varies a
        // little per level; ComputeCursorLabelRect / DrawMagnifier read these as LIVE values so the
        // layout + flip-on-edge logic always tracks the current zoom.
        private static readonly (int count, int size)[] ZoomLevels =
        {
            (7, 24),   // 168 px disc — most zoomed in
            (9, 18),   // 162 px
            (11, 13),  // 143 px — original fixed magnifier
            (15, 11),  // 165 px
            (21, 9),   // 189 px — most zoomed out (start)
        };
        // Start at the widest view (most zoomed out) per user request — shows the most
        // surrounding context; scroll up to zoom in on a single pixel.
        private int _zoomIndex = ZoomLevels.Length - 1;
        private int MagPixelCount => ZoomLevels[_zoomIndex].count;
        private int MagPixelSize => ZoomLevels[_zoomIndex].size;
        private int MagDiameter => MagPixelCount * MagPixelSize;
        private const int MagLabelGap = 8;
        // Three-line chip: coords + HEX + RGB. Must match the rendered height so the
        // flip-on-edge logic in DrawMagnifier + ComputeCursorLabelRect lands cleanly.
        private const int MagLabelHeight = 56;
        private const int MagOffset = 20;
        private int MagTotalHeight => MagDiameter + MagLabelGap + MagLabelHeight;

        // Fake drop shadow — GDI+ has no blur, so several low-alpha rings stacked at
        // growing radii accumulate into a soft falloff. Kept subtle so the disc/chip
        // read as lifted, not boxed. MagShadowMargin pads the invalidate rects so the
        // shadow clears cleanly as the cursor moves (no smear trails).
        private const int MagShadowSpread = 6;
        private const int MagShadowAlpha = 15;
        private const int MagShadowDy = 2;
        private const int MagShadowMargin = MagShadowSpread + MagShadowDy;

        // Approximates the magnifier's bounding box for OnMouseMove's invalidate. The
        // actual paint rect is captured back into _lastCursorLabelRect inside DrawMagnifier
        // so the next move invalidates exactly the touched pixels.
        private Rectangle ComputeCursorLabelRect()
        {
            if (!_hasCursor) return Rectangle.Empty;
            int lx = _cursorPoint.X + MagOffset;
            int ly = _cursorPoint.Y + MagOffset;
            if (lx + MagDiameter > ClientRectangle.Width)  lx = _cursorPoint.X - MagOffset - MagDiameter;
            if (ly + MagTotalHeight > ClientRectangle.Height) ly = _cursorPoint.Y - MagOffset - MagTotalHeight;
            if (lx < 0) lx = 0;
            if (ly < 0) ly = 0;
            // Pad by the drop-shadow spread so the move-invalidate clears the shadow too.
            return Rectangle.Inflate(new Rectangle(lx, ly, MagDiameter, MagTotalHeight),
                                     MagShadowMargin, MagShadowMargin);
        }

        // ShareX-style zoom magnifier. Renders a patch of the in-memory screenshot centred on the
        // cursor, amplified with nearest-neighbour so individual pixels are crisp squares. A
        // crosshair points at the centre pixel — the one the click will actually capture — and the
        // chip below the disc says where it is ("824, 492") and, in a colour pick, its colour
        // ("#2ECC71", "46 204 113"), as the board draws it.
        //
        // The system cursor alone makes 1-pixel colour-picking essentially a guessing game; this
        // disc removes the ambiguity (the user sees exactly which pixel will be sampled).
        private void DrawMagnifier(Graphics g)
        {
            if (!_hasCursor) return;
            int absX = _cursorPoint.X + _virtualOriginX;
            int absY = _cursorPoint.Y + _virtualOriginY;

            // Position with the same flip-on-edge rules as DrawCursorCoords. Total
            // box includes the label below; if the disc alone would clip, flip
            // vertically before the label clipping logic runs.
            int magX = _cursorPoint.X + MagOffset;
            int magY = _cursorPoint.Y + MagOffset;
            if (magX + MagDiameter > ClientRectangle.Width)
                magX = _cursorPoint.X - MagOffset - MagDiameter;
            if (magY + MagTotalHeight > ClientRectangle.Height)
                magY = _cursorPoint.Y - MagOffset - MagTotalHeight;
            if (magX < 0) magX = 0;
            if (magY < 0) magY = 0;

            var circleRect = new Rectangle(magX, magY, MagDiameter, MagDiameter);

            // Anti-alias every vector pass (shadow, disc, crosshair, centre cell, chip) and
            // ClearType the chip text — the jagged 1.5 px border / 2 px crosshair were the
            // main thing that read as "unfinished". The blit + pixel grid flip back to None
            // below so zoomed pixels stay hard-edged. DrawMagnifier is the last thing
            // OnPaint draws, so these modes don't need restoring.
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            // Soft drop shadow — lifts the disc off busy backgrounds so it reads as a
            // deliberate instrument rather than a screenshot artifact.
            for (int s = MagShadowSpread; s >= 1; s--)
                g.FillEllipse(MagShadowBrush, circleRect.X - s, circleRect.Y - s + MagShadowDy,
                              circleRect.Width + 2 * s, circleRect.Height + 2 * s);

            // Dark backdrop so out-of-bounds source pixels (near screen edges) read
            // as "void" instead of garbage. Sub-pixel circle border softens the
            // clipped edge.
            g.FillEllipse(MagBackdropBrush, circleRect);

            // Clip to the disc, then blit the screenshot patch with
            // NearestNeighbour for pixel-perfect zoom (no smoothing).
            using (var clip = new GraphicsPath())
            {
                clip.AddEllipse(circleRect);
                g.SetClip(clip);

                // Blit + pixel grid must stay hard-edged — AA here would shimmer the grid
                // lines and soften the crisp pixel squares.
                g.SmoothingMode = SmoothingMode.None;

                int halfGrid = MagPixelCount / 2;
                var srcRect = new Rectangle(
                    _cursorPoint.X - halfGrid,
                    _cursorPoint.Y - halfGrid,
                    MagPixelCount, MagPixelCount);

                var oldInterp = g.InterpolationMode;
                var oldPixel = g.PixelOffsetMode;
                g.InterpolationMode = InterpolationMode.NearestNeighbor;
                g.PixelOffsetMode = PixelOffsetMode.Half;
                try
                {
                    g.DrawImage(_screenshot, circleRect, srcRect, GraphicsUnit.Pixel);
                }
                finally
                {
                    g.InterpolationMode = oldInterp;
                    g.PixelOffsetMode = oldPixel;
                }

                // Faint grid between amplified pixels — half-alpha white so it sits
                // on top of any colour without dominating. Skipping the i=0 and
                // i=MagPixelCount edges (they land on the disc border anyway).
                for (int i = 1; i < MagPixelCount; i++)
                {
                    int gx = magX + i * MagPixelSize;
                    int gy = magY + i * MagPixelSize;
                    g.DrawLine(MagGridPen, gx, magY, gx, magY + MagDiameter);
                    g.DrawLine(MagGridPen, magX, gy, magX + MagDiameter, gy);
                }

                int halfPx = (MagPixelCount / 2) * MagPixelSize;

                // Crosshair — ShareX-style: a translucent band exactly ONE magnified pixel
                // wide, snapped to the target cell's row and column. Two deliberate changes
                // from the old 2 px near-opaque line: the band now corresponds to a real
                // screen pixel instead of floating mid-cell, and the low alpha lets the
                // magnified content read straight THROUGH it, so the crosshair guides the eye
                // without hiding the very pixels being inspected. It runs uninterrupted across
                // the disc — the old gap around the centre existed only because the opaque
                // line would have covered the target, which a soft band no longer does.
                //
                // Hard edges: the band has to land exactly on the pixel grid, and AA would
                // bleed it a fraction into the neighbouring cells.
                g.SmoothingMode = SmoothingMode.None;

                // Filled as ONE region, not two rectangles — the arms overlap on the centre
                // cell, and two translucent fills would stack their alpha into a visibly
                // darker square right where the user is looking.
                using (var crossArea = new Region(new Rectangle(magX + halfPx, magY, MagPixelSize, MagDiameter)))
                {
                    crossArea.Union(new Rectangle(magX, magY + halfPx, MagDiameter, MagPixelSize));
                    g.FillRegion(MagCrossBrush, crossArea);
                }

                // Back to anti-aliased for the centre-cell outline (smooth vector).
                g.SmoothingMode = SmoothingMode.AntiAlias;

                // Highlight the exact target pixel — 1.5 px white outline around the
                // centre cell so the user can see which pixel the click will sample,
                // even when the underlying colour is white-ish.
                // Dual stroke — a dark 3 px underlay then white 1.5 px on top — so the
                // target cell stays legible on both light and dark pixels (a lone white
                // outline used to vanish on white-ish colours).
                g.DrawRectangle(MagCenterDarkPen, magX + halfPx, magY + halfPx, MagPixelSize, MagPixelSize);
                g.DrawRectangle(MagCenterLightPen, magX + halfPx, magY + halfPx, MagPixelSize, MagPixelSize);

                g.ResetClip();
            }

            // Disc border — 1.5 px subtle white outside the clip so it doesn't
            // overlap with the centre highlight. Turns accent while precision mode is on,
            // so the damped cursor never leaves the user wondering why it feels stuck.
            g.DrawEllipse(_precisionActive ? MagBorderPrecisionPen : MagBorderPen, circleRect);

            // Live "SLOW" badge — state, not instruction: the discoverable hint lives in the
            // bar, this only confirms the mode is engaged. Sits inside the lower edge of
            // the disc (well within the tracked invalidate rect, so it can't smear) and is
            // narrow enough to fit the chord at that height even on the smallest zoom level.
            if (_precisionActive)
            {
                // In the interface's language ("SLOW" / "LENTO"): five letters still fit the chord of
                // the smallest disc (143 px) at this height.
                string slowText = S.CaptureSlowBadge;
                var slowSize = g.MeasureString(slowText, SlowBadgeFont);
                float badgeW = slowSize.Width + 10;
                float badgeH = slowSize.Height + 2;
                float badgeX = magX + (MagDiameter - badgeW) / 2;
                float badgeY = magY + MagDiameter - badgeH - 8;
                g.FillRoundedRectangle(SlowBadgeBgBrush, badgeX, badgeY, badgeW, badgeH, 4);
                g.DrawString(slowText, SlowBadgeFont, AccentTextBrush, badgeX + 5, badgeY + 1);
            }

            // Coord chip below the disc:
            //   1. "{x}, {y}"      — always shown
            //   2. "#RRGGBB"      — colour picks only, with the swatch
            //   3. "{r} {g} {b}"  — colour picks only
            string coordText = $"{absX}, {absY}";
            bool showHex = _showColor;
            Color? sampled = null;
            if (showHex
                && _cursorPoint.X >= 0 && _cursorPoint.X < _screenshot.Width
                && _cursorPoint.Y >= 0 && _cursorPoint.Y < _screenshot.Height)
            {
                sampled = _screenshot.GetPixel(_cursorPoint.X, _cursorPoint.Y);
            }
            string hexText = sampled.HasValue
                ? TrueReplayer.Services.PixelColorService.ToHex(sampled.Value)
                : "—";
            // RGB readout alongside HEX — PowerToys shows multiple formats; this is the second one.
            string rgbText = sampled.HasValue
                ? $"{sampled.Value.R} {sampled.Value.G} {sampled.Value.B}"
                : "";

            var coordSize = g.MeasureString(coordText, CoordFont);
            var hexSize = showHex ? g.MeasureString(hexText, HexFont) : SizeF.Empty;
            var rgbSize = (showHex && rgbText.Length > 0) ? g.MeasureString(rgbText, RgbFont) : SizeF.Empty;

            // Colour swatch to the left of the HEX line — the signature "real eyedropper"
            // element (ShareX/PowerToys both show it). Colour picks only, so gated on showHex.
            const float swatch = 12f, swGap = 6f;
            bool showSwatch = showHex && sampled.HasValue;
            float hexGroupW = showSwatch ? swatch + swGap + hexSize.Width : hexSize.Width;

            // Chip sized per content — full (3-line) height when picking colour, compact
            // otherwise. The HEX row width now includes the swatch group.
            float chipW = Math.Max(coordSize.Width, Math.Max(hexGroupW, rgbSize.Width)) + 16;
            float chipH = showHex ? MagLabelHeight : (coordSize.Height + 6);
            float chipX = magX + (MagDiameter - chipW) / 2;
            float chipY = magY + MagDiameter + MagLabelGap;

            // Match the disc — a soft shadow lifts the chip too (radius grows with the ring).
            for (int s = MagShadowSpread; s >= 1; s--)
                g.FillRoundedRectangle(MagShadowBrush, chipX - s, chipY - s + MagShadowDy,
                                       chipW + 2 * s, chipH + 2 * s, 5 + s);

            g.FillRoundedRectangle(ChipBgBrush, chipX, chipY, chipW, chipH, 5);
            float coordX = chipX + (chipW - coordSize.Width) / 2;
            g.DrawString(coordText, CoordFont, AccentTextBrush, coordX, chipY + 3);
            if (showHex)
            {
                float hexY = chipY + 3 + coordSize.Height + 1;
                float groupX = chipX + (chipW - hexGroupW) / 2;
                float hexX = groupX;
                if (showSwatch)
                {
                    float swY = hexY + (hexSize.Height - swatch) / 2f;
                    using (var swBrush = new SolidBrush(Color.FromArgb(255, sampled!.Value.R, sampled.Value.G, sampled.Value.B)))
                        g.FillRectangle(swBrush, groupX, swY, swatch, swatch);
                    g.DrawRectangle(SwatchBorderPen, groupX, swY, swatch, swatch);
                    hexX = groupX + swatch + swGap;
                }
                g.DrawString(hexText, HexFont, AccentTextBrush, hexX, hexY);
                if (rgbText.Length > 0)
                {
                    float rgbX = chipX + (chipW - rgbSize.Width) / 2;
                    g.DrawString(rgbText, RgbFont, RgbTextBrush, rgbX, hexY + hexSize.Height + 1);
                }
            }

            // Tracked rect = whole magnifier + label, padded by the drop-shadow spread so
            // the next move invalidates the shadow pixels too. Used by OnMouseMove to
            // invalidate the previous frame; without it the disc would smear.
            _lastCursorLabelRect = Rectangle.Inflate(
                new Rectangle(magX, magY, MagDiameter, MagTotalHeight), MagShadowMargin, MagShadowMargin);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _screenshot?.Dispose();
                foreach (var f in _barFonts.Values)
                {
                    f.Title.Dispose(); f.Body.Dispose(); f.Cap.Dispose(); f.Button.Dispose();
                }
                _barFonts.Clear();
                // Put the process-wide ceiling back. MaximumBuffer is global state, and lowering it
                // releases the cached surface rather than merely capping future ones — measured at
                // 28.3 MB returned on a 5120x1440 desktop — so the overlay pays for its buffer only
                // while it is on screen. Without this the app would hold that surface for the rest
                // of the session for a window that lives for seconds.
                if (_previousMaximumBuffer is { } previous)
                {
                    try { BufferedGraphicsManager.Current.MaximumBuffer = previous; } catch { }
                    _previousMaximumBuffer = null;
                }
            }
            base.Dispose(disposing);
        }

        private const uint MONITOR_DEFAULTTONEAREST = 2;
        private const int MDT_EFFECTIVE_DPI = 0;
        [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(NativeMethods.POINT pt, uint dwFlags);
        [DllImport("shcore.dll")] private static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);
    }

    // Extension method for rounded rectangles
    internal static class GraphicsExtensions
    {
        public static void FillRoundedRectangle(this Graphics g, Brush brush, float x, float y, float w, float h, float r)
        {
            using var path = new GraphicsPath();
            path.AddArc(x, y, r * 2, r * 2, 180, 90);
            path.AddArc(x + w - r * 2, y, r * 2, r * 2, 270, 90);
            path.AddArc(x + w - r * 2, y + h - r * 2, r * 2, r * 2, 0, 90);
            path.AddArc(x, y + h - r * 2, r * 2, r * 2, 90, 90);
            path.CloseFigure();
            g.FillPath(brush, path);
        }
    }
}
