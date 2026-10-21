using Microsoft.UI.Dispatching;
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using TrueReplayer.Models;
using TrueReplayer.Interop;
using TrueReplayer.Services;


namespace TrueReplayer.Services
{
    public class RecordingService
    {
        private readonly ActionRecorder recorder;
        private readonly Func<bool> getMouse, getScroll, getKeyboard, getCombined;
        private readonly Action<DateTime> setLastActionTime;
        private readonly Action<string>? onStatusChanged;
        private readonly Action<string, bool>? onButtonStateChanged; // (text, isRecording)

        // Volatile: written on the UI thread, read by the input hooks on their own thread.
        public bool IsRecording { get => _isRecording; private set => _isRecording = value; }
        private volatile bool _isRecording;

        /// <summary>
        /// When the CURRENT recording session began, in UTC. DateTime.MaxValue while not recording,
        /// so a "was this row produced by this session?" test is false for everything by default.
        ///
        /// Exists because ActionItem.RecordedAt is [JsonIgnore]: it is stamped by the property
        /// initialiser at construction, and loading a profile constructs every row, so a freshly
        /// loaded profile carries a "just now" stamp on rows the user saved weeks ago. The browser
        /// dedup sweeps key on RecordedAt to find the native click rows that belong to the event
        /// they are handling — without this floor they matched SAVED rows and deleted the user's
        /// work at the first extension event of a new recording.
        /// </summary>
        public DateTime RecordingStartedUtc { get; private set; } = DateTime.MaxValue;

        // When the last recording session ended (UTC); MinValue before the first one. WebViewBridge
        // accepts the extension's final typingCaptured for a moment past it — see there.
        public DateTime RecordingEndedUtc { get; private set; } = DateTime.MinValue;

        public RecordingService(
            ActionRecorder recorder,
            Func<bool> getMouse,
            Func<bool> getScroll,
            Func<bool> getKeyboard,
            Func<bool> getCombined,
            Action<DateTime> setLastActionTime,
            Action<string>? onStatusChanged = null,
            Action<string, bool>? onButtonStateChanged = null)
        {
            this.recorder = recorder;
            this.getMouse = getMouse;
            this.getScroll = getScroll;
            this.getKeyboard = getKeyboard;
            this.getCombined = getCombined;
            this.setLastActionTime = setLastActionTime;
            this.onStatusChanged = onStatusChanged;
            this.onButtonStateChanged = onButtonStateChanged;
        }

        public void ToggleRecording()
        {
            if (IsRecording) StopRecording();
            else StartRecording();
        }

        private void StartRecording()
        {
            IsRecording = true;
            RecordingStartedUtc = DateTime.UtcNow;
            onButtonStateChanged?.Invoke("Pause", true);
            recorder.RecordMouse = getMouse();
            recorder.RecordScroll = getScroll();
            recorder.RecordKeyboard = getKeyboard();
            recorder.RecordCombined = getCombined();
            recorder.UseRelativeCoordinates = Models.UserProfile.Current.UseRelativeCoordinates;
            recorder.Start();
            setLastActionTime(DateTime.Now);
            onStatusChanged?.Invoke("recording");
            DiagnosticLog.Info(
                $"Recording start: mouse={recorder.RecordMouse}, scroll={recorder.RecordScroll}, " +
                $"keyboard={recorder.RecordKeyboard}, combined={recorder.RecordCombined}, " +
                $"relativeCoords={recorder.UseRelativeCoordinates}");
        }

        public void StopRecording()
        {
            if (!IsRecording) return;
            IsRecording = false;
            RecordingStartedUtc = DateTime.MaxValue;
            RecordingEndedUtc = DateTime.UtcNow;
            onButtonStateChanged?.Invoke("Recording", false);
            recorder.Stop();
            // captured=N, not a bare "stopped". A recording that appended NOTHING while keyboard
            // and mouse were both armed points at a hook that is no longer installed, and it is the
            // one question a session log could never answer after the fact — the old line was
            // identical whether the recorder saw 40 events or none.
            DiagnosticLog.Info($"Recording stopped: captured={recorder.CapturedThisSession}");
            // Clear the <select>-interaction suppression flag in case the user hit Stop
            // mid-interaction. Without this the flag would persist up to 15 s before the
            // safety timer cleared it — and any clicks recorded in the next session
            // (or via a different code path) would be silently dropped.
            InputHookManager.SuppressMouseRecording = false;
            onStatusChanged?.Invoke("ready");
        }
    }

    public class ReplayService
    {
        private readonly ObservableCollection<ActionItem> actions;
        private readonly ActionReplayer replayer;

        /// <summary>Last run's per-step diagnostics — see ActionReplayer.RunStepRecord.</summary>
        public (List<ActionReplayer.RunStepRecord> Steps, int Overflow, DateTime StartedAt, long ElapsedMs) GetRunReport()
            => replayer.GetRunReport();

        /// <summary>
        /// Which run the current report belongs to. Bumped once per replay, when the report opens.
        /// The bridge reads it to tell "a new run finished" from "the same report came around
        /// again" — a Clicker session or a manual Refresh re-pushes the last macro's report, and
        /// without this the verdict attached to it was recomputed from whatever had just happened.
        /// Not used by ActionExecution itself.
        /// </summary>
        public int RunSequence => replayer.RunSequence;
        private readonly DispatcherQueue dispatcherQueue;
        private readonly Action updateButtonStates;
        private readonly Action<string>? onStatusChanged;
        private readonly Action<string, bool>? onButtonStateChanged; // (text, isReplaying)
        private readonly Action<int>? onActionHighlight; // highlight action at index

        // action → grid row index, for the highlight callback. Invalidated (not patched) on any
        // structural change to `actions`; rebuilt on the next highlight. Only ever touched on the
        // UI thread: CollectionChanged fires there and the read lives inside a TryEnqueue.
        private Dictionary<object, int>? _rowIndexCache;

        // Keyed by object with ReferenceEqualityComparer rather than by ActionItem with the default
        // comparer: both behave identically today (ActionItem overrides neither Equals nor
        // GetHashCode, so the default comparer IS identity — which is what actions.IndexOf used),
        // but this way the identity semantics the highlight depends on cannot be changed out from
        // under it by a later Equals override on the model.
        private Dictionary<object, int> BuildRowIndexCache()
        {
            var map = new Dictionary<object, int>(actions.Count, ReferenceEqualityComparer.Instance);
            for (int i = 0; i < actions.Count; i++)
                map[actions[i]] = i;
            return map;
        }

        // Volatile: written on the UI thread, read by the input hooks on their own thread.
        public bool IsReplaying { get => _isReplaying; private set => _isReplaying = value; }
        private volatile bool _isReplaying;

        public ReplayService(
            ObservableCollection<ActionItem> actions,
            DispatcherQueue dispatcherQueue,
            Action updateButtonStates,
            Action<string>? onStatusChanged = null,
            Action<string, bool>? onButtonStateChanged = null,
            Action<int>? onActionHighlight = null,
            BrowserBridgeService? browserBridge = null)
        {
            this.actions = actions;
            this.replayer = new ActionReplayer(actions, dispatcherQueue, browserBridge);
            this.dispatcherQueue = dispatcherQueue;
            this.updateButtonStates = updateButtonStates;
            this.onStatusChanged = onStatusChanged;
            this.onButtonStateChanged = onButtonStateChanged;
            this.onActionHighlight = onActionHighlight;

            // Any structural change drops the row lookup below. Fires on the same (UI) thread the
            // lookup is read from, and it is exactly when the row numbers move anyway.
            actions.CollectionChanged += (_, _) => _rowIndexCache = null;

            replayer.OnActionExecuting += (action) =>
            {
                dispatcherQueue.TryEnqueue(() =>
                {
                    // O(1) instead of the O(n) reference scan actions.IndexOf did — this runs for
                    // EVERY executed action, on the UI thread, which also owns the WebView, so a
                    // long macro on loop was spending millions of comparisons there.
                    // "Not in the grid" is load-bearing and preserved: RunProfile executes rows from
                    // a sub-profile that are absent from `actions`, and the miss is what suppresses
                    // their highlight. ActionItem declares no Equals override, so a reference-keyed
                    // dictionary matches what EqualityComparer<ActionItem>.Default was doing.
                    var map = _rowIndexCache ??= BuildRowIndexCache();
                    if (map.TryGetValue(action, out int index))
                        onActionHighlight?.Invoke(index);
                });
            };

            replayer.OnReplayPaused += (hotkey, timeoutMs) =>
            {
                OnReplayPaused?.Invoke(hotkey, timeoutMs);
            };
            // Forward structural-error messages (e.g. missing target window) to the host's
            // status pipeline. The "error:" prefix gets stripped by PushStatusChange and
            // displayed as an alert toast. Marshalled to the UI thread because the
            // callback fires from background task contexts (ExecuteWaitImage,
            // ExecuteWaitPixelColor) — onStatusChanged downstream updates UI state, so
            // invoking it from the task pool would race the dispatcher. Mirrors the
            // continuation pattern at the bottom of StartReplay (lines 203-213).
            replayer.OnReplayError = msg => dispatcherQueue.TryEnqueue(
                () => onStatusChanged?.Invoke($"error:{msg}"));
            // Data-list lap notice — same dispatcher marshalling as OnReplayError (it fires
            // from the replay task), but its own channel so the host can present it as
            // information rather than an error.
            replayer.OnDataLapCompleted = rows => dispatcherQueue.TryEnqueue(
                () => OnDataLapCompleted?.Invoke(rows));
            // Same marshalling, same reason for having its own channel as the lap notice.
            replayer.OnRunSummary = text => dispatcherQueue.TryEnqueue(
                () => OnRunSummary?.Invoke(text));
            replayer.OnRowCursorChanged = row => dispatcherQueue.TryEnqueue(
                () => OnRowCursorChanged?.Invoke(row));
            // Same marshalling and the same reasoning as the lap notice above: raised from the
            // replay task, presented as information.
            replayer.OnBrowserExtensionMissing = rows => dispatcherQueue.TryEnqueue(
                () => OnBrowserExtensionMissing?.Invoke(rows));
            replayer.OnReplayResumed += () =>
            {
                OnReplayResumed?.Invoke();
            };
            replayer.OnInputRequested += (id, label, menu) => OnInputRequested?.Invoke(id, label, menu);
            replayer.OnInputDismissed += id => OnInputDismissed?.Invoke(id);
            replayer.OnVariablesChanged += (vars, slots, row) => OnVariablesChanged?.Invoke(vars, slots, row);
            // Loop counter — defined on the inner replayer (it's the one running the loop),
            // re-exposed here so MainWindow can wire the bridge callback alongside the other
            // ReplayService events. Same pass-through pattern as OnReplayPaused/Resumed above.
            replayer.OnLoopProgress = (current, total) =>
            {
                OnLoopProgress?.Invoke(current, total);
            };
            // Chain step counter — same pass-through as the loop counter directly above; the
            // inner replayer is the one that knows both the call stack and the row position.
            replayer.OnChainStep = (current, total) =>
            {
                OnChainStep?.Invoke(current, total);
            };
        }

        // Re-exposed events from the inner replayer so MainWindow/WebViewBridge can wire UI feedback.
        public event Action<string, int>? OnReplayPaused;
        public event Action? OnReplayResumed;
        // {input:Label} Ask-Input modal: request a value from the host, and dismiss a stale prompt.
        public event Action<string, string, string[]?>? OnInputRequested;   // (requestId, label, menu?)
        public event Action<string>? OnInputDismissed;                       // (requestId)
        // Live-variables pane feed: (variables, clip slots, current data row or null).
        public event Action<Dictionary<string, string>, Dictionary<string, string>, Dictionary<string, string>?>? OnVariablesChanged;

        // Live pane opened / re-subscribed — push the current snapshot on demand.
        public void RequestVariablesSnapshot() => replayer.PushVariablesSnapshot(force: true);

        // Global capture hotkey: capture the current selection into the next sequential slot.
        public Task<(string Slot, string? Value)> CaptureSelectionToNextSlotAsync()
            => replayer.CaptureSelectionToNextSlotAsync();

        // Host → replay: the Ask-Input modal was submitted (cancelled=false) or cancelled.
        public void CompleteInput(string requestId, string? value, bool cancelled)
            => replayer.CompleteInput(requestId, value, cancelled);

        // Manual resume from a UI button (status-bar Resume, or the Clicker dashboard).
        // Resumes whichever is paused: a Clicker run (no-op if not paused) and/or a macro
        // Pause action (TriggerReplayPauseListener is a no-op when no listener is registered).
        public void ManualResume()
        {
            ResumeClicker();
            InputHookManager.TriggerReplayPauseListener();
        }

        // ── Clicker pause/resume ──────────────────────────────────────────────
        // The click loop (ToggleCursorClickReplay) awaits _clickerResumeTcs while paused and
        // reuses the existing OnReplayPaused/OnReplayResumed events (already bridged) so the
        // dashboard's pause overlay works. Pause is triggered from the dashboard Pause button
        // (clicker:pause); resume from the overlay's Resume button (replay:resume → ManualResume).
        private volatile bool _clickerLoopActive;
        private volatile bool _clickerPaused;
        private TaskCompletionSource<bool>? _clickerResumeTcs;

        public void PauseClicker()
        {
            if (!_clickerLoopActive || _clickerPaused) return;
            _clickerResumeTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            _clickerPaused = true;
            dispatcherQueue.TryEnqueue(() => OnReplayPaused?.Invoke("", 0));
        }

        public void ResumeClicker()
        {
            if (!_clickerPaused) return;
            _clickerPaused = false;
            _clickerResumeTcs?.TrySetResult(true);
            dispatcherQueue.TryEnqueue(() => OnReplayResumed?.Invoke());
        }

        // Pause hotkey — toggles pause/resume on a running clicker (no-op if not running).
        public void TogglePauseClicker()
        {
            if (!_clickerLoopActive) return;
            if (_clickerPaused) ResumeClicker();
            else PauseClicker();
        }

        public void SetProfileNameProvider(Func<string> getProfileName)
        {
            replayer.SetProfileNameProvider(getProfileName);
        }

        // Reset a SetVariable cycle row to its first item (see ActionReplayer.ResetCycleCursor).
        public void ResetCycleCursor(string actionId)
        {
            replayer.ResetCycleCursor(actionId);
        }

        // Reset the data-loop row cursor to the first row (see ActionReplayer.ResetRowCursor).
        public void ResetRowCursor()
        {
            replayer.ResetRowCursor();
        }

        // Where the cursor stands / park it on a row — see ActionReplayer for both.
        public int GetRowCursor() => replayer.GetRowCursor();

        public void SetRowCursor(int rowIndex) => replayer.SetRowCursor(rowIndex);

        public void SetProfileLookup(Func<string, Task<Models.UserProfile?>> lookup)
        {
            replayer.SetProfileLookup(lookup);
        }

        public void SetFolderInheritedContextLookup(Func<string, Controllers.ProfileController.FolderInheritedContext?> lookup)
        {
            replayer.SetFolderInheritedContextLookup(lookup);
        }

        public void SetChainChangedCallback(Action<List<string>> callback)
        {
            replayer.SetChainChangedCallback(callback);
        }

        // gameMode: the profile's own Game Mode (WebViewBridge.ResolveGameMode), null = follows the
        // app-wide switch. REQUIRED, not defaulted like its neighbours, so that every entry point
        // has to answer it — a defaulted null would let a new caller run every profile on the
        // global value without anything noticing.
        // restoreCursor: the profile's own cursor return (WebViewBridge.ResolveRestoreCursor), null =
        // follows the app default. REQUIRED for the same reason as gameMode.
        public void ToggleReplay(bool loopEnabled, string loopCountText, bool intervalEnabled, string intervalText, bool? gameMode, bool? restoreCursor, bool useDelayVariation = false, int delayVariationPercent = 20, bool useRelativeCoords = false, Models.WindowTarget? windowTarget = null, bool bringToFocus = false, int lockWidth = 0, int lockHeight = 0, int lockX = 0, int lockY = 0, bool restorePosition = false, bool restoreSize = false, bool forceInfiniteLoop = false)
        {
            if (!IsReplaying && actions.Count > 0)
                StartReplay(loopEnabled, loopCountText, intervalEnabled, intervalText, gameMode, restoreCursor, useDelayVariation, delayVariationPercent, useRelativeCoords, windowTarget, bringToFocus, lockWidth, lockHeight, lockX, lockY, restorePosition, restoreSize, forceInfiniteLoop);
            else if (IsReplaying)
                StopReplay();
        }

        private void StartReplay(bool loopEnabled, string loopCountText, bool intervalEnabled, string intervalText, bool? gameMode, bool? restoreCursor, bool useDelayVariation, int delayVariationPercent, bool useRelativeCoords, Models.WindowTarget? windowTarget, bool bringToFocus, int lockWidth, int lockHeight, int lockX, int lockY, bool restorePosition, bool restoreSize, bool forceInfiniteLoop)
        {
            // Data-loop (Model A): the active profile's table. Read BEFORE flipping IsReplaying
            // so the empty-table guard can bail cleanly without a state to unwind. Data is
            // per-profile only (no folder inheritance), so UserProfile.Current is the source.
            var dataTable = Models.UserProfile.Current?.Data;
            bool loopOverData = dataTable != null && dataTable.LoopOverData;
            if (loopOverData && (dataTable!.Rows?.Count ?? 0) == 0)
            {
                // Empty table + loop-over-data would set loopCount=0 → the loop reads that as
                // INFINITE. Refuse with a friendly message instead of spinning forever.
                // Null-safe: a hand-edited/corrupt profile can carry {"rows":null}, and this guard
                // runs BEFORE SetDataTable normalizes Rows — treat null as empty, not a crash.
                DiagnosticLog.Warn("Replay refused: 'loop over data' is on but the data table has no rows.");
                onStatusChanged?.Invoke("error:The data table has no rows — add data or turn off \"loop over data\".");
                return;
            }

            IsReplaying = true;
            _userStopped = false;
            onButtonStateChanged?.Invoke("Stop", true);

            int loopCount = loopEnabled && int.TryParse(loopCountText, out int count) && count >= 0 ? count : 1;
            int loopInterval = intervalEnabled && int.TryParse(intervalText, out int interval) && interval >= 0 ? interval : 0;
            // Loop-over-data OVERRIDES the normal loop count: one iteration per data row.
            // It also wins over forceInfiniteLoop (WhilePressed/Toggle hotkeys) — the feature's
            // contract is "run once per row", so a bounded run must not become infinite (which
            // would also stamp empty {row:col} for every iteration past the last row).
            if (loopOverData)
            {
                loopCount = dataTable!.Rows?.Count ?? 0;
                forceInfiniteLoop = false;
            }
            replayer.SetDataTable(dataTable, loopOverData);
            replayer.SetLoopOptions(loopCount, loopInterval);
            replayer.SetDelayVariation(useDelayVariation, delayVariationPercent);
            replayer.SetRelativeCoordinates(useRelativeCoords, windowTarget, lockWidth, lockHeight, lockX, lockY, restorePosition, restoreSize);
            replayer.SetBringToFocus(bringToFocus);
            replayer.SetForceInfiniteLoop(forceInfiniteLoop);
            replayer.SetGameMode(gameMode);
            replayer.SetRestoreCursor(restoreCursor);

            // Start banner — the single highest-value diagnostic line: records action count,
            // loop config, the resolved window target, relative-coords, and the movement strategy
            // (smooth/path vs jump — the Roblox-class issue). Without this no replay leaves any
            // trace of having run or with what settings.
            DiagnosticLog.Info(
                $"Replay start: actions={actions.Count}, " +
                $"loop={(loopCount == 0 ? "infinite" : loopCount.ToString())}, interval={loopInterval}ms, " +
                $"relativeCoords={useRelativeCoords}, " +
                $"target=[{(windowTarget == null ? "none" : $"{windowTarget.ProcessName} {windowTarget.WindowTitle}".Trim())}], " +
                $"bringToFocus={bringToFocus}, forceInfinite={forceInfiniteLoop}, " +
                // Effective value AND where it came from: "my Roblox macro didn't walk" is
                // answered by this field, and "default" vs "profile" is half of that answer.
                $"gameMode={gameMode ?? ActionReplayer.SmoothMovement} ({(gameMode.HasValue ? "profile" : "default")}) (step {ActionReplayer.MoveStepPx}px/{ActionReplayer.MoveStepDelayMs}ms, clickGap {ActionReplayer.MoveClickDelayMs}ms), " +
                $"fastApproach={ActionReplayer.FastApproach} (settle {ActionReplayer.SettleDistancePx}px), " +
                // Effective at start; a profile that follows re-reads the default at the end.
                $"restoreCursor={restoreCursor ?? ActionReplayer.RestoreCursorDefault} ({(restoreCursor.HasValue ? "profile" : "default")})");

            onStatusChanged?.Invoke("replaying");

            _ = replayer.StartAsync().ContinueWith(t =>
            {
                dispatcherQueue.TryEnqueue(() =>
                {
                    // Error status is pushed BEFORE ResetReplayState — the bridge's
                    // run-end notifier keys on status transitions, and the old order
                    // (reset first) made a faulted run fire the SUCCESS cue off the
                    // replaying→ready edge and then the error cue right behind it.
                    // Error-first notifies exactly once, with the error sound.
                    if (t.Exception?.InnerException is TimeoutException tex)
                        onStatusChanged?.Invoke($"error:{tex.Message}");
                    else if (t.Exception?.InnerException != null)
                    {
                        // Capture the type + stack — the user only sees the message in the status bar.
                        DiagnosticLog.Error("Replay run faulted", t.Exception.InnerException);
                        onStatusChanged?.Invoke($"error:{t.Exception.InnerException.Message}");
                    }
                    else
                    {
                        DiagnosticLog.Info("Replay finished");
                    }
                    ResetReplayState();
                });
            });
        }

        // True while the CURRENT run is ending because the user asked it to (Stop
        // hotkey, WhilePressed release, clicker toggle-off). ResetReplayState turns
        // it into the "ready:stopped" status so the bridge's run-end notifier stays
        // silent — a deliberate stop is not "something finished in the background",
        // and WhilePressed would otherwise flash the taskbar on EVERY key release.
        private volatile bool _userStopped;

        private void StopReplay()
        {
            _userStopped = true;
            // Cancel BEFORE replayer.Stop(). Stop() runs ResetMouseState, and now that the
            // clicker records its presses in the SAME _simLeftDown/_simRightDown/_simMiddleDown
            // state, releasing while the click loop is still live could be followed immediately
            // by a fresh DOWN from the next tick — re-sticking the button we just released.
            // Cancelling first closes that window; the loop's own finally is the backstop for
            // the sub-millisecond remainder.
            // ObjectDisposedException: the loop's finally disposes the CTS, so a Stop racing a
            // run that just ended can find it gone. The intent ("stop whatever is running") is
            // satisfied either way — same swallow as ActionReplayer.Stop.
            try { _cursorClickCts?.Cancel(); } catch (ObjectDisposedException) { /* already gone */ }
            replayer.Stop();
        }

        /// <summary>
        /// Stop replay if currently running. No-op if idle. Used by the WhilePressed trigger mode
        /// release handler, where calling ToggleReplay could otherwise start a new replay if the
        /// previous one had already completed naturally before the key was released.
        /// </summary>
        public void StopIfRunning()
        {
            if (IsReplaying) StopReplay();
        }

        private CancellationTokenSource? _cursorClickCts;

        // Bridge callback for click counter / CPS / elapsed updates. Set by MainWindow on init.
        // Throttled to ~4 Hz inside the loop so the WebView2 message channel isn't flooded
        // (a 100 Hz clicker would otherwise spam 100 messages/s). capMs is the run's duration
        // limit (0 = none) so the dashboard can show time-to-finish and progress for the Time
        // limit from the RUN's own snapshot, not from settings the user may edit mid-run.
        public Action<long, long, long>? OnClickerStats; // (count, elapsedMs, capMs)

        // Countdown before the first click — only when the run was started from the button in a
        // cursor-relative mode (see ClickerRunConfig.StartDelayMs). Fires with the whole ms
        // remaining at each second boundary, then with 0 the moment clicking begins.
        public Action<long>? OnClickerCountdown;

        // End of a Clicker run: why it ended ("stopped" | "clicks" | "time") and how many
        // SendInput calls were rejected outright. Fires once, in the final flush, before
        // ResetReplayState — the dashboard used to say "finished" for a cancelled run too.
        public Action<string, long>? OnClickerEnded;

        // Live warning about the target: "elevatedTarget" when the root window under the cursor
        // runs elevated and this process does not (UIPI drops every click while SendInput says
        // yes — see ProcessIntegrity), null when the cursor is back over a normal window.
        public Action<string?>? OnClickerWarning;

        // Macro loop counter — re-exposed from the inner ActionReplayer. Fired only for
        // genuine loops (LoopCount > 1 or infinite); single-shot replays never trigger it.
        // total == 0 signals infinite loop. Frontend renders "Loop X/Y" or "Loop X/∞".
        public Action<int, int>? OnLoopProgress;

        // Chain step counter — re-exposed from the inner ActionReplayer. Fires only while a
        // RunProfile sub-call is on the stack, so an unchained run never triggers it and the
        // status bar's chain read-out stays hidden exactly as before. (current, total) is the
        // sub-profile's row position, throttled to ~4 Hz at the source.
        public Action<int, int>? OnChainStep;

        // Data-list lap notice — re-exposed from the inner ActionReplayer. Fires only in
        // cursor mode (data table present, "loop over data" OFF) when a run consumes the
        // last row. Arg = the table's row count.
        public Action<int>? OnDataLapCompleted;

        // End-of-run tally ("N row(s) skipped after errors") — re-exposed from the inner
        // ActionReplayer. Information, not an error: it must NOT reach onStatusChanged with the
        // "error:" prefix, which is what stamped a finished batch as outcome="failed".
        public Action<string>? OnRunSummary;

        // Row-cursor movement — re-exposed from the inner ActionReplayer, marshalled to the UI
        // thread by the forwarder in the constructor. Fires once per cursor-mode run, at the top,
        // where the advance happens. Arg = the 0-based row the NEXT run will consume.
        public Action<int>? OnRowCursorChanged;

        // Replay pre-flight — re-exposed from the inner ActionReplayer. Fires at kickoff when
        // the run has rows that need the Chrome extension and the bridge is down. Arg = how
        // many. Every replay entry point (button, hotkey, automation, RunProfile chain) funnels
        // through StartAsync, which is why the check lives there and not on the button.
        public Action<int>? OnBrowserExtensionMissing;

        // Clicker scheduling bounds. MinClickPeriodMs is the floor the engine will honour;
        // anything below it is unreachable anyway (Task.Delay quantises to the system timer
        // period, which we raise to 1 ms for fast runs — see TimeBeginPeriod in the loop).
        private const int MinClickPeriodMs = 5;
        private const int MaxClickPeriodMs = 60000;
        // Slack when deciding whether the cursor moved because the USER moved it, versus because
        // our own click moved it. Our emitted position round-trips through the lossy 0-65535
        // normalisation, so the physical pixel can land ~1 px off what we asked for.
        private const int AnchorTolerancePx = 2;

        public void ToggleCursorClickReplay(ClickerRunConfig config)
        {
            if (IsReplaying)
            {
                // Stop whatever's running — could be either a regular replay (started by a profile
                // hotkey before the user switched to Clicker mode) or our own click loop. StopReplay
                // cancels both, so the Replay hotkey reliably acts as "stop" regardless of source.
                StopReplay();
                return;
            }

            // ── Resolve and CLAMP the run config once, up front ──────────────────────────────
            // Clamping here rather than deep inside the loop means the start banner reports what
            // will actually run, and it is the engine's own guarantee: appsettings.json is
            // hand-editable and never passes through the settings:change handler, so nothing
            // upstream can be assumed to have validated these.
            int basePeriod = Math.Clamp(config.DelayMs, MinClickPeriodMs, MaxClickPeriodMs);
            int safeHold = Math.Clamp(config.HoldMs, 0, 2000);
            // 0..100 mirrors the identical jitter formula on the macro repeat path. Unclamped,
            // basePeriod * jitterPercent overflows int and yields a NEGATIVE variation, which
            // makes Random.Shared.Next(min > max) throw.
            int jitterPercent = Math.Clamp(config.JitterPercent, 0, 100);
            int jitterRadius = Math.Clamp(config.PositionJitter, 0, 500);
            int loopInterval = Math.Clamp(config.LoopIntervalMs, 0, MaxClickPeriodMs);
            int loopCount = Math.Max(0, config.LoopCount);
            // 0 = no cap. Independent of loopCount: either, both or neither may bound the run,
            // and whichever is reached first ends it.
            long maxDurationMs = Math.Max(0, config.MaxDurationMs);
            bool gameMove = config.GameMove;
            bool useJitter = config.UseJitter;
            string button = config.Button;
            // Button-start countdown (see ClickerRunConfig.StartDelayMs). 10 s ceiling: past that
            // a typo would read as "the clicker does nothing".
            int startDelayMs = Math.Clamp(config.StartDelayMs, 0, 10000);

            // Decompose the optional Area record into the booleans + 4 ints the engine expects.
            bool useArea = config.Area is not null;
            int areaX = config.Area?.X ?? 0;
            int areaY = config.Area?.Y ?? 0;
            int areaW = config.Area?.W ?? 0;
            int areaH = config.Area?.H ?? 0;
            // Fixed-point mode. A picked point clicks exactly there every tick; a null point
            // with UseFixed on = "lock on start" — capture the cursor on the first click and
            // reuse it. fixedCaptured is pre-set when a point was picked so the loop skips the
            // one-time GetCursorPos. No position jitter is applied in fixed mode (exact point).
            bool useFixed = config.UseFixed;
            int fixedX = config.FixedPoint?.X ?? 0;
            int fixedY = config.FixedPoint?.Y ?? 0;
            bool fixedCaptured = config.FixedPoint is not null;

            IsReplaying = true;
            _userStopped = false;
            _clickerLoopActive = true;
            _clickerPaused = false;
            _clickerResumeTcs = null;
            onButtonStateChanged?.Invoke("Stop", true);
            onStatusChanged?.Invoke("replaying");

            // Start banner — records the RESOLVED (post-clamp) run config so "clicker does
            // nothing / wrong rate / wrong place" is diagnosable from the session log alone.
            // "where" is spelled out because that is the whole point of the banner and Fixed
            // mode used to be missing from it entirely.
            // (Smooth-movement does NOT apply here — the loop clicks via SendInput directly,
            // not the macro mouse path.)
            string whereDesc = useArea ? $"area {areaW}x{areaH}@{areaX},{areaY}"
                : useFixed ? (fixedCaptured ? $"fixed {fixedX},{fixedY}" : "fixed (lock on start)")
                : jitterRadius > 0 ? $"cursor ±{jitterRadius}px" : "cursor";
            // The period is the whole cycle: hold and interval live INSIDE it, so this rate is
            // what the user actually gets. A hold at or above the period is the one case the
            // schedule cannot honour, so say so rather than drifting silently.
            int nominalPeriod = basePeriod + loopInterval;
            string rateNote = safeHold >= nominalPeriod
                ? $" (hold {safeHold}ms >= period {nominalPeriod}ms — rate limited to ~{1000.0 / Math.Max(1, safeHold + 1):0.#}/s)"
                : "";
            DiagnosticLog.Info(
                $"Clicker start: button={button}, period={nominalPeriod}ms (~{1000.0 / Math.Max(1, nominalPeriod):0.#}/s){rateNote}, " +
                $"loops={(loopCount == 0 ? "unbounded" : loopCount.ToString())}, interval={loopInterval}ms, " +
                $"maxDuration={(maxDurationMs == 0 ? "unbounded" : maxDurationMs + "ms")}, " +
                $"hold={safeHold}ms, jitter={(useJitter ? jitterPercent + "%" : "off")}, " +
                $"gameMove={(gameMove ? "on" : "off")}, where={whereDesc}");
            // Game-aware movement spends real time INSIDE the tick, and only Area moves on every
            // one. Estimate that cost and say when it will not fit the period, rather than
            // letting the run drift and calling the schedule a liar — the B3 mistake, one layer
            // down. FastApproach caps the walked stretch at SettleDistancePx whatever the
            // distance, so the estimate is bounded by the settle ring, not by the rect size.
            // No SmoothMovement gate: the Clicker's Game move forces the walk regardless of the
            // macro master, so the cost applies whenever this switch is on in Area mode.
            if (gameMove && useArea)
            {
                int stepPx = ActionReplayer.MoveStepPx > 0
                    ? ActionReplayer.MoveStepPx
                    : ActionReplayer.DefaultMoveStepPx;
                int walkPx = ActionReplayer.FastApproach && ActionReplayer.SettleDistancePx > 0
                    ? ActionReplayer.SettleDistancePx
                    : Math.Max(areaW, areaH);
                int steps = Math.Max(1, (int)Math.Ceiling((double)walkPx / stepPx));
                int moveCostMs = (steps - 1) * ActionReplayer.MoveStepDelayMs;
                // Reports the ADDED cost, not a resulting rate. Measured 2026-08-08 in Area at a
                // 10 ms period: this estimate said 6 ms and the observed per-tick difference was
                // 6.2 ms — the delta is sound. The absolute ceiling is not: it can only count the
                // walk's own sleeps, and the run also pays syscall + low-level-hook overhead that
                // varies by machine and load (measured ~7 ms, which turned a predicted 62/s into
                // an actual 43/s). Stating a ceiling this cannot compute would be the same lie
                // the rate itself used to tell. The dashboard's measured Rate is the ground truth.
                if (moveCostMs + safeHold >= nominalPeriod)
                    DiagnosticLog.Info(
                        $"Clicker: gameMove adds ~{moveCostMs}ms/tick of cursor travel; with the {safeHold}ms hold " +
                        $"that already exceeds the {nominalPeriod}ms period, so the run will be slower than configured.");
            }
            if (loopCount == 0 && maxDurationMs == 0)
                DiagnosticLog.Info("Clicker: unbounded run — stop with the Clicker hotkey, the Stop button or the tray.");
            if (startDelayMs > 200)
                DiagnosticLog.Info($"Clicker: {startDelayMs} ms countdown before the first click (started from the button in a cursor-relative mode).");

            // Dispose the previous run's source before replacing it. StopReplay swallows the
            // ObjectDisposedException this can produce if it races a run that just ended.
            _cursorClickCts?.Dispose();
            _cursorClickCts = new CancellationTokenSource();
            var token = _cursorClickCts.Token;

            // Task.Run, not Task.Factory.StartNew(..., LongRunning, ...): LongRunning spawns a
            // dedicated non-pool thread that exits at the first await (200 ms in), so every
            // continuation ran on the pool anyway — the thread was created and thrown away.
            // The OnlyOnFaulted continuation is what makes a non-cancellation fault visible:
            // previously the unwrapped task was discarded and only the process-wide
            // UnobservedTaskException handler saw it, whenever the GC got round to it, with no
            // hint that the clicker was involved.
            var clickerTask = Task.Run(async () =>
            {
                long clickCount = 0;
                long blockedCount = 0;
                // Monotonic clock. DateTime.UtcNow is not monotonic — an NTP step correction
                // mid-run would corrupt elapsed/CPS — and the project already committed to
                // tick-based timing elsewhere for exactly this reason.
                var sw = System.Diagnostics.Stopwatch.StartNew();
                long pausedAccumMs = 0;
                long lastStatsPushMs = 0;
                // Read by the finally block for the final loop-progress flush.
                int iteration = 0;
                bool isInfinite = loopCount == 0;
                bool raisedTimerRes = false;
                string endReason = "cancelled";
                try
                {
                    // Wait for hotkey release — or, when the run was started from the BUTTON in a
                    // cursor-relative mode, count down so the user can move the mouse off the
                    // button that has just turned into "Stop": the first tick would otherwise
                    // click it and end the run after a single click (200 ms is not enough to
                    // move away). Whole seconds go to the dashboard; ClickerWaitAsync keeps Stop
                    // and Pause responsive throughout, and the hotkey paths (StartDelayMs = 0)
                    // keep the plain grace.
                    if (startDelayMs > 200)
                    {
                        long remaining = startDelayMs;
                        while (remaining > 0)
                        {
                            var snapshotRemaining = remaining;
                            dispatcherQueue.TryEnqueue(() => OnClickerCountdown?.Invoke(snapshotRemaining));
                            long slice = remaining % 1000 == 0 ? 1000 : remaining % 1000;
                            await ClickerWaitAsync(slice, sw, token);
                            remaining -= slice;
                        }
                        dispatcherQueue.TryEnqueue(() => OnClickerCountdown?.Invoke(0));
                    }
                    else
                    {
                        await Task.Delay(200, token);
                    }
                    sw.Restart();  // reset after the grace/countdown so CPS isn't skewed

                    // Ask for a 1 ms system timer while a fast run is live. Task.Delay quantises
                    // to the timer period (~15.6 ms by default), so without this a configured
                    // 10 ms period silently becomes ~15.6 ms. Skipped for slow runs so an idle
                    // 1-click-per-second job doesn't hold the whole system at high resolution.
                    // Released in the finally — the setting is process-wide and sticky.
                    // Gated on the SHORTEST period the run can produce, not the nominal one: with
                    // rate jitter a 40 ms nominal at ±50 % dips to 20 ms, and those ticks would
                    // quantise to 15.6 ms with the resolution left alone.
                    int shortestPeriod = (useJitter && jitterPercent > 0
                        ? Math.Max(MinClickPeriodMs, basePeriod - basePeriod * jitterPercent / 100)
                        : basePeriod) + loopInterval;
                    if (shortestPeriod < 30)
                    {
                        NativeMethods.TimeBeginPeriod(1);
                        raisedTimerRes = true;
                    }

                    // Resolve button flags
                    uint downFlag = button switch
                    {
                        "Right" => NativeMethods.MOUSEEVENTF_RIGHTDOWN,
                        "Middle" => NativeMethods.MOUSEEVENTF_MIDDLEDOWN,
                        _ => NativeMethods.MOUSEEVENTF_LEFTDOWN,
                    };
                    uint upFlag = button switch
                    {
                        "Right" => NativeMethods.MOUSEEVENTF_RIGHTUP,
                        "Middle" => NativeMethods.MOUSEEVENTF_MIDDLEUP,
                        _ => NativeMethods.MOUSEEVENTF_LEFTUP,
                    };

                    // Area mode: each click picks a uniformly-random pixel inside (x,y,w,h).
                    // Requires positive dimensions — defensive against stale/empty state.
                    bool areaActive = useArea && areaW > 0 && areaH > 0;

                    // Anchor for position jitter — see the re-detect comment in the loop.
                    int anchorX = 0, anchorY = 0;
                    bool anchorSet = false;

                    // Schedule against a monotonic deadline rather than chaining sleeps. Chaining
                    // makes the real cycle hold + delay + interval + syscall cost, which is why
                    // the UI's 1000/delay never matched reality; and it accumulates drift.
                    long nextTickMs = 0;
                    bool durationCapped = false;

                    // Elevated-target probe. Runs at the stats cadence (4 Hz), and the token is
                    // only queried when the ROOT window under the cursor changes: WindowFromPoint
                    // is cheap, OpenProcess/OpenProcessToken are not. Skipped entirely when we run
                    // elevated ourselves — UIPI never blocks a high-integrity sender.
                    bool probeElevation = !ProcessIntegrity.SelfElevated;
                    IntPtr lastRootHwnd = IntPtr.Zero;
                    bool reportedElevated = false;
                    // The probe keeps its own clock so it can fire on the FIRST tick and then
                    // settle into the stats cadence. Sharing the stats gate meant a run whose
                    // clicks all fit inside 250 ms — Loops = 1, or ten clicks at 100/s — never
                    // probed at all: every click was dropped by UIPI, the counter filled up, and
                    // nothing on screen said why.
                    bool probedOnce = false;
                    long lastProbeMs = 0;

                    while (!token.IsCancellationRequested && (isInfinite || iteration < loopCount))
                    {
                        // Duration cap, checked before committing to another click. The elapsed
                        // it compares against EXCLUDES paused time (pausedAccumMs), so "stop
                        // after 5 minutes" means five minutes of clicking, not five minutes of
                        // wall clock with a pause in the middle.
                        if (maxDurationMs > 0 && (sw.ElapsedMilliseconds - pausedAccumMs) >= maxDurationMs)
                        {
                            durationCapped = true;
                            break;
                        }

                        // Pause can also land mid-wait; this catches a pause that arrived exactly
                        // between the wait returning and the next tick.
                        if (_clickerPaused)
                        {
                            long pauseBegan = sw.ElapsedMilliseconds;
                            await AwaitClickerResumeAsync(token);
                            long pausedFor = sw.ElapsedMilliseconds - pauseBegan;
                            pausedAccumMs += pausedFor;
                            nextTickMs += pausedFor;
                        }
                        iteration++;

                        int targetX, targetY;
                        if (areaActive)
                        {
                            // Sample inclusive on both axes (Next's upper bound is exclusive, so
                            // we pass areaW directly to get [0, areaW-1], which when added to
                            // areaX covers [areaX, areaX+areaW-1] — the full rect interior.
                            targetX = areaX + Random.Shared.Next(0, areaW);
                            targetY = areaY + Random.Shared.Next(0, areaH);
                        }
                        else if (useFixed)
                        {
                            // Lock on start: capture the cursor at the FIRST click, reuse it for
                            // the whole run. A picked point pre-sets fixedCaptured so this is a
                            // no-op and (fixedX, fixedY) is used verbatim. No jitter — exact point.
                            if (!fixedCaptured)
                            {
                                NativeMethods.GetCursorPos(out var fp);
                                fixedX = fp.x;
                                fixedY = fp.y;
                                fixedCaptured = true;
                            }
                            targetX = fixedX;
                            targetY = fixedY;
                        }
                        else if (jitterRadius > 0)
                        {
                            NativeMethods.GetCursorPos(out var live);
                            // ANCHORED jitter. The previous version re-read the LIVE cursor every
                            // tick and jittered from there — but the click carries MOUSEEVENTF_MOVE,
                            // so it MOVES the cursor to the jittered point, and the next tick then
                            // started from the already-displaced position. That is a random walk:
                            // displacement grows as sqrt(N), so the cursor wandered off the target
                            // and eventually off the monitor.
                            //
                            // Re-detect a genuine user move by TOLERANCE, not by exact compare: our
                            // own emitted position round-trips through the lossy 0-65535
                            // normalisation, so the physical pixel can land ~1 px off what we asked
                            // for. An exact test would re-anchor on our own click and reproduce the
                            // walk one pixel at a time. With the tolerance, our emissions are inside
                            // the window by construction and never re-anchor, while a real user move
                            // does — so jitter still "follows your mouse" and displacement stays
                            // permanently bounded by the radius.
                            if (!anchorSet
                                || Math.Abs(live.x - anchorX) > jitterRadius + AnchorTolerancePx
                                || Math.Abs(live.y - anchorY) > jitterRadius + AnchorTolerancePx)
                            {
                                anchorX = live.x;
                                anchorY = live.y;
                                anchorSet = true;
                            }
                            targetX = anchorX + Random.Shared.Next(-jitterRadius, jitterRadius + 1);
                            targetY = anchorY + Random.Shared.Next(-jitterRadius, jitterRadius + 1);
                        }
                        else
                        {
                            NativeMethods.GetCursorPos(out var live);
                            targetX = live.x;
                            targetY = live.y;
                        }

                        // Cached virtual-screen bounds — saves 4 P/Invokes per clicker tick.
                        // See NativeMethods.VirtualScreen.
                        var (vx, vy, vw, vh) = NativeMethods.VirtualScreen.Bounds;
                        // Keep the click inside the virtual desktop's BOUNDING BOX: a saved area
                        // rect or picked point can outlive the display arrangement that produced
                        // it. Deliberately not promised as "a real pixel" — in a staggered layout
                        // (1920x1080 at 0,0 next to 1280x1024 at 1920,-400) the bounding box has
                        // dead zones no monitor covers, and this clamp will happily accept a point
                        // inside one. Windows silently relocates a SetCursorPos that lands there;
                        // ScreenOverlayWindow's precision mode documents the same effect and reads
                        // the cursor back afterwards for exactly that reason.
                        targetX = Math.Clamp(targetX, vx, vx + Math.Max(1, vw) - 1);
                        targetY = Math.Clamp(targetY, vy, vy + Math.Max(1, vh) - 1);
                        int absX = (int)(((double)(targetX - vx) * 65535) / Math.Max(1, vw - 1));
                        int absY = (int)(((double)(targetY - vy) * 65535) / Math.Max(1, vh - 1));

                        // ── The move, as its own event, BEFORE the button. ──────────────────
                        // The loop used to fold position into the click INPUT and send nothing
                        // else, so an app saw the cursor's whole delta arrive simultaneously
                        // with the press — no SetCursorPos for GetCursorPos readers, no separate
                        // move for Raw Input readers, and no chance to process the arrival
                        // before the click. That breaks hit-testing in Win32 menus and WinUI
                        // flyouts, and it is the "single large teleport" that Roblox-class games
                        // reject outright (see MoveCursorTo).
                        //
                        // Returns false when the cursor is already on target, which is the
                        // common case: cursor mode with jitter off aims at the live cursor, so
                        // the default configuration pays nothing at all for this. Fixed mode
                        // pays once, on the first tick. Area mode is the only one that moves
                        // every tick — and it is the one that needed this most.
                        replayer.ClickerMoveTo(targetX, targetY, gameMove, token);
                        // A Stop that landed during a game-move walk returns it early (the walk now
                        // honours the token between steps); pressing now would click after Stop.
                        if (token.IsCancellationRequested) break;

                        // ── The click. The UP is guaranteed. ────────────────────────────────
                        // Cancelling inside the hold used to skip the UP entirely and leave the
                        // button physically latched down system-wide, for up to HoldMs (2 s max).
                        // Three layers now prevent it: this finally; ClickerButton recording the
                        // press in the shared _simLeftDown/... state so ResetMouseState can
                        // release it; and ReleaseHeldMouseButtons in the outer finally.
                        uint downRc = replayer.ClickerButton(downFlag, absX, absY);
                        bool downSent = downRc == 1;
                        try
                        {
                            // Keeps the token so Stop stays prompt; the finally covers the throw.
                            if (safeHold > 0) await Task.Delay(safeHold, token);
                        }
                        finally
                        {
                            // NOT conditional on the token — that is the whole point.
                            if (downSent) replayer.ClickerButton(upFlag, absX, absY);
                        }

                        // SendInput returns the number of events actually inserted; 0 means the
                        // call was rejected outright (a bad cbSize, or another thread holding
                        // BlockInput). Not counting those keeps the dashboard from reporting a
                        // healthy CPS for clicks that never happened.
                        //
                        // This does NOT catch UIPI. Measured 2026-08-08 with a medium-integrity
                        // probe against an elevated foreground window: SendInput returned 1 and
                        // GetAsyncKeyState confirmed the event never entered the input stream —
                        // matching the SendInput docs, which say neither the return value nor
                        // GetLastError reveal UIPI blocking. So an unelevated TrueReplayer
                        // clicking at an elevated target still reports a full, healthy run while
                        // nothing lands. Detecting that needs an explicit integrity comparison
                        // against the foreground window, which this counter is not.
                        if (downSent) clickCount++;
                        else blockedCount++;

                        // Push click stats to the UI every ~250ms. Comparing against elapsed
                        // (not iteration count) makes the cadence stable across slow/fast
                        // configurations.
                        var elapsedMs = sw.ElapsedMilliseconds - pausedAccumMs;

                        // The one failure the click counter cannot see: the click landed on an
                        // elevated window. Reported on the CHANGE, in both directions, so the
                        // dashboard line follows the cursor rather than latching for the run.
                        // Its own gate — first tick, then every 250 ms — because the expensive
                        // part is OpenProcess/OpenProcessToken, not WindowFromPoint, and because a
                        // short run has to be covered too.
                        if (probeElevation && (!probedOnce || elapsedMs - lastProbeMs >= 250))
                        {
                            probedOnce = true;
                            lastProbeMs = elapsedMs;
                            var root = ProcessIntegrity.RootWindowAt(targetX, targetY);
                            if (root != lastRootHwnd)
                            {
                                lastRootHwnd = root;
                                bool elevated = ProcessIntegrity.IsWindowElevated(root) == true;
                                if (elevated != reportedElevated)
                                {
                                    reportedElevated = elevated;
                                    if (elevated)
                                        DiagnosticLog.Warn("Clicker: the window under the cursor runs elevated and this process does not — SendInput reports success but UIPI drops every click. Run TrueReplayer as administrator.");
                                    dispatcherQueue.TryEnqueue(() => OnClickerWarning?.Invoke(elevated ? "elevatedTarget" : null));
                                }
                            }
                        }

                        if (elapsedMs - lastStatsPushMs >= 250)
                        {
                            lastStatsPushMs = elapsedMs;
                            var snapshotCount = clickCount;
                            var snapshotElapsed = elapsedMs;
                            dispatcherQueue.TryEnqueue(() => OnClickerStats?.Invoke(snapshotCount, snapshotElapsed, maxDurationMs));

                            // Loop progress for genuine loops only (single-shot keeps "—").
                            // total=0 signals infinite — matches Macro engine convention.
                            if (isInfinite || loopCount > 1)
                            {
                                var snapshotIteration = iteration;
                                var snapshotTotal = isInfinite ? 0 : loopCount;
                                dispatcherQueue.TryEnqueue(() => OnLoopProgress?.Invoke(snapshotIteration, snapshotTotal));
                            }
                        }

                        // ── Next deadline ───────────────────────────────────────────────────
                        // Jitter is a symmetric scatter (Next(-v, v+1)), so it perturbs individual
                        // periods without changing the mean — which is why it is applied here and
                        // deliberately NOT modelled in the rate the UI reports.
                        int period = basePeriod;
                        if (useJitter && jitterPercent > 0)
                        {
                            int variation = period * jitterPercent / 100;   // clamped 0..100 above
                            period = Math.Max(MinClickPeriodMs, period + Random.Shared.Next(-variation, variation + 1));
                        }
                        // Interval applies only between iterations, never after the last one.
                        if (loopInterval > 0 && (isInfinite || iteration < loopCount))
                            period += loopInterval;

                        nextTickMs += period;
                        long wait = nextTickMs - (sw.ElapsedMilliseconds - pausedAccumMs);
                        // Never wait PAST the cap. Without this a 60 s gap would sit through a
                        // 5 s limit and only notice at the top of the next iteration, so the run
                        // would overshoot by most of a minute. Truncating here makes the cap land
                        // on time whatever the period is.
                        if (maxDurationMs > 0)
                        {
                            long remaining = maxDurationMs - (sw.ElapsedMilliseconds - pausedAccumMs);
                            if (remaining < wait) wait = remaining;
                        }
                        if (wait > 0)
                        {
                            long pausedDuringWait = await ClickerWaitAsync(wait, sw, token);
                            pausedAccumMs += pausedDuringWait;
                        }
                        else
                        {
                            // Behind schedule (slow tick, a stall, a hold longer than the period).
                            // Resync instead of banking the debt — otherwise the loop "catches up"
                            // with a no-delay salvo, which at a 5 ms setting is hundreds of clicks.
                            nextTickMs = sw.ElapsedMilliseconds - pausedAccumMs;
                        }
                    }
                    endReason = token.IsCancellationRequested ? "cancelled"
                        : durationCapped ? "duration limit reached"
                        : "loop count reached";
                }
                catch (OperationCanceledException) { endReason = "cancelled"; }
                catch
                {
                    // A loop that THREW is not a stop. endReason kept its initial "cancelled" and the
                    // dashboard showed a normal "stopped"; the fault only reached the log. Rethrown so
                    // the OnlyOnFaulted continuation below still logs it.
                    endReason = "error";
                    throw;
                }
                finally
                {
                    // Clear pause state so a stop-while-paused doesn't leave the loop "armed"
                    // and the dashboard stuck on the PAUSED overlay.
                    _clickerLoopActive = false;
                    bool wasPaused = _clickerPaused;
                    _clickerPaused = false;
                    _clickerResumeTcs?.TrySetResult(true);

                    // Layer 3 of the stuck-button guard: the authoritative last word, once the
                    // loop is definitively over. No-ops when nothing is down.
                    replayer.ReleaseHeldMouseButtons();

                    // Always paired with TimeBeginPeriod — the resolution is process-wide.
                    if (raisedTimerRes) NativeMethods.TimeEndPeriod(1);

                    var finalElapsed = sw.ElapsedMilliseconds - pausedAccumMs;
                    // End-of-run line — the clicker had no equivalent of the macro engine's
                    // "Replay finished", so a run that stopped early was invisible in the log.
                    DiagnosticLog.Info(
                        $"Clicker end: {clickCount} click(s)" +
                        (blockedCount > 0 ? $", {blockedCount} REJECTED by SendInput" : "") +
                        $", {finalElapsed}ms elapsed" +
                        (finalElapsed > 0 ? $" (~{clickCount * 1000.0 / finalElapsed:0.#}/s)" : "") +
                        $", reason={endReason}");

                    // Final flush so the UI lands on the exact end-state (e.g. "100/100" not
                    // "97/100") even if the loop ended between throttled pushes.
                    var finalCount = clickCount;
                    var finalBlocked = blockedCount;
                    var finalIteration = iteration;
                    var finalLoopTotal = isInfinite ? 0 : loopCount;
                    var emitFinalLoop = isInfinite || loopCount > 1;
                    // The log keeps its prose; the wire gets four fixed words the dashboard maps
                    // to a badge ("stopped" / "limit reached" / "time's up" / "failed").
                    var wireReason = endReason == "cancelled" ? "stopped"
                        : endReason == "duration limit reached" ? "time"
                        : endReason == "error" ? "error"
                        : "clicks";
                    dispatcherQueue.TryEnqueue(() =>
                    {
                        OnClickerStats?.Invoke(finalCount, finalElapsed, maxDurationMs);
                        if (emitFinalLoop)
                            OnLoopProgress?.Invoke(finalIteration, finalLoopTotal);
                        OnClickerEnded?.Invoke(wireReason, finalBlocked);
                        if (wasPaused) OnReplayResumed?.Invoke();
                        ResetReplayState();
                    });
                }
            });

            _ = clickerTask.ContinueWith(
                t => DiagnosticLog.Error("Clicker loop faulted", t.Exception!),
                CancellationToken.None,
                TaskContinuationOptions.OnlyOnFaulted,
                TaskScheduler.Default);
        }

        // Waits `ms`, staying responsive to BOTH cancellation and pause.
        //
        // The old loop only checked _clickerPaused at the top of each iteration, so a pause
        // could take a whole cycle to land (up to a minute with a long interval) while the
        // dashboard already showed PAUSED — and a pause+resume inside one cycle was a complete
        // no-op that the UI nonetheless animated.
        //
        // Returns the milliseconds spent paused so the caller can shift both its schedule and
        // its elapsed-time baseline, keeping the reported CPS free of paused time.
        private async Task<long> ClickerWaitAsync(long ms, System.Diagnostics.Stopwatch sw, CancellationToken token)
        {
            long pausedTotal = 0;
            while (ms > 0)
            {
                token.ThrowIfCancellationRequested();
                if (_clickerPaused)
                {
                    long pauseBegan = sw.ElapsedMilliseconds;
                    await AwaitClickerResumeAsync(token);
                    pausedTotal += sw.ElapsedMilliseconds - pauseBegan;
                    continue;
                }
                // Slice only LONG waits. A fast run keeps a single Task.Delay (one quantisation
                // error per tick, not one per slice), while a 60 s interval still notices a
                // pause within 25 ms instead of a minute.
                int slice = ms > 50 ? 25 : (int)ms;
                long before = sw.ElapsedMilliseconds;
                await Task.Delay(slice, token);
                ms -= sw.ElapsedMilliseconds - before;
            }
            return pausedTotal;
        }

        // Blocks until ResumeClicker fires or the run is cancelled.
        // Loops on the flag: a spurious completion (or a pause that re-arms while we were
        // waking) must re-wait rather than fall through and click while the UI shows PAUSED.
        private async Task AwaitClickerResumeAsync(CancellationToken token)
        {
            while (_clickerPaused)
            {
                token.ThrowIfCancellationRequested();
                var resumeTcs = _clickerResumeTcs;
                if (resumeTcs == null) break;   // resumed between the flag read and the field read
                // A linked TCS + a disposed registration, rather than
                // Task.WhenAny(resume, Task.Delay(Infinite, token)): the abandoned Delay would
                // leave a live timer and token registration behind on every single resume.
                var cancelTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                using (token.Register(static s => ((TaskCompletionSource<bool>)s!).TrySetResult(true), cancelTcs))
                    await Task.WhenAny(resumeTcs.Task, cancelTcs.Task);
                token.ThrowIfCancellationRequested();
            }
        }

        private void ResetReplayState()
        {
            IsReplaying = false;
            onButtonStateChanged?.Invoke("Replay", false);
            updateButtonStates();
            // "ready:stopped" = same READY state, but tagged so the bridge knows the
            // run ended by user request and skips the out-of-window notification.
            var stopped = _userStopped;
            _userStopped = false;
            onStatusChanged?.Invoke(stopped ? "ready:stopped" : "ready");
        }
    }

    public class ActionRecorder
    {
        private readonly ObservableCollection<ActionItem> _actions;
        private readonly Func<int> _getCustomDelay;
        private readonly Func<bool> _useCustomDelayFunc;
        private readonly Action? _onActionAdded;
        private readonly HashSet<string> _pressedKeys = new();
        private int? insertIndex;
        private bool _isRecording;
        // Environment.TickCount64 of the last recorded action. Monotonic on purpose: DateTime.Now
        // jumps with an NTP correction after a resume or a DST change, and a forward jump between
        // two clicks was recorded as the Delay itself — an hour of wait between two clicks made
        // 300 ms apart. The replay side already measures its waits with the tick count.
        private long? _lastActionTicks;

        public bool RecordMouse { get; set; } = true;
        public bool RecordScroll { get; set; } = true;
        public bool RecordKeyboard { get; set; } = true;
        // When true, a key press / mouse click is recorded as ONE action (Keystroke / *Click)
        // instead of the paired Down+Up. Set per-session from the global toggle in Start().
        public bool RecordCombined { get; set; } = false;
        public bool UseRelativeCoordinates { get; set; } = false;

        // ── Double-click merge state ──
        // The merge is always active in combined mode (two LeftClicks within the SYSTEM
        // double-click time and SM_CX/CYDOUBLECLK rectangle collapse into one DoubleClick
        // row); paired mode records raw Down/Up rows and never merges.
        // _lastAdded tracks the most recent row from ANY AddAction (a keystroke between
        // two clicks must break the pair); the click fields remember where/when the last
        // combined LeftClick physically landed, in SCREEN coords — the recorded X/Y may
        // be window-relative, which would break the distance check.
        private ActionItem? _lastAdded;
        private ActionItem? _lastCombinedLeftClick;
        private int _lastClickScreenX, _lastClickScreenY;
        private long _lastClickTickMs;
        // GetSystemMetrics indices for the system double-click tolerance rectangle — Win32 SM_* constants.
        // SM_CXDOUBLECLK / SM_CYDOUBLECLK give the FULL width/height of the rectangle (centred on the
        // first click) within which Windows itself pairs two clicks into a double-click.
        private const int SM_CXDOUBLECLK = 36, SM_CYDOUBLECLK = 37;

        // ── Combined-mode keyboard grouping state ──
        // Modifiers are folded into the following key so "Ctrl+C", "Shift+A" (capitals) and
        // "Shift+1" (symbols) reproduce correctly. _heldMods = modifiers physically down now;
        // _sessionMods = union seen since the first modifier of the current chord went down
        // (used to emit a lone-modifier tap on release); _sessionUsed = a key/click already
        // consumed the held modifiers, so releasing them must NOT emit a stray Keystroke.
        private readonly HashSet<string> _heldMods = new(StringComparer.OrdinalIgnoreCase);
        private readonly HashSet<string> _sessionMods = new(StringComparer.OrdinalIgnoreCase);
        private bool _sessionUsed;
        private static readonly HashSet<string> ModifierKeyNames =
            new(StringComparer.OrdinalIgnoreCase) { "Ctrl", "Shift", "Alt", "Win" };

        public ActionRecorder(
            ObservableCollection<ActionItem> actions,
            Func<int>? getCustomDelay = null,
            Func<bool>? useCustomDelayFunc = null,
            Action? onActionAdded = null)
        {
            _actions = actions;
            _getCustomDelay = getCustomDelay ?? (() => 100);
            _useCustomDelayFunc = useCustomDelayFunc ?? (() => true);
            _onActionAdded = onActionAdded;
        }

        public void SetInsertIndex(int? index) => insertIndex = (index >= 0 && index <= _actions.Count) ? index : null;
        public bool IsInsertMode => insertIndex.HasValue;

        /// Rows this recording session has appended. Reset by <see cref="Start"/> and deliberately
        /// NOT by <see cref="Stop"/>: RecordingService calls Stop() before it logs, so zeroing it
        /// there would erase the number the log line exists to print. Its job is to make a dead
        /// keyboard hook visible: "keyboard=True" plus "captured=0" narrows it to a dead hook or an
        /// idle session — the two are told apart by how long the session ran — where the old bare
        /// "Recording stopped" could not tell a hook Windows had silently removed from one that saw
        /// forty events. Counts rows APPENDED, so a capture the user discards still reports what it
        /// captured, and events merged into the previous row are not counted twice.
        private int _capturedThisSession;
        public int CapturedThisSession => _capturedThisSession;

        public void Start()
        {
            _isRecording = true;
            _capturedThisSession = 0;
            _lastActionTicks = null;
            // A click from a previous session must never pair with the first click of
            // this one — the wall-clock gap check would usually reject it anyway, but a
            // quick stop/start inside the double-click window shouldn't merge across.
            _lastCombinedLeftClick = null;
            _lastAdded = null;
        }

        public void Stop()
        {
            _isRecording = false;
            _pressedKeys.Clear();
            _heldMods.Clear();
            _sessionMods.Clear();
            _sessionUsed = false;
            insertIndex = null;
            _lastActionTicks = null;
            _lastCombinedLeftClick = null;
            _lastAdded = null;
            foreach (var action in _actions) action.IsInsertionPoint = false;
        }

        public bool IsRecording => _isRecording;

        // The Environment.TickCount64 of the event being recorded, stamped by the input hook on its
        // own thread. Every "now" in the recorder is this: the event reaches the recorder through
        // the UI thread's queue, and the clock at THAT moment would add however long the queue
        // waited to a delay, or push a fast double-click past the system's double-click time.
        private long _eventTicks;

        private int GetDelayForNewAction()
        {
            if (_useCustomDelayFunc())
            {
                return _getCustomDelay();
            }
            else
            {
                long now = _eventTicks;
                int delay;
                if (_lastActionTicks.HasValue)
                {
                    delay = (int)Math.Min(int.MaxValue, Math.Max(0, now - _lastActionTicks.Value));
                }
                else
                {
                    delay = 0;
                }
                _lastActionTicks = now;
                return delay;
            }
        }

        /// <param name="eventTicks">The event's Environment.TickCount64; 0 = now.</param>
        public void RecordKeyboardAction(string key, bool isDown, long eventTicks = 0)
        {
            if (!_isRecording || !RecordKeyboard) return;
            _eventTicks = eventTicks != 0 ? eventTicks : Environment.TickCount64;
            if (RecordCombined) { RecordKeyboardCombined(key, isDown); return; }

            // ── Paired mode (legacy, unchanged) ──
            var actionType = isDown ? "KeyDown" : "KeyUp";
            int delay = GetDelayForNewAction();

            if (isDown && !_pressedKeys.Contains(key))
            {
                AddAction(new ActionItem { ActionType = actionType, Key = key, Delay = delay });
                _pressedKeys.Add(key);
            }
            else if (!isDown)
            {
                _pressedKeys.Remove(key);
                AddAction(new ActionItem { ActionType = actionType, Key = key, Delay = delay });
            }
        }

        // Combined mode: one event per press, emitted on key-DOWN; the key-up is ignored
        // (no hold capture — the user adds a HoldKey action manually if they want a hold).
        // A held modifier folds into the next key so combos / capitals / symbols replay right.
        private void RecordKeyboardCombined(string key, bool isDown)
        {
            if (ModifierKeyNames.Contains(key))
            {
                if (isDown)
                {
                    if (_heldMods.Count == 0) { _sessionUsed = false; _sessionMods.Clear(); }
                    _heldMods.Add(key);
                    _sessionMods.Add(key);
                }
                else
                {
                    _heldMods.Remove(key);
                    // Modifier(s) pressed and released with no key/click in between → record the
                    // lone tap as a single Keystroke ("Shift", "Ctrl+Shift", …). Emitted only
                    // once the whole chord is released so multi-modifier taps fold together.
                    if (_heldMods.Count == 0 && !_sessionUsed && _sessionMods.Count > 0)
                    {
                        AddAction(new ActionItem { ActionType = "Keystroke", Key = BuildCombo(_sessionMods, null), Delay = GetDelayForNewAction() });
                        _sessionMods.Clear();
                    }
                }
                return;
            }

            // Non-modifier key.
            if (isDown && !_pressedKeys.Contains(key))
            {
                string combo = _heldMods.Count > 0 ? BuildCombo(_heldMods, key) : key;
                AddAction(new ActionItem { ActionType = "Keystroke", Key = combo, Delay = GetDelayForNewAction() });
                _pressedKeys.Add(key);
                if (_heldMods.Count > 0) _sessionUsed = true;
            }
            else if (!isDown)
            {
                _pressedKeys.Remove(key);   // combined mode emits nothing on key-up
            }
        }

        // Joins modifiers (+ optional target key) into the canonical "Win+Ctrl+Shift+Alt+Key"
        // form SimulateKeystroke parses — identical to what the manual "Send Keystroke" insert
        // and the hotkey capture produce, so replay of a recorded combo matches exactly.
        private static string BuildCombo(HashSet<string> mods, string? target)
        {
            var parts = new List<string>();
            if (mods.Contains("Win")) parts.Add("Win");
            if (mods.Contains("Ctrl")) parts.Add("Ctrl");
            if (mods.Contains("Shift")) parts.Add("Shift");
            if (mods.Contains("Alt")) parts.Add("Alt");
            if (!string.IsNullOrEmpty(target)) parts.Add(target);
            return string.Join("+", parts);
        }

        /// <param name="eventTicks">The event's Environment.TickCount64; 0 = now.</param>
        public void RecordMouseAction(string button, int x, int y, bool isDown, int scrollDelta = 0, long eventTicks = 0)
        {
            if (!_isRecording) return;
            _eventTicks = eventTicks != 0 ? eventTicks : Environment.TickCount64;

            bool isScroll = button == "Scroll";
            if ((isScroll && !RecordScroll) || (!isScroll && !RecordMouse)) return;

            // Combined mode records a click as ONE event captured on the press; the release is
            // ignored (no drag/hold capture — use paired mode for those). Scroll is unaffected.
            if (RecordCombined && !isScroll && !isDown) return;

            string actionType = isScroll
                ? (scrollDelta > 0 ? "ScrollUp" : "ScrollDown")
                : RecordCombined
                    ? button switch
                    {
                        "Left" => "LeftClick",
                        "Right" => "RightClick",
                        "Middle" => "MiddleClick",
                        _ => ""
                    }
                    : button switch
                    {
                        "Left" => isDown ? "LeftClickDown" : "LeftClickUp",
                        "Right" => isDown ? "RightClickDown" : "RightClickUp",
                        "Middle" => isDown ? "MiddleClickDown" : "MiddleClickUp",
                        _ => ""
                    };

            if (string.IsNullOrEmpty(actionType)) return;

            int delay = GetDelayForNewAction();

            if (isScroll)
            {
                AddAction(new ActionItem { ActionType = actionType, Delay = delay });
            }
            else
            {
                // A click consumes any held-modifier session so its (ignored) release doesn't
                // later emit a stray lone-modifier Keystroke. Modifier+click isn't encoded as a
                // unit in combined mode — the click is recorded without the modifier.
                if (RecordCombined && _heldMods.Count > 0) _sessionUsed = true;

                // Multi-click merge: this LeftClick continues a system multi-click chain →
                // upgrade the previous row in place instead of adding a new one. The chain is
                // LeftClick → DoubleClick → TripleClick, one hop per physical click, and it STOPS
                // there: a fourth click starts a fresh LeftClick. Always on in combined mode
                // (paired mode keeps raw Down/Up rows untouched). Conditions: Left button + the
                // previous row is still the most recently added action (consecutive) + within
                // GetDoubleClickTime and the SM_CX/CYDOUBLECLK rectangle of the PREVIOUS physical
                // click, both measured the way Windows itself pairs clicks. Skipped in capture
                // mode (capture flows count actions and complete after exactly one click). The
                // merged row keeps the FIRST click's coords/delay.
                //
                // The third hop is why the window and the rectangle are re-armed on every merge
                // instead of staying centred on the first click: an OS chain pairs each click with
                // the one BEFORE it, so hop 2→3 is measured from click 2. Leaving them on click 1
                // would hand the third click a budget already half spent and a rectangle it has to
                // hit from two clicks away — a hand-made triple-click would fail the check that a
                // double-click at the same speed passes.
                //
                // The chain used to stop at two on purpose, leaving a physical triple-click to
                // record as DoubleClick + LeftClick. That was wrong for the one case TripleClick
                // exists to serve: replaying select-word and then clicking UNDOES the selection, so
                // a recorded triple-click could not reproduce itself. Escalating does regroup fast
                // repeated clicking — six clicks in one spot now record as two TripleClicks where
                // they recorded as three DoubleClicks — which is deliberate, and is why the chain
                // is capped at three rather than counting on forever.
                if (RecordCombined && button == "Left"
                    && _lastCombinedLeftClick != null
                    && ReferenceEquals(_lastCombinedLeftClick, _lastAdded)
                    && _lastCombinedLeftClick.ActionType is "LeftClick" or "DoubleClick")
                {
                    long nowMs = _eventTicks;
                    // SM_CX/CYDOUBLECLK are the FULL rectangle dimensions, but the distance check
                    // measures the offset of this click from the rectangle's centre — the PREVIOUS
                    // click of the chain — so the tolerance is HALF the metric per axis. Max(2, …)
                    // guards against a degenerate 0/1-px metric collapsing the rectangle and never
                    // merging.
                    int maxW = Math.Max(2, NativeMethods.GetSystemMetrics(SM_CXDOUBLECLK) / 2);
                    int maxH = Math.Max(2, NativeMethods.GetSystemMetrics(SM_CYDOUBLECLK) / 2);
                    if (nowMs - _lastClickTickMs <= NativeMethods.GetDoubleClickTime()
                        && Math.Abs(x - _lastClickScreenX) <= maxW
                        && Math.Abs(y - _lastClickScreenY) <= maxH)
                    {
                        // Resolve the index BEFORE mutating. ReferenceEquals(_lastCombinedLeftClick,
                        // _lastAdded) above proves this recorder added the row last, NOT that the
                        // row is still in the collection: the bridge's browser-click dedup removes
                        // rows straight off `actions` without going through AddAction, so during an
                        // extension recording _lastAdded can be a dangling pointer. Mutating it
                        // there used to rewrite a detached object to DoubleClick and then swallow
                        // the write on `if (mi >= 0)` — and the second physical click produced no
                        // row at all, in silence. A removed row is not a pair to merge with, so
                        // fall through and let this click record as an ordinary LeftClick.
                        int mi = _actions.IndexOf(_lastCombinedLeftClick);
                        if (mi >= 0)
                        {
                            var merged = _lastCombinedLeftClick;
                            // One hop up the chain. Reading the CURRENT type (not a counter) keeps
                            // how far the chain has gone in the row itself, so there is no second
                            // copy of that state to fall out of sync with it.
                            bool chainEnds = merged.ActionType == "DoubleClick";
                            merged.ActionType = chainEnds ? "TripleClick" : "DoubleClick";
                            if (chainEnds)
                            {
                                // Three pairs is the whole vocabulary: a fourth click is a new row.
                                _lastCombinedLeftClick = null;
                            }
                            else
                            {
                                // Stay armed for a third click, re-centred on THIS one (see the
                                // header). _lastCombinedLeftClick and _lastAdded both still point at
                                // `merged` — the type was mutated in place and no row was added —
                                // so the consecutive-row check holds for the next click unchanged.
                                _lastClickScreenX = x;
                                _lastClickScreenY = y;
                                _lastClickTickMs = nowMs;
                            }
                            // An in-place property mutation only raises PropertyChanged — the
                            // bridge pushes the grid on COLLECTION changes. Re-assigning the
                            // same instance at its index raises a Replace event, so the
                            // upgraded row shows immediately (not only after the next action
                            // happens to be recorded or the profile reloads).
                            _actions[mi] = merged;
                            _onActionAdded?.Invoke();
                            return;
                        }
                        _lastCombinedLeftClick = null;
                    }
                }

                int recX = x, recY = y;
                if (UseRelativeCoordinates)
                {
                    // Convert screen coords to window-relative
                    var pt = new NativeMethods.POINT { x = x, y = y };
                    var hwnd = NativeMethods.WindowFromPoint(pt);
                    if (hwnd != IntPtr.Zero)
                    {
                        // Get the top-level window (not child controls)
                        var root = NativeMethods.GetAncestor(hwnd, NativeMethods.GA_ROOT);
                        if (root != IntPtr.Zero) hwnd = root;
                        if (NativeMethods.GetWindowRect(hwnd, out var rect))
                        {
                            recX = x - rect.Left;
                            recY = y - rect.Top;
                            // Capture window geometry on first click for Restore Position / Restore Size.
                            // WindowFromPoint can resolve to the wrong window (a tooltip, the desktop, or
                            // TrueReplayer itself if the click lands on our own UI) — capturing that would
                            // permanently poison the profile's restore geometry. Skip our own process and
                            // implausibly small rects to rule out the common poison cases. This is a
                            // heuristic, not a strict Window Target match (the recorder has no target
                            // reference), so an unrelated large window could still seed geometry.
                            if (Models.UserProfile.Current.WindowWidth == 0)
                            {
                                int w = rect.Right - rect.Left;
                                int h = rect.Bottom - rect.Top;
                                NativeMethods.GetWindowThreadProcessId(hwnd, out uint pid);
                                bool isOwnWindow = pid == (uint)Environment.ProcessId;
                                if (!isOwnWindow && w >= 100 && h >= 100)
                                {
                                    Models.UserProfile.Current.WindowWidth = w;
                                    Models.UserProfile.Current.WindowHeight = h;
                                    Models.UserProfile.Current.WindowX = rect.Left;
                                    Models.UserProfile.Current.WindowY = rect.Top;
                                }
                            }
                        }
                    }
                }
                var clickAction = new ActionItem { ActionType = actionType, X = recX, Y = recY, Delay = delay };
                AddAction(clickAction);
                // Arm (or reset) the double-click tracker. Screen coords, not recX/recY —
                // relative recording rewrites those and would corrupt the distance check.
                if (RecordCombined && actionType == "LeftClick")
                {
                    _lastCombinedLeftClick = clickAction;
                    _lastClickScreenX = x;
                    _lastClickScreenY = y;
                    _lastClickTickMs = _eventTicks;
                }
                else
                {
                    _lastCombinedLeftClick = null;
                }
            }
        }

        private void AddAction(ActionItem action)
        {
            if (insertIndex.HasValue && insertIndex.Value >= 0 && insertIndex.Value <= _actions.Count)
            {
                _actions.Insert(insertIndex.Value, action);
                insertIndex++;
            }
            else
            {
                _actions.Add(action);
            }

            _lastAdded = action;
            _capturedThisSession++;
            _onActionAdded?.Invoke();
        }
    }

    public class ActionReplayer
    {
        // ── Smooth mouse movement ─────────────────────────────────────────────────────
        // Some apps/games (notably Roblox) reject a single large "teleport" of the cursor —
        // they only follow movement that progresses through intermediate positions, like a
        // physical mouse. When SmoothMovement is on, SimulateMouse walks a straight path from
        // the current cursor to the target in steps of at most MoveStepPx pixels, pausing
        // MoveStepDelayMs between steps. MoveClickDelayMs is the gap before the click fires.
        // When off, it jumps straight to the target (the default). These are persisted in
        // appsettings.json and loaded into these statics by AppSettingsManager.ApplyGlobalSettings;
        // the UI edits them through the settings:change keys smoothMovement / moveStepPx /
        // moveStepDelay / moveClickDelay.
        public static bool SmoothMovement = false;
        // The RUN's own Game Mode — the loaded profile's explicit choice, or null when it never
        // set one. Effective = this ?? SmoothMovement, read per move, so a profile that follows
        // still sees the global flipped mid-run exactly as before. Per run, not a static:
        // ApplyGlobalSettings re-stamps the statics from disk on every hotkey and automation fire,
        // and a profile value parked there would be overwritten (or leak into the next profile).
        // One engine, one replay at a time, run body single-threaded — a field is enough. A
        // sub-profile with its own value swaps it for its call (SaveWindowContext carries it).
        private bool? _runGameMode;
        public void SetGameMode(bool? gameMode) => _runGameMode = gameMode;
        // Cursor return at the end of a macro run — the app default (AppSettings.RestoreCursor).
        // The run's own value lives in _runRestoreCursor, for the same re-stamping reason as
        // _runGameMode. Effective = run ?? default, read at the END (StartAsync's finally), so a
        // profile that follows sees the default flipped mid-run. Only the ROOT run's value counts:
        // RunProfile never touches it, so a sub-profile's own choice is ignored in a chain.
        public static bool RestoreCursorDefault = false;
        private bool? _runRestoreCursor;
        public void SetRestoreCursor(bool? restoreCursor) => _runRestoreCursor = restoreCursor;
        public static int MoveStepPx = 20;
        // Fallback step for a FORCED walk (Clicker "Game move") when MoveStepPx is 0 — legal for
        // macro, meaningless for a walk. Mirrors the shipped MoveStepPx default.
        public const int DefaultMoveStepPx = 20;
        public static int MoveStepDelayMs = 2;
        public static int MoveClickDelayMs = 10;

        // ── Fast approach (jump-and-settle) ─────────────────────────────────────────────
        // Walking the WHOLE smooth path is slow when the cursor starts far from the target
        // (e.g. the first click is on the opposite monitor — hundreds of MoveStepPx steps).
        // When FastApproach is on and the move is longer than SettleDistancePx, we teleport
        // most of the way with a bare SetCursorPos (no SendInput, so no large Raw-Input delta
        // for anti-cheat to flag) to a point SettleDistancePx short of the target, then walk
        // only that final stretch smoothly — the small "settle" moves are what games look for
        // to accept the cursor as having arrived. Far moves become ~constant-time instead of
        // scaling with distance. On by default (validated on real games): the bare SetCursorPos
        // teleport works for the user's games — turn off only if a particular game misclicks.
        // UI keys: fastApproach / settleDistance.
        public static bool FastApproach = true;
        public static int SettleDistancePx = 80;

        // ── Focus click ───────────────────────────────────────────────────────────────
        // Opt-in per-action flag (ActionItem.IsFocusClick) honoured by combined clicks. A
        // single click on a very small target — e.g. a Roblox text field while the window is at
        // its minimum size — lands but doesn't give the field keyboard focus. Replaying the click
        // TWICE a few pixels apart (what users do by hand) makes the second click settle inside
        // the field and focus it. FocusClickOffsetPx is the second click's down-right offset from
        // the recorded point (in recorded/profile space, so the window-relative translation in
        // SimulateMouse applies to it too); FocusClickGapMs is the pause between the two clicks.
        // Static so a future settings knob can tune them; defaults match the manual workaround.
        public static int FocusClickOffsetPx = 5;
        public static int FocusClickGapMs = 60;

        // Gap between consecutive press/release pairs of a MULTI-click replay — DoubleClick's two
        // and TripleClick's three. 50 ms sits comfortably below any system double-click time
        // (default 500 ms, minimum 200) while still letting slower apps process the previous
        // click. ONE constant for both on purpose: GetDoubleClickTime governs every hop of a
        // multi-click chain, not just the second, so a separate triple knob would be a second
        // name for the same OS quantity and would drift the first time either is tuned. Static so
        // a future settings knob can tune it.
        public static int DoubleClickGapMs = 50;

        // Fires the second "focus" click for an IsFocusClick combined click: a short pause, then
        // a full press/release FocusClickOffsetPx down-right of the recorded point. Skips if the
        // replay was cancelled mid-sequence (mirrors how the primary click's release is gated).
        // coordsAreProfileSpace is threaded from the caller, not defaulted at the call site: an
        // at-cursor click resolves an ABSOLUTE point, and translating the tap while leaving the
        // primary click untranslated would land the two in different coordinate spaces.
        // restoreAnchor: put the cursor back where it started once the tap is done. Only the
        // at-cursor rows pass true, and for them it is not cosmetic — it is what stops a repeat
        // burst from WALKING. Those rows resolve their point by reading the LIVE cursor
        // (ResolveClickPoint), so the tap's +5 px becomes cycle n+1's origin, and a Times = 8 burst
        // ends 35 px away from the small target the focus click exists to hit, reporting "ok" the
        // whole way (StampCursorPoint records only the last cycle). Same class as the jitter walk
        // 2.31.0 already forbade — "a point read from the cursor cannot take an offset that moves
        // the cursor" — surfacing on the second path that moves it.
        // SetCursorPos and not SendInput on purpose: a move INPUT would publish a Raw-Input delta
        // to the target, and this restore must be invisible to it. Same reasoning as the fast-
        // approach teleport. Absolute because at-cursor points always are (profileSpace: false).
        private void FocusTap(int x, int y, uint down, uint up, CancellationToken token,
                              bool coordsAreProfileSpace = true, bool restoreAnchor = false)
        {
            if (FocusClickGapMs > 0) Thread.Sleep(FocusClickGapMs);
            if (token.IsCancellationRequested) return;
            int fx = x + FocusClickOffsetPx, fy = y + FocusClickOffsetPx;
            // The focus tap is a deliberate few-px settle off the primary click, never a jump — opt it
            // out of fast approach so a tiny SettleDistancePx can't turn this nudge into a teleport.
            SimulateMouse(fx, fy, down, coordsAreProfileSpace: coordsAreProfileSpace, allowFastApproach: false, token: token);
            if (!token.IsCancellationRequested)
                SimulateMouse(fx, fy, up, coordsAreProfileSpace: coordsAreProfileSpace, allowFastApproach: false, token: token);
            // Outside the cancellation guard: a run stopped between the tap's down and up must
            // still leave the cursor where it was found, not 5 px adrift.
            if (restoreAnchor && !coordsAreProfileSpace) NativeMethods.SetCursorPos(x, y);
        }

        // N full left press/release pairs at ONE point, each hop under DoubleClickGapMs so the
        // target chains them: 2 = double-click, 3 = triple-click (select-a-paragraph, which two
        // separate DoubleClick rows can NOT produce — their inter-repeat gap is deliberately 600 ms
        // so they read as distinct double-clicks). The cursor travels once: every later pair's move
        // is a no-op because SimulateMouse sees it is already on target, which is also what keeps
        // all pairs inside the SM_CX/CYDOUBLECLK rectangle the OS pairs them by.
        // Cancellation is checked at every boundary — including BEFORE the first press, which the
        // hand-rolled DoubleClick body this replaced did not do (it emitted one orphan press that
        // only StartAsync's ResetMouseState cleaned up).
        private void MultiClickPairs(int cx, int cy, int pairs, CancellationToken token,
                                     bool coordsAreProfileSpace = true)
        {
            for (int p = 0; p < pairs; p++)
            {
                if (token.IsCancellationRequested) return;
                if (p > 0 && DoubleClickGapMs > 0) Thread.Sleep(DoubleClickGapMs);
                if (token.IsCancellationRequested) return;
                SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_LEFTDOWN, coordsAreProfileSpace: coordsAreProfileSpace, token: token);
                if (token.IsCancellationRequested) return;
                SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_LEFTUP, coordsAreProfileSpace: coordsAreProfileSpace, token: token);
            }
        }

        // Resolves the point ONE repeat cycle uses, plus whether that point still needs the
        // profile-space (window-relative) translation SimulateMouse applies.
        //
        // AtCursor reads the live cursor ONCE, here — never per press/release. Re-reading between
        // the down and the up turns a hand-nudge into a DRAG, and for a Double/TripleClick it
        // would scatter the pairs out of the SM_CX/CYDOUBLECLK rectangle and break the chain.
        // The returned point is ALREADY absolute virtual-screen, so profileSpace is false — same
        // reasoning as WaitImage's click-on-match and the pixel one, which also hand SimulateMouse
        // a computed absolute point. Consequence, and it is correct: an at-cursor click never
        // reaches TryResolveRelativeOffset, so it does NOT abort the run via
        // ReportMissingTargetWindow — it does not depend on the target window at all.
        //
        // Position jitter is deliberately NOT applied to a cursor point. SimulateMouse carries
        // MOUSEEVENTF_MOVE, so cycle 1 would move the cursor to cursor+offset and cycle 2 would
        // read THAT as the live cursor — a random walk whose displacement grows with the square
        // root of the repeat count. That is verbatim the bug the Clicker fixed with anchored
        // jitter, and the anchor+re-detect machinery is disproportionate inside a per-action
        // lambda. The Sheet disables the field and writes 0 to match.
        private static (int x, int y, bool profileSpace) ResolveClickPoint(ActionItem a, int jx, int jy)
        {
            if (a.AtCursor)
            {
                NativeMethods.GetCursorPos(out var live);
                return (live.x, live.y, false);
            }
            return (a.X + jx, a.Y + jy, true);
        }

        // Stamps the run-report row with the point an at-cursor click ACTUALLY resolved, so the
        // report proves where it landed instead of echoing a stored coordinate the run ignored —
        // this is what makes the feature verifiable through replay:report rather than by eye.
        // No-op for a normal click (DescribeStepDetail already printed its X/Y) and once the
        // report is full, matching every other Detail write in this loop. With RepeatCount > 1 the
        // last cycle wins, which reads correctly as "where the last click landed".
        private void StampCursorPoint(RunStepRecord rec, ActionItem a, int cx, int cy)
        {
            if (a.AtCursor && !_runStepsFull) rec.Detail = $"at cursor → {cx}, {cy}";
        }

        private readonly ObservableCollection<ActionItem> _actions;
        private readonly DispatcherQueue dispatcherQueue;
        private readonly BrowserBridgeService? _browserBridge;
        private CancellationTokenSource? _cts;
        private int _loopCount = 0;
        private int _loopInterval = 0;
        private Func<string>? _getProfileName;

        // Bridge callback for the status bar's "Loop X/Y" indicator. Mirrors OnClickerStats:
        // throttled to ~4 Hz inside the loop so we don't flood the WebView2 message channel
        // for tight macros, plus a final push in the finally block so the last count lands
        // even when the throttle skipped the last tick or the user cancelled mid-iteration.
        // total == 0 means infinite (WhilePressed or LoopCount=0).
        public Action<int, int>? OnLoopProgress;
        private long _lastLoopProgressMs;

        // Bridge callback for the step counter on the status bar's chain read-out — "A → B (4/11)".
        // Without it the read-out names the sub-profile but its progress counter freezes on the
        // caller's RunProfile row for the whole sub-call, because that counter is derived from the
        // row highlight and the highlight is deliberately blind to rows outside the loaded grid
        // (see the OnActionExecuting map). A chain that is merely slow then reads as a hang.
        //
        // Throttled to ~4 Hz on the same TickCount64 scheme as OnLoopProgress, and for a sharper
        // reason: this fires per ACTION, not per iteration, so a sub-profile of 20 ms actions would
        // otherwise post a WebView2 message every 20 ms. NotifyChainChanged zeroes the stamp so the
        // first action after a push/pop always lands immediately — otherwise a newly entered
        // sub-profile would show the PREVIOUS one's count for up to a quarter second.
        //
        // Two known limits, both deliberate:
        //  • RunProfile RepeatCount > 1 and the data-loop path re-enter ExecuteActionsAsync with
        //    i = 0, so the counter restarts at 1 and nothing on screen says which pass. Note that
        //    the "Loop x/y" indicator does NOT cover this: OnLoopProgress is emitted only by the
        //    ROOT loop in StartAsync — neither the repeats loop in HandleRunProfile nor
        //    RunSubProfileOverDataAsync emits anything. So a sub-profile repeated 300× over data
        //    rows shows its counter sweeping 1..n over and over with no pass number anywhere.
        //    Left as is deliberately: a per-pass counter for sub-calls is a second feature (it
        //    needs its own emit sites and a third number on a 26 px bar), and the read-out's job
        //    here is "is it alive", which a sweeping counter answers. Worth revisiting if chained
        //    data-loops become common.
        //  • It is announced at the TOP of the iteration, before the per-action delay and before
        //    the conditional gate, so it counts If/Else/EndIf and IsSkipped rows. That is the
        //    point: the denominator is actions.Count, which counts them too. Moving the emit down
        //    next to the highlight would make the numerator skip rows the denominator still
        //    includes, and the counter would stall short of its own total.
        public Action<int, int>? OnChainStep;
        private long _lastChainStepMs;

        // ── Profile chaining ──
        // Async lookup that resolves a profile name into its UserProfile. Returns null when missing.
        private Func<string, Task<Models.UserProfile?>>? _profileLookup;
        // Sync lookup for folder-inherited execution context (target + flags + geometry) when the
        // sub-profile has no target of its own. Returns null when the profile already has its own
        // target (caller uses subProfile.* directly) or no folder applies. Without this, a sub
        // inheriting from its folder would silently run against the caller's window.
        private Func<string, Controllers.ProfileController.FolderInheritedContext?>? _folderInheritedContextLookup;
        // Active call stack of profile names, ROOT INCLUDED at index 0 (StartAsync pushes it —
        // see the reset there). Used for cycle detection and for the status-bar "A → B → C"
        // display, and Count >= 2 is the test for "we are inside a sub-profile right now".
        private readonly List<string> _callStack = new();
        // Run-global variable store behind SetVariable / {var:name}. Cleared at the start of
        // every replay run; deliberately NOT snapshot/restored around RunProfile sub-calls —
        // variables share one scope across the whole chain (AHK model), unlike the window
        // context. Keys are normalized to lowercase so {var:UserName} and {var:username} agree.
        private readonly Dictionary<string, string> _runtimeVariables = new();
        // Condition families already reported as unrecognized in THIS run — the anti-flood latch
        // for InstantProbe's unknown-ConditionType warning, which sits on a polled path. Reset
        // with the rest of the run state in StartAsync; never read outside the replay worker.
        private readonly HashSet<string> _unknownConditionTypesWarned = new(StringComparer.OrdinalIgnoreCase);
        // {counter} source: the root replay loop's 1-based iteration. Written only by
        // StartAsync's loop (RunProfile RepeatCount is a different knob and never touches it),
        // so a sub-profile reads the same counter as its caller.
        private int _currentIteration;
        // {row} source: 1-based grid row of the action currently executing, set per action in
        // ExecuteActionsAsync. Inside a RunProfile sub-call it tracks the SUB-profile's rows —
        // the caller's next iteration re-stamps it before any of its own tokens resolve, so no
        // save/restore is needed around the recursion.
        private int _currentActionRow;
        // {loop}: iteration of the innermost While / For Each Data Row block enclosing the executing
        // action — the run repeat (_currentIteration) when no block does. Stamped per action next to
        // _currentActionRow, from the block map and the live loop counters of the executing list.
        private int _currentLoopIteration;
        // {datarow}: 1-based number of the data row the current row context came from — the batch
        // iteration, the Model-B cursor row, the ForEachRow cursor or the sub-profile's row. 0 = no
        // row context (resolves empty). Saved and restored with the data context (DataCtxSnapshot).
        private int _currentDataRow;
        // {rownext:column} source — a run-local, per-column cursor. The Nth {rownext:col} resolved
        // in a run reads the Nth row of that column (0-based here), advancing on EACH resolution
        // across all actions in the run. Keyed by lowercased column name. UNLIKE _rowCursors /
        // _cycleCursors, this IS cleared in StartAsync's fresh-run reset so every run walks the list
        // from the top — swapping the data table then feeds new values into the same fields. Past
        // the last row resolves empty (consume-always). Reference-swapped for a FRESH walk inside a
        // RunProfile-over-data sub-call (RunSubProfileOverDataAsync): the sub owns its own table, so
        // its {rownext} walks that table independently and the parent's cursor is restored on return
        // — mirroring the _currentRowData save/restore there (hence not readonly).
        private Dictionary<string, int> _rowNextCursors = new(StringComparer.OrdinalIgnoreCase);
        // Data-loop state. _dataTable is the profile's table (set once per run in StartReplay);
        // _dataLoopOver drives the "one iteration per row" loop override; _currentRowData is the
        // current iteration's column→cell dict that {row:column} resolves from. Like _currentIteration,
        // this is instance state so a RunProfile sub-call sees the CALLER's current row (the sub has
        // no data loop of its own to re-stamp it) — same AHK-shared-scope model as {counter}/{var}.
        private Models.ProfileDataTable? _dataTable;
        private bool _dataLoopOver;
        private IReadOnlyDictionary<string, string>? _currentRowData;
        // Data-loop CURSOR (Model B) and the SetVariable cycle cursor both live in
        // RunCursorService now — they SURVIVE A RESTART, so the position is no longer lost
        // when the app closes. Still deliberately absent from the fresh-run reset block:
        // carrying across runs is the whole point. Keys are unchanged (row = executing root
        // profile name; cycle = "profile|actionId"), so an in-flight list keeps its place.
        // {clipboard:next} cursor — how many lines of the CURRENT clipboard have been consumed.
        // Single-entry by construction: the key is a hash of the clipboard text, so copying
        // something new leaves the old key behind and the walk restarts at line 1 by itself. That
        // content-keying is what makes ONE cursor serve both shapes of the feature — "one run
        // consumes N lines" (several {clipboard:next} in a run) and "one line per hotkey press"
        // (the same action fired repeatedly) — without the user choosing a mode.
        // DELIBERATELY not in the fresh-run reset block: clearing it per run would break the
        // press-per-line shape. Session-lifetime, like _rowCursors / _cycleCursors / _clipSlots.
        private readonly Dictionary<string, int> _clipNextCursors = new(StringComparer.Ordinal);
        // Clipboard SLOTS behind Copy to Slot / {clip:name}. "Multiple clipboards": each slot
        // holds one captured selection, read back via {clip:1}…{clip:name}. DELIBERATELY not in
        // the fresh-run reset block — slots are captured ad hoc (capture hotkey, earlier runs)
        // and must survive into later runs, exactly like _cycleCursors. Session-lifetime; keys
        // are lowercased like _runtimeVariables so {clip:Name} and {clip:name} agree.
        private readonly Dictionary<string, string> _clipSlots = new();
        // Guards _clipSlots and _runtimeVariables where they cross threads: the capture
        // hotkey writes _clipSlots on the UI dispatcher while the replay thread reads it
        // (token resolution) and both threads copy both dicts for the live-variables pane
        // (a Dictionary enumerated concurrently with a resizing write throws). Writes and
        // copies are rare and tiny, so one coarse lock is plenty.
        private readonly object _runStateLock = new();
        // Sequential slot the capture hotkey writes to next: 1..9, wrapping. Session-lifetime.
        private int _nextHotkeySlot = 1;
        // Per-row skip-on-error (data loop). When the table opts in (OnRowError == "skip"),
        // an action-level failure marks the CURRENT ROW faulted instead of cancelling the
        // run: the action loop (and any RunProfile recursion) unwinds at its next boundary
        // check, StartAsync logs the row and continues with the next one. Replay-thread-only
        // state, reset per iteration.
        private bool _rowFaulted;
        private string? _rowFaultReason;
        // Return (D6): ends only the CURRENT ExecuteActionsAsync pass. The action loop's
        // boundary check breaks on it, and each of the three call sites clears it right
        // after its await, so the REMAINING passes (repeat-loop iterations, data rows,
        // root-loop iterations) still run. NEVER fold this into _rowFaulted: that flag
        // propagates through RunProfile recursion levels by design, and Return must not.
        // Replay-thread-only state, defensively reset at fresh-run.
        private bool _returnRequested;
        // Token cancellation used to mean exactly one thing: a user abort. The Stop action and
        // the Assert quiet-stop policy gave it a SECOND meaning — an authored SUCCESS finish —
        // and the end-of-run notices (skip summaries, lap notice) gate on the token to stay
        // quiet after a user abort. This flag threads the new meaning through those gates: an
        // authored finish is a normal finish, so notices about rows that genuinely failed (or
        // a completed cursor lap) still belong on screen. Set only by the two authored cancel
        // sites; reset at fresh-run.
        private bool _authoredStop;
        // Skip mode gates on the LIVE data-loop flag: the batch loop sets it, and so do the two
        // paths that walk a table inside one run — a For Each Data Row block and a caller's
        // Run once per data row (both hoist _dataLoopOver). A plain run, or cursor mode outside
        // those blocks, keeps the exact halt semantics it had.
        // _softFaultOverride: RunProfile-over-data (Phase C) sets it while a HALT-mode sub
        // table runs UNDER a skip-active parent batch — the fault sites must then FaultRow
        // (soft) instead of cancelling _cts, or one bad sub row would kill the whole parent
        // batch that skip-on-error exists to protect. Replay-thread-only, save/restored by
        // RunSubProfileOverDataAsync.
        private bool _softFaultOverride;
        // The CONFIGURED batch flag (what SetDataTable last decided). _dataLoopOver is the
        // LIVE flag, temporarily hoisted by sub-over-data calls and inline ForEachRow blocks;
        // the fresh-run reset re-stamps live from configured so no block-local hoist can
        // survive into the next run (layer 3 of the ForEachRow restore).
        private bool _dataLoopOverConfigured;
        private bool SkipRowOnErrorActive =>
            (_dataLoopOver && string.Equals(_dataTable?.OnRowError, "skip", StringComparison.OrdinalIgnoreCase))
            || _softFaultOverride;

        // Route an action-level failure while skip mode is active: mark the row faulted and
        // let the loops unwind. Keeps the FIRST reason (later failures are knock-on noise).
        //
        // The STEP is marked separately, by the caller, right before this — see the five skip
        // branches. This only sets row-level state, and the per-step finally promotes a step that
        // is still "running" to "ok", so a row the policy absorbed left a green step behind: the
        // run report showed every step fine, the chip counted zero failures, and a batch where
        // half the rows failed read as a clean run. Marking the step is what makes the amber
        // "N steps failed" reachable at all. The policy means "the row failed, the run went on" —
        // not "nothing failed".
        private void FaultRow(string reason)
        {
            _rowFaulted = true;
            _rowFaultReason ??= reason;
        }
        // Hard cap on how deep RunProfile chains can recurse. Prevents accidental infinite loops
        // even if cycle detection were somehow bypassed.
        private const int MaxCallDepth = 5;
        // Fires whenever the call stack changes so the host can update the status bar.
        // The argument is the current stack snapshot (empty when no sub-profile is running).
        private Action<List<string>>? _onChainChanged;

        public event Action<ActionItem>? OnActionExecuting;

        // ── Run report ──────────────────────────────────────────────────────────────────────
        //
        // One record per executed action, kept for the LAST run only. It exists because a browser
        // macro that breaks on DOM drift is otherwise undiagnosable after the fact: the engine
        // already computes which selector tier matched, which structured error code came back and
        // what the tip was, and then throws all of it away — the fallback match is written to the
        // session log and the success payload is dropped on the floor at the call site.
        //
        // Deliberately in memory and last-run-only: this is a debugging aid for the run you just
        // watched fail, not an audit trail. Persisting it would need a retention policy, a size
        // budget and a privacy answer (steps carry resolved text), none of which a diagnostic
        // panel is worth.
        public sealed class RunStepRecord
        {
            public int Row { get; set; }                  // 1-based grid row
            // WHICH profile's row 1 this is. Sub-profiles execute through the same
            // ExecuteActionsAsync loop, so a chained run interleaves rows from A and B that are
            // numbered independently — without this, "row 4 failed" is unreadable the moment a
            // RunProfile is involved, which is exactly when a report gets opened. Reference copy
            // off the call stack (CurrentExecutingProfileName), so it costs nothing per action.
            public string Profile { get; set; } = "";
            public string ActionType { get; set; } = "";
            public string? Detail { get; set; }           // selector / key / short label
            // running | ok | failed | skipped. Defaults to "running", NOT "ok": since 2.21.0 the
            // record is filed BEFORE the action executes, so a report requested mid-run publishes
            // steps that have not happened yet. Defaulting to "ok" painted those as green ticks
            // with 0 ms — including the step that was hanging, which is the one the panel gets
            // opened to diagnose. The finally below promotes running -> ok; every failure path
            // writes its own status before it.
            public string Status { get; set; } = "running";
            public long DurationMs { get; set; }
            // Browser diagnostics — null for every other action type.
            public string? ErrorCode { get; set; }        // ELEMENT_NOT_FOUND / HIDDEN / DISABLED / …
            public string? ErrorMessage { get; set; }
            public string? Tip { get; set; }
            // Set when the PRIMARY selector failed and a fallback tier matched instead: the single
            // most useful signal that a selector is drifting and should be re-picked.
            public string? MatchedSelector { get; set; }
            public string? MatchedTier { get; set; }
            // The page the step actually acted on. Recorded because "it ran on the wrong tab" is
            // otherwise invisible after the fact — the step passes, it just passed somewhere else.
            public string? TabUrl { get; set; }
        }

        // Bounded so a long-running loop cannot grow it without limit. When the cap is hit we stop
        // appending and count the overflow rather than dropping the FIRST steps — the beginning of
        // a run is where the setup that caused a later failure usually is.
        private const int MaxRunStepRecords = 500;
        private readonly List<RunStepRecord> _runSteps = new();
        private int _runStepsOverflow;
        private DateTime _runStartedAt;
        // Latches once the cap above is reached, so the per-action path can skip building a Detail
        // string that RecordRunStep is only going to throw away. Monotone within a run and reset by
        // ResetRunReport, so a plain volatile read is enough — no need to take the _runSteps lock
        // on a path that runs once per executed action of an unbounded loop.
        private volatile bool _runStepsFull;

        // How long the run actually took, captured when it ENDS. The status bar used to add the
        // step durations up, but a step's stopwatch deliberately wraps only its own work — the
        // configured Delay is waited before the record is even created — so ten clicks with a 1 s
        // delay each reported "0.2 s" for a run the user watched take ten seconds. Computing it in
        // the frontend instead was not an option: opening the run report re-pushes the same report
        // minutes later, and a wall-clock-now calculation would rewrite the number every time.
        private long _runElapsedMs;
        // Wall-clock minus the time the user had it paused, the same subtraction the live clock in
        // the status bar and the clicker loop already make.
        private long _runPausedAccumMs;

        /// <summary>Snapshot of the last run's step records (a copy — the list keeps mutating).</summary>
        public (List<RunStepRecord> Steps, int Overflow, DateTime StartedAt, long ElapsedMs) GetRunReport()
        {
            lock (_runSteps) return (new List<RunStepRecord>(_runSteps), _runStepsOverflow, _runStartedAt, _runElapsedMs);
        }

        // Which report is current. Handed out by ResetRunReport and checked by FinishRunReport, so
        // a run can only stamp the report it opened. An INT, not a bool: StartAsync cancels the
        // previous replay at its top, so the old run's finally can arrive after the new run has
        // already reset — a flag would let A carve its ending into B's report.
        private int _runReportGen;

        /// <summary>The current report's generation. Read by the bridge to tell runs apart.</summary>
        public int RunSequence { get { lock (_runSteps) return _runReportGen; } }

        /// <summary>
        /// Stamp the run's wall-clock duration. Called once, as the run finishes, with the
        /// generation that run was given. A stale generation stamps NOTHING: a replay cancelled
        /// before it reached ResetRunReport (gen 0) used to run this anyway and measure from the
        /// PREVIOUS run's start — so the earlier report was re-stamped with every idle minute
        /// since, and the status bar reported a two-second macro as having taken twenty.
        /// </summary>
        private void FinishRunReport(int gen)
        {
            lock (_runSteps)
            {
                if (gen == 0 || gen != _runReportGen) return;
                var total = (long)(DateTime.Now - _runStartedAt).TotalMilliseconds;
                _runElapsedMs = Math.Max(0, total - _runPausedAccumMs);
            }
        }

        /// <summary>Opens a fresh report and returns its generation.</summary>
        private int ResetRunReport()
        {
            lock (_runSteps)
            {
                _runSteps.Clear();
                _runStepsOverflow = 0;
                _runStepsFull = false;
                _runStartedAt = DateTime.Now;
                _runElapsedMs = 0;
                _runPausedAccumMs = 0;
                return ++_runReportGen;
            }
        }

        private void RecordRunStep(RunStepRecord rec)
        {
            lock (_runSteps)
            {
                if (_runSteps.Count >= MaxRunStepRecords) { _runStepsOverflow++; _runStepsFull = true; return; }
                _runSteps.Add(rec);
                if (_runSteps.Count >= MaxRunStepRecords) _runStepsFull = true;
            }
        }

        /// <summary>
        /// The one-line "what did this step act on" for the report. Kept SHORT and, for anything
        /// that types, kept to the RAW authored text — never the resolved value, which is where a
        /// password or a customer's details would be.
        /// </summary>
        /// <summary>
        /// Detail line for an IF row in the run report: what was probed, and what it answered.
        ///
        /// The outcome is the whole point. Before this, a conditional macro's report showed no
        /// evidence a condition had been evaluated at all — the reader saw the body rows of one
        /// branch and had to infer backwards which way it went, on the very macro where "it took
        /// the wrong branch" is the most likely complaint.
        ///
        /// `branchTrue` is null while the probe is still running (or when the whole block was
        /// skipped), so the row says what it is checking without claiming an answer it does not
        /// have yet.
        /// </summary>
        private static string? DescribeIfDetail(ActionItem a, bool? branchTrue, string? screenRead = null)
        {
            string probe = string.IsNullOrWhiteSpace(a.ConditionType) ? "condition" : a.ConditionType!;
            // IFNOT inverts the branch the user reads, so showing the raw probe result would
            // contradict the row they are looking at. Name the negation instead.
            if (a.ConditionNegate) probe = "NOT " + probe;
            string? label = a.Comment;
            if (!string.IsNullOrWhiteSpace(label))
            {
                label = label.Replace("\r", " ").Replace("\n", " ").Trim();
                if (label.Length > 40) label = label.Substring(0, 40) + "…";
                probe = $"{probe} · {label}";
            }
            if (branchTrue is null) return probe;
            var outcome = $"{probe} → {(branchTrue.Value ? "true" : "false")}";
            // Screen Text: what the engine read, so a branch that went the "wrong" way explains itself.
            if (screenRead != null)
            {
                var r = Clip40(screenRead);
                outcome += r.Length == 0 ? " · read nothing" : $" · read \"{r}\"";
            }
            return outcome;
        }

        private string? ScreenReadFor(ActionItem a) =>
            string.Equals(a.ConditionType, "ScreenText", StringComparison.OrdinalIgnoreCase) ? _lastScreenRead : null;

        private static string? DescribeStepDetail(ActionItem a)
        {
            static string? Clip(string? s, int max = 60)
            {
                if (string.IsNullOrEmpty(s)) return null;
                s = s.Replace("\r", " ").Replace("\n", " ").Trim();
                return s.Length <= max ? s : s.Substring(0, max) + "…";
            }
            switch (a.ActionType)
            {
                case "BrowserClick":
                case "BrowserRightClick":
                case "BrowserType":
                case "BrowserWaitElement":
                case "BrowserSelectOption":
                case "BrowserAssert":
                    return Clip(a.Key);                       // the selector
                case "BrowserNavigate":
                    return Clip(a.BrowserText ?? a.Key);      // the URL
                case "LeftClick":
                case "RightClick":
                case "MiddleClick":
                case "DoubleClick":
                case "TripleClick":
                case "LeftClickHold":
                case "RightClickHold":
                case "MiddleClickHold":
                    // At-cursor rows have no meaningful stored point — printing X/Y here would
                    // report a coordinate the run never used. The replay body overwrites this
                    // with the point it actually resolved, so a completed step reads
                    // "at cursor → 812, 344"; this string is what an in-flight row shows.
                    return a.AtCursor ? "at cursor" : $"{a.X}, {a.Y}";
                case "Keystroke":
                case "KeyDown":
                case "KeyUp":
                case "HoldKey":
                    return Clip(a.Key, 30);
                case "SetVariable":
                case "CopyToSlot":
                    return Clip(a.Key, 30);
                case "WaitText":
                    return Clip(a.Comment) ?? Clip(string.Equals(a.WaitMode, "changes", StringComparison.OrdinalIgnoreCase) ? "changes" : ScreenTextMatcher.Summary(a));
                case "RunProfile":
                case "ActivateWindow":
                case "WaitImage":
                case "WaitPixelColor":
                // "If" is NOT here: IF rows never reach this switch — they are recorded from the
                // conditional block above, through DescribeIfDetail, which also carries the
                // branch outcome. Assert does come through here, sharing the same shape.
                case "Assert":
                    return Clip(a.Comment) ?? Clip(a.Key, 30);
                default:
                    return null;                              // SendText etc — the text is the payload
            }
        }
        public event Action<string, int>? OnReplayPaused;
        public event Action? OnReplayResumed;
        // Surfaced when an action can't proceed for a structural reason (e.g. profile uses
        // relative coords but the target window isn't running). ReplayService wires this to
        // its onStatusChanged with the "error:" prefix so the bridge alerts the user.
        public Action<string>? OnReplayError;
        // Cursor mode: the run just consumed the last row of the data table (arg = row count).
        // Benign/informational — deliberately NOT routed through OnReplayError, which the host
        // renders as a red error toast.
        public Action<int>? OnDataLapCompleted;

        // End-of-run tally: "N row(s) skipped after errors". The SAME reason OnDataLapCompleted
        // has its own channel, learned the hard way: these notices went out through OnReplayError,
        // which ReplayService prefixes with "error:" and PushStatusChange reads on the
        // replaying→ready edge — so a run that reached the end with the skip policy doing exactly
        // what it was configured to do came back stamped outcome="failed", and the status bar
        // painted a red "run failed" over a finished batch. The text is unchanged: it always was
        // a summary, not a failure.
        public Action<string>? OnRunSummary;

        // Cursor mode: the row cursor moved (arg = 0-based row the NEXT run will consume). Fires
        // once per run, at the top, right where the advance happens. Its own channel rather than
        // a re-push of the whole table: the table can be thousands of cells and none of them
        // changed — only where the marker sits.
        public Action<int>? OnRowCursorChanged;

        // Pre-flight: this run needs the Chrome extension and the bridge is down (arg = how many
        // rows need it). Its own channel for the same reason OnDataLapCompleted has one, plus a
        // second: OnReplayError routes through PushStatusChange, which turns any "error:" into
        // status "ready" — raising it at KICKOFF would tell the frontend the run had already
        // ended. Warning only; the run proceeds.
        public Action<int>? OnBrowserExtensionMissing;

        // {input:Label} Ask-Input modal round-trip, raised from the token resolver. OnInputRequested
        // asks the host to show the prompt; the host later calls CompleteInput with the answer.
        // OnInputDismissed tells the host to close a still-open prompt (on cancel / Stop).
        public event Action<string, string, string[]?>? OnInputRequested;   // (requestId, label, menu?)
        public event Action<string>? OnInputDismissed;                       // (requestId)
        private readonly System.Collections.Concurrent.ConcurrentDictionary<string, TaskCompletionSource<string?>> _pendingInputs = new();
        // An {input:} prompt with no answer aborts the run after this, instead of pausing the single
        // replay engine forever (an unattended automation would otherwise block it and starve every
        // other trigger). A present, hotkey-driven user beats 60 s easily; timeout = clean cancel.
        private const int InputTimeoutMs = 60_000;

        // Live-variables snapshot for the frontend debug pane: (variables, clip slots, current
        // data row or null). Raised on the dispatcher with COPIES of the dictionaries (the live
        // ones mutate on the replay thread). Forced on user-meaningful writes (SetVariable, input
        // answer, slot capture) and run start; per-iteration bumps ride a small throttle.
        public event Action<Dictionary<string, string>, Dictionary<string, string>, Dictionary<string, string>?>? OnVariablesChanged;
        private long _lastVariablesPushTick;

        public ActionReplayer(ObservableCollection<ActionItem> actions, DispatcherQueue dispatcherQueue, BrowserBridgeService? browserBridge = null)
        {
            _actions = actions;
            this.dispatcherQueue = dispatcherQueue;
            _browserBridge = browserBridge;
        }

        // Reset a cycle row's position back to item 1. Removes the cursor entry for
        // this action under the ACTIVE UI profile (the profile the user is looking at
        // when they right-click the row), so the next execution starts at the first
        // item again. No-op when the row never cycled (no entry yet). Keyed the same
        // way ExecuteSetVariable creates the entry — profile name + '|' + action Id.
        public void ResetCycleCursor(string actionId)
        {
            if (string.IsNullOrEmpty(actionId)) return;
            var profile = _getProfileName?.Invoke() ?? "default";
            RunCursorService.RemoveCycle(profile + "|" + actionId);
        }

        // Reset the data-loop row cursor (Model B) to the first row for the active UI
        // profile — the "start over" the table can't trigger itself. Keyed the same way
        // StartAsync reads it. No-op when the profile never cursored.
        public void ResetRowCursor()
        {
            var profile = _getProfileName?.Invoke() ?? "default";
            RunCursorService.RemoveRow(profile);
        }

        // Where the row cursor stands: the 0-based row the NEXT run will consume. -1 = this
        // profile has never cursored, which the UI renders the same as row 0 (StartAsync's read
        // falls back to 0 on a missing key) — but the caller can tell the two apart.
        public int GetRowCursor()
        {
            var profile = _getProfileName?.Invoke() ?? "default";
            return RunCursorService.TryGetRow(profile, out int row) ? row : -1;
        }

        // Park the cursor on a specific row — the fine-grained twin of ResetRowCursor, which only
        // ever means "back to row 1". It exists because the cursor advances at the TOP of a run:
        // a run the user stops, or one that dies on its first action, has already consumed its
        // row, and without this the only recovery was to reset to the top and walk the whole list
        // again. Persisted immediately (see RunCursorService.SetRow) — this is a user gesture,
        // not the replay's own bookkeeping.
        public void SetRowCursor(int rowIndex)
        {
            if (rowIndex < 0) return;
            var profile = _getProfileName?.Invoke() ?? "default";
            RunCursorService.SetRow(profile, rowIndex, immediate: true);
        }

        public void SetProfileNameProvider(Func<string> getProfileName)
        {
            _getProfileName = getProfileName;
        }

        // The profile whose action list is CURRENTLY executing. During a RunProfile sub-call this
        // is the sub-profile (top of the call stack), NOT the root profile shown in the UI.
        // _getProfileName always returns the UI's active profile, so image-based actions that
        // resolve their reference image per-profile (WaitImage, If/ImageFound) must use THIS
        // instead — otherwise a sub-profile's image is looked up under the parent's folder, fails
        // to load, and the action silently no-ops (WaitImage: skips the wait + OnTimeout policy;
        // If/ImageFound: always reads "not found"). The call stack always holds at least the root
        // (pushed in StartAsync) by the time any action runs; the _getProfileName fallback only
        // guards the degenerate empty-stack case.
        private string CurrentExecutingProfileName =>
            _callStack.Count > 0 ? _callStack[^1] : (_getProfileName?.Invoke() ?? "default");

        public void SetProfileLookup(Func<string, Task<Models.UserProfile?>> lookup)
        {
            _profileLookup = lookup;
        }

        public void SetFolderInheritedContextLookup(Func<string, Controllers.ProfileController.FolderInheritedContext?> lookup)
        {
            _folderInheritedContextLookup = lookup;
        }

        public void SetChainChangedCallback(Action<List<string>> callback)
        {
            _onChainChanged = callback;
        }

        public void SetLoopOptions(int loopCount, int loopInterval)
        {
            // A negative count folds to ONE pass, not zero. Zero is read as "infinite" by
            // StartAsync, so the old `: 0` turned a corrupt/negative value into an endless run
            // that owns the engine with no Stop reachable from the tray. Unreachable today
            // (BuildLoopConfig clamps to 1..999 before this), but the rule that matters is:
            // SetForceInfiniteLoop is the ONLY legal way to produce an infinite macro run.
            // loopCount == 0 still arrives legitimately from loop-over-data with zero rows —
            // StartReplay refuses that case before it gets here.
            _loopCount = loopCount >= 0 ? loopCount : 1;
            _loopInterval = loopInterval >= 0 ? loopInterval : 0;
        }

        // Data-loop: hand the replayer the active profile's table + whether to loop over it.
        // Both null/false when the feature is off (byte-identical behaviour). Called once per
        // run in ReplayService.StartReplay, before StartAsync.
        public void SetDataTable(Models.ProfileDataTable? dataTable, bool loopOverData)
        {
            // Normalize null Headers/Rows — a hand-edited / corrupt imported .trprofile can
            // deserialize {"rows":null} to a null list, and the loop/BuildRowDict paths
            // dereference these without further guards. Import is a trust boundary.
            if (dataTable != null)
            {
                dataTable.Headers ??= new System.Collections.Generic.List<string>();
                dataTable.Rows ??= new System.Collections.Generic.List<System.Collections.Generic.List<string>>();
            }
            _dataTable = dataTable;
            _dataLoopOver = loopOverData && dataTable != null;
            // Belt-and-braces (layer 3 of the ForEachRow restore): remember what the
            // CONFIGURED value is, so the fresh-run reset can re-stamp _dataLoopOver even
            // if some future exit path leaks a block-local true past the layer-2 net.
            _dataLoopOverConfigured = _dataLoopOver;
        }

        // Builds the column→cell dict for one data row: lowercased header → cell value.
        // Short rows are tolerated (missing trailing cells resolve empty); duplicate headers
        // keep the LAST occurrence (last-writer-wins, same as a plain dictionary assign).
        private static IReadOnlyDictionary<string, string> BuildRowDict(Models.ProfileDataTable table, int rowIndex)
        {
            var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var row = table.Rows[rowIndex];
            for (int c = 0; c < table.Headers.Count; c++)
            {
                var header = table.Headers[c]?.Trim();
                if (string.IsNullOrEmpty(header)) continue;
                dict[header] = c < row.Count ? (row[c] ?? string.Empty) : string.Empty;
            }
            return dict;
        }

        private bool _useRelativeCoordinates = false;
        private Models.WindowTarget? _windowTarget;
        // Cached compiled regex for _windowTarget.WindowTitle. Recomputed whenever
        // _windowTarget is reassigned (SetRelativeCoordinates or sub-profile context swap).
        // Avoids recompiling every SimulateMouse call inside a long replay loop.
        private System.Text.RegularExpressions.Regex? _windowTargetTitleRegex;
        private int _lockWidth = 0;
        private int _lockHeight = 0;
        private int _lockX = 0;
        private int _lockY = 0;
        private bool _restorePosition = false;
        private bool _restoreSize = false;
        // One-shot latch for the relative-coordinate geometry-drift warning — see
        // WarnRelativeGeometryDrift. Read on the mouse hot path (twice per click), so it is
        // deliberately the FIRST term of the guard: once the warning has fired the whole check
        // collapses to a single bool test. Cleared per RUN, not per sub-profile: a RunProfile
        // called 200 times in a loop must not write 200 identical lines to the session log.
        private bool _relGeometryDriftWarned;

        private bool _bringToFocus = false;

        public void SetRelativeCoordinates(bool enabled, Models.WindowTarget? target, int lockWidth = 0, int lockHeight = 0, int lockX = 0, int lockY = 0, bool restorePosition = false, bool restoreSize = false)
        {
            _useRelativeCoordinates = enabled;
            _windowTarget = target;
            _windowTargetTitleRegex = TrueReplayer.Helpers.WindowMatcher.CompileTitleRegex(target);
            _lockWidth = lockWidth;
            _lockHeight = lockHeight;
            _lockX = lockX;
            _lockY = lockY;
            _restorePosition = restorePosition;
            _restoreSize = restoreSize;
        }

        public void SetBringToFocus(bool enabled)
        {
            _bringToFocus = enabled;
        }

        private bool _useDelayVariation = false;
        private int _delayVariationPercent = 20;

        public void SetDelayVariation(bool enabled, int percent)
        {
            _useDelayVariation = enabled;
            _delayVariationPercent = Math.Clamp(percent, 0, 50);
        }

        // Forced infinite loop (set by WhilePressed trigger mode, overrides profile's LoopCount)
        private bool _forceInfiniteLoop = false;
        public void SetForceInfiniteLoop(bool enabled) => _forceInfiniteLoop = enabled;

        public async Task StartAsync()
        {
            // Atomically swap _cts so any in-flight callers that read the field after this
            // line see the NEW cts immediately. Without Interlocked.Exchange there's a window
            // where an internal cancel path (e.g. ReportMissingTargetWindow → _cts?.Cancel())
            // could fire AFTER we reassign _cts and end up cancelling the new replay's CTS.
            // Disposing the old cts is fire-and-forget on a background task — gives any sync
            // loop sections of the old replay time to finish without us blocking StartAsync,
            // AND ObjectDisposedException on any straggler Cancel is swallowed inside the
            // continuation so the new replay doesn't crash.
            var oldCts = System.Threading.Interlocked.Exchange(ref _cts, new CancellationTokenSource());
            var token = _cts!.Token;
            if (oldCts != null)
            {
                try { oldCts.Cancel(); } catch (ObjectDisposedException) { /* already gone */ }
                _ = Task.Delay(500).ContinueWith(_ => { try { oldCts.Dispose(); } catch { } }, TaskScheduler.Default);
            }
            // Cursor return: where the cursor was when the run was fired. Read HERE, before the
            // yield — this synchronous prefix still runs on the thread that started the run (button,
            // hotkey, automation), so it is the position "before the trigger", not one the first
            // action may already have moved. Read always (cheap); whether it is used is decided at
            // the end, against the effective value then.
            bool haveCursorOrigin = NativeMethods.GetCursorPos(out var cursorOrigin);
            await Task.Yield(); // preserve the original "yield before kickoff" behaviour
            int iteration = 0;
            bool isInfinite = _forceInfiniteLoop || _loopCount == 0;
            // Status-bar loop counter only makes sense for actual loops. Single-run replays
            // (loopCount=1, not infinite) execute the macro once and end — no counter to
            // overlay. Computed once here so the lambda captures stay simple.
            bool emitLoopProgress = isInfinite || _loopCount > 1;
            int loopProgressTotal = isInfinite ? 0 : _loopCount;
            _lastLoopProgressMs = 0;

            // Snapshot the actions list to avoid crashes from concurrent modifications
            var snapshot = _actions.ToList();

            // Pre-flight for the Chrome extension. Browser ACTIONS already fail loudly when the
            // bridge is down (ExecuteBrowserCommandAsync throws "Browser extension is not
            // connected"), but browser CONDITIONS do not: ProbeBrowserElementStateAsync returns
            // false, which is indistinguishable from the element genuinely being absent, so an
            // If/While takes the ELSE arm and the macro walks a path the user never chose —
            // silently, with a run report full of green. Said once, at kickoff, while there is
            // still time to act; the indicator in the status bar is the standing half of this.
            //
            // Counted off the SNAPSHOT (what will actually run), not the live list. Warning only:
            // a probe deliberately used as "is Chrome even there" is a legitimate macro, so this
            // must not decide the run is wrong — only that the user should know.
            int browserRows = snapshot.Count(a =>
                (a.ActionType?.StartsWith("Browser", StringComparison.OrdinalIgnoreCase) ?? false)
                || (a.CarriesConditionProbe
                    && string.Equals(a.ConditionType, "BrowserElementState", StringComparison.OrdinalIgnoreCase)));
            if (browserRows > 0 && _browserBridge?.IsConnected != true)
            {
                Services.DiagnosticLog.Warn(
                    $"Replay pre-flight: {browserRows} row(s) need the Chrome extension and the bridge is not connected.");
                // Raised raw, like OnDataLapCompleted: the ReplayService forwarder is what
                // marshals to the dispatcher. Enqueueing here too would just cost a second hop.
                OnBrowserExtensionMissing?.Invoke(browserRows);
            }

            bool raisedTimerRes = false;
            // Set when the run ends by THROWING rather than by cancellation (see the finally).
            bool faulted = false;
            _waitedOnUser = false;
            // Which report this run is allowed to stamp. Stays 0 until ResetRunReport claims one —
            // a run cancelled before it gets that far owns no report and must stamp nothing.
            int reportGen = 0;

            try
            {
                // Ask for a 1 ms system timer for the whole replay. Task.Delay quantises to
                // the timer period (~15.6 ms by default), so without this every configured
                // delay silently rounds up to the next ~15.6 ms multiple. Unlike the clicker
                // there is no slow-run gate: its `nominalPeriod < 30` check protects an idle
                // 1-click-per-second job, whereas a replay executes actions continuously and
                // Game Mode's cursor interpolation sleeps 2/10 ms between steps regardless of
                // the configured delays. Released in the finally — the setting is
                // process-wide and sticky.
                NativeMethods.TimeBeginPeriod(1);
                raisedTimerRes = true;

                // WhilePressed (forceInfiniteLoop) is semantically "run while the key is held"
                // — waiting for the user to release the hotkey before starting would defeat
                // the entire purpose. Skip the release wait in that mode.
                if (!_forceInfiniteLoop)
                    await WaitForHotkeyReleaseAsync(token);

                // Release any physically-held modifier keys from the target app's perspective.
                // Without this, a combined hotkey like Alt+Q leaves Alt "pressed" in the target
                // while the replay runs, turning every simulated keystroke into Alt+<key> (so a
                // plain KeyDown A becomes Alt+A in the target). The user's real Alt release later
                // will send a duplicate keyup which is harmless.
                ReleasePhysicallyHeldModifiers();

                // Bring to Focus + Restore Position / Restore Size, through the same code a
                // sub-profile entry uses (ApplyWindowContextAsync — full activation stack,
                // best-effort: a refused switch doesn't block the run), on a POOL thread. This
                // point still runs on the thread that called StartAsync, the UI thread; the
                // activation and the move wait on the target's own thread, and against a busy or
                // frozen target that froze the UI thread with them. While the low-level hooks still
                // pumped on that thread, it froze every key and click on the machine too, behind
                // LowLevelHooksTimeout, and the Stop hotkey, which arrives through that hook,
                // could not stop the run it was stuck in. This copy also used to be a hand-kept
                // twin of ApplyWindowContextAsync, and the root run had fallen behind it: no
                // off-screen clamp on the restored position. Settle 300 ms after the activation,
                // as the top of a run always waited.
                await Task.Run(() => ApplyWindowContextAsync(token, settleMs: 300), token);

                // Reset the call stack at the start of every replay run (in case a previous
                // run was canceled mid-sub-profile, leaving stack residue). Push the ROOT
                // profile name so cycle detection treats "A directly invoked → B → A" as a
                // cycle. Without this, the root would be invisible to RunProfile and a
                // sub-profile could re-call its own grandparent recursively.
                _callStack.Clear();
                var rootName = _getProfileName?.Invoke();
                if (!string.IsNullOrEmpty(rootName))
                    _callStack.Add(rootName);
                NotifyChainChanged();

                // Fresh run = fresh run state: variables from a previous run must not leak in,
                // and the counter/row read as "not started" until the loop below stamps them.
                lock (_runStateLock) _runtimeVariables.Clear();
                _pendingTokenKeyDowns.Clear();
                _currentIteration = 0;
                _currentActionRow = 0;
                _currentLoopIteration = 0;
                _currentDataRow = 0;
                _rowNextCursors.Clear();   // {rownext:col} — restart the per-column walk each run
                _currentRowData = null;
                _rowFaulted = false;
                _rowFaultReason = null;
                _returnRequested = false;  // defensive: a Return must never leak in from a prior run
                _authoredStop = false;     // idem for an authored Stop / quiet-stop
                _dataLoopOver = _dataLoopOverConfigured;   // layer-3: no ForEachRow hoist survives a run boundary
                _softFaultOverride = false;
                _relGeometryDriftWarned = false;   // one geometry-drift notice per run
                _unknownConditionTypesWarned.Clear();   // one notice per bad family per run — see InstantProbe
                reportGen = ResetRunReport();   // the report describes THIS run only
                // Each run picks its browser tab afresh. Inheriting the previous run's tab would
                // aim a macro at a page the user has since navigated away from.
                _browserBridge?.ResetTabPin();
                PushVariablesSnapshot(force: true); // live pane: run started, variables cleared

                // Data-loop CURSOR (Model B): table present but "loop over data" OFF → this
                // whole run uses ONE row (the per-profile cursor's current row); the cursor
                // then advances (wrapping) for the next run. Resolved ONCE here (not per
                // iteration) so an inner loop repeats the SAME row — "each run = one row".
                // Batch mode (_dataLoopOver) leaves this null and stamps per-iteration below.
                IReadOnlyDictionary<string, string>? cursorRowData = null;
                int cursorRow = 0;   // {datarow} under Model B: the cursor row, 1-based
                int lapCompletedRows = 0;
                if (!_dataLoopOver && _dataTable != null && (_dataTable.Rows?.Count ?? 0) > 0)
                {
                    string rowKey = _getProfileName?.Invoke() ?? "default";
                    int rowN = _dataTable.Rows!.Count;
                    int cur = RunCursorService.TryGetRow(rowKey, out var cv) ? ((cv % rowN) + rowN) % rowN : 0;
                    cursorRowData = BuildRowDict(_dataTable, cur);
                    cursorRow = cur + 1;
                    // ADVANCE HAPPENS HERE, at the TOP of the run — before a single action has
                    // executed. So one hotkey press consumes exactly one row no matter what
                    // follows, including a run the user Stops and a run that dies on its first
                    // action. That predictability is the point (and it matches {clipboard:next},
                    // which also consumes at use rather than on success), but it does mean a
                    // mis-fired run silently burns a row. The answer is NOT to move this to the
                    // end and guess at "success" — the engine has no such boolean, and a repeated
                    // row is the worse failure because the RECIPIENT sees it. The answer is that
                    // the position is now visible in the Data panel and one click puts it back:
                    // OnRowCursorChanged below pushes it, SetRowCursor moves it.
                    int nextRow = (cur + 1) % rowN;
                    RunCursorService.SetRow(rowKey, nextRow);
                    // Raised raw; the ReplayService forwarder marshals to the UI thread (same
                    // shape as OnDataLapCompleted right below).
                    OnRowCursorChanged?.Invoke(nextRow);
                    // Lap complete = this run consumed the LAST row, so the next one wraps to
                    // the top. Detected HERE (not at the wrap) so the notice fires while it is
                    // still true — "that was the last one" — instead of after row 1 was already
                    // re-sent. Suppressed for a single-row table, where every run would qualify.
                    if (rowN > 1 && cur == rowN - 1 && _dataTable.NotifyOnLapComplete != false)
                        lapCompletedRows = rowN;
                }

                // Task.Run, not Task.Factory.StartNew(..., LongRunning, ...): LongRunning
                // spawns a dedicated non-pool thread that exits at the first await inside the
                // loop, so every continuation ran on the pool anyway — the thread was created
                // and thrown away. Same anti-pattern the clicker loop documents.
                int skippedRows = 0;
                string? firstSkipNote = null;
                await Task.Run(async () =>
                {
                    while (!token.IsCancellationRequested && (isInfinite || iteration < _loopCount))
                    {
                        iteration++;
                        _currentIteration = iteration; // {counter} token source (1-based)
                        // Data-loop: stamp the current row so {row:column} resolves to it.
                        // Batch (loop-over-data): 1-based iteration → 0-based row index, guarded
                        // against a corrupt count. Cursor mode (Model B): the fixed cursor row
                        // for every iteration. Neither: null → {row:column} resolves empty.
                        _currentRowData = (_dataLoopOver && _dataTable != null && iteration - 1 < (_dataTable.Rows?.Count ?? 0))
                            ? BuildRowDict(_dataTable, iteration - 1)
                            : cursorRowData;
                        // {datarow}: the same choice as a NUMBER — the batch iteration, or the cursor row.
                        _currentDataRow = _currentRowData == null ? 0 : (_dataLoopOver ? iteration : cursorRow);
                        _rowFaulted = false;
                        _rowFaultReason = null;

                        // Throttled status-bar update. First iteration is always pushed so the
                        // counter appears immediately; subsequent iterations are coalesced to
                        // ~4 Hz to avoid flooding the message channel on tight loops (e.g. a
                        // macro that's basically "press key + 10 ms delay" running infinite).
                        if (emitLoopProgress)
                        {
                            long nowMs = Environment.TickCount64;
                            if (iteration == 1 || nowMs - _lastLoopProgressMs >= 250)
                            {
                                _lastLoopProgressMs = nowMs;
                                int capturedIteration = iteration;
                                dispatcherQueue.TryEnqueue(() => OnLoopProgress?.Invoke(capturedIteration, loopProgressTotal));
                            }
                        }
                        PushVariablesSnapshot(); // live pane: counter/{row:col} moved (throttled)

                        try
                        {
                            await ExecuteActionsAsync(snapshot, token);
                        }
                        // Skip mode also absorbs the FAULTING error paths (browser action
                        // exceptions, If-probe Halt rethrows). A genuine Stop/cancel (token
                        // cancelled) must keep unwinding the whole run — but a SPURIOUS OCE
                        // (e.g. a pipe drop resolving an in-flight TCS with no token behind
                        // it) is just another row error, so only the token-backed one rethrows.
                        catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
                        catch (Exception ex) when (SkipRowOnErrorActive)
                        {
                            FaultRow(ex.Message);
                        }

                        // Return (D6): consumed AFTER the await, never in the while condition —
                        // it ended THIS iteration's pass; the remaining iterations are the point.
                        _returnRequested = false;

                        if (_rowFaulted)
                        {
                            // Release anything the faulted row left pressed BEFORE moving on —
                            // the engine's stuck-input recovery (StartAsync's finally) is gated
                            // on cancellation, which skip mode deliberately avoids. A KeyDown
                            // whose matching KeyUp was skipped would otherwise stay stuck for
                            // every remaining row and past the end of the run. Both resets are
                            // lock-guarded no-ops when nothing is down.
                            ResetMouseState();
                            ResetKeyState();
                            skippedRows++;
                            var reason = _rowFaultReason ?? "error";
                            firstSkipNote ??= $"row {iteration}: {reason}";
                            Services.DiagnosticLog.Warn($"Data loop: row {iteration} skipped — {reason}");
                            _rowFaulted = false;
                            _rowFaultReason = null;
                        }

                        if (!token.IsCancellationRequested && (isInfinite || iteration < _loopCount) && _loopInterval > 0)
                            await Task.Delay(_loopInterval, token);
                    }
                }, token);

                // One honest end-of-run summary instead of a toast per skipped row. Rides the
                // error channel on purpose: rows DID fail; the log has the per-row reasons.
                // _authoredStop re-opens the gate: a Stop/quiet-stop finish reads as a normal
                // success, and a success cue that hides "2 rows failed" would be a lie.
                if (skippedRows > 0 && (!token.IsCancellationRequested || _authoredStop))
                    OnRunSummary?.Invoke($"Data loop finished — {skippedRows} of {_loopCount} row(s) skipped after errors (first: {firstSkipNote})");

                // Cursor-mode lap notice. Armed at the top of the run (the cursor advances
                // there, so it is already known), announced here so it lands with the run's
                // own end-of-run cue rather than before the row was actually used. Not raised
                // on a user Stop: the host's run-end notifier suppresses those too, and being
                // told "list complete" right after aborting is noise.
                // Same _authoredStop re-open as the skip summary: an authored finish that
                // consumed the last row still owes the "lap complete" signal.
                if (lapCompletedRows > 0 && (!token.IsCancellationRequested || _authoredStop))
                    OnDataLapCompleted?.Invoke(lapCompletedRows);
            }
            // OperationCanceledException is the BASE type (TaskCanceledException derives from it),
            // so this catches both. A plain Stop during a Pause or an instant probe surfaces a bare
            // OperationCanceledException (ExecutePause's ThrowIfCancellationRequested, InstantProbe's
            // rethrow) — catching only TaskCanceledException let it escape and fault the run, making
            // StartReplay's continuation show a spurious "error:" toast on a normal cancel.
            catch (OperationCanceledException) { }
            catch
            {
                faulted = true;
                throw;
            }
            finally
            {
                // Always paired with TimeBeginPeriod — the resolution is process-wide.
                if (raisedTimerRes) NativeMethods.TimeEndPeriod(1);

                // Final push so the StatusBar lands on the actual completion count regardless
                // of where the throttle happened to be. Skipped when no iterations ran (early
                // cancel before the loop body) — pushing "Loop 0/N" would look broken.
                if (emitLoopProgress && iteration > 0)
                {
                    int capturedFinal = iteration;
                    dispatcherQueue.TryEnqueue(() => OnLoopProgress?.Invoke(capturedFinal, loopProgressTotal));
                }

                // Release any button/key the replay left pressed when it was cancelled. This
                // runs after the replay task has fully completed, so an in-flight SimulateMouse/
                // SimulateKey (whose Thread.Sleep window Stop's own ResetMouseState may have
                // raced) has finished and recorded its state — closing the stuck-button/key
                // race. Idempotent with Stop()'s reset (lock-guarded, no-op when nothing down).
                //
                // A run that ends by THROWING is over just as surely, and it cancels nothing: a
                // browser action failing under Halt, an If probe's Halt rethrow. Gated on the token
                // alone, that ending skipped this release and left the KeyDown W or LeftClickDown
                // the row before it pressed system-wide after the error toast — for the keys and the
                // buttons nothing else ever releases. A NATURAL end still leaves them as authored.
                if (token.IsCancellationRequested || faulted)
                {
                    ResetMouseState();
                    ResetKeyState();
                }

                // Cursor return — every ending (finish, Stop, error) passes through here, and it
                // runs AFTER the release above so nothing is held while the cursor moves.
                if ((_runRestoreCursor ?? RestoreCursorDefault) && haveCursorOrigin)
                    RestoreCursorToOrigin(cursorOrigin);

                _callStack.Clear();
                NotifyChainChanged();
                // Stamp the duration here, at the one place every ending passes through — normal
                // finish, Stop, error — so a report pulled minutes later still reports the run.
                FinishRunReport(reportGen);
                PushVariablesSnapshot(force: true); // live pane: land on the final state
            }
        }

        /// <summary>
        /// End-of-run half of the cursor return. SetCursorPos ONLY — the Raw-Input-silent move the
        /// fast approach also uses: no move INPUT, so a game reading raw deltas sees no camera
        /// flick, and Windows still posts the WM_MOUSEMOVE itself. Not the Game Mode walk: this is
        /// the end of the run, not a click anyone has to accept.
        ///
        /// Refused when a mouse button is still down: a NATURAL end leaves a LeftClickDown without
        /// its Up pressed as authored (the release in the finally is for Stop and errors only), and
        /// moving then would drag whatever is under the cursor and drop it at the origin.
        /// </summary>
        private void RestoreCursorToOrigin(NativeMethods.POINT origin)
        {
            bool buttonHeld;
            lock (_simInputLock) buttonHeld = _simLeftDown || _simRightDown || _simMiddleDown;
            if (buttonHeld)
            {
                Services.DiagnosticLog.Warn($"Cursor not restored to ({origin.x},{origin.y}): a mouse button is still held at the end of the run.");
                return;
            }
            if (NativeMethods.SetCursorPos(origin.x, origin.y))
                Services.DiagnosticLog.Info($"Cursor restored to ({origin.x},{origin.y})");
            else
                Services.DiagnosticLog.Warn($"Cursor not restored to ({origin.x},{origin.y}): SetCursorPos failed.");
        }

        /// <summary>
        /// Executes a flat list of actions sequentially. Reentrant: a RunProfile action invokes
        /// this method again with the sub-profile's actions. Honors the same cancellation token,
        /// delay variation and skip behavior as the top-level loop.
        /// </summary>
        // ── Conditional logic: block map ─────────────────────────────────────
        // Single O(n) pass over the action list pre-computing:
        //   nextBranchOf[armIdx] = index of the NEXT branch marker in the same block —
        //                       IF → ELSEIF → ELSEIF → … → ELSE. Absent on the last arm.
        //                       With no ELSEIF rows this degenerates to the old
        //                       elseOf[ifIndex] = index of the matching ELSE.
        //   endIfOf[armIdx]  = index of the matching ENDIF, recorded for EVERY arm (the IF,
        //                       each ELSEIF and the ELSE) so the engine can jump from inside
        //                       a TAKEN branch's body — when it hits the next branch
        //                       boundary — all the way to the closing ENDIF, skipping every
        //                       remaining branch body.
        // Orphan ELSEIF / ELSE / ENDIF (no open IF on the stack) are silently ignored at
        // runtime; the load-time validator should have stripped them, but the engine stays
        // graceful if a hand-edited profile slipped through.
        // The three block-opening kinds. If closes with EndIf (and may own a chain of ElseIf
        // arms plus one Else); While and ForEachRow share the one EndLoop closer. ElseIf does
        // NOT open a block — it never pushes, exactly like Else.
        internal enum BlockKind { If, While, ForEachRow }

        // Pre-pass index maps for one action list. TYPED stack underneath: EndIf only ever
        // closes an If, EndLoop only a loop opener, and Else/ElseIf only pair with an If
        // sitting on TOP — the kind checks are what keep an Else inside a While from leaking
        // into the outer If (a latent bug the untyped int-stack would have had).
        private sealed class BlockMap
        {
            public readonly Dictionary<int, int> NextBranchOf = new(); // arm idx → next arm idx
            public readonly Dictionary<int, int> EndIfOf = new();    // every arm idx → EndIf idx
            public readonly Dictionary<int, int> EndLoopOf = new();  // While/ForEachRow idx → EndLoop idx
            public readonly Dictionary<int, int> LoopStartOf = new();// EndLoop idx → its opener idx
            // BreakLoop/ContinueLoop idx → innermost enclosing loop (kind + opener idx).
            // The closer's index is resolved at execution via EndLoopOf — it isn't known
            // yet when the jump row is scanned.
            public readonly Dictionary<int, (BlockKind Kind, int OpenIdx)> EnclosingLoopOf = new();
        }

        // Human-readable loop kind for the Break/Continue run-report detail. The grid labels are
        // "While" and "For Each Data Row", so the report names the row the user is looking at.
        private static string DescribeLoopKind(BlockKind kind) =>
            kind == BlockKind.ForEachRow ? "For Each Data Row" : "While";

        private static BlockMap BuildBlockMap(List<ActionItem> actions)
        {
            var map = new BlockMap();
            var stack = new Stack<(BlockKind Kind, int Idx)>();
            // Per OPEN If: the TAIL of its branch chain (the arm a new one links from) and
            // whether a terminal Else has already claimed it. Side tables rather than fields on
            // the stack frame so the frame stays the plain value tuple the loop families share.
            // Keyed by the If's own index, so nested blocks can never collide.
            var lastArmOf = new Dictionary<int, int>();
            var elseClaimed = new HashSet<int>();
            for (int i = 0; i < actions.Count; i++)
            {
                var t = actions[i].ActionType;
                if (string.Equals(t, "If", StringComparison.OrdinalIgnoreCase))
                {
                    stack.Push((BlockKind.If, i));
                    lastArmOf[i] = i;          // the IF is its own chain head
                }
                else if (string.Equals(t, "While", StringComparison.OrdinalIgnoreCase))
                {
                    stack.Push((BlockKind.While, i));
                }
                else if (string.Equals(t, "ForEachRow", StringComparison.OrdinalIgnoreCase))
                {
                    stack.Push((BlockKind.ForEachRow, i));
                }
                else if (string.Equals(t, "ElseIf", StringComparison.OrdinalIgnoreCase))
                {
                    // Links onto the chain of the If sitting on TOP, and only while no terminal
                    // Else has claimed it yet — an ELSEIF *after* the ELSE is unreachable by
                    // construction, so the validator strips it and the engine ignores it here.
                    // Same agreement rule as the first-Else-wins case below.
                    if (stack.Count > 0 && stack.Peek().Kind == BlockKind.If)
                    {
                        int ifIdx = stack.Peek().Idx;
                        if (!elseClaimed.Contains(ifIdx) && lastArmOf.TryGetValue(ifIdx, out int tail))
                        {
                            map.NextBranchOf[tail] = i;
                            lastArmOf[ifIdx] = i;
                        }
                    }
                }
                else if (string.Equals(t, "Else", StringComparison.OrdinalIgnoreCase))
                {
                    // FIRST Else wins — the same first-wins rule the validator's hasElseFor
                    // applies, so on a hand-fed list with a duplicate Else the two agree on
                    // WHICH one is the orphan (last-wins here made the engine no-op the
                    // first Else while the validator would have removed the second).
                    // The Else CLOSES the chain: nothing may link after it.
                    if (stack.Count > 0 && stack.Peek().Kind == BlockKind.If)
                    {
                        int ifIdx = stack.Peek().Idx;
                        if (elseClaimed.Add(ifIdx) && lastArmOf.TryGetValue(ifIdx, out int tail))
                        {
                            map.NextBranchOf[tail] = i;
                            lastArmOf[ifIdx] = i;
                        }
                    }
                }
                else if (string.Equals(t, "EndIf", StringComparison.OrdinalIgnoreCase))
                {
                    if (stack.Count > 0 && stack.Peek().Kind == BlockKind.If)
                    {
                        int ifIdx = stack.Pop().Idx;
                        // EVERY arm maps to this ENDIF, so a body walking off the end of ANY
                        // taken branch lands past the whole block. The walk terminates because
                        // NextBranchOf only ever points FORWARD (it is written as we scan).
                        for (int b = ifIdx; ; )
                        {
                            map.EndIfOf[b] = i;
                            if (!map.NextBranchOf.TryGetValue(b, out int nxt)) break;
                            b = nxt;
                        }
                        lastArmOf.Remove(ifIdx);
                        elseClaimed.Remove(ifIdx);
                    }
                    // else: orphan/crossed EndIf — no entry, the engine no-ops it (the
                    // load-time validator removes these; this is the belt for hand-fed lists).
                }
                else if (string.Equals(t, "EndLoop", StringComparison.OrdinalIgnoreCase))
                {
                    if (stack.Count > 0 && stack.Peek().Kind != BlockKind.If)
                    {
                        var opener = stack.Pop();
                        map.EndLoopOf[opener.Idx] = i;
                        map.LoopStartOf[i] = opener.Idx;
                    }
                }
                else if (string.Equals(t, "BreakLoop", StringComparison.OrdinalIgnoreCase)
                      || string.Equals(t, "ContinueLoop", StringComparison.OrdinalIgnoreCase))
                {
                    // Innermost LOOP, scanning top→base — If frames in between don't count.
                    foreach (var frame in stack)
                    {
                        if (frame.Kind != BlockKind.If)
                        {
                            map.EnclosingLoopOf[i] = (frame.Kind, frame.Idx);
                            break;
                        }
                    }
                    // No loop on the stack → no entry → the row is a no-op at execution.
                }
            }
            return map;
        }

        // Shared "× N" repeat driver for the inline-repeat actions (Keystroke and the
        // combined-mode clicks). Runs <paramref name="body"/> RepeatCount times (clamped
        // 1..999) with RepeatDelayMs between cycles (clamped 0..5000; default 30 ms, or
        // 600 ms for a multi-click, Double or Triple — see defaultGap below),
        // applying the optional ±% per-cycle gap jitter so a burst isn't a fixed-interval
        // metronome — a constant gap is the single clearest "this is a bot" tell. The jitter
        // is re-rolled EVERY cycle (a single up-front roll would just shift the whole burst
        // to a different constant, defeating the point) using the same ±% rate-jitter formula
        // the Clicker uses, clamped >= 0 so a large % can't produce a negative delay.
        // Cancellation is checked between cycles so a Stop hotkey aborts a long "× 999"
        // cleanly; <paramref name="body"/> is expected to honour the token for mid-cycle stops
        // (the click bodies guard the release, SimulateKeystroke checks it internally). A
        // RepeatCount of 1 runs the body exactly once with no delay — byte-identical to the
        // pre-repeat single-shot behaviour, so existing macros are unaffected.
        //
        // <paramref name="body"/> receives the cycle's (offsetX, offsetY) POSITION jitter — a
        // ±px scatter re-rolled per cycle from RepeatPositionJitterPx, the positional twin of
        // the gap jitter above. Timing jitter alone still leaves every click on one exact pixel,
        // which is the other half of the "this is a bot" signature; scattering both makes a
        // burst read as a human tapping the same region. The offset is handed to the body (not
        // applied here) because only the caller knows which coordinates the cycle uses, and
        // because EVERY event inside one cycle must share the SAME offset — a down and up at
        // different points is a drag, and a double-click whose two pairs straddle the
        // SM_CX/CYDOUBLECLK rectangle stops being a double-click. Keystroke ignores it.
        // Synchronous bodies — every cycle that completes inside one call. Forwards to the Core
        // below so the repeat/gap/jitter loop exists ONCE: an "await" copy of that loop is
        // exactly the kind of duplicate that drifts a release later.
        private Task ExecuteRepeated(ActionItem action, CancellationToken token, Action<int, int> body)
            => ExecuteRepeatedCore(action, token, (jx, jy) => { body(jx, jy); return Task.CompletedTask; });

        // Awaitable bodies — a cycle that spans a real wait (the *ClickHold family holds the
        // button for an authored duration between its press and its release).
        //
        // DELIBERATELY a different NAME, not an overload. An `async (jx, jy) => { … }` lambda is
        // convertible to BOTH Action<int,int> and Func<int,int,Task>, and the Action binding is a
        // silent `async void`: the loop would fire each cycle and move on without awaiting the
        // hold, the gap would start during the press, and any exception inside would be
        // unobservable. Overload resolution does pick the Task form today, but nothing in the
        // call site would SHOW that — so the ambiguity is removed instead of relied upon.
        private async Task ExecuteRepeatedCore(ActionItem action, CancellationToken token, Func<int, int, Task> body)
        {
            int repeats = Math.Max(1, Math.Min(999, action.RepeatCount));
            // A MULTI-click (Double/Triple) × N falls back to a larger default gap (see
            // DefaultDoubleClickRepeatDelayMs) so repeats register as DISTINCT multi-clicks rather
            // than blurring into one long chain; single clicks / Keystroke use 30 ms. The constant
            // is named for DoubleClick only for history — it is keyed on GetDoubleClickTime, not on
            // the number of pairs, so a triple needs the identical clearance.
            // Constant patterns match ordinally, preserving the StringComparison.Ordinal this used.
            int defaultGap = action.ActionType is "DoubleClick" or "TripleClick"
                ? ActionItem.DefaultDoubleClickRepeatDelayMs
                : ActionItem.DefaultRepeatDelayMs;
            int gap = Math.Max(0, Math.Min(5000, action.RepeatDelayMs ?? defaultGap));
            int jitterPct = Math.Max(0, Math.Min(100, action.RepeatDelayJitterPct ?? 0));
            // Position jitter is a real BURST knob: gated on repeats > 1 so a single-shot click
            // always lands on the exact coordinate the user picked (matches the editor, which
            // greys the field until Times > 1, and keeps a RepeatCount == 1 click safe for
            // ActionModeConverter to split into Down/Up halves — those cases don't jitter).
            int posJitter = repeats > 1
                ? Math.Max(0, Math.Min(500, action.RepeatPositionJitterPx ?? 0))
                : 0;
            for (int r = 0; r < repeats; r++)
            {
                if (token.IsCancellationRequested) break;
                // Re-rolled EVERY cycle, same reasoning as the gap jitter: one up-front roll
                // would just move the whole burst to a different fixed pixel.
                int offsetX = 0, offsetY = 0;
                if (posJitter > 0)
                {
                    offsetX = Random.Shared.Next(-posJitter, posJitter + 1);
                    offsetY = Random.Shared.Next(-posJitter, posJitter + 1);
                }
                await body(offsetX, offsetY);
                if (r < repeats - 1 && gap > 0)
                {
                    int thisGap = gap;
                    if (jitterPct > 0)
                    {
                        int variation = gap * jitterPct / 100;
                        thisGap = Math.Max(0, gap + Random.Shared.Next(-variation, variation + 1));
                    }
                    try { await Task.Delay(thisGap, token); }
                    catch (OperationCanceledException) { break; }
                }
            }
        }

        // Actions after which the deadline scheduler must RESYNC rather than compress the next
        // action's delay. The test that covers every case is neither "does it take a while" nor
        // "is the time imposed from outside this process" — it is:
        //
        //     was this time ever part of the gap the user RECORDED?
        //
        // If it was, absorbing it is the entire point of deadline scheduling: a click's own
        // travel time sat inside the recorded gap, so the next delay should eat it. If it was
        // not, absorbing it silently deletes settle time the macro depends on. Three families
        // fail that test, and 2.18.0 shipped covering only the first:
        //
        //   1. Waiting on a state — WaitImage, WaitPixelColor, Pause, RunProfile, HoldKey and
        //      Browser* (pipe round-trip), plus a timed If/Assert polling window.
        //   2. Handing work to ANOTHER app and letting it settle. At record time no such
        //      handoff happened, so the recorded gap cannot contain it: SendText hands the payload
        //      to another app either through the clipboard (settle 50 ms, Ctrl+V, ingest 50 ms — a
        //      FIXED cost, no large text needed) or by TYPING it character by character, whose cost
        //      is unbounded in the payload length and is really a family-3 authored duration rather
        //      than a family-2 handoff; ActivateWindow polls up to its Timeout for the window to
        //      come up; CopyToSlot fires Ctrl+C and polls up to 750 ms for the target to render the
        //      copy. Field-reported on SendText → click macros. Both SendText transports fail the
        //      recorded-gap test, so the type-level entry below is right for both and this set
        //      needs no per-row knowledge.
        //   3. Durations authored AFTER recording. A repeat burst (Times > 1) spends
        //      (N-1) × RepeatDelayMs between cycles, but the recording held ONE click, so that
        //      time was never in the gap either. Found on real game macros whose bursts burn
        //      350-800 ms ahead of a recorded 350 ms delay — same failure as family 2, another
        //      door. This is also why HoldKey belongs in family 1 instead of looking like an
        //      oddity there: its duration is authored, not recorded.
        //
        // Resyncing after an action that consumed nothing is inert: the action starts AT its
        // deadline, so elapsed >= nextTickMs already and the assignment changes nothing.
        private static readonly HashSet<string> LongWaitActionTypes = new(StringComparer.OrdinalIgnoreCase)
        {
            "WaitImage", "WaitPixelColor", "Pause", "RunProfile", "HoldKey",
            "SendText", "ActivateWindow", "CopyToSlot", "WaitText",
            // The *ClickHold family for the same reason HoldKey is here: the dwell between the
            // press and the release is AUTHORED, so it was never part of any recorded gap.
            // Absorbing it would delete the settle time the next action was recorded with.
            "LeftClickHold", "RightClickHold", "MiddleClickHold",
        };

        // Browser actions all round-trip the extension pipe with a multi-second timeout, so
        // the whole family qualifies — matched by prefix so a future Browser* action is
        // covered without anyone remembering this list exists.
        private static bool IsLongWaitAction(string? actionType) =>
            actionType != null
            && (LongWaitActionTypes.Contains(actionType)
                || actionType.StartsWith("Browser", StringComparison.OrdinalIgnoreCase));

        // The per-ACTION half of the rule above: family 3 (a repeat burst) and the timed Assert
        // are properties of the row, not of its type, so they cannot live in the set.
        // Assert shares EvaluateConditionWithTimeout with If — a timed Assert polls exactly like
        // one — but it runs through the action switch, where the If's own resync cannot reach it
        // (If rows `continue` out of the loop body before the switch and resync there instead).
        private static bool ShouldResyncAfter(ActionItem action) =>
            IsLongWaitAction(action.ActionType)
            || action.RepeatCount > 1
            // Focus click is family 3, exactly like RepeatCount: the recording held ONE click and
            // the replay performs TWO, so the 80 ms it adds (FocusClickGapMs 60 + two
            // MoveClickDelayMs of 10) was never inside the gap the user recorded. Measured
            // physically 2026-08-18 on a 10-pair profile: the focus-click rows cost 106-119 ms
            // each against 21-25 ms for a plain click (Run Report, which times only the action),
            // 864 ms across the run -- and wall clock was IDENTICAL to the same profile without
            // focus click, i.e. every one of those 864 ms was being eaten out of the following
            // delays. 82 rows across 20 of the owner's real profiles; Tranquility alone lost
            // 1.28 s per run, with the settle after "click the search box" cut from 350 to ~264.
            || action.IsFocusClick
            // TripleClick is family 3 for the same reason, and PROVENANCE is what puts it here.
            // MultiClickPairs spends (pairs-1) x DoubleClickGapMs + pairs x 2 x MoveClickDelayMs:
            // ~160 ms for three pairs against ~20 ms for a plain click, so it eats ~140 ms of the
            // NEXT row's delay. With Delay = 120 ms after it, the next action fires with no gap at
            // all; with 300, it fires 140 ms after the click instead of 300.
            //
            // DoubleClick belongs here too, and the argument that kept it out was wrong TWICE.
            //
            // It used to read: the recorder MERGES two physical clicks into a DoubleClick row, so
            // the real double-click's duration was already inside the gap recorded after it, and
            // resyncing would pay that time twice. The recorder does not work that way. The delay
            // of the NEXT row is computed by GetDelayForNewAction from _lastActionTicks, which is
            // stamped on the SECOND physical click — the merge reuses the first click's row and
            // its already-computed delay, and never rewrites it. So the interval between the two
            // clicks was never in that gap: resyncing after a recorded DoubleClick is MORE
            // faithful to the recording, not less.
            //
            // And the bet itself stopped being safe. Provenance is not readable at replay time —
            // there is no flag, and the two rows are byte-identical in the JSON — while this
            // release opened three doors that author a DoubleClick with no recording behind it at
            // all: Insert Click (the dialog maps "double" straight to the type), the row menu's
            // Change click type (bulkUpdateType promotes N recorded single clicks in one go), and
            // the Sheet's own type picker.
            //
            // The arithmetic, with the real constants: a DoubleClick is 2x10 + DoubleClickGapMs(50)
            // + 2x10 = 90 ms, and the whole 90 came out of the next row's delay. NOT 70: subtracting
            // a plain click's 20 ms as a baseline would only be right if the scheduler resynced
            // after a plain click, and it does not — `LeftClick` is in neither LongWaitActionTypes
            // nor any other term of this predicate, so a plain click's 20 ms is absorbed by the
            // next delay exactly the same way and is never given back to anyone. The baseline is
            // zero, because nothing in this cost model is ever refunded; what a row costs is what
            // the following delay loses. With Delay <= 90 ms after it — ordinary in a game macro —
            // the next action fired with no interval at all. Same failure described for TripleClick
            // two paragraphs up, one step smaller.
            //
            // Both types now reach here from a RECORDING as well as from authoring — the merge
            // chain is LeftClick → DoubleClick → TripleClick — so provenance is unreadable for
            // either one. It does not need to be: the arithmetic above is about what the row COSTS
            // to replay, and that is the same however the row came to be written.
            //
            // Measured before adding either: the owner's 108 profiles hold 1247 actions and ZERO
            // DoubleClick and ZERO TripleClick rows, so this changes no existing profile's timing.
            // For anyone who does have one, the change GIVES BACK the 90 ms it was taking (160 for
            // a TripleClick), which is the row's full cost — see the baseline note above.
            || string.Equals(action.ActionType, "DoubleClick", StringComparison.OrdinalIgnoreCase)
            || string.Equals(action.ActionType, "TripleClick", StringComparison.OrdinalIgnoreCase)
            || (action.ConditionTimeout > 0
                && string.Equals(action.ActionType, "Assert", StringComparison.OrdinalIgnoreCase))
            // Set Variable's Screen mode is an OCR read (tens of ms on a region, ~0.45 s on the whole
            // screen) and, with "Wait up to", a wait — whatever it spends was never in the next gap.
            || (string.Equals(action.ActionType, "SetVariable", StringComparison.OrdinalIgnoreCase)
                && string.Equals(action.VariableMode, "screen", StringComparison.OrdinalIgnoreCase));

        // An authored delay with the run's jitter applied, never negative. The ONE copy: the action
        // delay, the If/ElseIf arm and the While guard each carried their own, byte for byte.
        private int JitteredDelay(int delay)
        {
            int d = Math.Max(0, delay);
            if (_useDelayVariation && _delayVariationPercent > 0 && d > 0)
            {
                int variation = d * _delayVariationPercent / 100;
                d += Random.Shared.Next(-variation, variation + 1);
                d = Math.Max(0, d);
            }
            return d;
        }

        /// <summary>
        /// The innermost loop opener (While / ForEachRow row index) whose block encloses
        /// <paramref name="idx"/>, or -1. Innermost = the enclosing opener with the highest index:
        /// blocks nest, so of two openers both before idx with EndLoops both past it, the later
        /// one opened inside the earlier. Pure, so the {loop} stamp can be proven head-lessly.
        /// </summary>
        internal static int InnermostEnclosingLoop(int idx, IReadOnlyDictionary<int, int> endLoopOf)
        {
            int best = -1;
            foreach (var (open, end) in endLoopOf)
                if (open < idx && idx < end && open > best) best = open;
            return best;
        }

        // One live For-Each-Data-Row activation: where the cursor is, what data context to
        // restore on exit, and the skip tally for the end-of-block summary.
        private sealed class ForEachFrame
        {
            public int Cursor;
            public DataCtxSnapshot Saved;
            public int Skipped;
            public string? FirstReason;
        }

        // The data-loop context as one restorable unit — extracted so the sub-profile
        // over-data call and the inline ForEachRow block share ONE save/restore instead of
        // keeping drifting field-by-field copies (the restore path is where a missed field
        // becomes a cross-run leak: _dataLoopOver=true leaking out of a cancelled block
        // turns the NEXT run into batch mode).
        private readonly struct DataCtxSnapshot
        {
            public Models.ProfileDataTable? Table { get; init; }
            public bool LoopOver { get; init; }
            public IReadOnlyDictionary<string, string>? RowData { get; init; }
            public int DataRow { get; init; }                                // {datarow} of that row context
            public Dictionary<string, int>? RowNextCursors { get; init; }   // null = leave untouched
            public bool SoftOverride { get; init; }
        }

        private DataCtxSnapshot SaveDataContext(bool swapRowNextCursors) => new()
        {
            Table = _dataTable,
            LoopOver = _dataLoopOver,
            RowData = _currentRowData,
            DataRow = _currentDataRow,
            // The sub-call swaps in a fresh {rownext} cursor dict (it walks the SUB's
            // table); the inline ForEachRow keeps the ambient one (same table, same walk).
            RowNextCursors = swapRowNextCursors ? _rowNextCursors : null,
            SoftOverride = _softFaultOverride,
        };

        private void RestoreDataContext(in DataCtxSnapshot s)
        {
            _dataTable = s.Table;
            _dataLoopOver = s.LoopOver;
            _currentRowData = s.RowData;
            _currentDataRow = s.DataRow;
            if (s.RowNextCursors != null) _rowNextCursors = s.RowNextCursors;
            _softFaultOverride = s.SoftOverride;
            PushVariablesSnapshot();   // live pane: back on the caller's row
        }

        // Layer-2 safety net for ForEachRow: restores the OUTERMOST live frame's snapshot on
        // EVERY exit of ExecuteActionsAsync (token cancel, Stop, Return, soft unwind, rethrown
        // exceptions). `using`-based so the 300-line action loop needs no re-indent. Without
        // it, _dataLoopOver=true would LEAK out of an aborted block — the fresh-run reset
        // doesn't clear it (only SetDataTable writes it), and a leaked true flips the next
        // run into batch row-stamping. Inner frames are stamped states of the outer one and
        // are discarded, not restored.
        private sealed class ForEachRestoreNet : IDisposable
        {
            private readonly ActionReplayer _owner;
            private readonly Dictionary<int, ForEachFrame> _state;
            private readonly List<int> _active;
            private readonly CancellationToken _token;
            public ForEachRestoreNet(ActionReplayer owner, Dictionary<int, ForEachFrame> state, List<int> active, CancellationToken token)
            { _owner = owner; _state = state; _active = active; _token = token; }
            public void Dispose()
            {
                if (_active.Count == 0) return;
                // Surface the skip tally the frames carry BEFORE discarding them — an authored
                // Stop / Return / thrown-error exit bypasses ExitForEachFrame, and silently
                // dropping "N rows failed" under a success cue is the exact lie the
                // _authoredStop gate exists to prevent (same doctrine as the batch summary).
                int skipped = 0;
                string? firstReason = null;
                foreach (var idx in _active)
                {
                    var f = _state[idx];
                    skipped += f.Skipped;
                    firstReason ??= f.FirstReason;
                }
                _owner.RestoreDataContext(_state[_active[0]].Saved);   // [0] = outermost
                _active.Clear();
                _state.Clear();
                if (skipped > 0 && (!_token.IsCancellationRequested || _owner._authoredStop))
                    _owner.OnRunSummary?.Invoke($"For Each Data Row: {skipped} row(s) skipped after errors"
                        + (firstReason != null ? $" — first: {firstReason}" : ""));
            }
        }

        private async Task ExecuteActionsAsync(List<ActionItem> actions, CancellationToken token)
        {
            // Pre-pass per call so nested RunProfile invocations each get a fresh map
            // scoped to the sub-profile's action list. Cost is negligible (~32 B / IF row).
            var map = BuildBlockMap(actions);
            // Loop-family state, all frame-local: While iteration counters (opener idx →
            // count so far) and the ForEachRow frames + active stack (outermost first).
            var loopIterations = new Dictionary<int, int>();
            var feState = new Dictionary<int, ForEachFrame>();
            var feActive = new List<int>();
            // Break/Continue rows already reported in this frame. ONE record per ROW, not per
            // firing: a Break inside a nested loop fires once per outer iteration, and the report
            // caps at 500 records that the While guard is already spending one per probe on. The
            // first firing is the one that answers "why did the loop end here?"; the rest is
            // noise that would push the interesting rows off the end.
            var jumpRecorded = new HashSet<int>();
            using var feNet = new ForEachRestoreNet(this, feState, feActive, token);

            // Structured ForEachRow exit — restore the frame's data context, drop it, and
            // surface the skip tally (same honesty gate as the batch summary: an authored
            // Stop re-opens it).
            void ExitForEachFrame(int openerIdx, ForEachFrame fe)
            {
                RestoreDataContext(fe.Saved);
                feState.Remove(openerIdx);
                feActive.Remove(openerIdx);
                if (fe.Skipped > 0 && (!token.IsCancellationRequested || _authoredStop))
                    OnRunSummary?.Invoke($"For Each Data Row: {fe.Skipped} row(s) skipped after errors"
                        + (fe.FirstReason != null ? $" — first: {fe.FirstReason}" : ""));
            }

            // {loop}: the iteration of the innermost While / ForEachRow block enclosing row idx —
            // the most recently opened one whose EndLoop lies past it — read from the same live
            // counters the blocks keep (loopIterations is done+1 once a body runs; fe.Cursor is
            // 1-based once the row is stamped). No enclosing block: the run repeat, so {loop}
            // reads as "the loop I am in" at every depth, the outermost being the profile's own.
            int InnermostLoopIteration(int idx)
            {
                int opener = InnermostEnclosingLoop(idx, map.EndLoopOf);
                if (opener < 0) return _currentIteration;
                if (feState.TryGetValue(opener, out var frame)) return frame.Cursor;
                return loopIterations.GetValueOrDefault(opener);
            }

            // A skip-absorb reentry jumps from deep inside the block back to the opener,
            // trampling whatever inner loops were mid-flight — abandon their state or the
            // NEXT row would inherit a half-run While counter / a stale nested frame.
            void AbandonInnerLoopState(int outerOpener)
            {
                int end = map.EndLoopOf.TryGetValue(outerOpener, out var e) ? e : actions.Count;
                List<int>? deadWhiles = null;
                foreach (var k in loopIterations.Keys)
                    if (k > outerOpener && k < end) (deadWhiles ??= new List<int>()).Add(k);
                if (deadWhiles != null)
                    foreach (var k in deadWhiles) loopIterations.Remove(k);
                for (int k = feActive.Count - 1; k >= 0; k--)
                    if (feActive[k] > outerOpener && feActive[k] < end)
                    {
                        feState.Remove(feActive[k]);
                        feActive.RemoveAt(k);
                    }
            }

            // Schedule each action's delay against a monotonic deadline rather than chaining
            // sleeps. Chaining makes the real cadence delay + action cost + syscall cost, so
            // a macro drifted by the cost of its own actions — the clicker loop moved to the
            // same scheme for the same reason. Wait-class actions are the deliberate
            // exception; see the IsLongWaitAction resync after the switch.
            var sw = System.Diagnostics.Stopwatch.StartNew();
            long nextTickMs = 0;

            for (int i = 0; i < actions.Count; i++)
            {
                // ForEachRow skip-absorb — in THIS frame, before the boundary break (the
                // sub-call absorbs a faulted row outside ExecuteActionsAsync; an inline
                // block has no outside). Only when the ACTIVE table's policy is skip;
                // halt-mode faults fall through to the break below (hard cancel, or soft
                // unwind to a skip-active parent that absorbs the whole block as one row).
                if (_rowFaulted && feActive.Count > 0
                    && string.Equals(_dataTable?.OnRowError, "skip", StringComparison.OrdinalIgnoreCase))
                {
                    int fej = feActive[^1];
                    if (feState.TryGetValue(fej, out var faultedFrame))
                    {
                        // Same recovery the batch loop does: release anything the faulted
                        // row left pressed, tally, clear the fault, reenter for the NEXT
                        // row (the cursor already advanced at stamp time).
                        ResetMouseState();
                        ResetKeyState();
                        faultedFrame.Skipped++;
                        faultedFrame.FirstReason ??= _rowFaultReason;
                        Services.DiagnosticLog.Warn($"For Each Data Row: row {faultedFrame.Cursor} skipped — {_rowFaultReason}");
                        _rowFaulted = false;
                        _rowFaultReason = null;
                        AbandonInnerLoopState(fej);
                        i = fej - 1;   // for's i++ lands on the opener → next row
                        continue;
                    }
                }

                // _rowFaulted: a skip-mode action failure unwinds the rest of the row's
                // actions (and any RunProfile recursion level) without cancelling the run.
                // _returnRequested: a Return row ended the current pass — unwind this frame;
                // the call sites consume the flag so later passes start clean.
                if (token.IsCancellationRequested || _rowFaulted || _returnRequested) break;
                var action = actions[i];

                // {loop} / {datarow} stamp, at the TOP of the iteration rather than only on the
                // leaf path further down. Structural lines resolve tokens too — an If/ElseIf
                // condition and a While guard both call ProbeVariableAsync, which reads
                // _currentLoopIteration through CurrentRunCtx — and they `continue` long before
                // the leaf stamp ran, so they used to see whatever the LAST executed leaf had
                // left there: on the first lap nothing at all, and afterwards one lap behind.
                // "If Variable x eq {loop}" inside a While therefore took the wrong arm, which is
                // exactly the comparison eb8ea6c advertises. Stamping here means no future
                // structural line has to remember to do it.
                //
                // Cost: InnermostEnclosingLoop is O(number of block openers) per line, now paid on
                // structural lines too. A profile has one or two loops and a median of two
                // actions, so this is a handful of int comparisons per line.
                _currentActionRow = i + 1;                           // {row} token source (1-based grid row)
                _currentLoopIteration = InnermostLoopIteration(i);   // {loop} token source

                // Chain read-out progress — see OnChainStep. Emitted only from inside a sub-profile
                // (Count >= 2); at depth 1 the status bar hides the chain entirely and the root's
                // own highlight-derived counter already covers it. The number is POSITION in the
                // list, not steps-executed, which is what the root counter means too — and it has
                // to be, because a conditional block skip jumps `i` past its body.
                if (_callStack.Count >= 2)
                {
                    long chainNowMs = Environment.TickCount64;
                    if (chainNowMs - _lastChainStepMs >= 250)
                    {
                        _lastChainStepMs = chainNowMs;
                        int chainStep = i + 1, chainTotal = actions.Count;
                        dispatcherQueue.TryEnqueue(() => OnChainStep?.Invoke(chainStep, chainTotal));
                    }
                }

                // ── Conditional logic — handled before the regular Delay / Highlight /
                // input-replay gate so block skips happen immediately (no spurious 0 ms
                // Task.Delay) and ELSE/ENDIF don't trip the input-replay marker (they
                // don't simulate input). Structural rows never enter the action switch.
                if (string.Equals(action.ActionType, "If", StringComparison.OrdinalIgnoreCase))
                {
                    if (action.IsSkipped)
                    {
                        // Recorded before the jump: a greyed-out block is a deliberate choice, and
                        // a report that simply omits it reads as "this never existed" rather than
                        // "you turned this off" — which is the wrong answer to "why did nothing
                        // happen?". The whole body is elided, so this one row stands for all of it.
                        RecordRunStep(new RunStepRecord
                        {
                            Row = i + 1,
                            Profile = CurrentExecutingProfileName,
                            ActionType = "If",
                            Detail = _runStepsFull ? null : DescribeIfDetail(action, null),
                            Status = "skipped",
                        });
                        // Block-level skip: jump past the whole IF/ELSEIF/ELSE/ENDIF range so the
                        // body rows of EVERY branch are elided. Mirrors the visual
                        // "whole block is greyed out" the frontend renders for an IF row
                        // whose IsSkipped is true. Orphan IF (no matching EndIf in the map
                        // because the load-time validator failed somehow) → bail out to
                        // end-of-list so the body doesn't run unconditionally. Safer than
                        // continuing past the IF, which would execute the body as if no
                        // IF existed and contradict the user's explicit skip.
                        if (map.EndIfOf.TryGetValue(i, out int endIdx))
                            i = endIdx;
                        else
                            i = actions.Count;
                        continue;
                    }

                    // ── The BRANCH CHAIN — IF → ELSEIF → ELSEIF → … → ELSE.
                    // Walked HERE, from the opener, rather than by jumping to each marker row and
                    // letting it probe itself. An ELSEIF row is reachable two ways that are
                    // POSITIONALLY IDENTICAL: falling in from a FALSE sibling (it must probe) and
                    // walking out of the TRUE body above it (it must jump to ENDIF). Driving the
                    // chain from the opener leaves the ELSEIF *row* with the single ELSE meaning,
                    // so there is no per-run "which arm is pending" state that could go stale
                    // across a While back-edge, a ForEachRow reentry, or a cancelled jump.
                    // With zero ELSEIF rows this walks exactly one arm and is behaviourally
                    // identical to the pre-chain engine.
                    int branchArm = i;
                    bool branchTaken = false;
                    bool branchAbort = false;   // cancellation → stop the whole replay
                    bool branchAbsorb = false;  // probe error absorbed as a skipped data row
                    while (true)
                    {
                        var armRow = actions[branchArm];
                        // Tokens resolved by THIS arm belong to THIS row. The stamp was taken once
                        // at the opener and never moved, so every ElseIf in a chain resolved
                        // {row}/@row as the IF's line number — while the run report numbered the
                        // same step by the arm (Row = branchArm + 1, just below). The two already
                        // disagreed; this settles it on the number the user can see in the grid.
                        _currentActionRow = branchArm + 1;
                        // A greyed-out ELSEIF elides only ITS OWN arm — the chain moves on as if
                        // the probe had read false. (A greyed-out IF elides the entire block and
                        // never reaches here; that is the IsSkipped branch above.)
                        if (branchArm != i && armRow.IsSkipped)
                        {
                            RecordRunStep(new RunStepRecord
                            {
                                Row = branchArm + 1,
                                Profile = CurrentExecutingProfileName,
                                ActionType = "ElseIf",
                                Detail = _runStepsFull ? null : DescribeIfDetail(armRow, null),
                                Status = "skipped",
                            });
                        }
                        else
                        {
                            // The arm carries an optional delay applied BEFORE the probe — a "wait for
                            // the condition to settle" knob. Some conditions (an image/pixel that only
                            // appears after a page or animation loads) aren't ready the instant the loop
                            // reaches the row, so an immediate probe reads FALSE and the branch is
                            // wrongly skipped. The delay lets the screen catch up first. (ELSE/ENDIF are
                            // pure jumps and carry no delay; ELSEIF runs a probe, so it keeps the knob.)
                            // Honours the same jitter setting as a regular action's delay.
                            int ifDelay = JitteredDelay(armRow.Delay);
                            if (ifDelay > 0)
                            {
                                try { await Task.Delay(ifDelay, token); }
                                catch (OperationCanceledException) { branchAbort = true; break; }
                            }
                            // Highlight while the probe runs — user feedback "we're checking the condition".
                            dispatcherQueue.TryEnqueue(() => OnActionExecuting?.Invoke(armRow));
                            // Filed BEFORE the probe, like every other step, so a report pulled while a
                            // timed arm is still polling shows the row it is stuck on instead of omitting
                            // it. Status starts "running" and the outcome is written below; a cancel
                            // during the probe leaves it running, which is exactly what happened.
                            var ifRec = new RunStepRecord
                            {
                                Row = branchArm + 1,
                                Profile = CurrentExecutingProfileName,
                                ActionType = branchArm == i ? "If" : "ElseIf",
                                Detail = _runStepsFull ? null : DescribeIfDetail(armRow, null),
                            };
                            var ifWatch = System.Diagnostics.Stopwatch.StartNew();
                            RecordRunStep(ifRec);
                            bool branchTrue;
                            try { branchTrue = await EvaluateConditionWithTimeout(armRow, token); }
                            catch (OperationCanceledException) { ifRec.Status = "skipped"; ifWatch.Stop(); ifRec.DurationMs = ifWatch.ElapsedMilliseconds; branchAbort = true; break; }
                            catch (Exception ex)
                            {
                                // Reachable: a probe error under IfOnProbeError == "Halt" rethrows out of
                                // InstantProbeAsync (the TreatAsFalse policy swallows it instead). Without
                                // this the row would stay "running" and read as in-flight when it actually
                                // killed the run — the same lie the in-flight default was fixed to stop
                                // telling. Rethrown untouched so the halt still halts — EXCEPT inside an
                                // inline ForEachRow whose table policy is skip: there a thrown error is a
                                // ROW error (the sub-over-data catch treats it the same), softened to a
                                // fault so the loop-top absorb reenters on the next data row.
                                ifRec.Status = "failed";
                                ifRec.ErrorMessage = ex.Message;
                                ifWatch.Stop();
                                ifRec.DurationMs = ifWatch.ElapsedMilliseconds;
                                if (feActive.Count > 0
                                    && string.Equals(_dataTable?.OnRowError, "skip", StringComparison.OrdinalIgnoreCase))
                                {
                                    FaultRow(ex.Message);
                                    branchAbsorb = true;
                                    break;
                                }
                                throw;
                            }
                            ifWatch.Stop();
                            ifRec.DurationMs = ifWatch.ElapsedMilliseconds;
                            ifRec.Status = "ok";      // the PROBE ran; a false condition is an answer, not a failure
                            if (!_runStepsFull) ifRec.Detail = DescribeIfDetail(armRow, branchTrue, ScreenReadFor(armRow));
                            // A timed arm polls for up to ConditionTimeout ms — wall time that is the
                            // feature, not schedule debt. Same wait-class resync as the one after the
                            // action switch, for the same settle-delay reason. (Branch rows never reach
                            // that switch — they `continue` out of the loop body right below.)
                            //
                            // An INSTANT probe resyncs too when it stopped for the Ask-Input modal — a
                            // {input:} in its operand parks it for up to a minute (ConsumeWaitedOnUser).
                            bool armWaited = ConsumeWaitedOnUser();
                            if (armRow.ConditionTimeout > 0 || armWaited)
                                nextTickMs = sw.ElapsedMilliseconds;
                            if (branchTrue)
                            {
                                branchTaken = true;
                                break;
                            }
                            // A probe that FAULTED the data row (e.g. a missing rel-coords target under
                            // OnRowError=="skip") returns false WITHOUT throwing. The chain is the only
                            // place in the engine that runs several probes before passing back through
                            // the loop-top absorb, so without this gate the remaining arms would each pay
                            // their delay, file an "ok" step and RESOLVE THEIR TOKENS — burning a
                            // {clipboard:next} cursor or popping an {input:...} prompt for a row that is
                            // already being abandoned. Same "unwind NOW, do not keep probing a dead row"
                            // rule EvaluateConditionWithTimeout applies one level down. Leaving
                            // branchTaken false makes the post-loop jump past the block, which is exactly
                            // what the pre-chain engine did before the loop top absorbed the row.
                            if (_rowFaulted) break;
                        }

                        // FALSE (or an elided ELSEIF arm) — advance to the next branch marker.
                        // No next marker at all → every arm failed and the block has no ELSE.
                        if (!map.NextBranchOf.TryGetValue(branchArm, out int nextArm)) break;
                        if (string.Equals(actions[nextArm].ActionType, "Else", StringComparison.OrdinalIgnoreCase))
                        {
                            // Terminal ELSE — the unconditional fallback. Land ON the marker so the
                            // outer loop's i++ steps into the ELSE body.
                            //
                            // …unless it is greyed out. IsSkipped is checked HERE and not only at
                            // the top of the loop, because this branch does not go round again: it
                            // sets branchTaken and breaks, so the arm test above never sees the ELSE.
                            // An ELSEIF elides by "the probe reads false and the chain walks on",
                            // which needs no special case — but an ELSE has no probe to falsify, so
                            // without this it was taken while the grid, the duration chip and
                            // conditionalBlocks.armBodyEnd all painted its whole body as dead. The
                            // front end derives "skipped arm takes its body with it" for BOTH arm
                            // types from the engine's own ELSEIF comment; this is the half of that
                            // sentence the engine did not implement.
                            if (actions[nextArm].IsSkipped)
                            {
                                RecordRunStep(new RunStepRecord
                                {
                                    Row = nextArm + 1,
                                    Profile = CurrentExecutingProfileName,
                                    ActionType = "Else",
                                    Detail = _runStepsFull ? null : DescribeIfDetail(actions[nextArm], null),
                                    Status = "skipped",
                                });
                                branchArm = nextArm;
                                break;   // branchTaken stays false → jump past the whole block
                            }
                            branchArm = nextArm;
                            branchTaken = true;
                            break;
                        }
                        branchArm = nextArm;   // another ELSEIF — probe it on the next turn
                    }
                    if (branchAbort) break;
                    if (branchAbsorb) continue;
                    if (branchTaken)
                    {
                        // Land on the winning marker; the loop's i++ steps into its body. When the
                        // IF itself won this is `i = i`, byte-identical to the old fall-through.
                        i = branchArm;
                    }
                    else
                    {
                        // Every arm read false and there is no ELSE — jump past the block. Orphan
                        // opener (no ENDIF in the map) falls back to i, the same self-landing the
                        // pre-chain engine had; the load-time validator is what guarantees it
                        // cannot actually happen.
                        i = map.EndIfOf.GetValueOrDefault(branchArm, i);
                    }
                    continue;
                }
                if (string.Equals(action.ActionType, "Else", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(action.ActionType, "ElseIf", StringComparison.OrdinalIgnoreCase))
                {
                    // Encountered only when walking through a TAKEN branch's body and the loop
                    // reached the next branch boundary. Skip every remaining branch body entirely
                    // by jumping to the matching ENDIF. An ELSEIF reached this way must NOT probe:
                    // a sibling above it already won, and the chain walk in the IF arm is the only
                    // place an arm is ever evaluated. Orphan marker (no entry in the map because
                    // the load-time validator failed to strip it) → treat as a no-op so the rows
                    // after it run with whatever scope they were already in. Falling through to
                    // the next branch instead would execute the wrong code path, which is worse
                    // than ignoring the orphan marker.
                    if (map.EndIfOf.TryGetValue(i, out int endIdx))
                        i = endIdx;
                    continue;
                }
                if (string.Equals(action.ActionType, "EndIf", StringComparison.OrdinalIgnoreCase))
                {
                    continue; // structural marker — no work, no delay, no highlight
                }

                // ── Loop family — same handled-before-the-leaf-gate contract as If/Else/EndIf:
                // block jumps happen immediately, structural rows never enter the action
                // switch, and only the two probe-bearing openers (While here, If above) pay
                // a delay.
                if (string.Equals(action.ActionType, "While", StringComparison.OrdinalIgnoreCase))
                {
                    if (action.IsSkipped)
                    {
                        // Same skip-elide contract as the If row: one record stands for the
                        // whole greyed-out block, and the entire body is jumped.
                        RecordRunStep(new RunStepRecord
                        {
                            Row = i + 1,
                            Profile = CurrentExecutingProfileName,
                            ActionType = "While",
                            Detail = _runStepsFull ? null : DescribeIfDetail(action, null),
                            Status = "skipped",
                        });
                        // Counter reset on EVERY exit incl. this one — IsSkipped is live
                        // mid-run (shallow snapshot), and a stale count would shortchange
                        // the ceiling on a later re-activation in this same pass.
                        loopIterations.Remove(i);
                        if (map.EndLoopOf.TryGetValue(i, out int skipEnd))
                            i = skipEnd;
                        else
                            i = actions.Count;
                        continue;
                    }
                    // Iteration ceiling BEFORE the delay/probe: a loop that has spent its
                    // budget must not pay another settle delay or probe just to find out.
                    // Exiting on the ceiling is a NORMAL "ok" exit with a log line — the
                    // knob is a runaway guard, not an assertion.
                    int done = loopIterations.GetValueOrDefault(i);
                    int ceiling = action.LoopMaxIterations > 0 ? action.LoopMaxIterations : 1000;
                    if (done >= ceiling)
                    {
                        Services.DiagnosticLog.Warn($"While (row {i + 1}): iteration ceiling {ceiling} reached — exiting loop");
                        loopIterations.Remove(i);   // reset on EVERY exit — under ForEachRow the same While reenters per row
                        if (map.EndLoopOf.TryGetValue(i, out int capEnd))
                            i = capEnd;
                        else
                            i = actions.Count;
                        continue;
                    }
                    // {loop} inside THIS guard means the lap the guard is about to decide, not the
                    // lap of whatever block encloses the While. The top-of-iteration stamp reads
                    // the ENCLOSING opener — InnermostEnclosingLoop requires `open < idx`, so a
                    // While never encloses itself — which for a top-level While is the run's
                    // repeat count, constant all run. That would quietly kill
                    // "While … {clipboard:line:@loop}", the walk eb8ea6c exists for. `done` is the
                    // number of laps finished, so the lap being decided is done + 1.
                    _currentLoopIteration = done + 1;

                    // Delay BEFORE the probe, PER ITERATION — double duty: the If's "let the
                    // screen settle before checking" plus the pacing between iterations.
                    int whileDelay = JitteredDelay(action.Delay);
                    if (whileDelay > 0)
                    {
                        try { await Task.Delay(whileDelay, token); }
                        catch (OperationCanceledException) { break; }
                    }
                    dispatcherQueue.TryEnqueue(() => OnActionExecuting?.Invoke(action));
                    // Filed BEFORE the probe (the If row's reason): a report pulled while a
                    // timed guard is polling shows the iteration it is stuck on. One record
                    // PER PROBE — the report's 500-cap keeps an infinite loop from flooding
                    // it (accepted degradation: past the cap only the counter bumps).
                    var whileRec = new RunStepRecord
                    {
                        Row = i + 1,
                        Profile = CurrentExecutingProfileName,
                        ActionType = "While",
                        Detail = _runStepsFull ? null : DescribeIfDetail(action, null),
                    };
                    var whileWatch = System.Diagnostics.Stopwatch.StartNew();
                    RecordRunStep(whileRec);
                    bool loopTrue;
                    try { loopTrue = await EvaluateConditionWithTimeout(action, token); }
                    catch (OperationCanceledException) { whileRec.Status = "skipped"; whileWatch.Stop(); whileRec.DurationMs = whileWatch.ElapsedMilliseconds; break; }
                    catch (Exception ex)
                    {
                        // Probe error under IfOnProbeError == "Halt" rethrows (the If
                        // contract). TreatAsFalse never reaches here — InstantProbe swallows
                        // and returns ConditionNegate: an UN-negated guard reads false and
                        // exits the loop; a NEGATED guard ("While NOT x") reads true on a
                        // broken probe and keeps looping — bounded by the iteration ceiling,
                        // mirroring the If's IFNOT-on-probe-error semantics, but not "safe
                        // by construction". The ceiling is the actual net.
                        whileRec.Status = "failed";
                        whileRec.ErrorMessage = ex.Message;
                        whileWatch.Stop();
                        whileRec.DurationMs = whileWatch.ElapsedMilliseconds;
                        // Inline ForEachRow + skip policy: a thrown probe error is a ROW error
                        // (the sub-over-data catch treats it the same) — soften to a fault so
                        // the loop-top absorb reenters on the next data row instead of the
                        // whole run dying (the restore net runs BEFORE the caller's filter
                        // sees the exception, so StartAsync's skip catch can't help here).
                        if (feActive.Count > 0
                            && string.Equals(_dataTable?.OnRowError, "skip", StringComparison.OrdinalIgnoreCase))
                        {
                            FaultRow(ex.Message);
                            continue;
                        }
                        throw;
                    }
                    whileWatch.Stop();
                    whileRec.DurationMs = whileWatch.ElapsedMilliseconds;
                    whileRec.Status = "ok";      // the PROBE ran; false is an answer (loop exit)
                    if (!_runStepsFull) whileRec.Detail = DescribeIfDetail(action, loopTrue, ScreenReadFor(action));
                    bool guardWaited = ConsumeWaitedOnUser();   // see the If arm
                    if (action.ConditionTimeout > 0 || guardWaited)
                        nextTickMs = sw.ElapsedMilliseconds;   // timed probe = wait-class resync
                    if (!loopTrue)
                    {
                        loopIterations.Remove(i);   // next ACTIVATION starts from zero
                        if (map.EndLoopOf.TryGetValue(i, out int exitEnd))
                            i = exitEnd;            // for's i++ lands after the EndLoop
                        else
                            i = actions.Count;      // unmatched opener (hand-fed list) — bail
                        continue;
                    }
                    loopIterations[i] = done + 1;
                    continue;   // TRUE → body starts at i+1
                }
                if (string.Equals(action.ActionType, "EndLoop", StringComparison.OrdinalIgnoreCase))
                {
                    // Back edge. Orphan (no opener in the map) = pure no-op, mirroring the
                    // validator's removal posture. The deadline RESYNCS before the jump —
                    // without it, iteration 2's first delay would be measured against
                    // iteration 1's deadline and compress to zero.
                    if (map.LoopStartOf.TryGetValue(i, out int openIdx))
                    {
                        nextTickMs = sw.ElapsedMilliseconds;
                        i = openIdx - 1;   // for's i++ lands ON the opener (re-probe / next row)
                    }
                    continue;
                }
                if (string.Equals(action.ActionType, "BreakLoop", StringComparison.OrdinalIgnoreCase))
                {
                    // Jump PAST the innermost loop's EndLoop. IsSkipped = the jump doesn't
                    // fire; orphans (no enclosing loop) are no-ops. Kind-dispatched exit: a
                    // While resets its counter, a ForEachRow restores its data context.
                    //
                    // This DOES file a run-report record, unlike Else/EndIf. The old parity
                    // argument was wrong in one respect: Else is a boundary the engine walks
                    // through, while a Break is a decision the AUTHOR made, and a report of a
                    // loop that ended early with no trace of the row that ended it cannot answer
                    // the first question anyone asks of it. Recorded only when the jump actually
                    // fires (a skipped or orphan row did nothing) and only once per row.
                    if (!action.IsSkipped
                        && map.EnclosingLoopOf.TryGetValue(i, out var encB)
                        && map.EndLoopOf.TryGetValue(encB.OpenIdx, out int breakEnd))
                    {
                        if (encB.Kind == BlockKind.ForEachRow)
                        {
                            if (feState.TryGetValue(encB.OpenIdx, out var bfe))
                                ExitForEachFrame(encB.OpenIdx, bfe);
                        }
                        else
                        {
                            loopIterations.Remove(encB.OpenIdx);
                        }
                        if (jumpRecorded.Add(i))
                        {
                            RecordRunStep(new RunStepRecord
                            {
                                Row = i + 1,
                                Profile = CurrentExecutingProfileName,
                                ActionType = "BreakLoop",
                                Detail = _runStepsFull ? null
                                    : $"exited the {DescribeLoopKind(encB.Kind)} opened at row {encB.OpenIdx + 1}",
                                Status = "ok",
                            });
                        }
                        i = breakEnd;   // for's i++ lands after the EndLoop
                    }
                    continue;
                }
                if (string.Equals(action.ActionType, "ContinueLoop", StringComparison.OrdinalIgnoreCase))
                {
                    // Jump to the innermost loop's opener: a While re-probes, a ForEachRow
                    // stamps the NEXT row for free (reentry advances the cursor). Resync
                    // first — the jump consumes no schedule.
                    if (!action.IsSkipped && map.EnclosingLoopOf.TryGetValue(i, out var encC))
                    {
                        nextTickMs = sw.ElapsedMilliseconds;
                        // Same once-per-row rule as BreakLoop above, and it matters more here: a
                        // Continue fires on EVERY iteration it is reached on, so per-firing
                        // records would be the single biggest consumer of the 500-record cap.
                        if (jumpRecorded.Add(i))
                        {
                            RecordRunStep(new RunStepRecord
                            {
                                Row = i + 1,
                                Profile = CurrentExecutingProfileName,
                                ActionType = "ContinueLoop",
                                Detail = _runStepsFull ? null
                                    : $"jumped to the {DescribeLoopKind(encC.Kind)} opened at row {encC.OpenIdx + 1}",
                                Status = "ok",
                            });
                        }
                        i = encC.OpenIdx - 1;
                    }
                    continue;
                }
                if (string.Equals(action.ActionType, "ForEachRow", StringComparison.OrdinalIgnoreCase))
                {
                    if (action.IsSkipped)
                    {
                        // The run list is a SHALLOW copy — item properties are live, so a
                        // mid-block skip toggle can land here with an ACTIVE frame. Exit it
                        // first: without the restore, _dataLoopOver/_currentRowData leak past
                        // the jump and the loop-top skip-absorb can teleport execution
                        // backward into the disabled block.
                        if (feState.TryGetValue(i, out var skippedFrame))
                            ExitForEachFrame(i, skippedFrame);
                        RecordRunStep(new RunStepRecord
                        {
                            Row = i + 1,
                            Profile = CurrentExecutingProfileName,
                            ActionType = "ForEachRow",
                            Detail = _runStepsFull ? null : "skipped block",
                            Status = "skipped",
                        });
                        if (map.EndLoopOf.TryGetValue(i, out int feSkipEnd))
                            i = feSkipEnd;
                        else
                            i = actions.Count;
                        continue;
                    }
                    if (!feState.TryGetValue(i, out var fe))
                    {
                        // ACTIVATION. The table is the AMBIENT context (_dataTable): inside a
                        // sub running over-data that is the sub's own table; a plain
                        // RunProfile call inherits the caller's ("to iterate the sub's own
                        // table, use RunProfile → run once per data row"). Empty/missing
                        // table → block skipped with one honest record, never an error.
                        int rowsNow = _dataTable?.Rows?.Count ?? 0;
                        if (rowsNow == 0)
                        {
                            Services.DiagnosticLog.Warn("For Each Data Row: no data rows in the active table — block skipped");
                            RecordRunStep(new RunStepRecord
                            {
                                Row = i + 1,
                                Profile = CurrentExecutingProfileName,
                                ActionType = "ForEachRow",
                                Detail = _runStepsFull ? null : "no data rows",
                                Status = "skipped",
                            });
                            if (map.EndLoopOf.TryGetValue(i, out int feEmptyEnd))
                                i = feEmptyEnd;
                            else
                                i = actions.Count;
                            continue;
                        }
                        fe = new ForEachFrame { Saved = SaveDataContext(swapRowNextCursors: false) };
                        feState[i] = fe;
                        feActive.Add(i);   // outermost FIRST — the restore net uses [0]
                        // Fault sites read the ACTIVE table's skip policy while inside the
                        // block (the sub-over-data mold); the {row:col} stamping below does
                        // the rest. {rownext} cursors are NOT swapped — same table, same walk.
                        _dataLoopOver = true;
                        // ONE record per ACTIVATION, never per row (the 500-cap would drown).
                        RecordRunStep(new RunStepRecord
                        {
                            Row = i + 1,
                            Profile = CurrentExecutingProfileName,
                            ActionType = "ForEachRow",
                            Detail = _runStepsFull ? null : $"over {rowsNow} data row(s)",
                            Status = "ok",
                        });
                    }
                    // (RE)ENTRY — the row count is RE-READ every pass rather than captured at
                    // activation. Today it CANNOT change: the Data panel's save replaces the whole
                    // ProfileDataTable object (WebViewBridge: `UserProfile.Current.Data = table`)
                    // and nothing mutates Rows in place, so _dataTable is an immutable snapshot
                    // for the run's duration. (The comment here used to claim the panel "edits
                    // live" — it does not, and believing that would suggest in-place mutation is
                    // supported.) The re-read stays because it costs one field access and is the
                    // correct code the day that invariant changes; indexing past a shrunken table
                    // is what it protects against.
                    int rowCount = _dataTable?.Rows?.Count ?? 0;
                    if (fe.Cursor >= rowCount)
                    {
                        ExitForEachFrame(i, fe);
                        if (map.EndLoopOf.TryGetValue(i, out int feDoneEnd))
                            i = feDoneEnd;
                        else
                            i = actions.Count;
                        continue;
                    }
                    _currentRowData = BuildRowDict(_dataTable!, fe.Cursor);
                    fe.Cursor++;   // advanced at STAMP time — a skip-absorb reentry is already "next row"
                    _currentDataRow = fe.Cursor;   // {datarow}: 1-based once advanced
                    PushVariablesSnapshot();
                    nextTickMs = sw.ElapsedMilliseconds;   // fresh row, fresh schedule
                    continue;
                }

                if (action.IsSkipped) continue;
                int safeDelay = JitteredDelay(action.Delay);

                // The (jittered) delay advances a deadline instead of feeding Task.Delay
                // directly, so the wait measures from the PREVIOUS action's deadline rather
                // than from whenever its execution happened to finish — the action's own
                // cost no longer stretches the cadence. Behind schedule (a slow action, a
                // stall)? Resync instead of banking the debt — otherwise the loop would
                // "catch up" with a no-delay salvo, same rationale as the clicker's scheduler.
                nextTickMs += safeDelay;
                long wait = nextTickMs - sw.ElapsedMilliseconds;
                if (wait > 0)
                    await Task.Delay((int)wait, token);
                else
                    nextTickMs = sw.ElapsedMilliseconds;
                _currentActionRow = i + 1; // {row} token source (1-based grid row)
                _currentLoopIteration = InnermostLoopIteration(i);   // {loop} token source
                dispatcherQueue.TryEnqueue(() => OnActionExecuting?.Invoke(action));
                InputHookManager.IsReplayingAction = true;

                // Run report — one record per action. The stopwatch wraps ONLY the switch, so the
                // number is the action's own cost and not the Delay the user configured before it
                // (which is already visible in the grid and would swamp the interesting part).
                var stepRec = new RunStepRecord
                {
                    Row = i + 1,
                    // Read per action rather than once per ExecuteActionsAsync call: the same call
                    // frame can span a RunProfile that pushes and pops the stack, and reading it
                    // here is what keeps the parent's rows stamped with the parent after the sub
                    // returns.
                    Profile = CurrentExecutingProfileName,
                    ActionType = action.ActionType ?? "",
                    // Skipped once the report is full: RecordRunStep discards the whole record from
                    // there on (it only bumps the overflow counter), so the string work — up to four
                    // allocations per action, forever, in an unbounded loop — buys nothing. The
                    // record itself still has to exist for the Status/ErrorCode writes in the catch
                    // blocks below.
                    Detail = _runStepsFull ? null : DescribeStepDetail(action),
                };
                // Published so the auto-cancel paths can mark this step before they pull the run
                // out from under it — see FailCurrentStep.
                _currentStepRec = stepRec;
                var stepWatch = System.Diagnostics.Stopwatch.StartNew();
                // Appended on START, not on completion. RunStepRecord is a class and the catch /
                // finally blocks below mutate this same instance in place, so reserving the slot
                // here costs nothing and fixes the ORDER: a RunProfile row completes only after
                // the entire sub-call, so recording at completion filed the caller's row AFTER
                // every row of the profile it invoked. The report then opened on the sub-profile,
                // and a nested A→B→C came out in pure post-order — the exact reverse of the call
                // sequence. Start order narrates the chain as it ran, which is the whole premise
                // of the per-profile grouping in the report panel.
                //
                // Two knock-ons, both improvements: the MaxRunStepRecords cut now drops by start
                // order (before, a sub-profile that filled the cap discarded the very row that
                // invoked it), and a report requested MID-run now shows in-flight rows with
                // DurationMs still 0 instead of omitting them.
                RecordRunStep(stepRec);

                try
                {
                    switch (action.ActionType)
                    {
                        case "KeyDown": {
                            // Token keys record their resolution under the RAW key text so the
                            // matching KeyUp releases exactly what was pressed — {var} can change
                            // (SetVariable in between), {random} re-rolls, {clipboard} is live.
                            // Without the pairing, the up would target a different key and the
                            // pressed one would stay stuck past a normally-completed run.
                            var downKey = await ResolveKeyTokens(action.Key);
                            if (action.Key.IndexOf('{') >= 0)
                                _pendingTokenKeyDowns[action.Key] = downKey;
                            SimulateKey(downKey, true);
                            break;
                        }
                        case "KeyUp": {
                            string upKey;
                            if (action.Key.IndexOf('{') >= 0 && _pendingTokenKeyDowns.Remove(action.Key, out var pairedDown))
                                upKey = pairedDown;
                            else
                                upKey = await ResolveKeyTokens(action.Key);
                            SimulateKey(upKey, false);
                            break;
                        }
                        case "HoldKey": {
                            // Send KEYDOWN, hold the configured duration, then KEYUP. The
                            // SimulateKey tracker (Add on isDown / Remove on !isDown) keeps
                            // the key in _simulatedKeysDown for the entire hold, so a Stop
                            // mid-hold has ResetKeyState() release it cleanly instead of
                            // leaving it stuck in the OS keyboard state.
                            int duration = action.HoldDurationMs > 0
                                ? Math.Max(10, Math.Min(60000, action.HoldDurationMs))
                                : ActionItem.DefaultHoldDurationMs;
                            // Resolve ONCE and reuse for both halves — the down and up must
                            // agree on the key string or the stuck-key tracker desyncs.
                            var holdKey = await ResolveKeyTokens(action.Key);
                            SimulateKey(holdKey, true);
                            try { await Task.Delay(duration, token); }
                            catch (OperationCanceledException) { /* ResetKeyState releases */ }
                            SimulateKey(holdKey, false);
                            break;
                        }
                        case "Keystroke": {
                            // RepeatCount > 1 → emit N consecutive press cycles with the
                            // RepeatDelayMs gap (and optional ±% jitter) between them, via the
                            // shared ExecuteRepeated driver. Resolve the combo ONCE, outside the
                            // burst — no other action runs between repeats, so the value can't
                            // legitimately change mid-burst.
                            // Position jitter is meaningless for a keystroke (no coordinates) —
                            // discard the offsets the shared driver hands every body.
                            var combo = await ResolveKeyTokens(action.Key);
                            await ExecuteRepeated(action, token, (_, _) => SimulateKeystroke(combo, token));
                            break;
                        }
                        case "LeftClickDown": SimulateMouse(action.X, action.Y, NativeMethods.MOUSEEVENTF_LEFTDOWN, token: token); break;
                        case "LeftClickUp": SimulateMouse(action.X, action.Y, NativeMethods.MOUSEEVENTF_LEFTUP, token: token); break;
                        case "RightClickDown": SimulateMouse(action.X, action.Y, NativeMethods.MOUSEEVENTF_RIGHTDOWN, token: token); break;
                        case "RightClickUp": SimulateMouse(action.X, action.Y, NativeMethods.MOUSEEVENTF_RIGHTUP, token: token); break;
                        case "MiddleClickDown": SimulateMouse(action.X, action.Y, NativeMethods.MOUSEEVENTF_MIDDLEDOWN, token: token); break;
                        case "MiddleClickUp": SimulateMouse(action.X, action.Y, NativeMethods.MOUSEEVENTF_MIDDLEUP, token: token); break;
                        // Combined-mode clicks: one row = press + release at the same point.
                        // SimulateMouse moves the cursor and embeds the position in each event,
                        // so the two calls land the down/up together (the second move is a no-op).
                        // The release is skipped if the press cancelled the replay (e.g. a missing
                        // target window with relative coords calls _cts.Cancel via
                        // ReportMissingTargetWindow) — this matches paired mode, where the loop
                        // breaks after the *Down action and the *Up never fires, so only ONE error
                        // surfaces. A button left pressed mid-cancel is released by StartAsync's
                        // finally (ResetMouseState), so skipping the up can't leave it stuck.
                        // RepeatCount > 1 → replay the combined click N times (Times/Gap/Gap-jitter
                        // set in the Sheet), mirroring Keystroke × N via the shared ExecuteRepeated
                        // driver. RepeatCount == 1 (every recorded/existing click) runs the body once
                        // — byte-identical to the pre-feature single-shot. The focus tap, when on,
                        // fires once per cycle so each click still lands on a small target. Paired
                        // halves keep their single-shot cases below; Double/TripleClick repeat via
                        // their own wrapped cases (each cycle keeps the fixed ×2 / ×3 internal
                        // timing, which MultiClickPairs owns). (jx, jy) is the
                        // cycle's position-jitter offset (0,0 unless Position jitter is on and
                        // Times > 1) — applied ONCE per cycle to a local point so the down, the
                        // up and the focus tap all land together instead of turning into a drag.
                        // ResolveClickPoint yields the cycle's point and whether it still needs the
                        // profile-space translation: a normal click is the stored X/Y plus this
                        // cycle's jitter (profile space), an AtCursor click is the LIVE cursor read
                        // ONCE here (already absolute — see the helper for why re-reading per
                        // press/release would be a drag).
                        case "LeftClick":
                            await ExecuteRepeated(action, token, (jx, jy) => {
                                var (cx, cy, ps) = ResolveClickPoint(action, jx, jy);
                                StampCursorPoint(stepRec, action, cx, cy);
                                SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_LEFTDOWN, coordsAreProfileSpace: ps, token: token);
                                if (!token.IsCancellationRequested)
                                    SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_LEFTUP, coordsAreProfileSpace: ps, token: token);
                                if (action.IsFocusClick && !token.IsCancellationRequested)
                                    FocusTap(cx, cy, NativeMethods.MOUSEEVENTF_LEFTDOWN, NativeMethods.MOUSEEVENTF_LEFTUP, token, ps, restoreAnchor: action.AtCursor);
                            });
                            break;
                        case "RightClick":
                            await ExecuteRepeated(action, token, (jx, jy) => {
                                var (cx, cy, ps) = ResolveClickPoint(action, jx, jy);
                                StampCursorPoint(stepRec, action, cx, cy);
                                SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_RIGHTDOWN, coordsAreProfileSpace: ps, token: token);
                                if (!token.IsCancellationRequested)
                                    SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_RIGHTUP, coordsAreProfileSpace: ps, token: token);
                                if (action.IsFocusClick && !token.IsCancellationRequested)
                                    FocusTap(cx, cy, NativeMethods.MOUSEEVENTF_RIGHTDOWN, NativeMethods.MOUSEEVENTF_RIGHTUP, token, ps, restoreAnchor: action.AtCursor);
                            });
                            break;
                        case "MiddleClick":
                            await ExecuteRepeated(action, token, (jx, jy) => {
                                var (cx, cy, ps) = ResolveClickPoint(action, jx, jy);
                                StampCursorPoint(stepRec, action, cx, cy);
                                SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_MIDDLEDOWN, coordsAreProfileSpace: ps, token: token);
                                if (!token.IsCancellationRequested)
                                    SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_MIDDLEUP, coordsAreProfileSpace: ps, token: token);
                                if (action.IsFocusClick && !token.IsCancellationRequested)
                                    FocusTap(cx, cy, NativeMethods.MOUSEEVENTF_MIDDLEDOWN, NativeMethods.MOUSEEVENTF_MIDDLEUP, token, ps, restoreAnchor: action.AtCursor);
                            });
                            break;
                        // Press, hold for the authored duration, release — the mouse twin of
                        // HoldKey above, and the only click row whose press and release are
                        // separated by a wait the user typed rather than one the recording
                        // captured (which is why the family sits in LongWaitActionTypes above).
                        //
                        // The point is resolved ONCE per cycle and reused for BOTH halves. An
                        // at-cursor hold that re-read GetCursorPos at the release would turn a
                        // hand-nudge mid-hold into a DRAG — the exact failure AtCursor's note on
                        // ActionItem warns about, and far likelier here than on an instant click
                        // because the hold gives the hand seconds to move.
                        //
                        // The button stays in the shared _simLeftDown/_simRightDown/_simMiddleDown
                        // state for the whole hold, so a Stop mid-hold has ResetMouseState()
                        // release it instead of leaving it latched system-wide — the same contract
                        // HoldKey has with ResetKeyState, and the reason the release below may be
                        // skipped on cancellation without stranding the button.
                        //
                        // IsFocusClick is deliberately NOT honoured: the tap would press and
                        // release the same button immediately before the hold takes it, and the
                        // hold's own press already gives the target focus for the entire dwell.
                        case "LeftClickHold":
                        case "RightClickHold":
                        case "MiddleClickHold":
                        {
                            (uint downEvent, uint upEvent) = action.ActionType switch
                            {
                                "RightClickHold"  => (NativeMethods.MOUSEEVENTF_RIGHTDOWN,  NativeMethods.MOUSEEVENTF_RIGHTUP),
                                "MiddleClickHold" => (NativeMethods.MOUSEEVENTF_MIDDLEDOWN, NativeMethods.MOUSEEVENTF_MIDDLEUP),
                                _                 => (NativeMethods.MOUSEEVENTF_LEFTDOWN,   NativeMethods.MOUSEEVENTF_LEFTUP),
                            };
                            // Same clamp and same "0 means the shared default" as HoldKey, read
                            // from the same field, so the two holds cannot drift apart.
                            int holdMs = action.HoldDurationMs > 0
                                ? Math.Max(10, Math.Min(60000, action.HoldDurationMs))
                                : ActionItem.DefaultHoldDurationMs;
                            await ExecuteRepeatedCore(action, token, async (jx, jy) => {
                                var (cx, cy, ps) = ResolveClickPoint(action, jx, jy);
                                StampCursorPoint(stepRec, action, cx, cy);
                                SimulateMouse(cx, cy, downEvent, coordsAreProfileSpace: ps, token: token);
                                try { await Task.Delay(holdMs, token); }
                                catch (OperationCanceledException) { /* ResetMouseState releases */ }
                                if (!token.IsCancellationRequested)
                                    SimulateMouse(cx, cy, upEvent, coordsAreProfileSpace: ps, token: token);
                            });
                            break;
                        }
                        // Two full left press/release pairs at the SAME point with a gap well
                        // below GetDoubleClickTime, so the target app pairs them into a real
                        // double-click. The cursor only travels once — the second pair's move
                        // is a no-op because SimulateMouse sees it's already on target, which
                        // also keeps the clicks inside the SM_CX/CYDOUBLECLK rectangle.
                        // IsFocusClick is intentionally ignored here (a focus tap after a
                        // double-click would read as a triple-click to the target — and now that
                        // TripleClick is a real type, that accident must stay unreachable).
                        // RepeatCount > 1 → replay the WHOLE double-click N times via ExecuteRepeated;
                        // the inter-repeat gap defaults larger (DefaultDoubleClickRepeatDelayMs) so the
                        // OS reads distinct double-clicks. Position jitter (jx, jy) offsets
                        // the WHOLE double-click by one point per cycle — deliberately NOT per
                        // pair: the two pairs must stay inside the SM_CX/CYDOUBLECLK rectangle or
                        // the OS stops reading them as a double-click at all.
                        // The pair loop lives in MultiClickPairs, shared with TripleClick so the two
                        // cannot drift. It is the pre-existing body except that cancellation is now
                        // also checked BEFORE the first press (previously that press was
                        // unconditional, leaving an orphan for ResetMouseState to clean up).
                        case "DoubleClick":
                            await ExecuteRepeated(action, token, (jx, jy) => {
                                var (cx, cy, ps) = ResolveClickPoint(action, jx, jy);
                                StampCursorPoint(stepRec, action, cx, cy);
                                MultiClickPairs(cx, cy, 2, token, ps);
                            });
                            break;
                        // Three full left press/release pairs at the SAME point — the target reads a
                        // real triple-click (select-a-paragraph), which two DoubleClick rows can NOT
                        // produce: their inter-repeat gap is deliberately 600 ms so the OS reads them
                        // as distinct double-clicks rather than chaining them.
                        // Everything the DoubleClick comment above says applies verbatim, and one
                        // thing more strongly: IsFocusClick is ignored because a focus tap after
                        // three pairs would read as a FOURTH click and restart the chain.
                        case "TripleClick":
                            await ExecuteRepeated(action, token, (jx, jy) => {
                                var (cx, cy, ps) = ResolveClickPoint(action, jx, jy);
                                StampCursorPoint(stepRec, action, cx, cy);
                                MultiClickPairs(cx, cy, 3, token, ps);
                            });
                            break;
                        case "ScrollUp": SimulateScroll(120); break;
                        case "ScrollDown": SimulateScroll(-120); break;
                        case "SendText":
                        {
                            var d = ResolveSendTextDelivery(action);
                            await SendTextPayload(d.Text, d.Html, d.Type, d.CharDelayMs, token);
                            break;
                        }
                        case "SetVariable": await ExecuteSetVariable(action, token); break;
                        case "CopyToSlot": await ExecuteCopyToSlot(action, token); break;
                        case "Assert": {
                            // D4 quiet-stop: the row stays "ok" (the probe RAN — the same
                            // philosophy the If row applies) and the Detail says what happened.
                            bool quietStopped = await ExecuteAssert(action, token);
                            // "failed", not "not met": the quiet stop also fires when the probe
                            // could not be CHECKED, and the report must not claim a judgment
                            // that never happened.
                            if (quietStopped && !_runStepsFull)
                                stepRec.Detail = (stepRec.Detail is { Length: > 0 } d ? d + " " : "")
                                    + "— assert failed · stopped run (quiet)";
                            break;
                        }
                        case "ActivateWindow": await ExecuteActivateWindow(action, token); break;
                        case "WaitImage": await ExecuteWaitImage(action, token); break;
                        case "WaitText": await ExecuteWaitText(action, token); break;
                        case "WaitPixelColor": await ExecuteWaitPixelColor(action, token); break;
                        case "RunProfile": {
                            // A refusal (disabled target, cycle, over-depth, missing profile, …)
                            // is a deliberate non-fatal no-op, and until now it reported "ok".
                            // Status is set BEFORE the finally, whose promotion only fires on
                            // "running", so this sticks. See HandleRunProfile for why "skipped"
                            // rather than "failed".
                            var runProfileSkip = await HandleRunProfile(action, token);
                            if (runProfileSkip != null)
                            {
                                stepRec.Status = "skipped";
                                if (!_runStepsFull)
                                    stepRec.Detail = (stepRec.Detail is { Length: > 0 } d ? d + " — " : "")
                                        + runProfileSkip;
                            }
                            break;
                        }
                        case "Pause": await ExecutePause(action, token); break;
                        case "BrowserAssert": {
                            bool quietStopped = await ExecuteBrowserAssert(action, token);
                            // "failed", not "not met" — see the desktop Assert case above.
                            if (quietStopped && !_runStepsFull)
                                stepRec.Detail = (stepRec.Detail is { Length: > 0 } d ? d + " " : "")
                                    + "— assert failed · stopped run (quiet)";
                            break;
                        }
                        case "Stop": {
                            // D5: end the WHOLE run as SUCCESS — "the macro decided it is done".
                            // No OnReplayError and no _userStopped flag: the cancel unwinds
                            // through the OCE catches, StartAsync's finally lands the status on
                            // "ready", and the bridge emits its normal success cue.
                            //
                            // Ordering proof for this row reading "ok": nothing awaits between
                            // Cancel and this frame's finally, so the OCE catch below cannot fire
                            // for THIS row and the finally's running→ok promotion runs; parent
                            // frames return normally ("ok" as well). A future await inserted
                            // after the Cancel would break that proof — don't.
                            if (!_runStepsFull) stepRec.Detail = "run ended by Stop";
                            _authoredStop = true;   // notices gate: authored finish ≠ user abort
                            try { _cts?.Cancel(); } catch (ObjectDisposedException) { }
                            break;
                        }
                        case "Return": {
                            // D6: end only the CURRENT pass — the boundary check at the top of
                            // this loop breaks on the flag, and each caller clears it after its
                            // await, so repeat passes / data rows / loop iterations continue.
                            // Held keys are NOT released here on purpose: Return is authored
                            // flow, exactly like reaching the end of the list.
                            if (!_runStepsFull) stepRec.Detail = "ended this pass";
                            _returnRequested = true;
                            break;
                        }
                        case "BrowserClick":
                        case "BrowserRightClick":
                        case "BrowserType":
                        case "BrowserWaitElement":
                        case "BrowserNavigate":
                        case "BrowserSelectOption":
                            if (_browserBridge != null)
                            {
                                // Resolve {clipboard}, {date}, {time}, {datetime} in BrowserText without
                                // mutating original. Applies to BrowserType AND BrowserSelectOption
                                // (where a user might want to pick an option dynamically by clipboard
                                // content, e.g. clipboard holds "Option 1" → select matches that).
                                // BrowserType keeps a SUBSTITUTED brace as its sentinel (see
                                // ResolveBrowserTypeTextAsync); Select Option matches the text, so it
                                // gets the real characters.
                                string? resolvedText = null;
                                if (!string.IsNullOrEmpty(action.BrowserText))
                                {
                                    if (action.ActionType == "BrowserType")
                                        resolvedText = await ResolveBrowserTypeTextAsync(action.BrowserText, dispatcherQueue, CurrentRunCtx);
                                    else if (action.ActionType == "BrowserSelectOption")
                                        resolvedText = await ResolveBrowserTextPlaceholders(action.BrowserText);
                                }
                                // The result was previously discarded. It carries matchedVia — WHICH
                                // selector tier actually matched — which is the single most useful
                                // thing to know when a macro starts failing on DOM drift, because a
                                // fallback match means the primary selector is already dead.
                                var browserResult = await _browserBridge.ExecuteBrowserCommandAsync(
                                    action, token, action.Timeout > 0 ? action.Timeout : 5000, resolvedText);
                                if (browserResult.ValueKind == System.Text.Json.JsonValueKind.Object
                                    && browserResult.TryGetProperty("matchedVia", out var mvEl)
                                    && mvEl.ValueKind == System.Text.Json.JsonValueKind.Object)
                                {
                                    stepRec.MatchedSelector = mvEl.TryGetProperty("selector", out var mvS) ? mvS.GetString() : null;
                                    stepRec.MatchedTier = mvEl.TryGetProperty("tier", out var mvT) ? mvT.GetString() : null;
                                }
                                if (browserResult.ValueKind == System.Text.Json.JsonValueKind.Object
                                    && browserResult.TryGetProperty("tabUrl", out var tabUrlEl)
                                    && tabUrlEl.ValueKind == System.Text.Json.JsonValueKind.String)
                                {
                                    stepRec.TabUrl = tabUrlEl.GetString();
                                }
                            }
                            break;
                    }
                }
                catch (BrowserActionException bex)
                {
                    // Record the STRUCTURED diagnosis before it is flattened into a message string
                    // higher up. Rethrow untouched — the failure policy above this frame is what
                    // decides whether the run halts or the data-loop row is skipped. The ONE
                    // exception: inside an inline ForEachRow whose table policy is skip, a thrown
                    // error IS the row's failure (the sub-over-data catch treats it the same) and
                    // the frame's restore net would fire BEFORE any caller's filter could see the
                    // hoisted state — so it softens to a row fault here, and the loop-top absorb
                    // reenters on the next data row.
                    stepRec.Status = "failed";
                    stepRec.ErrorCode = bex.Code;
                    stepRec.ErrorMessage = bex.Message;
                    stepRec.Tip = bex.Tip;
                    // The success path records this after the call returns, which never happens
                    // here — so a failing step used to be the ONE step whose page went unrecorded.
                    // Null on a timeout, where the extension never answered and there is honestly
                    // no page to name.
                    stepRec.TabUrl = bex.TabUrl;
                    if (feActive.Count > 0
                        && string.Equals(_dataTable?.OnRowError, "skip", StringComparison.OrdinalIgnoreCase))
                        FaultRow(bex.Message);
                    else
                        throw;
                }
                catch (OperationCanceledException)
                {
                    stepRec.Status = "skipped";   // user stop or a fault policy cancelling the run
                    throw;
                }
                catch (Exception ex)
                {
                    stepRec.Status = "failed";
                    stepRec.ErrorMessage = ex.Message;
                    // Same inline-ForEachRow softening as the BrowserActionException arm above.
                    if (feActive.Count > 0
                        && string.Equals(_dataTable?.OnRowError, "skip", StringComparison.OrdinalIgnoreCase))
                        FaultRow(ex.Message);
                    else
                        throw;
                }
                finally
                {
                    InputHookManager.IsReplayingAction = false;
                    stepWatch.Stop();
                    // The record is already in the list (appended before the try) — this writes
                    // through the reference the list holds, same as the Status / ErrorCode writes
                    // in the catch blocks above.
                    stepRec.DurationMs = stepWatch.ElapsedMilliseconds;
                    // Success has no explicit write anywhere — it used to be the default. Promote
                    // here rather than after the try: `finally` is the one place that runs on
                    // EVERY exit, so no future `break`/`continue`/early return can leave a
                    // finished step reading as still running. The catch blocks have already
                    // written failed/skipped by now, so this only ever fires for a clean pass.
                    if (stepRec.Status == "running") stepRec.Status = "ok";
                    _currentStepRec = null;
                }

                // Wait-class actions legitimately consume wall time — that time is the whole
                // point of the action, not schedule debt. Resync the deadline after them so
                // the NEXT action's delay runs in full: users configure that delay as a
                // settle period after the wait, and deadline scheduling would otherwise
                // compress it to zero.
                // …and after any row that stopped for the Ask-Input modal: a {input:} in a
                // SetVariable value or a Keystroke key parks the run for up to a minute, and that
                // wait was never part of any recorded gap either. Consumed on every row, so a flag
                // set here cannot leak into a later one.
                bool waitedOnUser = ConsumeWaitedOnUser();
                if (ShouldResyncAfter(action) || waitedOnUser)
                    nextTickMs = sw.ElapsedMilliseconds;
            }
        }

        /// <summary>
        /// Saved snapshot of the window-context state so a sub-profile can apply its own without
        /// destroying the caller's context.
        /// </summary>
        private struct WindowContextSnapshot
        {
            public bool UseRelativeCoordinates;
            public Models.WindowTarget? WindowTarget;
            public int LockWidth, LockHeight, LockX, LockY;
            public bool RestorePosition;
            public bool RestoreSize;
            public bool BringToFocus;
            // Not a window setting, but it rides the same save/restore for the same reason: a
            // sub-profile with its own Game Mode applies it for its call and the caller's comes
            // back on return, however the call ends.
            public bool? GameMode;
        }

        private WindowContextSnapshot SaveWindowContext() => new()
        {
            GameMode = _runGameMode,
            UseRelativeCoordinates = _useRelativeCoordinates,
            WindowTarget = _windowTarget,
            LockWidth = _lockWidth,
            LockHeight = _lockHeight,
            LockX = _lockX,
            LockY = _lockY,
            RestorePosition = _restorePosition,
            RestoreSize = _restoreSize,
            BringToFocus = _bringToFocus,
        };

        private void RestoreWindowContext(WindowContextSnapshot snap)
        {
            _useRelativeCoordinates = snap.UseRelativeCoordinates;
            _windowTarget = snap.WindowTarget;
            _windowTargetTitleRegex = TrueReplayer.Helpers.WindowMatcher.CompileTitleRegex(snap.WindowTarget);
            _lockWidth = snap.LockWidth;
            _lockHeight = snap.LockHeight;
            _lockX = snap.LockX;
            _lockY = snap.LockY;
            _restorePosition = snap.RestorePosition;
            _restoreSize = snap.RestoreSize;
            _bringToFocus = snap.BringToFocus;
            _runGameMode = snap.GameMode;
        }

        /// <summary>
        /// The focus + lock-position + lock-size setup, applied at the top of a run (StartAsync,
        /// settle 300 ms) and at a sub-profile entry (settle 200 ms), so both apply a target window
        /// the same way. Runs on a pool thread in both cases — see StartAsync on why never the UI's.
        /// </summary>
        private async Task ApplyWindowContextAsync(CancellationToken token, int settleMs = 200)
        {
            IntPtr focusedHwnd = IntPtr.Zero;
            if (_bringToFocus && _windowTarget != null)
            {
                var targetHwnd = FindTargetWindow();
                if (targetHwnd == IntPtr.Zero)
                {
                    // A missing target used to be a total no-op — no log, no step in the run
                    // report — and with ABSOLUTE coordinates there is no rescue afterwards
                    // (TryResolveRelativeOffset returns true immediately for non-relative), so
                    // the clicks land at those screen positions and SendText types into
                    // whatever happens to be in front. An automation then reports "fired".
                    // Costs nothing: FindTargetWindow has already run.
                    DiagnosticLog.Warn(
                        $"BringToFocus: target window not found ({DescribeWindowTarget(_windowTarget)}) — " +
                        "the run continues against whatever is in the foreground");
                }
                else if (NativeMethods.IsHungAppWindow(targetHwnd))
                {
                    // A frozen owner does not answer the restore/raise that the activation sends it,
                    // and the call waits on it with no timeout of its own. Same best-effort policy
                    // as a refused switch: the run goes on, and the log says why nothing came forward.
                    DiagnosticLog.Warn(
                        $"BringToFocus: target window is not responding ({DescribeWindowTarget(_windowTarget)}) — " +
                        "activation skipped; the run continues against whatever is in the foreground");
                }
                else
                {
                    // Full activation stack, best-effort (see WindowActivation).
                    await TrueReplayer.Helpers.WindowActivation.ActivateAsync(
                        targetHwnd, _windowTarget, _windowTargetTitleRegex, token);
                    await Task.Delay(settleMs, token); // Wait for window to restore and gain focus
                    focusedHwnd = targetHwnd;
                }
            }

            // Restore Position / Restore Size: reposition/resize target window before replay.
            // Independent from Relative Coordinates — the user can restore geometry even with
            // absolute coordinates (e.g., they just want the window consistently placed).
            // hasSize gates the SIZE only. Position must NOT be gated on it: "Convert coords →
            // Absolute" zeroes WindowWidth/Height while deliberately keeping the captured X/Y
            // (WebViewBridge.ExecuteConvertCoordinatesWithRect), and that position-only restore
            // is precisely what keeps absolute coordinates valid — the window has to go back
            // where they were measured. Gating applyPos on width/height turned it into a silent
            // no-op for every profile that ever went through that conversion.
            bool hasSize = _lockWidth > 0 && _lockHeight > 0;
            bool applySize = _restoreSize && hasSize;
            bool applyPos = _restorePosition;
            // The window just brought forward, not a second lookup — the rule
            // ExecuteActivateWindow already follows. With two windows that match (a process
            // name alone, a loose title regex), a fresh FindTargetWindow walks the Z-order
            // again and, after a refused or superseded activation, moves and sizes the OTHER
            // one.
            if (_windowTarget != null && (applySize || applyPos))
                await ApplyWindowGeometryAsync(focusedHwnd != IntPtr.Zero ? focusedHwnd : FindTargetWindow(),
                    _lockX, _lockY, _lockWidth, _lockHeight, applyPos, applySize, token);
        }

        private static string DescribeWindowTarget(Models.WindowTarget target)
            => $"{target.ProcessName ?? "any process"}" +
               $"{(string.IsNullOrEmpty(target.WindowTitle) ? "" : $" / {target.WindowTitle}")}";

        /// <summary>
        /// Moves and/or resizes a window to a saved rect. Shared by the profile/folder
        /// "restore position/size" pass and the per-action ActivateWindow placement, so the
        /// un-maximize workaround (a zoomed window ignores SetWindowPos sizing — the Chrome
        /// case) and the minimized guard live in ONE place instead of being copied per call site.
        /// </summary>
        private static async Task ApplyWindowGeometryAsync(
            IntPtr hwnd, int x, int y, int width, int height,
            bool applyPos, bool applySize, CancellationToken token)
        {
            if (hwnd == IntPtr.Zero || (!applyPos && !applySize)) return;
            if (NativeMethods.IsIconic(hwnd)) return;
            // Both calls below are ASYNC variants: the synchronous ones wait for the window's own
            // thread to process the move, with no timeout, so a frozen target used to hold this
            // thread until it recovered — or forever. A hung window is skipped outright: nothing
            // posted to it can land while it is hung, and the log says why it did not move.
            if (NativeMethods.IsHungAppWindow(hwnd))
            {
                DiagnosticLog.Warn("Window placement skipped: the target window is not responding.");
                return;
            }
            if (applySize && NativeMethods.IsZoomed(hwnd))
            {
                NativeMethods.ShowWindowAsync(hwnd, NativeMethods.SW_RESTORE);
                // A zoomed window ignores the resize, so wait until it has actually left the
                // maximized state rather than a fixed 80 ms: a busy app processes the restore late,
                // and the resize then went through against a window still maximized — accepted,
                // no error, no effect, and every click of the run measured against a size the
                // window never took. Past the ceiling the placement is skipped and logged.
                var unzoom = System.Diagnostics.Stopwatch.StartNew();
                while (NativeMethods.IsZoomed(hwnd) && unzoom.ElapsedMilliseconds < UnzoomTimeoutMs)
                    await Task.Delay(20, token);
                if (NativeMethods.IsZoomed(hwnd))
                {
                    DiagnosticLog.Warn(
                        $"Window placement skipped: the target window is still maximized {UnzoomTimeoutMs} ms " +
                        $"after the restore, so the {width}x{height} size cannot take effect.");
                    return;
                }
                await Task.Delay(80, token); // the restore's own relayout (the Chrome case)
            }
            if (applyPos) (x, y) = ClampOnScreen(hwnd, x, y, width, height, applySize);
            uint flags = NativeMethods.SWP_NOZORDER | NativeMethods.SWP_ASYNCWINDOWPOS;
            if (!applyPos) flags |= NativeMethods.SWP_NOMOVE;
            if (!applySize) flags |= NativeMethods.SWP_NOSIZE;
            NativeMethods.SetWindowPos(hwnd, IntPtr.Zero,
                applyPos ? x : 0, applyPos ? y : 0,
                applySize ? width : 0, applySize ? height : 0, flags);
            await Task.Delay(80, token);
        }

        // How long a zoomed window gets to leave the maximized state before a size placement is
        // given up. A responsive window does it in one frame; this only bounds a busy one.
        private const int UnzoomTimeoutMs = 1500;

        // How much of the window has to stay reachable after a placement: enough title bar to
        // grab with the mouse. Windows' own snap/restore logic uses a comparable margin.
        private const int MinOnScreenX = 120;
        private const int MinOnScreenY = 32;

        /// <summary>
        /// Keeps a placement's target position on the desktop that actually exists right now.
        ///
        /// Stored geometry is a snapshot of the machine it was captured on. Capture the target on
        /// a secondary monitor at x=2560, replay on the laptop alone, and SetWindowPos happily
        /// parks the window entirely off-screen — silently, and every click the macro makes after
        /// that lands on nothing, so the failure surfaces as "the macro stopped working" with no
        /// hint of where it went. Windows does not rescue this; nothing here did either.
        ///
        /// CLAMPS POSITION ONLY. An oversized window is ugly but reachable — the user can resize
        /// it — while re-deriving a size would be rewriting what they authored. Same doctrine as
        /// WarnRelativeGeometryDrift: notice the mismatch, do not silently rescale the macro's
        /// intent. The move is still made, just to the nearest position that leaves a grabbable
        /// strip on a real monitor, and the log says it happened so "why is my window not at
        /// 2560?" has an answer.
        ///
        /// The window's own size comes from the placement when it is also setting the size, and
        /// otherwise from the live rect — without it there is no way to know how far left a
        /// window may hang while keeping its right edge visible.
        /// </summary>
        private static (int X, int Y) ClampOnScreen(IntPtr hwnd, int x, int y, int width, int height, bool applySize)
        {
            int w = width, h = height;
            if (!applySize || w <= 0 || h <= 0)
            {
                if (!NativeMethods.GetWindowRect(hwnd, out var cur)) return (x, y);
                w = cur.Right - cur.Left;
                h = cur.Bottom - cur.Top;
            }
            if (w <= 0 || h <= 0) return (x, y);

            var (vx, vy, vw, vh) = NativeMethods.VirtualScreen.Bounds;
            if (vw <= 0 || vh <= 0) return (x, y);

            // A window may hang off the LEFT as long as MinOnScreenX of its right edge is still
            // on the desktop, and off the RIGHT as long as MinOnScreenX of its left edge is. The
            // top is never allowed above the desktop: a title bar above the screen is the one
            // position the user genuinely cannot recover with the mouse.
            int minX = vx + MinOnScreenX - w;
            int maxX = vx + vw - MinOnScreenX;
            int minY = vy;
            int maxY = vy + vh - MinOnScreenY;

            int cx = Math.Clamp(x, Math.Min(minX, maxX), Math.Max(minX, maxX));
            int cy = Math.Clamp(y, Math.Min(minY, maxY), Math.Max(minY, maxY));
            if (cx != x || cy != y)
            {
                DiagnosticLog.Warn(
                    $"Window placement: ({x},{y}) is off the current desktop " +
                    $"({vw}x{vh} at {vx},{vy}) for a {w}x{h} window — clamped to ({cx},{cy}). " +
                    "The stored position probably came from a monitor that is no longer connected.");
            }
            return (cx, cy);
        }

        /// <summary>
        /// Resolves a RunProfile action: validates target, guards cycles and depth, applies the
        /// sub-profile's window context (if it has one), executes its actions N times, then
        /// restores the caller's context.
        /// </summary>
        /// <summary>
        /// Runs a RunProfile row. Returns null when the sub-profile actually executed, otherwise a
        /// SHORT human-readable reason it did not — which the caller writes into the row's run-report
        /// step (Status "skipped" + the reason in Detail).
        ///
        /// Why the return value exists: every one of the seven refusals below is a deliberate,
        /// non-fatal no-op that only logged. The step record the action switch files defaults to
        /// "running" and its finally promotes that to "ok", so the report showed
        /// "RunProfile · name · ok · 2 ms" for a call that executed nothing at all — the exact lie
        /// the Status field's own comment was written to stop ("green ticks with 0 ms … including
        /// the step that was hanging, which is the one the panel gets opened to diagnose"), and the
        /// one case that had been left out. ForEachRow over an empty table already does this right.
        ///
        /// All seven map to "skipped", never "failed", including "not found". The panel paints
        /// failed rows red and counts them in the header, and claiming a failure here would
        /// contradict the engine's own decision that these are survivable — it keeps going on
        /// purpose. The Detail carries the actionable half; that is what answers "why did nothing
        /// happen?". Same choice ForEachRow's "no data rows" makes.
        ///
        /// The other doors to the same silent no-op are already shut elsewhere, which is why this
        /// is a small fix: a rename rewrites every reference (ScanRunProfileReferencesAsync), a
        /// delete counts the dangling ones, and RunProfileDialog's picker drops self-references and
        /// disabled profiles. What is left — and what this reports — is a profile disabled AFTER the
        /// row was authored, and a cycle or over-depth chain introduced by later editing.
        /// </summary>
        private async Task<string?> HandleRunProfile(ActionItem action, CancellationToken token)
        {
            var targetName = action.Key?.Trim();
            if (string.IsNullOrEmpty(targetName))
            {
                DiagnosticLog.Info("[Chain] RunProfile with empty profile name — skipped.");
                return "no profile selected";
            }

            // Cycle detection: refuse if the target is already on the active call stack.
            if (_callStack.Contains(targetName, StringComparer.OrdinalIgnoreCase))
            {
                var path = string.Join(" → ", _callStack) + " → " + targetName;
                DiagnosticLog.Info($"[Chain] Cycle detected, aborting sub-call: {path}");
                // The PATH, not just "cycle": which loop it is, is the whole diagnosis.
                return $"cycle blocked ({path})";
            }

            // Hard depth cap as a defensive belt-and-suspenders even when cycle detection passes.
            if (_callStack.Count >= MaxCallDepth)
            {
                DiagnosticLog.Info($"[Chain] Max depth {MaxCallDepth} exceeded at '{targetName}', aborting.");
                return $"chain deeper than {MaxCallDepth} levels";
            }

            if (_profileLookup == null)
            {
                DiagnosticLog.Info("[Chain] Profile lookup not configured — RunProfile is a no-op.");
                return "profile lookup unavailable";
            }

            Models.UserProfile? subProfile;
            try
            {
                subProfile = await _profileLookup(targetName);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Info($"[Chain] Profile lookup threw for '{targetName}': {ex.Message}");
                return $"could not load profile ({ex.Message})";
            }

            if (subProfile == null)
            {
                DiagnosticLog.Info($"[Chain] Profile '{targetName}' not found, skipping.");
                return "profile not found";
            }

            // Disabled sub-profiles are skipped at replay time — same rule as direct hotkey
            // triggering (ProfileController.GetProfileHotkeys filters disabled). Running a
            // profile the user has explicitly turned off would surprise more than help.
            if (subProfile.IsDisabled)
            {
                DiagnosticLog.Info($"[Chain] Profile '{targetName}' is disabled, skipping.");
                return "profile is disabled";
            }

            // The folder half of the sub's context, read here — before anything is pushed — and
            // guarded like the profile lookup above. It used to be read unguarded further down, so a
            // throw there escaped HandleRunProfile and, with On row error off, killed the WHOLE run
            // with a bare .NET message. Refusing the step is the honest outcome; running the sub
            // against the caller's window instead would be the silent wrong one.
            Controllers.ProfileController.FolderInheritedContext? inherited = null;
            if (!TrueReplayer.Helpers.WindowMatcher.IsUsable(subProfile.TargetWindow))
            {
                try
                {
                    inherited = _folderInheritedContextLookup?.Invoke(targetName);
                }
                catch (Exception ex)
                {
                    DiagnosticLog.Info($"[Chain] Folder context lookup threw for '{targetName}': {ex.Message}");
                    return $"could not read its folder's window target ({ex.Message})";
                }
            }

            // Push and update chain status BEFORE applying sub context so the user sees the
            // chain even during the focus/lock setup phase.
            _callStack.Add(targetName);
            NotifyChainChanged();

            var savedContext = SaveWindowContext();

            // A chained sub-profile gets its OWN KeyDown/KeyUp pairing map, restored in the finally
            // below — same reasoning as the {rownext} cursor swap in RunSubProfileOverDataAsync.
            // The map is keyed by RAW token text, so a parent and a sub both using the literal
            // "{var:K}" collided in one shared dictionary: the sub's KeyDown overwrote the parent's
            // recorded resolution, the sub's KeyUp then REMOVED the entry entirely, and the parent's
            // later KeyUp fell through to a fresh resolve — releasing whatever the token means by
            // then and leaving the key the parent actually pressed stuck down past the end of the run.
            //
            // Whatever the sub leaves pending is discarded with its map, which is the right call: an
            // unpaired KeyDown inside the sub is the sub's own defect, and the stuck-key safety net
            // is _simulatedKeysDown / ResetKeyState, not this pairing table.
            var savedPendingKeyDowns = _pendingTokenKeyDowns;
            _pendingTokenKeyDowns = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                // Resolve sub's effective context: own target wins, otherwise fall back to the
                // folder it lives in. Without the folder fallback, a sub-profile that inherits
                // its target from a folder would silently run against the caller's window.
                Models.WindowTarget? subTarget = null;
                bool subUseRel = false, subBringFocus = false, subRestorePos = false, subRestoreSz = false;
                int subW = 0, subH = 0, subX = 0, subY = 0;
                // IsUsable, not a bare null check: ProfileController decides inheritance with the
                // same predicate, and a blank-but-non-null TargetWindow answered differently here
                // — the sub took its "own" branch and ran against a target that can never resolve,
                // instead of inheriting the folder's.
                if (TrueReplayer.Helpers.WindowMatcher.IsUsable(subProfile.TargetWindow))
                {
                    subTarget = subProfile.TargetWindow;
                    subUseRel = subProfile.UseRelativeCoordinates;
                    subBringFocus = subProfile.BringToFocus;
                    // Same rect rule the direct fire paths use: nothing ever captured means nothing
                    // to restore, and the Restore flags go with it. applyPos is not size-gated, so
                    // forwarding a zero rect with RestorePosition still on would move the target
                    // window to the screen corner — and would make the SAME profile behave one way
                    // chained and another way fired directly.
                    var subRect = TrueReplayer.Helpers.WindowMatcher.CapturedRect(
                        subProfile.WindowX, subProfile.WindowY, subProfile.WindowWidth, subProfile.WindowHeight);
                    subRestorePos = subRect is not null && subProfile.RestorePosition;
                    subRestoreSz = subRect is not null && subProfile.RestoreSize;
                    subX = subRect?.X ?? 0;
                    subY = subRect?.Y ?? 0;
                    subW = subRect?.Width ?? 0;
                    subH = subRect?.Height ?? 0;
                }
                else
                {
                    // Read above, before the push.
                    if (inherited.HasValue)
                    {
                        subTarget = inherited.Value.Target;
                        subUseRel = inherited.Value.UseRelativeCoordinates;
                        subBringFocus = inherited.Value.BringToFocus;
                        subRestorePos = inherited.Value.RestorePosition;
                        subRestoreSz = inherited.Value.RestoreSize;
                        subW = inherited.Value.Width;
                        subH = inherited.Value.Height;
                        subX = inherited.Value.X;
                        subY = inherited.Value.Y;
                    }
                    // else: no own target and no folder — keep the caller's context unchanged
                    //       (sub runs against whatever the parent set up).
                }
                if (subTarget != null)
                {
                    _windowTarget = subTarget;
                    _windowTargetTitleRegex = TrueReplayer.Helpers.WindowMatcher.CompileTitleRegex(subTarget);
                    _useRelativeCoordinates = subUseRel;
                    _bringToFocus = subBringFocus;
                    _restorePosition = subRestorePos;
                    _restoreSize = subRestoreSz;
                    _lockWidth = subW;
                    _lockHeight = subH;
                    _lockX = subX;
                    _lockY = subY;
                    await ApplyWindowContextAsync(token);
                }

                // Game Mode: the sub's own choice wins for its call; a sub that never set one
                // keeps the caller's EFFECTIVE value (the run field is left alone, so a caller
                // that follows the global keeps following it). Restored in the finally below.
                if (subProfile.GameMode is bool subGameMode)
                {
                    _runGameMode = subGameMode;
                    DiagnosticLog.Info($"[Chain] '{targetName}' Game Mode {(subGameMode ? "on" : "off")} (its own)");
                }

                // Clamp 1..999 to match Keystroke (the canonical RepeatCount range) — without
                // an upper bound a hand-edited/corrupt RepeatCount could spin a sub-profile an
                // unbounded number of times before the Stop hotkey gets a turn between iterations.
                int repeats = Math.Max(1, Math.Min(999, action.RepeatCount));
                var subActions = subProfile.Actions.ToList();

                // Data-loop Phase C: "run once per data row" iterates the SUB-profile's own
                // table, one sub-run per row, {row:col} resolving from that row. RepeatCount
                // is ignored while over-data (UI disables it). Missing/empty table degrades
                // to a single normal run with a log line (graceful, never a hard error).
                if (action.RunOverData == true && (subProfile.Data?.Rows?.Count ?? 0) > 0)
                {
                    await RunSubProfileOverDataAsync(targetName, subActions, subProfile.Data!, token);
                }
                else
                {
                    // Over-data with no rows degrades to exactly ONE run — the stored
                    // RepeatCount belongs to the mode the user turned off.
                    if (action.RunOverData == true)
                    {
                        DiagnosticLog.Warn($"[Chain] '{targetName}' has no data rows — 'run once per data row' fell back to a single run.");
                        repeats = 1;
                    }
                    for (int r = 0; r < repeats && !token.IsCancellationRequested && !_rowFaulted; r++)
                    {
                        await ExecuteActionsAsync(subActions, token);
                        // Return (D6) ends THIS pass only — passes r+1.. still run. Cleared
                        // after the await, never in the for condition.
                        _returnRequested = false;
                    }
                }
            }
            finally
            {
                _pendingTokenKeyDowns = savedPendingKeyDowns;   // restore the caller's pending down/up pairs verbatim
                RestoreWindowContext(savedContext);

                // After returning to the caller's context, re-bring its window to focus so the
                // remaining actions of the parent run against the intended window. We don't
                // re-apply lock-position because the window is still where we put it.
                if (_bringToFocus && _windowTarget != null && !token.IsCancellationRequested)
                {
                    try
                    {
                        var hwnd = FindTargetWindow();
                        if (hwnd != IntPtr.Zero)
                        {
                            // Full activation stack, best-effort (see WindowActivation) —
                            // the bare SetForegroundWindow this used to call is routinely
                            // rejected by the foreground lock when TR isn't active.
                            await TrueReplayer.Helpers.WindowActivation.ActivateAsync(
                                hwnd, _windowTarget, _windowTargetTitleRegex, token);
                            await Task.Delay(80, token);
                        }
                    }
                    catch { /* best-effort restore */ }
                }

                if (_callStack.Count > 0) _callStack.RemoveAt(_callStack.Count - 1);
                NotifyChainChanged();
            }

            // Reached only after the sub-profile actually ran (any number of its own rows may have
            // been skipped inside it — that is the sub's own report, not this row's).
            return null;
        }

        /// <summary>
        /// Data-loop Phase C body: run the sub-profile once per row of ITS OWN Data table,
        /// stamping the shared row context so {row:col} resolves per row inside the sub. The
        /// caller's data context (table / loop flag / current row / soft-fault override) is
        /// saved and restored — a parent batch loop keeps its own row across the call. The
        /// Model-B cursor is untouched (batch iteration is not a "run") and the lap notice
        /// never fires (cursor-mode feature). Fault policy per row:
        ///   sub table "skip"        → faulted row absorbed HERE: stuck input released,
        ///                             logged + counted, next row runs (mirrors StartAsync's
        ///                             per-iteration skip block);
        ///   sub halt + parent skip  → _softFaultOverride keeps the fault SOFT (FaultRow, not
        ///                             _cts.Cancel), remaining sub rows abort, and the fault
        ///                             propagates to the PARENT row (today's granularity: a
        ///                             failed sub call = one skipped parent row);
        ///   sub halt, no parent skip→ the fault site cancels _cts exactly like today.
        /// </summary>
        private async Task RunSubProfileOverDataAsync(
            string subName, List<ActionItem> subActions, Models.ProfileDataTable subTable, CancellationToken token)
        {
            bool parentSkipActive = SkipRowOnErrorActive;
            // ONE shared save/restore with the inline ForEachRow block (DataCtxSnapshot) —
            // the field-by-field copies this used to keep are exactly the kind of sibling
            // pair that drifts. swapRowNextCursors: {rownext} walks the SUB's table on a
            // fresh cursor, so the parent's walk is preserved and restored verbatim.
            var savedCtx = SaveDataContext(swapRowNextCursors: true);
            bool subSkip = string.Equals(subTable.OnRowError, "skip", StringComparison.OrdinalIgnoreCase);
            int rowCount = subTable.Rows?.Count ?? 0;
            int skipped = 0;
            string? firstReason = null;
            try
            {
                // The sub table comes straight from the profile lookup, which does NOT pass
                // through SetDataTable's null-normalization trust boundary — a hand-edited
                // {"Headers":null} sub .trprofile would NRE in BuildRowDict otherwise.
                subTable.Headers ??= new List<string>();
                subTable.Rows ??= new List<List<string>>();

                _dataTable = subTable;
                _dataLoopOver = true;               // fault sites now read the SUB's skip policy…
                // Fresh {rownext} cursor for the sub — it indexes the SUB's table, so the parent's
                // walk (against the parent's table) must NOT bleed into or be advanced by it.
                _rowNextCursors = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
                _softFaultOverride = parentSkipActive && !subSkip;   // …or stay soft for the parent's sake

                for (int i = 0; i < rowCount && !token.IsCancellationRequested; i++)
                {
                    _currentRowData = BuildRowDict(subTable, i);
                    _currentDataRow = i + 1;   // {datarow} counts the SUB's own table
                    PushVariablesSnapshot();   // live pane: show which row {row:col} resolves from (throttled)
                    _rowFaulted = false;
                    _rowFaultReason = null;
                    try
                    {
                        await ExecuteActionsAsync(subActions, token);
                    }
                    // Same two-catch shape as StartAsync's batch loop: a genuine Stop (token
                    // cancelled) keeps unwinding; a SPURIOUS OCE (pipe drop resolving an
                    // in-flight TCS) and any thrown action error (browser exceptions, If-probe
                    // Halt rethrows) are just row errors while a skip policy is active.
                    catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
                    catch (Exception ex) when (SkipRowOnErrorActive)
                    {
                        FaultRow(ex.Message);
                    }

                    // Return (D6): ended THIS row's pass — the next data row still runs.
                    // Consumed before the fault check (a Return is not a fault).
                    _returnRequested = false;

                    if (!_rowFaulted) continue;

                    if (subSkip)
                    {
                        skipped++;
                        firstReason ??= _rowFaultReason;
                        // A skipped row may die mid-hold — release anything the faulted row
                        // left pressed before the next row starts.
                        ResetMouseState();
                        ResetKeyState();
                        DiagnosticLog.Warn($"[Chain] '{subName}' data row {i + 1}/{rowCount} skipped: {_rowFaultReason}");
                        _rowFaulted = false;
                        _rowFaultReason = null;
                        continue;
                    }

                    // Halt-mode sub under a skip-active parent: abort the remaining sub rows and
                    // leave _rowFaulted SET — after the finally restores the parent context, the
                    // parent's boundary checks unwind this as a normal parent-row fault.
                    break;
                }

                // Suppressed after a user abort — a notice right after the user's own abort is
                // noise (StartAsync's summary applies the same gate). An AUTHORED Stop /
                // quiet-stop is not an abort: _authoredStop re-opens the gate so failed rows
                // are still reported under the success cue.
                if (skipped > 0 && (!token.IsCancellationRequested || _authoredStop))
                {
                    string msg = $"Sub-profile '{subName}': {skipped} of {rowCount} row(s) skipped" +
                        (firstReason != null ? $" — first: {firstReason}" : "");
                    OnRunSummary?.Invoke(msg);
                }
            }
            finally
            {
                RestoreDataContext(savedCtx);   // parent table/flag/row/{rownext}/soft-override, one unit
            }
        }

        private void NotifyChainChanged()
        {
            // Zeroed on every push/pop so the next action inside the new frame pushes its step
            // immediately instead of waiting out the 250 ms throttle — the gap between naming a
            // freshly entered sub-profile and correcting its counter is exactly where the
            // PREVIOUS sub-profile's numbers would sit on screen. Deliberately outside the
            // null-callback guard below: the stamp is engine state, not a UI concern.
            _lastChainStepMs = 0;
            if (_onChainChanged == null) return;
            // Send a defensive copy so callers can't mutate our internal state.
            var snapshot = new List<string>(_callStack);
            dispatcherQueue.TryEnqueue(() => _onChainChanged?.Invoke(snapshot));
        }

        private static readonly Dictionary<string, int> ModifierGenericVkCodes = new(StringComparer.OrdinalIgnoreCase)
        {
            ["Ctrl"] = 0x11,   // VK_CONTROL (left or right)
            ["Alt"] = 0x12,    // VK_MENU (left or right)
            ["Shift"] = 0x10,  // VK_SHIFT (left or right)
        };

        /// <summary>
        /// Sends key-up events for any modifier keys (Alt, Ctrl, Shift, Win) the user is
        /// currently physically holding, so the target app's input state is clean when the
        /// replay's simulated keystrokes arrive. Without this, a replay triggered by a
        /// combined hotkey like Alt+Q would have every simulated key stroke seen as Alt+key
        /// by the target because the OS still reports Alt as pressed.
        /// The user's real key-up event that follows is a benign duplicate for the target.
        /// </summary>
        private void ReleasePhysicallyHeldModifiers()
        {
            // Check specific L/R vk codes so we send keyup for the exact key the user is holding,
            // not the generic virtual key (which some drivers ignore).
            ReadOnlySpan<ushort> modifierVks = new ushort[]
            {
                0xA0, 0xA1,   // LShift, RShift
                0xA2, 0xA3,   // LControl, RControl
                0xA4, 0xA5,   // LMenu, RMenu (Alt)
                0x5B, 0x5C,   // LWin, RWin
            };

            var inputs = new System.Collections.Generic.List<NativeMethods.INPUT>(modifierVks.Length);
            foreach (var vk in modifierVks)
            {
                if ((NativeMethods.GetAsyncKeyState(vk) & 0x8000) == 0) continue;
                inputs.Add(new NativeMethods.INPUT
                {
                    type = NativeMethods.INPUT_KEYBOARD,
                    U = new NativeMethods.InputUnion
                    {
                        ki = new NativeMethods.KEYBDINPUT { wVk = vk, dwFlags = NativeMethods.KEYEVENTF_KEYUP }
                    }
                });
            }

            if (inputs.Count > 0)
            {
                NativeMethods.SendInput((uint)inputs.Count, inputs.ToArray(),
                    NativeMethods.InputSize);
            }
        }

        // The modifier keys the engine itself has down right now — KeyDown rows whose KeyUp has not
        // run — by the names they were pressed with.
        private List<string> ModifiersHeldByEngine()
        {
            var held = new List<string>();
            lock (_simInputLock)
            {
                foreach (var k in _simulatedKeysDown)
                    if (Helpers.KeyUtils.TryResolveVirtualKeyCode(k, out ushort vk) && IsModifierVk(vk))
                        held.Add(k);
            }
            return held;
        }

        private static bool IsModifierVk(ushort vk) =>
            vk is 0x10 or 0x11 or 0x12 or (>= 0xA0 and <= 0xA5) or 0x5B or 0x5C;

        private async Task WaitForHotkeyReleaseAsync(CancellationToken token)
        {
            var hotkey = InputHookManager.LastTriggerHotkey;
            InputHookManager.LastTriggerHotkey = null;

            if (string.IsNullOrEmpty(hotkey))
                return;

            // A HOTSTRING fire has no physical hotkey to wait for. The hook writes
            // "HOTSTRING::<profile name>" here, and splitting that on '+' read the profile's own name
            // as keys: a profile named "Notes+Enter" waited up to 2 s on the Enter that had just
            // ended the hotstring, on every fire.
            if (hotkey.StartsWith("HOTSTRING::", StringComparison.Ordinal))
                return;

            await WaitForComboReleaseAsync(hotkey, token);
        }

        /// <summary>
        /// Polls until every key of <paramref name="combo"/> ("Shift+F12") is physically up, for at
        /// most 2 s. Shared with the Copy screen text hotkey, which opens a focus-taking overlay: a
        /// modifier still held at that moment releases INTO the overlay, so the app the user was in
        /// never sees the key-up and keeps reading the modifier as down after focus comes back.
        /// </summary>
        internal static async Task WaitForComboReleaseAsync(string combo, CancellationToken token)
        {
            var vkCodes = new List<int>();

            foreach (var part in combo.Split('+'))
            {
                var trimmed = part.Trim();
                if (ModifierGenericVkCodes.TryGetValue(trimmed, out int genericVk))
                    vkCodes.Add(genericVk);
                else if (Helpers.KeyUtils.TryResolveVirtualKeyCode(trimmed, out ushort vk))
                    vkCodes.Add(vk);
            }

            if (vkCodes.Count == 0)
                return;

            var deadline = DateTime.Now.AddMilliseconds(2000);

            while (!token.IsCancellationRequested && DateTime.Now < deadline)
            {
                bool anyPressed = false;
                foreach (var vk in vkCodes)
                {
                    if ((NativeMethods.GetAsyncKeyState(vk) & 0x8000) != 0)
                    {
                        anyPressed = true;
                        break;
                    }
                }

                if (!anyPressed)
                    break;

                await Task.Delay(10, token);
            }
        }

        public void Stop()
        {
            // Only cancel — disposal is handled by the next StartAsync() call (via async path).
            // ObjectDisposedException is possible if Stop fires concurrently with a fresh
            // StartAsync that already disposed the old cts; swallow because the intent
            // (stop whatever's running) is satisfied regardless.
            try { _cts?.Cancel(); } catch (ObjectDisposedException) { /* already gone */ }
            ResetMouseState();
            ResetKeyState();
        }

        // Tracks mouse buttons pressed down by the replay that have not yet been released.
        // Used by ResetMouseState to only release buttons we actually pressed — avoids firing
        // spurious UP events (which some apps perceive as a click) when replay stops cleanly.
        private bool _simLeftDown, _simRightDown, _simMiddleDown;

        // Same idea for keyboard: tracks key names sent KEYDOWN by the replay that haven't
        // received their matching KEYUP yet. Used by ResetKeyState on Stop so a macro that
        // does `KeyDown(W), delay 10s, KeyUp(W)` doesn't leave W stuck in the OS keyboard
        // state when the user hits Stop mid-hold (a real bug pre-fix — without an explicit
        // KEYUP the OS treats the key as physically pressed until the user releases it
        // themselves, which manifests as a "stuck character" or a game-character that
        // keeps walking forever). StringComparer.OrdinalIgnoreCase matches the resolution
        // logic in SimulateKey which is case-insensitive at the VK lookup.
        private readonly HashSet<string> _simulatedKeysDown = new(StringComparer.OrdinalIgnoreCase);

        // Serializes mutation/inspection of the simulated-input "currently down" state
        // (_simLeftDown/_simRightDown/_simMiddleDown and _simulatedKeysDown) so Stop()'s
        // ResetMouseState/ResetKeyState (UI/hotkey thread) can't race the replay thread
        // mid-dispatch and leave a button/key stuck or corrupt the HashSet.
        private readonly object _simInputLock = new();

        private void ResetMouseState()
        {
            lock (_simInputLock)
            {
                if (!_simLeftDown && !_simRightDown && !_simMiddleDown) return;
                NativeMethods.GetCursorPos(out var pos);
                // pos is already absolute screen space — coordsAreProfileSpace:false skips the
                // relative-offset resolution (which would mis-place, or even suppress, the UP).
                if (_simLeftDown)   SimulateMouse(pos.x, pos.y, NativeMethods.MOUSEEVENTF_LEFTUP,   coordsAreProfileSpace: false);
                if (_simRightDown)  SimulateMouse(pos.x, pos.y, NativeMethods.MOUSEEVENTF_RIGHTUP,  coordsAreProfileSpace: false);
                if (_simMiddleDown) SimulateMouse(pos.x, pos.y, NativeMethods.MOUSEEVENTF_MIDDLEUP, coordsAreProfileSpace: false);
            }
        }

        private void ResetKeyState()
        {
            lock (_simInputLock)
            {
                if (_simulatedKeysDown.Count == 0) return;
                // Snapshot first — SimulateKey(_, false) calls Remove() on the set, mutating it
                // mid-iteration. Copy-then-iterate avoids InvalidOperationException.
                var pending = _simulatedKeysDown.ToArray();
                foreach (var key in pending) SimulateKey(key, false);
            }
        }

        private void SimulateScroll(int delta)
        {
            int inputSize = NativeMethods.InputSize;
            var scrollInput = new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_MOUSE,
                U = new NativeMethods.InputUnion
                {
                    mi = new NativeMethods.MOUSEINPUT
                    {
                        mouseData = (uint)delta,
                        dwFlags = NativeMethods.MOUSEEVENTF_WHEEL,
                    }
                }
            };
            NativeMethods.SendInput(1, new[] { scrollInput }, inputSize);
        }

        private IntPtr FindTargetWindow()
            => TrueReplayer.Helpers.WindowMatcher.FindWindow(_windowTarget, _windowTargetTitleRegex);

        // Windows parks a minimised window at (-32000, -32000); GetWindowRect reports that
        // instead of the real geometry, and a minimised window still passes IsWindowVisible so
        // the matcher happily returns it. Anything at or left of this is a parking rect, not a
        // measurement. Slack of 1000 px covers the parked width without reaching any real
        // monitor — the leftmost secondary display in practice sits far to the right of -31000.
        private const int MinimizedParkedLeft = -31000;

        /// <summary>
        /// Resolve the offset (window origin) that converts profile-space coordinates to
        /// absolute virtual-desktop coordinates. Used by every replay path that consumes
        /// stored relative coords — mouse clicks, WaitImage search region, WaitPixelColor.
        ///
        /// Returns true when no translation is needed (rel coords off OR no target window
        /// configured — degenerate state preserved for backward compat) OR the target was
        /// found and dx/dy are populated. Returns false ONLY when rel coords are on AND a
        /// target is configured AND we couldn't resolve the running window — caller should
        /// treat this as an error (call <see cref="ReportMissingTargetWindow"/>).
        /// </summary>
        private bool TryResolveRelativeOffset(out int dx, out int dy)
        {
            dx = 0;
            dy = 0;
            // The flag describes THIS call's refusal. Reset up front, so the not-found and no-rect
            // exits below cannot leave a stale "minimised" from an earlier call nobody consumed (a
            // probe under a non-Halt policy never reports) — which then told the user to restore a
            // window that no longer existed.
            _lastRelativeFailureWasMinimised = false;
            if (!_useRelativeCoordinates) return true;
            if (_windowTarget == null) return true;
            var hwnd = FindTargetWindow();
            if (hwnd == IntPtr.Zero) return false;
            if (!NativeMethods.GetWindowRect(hwnd, out var rect)) return false;

            // A MINIMISED target has no origin, and pretending it does is worse than not finding
            // it at all. Windows parks a minimised window at (-32000,-32000) and it still passes
            // IsWindowVisible, so the matcher returns it happily; dx became -32000, every click
            // in the profile got clamped to the top-left pixel of the virtual screen, and it
            // landed there for real — cursor, button and all — on whatever happened to be under
            // it, with the run reporting success. WaitImage and WaitPixelColor read their region
            // in that corner instead and died on timeout with no reason given.
            //
            // Returning false is the treatment an ABSENT window already gets: every caller routes
            // it to ReportMissingTargetWindow. A minimised target is not a more valid origin than
            // a closed one, and seven other surfaces in the app already refuse exactly this state
            // — including the automation watcher's own anchor, whose comment claims this is "the
            // same test TryResolveRelativeOffset does on the actions side". It wasn't: here the
            // test existed but only gated a WARNING, which meant the one diagnostic that would
            // have named the minimised window was the thing being suppressed.
            //
            // Costs nothing on the hot path: it reads the rect GetWindowRect already returned,
            // no IsIconic P/Invoke per mouse event.
            if (rect.Left <= MinimizedParkedLeft || rect.Top <= MinimizedParkedLeft)
            {
                // Remember WHICH refusal this was. Every caller funnels a false into
                // ReportMissingTargetWindow, whose message is "not found — open it and retry" —
                // advice that is actively wrong here, because the window IS open and the user is
                // being told to open a second one. Recording it on the instance rather than
                // threading an out-param through six call sites keeps those sites untouched;
                // replay is single-threaded, and the flag is read by the very next call.
                _lastRelativeFailureWasMinimised = true;
                return false;
            }
            _lastRelativeFailureWasMinimised = false;

            // The translation below is exact only while the target is the SIZE it was recorded
            // at — see WarnRelativeGeometryDrift for why, and for why this warns instead of
            // rescaling. This is the one place that holds both numbers, so it is the only place
            // the drift can be noticed at all. Cost on the mouse hot path when nothing is wrong:
            // one already-false bool, three compares and two subtractions. No allocation, no
            // log, no extra P/Invoke — the rect is the one GetWindowRect already returned.
            //
            // The minimised rect can no longer reach here — the guard above returns before it —
            // so this no longer needs its own Left test. Because this path never latches, a
            // genuinely drifted window still gets its one warning as soon as it is restored.
            if (!_relGeometryDriftWarned && _lockWidth > 0 && _lockHeight > 0
                && (rect.Right - rect.Left != _lockWidth || rect.Bottom - rect.Top != _lockHeight))
            {
                WarnRelativeGeometryDrift(hwnd, rect);
            }

            dx = rect.Left;
            dy = rect.Top;
            return true;
        }

        /// <summary>
        /// Relative coordinates are stored as PHYSICAL-pixel offsets from the target window's
        /// top-left with no record of the DPI they were measured at, and TryResolveRelativeOffset
        /// replays them as a pure translation. Record with the target on a 150% laptop panel, drag
        /// it to a 100% external monitor, and a per-monitor-aware app re-lays-out: a control that
        /// sat 600 physical px from the left edge is now at 400. Every relative click misses by
        /// ~33% and the run still reports success. The profile's captured window size
        /// (_lockWidth/_lockHeight, i.e. UserProfile.WindowWidth/Height, stamped on the first
        /// recorded click) is the only stamp available, so a size mismatch is the drift signal.
        ///
        /// WARN — do not rescale, do not refuse.
        ///
        /// Rescaling by the size ratio assumes the target's layout is proportional, and the
        /// common targets aren't: fixed-size dialogs, toolbars that keep their pixel height while
        /// only the content area grows, apps that don't re-layout at all, games rendering into a
        /// fixed backbuffer. Worse, it would break the ordinary "the user resized the window"
        /// case, where top-left-anchored coordinates are still exactly right today — silently
        /// moving those clicks would be a regression manufactured out of a guess.
        ///
        /// Refusing (the ReportMissingTargetWindow idiom) fails the same test from the other
        /// side. A missing window is unambiguous — there is nothing to click and every coordinate
        /// is certainly wrong. A resized window is neither: resizing is routine, usually
        /// deliberate, and usually harmless, so killing the run over it would strand every
        /// profile whose target the user ever dragged an edge on.
        ///
        /// So: name it precisely, once per run, and keep going. The user decides whether to
        /// re-record, add Restore Size, or ignore it.
        ///
        /// Known blind spot, stated rather than papered over: with Restore Size ON,
        /// ApplyWindowGeometryAsync forces the target back to _lockWidth x _lockHeight PHYSICAL
        /// pixels before the run. After a DPI move that makes the two numbers agree again while
        /// the target's internal layout is still scaled differently — same physical box, more or
        /// less content inside it — so the sizes match and this check stays quiet even though the
        /// coordinates are still wrong. Closing that needs the capture DPI written into the
        /// profile (which is what "no DPI stamp" means) and a scale-aware restore; the size
        /// comparison here is what the data on disk can support today.
        /// </summary>
        private void WarnRelativeGeometryDrift(IntPtr hwnd, in NativeMethods.RECT rect)
        {
            int liveW = rect.Right - rect.Left;
            int liveH = rect.Bottom - rect.Top;
            // A degenerate rect (a window mid-teardown) is not drift, and must not spend the latch:
            // latched first, it silenced the one warning a real drift later in the run was owed.
            if (liveW <= 0 || liveH <= 0) return;
            _relGeometryDriftWarned = true;   // latch before anything else — this must never fire twice

            var name = _windowTarget?.ProcessName ?? "target";
            uint dpi = NativeMethods.GetDpiForWindowSafe(hwnd);
            long pct = (long)Math.Round(dpi * 100.0 / 96.0);

            double scaleX = (double)liveW / _lockWidth;
            double scaleY = (double)liveH / _lockHeight;

            // Both axes scaled by the same factor is the fingerprint of a DPI change; a hand
            // resize practically never matches on both axes to within 2%. Worth separating,
            // because the two cases need different advice: a DPI move breaks EVERY coordinate
            // proportionally, while a plain resize only breaks the ones anchored away from the
            // top-left corner (which is what the pure translation preserves).
            bool uniform = Math.Abs(scaleX - scaleY) <= 0.02 && Math.Abs(scaleX - 1.0) > 0.02;

            if (uniform)
            {
                DiagnosticLog.Warn(
                    $"Relative coordinates are stale: target window '{name}' is {liveW}x{liveH} but this profile " +
                    $"recorded it at {_lockWidth}x{_lockHeight}. Both axes scaled by {scaleX:0.###}x — the signature " +
                    $"of a DPI change (the window now reports {dpi} DPI / {pct}% scaling). Stored offsets are physical " +
                    $"pixels with no DPI stamp and are replayed as a plain translation, so every relative click is off " +
                    $"by about {Math.Abs(1.0 - scaleX) * 100:0}%. Move the target back to the display it was recorded " +
                    "on, or re-record it here — Restore size will NOT fix this, it only forces the same physical box " +
                    "at the new scaling. Continuing — the run is NOT being stopped or rescaled.");
            }
            else
            {
                DiagnosticLog.Warn(
                    $"Relative coordinates may be stale: target window '{name}' is {liveW}x{liveH} but this profile " +
                    $"recorded it at {_lockWidth}x{_lockHeight} (window now reports {dpi} DPI / {pct}% scaling). Offsets " +
                    $"are replayed as a plain translation from the top-left, so coordinates anchored near the right or " +
                    $"bottom edge are off by {liveW - _lockWidth}x{liveH - _lockHeight} px. Turn on Restore size to pin " +
                    "the window back to its recorded size. Continuing — the run is NOT being stopped or rescaled.");
            }
        }

        /// <summary>
        /// Surfaces a visible error and stops the replay when a profile-relative action
        /// can't resolve its target window. Used to be silent for mouse clicks — actions
        /// would land at the relative coord interpreted as absolute, almost certainly
        /// somewhere wrong. Now the user sees "target window X not found" instead.
        /// </summary>
        private bool _lastRelativeFailureWasMinimised;

        private void ReportMissingTargetWindow()
        {
            var name = _windowTarget?.ProcessName ?? "target";
            // A minimised target and an absent one both stop the run, but they are not the same
            // problem and must not carry the same sentence. "Open it and retry" sends the user to
            // open a window that is already open, and the diagnostic that would have named the
            // minimised window was the very thing the old warning-only path suppressed.
            bool minimised = _lastRelativeFailureWasMinimised;
            _lastRelativeFailureWasMinimised = false;
            string why = minimised ? $"target window '{name}' is minimised" : $"target window '{name}' not found";
            if (SkipRowOnErrorActive)
            {
                FailCurrentStep(why);
                FaultRow(why);
                return;
            }
            DiagnosticLog.Warn($"Replay aborted: relative-coords {why} [{name} {_windowTarget?.WindowTitle}]".TrimEnd());
            OnReplayError?.Invoke(minimised
                ? $"Target window '{name}' is minimised — restore it and retry. A minimised window has no on-screen position to place relative coordinates against."
                : $"Target window '{name}' not found — open it and retry");
            FailCurrentStep(why);
            try { _cts?.Cancel(); } catch (ObjectDisposedException) { }
        }

        // ── ActivateWindow ──
        // Combined find → launch-if-missing → wait → focus. The matcher reuses the
        // If-Window fields (WindowProcessName/WindowTitle/WindowTitleMatchMode); Timeout
        // is the wait-for-window budget; window EXISTENCE is the only success criterion —
        // the launched process is never tracked, so single-instance apps that forward to
        // an already-running instance behave identically to a plain focus.
        private async Task ExecuteActivateWindow(ActionItem action, CancellationToken token)
        {
            var (target, regex) = BuildWindowTargetFromAction(action);
            bool hasMatcher = target.ProcessName != null || target.WindowTitle != null;

            // Phase-3 verb + nth-match. Verb null/unknown = "activate" (bring to foreground). matchN
            // is 1-based in Z-order (front→back); null/≤1 = first match.
            string verb = (action.WindowVerb ?? "activate").ToLowerInvariant();
            if (verb != "maximize" && verb != "minimize" && verb != "close") verb = "activate";
            int matchN = action.WindowMatchIndex is int mi && mi > 1 ? mi : 1;

            // LaunchPath/LaunchArgs accept the same tokens as SendText ({var:}, {clipboard}, …).
            // Only activate/maximize can launch — resolving for minimize/close would fire a token's
            // side effects (e.g. an {input:} prompt / clipboard-cursor advance) whose result is then
            // discarded, since those verbs never launch.
            string? path = null;
            string? args = null;
            if (verb == "activate" || verb == "maximize")
            {
                path = string.IsNullOrWhiteSpace(action.LaunchPath)
                    ? null
                    : (await ResolveTokens(action.LaunchPath)).Trim();
                if (string.IsNullOrEmpty(path)) path = null;
                args = path != null && !string.IsNullOrWhiteSpace(action.LaunchArgs)
                    ? await ResolveTokens(action.LaunchArgs)
                    : null;
            }

            if (!hasMatcher)
            {
                // Pure-run row: no matcher → fire-and-forget shell run (URL, document, .lnk, exe).
                // Only the "activate" intent launches; minimize/close have no window to act on → no-op.
                // A row with neither matcher nor launch no-ops (SetVariable-without-a-name forgiveness).
                if (path == null || verb == "minimize" || verb == "close") return;
                if (!TryLaunch(path, args, out var runError))
                    HandleActivateWindowFailure(action, $"launch failed: {runError}");
                return;
            }

            // Minimize / Close act on the EXISTING window only — no launch, no focus, no wait. If it's
            // not there, nothing to do and the goal (window minimized / gone) is already met — benign
            // no-op success (owner decision).
            if (verb == "minimize" || verb == "close")
            {
                IntPtr existing = FindWindowExcludingSelf(target, regex, matchN);
                if (existing == IntPtr.Zero)
                {
                    DiagnosticLog.Info($"ActivateWindow {verb}: no matching window — nothing to do");
                    return;
                }
                if (verb == "minimize")
                    NativeMethods.ShowWindow(existing, NativeMethods.SW_MINIMIZE);
                else
                    NativeMethods.PostMessage(existing, NativeMethods.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                return;
            }

            IntPtr hwnd = FindWindowExcludingSelf(target, regex, matchN);

            // Launch AT MOST once, and only when no window matched first — re-running
            // the program on every poll would spawn N copies of a slow-starting app.
            //
            // With matchN > 1 "no window matched" means "fewer than N matched", so this reads as
            // "launch until there are N of them" rather than the "launch if missing" the field is
            // named for. That is left as-is on purpose: for an app that opens a NEW window per
            // invocation (most browsers) launching really is how you get to a second window, so
            // gating it on matchN <= 1 would break a legitimate setup to tidy a surprising one.
            // The log line is the fix — the surprising case is now diagnosable instead of silent.
            if (hwnd == IntPtr.Zero && path != null)
            {
                if (matchN > 1)
                    DiagnosticLog.Info($"Activate Window: fewer than {matchN} matching windows — launching '{path}'");
                if (!TryLaunch(path, args, out var launchError))
                {
                    HandleActivateWindowFailure(action, $"launch failed: {launchError}");
                    return;
                }
            }

            int timeoutMs = action.Timeout > 0 ? action.Timeout : 10000;
            var sw = System.Diagnostics.Stopwatch.StartNew();
            while (hwnd == IntPtr.Zero)
            {
                if (sw.ElapsedMilliseconds >= timeoutMs)
                {
                    HandleActivateWindowFailure(action, "window not found");
                    return;
                }
                await Task.Delay(200, token); // token-aware — the Stop hotkey aborts instantly
                hwnd = FindWindowExcludingSelf(target, regex, matchN);
            }

            if (!await TrueReplayer.Helpers.WindowActivation.ActivateAsync(hwnd, target, regex, token))
            {
                HandleActivateWindowFailure(action, "could not bring window to foreground");
                return;
            }

            // Readiness: don't fire the following keystrokes into a FROZEN target. Poll
            // IsHungAppWindow within the SAME Timeout budget the window-not-found loop above used
            // (sw is still running). A responsive window returns false on the first check, so this
            // costs nothing on the normal path — it only waits for a genuinely hung app, then applies
            // the On-Timeout policy if it never recovers. IsHungAppWindow is heuristic (true only
            // after ~5s of an unpumped queue), so it's a frozen-app guard, not a "slow loader ready"
            // signal — the 300ms settle below still covers the ordinary focus-animation wait.
            while (NativeMethods.IsHungAppWindow(hwnd))
            {
                if (sw.ElapsedMilliseconds >= timeoutMs)
                {
                    HandleActivateWindowFailure(action, "target window not responding");
                    return;
                }
                await Task.Delay(150, token); // token-aware — the Stop hotkey aborts instantly
            }

            await Task.Delay(300, token); // settle — same wait the replay-start focus uses

            if (verb == "maximize")
            {
                // Maximize is its own placement — SetWindowPos is ignored on a zoomed window, so the
                // Placement fields are mutually exclusive with this verb (the editor hides them).
                NativeMethods.ShowWindow(hwnd, NativeMethods.SW_MAXIMIZE);
                return;
            }

            // Optional placement (activate verb): move/resize the window we just activated. Deliberately
            // uses the hwnd we actually focused rather than a fresh matcher lookup, so with two windows of
            // the same process the placement can never land on a different one. Purely positional
            // — the replay's coordinate context is untouched (clicks still resolve against the
            // profile/folder target; use a sub-profile + RunProfile for per-window relative coords).
            bool placeSize = action.RestoreSize && action.WindowWidth > 0 && action.WindowHeight > 0;
            bool placePos = action.RestorePosition;
            if (placePos || placeSize)
                await ApplyWindowGeometryAsync(hwnd, action.WindowX, action.WindowY,
                    action.WindowWidth, action.WindowHeight, placePos, placeSize, token);
        }

        // ── BrowserAssert ──
        // Verify a page element is in the expected state (reusing the BrowserWaitElement
        // probe + selector fallback) and FAIL the replay LOUDLY when it isn't — the
        // difference from an If, which branches. The extension polls up to Timeout and
        // walks the ranked alternatives; success returns with no side effect. A timeout /
        // failure surfaces as a BrowserActionException which we convert into the friendly
        // Halt/Continue policy. Bridge not connected = we can't verify ⇒ that's a FAILURE
        // (contrast If-Browser, which reads "not found" and branches).
        // Returns true when the quiet-stop policy (AssertOnFail == "StopReplay") ended the
        // run — the caller's switch case annotates the step's Detail with it.
        private async Task<bool> ExecuteBrowserAssert(ActionItem action, CancellationToken token)
        {
            if (_browserBridge == null || !_browserBridge.IsConnected)
            {
                return HandleAssertFailure(action, "browser bridge not connected");
            }
            int timeout = action.Timeout > 0 ? action.Timeout : 5000;
            try
            {
                // A text-match assert needs its text pattern resolved for tokens, same as
                // BrowserType/SelectOption. Other modes ignore the text.
                string? resolvedText = string.IsNullOrEmpty(action.BrowserText)
                    ? null
                    : KeepAuthoredTextMode(action.BrowserText, await ResolveBrowserTextPlaceholders(action.BrowserText));
                await _browserBridge.ExecuteBrowserCommandAsync(action, token, timeout, resolvedText);
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                throw; // genuine user stop always propagates
            }
            catch (OperationCanceledException)
            {
                // Belt-and-braces for a cancellation with no token behind it. The pipe drop that
                // used to arrive this way is now a BrowserActionException("EXTENSION_DISCONNECTED")
                // and lands in the catch below instead, so this arm should no longer be reachable —
                // it stays because the rule it encodes is the one that matters: we could not verify,
                // therefore the assertion FAILED and goes through the policy. Never a silent stop.
                return HandleAssertFailure(action, "browser bridge disconnected");
            }
            catch (BrowserActionException ex)
            {
                return HandleAssertFailure(action, ex.Message);
            }
            return false;
        }

        // BrowserAssert failure policy — mirrors HandleActivateWindowFailure. Default (null)
        // = Halt: report LOUDLY (OnReplayError — the whole point of an assertion) and stop.
        // "Continue" logs and lets the run proceed.
        /// <summary>
        /// Desktop Assert — "this MUST be true, or stop and say why".
        ///
        /// Fills the gap between the three things that already exist and none of which state a
        /// REQUIREMENT: WaitImage/WaitPixelColor are synchronisation (poll, then abort — but only
        /// for image/pixel), and an <c>If</c> whose probe reads false jumps to ENDIF and carries on
        /// SILENTLY, which is the right semantic for a branch and the wrong one for a precondition.
        /// So the six state conditions (window / process / file / variable / clipboard / time)
        /// had no way to be required at all.
        ///
        /// Reuses the If machinery verbatim — same ConditionType family, same ConditionNegate,
        /// same ConditionTimeout polling — so nothing here re-implements a probe.
        ///
        /// Deliberately does NOT honour IfOnProbeError: on the If path a "Halt" setting makes the
        /// probe RETHROW, which would bypass HandleAssertFailure entirely and surface a raw
        /// exception with no "Assert failed" framing and no AssertOnFail policy. An Assert catches
        /// here instead and routes a broken probe through the SAME failure path as a false one —
        /// "couldn't check" and "checked and it was false" are both "the precondition is not
        /// established", and the user's on-fail choice should govern both.
        /// </summary>
        private async Task<bool> ExecuteAssert(ActionItem action, CancellationToken token)
        {
            bool satisfied;
            try
            {
                satisfied = await EvaluateConditionWithTimeout(action, token);
            }
            catch (OperationCanceledException)
            {
                throw;   // user pressed Stop — never a failed assertion
            }
            catch (Exception ex)
            {
                return HandleAssertFailure(action, $"could not check the condition ({ex.Message})");
            }
            // The probe can return FALSE because the run was stopped mid-check, not because the
            // precondition failed: a blocking probe (File.Exists on a dead UNC share, a clipboard
            // another app has locked) observes no token until it returns, and
            // EvaluateConditionWithTimeout's elapsed-window exit doesn't re-check either. Without
            // this guard, hitting Stop during that window pops a red "Assert failed" toast naming
            // a precondition that was never actually judged.
            if (token.IsCancellationRequested) return false;
            // A probe that faulted the row in skip-mode already unwound it; adding an assert
            // failure on top would double-report the same row. EXCEPT under the quiet-stop
            // policy: "stop the run here" is the user's explicit choice and must beat the
            // row-skip degradation (the same arm-order doctrine inside HandleAssertFailure) —
            // otherwise a probe that faults instead of throwing would keep the batch running
            // through the very assert marked "Stop quietly".
            if (!satisfied && (!_rowFaulted
                    || string.Equals(action.AssertOnFail, "StopReplay", StringComparison.OrdinalIgnoreCase)))
                return HandleAssertFailure(action, DescribeAssertExpectation(action));
            return false;
        }

        /// Human-readable "what was required" for the failure toast/log. The label (Comment/Key)
        /// is prepended by HandleAssertFailure, so this is only the expectation clause. Phrased
        /// from the USER's side ("window … was not open") rather than the engine's ("probe
        /// returned false") — the whole point of an assert is that the message names the thing.
        private static string DescribeAssertExpectation(ActionItem action)
        {
            bool neg = action.ConditionNegate;
            string who(string? a, string? b) =>
                !string.IsNullOrWhiteSpace(a) && !string.IsNullOrWhiteSpace(b) ? $"{a} · {b}"
                : !string.IsNullOrWhiteSpace(a) ? a!
                : !string.IsNullOrWhiteSpace(b) ? b!
                : "(unspecified)";

            switch (action.ConditionType)
            {
                case "WindowOpen":
                    var target = who(action.WindowProcessName, action.WindowTitle);
                    var scope = action.WindowMatchForegroundOnly ? "in the foreground" : "open";
                    return neg ? $"window {target} was {scope}" : $"window {target} was not {scope}";
                case "ProcessRunning":
                    return neg
                        ? $"process '{action.WindowProcessName}' was running"
                        : $"process '{action.WindowProcessName}' was not running";
                case "FileExists":
                    return neg ? $"file exists: {action.FilePath}" : $"file not found: {action.FilePath}";
                case "Variable":
                    return neg
                        ? $"variable '{action.Key}' matched {action.ConditionOperator} {action.ConditionOperand}"
                        : $"variable '{action.Key}' did not match {action.ConditionOperator} {action.ConditionOperand}";
                case "ClipboardMatch":
                    return neg ? "clipboard matched the pattern" : "clipboard did not match the pattern";
                case "TimeWindow":
                {
                    // ProbeTimeWindow fails on TWO independent criteria and SHORT-CIRCUITS on the
                    // day check, and it supports a day-only mode (no start/end). Rendering only
                    // the time clause therefore produced "the current time was outside –" for a
                    // plain "weekdays only" guard, and blamed the clock for a wrong-day failure.
                    var days = Models.ActionItem.FormatDaysOfWeek(action.DaysOfWeek);
                    bool hasWindow = !string.IsNullOrWhiteSpace(action.TimeStart)
                                  && !string.IsNullOrWhiteSpace(action.TimeEnd);
                    var window = hasWindow ? $"{action.TimeStart}–{action.TimeEnd}" : "";
                    string need =
                        days.Length > 0 && hasWindow ? $"{days} {window}" :
                        days.Length > 0 ? days :
                        hasWindow ? window :
                        "(no day or time window set)";
                    // A negated assert fails only when the probe returned TRUE — i.e. day AND
                    // time both matched — so the combined clause is exactly right there.
                    if (neg) return $"the current time was inside {need}";
                    var today = DateTime.Now.DayOfWeek;
                    bool dayOk = action.DaysOfWeek == 0
                              || (action.DaysOfWeek & (1 << (int)today)) != 0;
                    if (!dayOk) return $"today ({today}) is not one of {days}";
                    return hasWindow
                        ? $"the current time was outside {window}"
                        : $"the required window was not met ({need})";
                }
                case "ImageFound":
                    return neg ? "the image was on screen" : "the image was not on screen";
                case "PixelColorMatch":
                    return neg ? "the pixel matched the colour" : "the pixel did not match the colour";
                default:
                    return neg ? "the condition was met" : "the condition was not met";
            }
        }

        // Returns true only for the quiet-stop arm — the assert switch cases use it to
        // annotate the step's Detail (the row itself still archives "ok": the probe RAN).
        private bool HandleAssertFailure(ActionItem action, string reason)
        {
            string label = !string.IsNullOrWhiteSpace(action.Comment) ? action.Comment
                : !string.IsNullOrWhiteSpace(action.Key) ? action.Key
                : "element";

            if (string.Equals(action.AssertOnFail, "Continue", StringComparison.OrdinalIgnoreCase))
            {
                DiagnosticLog.Warn($"Assert '{label}': {reason} — Continue policy, moving on");
                return false;
            }
            // D4 "Stop quietly": end the run with NO error — the Stop-action framing. The arm
            // sits ABOVE the skip check on purpose, and the order is semantic: the user's
            // explicit "stop the run here" beats the table's row-skip policy — degrading it to
            // "skip this row and keep going" would keep running the exact thing they asked to
            // stop. No OnReplayError: the cancel unwinds through the OCE catches and the bridge
            // emits its normal success cue (byte-identical path to the Stop action's proof).
            if (string.Equals(action.AssertOnFail, "StopReplay", StringComparison.OrdinalIgnoreCase))
            {
                DiagnosticLog.Warn($"Assert '{label}': {reason} — quiet-stop policy, run ended");
                _authoredStop = true;   // notices gate: authored finish ≠ user abort
                try { _cts?.Cancel(); } catch (ObjectDisposedException) { }
                return true;
            }
            if (SkipRowOnErrorActive)
            {
                FailCurrentStep($"Assert failed: '{label}' — {reason}");
                FaultRow($"Assert failed: '{label}' — {reason}");
                return false;
            }
            DiagnosticLog.Warn($"Replay aborted: Assert '{label}' — {reason}");
            OnReplayError?.Invoke($"Assert failed: '{label}' — {reason}");
            FailCurrentStep($"Assert failed: '{label}' — {reason}");
            try { _cts?.Cancel(); } catch (ObjectDisposedException) { }
            return false;
        }

        // One failure policy for all three modes (launch threw / window never appeared /
        // activation unverified). Default = halt: keyboard actions follow the OS foreground,
        // so continuing after a silent focus failure would type into the wrong app.
        private void HandleActivateWindowFailure(ActionItem action, string reason)
        {
            bool hasProc = !string.IsNullOrWhiteSpace(action.WindowProcessName);
            bool hasTitle = !string.IsNullOrWhiteSpace(action.WindowTitle);
            string label =
                hasProc && hasTitle ? $"{action.WindowProcessName} · {action.WindowTitle}" :
                hasProc ? action.WindowProcessName! :
                hasTitle ? action.WindowTitle! :
                action.LaunchPath ?? "?";

            if (string.Equals(action.ActivateOnTimeout, "Continue", StringComparison.OrdinalIgnoreCase))
            {
                DiagnosticLog.Warn($"Activate Window '{label}': {reason} — Continue policy, moving on");
                return;
            }
            if (SkipRowOnErrorActive)
            {
                FailCurrentStep($"Activate Window: '{label}' — {reason}");
                FaultRow($"Activate Window: '{label}' — {reason}");
                return;
            }
            DiagnosticLog.Warn($"Replay aborted: Activate Window '{label}' — {reason}");
            OnReplayError?.Invoke($"Activate Window: '{label}' — {reason}");
            FailCurrentStep($"Activate Window: '{label}' — {reason}");
            try { _cts?.Cancel(); } catch (ObjectDisposedException) { }
        }

        private static bool TryLaunch(string path, string? args, out string error)
        {
            try
            {
                // UseShellExecute so bare names resolve via PATH/App Paths and URLs,
                // documents and .lnk files open with their registered handler — same
                // semantics as Win+R. The Process object is irrelevant (window existence
                // is the success criterion), dispose it immediately.
                var psi = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = path,
                    Arguments = args ?? string.Empty,
                    UseShellExecute = true,
                };
                System.Diagnostics.Process.Start(psi)?.Dispose();
                error = string.Empty;
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        // WindowMatcher.FindWindow with TrueReplayer's own windows excluded — a target
        // like title-contains "True" must never match (and then activate) ourselves.
        // Same self-skip rule the window picker applies.
        // <paramref name="matchN"/> = nth-match (1-based, EnumWindows Z-order front→back), counted
        // AFTER the visible + self-PID filters so it stays consistent with the first-match default.
        // matchN≤1 keeps the original first-match fast path; if fewer than N windows match, returns
        // Zero (the caller's poll loop then keeps waiting / times out).
        internal static IntPtr FindWindowExcludingSelf(Models.WindowTarget target, Regex? regex, int matchN = 1)
        {
            uint ownPid = (uint)Environment.ProcessId;
            var titleBuffer = new System.Text.StringBuilder(512);
            var procBuffer = new System.Text.StringBuilder(512);
            IntPtr result = IntPtr.Zero;
            int seen = 0;
            NativeMethods.EnumWindows((hwnd, lParam) =>
            {
                if (!NativeMethods.IsWindowVisible(hwnd)) return true;
                NativeMethods.GetWindowThreadProcessId(hwnd, out uint pid);
                if (pid == ownPid) return true;
                if (TrueReplayer.Helpers.WindowMatcher.Matches(hwnd, target, regex, titleBuffer, procBuffer)
                    && ++seen >= matchN)
                {
                    result = hwnd;
                    return false; // stop enumeration at the Nth match
                }
                return true;
            }, IntPtr.Zero);
            return result;
        }

        /// <summary>
        /// Send a synthesized mouse event. By default the (x, y) is interpreted as
        /// "profile coord space" — i.e. relative to the target window when
        /// <see cref="_useRelativeCoordinates"/> is on, absolute otherwise. Pass
        /// <paramref name="coordsAreProfileSpace"/> = false for callers that already
        /// have absolute virtual-desktop coordinates (e.g. WaitImage match-centre
        /// click — the screenshot pipeline returns absolute hits regardless of
        /// profile rel-coord state) so we don't double-translate.
        ///
        /// <paramref name="token"/> is the RUN's token, and it is what lets Stop reach the parts of
        /// a click that sleep: the smooth walk (MoveCursorTo) and the dwell below. Callers outside a
        /// run — ResetMouseState, which must always release — pass nothing and are unaffected.
        /// </summary>
        private void SimulateMouse(int x, int y, uint mouseEvent, int mouseData = 0, bool coordsAreProfileSpace = true, bool allowFastApproach = true, CancellationToken token = default)
        {
            // Translate profile-space coords (window-relative when UseRelativeCoordinates is on)
            // to absolute virtual-desktop pixels. Callers that already hold absolute coords
            // (e.g. WaitImage match-centre click) pass coordsAreProfileSpace: false to skip.
            // Missing target window with rel-coords on used to silently fall through here —
            // clicks would land at the relative coord interpreted as absolute. Now we surface
            // a visible error and bail instead. Same fix applies to WaitImage / WaitPixelColor.
            if (coordsAreProfileSpace)
            {
                if (!TryResolveRelativeOffset(out int dx, out int dy))
                {
                    ReportMissingTargetWindow();
                    return;
                }
                x += dx;
                y += dy;
            }

            // Cached virtual-screen bounds — saves 4 P/Invokes per mouse action.
            // See NativeMethods.VirtualScreen.
            var (vx, vy, vw, vh) = NativeMethods.VirtualScreen.Bounds;

            // Same clamp the clicker loop applies before normalising, for the same reason and now
            // by the same rule: a coordinate recorded on a monitor that has since been unplugged
            // (x = -1000 after vx went back to 0) normalises to roughly -34150, and only Windows'
            // own saturation at the edge kept that from being a wild pointer jump. Clamping here
            // makes the two paths agree instead of relying on that saturation.
            x = Math.Clamp(x, vx, vx + Math.Max(1, vw) - 1);
            y = Math.Clamp(y, vy, vy + Math.Max(1, vh) - 1);

            int absoluteX = (int)(((double)(x - vx) * 65535) / Math.Max(1, vw - 1));
            int absoluteY = (int)(((double)(y - vy) * 65535) / Math.Max(1, vh - 1));

            uint posFlags = NativeMethods.MOUSEEVENTF_MOVE
                | NativeMethods.MOUSEEVENTF_ABSOLUTE
                | NativeMethods.MOUSEEVENTF_VIRTUALDESK;

            int inputSize = NativeMethods.InputSize;

            MoveCursorTo(x, y, allowFastApproach, token: token);

            var clickInput = new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_MOUSE,
                U = new NativeMethods.InputUnion
                {
                    mi = new NativeMethods.MOUSEINPUT { dx = absoluteX, dy = absoluteY, mouseData = (uint)mouseData, dwFlags = mouseEvent | posFlags }
                }
            };

            // Small gap before the button fires: after a move it lets the app register the final
            // position; on the same-spot UP half it provides the press→release dwell. Kept on both
            // halves so synthetic clicks keep a realistic, non-zero dwell.
            if (!token.IsCancellationRequested) Thread.Sleep(Math.Max(0, MoveClickDelayMs));
            lock (_simInputLock)
            {
                // A Stop that landed during the walk or the dwell: nothing is PRESSED after it —
                // with slow Game Mode tuning the DOWN the walk was heading for used to go out
                // seconds after the user asked to stop. An UP still goes out while its button is
                // down, so a run stopped between the halves releases; once ResetMouseState has
                // released it, a second UP is skipped (a stray UP reads as a click to some apps).
                if (token.IsCancellationRequested && !IsTrackedRelease(mouseEvent)) return;
                NativeMethods.SendInput(1, ref clickInput, inputSize);

                // Track currently-pressed buttons here (atomic with the SendInput) so
                // ResetMouseState releases exactly what's down. Living inside SimulateMouse
                // means the missing-target early-return above never leaves a flag set — which
                // previously caused a spurious UP on Stop — and Stop can't observe a torn state.
                TrackButtonState(mouseEvent);
            }
        }

        // ── Move the cursor to (x,y). ───────────────────────────────────────────────────────
        // Roblox (and similar) reject a single large "teleport" move — they only follow
        // movement that progresses through intermediate positions, like a physical mouse.
        // So when SmoothMovement is on we INTERPOLATE: walk a straight path from the current
        // cursor to the target in steps of at most MoveStepPx pixels, pausing MoveStepDelayMs
        // between steps. SmoothMovement off (or MoveStepPx == 0) jumps straight (legacy).
        //
        // Extracted from SimulateMouse so the Clicker loop can reach the same machinery. The
        // body is unchanged; SimulateMouse calls it in exactly the place the block used to sit.
        // forceSmooth: walk the path even when the macro Game Mode master (SmoothMovement) is
        // off. The Clicker has its own "Game move" switch, and in Clicker mode the Game Mode
        // section is not even rendered — so without this the clicker toggle silently did
        // nothing whenever the macro master happened to be off, with no way for the user to
        // see what was cancelling it. Macro callers never pass it and keep honouring the master.
        private void MoveCursorTo(int x, int y, bool allowFastApproach, bool forceSmooth = false, CancellationToken token = default)
        {
            if (token.IsCancellationRequested) return;
            var (vx, vy, vw, vh) = NativeMethods.VirtualScreen.Bounds;
            uint posFlags = NativeMethods.MOUSEEVENTF_MOVE
                | NativeMethods.MOUSEEVENTF_ABSOLUTE
                | NativeMethods.MOUSEEVENTF_VIRTUALDESK;
            int inputSize = NativeMethods.InputSize;

            void MoveAbs(int tx, int ty)
            {
                int nx = (int)(((double)(tx - vx) * 65535) / Math.Max(1, vw - 1));
                int ny = (int)(((double)(ty - vy) * 65535) / Math.Max(1, vh - 1));
                NativeMethods.SetCursorPos(tx, ty); // for apps reading GetCursorPos
                var mv = new NativeMethods.INPUT
                {
                    type = NativeMethods.INPUT_MOUSE,
                    U = new NativeMethods.InputUnion { mi = new NativeMethods.MOUSEINPUT { dx = nx, dy = ny, dwFlags = posFlags } }
                };
                NativeMethods.SendInput(1, ref mv, inputSize); // for apps reading Raw Input
            }

            // A click is split across separate SimulateMouse calls (DOWN then UP at the same
            // point); on the UP half the cursor is already on target, so re-issuing the move is a
            // redundant SetCursorPos/SendInput. Skip that no-op move — but the gap sleep in
            // SimulateMouse is KEPT on both halves so press→release retains a small, realistic
            // dwell (some games / anti-cheat reject a zero-dwell synthetic click).
            int stepPx = MoveStepPx;
            bool smooth = (_runGameMode ?? SmoothMovement) || forceSmooth;
            // MoveStepPx is a macro tuning value and 0 is a legal setting there (PathStepZeroNote
            // exists for it). A forced walk with no step size would divide the path into nothing,
            // so fall back to the shipped default rather than silently degrade to a jump.
            if (forceSmooth && stepPx <= 0) stepPx = DefaultMoveStepPx;
            if (smooth && stepPx > 0 && NativeMethods.GetCursorPos(out var start) && (start.x != x || start.y != y))
            {
                int originX = start.x, originY = start.y;

                // Fast approach: teleport the long part of the move (SetCursorPos only — no
                // SendInput, so the game never sees a giant Raw-Input delta) to SettleDistancePx
                // short of the target, then smooth-walk just that final stretch below. Skipped
                // for moves already shorter than the settle distance (they're walked in full) and
                // for callers that opt out (the focus tap — see FocusTap). The settle point lands on
                // the nearest integer pixel, so it can sit ~1px off the exact SettleDistancePx ring;
                // that's harmless — the walk below still ends exactly on the target.
                if (allowFastApproach && FastApproach && SettleDistancePx > 0)
                {
                    double fullDx = x - originX;
                    double fullDy = y - originY;
                    double fullDist = Math.Sqrt(fullDx * fullDx + fullDy * fullDy);
                    if (fullDist > SettleDistancePx)
                    {
                        originX = x - (int)Math.Round(fullDx / fullDist * SettleDistancePx);
                        originY = y - (int)Math.Round(fullDy / fullDist * SettleDistancePx);
                        NativeMethods.SetCursorPos(originX, originY); // raw-input-silent teleport
                    }
                }

                int pathDx = x - originX;
                int pathDy = y - originY;
                double dist = Math.Sqrt((double)pathDx * pathDx + (double)pathDy * pathDy);
                int steps = Math.Max(1, (int)Math.Ceiling(dist / stepPx));
                for (int i = 1; i <= steps; i++)
                {
                    // Stop reaches the walk between steps. With Fast approach off, a small step and a
                    // long step delay, a cross-monitor walk is hundreds of steps and ran on for
                    // seconds after Stop, then clicked.
                    if (token.IsCancellationRequested) return;
                    double t = (double)i / steps;
                    MoveAbs(originX + (int)Math.Round(pathDx * t), originY + (int)Math.Round(pathDy * t));
                    if (i < steps && MoveStepDelayMs > 0) Thread.Sleep(MoveStepDelayMs);
                }
            }
            else if (smooth && stepPx > 0 && NativeMethods.GetCursorPos(out var atTarget) && atTarget.x == x && atTarget.y == y)
            {
                // Already exactly on target (typical UP half of a click) — skip the redundant move.
            }
            else
            {
                MoveAbs(x, y); // single jump (SmoothMovement off, MoveStepPx == 0, or GetCursorPos failed)
            }
        }

        // Clicker seam for the move half. gameAware routes through the interpolated path above,
        // FORCING the walk (forceSmooth) so the Clicker's own switch governs the Clicker — the
        // macro Game Mode master is not reachable from Clicker mode, so inheriting it would mean
        // a toggle that silently does nothing. It still reads the macro TUNING values
        // (FastApproach / MoveStepPx / MoveStepDelayMs / SettleDistancePx); otherwise it
        // is the plain dual write — SetCursorPos for GetCursorPos readers, one move INPUT for
        // Raw Input readers. Either way the move is its OWN event, emitted BEFORE the button,
        // which is what the clicker never did: it folded position into the click INPUT and sent
        // nothing else, so a game saw a giant delta arrive simultaneously with the press.
        //
        // Returns false when the cursor is already there, so the caller can skip the whole thing.
        // That is what keeps the default (cursor mode, no jitter) at exactly zero added cost:
        // its target IS the current position.
        public bool ClickerMoveTo(int x, int y, bool gameAware, CancellationToken token = default)
        {
            if (NativeMethods.GetCursorPos(out var cur) && cur.x == x && cur.y == y) return false;
            if (gameAware)
            {
                MoveCursorTo(x, y, allowFastApproach: true, forceSmooth: true, token: token);
            }
            else
            {
                var (vx, vy, vw, vh) = NativeMethods.VirtualScreen.Bounds;
                int nx = (int)(((double)(x - vx) * 65535) / Math.Max(1, vw - 1));
                int ny = (int)(((double)(y - vy) * 65535) / Math.Max(1, vh - 1));
                NativeMethods.SetCursorPos(x, y);
                var mv = new NativeMethods.INPUT
                {
                    type = NativeMethods.INPUT_MOUSE,
                    U = new NativeMethods.InputUnion
                    {
                        mi = new NativeMethods.MOUSEINPUT
                        {
                            dx = nx, dy = ny,
                            dwFlags = NativeMethods.MOUSEEVENTF_MOVE
                                | NativeMethods.MOUSEEVENTF_ABSOLUTE
                                | NativeMethods.MOUSEEVENTF_VIRTUALDESK,
                        }
                    }
                };
                NativeMethods.SendInput(1, ref mv, NativeMethods.InputSize);
            }
            return true;
        }

        // Updates the "currently pressed" flags from a mouse event's button bits.
        //
        // CALLER MUST ALREADY HOLD _simInputLock. It is split out (rather than inlined at the
        // one call site it used to have) so the clicker loop can share it: the clicker injects
        // its own INPUTs and, before this existed, never set these flags at all — so
        // ResetMouseState early-returned and a Stop landing inside the clicker's hold window
        // left the button physically latched down system-wide.
        // True for an UP whose button the engine currently holds down (TrackButtonState's view).
        private bool IsTrackedRelease(uint mouseEvent) =>
            ((mouseEvent & NativeMethods.MOUSEEVENTF_LEFTUP) != 0 && _simLeftDown)
            || ((mouseEvent & NativeMethods.MOUSEEVENTF_RIGHTUP) != 0 && _simRightDown)
            || ((mouseEvent & NativeMethods.MOUSEEVENTF_MIDDLEUP) != 0 && _simMiddleDown);

        private void TrackButtonState(uint mouseEvent)
        {
            if ((mouseEvent & NativeMethods.MOUSEEVENTF_LEFTDOWN) != 0) _simLeftDown = true;
            else if ((mouseEvent & NativeMethods.MOUSEEVENTF_LEFTUP) != 0) _simLeftDown = false;
            if ((mouseEvent & NativeMethods.MOUSEEVENTF_RIGHTDOWN) != 0) _simRightDown = true;
            else if ((mouseEvent & NativeMethods.MOUSEEVENTF_RIGHTUP) != 0) _simRightDown = false;
            if ((mouseEvent & NativeMethods.MOUSEEVENTF_MIDDLEDOWN) != 0) _simMiddleDown = true;
            else if ((mouseEvent & NativeMethods.MOUSEEVENTF_MIDDLEUP) != 0) _simMiddleDown = false;
        }

        // ── Clicker seam ────────────────────────────────────────────────────────────────────
        //
        // The Clicker loop (ReplayService.ToggleCursorClickReplay) builds and sends its own
        // INPUTs. These two members let it do that through the same button-tracking and the
        // same lock the macro engine uses, so Stop/ResetMouseState can release a clicker-held
        // button. Macro replay and the clicker can never run concurrently (ToggleCursorClick-
        // Replay stops any live replay first, and StartReplay is gated on !IsReplaying), so
        // sharing _simLeftDown/_simRightDown/_simMiddleDown between them is safe — that is the
        // invariant this whole seam rests on.
        //
        // Deliberately NOT routed through SimulateMouse: that method sleeps MoveClickDelayMs
        // (default 10 ms) on every call, which would be 20 ms per clicker tick and would cap
        // the achievable rate at ~50/s regardless of what the user configured. The clicker has
        // its own HoldMs for the press→release dwell.
        //
        // Returns SendInput's result: 0 means the call was rejected outright (a bad cbSize, or
        // another thread holding BlockInput), which the caller must not count as a click. It does
        // NOT reveal UIPI: against an elevated foreground window SendInput still returns 1 and the
        // event silently never enters the input stream — measured 2026-08-08, see the note in the
        // click loop above. An earlier version of this comment claimed the opposite.
        public uint ClickerButton(uint mouseEvent, int absX, int absY)
        {
            var input = new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_MOUSE,
                U = new NativeMethods.InputUnion
                {
                    mi = new NativeMethods.MOUSEINPUT
                    {
                        dx = absX,
                        dy = absY,
                        dwFlags = mouseEvent
                            | NativeMethods.MOUSEEVENTF_MOVE
                            | NativeMethods.MOUSEEVENTF_ABSOLUTE
                            | NativeMethods.MOUSEEVENTF_VIRTUALDESK,
                    }
                }
            };
            lock (_simInputLock)
            {
                uint sent = NativeMethods.SendInput(1, ref input, NativeMethods.InputSize);
                // Only record a press the OS actually accepted. Tracking a rejected DOWN would
                // make ResetMouseState emit an UP for a button that was never pressed — an
                // orphan release that some apps read as a click.
                if (sent == 1) TrackButtonState(mouseEvent);
                return sent;
            }
        }

        // Authoritative last word for the clicker's outer finally: releases whatever the loop
        // left pressed. No-ops when nothing is down.
        public void ReleaseHeldMouseButtons() => ResetMouseState();

        // Matches {clipboard} or {clipboard:modifier[:arg]...}
        // Group 1 captures the modifier chain (without the leading colon); empty when no modifiers.
        private static readonly Regex ClipboardTokenRegex = new(
            @"\{clipboard(?::([^}]+))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // ── Reference arguments: "@name" in an argument position ────────────────────────────
        //
        // A modifier argument is normally a literal ("line:3"). It may instead be a REFERENCE to
        // run state — "line:@i" takes the index from the variable `i`. Reserved: @counter (the run
        // repeat), @loop (the innermost While / For Each iteration), @row (the action's own grid
        // row, like {row}) and @datarow (the data-loop row number).
        //
        // Why a sigil and not the obvious `{clipboard:line:{i}}`: '@' is not '{', '}' or ':', so
        // every token regex, every Split(':') and every positional mirror in this file AND in the
        // frontend keeps working untouched. A brace form would instead have to widen
        // ClipboardTokenRegex, the pin's ClipboardTokenShapeRegex and the TS mirror in lockstep —
        // three hand-written walks over the same grammar, in the one area of this codebase with a
        // documented history of drifting apart (see the note above TrySplitNextModifier). It would
        // also silently re-read text already on disk: `{clipboard:join:{enter}}` means "join with
        // the literal string `{enter`" today, and brace-awareness would change that meaning under
        // profiles nobody edited.
        //
        // Deliberately excluded as reference targets: {input:}, {winclip:}, {clipboard:next},
        // {rownext:} and {random:} — every one is async or stateful, and this resolution runs
        // inside synchronous Regex.Replace evaluators. A user who wants a prompt-driven index sets
        // a variable one row earlier, which costs a row and keeps this path deadlock-free.
        private const string ArgRefSigil = "@";

        /// <summary>
        /// True when a chain segment has the SHAPE of a reference argument. Shape only — it never
        /// asks whether the reference resolves, because arity must not depend on run-time data: the
        /// applier, <see cref="TrySplitNextModifier"/> and the frontend's findNextModifier all step
        /// through the chain using this predicate, and a value-dependent answer would make "is this
        /// segment `next`?" depend on what a variable happens to hold.
        /// </summary>
        internal static bool IsArgRef(string? segment)
        {
            if (string.IsNullOrEmpty(segment) || segment.Length < 2) return false;
            if (segment[0] != ArgRefSigil[0]) return false;
            for (int k = 1; k < segment.Length; k++)
            {
                char c = segment[k];
                if (!char.IsLetterOrDigit(c) && c != '_') return false;
            }
            return true;
        }

        /// <summary>
        /// Resolves an "@name" segment to its run-state text. Returns false when the name is
        /// unknown — callers then yield EMPTY rather than skipping the modifier (see the fail-empty
        /// note at each call site).
        /// </summary>
        private static bool TryResolveRefArg(string segment, in RunCtx ctx, out string value)
        {
            value = string.Empty;
            if (!IsArgRef(segment)) return false;
            var name = segment.Substring(1);
            // Reserved names first so a variable literally called "counter" can't shadow them.
            if (string.Equals(name, "counter", StringComparison.OrdinalIgnoreCase))
            {
                value = ctx.Iteration.ToString(System.Globalization.CultureInfo.InvariantCulture);
                return true;
            }
            if (string.Equals(name, "row", StringComparison.OrdinalIgnoreCase))
            {
                value = ctx.Row.ToString(System.Globalization.CultureInfo.InvariantCulture);
                return true;
            }
            if (string.Equals(name, "loop", StringComparison.OrdinalIgnoreCase))
            {
                value = ctx.Loop.ToString(System.Globalization.CultureInfo.InvariantCulture);
                return true;
            }
            if (string.Equals(name, "datarow", StringComparison.OrdinalIgnoreCase))
            {
                value = ctx.DataRow.ToString(System.Globalization.CultureInfo.InvariantCulture);
                return true;
            }
            // Lowercased lookup, mirroring how {var:name} reads the same dictionary.
            if (ctx.Variables != null && ctx.Variables.TryGetValue(name.ToLowerInvariant(), out var v))
            {
                value = v ?? string.Empty;
                return true;
            }
            return false;
        }

        /// <summary>
        /// Reads an integer argument that may be a literal or an "@name" reference.
        /// <paramref name="consumed"/> says whether the segment belongs to this modifier — for a
        /// reference it is ALWAYS true (shape-decided arity), for a literal it is true only when it
        /// parsed, preserving today's behaviour where a typo'd "line:upper" leaves `upper` to be
        /// read as its own modifier.
        /// </summary>
        private static bool TryReadIntArg(string segment, in RunCtx ctx, int min, out int n, out bool consumed)
        {
            if (IsArgRef(segment))
            {
                consumed = true;
                return TryResolveRefArg(segment, ctx, out var text)
                    && int.TryParse(text.Trim(), System.Globalization.NumberStyles.Integer,
                                    System.Globalization.CultureInfo.InvariantCulture, out n)
                    && n >= min
                    ? true
                    : Fail(out n);
            }
            consumed = int.TryParse(segment, out n) && n >= min;
            return consumed;

            static bool Fail(out int n) { n = 0; return false; }
        }

        /// <summary>
        /// How many segments a modifier eats, and how it decides. This is THE arity rule: five
        /// walks step through a chain (the applier, <see cref="TrySplitNextModifier"/>,
        /// <see cref="ChainUsesTokenArg"/>, <see cref="ChainUsesAnyOf"/>,
        /// <see cref="ChainCarriesEscapedColon"/>) and every one of them must agree
        /// segment-for-segment, or a chain means one thing to the engine and another to the
        /// version pin.
        /// </summary>
        private enum ModifierArg
        {
            None,       // takes no argument
            Raw,        // `join` — eats the next segment whatever it says, even a modifier name
            RawPair,    // `replace` — eats the next TWO segments whatever they say (FROM, TO)
            RawSplit,   // the split family, dropnum and default — like Raw, but "::" inside the
                        // argument is one literal ':', so it can span several segments (see ReadSplitDelimiter)
            Count1,     // line/word — a 1-based index
            Count0,     // first/last — a length
            Span,       // range/words — "a-b", either side optional ("6-", "-5")
            Indices,    // lines — "3,1,2"
        }

        private static ModifierArg ArgOf(string modifier) => modifier switch
        {
            // Freeform-text arguments — a separator (join) or a cut point (the split family).
            // Consumed unconditionally, so an argument that happens to spell a modifier name
            // is still an argument.
            //
            // The two are NOT the same kind, and the difference is not cosmetic: `join` may
            // legitimately take an EMPTY separator, which the editor emits as an explicit empty
            // part, so "{clipboard:join::upper}" already means "glue with nothing, then upper"
            // and its "::" is spoken for. The split family never emits an empty delimiter (one
            // leaves the modifier inert), so ITS "::" was free to mean an escaped colon.
            "join" => ModifierArg.Raw,
            // replace takes TWO raw segments, FROM and TO — see its case in the applier for why
            // neither can hold a colon (an empty TO is meaningful, so "::" is spoken for, as join's).
            "replace" => ModifierArg.RawPair,
            // default joins the split family: an empty text is inert, so its "::" is free to escape.
            "before" or "after" or "beforelast" or "afterlast" or "dropnum" or "default" => ModifierArg.RawSplit,
            "line" or "word" => ModifierArg.Count1,
            "first" or "last" or "pad" => ModifierArg.Count0,
            "range" or "words" => ModifierArg.Span,
            "lines" => ModifierArg.Indices,
            _ => ModifierArg.None,
        };

        /// <summary>
        /// Reads the delimiter of a split-family modifier sitting at <paramref name="i"/> and
        /// reports where the next modifier starts. "::" inside the argument is ONE literal colon:
        /// the chain was split on ':' long before anyone got here, so an escaped colon arrives as
        /// an EMPTY segment between the two halves, and this stitches them back together.
        ///
        /// The escape is confined to this family deliberately. `join` is the other freeform
        /// argument, but an empty separator is MEANINGFUL there and the editor emits it as an
        /// explicit empty part — "{clipboard:join::upper}" already means "glue with nothing, then
        /// upper", so its "::" is spoken for and redefining it would change tokens that exist on
        /// disk. Here an empty delimiter only ever left the modifier inert, and the editor refuses
        /// to emit one at all, so "after::" was unreachable and free to mean ":".
        ///
        /// Arity still comes from SHAPE alone, as everywhere else in this walk: how many segments
        /// are consumed depends on WHERE the empty segments are, never on what any of them hold.
        /// </summary>
        private static string ReadSplitDelimiter(string[] parts, int i, out int next)
        {
            int j = i + 1;
            // No argument at all (a hand-typed "...:after" at the tail): empty delimiter, and the
            // step below lands safely past the end — the same fall-through Raw has always had.
            string delim = j < parts.Length ? parts[j] : string.Empty;
            // An empty follower is a "::" seam ONLY when something follows it. The bound is
            // j+2, not j+1, and that one index is the whole difference between reading the
            // grammar and guessing at it:
            //
            //   "after:Total:"   splits to ["after","Total",""] — ONE trailing empty. That is a
            //                    chain that merely ENDS in a colon, which 2.22.0 read as the
            //                    delimiter "Total" plus an inert empty modifier. No encoder can
            //                    produce this shape for an escape, because buildModifierParts
            //                    writes a trailing colon DOUBLED ("after:Total::"), so absorbing
            //                    it would silently redefine chains already on disk.
            //   "after:Total::"  splits to ["after","Total","",""] — the empty has a follower, so
            //                    it is a real seam and the delimiter is "Total:".
            //
            // It also keeps this in step with ChainUsesEscapedColon's cheap reject: absorbing now
            // ALWAYS implies two adjacent colons in the chain string, which is exactly what that
            // detector scans for. Loosen this bound and the pin goes blind to the difference.
            while (j + 2 < parts.Length && parts[j + 1].Length == 0)
            {
                delim += ":" + parts[j + 2];
                j += 2;
            }
            next = j + 1;
            return delim;
        }

        /// <summary>
        /// Advances past ONE modifier and returns where the next one starts, reporting whether the
        /// argument it consumed was an "@name" reference.
        ///
        /// Every walk in this file routes its stepping through here rather than re-deriving it.
        /// That is not tidiness: <see cref="ChainUsesTokenArg"/> used to step `i += 2` after any
        /// arg-taking modifier while the applier steps `+1` when a LITERAL argument fails its gate,
        /// and the two disagreed on chains like `{clipboard:line:first:@n}` — the applier reads
        /// `line` as argument-less (its follower "first" is not a number) and then applies
        /// `first:@n`, while the pin walk swallowed "first" as line's argument, landed on "@n" as a
        /// bare modifier, and reported NO reference. The profile then exported with no minimum
        /// version and an older build pasted the whole clipboard.
        ///
        /// Arity is decided on SHAPE alone — never on what a variable holds. A reference is always
        /// consumed; a literal only when it satisfies that modifier's gate, which is what keeps a
        /// typo'd `line:upper` from eating the next modifier.
        /// </summary>
        /// <summary>
        /// Widest zero-pad `pad:N` will build. Above this the modifier fails empty instead of
        /// allocating: no real zero-pad needs four thousand characters, and the values that reach
        /// this far are typos. Mirrored by MAX_PAD_WIDTH in clipboardModifiers.ts — the preview
        /// must refuse exactly what the engine refuses.
        /// </summary>
        internal const int MaxPadWidth = 4096;

        private static int StepModifier(string[] parts, int i, out bool argIsRef)
        {
            argIsRef = false;
            var kind = ArgOf(parts[i].ToLowerInvariant());
            if (kind == ModifierArg.None) return i + 1;
            // The split family owns a VARIABLE number of segments once "::" is in play, and
            // ReadSplitDelimiter is the single place that decides how many — so every walk
            // routing through here inherits the escape instead of re-deriving it.
            if (kind == ModifierArg.RawSplit)
            {
                ReadSplitDelimiter(parts, i, out var afterSplit);
                return afterSplit;
            }
            // Two raw segments, unconditionally — a missing one reads as empty, and the step lands
            // past the end safely (the applier reads what is there).
            if (kind == ModifierArg.RawPair) return i + 3;
            // No argument left to take. `join` still steps 2 — the applier does, falling safely
            // past the end — and every other modifier degrades to argument-less.
            if (i + 1 >= parts.Length) return kind == ModifierArg.Raw ? i + 2 : i + 1;

            var arg = parts[i + 1];
            if (kind == ModifierArg.Raw) return i + 2;
            if (IsArgRef(arg)) { argIsRef = true; return i + 2; }

            bool literalFits = kind switch
            {
                ModifierArg.Count1 => int.TryParse(arg, out var one) && one >= 1,
                ModifierArg.Count0 => int.TryParse(arg, out var zero) && zero >= 0,
                ModifierArg.Span => TryParseSpan(arg, out _, out _),
                ModifierArg.Indices => arg.AsSpan().IndexOfAnyInRange('0', '9') >= 0,
                _ => false,
            };
            return literalFits ? i + 2 : i + 1;
        }

        /// <summary>
        /// True when the chain uses a reference argument anywhere — the single source of truth the
        /// version pin delegates to, so the pin can never disagree with the engine about what
        /// counts (the doctrine the {clipboard:next} pin already follows).
        /// </summary>
        internal static bool ChainUsesTokenArg(string? modifierChain)
        {
            if (string.IsNullOrEmpty(modifierChain)) return false;
            if (modifierChain.IndexOf(ArgRefSigil[0]) < 0) return false;
            var parts = modifierChain.Split(':');
            for (int i = 0; i < parts.Length;)
            {
                i = StepModifier(parts, i, out var isRef);
                if (isRef) return true;
            }
            return false;
        }

        /// <summary>
        /// True when the chain references the loop-block state — "@loop" or "@datarow" in an
        /// argument position. The pin for the tokens that shipped with those names delegates here,
        /// on the same walk as <see cref="ChainUsesTokenArg"/>, so a join separator that merely
        /// spells "@loop" ({clipboard:join:@loop}) is an argument to the pin exactly as it is to
        /// the applier, and never pins.
        /// </summary>
        internal static bool ChainUsesLoopRef(string? modifierChain)
        {
            if (string.IsNullOrEmpty(modifierChain)) return false;
            if (modifierChain.IndexOf(ArgRefSigil[0]) < 0) return false;
            var parts = modifierChain.Split(':');
            for (int i = 0; i < parts.Length;)
            {
                int at = i;
                i = StepModifier(parts, at, out var isRef);
                if (isRef && (string.Equals(parts[at + 1], "@loop", StringComparison.OrdinalIgnoreCase)
                              || string.Equals(parts[at + 1], "@datarow", StringComparison.OrdinalIgnoreCase)))
                    return true;
            }
            return false;
        }

        private static readonly HashSet<string> SliceModifierNames = new(StringComparer.OrdinalIgnoreCase)
            { "words", "before", "after", "beforelast", "afterlast" };

        private static readonly HashSet<string> ListModifierNames = new(StringComparer.OrdinalIgnoreCase)
            { "range", "lines", "sort", "dedupe", "reverse", "join" };

        // NOT folded into SliceModifierNames: that set is wired to the 2.20.0 pin, and a 2.20.0
        // build has no dropnum — sharing the set would let a dropnum profile import where the
        // modifier silently does nothing.
        private static readonly HashSet<string> DropNumModifierNames = new(StringComparer.OrdinalIgnoreCase)
            { "dropnum" };

        // Same isolation rule as DropNumModifierNames: these two shipped together after 2.24.0
        // and get their own pin — folding them into an older pinned set would let a profile
        // using them import where the modifiers silently do nothing.
        private static readonly HashSet<string> TextFilterModifierNames = new(StringComparer.OrdinalIgnoreCase)
            { "noaccents", "digits" };

        // The value-shaping modifiers that shipped in 2.37.0: replace, count, pad and default. Its
        // own pin, for the DropNum reason — sharing an older pinned set would let a profile using
        // them import where they silently do nothing.
        private static readonly HashSet<string> ShapeModifierNames = new(StringComparer.OrdinalIgnoreCase)
            { "replace", "count", "pad", "default" };

        /// <summary>
        /// True when the chain uses a modifier the walk LANDS on — never one it steps over as
        /// somebody's argument. Both pins below delegate here for the reason the {clipboard:next}
        /// pin does: deciding "does this chain use X?" with a regex means re-implementing the
        /// argument-consumption walk in another dialect, and the two drift.
        /// </summary>
        private static bool ChainUsesAnyOf(string? modifierChain, HashSet<string> names, bool openSpanCounts)
        {
            if (string.IsNullOrEmpty(modifierChain)) return false;
            var parts = modifierChain.Split(':');
            for (int i = 0; i < parts.Length;)
            {
                if (names.Contains(parts[i])) return true;
                // An OPEN-ended span is new even on a modifier that is not: an older build's
                // closed-range parser refuses "6-", leaves the argument unconsumed, and `range`
                // sits inert on the whole content.
                if (openSpanCounts
                    && string.Equals(parts[i], "range", StringComparison.OrdinalIgnoreCase)
                    && i + 1 < parts.Length && IsOpenSpan(parts[i + 1])) return true;
                i = StepModifier(parts, i, out _);
            }
            return false;
        }

        /// <summary>Text-slice modifiers (words / before / after / beforelast / afterlast) and
        /// open-ended spans — everything this version added to the chain.</summary>
        internal static bool ChainUsesSliceModifier(string? modifierChain)
            => ChainUsesAnyOf(modifierChain, SliceModifierNames, openSpanCounts: true);

        /// <summary>The list modifiers, which shipped in 2.8.0 and were never pinned.</summary>
        internal static bool ChainUsesListModifier(string? modifierChain)
            => ChainUsesAnyOf(modifierChain, ListModifierNames, openSpanCounts: false);

        /// <summary>The `dropnum` modifier (drop a leading digit run + suffix), for its own pin.</summary>
        internal static bool ChainUsesDropNum(string? modifierChain)
            => ChainUsesAnyOf(modifierChain, DropNumModifierNames, openSpanCounts: false);

        /// <summary>The text-filter modifiers (`noaccents` / `digits`), for their own pin.</summary>
        internal static bool ChainUsesTextFilter(string? modifierChain)
            => ChainUsesAnyOf(modifierChain, TextFilterModifierNames, openSpanCounts: false);

        /// <summary>The value-shaping modifiers (`replace` / `count` / `pad` / `default`), for their own pin.</summary>
        internal static bool ChainUsesShapeModifier(string? modifierChain)
            => ChainUsesAnyOf(modifierChain, ShapeModifierNames, openSpanCounts: false);

        /// <summary>
        /// True when a split-family delimiter carries an escaped colon ("after: :: "). Asked by the
        /// version pin, and delegated here rather than sniffed with a regex for the reason every
        /// other detector in this file delegates: "::" is only an escape where the WALK says a
        /// delimiter is being read, and a "{clipboard:join::upper}" that a regex cannot tell apart
        /// would pin a token that has meant the same thing since 2.8.0.
        ///
        /// Consuming more than two segments is the signature, and it is exact: ReadSplitDelimiter
        /// steps past i+2 only when it absorbed an empty segment, which is what an escaped colon
        /// splits into.
        /// </summary>
        internal static bool ChainUsesEscapedColon(string? modifierChain)
        {
            if (ChainCarriesEscapedColon(modifierChain)) return true;
            // The applier never sees the STORED chain when a bare `next` is in it: TrySplitNextModifier
            // pulls that segment out and the REST is what gets applied. Dropping an index and
            // re-joining can leave an inert empty segment sitting beside a split delimiter, where it
            // reads as a "::" seam — so the chain that actually runs can carry an escape the stored
            // one does not ("after:-:next::upper" stores no escape and applies "after:-::upper",
            // which does). Ask the same method the engine asks, and pin on what will really run.
            return TrySplitNextModifier(modifierChain, out var rest) && ChainCarriesEscapedColon(rest);
        }

        private static bool ChainCarriesEscapedColon(string? modifierChain)
        {
            if (string.IsNullOrEmpty(modifierChain)) return false;
            // Cheap reject: after ReadSplitDelimiter's j+2 bound, absorbing ALWAYS means two
            // adjacent colons are present, so this can never hide a real escape.
            if (modifierChain.IndexOf("::", StringComparison.Ordinal) < 0) return false;
            var parts = modifierChain.Split(':');
            for (int i = 0; i < parts.Length;)
            {
                bool isSplit = ArgOf(parts[i].ToLowerInvariant()) == ModifierArg.RawSplit;
                int next = StepModifier(parts, i, out _);
                if (isSplit && next > i + 2) return true;
                i = next;
            }
            return false;
        }

        // "6-" or "-5" — a span whose missing side an older TryParseLineRange would reject.
        private static bool IsOpenSpan(string s)
        {
            if (!TryParseSpan(s, out _, out _)) return false;
            int dash = s.IndexOf('-');
            return dash == 0 || dash == s.Length - 1;
        }

        // True when every surrogate half is correctly paired. noaccents gates on this because
        // string.Normalize THROWS on a lone half, and the applier's modifiers must stay total
        // functions — a broken clipboard degrades, it never fails the run. The TS preview keeps
        // the same gate (a /[\uD800-\uDFFF]/u test) so preview and replay agree on these inputs.
        private static bool IsWellFormedUtf16(string s)
        {
            for (int k = 0; k < s.Length; k++)
            {
                if (char.IsHighSurrogate(s[k]))
                {
                    if (k + 1 >= s.Length || !char.IsLowSurrogate(s[k + 1])) return false;
                    k++;
                }
                else if (char.IsLowSurrogate(s[k])) return false;
            }
            return true;
        }

        /// <summary>
        /// Applies modifier chain (e.g. "trim:line:1:first:8:upper") to clipboard content.
        /// Unknown modifiers are silently ignored so that future modifiers stay forward-compatible.
        /// An argument may be a literal or an "@name" reference (see <see cref="IsArgRef"/>);
        /// <paramref name="ctx"/> is what a reference resolves against and is ignored otherwise.
        /// </summary>
        internal static string ApplyClipboardModifiers(string content, string? modifierChain, RunCtx ctx = default)
        {
            if (string.IsNullOrEmpty(modifierChain)) return content;
            if (content == null) return string.Empty;

            var parts = modifierChain.Split(':');
            var result = content;
            int i = 0;
            while (i < parts.Length)
            {
                var mod = parts[i].ToLowerInvariant();
                switch (mod)
                {
                    case "upper":
                        result = result.ToUpperInvariant();
                        i++;
                        break;
                    case "lower":
                        result = result.ToLowerInvariant();
                        i++;
                        break;
                    case "sentence":
                        if (result.Length > 0)
                            result = char.ToUpperInvariant(result[0]) + result.Substring(1);
                        i++;
                        break;
                    case "title":
                        {
                            var sb = new System.Text.StringBuilder(result.Length);
                            bool atWordStart = true;
                            foreach (var ch in result)
                            {
                                if (char.IsWhiteSpace(ch)) { sb.Append(ch); atWordStart = true; }
                                else { sb.Append(atWordStart ? char.ToUpperInvariant(ch) : ch); atWordStart = false; }
                            }
                            result = sb.ToString();
                        }
                        i++;
                        break;
                    case "trim":
                        result = result.Trim();
                        i++;
                        break;
                    case "noaccents":
                        {
                            // NFD → drop combining marks → NFC, the exact algorithm the TS preview
                            // mirrors (normalize('NFD') + strip \p{Mn} + normalize('NFC')). Case is
                            // preserved by construction — no case mapping is involved (ç→c, Ã→A).
                            //
                            // Gated on well-formed UTF-16 because string.Normalize THROWS on a lone
                            // surrogate half — and those are reachable, not exotic: any app can put
                            // ill-formed text on the clipboard, and first/last cut by UTF-16 unit,
                            // so "first:5:noaccents" (the builder's own canonical order) manufactures
                            // one by slicing inside an emoji pair. Unguarded, this would be the
                            // chain's only run-killing modifier; broken input passes through
                            // UNTOUCHED instead (dropnum's fail-open posture), and the TS preview
                            // carries the same gate so both sides agree on exactly these inputs.
                            if (IsWellFormedUtf16(result))
                            {
                                var formD = result.Normalize(System.Text.NormalizationForm.FormD);
                                var sb = new System.Text.StringBuilder(formD.Length);
                                for (int k = 0; k < formD.Length; k++)
                                {
                                    // Classify by CODE POINT, never per UTF-16 unit: the char
                                    // overload calls both halves of an astral mark "Surrogate" and
                                    // would keep marks the TS preview's \p{Mn} strips (ideographic
                                    // variation selectors, Adlam marks). Pairs are intact here by
                                    // the gate above, so k+1 is always valid after a high half.
                                    int width = char.IsHighSurrogate(formD[k]) ? 2 : 1;
                                    if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(formD, k)
                                            != System.Globalization.UnicodeCategory.NonSpacingMark)
                                        sb.Append(formD, k, width);
                                    if (width == 2) k++;
                                }
                                result = sb.ToString().Normalize(System.Text.NormalizationForm.FormC);
                            }
                        }
                        i++;
                        break;
                    case "digits":
                        {
                            // ASCII '0'–'9' on purpose, never char.IsDigit — it matches Unicode Nd
                            // (e.g. full-width '１') and would diverge from the TS preview's [0-9].
                            // Same ASCII doctrine as dropnum and the lines gate.
                            var sb = new System.Text.StringBuilder(result.Length);
                            foreach (var ch in result)
                                if (ch >= '0' && ch <= '9') sb.Append(ch);
                            result = sb.ToString();
                        }
                        i++;
                        break;

                    // ── Split modifiers — cut at a delimiter, keep one side ─────────────────
                    // before:X / after:X cut at the FIRST occurrence, beforelast/afterlast at
                    // the LAST. The delimiter itself is dropped either way. Placed here, ahead
                    // of the line ops, because they narrow the RAW text before it is reshaped.
                    case "before":
                    case "after":
                    case "beforelast":
                    case "afterlast":
                        {
                            // The delimiter is freeform text, so it is consumed UNCONDITIONALLY
                            // — the join rule, for the join reason: a delimiter that happens to
                            // spell a modifier name is still a delimiter. It may also carry a
                            // colon of its own, written "::"; ReadSplitDelimiter owns both the
                            // stitching and the resulting arity, so this branch and every pin
                            // walk agree on where the modifier ends.
                            string delim = ReadSplitDelimiter(parts, i, out int afterDelim);
                            if (delim.Length > 0)
                            {
                                bool fromEnd = mod is "beforelast" or "afterlast";
                                // Case-insensitive, like every other match in the app (the same
                                // convention sort/dedupe cite). It also means the editor's
                                // cosmetic case-folding of a chain can never change the cut.
                                int at = fromEnd
                                    ? result.LastIndexOf(delim, StringComparison.OrdinalIgnoreCase)
                                    : result.IndexOf(delim, StringComparison.OrdinalIgnoreCase);
                                if (at < 0)
                                    // Delimiter ABSENT → empty, never the whole content. Same
                                    // fail-closed rule as line:99 and word:99: ask for a piece
                                    // that is not there, get nothing. The other answer pastes an
                                    // entire clipboard where the author meant a fragment.
                                    result = string.Empty;
                                else if (mod is "before" or "beforelast")
                                    result = result[..at];
                                else
                                    result = result[(at + delim.Length)..];
                            }
                            // An empty delimiter is not a cut point — leave the content untouched.
                            // That is "you didn't ask for anything", not "what you asked for is
                            // missing", so it degrades to inert rather than to empty. Reachable
                            // only by hand now: a bare trailing "after" or a hand-typed "after::"
                            // (a one-colon delimiter is spelled "after:::"), and the editor never
                            // emits an empty one.

                            // Steps over the whole delimiter however many segments it took,
                            // landing safely past-the-end when there was no argument at all.
                            i = afterDelim;
                        }
                        break;
                    // ── Drop count — strip a leading "<digits><suffix>" when present ────────
                    // dropnum:X removes a run of ASCII digits plus X from the very START of the
                    // content ("1x Caixa" → "Caixa" for X = "x "), and leaves it alone otherwise.
                    // Same RawSplit argument shape as the split family: freeform, consumed
                    // unconditionally, "::" is a literal colon.
                    case "dropnum":
                        {
                            string suffix = ReadSplitDelimiter(parts, i, out int afterSuffix);
                            // Empty suffix = inert, and that is CONTRACT, not a corner case: it is
                            // the property that keeps "::" free to mean an escaped colon in this
                            // arm (the same reason the split family could take the escape and
                            // `join` could not). Redefining empty as, say, "digits only" would
                            // recreate exactly the join collision.
                            if (suffix.Length > 0)
                            {
                                // ASCII '0'–'9' on purpose, never char.IsDigit: the TS preview
                                // matches /^[0-9]+/, and a Unicode-aware run here would strip
                                // digits the preview shows surviving. Same ASCII-only intent as
                                // the `lines` gate in StepModifier.
                                int d = 0;
                                while (d < result.Length && result[d] >= '0' && result[d] <= '9') d++;
                                // Fail-OPEN — no prefix, no change. The opposite of the split
                                // family's fail-closed rule ON PURPOSE, not an oversight to fix:
                                // there "absent" is a failed SEARCH, and yielding the whole
                                // content would paste a clipboard where the author meant a
                                // fragment. Here "absent" is a fact about POSITION — the content
                                // simply doesn't start with a count — and the author asked to
                                // normalize, not to extract. Untouched IS the correct answer.
                                if (d > 0
                                    && d + suffix.Length <= result.Length
                                    && string.Compare(result, d, suffix, 0, suffix.Length,
                                                      StringComparison.OrdinalIgnoreCase) == 0)
                                    result = result[(d + suffix.Length)..];
                            }
                            i = afterSuffix;
                        }
                        break;
                    // The four int-argument modifiers share one shape: read the arg (literal or
                    // "@name"), and when a REFERENCE fails to resolve, yield EMPTY rather than
                    // leaving the modifier unapplied. Falling through would hand the caller the
                    // WHOLE content — a typo'd variable name would paste an entire clipboard into
                    // a customer reply, which is exactly the silent-divergence class this file
                    // already pins {clipboard:next} against.
                    // Arity comes from StepModifier, never from a local `i +=` — see the note there.
                    // `next == i + 2` IS "the argument belongs to me", so a consumed-but-unusable
                    // argument fails EMPTY and an unconsumed one leaves the modifier inert.
                    case "line":
                        {
                            int next = StepModifier(parts, i, out _);
                            if (next == i + 2)
                            {
                                if (TryReadIntArg(parts[i + 1], ctx, 1, out var lineN, out _))
                                {
                                    var lines = result.Replace("\r\n", "\n").Split('\n');
                                    result = lineN <= lines.Length ? lines[lineN - 1] : string.Empty;
                                }
                                else result = string.Empty;   // reference that didn't resolve
                            }
                            i = next;
                        }
                        break;
                    case "word":
                        {
                            int next = StepModifier(parts, i, out _);
                            if (next == i + 2)
                            {
                                if (TryReadIntArg(parts[i + 1], ctx, 1, out var wordN, out _))
                                {
                                    var words = result.Split(WordSeparators, StringSplitOptions.RemoveEmptyEntries);
                                    result = wordN <= words.Length ? words[wordN - 1] : string.Empty;
                                }
                                else result = string.Empty;
                            }
                            i = next;
                        }
                        break;
                    case "words":
                        // words:a-b → the SPAN of words a..b, as a substring of the original so
                        // the spacing between them survives (see SliceWords). Open ends allowed:
                        // "words:6-" is word 6 onwards. A reference is resolved to text and fed to
                        // the SAME parser, so a variable holding "2-4" works — included for the
                        // reason range has it: without it a hand-typed "words:@r" would fall
                        // through the unknown-modifier default and paste everything.
                        {
                            int next = StepModifier(parts, i, out var wordsRef);
                            if (next == i + 2)
                            {
                                var seg = parts[i + 1];
                                string argText = seg;
                                bool resolved = !wordsRef || TryResolveRefArg(seg, ctx, out argText);
                                result = resolved && TryParseSpan(argText, out var wordFrom, out var wordTo)
                                    ? SliceWords(result, wordFrom, wordTo)
                                    // Only reachable for a reference: a literal only gets consumed
                                    // when it already parsed as a span.
                                    : string.Empty;
                            }
                            i = next;
                        }
                        break;
                    case "first":
                        {
                            int next = StepModifier(parts, i, out _);
                            if (next == i + 2)
                            {
                                if (TryReadIntArg(parts[i + 1], ctx, 0, out var firstN, out _))
                                    result = firstN >= result.Length ? result : result.Substring(0, firstN);
                                else result = string.Empty;
                            }
                            i = next;
                        }
                        break;
                    case "last":
                        {
                            int next = StepModifier(parts, i, out _);
                            if (next == i + 2)
                            {
                                if (TryReadIntArg(parts[i + 1], ctx, 0, out var lastN, out _))
                                    result = lastN >= result.Length ? result : result.Substring(result.Length - lastN);
                                else result = string.Empty;
                            }
                            i = next;
                        }
                        break;

                    // ── List modifiers — operate on CRLF-normalized lines (same split rule
                    // as line:N above) and re-join with "\n". Old app versions skip these
                    // via the default case below, degrading to the unmodified content.
                    case "range":
                        // range:a-b → keep lines a..b (1-based, inclusive; bounds swap when
                        // reversed; clamped to the available lines; no overlap → empty).
                        // Either end may be open: "range:6-" is line 6 onwards.
                        // A reference here is resolved to text and fed to the SAME "a-b" parser, so
                        // a variable holding "2-4" works. Reference included even though the UI
                        // keeps this control literal-only: without it a hand-typed "range:@r" would
                        // drop through the unknown-modifier default and paste everything.
                        {
                            int next = StepModifier(parts, i, out var rangeRef);
                            if (next == i + 2)
                            {
                                var seg = parts[i + 1];
                                string argText = seg;
                                bool resolved = !rangeRef || TryResolveRefArg(seg, ctx, out argText);
                                if (resolved && TryParseSpan(argText, out var rangeFrom, out var rangeTo))
                                {
                                    var lines = SplitContentLines(result);
                                    int from = Math.Max(1, rangeFrom);
                                    int to = Math.Min(lines.Length, rangeTo);
                                    result = from <= to ? string.Join("\n", lines[(from - 1)..to]) : string.Empty;
                                }
                                // Only reachable for a reference: a literal only gets consumed when
                                // it already parsed as "a-b".
                                else result = string.Empty;
                            }
                            i = next;
                        }
                        break;
                    case "lines":
                        // lines:3,1,2 → pick lines by 1-based index in the given order
                        // (duplicates allowed — it's a reorder/pick, not a filter);
                        // invalid or out-of-range indices are skipped. The arg is only
                        // consumed when it actually contains a digit — same validating
                        // posture as line/word, so a typo'd "lines:upper" doesn't eat
                        // the next modifier.
                        // Same reference treatment as range, and for the same fail-closed reason.
                        {
                            int next = StepModifier(parts, i, out var linesRef);
                            if (next == i + 2)
                            {
                                var seg = parts[i + 1];
                                string argText = seg;
                                bool resolved = !linesRef || TryResolveRefArg(seg, ctx, out argText);
                                if (resolved && argText.AsSpan().IndexOfAnyInRange('0', '9') >= 0)
                                {
                                    var lines = SplitContentLines(result);
                                    var picked = new List<string>();
                                    foreach (var tok in argText.Split(','))
                                    {
                                        if (int.TryParse(tok, out var n) && n >= 1 && n <= lines.Length)
                                            picked.Add(lines[n - 1]);
                                    }
                                    result = string.Join("\n", picked);
                                }
                                // Only reachable for a reference — see range above.
                                else result = string.Empty;
                            }
                            i = next;
                        }
                        break;
                    case "reverse":
                        {
                            var lines = SplitContentLines(result);
                            Array.Reverse(lines);
                            result = string.Join("\n", lines);
                        }
                        i++;
                        break;
                    case "sort":
                        {
                            // Case-insensitive alphabetical — matches the app-wide
                            // case-insensitive matching convention.
                            var lines = SplitContentLines(result);
                            Array.Sort(lines, StringComparer.OrdinalIgnoreCase);
                            result = string.Join("\n", lines);
                        }
                        i++;
                        break;
                    case "dedupe":
                        {
                            // Keeps the FIRST occurrence of each line; case-insensitive.
                            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                            var kept = new List<string>();
                            foreach (var line in SplitContentLines(result))
                                if (seen.Add(line)) kept.Add(line);
                            result = string.Join("\n", kept);
                        }
                        i++;
                        break;
                    case "join":
                        // join:sep → collapse the lines into one with the separator.
                        // ALWAYS consumes exactly the next part ("join:" = empty separator)
                        // — the one modifier whose arg is freeform text, so unconditional
                        // consumption keeps the grammar unambiguous (a separator that
                        // happens to spell a modifier name is still a separator). A
                        // hand-typed trailing {clipboard:...:join} with no arg at all
                        // falls back to a single space.
                        {
                            string sep = i + 1 < parts.Length ? parts[i + 1] : " ";
                            result = string.Join(sep, SplitContentLines(result));
                        }
                        // Steps 2, landing safely past-the-end when there was no arg at all.
                        i = StepModifier(parts, i, out _);
                        break;

                    // ── Value shaping (2.37.0) ──────────────────────────────────────────────
                    case "replace":
                        // replace:FROM:TO → every occurrence of FROM becomes TO, case-insensitive
                        // like every other match here. TWO raw segments, ALWAYS consumed (the join
                        // rule, twice): an argument that spells a modifier name is still an
                        // argument, and a missing TO is the empty string, so "replace:x" deletes
                        // every x. Neither side can hold a colon — join's limit, for join's reason:
                        // an EMPTY TO is meaningful, so "::" cannot double as an escape here. An
                        // empty FROM has nothing to find and leaves the content untouched.
                        {
                            string from = i + 1 < parts.Length ? parts[i + 1] : string.Empty;
                            string to = i + 2 < parts.Length ? parts[i + 2] : string.Empty;
                            if (from.Length > 0)
                                result = result.Replace(from, to, StringComparison.OrdinalIgnoreCase);
                            i = StepModifier(parts, i, out _);
                        }
                        break;
                    case "count":
                        // The number of non-blank lines — "items", the way {clipboard:next} and
                        // Set Variable's Cycle count them. Runs on the value at THIS point of the
                        // chain, so "dedupe:count" counts distinct lines.
                        {
                            int n = 0;
                            foreach (var l in SplitContentLines(result))
                                if (!string.IsNullOrWhiteSpace(l)) n++;
                            result = n.ToString(System.Globalization.CultureInfo.InvariantCulture);
                        }
                        i++;
                        break;
                    case "pad":
                        // pad:N → left-pad with zeros to N characters ("7" → "007"); a value already
                        // that long is untouched. The int-argument shape of first/last: a literal or
                        // an "@name" reference, and a reference that fails resolves EMPTY (the
                        // fail-empty rule — a typo'd variable must not paste the bare value).
                        //
                        // pad is the one modifier whose COST is its argument: first/last can only
                        // shrink, pad allocates the width it is given. "{counter:pad:2000000000}"
                        // — a plausible slip of the hand — asked for a 4 GB string and ended the
                        // run with OutOfMemoryException from inside the Replace lambda. Above the
                        // ceiling it takes the same fail-empty exit the unreadable argument takes,
                        // rather than being silently clamped to a width the user did not ask for.
                        {
                            int next = StepModifier(parts, i, out _);
                            if (next == i + 2)
                            {
                                if (TryReadIntArg(parts[i + 1], ctx, 0, out var width, out _) && width <= MaxPadWidth)
                                    result = result.PadLeft(width, '0');
                                else result = string.Empty;
                            }
                            i = next;
                        }
                        break;
                    case "default":
                        // default:TEXT → TEXT when the value at this point is EMPTY, otherwise the
                        // value. The fallback the fail-empty doctrine needed: an unset variable, a
                        // missing delimiter or a line past the end pasted nothing, with nothing to
                        // say about it. RawSplit shape like the split family — "::" is a literal
                        // colon ("default:12::00"), free here because an empty TEXT is inert.
                        {
                            string text = ReadSplitDelimiter(parts, i, out int afterText);
                            if (result.Length == 0 && text.Length > 0) result = text;
                            i = afterText;
                        }
                        break;

                    default:
                        // Unknown modifier — skip it (forward-compat)
                        i++;
                        break;
                }
            }
            return result;
        }

        // Shared line split for the list modifiers — same CRLF normalization the
        // line:N modifier uses, kept as one helper so all list ops agree on it.
        private static string[] SplitContentLines(string content)
            => content.Replace("\r\n", "\n").Split('\n');

        // Parses the "a-b" argument of range:a-b and words:a-b (both 1-based ints; reversed
        // bounds swap, mirroring {random:a-b}'s forgiveness).
        //
        // Either side may be OMITTED for an open end: "6-" is "from 6 to the end", "-5" is
        // "from the start to 5". A bare "-" carries no bound at all and is not a span — it has
        // to stay rejected, or it would consume the following segment as an argument and shift
        // the meaning of every modifier after it.
        private static bool TryParseSpan(string s, out int from, out int to)
        {
            from = 0; to = 0;
            if (string.IsNullOrEmpty(s)) return false;
            int dash = s.IndexOf('-');
            if (dash < 0) return false;
            var left = s[..dash];
            var right = s[(dash + 1)..];
            if (left.Length == 0 && right.Length == 0) return false;
            if (left.Length == 0) from = 1;
            else if (!int.TryParse(left, out from)) return false;
            // int.MaxValue is safe as "no upper bound": every consumer clamps it with Math.Min
            // against the real item count before indexing.
            if (right.Length == 0) to = int.MaxValue;
            else if (!int.TryParse(right, out to)) return false;
            if (from > to) (from, to) = (to, from);
            return true;
        }

        // ONE definition of "what separates two words", used by word:N (which splits) and by
        // words:a-b (which scans for offsets). Two hand-written copies of this set would be a
        // rule that drifts — the same reason StepModifier is the single arity rule.
        private static readonly char[] WordSeparators = { ' ', '\t', '\n', '\r' };
        private static bool IsWordSeparator(char c) => Array.IndexOf(WordSeparators, c) >= 0;

        // The span of WORDS from..to, returned as a SUBSTRING of the original. Splitting into
        // words and re-joining with a single space would silently reformat the user's text —
        // runs of spaces, tabs and line breaks BETWEEN the kept words come back verbatim this
        // way. Offsets come from the original string, so the result can never split a surrogate
        // pair either (word boundaries are whitespace).
        private static string SliceWords(string content, int from, int to)
        {
            if (string.IsNullOrEmpty(content) || to < 1) return string.Empty;
            if (from < 1) from = 1;
            int start = -1, end = -1, index = 0, i = 0;
            while (i < content.Length)
            {
                while (i < content.Length && IsWordSeparator(content[i])) i++;
                if (i >= content.Length) break;
                int wordStart = i;
                while (i < content.Length && !IsWordSeparator(content[i])) i++;
                index++;
                if (index == from) start = wordStart;
                if (index <= to) end = i;          // past the last word, `end` keeps the final one
                if (index >= to) break;
            }
            // `from` past the last word leaves start < 0 — empty, the same answer word:99 gives.
            return start < 0 || end <= start ? string.Empty : content[start..end];
        }

        // Run-state carrier threaded into token resolution: the variable store plus the current
        // loop iteration and data-row index. RunCtx.Empty (the default) is what the static Test
        // Action path uses — there, stateful tokens resolve to empty/0. A later phase populates it
        // from _runtimeVariables + the live loop counter; today it is the seam only, so the unified
        // resolver stays behavior-identical to the pre-refactor scattered resolvers.
        public readonly struct RunCtx
        {
            public IReadOnlyDictionary<string, string>? Variables { get; init; }
            public int Iteration { get; init; }
            public int Row { get; init; }
            // {loop}: iteration of the innermost While / ForEachRow block (the run repeat outside one).
            public int Loop { get; init; }
            // {datarow}: 1-based data row of the current row context; 0 = none (resolves empty).
            public int DataRow { get; init; }
            // Data-loop current row: column name (lowercased) → cell value. Non-null only
            // while a "loop over data" run is stamping rows. {row:column} resolves from here.
            public IReadOnlyDictionary<string, string>? RowData { get; init; }
            // {rownext:column} data source + its run-local per-column cursor. DataTable is the whole
            // table (row lookup by index); RowNextCursors is a LIVE reference to the replayer's cursor
            // dict (mutated in place as tokens resolve). Both null on the static Test-Action path
            // (RunCtx.Empty) → {rownext} resolves empty, no advance.
            public Models.ProfileDataTable? DataTable { get; init; }
            public IDictionary<string, int>? RowNextCursors { get; init; }
            // {clipboard:next} cursor — a LIVE reference to the replayer's dict (mutated in place
            // as tokens resolve), keyed by a hash of the clipboard text so new content restarts the
            // walk. Null on the static Test-Action path (RunCtx.Empty), where {clipboard:next}
            // falls back to the FIRST line and never advances — a preview must not consume.
            public IDictionary<string, int>? ClipNextCursors { get; init; }
            // Clipboard slots (Copy to Slot / capture hotkey): slot name (lowercased) → captured
            // text. {clip:name} resolves from here. Null on the static Test-Action path → empty.
            public IReadOnlyDictionary<string, string>? ClipSlots { get; init; }
            // {input:Label} provider: (label, menu-options-or-null) → the value to substitute.
            // Null on the static Test-Action path (RunCtx.Empty) — there {input} resolves empty.
            // On the live path it pauses replay and prompts the user (ProvideInputAsync).
            public Func<string, string[]?, Task<string>>? InputProvider { get; init; }
            public static RunCtx Empty => default;
        }

        // Live run context handed to token resolution on the replay-instance path. The static
        // Test-Action path never sees this — it resolves against RunCtx.Empty instead.
        private RunCtx CurrentRunCtx => new()
        {
            Variables = _runtimeVariables,
            Iteration = _currentIteration,
            Row = _currentActionRow,
            Loop = _currentLoopIteration,
            DataRow = _currentDataRow,
            RowData = _currentRowData,
            DataTable = _dataTable,
            RowNextCursors = _rowNextCursors,
            ClipNextCursors = _clipNextCursors,
            // Snapshot, not the live dict — the capture hotkey mutates _clipSlots on the UI
            // thread and a TryGetValue racing a resize is undefined. Slots are tiny (≤ a few
            // entries), so a copy per resolution is noise. _runtimeVariables needs no copy:
            // it is only ever written on the replay thread that is also doing the resolving.
            ClipSlots = SnapshotClipSlots(),
            InputProvider = ProvideInputAsync,
        };

        private IReadOnlyDictionary<string, string> SnapshotClipSlots()
        {
            lock (_runStateLock) return new Dictionary<string, string>(_clipSlots);
        }

        // Variable names: letters/digits/underscore, matched case-insensitively (stored keys are
        // lowercased). Same shape as the {var:name} token regex below — keep the two in sync.
        private static readonly Regex VariableNameRegex = new(@"^[A-Za-z0-9_]+$", RegexOptions.Compiled);

        // Cycle-mode cursors live in RunCursorService, keyed by executing-profile-name +
        // ActionItem.Id. Deliberately NOT cleared in StartAsync — surviving across runs is the
        // feature: each hotkey press walks the list one item further — and they now survive an
        // APP RESTART too (the sidecar), so closing the app no longer silently restarts every
        // list at item 1. The profile-name half of the key matters: Profile Duplicate is a raw
        // File.Copy and import keeps envelope Actions verbatim, so the SAME action Id can exist
        // in several profiles — Id alone would make copies share (and fight over) one cursor.
        // Row-level copies are covered the other way: Clone() gives duplicated rows a fresh Id.
        // A profile RENAME now carries its cursors across (RunCursorService.RenameProfile);
        // deleted rows strand a dead int until the profile itself goes (then Prune sweeps it).

        // SetVariable action: resolve the value's tokens against the live run state, then write
        // (or, for an empty resolved value, delete) the entry. Pure state mutation — no input
        // simulation, no extra delay beyond the row's own Delay.
        //
        // Cycle mode (VariableMode == "cycle"): the RESOLVED value is treated as a list
        // (one item per line, blank lines dropped) and each execution stores the NEXT
        // line, wrapping around. Resolution happens before the split on purpose — a
        // value of just {clipboard} cycles through the clipboard's lines. The modulo
        // keeps an old cursor valid when the list shrinks between presses.
        //
        // Add mode (VariableMode == "add"): the RESOLVED value is a number added to the variable's
        // current value, an unset or non-numeric current counting as 0 (so a first "add 1" yields
        // 1) and a negative step subtracting. A non-numeric step leaves the variable untouched and
        // logs — a typo must never overwrite a counter. This is the "i = i + 1" a While needs; the
        // arithmetic lives in TryAddVariable so it can be proven without a replayer.
        private async Task ExecuteSetVariable(ActionItem action, CancellationToken token = default)
        {
            var name = action.Key?.Trim();
            if (string.IsNullOrEmpty(name) || !VariableNameRegex.IsMatch(name))
            {
                // Unusable name — no-op, same forgiveness as an unknown clipboard modifier. Said in
                // the log: the step otherwise reads as having run, and nothing else tells a user why
                // {var:…} came out literal further down. The Sheet filters new names to this charset.
                if (!string.IsNullOrEmpty(name))
                    Services.DiagnosticLog.Warn($"Set Variable '{name}': not a usable name (letters, digits and _ only) — skipped");
                return;
            }
            var key = name.ToLowerInvariant();

            if (string.Equals(action.VariableMode, "screen", StringComparison.OrdinalIgnoreCase))
            {
                await ExecuteSetVariableFromScreen(action, name, key, token);
                return;
            }

            // escapeBracesInSubstitution:false — the dict stores raw text, braces and all. The
            // resolver escapes them only while it runs (so a clipboard holding "{counter}" is
            // stored as those nine characters, never as the count), and the escaping the SendText
            // segment parser needs happens later, at {var} substitution time on that path.
            var value = await ResolveTokens(action.VariableValue ?? string.Empty);

            if (string.Equals(action.VariableMode, "cycle", StringComparison.OrdinalIgnoreCase))
            {
                var items = value.Replace("\r\n", "\n").Split('\n')
                    .Where(l => !string.IsNullOrWhiteSpace(l))
                    .ToArray();
                if (items.Length == 0)
                {
                    lock (_runStateLock) _runtimeVariables.Remove(key); // empty list = delete (same contract as set mode)
                    PushVariablesSnapshot(force: true);
                    return;
                }
                var idPart = string.IsNullOrEmpty(action.Id) ? key : action.Id; // Id always set in practice
                var cursorKey = CurrentExecutingProfileName + "|" + idPart;
                RunCursorService.TryGetCycle(cursorKey, out int cursor);
                lock (_runStateLock) _runtimeVariables[key] = items[((cursor % items.Length) + items.Length) % items.Length];
                RunCursorService.SetCycle(cursorKey, (cursor + 1) % items.Length);
                PushVariablesSnapshot(force: true);
                return;
            }

            if (string.Equals(action.VariableMode, "add", StringComparison.OrdinalIgnoreCase))
            {
                string? current;
                lock (_runStateLock) _runtimeVariables.TryGetValue(key, out current);
                if (!TryAddVariable(current, value, out var sum))
                {
                    Services.DiagnosticLog.Info($"Set Variable '{name}' (add): \"{value}\" could not be added — not a number, or the sum leaves the numeric range — variable left unchanged");
                    return;
                }
                lock (_runStateLock) _runtimeVariables[key] = sum;
                PushVariablesSnapshot(force: true);
                return;
            }

            if (string.IsNullOrEmpty(value))
                lock (_runStateLock) _runtimeVariables.Remove(key);   // empty value = delete (documented contract)
            else
                lock (_runStateLock) _runtimeVariables[key] = value;
            PushVariablesSnapshot(force: true);
        }

        /// <summary>
        /// Set Variable's add mode, as arithmetic on the text store: current + delta as decimals.
        /// Invariant culture with ',' accepted as the decimal separator (the owner's locale writes
        /// "1,5"; a thousands separator is not a thing in a counter or a step). A missing or
        /// non-numeric current value counts as 0, so a first "add 1" yields 1; a non-numeric delta
        /// — or a sum that would leave decimal's range — refuses (false) so a typo never
        /// overwrites a counter and never ends the run. Integers stay integers ("3", never
        /// "3.0") and scale is trimmed ("2.50" + 0 = "2.5"): the store is text, and {var:i} feeds
        /// conditions, file names and regexes that compare it as such.
        /// </summary>
        internal static bool TryAddVariable(string? current, string delta, out string result)
        {
            result = current ?? string.Empty;
            if (!TryParseNumber(delta, out var d)) return false;
            var c = TryParseNumber(current, out var cv) ? cv : 0m;
            // decimal addition is checked and THROWS on overflow, which would have escaped this
            // method — past ExecuteSetVariable, into the per-action catch — and ended the run with
            // "Value was either too large or too small for a Decimal". TryParseNumber accepts an
            // exponent (NumberStyles.Float), so "7e28" parses fine and two of them overflow. The
            // range test keeps the method total, as the doc above promises, and it cannot overflow
            // itself: MaxValue - d with d > 0 (and MinValue - d with d < 0) always fits.
            if ((d > 0m && c > decimal.MaxValue - d) || (d < 0m && c < decimal.MinValue - d)) return false;
            result = (c + d).ToString("0.############################", System.Globalization.CultureInfo.InvariantCulture);
            return true;
        }

        private static bool TryParseNumber(string? s, out decimal n)
        {
            n = 0m;
            if (string.IsNullOrWhiteSpace(s)) return false;
            var t = s.Trim();
            if (t.IndexOf('.') < 0) t = t.Replace(',', '.');
            return decimal.TryParse(t, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out n);
        }

        // {input:Label} provider handed to the resolver via RunCtx. Ask-once-per-Label-per-run:
        // the answer is stored in _runtimeVariables (so a later {var:Label} reuses it, and the rich
        // SendText's double resolve — plain pass then html pass — prompts only once). Cancelling the
        // prompt (or a Stop mid-prompt) aborts the run, mirroring the Stop hotkey.
        private async Task<string> ProvideInputAsync(string label, string[]? menu)
        {
            var trimmed = (label ?? string.Empty).Trim();
            var key = trimmed.ToLowerInvariant();
            if (key.Length > 0 && _runtimeVariables.TryGetValue(key, out var cached))
                return cached; // already answered (or pre-set by a same-named SetVariable) — reuse
            var token = _cts?.Token ?? CancellationToken.None;
            var answer = await RequestInputAsync(trimmed, menu, token);
            if (answer == null)
            {
                // User cancelled the prompt → abort the run, same clean stop as the Stop hotkey.
                try { _cts?.Cancel(); } catch (ObjectDisposedException) { }
                token.ThrowIfCancellationRequested();
                throw new OperationCanceledException();
            }
            if (key.Length > 0)
            {
                lock (_runStateLock) _runtimeVariables[key] = answer;
                PushVariablesSnapshot(force: true);
            }
            return answer;
        }

        // Pauses replay, raises the Ask-Input modal on the host, and awaits the answer. Returns the
        // entered/selected string, or null if the user cancelled (or replay was stopped mid-prompt).
        // Mirrors ExecutePause's TCS-park-on-dispatcher shape but returns a value.
        // Set when the Ask-Input modal actually opened and waited on the user; consumed by the
        // deadline scheduler after each row, If arm and While guard. Type and row say nothing about
        // it — any token-bearing field can ask ({input:} in a SetVariable value, a Keystroke key,
        // an If operand) — so the wait itself says so.
        private volatile bool _waitedOnUser;

        private bool ConsumeWaitedOnUser()
        {
            bool waited = _waitedOnUser;
            _waitedOnUser = false;
            return waited;
        }

        private async Task<string?> RequestInputAsync(string label, string[]? menu, CancellationToken token)
        {
            var requestId = Guid.NewGuid().ToString("N")[..8];
            var tcs = new TaskCompletionSource<string?>(TaskCreationOptions.RunContinuationsAsynchronously);
            _pendingInputs[requestId] = tcs;
            // Remember who had focus BEFORE the prompt surfaces the TrueReplayer window
            // (OnInputRequested brings the app forward so the modal is visible). After a real answer
            // we hand focus back, so the replay's resolved text lands where the user was pointing
            // (Notepad/Chrome) instead of typing into TrueReplayer itself.
            IntPtr prevForeground = NativeMethods.GetForegroundWindow();
            dispatcherQueue.TryEnqueue(() => OnInputRequested?.Invoke(requestId, label, menu));
            _waitedOnUser = true;
            using var timeoutCts = new CancellationTokenSource(InputTimeoutMs);
            try
            {
                // Resolve as cancel (null) — the caller then aborts the run — on either a Stop mid-prompt
                // (token) or the no-response timeout (timeoutCts), so the engine is never held forever.
                using (token.Register(() => tcs.TrySetResult(null)))
                using (timeoutCts.Token.Register(() =>
                {
                    if (tcs.TrySetResult(null))
                        DiagnosticLog.Info($"Ask-Input '{label}': no response after {InputTimeoutMs / 1000}s — run aborted");
                }))
                {
                    var answer = await tcs.Task;
                    // Hand focus back before returning — on a real submit so the resolved text lands on
                    // the target, and on a modal Cancel so the user's window isn't left buried behind TR.
                    // A hard Stop cancels the token, so ActivateAsync short-circuits and skips the poll.
                    await RestoreForegroundAfterInputAsync(prevForeground, token);
                    return answer;
                }
            }
            finally
            {
                _pendingInputs.TryRemove(requestId, out _);
                dispatcherQueue.TryEnqueue(() => OnInputDismissed?.Invoke(requestId));
            }
        }

        // Hand foreground back after an Ask-Input prompt (which surfaced the TrueReplayer window):
        // prefer the profile's explicit target (customer-service flows type into Chrome/Crisp), else
        // the window that was focused when the prompt appeared (the simple no-target flow → Notepad).
        // Best-effort — a refused switch never breaks the run. ActivateAsync no-ops when the chosen
        // window is already foreground, so this is cheap when nothing needs restoring.
        private async Task RestoreForegroundAfterInputAsync(IntPtr prevForeground, CancellationToken token)
        {
            try
            {
                if (_bringToFocus && _windowTarget != null)
                {
                    var targetHwnd = FindTargetWindow();
                    if (targetHwnd != IntPtr.Zero)
                    {
                        await Helpers.WindowActivation.ActivateAsync(targetHwnd, _windowTarget, _windowTargetTitleRegex, token);
                        return;
                    }
                }
                if (prevForeground != IntPtr.Zero)
                    await Helpers.WindowActivation.ActivateAsync(prevForeground, token: token);
            }
            catch { /* focus restore is best-effort (also swallows the token's OCE on a hard Stop) */ }
        }

        // Called by the host when the Ask-Input modal is submitted or cancelled. Completes the
        // pending await: a cancel resolves to null (→ the run aborts); a submit resolves the value.
        public void CompleteInput(string requestId, string? value, bool cancelled)
        {
            if (_pendingInputs.TryRemove(requestId, out var tcs))
                tcs.TrySetResult(cancelled ? null : (value ?? string.Empty));
        }

        // Copy to Slot action: capture the CURRENT SELECTION of the focused app (synthetic
        // Ctrl+C) into the named clipboard slot, then restore the user's real clipboard.
        // Slot name lives in Key (SetVariable's Key-reuse convention); read back via
        // {clip:name}. A failed capture (no selection / slow target) leaves the slot
        // UNCHANGED — a transient focus hiccup must not wipe a good capture.
        private async Task ExecuteCopyToSlot(ActionItem action, CancellationToken token)
        {
            var name = action.Key?.Trim();

            // Clear mode: empty a slot instead of capturing. A blank name wipes ALL slots
            // (1..9) and resets the capture hotkey's cursor to slot 1 — the "start over" the
            // sequential hotkey otherwise can't do. Nothing is typed/pasted. No capture, so
            // no selection is needed and it never touches the clipboard.
            if (string.Equals(action.SlotMode, "clear", StringComparison.OrdinalIgnoreCase))
            {
                if (string.IsNullOrEmpty(name))
                {
                    lock (_runStateLock)
                    {
                        _clipSlots.Clear();
                        _nextHotkeySlot = 1;   // under the lock — see CaptureSelectionToNextSlotAsync
                    }
                }
                else if (VariableNameRegex.IsMatch(name))
                {
                    lock (_runStateLock) _clipSlots.Remove(name.ToLowerInvariant());
                }
                else
                {
                    Services.DiagnosticLog.Warn($"Copy to Slot (clear) '{name}': not a usable slot name (letters, digits and _ only) — skipped");
                    return; // unusable slot name — no-op
                }
                PushVariablesSnapshot(force: true);
                return;
            }

            if (string.IsNullOrEmpty(name) || !VariableNameRegex.IsMatch(name))
            {
                // Same forgiveness as SetVariable, and the same line in the log.
                if (!string.IsNullOrEmpty(name))
                    Services.DiagnosticLog.Warn($"Copy to Slot '{name}': not a usable slot name (letters, digits and _ only) — skipped");
                return;
            }
            var key = name.ToLowerInvariant();
            var captured = await CaptureSelectionTextAsync(token);
            if (captured == null)
            {
                Services.DiagnosticLog.Info($"Copy to Slot '{name}': nothing copied (empty selection?) — slot left unchanged");
                return;
            }
            lock (_runStateLock) _clipSlots[key] = captured;
            PushVariablesSnapshot(force: true);
        }

        // 1 while a selection capture is in flight — a second capture (double-tapped hotkey,
        // or hotkey overlapping a CopyToSlot action) interleaving its snapshot/clear/restore
        // with the first would store the OLD clipboard as the "selection" and then wipe the
        // clipboard. Overlappers bail out with null instead.
        private int _captureBusy;

        // The selection-capture primitive shared by the Copy to Slot action and the global
        // capture hotkey: snapshot the real clipboard → clear it (the "did a copy happen"
        // detector) → synthetic Ctrl+C → poll for the copied text → restore the snapshot.
        // Injected keys carry LLKHF_INJECTED so the hook can't re-trigger anything. Returns
        // null when nothing arrived (empty selection, or a target that doesn't copy text).
        private async Task<string?> CaptureSelectionTextAsync(CancellationToken token)
        {
            if (System.Threading.Interlocked.CompareExchange(ref _captureBusy, 1, 0) != 0)
            {
                Services.DiagnosticLog.Info("Capture to Slot: a capture is already in flight — ignored");
                return null;
            }
            (string? Text, string? Html) original;
            try { original = await ReadClipboardSnapshotAsync(dispatcherQueue, includeHtml: true, token); }
            catch
            {
                // A Stop during the read: nothing was cleared yet, so there is nothing to restore —
                // but the in-flight flag has to come down, or every later capture bails as "busy".
                System.Threading.Interlocked.Exchange(ref _captureBusy, 0);
                throw;
            }
            // Text-bearing clipboards get the clear-then-poll change detector (and a faithful
            // restore at the end). A NON-text clipboard (files, image — the snapshot can't
            // carry those) is left untouched instead: any text APPEARING is the copy, and
            // skipping the pre-clear means a no-op copy (empty selection) can't destroy the
            // files/image the user had copied. A successful capture still replaces the
            // clipboard system-wide — that's Ctrl+C itself, not something we can restore.
            bool hadTextual = original.Text != null || original.Html != null;
            try
            {
                if (hadTextual)
                {
                    RestoreOriginalClipboard((null, null)); // (null, null) = Clipboard.Clear()
                    await Task.Delay(30, token);
                }
                // A physically held hotkey modifier (e.g. the Shift of Ctrl+Shift+9) would turn
                // the injected Ctrl+C into Ctrl+Shift+C for the target — release first, same as
                // replay start does before its first synthetic input.
                // A modifier the MACRO holds (a KeyDown whose KeyUp has not run) is released by the
                // same sweep and has to come back after the copy — released for good, a Shift held for
                // a multi-selection turned every later click into a plain one. Releasing it first is
                // still right: held, it would make the copy Ctrl+Shift+C.
                var macroHeld = ModifiersHeldByEngine();
                ReleasePhysicallyHeldModifiers();
                SimulateKeystroke("Ctrl+C", token);
                foreach (var m in macroHeld) SimulateKey(m, true);
                for (int i = 0; i < 15; i++) // up to ~750 ms — slow targets render the copy late
                {
                    await Task.Delay(50, token);
                    var text = await ReadClipboardTextAsync(dispatcherQueue, token);
                    if (!string.IsNullOrEmpty(text)) return text;
                }
                return null;
            }
            finally
            {
                if (hadTextual) RestoreOriginalClipboard(original);
                System.Threading.Interlocked.Exchange(ref _captureBusy, 0);
            }
        }

        // Capture the current selection into the NEXT sequential slot (1..9, wrapping) — the
        // global capture hotkey's entry, called by the host on its dispatcher. Returns the slot
        // name and the captured text (null = nothing copied; the cursor does not advance then).
        public async Task<(string Slot, string? Value)> CaptureSelectionToNextSlotAsync()
        {
            // The slot is chosen AFTER the capture, under the lock the slots live under. Read before
            // the await (the copy polls for up to ~750 ms), a Copy to Slot "clear all" landing in
            // between was undone: the capture refilled a slot just cleared and moved the cursor
            // past the reset to 1.
            var captured = await CaptureSelectionTextAsync(CancellationToken.None);
            string slot;
            lock (_runStateLock)
            {
                slot = _nextHotkeySlot.ToString();
                if (captured != null)
                {
                    _clipSlots[slot] = captured;
                    _nextHotkeySlot = _nextHotkeySlot >= 9 ? 1 : _nextHotkeySlot + 1;
                }
            }
            if (captured != null) PushVariablesSnapshot(force: true);
            return (slot, captured);
        }

        // Live-variables pane feed: copy the mutable dictionaries (they change on the replay
        // thread) and raise OnVariablesChanged on the dispatcher. Forced pushes are for rare,
        // user-meaningful writes; unforced (per-iteration) pushes ride a ~4 Hz throttle so a
        // tight infinite loop doesn't flood the bridge.
        public void PushVariablesSnapshot(bool force = false)
        {
            if (OnVariablesChanged == null) return;
            var now = Environment.TickCount64;
            if (!force && now - _lastVariablesPushTick < 250) return;
            _lastVariablesPushTick = now;
            Dictionary<string, string> vars, slots;
            lock (_runStateLock)
            {
                vars = new Dictionary<string, string>(_runtimeVariables);
                slots = new Dictionary<string, string>(_clipSlots);
            }
            var row = _currentRowData != null ? new Dictionary<string, string>(_currentRowData) : null;
            dispatcherQueue.TryEnqueue(() => OnVariablesChanged?.Invoke(vars, slots, row));
        }

        // Instance entry to the unified resolver. The SendText/paste path passes the saved clipboard
        // backup and asks for the brace SENTINELS back (escapeBracesInSubstitution: true) so
        // ParseSendTextSegments sees substituted braces as text; every other caller takes the
        // default and gets real braces back — see the note inside ResolveTokensAsync.
        private Task<string> ResolveTokens(string text, string? clipboardOverride = null, bool escapeBracesInSubstitution = false, TokenFlavorSync? flavorSync = null)
            => ResolveTokensAsync(text, dispatcherQueue, CurrentRunCtx, clipboardOverride, escapeBracesInSubstitution, htmlEncodeSubstitution: false, flavorSync);

        /// <summary>
        /// Replaces every {clipboard[:mods]} token in <paramref name="text"/> with the
        /// clipboard content transformed by the given modifiers. Reads the clipboard only once.
        /// If <paramref name="clipboardOverride"/> is non-null it is used instead of reading the OS clipboard.
        /// When <paramref name="escapeBracesInSubstitution"/> is true, '{' / '}' in substituted
        /// values are replaced with sentinels so ParseSendTextSegments does not re-interpret them
        /// as another placeholder — used for the Win32 SendText path.
        /// </summary>
        /// <summary>
        /// Reads the clipboard's TEXT content on the UI dispatcher (clipboard access requires
        /// it). Returns null when the clipboard holds no text, the read fails, or the queue is
        /// shutting down. Shared by token resolution, the SendText backup snapshot, and the
        /// If-Clipboard probe so the TCS/TryEnqueue dance lives in exactly one place.
        /// </summary>
        /// <summary>
        /// Snapshots the clipboard's text AND HTML flavors for the SendText backup/restore
        /// round-trip. The HTML string is the raw CF_HTML format payload (header included),
        /// so restoring it via SetHtmlFormat is byte-symmetric. Either flavor is null when
        /// absent or unreadable; both null = clipboard held something else entirely (image,
        /// files) — restore then clears, same as the old text-only behavior.
        /// </summary>
        // The read runs on the UI thread and waits on the clipboard's OWNER, which renders a
        // delayed format on request (Excel does) — a busy or hung owner holds it. The caller's
        // token lets a Stop abandon that wait: it used to be uncancellable, so the run sat on it
        // past the Stop. Deliberately NO timeout: a read given up early reads as an empty
        // clipboard, which types an empty {clipboard} and, for the SendText backup, turns the
        // restore into a Clear() of what the user had copied.
        internal static async Task<(string? Text, string? Html)> ReadClipboardSnapshotAsync(DispatcherQueue dispatcherQueue, bool includeHtml = true, CancellationToken token = default)
        {
            var tcsSnap = new TaskCompletionSource<(string?, string?)>();
            if (!dispatcherQueue.TryEnqueue(async () =>
            {
                string? text = null, htmlFormat = null;
                try
                {
                    var content = Windows.ApplicationModel.DataTransfer.Clipboard.GetContent();
                    if (content.Contains(Windows.ApplicationModel.DataTransfer.StandardDataFormats.Text))
                    {
                        try { text = await content.GetTextAsync(); } catch { }
                    }
                    // Materializing CF_HTML forces delayed-render owners (Excel) to produce it —
                    // skip unless the caller will actually overwrite the HTML flavor.
                    if (includeHtml && content.Contains(Windows.ApplicationModel.DataTransfer.StandardDataFormats.Html))
                    {
                        try { htmlFormat = await content.GetHtmlFormatAsync(); } catch { }
                    }
                }
                catch { }
                tcsSnap.TrySetResult((text, htmlFormat));
            }))
            {
                tcsSnap.TrySetResult((null, null));
            }
            using (token.Register(() => tcsSnap.TrySetCanceled(token)))
                return await tcsSnap.Task;
        }

        // Same wait as ReadClipboardSnapshotAsync, same token and no-timeout rule. Every
        // completion is a Try*: after a Stop has cancelled the TCS, the read finishing late on
        // the UI thread must not throw there.
        internal static async Task<string?> ReadClipboardTextAsync(DispatcherQueue dispatcherQueue, CancellationToken token = default)
        {
            var tcsClip = new TaskCompletionSource<string?>();
            if (!dispatcherQueue.TryEnqueue(async () =>
            {
                try
                {
                    var content = Windows.ApplicationModel.DataTransfer.Clipboard.GetContent();
                    if (content.Contains(Windows.ApplicationModel.DataTransfer.StandardDataFormats.Text))
                    {
                        var clipText = await content.GetTextAsync();
                        tcsClip.TrySetResult(clipText);
                    }
                    else tcsClip.TrySetResult(null);
                }
                catch { tcsClip.TrySetResult(null); }
            }))
            {
                // Queue shut down (app closing) — unblock the awaiter with "no clipboard".
                tcsClip.TrySetResult(null);
            }
            using (token.Register(() => tcsClip.TrySetCanceled(token)))
                return await tcsClip.Task;
        }

        // Reads the Windows clipboard HISTORY (Win+V) as a recency-ordered list of text values —
        // element 0 = most recent. The WinRT Items order is NOT documented, so we sort by Timestamp
        // DESCENDING (a stable OrderBy) rather than trust the raw order. Each element is the item's
        // text, or null when that item carries no text (image / other format). Returns null when
        // history is disabled/denied or the call throws — the resolver treats a null list and a null
        // element alike as empty, and never throws. Marshaled to the UI thread like
        // ReadClipboardTextAsync (the WinRT clipboard APIs want the UI thread; a background-daemon
        // call may legitimately fail here, which surfaces as "history unavailable" = empty).
        internal static async Task<IReadOnlyList<string?>?> ReadClipboardHistoryTextsAsync(DispatcherQueue dispatcherQueue)
        {
            var tcs = new TaskCompletionSource<IReadOnlyList<string?>?>();
            if (!dispatcherQueue.TryEnqueue(async () =>
            {
                try
                {
                    var result = await Windows.ApplicationModel.DataTransfer.Clipboard.GetHistoryItemsAsync();
                    if (result.Status != Windows.ApplicationModel.DataTransfer.ClipboardHistoryItemsResultStatus.Success)
                    {
                        tcs.SetResult(null); // disabled / access denied — treat as empty
                        return;
                    }
                    var texts = new List<string?>(result.Items.Count);
                    foreach (var item in result.Items.OrderByDescending(i => i.Timestamp))
                    {
                        try
                        {
                            texts.Add(item.Content.Contains(Windows.ApplicationModel.DataTransfer.StandardDataFormats.Text)
                                ? await item.Content.GetTextAsync()
                                : null); // non-text item (image/other) — placeholder so indices still align
                        }
                        catch { texts.Add(null); } // one unreadable item must not sink the whole read
                    }
                    tcs.SetResult(texts);
                }
                catch { tcs.SetResult(null); }
            }))
            {
                tcs.TrySetResult(null); // queue shut down (app closing)
            }
            return await tcs.Task;
        }

        // HTML-flavor substitution guard: a resolved clipboard/var/row value containing '<' or
        // '&' must paste as visible TEXT inside the rich payload, never inject markup; newlines
        // in the value become <br> so multi-line values still render (the CRLF normalization is
        // plain-flavor-only). Dates/counters resolve to digits/punctuation and skip this.
        internal static string HtmlEncodeValue(string value)
            => System.Net.WebUtility.HtmlEncode(value).Replace("\r\n", "\n").Replace("\n", "<br>");

        internal static async Task<string> ResolveClipboardTokensAsync(string text, DispatcherQueue dispatcherQueue, string? clipboardOverride = null, bool escapeBracesInSubstitution = false, bool htmlEncodeSubstitution = false, RunCtx runCtx = default, TokenFlavorSync? sync = null)
        {
            if (string.IsNullOrEmpty(text)) return text;
            if (!ClipboardTokenRegex.IsMatch(text)) return text;

            string? clipContent = clipboardOverride != null
                ? clipboardOverride
                : await ReadClipboardTextAsync(dispatcherQueue);

            var raw = clipContent ?? string.Empty;
            return ClipboardTokenRegex.Replace(text, m =>
            {
                var mods = m.Groups[1].Success ? m.Groups[1].Value : null;
                string resolved;
                // {clipboard:next} — sequential line consumption. Handled HERE rather than inside
                // ApplyClipboardModifiers because it is the only STATEFUL modifier: that method is
                // static and shared verbatim by {row:col:mods} and {rownext:col:mods}, which have
                // no cursor of their own here and must keep resolving identically.
                // ({clip:name} DOES reach the applier now — it gained a chain — but never through
                // here: 'next' is stateful and clipboard-only, and the slot heads resolve in
                // ResolveRunStateTokens, which calls ApplyClipboardModifiers directly.)
                if (TrySplitNextModifier(mods, out var restMods))
                {
                    if (sync?.ClipNextReplay is { Count: > 0 } replay)
                    {
                        // html pass of the rich SendText double-resolve — reuse the plain pass's
                        // line; the cursor already advanced there, and advancing twice would make
                        // one paste eat two lines.
                        resolved = replay.Dequeue();
                    }
                    else
                    {
                        resolved = TakeNextClipboardLine(raw, runCtx.ClipNextCursors);
                        resolved = ApplyClipboardModifiers(resolved, restMods, runCtx);
                        sync?.ClipNextRecord?.Add(resolved);
                    }
                }
                else
                {
                    resolved = ApplyClipboardModifiers(raw, mods, runCtx);
                }
                if (htmlEncodeSubstitution) resolved = HtmlEncodeValue(resolved);
                return escapeBracesInSubstitution ? EscapeBracesForParser(resolved) : resolved;
            });
        }

        // Pulls a bare "next" segment out of a {clipboard:...} modifier chain, returning the
        // remaining chain in <paramref name="rest"/>. Extracted from ANY position rather than only
        // the first: "next" always applies first (pick the line, then transform it), so honouring it
        // only in front would make "{clipboard:trim:next}" a silent no-op — ApplyClipboardModifiers
        // ignores unknown modifiers by design, so the user would get the whole clipboard with no
        // hint anything was wrong.
        //
        // The walk MIRRORS ApplyClipboardModifiers' own stepping so a segment that is an ARGUMENT
        // is never mistaken for the modifier. That is not hypothetical: "join" always consumes the
        // next segment as its separator, and the separator inputs only strip '{', '}' and ':' — so
        // a user can legitimately build {clipboard:join:next} ("glue the lines with the word next").
        // A naive scan would eat that separator and turn a join into a line-pop.
        // internal, not private: ProfileCompatibility asks THIS method whether a token is
        // sequential instead of re-implementing the walk in a regex. A hand-written mirror of an
        // execution walk drifts — a lookbehind that only checks one segment back disagrees with
        // the real walk on chains like {clipboard:join:join:next}, and a pin that under-fires
        // ships the exact silent divergence the pin exists to prevent. One source of truth.
        internal static bool TrySplitNextModifier(string? modifierChain, out string? rest)
        {
            rest = modifierChain;
            if (string.IsNullOrEmpty(modifierChain)) return false;
            if (modifierChain.IndexOf("next", StringComparison.OrdinalIgnoreCase) < 0) return false;

            var parts = modifierChain.Split(':');
            int found = -1;
            for (int i = 0; i < parts.Length; )
            {
                // A segment only counts as `next` when the walk LANDS on it as a modifier —
                // "join:next" glues the lines with the word "next" and must not pop a line.
                // StepModifier owns that decision so this walk cannot drift from the applier;
                // it used to re-state the gates here, and a transcribed rule is a rule that
                // eventually diverges.
                if (found < 0 && string.Equals(parts[i], "next", StringComparison.OrdinalIgnoreCase))
                    found = i;
                i = StepModifier(parts, i, out _);
            }
            if (found < 0) return false;

            // Rebuild EXACTLY as before — drop the one index, re-join with ':'. Tempting as it is
            // to also drop the inert empty segments the walk landed on (removing `next` can leave
            // one beside a split delimiter, where it now reads as a "::" seam), doing so is NOT
            // behaviour-neutral: an empty segment is also what STOPS the modifier before it from
            // eating its neighbour as an argument. Dropping them turned "words::1-2" — inert in
            // every shipped version, because "" is not a span — into a live "words:1-2".
            //
            // The re-join CAN therefore change a chain's meaning between 2.22.0 and 2.23.0. That
            // is handled where it belongs, in the pin: ChainUsesEscapedColon asks this method for
            // the post-`next` chain and inspects that too, so such a profile is blocked on import
            // by an older build instead of quietly resolving to something else.
            var kept = new List<string>(parts.Length - 1);
            for (int i = 0; i < parts.Length; i++) if (i != found) kept.Add(parts[i]);
            rest = kept.Count > 0 ? string.Join(":", kept) : null;
            return true;
        }

        // Reads the line the cursor is on and advances it. Blank lines are dropped (a trailing
        // newline is near-universal in copied text and would otherwise waste a press on an empty
        // value) — same rule SetVariable's Cycle mode uses on its list. Past the last line resolves
        // EMPTY and does not wrap, matching {rownext:column}: an empty result is how a macro can
        // tell the list is finished, which wrapping would hide forever.
        // A null cursor dict = the static Test-Action path: return line 1 WITHOUT advancing, so a
        // preview never consumes the user's list.
        private static string TakeNextClipboardLine(string raw, IDictionary<string, int>? cursors)
        {
            var lines = SplitContentLines(raw);
            var items = new List<string>(lines.Length);
            foreach (var l in lines) if (!string.IsNullOrWhiteSpace(l)) items.Add(l);
            if (items.Count == 0) return string.Empty;
            if (cursors == null) return items[0];

            // Content-keyed, single-entry: a different clipboard drops the old key and restarts.
            string key = ClipboardContentKey(raw);
            if (!cursors.TryGetValue(key, out int cur))
            {
                cursors.Clear();
                cur = 0;
            }
            cursors[key] = cur + 1;
            return cur < items.Count ? items[cur] : string.Empty;
        }

        // Stable, cheap identity for "is this the same clipboard as last time". Content hash, not
        // the content itself, so a megabyte paste doesn't sit in the dictionary for the session.
        private static string ClipboardContentKey(string raw)
        {
            var bytes = System.Text.Encoding.UTF8.GetBytes(raw);
            return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes));
        }

        // Matches {winclip:N} — a 1-based index into the WINDOWS clipboard history (Win+V),
        // most-recent first ({winclip:1} = the last thing copied). The index is OPTIONAL: a bare
        // {winclip} means index 1, matching the editor chip (which defaults to 1) so a hand-typed
        // {winclip} resolves instead of pasting literally. Deliberately DISJOINT from {clip:name}
        // (in-app capture slots) and {clipboard} (the live OS clipboard). IgnoreCase like the others.
        // {winclip} / {winclip:N} / {winclip:N:mods} / {winclip:mods}. Unambiguous because the
        // index group is DIGITS ONLY: "{winclip:trim}" cannot match it, so `trim` falls through to
        // the chain group and the index stays at its default of 1. (Before the chain existed,
        // "{winclip:trim}" matched nothing at all and was typed out literally.)
        // A chain may not START with a digit. Without that guard the optional index BACKTRACKS
        // away whenever the chain group cannot match after it, and the token still resolves:
        // "{winclip:2-4}" and "{winclip:2:}" came out as index 1 with an inert chain, pasting the
        // most recent clipboard item. In 2.19.1 both matched nothing and were typed out literally.
        // Silently pasting the wrong item is a worse failure than visibly pasting the token text,
        // because it looks like it worked — so a malformed index stays literal, as it was.
        // No real modifier name begins with a digit, so nothing legitimate is excluded.
        private static readonly Regex WinClipTokenRegex = new(
            @"\{winclip(?::(\d+))?(?::((?![0-9])[^}]+))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Resolves {winclip:N} against the Windows clipboard history. Fetches the history ONCE per
        // pass (so several {winclip:N} in one field see a consistent snapshot; different actions in a
        // run each read fresh, which is MORE correct than a run-start snapshot) and indexes it
        // 1-based, most-recent-first. Consume-always forgiveness — history disabled, index out of
        // range, or a non-text item at that slot all resolve to empty; it never throws or stalls the
        // run. On the rich SendText double-resolve the plain pass RECORDS each resolved value and the
        // html pass REPLAYS it, so both flavors agree and the html pass skips the second history read.
        internal static async Task<string> ResolveWinClipTokensAsync(
            string text, DispatcherQueue dispatcherQueue,
            bool escapeBracesInSubstitution, bool htmlEncodeSubstitution, TokenFlavorSync? sync = null,
            RunCtx runCtx = default)
        {
            if (string.IsNullOrEmpty(text) || !WinClipTokenRegex.IsMatch(text)) return text;
            bool replaying = sync?.WinClipReplay is { Count: > 0 };
            IReadOnlyList<string?>? history = replaying
                ? null
                : await ReadClipboardHistoryTextsAsync(dispatcherQueue);
            return WinClipTokenRegex.Replace(text, m =>
            {
                string raw;
                if (sync?.WinClipReplay is { Count: > 0 } replay)
                {
                    raw = replay.Dequeue();
                }
                else
                {
                    raw = string.Empty;
                    // Bare {winclip} (no group) = index 1; {winclip:N} parses N (overflow → skip).
                    int n = 1;
                    bool haveIndex = !m.Groups[1].Success || int.TryParse(m.Groups[1].Value, out n);
                    if (history != null && haveIndex
                        && n >= 1 && n <= history.Count && history[n - 1] != null)
                        raw = history[n - 1]!;
                    sync?.WinClipRecord?.Add(raw);
                }
                // Modifiers run AFTER the record/replay split, on both flavors. They are pure, so
                // applying them twice over the same recorded value lands on the same string — and
                // recording the UNMODIFIED item keeps the replay queue meaning what it says.
                if (m.Groups[2].Success)
                    raw = ApplyClipboardModifiers(raw, m.Groups[2].Value, runCtx);
                var resolved = htmlEncodeSubstitution ? HtmlEncodeValue(raw) : raw;
                return escapeBracesInSubstitution ? EscapeBracesForParser(resolved) : resolved;
            });
        }

        private Task<string> ResolveBrowserTextPlaceholders(string text)
            => ResolveBrowserTextPlaceholdersAsync(text, dispatcherQueue, CurrentRunCtx);

        /// <summary>
        /// Resolves data placeholders ({clipboard[:mods]}, {datetime}, {date}, {time}, …) in the text a
        /// Browser action MATCHES — Select Option's option text, Assert's text pattern — via the unified
        /// resolver, with real braces back (escapeBracesInSubstitution: false): the extension compares
        /// this text, it never reads tokens out of it. Inside the C# pipeline a substituted value is
        /// never re-read as a token (the resolvers escape while they run). Static so the Test Action path
        /// can call it without an ActionReplayer instance (runCtx defaults to RunCtx.Empty there).
        /// BrowserType is NOT this path — see ResolveBrowserTypeTextAsync.
        /// </summary>
        internal static Task<string> ResolveBrowserTextPlaceholdersAsync(string text, DispatcherQueue dispatcherQueue, RunCtx runCtx = default)
            => ResolveTokensAsync(text, dispatcherQueue, runCtx, clipboardOverride: null, escapeBracesInSubstitution: false);

        /// <summary>
        /// BrowserType's payload. The extension DOES read tokens out of it — {enter}, {tab:2},
        /// {delay:500} are key chips its parseTypeSegments turns into presses and pauses — and it
        /// cannot tell a brace the user typed from one inside a substituted value. With real braces
        /// back, a clipboard, {var} or {row} value holding "Press {Enter} to continue" pressed Enter
        /// (submitting the form), and a "{delay:60000}" in the data froze the typing for a minute,
        /// while the same value on the SendText path typed as text. So this keeps the sentinels for
        /// substituted braces, the private contract SendText already has with its own parser, and
        /// the extension (1.4.25+) types a sentinel as the literal brace AFTER splitting out the
        /// chips. BrowserBridgeService restores real braces for an older extension, which would
        /// otherwise type the control character itself.
        /// </summary>
        internal static Task<string> ResolveBrowserTypeTextAsync(string text, DispatcherQueue dispatcherQueue, RunCtx runCtx = default)
            => ResolveTokensAsync(text, dispatcherQueue, runCtx, clipboardOverride: null, escapeBracesInSubstitution: true);

        /// <summary>
        /// A text-match pattern's MODE belongs to what the user TYPED. content.js reads it from a
        /// prefix of the text it receives (parseTextSelector: "text=" exact, "text*=" contains,
        /// "text~=" contains ignoring case, "text/…/flags" regex; no prefix = exact), and it receives
        /// the RESOLVED text — so a {var} or {clipboard} value that happened to begin with one of
        /// those ("text=Pedido confirmado") switched the Assert's mode and dropped the prefix from
        /// the comparison. When the authored pattern has no prefix, the resolved one is pinned to
        /// exact with an explicit "text=". HasTextModePrefix mirrors parseTextSelector: the two
        /// change together.
        /// </summary>
        internal static string KeepAuthoredTextMode(string authored, string resolved)
            => !HasTextModePrefix(authored) && HasTextModePrefix(resolved) ? "text=" + resolved : resolved;

        private static bool HasTextModePrefix(string s)
            => s.StartsWith("text*=", StringComparison.Ordinal)
               || s.StartsWith("text~=", StringComparison.Ordinal)
               || s.StartsWith("text=", StringComparison.Ordinal)
               || (s.StartsWith("text/", StringComparison.Ordinal) && s.LastIndexOf('/') > 4);

        /// <summary>
        /// The single token-resolution pipeline for user text (SendText, BrowserType, variable
        /// values, condition operands, file paths, launch arguments, hotkey names). Order:
        /// {clipboard[:mods]}, {winclip}, {datetime}/{date}/{time}, {random}, {pick}, {input}, then
        /// the run-state tokens ({var}/{row:col}/{clip}/{counter}/{row}) and {rownext}, all from
        /// <paramref name="runCtx"/> (RunCtx.Empty on the static Test-Action path).
        /// <paramref name="escapeBracesInSubstitution"/> decides what the caller gets BACK for a
        /// '{' / '}' inside a substituted value: true hands over the private-use sentinels (the
        /// Win32 SendText path, whose ParseSendTextSegments emits them as literal text); false
        /// restores the real characters. Inside the pipeline the braces are ALWAYS escaped — see
        /// the note in the body. Static so the Test Action path resolves without a live ActionReplayer.
        /// </summary>
        internal static async Task<string> ResolveTokensAsync(
            string text, DispatcherQueue dispatcherQueue, RunCtx runCtx = default,
            string? clipboardOverride = null, bool escapeBracesInSubstitution = false,
            bool htmlEncodeSubstitution = false, TokenFlavorSync? flavorSync = null)
        {
            if (string.IsNullOrEmpty(text)) return text;
            // Every resolver escapes the braces of what it SUBSTITUTES, whatever the caller asked
            // for. The passes below run in sequence over ONE string, and to the next pass a
            // substituted value with real braces in it is indistinguishable from authored text.
            // Measured before this was unconditional: on the Browser path a clipboard holding
            // "{input:Senha}" raised the Ask-Input prompt, one holding "{rownext:Nome}" advanced
            // the data cursor, and "{var:x}" pasted the variable's value — while the SAME
            // clipboard on the SendText path (which always asked for the escape) pasted the
            // braces as text. Same data, a different meaning per delivery, and asymmetric even
            // within one pass order (clipboard→var expanded, var→clipboard never did, because var
            // runs later). The caller's flag now decides only what it gets back at the end.
            const bool escapeWhileResolving = true;
            text = await ResolveClipboardTokensAsync(text, dispatcherQueue, clipboardOverride, escapeWhileResolving, htmlEncodeSubstitution, runCtx, flavorSync);
            text = await ResolveWinClipTokensAsync(text, dispatcherQueue, escapeWhileResolving, htmlEncodeSubstitution, flavorSync, runCtx);
            text = ResolveDateTimeTokens(text, flavorSync);
            text = ResolveRandomTokens(text, flavorSync);
            text = ResolvePickTokens(text, escapeWhileResolving, htmlEncodeSubstitution, flavorSync);
            // {input:Label} runs BEFORE run-state so a {var:Label} in the same text sees the answer
            // the prompt just stored. On the static Test-Action path runCtx.InputProvider is null →
            // resolves empty (consume-always), keeping that path byte-identical.
            text = await ResolveInputTokensAsync(text, runCtx, escapeWhileResolving, htmlEncodeSubstitution);
            text = ResolveRunStateTokens(text, runCtx, escapeWhileResolving, htmlEncodeSubstitution);
            // {uuid} / {timestamp} / {env:NAME} — generated and machine values, after run-state so a
            // chain on them can read @var references the same way every other head does.
            text = ResolveMachineTokens(text, runCtx, escapeWhileResolving, htmlEncodeSubstitution, flavorSync);
            text = ResolveRowNextTokens(text, runCtx, escapeWhileResolving, htmlEncodeSubstitution, flavorSync);
            // The sentinels are a private contract with ParseSendTextSegments; nobody else sees them.
            return escapeBracesInSubstitution ? text : UnescapeBraceSentinels(text);
        }

        // Matches {input:Label} and {input:Label|menu:a,b,c}. The label allows any char except '}'
        // and '|' (so it can contain spaces); the optional menu carries a comma-separated option
        // list. IgnoreCase like the other token regexes (the FE chip normalizer title-cases names).
        // menu group is [^}]* (not +) so a present-but-empty "|menu:" still matches and falls
        // through to the plain-field branch below, instead of failing the whole match and leaking
        // the literal token. A stray '|' that isn't "|menu:" (a typo) still stays literal, like any
        // other malformed token.
        private static readonly Regex InputTokenRegex = new(
            @"\{input:([^}|]+)(?:\|menu:([^}]*))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Resolves {input:Label} / {input:Label|menu:a,b,c} by asking the user at replay time and
        // substituting the answer. Awaits a UI round-trip, so it can't live in the sync run-state
        // step. On the static Test-Action path (RunCtx.Empty) InputProvider is null → each token
        // resolves to empty. The provider caches by Label (ask-once-per-run), so multiple
        // occurrences and the rich SendText double-resolve prompt only once. The substituted value
        // gets the same html-encode / brace-escape treatment as {var} for its target context.
        private static async Task<string> ResolveInputTokensAsync(
            string text, RunCtx runCtx, bool escapeBracesInSubstitution, bool htmlEncodeSubstitution)
        {
            if (string.IsNullOrEmpty(text) || !InputTokenRegex.IsMatch(text)) return text;
            var sb = new System.Text.StringBuilder();
            int last = 0;
            foreach (Match m in InputTokenRegex.Matches(text))
            {
                sb.Append(text, last, m.Index - last);
                last = m.Index + m.Length;
                string value = string.Empty;
                if (runCtx.InputProvider != null)
                {
                    var label = m.Groups[1].Value.Trim();
                    string[]? menu = null;
                    if (m.Groups[2].Success)
                    {
                        menu = m.Groups[2].Value.Split(',')
                            .Select(o => o.Trim()).Where(o => o.Length > 0).ToArray();
                        if (menu.Length == 0) menu = null; // "|menu:" with no real options → plain field
                    }
                    value = await runCtx.InputProvider(label, menu);
                }
                if (htmlEncodeSubstitution) value = HtmlEncodeValue(value);
                if (escapeBracesInSubstitution) value = EscapeBracesForParser(value);
                sb.Append(value);
            }
            sb.Append(text, last, text.Length - last);
            return sb.ToString();
        }

        // Matches {random:a-b} — two non-negative integers separated by a hyphen.
        // IgnoreCase because the frontend chip normalizer title-cases token names
        // ({Random:1-10}), same rationale as the clipboard/var regexes.
        private static readonly Regex RandomTokenRegex = new(
            @"\{random:(\d+)-(\d+)\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Stateless {random:a-b} → uniform integer in [a, b] (inclusive; bounds swap when
        // reversed). Each occurrence rolls independently — "{random:1-6} {random:1-6}" is
        // two dice. Unparseable/overflowing numbers resolve to empty, the same consume-
        // always forgiveness as an empty clipboard. Output is digits-only, so no brace
        // escaping is needed on the SendText path (same note as {counter}/{row}).
        /// <summary>
        /// Cross-flavor value sync for one SendText paste: the plain (CF_UNICODETEXT) and rich
        /// (CF_HTML) flavors of the SAME DataPackage must carry IDENTICAL values for
        /// non-deterministic tokens, or the pasted content would depend on the target's paste
        /// mode. The plain pass RECORDS each {random} draw and one DateTime.Now snapshot; the
        /// html pass REPLAYS them in occurrence order (the two strings are parallel
        /// serializations of one document, so occurrences align).
        /// </summary>
        internal sealed class TokenFlavorSync
        {
            public DateTime Now = DateTime.Now;
            public List<string>? RandomRecord;   // set on the recording (plain) pass
            public Queue<string>? RandomReplay;  // set on the replay (html) pass
            public List<string>? WinClipRecord;  // {winclip:N} resolved values — recording (plain) pass
            public Queue<string>? WinClipReplay; // replayed on the html pass so both flavors agree
            public List<string>? RowNextRecord;  // {rownext:col} resolved values — recording (plain) pass
            public Queue<string>? RowNextReplay; // replayed on the html pass so the cursor advances once
            public List<string>? ClipNextRecord;  // {clipboard:next} resolved lines — recording (plain) pass
            public Queue<string>? ClipNextReplay; // replayed on the html pass so one paste eats one line
            public List<string>? PickRecord;      // {pick:a|b|c} drawn options — recording (plain) pass
            public Queue<string>? PickReplay;     // replayed on the html pass so both flavors agree
            public List<string>? UuidRecord;      // {uuid} generated ids — recording (plain) pass
            public Queue<string>? UuidReplay;     // replayed on the html pass so both flavors paste ONE id
        }

        private static string ResolveRandomTokens(string text, TokenFlavorSync? sync = null)
        {
            if (text.IndexOf("{random:", StringComparison.OrdinalIgnoreCase) < 0) return text;
            return RandomTokenRegex.Replace(text, m =>
            {
                // Replay pass: consume the plain pass's draw for this occurrence. Falls
                // through to a fresh roll only if the occurrence counts diverge (defensive).
                if (sync?.RandomReplay is { Count: > 0 } replay) return replay.Dequeue();
                if (!long.TryParse(m.Groups[1].Value, out var a) ||
                    !long.TryParse(m.Groups[2].Value, out var b))
                    return string.Empty; // digits beyond long range — treat as invalid
                if (a > b) (a, b) = (b, a);
                if (b == long.MaxValue) b--; // keep the inclusive upper bound addable
                var value = Random.Shared.NextInt64(a, b + 1).ToString();
                sync?.RandomRecord?.Add(value);
                return value;
            });
        }

        // Matches {pick:a|b|c} — a uniform random choice among '|'-separated verbatim options.
        // The argument is freeform text ending at the first '}', so options may carry spaces,
        // ':' and accents; they can never carry '}' (token grammar) or '|' (the separator).
        // IgnoreCase like the other token regexes (the FE chip normalizer title-cases the head).
        private static readonly Regex PickTokenRegex = new(
            @"\{pick:([^}]+)\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Resolves {pick:a|b|c}: each occurrence rolls independently ({random}'s contract).
        // Empty options are dropped ("a||b" is two options); zero usable options resolve to
        // EMPTY (consume-always). On the rich SendText double-resolve the plain pass RECORDS
        // the chosen option (raw, pre-escaping — the winclip discipline) and the html pass
        // REPLAYS it, so both flavors paste the same choice. Unlike {random}, the options are
        // arbitrary text, so the substituted value gets the full {var}-style escape treatment.
        private static string ResolvePickTokens(string text,
            bool escapeBracesInSubstitution, bool htmlEncodeSubstitution, TokenFlavorSync? sync = null)
        {
            if (text.IndexOf("{pick:", StringComparison.OrdinalIgnoreCase) < 0) return text;
            return PickTokenRegex.Replace(text, m =>
            {
                string raw;
                if (sync?.PickReplay is { Count: > 0 } replay)
                {
                    raw = replay.Dequeue();
                }
                else
                {
                    var options = m.Groups[1].Value.Split('|').Where(o => o.Length > 0).ToArray();
                    raw = options.Length > 0 ? options[Random.Shared.Next(options.Length)] : string.Empty;
                    sync?.PickRecord?.Add(raw);
                }
                var resolved = htmlEncodeSubstitution ? HtmlEncodeValue(raw) : raw;
                return escapeBracesInSubstitution ? EscapeBracesForParser(resolved) : resolved;
            });
        }

        // Matches {var:name} — letters/digits/underscore, case-insensitive (mirrors
        // VariableNameRegex; lookup lowercases the captured name).
        // {var:name} / {var:name:mods} — the modifier tail is unambiguous because a variable name
        // is [A-Za-z0-9_]+, so the first ':' after the name can only start a chain.
        private static readonly Regex VarTokenRegex = new(
            @"\{var:([A-Za-z0-9_]+)(?::([^}]+))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Data-loop column token {row:column} / {row:column:mods}. Disjoint from the bare
        // {row} replace below — "{row}" is not a substring of "{row:column}" (the ':' breaks
        // the literal match), and this regex requires the ':name' tail so it never matches
        // bare {row}. Group 2 is the optional clipboard-style modifier chain (same grammar
        // as {clipboard:mods} — the FIRST segment is always the column, the rest modifiers).
        // The column is [^:}]+ since 2.37.0 — a header is whatever the spreadsheet said
        // ("Nome Completo", "Preço (R$)"), and BuildRowDict already keyed it trimmed and
        // case-insensitively; only ':' (the chain separator) and '}' (the token's end) are out.
        // The first ':' after the column still starts the chain, exactly as before.
        private static readonly Regex RowDataTokenRegex = new(
            @"\{row:([^:}]+)(?::([^}]+))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Sequential data-row token {rownext:column} / {rownext:column:mods}. A run-local,
        // per-column cursor: the FIRST {rownext:col} resolved in a run reads row 1, the next reads
        // row 2, and so on — every occurrence (across actions) advances that column's cursor.
        // DISJOINT from {row}/{row:column}: "{rownext:" shares no literal prefix with the bare "{row}"
        // replace and never matches RowDataTokenRegex ("{row:" needs ':' as the 5th char, here it's
        // 'n'). Group 2 is the optional clipboard-style modifier chain, same as {row:column:mods}.
        // Same [^:}]+ column as RowDataTokenRegex (2.37.0).
        private static readonly Regex RowNextTokenRegex = new(
            @"\{rownext:([^:}]+)(?::([^}]+))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Clipboard-slot token {clip:name}. Disjoint from {clipboard...}: this regex requires
        // ':' immediately after "clip", which "{clipboard}" / "{clipboard:mods}" never has
        // (their 5th char is 'b'). Lookup lowercases the captured name, same as {var}.
        // {clip:name} / {clip:name:mods} — same unambiguous shape as {var:}.
        private static readonly Regex ClipSlotTokenRegex = new(
            @"\{clip:([A-Za-z0-9_]+)(?::([^}]+))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // The run counters with a chain: {counter[:mods]} / {loop[:mods]} / {datarow[:mods]}
        // ({counter:pad:3} → "007"). Group 2 is the same clipboard-style chain every other head
        // takes. Bare {row} is NOT here: "{row:" is the data-column token, so the action row cannot
        // take a chain and stays a literal Replace below.
        private static readonly Regex RunStateChainTokenRegex = new(
            @"\{(counter|loop|datarow)(?::([^}]+))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        /// <summary>
        /// Resolves the run-state tokens {var:name} / {counter} / {row} from
        /// <paramref name="runCtx"/>. With RunCtx.Empty (the Test Action path) every {var}
        /// resolves to empty and counter/row read as not-started → empty, mirroring how an
        /// empty clipboard resolves — the token is always consumed, never left as literal
        /// text. Variable VALUES get the same brace-escaping treatment as clipboard content
        /// so a value like "{enter}" pastes as text on the SendText path instead of being
        /// re-parsed as a key press.
        /// </summary>
        private static string ResolveRunStateTokens(string text, RunCtx runCtx, bool escapeBracesInSubstitution, bool htmlEncodeSubstitution = false)
        {
            if (text.IndexOf('{') < 0) return text;

            if (VarTokenRegex.IsMatch(text))
            {
                text = VarTokenRegex.Replace(text, m =>
                {
                    var name = m.Groups[1].Value.ToLowerInvariant();
                    string value = string.Empty;
                    runCtx.Variables?.TryGetValue(name, out value!);
                    value ??= string.Empty;
                    // Optional modifier chain ({var:nome:trim:upper}) — the SAME shared pipeline
                    // {row:col:mods} uses, applied to the raw value before the html-encode and
                    // brace-escape for the target context.
                    if (m.Groups[2].Success)
                        value = ApplyClipboardModifiers(value, m.Groups[2].Value, runCtx);
                    if (htmlEncodeSubstitution) value = HtmlEncodeValue(value);
                    return escapeBracesInSubstitution ? EscapeBracesForParser(value) : value;
                });
            }

            // Data-loop {row:column} — resolves to the current loop row's cell. Runs BEFORE
            // the bare {row} replace below (defensive isolation). Missing column / no data
            // loop → empty (consume-always), and the cell is brace-escaped like {var} since
            // data cells can contain arbitrary text. An optional modifier chain
            // ({row:name:trim:upper}) reuses the clipboard pipeline VERBATIM — modifiers run
            // on the raw cell, before the html-encode/brace-escape for the target context.
            if (RowDataTokenRegex.IsMatch(text))
            {
                text = RowDataTokenRegex.Replace(text, m =>
                {
                    // Trimmed like the header BuildRowDict keyed it, so "{row: Nome }" finds "Nome".
                    var col = m.Groups[1].Value.Trim().ToLowerInvariant();
                    string value = string.Empty;
                    runCtx.RowData?.TryGetValue(col, out value!);
                    value ??= string.Empty;
                    if (m.Groups[2].Success)
                        value = ApplyClipboardModifiers(value, m.Groups[2].Value, runCtx);
                    if (htmlEncodeSubstitution) value = HtmlEncodeValue(value);
                    return escapeBracesInSubstitution ? EscapeBracesForParser(value) : value;
                });
            }

            // Clipboard slots {clip:name} — captured selections (Copy to Slot / capture
            // hotkey). Missing slot → empty (consume-always); slot text is brace-escaped
            // like {var} since captured selections can contain arbitrary text.
            if (ClipSlotTokenRegex.IsMatch(text))
            {
                text = ClipSlotTokenRegex.Replace(text, m =>
                {
                    var name = m.Groups[1].Value.ToLowerInvariant();
                    string value = string.Empty;
                    runCtx.ClipSlots?.TryGetValue(name, out value!);
                    value ??= string.Empty;
                    if (m.Groups[2].Success)
                        value = ApplyClipboardModifiers(value, m.Groups[2].Value, runCtx);
                    if (htmlEncodeSubstitution) value = HtmlEncodeValue(value);
                    return escapeBracesInSubstitution ? EscapeBracesForParser(value) : value;
                });
            }

            // Numeric run-state tokens. {counter}, {loop} and {datarow} take the modifier chain
            // ({counter:pad:3} → "007") on the SAME applier as every other head; the value is the
            // number, or EMPTY when <= 0 ("no live run" on the Test Action path — consistent with
            // {var}), so a "default:" in the chain is what a macro reads outside a run. A chain's
            // output is text the author shaped (a default, a replacement), so it gets the {var}
            // treatment for the target context. Bare {row} stays a literal Replace: "{row:" is the
            // data-column token, so the action row cannot take a chain.
            if (RunStateChainTokenRegex.IsMatch(text))
            {
                text = RunStateChainTokenRegex.Replace(text, m =>
                {
                    int n = m.Groups[1].Value.ToLowerInvariant() switch
                    {
                        "counter" => runCtx.Iteration,
                        "loop" => runCtx.Loop,
                        _ => runCtx.DataRow,
                    };
                    string value = n > 0 ? n.ToString(System.Globalization.CultureInfo.InvariantCulture) : string.Empty;
                    if (m.Groups[2].Success)
                        value = ApplyClipboardModifiers(value, m.Groups[2].Value, runCtx);
                    if (htmlEncodeSubstitution) value = HtmlEncodeValue(value);
                    return escapeBracesInSubstitution ? EscapeBracesForParser(value) : value;
                });
            }
            if (text.Contains("{row}", StringComparison.OrdinalIgnoreCase))
                text = text.Replace("{row}", runCtx.Row > 0 ? runCtx.Row.ToString() : string.Empty, StringComparison.OrdinalIgnoreCase);

            return text;
        }

        // ── Generated and machine values (2.37.0): {uuid}, {timestamp}, {env:NAME} ──────────
        // {uuid[:mods]} — a fresh GUID per OCCURRENCE (the {random} contract: two tokens are two
        // ids; a Set Variable holding one is how a macro reuses it). Lowercase "D" form, 36 chars;
        // the chain shapes it ({uuid:upper}, {uuid:replace:-:} for the dashless form).
        private static readonly Regex UuidTokenRegex = new(
            @"\{uuid(?::([^}]+))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // {timestamp[:ms][:mods]} — Unix time: seconds since 1970-01-01 UTC, or milliseconds when
        // the FIRST segment is the unit `ms`. The unit is one fixed word, never a modifier name, so
        // {timestamp:upper} is a chain and {timestamp:ms:upper} is a unit and a chain.
        private static readonly Regex TimestampTokenRegex = new(
            @"\{timestamp(?::(ms))?(?::([^}]+))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // {env:NAME[:mods]} — an environment variable as the TrueReplayer process sees it. The name
        // charset is the {var} one plus parentheses, for ProgramFiles(x86); Windows compares names
        // case-insensitively, so {ENV:path} and {env:PATH} read the same variable.
        private static readonly Regex EnvTokenRegex = new(
            @"\{env:([A-Za-z0-9_()]+)(?::([^}]+))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Resolves the three. Each substituted value gets the {var} treatment for the target
        // context (html-encode, then the brace escape) — an environment variable can hold anything,
        // and a chain's default text is whatever the author typed.
        private static string ResolveMachineTokens(string text, RunCtx runCtx,
            bool escapeBracesInSubstitution, bool htmlEncodeSubstitution, TokenFlavorSync? sync = null)
        {
            if (string.IsNullOrEmpty(text) || text.IndexOf('{') < 0) return text;

            string Finish(string value)
            {
                if (htmlEncodeSubstitution) value = HtmlEncodeValue(value);
                return escapeBracesInSubstitution ? EscapeBracesForParser(value) : value;
            }

            if (text.IndexOf("{uuid", StringComparison.OrdinalIgnoreCase) >= 0 && UuidTokenRegex.IsMatch(text))
            {
                text = UuidTokenRegex.Replace(text, m =>
                {
                    // Rich double-resolve: the plain pass RECORDS each id and the html pass REPLAYS
                    // it, so both flavors paste the SAME identifier (the {random} discipline). Falls
                    // through to a fresh id only if the occurrence counts diverge (defensive).
                    string raw;
                    if (sync?.UuidReplay is { Count: > 0 } replay) raw = replay.Dequeue();
                    else
                    {
                        raw = Guid.NewGuid().ToString("D");
                        sync?.UuidRecord?.Add(raw);
                    }
                    if (m.Groups[1].Success) raw = ApplyClipboardModifiers(raw, m.Groups[1].Value, runCtx);
                    return Finish(raw);
                });
            }

            if (text.IndexOf("{timestamp", StringComparison.OrdinalIgnoreCase) >= 0 && TimestampTokenRegex.IsMatch(text))
            {
                // The date tokens' clock: one instant for every token in the text and for both
                // flavors of a rich paste. sync.Now is a LOCAL DateTime and Unix time counts from
                // UTC, so the zone conversion happens here, in the DateTimeOffset, never by hand.
                var now = new DateTimeOffset(sync?.Now ?? DateTime.Now);
                text = TimestampTokenRegex.Replace(text, m =>
                {
                    bool ms = m.Groups[1].Success;
                    string raw = (ms ? now.ToUnixTimeMilliseconds() : now.ToUnixTimeSeconds())
                        .ToString(System.Globalization.CultureInfo.InvariantCulture);
                    if (m.Groups[2].Success) raw = ApplyClipboardModifiers(raw, m.Groups[2].Value, runCtx);
                    return Finish(raw);
                });
            }

            if (text.IndexOf("{env:", StringComparison.OrdinalIgnoreCase) >= 0 && EnvTokenRegex.IsMatch(text))
            {
                text = EnvTokenRegex.Replace(text, m =>
                {
                    // Missing → EMPTY (consume-always, the {var} rule). Read at replay, never cached:
                    // the value is whatever the process sees at that moment.
                    string raw = Environment.GetEnvironmentVariable(m.Groups[1].Value) ?? string.Empty;
                    if (m.Groups[2].Success) raw = ApplyClipboardModifiers(raw, m.Groups[2].Value, runCtx);
                    return Finish(raw);
                });
            }

            return text;
        }

        // Resolves {rownext:column} against the run's data table with a run-local, per-column cursor
        // (runCtx.RowNextCursors, mutated in place). The Nth occurrence of {rownext:col} in a run reads
        // row N of that column and advances; past the last row resolves empty (consume-always). On the
        // rich SendText double-resolve the plain pass RECORDS each resolved value + advances the cursor,
        // and the html pass REPLAYS the recorded values WITHOUT advancing — so both flavors agree and the
        // cursor moves exactly once per occurrence (same discipline as {winclip:N}). On the static
        // Test-Action path (RunCtx.Empty: DataTable/cursors null) every token resolves empty, no advance.
        private static string ResolveRowNextTokens(
            string text, RunCtx runCtx, bool escapeBracesInSubstitution,
            bool htmlEncodeSubstitution, TokenFlavorSync? sync = null)
        {
            if (string.IsNullOrEmpty(text) || !RowNextTokenRegex.IsMatch(text)) return text;
            var table = runCtx.DataTable;
            var cursors = runCtx.RowNextCursors;
            int rowN = table?.Rows?.Count ?? 0;
            return RowNextTokenRegex.Replace(text, m =>
            {
                string value;
                if (sync?.RowNextReplay is { Count: > 0 } replay)
                {
                    // html pass — reuse the plain pass's value (the cursor already advanced there).
                    value = replay.Dequeue();
                }
                else
                {
                    var col = m.Groups[1].Value.Trim().ToLowerInvariant();   // trimmed like BuildRowDict's headers
                    value = string.Empty;
                    if (cursors != null && rowN > 0)
                    {
                        int cur = cursors.TryGetValue(col, out var cv) ? cv : 0;
                        if (cur < rowN)
                        {
                            BuildRowDict(table!, cur).TryGetValue(col, out value!);
                            value ??= string.Empty;
                        }
                        cursors[col] = cur + 1; // advance this column's cursor for the next occurrence
                    }
                    if (m.Groups[2].Success)
                        value = ApplyClipboardModifiers(value, m.Groups[2].Value, runCtx);
                    sync?.RowNextRecord?.Add(value);
                }
                if (htmlEncodeSubstitution) value = HtmlEncodeValue(value);
                return escapeBracesInSubstitution ? EscapeBracesForParser(value) : value;
            });
        }

        // {date} / {time} / {datetime}, optionally with a chain of OFFSETS and a FORMAT:
        //   {date:+7}   {date:-1:yyyy-MM-dd}   {time:HH:mm}   {datetime:+1mo:dd/MM/yyyy HH:mm}   {date:D}
        // The segments after the head are split on ':'. Every segment shaped like an offset — [+-]N
        // with an optional unit: d (days, the default), w, mo (months), y, h, min or m (minutes), s —
        // is applied in order; the remaining segments, re-joined with ':', are the .NET format
        // (custom, or a single-letter standard one). No format → the classic dd/MM/yyyy · HH:mm:ss ·
        // dd/MM/yyyy - HH:mm:ss. Formatting uses TokenCulture, so month and day NAMES follow the
        // machine while '/' and ':' are always themselves — the output the manual documents, on
        // every locale. A format .NET rejects (an unterminated quote, an unknown single letter) or
        // an offset past the calendar leaves the token LITERAL, like every other malformed token.
        // The substituted values carry no braces unless the author quoted some into the format, so
        // no brace-escaping is needed here. The TS port (lexical/dateFormat.ts) mirrors all of it.
        private static readonly Regex DateTokenRegex = new(
            @"\{(datetime|date|time)(?::([^}]+))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static readonly Regex DateOffsetRegex = new(
            @"^([+-]\d{1,6})(d|w|mo|y|h|min|m|s)?$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // The machine's culture with the date and time separators pinned to '/' and ':'. Names
        // (dddd, MMMM) stay local; a pattern prints as it is typed. Built once — the culture does
        // not change while the app runs. The AM/PM designators get a fallback: pt-BR's are EMPTY
        // in .NET's data (measured: "h:mm tt" printed "2:07 " with a trailing space), which would
        // make a 12-hour format silently useless on the very machines this app runs on.
        private static readonly System.Globalization.CultureInfo TokenCulture = BuildTokenCulture();

        private static System.Globalization.CultureInfo BuildTokenCulture()
        {
            var ci = (System.Globalization.CultureInfo)System.Globalization.CultureInfo.CurrentCulture.Clone();
            ci.DateTimeFormat.DateSeparator = "/";
            ci.DateTimeFormat.TimeSeparator = ":";
            if (string.IsNullOrEmpty(ci.DateTimeFormat.AMDesignator)) ci.DateTimeFormat.AMDesignator = "AM";
            if (string.IsNullOrEmpty(ci.DateTimeFormat.PMDesignator)) ci.DateTimeFormat.PMDesignator = "PM";
            return ci;
        }

        private static string ResolveDateTimeTokens(string text, TokenFlavorSync? sync = null)
        {
            if (string.IsNullOrEmpty(text) || text.IndexOf('{') < 0) return text;
            if (!DateTokenRegex.IsMatch(text)) return text;
            // One clock for every token in the text, and for both flavors of a rich paste.
            var now = sync?.Now ?? DateTime.Now;
            return DateTokenRegex.Replace(text, m =>
                TryFormatDateToken(m.Groups[1].Value, m.Groups[2].Success ? m.Groups[2].Value : null, now, out var v)
                    ? v
                    : m.Value);
        }

        /// <summary>
        /// One date/time token, resolved. False when .NET rejects the format (an unterminated
        /// quote, an unknown single letter) or the offset walks off the calendar — the caller then
        /// leaves the token literal, like every other malformed token.
        ///
        /// Shared with ProfileCompatibility so the export floor is decided by the RESOLVER rather
        /// than by a regex that only knows the token has an argument: "{date:x}" is literal on
        /// every build, so pinning it to 2.37.0 would refuse a profile a 2.36.0 machine runs
        /// identically. Same doctrine as ChainUsesShapeModifier and ChainUsesLoopRef.
        ///
        /// `culture` exists for that second caller. Resolving uses TokenCulture, which clones the
        /// MACHINE's culture — and a culture carries a CALENDAR, so on a Windows set to ar-SA
        /// (UmAlQura) an offset like "{date:+60y}" walks off the end, throws, and the token is
        /// reported as literal. Harmless while running (the token really is literal there), but it
        /// made the EXPORT FLOOR depend on the exporting machine's calendar: the same profile
        /// pinned 2.37.0 on one PC and nothing on another. The compatibility scan asks with the
        /// invariant calendar, so the answer is about the profile and not about the desk it left.
        /// </summary>
        internal static bool TryFormatDateToken(string head, string? arg, DateTime now, out string value,
            System.Globalization.CultureInfo? culture = null)
        {
            value = string.Empty;
            try
            {
                var h = head.ToLowerInvariant();
                var when = now;
                string? format = null;
                if (arg != null)
                {
                    var formatParts = new List<string>();
                    foreach (var seg in arg.Split(':'))
                    {
                        var om = DateOffsetRegex.Match(seg);
                        if (om.Success)
                            when = ApplyDateOffset(when, int.Parse(om.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture), om.Groups[2].Value);
                        else
                            formatParts.Add(seg);
                    }
                    var joined = string.Join(":", formatParts);
                    if (joined.Trim().Length > 0) format = joined;
                }
                format ??= h switch { "date" => "dd/MM/yyyy", "time" => "HH:mm:ss", _ => "dd/MM/yyyy - HH:mm:ss" };
                value = when.ToString(format, culture ?? TokenCulture);
                return true;
            }
            catch (FormatException) { return false; }
            catch (ArgumentOutOfRangeException) { return false; }
        }

        /// <summary>
        /// The regex ProfileCompatibility walks to ask the resolver about each date token. Same
        /// shape as DateTokenRegex, exposed so the pin does not re-implement the grammar.
        /// </summary>
        internal static Regex DateTokenMatcher => DateTokenRegex;

        // The unit letters of a date offset. Weeks are seven days; months and years go through
        // AddMonths/AddYears, which clamp the day to the target month (Jan 31 + 1mo = Feb 28).
        private static DateTime ApplyDateOffset(DateTime when, int n, string unit) => unit.ToLowerInvariant() switch
        {
            "" or "d" => when.AddDays(n),
            "w" => when.AddDays(7L * n),
            "mo" => when.AddMonths(n),
            "y" => when.AddYears(n),
            "h" => when.AddHours(n),
            "min" or "m" => when.AddMinutes(n),
            "s" => when.AddSeconds(n),
            _ => when,
        };

        // The editor exports every token chip as <span data-token="{token}">{token}</span> so a
        // saved KeyHtml round-trips back into chips. At SEND time those markers must go: the
        // wrapper span carries no paste value, key/delay placeholders ({enter}/{tab}/{delay:N})
        // act at the SEGMENT level (pressed around the paste) and must not surface as literal
        // text in the rich flavor, and the DOM serializer entity-escapes freeform modifier args
        // ({clipboard:join:&} → &amp;, likewise {row:col:join:&}) which would desync the two
        // flavors' mods. Replacing each marker with its HtmlDecode'd raw token hands the
        // resolvers the exact same token string the plain pass sees; the substituted VALUE is
        // then HTML-encoded by the html pass. KNOWN LIMIT: a HAND-TYPED token whose separator
        // falls outside the chip grammar (join:&) never becomes a marker span, so its escaped
        // form reaches the html-pass resolvers and the flavors desync — pre-existing for
        // {clipboard}, inherited by {row:col:mods}; popover-built chips are immune.
        private static readonly Regex TokenMarkerSpanRegex = new(
            "<span[^>]*\\bdata-token=\"([^\"]*)\"[^>]*>.*?</span>",
            RegexOptions.Singleline | RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static string PrepareRichHtmlForSend(string html)
        {
            return TokenMarkerSpanRegex.Replace(html, m =>
            {
                var tokenText = System.Net.WebUtility.HtmlDecode(m.Groups[1].Value);
                var inner = tokenText.Trim('{', '}');
                var name = inner.Split(':')[0];
                // SpecialKeyPlaceholders is keyed WITH the braces ("{enter}"), so the lookup
                // has to re-wrap the bare name exactly like ParseSendTextSegments does. Passing
                // the bare "enter" never matched, so no key placeholder was ever stripped from
                // the rich flavor and every {enter}/{tab}/… pasted as literal text next to the
                // key press it was supposed to BE.
                if (string.Equals(name, "delay", StringComparison.OrdinalIgnoreCase)
                    || SpecialKeyPlaceholders.ContainsKey("{" + name + "}"))
                    return string.Empty;
                return tokenText;
            });
        }

        /// <summary>
        /// THE single place the two SendText axes are read. Everything downstream consumes this
        /// tuple and never re-derives from action.SendMode / action.SendMethod, so "type + rich"
        /// can only ever mean one thing.
        ///
        /// FLAVOR (SendMode) picks the STRING: "markdown"/"discord" → the pre-serialized
        /// KeyMarkdown, whose marks are already literal characters; everything else → Key.
        /// METHOD (SendMethod) picks the TRANSPORT — and forces Html to null when typing, which is
        /// the structural guarantee that the ==1 rich gate below can never fire on a typed payload.
        /// The grid badge (deliveryBadge.ts) and the status ladder (sendTextStatus.ts) MIRROR this
        /// rule; they must never re-derive it.
        /// </summary>
        private static (string Text, string? Html, bool Type, int CharDelayMs) ResolveSendTextDelivery(ActionItem action)
        {
            var mode = action.SendMode;
            bool markdownMode = string.Equals(mode, "markdown", StringComparison.OrdinalIgnoreCase)
                || string.Equals(mode, "discord", StringComparison.OrdinalIgnoreCase);
            bool type = string.Equals(action.SendMethod, "type", StringComparison.OrdinalIgnoreCase);

            string text = markdownMode && !string.IsNullOrEmpty(action.KeyMarkdown)
                ? action.KeyMarkdown : action.Key;

            string? html = type
                ? null
                : (string.IsNullOrEmpty(mode) || string.Equals(mode, "rich", StringComparison.OrdinalIgnoreCase))
                    ? action.KeyHtml : null;

            // Clamped HERE, once, so the sink stays a dumb emitter. 200 ms/char is already absurd
            // (a 500-char message = 100 s of typing, doubled by the down/up split); the cap exists
            // so a hand-edited profile cannot wedge a run for an hour.
            int charDelay = type ? Math.Clamp(action.SendCharDelay ?? 0, 0, 200) : 0;

            return (text, html, type, charDelay);
        }

        private async Task SendTextPayload(string text, string? html, bool typeMode, int charDelayMs, CancellationToken token)
        {
            if (string.IsNullOrEmpty(text)) return;

            // Save the original clipboard so we can restore it after pasting. The HTML flavor
            // is snapshotted only when this paste will WRITE an HTML flavor (materializing
            // CF_HTML can stall on delayed-render owners like Excel — don't pay that cost for
            // plain pastes, which never clobber the HTML flavor's source text anyway... they do
            // replace the package, so when we're about to paste rich we save/restore both).
            // Typed delivery still READS: originalClipboard.Text feeds token resolution below, so
            // {clipboard[:mods]} resolves identically. It just never WRITES and never restores —
            // includeHtml is already false there, because ResolveSendTextDelivery nulled html.
            var originalClipboard = await ReadClipboardSnapshotAsync(dispatcherQueue, includeHtml: !string.IsNullOrEmpty(html), token);

            // Resolve {clipboard[:mods]} + {datetime}/{date}/{time} in one pass via the unified
            // resolver, using the saved clipboard content so subsequent clipboard writes (for
            // pasting) don't affect token resolution. Escape '{' / '}' in the substituted clipboard
            // value so content like "{enter}" is pasted as text, not re-interpreted as a key press.
            // The flavor sync RECORDS this pass's {random} draws + DateTime.Now snapshot so the
            // html pass below replays the exact same values (one paste = one set of values).
            var flavorSync = new TokenFlavorSync { RandomRecord = new List<string>(), WinClipRecord = new List<string>(), RowNextRecord = new List<string>(), ClipNextRecord = new List<string>(), PickRecord = new List<string>(), UuidRecord = new List<string>() };
            text = await ResolveTokens(text, originalClipboard.Text ?? string.Empty, escapeBracesInSubstitution: true, flavorSync);

            if (string.IsNullOrEmpty(text) || token.IsCancellationRequested)
            {
                if (!typeMode) RestoreOriginalClipboard(originalClipboard);
                return;
            }

            // Parse text into segments: plain text + special key placeholders
            var segments = ParseSendTextSegments(text);

            // Rich flavor (KeyHtml): resolve the SAME token chain over the HTML with the
            // substituted values HTML-encoded (a clipboard/var/row value containing '<' must
            // paste as text, never inject markup) AND brace-sentinel-escaped (a clipboard/var
            // value containing a literal "{date}" must not be re-expanded by the downstream
            // resolvers — same guard the plain pass has), un-escaped again before the CF_HTML
            // is built. V1 rule: the HTML is attached only when the plain resolution produced
            // EXACTLY ONE text segment ({enter}/{tab}/{delay} before/after still work as their
            // own segments — their marker spans are stripped from the html by the pre-process);
            // a key press in the MIDDLE of the text downgrades the whole action to plain —
            // splitting markup at placeholder boundaries is Phase 2.
            // Unreachable under Type — ResolveSendTextDelivery already nulled html, so there is no
            // second flavor to keep in sync and the TokenFlavorSync replay queue is never built.
            string? resolvedHtml = null;
            if (!string.IsNullOrEmpty(html) && segments.Count(s => !string.IsNullOrEmpty(s.Text)) == 1)
            {
                var replaySync = new TokenFlavorSync
                {
                    Now = flavorSync.Now,
                    RandomReplay = new Queue<string>(flavorSync.RandomRecord!),
                    WinClipReplay = new Queue<string>(flavorSync.WinClipRecord!),
                    RowNextReplay = new Queue<string>(flavorSync.RowNextRecord!),
                    ClipNextReplay = new Queue<string>(flavorSync.ClipNextRecord!),
                    PickReplay = new Queue<string>(flavorSync.PickRecord!),
                    UuidReplay = new Queue<string>(flavorSync.UuidRecord!),
                };
                resolvedHtml = await ResolveTokensAsync(PrepareRichHtmlForSend(html), dispatcherQueue, CurrentRunCtx,
                    originalClipboard.Text ?? string.Empty, escapeBracesInSubstitution: true,
                    htmlEncodeSubstitution: true, flavorSync: replaySync);
                resolvedHtml = UnescapeBraceSentinels(resolvedHtml);
            }

            try
            {
                foreach (var segment in segments)
                {
                    if (token.IsCancellationRequested) break;

                    if (segment.DelayMs.HasValue)
                    {
                        // Explicit delay: pause during replay
                        await Task.Delay(segment.DelayMs.Value, token);
                    }
                    else if (segment.VkCode.HasValue)
                    {
                        // Special key: simulate key down + up
                        SimulateKeyPress(segment.VkCode.Value);
                        await Task.Delay(30, token);
                    }
                    else if (!string.IsNullOrEmpty(segment.Text))
                    {
                        // Restore '{' / '}' that the resolver escaped, then hand the literal to the
                        // chosen transport. THIS IS THE ONLY LINE THAT DIFFERS between Paste and
                        // Type: {enter}/{tab}/{delay:N} were already split into VkCode/DelayMs
                        // segments by ParseSendTextSegments BEFORE any transport decision exists,
                        // and both of those arms were always keystrokes and sleeps — so they are
                        // bit-identical either way.
                        var literal = UnescapeBraceSentinels(segment.Text);
                        if (typeMode) await TypeTextViaSendInput(literal, charDelayMs, token);
                        else await PasteTextViaClipboard(literal, resolvedHtml, token);
                    }
                }
            }
            finally
            {
                // Always restore the user's original clipboard, even if cancelled mid-paste — but
                // ONLY when we wrote it. Typing never does, and RestoreOriginalClipboard's else
                // branch is a Clipboard.Clear() when the snapshot held neither flavor (an image, a
                // file list). "Restoring" here would let the one mode that promises never to touch
                // your clipboard WIPE what you copied while the macro ran.
                // The settle is not cut short by a Stop: a Ctrl+V already injected still reads the
                // clipboard whenever the target gets to it, and what it must find there is ours.
                if (!typeMode)
                {
                    await WaitPasteSettleAsync(CancellationToken.None);
                    RestoreOriginalClipboard(originalClipboard);
                }
            }
        }

        private void RestoreOriginalClipboard((string? Text, string? Html) originalClipboard)
        {
            bool queued = dispatcherQueue.TryEnqueue(() =>
            {
                try
                {
                    if (originalClipboard.Text != null || originalClipboard.Html != null)
                    {
                        var dataPackage = new Windows.ApplicationModel.DataTransfer.DataPackage();
                        if (originalClipboard.Text != null) dataPackage.SetText(originalClipboard.Text);
                        // The snapshot holds the raw CF_HTML payload (header included) exactly as
                        // GetHtmlFormatAsync returned it — restore it verbatim, no re-wrapping.
                        if (originalClipboard.Html != null) dataPackage.SetHtmlFormat(originalClipboard.Html);
                        Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dataPackage);
                    }
                    else
                    {
                        Windows.ApplicationModel.DataTransfer.Clipboard.Clear();
                    }
                }
                catch (Exception ex)
                {
                    // Clipboard.SetContent/Clear can throw transiently (another app holding the
                    // clipboard, COM 0x800401D0 CLIPBRD_E_CANT_OPEN). Non-fatal — the replay is
                    // already over — but log so a user who notices their clipboard wasn't restored
                    // has a breadcrumb instead of silence.
                    DiagnosticLog.Error("Failed to restore original clipboard", ex);
                }
            });
            // The queue refuses work once the window is closing (the app shut down with a paste in
            // flight). The restore then never runs; say so, as the catch above does for a failed one.
            if (!queued)
                DiagnosticLog.Warn("Original clipboard not restored: the UI queue is shut down (app closing)");
        }

        private async Task ExecuteWaitImage(ActionItem action, CancellationToken token)
        {
            if (string.IsNullOrEmpty(action.ImagePath)) return;

            // Resolve from the executing profile, not the UI's active one — see
            // CurrentExecutingProfileName. Using _getProfileName here made WaitImage a silent
            // no-op when run via RunProfile (image lives in the sub-profile's folder).
            string profileName = CurrentExecutingProfileName;
            var referenceImage = ImageStorageService.LoadReferenceImage(profileName, action.ImagePath);
            if (referenceImage == null)
            {
                // Reference PNG missing/unreadable (e.g. deleted by orphan cleanup, or a wrong
                // profile-name context). Don't silently skip the wait — that lets the macro fall
                // through as if the screen were ready and silently desync. Log it and honour the
                // OnTimeout policy (StopReplay by default), the same as a real match timeout.
                DiagnosticLog.Info($"[WaitImage] Reference image not found (profile '{profileName}', {action.ImagePath}) — applying OnTimeout policy.");
                HandleWaitImageTimeout(action);
                return;
            }

            // Compose the optional ROI from the four nullable ints stored on the action.
            // When the profile uses relative coordinates, the stored X/Y are window-relative
            // and must be translated to absolute via the current target-window origin —
            // mirrors the SimulateMouse translation path. Skipping translation here was the
            // original bug: a WaitImage region anchored visually to a window would stop
            // matching the moment the user moved the window.
            //
            // The translation is now RE-RESOLVED ON EVERY POLL TICK rather than once before the
            // wait. Resolving it once left the ROI pinned to wherever the window sat at t=0 and
            // then searched there for up to the whole timeout (30 s by default) — the identical
            // failure the fix above describes, just moved from "the user moved the window between
            // runs" to "the window moved DURING the wait". The timed-IF path already re-resolves
            // per tick for exactly this reason (see TryComposeIfSearchRegion), so this brings the
            // two probes back into agreement. Cost: the same GetWindowRect the IF path already
            // pays per tick, and TryResolveRelativeOffset returns immediately for a profile that
            // is not on relative coordinates.
            ImageMatchingService.SearchRegionResolver? regionResolver = null;
            bool targetLost = false;   // set inside the resolver — distinguishes abort from timeout
            if (action.WaitImageSearchW is int sw && action.WaitImageSearchH is int sh && sw > 0 && sh > 0)
            {
                int sx = action.WaitImageSearchX ?? 0;
                int sy = action.WaitImageSearchY ?? 0;
                regionResolver = (out System.Drawing.Rectangle? r) =>
                {
                    if (!TryResolveRelativeOffset(out int dx, out int dy))
                    {
                        r = null;
                        targetLost = true;
                        return false;
                    }
                    r = new System.Drawing.Rectangle(sx + dx, sy + dy, sw, sh);
                    return true;
                };
            }

            try
            {
                int timeoutMs = action.Timeout > 0 ? action.Timeout : 30000;
                // Clamp below 1.0: a normalized template correlation (CCoeffNormed) essentially never
                // reaches an exact 1.0 on a live screen (anti-aliasing, sub-pixel text, animation,
                // capture noise), so a user-set 100% confidence makes the match unreachable and the
                // WaitImage just times out forever (→ StopReplay). Cap at 0.99 so "max confidence"
                // stays strict but achievable.
                double confidence = action.Confidence > 0 ? Math.Min(action.Confidence, 0.99) : 0.8;

                var matchResult = await ImageMatchingService.WaitForImageAsync(
                    referenceImage,
                    confidence,
                    timeoutMs,
                    token,
                    waitForDisappear: action.WaitImageInvert,
                    searchRegionResolver: regionResolver);

                if (matchResult == null)
                {
                    if (token.IsCancellationRequested) return;
                    // The target window vanished mid-wait. Same handling the pre-wait check used
                    // to give it (surface + cancel, or fault the row under skip mode) — NOT the
                    // OnTimeout policy, because nothing was ever actually searched.
                    if (targetLost)
                    {
                        ReportMissingTargetWindow();
                        return;
                    }
                    HandleWaitImageTimeout(action);
                    return;
                }

                // Click center of the matched region when the user opted in. The match coords are
                // absolute virtual-screen positions (from the screenshot pipeline) regardless of
                // whether the profile uses relative coordinates. Pass coordsAreProfileSpace: false
                // so SimulateMouse skips the relative→absolute translation it would normally apply —
                // without this gate, a profile with rel-coords on would add the window origin twice
                // and click in the wrong place.
                if (action.WaitImageClickOnMatch && !action.WaitImageInvert)
                {
                    int cx = matchResult.X + matchResult.W / 2;
                    int cy = matchResult.Y + matchResult.H / 2;
                    SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_LEFTDOWN, coordsAreProfileSpace: false, token: token);
                    SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_LEFTUP, coordsAreProfileSpace: false, token: token);
                }
            }
            finally
            {
                referenceImage.Dispose();
            }
        }

        // The OCR families' search region, re-composed per tick through the CURRENT relative offset
        // (the WaitImage rule). null region = whole screen. false = the target window is gone.
        private bool TryResolveOcrRegion(ActionItem action, out System.Drawing.Rectangle? region)
        {
            region = null;
            if (action.WaitImageSearchW is int sw && action.WaitImageSearchH is int sh && sw > 0 && sh > 0)
            {
                if (!TryResolveRelativeOffset(out int dx, out int dy)) return false;
                region = new System.Drawing.Rectangle((action.WaitImageSearchX ?? 0) + dx, (action.WaitImageSearchY ?? 0) + dy, sw, sh);
            }
            return true;
        }

        /// <summary>
        /// Wait for Text — the OCR twin of <see cref="ExecuteWaitImage"/>: same Timeout, same OnTimeout
        /// vocabulary, same "Click on found location" (centre of the matched words). WaitMode:
        /// null = appears, "disappears", "changes" (the region's text — or number — differs from the
        /// first read, confirmed by two reads in a row so one flickering glyph cannot end the wait).
        /// "disappears" runs the WHOLE variant ladder before calling the text gone: one variant failing
        /// to read text that is still there must not read as absence.
        /// </summary>
        private async Task ExecuteWaitText(ActionItem action, CancellationToken token)
        {
            bool changes = string.Equals(action.WaitMode, "changes", StringComparison.OrdinalIgnoreCase);
            bool disappear = string.Equals(action.WaitMode, "disappears", StringComparison.OrdinalIgnoreCase);
            bool number = ScreenTextMatcher.IsNumberMode(action.OcrReadAs);
            var options = OcrOptionsFor(action);
            // One wait is one window: the operand resolves once, like the hoisted If operand.
            var operand = changes ? "" : await ResolveTokens(action.ConditionOperand ?? string.Empty);
            int timeoutMs = action.Timeout > 0 ? action.Timeout : 30000;
            var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
            string? baseline = null, candidate = null;
            string lastRead = "";

            while (true)
            {
                if (token.IsCancellationRequested) return;
                if (!TryResolveOcrRegion(action, out var region))
                {
                    ReportMissingTargetWindow();
                    return;
                }

                ScreenTextMatcher.Result? last = null;
                OcrRead read;
                try
                {
                    read = await OcrService.ReadAsync(region, options,
                        changes ? null : r => (last = ScreenTextMatcher.Evaluate(r, action.ConditionOperator, operand, number)).Ok,
                        token);
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested) { return; }
                // Setup errors — a Value that resolves to no number, a pattern that does not compile
                // or times out, no OCR language — take the row's On Timeout policy like Wait Image's
                // missing reference and Wait Pixel's bad colour do, instead of escaping to the
                // step's generic handler and stopping a run the user marked Continue.
                catch (Exception ex) when (ex is FormatException or ArgumentException
                                           or System.Text.RegularExpressions.RegexMatchTimeoutException or OcrUnavailableException)
                {
                    HandleWaitTextTimeout(action, lastRead, $"Wait Text: {ex.Message}");
                    return;
                }
                lastRead = read.Text;

                bool done;
                if (changes)
                {
                    var now = number ? ScreenTextMatcher.ValueForVariable(read, true) : ScreenTextMatcher.Normalize(read.Text);
                    if (baseline == null) { baseline = now; done = false; }
                    else if (now == baseline) { candidate = null; done = false; }
                    else if (now == candidate) done = true;
                    else { candidate = now; done = false; }
                }
                else
                {
                    bool found = last?.Ok ?? false;
                    done = disappear ? !found : found;
                }

                if (done)
                {
                    if (_currentStepRec is { } rec && !_runStepsFull)
                    {
                        var shown = Clip40(read.Text);
                        rec.Detail = changes ? $"changed → \"{shown}\"" : disappear ? "gone" : $"found \"{shown}\"";
                    }
                    if (!changes && !disappear && action.WaitImageClickOnMatch && last?.Rect is System.Drawing.Rectangle hit)
                    {
                        // Absolute virtual-screen coords from the OCR pipeline — never profile space.
                        int cx = hit.X + hit.Width / 2;
                        int cy = hit.Y + hit.Height / 2;
                        SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_LEFTDOWN, coordsAreProfileSpace: false, token: token);
                        SimulateMouse(cx, cy, NativeMethods.MOUSEEVENTF_LEFTUP, coordsAreProfileSpace: false, token: token);
                    }
                    return;
                }

                if (DateTime.UtcNow >= deadline)
                {
                    HandleWaitTextTimeout(action, lastRead);
                    return;
                }
                try { await Task.Delay(500, token); }
                catch (OperationCanceledException) { return; }
            }
        }

        private static string Clip40(string s)
        {
            s = (s ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
            return s.Length <= 40 ? s : s.Substring(0, 40) + "…";
        }

        // Same policy as HandleWaitImageTimeout (Continue = expected miss, no screenshot); the message
        // carries what was read last, which is the first thing anyone asks about an OCR miss.
        private void HandleWaitTextTimeout(ActionItem action, string lastRead, string? setupError = null)
        {
            if (action.WaitImageOnTimeout == "Continue")
            {
                // Continue swallows the outcome, but a SETUP error is not a miss the user expected:
                // leave it in the log so "it never matched" has an answer.
                if (setupError != null) DiagnosticLog.Warn(setupError);
                return;
            }
            string reason = setupError ?? $"Wait Text timed out — last read: \"{Clip40(lastRead)}\"";
            if (setupError == null) SaveTimeoutScreenshot(action);
            FailCurrentStep(reason);
            if (SkipRowOnErrorActive)
            {
                FaultRow(reason);
                return;
            }
            try { _cts?.Cancel(); } catch (ObjectDisposedException) { }
        }

        /// <summary>
        /// Set Variable, Screen mode: read the region into {var:name} — the text, or (Number) the first
        /// number. ConditionTimeout is the "Wait up to": 0 reads once; more retries until something is
        /// read. Nothing read deletes the variable, the same contract as an empty Set.
        /// </summary>
        private async Task ExecuteSetVariableFromScreen(ActionItem action, string name, string key, CancellationToken token)
        {
            bool number = ScreenTextMatcher.IsNumberMode(action.OcrReadAs);
            var options = OcrOptionsFor(action);
            var deadline = DateTime.UtcNow.AddMilliseconds(Math.Max(0, action.ConditionTimeout));
            string value;
            while (true)
            {
                if (!TryResolveOcrRegion(action, out var region))
                {
                    ReportMissingTargetWindow();
                    return;
                }
                var read = await OcrService.ReadAsync(region, options,
                    r => ScreenTextMatcher.ValueForVariable(r, number).Length > 0, token);
                value = ScreenTextMatcher.ValueForVariable(read, number);
                if (value.Length > 0 || DateTime.UtcNow >= deadline) break;
                await Task.Delay(300, token);
            }

            if (value.Length == 0)
            {
                lock (_runStateLock) _runtimeVariables.Remove(key);
                Services.DiagnosticLog.Info($"Set Variable '{name}' (screen): read nothing — variable removed");
            }
            else
            {
                lock (_runStateLock) _runtimeVariables[key] = value;
            }
            if (_currentStepRec is { } rec && !_runStepsFull)
                rec.Detail = value.Length == 0 ? $"{name} ← nothing read" : $"{name} ← \"{Clip40(value)}\"";
            PushVariablesSnapshot(force: true);
        }

        // Two branches: explicit "Continue" silently moves on to the next action; everything
        // else (null default / "StopReplay" / anything legacy) cancels the shared CTS so the
        // replay halts cleanly mid-iteration, equivalent to pressing the Stop button. A debug
        // screenshot is dumped to %APPDATA%\TrueReplayer\Debug\ regardless, so the user can
        // diagnose why the match failed.
        /// <summary>
        /// The step record currently executing, or null between steps. Exists so the paths that end
        /// a run by CANCELLING can still say which step ended it.
        /// </summary>
        private RunStepRecord? _currentStepRec;

        /// <summary>
        /// Mark the running step as failed, for an outcome that stops the run WITHOUT throwing.
        ///
        /// This is the honesty hole behind "the automation says it fired and nothing happened".
        /// A Wait that times out under the Stop policy does not raise: WaitForImageAsync returns
        /// null, the handler cancels the token and RETURNS, so the step exits its try normally and
        /// the finally promotes running -> ok. The report therefore showed a green tick on the very
        /// row that killed the run, and every later row as skipped — with nothing naming the cause.
        /// The cancellation only surfaces as OperationCanceledException on the NEXT step, which is
        /// why the existing catch never covered this.
        ///
        /// Deliberately does not touch a step that already has a verdict: a real exception carries
        /// a better message than anything this could invent.
        /// </summary>
        private void FailCurrentStep(string reason)
        {
            var rec = _currentStepRec;
            if (rec == null || rec.Status != "running") return;
            rec.Status = "failed";
            rec.ErrorMessage = reason;
        }

        private void HandleWaitImageTimeout(ActionItem action)
        {
            // The screenshot is a DIAGNOSTIC for an unexpected miss, so it is taken only on the
            // paths where the miss actually ends something: the hard stop below, and the skip-mode
            // row fault (there the user still has to answer "why did row 37 fail?").
            //
            // "Continue" is the user declaring the miss EXPECTED — the documented poll-and-move-on
            // pattern. Dumping a full virtual-screen PNG for an outcome nobody will diagnose costs
            // a capture + PNG encode + disk write on every miss (the capture alone measured 60 ms
            // at 5120x1440), lands inside the row's own duration so it also skews the schedule,
            // and inside a While at the default 1000-iteration ceiling fills the Debug folder with
            // up to 1000 desktop-sized PNGs. Nothing pruned that folder, ever.
            if (action.WaitImageOnTimeout == "Continue")
            {
                return;
            }

            // DisplayKey is empty for a WaitImage — the reference lives in ImagePath, not Key — so
            // the old format produced a bare "timed out ()". Harmless in a log line, sloppy now that
            // FailCurrentStep puts this text in the run report where the user reads it. The row
            // already carries its own number and comment, so nothing is lost by dropping the empty
            // pair rather than inventing a GUID filename to fill it.
            string label = string.IsNullOrWhiteSpace(action.DisplayKey) || action.DisplayKey == "—"
                ? "" : $" ({action.DisplayKey})";

            SaveTimeoutScreenshot(action);

            if (SkipRowOnErrorActive)
            {
                FailCurrentStep($"Wait Image timed out{label}");
                FaultRow($"Wait Image timed out{label}");
                return;
            }
            FailCurrentStep($"Wait Image timed out{label}");
            // ObjectDisposedException possible if a new StartAsync swapped _cts out
            // from under us; swallow because this run was already over anyway.
            try { _cts?.Cancel(); } catch (ObjectDisposedException) { }
        }

        /// <summary>
        /// Poll a single screen pixel until it matches (or stops matching, with Invert) a
        /// target colour within a per-channel tolerance, or the timeout elapses. Mirrors the
        /// shape of <see cref="ExecuteWaitImage"/> so they share the same OnTimeout vocabulary
        /// and cancellation semantics, but the implementation is intentionally tiny —
        /// <c>GetPixelAt</c> is ~0.1 ms so the loop spends ~all its time in Task.Delay,
        /// keeping CPU near zero and cancellation responsive.
        /// </summary>
        private async Task ExecuteWaitPixelColor(ActionItem action, CancellationToken token)
        {
            // Missing coords or unparseable colour → immediate timeout. Better to surface the
            // configuration error via OnTimeout (Stop/Continue/Halt) than to silently no-op
            // and have the user wonder why the action did nothing.
            if (action.PixelX is not int relPx || action.PixelY is not int relPy)
            {
                HandleWaitPixelColorTimeout(action);
                return;
            }
            var target = PixelColorService.ParseHex(action.PixelColor);
            if (target == null)
            {
                HandleWaitPixelColorTimeout(action);
                return;
            }

            int timeoutMs = action.Timeout > 0 ? action.Timeout : 5000;
            int tolerance = action.PixelTolerance;
            bool invert = action.PixelInvert;

            // 50 ms poll = ~20 Hz. Fast enough that humans never perceive lag, slow enough
            // that even an infinite loop costs <1 % CPU on a recent machine. Stopwatch
            // beats DateTime here because we're inside a hot loop with cancellation.
            var sw = System.Diagnostics.Stopwatch.StartNew();
            System.Drawing.Color? lastSampled = null;
            // Hoisted out of the loop ONLY so the timeout log below can report the last
            // translation that was actually sampled. Seeded with the untranslated point so the
            // log is still meaningful if the very first tick aborts.
            int px = relPx, py = relPy;

            while (!token.IsCancellationRequested && sw.ElapsedMilliseconds < timeoutMs)
            {
                // Translate profile-space coords to absolute virtual-desktop pixels via the
                // current target-window origin. With rel-coords on but no target running this
                // is a hard error: GetPixelAt at the wrong location would silently sample the
                // desktop and never match. ReportMissingTargetWindow surfaces it + cancels.
                //
                // INSIDE the loop, not once before it. A single pixel is the least forgiving
                // probe in the app: resolve the origin once and a window that moves 10 px during
                // the wait makes every remaining tick sample something unrelated — and with
                // PixelClickOnMatch a coincidental colour there turns into a real click at the
                // STALE coordinate. The timed-IF pixel probe already re-resolves per tick at this
                // very cadence (ProbePixelColorMatch), so the cost is one the engine already
                // accepts, and TryResolveRelativeOffset is a no-op on an absolute-coords profile.
                if (!TryResolveRelativeOffset(out int dx, out int dy))
                {
                    ReportMissingTargetWindow();
                    return;
                }
                px = relPx + dx;
                py = relPy + dy;

                var sampled = PixelColorService.GetPixelAt(px, py);
                lastSampled = sampled;

                if (sampled is System.Drawing.Color s)
                {
                    bool match = PixelColorService.MatchesWithinTolerance(s, target.Value, tolerance);
                    // Invert flips the success condition: "wait for X to disappear" succeeds
                    // when the current colour DOESN'T match. Out-of-bounds reads (sampled
                    // null) treat as no-match this iteration — they never satisfy either
                    // branch, so the action falls through to its timeout.
                    if (invert ? !match : match)
                    {
                        // Click the watched pixel when the user opted in. Suppressed in invert
                        // mode because "the colour we expected isn't here anymore" doesn't make
                        // a clear target for a follow-up click — same gate WaitImage uses.
                        // SimulateMouse handles virtual-desktop normalisation + Raw Input.
                        if (action.PixelClickOnMatch && !invert)
                        {
                            // px/py are already absolute — THIS tick's TryResolveRelativeOffset
                            // translated them at the top of the loop, so the click lands where
                            // the colour was actually just sampled even if the window moved
                            // during the wait. Pass coordsAreProfileSpace: false so SimulateMouse
                            // doesn't translate a second time.
                            SimulateMouse(px, py, NativeMethods.MOUSEEVENTF_LEFTDOWN, coordsAreProfileSpace: false, token: token);
                            SimulateMouse(px, py, NativeMethods.MOUSEEVENTF_LEFTUP, coordsAreProfileSpace: false, token: token);
                        }
                        return;
                    }
                }

                try { await Task.Delay(50, token); }
                catch (TaskCanceledException) { return; }
            }

            if (token.IsCancellationRequested) return;

            // Surface the last sampled colour into the diagnostic log so the user can
            // compare "wanted #FF5733 ± 10 / got #2B2B2B" without instrumenting anything.
            // Cheap and non-blocking; falls off the end of the buffer like any other log.
            // Log both stored coords (profile space) and effective abs coords so users on
            // rel-coords profiles can tell whether the translation landed where they wanted.
            //
            // DiagnosticLog, NOT Debug.WriteLine: the latter is [Conditional("DEBUG")], so this
            // line — the ONLY explanation a user ever gets for a WaitPixelColor timeout, and the
            // stated reason HandleWaitPixelColorTimeout skips the screenshot WaitImage takes —
            // did not exist in any published build. A timeout is a once-per-action event, so
            // there is no flood risk in the queue.
            // lastSampled=null is itself the signal that GetPixelAt could not read the point
            // (off-desktop, or an accelerated surface denying the GDI read).
            DiagnosticLog.Info(
                $"[WaitPixelColor] Timeout @ rel ({relPx},{relPy}) → abs ({px},{py}). " +
                $"Target={action.PixelColor} tol={tolerance} invert={invert} " +
                $"lastSampled={(lastSampled is System.Drawing.Color ls ? PixelColorService.ToHex(ls) : "null")}");
            HandleWaitPixelColorTimeout(action);
        }

        // Same Continue/StopReplay shape as HandleWaitImageTimeout, just driven by the
        // separate PixelOnTimeout field so each action type can carry its own policy.
        // No diagnostic screenshot here — the cheaper, more relevant artefact (last sampled
        // colour) already went into the diagnostic log above. That claim is only true as of
        // 2026-09-01: the line used to be a Debug.WriteLine, so in every published build this
        // action's timeout explained itself nowhere at all.
        private void HandleWaitPixelColorTimeout(ActionItem action)
        {
            if (action.PixelOnTimeout == "Continue") return;
            if (SkipRowOnErrorActive)
            {
                FailCurrentStep($"Wait Pixel timed out ({action.PixelColor ?? "?"})");
                FaultRow($"Wait Pixel timed out ({action.PixelColor ?? "?"})");
                return;
            }
            FailCurrentStep($"Wait Pixel timed out ({action.PixelColor ?? "?"})");
            // Same swallow as HandleWaitImageTimeout — race with a fresh StartAsync.
            try { _cts?.Cancel(); } catch (ObjectDisposedException) { }
        }

        // ── Conditional logic: instant probe ─────────────────────────────────
        // Evaluates an IF condition, optionally POLLING for up to action.ConditionTimeout ms for the
        // (negate-applied) outcome to become true before deciding. ConditionTimeout 0 = the classic
        // instant single check (unchanged). > 0 turns the IF into "wait up to N ms for the condition,
        // then branch": returns TRUE the instant the probe is satisfied, otherwise FALSE once the window
        // elapses (→ Else / false branch). Like a Wait Image/Pixel poll, but it BRANCHES on the result
        // instead of stopping the run. Poll cadence tracks the probe's MEASURED cost, floored at the
        // family's base rate (pixel ~0.1 ms → 50 ms; an image match captures + correlates the screen
        // → a gentler 200 ms) and capped at MaxPollDelayMs — see NextPollDelayMs.
        private async Task<bool> EvaluateConditionWithTimeout(ActionItem action, CancellationToken token)
        {
            int timeoutMs = action.ConditionTimeout;
            if (timeoutMs <= 0)
                return await InstantProbeAsync(action, token); // instant single check — unchanged legacy behaviour

            int pollFloorMs = string.Equals(action.ConditionType, "PixelColorMatch", StringComparison.OrdinalIgnoreCase) ? 50 : 200;
            // Hoist the per-tick invariants ONCE for the whole poll window — the reference
            // image load + Bitmap→Mat conversion, the compiled window-title regex, the
            // parsed pixel hex — exactly what the automation watcher hoists in
            // TriggerService.RunConditionLoopAsync, and for the same reason: none of them
            // can change mid-window, and redoing them every 50/200 ms tick was the bulk of
            // the poll's cost. The instant path above stays context-free — a single check
            // has nothing to amortise. `using` = the evaluation's finally: the context owns
            // the template Mat and disposes it however the window ends.
            //
            // It also hoists an operand carrying a STATEFUL token, and that one is a
            // CORRECTNESS hoist rather than a cost one: re-resolving {clipboard:next} per tick
            // ate a clipboard line per tick and compared against a different value each time.
            // See HoistStatefulOperandAsync.
            using var ctx = await BuildIfProbeContextAsync(action);
            var sw = System.Diagnostics.Stopwatch.StartNew();
            long lastProbeMs = 0;
            while (true)
            {
                token.ThrowIfCancellationRequested();
                // The probe's own cost is measured so the gap after it can absorb it — see
                // NextPollDelayMs. Reading the shared stopwatch twice is cheaper than a second
                // one and keeps both numbers on the same clock as the timeout check below.
                long probeStartMs = sw.ElapsedMilliseconds;
                bool satisfied = await InstantProbeAsync(action, ctx, token);
                lastProbeMs = sw.ElapsedMilliseconds - probeStartMs;
                if (satisfied) return true; // condition satisfied within the window
                // Skip mode: a probe that faulted the row (e.g. missing rel-coords target
                // window) must unwind NOW, not keep re-polling a dead probe for the full window.
                if (_rowFaulted) return false;
                if (sw.ElapsedMilliseconds >= timeoutMs) return false;   // window elapsed → take the Else/false branch
                await Task.Delay(NextPollDelayMs(pollFloorMs, lastProbeMs), token);
            }
        }

        // Ceiling on the gap between two poll ticks. Set to WaitImage's own poll interval
        // (ImageMatchingService.WaitForImageAsync's pollIntervalMs default) so the expensive path
        // of a timed condition converges on the cadence the app already chose for the identical
        // work, instead of drifting somewhere nobody picked.
        internal const int MaxPollDelayMs = 500;

        /// <summary>
        /// Gap to wait before the next poll tick of a timed condition: the probe's own measured
        /// cost, floored at the family's base cadence and capped at <see cref="MaxPollDelayMs"/>.
        ///
        /// The old code used the floor as a CONSTANT, which assumed the probe was free. It is not:
        /// the comment justifying it claimed "~30-80 ms on 1080p", while the measurement on the
        /// owner's 5120x1440 desktop is ~541 ms for one full-screen template match — so a
        /// "200 ms" cadence really ran at ~741 ms and spent 73% of the wall clock inside OpenCV.
        ///
        /// Tracking the probe's cost bounds the duty cycle at ~50% regardless of desktop size,
        /// which is what WaitImage's 500 ms poll already does for the same match. A CHEAP probe
        /// never leaves the floor — an ROI-constrained match is ~4 ms and a pixel read ~0.1 ms —
        /// so the correctly-configured path (the one the Search Region hint pushes users toward)
        /// is byte-identical to before. Deliberately NOT the reverse policy of subtracting the
        /// probe cost from the floor: that would peg a core at 100% for the whole window to buy
        /// ~200 ms of detection latency on a setup the app is actively telling the user to fix.
        /// </summary>
        internal static int NextPollDelayMs(int floorMs, long lastProbeMs) =>
            (int)Math.Clamp(lastProbeMs, floorMs, MaxPollDelayMs);

        // Per-evaluation cache for a timed IF's poll loop: the probe inputs that CANNOT
        // change while the window runs. The search ROI is deliberately absent — the target
        // window can move during the timeout, so TryResolveRelativeOffset stays per tick
        // (see TryComposeIfSearchRegion). Owns the template Mat; Dispose ends the window.
        private sealed class IfProbeContext : IDisposable
        {
            public OpenCvSharp.Mat? TemplateMat;          // ImageFound — null = reference image missing
            public Models.WindowTarget? WindowTarget;     // WindowOpen — compiled regex cached alongside
            public Regex? TitleRegex;
            public System.Drawing.Color? PixelColor;      // PixelColorMatch — null = unparseable hex
            // Variable / FileExists: the operand / path RESOLVED ONCE for the whole window, set
            // only when it carries a STATEFUL token (see CarriesStatefulToken). null = resolve per
            // tick, which is what keeps a plain {var:other} / {date} operand live. A row is one
            // family or the other, never both, but they get their own field so no probe can ever
            // read the value the other family hoisted.
            public string? HoistedOperand;
            public string? HoistedFilePath;
            // Only the FIRST tick may report an unusable search region: the region is fixed
            // for the whole window, so the verdict can't change between ticks (same rule as
            // WaitForImageAsync's reportRegion flag).
            public bool ReportRegion = true;

            public void Dispose()
            {
                TemplateMat?.Dispose();
                TemplateMat = null;
            }
        }

        private async Task<IfProbeContext> BuildIfProbeContextAsync(ActionItem action)
        {
            var ctx = new IfProbeContext();
            if (string.Equals(action.ConditionType, "ImageFound", StringComparison.OrdinalIgnoreCase))
            {
                if (!string.IsNullOrEmpty(action.ImagePath))
                {
                    // Executing profile, not the UI's active one — same resolution rule as the
                    // context-free ProbeImageFound path below.
                    var refImage = ImageStorageService.LoadReferenceImage(CurrentExecutingProfileName, action.ImagePath);
                    if (refImage != null)
                    {
                        // BitmapToMat copies the pixels, so the Bitmap can go immediately —
                        // only the Mat has to live for the window (cf. TriggerService, which
                        // keeps both for its own reasons).
                        try { ctx.TemplateMat = ScreenCaptureService.BitmapToMat(refImage); }
                        finally { refImage.Dispose(); }
                    }
                }
            }
            else if (string.Equals(action.ConditionType, "WindowOpen", StringComparison.OrdinalIgnoreCase))
            {
                // CompileTitleRegex emits IL (RegexOptions.Compiled) — its own doc asks
                // callers to cache the result when the target is reused across many calls.
                (ctx.WindowTarget, ctx.TitleRegex) = BuildWindowTargetFromAction(action);
            }
            else if (string.Equals(action.ConditionType, "PixelColorMatch", StringComparison.OrdinalIgnoreCase))
            {
                ctx.PixelColor = PixelColorService.ParseHex(action.PixelColor);
            }
            else if (string.Equals(action.ConditionType, "Variable", StringComparison.OrdinalIgnoreCase))
            {
                ctx.HoistedOperand = await HoistStatefulOperandAsync(action.ConditionOperand);
            }
            else if (string.Equals(action.ConditionType, "FileExists", StringComparison.OrdinalIgnoreCase))
            {
                ctx.HoistedFilePath = await HoistStatefulOperandAsync(action.FilePath);
            }
            else if (string.Equals(action.ConditionType, "ScreenText", StringComparison.OrdinalIgnoreCase))
            {
                // Same rule as Variable: a stateful operand ({input}, {random}, {clipboard:next}…)
                // resolves once per window so a poll cannot consume it tick after tick.
                ctx.HoistedOperand = await HoistStatefulOperandAsync(action.ConditionOperand);
            }
            // Every remaining family has nothing hoistable — Random and TimeWindow are meant to
            // read fresh, ProcessRunning and ClipboardMatch have no inputs to resolve, and the
            // browser probe's selector goes over the pipe untouched. The empty context is ignored.
            return ctx;
        }

        /// <summary>
        /// Resolves <paramref name="raw"/> ONCE for a timed condition's whole poll window, but only
        /// when it carries a token whose resolution has a side effect. Returns null otherwise, and
        /// null means "the probe resolves this per tick", i.e. exactly the old behaviour.
        ///
        /// The bug this closes: the poll loop calls the Variable / FileExists probe every 50-200 ms
        /// and each call re-resolved the operand, so a {clipboard:next} in it consumed one clipboard
        /// line PER TICK and compared against a different value every time — the wait could
        /// "succeed" on a line the author never meant. The Wait ▾ presets arm a 10 s budget by
        /// default, so that is ~50 lines eaten while waiting. Same class the engine already guards
        /// at two other doors: ExecuteActivateWindow does not resolve LaunchPath for a verb that
        /// cannot launch, and the branch chain stops probing arms once the row is faulted, both
        /// citing the {clipboard:next} cursor and the {input:} prompt by name.
        ///
        /// A hoist that THROWS deliberately falls back to null rather than propagating: the row's
        /// error contract belongs to InstantProbeAsync's catch (IfOnProbeError), and moving a
        /// failure one statement earlier would route it around that policy. Cancellation still
        /// propagates — a user Stop is never a probe error.
        /// </summary>
        private async Task<string?> HoistStatefulOperandAsync(string? raw)
        {
            if (!CarriesStatefulToken(raw)) return null;
            try { return await ResolveTokens(raw!); }
            catch (OperationCanceledException) { throw; }
            catch (Exception ex)
            {
                DiagnosticLog.Info($"[IfProbe] Could not pre-resolve a stateful operand ({ex.Message}) — falling back to per-tick resolution");
                return null;
            }
        }

        /// <summary>
        /// True when <paramref name="text"/> carries a token whose RESOLUTION has a side effect or
        /// a fresh result — resolving it twice is not the same as resolving it once. The set is the
        /// one the ArgRefSigil note already names as "async or stateful": {input:}, {winclip:},
        /// {clipboard:…next…}, {rownext:} and {random:}.
        ///
        /// Every branch reuses the RESOLVER'S OWN regex instead of scanning for substrings. A
        /// hand-written scan is wrong in both directions here: ":next" also matches {var:next} and
        /// "random" also matches a variable called random, and freezing an operand that must stay
        /// live breaks "wait until A equals B" — the opposite failure, and a silent one.
        /// </summary>
        internal static bool CarriesStatefulToken(string? text)
        {
            if (string.IsNullOrEmpty(text)) return false;
            if (InputTokenRegex.IsMatch(text)) return true;    // modal prompt (memoised per run, but still a prompt)
            if (WinClipTokenRegex.IsMatch(text)) return true;  // clipboard-history read
            if (RandomTokenRegex.IsMatch(text)) return true;   // re-rolls per resolution
            // {pick:a|b|c} is {random}'s twin and its doc says so word for word — "each occurrence
            // rolls independently ({random}'s contract)". Missing it here left the exact hole this
            // predicate exists to close: a timed condition would draw a DIFFERENT option on every
            // poll tick and compare the variable against a moving target. Found by re-reading the
            // resolver rather than by trusting a review that had declared this case refuted.
            if (PickTokenRegex.IsMatch(text)) return true;     // re-rolls per resolution
            // {uuid} is a fresh identifier per resolution — the {random} case exactly. {timestamp}
            // is a CLOCK and stays live like {date}; {env:} is a pure read like {var}. Neither of
            // those two belongs here: hoisting a clock is the "wait until A equals B" failure.
            if (UuidTokenRegex.IsMatch(text)) return true;     // fresh id per resolution
            if (RowNextTokenRegex.IsMatch(text)) return true;  // advances the per-column data cursor
            // {clipboard:next} ONLY — a plain {clipboard} or {clipboard:upper} is a pure read, and
            // `next` is legal anywhere in the modifier chain, so the chain is split the same way
            // the resolver splits it rather than pattern-matched.
            foreach (Match m in ClipboardTokenRegex.Matches(text))
            {
                var mods = m.Groups[1].Success ? m.Groups[1].Value : null;
                if (TrySplitNextModifier(mods, out _)) return true;
            }
            return false;
        }

        // Async-probing conditions fetch their data here before evaluating — the clipboard
        // read must run on the UI dispatcher and the browser probe awaits the extension
        // pipe; neither can block the sync InstantProbe (the replay thread awaiting a
        // dispatcher/pipe hop synchronously would risk a deadlock). Everything else falls
        // straight through to the sync InstantProbe unchanged. Keeps the same Negate /
        // IfOnProbeError / cancellation contract as InstantProbe.
        //
        // Context-free overload — the single instant check (ConditionTimeout <= 0). Behaviour
        // and cost identical to before the timed path grew its per-window IfProbeContext.
        private Task<bool> InstantProbeAsync(ActionItem action, CancellationToken token)
            => InstantProbeAsync(action, null, token);

        private async Task<bool> InstantProbeAsync(ActionItem action, IfProbeContext? ctx, CancellationToken token)
        {
            bool isClipboard = string.Equals(action.ConditionType, "ClipboardMatch", StringComparison.OrdinalIgnoreCase);
            bool isBrowserElement = string.Equals(action.ConditionType, "BrowserElementState", StringComparison.OrdinalIgnoreCase);
            bool isVariable = string.Equals(action.ConditionType, "Variable", StringComparison.OrdinalIgnoreCase);
            bool isFileExists = string.Equals(action.ConditionType, "FileExists", StringComparison.OrdinalIgnoreCase);
            // OCR awaits WinRT — it belongs with the async families, never on the sync chain below.
            bool isScreenText = string.Equals(action.ConditionType, "ScreenText", StringComparison.OrdinalIgnoreCase);
            if (!isClipboard && !isBrowserElement && !isVariable && !isFileExists && !isScreenText)
                return InstantProbe(action, ctx, token);

            token.ThrowIfCancellationRequested();
            try
            {
                bool rawResult;
                if (isClipboard)
                {
                    var clip = await ReadClipboardTextAsync(dispatcherQueue, token) ?? string.Empty;
                    rawResult = EvaluateClipboardPattern(clip, action);
                }
                else if (isVariable)
                {
                    rawResult = await ProbeVariableAsync(action, ctx);
                }
                else if (isFileExists)
                {
                    rawResult = await ProbeFileExistsAsync(action, ctx);
                }
                else if (isScreenText)
                {
                    rawResult = await ProbeScreenTextAsync(action, ctx, token);
                }
                else
                {
                    rawResult = await ProbeBrowserElementStateAsync(action, token);
                }
                return action.ConditionNegate ? !rawResult : rawResult;
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested)
            {
                throw; // genuine user stop always propagates — same rule as InstantProbe
            }
            catch (OcrUnavailableException)
            {
                // No OCR language on this PC is a property of the MACHINE, not a miss on screen:
                // under Treat-as-false every Screen Text If would take its Else and every While exit
                // at once, with nothing to say why (a profile shared to a PC without the pack).
                // The other OCR paths are loud — Wait for Text, Set Variable, the watcher — so is this.
                throw;
            }
            catch (Exception ex)
            {
                // A spurious OCE (e.g. token.None from a pipe-disconnect TCS cancel) does NOT match
                // the guarded catch above and lands here — treated as a probe error → TreatAsFalse
                // (or Halt if the row opts in), so a dropped bridge branches instead of halting.
                DiagnosticLog.Info($"[InstantProbe] Probe error ({action.ConditionType}): {ex.Message}");
                if (string.Equals(action.IfOnProbeError, "Halt", StringComparison.OrdinalIgnoreCase))
                    throw;
                return action.ConditionNegate; // TreatAsFalse + negate — mirrors InstantProbe's catch
            }
        }

        // Last text the Screen Text probe read — appended to the If/While run-report detail so a
        // branch that went the "wrong" way shows what the engine actually saw. Replay-thread only.
        private string? _lastScreenRead;

        internal static OcrOptions OcrOptionsFor(ActionItem action, bool wantPreview = false) => new(
            Number: ScreenTextMatcher.IsNumberMode(action.OcrReadAs),
            TextColor: PixelColorService.ParseHex(action.OcrTextColor),
            ColorTolerance: action.OcrColorTolerance ?? OcrService.DefaultColorTolerance,
            WantPreview: wantPreview);

        // If/While Screen Text raw probe: read the region (re-composed every tick, like ImageFound,
        // so a moving target window is tracked), stop the variant ladder at the first read the
        // matcher accepts. A missing target window reads not-matched (or Halt, via the shared
        // helper). An operand that is not a number in Number mode throws → probe-error policy.
        private async Task<bool> ProbeScreenTextAsync(ActionItem action, IfProbeContext? ctx, CancellationToken token)
        {
            _lastScreenRead = null;
            if (!TryComposeIfSearchRegion(action, out var region)) return false;
            bool number = ScreenTextMatcher.IsNumberMode(action.OcrReadAs);
            var operand = ctx?.HoistedOperand ?? await ResolveTokens(action.ConditionOperand ?? string.Empty);
            ScreenTextMatcher.Result? last = null;
            var read = await OcrService.ReadAsync(region, OcrOptionsFor(action),
                r => (last = ScreenTextMatcher.Evaluate(r, action.ConditionOperator, operand, number)).Ok, token);
            _lastScreenRead = read.Text;
            return last?.Ok ?? false;
        }

        // If-Browser-Element raw probe: one instant state check (appears/disappears/enabled/
        // text-match) against the live page, reusing the extension's waitElement evaluator
        // with timeout=0 so it never enters the wait loop. Reuses BrowserWaitElement's probe
        // fields — Key (selector), WaitMode, BrowserText (text pattern) — the same way
        // If-Image reuses WaitImage's. A missing/disconnected extension reads as "not found"
        // (raw false) rather than an error, so an If never halts a replay just because the
        // browser bridge is down; ConditionNegate still applies via the caller.
        private async Task<bool> ProbeBrowserElementStateAsync(ActionItem action, CancellationToken token)
        {
            if (string.IsNullOrEmpty(action.Key)) return false; // unconfigured probe
            if (_browserBridge == null || !_browserBridge.IsConnected) return false;
            return await _browserBridge.ProbeElementStateAsync(action, token);
        }

        // If-Clipboard raw match: case-insensitive contains (default) / equals / regex, matching
        // the case-insensitive convention of window-title matching. Empty pattern = unconfigured
        // probe = no match (same shape as an If-Image with no reference image). An invalid regex
        // throws ArgumentException, which the caller's catch routes through IfOnProbeError.
        private static bool EvaluateClipboardPattern(string clip, ActionItem action)
        {
            var pattern = action.ClipboardPattern ?? string.Empty;
            if (pattern.Length == 0) return false;
            var mode = action.ClipboardPatternType?.ToLowerInvariant();
            return mode switch
            {
                "equals" => string.Equals(clip, pattern, StringComparison.OrdinalIgnoreCase),
                "regex" => Regex.IsMatch(clip, pattern, RegexOptions.IgnoreCase, TimeSpan.FromMilliseconds(50)),
                _ => clip.IndexOf(pattern, StringComparison.OrdinalIgnoreCase) >= 0, // contains (default)
            };
        }

        // If-Window raw probe: builds a WindowTarget from the IF's fields and reuses
        // WindowMatcher — identical semantics to the profile Window Target (empty field =
        // wildcard; no criteria at all = no match). ForegroundOnly checks only the window
        // currently in front instead of enumerating all top-level windows.
        private static bool ProbeWindowOpen(ActionItem action, IfProbeContext? ctx)
        {
            // Timed-IF path reuses the target + compiled title regex hoisted into the
            // context; a context-free (instant) probe builds them fresh, as it always did.
            var (target, regex) = ctx?.WindowTarget != null
                ? (ctx.WindowTarget, ctx.TitleRegex)
                : BuildWindowTargetFromAction(action);
            if (action.WindowMatchForegroundOnly)
                return TrueReplayer.Helpers.WindowMatcher.Matches(NativeMethods.GetForegroundWindow(), target, regex);
            return TrueReplayer.Helpers.WindowMatcher.FindWindow(target, regex) != IntPtr.Zero;
        }

        // Shared matcher builder for the per-action window fields (If-Window probe,
        // ActivateWindow, and the bridge's window:testProbe). Forgiving process input — "chrome"
        // as well as "chrome.exe" — now lives in WindowMatcher.ProcessNameMatches, for every
        // consumer at once. The ".exe" this used to append went only onto names WITHOUT a dot, so
        // "my.app" never became "my.app.exe" and never matched; and appending to a dotted name
        // would break an image that is not an .exe. The name is kept as typed.
        internal static (Models.WindowTarget Target, Regex? TitleRegex) BuildWindowTarget(
            string? processName, string? windowTitle, string? titleMatchMode)
        {
            var proc = processName?.Trim();
            var target = new Models.WindowTarget
            {
                ProcessName = string.IsNullOrWhiteSpace(proc) ? null : proc,
                WindowTitle = string.IsNullOrWhiteSpace(windowTitle) ? null : windowTitle,
                TitleMatchMode = string.Equals(titleMatchMode, "regex", StringComparison.OrdinalIgnoreCase)
                    ? "regex" : "contains",
            };
            return (target, TrueReplayer.Helpers.WindowMatcher.CompileTitleRegex(target));
        }

        private static (Models.WindowTarget Target, Regex? TitleRegex) BuildWindowTargetFromAction(ActionItem action)
            => BuildWindowTarget(action.WindowProcessName, action.WindowTitle, action.WindowTitleMatchMode);

        // If-Random raw probe: TRUE with probability RandomPercent/100. Stateless, rolls
        // fresh each check (Random.Shared, same source as delay jitter and {random:a-b}).
        // 0 → never, 100 → always. Clamped so a hand-edited out-of-range value is sane.
        private static bool ProbeRandom(ActionItem action)
        {
            int pct = Math.Clamp(action.RandomPercent, 0, 100);
            return Random.Shared.Next(100) < pct;
        }

        // If-Process raw probe: TRUE when a process with the given image name is running,
        // window or not (broader than If-Window). Reuses the process-name field of If-Window
        // and the GetProcessesByName pattern (same as AppIconService). ".exe" stripped since
        // GetProcessesByName wants the bare name.
        private static bool ProbeProcessRunning(ActionItem action)
        {
            var name = action.WindowProcessName?.Trim();
            if (string.IsNullOrEmpty(name)) return false;
            if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                name = name[..^4];
            System.Diagnostics.Process[] procs;
            try { procs = System.Diagnostics.Process.GetProcessesByName(name); }
            catch { return false; }
            try { return procs.Length > 0; }
            finally { foreach (var p in procs) p.Dispose(); }
        }

        // If-Time raw probe: TRUE when local time is inside [TimeStart, TimeEnd] AND today is
        // selected in DaysOfWeek. Empty times = day-only (time check passes). start > end =
        // overnight window (22:00–02:00 → in-window when now ≥ start OR now ≤ end). Local time
        // to match the token engine's {time}. DaysOfWeek 0 = every day.
        private static bool ProbeTimeWindow(ActionItem action)
        {
            var now = DateTime.Now;
            bool dayOk = action.DaysOfWeek == 0 || (action.DaysOfWeek & (1 << (int)now.DayOfWeek)) != 0;
            if (!dayOk) return false;

            bool hasStart = TimeSpan.TryParse(action.TimeStart, System.Globalization.CultureInfo.InvariantCulture, out var start);
            bool hasEnd = TimeSpan.TryParse(action.TimeEnd, System.Globalization.CultureInfo.InvariantCulture, out var end);
            if (!hasStart || !hasEnd) return true; // day-only mode (or partial config) — day already matched

            var t = now.TimeOfDay;
            return start <= end
                ? (t >= start && t <= end)      // normal same-day window
                : (t >= start || t <= end);     // overnight wrap-around
        }

        // If-Variable raw probe: compares the runtime variable named in Key against the
        // resolved operand. Async because the operand runs the full token pipeline (may hit
        // {clipboard}). Missing variable → "". gt/lt coerce to numeric when both sides parse
        // (InvariantCulture); eq/neq/contains are case-insensitive string (house style).
        private async Task<bool> ProbeVariableAsync(ActionItem action, IfProbeContext? ctx)
        {
            var name = action.Key?.Trim();
            if (string.IsNullOrEmpty(name)) return false; // unconfigured
            var lhs = _runtimeVariables.TryGetValue(name.ToLowerInvariant(), out var v) ? v : string.Empty;
            // Hoisted for the whole poll window when the operand carries a stateful token (see
            // HoistStatefulOperandAsync); null there means resolve per tick, which is what keeps a
            // plain {var:other} / {date} operand live. The LHS above is ALWAYS read fresh — it is
            // the value the wait is waiting on.
            var rhs = ctx?.HoistedOperand ?? await ResolveTokens(action.ConditionOperand ?? string.Empty);
            var op = action.ConditionOperator?.ToLowerInvariant() ?? "eq";
            switch (op)
            {
                case "neq":
                    return !string.Equals(lhs, rhs, StringComparison.OrdinalIgnoreCase);
                case "contains":
                    return lhs.IndexOf(rhs, StringComparison.OrdinalIgnoreCase) >= 0;
                case "gt":
                case "lt":
                    bool lok = double.TryParse(lhs, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var ln);
                    bool rok = double.TryParse(rhs, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var rn);
                    if (lok && rok) return op == "gt" ? ln > rn : ln < rn;
                    // Non-numeric → lexical comparison so the operator still means something.
                    int cmp = string.Compare(lhs, rhs, StringComparison.OrdinalIgnoreCase);
                    return op == "gt" ? cmp > 0 : cmp < 0;
                default: // "eq"
                    return string.Equals(lhs, rhs, StringComparison.OrdinalIgnoreCase);
            }
        }

        // If-File raw probe: TRUE when the resolved path exists as a file OR directory.
        // Async so the path can carry {clipboard}/{var}/{date} tokens. Empty → false.
        private async Task<bool> ProbeFileExistsAsync(ActionItem action, IfProbeContext? ctx)
        {
            // Same hoist rule as the Variable operand — see HoistStatefulOperandAsync.
            var path = (ctx?.HoistedFilePath ?? await ResolveTokens(action.FilePath ?? string.Empty)).Trim();
            if (string.IsNullOrEmpty(path)) return false;
            try { return System.IO.File.Exists(path) || System.IO.Directory.Exists(path); }
            catch { return false; } // malformed path (illegal chars, too long) → not found
        }

        // Used by IF rows to decide which branch to take — a SINGLE-SHOT probe (the optional
        // "wait up to N ms for the condition" polling lives in EvaluateConditionWithTimeout above).
        // One screen capture + match (image) or one pixel read (pixel). Cancellation is checked
        // up-front only; the work itself is one Cv2.MatchTemplate / GetPixel call with no
        // interruption point inside it, so a Stop lands at the END of the current probe.
        // COST, measured (5120x1440, template 200x80): a full-screen match is ~541 ms, an
        // ROI-constrained one ~4 ms, GetPixelAt ~0.1 ms. The full-screen number is the one that
        // matters here — it is also the Stop latency on that path, and per ITERATION when the
        // probe is a While guard. It is why NextPollDelayMs paces off the measured cost rather
        // than a constant, and why the Search Region hint in the Sheet leads with the ROI.
        //
        // Returns the EFFECTIVE branch outcome — i.e. ConditionNegate is already applied.
        // The caller treats the return value as "execute TRUE branch?" without needing
        // to know about negation.
        // ctx non-null only inside a timed IF's poll window (EvaluateConditionWithTimeout),
        // carrying the hoisted template Mat / title regex / pixel color for that window; the
        // instant single check arrives with null and the probes resolve everything fresh,
        // exactly as they always did.
        private bool InstantProbe(ActionItem action, IfProbeContext? ctx, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();

            try
            {
                bool rawResult;
                if (string.Equals(action.ConditionType, "ImageFound", StringComparison.OrdinalIgnoreCase))
                {
                    rawResult = ProbeImageFound(action, ctx);
                }
                else if (string.Equals(action.ConditionType, "PixelColorMatch", StringComparison.OrdinalIgnoreCase))
                {
                    rawResult = ProbePixelColorMatch(action, ctx);
                }
                else if (string.Equals(action.ConditionType, "WindowOpen", StringComparison.OrdinalIgnoreCase))
                {
                    rawResult = ProbeWindowOpen(action, ctx);
                }
                else if (string.Equals(action.ConditionType, "Random", StringComparison.OrdinalIgnoreCase))
                {
                    rawResult = ProbeRandom(action);
                }
                else if (string.Equals(action.ConditionType, "ProcessRunning", StringComparison.OrdinalIgnoreCase))
                {
                    rawResult = ProbeProcessRunning(action);
                }
                else if (string.Equals(action.ConditionType, "TimeWindow", StringComparison.OrdinalIgnoreCase))
                {
                    rawResult = ProbeTimeWindow(action);
                }
                else
                {
                    // Unknown / unset ConditionType — return false so the FALSE branch fires.
                    // The load-time validator should also have flagged this, but defending the
                    // engine against a hand-edited typo keeps the replay graceful instead of
                    // throwing on an unrecognized probe family.
                    //
                    // DiagnosticLog, NOT Debug.WriteLine ([Conditional("DEBUG")] — stripped from
                    // every published build): an imported profile with a mistyped conditionType
                    // silently takes the false branch forever, and this was the only trace of it.
                    // Warn, not Info: nothing downstream will ever behave as the author intended.
                    //
                    // ONCE PER BAD FAMILY PER RUN. This is the one former-Debug line that sits on
                    // a POLLED path: a timed condition re-enters here every 50/200 ms, and a While
                    // guard multiplies that by its iteration ceiling — an unguarded Warn would
                    // push tens of thousands of identical lines through a queue that drops at
                    // 4096, i.e. it would delete the rest of the session's log to say one thing.
                    // Keyed on the TYPE, not the row: the message names only the type, so a second
                    // row with the same typo would emit a byte-identical line.
                    if (_unknownConditionTypesWarned.Add(action.ConditionType ?? ""))
                        DiagnosticLog.Warn($"[InstantProbe] Unknown ConditionType '{action.ConditionType}' — treating as false");
                    rawResult = false;
                }

                return action.ConditionNegate ? !rawResult : rawResult;
            }
            catch (OperationCanceledException)
            {
                // Cancellation always propagates regardless of error policy — the user
                // explicitly stopped the replay; surfacing it as "no match" would let the
                // FALSE branch run, which is wrong.
                throw;
            }
            catch (Exception ex)
            {
                DiagnosticLog.Info($"[InstantProbe] Probe error ({action.ConditionType}): {ex.Message}");
                if (string.Equals(action.IfOnProbeError, "Halt", StringComparison.OrdinalIgnoreCase))
                    throw;
                // TreatAsFalse (null / default): raw outcome is false, then apply Negate so
                // the IFNOT semantics still hold (a negated IF whose probe errored still
                // executes its TRUE branch — same as if the image weren't found).
                return action.ConditionNegate;
            }
        }

        // Composes the optional search ROI the same way ExecuteWaitImage does — translated
        // through the CURRENT relative-coord offset so a profile-bound region tracks its
        // target window even when the user has moved the window. Deliberately re-run on
        // every poll tick of a timed IF (never hoisted into IfProbeContext): the window can
        // move during the timeout, and a frozen ROI would keep searching where it used to be.
        // Returns false for the config-impossible state (rel-coords on, target window
        // missing): with IfOnProbeError=Halt this surfaces the error + cancels (same as
        // WaitImage); otherwise the probe silently reads not-matched. Not an exception, so
        // InstantProbe's catch never fires for this path.
        private bool TryComposeIfSearchRegion(ActionItem action, out System.Drawing.Rectangle? searchRegion)
        {
            searchRegion = null;
            if (action.WaitImageSearchW is int sw && action.WaitImageSearchH is int sh && sw > 0 && sh > 0)
            {
                int sx = action.WaitImageSearchX ?? 0;
                int sy = action.WaitImageSearchY ?? 0;
                if (!TryResolveRelativeOffset(out int dx, out int dy))
                {
                    if (string.Equals(action.IfOnProbeError, "Halt", StringComparison.OrdinalIgnoreCase))
                        ReportMissingTargetWindow();
                    return false;
                }
                searchRegion = new System.Drawing.Rectangle(sx + dx, sy + dy, sw, sh);
            }
            return true;
        }

        private bool ProbeImageFound(ActionItem action, IfProbeContext? ctx)
        {
            if (string.IsNullOrEmpty(action.ImagePath)) return false;

            // Same 1.0-is-unreachable clamp as ExecuteWaitImage — a 100%-confidence IF/ImageFound
            // condition would otherwise always read FALSE on a live screen.
            double confidence = action.Confidence > 0 ? Math.Min(action.Confidence, 0.99) : 0.8;

            // Timed-IF path: the template was decoded + converted ONCE by BuildIfProbeContext.
            // A null Mat means the reference image is missing on disk — same raw not-found
            // the context-free path returns below.
            if (ctx != null)
            {
                if (ctx.TemplateMat == null) return false;
                if (!TryComposeIfSearchRegion(action, out var region)) return false;
                bool report = ctx.ReportRegion;   // unusable-region warning: first tick only
                ctx.ReportRegion = false;
                return ImageMatchingService.MatchOnce(ctx.TemplateMat, region, report).Score >= confidence;
            }

            // Executing profile, not the UI's active one — see CurrentExecutingProfileName. With
            // _getProfileName an If/ImageFound inside a RunProfile'd sub-profile always read
            // "not found" (image lives in the sub-profile's folder), forcing the FALSE branch.
            string profileName = CurrentExecutingProfileName;
            var referenceImage = ImageStorageService.LoadReferenceImage(profileName, action.ImagePath);
            if (referenceImage == null) return false;

            try
            {
                if (!TryComposeIfSearchRegion(action, out var searchRegion)) return false;
                var matchResult = ImageMatchingService.MatchOnce(referenceImage, searchRegion);
                return matchResult.Score >= confidence;
            }
            finally
            {
                referenceImage.Dispose();
            }
        }

        private bool ProbePixelColorMatch(ActionItem action, IfProbeContext? ctx)
        {
            if (action.PixelX is not int relPx || action.PixelY is not int relPy) return false;
            // Timed-IF path reads the hex parsed once into the context (null there = the same
            // unparseable-color false the fresh parse yields).
            var target = ctx != null ? ctx.PixelColor : PixelColorService.ParseHex(action.PixelColor);
            if (target == null) return false;

            if (!TryResolveRelativeOffset(out int dx, out int dy))
            {
                if (string.Equals(action.IfOnProbeError, "Halt", StringComparison.OrdinalIgnoreCase))
                    ReportMissingTargetWindow();
                return false;
            }
            int px = relPx + dx;
            int py = relPy + dy;

            var sampled = PixelColorService.GetPixelAt(px, py);
            if (sampled is not System.Drawing.Color s) return false;
            return PixelColorService.MatchesWithinTolerance(s, target.Value, action.PixelTolerance);
        }

        private void SaveTimeoutScreenshot(ActionItem action)
        {
            // Diagnostic-only — never let a screenshot failure bubble up and break the replay.
            try
            {
                var dir = System.IO.Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "TrueReplayer", "Debug");
                System.IO.Directory.CreateDirectory(dir);

                var refName = System.IO.Path.GetFileNameWithoutExtension(action.ImagePath ?? "unknown");
                // Milliseconds in the stamp: at second resolution two misses of the SAME reference
                // inside one second overwrote each other, which also made "the newest N" ambiguous
                // for the prune below. A timeout normally takes >= 1 s, but the reference-missing
                // path returns instantly and can genuinely fire twice in a second.
                var ts = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff");
                using var screen = ScreenCaptureService.CaptureVirtualScreen();
                var outPath = System.IO.Path.Combine(dir, $"waitimage-timeout-{refName}-{ts}.png");
                screen.Save(outPath, System.Drawing.Imaging.ImageFormat.Png);
                DiagnosticLog.Info($"[WaitImage] Timeout screenshot saved: {outPath}");
                PruneTimeoutScreenshots(dir, MaxTimeoutScreenshots);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Info($"[WaitImage] Failed to save timeout screenshot: {ex.Message}");
            }
        }

        // How many timeout screenshots survive in %APPDATA%\TrueReplayer\Debug. Same posture as
        // DiagnosticLog's MaxSessionFiles: a diagnostic artefact is worth keeping until it is
        // stale, never worth unbounded disk. Desktop-sized PNGs, so the count is small.
        internal const int MaxTimeoutScreenshots = 20;

        /// <summary>
        /// Keeps only the <paramref name="keep"/> newest timeout screenshots in
        /// <paramref name="dir"/>, deleting the rest. Matches ONLY the "waitimage-timeout-*.png"
        /// files this class writes — the Debug folder is a shared drop point and a broader sweep
        /// would delete artefacts that belong to someone else.
        ///
        /// Never throws: it runs inside SaveTimeoutScreenshot's diagnostic-only try, and a failed
        /// cleanup must not be able to break a replay. A file another process has open is skipped
        /// individually rather than aborting the whole pass.
        /// </summary>
        internal static void PruneTimeoutScreenshots(string dir, int keep)
        {
            if (keep < 0) keep = 0;
            try
            {
                var files = System.IO.Directory.GetFiles(dir, "waitimage-timeout-*.png");
                if (files.Length <= keep) return;
                // Timestamps are read ONCE into the list rather than from inside the comparer:
                // Sort calls the comparer O(n log n) times and each call would be a fresh stat.
                var stamped = new List<(string Path, DateTime When)>(files.Length);
                foreach (var f in files)
                {
                    try { stamped.Add((f, System.IO.File.GetLastWriteTimeUtc(f))); }
                    catch { /* vanished between the enumerate and the stat — nothing to prune */ }
                }
                stamped.Sort((a, b) => b.When.CompareTo(a.When));   // newest first
                for (int i = keep; i < stamped.Count; i++)
                {
                    try { System.IO.File.Delete(stamped[i].Path); }
                    catch { /* locked / already gone — the next pass retries */ }
                }
            }
            catch { /* folder unreadable — diagnostic-only, stay silent */ }
        }

        /// <summary>
        /// Pauses replay until either the configured resume hotkey is pressed, or the timeout
        /// expires, or the replay is cancelled. The hotkey is suppressed (not sent to the target
        /// app). If both fields are empty/zero, this is a no-op so the replay continues immediately.
        /// </summary>
        private async Task ExecutePause(ActionItem action, CancellationToken token)
        {
            string? hotkey = string.IsNullOrWhiteSpace(action.Key) ? null : action.Key.Trim();
            int timeoutMs = action.Timeout > 0 ? action.Timeout : 0;
            if (hotkey == null && timeoutMs == 0) return;

            var resumeTcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

            dispatcherQueue.TryEnqueue(() => OnReplayPaused?.Invoke(hotkey ?? "", timeoutMs));

            if (hotkey != null)
                InputHookManager.SetReplayPauseListener(hotkey, () => resumeTcs.TrySetResult(true));

            // Time spent sitting in a Pause action is not time the macro took. The status bar's
            // live clock already subtracts it, so the duration the run REPORTS has to subtract it
            // too, or a run paused for two minutes ends by printing a number the user never saw on
            // screen.
            var pausedWatch = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                var resumeTask = resumeTcs.Task;
                var timeoutTask = timeoutMs > 0 ? Task.Delay(timeoutMs, token) : Task.Delay(Timeout.Infinite, token);
                await Task.WhenAny(resumeTask, timeoutTask);
                token.ThrowIfCancellationRequested();
            }
            finally
            {
                pausedWatch.Stop();
                lock (_runSteps) _runPausedAccumMs += pausedWatch.ElapsedMilliseconds;
                InputHookManager.ClearReplayPauseListener();
                dispatcherQueue.TryEnqueue(() => OnReplayResumed?.Invoke());
            }
        }

        private static readonly Dictionary<string, ushort> SpecialKeyPlaceholders = new(StringComparer.OrdinalIgnoreCase)
        {
            ["{enter}"] = 0x0D,      // VK_RETURN
            ["{tab}"] = 0x09,        // VK_TAB
            ["{space}"] = 0x20,      // VK_SPACE
            ["{backspace}"] = 0x08,  // VK_BACK
            ["{delete}"] = 0x2E,     // VK_DELETE
            ["{escape}"] = 0x1B,     // VK_ESCAPE
            ["{esc}"] = 0x1B,        // alias for {escape} — matches BrowserType chip naming
            ["{home}"] = 0x24,       // VK_HOME
            ["{end}"] = 0x23,        // VK_END
            ["{pageup}"] = 0x21,     // VK_PRIOR
            ["{pagedown}"] = 0x22,   // VK_NEXT
            ["{up}"] = 0x26,         // VK_UP
            ["{down}"] = 0x28,       // VK_DOWN
            ["{left}"] = 0x25,       // VK_LEFT
            ["{right}"] = 0x27,      // VK_RIGHT
        };

        // Sentinels used to mark literal '{' / '}' produced by placeholder substitution
        // (e.g. clipboard content). Stops ParseSendTextSegments from re-interpreting them
        // as another placeholder. Stripped back to '{' / '}' when text segments are emitted.
        private const char OpenBraceSentinel = '';
        private const char CloseBraceSentinel = '';

        private struct SendTextSegment
        {
            public string? Text;
            public ushort? VkCode;
            public int? DelayMs;
        }

        private static List<SendTextSegment> ParseSendTextSegments(string text)
        {
            var segments = new List<SendTextSegment>();
            int i = 0;

            while (i < text.Length)
            {
                char ch = text[i];

                // Sentinels stand in for literal '{' / '}' that came from placeholder substitution
                // (e.g. clipboard content). Emit as plain text — never re-parse as a placeholder.
                if (ch == OpenBraceSentinel)
                {
                    AppendTextChar(segments, '{');
                    i++;
                    continue;
                }
                if (ch == CloseBraceSentinel)
                {
                    AppendTextChar(segments, '}');
                    i++;
                    continue;
                }

                if (ch == '{')
                {
                    // Find closing brace (skip sentinel close-braces — they belong to substituted text)
                    int closeBrace = -1;
                    for (int j = i + 1; j < text.Length; j++)
                    {
                        if (text[j] == '}') { closeBrace = j; break; }
                        if (text[j] == OpenBraceSentinel || text[j] == CloseBraceSentinel)
                        {
                            // Sentinel inside what looked like a placeholder — bail out, treat '{' as literal
                            break;
                        }
                    }
                    if (closeBrace == -1)
                    {
                        AppendTextChar(segments, ch);
                        i++;
                        continue;
                    }

                    string inner = text.Substring(i + 1, closeBrace - i - 1); // e.g. "enter", "enter:5", "delay:500"
                    string name = inner;
                    int colonIdx = inner.IndexOf(':');
                    bool hasValidParam = false;
                    int paramValue = 0;
                    if (colonIdx >= 0)
                    {
                        name = inner.Substring(0, colonIdx);
                        if (int.TryParse(inner.Substring(colonIdx + 1), out int n) && n > 0)
                        {
                            hasValidParam = true;
                            paramValue = n;
                        }
                    }

                    // {delay:N} — pause during replay. Invalid/missing N → treat as default (500 ms),
                    // not as a 1 ms no-op. Cap at 60 s.
                    if (name.Equals("delay", StringComparison.OrdinalIgnoreCase))
                    {
                        int delayMs = hasValidParam ? Math.Min(paramValue, 60000) : 500;
                        segments.Add(new SendTextSegment { DelayMs = delayMs });
                        i = closeBrace + 1;
                        continue;
                    }

                    // {key} or {key:N} — special key with optional repeat. Invalid N → 1 press. Cap at 100.
                    string keyPlaceholder = "{" + name + "}";
                    if (SpecialKeyPlaceholders.TryGetValue(keyPlaceholder, out ushort vk))
                    {
                        int count = hasValidParam ? Math.Min(paramValue, 100) : 1;
                        for (int r = 0; r < count; r++)
                            segments.Add(new SendTextSegment { VkCode = vk });
                        i = closeBrace + 1;
                        continue;
                    }

                    // Unknown placeholder, treat '{' as regular text
                    AppendTextChar(segments, ch);
                    i++;
                }
                else
                {
                    AppendTextChar(segments, ch);
                    i++;
                }
            }

            return segments;
        }

        private static void AppendTextChar(List<SendTextSegment> segments, char c)
        {
            if (segments.Count > 0 && segments[^1].Text != null)
            {
                var last = segments[^1];
                last.Text += c;
                segments[^1] = last;
            }
            else
            {
                segments.Add(new SendTextSegment { Text = c.ToString() });
            }
        }

        // Escape '{' and '}' in substituted placeholder values so the parser does not re-interpret
        // them as another placeholder (e.g. clipboard content "{enter}" should stay as text).
        private static string EscapeBracesForParser(string value)
        {
            if (string.IsNullOrEmpty(value)) return value ?? string.Empty;
            if (value.IndexOf('{') < 0 && value.IndexOf('}') < 0) return value;
            return value.Replace('{', OpenBraceSentinel).Replace('}', CloseBraceSentinel);
        }

        // Inverse of EscapeBracesForParser — restore real '{' / '}' before any further use of the text.
        internal static string UnescapeBraceSentinels(string value)
        {
            if (string.IsNullOrEmpty(value)) return value ?? string.Empty;
            if (value.IndexOf(OpenBraceSentinel) < 0 && value.IndexOf(CloseBraceSentinel) < 0) return value;
            return value.Replace(OpenBraceSentinel, '{').Replace(CloseBraceSentinel, '}');
        }

        // VK codes that must carry KEYEVENTF_EXTENDEDKEY when replayed via SendInput. These keys
        // share their scancode with a numpad twin (Delete↔Num. , Insert↔Num0, Home↔Num7, etc.);
        // the E0 prefix — Windows' KEYEVENTF_EXTENDEDKEY flag — is what distinguishes them on
        // hardware. Without it, Delete is delivered as scancode 0x53 with no E0 → Windows treats
        // it as Numpad Decimal → produces "." instead of deleting. Same shape for the others.
        // PrintScreen (0x2C) and Pause (0x13) have non-trivial scancode sequences and are
        // intentionally omitted — replaying them via SendInput needs special handling.
        private static readonly HashSet<ushort> ExtendedVkCodes = new()
        {
            0x21, 0x22, 0x23, 0x24, // PgUp, PgDn, End, Home
            0x25, 0x26, 0x27, 0x28, // Left, Up, Right, Down
            0x2D, 0x2E,             // Insert, Delete
            0x5B, 0x5C, 0x5D,       // LWin, RWin, Apps (context menu)
            0x6F,                   // NumDivide (numpad /)
            0x90,                   // NumLock
            0xA3, 0xA5              // RControl, RAlt (RMenu)
        };

        private void SimulateKeyPress(ushort vk)
        {
            ushort scan = (ushort)NativeMethods.MapVirtualKey(vk, 0);
            bool isExtended = ExtendedVkCodes.Contains(vk);
            uint downFlags = NativeMethods.KEYEVENTF_SCANCODE;
            if (isExtended) downFlags |= NativeMethods.KEYEVENTF_EXTENDEDKEY;
            uint upFlags = downFlags | NativeMethods.KEYEVENTF_KEYUP;
            // wVk is ignored when KEYEVENTF_SCANCODE is set, but kept populated for non-extended
            // keys so any listener that ignores the flag still sees something sensible. Extended
            // keys send 0 to mirror the long-standing arrow-key behaviour.
            ushort effectiveVk = isExtended ? (ushort)0 : vk;

            var inputs = new NativeMethods.INPUT[]
            {
                new() { type = NativeMethods.INPUT_KEYBOARD, U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = effectiveVk, wScan = scan, dwFlags = downFlags } } },
                new() { type = NativeMethods.INPUT_KEYBOARD, U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = effectiveVk, wScan = scan, dwFlags = upFlags } } },
            };
            NativeMethods.SendInput((uint)inputs.Length, inputs, NativeMethods.InputSize);
        }

        // Events per SendInput batch on the unpaced path. SendInput's documented non-interleave
        // guarantee ("not interspersed with other keyboard or mouse input events inserted either
        // by the user or by other calls to SendInput") is per CALL, which matters here because the
        // clicker runs on its own thread and shares _simInputLock. ~256 events keeps whole words
        // atomic while still letting Stop land within a few ms on a long payload.
        private const int TypeBatchEvents = 256;

        /// <summary>
        /// Types <paramref name="text"/> as real keystrokes — no clipboard, no Ctrl+V. The
        /// transport for SendText rows with SendMethod == "type".
        ///
        /// SCANCODE FIRST, KEYEVENTF_UNICODE only as the per-character fallback. Every other
        /// injection site in this app sends KEYEVENTF_SCANCODE, and that is the mechanism a target
        /// reading Raw Input / DirectInput actually sees; a unicode packet sets wVk = 0 and puts a
        /// CHARACTER in wScan, becoming text only after the target calls TranslateMessage — right
        /// for Notepad and browsers, potentially invisible to the target class this feature exists
        /// for. The packet path covers what a layout cannot produce at all (emoji, →, é on a US
        /// layout), where it is the only option.
        ///
        /// LAYOUT: resolved against the FOREGROUND window's layout, not ours. We emit a scancode
        /// and the target re-interprets it through ITS layout, so resolving against
        /// KeyUtils.ActiveLayout would type ç as \ whenever the two differ. (KeyUtils' own "the
        /// layout has to be ours" rule is about resolving RECORDED input — the opposite direction.)
        ///
        /// KeyUtils.CharToVkCurrentLayout is deliberately NOT reused: it does
        /// vk = (ushort)(result &amp; 0xFF), masking off VkKeyScanEx's high byte — the SHIFT STATE —
        /// so it cannot tell 'H' from 'h' and would type every capital in lower case.
        ///
        /// NEWLINES ARE NOT TYPED. WM_CHAR 0x0A does not break a line in a classic Win32 EDIT (the
        /// typing-side twin of PasteTextViaClipboard's LF→CRLF normalization) and browsers handle
        /// Enter on keydown, not on char. Every \r\n / \r / \n becomes a real VK_RETURN press
        /// through SimulateKeyPress — which also means a multi-line typed message SENDS N times in
        /// a chat box, where a pasted one sends once.
        ///
        /// EVERY OTHER C0 CONTROL CHARACTER (&lt; 0x20) GOES OUT AS A UNICODE PACKET, never through
        /// VkKeyScanEx. This is not a preference, it is a correctness gate: VkKeyScanEx resolves
        /// them to their CONTROL-KEY origin, so the layout would hand back a real chord and the
        /// text would execute instead of being typed. Measured — \t → VK_TAB (moves focus out of
        /// the field, so the rest of the payload lands in the WRONG control), \b → VK_BACK (erases
        /// what was already typed), \x1B → VK_ESCAPE (closes the dialog being filled), \v → Ctrl+K,
        /// \x1A → Ctrl+Z. These reach a payload through {clipboard}/{var}/{row:col}, not through
        /// the editor: a tab-separated row copied out of a spreadsheet is the everyday case.
        ///
        /// What the packet then does is the TARGET's business, and it is not always nothing —
        /// measured against a real Win32 EDIT: "Nome\tValor\tTotal" arrives with the tabs as
        /// LITERAL CHARACTERS and focus never leaves the field (which is the whole win), while
        /// "ab\bcd" arrives as "acd" because that control interprets WM_CHAR 0x08 as a backspace.
        /// So the promise this gate makes is precise and narrow: typing never fires the control
        /// KEY. It does not promise the character is inert. A payload that wants a real Tab
        /// keystroke has the explicit {tab} chip. (The brace sentinels U+0001/U+0002 never arrive
        /// here — UnescapeBraceSentinels runs on the segment before this is called.)
        /// </summary>
        private async Task TypeTextViaSendInput(string text, int charDelayMs, CancellationToken token)
        {
            if (string.IsNullOrEmpty(text)) return;

            IntPtr hkl = ForegroundKeyboardLayout();
            var batch = new List<NativeMethods.INPUT>(TypeBatchEvents + 8);

            for (int i = 0; i < text.Length; i++)
            {
                if (token.IsCancellationRequested) { FlushTypedInputs(batch); return; }
                char ch = text[i];

                if (ch == '\r' || ch == '\n')
                {
                    FlushTypedInputs(batch);                       // ordering: never reorder a run
                    SimulateKeyPress(0x0D);                        // VK_RETURN. Deliberately NOT in
                    if (ch == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;  // Extended-
                    await Task.Delay(30, token);                   // VkCodes: the E0 twin is NUMPAD.
                    continue;                                      // 30 ms mirrors the VkCode arm.
                }

                // Control characters never reach the layout: see the C0 paragraph in the docblock.
                // Gated BEFORE TryResolveTypedKey rather than inside it, because that helper answers
                // "can this layout produce the character" — and for \t the honest answer is yes,
                // via a key whose EFFECT is to leave the field. The refusal is this sink's policy,
                // not the layout's fact, so it belongs here, where the alternative (packet) exists.
                // Written as a statement rather than `ch >= 0x20 && TryResolve(...)`: `out` values
                // from a short-circuited && are only definitely assigned when the whole expression
                // is TRUE, so the terse form does not compile.
                ushort vk = 0;
                bool shift = false, ctrl = false, alt = false;
                bool resolved = ch >= 0x20 && TryResolveTypedKey(ch, hkl, out vk, out shift, out ctrl, out alt);

                if (charDelayMs > 0)
                {
                    // PACED: the delay is BOTH the key-hold and the gap, so a frame-sampled target
                    // can observe the press. The up half is in a finally — this is the only path
                    // where a cancellation can land between down and up, and a stuck modifier is
                    // the one thing a typing run must never leave behind.
                    FlushTypedInputs(batch);
                    var down = new List<NativeMethods.INPUT>(8);
                    var up = new List<NativeMethods.INPUT>(8);
                    if (resolved)
                    {
                        if (shift) AppendScanKey(down, 0x10, false, hkl);
                        if (ctrl)  AppendScanKey(down, 0x11, false, hkl);
                        if (alt)   AppendScanKey(down, 0x12, false, hkl);
                        AppendScanKey(down, vk, false, hkl);
                        AppendScanKey(up, vk, true, hkl);
                        if (alt)   AppendScanKey(up, 0x12, true, hkl);
                        if (ctrl)  AppendScanKey(up, 0x11, true, hkl);
                        if (shift) AppendScanKey(up, 0x10, true, hkl);
                    }
                    else { AppendPacket(down, ch, false); AppendPacket(up, ch, true); }

                    try
                    {
                        FlushTypedInputs(down);
                        await Task.Delay(charDelayMs, token);      // never Thread.Sleep here
                    }
                    finally { FlushTypedInputs(up); }
                    await Task.Delay(charDelayMs, token);
                    continue;
                }

                // UNPACED: down+up ride the same array, so nothing can ever be left held and none
                // of this needs _simulatedKeysDown bookkeeping — the same safety property that lets
                // SimulateKeyPress skip the tracker.
                if (resolved)
                {
                    if (shift) AppendScanKey(batch, 0x10, false, hkl);
                    if (ctrl)  AppendScanKey(batch, 0x11, false, hkl);
                    if (alt)   AppendScanKey(batch, 0x12, false, hkl);
                    AppendScanKey(batch, vk, false, hkl);
                    AppendScanKey(batch, vk, true, hkl);
                    if (alt)   AppendScanKey(batch, 0x12, true, hkl);
                    if (ctrl)  AppendScanKey(batch, 0x11, true, hkl);
                    if (shift) AppendScanKey(batch, 0x10, true, hkl);
                }
                else
                {
                    // TWO events per UTF-16 CODE UNIT, not per rune: a non-BMP character (emoji) is
                    // a surrogate pair and each half is its own INPUT, in order. C# strings are
                    // already UTF-16, so the naive char loop is the CORRECT one here and a
                    // Rune/StringInfo-aware version would be the broken one.
                    AppendPacket(batch, ch, false);
                    AppendPacket(batch, ch, true);
                }

                if (batch.Count >= TypeBatchEvents)
                {
                    FlushTypedInputs(batch);
                    await Task.Yield();   // let the target's message pump drain between batches
                }
            }
            FlushTypedInputs(batch);
        }

        // The foreground window's keyboard layout, falling back to our own thread's. We emit
        // scancodes; the TARGET decides what character they produce.
        private static IntPtr ForegroundKeyboardLayout()
        {
            try
            {
                IntPtr hwnd = NativeMethods.GetForegroundWindow();
                if (hwnd != IntPtr.Zero)
                {
                    uint tid = NativeMethods.GetWindowThreadProcessId(hwnd, out _);
                    if (tid != 0)
                    {
                        IntPtr hkl = NativeMethods.GetKeyboardLayout(tid);
                        if (hkl != IntPtr.Zero) return hkl;
                    }
                }
            }
            catch { /* fall through to our own layout */ }
            // Fully qualified: this file's namespace is TrueReplayer.Services and it does not (and
            // should not) pull in all of TrueReplayer.Helpers for one property.
            return TrueReplayer.Helpers.KeyUtils.ActiveLayout;
        }

        // True when the character exists on the target's layout as a key press. VkKeyScanEx returns
        // the vk in the LOW byte and the shift state in the HIGH byte (1 = Shift, 2 = Ctrl,
        // 4 = Alt; Ctrl+Alt together is the AltGr signature — see KeyUtils.LayoutHasAltGr). -1
        // means "not on this layout"; anything in the high byte beyond Shift/Ctrl/Alt is a layout
        // state this app does not drive (Hankaku, Kana), so we packet it rather than guess.
        //
        // THE -1 CHECK IS NOT ENOUGH, and believing it was is a silent-corruption bug.
        // A character the layout cannot produce can still come back as a perfectly valid mapping —
        // for a DIFFERENT character. Measured 2026-09-01: U+D83D and U+DE00 (the halves of an
        // emoji) and U+2192 '→' each returned 0x01BF, which is Shift+VK_OEM_2 = '?'. Trusting that
        // would type "?" for every such character and the packet fallback, the whole reason it
        // exists, would NEVER fire.
        //
        // The 0x01BF above was BEST-FIT ANSI SUBSTITUTION, and the mechanism is worth naming
        // precisely because the first diagnosis here blamed the wrong layer: it is the P/Invoke
        // MARSHALLER, not the API. NativeMethods.VkKeyScanEx now declares CharSet.Unicode and so
        // binds VkKeyScanExW, which answers 0xFFFF for those three; before that it bound the ANSI
        // entry point, the char was best-fitted to '?' on the way in, and the API faithfully
        // scanned the '?' it was handed. The round-trip below is what caught it and is what still
        // guards it — do not delete it now that the CharSet is right: a layout can legitimately map
        // two different characters through one key (dead keys, AltGr chords), so "VkKeyScanEx
        // answered" has never implied "answered about the character we asked for".
        //
        // So the answer is ROUND-TRIP VERIFIED against the same layout: press the resolved key with
        // the resolved modifiers and confirm the layout hands back the character we asked for.
        // wFlags bit 2 (0x4) is "do not modify keyboard state" — without it this call would consume
        // and re-arm the layout's dead-key latch as a side effect of merely asking a question.
        private static bool TryResolveTypedKey(char ch, IntPtr hkl, out ushort vk, out bool shift, out bool ctrl, out bool alt)
        {
            vk = 0; shift = ctrl = alt = false;
            short r;
            try { r = NativeMethods.VkKeyScanEx(ch, hkl); } catch { return false; }
            if (r == -1) return false;
            int state = (r >> 8) & 0xFF;
            if ((state & ~0x07) != 0) return false;
            ushort candidate = (ushort)(r & 0xFF);
            if (candidate == 0) return false;
            bool s = (state & 0x01) != 0, c = (state & 0x02) != 0, a = (state & 0x04) != 0;

            var keyState = new byte[256];
            if (s) keyState[0x10] = 0x80;   // VK_SHIFT
            if (c) keyState[0x11] = 0x80;   // VK_CONTROL
            if (a) keyState[0x12] = 0x80;   // VK_MENU
            var buf = new System.Text.StringBuilder(8);
            int n;
            try
            {
                n = NativeMethods.ToUnicodeEx(candidate, NativeMethods.MapVirtualKeyEx(candidate, 0, hkl),
                                              keyState, buf, buf.Capacity, 0x4, hkl);
            }
            catch { return false; }
            // n < 0 is a dead key (é on an international layout is two keystrokes, not one); n == 0
            // is no translation. Both mean "not a single key press", which is all this path can emit.
            if (n != 1 || buf.Length < 1 || buf[0] != ch) return false;

            vk = candidate; shift = s; ctrl = c; alt = a;
            return true;
        }

        // hkl is the TARGET's layout, and passing it is the whole point: the VK handed in was
        // resolved against that layout (VkKeyScanEx + the ToUnicodeEx round-trip), so translating
        // it back to a scancode against OURS would break the chain the moment the two differ.
        // Measured with a de-DE target: 4 characters come out wrong, 'z' types as 'y'; fr-FR: 10,
        // 'a' types as 'q'. Both layouts are QWERTZ/AZERTY — every QWERTY layout (en-US, pt-BR
        // ABNT2) agrees on these codes, which is why the bug was invisible here.
        // SimulateKeyPress deliberately keeps the layout-free MapVirtualKey: it serves the whole
        // app, where the VK is a NAMED key ({enter}, a hotkey) rather than one resolved against a
        // foreign layout, and there our own layout is the right frame.
        private static void AppendScanKey(List<NativeMethods.INPUT> list, ushort vk, bool up, IntPtr hkl)
        {
            ushort scan = (ushort)NativeMethods.MapVirtualKeyEx(vk, 0, hkl);
            bool isExtended = ExtendedVkCodes.Contains(vk);
            uint flags = NativeMethods.KEYEVENTF_SCANCODE;
            if (isExtended) flags |= NativeMethods.KEYEVENTF_EXTENDEDKEY;
            if (up) flags |= NativeMethods.KEYEVENTF_KEYUP;
            ushort effectiveVk = isExtended ? (ushort)0 : vk;   // mirrors SimulateKeyPress exactly
            list.Add(new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_KEYBOARD,
                U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = effectiveVk, wScan = scan, dwFlags = flags } }
            });
        }

        private static void AppendPacket(List<NativeMethods.INPUT> list, char unit, bool up)
        {
            uint flags = NativeMethods.KEYEVENTF_UNICODE | (up ? NativeMethods.KEYEVENTF_KEYUP : 0u);
            list.Add(new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_KEYBOARD,
                // wVk MUST be 0 for KEYEVENTF_UNICODE, and the flag must never be OR'd with
                // KEYEVENTF_SCANCODE — do not "harmonize" this with AppendScanKey.
                U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = 0, wScan = unit, dwFlags = flags } }
            });
        }

        // Shares _simInputLock with the clicker thread and ResetKeyState, but registers NOTHING in
        // _simulatedKeysDown: on the unpaced path down+up ride one array, and on the paced path the
        // up half is in a finally. SendInput's return is discarded at every other site here; it is
        // read on this one because a typed run is long and a rejected batch is otherwise
        // indistinguishable from success. A NONZERO return is NOT proof of delivery — measured
        // 2026-08-08, SendInput returned 1 against an elevated foreground window and the event
        // never entered the input stream.
        private void FlushTypedInputs(List<NativeMethods.INPUT> batch)
        {
            if (batch.Count == 0) return;
            var arr = batch.ToArray();
            uint sent;
            lock (_simInputLock) sent = NativeMethods.SendInput((uint)arr.Length, arr, NativeMethods.InputSize);
            if (sent != arr.Length)
                DiagnosticLog.Warn($"Typed text: SendInput accepted {sent}/{arr.Length} events (blocked input, or a higher-integrity foreground window)");
            batch.Clear();
        }

        private async Task PasteTextViaClipboard(string text, string? html, CancellationToken token)
        {
            // SEC: KeyHtml is untrusted markup (a foreign/hand-edited .trprofile could carry a tracking
            // beacon, hidden text, or a javascript:/file: link) that the paste TARGET interprets. Scrub
            // it to the editor-producible allowlist at this single choke point — reader-side covers ALL
            // provenance (import, hand-edited profile JSON on disk, and profiles imported before the
            // sanitizer shipped), which an import-only gate would miss. Sanitize returns null on an
            // empty/hostile result or a parse error, so we fail CLOSED to plain text and never emit raw
            // markup. Cost is negligible against the two Task.Delay(50) + SendInput already on this path.
            // NOT done in PrepareRichHtmlForSend: that runs pre-token-resolution, so it wouldn't see the
            // final bytes (resolution itself can't inject — htmlEncodeSubstitution is on — but the sink
            // is where the truly-final CF_HTML string exists).
            if (!string.IsNullOrEmpty(html))
                html = HtmlSanitizer.Sanitize(html);
            // CF_UNICODETEXT convention is CRLF, and classic Win32 EDIT / WinForms
            // multiline targets do NOT break lines on a lone LF. The list modifiers
            // (sort/range/lines/dedupe/reverse) emit LF-joined text — normalize any
            // bare LF back to CRLF before it hits the clipboard. Browser-path text
            // never routes through here, so LF-tolerant consumers are unaffected.
            // The HTML flavor is deliberately NOT normalized — markup needs no CRLF.
            text = text.Replace("\r\n", "\n").Replace("\n", "\r\n");
            // The previous segment's Ctrl+V may not have been read yet — see PasteSettleMs.
            await WaitPasteSettleAsync(token);
            var tcs = new TaskCompletionSource<bool>();
            if (!dispatcherQueue.TryEnqueue(() =>
            {
                try
                {
                    var dataPackage = new Windows.ApplicationModel.DataTransfer.DataPackage();
                    dataPackage.SetText(text);
                    // Rich flavor: both formats ride the same package and the paste TARGET
                    // negotiates — Gmail/Word/contenteditable take the HTML, Notepad takes the
                    // text. HtmlFormatHelper writes the CF_HTML header (StartHTML/EndHTML byte
                    // offsets) for us — same pattern as ClipboardService.CopyActions.
                    if (!string.IsNullOrEmpty(html))
                        dataPackage.SetHtmlFormat(Windows.ApplicationModel.DataTransfer.HtmlFormatHelper.CreateHtmlFormat(html));
                    Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dataPackage);
                    tcs.TrySetResult(true);   // Try: a Stop may already have resolved it (below)
                }
                catch
                {
                    tcs.TrySetResult(false);
                }
            }))
            {
                // Queue shut down (app closing) — unblock the awaiter; the false result bails below.
                tcs.TrySetResult(false);
            }

            // Stop reaches this wait too. A busy or wedged UI thread used to hold the run here, past
            // Stop, for as long as it took to get to the queued write.
            bool written;
            using (token.Register(() => tcs.TrySetResult(false)))
                written = await tcs.Task;
            if (!written || token.IsCancellationRequested) return;

            await Task.Delay(50, token);

            ushort vkCtrl = 0x11;
            ushort vkV = 0x56;
            ushort scanCtrl = (ushort)NativeMethods.MapVirtualKey(vkCtrl, 0);
            ushort scanV = (ushort)NativeMethods.MapVirtualKey(vkV, 0);

            var inputs = new NativeMethods.INPUT[]
            {
                new() { type = NativeMethods.INPUT_KEYBOARD, U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = vkCtrl, wScan = scanCtrl, dwFlags = NativeMethods.KEYEVENTF_SCANCODE } } },
                new() { type = NativeMethods.INPUT_KEYBOARD, U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = vkV, wScan = scanV, dwFlags = NativeMethods.KEYEVENTF_SCANCODE } } },
                new() { type = NativeMethods.INPUT_KEYBOARD, U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = vkV, wScan = scanV, dwFlags = NativeMethods.KEYEVENTF_KEYUP | NativeMethods.KEYEVENTF_SCANCODE } } },
                new() { type = NativeMethods.INPUT_KEYBOARD, U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = vkCtrl, wScan = scanCtrl, dwFlags = NativeMethods.KEYEVENTF_KEYUP | NativeMethods.KEYEVENTF_SCANCODE } } },
            };

            NativeMethods.SendInput((uint)inputs.Length, inputs, NativeMethods.InputSize);
            _lastPasteTicks = Environment.TickCount64;
            await Task.Delay(50, token);
        }

        // How long the text we pasted stays on the clipboard after its Ctrl+V before anything of
        // ours replaces it — the next segment's paste, or the restore of the user's own clipboard.
        // Nothing tells us the target has READ it: the Ctrl+V is only queued input, and a busy
        // Electron app, a browser whose page is working, or an RDP/VM window forwarding the paste
        // reads the clipboard whenever it gets to it. The restore used to follow the Ctrl+V after
        // 50 ms, and a target that read later pasted the user's OLD clipboard — whatever they had
        // copied before the run, a password included — reported as a successful SendText. The
        // clipboard sequence number is no such signal either (it counts writes, and a read is not
        // one). So a fixed floor, the order of what text expanders ship as their restore delay:
        // ~250 ms more per paste-mode SendText, against a leak of the user's clipboard.
        private const int PasteSettleMs = 300;
        // Environment.TickCount64 of the last injected Ctrl+V. 0 never waits: the tick count is
        // milliseconds since boot.
        private long _lastPasteTicks;

        private async Task WaitPasteSettleAsync(CancellationToken token)
        {
            long wait = PasteSettleMs - (Environment.TickCount64 - _lastPasteTicks);
            if (wait > 0) await Task.Delay((int)wait, token);
        }

        // Replay handler for the Keystroke action type. Parses a "+"-joined combo like
        // "Ctrl+Shift+T" or "Alt+Tab" and emits the proper modifier-down → key-down →
        // key-up → modifier-up sequence. The modifiers are released in REVERSE order
        // (last-pressed-first-released) which is what physical typing produces and what
        // Windows shortcut handlers expect.
        //
        // A short Thread.Sleep(10) sits between the modifier-down chain and the key tap
        // so the target app has a frame to register the modifier state before the key
        // event arrives. Without it, fast apps (some games, terminals) can drop the
        // modifier from their state machine and treat the keystroke as if only the key
        // was pressed bare. 10 ms is below human-perceptible latency.
        // Keystroke / KeyDown / KeyUp / HoldKey: the Key field accepts the same tokens
        // as the text fields ({var:name}, {clipboard}, {random:a-b}, …). Resolved here,
        // BEFORE SimulateKeystroke's '+' split, so a variable holding a whole combo
        // ("Ctrl+V") works. Plain keys (no '{') never touch the async resolver — the
        // hot path in tight repeat loops stays synchronous. escapeBraces:false — the
        // resolved value must remain a literal key name; ParseSendTextSegments never
        // runs on this path.
        private async Task<string> ResolveKeyTokens(string key)
        {
            if (string.IsNullOrEmpty(key) || key.IndexOf('{') < 0) return key;
            var resolved = (await ResolveTokens(key)).Trim();
            if (resolved.Length == 0)
                DiagnosticLog.Warn($"Key '{key}' resolved to empty — press skipped");
            return resolved;
        }

        // KeyDown resolutions awaiting their KeyUp, keyed by the RAW (token) key text.
        // Guarantees a down/up pair with identical token text presses and releases the
        // SAME key even when the token would resolve differently by the KeyUp row.
        //
        // NOT readonly: HandleRunProfile swaps in a fresh map for the duration of a chained
        // sub-profile and restores the caller's afterwards — the same save/replace/restore the
        // {rownext} cursors already use. Keying by RAW token text is what makes the isolation
        // necessary: parent and sub writing the same literal "{var:K}" collided in one shared
        // dictionary across call levels.
        private Dictionary<string, string> _pendingTokenKeyDowns = new(StringComparer.OrdinalIgnoreCase);

        // Last key SimulateKey warned about — dedupes the unrecognizable-key warning so
        // a misspelled key inside a tight/infinite loop logs once, not once per press
        // (DiagnosticLog appends synchronously per line; it is for low-volume events).
        private string? _lastUnrecognizedKeyWarned;

        private void SimulateKeystroke(string keystroke, CancellationToken token = default)
        {
            if (string.IsNullOrWhiteSpace(keystroke)) return;
            // KeyUtils.SplitCombo, not Split('+'): "Ctrl++" is Ctrl with the + key, and a plain split
            // read it as Ctrl with an EMPTY key — Ctrl went down and up and the + never came.
            var (prefix, target) = Helpers.KeyUtils.SplitCombo(keystroke);
            if (target.Length == 0) return;

            // The LAST part is the target key; everything before it is a modifier.
            // Order matters at replay time, but for the modifier set we don't need to
            // preserve incoming order (Ctrl+Shift and Shift+Ctrl are semantically the
            // same modifier set; we always emit in our canonical order: Win, Ctrl, Shift, Alt).
            // Matched ignoring case and written canonically: a hand-typed "ctrl+a" lost its Ctrl
            // here (an exact == compare) and pressed a bare A, while the same row converted to
            // paired — whose expansion compares ignoring case — pressed Ctrl+A.
            var modifiers = new System.Collections.Generic.List<string>();
            foreach (var p in prefix)
            {
                foreach (var canonical in new[] { "Win", "Ctrl", "Shift", "Alt" })
                    if (string.Equals(p, canonical, StringComparison.OrdinalIgnoreCase) && !modifiers.Contains(canonical))
                        modifiers.Add(canonical);
                // Silently skip unknown modifiers — keystroke replay is best-effort.
            }

            // A modifier a KeyDown row of the macro already holds belongs to THAT row. This combo
            // presses it again (nothing new for the target) but must not let go of it: the finally
            // below released it anyway, and the Ctrl of "KeyDown Ctrl, Ctrl+C, click, KeyUp Ctrl"
            // was up before the click that was meant to be a Ctrl+click.
            var heldByMacro = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
            lock (_simInputLock)
            {
                foreach (var m in modifiers)
                    if (_simulatedKeysDown.Contains(m)) heldByMacro.Add(m);
            }

            // Modifiers down. Win goes first because shell shortcuts (Win+D, Win+E, Win+R)
            // need the LWin keydown to land before the trigger key, otherwise the Shell
            // sees a bare D and ignores it. Ctrl/Shift/Alt order matches the capture
            // canonical order.
            foreach (var m in new[] { "Win", "Ctrl", "Shift", "Alt" })
                if (modifiers.Contains(m)) SimulateKey(m, true);

            try
            {
                Thread.Sleep(10); // let target app's input system register the modifier set

                // If Stop landed while the modifiers were going down, skip the target tap —
                // but still fall through to the finally so the modifiers are released.
                if (token.IsCancellationRequested) return;

                // Key tap (down → up)
                SimulateKey(target, true);
                SimulateKey(target, false);
            }
            finally
            {
                // Modifiers up in REVERSE order. Mirrors physical typing — release the last-
                // pressed first. Some apps watch for transient modifier states; doing this
                // out of order can leave them in a stuck modifier state until the user
                // physically presses + releases the same modifier themselves. In a finally so a
                // cancelled combo (or a throw in the tap) never leaves a modifier stuck down.
                foreach (var m in new[] { "Alt", "Shift", "Ctrl", "Win" })
                    if (modifiers.Contains(m) && !heldByMacro.Contains(m)) SimulateKey(m, false);
            }
        }

        private void SimulateKey(string key, bool isDown)
        {
            if (!Helpers.KeyUtils.TryResolveVirtualKeyCode(key, out ushort vk))
            {
                // Was a silent no-op — surface it in the session log: an unresolvable
                // key here is almost always a typo'd key name or a {var} that resolved
                // to something that isn't a key. Empty strings stay quiet (the resolver
                // already logged the resolved-to-empty case), and repeats of the SAME
                // bad key are deduped — a Keystroke ×999 or an infinite loop must not
                // turn one typo into thousands of synchronous log appends.
                if (!string.IsNullOrWhiteSpace(key)
                    && !string.Equals(_lastUnrecognizedKeyWarned, key, StringComparison.Ordinal))
                {
                    _lastUnrecognizedKeyWarned = key;
                    DiagnosticLog.Warn($"Key press skipped: '{key}' is not a recognizable key");
                }
                return;
            }
            bool isExtended = ExtendedVkCodes.Contains(vk);
            ushort scan = (ushort)NativeMethods.MapVirtualKey(vk, 0);

            uint flags = isDown ? 0u : NativeMethods.KEYEVENTF_KEYUP;
            flags |= NativeMethods.KEYEVENTF_SCANCODE;
            if (isExtended) flags |= NativeMethods.KEYEVENTF_EXTENDEDKEY;

            var input = new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_KEYBOARD,
                U = new NativeMethods.InputUnion
                {
                    ki = new NativeMethods.KEYBDINPUT
                    {
                        wVk = isExtended ? (ushort)0 : vk,
                        wScan = scan,
                        dwFlags = flags,
                        time = 0,
                        dwExtraInfo = IntPtr.Zero
                    }
                }
            };

            lock (_simInputLock)
            {
                NativeMethods.SendInput(1, new[] { input }, NativeMethods.InputSize);

                // Track pressed-but-not-released keys (atomic with the SendInput) so
                // ResetKeyState (called from Stop, on another thread) sees a consistent set
                // and emits the missing KEYUP. Mirrors the mouse flag pattern above.
                if (isDown) _simulatedKeysDown.Add(key);
                else _simulatedKeysDown.Remove(key);
            }
        }
    }
}
