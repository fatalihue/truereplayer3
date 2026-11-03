using System;
using System.Collections.Generic;
using System.Linq;
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
        /// <summary>What kind of thing held an autonomous fire.</summary>
        internal enum BlockKind
        {
            /// An InteractionScope: an overlay, a file picker, a ContentDialog, window detection.
            Scope,
            /// Editors holding unsaved work (see HeldEditors), one kind per thing the line can name.
            DataTable, Automation, Step, Row,
            /// No scope, but the frontend's suppression: a React modal is up.
            Dialog,
            /// A hotkey field waiting for its key.
            HotkeyCapture,
        }

        /// <summary>
        /// What held a fire: the kind, and for a scope or an editor its internal name (the scope's owner,
        /// the editor's claim). Kept as what happened rather than as words: the result line says it when
        /// it is read (<see cref="SkippedLine"/> and its two siblings), in the interface's language.
        /// </summary>
        internal sealed record Block(BlockKind Kind, string Owner = "");

        /// <summary>
        /// Null when nothing blocks an autonomous fire. Otherwise the result line naming what does
        /// ("skipped (the reference image capture is open)"), suitable for the Automation panel —
        /// the bookkeeping itself reads <see cref="LastBlock"/>.
        ///
        /// IsCaptureDialogOpen rather than CaptureHotkeyMode: the latter is additionally gated on
        /// TrueReplayer being the foreground app, which an autonomous fire by definition almost
        /// never is — using it here would read false exactly when it matters.
        /// </summary>
        public static string? BlockedReason()
        {
            var block = CurrentBlock();
            if (block == null) return null;
            LastBlock = block;
            return SkippedLine(block);
        }

        private static Block? CurrentBlock()
        {
            // Most specific first: the scope knows WHICH interaction, and it is also the most
            // common blocker now that overlays and pickers register.
            var owner = InteractionScope.CurrentOwner;
            if (owner != null) return new Block(BlockKind.Scope, owner);
            // Only the editors a profile swap can hurt. The Automations panel edits a trigger by
            // profile NAME and re-seeds only when it holds nothing of the user's, so a fire that
            // swaps the active profile leaves its draft alone — holding every automation off while
            // someone tunes one of them would lose schedule fires for nothing. Its claim is for the
            // two gates that END the process (the close guard and the update gate).
            foreach (var held in HeldEditors())
                if (!FireSafeEditors.Contains(held)) return new Block(EditorKind(held), held);
            // No scope open, so this is the frontend channel: a React modal is up.
            if (TrueReplayer.InputHookManager.SuppressAllHotkeys) return new Block(BlockKind.Dialog);
            if (TrueReplayer.InputHookManager.IsCaptureDialogOpen) return new Block(BlockKind.HotkeyCapture);
            return null;
        }

        /// <summary>
        /// What the most recent blocked check found.
        ///
        /// It exists because the decision and the bookkeeping happen in different places: the fire
        /// path decides (and returns a bare enum), TriggerService records. Re-asking BlockedReason
        /// at record time would be worse than this — by then the overlay is usually closed, so it
        /// would answer "nothing is blocking" for a fire that was demonstrably blocked.
        ///
        /// Two skips racing can therefore label one with the other's reason. That is a cosmetic
        /// mislabel in a diagnostics line, and both were genuinely blocked; nothing branches on it.
        /// </summary>
        public static Block? LastBlock
        {
            get => Volatile.Read(ref _lastBlock);
            private set => Volatile.Write(ref _lastBlock, value);
        }

        private static Block? _lastBlock;

        // ── The result lines that name a block, one whole sentence per kind (catalog area
        // engine-automations, result). Null is a modal skip with nothing on record. ──

        /// <summary>A fire refused right now: "skipped (…)".</summary>
        internal static string SkippedLine(Block? block) => block is null ? S.AutomationsResultSkippedUnknown : block.Kind switch
        {
            BlockKind.Scope => S.AutomationsResultSkippedScope(InteractionScope.Describe(block.Owner)),
            BlockKind.DataTable => S.AutomationsResultSkippedDataTable,
            BlockKind.Automation => S.AutomationsResultSkippedAutomation,
            BlockKind.Step => S.AutomationsResultSkippedStep,
            BlockKind.Row => S.AutomationsResultSkippedRow,
            BlockKind.HotkeyCapture => S.AutomationsResultSkippedHotkey,
            _ => S.AutomationsResultSkippedDialog,
        };

        /// <summary>An interval or schedule tick that waited its grace window out: "missed (… past the grace window)".</summary>
        internal static string MissedLine(Block? block) => block is null ? S.AutomationsResultMissedDialog : block.Kind switch
        {
            BlockKind.Scope => S.AutomationsResultMissedScope(InteractionScope.Describe(block.Owner)),
            BlockKind.DataTable => S.AutomationsResultMissedDataTable,
            BlockKind.Automation => S.AutomationsResultMissedAutomation,
            BlockKind.Step => S.AutomationsResultMissedStep,
            BlockKind.Row => S.AutomationsResultMissedRow,
            BlockKind.HotkeyCapture => S.AutomationsResultMissedHotkey,
            _ => S.AutomationsResultMissedDialog,
        };

        /// <summary>A condition's edge that aged out while held: "fire skipped (…) — edge expired".</summary>
        internal static string EdgeExpiredLine(Block? block) => block is null ? S.AutomationsResultEdgeUnknown : block.Kind switch
        {
            BlockKind.Scope => S.AutomationsResultEdgeScope(InteractionScope.Describe(block.Owner)),
            BlockKind.DataTable => S.AutomationsResultEdgeDataTable,
            BlockKind.Automation => S.AutomationsResultEdgeAutomation,
            BlockKind.Step => S.AutomationsResultEdgeStep,
            BlockKind.Row => S.AutomationsResultEdgeRow,
            BlockKind.HotkeyCapture => S.AutomationsResultEdgeHotkey,
            _ => S.AutomationsResultEdgeDialog,
        };

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
        ///
        /// One stamp PER OWNER. There are five owners — the SheetPanel; the ActionTable, whose
        /// row dialogs (SendText, Keystroke, Pause, RunProfile) and one-field inline cell editor all
        /// ride its single 'row-dialog' claim; the Toolbar's six insert dialogs, under
        /// 'insert-dialog'; the Data table ('data-panel') and the Automations panel
        /// ('automation-panel') — and this used to be a single stamp:
        /// whichever wrote last won, so closing a row dialog wrote "not busy" over a Sheet still
        /// holding unsaved fields, and until the Sheet's next minute-long renewal an automation fire
        /// could swap the profile out from under it.
        ///
        /// The last two joined for the gates that END the process. The Data table and the
        /// Automations panel keep their work in React state until their own Save, exactly like the
        /// Sheet, and neither the window's close guard nor the silent update after a run could see
        /// it: closing the app or restarting it for an update threw a half-edited table away
        /// without a word.
        /// </summary>
        private static readonly Dictionary<string, long> _editorClaims = new(StringComparer.Ordinal);
        private static readonly object _editorLock = new();

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

        /// <summary>
        /// An editor holds typed work not yet sent. Also read by the update gate, which exits the
        /// process just as surely as an automation writes over it.
        /// </summary>
        internal static bool EditorHoldsUnsavedWork() => HeldEditors().Count > 0;

        /// <summary>
        /// The owners whose claims are live now — for the close guard, which has to NAME what the
        /// user is about to lose, and for BlockedReason, which skips the owners a fire cannot hurt.
        /// </summary>
        internal static IReadOnlyList<string> HeldEditors()
        {
            List<string>? expired = null;
            List<string>? held = null;
            lock (_editorLock)
            {
                if (_editorClaims.Count == 0) return Array.Empty<string>();
                long now = DateTime.UtcNow.Ticks;
                foreach (var (owner, since) in _editorClaims)
                {
                    if (now - since < EditorClaimTtl.Ticks) (held ??= new()).Add(owner);
                    else (expired ??= new()).Add(owner);
                }
                // Cleared rather than just skipped, so the warning is written once instead of on
                // every fire attempt for the rest of the session.
                if (expired != null) foreach (var owner in expired) _editorClaims.Remove(owner);
            }
            if (expired != null)
                DiagnosticLog.Warn(
                    $"Editor's unsaved-work claim ({string.Join(", ", expired)}) expired after {EditorClaimTtl.TotalMinutes:0} min without release — " +
                    "automations are no longer held by it. The editor was most likely torn down by a UI reload.");
            return (IReadOnlyList<string>?)held ?? Array.Empty<string>();
        }

        /// <summary>Owners whose work an autonomous fire cannot reach — see BlockedReason.</summary>
        private static readonly HashSet<string> FireSafeEditors = new(StringComparer.Ordinal) { "automation-panel" };

        /// <summary>What the skip line says the user is doing, by the editor's claim.</summary>
        private static BlockKind EditorKind(string owner) => owner switch
        {
            "data-panel" => BlockKind.DataTable,
            "automation-panel" => BlockKind.Automation,
            "inspector" => BlockKind.Step,
            _ => BlockKind.Row,
        };

        /// <summary>
        /// The close guard's sentence: which editors hold changes that never reached the profile.
        /// One whole sentence for one editor, and for several a list with the verb agreeing — the first
        /// name in its sentence-start form, so nothing is capitalised by code.
        /// </summary>
        internal static string DescribeUnappliedEdits(IReadOnlyList<string> owners)
        {
            var editors = new List<(string Start, string Inside)>();
            foreach (var owner in owners)
            {
                var names = EditorNames(owner);
                if (!editors.Contains(names)) editors.Add(names);
            }
            if (editors.Count == 0) editors.Add(EditorNames(""));
            if (editors.Count == 1) return S.GuardsUnappliedSingle(editors[0].Start);
            return S.GuardsUnappliedSeveral(S.List(editors.Select((e, i) => i == 0 ? e.Start : e.Inside)));
        }

        /// <summary>An editor's name at the start of the sentence and inside the list.</summary>
        private static (string Start, string Inside) EditorNames(string owner) => owner switch
        {
            "sheet" => (S.GuardsUnappliedStartSheet, S.GuardsUnappliedInsideSheet),
            "row-dialog" => (S.GuardsUnappliedStartRowDialog, S.GuardsUnappliedInsideRowDialog),
            "insert-dialog" => (S.GuardsUnappliedStartInsertDialog, S.GuardsUnappliedInsideInsertDialog),
            "data-panel" => (S.GuardsUnappliedStartDataPanel, S.GuardsUnappliedInsideDataPanel),
            "automation-panel" => (S.GuardsUnappliedStartAutomationPanel, S.GuardsUnappliedInsideAutomationPanel),
            "inspector" => (S.GuardsUnappliedStartInspector, S.GuardsUnappliedInsideInspector),
            _ => (S.GuardsUnappliedStartUnknown, S.GuardsUnappliedInsideUnknown),
        };

        /// <summary>True while any editor holds a claim — for the bridge's transition log.</summary>
        public static bool AnyEditorClaim
        {
            get { lock (_editorLock) return _editorClaims.Count > 0; }
        }

        /// <summary>
        /// Called by the bridge when an editor (<paramref name="owner"/>) gains or loses pending
        /// edits. A renewal re-stamps the owner's claim.
        /// </summary>
        public static void SetEditorBusy(string owner, bool busy)
        {
            lock (_editorLock)
            {
                if (busy) _editorClaims[owner] = DateTime.UtcNow.Ticks;
                else _editorClaims.Remove(owner);
            }
        }

        /// <summary>
        /// Drops every claim — on <c>ui:ready</c>: a reload means the editors that claimed no
        /// longer exist, and their releases will never arrive.
        /// </summary>
        public static void ClearEditorClaims()
        {
            lock (_editorLock) _editorClaims.Clear();
        }
    }
}
