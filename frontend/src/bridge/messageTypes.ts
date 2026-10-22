import type { SendMode, SendMethod } from '../utils/sendTextTypes';

// ── Data Models ──

export interface ActionItem {
  /**
   * Stable identifier set on action creation (UUID-like). Persisted in profile.json,
   * backfilled on load for actions from pre-2.2.6 profiles. Used as the React key in
   * ActionTable so reorder/undo/redo don't break selection or highlight state. Optional
   * here only because the backend might briefly push a payload without ids during an
   * upgrade window; the frontend should still treat it as required in new code.
   */
  id?: string;
  actionType: string;
  key: string;
  // SendText rich flavors (Insert Text dialog): keyHtml = HTML fragment, keyMarkdown =
  // chat-style markdown (WhatsApp or Discord marks per sendMode); both null when the doc has no
  // formatting. sendMode picks delivery: undefined/'rich' = HTML+plain, 'markdown' (WhatsApp) /
  // 'discord' = markdown-as-plain, 'plain' = clean text.
  keyHtml?: string | null;
  keyMarkdown?: string | null;
  sendMode?: SendMode | null;
  /** Delivery METHOD — orthogonal to sendMode. undefined/'paste' = clipboard + Ctrl+V;
   *  'type' = typed key by key via SendInput; the clipboard is read but never written. */
  sendMethod?: SendMethod | null;
  /** Per-character pause (and key-hold) for sendMethod 'type'. null/0 = unpaced. */
  sendCharDelay?: number | null;
  x: number;
  y: number;
  delay: number;
  comment: string;
  rowNumber: number;
  isInsertionPoint: boolean;
  shouldHighlight: boolean;
  imagePath: string;
  timeout: number;
  confidence: number;
  imageBase64: string;
  browserText: string;
  newTab: boolean;
  isSkipped: boolean;
  // When true, a combined click is replayed twice a few pixels apart so a small target
  // (e.g. a Roblox text field at minimum window size) actually receives focus. Shown as a
  // small icon in the Action pill (no grid column); toggled from the row context menu.
  isFocusClick?: boolean;
  // When true, the click ignores its stored x/y and fires wherever the OS cursor is at replay
  // time, read once per repeat cycle. Combined clicks only (Left/Right/Middle/Double/Triple) —
  // the C# side clears it on a switch to any other type. The stored x/y is kept untouched, so
  // switching back to "This point" restores the original coordinate; both surfaces hide the
  // coordinates while it is on rather than showing a number the run never reads.
  atCursor?: boolean;
  repeatCount?: number;
  // RunProfile, data-loop Phase C: run the called profile once per row of ITS OWN Data
  // table ({row:col} resolves per row inside the sub). Replaces Repeat while on.
  runOverData?: boolean;
  // Keystroke action: ms gap between consecutive press cycles when repeatCount > 1.
  // null/undefined = use the global default (30 ms; matches ActionItem.DefaultRepeatDelayMs
  // on the C# side). Explicit 0 = back-to-back. Ignored when repeatCount == 1.
  repeatDelayMs?: number | null;
  // Keystroke action: random ±% variation applied to each gap (1..100). null/undefined/0 =
  // off (fixed gap). Only meaningful when repeatCount > 1. Mirrors RepeatDelayJitterPct on
  // the C# side; a constant gap is the clearest "it's a bot" tell, this scatters it.
  repeatDelayJitterPct?: number | null;
  // Combined click (Left/Right/Middle/Double) with repeatCount > 1: random ±px scatter applied
  // to the click POINT on every repeat cycle (1..500). null/undefined/0 = off (exact point).
  // Mirrors RepeatPositionJitterPx on the C# side — the positional twin of repeatDelayJitterPct:
  // scattering only the timing still leaves every click on one exact pixel.
  repeatPositionJitterPx?: number | null;
  // HoldKey action: how long the key stays pressed before the matching KEYUP fires — and the
  // *ClickHold family, where it is how long the mouse button stays down. One field, one range.
  // 0/undefined = use the C# default (1000 ms; matches ActionItem.DefaultHoldDurationMs).
  // Clamped 10..60000 ms on every edit surface (dialog, sheet, bridge).
  holdDurationMs?: number;
  // #6 — BrowserWaitElement: appears | disappears | enabled | text-match
  waitMode?: string | null;
  // #7 — BrowserNavigate: optional URL pattern + post-navigation selector
  urlWaitPattern?: string | null;
  postNavigateSelector?: string | null;
  // #5 — BrowserType options
  typeAppend?: boolean;
  typePaste?: boolean;
  typeDelay?: number | null;
  // BrowserSelectOption: how to match the option in a native <select>.
  // null/undefined = "text" mode (default). Other values: "value" | "index".
  selectMatchMode?: string | null;
  // Ranked fallback selectors captured at pick time (browser actions). Persisted so
  // replay can retry tier B/C candidates when the primary selector drifts; cleared when
  // the user hand-edits the selector without re-picking. null/absent = no fallback data.
  selectorAlternatives?: SelectorAlternative[] | null;
  // WaitImage extras (all default-safe). null/undefined = current behaviour preserved.
  waitImageOnTimeout?: string | null;
  waitImageInvert?: boolean;
  waitImageClickOnMatch?: boolean;
  waitImageSearchX?: number | null;
  waitImageSearchY?: number | null;
  waitImageSearchW?: number | null;
  waitImageSearchH?: number | null;
  // WaitPixelColor — lighter alternative to WaitImage that watches a single screen pixel
  // for a target colour within a per-channel tolerance band. Coords are absolute virtual-
  // screen pixels (same convention as mouse-click X/Y). Reuses the `timeout` field above.
  pixelX?: number | null;
  pixelY?: number | null;
  pixelColor?: string | null;        // "#RRGGBB"
  pixelTolerance?: number;            // 0–255 per channel; default 0 = exact match
  pixelOnTimeout?: string | null;     // "Halt" | "Continue" | "StopReplay"
  pixelInvert?: boolean;              // wait for colour to DISAPPEAR
  pixelClickOnMatch?: boolean;        // left-click (X,Y) once match condition is satisfied
  // ── Conditional logic (IF / ELSE / ENDIF) ──
  // IF rows reuse the WaitImage / WaitPixelColor probe fields above. conditionType
  // selects which probe family is meaningful: "ImageFound" uses imagePath/confidence/
  // waitImageSearch*; "PixelColorMatch" uses pixelX/pixelY/pixelColor/pixelTolerance.
  // null/undefined on Else/EndIf and every non-conditional action.
  conditionType?: string | null;
  // IFNOT semantic — inverts the probe outcome so the TRUE branch fires when the
  // probe FAILS. Default false (clean JSON when unused).
  conditionNegate?: boolean;
  // Optional poll timeout (ms) for the IF condition. 0/undefined = instant single check (branch
  // immediately). > 0 = poll up to N ms for the (negate-applied) condition to become true, then branch.
  conditionTimeout?: number;
  // While-loop iteration ceiling (actionType === 'While'). 0/undefined = the engine's
  // 1000-iteration safety default; reaching it exits the loop as a normal "ok".
  loopMaxIterations?: number;
  // null/undefined = "TreatAsFalse" (probe exception → walk FALSE branch). "Halt"
  // rethrows and stops replay. Mirrors waitImageOnTimeout's vocabulary.
  ifOnProbeError?: string | null;
  // If Window (conditionType 'WindowOpen') — state-based probe: TRUE when a visible
  // window matching process AND/OR title exists (or is foreground when foregroundOnly).
  // Empty field = wildcard; at least one must be set. titleMatchMode: null = 'contains'.
  windowProcessName?: string | null;
  windowTitle?: string | null;
  windowTitleMatchMode?: string | null; // null='contains' | 'regex'
  windowMatchForegroundOnly?: boolean;
  // If Clipboard (conditionType 'ClipboardMatch') — TRUE when the clipboard TEXT matches
  // the pattern. patternType: null='contains' | 'equals' | 'regex' (all case-insensitive).
  clipboardPatternType?: string | null;
  clipboardPattern?: string | null;
  // If Random (conditionType 'Random') — TRUE with probability randomPercent/100.
  randomPercent?: number;
  // If Variable (conditionType 'Variable') — compares the variable named in `key`
  // against conditionOperand under conditionOperator (eq|neq|contains|gt|lt).
  conditionOperator?: string | null;
  conditionOperand?: string | null;
  // Screen text / OCR (WaitText, conditionType 'ScreenText', SetVariable variableMode 'screen').
  // Region = the waitImageSearch* fields. The matcher reuses conditionOperator/conditionOperand:
  // Text mode contains|eq|regex, Number mode eq|neq|gt|lt on the FIRST number read.
  // ocrReadAs: null = text | 'number'. ocrTextColor '#RRGGBB' keys on the text colour (game HUDs).
  ocrReadAs?: string | null;
  ocrTextColor?: string | null;
  ocrColorTolerance?: number | null;
  // If File exists (conditionType 'FileExists') — TRUE when the resolved path exists.
  filePath?: string | null;
  // If Time (conditionType 'TimeWindow') — "HH:mm" window + day bitmask (Sun=1<<0…Sat=1<<6; 0=every day).
  timeStart?: string | null;
  timeEnd?: string | null;
  daysOfWeek?: number;
  // SetVariable — the value written under the variable name held in `key` (Key-reuse
  // convention). Read back with {var:name} in SendText / Type Text; names are matched
  // case-insensitively; an empty resolved value deletes the variable at replay time.
  // null/undefined = never edited (renders as empty in the Sheet).
  variableValue?: string | null;
  // SetVariable mode: null/undefined = 'set' (store resolved value as-is) |
  // 'cycle' (value is a list, one item per line; each execution stores the NEXT
  // line, wrapping; the cursor survives across runs so repeated hotkey presses
  // walk the list — resets on app restart) |
  // 'add' (the resolved value is a number added to the variable's current value,
  // unset counting as 0; negative subtracts — the counter a While needs).
  variableMode?: string | null;
  // CopyToSlot mode: null/undefined = 'capture' (grab the current selection into the
  // slot named in `key`) | 'clear' (empty that slot; a blank `key` wipes all slots 1–9
  // and resets the capture-hotkey cursor to 1). Only 'clear' is persisted.
  slotMode?: string | null;
  // ActivateWindow — find → launch-if-missing → wait → focus. The window MATCHER
  // reuses windowProcessName/windowTitle/windowTitleMatchMode above; `timeout` is the
  // wait-for-window budget. launchPath: exe / bare name / .lnk / document / URL opened
  // via ShellExecute when no window matches (empty = focus-only; with the matcher ALSO
  // empty it's a fire-and-forget "pure run"). activateOnTimeout: null = 'Halt'
  // (default — stop the replay on any failure) | 'Continue'.
  launchPath?: string | null;
  launchArgs?: string | null;
  activateOnTimeout?: string | null;
  // ActivateWindow placement — move/resize the activated window to a saved rect. Purely
  // positional: does NOT change the replay's coordinate context (use a sub-profile +
  // RunProfile for per-window relative coords). Size is ignored when width/height <= 0.
  restorePosition?: boolean;
  restoreSize?: boolean;
  windowX?: number;
  windowY?: number;
  windowWidth?: number;
  windowHeight?: number;
  // ActivateWindow Phase 3 — verb (null/'activate' focus | 'maximize' | 'minimize' | 'close') and
  // nth-match (1-based Z-order; null/1 = first match).
  windowVerb?: string | null;
  windowMatchIndex?: number | null;
  // BrowserAssert — verify a page element (reuses key=selector, waitMode, browserText,
  // timeout, selectorAlternatives) and FAIL the replay if it's not in the expected state.
  // null = 'Halt' (default — stop loudly) | 'Continue' (log and move on) | 'StopReplay'
  // (quiet-stop: end the run with the normal success framing, no error).
  assertOnFail?: string | null;
}

