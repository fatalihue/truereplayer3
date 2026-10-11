using System;
using System.Collections.ObjectModel;
using TrueReplayer.Models;
using TrueReplayer.Services;

namespace TrueReplayer.Controllers
{
    public class MainController
    {
        public static MainController? Instance { get; private set; }

        private readonly ObservableCollection<ActionItem> actions;
        private readonly ActionRecorder recorder;
        private readonly RecordingService recordingService;
        private readonly ReplayService replayService;
        private readonly Func<int> getDelayFunc;
        private readonly Action? onButtonStatesChanged;

        public MainController(
            ObservableCollection<ActionItem> actions,
            ActionRecorder recorder,
            RecordingService recordingService,
            ReplayService replayService,
            Func<int> getDelay,
            Action? onButtonStatesChanged = null)
        {
            this.actions = actions;
            this.recorder = recorder;
            this.recordingService = recordingService;
            this.replayService = replayService;
            this.getDelayFunc = getDelay;
            this.onButtonStatesChanged = onButtonStatesChanged;

            Instance = this;
        }

        public void ToggleRecording()
        {
            // A running replay → this toggle STOPS it; the start-only arguments are never read.
            if (replayService.IsReplaying)
                replayService.ToggleReplay(false, "1", false, "0", gameMode: null);

            recordingService.ToggleRecording();
        }

        public void ToggleReplay(bool loopEnabled, string loopCountText, bool intervalEnabled, string intervalText, bool? gameMode, bool useDelayVariation = false, int delayVariationPercent = 20, bool useRelativeCoords = false, Models.WindowTarget? windowTarget = null, bool bringToFocus = false, int lockWidth = 0, int lockHeight = 0, int lockX = 0, int lockY = 0, bool restorePosition = false, bool restoreSize = false, bool forceInfiniteLoop = false)
        {
            if (recordingService.IsRecording)
                recordingService.ToggleRecording();

            replayService.ToggleReplay(loopEnabled, loopCountText, intervalEnabled, intervalText, gameMode, useDelayVariation, delayVariationPercent, useRelativeCoords, windowTarget, bringToFocus, lockWidth, lockHeight, lockX, lockY, restorePosition, restoreSize, forceInfiniteLoop);
        }

        public void ToggleCursorClickReplay(ClickerRunConfig config)
        {
            if (recordingService.IsRecording)
                recordingService.ToggleRecording();

            replayService.ToggleCursorClickReplay(config);
        }

        // Clicker pause hotkey — toggles pause/resume on a running click loop.
        public void TogglePauseClicker() => replayService.TogglePauseClicker();

        public void CancelInsertMode()
        {
            recorder.SetInsertIndex(null);
        }

        public void EnableInsertMode(int? index)
        {
            recorder.SetInsertIndex(index);
        }

        public bool IsInsertMode() => recorder.IsInsertMode;

        public bool IsRecording() => recordingService.IsRecording;

        public bool IsReplayInProgress() => replayService.IsReplaying;

        public void StopReplayIfRunning() => replayService.StopIfRunning();

        public void UpdateButtonStates()
        {
            onButtonStatesChanged?.Invoke();
        }

        // No-op: the captured timestamp had no consumer (the removed `lastActionTime`
        // field was write-only). Kept as a no-op so the RecordingService callback wired
        // from MainWindow stays valid without a cross-file signature change.
        public void SetLastActionTime(DateTime time)
        {
        }

        public int GetDelay() => getDelayFunc();

        public void ScrollToLastAction()
        {
            // Handled by bridge — React auto-scrolls on actions:updated
        }

        // Safety net (ms) on the swallowed-KeyUp claim, not the claim itself. The claim is
        // CONSUMED by the matching KeyUp (see IsHotkeyKeyUpSuppressed), so the normal case never
        // reaches this bound; it only stops a stamp whose KeyUp was never delivered from swallowing
        // an unrelated press of the same key much later.
        //
        // It was 300 ms, which is shorter than a held key. A hotkey held longer than that had its
        // down swallowed by the dispatch and its up recorded by the tail — a lone KeyUp in the
        // macro, the same half-key defect the pass-through branches were fixed for, reachable with
        // nothing but factory defaults and a finger resting on the key.
        private const long HotkeyKeyUpSuppressMs = 10_000;
        // Debounce window (ms) collapsing rapid duplicate Record/Replay hotkey fires
        // (key auto-repeat / double registration) into a single toggle.
        private const long DuplicateHotkeyDebounceMs = 500;

        private string? hotkeyJustPressed;
        // Monotonic tick timestamps (Environment.TickCount64) — DateTime.Now is non-monotonic
        // (NTP/manual/DST shifts could make the delta negative or huge and break suppression).
        // Default 0 is correct: TickCount64 is ms-since-boot, so `now - 0` is always >= the
        // suppression windows in any real session (and the key-match guard covers the hotkey case).
        private long hotkeyPressTicks;

        private long lastRecordingToggleTicks;
        private long lastReplayToggleTicks;

        public void SetLastHotkeyPressed(string key)
        {
            hotkeyJustPressed = key;
            hotkeyPressTicks = Environment.TickCount64;
        }

        public bool IsHotkeyKeyUpSuppressed(string key)
        {
            if (hotkeyJustPressed != key) return false;
            if (Environment.TickCount64 - hotkeyPressTicks >= HotkeyKeyUpSuppressMs) return false;
            // ONE key-down claims ONE key-up. Consuming the stamp is what lets the window be long
            // enough to cover a held key without also swallowing the up of a later, unrelated press
            // of the same key: a claim that is never redeemed expires, a claim that is redeemed is
            // gone immediately.
            hotkeyJustPressed = null;
            return true;
        }

        public bool ShouldSuppressDuplicateRecordingHotkey()
        {
            var now = Environment.TickCount64;
            if (now - lastRecordingToggleTicks < DuplicateHotkeyDebounceMs)
                return true;

            lastRecordingToggleTicks = now;
            return false;
        }

        public bool ShouldSuppressDuplicateReplayHotkey()
        {
            var now = Environment.TickCount64;
            if (now - lastReplayToggleTicks < DuplicateHotkeyDebounceMs)
                return true;

            lastReplayToggleTicks = now;
            return false;
        }
    }
}
