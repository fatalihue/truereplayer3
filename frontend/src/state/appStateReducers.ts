import type { AppState, ClickerLiveState, IncomingMessage } from '../bridge/messageTypes';

// The app state and the three reducers that keep it, as plain functions. The shell runs them in its
// store (shell/store.ts), the same ones TrueReplayer 2's shell runs, so both read the engine's
// messages the same way.

const defaultSettings = {
  customDelay: '100',
  useCustomDelay: true,
  delayVariation: '1',
  useDelayVariation: false,
  loopCount: '0',
  enableLoop: false,
  loopInterval: '200',
  loopIntervalEnabled: false,
  // Both off, matching AppSettings: Game Mode and Return cursor are the defaults profiles
  // without their own follow, and a profile turns either on for itself.
  smoothMovement: false,
  restoreCursor: false,
  moveStepPx: '20',
  moveStepDelay: '2',
  moveClickDelay: '10',
  fastApproach: true,
  settleDistance: '80',
  useCursorClick: false,
  cursorClickButton: 'Left',
  cursorClickStartHotkey: 'PageDown',
  cursorClickPauseHotkey: 'PageUp',
  // Clicker v2 — defaults match the AppSettings backend (delay=100 ms, jitter=1 %,
  // hold=10 ms, position=1 px, interval=200 ms; every switch starts off). Real values
  // arrive on settings:loaded after the post-upgrade migration (which copies the legacy
  // profile-shared delay/jitter/loops/interval into these fields). Keeping these in sync
  // with AppSettings.cs avoids a one-frame "wrong default" flash before settings:loaded
  // arrives on cold start.
  cursorClickDelay: '100',
  cursorClickDelayJitter: '1',
  cursorClickUseJitter: false,
  cursorClickHold: '10',
  cursorClickPositionJitter: '1',
  cursorClickUsePositionJitter: false,
  // null = no rect saved. useArea is the on/off toggle (preserves the rect when temporarily off).
  cursorClickUseArea: false,
  cursorClickArea: null as { x: number; y: number; w: number; h: number } | null,
  // Fixed-point mode. useFixed toggles it on; a null point = "lock on start" (capture the
  // cursor at the first click), a set point = click exactly there.
  cursorClickUseFixed: false,
  cursorClickFixedPoint: null as { x: number; y: number } | null,
  cursorClickLoops: '0',
  cursorClickUseLoops: false,
  cursorClickInterval: '200',
  cursorClickUseInterval: false,
  cursorClickMaxDuration: '60000',
  cursorClickUseMaxDuration: false,
  cursorClickGameMove: false,
  cursorClickPresets: [],
  recordMouse: true,
  recordScroll: true,
  recordKeyboard: true,
  recordCombinedInput: true,
  profileKeyEnabled: true,
  browserSelectorEnabled: true,
  // Mirror the engine's HotkeyDefaults (a new install's keys; whoever updates keeps theirs).
  recordingHotkey: 'Ctrl+F9',
  replayHotkey: 'Ctrl+F10',
  profileKeyToggleHotkey: 'Pause',
  foregroundHotkey: '',
  modeToggleHotkey: '',
  // Mirrors AppSettings.CaptureSlotHotkey so there's no wrong-value flash before
  // settings:loaded arrives. Empty still means disabled if the user clears it.
  captureSlotHotkey: 'Win+Ctrl+C',
  // Mirrors AppSettings.CopyScreenTextHotkey (HotkeyDefaults.CopyScreenText).
  copyScreenTextHotkey: 'Win+F12',
  copyScreenTextRegion: '',
  // Mirrors AppSettings.OcrLanguage (OcrService.DefaultLanguage); '' = Auto.
  ocrLanguage: 'pt-BR',
  alwaysOnTop: false,
  minimizeToTray: true,
  runOnStartup: true,
  startMinimized: true,
  // Must match AppSettingsManager.AppSettings defaults (both opt-in) so there's
  // no wrong-value flash before settings:loaded arrives.
  runEndFlash: false,
  runEndSound: false,
  runAsAdmin: false,
  automationEnabled: true,
  remaps: { enabled: true, entries: [] as { from: string; to: string; enabled: boolean; process?: string }[] },
};