// #2 — Selector alternative returned by the picker
export interface SelectorAlternative {
  selector: string;
  tier: 'S' | 'A' | 'B' | 'C';
  description: string;
}

// Settings → App → Screen Text: the OCR packs (see ocr:languagesResult). The bridge serializes
// with WhenWritingNull, so a null tag arrives as an ABSENT key — read them by truthiness.
export interface OcrLanguage {
  tag: string;
  name: string;
}
export interface OcrLanguagesPayload {
  available: OcrLanguage[];
  offered: OcrLanguage[];
  auto?: string | null;
  effective?: string | null;
  installing?: string | null;
  pendingRestart: string[];
}

// #3 — Test action result returned by the bridge
export interface BrowserTestResult {
  requestId: string;
  success: boolean;
  durationMs?: number;
  error?: { code: string; message: string; tip: string | null };
  // Present only when the PRIMARY selector failed and a pick-time fallback matched instead.
  // That is the earliest visible sign the selector is drifting: the action still works today,
  // and stops working the day the fallback drifts too. The signal was already produced by the
  // extension and logged by the bridge, but nothing showed it anywhere the user looks on a
  // SUCCESSFUL run — and Test action is exactly where they look when they care about a selector.
  matchedVia?: { selector: string; tier: string } | null;
}

export interface ProfileEntry {
  name: string;
  filePath: string;
  hotkey: string | null;
  hotstring: string | null;
  hotstringInstant: boolean;
  /** The hotkey is really contested: another enabled profile binds the same combo with the same
   *  effective target, so only one of them fires. The same combo on DIFFERENT targets is not a
   *  conflict — the foreground gate routes between those on purpose. Derived, never persisted. */
  hotkeyConflict?: boolean;
  isActive: boolean;
  hasWindowTarget: boolean;
  windowTargetProcessName: string | null;
  windowTargetWindowTitle: string | null;
  windowTargetTitleMatchMode: string;
  // Effective target — what the hotkey gate uses. Differs from hasWindowTarget when the
  // profile inherits from its folder. The UI uses this to render the inherited badge.
  hasEffectiveTarget: boolean;
  effectiveTargetSource: 'own' | 'folder' | null;
  effectiveTargetFolderName: string | null;
  effectiveTargetProcessName: string | null;
  effectiveTargetWindowTitle: string | null;
  effectiveTargetTitleMatchMode: string;
  // Whether this profile's coordinates are window-relative AFTER inheritance.
  // `useRelativeCoordinates` below is the profile's OWN flag and reads false on a profile
  // that inherits both target and mode from its folder — use this one to tell the user
  // which space an action's X/Y lives in.
  effectiveUseRelativeCoordinates: boolean;
  // Base64-encoded PNG of the effective-target .exe's icon, or null when no target
  // is set / icon extraction failed. Backend-resolved from process name via running
  // processes + App Paths registry; not persisted to disk. UI uses
  // `effectiveTargetSource` to pick opacity (own = 100 %, folder-inherited = 55 %).
  appIconBase64: string | null;
  useRelativeCoordinates: boolean;
  bringToFocus: boolean;
  restorePosition: boolean;
  restoreSize: boolean;
  triggerMode: TriggerMode;
  isDisabled: boolean;
  // Automation badge scalars — sidebar renders a Zap badge on armed profiles.
  hasTrigger?: boolean;
  triggerArmed?: boolean;
  // ── Sharing metadata mirror (read-only on this surface; edit via profile:setMetadata) ──
  // Pushed in every profiles:updated payload so the sidebar can render icon/tag badges
  // without an extra round-trip per profile. Null fields mean "not set" — UI renders a
  // placeholder rather than an empty string.
  description?: string | null;
  tags?: string[] | null;
  iconEmoji?: string | null;
  profileVersion?: number;
  createdAt?: string | null;   // ISO 8601 UTC, e.g. "2026-05-24T12:34:56.789Z"
  updatedAt?: string | null;
  appMinVersion?: string | null;
  actionCount?: number;   // per-profile action count (mirror), for the Export dialog weight column
  // Names this profile calls via Run Profile (trimmed, as authored; null when none). Lets the
  // Export dialog disclose which sub-profiles a selection bundles (they always ship), without a
  // round-trip. Resolve a ref to a local profile by EXACT (case-sensitive) name — mirrors the
  // Ordinal lookup the backend export uses, so a case-differing/dangling ref bundles nothing.
  runProfileTargets?: string[] | null;
  // The subset called with "Run once per data row" (same shape; null when none). The CALLED
  // profile's Data panel reads it: that call walks the sub's table and obeys the sub's own
  // On row error, so the panel offers the control even with the sub's Loop over data off.
  runOverDataTargets?: string[] | null;
}

// ── Sharing metadata payloads ──

/** Per-profile preview row inside an Import Preview dialog. */
export interface ImportPreviewProfile {
  name: string;
  description: string | null;
  tags: string[] | null;
  iconEmoji: string | null;
  profileVersion: number;
  createdAt: string | null;
  updatedAt: string | null;
  appMinVersion: string | null;
  /** Server-computed: false when this profile's AppMinVersion exceeds the running version. */
  compatible: boolean;
  actionCount: number;
  /** Number of embedded reference PNGs bundled for this profile. */
  imageCount?: number;
  /** Per-profile loop, already normalized to 1..999. Rendered only when enableLoop is on and
   *  the count is above 1 — a profile that repeats 500x should not be a surprise after import. */
  loopCount?: number;
  enableLoop?: boolean;
  hotkey: string | null;
  hotstring: string | null;
  targetProcessName: string | null;
  targetWindowTitle: string | null;
  /** True when the profile ships an automation trigger. It always arrives DISARMED
   *  (DisarmedTriggerClone forces Armed=false) — this field exists so the preview can
   *  SAY so instead of the receiver concluding the profile "doesn't work". */
  hasTrigger: boolean;
  /** Row count of the bundled data-loop table, 0 when none travels. */
  dataRowCount: number;
  /** RunProfile refs this profile calls, each classified: 'inEnvelope' = bundled here;
   *  'localOnly' = will call YOUR existing profile of that name; 'missing' = nothing to call. */
  dependencies?: { name: string; status: 'inEnvelope' | 'localOnly' | 'missing' }[];
  /** True when a profile with this exact name already exists locally. */
  nameConflict: boolean;
  /** On a name conflict, the local profile's version/updated-at, for an incoming-vs-yours diff. */
  localVersion?: number | null;
  localUpdatedAt?: string | null;
}

/** Post-import result pushed when the confirm finished with anything worth reading —
 *  it replaces what used to be a single 300+ char toast plus N loose collision toasts. */
export interface ImportResultPayload {
  imported: number;
  /** Final names as written to disk (post-rename). */
  importedNames: string[];
  /** Collision renames as exact (requested → written) pairs recorded by the import
   *  itself — never derived by set-difference, which misread ".json"-suffixed
   *  envelope names as renames. */
  renames: { from: string; to: string }[];
  skipped: number;
  /** Per-file failure reasons live in the app log — the dialog names the files. */
  imageFailureNames: string[];
  hasOrganization: boolean;
  /** Existing folders whose window target was filled in by the import. */
  adoptedFolderTargets: string[];
  /** Folders where YOUR existing target won over the sender's. */
  keptLocalFolderTargets: string[];
  /** Pre-composed collision messages (backend strings, English). */
  hotkeyCollisions: string[];
}

/** Full Import Preview payload pushed by the bridge after the user picks a .trprofile. */
export interface ImportPreviewPayload {
  fileName: string;
  envelopeVersion: number;
  exportedAt: string;
  runningVersion: string;
  hasOrganization: boolean;
  /** True when the user has never acknowledged the security warning before. */
  requiresAcknowledgement: boolean;
  profiles: ImportPreviewProfile[];
}

/** Detailed metadata payload for the Info tab. */
export interface ProfileMetadataPayload {
  name: string;
  found: boolean;
  description?: string | null;
  tags?: string[];
  iconEmoji?: string | null;
  profileVersion?: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  appMinVersion?: string | null;
  /** Feature names that pinned the AppMinVersion (e.g. "WaitImage", "TriggerMode WhilePressed"). */
  appMinVersionContributors?: string[];
}

/** Tag autocomplete row, sorted by usage frequency descending. */
export interface TagListEntry {
  tag: string;
  count: number;
}

/** Per-profile conflict resolution sent with profile:confirmImport. */
export type ImportConflictResolution = 'overwrite' | 'rename' | 'skip';

export type TriggerMode = 'onPress' | 'onRelease' | 'whilePressed' | 'toggle' | 'doubleTap' | 'hold';

export interface ProfileFolder {
  name: string;
  color: string;
  collapsed: boolean;
  items: string[];
  hasWindowTarget?: boolean;
  windowTargetProcessName?: string;
  windowTargetWindowTitle?: string;
  windowTargetTitleMatchMode?: string;
  // Base64-encoded PNG of the folder target's .exe, or null. Resolved server-side
  // alongside the profile-level icon; not persisted with the folder definition.
  appIconBase64?: string | null;
  useRelativeCoordinates?: boolean;
  bringToFocus?: boolean;
  // Inheritable Restore Position/Size + geometry. Profile inside the folder uses these unless
  // it overrides at the profile level. Geometry zero-values mean "not captured yet".
  restorePosition?: boolean;
  restoreSize?: boolean;
  windowX?: number;
  windowY?: number;
  windowWidth?: number;
  windowHeight?: number;
}

export interface ProfileOrderData {
  pinned: string[];
  folders: ProfileFolder[];
  ungroupedOrder: string[];
}

/**
 * The cursorClick* fields a Clicker preset snapshots — the same names and shapes SettingsState
 * uses (numbers as strings, the same area/point objects), so "which preset is active" is a
 * field-by-field comparison and nothing more. Hotkeys are deliberately not part of a preset.
 */
export type ClickerPresetFields = Pick<SettingsState,
  | 'cursorClickButton' | 'cursorClickDelay' | 'cursorClickDelayJitter' | 'cursorClickUseJitter' | 'cursorClickHold'
  | 'cursorClickPositionJitter' | 'cursorClickUsePositionJitter' | 'cursorClickUseArea' | 'cursorClickArea'
  | 'cursorClickUseFixed' | 'cursorClickFixedPoint' | 'cursorClickLoops' | 'cursorClickUseLoops'
  | 'cursorClickInterval' | 'cursorClickUseInterval' | 'cursorClickMaxDuration' | 'cursorClickUseMaxDuration'
  | 'cursorClickGameMove'>;

