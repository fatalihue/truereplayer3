using System;
using System.Threading;

namespace TrueReplayer.Services
{
    /// <summary>
    /// The one place that answers "may an autonomous fire proceed right now, and if not, why".
    ///
    /// The reason half is not decoration. Steps 4-5 deliberately RAISE the skip rate: overlays and
    /// file pickers that previously did not register as "user mid-interaction" now do, which is the
    /// correct behaviour and also new behaviour, in an app with armed automations and 84 profiles.
    /// A skipped fire is LOST, not queued. Reported as a bare "skipped (dialog open)" while the
    /// screen looks perfectly idle — because the thing holding it is a full-screen overlay the user
    /// already dismissed, or a picker behind the main window — that is indistinguishable from a
    /// bug, and it would be reported as a regression of the automation engine.
    ///
    /// Composed here rather than at each call site because the two readers (the hotkey/hotstring
    /// path and the trigger path) drifting apart is how one of them ends up firing into a state the
    /// other refuses.
    /// </summary>
    internal static class AutomationGuard
    {
        /// <summary>
        /// Null when nothing blocks an autonomous fire. Otherwise a short phrase naming what does,
        /// suitable for the Automation panel's result line.
        ///
        /// IsCaptureDialogOpen rather than CaptureHotkeyMode: the latter is additionally gated on
        /// TrueReplayer being the foreground app, which an autonomous fire by definition almost
        /// never is — using it here would read false exactly when it matters.
        /// </summary>
        public static string? BlockedReason()
        {
            // Most specific first: the scope knows WHICH interaction, and it is also the most
            // common blocker now that overlays and pickers register.
            var owner = InteractionScope.CurrentOwner;
            if (owner != null)
            {
                var reason = $"skipped ({owner})";
                LastReason = reason;
                return reason;
            }
            if (EditorHoldsUnsavedWork())
            {
                const string reason = "skipped (editing a row)";
                LastReason = reason;
                return reason;
            }
            if (TrueReplayer.InputHookManager.SuppressAllHotkeys)
            {
                // No scope open, so this is the frontend channel: a React modal is up.
                const string reason = "skipped (a dialog is open)";
                LastReason = reason;
                return reason;
            }
            if (TrueReplayer.InputHookManager.IsCaptureDialogOpen)
            {
                const string reason = "skipped (capturing a hotkey)";
                LastReason = reason;
                return reason;
            }
            return null;
        }

        /// <summary>
        /// The phrase from the most recent blocked check.
        ///
        /// It exists because the decision and the bookkeeping happen in different places: the fire
        /// path decides (and returns a bare enum), TriggerService records. Re-asking BlockedReason
        /// at record time would be worse than this — by then the overlay is usually closed, so it
        /// would answer "nothing is blocking" for a fire that was demonstrably blocked.
        ///
        /// Two skips racing can therefore label one with the other's reason. That is a cosmetic
        /// mislabel in a diagnostics line, and both were genuinely blocked; nothing branches on it.
        /// </summary>
        public static string? LastReason
        {
            get => Volatile.Read(ref _lastReason);
            private set => Volatile.Write(ref _lastReason, value);
        }

        private static string? _lastReason;

        /// <summary>
        /// The row editor's pending-edit claim, as a UTC tick stamp (0 = nothing pending).
        ///
        /// The gap this closes: the SheetPanel's fields live in React state and only become
        /// `actions:edit` on Save, so `HasUnsavedChanges` — which an autonomous fire DOES respect —
        /// is still false while a half-filled form is on screen. The fire then swaps the profile,
        /// ApplyProfileActions replaces the whole list, and the panel's seed effect overwrites the
        /// user's typing with the same-index row of a DIFFERENT profile. With fewer rows in the new
        /// profile the editor is left stranded: old values on screen, Save inert, no warning.
        ///
        /// Deliberately NOT an <see cref="InteractionScope"/>, which would have brought its sweeper
        /// for free: <c>InputHookManager.SuppressAllHotkeys</c> is <c>_frontendSuppress ||
        /// InteractionScope.IsAnyOpen</c>, so claiming a scope would also kill every hotkey and
        /// hotstring in the app for as long as a row editor had a draft. This flag is read by
        /// nothing but <see cref="BlockedReason"/>, so it stops autonomous fires and leaves the
        /// user's own keys alone.
        ///
        /// And it is NOT routed through SkippedDirty, which is terminal — never retried. A row
        /// editor is a moment of contention like an open dialog, so it reports as SkippedModal:
        /// retriable, with a reason the panel can show.
        /// </summary>
        private static long _editorBusySinceTicks;

        /// <summary>
        /// Leak backstop. A claim this old is a WebView that went away without releasing, not a
        /// user still typing — the frontend re-mounts on reload, so nothing legitimate re-claims.
        ///
        /// An on-read deadline is the wrong shape for InteractionScope (its own remarks explain
        /// why: a leaked scope is exactly the case where nobody reads it, so the check never runs).
        /// It is the RIGHT shape here, because the only reader is the only victim: while nobody
        /// asks, nobody is being blocked. Failing OPEN after the deadline costs one row editor's
        /// unsaved fields; failing closed would cost every automation until restart.
        /// </summary>
        private static readonly TimeSpan EditorClaimTtl = TimeSpan.FromMinutes(10);

        private static bool EditorHoldsUnsavedWork()
        {
            long since = Volatile.Read(ref _editorBusySinceTicks);
            if (since == 0) return false;
            if (DateTime.UtcNow.Ticks - since < EditorClaimTtl.Ticks) return true;

            // Clear it rather than just answering false, so the warning is written once instead of
            // on every fire attempt for the rest of the session.
            Volatile.Write(ref _editorBusySinceTicks, 0);
            DiagnosticLog.Warn(
                $"Row editor's unsaved-work claim expired after {EditorClaimTtl.TotalMinutes:0} min without release — " +
                "automations are no longer held by it. The editor was most likely torn down by a UI reload.");
            return false;
        }

        /// <summary>
        /// Called by the bridge when the row editor gains or loses pending edits, and
        /// unconditionally with false on <c>ui:ready</c> — a reload means the panel that claimed
        /// this no longer exists, and its release will never arrive.
        /// </summary>
        public static void SetEditorBusy(bool busy)
            => Volatile.Write(ref _editorBusySinceTicks, busy ? DateTime.UtcNow.Ticks : 0);
    }
}