export const initialState: AppState = {
  status: 'ready',
  actions: [],
  dataTable: { headers: [], rows: [], loopOverData: false, onRowError: 'halt', notifyOnLapComplete: true, cursorRow: 0 },
  automation: { enabled: true, entries: [] },
  profiles: [],
  activeProfile: null,
  profileOrder: { pinned: [], folders: [], ungroupedOrder: [] },
  settings: defaultSettings,
  // Mirrors WebViewBridge's "No Profile" fallback so there's no wrong-value flash before the
  // first profile:loop / state:init lands. count '1', never '0' — 0 means forever to the engine.
  profileLoop: { count: '1', enabled: false, interval: '200', intervalEnabled: false, dirty: false, scoped: false, gameMode: null, restoreCursor: null, delayVariation: null, fastApproach: null },
  toolbar: { profileName: 'No Profile' },
  statusBar: { directory: 'Profiles', profileName: null, actionCount: 0 },
  buttonStates: {
    recordEnabled: true,
    replayEnabled: true,
    recordingActive: false,
    replayActive: false,
    recordButtonText: 'Recording',
    replayButtonText: 'Replay',
    canUndo: false,
    canRedo: false,
    copiedCount: 0,
  },
  replayChain: [],
  pauseState: { isPaused: false, hotkey: '', timeoutMs: 0, startedAt: 0 },
  settingsResetEpoch: 0,
};

// The ~4 Hz live slices, deliberately OUTSIDE the AppState reducer — see ClickerLiveState in
// messageTypes.ts for why. Keeping them here would make every stats push allocate a new
// AppState and re-render every useAppState() consumer.
export const initialClickerLive: ClickerLiveState = {
  clickerStats: { active: false, count: 0, elapsedMs: 0, capMs: 0, countdownMs: 0, endReason: null, blocked: 0, warning: null },
  loopProgress: { active: false, current: 0, total: 0 },
  chainStep: { active: false, current: 0, total: 0 },
};

export function appStateReducer(state: AppState, message: IncomingMessage): AppState {
  switch (message.type) {
    case 'state:init':
      // Deep-merge settings (and guard profileOrder) so a partial state:init payload can't wipe
      // defaultSettings — every settings.* read downstream would otherwise crash the UI.
      return {
        ...initialState,
        ...message.payload,
        settings: { ...initialState.settings, ...(message.payload.settings ?? {}) },
        profileOrder: message.payload.profileOrder ?? initialState.profileOrder,
        automation: message.payload.automation ?? initialState.automation,
        // Same guard as settings/profileOrder: a version-skewed payload that omits the slice
        // must not make profileLoop.count undefined and blank the ActionBar chip.
        profileLoop: message.payload.profileLoop
          ? {
              ...message.payload.profileLoop,
              gameMode: message.payload.profileLoop.gameMode ?? null,
              restoreCursor: message.payload.profileLoop.restoreCursor ?? null,
              delayVariation: message.payload.profileLoop.delayVariation ?? null,
              fastApproach: message.payload.profileLoop.fastApproach ?? null,
            }
          : initialState.profileLoop,
      };
    case 'status:changed':
      // The Clicker counter / loop-progress resets that used to live here moved to
      // clickerLiveReducer with those slices — same transitions, same rules. The per-row
      // highlight clear moved to highlightReducer the same way.
      return { ...state, status: message.payload.status };
    case 'actions:updated':
      return { ...state, actions: message.payload.actions };
    case 'data:table':
      return { ...state, dataTable: message.payload };
    // Marker-only update: patch the cursor without touching headers/rows, so a run that moves
    // the cursor cannot re-seed the grid the user may be editing.
    case 'data:cursor':
      return { ...state, dataTable: { ...state.dataTable, cursorRow: message.payload.row } };
    case 'automation:state':
      return { ...state, automation: message.payload ?? state.automation };
    case 'profile:active':
      return { ...state, activeProfile: message.payload.activeProfile ?? null };
    case 'profiles:updated':
      // `?? null`: the engine leaves null properties out of its JSON, so with no macro open the
      // payload has no activeProfile at all — undefined, which a `!== null` check reads as open.
      return { ...state, profiles: message.payload.profiles, activeProfile: message.payload.activeProfile ?? null, profileOrder: message.payload.profileOrder ?? state.profileOrder };
    case 'settings:loaded': {
      // Deep-merge over defaults (mirrors state:init) so a partial/version-skewed payload
      // that drops a field can't make settings.* undefined and crash downstream reads.
      const nextSettings = { ...initialState.settings, ...(message.payload.settings ?? {}) };
      // The mode-flip wipe of the live clicker slices moved to clickerLiveReducer along with
      // the slices themselves — it now detects the same flip from its own last-seen value.
      return { ...state, settings: nextSettings };
    }
    case 'profile:loop':
      // Whole-slice replace: the C# bridge is the sole owner of these values (it resolves
      // profile-vs-global and does the 1..999 clamp), so there is no local state to preserve.
      // gameMode / restoreCursor are pinned to null when absent: undefined would read as
      // "follows" anyway, but `!== null` checks downstream must not see a third value.
      return {
        ...state,
        profileLoop: {
          ...message.payload,
          gameMode: message.payload.gameMode ?? null,
          restoreCursor: message.payload.restoreCursor ?? null,
          delayVariation: message.payload.delayVariation ?? null,
          fastApproach: message.payload.fastApproach ?? null,
        },
      };
    case 'button:states':
      return { ...state, buttonStates: message.payload };
    case 'toolbar:updated':
      return { ...state, toolbar: message.payload };
    case 'statusbar:updated':
      return { ...state, statusBar: message.payload };
    case 'replay:chain':
      // Also handled by clickerLiveReducer — not a duplicate: this reducer OWNS the stack, that
      // one uses the same edge to invalidate its step counter. Renaming or dropping this message
      // must touch both, or the counter silently keeps a dead frame's numbers.
      return { ...state, replayChain: message.payload.stack };
    case 'replay:paused':
      return {
        ...state,
        pauseState: {
          isPaused: true,
          hotkey: message.payload.hotkey,
          timeoutMs: message.payload.timeoutMs,
          startedAt: Date.now(),
        },
      };
    case 'replay:resumed':
      return {
        ...state,
        pauseState: { isPaused: false, hotkey: '', timeoutMs: 0, startedAt: 0 },
      };
    // 'clicker:stats' / 'macro:loopProgress' / 'replay:chainStep' (clickerLiveReducer) and
    // 'actions:highlight' (highlightReducer) are handled elsewhere, NOT here. Falling through to
    // `default` is the point: returning `state` unchanged is what keeps a ~4 Hz stats push — or a
    // per-action highlight push during replay — from re-rendering every useAppState() consumer.
    case 'settings:reset':
      // Increments on every explicit reset. SettingsPanel watches it in an effect to send
      // its non-persistent UI state (the clicker /s ↔ ms unit toggle) back to default.
      // It used to be a `key` on ClickerSection instead, but that component remounts for
      // several unrelated reasons — tab change, panel collapse — so the toggle it was meant
      // to preserve was being reset constantly; the state moved up and the epoch stayed.
      return { ...state, settingsResetEpoch: state.settingsResetEpoch + 1 };
    default:
      return state;
  }
}