export interface ClickerPreset extends ClickerPresetFields {
  name: string;
}

export interface SettingsState {
  customDelay: string;
  useCustomDelay: boolean;
  delayVariation: string;
  useDelayVariation: boolean;
  loopCount: string;
  enableLoop: boolean;
  loopInterval: string;
  loopIntervalEnabled: boolean;
  // Smooth mouse movement (interpolated cursor path) — fixes games like Roblox that ignore a
  // single large jump. Off = legacy instant move. moveStepPx/moveStepDelay/moveClickDelay are
  // numeric strings (same convention as customDelay).
  smoothMovement: boolean;
  // Cursor return at the end of a macro run — the app default every profile without its own
  // follows (ActionReplayer.RestoreCursorDefault). Edited through `profileRestoreCursor` under
  // "No Profile"; the effective value is `profileLoop.restoreCursor ?? restoreCursor`.
  restoreCursor: boolean;
  moveStepPx: string;
  moveStepDelay: string;
  moveClickDelay: string;
  // Fast approach (jump-and-settle) — teleport far moves, smooth only the final
  // settleDistance px. settleDistance is a numeric string (same convention as moveStepPx).
  fastApproach: boolean;
  settleDistance: string;
  useCursorClick: boolean;
  cursorClickButton: string;
  // Clicker-exclusive hotkeys (decoupled from the global macro hotkeys). Default
  // PageDown = Start/Stop, PageUp = Pause/Resume.
  cursorClickStartHotkey: string;
  cursorClickPauseHotkey: string;
  // Clicker v2 — dedicated Clicker settings, decoupled from the active profile. Stored
  // server-side in AppSettings (global), edited through ClickerSection in SettingsPanel.
  cursorClickDelay: string;
  cursorClickDelayJitter: string;
  cursorClickUseJitter: boolean;
  cursorClickHold: string;
  cursorClickPositionJitter: string;
  cursorClickUsePositionJitter: boolean;
  // Click-area rectangle (virtual-desktop px). null = no rect saved.
  // useArea is the on/off toggle — preserves the saved rect while temporarily disabled.
  // Effective area mode = useArea && area !== null.
  cursorClickUseArea: boolean;
  cursorClickArea: { x: number; y: number; w: number; h: number } | null;
  cursorClickUseFixed: boolean;
  cursorClickFixedPoint: { x: number; y: number } | null;
  cursorClickLoops: string;
  cursorClickUseLoops: boolean;
  cursorClickInterval: string;
  cursorClickUseInterval: boolean;
  /** Wall-clock cap in MS on the wire; the panel edits it in seconds. */
  cursorClickMaxDuration: string;
  cursorClickUseMaxDuration: boolean;
  /** Interpolated cursor path for the Clicker. Only bites when the cursor moves — Position, Fixed and Area; in plain cursor mode nothing moves. */
  cursorClickGameMove: boolean;
  /** Saved Clicker setups, applied/saved/deleted through the clicker:*Preset messages. */
  cursorClickPresets: ClickerPreset[];
  recordMouse: boolean;
  recordScroll: boolean;
  recordKeyboard: boolean;
  recordCombinedInput: boolean;
  profileKeyEnabled: boolean;
  browserSelectorEnabled: boolean;
  recordingHotkey: string;
  replayHotkey: string;
  profileKeyToggleHotkey: string;
  foregroundHotkey: string;
  modeToggleHotkey: string;
  // Capture-selection → clipboard slot ({clip:1}…{clip:9}). Empty = disabled (the default).
  captureSlotHotkey: string;
  // Copy screen text (OCR → clipboard): '' = disabled. Region '' = drag each time, or 'x,y,w,h'
  // (absolute) = always read that region. ocrLanguage '' = Auto; 'pt-BR' is the default.
  copyScreenTextHotkey: string;
  copyScreenTextRegion: string;
  ocrLanguage: string;
  alwaysOnTop: boolean;
  minimizeToTray: boolean;
  runOnStartup: boolean;
  startMinimized: boolean;
  // Out-of-window run-end cues — the window is usually behind the game when a
  // replay finishes, so the in-window status pills are invisible right then.
  runEndFlash: boolean;
  runEndSound: boolean;
  runAsAdmin: boolean;
  // Automation master switch — armed triggers only fire while this is on.
  automationEnabled: boolean;
  // Key remap layer (remaps.json sidecar). to: '' = disable the key; to may also be a mouse-side
  // name (LeftClick, MiddleClick, RightClick, XButton1/2, ScrollUp/Down). process = per-app scope
  // ('' / absent = any app). The load-failure trio is the sidecar quarantine: the file exists but
  // could not be read, the list shown is the backup (or empty), and saves go to `pendingFile`
  // until the user asks to replace the file (remap:overwriteUnreadable).
  remaps: {
    enabled: boolean;
    entries: RemapEntryDto[];
    loadFailed?: boolean;
    loadedFromBackup?: boolean;
    loadFailureDetail?: string | null;
    pendingFile?: string;
  };
}

export interface RemapEntryDto {
  from: string;
  to: string;
  enabled: boolean;
  process?: string;
}

// ── Automation (trigger daemon) ──

/** One executed action in the last run's report. Mirrors ActionReplayer.RunStepRecord. */
export interface RunStep {
  row: number;                    // 1-based grid row
  /** WHICH profile that row number belongs to. A RunProfile chain interleaves steps from
   *  profiles whose rows are numbered independently, so `row` alone is ambiguous the moment a
   *  chain is involved. Surfaced per step only when the run spanned more than one profile —
   *  same rule as `tabUrl`, and for the same reason: noise on the common single-profile run. */
  profile: string;
  actionType: string;
  detail: string | null;          // selector / coords / key — never a resolved value
  /** 'running' is reachable: steps are filed when they START, so a report requested mid-run
   *  contains the step currently executing — and, on a chain, the RunProfile row that is still
   *  inside its sub-call. It must never render as a pass. */
  status: 'running' | 'ok' | 'failed' | 'skipped';
  durationMs: number;
  // Browser diagnostics; null for every other action type.
  errorCode: string | null;       // ELEMENT_NOT_FOUND / HIDDEN / DISABLED / COVERED / …
  errorMessage: string | null;
  tip: string | null;
  /** Set only when the PRIMARY selector failed and a fallback tier matched — the signal that
   *  the selector is drifting and should be re-picked before the fallbacks drift too. */
  matchedSelector: string | null;
  matchedTier: string | null;
  /** The page this step acted on. Surfaced when a run touched more than one page, which is the
   *  only way to notice after the fact that a macro drifted onto the wrong tab. */
  tabUrl: string | null;
}

export interface RunReport {
  /** The profile loaded in the UI when the report was REQUESTED — not a property of the
   *  recorded run. It happens to equal the root on the automatic end-of-run push, but a manual
   *  Refresh after switching profiles renames it. Nothing renders it; per-step provenance is
   *  RunStep.profile, which is stamped at execution time and is the field to trust. */
  profile: string;
  startedAt: string | null;       // ISO; null when no run has been recorded yet
  /** Wall clock of the run minus the time it sat in a Pause action, stamped by the engine when
   *  the run ended. NOT the sum of step durations: a step's stopwatch wraps only its own work and
   *  excludes the Delay configured before it, so that sum reads 0.2 s for a ten-second run. Null
   *  on a report from a build that predates the field, and when no run has been recorded. */
  elapsedMs: number | null;
  /** How the run ENDED, decided on the replaying→ready edge. 'stopped' is the user's Stop; an
   *  authored Stop action and a quiet Assert stop are 'completed'. Null from an older build. */
  outcome: 'completed' | 'stopped' | 'failed' | null;
  overflow: number;               // steps dropped past the cap
  steps: RunStep[];
}

/** Per-profile automation trigger config — mirrors ProfileTriggerConfig on the backend. */
export interface TriggerConfig {
  kind: 'interval' | 'schedule' | 'condition';
  armed: boolean;
  intervalSeconds: number;
  timeOfDay: string | null;
  daysOfWeek: number;
  conditionType: string | null;
  windowProcessName: string | null;
  windowTitle: string | null;
  windowTitleMatchMode: string | null;
  windowMatchForegroundOnly: boolean;
  // PixelColorMatch / ImageFound: ancora as coordenadas na janela nomeada acima em vez de
  // trata-las como absolutas. Opt-in explicito — trocar o tipo de condicao nao limpa
  // windowProcessName, entao inferir a partir dele mudaria automacoes que ja funcionam.
  // Ignorado pelos outros quatro tipos, que nao tem coordenada.
  useRelativeCoordinates: boolean;
  filePath: string | null;
  pixelX: number;
  pixelY: number;
  pixelColor: string | null;
  pixelTolerance: number;
  imagePath: string | null;
  imageConfidence: number;
  // Derived C#→JS, display-only (never sent back): the reference PNG as base64 for the thumbnail.
  imageBase64: string | null;
  // ImageFound search region (ROI), absolute virtual-screen coords; null = full screen.
  searchRegion: { x: number; y: number; w: number; h: number } | null;
  clipboardPattern: string | null;
  // ScreenText watcher — same names and meaning as the ActionItem fields.
  conditionOperator?: string | null;
  conditionOperand?: string | null;
  ocrReadAs?: string | null;
  ocrTextColor?: string | null;
  ocrColorTolerance?: number | null;
  cooldownSeconds: number;
  retrigger: string | null;
  // How often the watcher re-probes, in ms. 0 = the per-condition default (see
  // TriggerService.PollCadenceMs). The knob exists because the cost is per-tick and
  // wildly uneven: an ImageFound watcher grabs and template-matches the whole virtual
  // screen every tick, so "check every 5 s" instead of every 1 s is a 5x cut a user
  // watching for something slow (an app launching, a download finishing) gives up nothing for.
  pollIntervalMs: number;
}

/** One trigger-bearing profile: full config + live runtime status. */
export interface AutomationEntry {
  profile: string;
  isDisabled: boolean;
  hasEffectiveTarget: boolean;
  trigger: TriggerConfig;
  running: boolean;
  conditionTrue: boolean;
  nextDueAt: string | null;
  lastFiredAt: string | null;
  fireCount: number;
  skippedBusy: number;
  skippedDirty: number;
  skippedModal: number;
  /** Clipboard changes swallowed by the app-traffic suppression window — NOT fire attempts,
   *  which is why they are counted apart from skippedBusy. */
  skippedSuppressed: number;
  lastResult: string | null;
}

export interface AutomationState {
  enabled: boolean;
  entries: AutomationEntry[];
}

export interface ButtonStates {
  recordEnabled: boolean;
  replayEnabled: boolean;
  recordingActive: boolean;
  replayActive: boolean;
  recordButtonText: string;
  replayButtonText: string;
  canUndo: boolean;
  canRedo: boolean;
  copiedCount: number;
}

// ── App State ──

/**
 * Per-profile loop settings, as resolved by WebViewBridge.BuildLoopConfig.
 * `count` is already clamped to 1..999 — 0 ("forever") is not an authorable macro value; an
 * endless run comes only from the WhilePressed / Toggle trigger modes.
 */
