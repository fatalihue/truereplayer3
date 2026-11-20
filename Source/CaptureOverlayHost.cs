using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace TrueReplayer.Services
{
    /// <summary>
    /// One capture overlay's lifetime: the dedicated STA thread that hosts it, the liveness probe
    /// and the cancel route <see cref="InteractionScope"/> needs, and the lifecycle log.
    ///
    /// This body used to be copy-pasted at nine call sites in WebViewBridge — one of them labelled
    /// "THE canonical overlay-thread body; the eight siblings in this file point here", which is
    /// what a shared helper is for. Copies are why the 2026-08-24 wedge produced no diagnostic:
    /// there was no single place to put one, so nothing logged that an overlay had opened at all,
    /// and the only evidence of a three-minute app-wide freeze was the twelve refusals it caused.
    ///
    /// Everything the copies had is kept. CATCH, because this is not the main thread and an
    /// exception escaping the delegate takes the whole process down; every other stage of these
    /// pipelines logs and degrades. IsBackground, because a foreground thread outlives
    /// Application.Current.Exit() — the tray's Exit path calls exactly that — which left a dead app
    /// running behind a full-screen TopMost window with no tray icon to reach it by. A null
    /// selection is what every caller already reads as "the user cancelled".
    ///
    /// What is new is <see cref="OnThreadException"/>: a WinForms message handler that throws does
    /// NOT unwind through ShowDialog. With no handler installed, WinForms shows its own modal
    /// ThreadExceptionDialog on this very thread, so the overlay never closes, the exclusive scope
    /// is never released, and not one line is written — a repo-wide grep found zero occurrences of
    /// SetUnhandledExceptionMode before this. That failure mode is indistinguishable from the
    /// incident, and this is what would have named it.
    /// </summary>
    internal sealed class CaptureOverlayHost
    {
        private readonly string _owner;

        // Both are written on one thread and read on others (the sweep's keep-alive probe, a second
        // exclusive claimant asking the holder to close), so both are volatile. Neither is a lock:
        // the probe must never block, and a torn read here can only cost one extra sweep interval.
        private volatile Thread? _thread;
        private volatile ScreenOverlayForm? _form;

        public CaptureOverlayHost(string owner) => _owner = owner;

        /// <summary>
        /// The keep-alive probe. True for precisely the window between Start() and the form
        /// closing — see the keepAlive overload of <see cref="InteractionScope.Enter(string, Func{bool}, TimeSpan?)"/>
        /// for why the capture overlays renew instead of taking a flat deadline.
        /// </summary>
        public bool IsAlive() => _thread?.IsAlive == true;

        /// <summary>
        /// The cancel route. Handed to the scope so a second exclusive claimant can clear a stuck
        /// holder instead of the user killing the process. Posted to the overlay's own thread; a
        /// thread that is not pumping cannot answer, and then the claim honestly stays refused.
        /// </summary>
        public void RequestCancel(string reason) => _form?.RequestCancel(reason);

        public async Task<RegionSelectionResult?> RunAsync(Func<ScreenOverlayForm> factory)
        {
            // Deck (branch deck, Fase 3): the whole screen is the overlay's while it is open — the decks, always on
            // top, step aside until it closes.
            using var deckAside = DeckHost.StepAside();
            RegionSelectionResult? selection = null;
            var thread = new Thread(() =>
            {
                try
                {
                    Application.EnableVisualStyles();
                    // Must precede the first window on this thread. Explicit rather than left to
                    // Automatic so the behaviour does not depend on whether a debugger is attached.
                    Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
                    Application.ThreadException += OnThreadException;
                    using var overlay = factory();
                    _form = overlay;
                    overlay.ShowDialog();
                    selection = overlay.GetSelectionAsync().Result;
                    DiagnosticLog.Info(
                        $"Capture overlay '{_owner}' closed ({overlay.CloseReason}) — " +
                        (selection == null ? "no selection." : "selection returned."));
                }
                catch (Exception ex)
                {
                    DiagnosticLog.Error($"Capture overlay '{_owner}' thread failed", ex);
                }
                finally
                {
                    _form = null;
                    try { Application.ThreadException -= OnThreadException; } catch { /* teardown only */ }
                    // The LAST line of the overlay's life. Paired with the "starting" line below it
                    // bounds the whole thing: a "starting" with no "exiting" is the wedge, named.
                    DiagnosticLog.Info($"Capture overlay '{_owner}' thread exiting.");
                }
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.IsBackground = true;
            _thread = thread;
            DiagnosticLog.Info($"Capture overlay '{_owner}' starting.");
            thread.Start();
            await Task.Run(() => thread.Join());
            return selection;
        }

        private void OnThreadException(object? sender, ThreadExceptionEventArgs e)
        {
            DiagnosticLog.Error($"Capture overlay '{_owner}' threw inside a message handler", e.Exception);
            // Close it rather than leaving a half-painted full-screen window holding the exclusive
            // slot. The caller then sees a null selection, which is its ordinary cancel path.
            try { _form?.RequestCancel("message-handler exception"); } catch { /* already gone */ }
        }
    }
}