/**
 * Carries the two live slices plus ONE derived field: the last useCursorClick we saw. That
 * field exists solely to detect the mode FLIP in settings:loaded, which used to be spotted by
 * comparing against AppState.settings — unavailable now that these slices are a separate
 * reducer. Nothing reads it, and it is computed with the SAME merge expression the AppState
 * reducer uses for nextSettings, so the two cannot answer differently for the same payload.
 */
export interface ClickerLiveInternal extends ClickerLiveState {
  lastUseCursorClick: boolean;
}

export const initialClickerLiveInternal: ClickerLiveInternal = {
  ...initialClickerLive,
  lastUseCursorClick: initialState.settings.useCursorClick,
};

/** Same merge the AppState reducer performs, so the flip detector reads the identical value. */
function mergedUseCursorClick(settings: Partial<AppState['settings']> | undefined): boolean {
  return { ...initialState.settings, ...(settings ?? {}) }.useCursorClick;
}

export function clickerLiveReducer(state: ClickerLiveInternal, message: IncomingMessage): ClickerLiveInternal {
  switch (message.type) {
    case 'state:init':
      return {
        ...initialClickerLiveInternal,
        lastUseCursorClick: mergedUseCursorClick(message.payload.settings),
      };
    case 'status:changed':
      // New run starting → reset the Clicker counter to zero so we don't carry over the
      // previous run's totals. Other transitions (replaying → ready, recording, etc.) KEEP
      // the last stats so the user can read the final "Clicked X · Y/s · MM:SS" after the run
      // ends. The StatusBar gates rendering on `isReplaying || count > 0`, so non-Clicker
      // replays don't trigger the Clicker counter even though this reset is mode-agnostic.
      //
      // loopProgress has the same lifecycle, except `active` starts FALSE here and the first
      // 'macro:loopProgress' push flips it true — that is what keeps single-shot replays from
      // showing the indicator, since the backend never sends loopProgress in that case.
      if (message.payload.status !== 'replaying') return state;
      return {
        ...state,
        clickerStats: { active: true, count: 0, elapsedMs: 0, capMs: 0, countdownMs: 0, endReason: null, blocked: 0, warning: null },
        loopProgress: { active: false, current: 0, total: 0 },
        // chainStep follows loopProgress exactly: inactive until a run actually enters a
        // sub-profile, so an unchained replay never shows the "(x/y)" tail.
        chainStep: { active: false, current: 0, total: 0 },
      };
    case 'settings:loaded': {
      // Wipe the live slices when the MODE actually flips. They were previously cleared only
      // on status → 'replaying', so Clicker → Macro → Clicker came back showing the previous
      // run's count, elapsed, full progress bar and "✓ finished" badge — indistinguishable
      // from a run that had just ended.
      //
      // Gated on the flip, not on every settings:loaded: this message has ~19 emitters, and
      // wiping live stats on an unrelated change (a theme switch mid-run) would be a new bug.
      // All three mode-flip paths — the ActionBar pills, the tray item and the ScrollLock
      // hotkey — push this message, so one branch covers them. SetCursorClickMode stops any
      // live run first, so there is never a run in flight to lose.
      const next = mergedUseCursorClick(message.payload.settings);
      if (next === state.lastUseCursorClick) return state;
      return { ...initialClickerLive, lastUseCursorClick: next };
    }
    case 'clicker:stats':
      // Set active = true on every stats push (covers the case where the user clicks Run and
      // the very first stats batch arrives). status:changed → 'replaying' (a new run starting)
      // is the only transition that wipes clickerStats; 'ready' preserves the final count so
      // the user can read the total after the run ends.
      // A stats push also ends any countdown: the engine sends countdown 0 first, but the
      // first click is proof enough on its own.
      return {
        ...state,
        clickerStats: {
          ...state.clickerStats,
          active: true,
          count: message.payload.count,
          elapsedMs: message.payload.elapsedMs,
          capMs: message.payload.capMs,
          countdownMs: 0,
        },
      };
    case 'clicker:countdown':
      // Button-start countdown (ClickerRunConfig.StartDelayMs). Lands before the first stats
      // push; the dashboard swaps its hero for the seconds left while this is > 0.
      return {
        ...state,
        clickerStats: { ...state.clickerStats, active: true, countdownMs: message.payload.remainingMs },
      };
    case 'clicker:ended':
      // Same final flush as the last stats push, just before status → ready. Kept through
      // 'ready' like the count, so the badge can say WHY the run ended.
      return {
        ...state,
        clickerStats: { ...state.clickerStats, countdownMs: 0, endReason: message.payload.reason, blocked: message.payload.blocked },
      };
    case 'clicker:warning':
      // Follows the cursor in both directions: the code while the root window under it runs
      // elevated, null (sent as an omitted key) once it is a normal window again.
      return {
        ...state,
        clickerStats: { ...state.clickerStats, warning: message.payload.code ?? null },
      };
    case 'macro:loopProgress':
      // Same idea as clicker:stats — first push flips `active` on, run-start in status:changed
      // wipes it. Backend only emits for genuine loops (count > 1 or infinite), so a
      // single-shot replay never lands here and the StatusBar's `active`-gated render stays
      // hidden.
      return {
        ...state,
        loopProgress: { active: true, current: message.payload.current, total: message.payload.total },
      };
    case 'replay:chainStep':
      return {
        ...state,
        chainStep: { active: true, current: message.payload.current, total: message.payload.total },
      };
    case 'replay:chain':
      // Handled in BOTH reducers, on purpose: AppState keeps the stack itself, and here a stack
      // change invalidates the counter, because the numbers describe the frame that just ended
      // or the one we haven't stepped into yet. Clearing rather than holding is what stops
      // "A → C (9/9)" from flashing the previous sub-profile's total. The engine's next action
      // re-arms it within one step (NotifyChainChanged zeroes its throttle for exactly this).
      if (!state.chainStep.active) return state;   // identity-stable when there's nothing to clear
      return { ...state, chainStep: { active: false, current: 0, total: 0 } };
    default:
      // Returning `state` unchanged is the whole point: every other message type leaves this
      // reducer's identity alone, so StatusBar and ClickerDashboard don't re-render for it.
      return state;
  }
}

/**
 * The per-action replay highlight, split out of AppState for the same reason as the live
 * clicker slices: the backend pushes 'actions:highlight' once per executed action, so keeping
 * the index in AppState re-rendered every useAppState() consumer at replay rate to tint one
 * grid row.
 */
export function highlightReducer(state: number | null, message: IncomingMessage): number | null {
  switch (message.type) {
    case 'actions:highlight':
      return message.payload.index;
    case 'status:changed':
      // Drop the per-row highlight when leaving 'replaying'. Without this the
      // last executed row stays tinted forever — confusing because nothing's running
      // anymore, and especially wrong when the user switches profiles mid-replay
      // (highlight from the old profile would survive onto a row index in the new
      // one). 'recording' and 'ready' both transition through here and don't have
      // a notion of "current action", so clearing is safe in both cases.
      return message.payload.status === 'replaying' ? state : null;
    case 'actions:updated':
      // The list the index pointed into just changed; a stale index would tint the wrong row.
      return null;
    default:
      // Identity preserved on every other message so highlight consumers don't re-render.
      return state;
  }
}