export interface ProfileLoopState {
  /** Times to repeat, 1..999. Always a real number, never the old 0 sentinel. */
  count: string;
  enabled: boolean;
  interval: string;
  intervalEnabled: boolean;
  /** An edit is pending that Ctrl+S / Save would persist. Drives the chip's dashed outline. */
  dirty: boolean;
  /** false = no profile loaded, so the Settings rows edit the app-level fallback instead. */
  scoped: boolean;
  /**
   * The loaded profile's OWN Game Mode (WebViewBridge.ResolveGameMode); null = it follows the
   * app default (`settings.smoothMovement`), and always null when `scoped` is false. Rides this
   * slice because it has the loop's lifecycle exactly — see ProjectProfileLoop. The effective
   * value is `gameMode ?? settings.smoothMovement`.
   */
  gameMode: boolean | null;
  /**
   * The loaded profile's OWN cursor return (WebViewBridge.ResolveRestoreCursor); null = it follows
   * the app default (`settings.restoreCursor`), always null when `scoped` is false. Same lifecycle
   * and same reason as `gameMode`.
   */
  restoreCursor: boolean | null;
}

export interface AppState {
  status: 'ready' | 'recording' | 'replaying';
  actions: ActionItem[];
  // Active profile's data-loop table (empty when unused). Kept in sync via data:table.
  dataTable: ProfileDataTable;
  // Automation daemon state (master switch + trigger-bearing profiles w/ live status).
  automation: AutomationState;
  profiles: ProfileEntry[];
  activeProfile: string | null;
  profileOrder: ProfileOrderData;
  settings: SettingsState;
  /**
   * Loop settings for the ACTIVE profile — the values a Replay will actually use.
   * Deliberately a top-level slice and not part of `settings`: settings:loaded replaces that
   * whole slice by merging over the defaults and has ~19 unrelated emitters (tray, ScrollLock,
   * Pause, key remaps, every Clicker picker), so an unsaved loop edit parked in there would be
   * wiped by, say, a mode toggle. Owned by the C# bridge; arrives via 'profile:loop' and in the
   * state:init blob, never mutated locally.
   */
  profileLoop: ProfileLoopState;
  toolbar: {
    profileName: string;
  };
  statusBar: {
    directory: string;
    profileName: string | null;
    actionCount: number;
  };
  buttonStates: ButtonStates;
  /**
   * Stack of sub-profile names currently active because of nested RunProfile
   * actions. Empty when not in a chain. Used by the status bar to render
   * "Running A → B" while a sub-profile executes.
   */
  replayChain: string[];
  /**
   * Pause action state. isPaused=true while the replay is awaiting either the
   * configured resume hotkey or timeout expiry. The status bar renders
   * "PAUSED — Press X or wait Ns" + a manual Resume button while active.
   */
  pauseState: {
    isPaused: boolean;
    hotkey: string;
    timeoutMs: number;
    startedAt: number;
  };
  /**
   * Increments on every explicit "reset to defaults" action. SettingsPanel watches it to
   * return its non-persistent local UI state (the clicker /s ↔ ms unit toggle) to default.
   * Cheap signal that doesn't bloat AppSettings with display-only prefs.
   * NOT a remount key any more — ClickerSection remounts for several unrelated reasons
   * (tab change, panel collapse, responsive auto-collapse), which reset the toggle far more
   * often than intended, so the state was lifted into SettingsPanel.
   */
  settingsResetEpoch: number;
}

/**
 * The slices the backend pushes on a ~4 Hz cadence during a run. They are deliberately
 * NOT part of AppState: every dispatch into the AppState reducer produces a new state object
 * and re-renders every useAppState() consumer, so leaving these in it meant a live Clicker
 * run re-rendered SettingsPanel, ProfilePanel and ActionTable four times a second to update
 * a counter only StatusBar and ClickerDashboard display. They live in their own provider and
 * their own hook (useClickerLive) so the cost lands only on the components that read them.
 *
 * The name is historical — `chainStep` is a MACRO-mode slice, and ClickerDashboard isn't even
 * mounted then (App renders it or the ActionTable, never both), so on a chained macro run the
 * only consumer of this context is the StatusBar. Kept as-is rather than renamed: the rename
 * would churn three files for no behaviour.
 */
/** Why a Clicker run ended — the four words the engine puts on the wire (clicker:ended). 'error' is a
 *  loop that threw: it used to arrive as 'stopped', indistinguishable from the user's own Stop. */
export type ClickerEndReason = 'stopped' | 'clicks' | 'time' | 'error';

/** Live target warnings (clicker:warning). One code today; a union so the next one is a one-liner. */
export type ClickerWarningCode = 'elevatedTarget';

export interface ClickerLiveState {
  /**
   * Clicker v2 — live click counter pushed from the backend during a Clicker run
   * (~4 Hz cadence, throttled in the loop). StatusBar renders "Clicked X · Y/s ·
   * MM:SS" from these. `active` flips on the first push; a new run (status →
   * 'replaying') resets the counter to zero, and 'ready' KEEPS the final count so the
   * total stays readable after the run (see clickerLiveReducer).
   */
  clickerStats: {
    active: boolean;
    count: number;
    elapsedMs: number;
    /** The run's duration limit in ms, 0 = none — the run's own snapshot, not the settings. */
    capMs: number;
    /** Button-start countdown, whole ms left; 0 while clicking (or when there was none). */
    countdownMs: number;
    /** Set once by clicker:ended; null while running and before the first run. */
    endReason: ClickerEndReason | null;
    /** SendInput calls rejected outright during the run (from clicker:ended). */
    blocked: number;
    /** Live target warning (clicker:warning); null while the target is a normal window. */
    warning: ClickerWarningCode | null;
  };
  /**
   * Macro loop counter — pushed during looping replays (~4 Hz throttle, plus a final push
   * when the run ends). Only set by the backend when the replay actually loops (loopCount
   * > 1 or infinite); single-shot replays leave this in its inactive default. StatusBar
   * gates rendering on `active`. `total === 0` means infinite (rendered as "Loop X/∞").
   */
  loopProgress: {
    active: boolean;
    current: number;
    total: number;
  };
  /**
   * Row position inside the sub-profile a RunProfile chain is currently executing — the
   * "(4/11)" tail StatusBar appends to the "A → B" read-out. Lives here rather than beside
   * `replayChain` in AppState because the STACK changes only on push/pop while this lands
   * ~4×/s, and AppState re-renders every consumer.
   *
   * `active` flips on the first push and is cleared by 'replay:chain' — a stack change means
   * a different frame is running, and the counter it describes no longer applies. Without
   * that clear, entering a second sub-profile would briefly show the first one's numbers.
   */
  chainStep: {
    active: boolean;
    current: number;
    total: number;
  };
}

// ── Messages C# → JS ──

// Data-loop table (Model A). Headers name the columns ({row:header}); rows are the
// data (each an ordered cell list aligned to headers by index). loopOverData drives the
// "run the profile once per row" behaviour.
export interface ProfileDataTable {
  headers: string[];
  rows: string[][];
  loopOverData: boolean;
  // Per-row error policy while looping over data: 'halt' (default) stops the run on the
  // first failed row; 'skip' logs the row and continues with the next one.
  onRowError: 'halt' | 'skip';
  // Cursor mode only (loopOverData off): chime + tray balloon when a run consumes the LAST
  // row, i.e. the list finished a pass and the next run wraps to row 1. Default true; only
  // an explicit opt-out is persisted.
  notifyOnLapComplete: boolean;
  // Cursor mode only: 0-based row the NEXT run will consume. RUNTIME state, not profile
  // content — it is never saved with the table and never part of the dirty check. -1 from the
  // backend means "this profile has never cursored", which behaves as row 0.
  //
  // Kept live (patched by data:cursor after every run) precisely because it is NOT editable
  // content: the seed-once rule above exists to protect the user's unsaved GRID edits from a
  // backend push, and a marker position has nothing to stomp.
  cursorRow: number;
}

/** One of the example macros that ship inside the app (examples:listResult). */
export interface ExampleInfo {
  name: string;
  description?: string | null;
  tags: string[];
  iconEmoji?: string | null;
  actionCount: number;
  /** The other examples it runs by name; examples:use copies them along. */
  runs: string[];
  /** A macro with this name is already in the library. */
  inLibrary: boolean;
}

/** The answer to examples:use: the name the example got in the library (a clash adds " (2)"). */
export interface ExampleUseResult {
  ok: boolean;
  requested: string;
  name?: string;
  copied?: string[];
  error?: string;
}

export type IncomingMessage =
  | { type: 'state:init'; payload: AppState }
  | { type: 'status:changed'; payload: { status: AppState['status'] } }
  | { type: 'actions:updated'; payload: { actions: ActionItem[] } }
  | { type: 'data:table'; payload: ProfileDataTable }
  // Row cursor moved (cursor mode): 0-based row the NEXT run consumes. Its own message rather
  // than a data:table re-push — the table can be thousands of cells and none of them changed.
  | { type: 'data:cursor'; payload: { row: number } }
  | { type: 'automation:state'; payload: AutomationState }
  // Tray "Automations…" clicked — restore + open the Automation panel.
  | { type: 'automation:open'; payload: Record<string, never> }
  // Tray "Browser extension…" clicked — restore + open the Browser extension dialog.
  | { type: 'extension:openHelp'; payload: Record<string, never> }
  // Reply to extension:help. path = the folder to load unpacked (already on the clipboard when
  // copied is true); exists = false only on a broken install, where the folder is missing.
  | { type: 'extension:help'; payload: { path: string; exists: boolean; copied: boolean; connected: boolean } }
  | { type: 'replay:report'; payload: RunReport }
  // Reply to automation:captureImage (region overlay). imagePath is the saved PNG's
  // per-profile relative path, ready to store on the trigger config.
  // refused/busyOwner ride along with cancelled (never instead of it — every existing branch
  // clears its pending state on cancelled): the capture surfaces share ONE global exclusive slot,
  // and reaching a refusal now means the holder was asked to close and did not answer. busyOwner
  // names it. The backend also raises alert:show, so nothing has to subscribe to these to be told.
  | { type: 'automation:imageCaptured'; payload: { requestId: string; cancelled: boolean; refused?: boolean; busyOwner?: string; imagePath?: string; imageBase64?: string } }
  // Reply to automation:testFire. `detail` is already user-facing prose (the TriggerFireResult
  // rendered), because the interesting answers are the SKIPS and each needs its own wording.
  | { type: 'automation:testFireResult'; payload: { requestId: string; fired: boolean; detail: string } }
  | { type: 'actions:highlight'; payload: { index: number } }
  | { type: 'profiles:updated'; payload: { profiles: ProfileEntry[]; activeProfile: string | null; profileOrder: ProfileOrderData } }
  | { type: 'settings:loaded'; payload: { settings: SettingsState } }
  // Narrow push for the active profile's loop settings. Fired by EVERY profile-activation
  // path (click, create, hotkey/hotstring, automation fire, import-overwrite reload, load,
  // delete/deselect to No Profile, reset) plus each Loops/Interval edit. Narrow on purpose —
  // see ProfileLoopState for why this cannot ride inside settings:loaded.
  | { type: 'profile:loop'; payload: ProfileLoopState }
  | { type: 'button:states'; payload: ButtonStates }
  | { type: 'toolbar:updated'; payload: { profileName: string } }
  | { type: 'statusbar:updated'; payload: { directory: string; profileName: string | null; actionCount: number } }
  | { type: 'alert:show'; payload: { message: string; type?: 'success' | 'error' | 'info'; duration?: number } }
  // Both carry the requestId of the profile:detectWindow they answer — two WindowTargetFields can
  // be mounted at once, and each applies only its own.
  | { type: 'windowTarget:detected'; payload: { requestId: string; processName: string; windowTitle: string } }
  | { type: 'windowTarget:detectState'; payload: { requestId: string; detecting: boolean } }
  | { type: 'windowTarget:testResult'; payload: { matches: boolean; foregroundProcess: string; foregroundTitle: string; error?: string } }
  // Exists-ANYWHERE window probe reply for the ActivateWindow Sheet editor's Test button.
  // Carries the requestId back so the Sheet can pair replies (unlike the legacy
  // windowTarget:testResult pair, which relies on the Target dialog being sole consumer).
  | { type: 'window:testProbeResult'; payload: { requestId: string; found: boolean; matchProcess: string; matchTitle: string; error?: string } }
  | { type: 'dialog:pickFileResult'; payload: { requestId: string; path?: string | null } }
  | { type: 'window:captureGeometryResult'; payload: { requestId: string; found: boolean; x: number; y: number; width: number; height: number; error?: string } }
  // The Target dialog's answer for both of its convert buttons: the combined "Apply target &
  // convert" on profile:setWindowTarget and the named profile:convertCoordinates. ok:true = the
  // coords were migrated (and, for the combined path, the target saved); the dialog dismisses the
  // migration hint and, after an apply, resets its `edited` flag so a second click can't
  // re-trigger the conversion. ok:false = refused or failed — the reason already went out as an
  // alert:show — and the dialog just lifts its in-flight lock, keeping the hint.
  | { type: 'windowTarget:applyConvertCompleted'; payload: { ok: boolean } }
  | { type: 'process:list'; payload: { processes: { name: string; title: string }[] } }
  | { type: 'clipboard:content'; payload: { text: string } }
  | { type: 'replay:chain'; payload: { stack: string[] } }
  // Row position inside the sub-profile currently running (~4 Hz, engine-throttled). Handled by
  // the live-slice reducer, NOT the AppState one — see ClickerLiveState.chainStep.
  | { type: 'replay:chainStep'; payload: { current: number; total: number } }
  | { type: 'replay:paused'; payload: { hotkey: string; timeoutMs: number } }
  | { type: 'replay:resumed'; payload: Record<string, never> }
  // {input:Label} Ask-Input modal: the resolver paused replay to ask the user. `options` non-null
  // → render a dropdown; null → a text field. inputDismiss closes a still-open prompt (Stop/cancel).
  | { type: 'replay:inputRequest'; payload: { requestId: string; label: string; options: string[] | null } }
  | { type: 'replay:inputDismiss'; payload: { requestId: string } }
  // Live-variables pane feed: the current run-state snapshot. Pushed on SetVariable/input/
  // slot writes (+ run start/end, and a throttled per-iteration bump). rowData is the
  // data-loop row currently executing (null outside a data run).
  | { type: 'replay:variables'; payload: { variables: Record<string, string>; slots: Record<string, string>; rowData: Record<string, string> | null } }
  // capMs = the run's own duration limit (0 = none), so time-to-finish comes from the run's
  // snapshot and not from settings the user may edit while it runs.
  | { type: 'clicker:stats'; payload: { count: number; elapsedMs: number; capMs: number } }
  // Whole ms left in the button-start countdown; 0 = clicking has begun.
  | { type: 'clicker:countdown'; payload: { remainingMs: number } }
  // Once per run, in the final flush before the READY status: why it ended, and how many
  // SendInput calls were rejected outright (not UIPI — see ClickerButton in ActionExecution.cs).
  | { type: 'clicker:ended'; payload: { reason: ClickerEndReason; blocked: number } }
  // Live target warning: 'elevatedTarget' while the root window under the cursor runs elevated
  // and the app does not (UIPI drops every click, SendInput says yes). The clearing message
  // arrives with the key OMITTED (the bridge serializer drops nulls) — read missing as null.
  | { type: 'clicker:warning'; payload: { code?: ClickerWarningCode | null } }
  | { type: 'macro:loopProgress'; payload: { current: number; total: number } }
  | { type: 'settings:reset'; payload: Record<string, never> }
  // Fired at the start of CheckForUpdateAsync so the overlay can show the indeterminate
  // "Checking for updates..." state (matches mockup phase 1). Resolves into update:available
  // (update found) or update:none (no update) shortly after.
  | { type: 'update:checking'; payload: Record<string, never> }
  // autoApply mirrors the backend's AutoApplyUpdates const so the overlay knows whether to
  // skip the "Download" gate (silent flow, mockup) or show the confirmation button (legacy).
  | { type: 'update:available'; payload: { version: string; currentVersion: string; notes: string[]; autoApply?: boolean } }
  | { type: 'update:progress'; payload: { percent: number } }
  | { type: 'update:ready'; payload: Record<string, never> }
  | { type: 'update:error'; payload: { message: string } }
  | { type: 'update:none'; payload: { currentVersion: string } }
  | { type: 'browser:status'; payload: { connected: boolean } }
  | { type: 'browser:pickResult'; payload: { requestId?: string; selector: string | null; alternatives?: SelectorAlternative[]; error?: string } }
  // Sent the moment the backend has RESOLVED the Test payload and knows what it will cost, before
  // the command goes to the extension. The panel's own safety net can only budget the raw text —
  // "{clipboard}" is one token there and however many characters it holds here — so it re-arms on
  // this. budgetMs is TypeKeyBudgetMs over the resolved text; timeoutMs is the element budget.
  | { type: 'browser:testAccepted'; payload: { requestId: string; budgetMs: number; timeoutMs: number } }
  | { type: 'browser:testResult'; payload: BrowserTestResult }
  // satisfied = which branch the If would take (negate already applied, same as InstantProbeAsync).
  // raw = the element state before negate. connected = false means we could not ask at all, which
  // must not be shown as a plain "false".
  | { type: 'browser:testConditionResult'; payload: { requestId: string; satisfied: boolean; raw: boolean; connected: boolean } }
  | { type: 'browser:extensionOutdated'; payload: { currentVersion: string; expectedVersion: string } }
  | { type: 'ocr:testReadResult'; payload: { requestId: string; text?: string; matched?: boolean | null; number?: string | null; x?: number; y?: number; w?: number; h?: number; elapsedMs?: number; variant?: string; language?: string; previewBase64?: string | null; error?: string } }
  // available = the packs installed on this PC; offered = the ones Settings always lists and can
  // install (Português, English); effective = the tag a read uses for the current pick (null = no
  // OCR at all); installing = the tag being installed now; pendingRestart = installed, but this
  // process's engine does not list it until the app restarts.
  | { type: 'ocr:languagesResult'; payload: OcrLanguagesPayload }
  | { type: 'examples:listResult'; payload: { examples: ExampleInfo[] } }
  | { type: 'examples:useResult'; payload: ExampleUseResult }
  | { type: 'profile:reverted'; payload: { ok: boolean; name?: string; error?: string } }
  // Save as you go (ui:capabilities { autoSave }): the open macro's file was written — after the
  // pause that follows an edit, on Ctrl+S, or right before a switch, a run or the window closing.
  // at is the UpdatedAt the file now carries; ok false names the error, and the edits stay pending.
  | { type: 'profile:saved'; payload: { ok: boolean; name: string; at?: string; error?: string } }
  | { type: 'ocr:installResult'; payload: { tag: string; ok: boolean; canceled: boolean; restartApp: boolean; restartWindows: boolean; error?: string | null } }
  | { type: 'image:testMatchResult'; payload: { requestId: string; found: boolean; score: number; x: number; y: number; w: number; h: number; error?: string } }
  | { type: 'waitimage:searchRegionSet'; payload: { requestId: string; cancelled: boolean; x?: number; y?: number; w?: number; h?: number } }
  // clicker:areaSet / clicker:pointSet used to live here. Removed with their emitters: the
  // Clicker pickers repaint through settings:loaded like every other settings write, so the
  // reply was never subscribed to on either branch. The sibling pickers below DO have
  // subscribers (SheetPanel) and stay.
  | { type: 'mouse:positionPicked'; payload: { requestId: string; cancelled: boolean; refused?: boolean; busyOwner?: string; x?: number; y?: number } }
  | { type: 'pixel:colorPicked'; payload: { requestId: string; cancelled: boolean; refused?: boolean; busyOwner?: string; x?: number; y?: number; hex?: string } }
  | { type: 'pixel:testMatchResult'; payload: { requestId: string; matches: boolean; sampledHex?: string | null; error?: string } }
  // Fired by the backend after a capture-first insert (Wait Image / Wait Pixel)
  // to auto-open the row's editor. The user just told us where the thing lives;
  // tolerance / timeout / on-timeout / etc are next — opening the sheet skips the
  // "find the new row and click it" detour.
  | { type: 'sheet:openIndex'; payload: { index: number } }
  // Fired by the backend while CaptureHotkeyMode is active. The combo string is
  // already composed (e.g. "Win+Q", "Ctrl+Shift+F5", "ScrollUp") and the hook has
  // swallowed the underlying OS event so it doesn't trigger Start menu / shell
  // shortcuts. Hotkey dialogs subscribe to this to fill the chip.
  | { type: 'hotkey:captured'; payload: { combo: string; owner?: string | null } }
  // ── Sharing-metadata messages ──
  // Pushed in response to profile:import (replaces the old auto-execute flow). The frontend
  // shows the security warning if requiresAcknowledgement, then the Import Preview dialog,
  // then sends profile:confirmImport with the selected names.
  | { type: 'profile:importPreview'; payload: ImportPreviewPayload }
  // Pushed INSTEAD of the alert:show toast when a confirmed import finished with
  // anything worth reading (skips, renames, image failures, folder-target notes,
  // hotkey collisions). A clean import keeps the plain success toast.
  | { type: 'profile:importResult'; payload: ImportResultPayload }
  // Pushed after a successful export — the frontend renders a success toast with a
  // "Show in folder" action (file:revealExport echoes exportId; paths stay server-side,
  // and the id pins each toast's action to the file THAT export wrote).
  | { type: 'profile:exportResult'; payload: {
      exportId: number;
      fileName: string | null;
      exportedCount: number;
      requestedCount: number;
      bundledDependencies: string[];
      missingImages: number;
    } }
  // Pushed in response to profile:getMetadata for the Info tab.
  | { type: 'profile:metadata'; payload: ProfileMetadataPayload }
  // Pushed in response to profile:listTags for the tag autocomplete.
  | { type: 'profile:tagList'; payload: { tags: TagListEntry[] } }
  // Confirmation after profile:bumpVersion succeeds — frontend can refresh its local
  // version display without waiting for the next profiles:updated push.
  | { type: 'profile:versionBumped'; payload: { name: string; newVersion: number } }
  // Backend confirms a window-target removal completed (vs being blocked by a hotkey/hotstring
  // collision, in which case the alert path fires and this event does NOT). Frontend uses this
  // to show the success-with-Undo toast — without it, an optimistic toast would appear even
  // when the removal was blocked, contradicting the alert.
  // The rect rides along because the Undo has to put it back and the profile list does not carry
  // geometry: resending the target alone left Restore Position/Size on over a zeroed rect.
  | { type: 'profile:windowTargetRemoved'; payload: { name: string; windowX: number; windowY: number; windowWidth: number; windowHeight: number } }
  // The folder twin: sent only when the removal went through, with EVERYTHING it wiped, so the
  // toast's Undo puts back the flags and the rect too, not just the target.
  | { type: 'profile:folderWindowTargetRemoved'; payload: { folderName: string; hadTarget: boolean; processName: string; windowTitle: string; titleMatchMode: string; relativeCoordinates: boolean; bringToFocus: boolean; restorePosition: boolean; restoreSize: boolean; windowX: number; windowY: number; windowWidth: number; windowHeight: number } };

// ── Messages JS → C# ──

/** Who holds an editor:pendingEdits claim — AutomationGuard keeps one stamp per owner. */
export type EditorClaimOwner = 'sheet' | 'row-dialog' | 'insert-dialog' | 'data-panel' | 'automation-panel';

/**
 * What a shell asks of the engine beyond today's behaviour (ui:capabilities, right after ui:ready).
 * A missing key is today's behaviour, and every ui:ready puts the engine back to it.
 * autoSave: the open macro saves as you go, with no unsaved-changes prompts (profile:saved).
 * extendedUndo: Ctrl+Z (actions:undo) also undoes the open macro's own settings — run settings, Data
 * Loop table, automation, info, hotkey, hotstring and window target — in one history with its steps.
 */
export interface EngineCapabilities {
  autoSave?: boolean;
  extendedUndo?: boolean;
}

export type OutgoingMessage =
  | { type: 'ui:ready'; payload: Record<string, never> }
  | { type: 'ui:capabilities'; payload: EngineCapabilities }
  | { type: 'data:request'; payload: Record<string, never> }
  // cursorRow is RUNTIME state, not table content: it is never saved with the profile, so the
  // save payload is the table minus it. Moving the cursor goes through actions:resetRow.
  | { type: 'data:save'; payload: Omit<ProfileDataTable, 'cursorRow'> }
  | { type: 'replay:reportRequest'; payload: Record<string, never> }
  | { type: 'automation:request'; payload: Record<string, never> }
  // trigger=null removes the automation from the profile.
  | { type: 'automation:save'; payload: { profile: string; trigger: TriggerConfig | null } }
  | { type: 'automation:setArmed'; payload: { profile: string; armed: boolean } }
  | { type: 'automation:setEnabled'; payload: { enabled: boolean } }
  | { type: 'automation:captureImage'; payload: { requestId: string; profile: string } }
  | { type: 'automation:cropReference'; payload: { requestId: string; profile: string; imagePath: string; x: number; y: number; w: number; h: number } }
  | { type: 'automation:testFire'; payload: { requestId: string; profile: string } }
  // Whole-list save of the key remap layer (capped at 32 entries backend-side).
  | { type: 'remap:save'; payload: { enabled: boolean; remaps: RemapEntryDto[] } }
  // "Replace the unreadable remaps.json with the list in memory" — the explicit choice the
  // sidecar quarantine waits for (RemapService.Save's overwriteUnreadableFile).
  | { type: 'remap:overwriteUnreadable'; payload: Record<string, never> }
  | { type: 'recording:toggle'; payload: { insertIndex?: number } }
  // No payload: the loop settings used to ride here, straight out of the React `settings`
  // slice, which no profile-activation path refreshes — so after switching from a 3x profile
  // to a 1x one the button sent the stale 3. The backend resolves them itself now
  // (WebViewBridge.BuildLoopConfig), same as the hotkey and automation paths.
  | { type: 'replay:toggle'; payload: Record<string, never> }
  | { type: 'replay:resume'; payload: Record<string, never> }
  // Answer to a replay:inputRequest. cancelled=true aborts the run; else `value` is substituted.
  | { type: 'replay:inputResult'; payload: { requestId: string; value: string; cancelled: boolean } }
  // Live-variables pane opened — ask the backend for the current snapshot on demand.
  | { type: 'replay:variablesRequest'; payload: Record<string, never> }
  | { type: 'clicker:pause'; payload: Record<string, never> }
  | { type: 'actions:clear'; payload: Record<string, never> }
  | { type: 'actions:undo'; payload: Record<string, never> }
  | { type: 'actions:redo'; payload: Record<string, never> }
  | { type: 'actions:copy'; payload: Record<string, never> }
  | { type: 'actions:copyInternal'; payload: { indices: number[] } }
  | { type: 'actions:paste'; payload: { insertIndex: number } }
  // `id` (optional) is the row the editor OPENED: when present the backend refuses — out loud —
  // an edit whose index now holds a different row (the list or the profile changed under it).
  | { type: 'actions:edit'; payload: { index: number; id?: string; field: string; value: string } }
  // Several field edits on ONE row, applied in order under ONE undo entry. An editor's Save is one
  // edit the user made that happens to touch N fields; sending it as N messages made each one its
  // own undo state, so a single Ctrl+Z landed on a snapshot taken BETWEEN two of them — X moved
  // with Y still old, a hold on the previous key, a point that existed at no moment of the edit.
  // The backend validates the whole batch before snapshotting, so it applies whole or not at all.
  // `convert` rides ALONG so a Sheet Save that both edits fields and switches the row's form is
  // one message and therefore one undo entry. The backend applies the edits first and the
  // conversion last, because a split changes the row count and `index` addresses the edits.
  | { type: 'actions:editMany'; payload: { index: number; id?: string; edits: { field: string; value: string }[]; convert?: { direction: 'toPaired' | 'toCombined'; indices: number[] } } }
  | { type: 'actions:delete'; payload: { indices: number[] } }
  | { type: 'profile:click'; payload: { name: string } }
  // Opens a macro and never closes the open one (D1); opening the open macro does nothing.
  | { type: 'profile:open'; payload: { name: string } }
  // "Revert to when I opened it": the open macro's file goes back to the copy taken when it was
  // opened, and the macro reopens from it. The page confirms; there is no native dialog.
  | { type: 'profile:revert'; payload: Record<string, never> }
  | { type: 'profile:create'; payload: { name: string; folder?: string } }
  | { type: 'profile:rename'; payload: { oldName: string; newName: string } }
  | { type: 'profile:duplicate'; payload: { name: string } }
  | { type: 'profile:toggleDisable'; payload: { name: string } }
  | { type: 'profile:delete'; payload: { name: string } }
  | { type: 'profile:assignHotkey'; payload: { name: string; hotkey: string; mode?: TriggerMode } }
  | { type: 'profile:removeHotkey'; payload: { name: string } }
  | { type: 'profile:assignHotstring'; payload: { name: string; sequence: string; instant: boolean } }
  | { type: 'profile:removeHotstring'; payload: { name: string } }
  | { type: 'profile:setWindowTarget'; payload: { name: string; processName: string; windowTitle: string; titleMatchMode: string; relativeCoordinates?: boolean; bringToFocus?: boolean; restorePosition?: boolean; restoreSize?: boolean; keepInheritedTarget?: boolean;
      // When set, the backend chains ExecuteConvertCoordinates after the target save
      // completes. Used by the Window Target dialog's "Apply target & convert"
      // path so save + conversion land atomically (no race with a separate
      // convertCoordinates message dispatched alongside this one).
      convertDirection?: 'toRelative' | 'toAbsolute';
      // The captured rect, all four or none — only an Undo sends it, to put back what the
      // removal zeroed (profile:windowTargetRemoved carries it).
      windowX?: number; windowY?: number; windowWidth?: number; windowHeight?: number } }
  // name: the Target dialog's profile — refused unless it is still the loaded one, and answered
  // with windowTarget:applyConvertCompleted. The palette omits it and acts on the loaded profile.
  | { type: 'profile:convertCoordinates'; payload: { direction: 'toRelative' | 'toAbsolute'; name?: string } }
  | { type: 'profile:updateWindowSize'; payload: { name?: string; folderName?: string; processName?: string; windowTitle?: string; titleMatchMode?: string } }
  // The four target flags (relativeCoordinates / bringToFocus / restorePosition / restoreSize)
  // and the trigger mode each used to have a message of their own. They ride profile:
  // setWindowTarget and profile:assignHotkey now, which is what makes them atomic with the
  // thing they qualify — nothing has sent the singles since, so they are gone.
  | { type: 'profile:removeWindowTarget'; payload: { name: string } }
  // The rect is the Undo's, as on profile:setWindowTarget (profile:folderWindowTargetRemoved).
  | { type: 'profile:setFolderWindowTarget'; payload: { folderName: string; processName: string; windowTitle: string; titleMatchMode: string; relativeCoordinates?: boolean; bringToFocus?: boolean; restorePosition?: boolean; restoreSize?: boolean; windowX?: number; windowY?: number; windowWidth?: number; windowHeight?: number } }
  | { type: 'profile:removeFolderWindowTarget'; payload: { folderName: string } }
  // Explicit start/stop, not a toggle: a stop only ends the detection its requestId started, and a
  // start while another instance's detection is armed takes it over (that one gets detecting:false).
  | { type: 'profile:detectWindow'; payload: { requestId: string; enabled: boolean } }
  | { type: 'profile:testWindowMatch'; payload: { processName: string; windowTitle: string; titleMatchMode: string } }
  // Window probe for the ActivateWindow editor and the If/Wait-window rows — same matcher the
  // replay uses (".exe" auto-append, self-excluded). `matchIndex` picks the Nth match the way
  // ActivateWindow does; `foregroundOnly` asks what a foreground-only condition asks, so the
  // verdict is the one the run will reach.
  | { type: 'window:testProbe'; payload: { requestId: string; processName: string; windowTitle: string; titleMatchMode: string; foregroundOnly?: boolean; matchIndex?: number } }
  | { type: 'dialog:pickFile'; payload: { requestId: string; kind: string } }
  | { type: 'window:captureGeometry'; payload: { requestId: string; processName: string; windowTitle: string; titleMatchMode: string } }
  | { type: 'process:list'; payload: Record<string, never> }
  | { type: 'profile:openFolder'; payload: { name?: string } }
  | { type: 'profile:pin'; payload: { name: string } }
  | { type: 'profile:unpin'; payload: { name: string } }
  | { type: 'profile:createFolder'; payload: { name: string; color?: string } }
  | { type: 'profile:renameFolder'; payload: { oldName: string; newName: string } }
  | { type: 'profile:deleteFolder'; payload: { name: string } }
  | { type: 'profile:setFolderColor'; payload: { name: string; color: string } }
  | { type: 'profile:toggleFolderCollapse'; payload: { name: string } }
  // Bulk collapse/expand behind the panel header's Collapse-all / Expand-all button
  // (it was a folder context-menu item until 9beaedb). One disk write regardless of
  // folder count.
  | { type: 'profile:setAllFoldersCollapsed'; payload: { collapsed: boolean } }
  | { type: 'profile:toggleFolderDisable'; payload: { name: string } }
  | { type: 'profile:moveToFolder'; payload: { profileName: string; folderName: string | null } }
  | { type: 'profile:reorder'; payload: { pinned?: string[]; folders?: ProfileFolder[]; ungroupedOrder?: string[] } }
  | { type: 'profile:save'; payload: Record<string, never> }
  | { type: 'profile:load'; payload: Record<string, never> }
  | { type: 'profile:reset'; payload: Record<string, never> }
  // Every app setting back to its default, without touching the open macro or the Automations
  // master switch (D23). The page confirms; there is no native dialog.
  | { type: 'settings:resetAll'; payload: Record<string, never> }
  // The example macros inside the app (decision 4): the list, and "Use this example", which copies
  // one (and the examples it runs) into the library's Examples folder.
  | { type: 'examples:list'; payload: Record<string, never> }
  | { type: 'examples:use'; payload: { name: string } }
  | { type: 'settings:change'; payload: { key: string; value: string | boolean | number | object | null } }
  // `indices` absent = the whole profile (the command palette's convert). Present = those rows
  // only, which is the row menu's Split / Merge. The backend groups them into contiguous runs
  // before converting, because both transforms work on adjacency.
  | { type: 'actions:convertMode'; payload: { direction: 'toCombined' | 'toPaired'; indices?: number[] } }
  // One actionType across N rows in ONE undo entry. Looping actions:edit per index costs one
  // undo state per row — see HandleBulkUpdateType.
  | { type: 'actions:bulkUpdateType'; payload: { indices: number[]; actionType: string } }
  | { type: 'actions:addSendText'; payload: { text: string; html?: string; markdown?: string; mode?: string; method?: string; charDelayMs?: number | null; insertIndex?: number } }
  | { type: 'actions:editSendText'; payload: { index: number; id?: string; text: string; html?: string; markdown?: string; mode?: string; method?: string; charDelayMs?: number | null } }
  // Same Set | Add contract as bulkUpdateCoord: `mode` is required, Add takes a signed delta and
  // the sum stops at 0 ms.
  | { type: 'actions:bulkUpdateDelay'; payload: { indices: number[]; mode: 'set' | 'add'; delay: number } }
  // `mode` says what the number does — the sign no longer does (Set -10 sets -10). Required:
  // the backend refuses a message without it rather than guess.
  | { type: 'actions:bulkUpdateCoord'; payload: { indices: number[]; axis: 'x' | 'y'; mode: 'set' | 'add'; value: number } }
  | { type: 'actions:bulkUpdateComment'; payload: { indices: number[]; comment: string } }
  | { type: 'actions:toggleSkip'; payload: { indices: number[] } }
  | { type: 'actions:toggleFocusClick'; payload: { indices: number[] } }
  // Reset a SetVariable cycle row to its first item (clears the in-memory cursor).
  | { type: 'actions:resetCycle'; payload: { index: number } }
  // Reset the data-loop row cursor (Model B) to the first row. Profile-level.
  // No row = reset the data-loop cursor to the first row. A row index = park it there
  // ("Set cursor here"), the recovery for a run that consumed its row and then failed.
  | { type: 'actions:resetRow'; payload: { row?: number } }
  | { type: 'actions:reorder'; payload: { indices: number[]; targetIndex: number } }
  | { type: 'actions:insertAction'; payload: { actionType: string; insertIndex: number } }
  // Pause insert (Pattern B normalization) — replaces the old "insertAction with
  // actionType=Pause then auto-open Sheet" flow. The dialog captures the resume
  // hotkey + timeout up-front; backend inserts a fully-configured row with no
  // sheet:openIndex follow-up. Either key or timeoutMs (or both) may be empty/0
  // for an infinite manual-resume Pause.
  | { type: 'actions:insertPause'; payload: { key: string; timeoutMs: number; insertIndex: number } }
  // Conditional logic — inserts a single Else row just BEFORE the EndIf that matches
  // the IF at ifRowIndex. Backend forward-scans with a stack of nested IFs to find the
  // right EndIf, so the call works in nested blocks without the caller having to track
  // depth. PushUndoState is fired so the user can Ctrl+Z the Else they just added.
  | { type: 'actions:addElseBranch'; payload: { ifRowIndex: number } }
  // Conditional logic — appends ONE ElseIf arm to the branch chain of the IF at ifRowIndex.
  // The caller does NOT choose the position: the backend forward-scans (FindBranchChainAnchor)
  // and lands the row before the terminal Else, or before the EndIf when the block has none,
  // because an arm placed after the unconditional Else is unreachable and would be stripped by
  // the load-time validator. conditionType is the probe family, the same ten insertConditional
  // accepts; 'ImageFound' / 'PixelColorMatch' run their capture overlay first and a cancel
  // inserts zero rows. Unlike insertConditional this adds ONE row — the block already owns its
  // EndIf. PushUndoState is fired so the arm is a single Ctrl+Z away.
  | { type: 'actions:addElseIfBranch'; payload: { ifRowIndex: number; conditionType: 'ImageFound' | 'PixelColorMatch' | 'WindowOpen' | 'ClipboardMatch' | 'BrowserElementState' | 'Random' | 'Variable' | 'ProcessRunning' | 'FileExists' | 'TimeWindow' | 'ScreenText' } }
  // Conditional logic — capture-first insert. conditionType selects which probe family
  // the new IF uses: 'ImageFound' runs the same screen overlay region-pick as WaitImage
  // and the captured image becomes the IF's reference; 'PixelColorMatch' runs the same
  // point-pick as WaitPixelColor and the captured X/Y/colour become the IF's probe data.
  // After capture, the backend inserts {If, EndIf} as a pair at insertIndex and
  // auto-opens the Sheet on the new IF row. If the user hits Esc during capture, nothing
  // is inserted — same "cancel means cancel" rule the Wait* flows follow.
  // 'WindowOpen', 'ClipboardMatch' and 'BrowserElementState' are capture-less: the
  // {If, EndIf} pair inserts immediately with empty probe fields and the Sheet auto-opens
  // to fill them. BrowserElementState reuses BrowserWaitElement's probe fields (key =
  // selector, waitMode, browserText = text pattern) the same way If-Image reuses WaitImage's.
  | { type: 'actions:insertConditional'; payload: { conditionType: 'ImageFound' | 'PixelColorMatch' | 'WindowOpen' | 'ClipboardMatch' | 'BrowserElementState' | 'Random' | 'Variable' | 'ProcessRunning' | 'FileExists' | 'TimeWindow' | 'ScreenText'; insertIndex: number } }
  // Desktop Assert — a LEAF row (no EndIf partner), so it gets its own message instead of riding
  // actions:insertConditional, which always inserts a block pair. Narrower condition union on
  // purpose: image/pixel already abort on timeout via WaitImage/WaitPixelColor, Random is
  // meaningless as a requirement, and a page element has its own BrowserAssert action.
  // conditionTimeout/assertOnFail are the Wait ▾ preset's pre-arm (poll budget 10 s +
  // quiet-stop policy); absent, the backend keeps the classic Assert seed (1500 ms, Halt).
  | { type: 'actions:insertAssert'; payload: { conditionType: 'WindowOpen' | 'ProcessRunning' | 'ClipboardMatch' | 'Variable' | 'FileExists' | 'TimeWindow'; insertIndex: number; conditionTimeout?: number; assertOnFail?: 'StopReplay' | 'Continue' } }
  // Conditional logic — delete the entire IF/ELSE/ENDIF block. Backend forward-scans
  // from ifRowIndex with a nested-IF stack to find the matching EndIf, then removes
  // the contiguous range [ifRowIndex..endIfIdx] inclusive (covers body + optional ELSE
  // + body + ENDIF). Wired from the row-actions menu's Delete on IF rows so deleting an
  // IF alone never orphans its body. PushUndoState fires so the deletion is reversible.
  | { type: 'actions:deleteConditional'; payload: { ifRowIndex: number } }
  // Loop blocks — insert {While, EndLoop} (capture-first for Image/Pixel guards, direct +
  // Sheet for the state families; Random is deliberately NOT offered: a coin-flip loop
  // guard has no stable ending) or {ForEachRow, EndLoop} (kind: 'ForEachRow'; ignores
  // conditionType, nothing to configure so no Sheet auto-open).
  | { type: 'actions:insertLoop'; payload: { conditionType?: 'ImageFound' | 'PixelColorMatch' | 'WindowOpen' | 'ClipboardMatch' | 'BrowserElementState' | 'Variable' | 'ProcessRunning' | 'FileExists' | 'TimeWindow' | 'ScreenText'; insertIndex: number; kind?: 'While' | 'ForEachRow' } }
  // Delete the entire loop block (opener + body + EndLoop) — deleteConditional's mirror
  // with a kind-aware scan (both loop openers deepen, only EndLoop pops).
  | { type: 'actions:deleteLoop'; payload: { loopRowIndex: number } }
  // Delete ONE Else If arm — its marker plus its body — leaving the rest of the chain standing.
  // Sibling of deleteConditional/deleteLoop, with the one structural difference that matters: an
  // arm is not a block, so the scan stops one row EARLIER than those two and the boundary row
  // (the next ElseIf/Else, or the EndIf) SURVIVES. Without this the row falls through to
  // actions:delete, where snapIndicesToBlocks sees a STRUCTURAL row and takes the whole If…EndIf.
  | { type: 'actions:deleteElseIfArm'; payload: { elseIfRowIndex: number } }
  // Insert a single Keystroke action (atomic combo like "Alt+Tab", "Ctrl+Shift+T").
  // Unlike insertKey which expands a single tap into a KeyDown+KeyUp pair, insertKeystroke
  // creates ONE row holding the whole combo as a "+"-joined string. The replay engine
  // expands it to the proper modifier-down → key-down → key-up → modifier-up sequence at
  // run time. Captured by KeystrokeCaptureDialog from a real keypress.
  // `repeat` / `repeatDelayMs` are optional — present when the "Press × N" insert flow
  // dispatches this message so the new row lands with RepeatCount preset; absent for
  // the regular "Send Keystroke" path which creates a single-press row (RepeatCount = 1).
  | { type: 'actions:insertKeystroke'; payload: { keystroke: string; insertIndex: number; repeat?: number; repeatDelayMs?: number; repeatDelayJitterPct?: number } }
  // HoldKey insert — captures a single key and a hold duration (ms). Replay
  // engine emits KEYDOWN, waits holdDurationMs, then KEYUP. Default duration
  // applied server-side when holdDurationMs is absent.
  | { type: 'actions:insertHoldKey'; payload: { key: string; insertIndex: number; holdDurationMs?: number } }
  // Click insert — the mouse twin of insertKeystroke/insertHoldKey, and the only path that
  // creates a click row without recording one. `actionType` is any COMBINED click (the backend
  // validates against ActionItem.IsCombinedClickType, so a paired half is refused). `atCursor:
  // true` resolves the point from the live cursor and is the only way to omit x/y — the backend
  // refuses a row with neither, because a click aimed at 0,0 by default would be a press in the
  // screen corner rather than an obvious slip. holdDurationMs is read only for *ClickHold;
  // repeat/repeatDelayMs are omitted for a single shot so the row persists nothing.
  // `paired` writes the click as TWO rows (Down then Up) instead of one; upX/upY give the Up its
  // own point, which is how a DRAG gets built by hand. actionType stays a COMBINED name either
  // way — the flag says what shape to write, so the wire keeps one vocabulary.
  | { type: 'actions:insertClick'; payload: { actionType: string; insertIndex: number; x?: number; y?: number; atCursor?: boolean; holdDurationMs?: number; repeat?: number; repeatDelayMs?: number; paired?: boolean; upX?: number; upY?: number } }
  // WaitPixelColor — minimises the app, opens the screen overlay in pointPick mode,
  // and only inserts the row after the user clicks a pixel (or nothing on Esc).
  // Mirrors how WaitImage's insertion flow works, so the two actions behave the
  // same way when picked from the toolbar / context menu.
  | { type: 'actions:insertWaitPixelColor'; payload: { insertIndex: number } }
  | { type: 'actions:duplicate'; payload: { indices: number[] } }
  // Atomic replace of a contiguous range — used by the "Collapse to × N" /
  // "Expand × N" flow so N rows in becomes M rows out under one undo step.
  // The bridge handler validates bounds; replacement is the new row(s) to splice
  // in at startIndex after removing `count` existing rows.
  | { type: 'actions:replaceRange'; payload: { startIndex: number; count: number; replacement: Partial<ActionItem>[] } }
  | { type: 'actions:addRunProfile'; payload: { profileName: string; repeatCount: number; runOverData?: boolean; insertIndex?: number } }
  | { type: 'actions:editRunProfile'; payload: { index: number; id?: string; profileName: string; repeatCount: number; runOverData?: boolean } }
  | { type: 'waitimage:recapture'; payload: { index: number } }
  // `anchor` (as tres abaixo): a janela a que um vigia de automacao ancora suas coordenadas.
  // Presente => o backend subtrai a origem dela ao GRAVAR e a soma ao exibir/testar, para que o
  // valor em disco viva no mesmo espaco que TriggerService.ProbeCondition le. Ortogonal a
  // `absolute`, que continua significando 'nao use o alvo do perfil ATIVO'.
  | { type: 'waitimage:configureSearchRegion'; payload: { requestId: string; absolute?: boolean; anchor?: { processName: string; windowTitle: string; titleMatchMode: string }; x?: number; y?: number; w?: number; h?: number } }
  // No requestId: there is no reply to correlate it with (see the note above).
  | { type: 'clicker:configureArea'; payload: Record<string, never> }
  | { type: 'clicker:configurePoint'; payload: Record<string, never> }
  // Clicker presets — named snapshots of the cursorClick* settings, global like the rest. The
  // bridge answers all three with settings:loaded (the list rides in cursorClickPresets).
  | { type: 'clicker:savePreset'; payload: { name: string } }
  | { type: 'clicker:applyPreset'; payload: { name: string } }
  | { type: 'clicker:deletePreset'; payload: { name: string } }
  /** The toast's Undo for the LAST delete: the backend puts that preset back in its slot. */
  | { type: 'clicker:undoDeletePreset'; payload: { name: string } }
  | { type: 'waitimage:cropReference'; payload: { index: number; x: number; y: number; w: number; h: number } }
  | { type: 'ocr:testRead'; payload: { requestId: string; searchRegion?: { x: number; y: number; w: number; h: number }; absolute?: boolean; anchor?: { processName: string; windowTitle: string; titleMatchMode: string }; readAs?: string | null; operator?: string | null; operand?: string; match?: boolean; textColor?: string | null; tolerance?: number } }
  | { type: 'ocr:languages'; payload: Record<string, never> }
  | { type: 'ocr:installLanguage'; payload: { tag: string } }
  | { type: 'ocr:configureHotkeyRegion'; payload: Record<string, never> }
  | { type: 'image:testMatch'; payload: { requestId: string; imagePath: string; confidence: number; searchRegion?: { x: number; y: number; w: number; h: number }; absolute?: boolean; anchor?: { processName: string; windowTitle: string; titleMatchMode: string }; profile?: string } }
  | { type: 'mouse:pickPosition'; payload: { requestId: string } }
  // absolute: skip the profile-relative translation (automation watchers sample
  // virtual-screen coords with no window context).
  | { type: 'pixel:pickColor'; payload: { requestId: string; absolute?: boolean; anchor?: { processName: string; windowTitle: string; titleMatchMode: string } } }
  | { type: 'pixel:testMatch'; payload: { requestId: string; x: number; y: number; hex: string; tolerance: number } }
  | { type: 'selection:changed'; payload: { indices: number[] } }
  | { type: 'window:alwaysOnTop'; payload: { enabled: boolean } }
  | { type: 'window:minimizeToTray'; payload: { enabled: boolean } }
  | { type: 'window:runOnStartup'; payload: { enabled: boolean } }
  | { type: 'window:startMinimized'; payload: { enabled: boolean } }
  | { type: 'window:runEndFlash'; payload: { enabled: boolean } }
  | { type: 'window:runEndSound'; payload: { enabled: boolean } }
  | { type: 'window:reloadUI'; payload: Record<string, never> }
  | { type: 'profile:export'; payload: { names: string[]; includeOrganization?: boolean; includeDependencies?: boolean } }
  | { type: 'profile:import'; payload: Record<string, never> }
  | { type: 'clipboard:read'; payload: Record<string, never> }
  | { type: 'update:check'; payload: Record<string, never> }
  | { type: 'update:apply'; payload: Record<string, never> }
  | { type: 'logs:openFolder'; payload: Record<string, never> }
  // The Browser extension dialog: help copies the extension folder's path to the clipboard and
  // answers with extension:help; openFolder shows that folder in Explorer.
  | { type: 'extension:help'; payload: Record<string, never> }
  | { type: 'extension:openFolder'; payload: Record<string, never> }
  // Open an https URL in the default browser. The backend allow-lists the host (the project's
  // own pages only), so this is a door to the manual, not a general launcher.
  | { type: 'shell:openUrl'; payload: { url: string } }
  // "Copy Diagnostics" — the backend gathers version / OS / WebView2 / state and puts one block
  // of text on the clipboard, then confirms with alert:show.
  | { type: 'diagnostics:copy'; payload: Record<string, never> }
  | { type: 'actions:addBrowserAction'; payload: { actionType: string; selector: string; browserText?: string; newTab?: boolean; insertIndex?: number } }
  // No browser:toggleRecording: the extension's recording mode is driven from the app side
  // (the recording status change and the Browser Actions setting both call SetRecordingMode),
  // never from a message, so the frontend has nothing to toggle.
  | { type: 'browser:pickElement'; payload: { requestId: string } }
  | { type: 'browser:cancelPick'; payload: Record<string, never> }
  | { type: 'browser:testAction'; payload: { requestId: string; actionType: string; key: string; browserText?: string; newTab?: boolean; timeout: number; waitMode?: string | null; urlWaitPattern?: string | null; postNavigateSelector?: string | null; typeAppend?: boolean; typePaste?: boolean; typeDelay?: number | null; selectMatchMode?: string | null; alternatives?: SelectorAlternative[] | null } }
  // "Is this condition true right now?" for the If-Browser-Element editor. Distinct from
  // browser:testAction because a condition has no failure state — a not-found element is the
  // answer, not an error — so the reply is a branch, not a success/error pair.
  | { type: 'browser:testCondition'; payload: { requestId: string; key: string; waitMode?: string | null; browserText?: string | null; conditionNegate?: boolean; alternatives?: SelectorAlternative[] | null } }
  | { type: 'theme:colors'; payload: { bgSurface: string; bgCard: string; textPrimary: string; textSecondary: string; accentSolid: string; borderSubtle: string } }
  | { type: 'hotkey:suppress'; payload: { enabled: boolean } }
  // The row editor holds edits that have not become `actions:edit` yet. Read ONLY by
  // AutomationGuard, so an autonomous fire refuses (retriably, as SkippedModal) instead of
  // swapping the profile out from under the open form. Deliberately not hotkey:suppress —
  // that would take the user's own hotkeys down with it — and not the unsaved-changes flag,
  // whose skip is terminal.
  // `owner` keeps the Sheet's claim and the row dialogs' claim apart, so one editor closing does
  // not release the other's (AutomationGuard holds one stamp per owner).
  // One claim per owner (AutomationGuard): the Sheet, the grid's row editors, the Toolbar's insert
  // dialogs, the Data table and the Automations panel. Sent through logic/useEditorClaim.
  | { type: 'editor:pendingEdits'; payload: { pending: boolean; owner: EditorClaimOwner } }
  // Zero one automation's fire/skip tallies. The interval anchor (lastFiredAt) and the schedule's
  // double-fire guard are kept — they are state, not history.
  | { type: 'automation:resetCounters'; payload: { profile: string } }
  // Activates the backend's low-level keyboard hook in capture mode: every keydown
  // gets composed via BuildComposedKey, emitted through 'hotkey:captured', and
  // swallowed before the OS shell sees it. This is what allows binding Win+letter
  // combos that the WebView2 JS layer never receives.
  //
  // ownerId is the refcount slot key — multiple components (Pause dialog, Sheet
  // editor, Settings hotkey field, ...) can hold capture open simultaneously
  // without stomping each other on cleanup (each registers under its own ID).
  // Optional for backward compat: payloads without ownerId share a single
  // "legacy" slot, matching pre-refcount v2.3.0 behaviour exactly.
  | { type: 'hotkey:capture'; payload: { enabled: boolean; ownerId?: string } }
  // ── Sharing-metadata outgoing ──
  | { type: 'profile:getMetadata'; payload: { name: string } }
  | { type: 'profile:setMetadata'; payload: { name: string; description?: string | null; tags?: string[] | null; iconEmoji?: string | null } }
  | { type: 'profile:bumpVersion'; payload: { name: string } }
  | { type: 'profile:listTags'; payload: Record<string, never> }
  // Phase 2 of import: tell the bridge which profiles (by name) from the previously
  // previewed envelope to actually import. conflictResolutions specifies what to do
  // for each profile name that collides with an existing local profile — defaults to
  // 'rename' server-side if a conflicting profile is missing from the map (defence
  // against frontend bugs / stale previews).
  | { type: 'profile:confirmImport'; payload: { selectedNames: string[]; conflictResolutions: Record<string, ImportConflictResolution> } }
  // Sent when the user dismisses the preview without importing (cancels the security
  // warning or the Import Preview dialog). Tells the bridge to drop the server-side
  // parsed envelope so it doesn't linger in memory.
  | { type: 'profile:cancelImport'; payload: Record<string, never> }
  // Reveal an exported .trprofile in Explorer. Carries only the exportId echoed from
  // profile:exportResult — the id→path map stays server-side, so the frontend can
  // never point explorer.exe at an arbitrary path.
  | { type: 'file:revealExport'; payload: { exportId: number } }
  // Persists the "Don't show again" choice on the security warning so subsequent imports
  // skip the warning dialog.
  | { type: 'settings:acknowledgeImportWarning'; payload: Record<string, never> };
