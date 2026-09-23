import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useImperativeHandle, lazy, Suspense, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, RefreshCw, Crosshair, Copy, ClipboardPaste, ShieldCheck, ShieldAlert, ShieldQuestion, PlayCircle, Pipette, Check, X, Frame, FolderOpen, Maximize } from 'lucide-react';
import { ActionIcon } from './ActionTable';
import { useBridge } from '../bridge/BridgeContext';
import { useAppState } from '../state/AppStateContext';
import { carriesConditionProbe, hasConditionFields } from '../utils/conditionalBlocks';
import { typeBudgetMs as typeBudgetMsOf } from '../utils/typeBudget';
import { useTt } from '../state/LanguageContext';
import { useToast } from '../state/ToastContext';
import type { SelectorAlternative, BrowserTestResult } from '../bridge/messageTypes';
import { Checkbox } from './Checkbox';
import { NumberInput } from './common/NumberInput';
import { SegmentedControl } from './common/SegmentedControl';
import { DurationChips, DURATION_PRESETS, TIMEOUT_PRESETS } from './common/DurationChips';
import { ProcessNameInput } from './common/ProcessNameInput';
import { FieldError } from './common/FieldError';
import { CheckboxBox } from './Checkbox';
import { Button } from './common/Button';
import { calloutStyle } from './common/Callout';
import { iconButtonClass } from './common/IconButton';
import { ImageCropper } from './ImageCropper';
// Deferred: only the BrowserType "Text to Type" field renders this, but a static import pulls
// the whole Lexical editor stack into the sheet's chunk — parsed on the first sheet open even
// for the plain click/key edits that are the common case. Splitting here needs no ref
// plumbing: LexicalTokenEditor is a plain named export (no forwardRef), and the imperative
// handle travels through the `apiRef` prop.
const LexicalTokenEditor = lazy(() => import('./lexical/LexicalTokenEditor').then(m => ({ default: m.LexicalTokenEditor })));
import type { LexicalEditorHandle } from './lexical/LexicalTokenEditor';
import { getDisplayKey, isClickHold, CLICK_FAMILY_TYPES, clickFormOf, NO_COORD_TYPES } from '../utils/displayUtils';
import { MIN_HOLD_MS, MAX_HOLD_MS, DEFAULT_HOLD_MS, DEFAULT_CLICK_GAP_MS, CLICK_COORD_TOLERANCE_PX, clickDefaultGap, rowDwellMs } from '../utils/actionCost';

// How often the open row editor re-stamps its unsaved-work claim with AutomationGuard. Must stay
// WELL under `AutomationGuard.EditorClaimTtl` (10 min) — that deadline is measured from the last
// stamp, so the gap between renewals is the only thing that can let it lapse under a live editor.
// One small message a minute, and only while the editor actually holds unsaved fields.
const EDITOR_CLAIM_RENEW_MS = 60_000;
import { Field, Section } from './sheet/Field';
import { WindowTargetFields } from './WindowTargetFields';
import { Slider } from './sheet/Slider';

interface SheetPanelProps {
  actionIndex: number | null;
  onClose: () => void;
  /** Exit choreography (owned by App): while true the panel plays its slide-out,
   *  then calls onExited so the parent can finally null the index. */
  leaving?: boolean;
  onExited?: () => void;
  /** One-shot X/Y override for the context-menu "Pick from screen" flow (pick FIRST,
   *  sheet after). App owns the pick round-trip — this panel's own pick correlation is
   *  disarmed on every actionIndex change, which is exactly the moment this flow needs
   *  it — and hands the picked point here. It seeds the DRAFT only (Save commits,
   *  Cancel discards, same as the in-sheet Pick button) and is consumed on arrival
   *  via onSeedConsumed so a later open never replays a stale point. */
  seedCoords?: { x: number; y: number } | null;
  onSeedConsumed?: () => void;
  /** Imperative handle for App's row-switch guard (see SheetPanelHandle). React 19: a plain prop. */
  ref?: Ref<SheetPanelHandle>;
}

/**
 * What App may ask the sheet before moving it to another row. `tryLeave` returns true when the
 * move may go ahead — the editor is clean, or the user already saw the warning and repeated the
 * gesture within the guard window (that repeat is the discard, and it toasts) — and false when
 * it just armed the footer warning instead. Mirrors the Esc guard exactly, so every way out of
 * a dirty editor takes the same two steps.
 */
export interface SheetPanelHandle {
  tryLeave: (kind: 'switch') => boolean;
  /**
   * Close now, but say so if there was anything to lose. For the one exit that cannot be a
   * two-step guard: switching to Clicker takes the grid away, so the sheet has to go whether or
   * not the editor is dirty. Arming a warning would leave it sitting over the Clicker dashboard —
   * the very state the close exists to prevent. The toast is the honest minimum.
   */
  discardAndClose: () => void;
}

// Action types organised by FAMILY — the picker only offers conversions that stay within
// a family because cross-family transforms produce semantically broken actions (e.g. a
// Click→KeyDown swap loses the X/Y context and leaves an empty key field). Users who really
// want a different action type record a new one. Within a family, the swaps are meaningful:
// Left Click ↔ Right Click ↔ Mid Click (same coord, different button), KeyDown ↔ KeyUp
// (same key, different phase), ScrollUp ↔ ScrollDown (toggle direction). SendText has no
// family because it's the only "text" action — picker would be a single chip with nothing
// to switch to, so currentFamily simply returns null for it.
type ActionFamily = 'click' | 'key' | 'scroll';
const familyTypes: Record<ActionFamily, { value: string; label: string }[]> = {
  // ORDER IS THE GROUPING. The picker renders these into a fixed 3-column grid, so the array
  // order decides which chips share a row — the three real BUTTONS first, then the left-button
  // MULTI-CLICK variants on their own row. Two axes are folded into this one list (which button
  // vs how many clicks) and only the ordering keeps them legible: Double/Triple are both
  // left-button actions, so listing them between Left and Right made them read as siblings of
  // Right Click, which they are not. Do not interleave them again.
  // Three rows of three-ish: the BUTTONS, then the same three buttons HELD, then the
  // left-button multi-click variants. The hold row sits in the middle rather than at the end
  // because it is the same three buttons one line down — the eye reads the column, and the
  // switch a user actually wants ("this click, but held") is directly below its click.
  // Double/Triple moved from row 2 to row 3 for that reason and stay together, which is the
  // grouping rule above: they are left-button actions, never siblings of Right Click.
  // The list itself moved to displayUtils on 2026-09-16 so the row menu's "Change click type"
  // submenu offers the SAME eight in the SAME order. The ordering rules above travelled with it.
  click: CLICK_FAMILY_TYPES,
  // Labels are Title Case with a space, matching the click family — they exist ONLY in this
  // picker (the grid pill and the drawer header derive their own text), so the spelling here is
  // free to read as prose rather than echo the stored actionType.
  key: [
    { value: 'KeyDown', label: 'Key Down' },
    { value: 'KeyUp', label: 'Key Up' },
  ],
  scroll: [
    { value: 'ScrollUp', label: 'Scroll Up ↑' },
    { value: 'ScrollDown', label: 'Scroll Down ↓' },
  ],
};

// The grid's set, not a copy of it. This used to be the SHEET's own — 33 members, byte-identical
// to displayUtils' apart from where RunProfile sat in the literal, kept in step by hand and
// warned about in a comment instead of being shared. One import removes the chance to drift.
const noCoordTypes = NO_COORD_TYPES;

// One normalizer for the Assert on-fail persistence pair: the default Halt stays ''
// (null on disk), Continue/StopReplay persist verbatim — mirrors the bridge's
// actions:edit arm, so the two can never disagree about what "unset" means.
const persistAssertPolicy = (p: string | null | undefined): string =>
  p === 'Continue' || p === 'StopReplay' ? p : '';

// The five COMBINED click types — one row = press + release. Mirrors
// ActionItem.IsCombinedClickType on the C# side. ONE set, two derived booleans
// (isRepeatableClick, isAtCursorEligible): both literally mean "is a combined click row", and
// keeping them as separate lists is how one learns a new click type and the other doesn't.
// Paired halves are excluded — they'd double-fire one edge under × N, and their replay cases
// read x/y directly so they can't honour at-cursor.
// Clamps mirror the C# ranges (RepeatCount 1..999, gap 0..5000 ms, jitter 1..100 %).
// Off by default: RepeatCount stays 1 so existing rows persist nothing and replay unchanged.
// The *ClickHold family is here for the same reason it is in the C# set: the row owns a whole
// press→release. Membership is what gives a hold its × N cluster and its Position control — the
// engine honours both, so withholding them here would be the UI lying about what the row can do.
const COMBINED_CLICKS = new Set([
  'LeftClick', 'RightClick', 'MiddleClick', 'DoubleClick', 'TripleClick',
  'LeftClickHold', 'RightClickHold', 'MiddleClickHold',
]);

// Hold duration editing, shared with the Send Keystroke dialog's hold mode so the key hold and
// the mouse hold offer the same range (C# clamps 10..60000 identically). The PRESETS are the
// app-wide ladder — see DURATION_PRESETS.
// The ranges, the defaults and the per-type gap come from utils/actionCost, which mirrors the C#
// constants by name. They used to be literals here, in ClickDialog and in KeystrokeCaptureDialog,
// and the StatusBar estimate — the one surface that PROMISES a duration — had no copy at all.
const clampHoldMs = (v: number) => Math.max(MIN_HOLD_MS, Math.min(MAX_HOLD_MS, Math.floor(v)));
const DEFAULT_CLICK_JITTER_PCT = 20;     // seeded into the input when the user turns jitter ON
const DEFAULT_CLICK_POS_JITTER_PX = 3;   // seeded when the user turns POSITION jitter ON — a few px
                                         // keeps the burst inside any real target; the cap is 500
                                         // (MAX_POSITION_PX, the Clicker's own position ceiling)
const clampRepeatCount = (v: number) => Math.max(1, Math.min(999, Math.floor(v)));
const clampRepeatGap = (v: number) => Math.max(0, Math.min(5000, Math.floor(v)));
const clampRepeatJitter = (v: number) => Math.max(1, Math.min(100, Math.floor(v)));
const clampRepeatPosJitter = (v: number) => Math.max(1, Math.min(500, Math.floor(v)));

// Result cards (a probe matched / failed) are Callouts: ok = replay green, error = recording
// red, text on the -fg rung so it survives light presets. The seven sites keep their markup and
// take the recipe from one place (common/Callout) instead of carrying their own color-mix.
const resultCardStyle = (ok: boolean) => calloutStyle(ok ? 'ok' : 'error');

// Notes textarea auto-grow: height follows the content between the 2-line floor (rows) and the
// max-h the class sets. Reset to auto first so shrinking works when lines are deleted.
function growTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  // scrollHeight measures content + padding and EXCLUDES the border, while `height` on a
  // border-box element (Tailwind's default) includes it. Assigning one to the other left the box
  // two pixels short of its own content, so the field kept a scrollbar and clipped the last line
  // no matter how well it had been measured.
  const borders = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + borders}px`;
}
const RESULT_CARD = 'border-l-2 rounded px-2.5 py-2 text-[11px] leading-relaxed callout-enter';

// One axis of the Activate Window placement grid: a single-letter caption and a stepper, half a
// row wide. Four of these make X/Y and W/H, so the caption alignment, the clamp and the disabled
// dimming are written once instead of four times.
function AxisInput({ axis, value, onChange, disabled = false, min }: {
  axis: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  min?: number;
}) {
  return (
    <div className="flex-1 min-w-0 flex items-center gap-1.5">
      <span className={`label-micro shrink-0 w-3 ${disabled ? 'text-text-tertiary/50' : 'text-text-tertiary'}`}>{axis}</span>
      <NumberInput
        value={parseInt(value, 10) || 0}
        onChange={(n) => onChange(String(min != null ? Math.max(min, n) : n))}
        min={min}
        disabled={disabled}
        ariaLabel={`Window ${axis}`}
        inputWidth="w-full" inputHeight="h-8" className="flex-1 min-w-0"
      />
    </div>
  );
}

// #1 — Text matching modes mapped to selector prefixes
type TextMode = 'exact' | 'contains' | 'icontains' | 'regex';
const TEXT_MODES: { value: TextMode; label: string; prefix: string }[] = [
  { value: 'exact',     label: 'Exact',         prefix: 'text=' },
  { value: 'contains',  label: 'Contains',      prefix: 'text*=' },
  { value: 'icontains', label: 'Contains (i)',  prefix: 'text~=' },
  { value: 'regex',     label: 'Regex',         prefix: 'text/' },
];

// The action types whose Key is a browser SELECTOR (and may carry a text= prefix).
// Everything else — notably SendText, whose payload can legitimately START with
// "text=..." or "text/..." — must never be parsed/rebuilt as a selector: the regex
// rebuild is lossy, so an unrelated save would rewrite Key (and null a fresh KeyHtml).
function isBrowserSelectorAction(actionType: string, conditionType?: string | null): boolean {
  return actionType === 'BrowserClick' || actionType === 'BrowserRightClick'
    || actionType === 'BrowserType' || actionType === 'BrowserWaitElement'
    || actionType === 'BrowserSelectOption' || actionType === 'BrowserAssert'
    // If AND While: the loop guard renders the same selector editor (isIfBrowser), so it
    // must persist selectorAlternatives / split text-modes the same way — one gate short
    // and a picked alternatives list silently vanishes on save.
    || (carriesConditionProbe(actionType) && conditionType === 'BrowserElementState');
}

function parseTextSelector(value: string): { mode: TextMode | null; raw: string } {
  if (!value) return { mode: null, raw: '' };
  if (value.startsWith('text/')) {
    // Strip leading text/ and the regex closing /flags so the input shows just the pattern
    const last = value.lastIndexOf('/');
    if (last > 4) return { mode: 'regex', raw: value.slice(5, last) };
  }
  if (value.startsWith('text*=')) return { mode: 'contains', raw: value.slice(6) };
  if (value.startsWith('text~=')) return { mode: 'icontains', raw: value.slice(6) };
  if (value.startsWith('text=')) return { mode: 'exact', raw: value.slice(5) };
  return { mode: null, raw: '' };
}

function buildTextSelector(mode: TextMode, raw: string): string {
  if (!raw) return '';
  if (mode === 'regex') return `text/${raw}/i`;
  const prefix = TEXT_MODES.find(m => m.value === mode)?.prefix ?? 'text=';
  return prefix + raw;
}

// #2 — Estimate selector tier client-side (mirrors selectorGenerator.estimateSelectorTier)
function estimateTier(selector: string): 'S' | 'A' | 'B' | 'C' {
  if (!selector) return 'C';
  const s = selector.trim();
  if (s.startsWith('text=') || s.startsWith('text*=') || s.startsWith('text~=') || s.startsWith('text/')) return 'B';
  if (/^#[A-Za-z_][\w-]*$/.test(s)) return 'S';
  if (/\[data-(testid|test|cy|qa)=/.test(s)) return 'S';
  if (/\[(name|aria-label|placeholder)=/.test(s)) return 'A';
  if (s.includes(':nth-') || s.includes(' > ')) return 'C';
  if (/^[a-z]+\./i.test(s)) return 'B';
  return 'C';
}

// Theme tokens only (S=replay green, A=accent, B=warning, C=recording red) — the old
// hardcoded hexes broke on light themes. labelPtBr feeds the bilingual shield tip.
const TIER_META: Record<'S' | 'A' | 'B' | 'C', { color: string; label: string; labelPtBr: string; Icon: typeof ShieldCheck }> = {
  S: { color: 'var(--color-replay-fg)', label: 'Stable', labelPtBr: 'Estável', Icon: ShieldCheck },
  A: { color: 'var(--color-accent)', label: 'Strong', labelPtBr: 'Forte', Icon: ShieldCheck },
  B: { color: 'var(--color-warning-ink)', label: 'Decent', labelPtBr: 'Razoável', Icon: ShieldQuestion },
  C: { color: 'var(--color-recording-fg)', label: 'Fragile', labelPtBr: 'Frágil', Icon: ShieldAlert },
};


export function SheetPanel({ actionIndex, onClose, leaving = false, onExited, seedCoords, onSeedConsumed, ref }: SheetPanelProps) {
  const { actions, profiles, activeProfile, buttonStates } = useAppState();
  const { send, subscribe } = useBridge();
  const tt = useTt();
  // Hoisted to sit beside tt(): handleSave is declared far above the guard machinery that used to
  // own this, and a dependency array cannot forward-reference a const (TS2448) the way a closure
  // body can — the same trap the comment inside handleSave already describes for the If flags.
  const { showToast } = useToast();
  // Every door the sheet has into a running profile refuses through here, so the reason and the
  // throttle cannot drift apart between them. Throttled to one toast per two seconds because error
  // toasts last eight and Ctrl+S is reflex — three presses would stack three.
  // It deliberately does NOT promise the edits survive. A run pushes actions:updated (recording
  // pushes one per captured key, and a hotkey-launched replay pushes before the button states even
  // arrive), and the seed effect re-seeds every field from the store on each push. "Your edits are
  // kept" would be a promise this panel cannot make.
  const runActive = buttonStates.recordingActive || buttonStates.replayActive;
  const lastRunRefusalRef = useRef(0);
  const refuseDuringRun = useCallback(() => {
    if (!runActive) return false;
    const now = Date.now();
    if (now - lastRunRefusalRef.current > 2000) {
      lastRunRefusalRef.current = now;
      showToast(tt('The action list is locked while a run is active.',
                   'A lista de ações está travada enquanto um run está ativo.'), 'error');
    }
    return true;
  }, [runActive, showToast, tt]);

  // Which space this profile's X/Y live in. Nothing on this panel used to say, and the
  // fields read "X" / "Y" either way — so a relative profile's 40,60 looks exactly like an
  // absolute 40,60. Uses the EFFECTIVE flag: a profile inheriting target + mode from its
  // folder has its own useRelativeCoordinates set to false while replaying relative.
  const activeEntry = activeProfile ? profiles.find(p => p.name === activeProfile) : undefined;
  const coordsAreRelative = activeEntry?.effectiveUseRelativeCoordinates ?? false;
  const relativeTargetLabel =
    activeEntry?.effectiveTargetProcessName || activeEntry?.effectiveTargetWindowTitle || null;

  // Exit fallback — mirrors DialogShell: if the slide-out's animationend never
  // fires (occluded window pauses CSS animations), unstick the unmount.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => onExited?.(), 500);
    return () => clearTimeout(t);
  }, [leaving, onExited]);

  const action = actionIndex != null ? actions[actionIndex] : null;

  const [actionType, setActionType] = useState('');
  // The click FORM as a draft. `initialForm` is what the row arrived as, kept so the dirty check
  // and the warning line both ask one question. Seeded from the row, like every other draft here.
  const [formDraft, setFormDraft] = useState<'combined' | 'paired'>('combined');
  const [initialForm, setInitialForm] = useState<'combined' | 'paired'>('combined');
  const [key, setKey] = useState('');
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [delay, setDelay] = useState('');
  const [comment, setComment] = useState('');
  // Click × N — inline repeat of this click (Times / Gap / Gap-jitter / Position-jitter),
  // mirroring Keystroke × N (which has no position axis).
  // Held locally during edit; persisted via actions:edit on Save. Jitter is two-track (on/off + %)
  // like the Keystroke dialog so toggling off and back on restores the last %. Only surfaced for
  // the combined clicks — Left/Right/Middle + Double/Triple (see isRepeatableClick).
  const [repeatCount, setRepeatCount] = useState(1);
  const [repeatGapMs, setRepeatGapMs] = useState(DEFAULT_CLICK_GAP_MS);
  const [jitterOn, setJitterOn] = useState(false);
  const [jitterPct, setJitterPct] = useState(DEFAULT_CLICK_JITTER_PCT);
  // Position jitter — the positional twin of the gap jitter above (±px scatter on the click
  // POINT, re-rolled each cycle). Same two-track on/off + value shape so toggling off and back
  // on restores the last px value.
  const [posJitterOn, setPosJitterOn] = useState(false);
  const [posJitterPx, setPosJitterPx] = useState(DEFAULT_CLICK_POS_JITTER_PX);
  // Click at cursor — the row resolves its point from the LIVE mouse at replay time instead of
  // from its stored X/Y. Held locally during edit and persisted via actions:edit on Save, like
  // every other field here. Mutually exclusive with Position jitter (see the Position control).
  const [atCursor, setAtCursor] = useState(false);
  // *ClickHold dwell (ms). Seeded from the row, clamped on save to the same 10..60000 the C#
  // side enforces. A row that has never been given one seeds at the shared 1000 ms default
  // rather than 0, so the field shows the number replay will actually use.
  const [holdMs, setHoldMs] = useState(DEFAULT_HOLD_MS);
  const [timeout, setTimeout_] = useState('');
  const [confidence, setConfidence] = useState('');
  const [browserText, setBrowserText] = useState('');
  // SetVariable — the value half of "name = value"; the name reuses the `key` state.
  const [variableValue, setVariableValue] = useState('');
  // SetVariable mode: 'set' (default) | 'cycle' (value = list, next line per execution) |
  // 'add' (value = a number added to the current one — the While counter).
  const [variableMode, setVariableMode] = useState<'set' | 'cycle' | 'add'>('set');
  // CopyToSlot mode: 'capture' (default) | 'clear' (empty the slot / all slots).
  const [slotMode, setSlotMode] = useState<'capture' | 'clear'>('capture');
  // Imperative handle to the Lexical-based BrowserType editor — used by the chip
  // buttons to insertText at the current cursor position instead of always appending.
  const browserTextEditorRef = useRef<LexicalEditorHandle | null>(null);
  // Imperative handle to the Lexical-based SendText editor (the `key` payload). Separate ref
  // from browserTextEditorRef: only one of the two surfaces is ever mounted, but a shared ref
  // would leave a stale handle behind after a type change under an open sheet.
  const sendTextEditorRef = useRef<LexicalEditorHandle | null>(null);
  // Bumped by the [action] seed effect below, and part of BOTH Lexical editors' remount keys.
  //
  // Those editors are UNCONTROLLED after their one-shot seed, while every other field here is a
  // controlled input. So when the seed effect re-runs — it does on every actions:updated push,
  // which is the deliberate liveness the effect's own comment describes — a controlled field
  // visibly snaps back to the stored value, but a Lexical surface would keep showing what the
  // user had typed while `key` / `browserText` had already been reset underneath it. Save then
  // writes the stored value and the typed text is gone with nothing on screen having changed.
  // Keying the editors on this nonce puts them back in step: whatever the seed writes is what
  // the editor redraws, so what you see stays what Save will write.
  const [seedNonce, setSeedNonce] = useState(0);
  const [textMatch, setTextMatch] = useState('');
  const [textMode, setTextMode] = useState<TextMode>('exact');
  const [newTab, setNewTab] = useState(false);
  const [isPicking, setIsPicking] = useState(false);

  // #6, #7, #5 — new browser fields
  const [waitMode, setWaitMode] = useState<string>('appears');
  const [urlWaitPattern, setUrlWaitPattern] = useState('');
  const [postNavigateSelector, setPostNavigateSelector] = useState('');
  const [typeAppend, setTypeAppend] = useState(false);
  const [typePaste, setTypePaste] = useState(false);
  const [typeDelay, setTypeDelay] = useState('');
  // BrowserSelectOption — how to match the <option> inside the <select>. Default 'text'.
  // Stored as null on disk when 'text' (the default); 'value' or 'index' otherwise.
  const [selectMatchMode, setSelectMatchMode] = useState<'text' | 'value' | 'index'>('text');

  // WaitImage extras (timeout branching, disappear toggle, click-on-match, ROI).
  // Stored locally during edit; persisted via actions:edit on Save. Default "StopReplay"
  // matches the dropdown's default option — a clean stop without a noisy error popup.
  const [waitImageOnTimeout, setWaitImageOnTimeout] = useState<string>('StopReplay'); // 'Continue' | 'StopReplay'
  const [waitImageInvert, setWaitImageInvert] = useState(false);
  const [waitImageClickOnMatch, setWaitImageClickOnMatch] = useState(false);
  const [waitImageSearchRegion, setWaitImageSearchRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // WaitPixelColor state — mirror of the action's pixel fields. Held locally so the user
  // can edit freely before Save; written back as 'actions:edit' messages on Save. Strings
  // for the numeric inputs to allow empty intermediate states without forcing 0 echoes.
  const [pixelX, setPixelX] = useState<string>('');
  const [pixelY, setPixelY] = useState<string>('');
  const [pixelColor, setPixelColor] = useState<string>('');     // "#RRGGBB"
  const [pixelTolerance, setPixelTolerance] = useState<string>('0');
  const [pixelOnTimeout, setPixelOnTimeout] = useState<string>('StopReplay'); // 'Continue' | 'StopReplay'
  const [pixelInvert, setPixelInvert] = useState(false);
  const [pixelClickOnMatch, setPixelClickOnMatch] = useState(false);

  // Conditional logic — IF rows reuse the WaitImage / WaitPixelColor probe state
  // above. Two extra knobs sit on top: Negate flips the branch outcome (IFNOT
  // semantic), OnProbeError decides what happens when the probe throws/can't
  // run. Default "TreatAsFalse" matches the C# IfOnProbeError null/default path
  // and lets the FALSE branch fire on error; "Halt" rethrows and stops replay.
  const [conditionNegate, setConditionNegate] = useState(false);
  const [ifOnProbeError, setIfOnProbeError] = useState<'TreatAsFalse' | 'Halt'>('TreatAsFalse');
  // If Window (WindowOpen) probe fields
  const [windowProcessName, setWindowProcessName] = useState('');
  const [windowTitle, setWindowTitle] = useState('');
  const [windowTitleMatchMode, setWindowTitleMatchMode] = useState<'contains' | 'regex'>('contains');
  const [windowMatchForegroundOnly, setWindowMatchForegroundOnly] = useState(false);
  // If Clipboard (ClipboardMatch) probe fields
  const [clipboardPatternType, setClipboardPatternType] = useState<'contains' | 'equals' | 'regex'>('contains');
  const [clipboardPattern, setClipboardPattern] = useState('');
  // If Random / Variable / File / Time probe fields
  const [randomPercent, setRandomPercent] = useState('50');
  const [conditionOperator, setConditionOperator] = useState<'eq' | 'neq' | 'contains' | 'gt' | 'lt'>('eq');
  const [conditionOperand, setConditionOperand] = useState('');
  const [filePath, setFilePath] = useState('');
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [daysOfWeek, setDaysOfWeek] = useState(0); // bitmask Sun=1<<0 … Sat=1<<6
  // ActivateWindow — launch fields + failure policy. The window MATCHER reuses the
  // If-Window state trio above (windowProcessName / windowTitle / windowTitleMatchMode).
  const [launchPath, setLaunchPath] = useState('');
  const [launchArgs, setLaunchArgs] = useState('');
  const [activateOnTimeout, setActivateOnTimeout] = useState<'Halt' | 'Continue'>('Halt');
  // ActivateWindow Phase 3 — verb (what to do with the matched window) + nth-match (which one).
  // matchIndex is string-backed (1-based) like the other numeric fields.
  const [windowVerb, setWindowVerb] = useState<'Activate' | 'Maximize' | 'Minimize' | 'Close'>('Activate');
  const [matchIndex, setMatchIndex] = useState('1');
  // ActivateWindow placement: move/resize the activated window to a saved rect. Purely
  // positional — coordinate context is untouched (sub-profile + RunProfile covers that).
  // String-backed like the other numeric fields so an input can be cleared while typing.
  const [restorePosition, setRestorePosition] = useState(false);
  const [restoreSize, setRestoreSize] = useState(false);
  const [windowX, setWindowX] = useState('0');
  const [windowY, setWindowY] = useState('0');
  const [windowWidth, setWindowWidth] = useState('0');
  const [windowHeight, setWindowHeight] = useState('0');
  const [captureGeoRequestId, setCaptureGeoRequestId] = useState<string | null>(null);
  const [captureGeoError, setCaptureGeoError] = useState<string | null>(null);
  // BrowserAssert failure policy (selector/waitMode/browserText/timeout reuse the shared
  // browser state above).
  const [assertOnFail, setAssertOnFail] = useState<'Halt' | 'Continue' | 'StopReplay'>('Halt');
  // Exists-anywhere Test probe tracking — same requestId-gating pattern as the browser
  // Test Action (the reply is gated on the id so a stale reply can't land elsewhere).
  const [windowProbeRequestId, setWindowProbeRequestId] = useState<string | null>(null);
  const [windowProbeResult, setWindowProbeResult] = useState<{ found: boolean; matchProcess: string; matchTitle: string; error?: string } | null>(null);
  // Optional "wait up to N ms for the condition" poll timeout (0 = instant single check). Stored as
  // a string so the input can be cleared; coerced to a non-negative int on persist.
  const [conditionTimeout, setConditionTimeout] = useState('0');
  // While iteration ceiling — string for clearability, non-negative int on persist.
  // 0 = the engine's 1000-iteration safety default.
  const [loopMaxIterations, setLoopMaxIterations] = useState('0');

  // Eyedropper / live-test request tracking — mirrors the WaitImage testMatch /
  // mouse:pickPosition pattern. Single in-flight request at a time; the requestId
  // gates the message handler so a stale reply can't overwrite newer state.
  const [pickColorRequestId, setPickColorRequestId] = useState<string | null>(null);
  const [testPixelRequestId, setTestPixelRequestId] = useState<string | null>(null);
  const [testPixelResult, setTestPixelResult] = useState<{ matches: boolean; sampledHex?: string | null; error?: string } | null>(null);

  // Test match button — fires a single MatchOnce on the live screen and shows the score.
  // Result is transient (cleared on close/save/recapture); no persistence.
  const [testMatchRequestId, setTestMatchRequestId] = useState<string | null>(null);
  const [testMatchResult, setTestMatchResult] = useState<{ found: boolean; score: number; x: number; y: number; w: number; h: number; error?: string } | null>(null);

  // Crop reference image modal — opens on thumbnail click; commit replaces the action's
  // ImagePath with a tighter cropped PNG via the bridge.
  const [cropperOpen, setCropperOpen] = useState(false);

  // Pick position — when active, the next 'mouse:positionPicked' message updates X/Y.
  const [pickPositionRequestId, setPickPositionRequestId] = useState<string | null>(null);

  // Browser element pick — gates 'browser:pickResult' so a reply arriving after the user
  // switched/closed actions (the panel doesn't remount) can't write the selector into the
  // wrong action. Mirrors pickPositionRequestId / pickColorRequestId. `isPicking` stays the
  // button's visual flag; this id is the correctness gate.
  const [pickElementRequestId, setPickElementRequestId] = useState<string | null>(null);

  // Pause action's Resume Hotkey capture state — same UX as KeyDown/KeyUp's keyFieldFocused
  // and the Settings / Profile / grid inputs: focus → empty + "New key..." + accent pulse.
  const [pauseHotkeyFocused, setPauseHotkeyFocused] = useState(false);
  const testMatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTestMatchTimeout = useCallback(() => {
    if (testMatchTimeoutRef.current) {
      clearTimeout(testMatchTimeoutRef.current);
      testMatchTimeoutRef.current = null;
    }
  }, []);
  useEffect(() => () => clearTestMatchTimeout(), [clearTestMatchTimeout]);

  // #2 — picker alternatives popover
  const [alternatives, setAlternatives] = useState<SelectorAlternative[]>([]);
  // Did THIS edit session produce the list above by picking, or was it seeded from disk?
  // The two used to be the same question — `alternatives` was empty unless a pick had happened —
  // and the save path still leans on that: a non-empty list means "persist it", an empty one plus a
  // hand-edited selector means "the stored fallbacks now point at a different element, clear them".
  // Seeding the list so Test action can use it made the first branch always true and the clearing
  // branch unreachable, which is worse than the bug it fixed: a hand-edited selector kept stale
  // fallbacks, and a fallback that matches the OLD element clicks the old element.
  const [pickedThisSession, setPickedThisSession] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  // The other half of the invariant described just above. `pickedThisSession` was set by the
  // picker and never unset, so typing a selector by hand — the exact case the clearing branch
  // exists for — kept the flag true and re-persisted the PICKED element's fallbacks under the
  // TYPED selector. At replay that is the worst possible pairing: the typed primary misses, the
  // engine walks the ranked list (extension: primary first, then the fallbacks), a fallback for
  // the element the user rejected still matches, and the click lands on that element.
  // Every hand edit of the EFFECTIVE selector routes through here — the CSS field and the Text
  // Match field, which takes priority over it — so the flag drops and handleSave falls into its
  // "clear the stored list" branch.
  // Deliberately DROPS the list instead of re-deriving a primary from it: the primary is always
  // generateSelector's output, never alternatives[0] (the recorder pairs a later typingCaptured
  // to its row by exact Key == selector equality), so promoting a fallback here would invent a
  // pairing neither side has.
  const invalidatePickedAlternatives = useCallback(() => {
    setAlternatives([]);
    setPickedThisSession(false);
    setShowAlternatives(false);
  }, []);

  // #3 — test action state
  const [testRequestId, setTestRequestId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<BrowserTestResult | null>(null);
  // If-Browser-Element "check now". Separate state from testResult because the answer is a
  // branch (true/false), not a success/error — see HandleBrowserTestCondition.
  const [condRequestId, setCondRequestId] = useState<string | null>(null);
  // `negate` is frozen INTO the result: the card explains the answer in terms of the Negate
  // setting, and reading live state at render time meant flipping Negate after a check silently
  // re-labelled a stale answer as the opposite branch.
  const [condResult, setCondResult] = useState<{ satisfied: boolean; raw: boolean; connected: boolean; negate: boolean; lost?: boolean } | null>(null);
  // Safety timeout — if the bridge response is lost, recover the UI instead of hanging "Running…".
  // Backend pipeTimeout is the action timeout (~5s default); we double it plus 5s overhead.
  const testTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTestTimeout = useCallback(() => {
    if (testTimeoutRef.current) {
      clearTimeout(testTimeoutRef.current);
      testTimeoutRef.current = null;
    }
  }, []);
  useEffect(() => () => clearTestTimeout(), [clearTestTimeout]);

  // Same safety net for the condition check. Its probe is an INSTANT one (timeout=0 short-circuits
  // content.js before it allocates any observer) capped by a 3 s pipe timeout on the C# side, so a
  // reply that has not arrived in 6 s is a lost reply, not a slow one.
  const condTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearCondTimeout = useCallback(() => {
    if (condTimeoutRef.current) {
      clearTimeout(condTimeoutRef.current);
      condTimeoutRef.current = null;
    }
  }, []);
  useEffect(() => () => clearCondTimeout(), [clearCondTimeout]);

  // Latest-value refs for the in-flight request ids, so the bridge subscription below can be a
  // stable one-time subscription instead of re-subscribing on every requestId change — a churn
  // that could drop a bridge response arriving in the unsubscribed gap (Test/Pick stuck "…").
  const testRequestIdRef = useRef(testRequestId);
  const testMatchRequestIdRef = useRef(testMatchRequestId);
  const pickPositionRequestIdRef = useRef(pickPositionRequestId);
  const pickColorRequestIdRef = useRef(pickColorRequestId);
  const testPixelRequestIdRef = useRef(testPixelRequestId);
  const pickElementRequestIdRef = useRef(pickElementRequestId);
  const windowProbeRequestIdRef = useRef(windowProbeRequestId);
  const condRequestIdRef = useRef(condRequestId);
  // The Negate the in-flight check asked about. The subscription below is a stable one-time
  // handler and cannot see the handler's locals, and reading live state there would stamp the
  // toggle's CURRENT value onto an answer about its previous one.
  const condNegateAskedRef = useRef(false);
  // Stable identity for the seed-consumed callback so the seed effect below can call it
  // without depending on the parent's callback identity (same rationale as the id refs).
  const onSeedConsumedRef = useRef(onSeedConsumed);
  // Correlates a dialog:pickFile round-trip (ActivateWindow Launch "Browse…") to its result.
  const browseLaunchReqRef = useRef<string | null>(null);
  // Correlates a window:captureGeometry round-trip (ActivateWindow "Capture") to its result.
  const captureGeoReqRef = useRef<string | null>(null);
  // Configure-region is fire-and-forget (no UI state), so a plain ref tracks the in-flight
  // request and guards waitimage:searchRegionSet against a stale reply landing on a different
  // action after the user switched (the panel doesn't remount on action change).
  const searchRegionRequestIdRef = useRef<string | null>(null);
  useEffect(() => {
    testRequestIdRef.current = testRequestId;
    testMatchRequestIdRef.current = testMatchRequestId;
    pickPositionRequestIdRef.current = pickPositionRequestId;
    pickColorRequestIdRef.current = pickColorRequestId;
    testPixelRequestIdRef.current = testPixelRequestId;
    pickElementRequestIdRef.current = pickElementRequestId;
    windowProbeRequestIdRef.current = windowProbeRequestId;
    condRequestIdRef.current = condRequestId;
    onSeedConsumedRef.current = onSeedConsumed;
  });

  // Listen for pick element result + test result from extension. Subscribed once (stable deps);
  // current request ids are read from the refs above so this never tears down mid-flight.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'browser:pickResult') {
        const payload = msg.payload as { requestId?: string; selector?: string | null; alternatives?: SelectorAlternative[] };
        // Gate on the request id we started with. A reply whose id doesn't match (the user
        // switched/closed the action, or cancelled via Esc) is stale — drop it so it can't
        // overwrite the now-current action's selector. Matches the pickPosition/pickColor guards.
        if (!pickElementRequestIdRef.current || payload.requestId !== pickElementRequestIdRef.current) return;
        setIsPicking(false);
        setPickElementRequestId(null);
        if (payload.selector) {
          setKey(payload.selector);
          // A fresh pick fully re-specifies the target element, so clear any text-match mode
          // seeded from a prior text= selector — otherwise the textMatch-precedence at display/
          // save time (`textMatch.trim() ? buildTextSelector(...) : key`) would silently override
          // the picked selector. Most visible on the If-Browser editor, where key and textMatch
          // share ONE field so the discarded pick vanishes with no feedback.
          setTextMatch('');
          // #2 — Show alternatives popover when there are 2+ candidates
          const alts = payload.alternatives || [];
          // This is the ONE place a list becomes "picked this session" — which is what the save
          // path keys its persist-vs-clear decision on. Set on both branches: a pick that yields
          // fewer than two candidates still means the user re-specified the target, so any list
          // seeded from disk is no longer about the element they just chose.
          setPickedThisSession(true);
          if (alts.length > 1) {
            setAlternatives(alts);
            setShowAlternatives(true);
          } else {
            setAlternatives([]);
            setShowAlternatives(false);
          }
        }
      } else if (msg.type === 'browser:testAccepted') {
        // The backend resolved the payload and knows what it is really going to spend. Only IT
        // can: a `{clipboard}` holding four thousand characters is one token here and four
        // thousand keystrokes there, so this side's estimate was short by the whole difference
        // and the safety net fired while the extension was still typing. Re-arm on the number
        // from the side that does the work.
        const a = msg.payload as { requestId: string; budgetMs: number; timeoutMs: number };
        if (testRequestIdRef.current && a.requestId === testRequestIdRef.current) {
          clearTestTimeout();
          testTimeoutRef.current = setTimeout(() => {
            testTimeoutRef.current = null;
            setTestRequestId(prev => {
              if (prev !== a.requestId) return prev;
              setTestResult({
                requestId: a.requestId,
                success: false,
                error: {
                  code: 'NO_RESPONSE',
                  message: 'No response from the browser extension.',
                  tip: 'Check that Chrome and the TrueReplayer extension are still running.',
                },
              });
              return null;
            });
          }, a.timeoutMs + 5000 + a.budgetMs);
        }
      } else if (msg.type === 'browser:testResult') {
        const r = msg.payload as BrowserTestResult;
        // Only react if it's the test we triggered
        if (testRequestIdRef.current && r.requestId === testRequestIdRef.current) {
          clearTestTimeout();
          setTestResult(r);
          setTestRequestId(null);
        }
      } else if (msg.type === 'browser:testConditionResult') {
        const r = msg.payload as { requestId: string; satisfied: boolean; raw: boolean; connected: boolean };
        if (condRequestIdRef.current && r.requestId === condRequestIdRef.current) {
          clearCondTimeout();
          setCondResult({ satisfied: r.satisfied, raw: r.raw, connected: r.connected, negate: condNegateAskedRef.current });
          setCondRequestId(null);
        }
      } else if (msg.type === 'image:testMatchResult') {
        const r = msg.payload as { requestId: string; found: boolean; score: number; x: number; y: number; w: number; h: number; error?: string };
        if (testMatchRequestIdRef.current && r.requestId === testMatchRequestIdRef.current) {
          clearTestMatchTimeout();
          setTestMatchResult({ found: r.found, score: r.score, x: r.x, y: r.y, w: r.w, h: r.h, error: r.error });
          setTestMatchRequestId(null);
          // Auto-apply the matched rect as the search region when the test succeeds.
          // Saves a click — the user just confirmed where the image is, so the most
          // useful Search Region is "right around there". 80 px padding tolerates
          // small UI shifts (resize, anti-aliasing) without wasting CPU on the rest
          // of the screen. The user can still customise via Configure Region — and
          // re-running Test with a manual region keeps overwriting it (intentional:
          // Test is the source of truth for "where the image actually is").
          if (r.found) {
            // No Math.max(0,…): these are ABSOLUTE virtual-screen coordinates and go NEGATIVE on a
            // monitor placed left of / above the primary. Clamping to 0 there does not "protect" the
            // value, it relocates the ROI to the left edge of the PRIMARY monitor, and the wrong
            // number is then persisted by the actions:edit below — the WaitImage silently stops
            // matching, or matches something else entirely. The backend's MatchOnce already clamps
            // the ROI against the captured bitmap, which is the only place that can do it correctly.
            // AutomationPanel's handler for this same message carries the same note; the two must
            // stay in step.
            const margin = 80;
            setWaitImageSearchRegion({
              x: r.x - margin,
              y: r.y - margin,
              w: r.w + margin * 2,
              h: r.h + margin * 2,
            });
          }
        }
      } else if (msg.type === 'waitimage:searchRegionSet') {
        const r = msg.payload as { requestId: string; cancelled: boolean; x?: number; y?: number; w?: number; h?: number };
        // Guard against a stale reply: only apply when it matches the configure-region request
        // we last initiated. The panel doesn't remount when the user switches actions, so a late
        // reply could otherwise overwrite a different action's search region.
        if (searchRegionRequestIdRef.current && r.requestId === searchRegionRequestIdRef.current) {
          searchRegionRequestIdRef.current = null;
          if (!r.cancelled && r.w && r.h && r.w > 0 && r.h > 0) {
            setWaitImageSearchRegion({ x: r.x ?? 0, y: r.y ?? 0, w: r.w, h: r.h });
          }
        }
      } else if (msg.type === 'mouse:positionPicked') {
        const r = msg.payload as { requestId: string; cancelled: boolean; x?: number; y?: number };
        if (pickPositionRequestIdRef.current && r.requestId === pickPositionRequestIdRef.current) {
          if (!r.cancelled && r.x != null && r.y != null) {
            setX(String(r.x));
            setY(String(r.y));
          }
          setPickPositionRequestId(null);
        }
      } else if (msg.type === 'pixel:colorPicked') {
        // Eyedropper reply — fills X/Y + colour in one shot. Three-field update so
        // the user gets all the metadata of the click; they can still tweak any of
        // the three before saving.
        const r = msg.payload as { requestId: string; cancelled: boolean; x?: number; y?: number; hex?: string };
        if (pickColorRequestIdRef.current && r.requestId === pickColorRequestIdRef.current) {
          if (!r.cancelled && r.x != null && r.y != null && r.hex) {
            setPixelX(String(r.x));
            setPixelY(String(r.y));
            setPixelColor(r.hex);
          }
          setPickColorRequestId(null);
        }
      } else if (msg.type === 'pixel:testMatchResult') {
        const r = msg.payload as { requestId: string; matches: boolean; sampledHex?: string | null; error?: string };
        if (testPixelRequestIdRef.current && r.requestId === testPixelRequestIdRef.current) {
          setTestPixelResult({ matches: r.matches, sampledHex: r.sampledHex, error: r.error });
          setTestPixelRequestId(null);
        }
      } else if (msg.type === 'window:testProbeResult') {
        const r = msg.payload as { requestId: string; found: boolean; matchProcess: string; matchTitle: string; error?: string };
        if (windowProbeRequestIdRef.current && r.requestId === windowProbeRequestIdRef.current) {
          setWindowProbeResult({ found: r.found, matchProcess: r.matchProcess, matchTitle: r.matchTitle, error: r.error });
          setWindowProbeRequestId(null);
        }
      } else if (msg.type === 'dialog:pickFileResult') {
        const r = msg.payload as { requestId: string; path?: string | null };
        if (browseLaunchReqRef.current && r.requestId === browseLaunchReqRef.current) {
          browseLaunchReqRef.current = null;
          if (r.path) setLaunchPath(r.path);
        }
      } else if (msg.type === 'window:captureGeometryResult') {
        const r = msg.payload as { requestId: string; found: boolean; x: number; y: number; width: number; height: number; error?: string };
        if (captureGeoReqRef.current && r.requestId === captureGeoReqRef.current) {
          captureGeoReqRef.current = null;
          setCaptureGeoRequestId(null);
          if (r.found) {
            setWindowX(String(r.x));
            setWindowY(String(r.y));
            setWindowWidth(String(r.width));
            setWindowHeight(String(r.height));
            setCaptureGeoError(null);
          } else {
            setCaptureGeoError(r.error || 'Could not read the window.');
          }
        }
      }
    });
  }, [subscribe, clearTestTimeout, clearTestMatchTimeout, clearCondTimeout]);

  // Sync local state from action. This is intentionally an effect-driven seed: keeping
  // local state lets the user edit freely before saving, while the dependency on `action`
  // means external changes (undo/redo, sibling-action updates) still flow into the panel
  // even when it stays open. A key-based remount would lose that liveness.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (action) {
      // Every re-seed remounts the two Lexical surfaces so they cannot drift from the state
      // this effect is about to overwrite — see seedNonce's declaration.
      setSeedNonce((n) => n + 1);
      setActionType(action.actionType);
      {
        const f = clickFormOf(action.actionType) ? 'paired' as const : 'combined' as const;
        setFormDraft(f);
        setInitialForm(f);
      }
      // #1 — Detect any text= prefix variant and split into mode + raw value.
      // Gated on selector-carrying types: a SendText payload starting with "text=" is
      // literal text, not a selector (parsing it would corrupt Key on the next save).
      const parsed = isBrowserSelectorAction(action.actionType, action.conditionType)
        ? parseTextSelector(action.key || '')
        : { mode: null, raw: '' };
      if (parsed.mode) {
        setKey('');
        setTextMatch(parsed.raw);
        setTextMode(parsed.mode);
      } else {
        setKey(action.key);
        setTextMatch('');
        setTextMode('exact');
      }
      // `?? ''` (not `|| ''`) so an explicit coordinate of 0 seeds as "0" rather than
      // collapsing to empty — empty means "no override" (skipped on save), 0 is a real value.
      setX(String(action.x ?? ''));
      setY(String(action.y ?? ''));
      setDelay(String(action.delay));
      setComment(action.comment || '');
      // Combined-click × N — seed Times/Gap/Jitter from the action (defaults when absent).
      // Jitter's on/off tracks whether a positive % is stored; the % input keeps the last
      // value (or the 20 % seed) so a toggle-off/on round-trips it.
      setRepeatCount(action.repeatCount ?? 1);
      setRepeatGapMs(action.repeatDelayMs ?? clickDefaultGap(action.actionType));
      setJitterOn((action.repeatDelayJitterPct ?? 0) > 0);
      setJitterPct(action.repeatDelayJitterPct && action.repeatDelayJitterPct > 0 ? action.repeatDelayJitterPct : DEFAULT_CLICK_JITTER_PCT);
      setPosJitterOn((action.repeatPositionJitterPx ?? 0) > 0);
      setPosJitterPx(action.repeatPositionJitterPx && action.repeatPositionJitterPx > 0 ? action.repeatPositionJitterPx : DEFAULT_CLICK_POS_JITTER_PX);
      setAtCursor(action.atCursor || false);
      setHoldMs(action.holdDurationMs && action.holdDurationMs > 0 ? action.holdDurationMs : DEFAULT_HOLD_MS);
      // Timeout edited in milliseconds (matches the grid + dialogs). Pause defaults
      // to 0 (infinite); other actions default to 5000ms.
      setTimeout_(action.actionType === 'Pause'
        ? String(action.timeout ?? 0)
        : String(action.timeout || 5000));
      setConfidence(String(Math.round((action.confidence || 0.8) * 100)));
      setBrowserText(action.browserText || '');
      setVariableValue(action.variableValue ?? '');
      setVariableMode(action.variableMode === 'cycle' || action.variableMode === 'add' ? action.variableMode : 'set');
      setSlotMode(action.slotMode === 'clear' ? 'clear' : 'capture');
      setNewTab(action.newTab || false);
      setWaitMode(action.waitMode || 'appears');
      setUrlWaitPattern(action.urlWaitPattern || '');
      setPostNavigateSelector(action.postNavigateSelector || '');
      setTypeAppend(action.typeAppend || false);
      setTypePaste(action.typePaste || false);
      setTypeDelay(action.typeDelay != null ? String(action.typeDelay) : '');
      // null/undefined/'text' all collapse to the default 'text' display.
      setSelectMatchMode(
        action.selectMatchMode === 'value' ? 'value'
          : action.selectMatchMode === 'index' ? 'index'
          : 'text'
      );
      // Default "StopReplay" handles null / empty / legacy values gracefully.
      setWaitImageOnTimeout(action.waitImageOnTimeout === 'Continue' ? 'Continue' : 'StopReplay');
      setWaitImageInvert(action.waitImageInvert || false);
      setWaitImageClickOnMatch(action.waitImageClickOnMatch || false);
      if (action.waitImageSearchW != null && action.waitImageSearchH != null
          && action.waitImageSearchW > 0 && action.waitImageSearchH > 0) {
        setWaitImageSearchRegion({
          x: action.waitImageSearchX || 0,
          y: action.waitImageSearchY || 0,
          w: action.waitImageSearchW,
          h: action.waitImageSearchH,
        });
      } else {
        setWaitImageSearchRegion(null);
      }
      // Seed from what the action already carries instead of starting empty. The list was
      // write-only before: the pick filled it, handleSave persisted it, and reopening the
      // action dropped it — so "Test action" evaluated ONE candidate while the replay walked
      // the whole ranked list, and an action saved by a tier-B fallback failed its own test.
      // No visual change: the popover below is gated on showAlternatives, which only ever
      // turns true right after a pick.
      setAlternatives(action.selectorAlternatives ?? []);
      setPickedThisSession(false); // seeded from disk, not picked — see the state declaration
      setShowAlternatives(false);
      setTestResult(null);
      setCondResult(null);
      setCondRequestId(null);
      setTestMatchResult(null);
      setTestMatchRequestId(null);
      // WaitPixelColor state seeding — null/undefined become empty strings so the
      // numeric inputs render blank instead of "null". OnTimeout collapses everything
      // that isn't explicit "Continue" down to "StopReplay" to match the dropdown options.
      setPixelX(action.pixelX != null ? String(action.pixelX) : '');
      setPixelY(action.pixelY != null ? String(action.pixelY) : '');
      setPixelColor(action.pixelColor ?? '');
      setPixelTolerance(String(action.pixelTolerance ?? 0));
      setPixelOnTimeout(action.pixelOnTimeout === 'Continue' ? 'Continue' : 'StopReplay');
      setPixelInvert(action.pixelInvert || false);
      setPixelClickOnMatch(action.pixelClickOnMatch || false);
      setTestPixelResult(null);
      setTestPixelRequestId(null);
      // Conditional logic seeding — defaults to "Found" semantic + TreatAsFalse policy
      // so a freshly-inserted IF row reads as the most permissive shape.
      setConditionNegate(action.conditionNegate || false);
      setIfOnProbeError(action.ifOnProbeError === 'Halt' ? 'Halt' : 'TreatAsFalse');
      setConditionTimeout(String(action.conditionTimeout ?? 0));
      setLoopMaxIterations(String(action.loopMaxIterations ?? 0));
      // If Window / If Clipboard probe seeding — null/undefined collapse to the defaults.
      setWindowProcessName(action.windowProcessName ?? '');
      setWindowTitle(action.windowTitle ?? '');
      setWindowTitleMatchMode(action.windowTitleMatchMode === 'regex' ? 'regex' : 'contains');
      setWindowMatchForegroundOnly(action.windowMatchForegroundOnly || false);
      setClipboardPatternType(
        action.clipboardPatternType === 'equals' ? 'equals'
          : action.clipboardPatternType === 'regex' ? 'regex'
          : 'contains'
      );
      setClipboardPattern(action.clipboardPattern ?? '');
      // If Random / Variable / File / Time seeding.
      setRandomPercent(String(action.randomPercent ?? 50));
      setConditionOperator(
        action.conditionOperator === 'neq' ? 'neq'
          : action.conditionOperator === 'contains' ? 'contains'
          : action.conditionOperator === 'gt' ? 'gt'
          : action.conditionOperator === 'lt' ? 'lt'
          : 'eq'
      );
      setConditionOperand(action.conditionOperand ?? '');
      setFilePath(action.filePath ?? '');
      setTimeStart(action.timeStart ?? '');
      setTimeEnd(action.timeEnd ?? '');
      setDaysOfWeek(action.daysOfWeek ?? 0);
      // ActivateWindow seeding — the matcher trio is seeded by the If-Window block above.
      setLaunchPath(action.launchPath ?? '');
      setLaunchArgs(action.launchArgs ?? '');
      setActivateOnTimeout(action.activateOnTimeout === 'Continue' ? 'Continue' : 'Halt');
      setRestorePosition(!!action.restorePosition);
      setRestoreSize(!!action.restoreSize);
      setWindowX(String(action.windowX ?? 0));
      setWindowY(String(action.windowY ?? 0));
      setWindowWidth(String(action.windowWidth ?? 0));
      setWindowHeight(String(action.windowHeight ?? 0));
      setWindowVerb(
        action.windowVerb === 'maximize' ? 'Maximize'
        : action.windowVerb === 'minimize' ? 'Minimize'
        : action.windowVerb === 'close' ? 'Close'
        : 'Activate');
      setMatchIndex(String(action.windowMatchIndex && action.windowMatchIndex > 1 ? action.windowMatchIndex : 1));
      setCaptureGeoError(null);
      setCaptureGeoRequestId(null);
      setAssertOnFail(action.assertOnFail === 'Continue' ? 'Continue'
        : action.assertOnFail === 'StopReplay' ? 'StopReplay' : 'Halt');
      setWindowProbeResult(null);
      setWindowProbeRequestId(null);
    }
  }, [action]);

  // editorTouched's reset (the flag is documented further down, where it is declared). It is
  // declared HERE, above the pick-first seed that follows, on purpose: both run when actionIndex
  // changes, effects run in declaration order, and the reset used to come LAST. A pick from the
  // row menu opens the sheet on a new row and seeds its coordinates in the same commit, so the
  // seed's setEditorTouched(true) was undone at once — the editor opened dirty, and no claim held
  // autonomous fires off it until the first click or keystroke inside the panel.
  useEffect(() => { setEditorTouched(false); }, [actionIndex]);

  // Context-menu pick-first seed — declared AFTER the [action] seed above on purpose:
  // effects run in declaration order, so on a fresh open the action's own coords land
  // first and this override wins. Keyed on the PROP (not [action]) so it also fires
  // when the sheet is already open on the same row — there `action` identity never
  // changes and the big effect stays silent. Consumed immediately: the next
  // actions:updated push re-runs the [action] seed and must not find this again.
  useEffect(() => {
    // The actions[actionIndex] existence check is defense-in-depth: today the index
    // cannot go stale mid-pick (the overlay's InteractionScope suppresses every
    // mutation vector), but this effect is the one place wrong-row coords would
    // come out if that contract ever weakened — so it refuses rather than trusts.
    // Refusal still CONSUMES the seed: a discarded point must not lie in wait and
    // land on whatever row the sheet opens next.
    if (seedCoords && actionIndex != null) {
      if (actions[actionIndex]) {
        setX(String(seedCoords.x));
        setY(String(seedCoords.y));
        // A pick opens the editor already dirty with no input event to notice it.
        setEditorTouched(true);
      }
      onSeedConsumedRef.current?.();
    }
  }, [seedCoords, actionIndex, actions]);
  /* eslint-enable react-hooks/set-state-in-effect */


  const handleSave = useCallback(() => {
    if (actionIndex == null || !action) return;

    // The sheet is the app's largest typing surface and it had no run gate at all: every field it
    // persists goes out as actions:edit, and during a replay that rewrites the very list the engine
    // is stepping through. Refused here rather than only on the button because Ctrl+S reaches this
    // through handleSaveRef without consulting `disabled` — the same shape as the insert dialogs,
    // where the keyboard route bypasses the button gate.
    // Refuse, do not close: unlike the Clicker flip, a run does not take the grid away, so the row
    // is still there. The panel stays open and the same Save works the moment the run ends.
    if (refuseDuringRun()) return;

    // Every field edit below is COLLECTED and sent as one actions:editMany, so a Save is one undo
    // entry. It used to be up to 78 separate actions:edit, one per changed field, and the bridge
    // snapshots per call — so changing X and Y and pressing Save cost two undo entries, and a
    // single Ctrl+Z left the row at the NEW x with the OLD y: a point that existed at no moment of
    // the edit, which the next replay then clicked. An ActivateWindow Save fired about fifteen,
    // burning fifteen of the fifty history slots on one click and needing fifteen Ctrl+Z to walk
    // back. Order inside the batch is preserved and still matters — actionType goes first so the
    // later fields land on the right shape, exactly as the separate sends relied on.
    const pendingEdits: { field: string; value: string }[] = [];
    const edit = (field: string, value: string) => { pendingEdits.push({ field, value }); };

    // Conditional flags re-derived inside the callback because the outer
    // `const isIf = ...` declarations sit FURTHER DOWN the component body
    // (after this useCallback). TypeScript flags forward references as
    // TS2448 / TS2454 in strict mode, even though the closure would read
    // them correctly at runtime. Cost is one bool eval per save click.
    // Desktop Assert stores the SAME condition payload, so every condition field below must
    // persist for it too. Gating these on 'If' alone would render a full Assert editor whose
    // window/clipboard/variable fields silently never save.
    const _hasCondition = hasConditionFields(actionType);
    const _isIfImage = _hasCondition && action.conditionType === 'ImageFound';
    const _isIfPixel = _hasCondition && action.conditionType === 'PixelColorMatch';

    if (actionType !== action.actionType) {
      edit('actionType', actionType);
    }
    // #1 — Build effective key from textMatch + mode if textMatch is set, else use raw selector
    const effectiveKey = textMatch.trim() ? buildTextSelector(textMode, textMatch.trim()) : key;
    if (effectiveKey !== action.key) {
      edit('key', effectiveKey);
    }

    // Selector-fallback persistence (browser element actions). A pick during THIS edit
    // session populates `alternatives` — persist the full ranked list so replay can fall
    // back tier B→C when the primary drifts. A manual selector edit with NO fresh pick
    // invalidates any stored list (it may point at a different element) — clear it.
    const isBrowserElementAction = isBrowserSelectorAction(actionType, action.conditionType);
    if (isBrowserElementAction) {
      // pickedThisSession restores what `alternatives.length > 1` used to mean on its own, before
      // the list started being seeded from disk. Without it this branch always won and the clear
      // below became dead code.
      if (pickedThisSession && alternatives.length > 1) {
        const nextJson = JSON.stringify(alternatives);
        if (nextJson !== JSON.stringify(action.selectorAlternatives ?? null)) {
          edit('selectorAlternatives', nextJson);
        }
      } else if (effectiveKey !== action.key && (action.selectorAlternatives?.length ?? 0) > 0) {
        edit('selectorAlternatives', '');
      }
    }
    const newX = parseInt(x, 10);
    if (!isNaN(newX) && newX !== action.x) {
      edit('x', String(newX));
    }
    const newY = parseInt(y, 10);
    if (!isNaN(newY) && newY !== action.y) {
      edit('y', String(newY));
    }
    const newDelay = parseInt(delay, 10);
    if (!isNaN(newDelay) && newDelay !== action.delay) {
      edit('delay', String(newDelay));
    }
    if (comment !== (action.comment || '')) {
      edit('comment', comment);
    }

    // Click × N — persist Times/Gap/Gap-jitter (plus the at-cursor flag) for the combined clicks
    // (Left/Right/Middle + Double/Triple). Gated on the CURRENT actionType (re-derived here;
    // isRepeatableClick is declared further down, a forward reference) so switching the picker to a
    // NON-combined type (a paired half) before Save never writes a repeat onto it. Diff-based like
    // every field above (unchanged → no message → clean profile); the gap default is per-type
    // (multi-click = 600 ms). Both jitters collapse to 0 when off or Times <= 1; the bridge stores
    // 0 as null (schema-clean), matching a pre-feature single click byte-for-byte.
    if (COMBINED_CLICKS.has(actionType)) {
      const effRepeat = clampRepeatCount(repeatCount);
      if (effRepeat !== (action.repeatCount ?? 1)) {
        edit('repeat', String(effRepeat));
      }
      const effGap = clampRepeatGap(repeatGapMs);
      if (effGap !== (action.repeatDelayMs ?? clickDefaultGap(actionType))) {
        edit('repeatDelayMs', String(effGap));
      }
      const effJitter = jitterOn && effRepeat > 1 ? clampRepeatJitter(jitterPct) : 0;
      if (effJitter !== (action.repeatDelayJitterPct ?? 0)) {
        edit('repeatDelayJitterPct', String(effJitter));
      }
      // Position jitter collapses to 0 under at-cursor as well: the engine ignores it there (a
      // jittered cursor point would feed its own offset back on the next cycle — a random walk),
      // so persisting a value would leave a dead knob stored AND pin the profile to 2.9.9 for a
      // setting that does nothing.
      const effPosJitter = posJitterOn && effRepeat > 1 && !atCursor ? clampRepeatPosJitter(posJitterPx) : 0;
      if (effPosJitter !== (action.repeatPositionJitterPx ?? 0)) {
        edit('repeatPositionJitterPx', String(effPosJitter));
      }
      if (atCursor !== (action.atCursor ?? false)) {
        edit('atCursor', String(atCursor));
      }
      // Only the hold family writes the dwell. Gating it here (rather than letting every
      // combined click persist a value) is what keeps a plain click byte-identical to a
      // pre-feature profile — the field is always serialized, so an unasked-for number would
      // show up on every click row in the JSON.
      // The module-level predicate, not the component's `isHoldClick`: that one is declared
      // further down, and a forward reference from this callback's dependency array would be
      // read in its temporal dead zone. Same reason this block tests COMBINED_CLICKS directly
      // instead of isRepeatableClick.
      // Against the EFFECTIVE dwell, matching the dirty mirror below: a stored 0 already MEANS
      // DEFAULT_HOLD_MS everywhere that reads it, so writing 1000 over it is a no-op edit that
      // costs an undo entry and puts an unasked-for number in the JSON.
      if (isClickHold(actionType)) {
        const effHold = clampHoldMs(holdMs);
        if (effHold !== rowDwellMs(action)) {
          edit('holdDurationMs', String(effHold));
        }
      }
    }

    // WaitImage-specific fields — also runs for IF Image rows (_isIfImage), but
    // the polling-only knobs (timeout, waitImageOnTimeout, waitImageInvert,
    // waitImageClickOnMatch) are gated inside so they don't leak into IF rows.
    if (actionType === 'WaitImage' || _isIfImage) {
      if (actionType === 'WaitImage') {
        const newTimeoutMs = Math.max(1000, parseFloat(timeout) || 5000);
        if (newTimeoutMs !== (action.timeout || 5000)) {
          edit('timeout', String(Math.round(newTimeoutMs)));
        }
      }
      const newConfidence = Math.min(100, Math.max(10, parseInt(confidence, 10) || 80)) / 100;
      // Compare with a tolerance below the 1% input granularity (0.01): the editor only exposes
      // integer-percent values, so any real edit differs by >= 0.01, while float-precision noise
      // from the seed round-trip (action.confidence * 100 -> round -> / 100) stays under 0.005.
      // Strict !== here re-saved an unchanged value whenever the stored fraction wasn't exactly
      // representable at 2 decimals (e.g. 0.8500001), bumping the undo stack for a no-op.
      if (Math.abs(newConfidence - (action.confidence || 0.8)) > 0.005) {
        edit('confidence', String(newConfidence));
      }
      if (actionType === 'WaitImage') {
        // Only "Continue" is persisted explicitly; "StopReplay" is the default and stays null
        // on disk to keep saved JSON minimal.
        const persistedTimeoutMode = waitImageOnTimeout === 'Continue' ? 'Continue' : '';
        const currentTimeoutMode = action.waitImageOnTimeout === 'Continue' ? 'Continue' : '';
        if (persistedTimeoutMode !== currentTimeoutMode) {
          edit('waitImageOnTimeout', persistedTimeoutMode);
        }
        if (!!waitImageInvert !== !!(action.waitImageInvert)) {
          edit('waitImageInvert', String(waitImageInvert));
        }
        if (!!waitImageClickOnMatch !== !!(action.waitImageClickOnMatch)) {
          edit('waitImageClickOnMatch', String(waitImageClickOnMatch));
        }
      }
      // Search region — serialised as "x,y,w,h" or empty string. Compare against the action's
      // current rect to avoid no-op edits (which would still bump the undo stack). Shared
      // between WaitImage and IF Image — both use the ROI to constrain the probe.
      const currentRect = (action.waitImageSearchW && action.waitImageSearchH)
        ? `${action.waitImageSearchX || 0},${action.waitImageSearchY || 0},${action.waitImageSearchW},${action.waitImageSearchH}`
        : '';
      const newRect = waitImageSearchRegion
        ? `${waitImageSearchRegion.x},${waitImageSearchRegion.y},${waitImageSearchRegion.w},${waitImageSearchRegion.h}`
        : '';
      if (newRect !== currentRect) {
        edit('waitImageSearchRegion', newRect);
      }
    }

    // WaitPixelColor — also runs for IF Pixel rows (_isIfPixel) for the shared probe
    // fields (pixelX/Y/Color/Tolerance). Polling-only knobs (timeout, pixelOnTimeout,
    // pixelInvert, pixelClickOnMatch) are gated inside so they don't leak into IF rows.
    if (actionType === 'WaitPixelColor' || _isIfPixel) {
      if (actionType === 'WaitPixelColor') {
        const newTimeoutMs = Math.max(1000, parseFloat(timeout) || 5000);
        if (newTimeoutMs !== (action.timeout || 5000)) {
          edit('timeout', String(Math.round(newTimeoutMs)));
        }
      }
      const trimmedX = pixelX.trim();
      const trimmedY = pixelY.trim();
      const parsedX = trimmedX === '' ? null : parseInt(trimmedX, 10);
      const parsedY = trimmedY === '' ? null : parseInt(trimmedY, 10);
      if ((parsedX ?? null) !== (action.pixelX ?? null)) {
        edit('pixelX', parsedX == null ? '' : String(parsedX));
      }
      if ((parsedY ?? null) !== (action.pixelY ?? null)) {
        edit('pixelY', parsedY == null ? '' : String(parsedY));
      }
      // Normalise the colour string on commit: trim, uppercase, ensure leading '#'.
      // Backend stores exactly what we send; keeping it canonical here avoids "#fc5" vs
      // "FC5" vs "fc5" diffs in the saved JSON and keeps the swatch in the editor
      // stable across save+reload cycles.
      const rawColor = pixelColor.trim();
      const normalisedColor = rawColor === ''
        ? ''
        : (rawColor.startsWith('#') ? rawColor.toUpperCase() : '#' + rawColor.toUpperCase());
      if (normalisedColor !== (action.pixelColor ?? '')) {
        edit('pixelColor', normalisedColor);
      }
      const newTol = Math.max(0, Math.min(255, parseInt(pixelTolerance, 10) || 0));
      if (newTol !== (action.pixelTolerance ?? 0)) {
        edit('pixelTolerance', String(newTol));
      }
      if (actionType === 'WaitPixelColor') {
        const persistedPxTimeout = pixelOnTimeout === 'Continue' ? 'Continue' : '';
        const currentPxTimeout = action.pixelOnTimeout === 'Continue' ? 'Continue' : '';
        if (persistedPxTimeout !== currentPxTimeout) {
          edit('pixelOnTimeout', persistedPxTimeout);
        }
        if (!!pixelInvert !== !!(action.pixelInvert)) {
          edit('pixelInvert', String(pixelInvert));
        }
        if (!!pixelClickOnMatch !== !!(action.pixelClickOnMatch)) {
          edit('pixelClickOnMatch', String(pixelClickOnMatch));
        }
      }
    }

    // Conditional-logic-specific fields — only fire when actually editing an IF row.
    // ifOnProbeError persists "Halt" only; "TreatAsFalse" stays null on disk (matches
    // the WaitImage / WaitPixelColor "Continue" convention). conditionNegate persists
    // as a plain boolean.
    if (_hasCondition) {
      if (!!conditionNegate !== !!(action.conditionNegate)) {
        edit('conditionNegate', String(conditionNegate));
      }
      const ctVal = Math.max(0, parseInt(conditionTimeout, 10) || 0);
      if (ctVal !== (action.conditionTimeout ?? 0)) {
        edit('conditionTimeout', String(ctVal));
      }
      // If/While-only: the Assert editor deliberately doesn't render On Probe Error (its
      // "Halt" makes the probe rethrow, bypassing the assert's own failure policy), so it
      // must not write it either — otherwise a hand-edited Assert would have the field
      // silently reset on save. The While guard DOES honor the knob (Halt rethrows out of
      // the loop; TreatAsFalse reads false and exits it), so it persists like the If.
      if (carriesConditionProbe(actionType)) {
        const persistedErr = ifOnProbeError === 'Halt' ? 'Halt' : '';
        const currentErr = action.ifOnProbeError === 'Halt' ? 'Halt' : '';
        if (persistedErr !== currentErr) {
          edit('ifOnProbeError', persistedErr);
        }
      }
      // While iteration ceiling — the trinca's save leg (state + hydrate live above; the
      // dirty mirror below must match this diff exactly).
      if (actionType === 'While') {
        const lmVal = Math.max(0, parseInt(loopMaxIterations, 10) || 0);
        if (lmVal !== (action.loopMaxIterations ?? 0)) {
          edit('loopMaxIterations', String(lmVal));
        }
      }

      // If Window probe fields — only meaningful on a WindowOpen row, but gating on the
      // stored conditionType keeps a stale state write from landing on other IF families.
      if (action.conditionType === 'WindowOpen') {
        if (windowProcessName !== (action.windowProcessName ?? '')) {
          edit('windowProcessName', windowProcessName);
        }
        if (windowTitle !== (action.windowTitle ?? '')) {
          edit('windowTitle', windowTitle);
        }
        const currentTitleMode = action.windowTitleMatchMode === 'regex' ? 'regex' : 'contains';
        if (windowTitleMatchMode !== currentTitleMode) {
          edit('windowTitleMatchMode', windowTitleMatchMode);
        }
        if (!!windowMatchForegroundOnly !== !!(action.windowMatchForegroundOnly)) {
          edit('windowMatchForegroundOnly', String(windowMatchForegroundOnly));
        }
      }

      // If Browser Element probe fields — key (selector) is saved by the generic
      // effectiveKey block above; here the state mode + text pattern.
      if (action.conditionType === 'BrowserElementState') {
        const persistedIfMode = (waitMode === 'appears') ? '' : waitMode; // empty = default
        if ((persistedIfMode || '') !== (action.waitMode || '')) {
          edit('waitMode', persistedIfMode);
        }
        if (browserText !== (action.browserText || '')) {
          edit('browserText', browserText);
        }
      }

      // If Clipboard probe fields — same conditionType gating.
      if (action.conditionType === 'ClipboardMatch') {
        const currentPatternType = action.clipboardPatternType === 'equals' ? 'equals'
          : action.clipboardPatternType === 'regex' ? 'regex'
          : 'contains';
        if (clipboardPatternType !== currentPatternType) {
          edit('clipboardPatternType', clipboardPatternType);
        }
        if (clipboardPattern !== (action.clipboardPattern ?? '')) {
          edit('clipboardPattern', clipboardPattern);
        }
      }

      // If Random — a single percent.
      if (action.conditionType === 'Random') {
        const pct = Math.max(0, Math.min(100, parseInt(randomPercent, 10) || 0));
        if (pct !== (action.randomPercent ?? 0)) {
          edit('randomPercent', String(pct));
        }
      }

      // If Variable — the variable NAME is in `key` (saved by the generic effectiveKey block
      // above); here the operator + operand.
      if (action.conditionType === 'Variable') {
        const currentOp = action.conditionOperator ?? 'eq';
        if (conditionOperator !== currentOp) {
          edit('conditionOperator', conditionOperator);
        }
        if (conditionOperand !== (action.conditionOperand ?? '')) {
          edit('conditionOperand', conditionOperand);
        }
      }

      // If Process — the process name reuses windowProcessName (saved by the If-Window block
      // above, which is gated on WindowOpen). Save it here for the ProcessRunning family too.
      if (action.conditionType === 'ProcessRunning') {
        if (windowProcessName !== (action.windowProcessName ?? '')) {
          edit('windowProcessName', windowProcessName);
        }
      }

      // If File — the path.
      if (action.conditionType === 'FileExists') {
        if (filePath !== (action.filePath ?? '')) {
          edit('filePath', filePath);
        }
      }

      // If Time — window + day bitmask.
      if (action.conditionType === 'TimeWindow') {
        if (timeStart !== (action.timeStart ?? '')) {
          edit('timeStart', timeStart);
        }
        if (timeEnd !== (action.timeEnd ?? '')) {
          edit('timeEnd', timeEnd);
        }
        if (daysOfWeek !== (action.daysOfWeek ?? 0)) {
          edit('daysOfWeek', String(daysOfWeek));
        }
      }
    }

    // Pause-specific fields: timeout in milliseconds. Hotkey shares the `key` field with other
    // action types (already saved above by the generic key-equality check). Default ms=0 = infinite.
    if (actionType === 'Pause') {
      const parsedMs = parseFloat(timeout);
      const newTimeoutMs = isNaN(parsedMs) || parsedMs < 0 ? 0 : Math.round(parsedMs);
      if (newTimeoutMs !== (action.timeout || 0)) {
        edit('timeout', String(newTimeoutMs));
      }
    }

    // Browser-specific fields
    if (actionType === 'BrowserType' && browserText !== (action.browserText || '')) {
      edit('browserText', browserText);
    }
    // Timeout persists for EVERY browser command — the engine honours action.Timeout for all
    // six types (ActionExecution.cs Browser switch arm). Previously only Wait/Click/RightClick
    // saved it, so edits on Type/Navigate/SelectOption were silently dropped even though the
    // Timeout field is shown for them.
    if (actionType.startsWith('Browser')) {
      const newTimeoutMs = Math.max(1000, parseFloat(timeout) || 5000);
      if (newTimeoutMs !== (action.timeout || 5000)) {
        edit('timeout', String(Math.round(newTimeoutMs)));
      }
    }
    if (actionType === 'BrowserNavigate' && newTab !== (action.newTab || false)) {
      edit('newTab', String(newTab));
    }

    // #6 — WaitElement mode
    if (actionType === 'BrowserWaitElement') {
      const persistedMode = (waitMode === 'appears') ? '' : waitMode; // empty = default
      if ((persistedMode || '') !== (action.waitMode || '')) {
        edit('waitMode', persistedMode);
      }
    }

    // BrowserAssert — mirrors WaitElement: selector saved by the generic effectiveKey block
    // above (text-match packs the pattern into a text= selector via textMatch), waitMode
    // here, plus the fail policy.
    if (actionType === 'BrowserAssert') {
      const persistedMode = (waitMode === 'appears') ? '' : waitMode;
      if ((persistedMode || '') !== (action.waitMode || '')) {
        edit('waitMode', persistedMode);
      }
      const persistedPolicy = persistAssertPolicy(assertOnFail);
      const currentPolicy = persistAssertPolicy(action.assertOnFail);
      if (persistedPolicy !== currentPolicy) {
        edit('assertOnFail', persistedPolicy);
      }
    }

    // Desktop Assert shares assertOnFail with BrowserAssert but none of its browser fields,
    // so it gets its own narrow block rather than widening the gate above.
    if (actionType === 'Assert') {
      const persistedPolicy = persistAssertPolicy(assertOnFail);
      const currentPolicy = persistAssertPolicy(action.assertOnFail);
      if (persistedPolicy !== currentPolicy) {
        edit('assertOnFail', persistedPolicy);
      }
    }

    // #7 — Navigate post-checks
    if (actionType === 'BrowserNavigate') {
      if ((urlWaitPattern || '') !== (action.urlWaitPattern || '')) {
        edit('urlWaitPattern', urlWaitPattern);
      }
      if ((postNavigateSelector || '') !== (action.postNavigateSelector || '')) {
        edit('postNavigateSelector', postNavigateSelector);
      }
    }

    // #5 — Type options
    if (actionType === 'BrowserType') {
      if (!!typeAppend !== !!(action.typeAppend)) {
        edit('typeAppend', String(typeAppend));
      }
      if (!!typePaste !== !!(action.typePaste)) {
        edit('typePaste', String(typePaste));
      }
      const tdParsed = typeDelay.trim() === '' ? null : parseInt(typeDelay, 10);
      const currentTd = action.typeDelay ?? null;
      const normalized = (tdParsed != null && !isNaN(tdParsed)) ? tdParsed : null;
      if (normalized !== currentTd) {
        edit('typeDelay', normalized != null ? String(normalized) : '');
      }
    }

    // SetVariable — the value half of "name = value"; the NAME (key state) is already
    // saved by the generic effectiveKey block above.
    if (actionType === 'SetVariable') {
      if (variableValue !== (action.variableValue ?? '')) {
        edit('variableValue', variableValue);
      }
      const currentVarMode = action.variableMode === 'cycle' || action.variableMode === 'add' ? action.variableMode : 'set';
      if (variableMode !== currentVarMode) {
        // Backend persists only the non-default modes ('cycle', 'add'); 'set' round-trips to null on disk.
        edit('variableMode', variableMode === 'set' ? '' : variableMode);
      }
    }

    // Copy to Slot — the slot NAME (key state) is saved by the generic effectiveKey block
    // above; only the mode needs its own round-trip. Backend persists only 'clear'.
    if (actionType === 'CopyToSlot') {
      const currentSlotMode = action.slotMode === 'clear' ? 'clear' : 'capture';
      if (slotMode !== currentSlotMode) {
        edit('slotMode', slotMode === 'clear' ? 'clear' : '');
      }
    }

    // ActivateWindow — matcher (shared window* fields, no conditionType gate: the type
    // itself is the discriminator), launch fields, wait budget and failure policy.
    if (actionType === 'ActivateWindow') {
      if (windowProcessName !== (action.windowProcessName ?? '')) {
        edit('windowProcessName', windowProcessName);
      }
      if (windowTitle !== (action.windowTitle ?? '')) {
        edit('windowTitle', windowTitle);
      }
      const currentAwTitleMode = action.windowTitleMatchMode === 'regex' ? 'regex' : 'contains';
      if (windowTitleMatchMode !== currentAwTitleMode) {
        edit('windowTitleMatchMode', windowTitleMatchMode);
      }
      if (launchPath !== (action.launchPath ?? '')) {
        edit('launchPath', launchPath);
      }
      if (launchArgs !== (action.launchArgs ?? '')) {
        edit('launchArgs', launchArgs);
      }
      const persistedPolicy = activateOnTimeout === 'Continue' ? 'Continue' : '';
      const currentPolicy = action.activateOnTimeout === 'Continue' ? 'Continue' : '';
      if (persistedPolicy !== currentPolicy) {
        edit('activateOnTimeout', persistedPolicy);
      }
      // Placement. Any normalization here MUST be mirrored in hasUnsavedChanges (parity).
      if (restorePosition !== !!action.restorePosition) {
        edit('restorePosition', String(restorePosition));
      }
      if (restoreSize !== !!action.restoreSize) {
        edit('restoreSize', String(restoreSize));
      }
      const geoEdits: Array<[string, number, number]> = [
        ['windowX', parseInt(windowX, 10) || 0, action.windowX ?? 0],
        ['windowY', parseInt(windowY, 10) || 0, action.windowY ?? 0],
        ['windowWidth', Math.max(0, parseInt(windowWidth, 10) || 0), action.windowWidth ?? 0],
        ['windowHeight', Math.max(0, parseInt(windowHeight, 10) || 0), action.windowHeight ?? 0],
      ];
      for (const [geoField, next, current] of geoEdits) {
        if (next !== current) {
          edit(geoField, String(next));
        }
      }
      const newAwTimeout = Math.max(1000, Math.round(parseFloat(timeout) || 10000));
      if (newAwTimeout !== (action.timeout || 5000)) {
        edit('timeout', String(newAwTimeout));
      }
      // Phase 3 verb + nth-match (parity-mirrored in hasUnsavedChanges). Default 'Activate' persists
      // as '' (like Halt); match #1 persists as '1' (the bridge collapses it to null). A stored literal
      // 'activate' (only from hand-edited JSON — the app writes null) is treated as the '' default so
      // the editor doesn't open pre-dirtied.
      const persistedVerb = windowVerb === 'Activate' ? '' : windowVerb.toLowerCase();
      const currentVerb = (action.windowVerb ?? '').toLowerCase() === 'activate' ? '' : (action.windowVerb ?? '').toLowerCase();
      if (persistedVerb !== currentVerb) {
        edit('windowVerb', persistedVerb);
      }
      const nextMatch = Math.max(1, parseInt(matchIndex, 10) || 1);
      const currentMatch = action.windowMatchIndex && action.windowMatchIndex > 1 ? action.windowMatchIndex : 1;
      if (nextMatch !== currentMatch) {
        edit('windowMatchIndex', String(nextMatch));
      }
    }

    // BrowserSelectOption — match mode + browserText hold the option label/value/index.
    // browserText is already saved by the BrowserType branch above when actionType matches —
    // here we just persist the selectMatchMode separately. 'text' is the default and stays
    // null on disk; the backend rewrites it to null when receiving 'text' or empty.
    if (actionType === 'BrowserSelectOption') {
      // Persist BrowserText for the select target too (BrowserType-branch only covers BrowserType).
      if (browserText !== (action.browserText || '')) {
        edit('browserText', browserText);
      }
      // Persist the match mode if it differs from what's on disk.
      const currentMode = action.selectMatchMode === 'value' ? 'value'
        : action.selectMatchMode === 'index' ? 'index'
        : 'text';
      if (selectMatchMode !== currentMode) {
        edit('selectMatchMode', selectMatchMode);
      }
    }

    // FORM — computed here, sent WITH the field edits below. The order inside the backend is
    // unchanged (fields first, then the conversion, because a split changes the row COUNT and the
    // edits are addressed by index); what changes is that both travel in one message and land in
    // ONE undo entry. As two messages a Save that also switched the form cost two Ctrl+Z, and the
    // first of them put the fields back while leaving the row in the other form.
    // The backend refuses out loud (× N, at-cursor, Double/Triple, a drag that must stay paired),
    // so there is no second copy of those rules here to fall out of step with it.
    let convert: { direction: 'toPaired' | 'toCombined'; indices: number[] } | undefined;
    if (formDraft !== initialForm) {
      // Merging needs BOTH halves. The sheet edits one row, so reach for the twin the same way
      // the row menu's Merge does — a half on its own would come back "select the Up that follows
      // it", which is the app asking the user to restate what the row already says.
      const indices = formDraft === 'paired'
        ? [actionIndex]
        : clickFormOf(action.actionType) === 'Down'
          ? [actionIndex, actionIndex + 1]
          : [actionIndex - 1, actionIndex];
      convert = {
        direction: formDraft === 'paired' ? 'toPaired' : 'toCombined',
        indices: indices.filter(i => i >= 0),
      };
    }

    // One message, one undo entry — whether it carries fields, a form change, or both.
    if (pendingEdits.length > 0 || convert) {
      send({
        type: 'actions:editMany',
        payload: { index: actionIndex, edits: pendingEdits, ...(convert ? { convert } : {}) },
      });
    }

    onClose();
    // isIf / isIfImage / isIfPixel intentionally NOT in deps: they're pure-derived
    // from actionType + action.conditionType which are already in the array, so the
    // callback rebinds whenever those change. Listing the derived flags would also
    // be a forward-reference error (they're declared further down the component body).
  }, [actionIndex, action, actionType, formDraft, initialForm, key, textMatch, textMode, x, y, delay, comment, repeatCount, repeatGapMs, jitterOn, jitterPct, posJitterOn, posJitterPx, atCursor, holdMs, timeout, confidence, browserText, variableValue, variableMode, slotMode, newTab, waitMode, urlWaitPattern, postNavigateSelector, typeAppend, typePaste, typeDelay, selectMatchMode, waitImageOnTimeout, waitImageInvert, waitImageClickOnMatch, waitImageSearchRegion, pixelX, pixelY, pixelColor, pixelTolerance, pixelOnTimeout, pixelInvert, pixelClickOnMatch, conditionNegate, ifOnProbeError, conditionTimeout, loopMaxIterations, windowProcessName, windowTitle, windowTitleMatchMode, windowMatchForegroundOnly, clipboardPatternType, clipboardPattern, randomPercent, conditionOperator, conditionOperand, filePath, timeStart, timeEnd, daysOfWeek, launchPath, launchArgs, activateOnTimeout, restorePosition, restoreSize, windowX, windowY, windowWidth, windowHeight, windowVerb, matchIndex, assertOnFail, alternatives, pickedThisSession, send, onClose,
    // The two booleans, never the buttonStates object: it is republished on unrelated events
    // and this callback already rebuilds on every keystroke.
    refuseDuringRun]);

  // Are there FIELD edits the Save-Changes button would persist? MIRRORS handleSave's diffs
  // exactly (same guards/normalisation), returning true on the first field that differs —
  // so it is defined as "handleSave would send at least one actions:edit". Kept additive
  // (handleSave untouched) to keep the save path zero-risk; if a NEW field is ever added
  // to handleSave, mirror it HERE too or a stray Esc will silently drop that field's edit.
  // The Form draft is NOT in here — hasUnsavedChanges below adds it. mergeConflict needs the
  // two apart: it asks whether an Up half carries edits the merge would drop, and a form
  // change is the merge itself, not an edit it drops. With the form folded in, that question
  // answered yes for EVERY merge opened from the Up half, so all of them were refused.
  const hasFieldEdits = useMemo<boolean>(() => {
    if (actionIndex == null || !action) return false;
    // Desktop Assert stores the SAME condition payload, so every condition field below must
    // persist for it too. Gating these on 'If' alone would render a full Assert editor whose
    // window/clipboard/variable fields silently never save.
    const _hasCondition = hasConditionFields(actionType);
    const _isIfImage = _hasCondition && action.conditionType === 'ImageFound';
    const _isIfPixel = _hasCondition && action.conditionType === 'PixelColorMatch';

    if (actionType !== action.actionType) return true;
    const effectiveKey = textMatch.trim() ? buildTextSelector(textMode, textMatch.trim()) : key;
    if (effectiveKey !== action.key) return true;

    const isBrowserElementAction = isBrowserSelectorAction(actionType, action.conditionType);
    if (isBrowserElementAction) {
      if (pickedThisSession && alternatives.length > 1) {
        if (JSON.stringify(alternatives) !== JSON.stringify(action.selectorAlternatives ?? null)) return true;
      } else if (effectiveKey !== action.key && (action.selectorAlternatives?.length ?? 0) > 0) {
        return true;
      }
    }
    const newX = parseInt(x, 10);
    if (!isNaN(newX) && newX !== action.x) return true;
    const newY = parseInt(y, 10);
    if (!isNaN(newY) && newY !== action.y) return true;
    const newDelay = parseInt(delay, 10);
    if (!isNaN(newDelay) && newDelay !== action.delay) return true;
    if (comment !== (action.comment || '')) return true;

    // Click × N — mirror the handleSave diffs (same guards/clamps/per-type gap default) so a
    // reflexive Esc arms the dirty warning instead of silently dropping a Times/Gap/Jitter edit.
    if (COMBINED_CLICKS.has(actionType)) {
      const effRepeat = clampRepeatCount(repeatCount);
      if (effRepeat !== (action.repeatCount ?? 1)) return true;
      const effGap = clampRepeatGap(repeatGapMs);
      if (effGap !== (action.repeatDelayMs ?? clickDefaultGap(actionType))) return true;
      const effJitter = jitterOn && effRepeat > 1 ? clampRepeatJitter(jitterPct) : 0;
      if (effJitter !== (action.repeatDelayJitterPct ?? 0)) return true;
      const effPosJitter = posJitterOn && effRepeat > 1 && !atCursor ? clampRepeatPosJitter(posJitterPx) : 0;
      if (effPosJitter !== (action.repeatPositionJitterPx ?? 0)) return true;
      if (atCursor !== (action.atCursor ?? false)) return true;
      // Module-level predicate here too — see the note on the save path above.
      //
      // Compared against the EFFECTIVE dwell, not the raw field. A stored 0 means "use the
      // default" — the engine reads it that way, the Details column prints it that way, and the
      // seed above fills the editor with DEFAULT_HOLD_MS because of it. Comparing the seeded 1000
      // against a raw 0 made the panel permanently dirty on every *ClickHold row that had never
      // had a dwell typed into it — which is exactly the row "Change click type → Hold" creates,
      // since bulkUpdateType only clears the field when the target is NOT a hold. Esc then refused
      // to close and Cancel read "Discard" with nothing to discard.
      if (isClickHold(actionType) && clampHoldMs(holdMs) !== rowDwellMs(action)) return true;
    }

    if (actionType === 'WaitImage' || _isIfImage) {
      if (actionType === 'WaitImage') {
        const newTimeoutMs = Math.max(1000, parseFloat(timeout) || 5000);
        if (newTimeoutMs !== (action.timeout || 5000)) return true;
      }
      const newConfidence = Math.min(100, Math.max(10, parseInt(confidence, 10) || 80)) / 100;
      if (Math.abs(newConfidence - (action.confidence || 0.8)) > 0.005) return true;
      if (actionType === 'WaitImage') {
        const persistedTimeoutMode = waitImageOnTimeout === 'Continue' ? 'Continue' : '';
        const currentTimeoutMode = action.waitImageOnTimeout === 'Continue' ? 'Continue' : '';
        if (persistedTimeoutMode !== currentTimeoutMode) return true;
        if (!!waitImageInvert !== !!(action.waitImageInvert)) return true;
        if (!!waitImageClickOnMatch !== !!(action.waitImageClickOnMatch)) return true;
      }
      const currentRect = (action.waitImageSearchW && action.waitImageSearchH)
        ? `${action.waitImageSearchX || 0},${action.waitImageSearchY || 0},${action.waitImageSearchW},${action.waitImageSearchH}`
        : '';
      const newRect = waitImageSearchRegion
        ? `${waitImageSearchRegion.x},${waitImageSearchRegion.y},${waitImageSearchRegion.w},${waitImageSearchRegion.h}`
        : '';
      if (newRect !== currentRect) return true;
    }

    if (actionType === 'WaitPixelColor' || _isIfPixel) {
      if (actionType === 'WaitPixelColor') {
        const newTimeoutMs = Math.max(1000, parseFloat(timeout) || 5000);
        if (newTimeoutMs !== (action.timeout || 5000)) return true;
      }
      const trimmedX = pixelX.trim();
      const trimmedY = pixelY.trim();
      const parsedX = trimmedX === '' ? null : parseInt(trimmedX, 10);
      const parsedY = trimmedY === '' ? null : parseInt(trimmedY, 10);
      if ((parsedX ?? null) !== (action.pixelX ?? null)) return true;
      if ((parsedY ?? null) !== (action.pixelY ?? null)) return true;
      const rawColor = pixelColor.trim();
      const normalisedColor = rawColor === ''
        ? ''
        : (rawColor.startsWith('#') ? rawColor.toUpperCase() : '#' + rawColor.toUpperCase());
      if (normalisedColor !== (action.pixelColor ?? '')) return true;
      const newTol = Math.max(0, Math.min(255, parseInt(pixelTolerance, 10) || 0));
      if (newTol !== (action.pixelTolerance ?? 0)) return true;
      if (actionType === 'WaitPixelColor') {
        const persistedPxTimeout = pixelOnTimeout === 'Continue' ? 'Continue' : '';
        const currentPxTimeout = action.pixelOnTimeout === 'Continue' ? 'Continue' : '';
        if (persistedPxTimeout !== currentPxTimeout) return true;
        if (!!pixelInvert !== !!(action.pixelInvert)) return true;
        if (!!pixelClickOnMatch !== !!(action.pixelClickOnMatch)) return true;
      }
    }

    if (_hasCondition) {
      if (!!conditionNegate !== !!(action.conditionNegate)) return true;
      const ctVal = Math.max(0, parseInt(conditionTimeout, 10) || 0);
      if (ctVal !== (action.conditionTimeout ?? 0)) return true;
      // Mirrors the If/While gate in handleSave — an Assert never writes ifOnProbeError, so
      // it must not report a difference in it as unsaved work either.
      if (carriesConditionProbe(actionType)) {
        const persistedErr = ifOnProbeError === 'Halt' ? 'Halt' : '';
        const currentErr = action.ifOnProbeError === 'Halt' ? 'Halt' : '';
        if (persistedErr !== currentErr) return true;
      }
      // While ceiling — the trinca's dirty leg, mirroring handleSave's diff exactly.
      if (actionType === 'While') {
        const lmVal = Math.max(0, parseInt(loopMaxIterations, 10) || 0);
        if (lmVal !== (action.loopMaxIterations ?? 0)) return true;
      }
      if (action.conditionType === 'WindowOpen') {
        if (windowProcessName !== (action.windowProcessName ?? '')) return true;
        if (windowTitle !== (action.windowTitle ?? '')) return true;
        const currentTitleMode = action.windowTitleMatchMode === 'regex' ? 'regex' : 'contains';
        if (windowTitleMatchMode !== currentTitleMode) return true;
        if (!!windowMatchForegroundOnly !== !!(action.windowMatchForegroundOnly)) return true;
      }
      if (action.conditionType === 'BrowserElementState') {
        const persistedIfMode = (waitMode === 'appears') ? '' : waitMode;
        if ((persistedIfMode || '') !== (action.waitMode || '')) return true;
        if (browserText !== (action.browserText || '')) return true;
      }
      if (action.conditionType === 'ClipboardMatch') {
        const currentPatternType = action.clipboardPatternType === 'equals' ? 'equals'
          : action.clipboardPatternType === 'regex' ? 'regex'
          : 'contains';
        if (clipboardPatternType !== currentPatternType) return true;
        if (clipboardPattern !== (action.clipboardPattern ?? '')) return true;
      }
      if (action.conditionType === 'Random') {
        const pct = Math.max(0, Math.min(100, parseInt(randomPercent, 10) || 0));
        if (pct !== (action.randomPercent ?? 0)) return true;
      }
      if (action.conditionType === 'Variable') {
        const currentOp = action.conditionOperator ?? 'eq';
        if (conditionOperator !== currentOp) return true;
        if (conditionOperand !== (action.conditionOperand ?? '')) return true;
      }
      if (action.conditionType === 'ProcessRunning') {
        if (windowProcessName !== (action.windowProcessName ?? '')) return true;
      }
      if (action.conditionType === 'FileExists') {
        if (filePath !== (action.filePath ?? '')) return true;
      }
      if (action.conditionType === 'TimeWindow') {
        if (timeStart !== (action.timeStart ?? '')) return true;
        if (timeEnd !== (action.timeEnd ?? '')) return true;
        if (daysOfWeek !== (action.daysOfWeek ?? 0)) return true;
      }
    }

    if (actionType === 'Pause') {
      const parsedMs = parseFloat(timeout);
      const newTimeoutMs = isNaN(parsedMs) || parsedMs < 0 ? 0 : Math.round(parsedMs);
      if (newTimeoutMs !== (action.timeout || 0)) return true;
    }

    if (actionType === 'BrowserType' && browserText !== (action.browserText || '')) return true;
    if (actionType.startsWith('Browser')) {
      const newTimeoutMs = Math.max(1000, parseFloat(timeout) || 5000);
      if (newTimeoutMs !== (action.timeout || 5000)) return true;
    }
    if (actionType === 'BrowserNavigate' && newTab !== (action.newTab || false)) return true;

    if (actionType === 'BrowserWaitElement') {
      const persistedMode = (waitMode === 'appears') ? '' : waitMode;
      if ((persistedMode || '') !== (action.waitMode || '')) return true;
    }

    if (actionType === 'BrowserAssert') {
      const persistedMode = (waitMode === 'appears') ? '' : waitMode;
      if ((persistedMode || '') !== (action.waitMode || '')) return true;
      const persistedPolicy = persistAssertPolicy(assertOnFail);
      const currentPolicy = persistAssertPolicy(action.assertOnFail);
      if (persistedPolicy !== currentPolicy) return true;
    }

    // Mirror of the Desktop Assert save block — a reflexive Esc must arm the dirty warning
    // instead of silently dropping an on-failure change.
    if (actionType === 'Assert') {
      const persistedPolicy = persistAssertPolicy(assertOnFail);
      const currentPolicy = persistAssertPolicy(action.assertOnFail);
      if (persistedPolicy !== currentPolicy) return true;
    }

    if (actionType === 'BrowserNavigate') {
      if ((urlWaitPattern || '') !== (action.urlWaitPattern || '')) return true;
      if ((postNavigateSelector || '') !== (action.postNavigateSelector || '')) return true;
    }

    if (actionType === 'BrowserType') {
      if (!!typeAppend !== !!(action.typeAppend)) return true;
      if (!!typePaste !== !!(action.typePaste)) return true;
      const tdParsed = typeDelay.trim() === '' ? null : parseInt(typeDelay, 10);
      const currentTd = action.typeDelay ?? null;
      const normalized = (tdParsed != null && !isNaN(tdParsed)) ? tdParsed : null;
      if (normalized !== currentTd) return true;
    }

    if (actionType === 'SetVariable') {
      if (variableValue !== (action.variableValue ?? '')) return true;
      const currentVarMode = action.variableMode === 'cycle' || action.variableMode === 'add' ? action.variableMode : 'set';
      if (variableMode !== currentVarMode) return true;
    }

    if (actionType === 'CopyToSlot') {
      const currentSlotMode = action.slotMode === 'clear' ? 'clear' : 'capture';
      if (slotMode !== currentSlotMode) return true;
    }

    if (actionType === 'ActivateWindow') {
      if (windowProcessName !== (action.windowProcessName ?? '')) return true;
      if (windowTitle !== (action.windowTitle ?? '')) return true;
      const currentAwTitleMode = action.windowTitleMatchMode === 'regex' ? 'regex' : 'contains';
      if (windowTitleMatchMode !== currentAwTitleMode) return true;
      if (launchPath !== (action.launchPath ?? '')) return true;
      if (launchArgs !== (action.launchArgs ?? '')) return true;
      const persistedPolicy = activateOnTimeout === 'Continue' ? 'Continue' : '';
      const currentPolicy = action.activateOnTimeout === 'Continue' ? 'Continue' : '';
      if (persistedPolicy !== currentPolicy) return true;
      // Placement — mirrors handleSave's diffs + normalization byte-for-byte (PARITY OBLIGATION:
      // a field in handleSave but not here means a stray Esc silently drops that edit).
      if (restorePosition !== !!action.restorePosition) return true;
      if (restoreSize !== !!action.restoreSize) return true;
      if ((parseInt(windowX, 10) || 0) !== (action.windowX ?? 0)) return true;
      if ((parseInt(windowY, 10) || 0) !== (action.windowY ?? 0)) return true;
      if (Math.max(0, parseInt(windowWidth, 10) || 0) !== (action.windowWidth ?? 0)) return true;
      if (Math.max(0, parseInt(windowHeight, 10) || 0) !== (action.windowHeight ?? 0)) return true;
      const newAwTimeout = Math.max(1000, Math.round(parseFloat(timeout) || 10000));
      if (newAwTimeout !== (action.timeout || 5000)) return true;
      // Verb + nth-match — parity with handleSave (incl. the 'activate'-literal normalization).
      const persistedVerb = windowVerb === 'Activate' ? '' : windowVerb.toLowerCase();
      const currentVerb = (action.windowVerb ?? '').toLowerCase() === 'activate' ? '' : (action.windowVerb ?? '').toLowerCase();
      if (persistedVerb !== currentVerb) return true;
      const nextMatch = Math.max(1, parseInt(matchIndex, 10) || 1);
      const currentMatch = action.windowMatchIndex && action.windowMatchIndex > 1 ? action.windowMatchIndex : 1;
      if (nextMatch !== currentMatch) return true;
    }

    if (actionType === 'BrowserSelectOption') {
      if (browserText !== (action.browserText || '')) return true;
      const currentMode = action.selectMatchMode === 'value' ? 'value'
        : action.selectMatchMode === 'index' ? 'index'
        : 'text';
      if (selectMatchMode !== currentMode) return true;
    }

    return false;
  }, [actionIndex, action, actionType, key, textMatch, textMode, x, y, delay, comment, repeatCount, repeatGapMs, jitterOn, jitterPct, posJitterOn, posJitterPx, atCursor, holdMs, timeout, confidence, browserText, variableValue, variableMode, slotMode, newTab, waitMode, urlWaitPattern, postNavigateSelector, typeAppend, typePaste, typeDelay, selectMatchMode, waitImageOnTimeout, waitImageInvert, waitImageClickOnMatch, waitImageSearchRegion, pixelX, pixelY, pixelColor, pixelTolerance, pixelOnTimeout, pixelInvert, pixelClickOnMatch, conditionNegate, ifOnProbeError, conditionTimeout, loopMaxIterations, windowProcessName, windowTitle, windowTitleMatchMode, windowMatchForegroundOnly, clipboardPatternType, clipboardPattern, randomPercent, conditionOperator, conditionOperand, filePath, timeStart, timeEnd, daysOfWeek, launchPath, launchArgs, activateOnTimeout, restorePosition, restoreSize, windowX, windowY, windowWidth, windowHeight, windowVerb, matchIndex, assertOnFail, alternatives, pickedThisSession]);

  // Powers the dirty-aware Esc guard (a reflexive Esc arms a warning instead of discarding). The
  // form is a draft like any other field, so it has to reach the dirty check — otherwise Save
  // stays disabled on a form-only change, and Esc discards it without the guard.
  const hasUnsavedChanges = hasFieldEdits || (actionIndex != null && action != null && formDraft !== initialForm);

  // Key capture handler — focusing the field switches it to capture mode (empty + "New
  // key..." + pulse), the next non-modifier key is stored, and the input auto-blurs so
  // the user sees the resolved value immediately. Esc is intentionally NOT a cancel key
  // any more — the user might legitimately want to assign Escape as a hotkey. Cancelling
  // is done by clicking away or letting the idle timer fire (see armKeyCaptureTimer).
  const [keyFieldFocused, setKeyFieldFocused] = useState(false);
  const keyFieldRef = useRef<HTMLInputElement>(null);
  const keyCaptureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable refcount slot for hotkey:capture — only ONE surface in Sheet uses the
  // backend low-level hook (the Pause-resume hotkey field, which has to capture
  // Win+letter combos the WebView2 JS layer never sees). The Keystroke / KeyDown /
  // KeyUp inline editors use plain React keydown handlers (see handleKeyCapture)
  // and do NOT touch this slot. See InputHookManager.RegisterCapture.
  const captureOwnerIdRef = useRef(`sheet-panel-${crypto.randomUUID()}`);
  const KEY_CAPTURE_TIMEOUT_MS = 4000;
  const armKeyCaptureTimer = useCallback(() => {
    if (keyCaptureTimerRef.current) clearTimeout(keyCaptureTimerRef.current);
    keyCaptureTimerRef.current = setTimeout(() => {
      keyFieldRef.current?.blur();
    }, KEY_CAPTURE_TIMEOUT_MS);
  }, []);
  const disarmKeyCaptureTimer = useCallback(() => {
    if (keyCaptureTimerRef.current) {
      clearTimeout(keyCaptureTimerRef.current);
      keyCaptureTimerRef.current = null;
    }
  }, []);

  // Release the hotkey-capture slot on unmount. Normal flow (user blurs the
  // Pause-resume hotkey field before closing the Sheet) already does this via
  // onBlur, but Sheet can be torn down without a blur fire — backend-pushed
  // sheet:openIndex (App.tsx) or a programmatic close while the field is focused
  // both skip blur. HashSet.Remove is idempotent so this is a no-op when the
  // slot was never registered.
  useEffect(() => {
    // Captured at effect time, not read in the cleanup — see SettingsPanel.
    const ownerId = captureOwnerIdRef.current;
    return () => {
      send({ type: 'hotkey:capture', payload: { enabled: false, ownerId } });
    };
  }, [send]);

  // Pause-resume hotkey capture: while the field is focused, the backend low-level
  // hook composes every keypress (including Win+letter combos the WebView2 JS layer
  // never sees) and forwards them here. Commit on first non-pure-modifier combo.
  useEffect(() => {
    if (!pauseHotkeyFocused) return;
    return subscribe((msg) => {
      if (msg.type !== 'hotkey:captured') return;
      const combo = msg.payload.combo;
      setKey(combo);
      armKeyCaptureTimer();
      const isPureModifier = /^(Win|Ctrl|Alt|Shift)(\+(Win|Ctrl|Alt|Shift))*$/.test(combo);
      if (!isPureModifier) {
        disarmKeyCaptureTimer();
        keyFieldRef.current?.blur();
      }
    });
  }, [pauseHotkeyFocused, subscribe, armKeyCaptureTimer, disarmKeyCaptureTimer]);

  const handleKeyCapture = useCallback((e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Push out the idle-cancel timer on every keypress — even modifiers — so an actively
    // engaged user is never surprised by a sudden cancel mid-combo.
    armKeyCaptureTimer();

    const modifierKeys = new Set(['Control', 'Alt', 'Shift', 'Meta']);
    if (modifierKeys.has(e.key)) return;

    let mainKey = e.key;
    if (mainKey === ' ') mainKey = 'Space';
    else if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
    else if (mainKey === 'ArrowUp') mainKey = 'Up';
    else if (mainKey === 'ArrowDown') mainKey = 'Down';
    else if (mainKey === 'ArrowLeft') mainKey = 'Left';
    else if (mainKey === 'ArrowRight') mainKey = 'Right';

    setKey(mainKey);
    disarmKeyCaptureTimer();
    // Drop focus so the user sees the captured value rendered instead of staying in
    // capture mode.
    (e.target as HTMLInputElement).blur();
  }, [armKeyCaptureTimer, disarmKeyCaptureTimer]);

  // Dirty-aware exits: a reflexive Esc — or a click on another row's pencil — must not silently
  // discard unsaved edits (the panel batches edits into local state and only persists them on
  // Save). The first attempt ARMS a footer warning that names the gesture ("Esc again discards"
  // / "Click again to discard"); the same gesture repeated inside the window is the discard,
  // and it toasts so the user knows the second press did what the first one promised. Each
  // gesture arms its own kind — an Esc after a refused row switch re-arms as Esc rather than
  // counting as the repeat. The refs let the document listener and App's tryLeave read the
  // latest values without re-attaching on every keystroke. Cancel / Back stay the EXPLICIT
  // one-click discard (no arm): they just say so on their labels while there is something to lose.
  type ArmedBy = 'esc' | 'switch' | null;
  const [armedBy, setArmedBy] = useState<ArmedBy>(null);
  const armedByRef = useRef<ArmedBy>(null);
  const escArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUnsavedRef = useRef(false);
  hasUnsavedRef.current = hasUnsavedChanges;
  // 4 s, up from 2.5: time to read the warning and decide. Shorter read as "I pressed Esc twice
  // and it did not close" once the second press landed just outside the window.
  const GUARD_WINDOW_MS = 4000;
  const armGuard = useCallback((kind: Exclude<ArmedBy, null>) => {
    armedByRef.current = kind;
    setArmedBy(kind);
    if (escArmTimerRef.current) clearTimeout(escArmTimerRef.current);
    escArmTimerRef.current = setTimeout(() => {
      armedByRef.current = null;
      setArmedBy(null);
    }, GUARD_WINDOW_MS);
  }, []);
  // Only when there WAS something to lose — a clean Cancel says nothing.
  const noteDiscard = useCallback(() => {
    if (hasUnsavedRef.current) showToast(tt('Changes discarded', 'Alterações descartadas'), 'info');
  }, [showToast, tt]);
  const discardAndClose = useCallback(() => { noteDiscard(); onClose(); }, [noteDiscard, onClose]);
  // Ctrl+S from the document listener below: refs so the listener never re-attaches on a field
  // edit (handleSave's identity changes with every keystroke) and so it can read regexError,
  // which is declared further down the component body.
  const handleSaveRef = useRef<() => void>(() => {});
  const saveBlockedRef = useRef(false);
  // WHY it is blocked, for the keyboard path — the button says it in a tooltip, which a Ctrl+S
  // never shows.
  const saveBlockedReasonRef = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    tryLeave: (kind) => {
      if (!hasUnsavedRef.current) return true;
      if (armedByRef.current === kind) { noteDiscard(); return true; }
      armGuard(kind);
      return false;
    },
    discardAndClose,
  }), [armGuard, noteDiscard, discardAndClose]);

  // Declare those same pending edits to the backend, for automations only.
  //
  // The edits live in this component's state until Save Changes turns them into `actions:edit`,
  // so the backend's unsaved-changes flag — which an autonomous fire DOES respect — is still
  // false while a half-filled form is on screen. The fire then swaps the profile, the action list
  // is replaced wholesale, and the seed effect above re-seeds these fields from the same-index row
  // of a DIFFERENT profile. With fewer rows in the new profile the panel is left stranded: stale
  // values, Save inert, nothing on screen having changed to explain it.
  //
  // Only AutomationGuard reads this, so hotkeys and hotstrings are untouched. Leak protection is
  // on the backend (cleared on ui:ready, plus a TTL) because a WebView that dies with this panel
  // open can never send the release.
  // LATCHED, not derived — and the difference is the whole fix.
  //
  // hasUnsavedChanges is a diff against the STORE, and the store is replaced by any
  // actions:updated push, including the one an autonomous fire causes. Deriving the flag from it
  // meant the seed effect above cleared it at the exact moment the danger arrived: a live test
  // caught YES and no four milliseconds apart, with the fire going through in between. The
  // protection depended on the state that the unprotected event destroys.
  //
  // So the flag answers "has the user touched this editor", which a re-seed cannot un-answer. It
  // resets when the editor moves to another row or closes — the two moments the user is done with
  // it. Erring long is deliberate: holding an autonomous fire for a few extra seconds costs a
  // deferral, while releasing it early costs the edits.
  const [editorTouched, setEditorTouched] = useState(false);
  // Its reset on [actionIndex] is declared ABOVE the pick-first seed — see there for why.
  // Armed by a real edit, not by hasUnsavedChanges. That flag is a diff against the STORE, and any
  // actions:updated push replaces the store — so an editor nobody had touched latched itself and
  // then held autonomous fires for up to the guard's whole TTL. markTouched is called from the DOM
  // input/change/CLICK handlers on the form below and from the pick-from-screen seed, which writes
  // coordinates without any input event at all and otherwise left a dirty editor completely
  // unprotected.
  //
  // The click handler is load-bearing, not belt-and-braces. This used to say that bubbling made
  // one handler enough for every field; bubbling was never the question. A <button> emits neither
  // `input` nor `change`, so onInput/onChange cannot see one however deep it sits — and the panel
  // is built out of buttons: SegmentedControl, DurationChips, the themed Checkbox and the
  // NumberInput steppers all render one.
  const markTouched = useCallback(() => setEditorTouched(true), []);

  // The CLICK half needs a filter the input/change halves do not. onInput and onChange only fire
  // when a value actually changed; onClick fires for everything that bubbles to the body div —
  // and that div is the whole panel, down to labels, padding, the scroll area and result cards.
  //
  // The gap matters because the latch is not local. editorTouched becomes editor:pendingEdits,
  // which becomes AutomationGuard.SetEditorBusy, which is RENEWED every 60 s against a 10-minute
  // TTL — so the TTL never expires while the panel is open, and every autonomous fire from then on
  // reports "skipped (editing a row)". A skipped fire is LOST, not queued, once it is past its
  // grace window. Opening the Sheet on a WaitImage row, pressing "Test match" to read the current
  // score, and walking away was enough to stop every armed automation in the profile, for as long
  // as the panel stayed open, with nothing on screen saying so.
  //
  // A probe is a READ. Buttons that only report — Test match, the window-target Test, and a
  // Pick-from-screen the user cancels — carry data-probe and do not claim. Anything that can write
  // a field still does, including the ones that emit no input event, which is why the click
  // handler exists at all.
  const markTouchedFromClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement | null)?.closest('[data-probe]')) return;
    setEditorTouched(true);
  }, []);

  const pendingEdits = actionIndex != null && editorTouched;
  useEffect(() => {
    send({ type: 'editor:pendingEdits', payload: { pending: pendingEdits } });
  }, [pendingEdits, send]);
  // Unmount is not a value change, so the effect above never fires for it.
  useEffect(() => () => { send({ type: 'editor:pendingEdits', payload: { pending: false } }); }, [send]);
  // RENEW the claim while it is held. AutomationGuard expires it a fixed TTL after the moment it
  // was STAMPED, and the effect above only fires on the TRANSITION of pendingEdits — so the clock
  // started on the user's first keystroke in this row and nothing ever restarted it. Ten minutes
  // later the claim died with the user still typing, and the next autonomous fire swapped the
  // profile and overwrote the open editor field by field, silently.
  //
  // A heartbeat is the right shape because it renews on exactly the condition the TTL exists to
  // detect. That backstop is there for "a WebView that went away without releasing" — and a
  // WebView that went away also stops this interval, so the claim still expires on schedule for
  // the case it was written for. Keyed on pendingEdits, so it never claims for a closed editor.
  //
  // It renews off the LATCH, not off recent keystrokes, and that is deliberate — do not "fix" it
  // into an idle budget. This is the house's settled answer for a surface that invites walking
  // away: InteractionScope.EnterRenewing was written for the capture overlays and its remarks
  // reject the alternative by name — "a longer flat ttl ... is strictly worse: it weakens leak
  // detection AND still eventually fires under a live one, so it trades a certain harm for a
  // rarer one". An idle budget here would be that flat ttl with a shorter fuse, and it would
  // lapse under the long editor interactions that emit no input event at all (the cropper, Test
  // match, the selector probe). What the claim costs while held is visible and recoverable: the
  // fire reports "skipped (editing a row)", counts as SkippedModal, and is retried inside its
  // grace window. What it costs when it lapses is not: the fields are overwritten in silence.
  // Four live paths still release it — ui:ready, unmount, moving to another row, and the TTL
  // itself the moment this interval stops.
  useEffect(() => {
    if (!pendingEdits) return;
    const id = setInterval(() => {
      send({ type: 'editor:pendingEdits', payload: { pending: true } });
    }, EDITOR_CLAIM_RENEW_MS);
    return () => clearInterval(id);
  }, [pendingEdits, send]);

  // The row this editor edits stopped existing — an Undo that shortened the list, a delete from
  // the grid, a profile switch. The panel went on painting a row that is gone: every field still
  // showed its values, and Save Changes was a silent no-op against an index past the end. Closing
  // is the honest answer; the toast is conditional because a panel the user had not touched
  // vanishing with an explanation reads as an error where nothing was lost.
  useEffect(() => {
    if (actionIndex == null || leaving) return;
    if (actionIndex < actions.length) return;
    if (editorTouched) showToast(tt('That action no longer exists', 'Essa ação não existe mais'), 'info');
    onClose();
  }, [actionIndex, actions.length, leaving, editorTouched, onClose, showToast, tt]);

  // Esc-to-close — global listener that closes the panel when the user presses Escape
  // outside of any capture mode. Key capture handlers (KeyDown/KeyUp Key field, Pause
  // Resume Hotkey, the grid Key column edit, Settings global hotkeys) all call
  // `e.preventDefault()` on every key, including Escape. That flips `defaultPrevented`
  // on the underlying native event, so we just check it here and skip the close when an
  // inner handler already consumed the press. Listener is only active while the panel is
  // mounted with a non-null actionIndex.
  useEffect(() => {
    if (actionIndex == null) return;
    const onDocKeyDown = (e: KeyboardEvent) => {
      // A modal opened FROM the sheet owns the keyboard while it is up. The sheet's own root is
      // not a dialog — only DialogShell's card carries role="dialog" — so this one test hands
      // every such overlay its keys back. Without it, Ctrl+S inside the image cropper saved the
      // row with the OLD image and closed the sheet, throwing the crop away: the cropper moved to
      // DialogShell in this delta, and DialogShell only stops Escape and Tab, while the wrapper
      // it replaced stopped every key. The Escape branch below wants the same protection and only
      // escaped it by luck, because DialogShell does consume Escape.
      const target = e.target as Element | null;
      if (target?.closest?.('[role="dialog"]')) return;
      // Ctrl+S saves the ROW while the editor is open (same gate as the Save button). Stopped
      // here so the window-level Ctrl+S — which saves the PROFILE — does not also fire.
      if (e.ctrlKey && !e.altKey && (e.key === 's' || e.key === 'S') && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        // Blocked is not the same as nothing happened. This branch consumes the key so the
        // window-level Ctrl+S (which saves the PROFILE) does not also fire — so returning quietly
        // left the user with a shortcut that did nothing at all, no row save AND no profile save,
        // while the Save button beside it states its reason in a tooltip. Refusals are spoken
        // everywhere else in this panel; the keyboard is not a quieter door.
        if (saveBlockedRef.current) {
          if (saveBlockedReasonRef.current) showToast(saveBlockedReasonRef.current, 'error');
          return;
        }
        handleSaveRef.current();
        return;
      }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // An active element pick takes priority: Esc cancels the pick (tear down the extension
      // overlay + drop our in-flight state) instead of closing the panel. The extension's own
      // page-level Esc only fires when the browser page is focused — this covers Esc while the
      // TrueReplayer editor has focus. Consume the press so the panel doesn't also close.
      if (pickElementRequestIdRef.current) {
        e.preventDefault();
        send({ type: 'browser:cancelPick', payload: {} });
        setPickElementRequestId(null);
        setIsPicking(false);
        return;
      }
      // Dirty guard rung (below capture/pick, above close): the FIRST Esc on a panel with
      // unsaved edits arms the footer warning instead of closing; a SECOND Esc within the
      // window discards (with a toast) + closes. A clean panel closes on the first Esc, as before.
      if (hasUnsavedRef.current && armedByRef.current !== 'esc') {
        e.preventDefault();
        armGuard('esc');
        return;
      }
      noteDiscard();
      onClose();
    };
    document.addEventListener('keydown', onDocKeyDown);
    return () => document.removeEventListener('keydown', onDocKeyDown);
  }, [actionIndex, onClose, send, armGuard, noteDiscard, showToast]);

  // Reset the capture state whenever the panel switches to a different action (including
  // closing — actionIndex going null). Without this, focusing the field, closing the
  // panel, then reopening leaves the field stuck in capture mode because the input was
  // unmounted before its blur could fire. Also tear down any pending idle-cancel timer
  // so it doesn't fire against a stale input ref after the panel reopens. Finally drop
  // every in-flight overlay/extension request: the panel doesn't remount on action
  // change, so if the user opens action A, fires Pick / eyedropper / Test action / Test
  // pixel, then switches to action B, the pending reply would otherwise land on B (and
  // a stuck requestId leaves B's button frozen at "Picking… / Running…"). Also kill the
  // Test-action safety timeout so it can't fire against B, and clear the transient test
  // results so B doesn't briefly show A's outcome.
  useEffect(() => {
    setKeyFieldFocused(false);
    setPauseHotkeyFocused(false);
    disarmKeyCaptureTimer();
    // Disarm the dirty-exit warning when switching action (a fresh row starts clean, and a
    // stale "Esc again" armed against the previous row must not carry over).
    armedByRef.current = null;
    setArmedBy(null);
    if (escArmTimerRef.current) { clearTimeout(escArmTimerRef.current); escArmTimerRef.current = null; }
    setPickPositionRequestId(null);
    clearTestTimeout();
    setTestRequestId(null);
    setTestResult(null);
    setPickColorRequestId(null);
    setTestPixelRequestId(null);
    setTestPixelResult(null);
    // Browser element pick — drop the in-flight pick when the action changes (mirrors the
    // pickPosition / pickColor resets above). Clearing the id makes any late browser:pickResult
    // stale (the handler's id guard drops it), and we ask the extension to tear down its overlay
    // so a leftover pick can't land on the newly-opened action. send is stable from useBridge.
    if (pickElementRequestIdRef.current) send({ type: 'browser:cancelPick', payload: {} });
    setPickElementRequestId(null);
    setIsPicking(false);
    // The round-trips correlated by a plain REF (no request-id state of their own) need the
    // same drop as the ids above, and they were the ones missed: each handler gates on its
    // ref, so a ref that survives the switch makes a late reply look current and it writes
    // action A's answer into action B. Nulling the ref is the whole fix — the reply handlers
    // already bail when the ref is null, and none of the three has a "…in progress" control
    // that could stick (the Capture button's state is re-seeded per action).
    //   window:captureGeometry is the sharp one: it is an OS query that does NOT minimise the
    //   app, so the grid stays clickable for the entire round-trip and switching rows mid-flight
    //   is an ordinary thing to do. The file dialog is modal and the region overlay covers the
    //   screen, so those two are far harder to trigger — reset together anyway, because a ref
    //   that is cleared in only one of its two exits is a trap for whoever edits this next.
    browseLaunchReqRef.current = null;
    captureGeoReqRef.current = null;
    searchRegionRequestIdRef.current = null;
  }, [actionIndex, disarmKeyCaptureTimer, clearTestTimeout, send]);

  // Unmount cleanup — any pending timers must be torn down so they don't fire against
  // refs to gone DOM nodes (would warn in React strict-mode dev, harmless in prod but
  // still worth doing).
  useEffect(() => {
    return () => {
      disarmKeyCaptureTimer();
      if (coordCopyFlashTimerRef.current) clearTimeout(coordCopyFlashTimerRef.current);
      if (coordPasteErrorTimerRef.current) clearTimeout(coordPasteErrorTimerRef.current);
    };
  }, [disarmKeyCaptureTimer]);

  // #1 — Validate regex pattern when in regex mode
  const regexError = useMemo(() => {
    if (textMode !== 'regex' || !textMatch.trim()) return null;
    try { new RegExp(textMatch); return null; }
    catch (e) { return (e as Error).message; }
  }, [textMode, textMatch]);

  // Notes grows to fit its CONTENT, and the content arrives by state, not by typing. The
  // textarea mounts while `comment` still holds the previous session's value (the sheet returns
  // null when closed, and the seed that fills it is a passive effect that fires no `input`), so
  // the mount-time measurement sized the box for the wrong text: a saved six-line note opened in
  // two lines with a scrollbar, and the height of one action leaked into the next.
  //
  // A layout effect, so the field is already the right size on the first painted frame. `comment`
  // is read inside the callback, which is also what keeps exhaustive-deps satisfied.
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = notesRef.current;
    if (el && el.value === comment) growTextarea(el);
    // actionIndex too: the sheet unmounts its own subtree while this component stays mounted
    // (App renders it without a `key`), so REOPENING the same action wrote an identical `comment`
    // and the effect never ran — the field came back at two rows with a scrollbar over text that
    // had been sized correctly a moment earlier.
  }, [comment, actionIndex]);

  // #2 — Tier shield for current selector (priority: textMatch > key). Memoised because
  // estimateTier runs a regex suite and buildTextSelector rebuilds the selector — recomputing
  // both on every render (the panel re-renders on each keystroke / test result) is wasteful.
  // MUST live here, above the `if (actionIndex == null) return null` early return below, so the
  // hook is called unconditionally on every render (Rules of Hooks).
  const { selectorForTier, tier, tierMeta } = useMemo(() => {
    const sel = textMatch.trim() ? buildTextSelector(textMode, textMatch.trim()) : key;
    const t = estimateTier(sel);
    return { selectorForTier: sel, tier: t, tierMeta: TIER_META[t] };
  }, [textMatch, textMode, key]);

  // #3 — Run the current action against the live page
  const handleTestAction = useCallback(() => {
    // The only Test that ACTS: it performs the real click / type / navigate on the live tab. During
    // a replay driving that same tab it is a second hand on the wheel, and it can move the pinned
    // tab out from under the run. The other Tests (match, probe, condition) only read, and stay
    // available on purpose — inspecting is exactly what someone does while watching a run.
    if (refuseDuringRun()) return;
    if (actionIndex == null || !action) return;
    const requestId = Math.random().toString(36).slice(2, 10);
    setTestRequestId(requestId);
    setTestResult(null);
    const effectiveKey = textMatch.trim() ? buildTextSelector(textMode, textMatch.trim()) : key;
    const timeoutMs = Math.max(1000, parseFloat(timeout) || 5000);
    const tdParsed = typeDelay.trim() === '' ? null : parseInt(typeDelay, 10);

    // Safety timeout — recover the UI if the bridge never responds (extension crash, pipe drop).
    // Wait the full backend timeout plus 5 s overhead before giving up.
    //
    // Plus everything the extension spends INSIDE the type command, mirroring
    // BrowserBridgeService.TypeKeyBudgetMs: {delay:N} pauses (500 ms bare, capped at 60 s), 30 ms
    // per {key:N} press (N capped at 100) and the per-character Delay over the characters left
    // once the key tokens are removed. Without it this net fires first and the late
    // browser:testResult is dropped, so a Test that legitimately types for 12 s reported
    // NO_RESPONSE at 10 s and swallowed the success.
    // The count is read exactly the way the two sides that EXECUTE it read it — int.TryParse in
    // the C#, the extension's own parser in the page. A local `/^\d+$/` rejected `{delay: 30000}`
    // over one space and billed it as a bare 500 ms, so this net fired at 5,5 s for a payload the
    // backend was giving 30 s, and the real answer arrived to a UI that had already given up.
    // Still the RAW text here: the authoritative number is the resolved one, and it arrives from
    // the backend as `browser:testAccepted` (below). This is the fallback.
    const charDelay = !typePaste && tdParsed != null && !isNaN(tdParsed) && tdParsed > 0 ? tdParsed : 0;
    const typeBudgetMs = actionType !== 'BrowserType' ? 0 : typeBudgetMsOf(browserText, charDelay);
    clearTestTimeout();
    testTimeoutRef.current = setTimeout(() => {
      testTimeoutRef.current = null;
      setTestRequestId(prev => {
        if (prev !== requestId) return prev;
        setTestResult({
          requestId,
          success: false,
          error: {
            code: 'NO_RESPONSE',
            message: 'No response from the browser extension.',
            tip: 'Check that Chrome and the TrueReplayer extension are still running.',
          },
        });
        return null;
      });
    }, timeoutMs + 5000 + typeBudgetMs);

    send({
      type: 'browser:testAction',
      payload: {
        requestId,
        actionType,
        key: effectiveKey,
        browserText,
        newTab,
        timeout: Math.round(timeoutMs),
        waitMode: waitMode === 'appears' ? null : waitMode,
        urlWaitPattern: urlWaitPattern || null,
        postNavigateSelector: postNavigateSelector || null,
        typeAppend,
        typePaste,
        typeDelay: tdParsed != null && !isNaN(tdParsed) ? tdParsed : null,
        // BrowserSelectOption — forward the match mode so Test Action picks the same
        // option the actual replay would. Without this, value/index modes silently fell
        // back to text on the test path.
        selectMatchMode: actionType === 'BrowserSelectOption' ? selectMatchMode : null,
        // The ranked fallbacks the replay would try. Without them the test evaluates ONE
        // candidate, so an action whose primary selector has drifted but which the replay
        // still saves via a tier-B fallback failed the test with "Element not found — try
        // Pick again", sending the user to re-pick something that works.
        alternatives: alternatives.length > 0 ? alternatives : null,
      },
    });
  }, [actionIndex, action, actionType, key, textMatch, textMode, timeout, browserText, newTab, waitMode, urlWaitPattern, postNavigateSelector, typeAppend, typePaste, typeDelay, selectMatchMode, alternatives, send, clearTestTimeout, refuseDuringRun]);

  // If-Browser-Element — "is this condition true right now?". Uses the same instant probe the
  // replay's If uses (timeout=0, single evaluation, no wait loop), against the ACTIVE tab.
  const handleTestCondition = useCallback(() => {
    const requestId = Math.random().toString(36).slice(2, 10);
    // Freeze the question being asked. Flipping Negate after a check must not silently re-label
    // a stale answer as the opposite branch.
    condNegateAskedRef.current = conditionNegate;
    const askedNegate = conditionNegate;
    setCondRequestId(requestId);
    setCondResult(null);
    const effectiveKey = textMatch.trim() ? buildTextSelector(textMode, textMatch.trim()) : key;

    clearCondTimeout();
    condTimeoutRef.current = setTimeout(() => {
      condTimeoutRef.current = null;
      setCondRequestId(prev => {
        if (prev !== requestId) return prev;
        setCondResult({ satisfied: false, raw: false, connected: false, negate: askedNegate, lost: true });
        return null;
      });
    }, 6000);

    send({
      type: 'browser:testCondition',
      payload: {
        requestId,
        key: effectiveKey,
        waitMode: waitMode || 'appears',
        browserText: browserText || null,
        conditionNegate,
        alternatives: alternatives.length > 0 ? alternatives : null,
      },
    });
  }, [key, textMatch, textMode, waitMode, browserText, conditionNegate, alternatives, send, clearCondTimeout]);

  // ActivateWindow — exists-anywhere probe: "would this action find the window right
  // now?". Same matcher semantics the replay uses (".exe" auto-append, self-excluded).
  // Local OS query, answers immediately — no safety timeout needed.
  const handleTestWindowProbe = useCallback(() => {
    const requestId = Math.random().toString(36).slice(2, 10);
    setWindowProbeRequestId(requestId);
    setWindowProbeResult(null);
    send({
      type: 'window:testProbe',
      payload: { requestId, processName: windowProcessName, windowTitle, titleMatchMode: windowTitleMatchMode },
    });
  }, [windowProcessName, windowTitle, windowTitleMatchMode, send]);

  // ActivateWindow Launch "Browse…" — opens a native file picker; the chosen full path lands in
  // launchPath via the dialog:pickFileResult subscription above.
  const handleBrowseLaunch = useCallback(() => {
    const requestId = Math.random().toString(36).slice(2, 10);
    browseLaunchReqRef.current = requestId;
    send({ type: 'dialog:pickFile', payload: { requestId, kind: 'executable' } });
  }, [send]);

  // ActivateWindow placement "Capture" — reads the matched window's CURRENT rect and seeds the
  // X/Y/W/H fields, so the user positions the window by hand once and saves it.
  const handleCaptureGeometry = useCallback(() => {
    const requestId = Math.random().toString(36).slice(2, 10);
    captureGeoReqRef.current = requestId;
    setCaptureGeoRequestId(requestId);
    setCaptureGeoError(null);
    // Capture reads BOTH pairs, so clicking it with neither applied arms both — otherwise it
    // fills four numbers that nothing uses, which reads as a no-op. Never turns one OFF: a
    // deliberate position-only setup stays position-only.
    if (!restorePosition && !restoreSize) { setRestorePosition(true); setRestoreSize(true); }
    send({
      type: 'window:captureGeometry',
      payload: { requestId, processName: windowProcessName, windowTitle, titleMatchMode: windowTitleMatchMode },
    });
  }, [windowProcessName, windowTitle, windowTitleMatchMode, restorePosition, restoreSize, send]);

  // WaitImage: capture screen now and report best confidence + matched rect against the reference
  // image. Doesn't run the replay — pure calibration helper.
  const handleTestMatch = useCallback(() => {
    if (!action || !action.imagePath) return;
    const requestId = Math.random().toString(36).slice(2, 10);
    setTestMatchRequestId(requestId);
    setTestMatchResult(null);
    const conf = Math.min(100, Math.max(10, parseInt(confidence, 10) || 80)) / 100;
    clearTestMatchTimeout();
    testMatchTimeoutRef.current = setTimeout(() => {
      testMatchTimeoutRef.current = null;
      setTestMatchRequestId(prev => {
        if (prev !== requestId) return prev;
        setTestMatchResult({ found: false, score: 0, x: 0, y: 0, w: 0, h: 0, error: 'No response from backend.' });
        return null;
      });
    }, 8000);
    send({
      type: 'image:testMatch',
      payload: {
        requestId,
        imagePath: action.imagePath,
        confidence: conf,
        searchRegion: waitImageSearchRegion ?? undefined,
      },
    });
  }, [action, confidence, waitImageSearchRegion, send, clearTestMatchTimeout]);

  // WaitImage: launch the screen overlay in region-only mode so the user can draw an ROI.
  // Result arrives via the 'waitimage:searchRegionSet' message handled above. When a region
  // is already saved, pass it along so the overlay opens with the rect pre-drawn — the user
  // can ESC to keep it as-is or drag a new one to overwrite.
  const handleConfigureSearchRegion = useCallback(() => {
    // Not a write, and worse than one: this claims InteractionScope exclusively, which sets
    // SuppressAllHotkeys — and while that is true NO hotkey matches, including the one that stops
    // the replay. A full-screen overlay over the screen the macro is driving, and no way to stop it.
    if (refuseDuringRun()) return;
    const requestId = Math.random().toString(36).slice(2, 10);
    searchRegionRequestIdRef.current = requestId;
    const r = waitImageSearchRegion;
    send({
      type: 'waitimage:configureSearchRegion',
      payload: r
        ? { requestId, x: r.x, y: r.y, w: r.w, h: r.h }
        : { requestId },
    });
  }, [send, waitImageSearchRegion, refuseDuringRun]);

  // Crop save: send the rect (image-pixel coords) to the backend, which clones the existing
  // PNG and updates action.ImagePath. The new imageBase64 arrives via the next actions:updated
  // push so the thumbnail refreshes automatically.
  const handleCropSave = useCallback((rect: { x: number; y: number; w: number; h: number }) => {
    if (actionIndex == null) return;
    // The second write door, and it was open: the backend pushes an undo state and re-points
    // ImagePath on the live row — under a run where Ctrl+Z is already refused.
    if (refuseDuringRun()) return;
    send({ type: 'waitimage:cropReference', payload: { index: actionIndex, ...rect } });
    setCropperOpen(false);
  }, [actionIndex, send, refuseDuringRun]);

  // Pick position: minimise the app, show the screen-overlay in pointPick mode, the next
  // click anywhere on screen fills X/Y. Much faster than typing or re-recording the action
  // just to nudge a coord.
  const handlePickPosition = useCallback(() => {
    const requestId = Math.random().toString(36).slice(2, 10);
    setPickPositionRequestId(requestId);
    send({ type: 'mouse:pickPosition', payload: { requestId } });
  }, [send]);

  // WaitPixelColor — eyedropper. Minimises the app, opens the screen overlay in
  // pointPick mode, fills X/Y + colour from the click in one shot. The reply lands
  // in the 'pixel:colorPicked' handler above which writes back through setters.
  const handlePickPixelColor = useCallback(() => {
    const requestId = Math.random().toString(36).slice(2, 10);
    setPickColorRequestId(requestId);
    send({ type: 'pixel:pickColor', payload: { requestId } });
  }, [send]);

  // WaitPixelColor — sanity-check the current config against the LIVE screen pixel
  // (no capture). Shows "✅ Matches" or "❌ Got #2B2B2B vs #FF5733 ± 10" inline so
  // the user can calibrate tolerance without leaving the editor. Bails early when
  // the form is incomplete — the backend would just echo a useless mismatch.
  const handleTestPixelMatch = useCallback(() => {
    const trimmedColor = pixelColor.trim();
    if (pixelX.trim() === '' || pixelY.trim() === '' || trimmedColor === '') {
      setTestPixelResult({ matches: false, error: 'Set X, Y, and the target colour first.' });
      return;
    }
    // The empty check above doesn't catch non-numeric input (e.g. "abc"): parseInt would
    // return NaN, which JSON-serialises to null and makes the backend probe a bogus pixel.
    // Parse up front and bail with an inline error so we never send NaN.
    const testX = parseInt(pixelX, 10);
    const testY = parseInt(pixelY, 10);
    if (isNaN(testX) || isNaN(testY)) {
      setTestPixelResult({ matches: false, error: 'X and Y must be numbers.' });
      return;
    }
    const requestId = Math.random().toString(36).slice(2, 10);
    setTestPixelRequestId(requestId);
    setTestPixelResult(null);
    const hex = trimmedColor.startsWith('#') ? trimmedColor : '#' + trimmedColor;
    send({
      type: 'pixel:testMatch',
      payload: {
        requestId,
        x: testX,
        y: testY,
        hex,
        tolerance: parseInt(pixelTolerance, 10) || 0,
      },
    });
  }, [pixelX, pixelY, pixelColor, pixelTolerance, send]);

  // Copy/Paste X,Y — supports the common workflow of picking a position on one click half
  // (e.g. LeftClickDown) and reusing it on the matching half (LeftClickUp) without picking
  // again. Uses the system clipboard so the value survives navigating between actions and
  // even across app restarts. Format is "x,y" (e.g. "1240,530"), matching what users would
  // naturally write down.
  const [coordCopyFlash, setCoordCopyFlash] = useState(false);
  const [coordPasteError, setCoordPasteError] = useState(false);
  // Refs hold the in-flight flash timers so we can cancel them when the panel switches
  // actions or unmounts — otherwise the setTimeout callback fires `setCoordCopyFlash(false)`
  // on a stale component and React warns about state-updates-after-unmount.
  const coordCopyFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coordPasteErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopyCoords = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(`${x},${y}`);
      setCoordCopyFlash(true);
      if (coordCopyFlashTimerRef.current) clearTimeout(coordCopyFlashTimerRef.current);
      coordCopyFlashTimerRef.current = setTimeout(() => {
        setCoordCopyFlash(false);
        coordCopyFlashTimerRef.current = null;
      }, 900);
    } catch {
      // Clipboard write can fail in some WebView2 sandbox configs — fall back silently.
    }
  }, [x, y]);
  const handlePasteCoords = useCallback(async () => {
    const showError = () => {
      setCoordPasteError(true);
      if (coordPasteErrorTimerRef.current) clearTimeout(coordPasteErrorTimerRef.current);
      coordPasteErrorTimerRef.current = setTimeout(() => {
        setCoordPasteError(false);
        coordPasteErrorTimerRef.current = null;
      }, 1200);
    };
    try {
      const text = await navigator.clipboard.readText();
      // Accept "x,y", "x, y", or whitespace-separated "x y" so users can also paste from
      // a manual note. Reject anything that doesn't yield two integers.
      const match = text.trim().match(/^(-?\d+)\s*[,\s]\s*(-?\d+)$/);
      if (!match) { showError(); return; }
      setX(match[1]);
      setY(match[2]);
    } catch {
      showError();
    }
  }, []);

  if (actionIndex == null) return null;

  const isKeyAction = actionType === 'KeyDown' || actionType === 'KeyUp';
  const isSendText = actionType === 'SendText';
  const isSetVariable = actionType === 'SetVariable';
  const isCopyToSlot = actionType === 'CopyToSlot';
  const isActivateWindow = actionType === 'ActivateWindow';
  const isWaitImage = actionType === 'WaitImage';
  const isWaitPixelColor = actionType === 'WaitPixelColor';
  const isPause = actionType === 'Pause';
  const isBrowser = actionType.startsWith('Browser');
  // Conditional logic — three structural row types. isIfImage / isIfPixel
  // discriminate which probe family the IF row uses, gating which sub-editor
  // (WaitImage's image picker vs WaitPixelColor's pixel + colour fields) renders.
  // Else/EndIf are pure structural markers — their editor is a Notes-only stub.
  const isIf = actionType === 'If';
  // ElseIf is NOT a marker stub: it carries a full condition, so it flows through every
  // hasCondition/carriesConditionProbe gate below exactly like If and While.
  const isElseIf = actionType === 'ElseIf';
  const isElse = actionType === 'Else';
  const isEndIf = actionType === 'EndIf';
  // Desktop Assert reuses the If condition editor wholesale — same ConditionType family, same
  // Negate, same wait-for-condition. So every per-condition flag below keys off "this row HAS a
  // condition", not off If specifically; only the surrounding chrome differs (Assert adds an
  // on-failure policy and hides On Probe Error — see the editor block).
  const isAssert = actionType === 'Assert';
  // The While guard is the third condition-bearing row — the whole If editor (probe
  // families, Negate, Wait-for-condition, Test buttons) comes along for free via this
  // one flag. LOCKSTEP RULE: this line and the two _hasCondition twins in the save /
  // dirty-mirror callbacks must always name the same three types.
  const isWhile = actionType === 'While';
  const hasCondition = hasConditionFields(actionType);
  const isIfImage = hasCondition && action?.conditionType === 'ImageFound';
  const isIfPixel = hasCondition && action?.conditionType === 'PixelColorMatch';
  const isIfWindow = hasCondition && action?.conditionType === 'WindowOpen';
  const isIfClipboard = hasCondition && action?.conditionType === 'ClipboardMatch';
  const isIfBrowser = carriesConditionProbe(actionType) && action?.conditionType === 'BrowserElementState';
  const isIfRandom = hasCondition && action?.conditionType === 'Random';
  const isIfVariable = hasCondition && action?.conditionType === 'Variable';
  const isIfProcess = hasCondition && action?.conditionType === 'ProcessRunning';
  const isIfFile = hasCondition && action?.conditionType === 'FileExists';
  const isIfTime = hasCondition && action?.conditionType === 'TimeWindow';
  const isConditional = isIf || isElseIf || isElse || isEndIf;
  const isBrowserType = actionType === 'BrowserType';
  const isBrowserNavigate = actionType === 'BrowserNavigate';
  const isBrowserWait = actionType === 'BrowserWaitElement';
  const isBrowserSelect = actionType === 'BrowserSelectOption';
  const isBrowserAssert = actionType === 'BrowserAssert';
  const showKey = isKeyAction || isSendText;
  const showCoords = !noCoordTypes.has(actionType);

  // Mouse clicks come in two shapes: paired halves (LeftClickDown/Up, …) and combined single
  // clicks (LeftClick, …) recorded in combined mode. The Action Type picker only offers the
  // unsuffixed names; baseActionType strips any Down/Up suffix so the picker highlights the
  // right button, and clickHalfSuffix (null for a combined click) preserves the press/release
  // half when switching between click types. The optional-suffix regex matches both shapes, so
  // isClickHalf here means "is a click row" (coords + Pick/Copy/Paste buttons apply to both).
  // Double and Triple are in the button alternation so they join the click family
  // (picker chips + coords/Pick/Copy/Paste). A "DoubleClickDown" never exists,
  // so the optional suffix simply never matches for them.
  // Hold is a THIRD suffix in this regex and deliberately NOT a third clickHalfSuffix: Down and
  // Up are fragments of one press, while Hold is a whole press that happens to last. Folding it
  // into the pair would strip the × N cluster and the Position control from a row the engine
  // honours both on.
  const clickHalfMatch = actionType.match(/^((?:Left|Right|Middle|Double|Triple)Click)(Down|Up|Hold)?$/);
  const isClickHalf = clickHalfMatch !== null;
  const clickHalfBase = clickHalfMatch ? clickHalfMatch[1] : null;
  const rawClickSuffix = clickHalfMatch?.[2] ?? null;
  const clickHalfSuffix = rawClickSuffix === 'Down' || rawClickSuffix === 'Up' ? rawClickSuffix : null;
  const isHoldClick = isClickHold(actionType);
  const baseActionType = clickHalfBase ?? actionType;

  // The one combination Save cannot honour in a single pass: a MERGE plus a change to a field the
  // merge is judged on.
  //
  // Save sends every actions:edit by index first and the form change LAST, because a split changes
  // the row COUNT and would invalidate those indices. That ordering is right, and the panel leans
  // on the backend to speak the merge's own refusals rather than restating them here — but the
  // merge is the one rule that reads the TWIN, and the twin is a row this Save never touches. So
  // the edit commits, ActionModeConverter then compares a half that changed against a half that
  // did not, refuses, and onClose runs anyway: the button rename (or the moved point) stays, and
  // the pair is left crossed — a RightClickDown whose LeftClickUp releases a button nobody
  // pressed, or a plain pair silently turned into a drag.
  //
  // Not fixed by "rewrite the twin too": halves are not necessarily adjacent. Down/Down/Up/Up is a
  // legitimate NESTED press — the interleaved case ActionModeConverter names and deliberately
  // leaves paired — and reaching for a neighbour by adjacency would corrupt it.
  //
  // So the panel states the SEQUENCING rule, which is its own rule and not a second copy of the
  // converter's: this Save is two Saves. The reserved line under Form says it and Save is blocked
  // until one of the two is backed out.
  //
  // Two refinements the first version missed:
  //
  //   • The coordinate terms compare with the converter's OWN tolerance, not for exact equality.
  //     ActionModeConverter merges halves up to CLICK_COORD_TOLERANCE_PX apart — so nudging X by
  //     one pixel blocked a Save the backend would have accepted, which is a refusal the app
  //     cannot justify when asked.
  //   • Merging keeps the DOWN half's fields — the converter clones that row — so editing the UP
  //     half and merging in the same Save discards EVERY field edit, not just the three below.
  //     Notes was the quiet one: typed on the Up half, gone after a successful-looking Save, with
  //     no refusal anywhere because the shape check passed. Same sequencing rule, stated once:
  //     when the row being edited is the half the merge does not keep, this Save is two Saves.
  const mergeCoordMoved = (typed: string, stored: number) => {
    const n = parseInt(typed, 10);
    return !isNaN(n) && Math.abs(n - stored) > CLICK_COORD_TOLERANCE_PX;
  };
  // Split so the refusal can name its real cause: a button or point change, or edits on the Up half.
  const mergeShapeChanged = action != null
    && (actionType !== action.actionType
      || mergeCoordMoved(x, action.x)
      || mergeCoordMoved(y, action.y));
  const mergeConflict = action != null
    && formDraft === 'combined' && initialForm === 'paired'
    && (mergeShapeChanged || (clickFormOf(action.actionType) === 'Up' && hasFieldEdits));

  // A single click (LeftClick/RightClick/MiddleClick), a Double/TripleClick or a *ClickHold
  // supports the inline "× N" repeat cluster. Paired halves (a Down/Up would double-fire one
  // edge) are excluded — and since COMBINED_CLICKS holds the FULL type names, asking it about
  // actionType excludes them on its own; no suffix guard needed.
  const isRepeatableClick = COMBINED_CLICKS.has(actionType);
  // Same set gates the Position control: only a whole click can resolve its own point at replay
  // time. Identical predicate on purpose — see COMBINED_CLICKS.
  const isAtCursorEligible = isRepeatableClick;
  // Double/Triple: several press/release pairs in ONE row, so the inter-repeat Gap has to clear
  // the system multi-click window (see DEFAULT_MULTICLICK_GAP_MS) — that is what the Gap guidance
  // below is about, and it applies to both equally.
  const isMultiClick = baseActionType === 'DoubleClick' || baseActionType === 'TripleClick';

  // Detect which family the current action belongs to, so the picker can offer only
  // meaningful in-family transitions (see familyTypes comment). SendText returns null —
  // it's the only "text" action so there's nothing to switch to.
  const currentFamily: ActionFamily | null = isClickHalf
    ? 'click'
    : (actionType === 'KeyDown' || actionType === 'KeyUp')
      ? 'key'
      : (actionType === 'ScrollUp' || actionType === 'ScrollDown')
        ? 'scroll'
        : null;
  // Skip rendering the picker when there's nothing useful to switch to (single-option family).
  const familyOptions = currentFamily ? familyTypes[currentFamily] : [];
  // Editing a paired half (Down/Up)? Drop Double/Triple Click AND the holds — all of them are
  // combined-only units; converting just one half would orphan its twin (a lone LeftClickUp left
  // behind by a Down that became a hold releases a button nobody pressed). Filtered HERE rather
  // than inline in the JSX because the grid's column count is decided from the visible count.
  const visibleFamilyOptions = familyOptions.filter(
    t => !(clickHalfSuffix && (t.value === 'DoubleClick' || t.value === 'TripleClick' || isClickHold(t.value)))
  );
  const showTypePicker = visibleFamilyOptions.length > 1;
  // Fixed columns for the key/scroll pairs so they split the width evenly instead of leaving a
  // hole. Fixed rather than flex-wrap is the point: with wrapping the break landed wherever the
  // label widths happened to put it, so the grouping was an accident of text measurement and
  // would reflow on any label edit. (The click family no longer renders as a grid here — see the
  // two axes below — but it still feeds this list, and the row menu's submenu still draws it.)
  const chipGridCols = visibleFamilyOptions.length >= 3 ? 'grid-cols-3' : 'grid-cols-2';

  // ── The click picker's two axes ──────────────────────────────────────────────────────────
  // Which BUTTON, and what KIND of press. Both are derived from the stored ActionType rather
  // than kept in state: the type is the single source of truth (the seed effect, an undo, a
  // convert from the row menu can all change it underneath this panel), and a mirrored pair of
  // useStates is how a picker starts disagreeing with the row it is editing.
  type ClickKind = 'click' | 'hold' | 'double' | 'triple';
  const clickKind: ClickKind = isHoldClick ? 'hold'
    : baseActionType === 'DoubleClick' ? 'double'
    : baseActionType === 'TripleClick' ? 'triple'
    : 'click';
  // Double/Triple carry no button in their name — they ARE left-button actions — so they report
  // Left, which is also what the pinned control shows.
  const clickButton = (isMultiClick ? 'Left' : (clickHalfBase?.replace('Click', '') || 'Left')) as 'Left' | 'Right' | 'Middle';
  const composeClickType = (button: 'Left' | 'Right' | 'Middle', kind: ClickKind) =>
    kind === 'double' ? 'DoubleClick'
    : kind === 'triple' ? 'TripleClick'
    : kind === 'hold' ? `${button}ClickHold`
    // A half stays a half. The suffix is what the replay switch dispatches on, so dropping it
    // turns the row into a combined click that the engine silently skips mid-gesture — the same
    // trap the old chip grid avoided by re-appending it.
    : `${button}Click${clickHalfSuffix ?? ''}`;
  const switchClickType = (next: string) => {
    if (next === actionType) return;
    // Repeat-gap default is per-type (multi-click 600 ms vs single click 30 ms). When switching
    // between types whose defaults differ, a Gap still sitting on the OLD type's default follows
    // the NEW one — untouched means "I want the default", and 30 ms between double-clicks blurs
    // them into one chain. A gap the user actually changed is preserved. See clickDefaultGap.
    const fromGap = clickDefaultGap(baseActionType);
    const toGap = clickDefaultGap(next);
    if (fromGap !== toGap) setRepeatGapMs(g => (g === fromGap ? toGap : g));
    setActionType(next);
  };

  // Human-readable action name — defined once, used as the header headline (and reusable
  // for tooltips). Replaces the inline 17-branch ternary that used to live in the header.
  // "If" vs "Assert" for the condition-family headings below — the flags they key off are
  // shared by both row types now.
  const condPrefix = isAssert ? 'Assert' : isWhile ? 'While' : isElseIf ? 'Else If' : 'If';
  const actionLabel = isWaitImage ? 'Wait Image'
    : isSetVariable ? 'Set Variable'
    : isCopyToSlot ? 'Copy to Slot'
    : isActivateWindow ? 'Activate Window'
    : isWaitPixelColor ? 'Wait Pixel Color'
    // The isIfX flags now mean "this row HAS condition X" (they cover Assert too), so the
    // prefix must come from the row's actual TYPE — otherwise an Assert row's drawer headline
    // reads "If Window Open", i.e. it names the one action it is deliberately NOT.
    : isIfImage ? `${condPrefix} Image Found`
    : isIfPixel ? `${condPrefix} Pixel Color Match`
    : isIfWindow ? `${condPrefix} Window Open`
    : isIfClipboard ? `${condPrefix} Clipboard`
    : isIfBrowser ? `${condPrefix} Browser Element`
    : isIfRandom ? `${condPrefix} Random`
    : isIfVariable ? `${condPrefix} Variable`
    : isIfProcess ? `${condPrefix} Process Running`
    : isIfFile ? `${condPrefix} File Exists`
    : isIfTime ? `${condPrefix} Time`
    : isAssert ? 'Assert'
    : isIf ? 'If'
    : isElseIf ? 'Else If'
    : isWhile ? 'While'
    : isElse ? 'Else'
    : isEndIf ? 'End If'
    : actionType === 'BrowserClick' ? 'Click Element'
    : actionType === 'BrowserRightClick' ? 'Right Click Element'
    : actionType === 'BrowserType' ? 'Type Text'
    : actionType === 'BrowserWaitElement' ? 'Wait Element'
    : actionType === 'BrowserAssert' ? 'Assert Element'
    : actionType === 'BrowserNavigate' ? 'Open URL'
    : actionType === 'BrowserSelectOption' ? 'Select Option'
    : actionType === 'DoubleClick' ? 'Double Click'
    // Backend sheet:openIndex can land on these (no insert path opens them here);
    // without a case they leaked the raw type name into the header.
    : actionType === 'HoldKey' ? 'Hold Key'
    : actionType === 'RunProfile' ? 'Run Profile'
    : actionType === 'Keystroke' ? 'Keystroke'
    : actionType === 'Stop' ? 'Stop'
    : actionType === 'Return' ? 'Return'
    : actionType === 'EndLoop' ? 'End Loop'
    : actionType === 'BreakLoop' ? 'Break Loop'
    : actionType === 'ContinueLoop' ? 'Next Iteration'
    : actionType === 'ForEachRow' ? 'For Each Data Row'
    // "Hold Left Click" — same wording as the grid's Action pill, and the "Hold" has to come
    // from the full type: clickHalfBase deliberately strips it, so the generic line below would
    // title a hold exactly like the plain click it is not.
    : isHoldClick ? `Hold ${(clickHalfBase ?? '').replace('Click', '')} Click`
    : isClickHalf ? `${(clickHalfBase ?? '').replace('Click', '')} Click`
    : actionType;

  // Header swatch family tint — the drawer's ENTIRE per-action-color budget (matches the
  // dialogs: Keystroke=key-fg, Pause=pause-fg, etc.). Render-only lookup; unknown types
  // fall back to the neutral secondary the swatch always had.
  const headerIconColor =
    actionType === 'SendText' ? 'var(--color-action-sendtext-fg)'
    : actionType === 'Pause' ? 'var(--color-action-pause-fg)'
    : (actionType === 'Keystroke' || actionType === 'KeyDown' || actionType === 'KeyUp' || actionType === 'HoldKey') ? 'var(--color-action-key-fg)'
    : (isIf || isElseIf || isElse || isEndIf) ? 'var(--color-action-if-fg)'
    : (actionType === 'Stop' || actionType === 'Return') ? 'var(--color-action-flow-fg, var(--color-action-pause-fg))'
    : (isWhile || actionType === 'EndLoop' || actionType === 'BreakLoop'
        || actionType === 'ContinueLoop' || actionType === 'ForEachRow')
      ? 'var(--color-action-loop-fg, var(--color-action-if-fg))'
    : undefined;

  // Latest save path + gate for the document-level Ctrl+S (see the listener above).
  handleSaveRef.current = handleSave;
  // The comment on the Ctrl+S branch says "same gate as the Save button", so it has to BE the same
  // gate — it was only the regex half, which let the keyboard through two refusals the button
  // states out loud.
  saveBlockedRef.current = !!regexError || runActive || mergeConflict;
  // The same three reasons the Save button's tooltip gives, in the same order, so the keyboard
  // and the button never disagree about WHY.
  saveBlockedReasonRef.current = runActive
    ? tt('Not saved — the action list is locked while a run is active.',
         'Não salvo — a lista de ações está travada enquanto um run está ativo.')
    : mergeConflict
      ? (mergeShapeChanged
        ? tt('Not saved — the merge is checked against the other half, which this Save does not touch. Save the button or point change on its own first.',
             'Não salvo — a fusão é conferida contra a outra metade, que este Save não toca. Salve a troca de botão ou de ponto sozinha primeiro.')
        : tt('Not saved — the merge keeps the Down half, so the edits on this Up half would be lost. Save them on their own first, or open the Down half to merge.',
             'Não salvo — a fusão mantém a metade Down, então as edições desta metade Up se perderiam. Salve-as sozinhas primeiro, ou abra a metade Down para fundir.'))
      : regexError
        ? tt('Not saved — fix the window-title pattern first.',
             'Não salvo — corrija o padrão do título da janela primeiro.')
        : null;

  return createPortal(
    <>
      {/* Backdrop — no click-to-close, user must Save/Cancel/arrow */}
      <div
        className="fixed inset-0 z-[60]"
        style={{
          background: 'var(--color-scrim)',
          animation: leaving ? 'fade-in var(--motion-base) var(--ease-exit) reverse forwards' : undefined,
        }}
      />

      {/* Panel — enters with slide-in-right, exits with its mirror (leaving is
          driven by App; onExited hands control back for the actual unmount). */}
      <div
        className="fixed right-0 top-0 bottom-0 w-[340px] z-[70] bg-bg-surface border-l border-border-default flex flex-col"
        style={{
          animation: leaving
            ? 'slide-out-right var(--motion-base) var(--ease-exit) forwards'
            // --motion-slow keeps the "exit is faster than entrance" relationship.
            : 'slide-in-right var(--motion-slow) var(--ease-enter)',
          boxShadow: 'var(--shadow-dialog)',
        }}
        onAnimationEnd={(e) => {
          if (leaving && e.target === e.currentTarget) onExited?.();
        }}
      >
        {/* Header */}
        {/* 52 px, one line: back · 24 px family tile · name · "Action #n". It was 64 px with a
            32 px tile and the number on a second line — 17 px taller than every other header
            in the window (the main-window bands closed at 47 px on 2026-09-04). */}
        <div className="flex items-center gap-2.5 h-[52px] px-3 border-b border-border-subtle shrink-0">
          {/* Back is the explicit one-click way out, like Cancel; while there is something to lose
              its tip says so, so the arrow never reads as a harmless "go back". */}
          <button
            onClick={discardAndClose}
            className={iconButtonClass('sm')}
            aria-label={hasUnsavedChanges ? 'Discard changes' : 'Back'}
            data-tip={hasUnsavedChanges ? tt('Discard changes', 'Descartar alterações') : undefined}
            data-tip-pos="right"
          >
            <ArrowLeft size={16} />
          </button>
          {/* Action icon — reuses the grid's canonical ActionIcon so the drawer reads the
              same as the row the user clicked (covers even the icon-less Else/EndIf). */}
          <div
            className="flex items-center justify-center w-6 h-6 rounded bg-bg-elevated text-text-secondary shrink-0"
            style={headerIconColor ? { color: headerIconColor } : undefined}
          >
            <ActionIcon actionType={actionType} size={13} />
          </div>
          <div className="min-w-0 flex items-baseline gap-2 flex-1">
            {/* Headline = the action name; the redundant "Edit Action" is dropped (the
                drawer context already makes it obvious). */}
            <div className="text-[15px] font-semibold font-display text-text-primary truncate">{actionLabel}</div>
            <span className="text-[11px] font-small text-text-tertiary shrink-0">Action #{(actionIndex ?? 0) + 1}</span>
            {clickHalfSuffix && (
              <span className="px-1.5 py-[1px] rounded text-[10px] font-medium border bg-bg-card text-text-secondary border-border-default shrink-0">
                {clickHalfSuffix === 'Down' ? '↓ press' : '↑ release'}
              </span>
            )}
          </div>
        </div>

        {/* Body. onInput/onChange/onClick here rather than on seventy setters: React events bubble,
            so one handler on the form marks the editor touched for any field the user actually
            types in, picks or toggles — which is what the automation guard needs to know, and what
            a diff against the store cannot tell it once a push has replaced that store.

            onClick is NOT redundant with the other two, and its absence was the hole. Bubbling was
            never the issue: a <button> emits neither `input` nor `change`, so those two handlers
            cannot see one at any depth — and this panel is built almost entirely out of buttons.
            Every SegmentedControl (Button, Kind, Form, Position), every DurationChips preset,
            every themed Checkbox and both NumberInput steppers render <button>. A user could flip
            a click to Hold, pick the 5 s chip and walk away with editorTouched still false, no
            claim sent to the backend, and the next autonomous fire overwriting the row field by
            field — the one loss this flag exists to prevent, and the one the comment beside
            markTouched calls "not recoverable". */}
        <div className="p-4 space-y-3 flex-1 min-h-0 overflow-y-auto"
          onInput={markTouched}
          onChange={markTouched}
          onClick={markTouchedFromClick}>
          {/* Action Type — only shown when the family has >1 meaningful option. Hidden for
              SendText (single option), WaitImage / Browser / Pause (each has its own editor
              shape). Cross-family conversions aren't offered: users who want to swap families
              record a new action — it's faster and avoids leaving half-filled fields behind. */}
          {/* CLICK rows: the type picker is TWO AXES — which button, and what kind of press.
              The eight click types were always those two questions folded into one list, and the
              folding is what made the flat grid awkward: eight chips in a three-column grid leave
              a hole in the last row, the grouping lives in the array ORDER rather than in
              anything visible, and the Insert Click dialog asks the very same two questions as
              two separate controls. Unfolding them here costs no height and makes the two
              surfaces describe a click the same way. CLICK_FAMILY_TYPES stays the one list: the
              row menu's "Change click type" submenu still renders it, and composeClickType can
              only produce names that are in it. */}
          {!isWaitImage && !isBrowser && !isPause && isClickHalf && (
          <>
            <Field label="Button">
              <SegmentedControl<'Left' | 'Right' | 'Middle'>
                value={clickButton}
                onChange={(b) => switchClickType(composeClickType(b, clickKind))}
                ariaLabel="Mouse button"
                grow
                // Pinned to Left under Double/Triple: MultiClickPairs emits LEFTDOWN/LEFTUP and
                // there is no right-button double-click to emit instead, so a lit "Right" would
                // be the UI stating something the row will not do. Same pin, same reason, as the
                // Insert Click dialog.
                disabled={isMultiClick}
                options={[
                  { value: 'Left', label: 'Left' },
                  { value: 'Right', label: 'Right' },
                  { value: 'Middle', label: 'Middle' },
                ]}
              />
            </Field>
            <Field label="Kind">
              <SegmentedControl<ClickKind>
                value={clickKind}
                onChange={(k) => switchClickType(composeClickType(clickButton, k))}
                ariaLabel="Click kind"
                grow
                // A paired half is a FRAGMENT of one press: it cannot be a hold or a multi-click,
                // and converting just one half would orphan its twin (a lone LeftClickUp left
                // behind by a Down that became a hold releases a button nobody pressed). The old
                // grid expressed this by dropping five chips; pinning says the same thing without
                // the row of controls changing shape under the user.
                // A REAL disabled, not `opacity-50 pointer-events-none`. That pair only removes
                // pointer hit-testing: the segments stayed in the tab order, and Tab-then-Enter
                // is turned by the browser into a click on the focused one — so the pin held for
                // the mouse and the keyboard walked straight through it, turning the Down half of
                // a recorded drag into a hold and orphaning the Up. Exactly the outcome the
                // paragraph above says the pin prevents.
                disabled={!!clickHalfSuffix}
                options={[
                  { value: 'click', label: 'Click' },
                  { value: 'hold', label: 'Hold', tip: tt('Press, wait, release — still one row', 'Aperta, espera, solta — ainda uma linha') },
                  { value: 'double', label: 'Double', tip: tt('Left button only', 'Só o botão esquerdo') },
                  { value: 'triple', label: 'Triple', tip: tt('Left button only — selects a paragraph', 'Só o botão esquerdo — seleciona um parágrafo') },
                ]}
              />
            </Field>

            {/* FORM — one row, or two. The two axes above change WHICH BUTTON a row uses and WHAT
                KIND of press it is, and carefully preserve its Down/Up suffix; this is the axis
                they deliberately leave alone, and until 2026-09-16 nothing but a whole-profile
                convert could move it.
                It applies on SAVE, last of everything, and the ordering is load-bearing: a split
                changes the ROW COUNT, so every actions:edit above it is addressed by an index
                this would invalidate. Save closes the sheet anyway, which is what makes "apply on
                Save" honest here rather than a draft that lies about a row that became two. */}
            <Field label="Form">
              <SegmentedControl<'combined' | 'paired'>
                value={formDraft}
                onChange={setFormDraft}
                ariaLabel="Click form"
                grow
                options={[
                  { value: 'combined', label: 'One row', tip: tt('Press and release together', 'Aperta e solta numa linha') },
                  { value: 'paired', label: 'Two rows', tip: tt('Down and Up as separate rows — needed for a drag', 'Down e Up em linhas separadas — preciso para arrastar') },
                ]}
              />
              {/* ALWAYS mounted, per FieldError's whole reason for existing — a line that appears
                  and disappears would move the controls under the user's cursor. Now it is also
                  never BLANK: the reserve is paid for either way, and a permanently empty strip
                  under every click row read as a gap in the panel rather than as a reserve. At
                  rest it states what the current form means; pending a Save it turns to warning
                  ink and states what Save will do. Visible text, so English on both tracks —
                  these two strings were carrying tt(), which belongs to tooltips and toasts.
                  The third state is the merge conflict — see mergeConflict. */}
              <FieldError
                show
                className={`text-[11px] mt-1 truncate ${mergeConflict ? 'text-recording' : formDraft !== initialForm ? 'text-warning-ink' : 'text-text-tertiary'}`}
              >
                {mergeConflict
                  ? (mergeShapeChanged
                    ? 'Save the button and point change first — the merge is checked against the other half.'
                    : 'Save the edits on this Up half first — the merge keeps the Down half.')
                  : formDraft !== initialForm
                    ? (formDraft === 'paired'
                      ? 'Saving splits this row in two.'
                      // WHICH neighbour, read off this row's own half. handleSave picks
                      // [i, i+1] from a Down and [i-1, i] from an Up, and this line used to say
                      // "the half after it" for both — so opening the Up of a pair and choosing
                      // One row named the row BELOW while the save consumed the row ABOVE. The
                      // operation then succeeded, so nothing corrected the sentence afterwards
                      // and a user with another click below it believed they had lost it.
                      : clickHalfSuffix === 'Up'
                        ? 'Saving merges this row with the half before it.'
                        : 'Saving merges this row with the half after it.')
                    : (formDraft === 'paired'
                      ? 'Two rows: Down and Up as separate rows.'
                      : 'One row: press and release together.')}
              </FieldError>
            </Field>
          </>
          )}

          {/* KEY / SCROLL rows keep the chip grid: two options, one row, nothing to unfold. */}
          {!isWaitImage && !isBrowser && !isPause && !isClickHalf && showTypePicker && (
          <Field label="Action Type">
            <div className={`grid gap-1.5 ${chipGridCols}`}>
              {visibleFamilyOptions.map(t => (
                <button
                  key={t.value}
                  onClick={() => setActionType(t.value)}
                  // Grid cells stretch, so every chip is the same width — nowrap + centre keeps
                  // a long label on one line so the row stays level.
                  className={`px-2.5 py-1 rounded text-[11px] font-medium border transition-colors text-center whitespace-nowrap ${
                    actionType === t.value
                      ? 'text-accent border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                      : 'text-text-secondary border-border-default bg-bg-elevated hover:bg-bg-card'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
          )}

          {/* CONDITION — IF rows only. Two stacked controls:
                • Found / NOT Found segmented toggle drives ConditionNegate. The labels
                  read as the user-facing branch semantic ("fire TRUE branch when found"
                  vs "fire TRUE branch when NOT found"); on disk this is just a flip of
                  the conditionNegate bool. NOT Found is the IFNOT scenario from the
                  user's example list.
                • On Probe Error dropdown drives IfOnProbeError. "Treat as false" (the
                  default) lets the FALSE branch fire on probe exception — graceful for
                  flaky screen captures. "Halt replay" rethrows so the user notices.
              Sits ABOVE the WaitImage / WaitPixelColor sub-editor so it reads as the
              top-of-mind question ("what does this IF do?") before the user dives into
              the probe configuration. */}
          {hasCondition && (
          <>

            <Field label={isAssert ? 'Require' : 'Condition'}>
              {/* 2-bucket label map (pure render): object probes read Found/NOT Found;
                  state checks (Clipboard/Variable/Random/Time) read Met/NOT Met. Same
                  conditionNegate boolean write either way. */}
              {(() => {
                const met = isIfClipboard || isIfVariable || isIfRandom || isIfTime;
                return (
                  <SegmentedControl<'found' | 'not'>
                    ariaLabel="Condition polarity"
                    grow
                    value={conditionNegate ? 'not' : 'found'}
                    onChange={(v) => setConditionNegate(v === 'not')}
                    options={[
                      { value: 'found', label: met ? 'Met' : 'Found' },
                      { value: 'not', label: met ? 'NOT Met' : 'NOT Found' },
                    ]}
                  />
                );
              })()}
            </Field>

            {/* Wait for condition sits next to the Condition toggle — the core branch
                decision and its timing modifier read as one pair; the flaky-probe fallback
                (On Probe Error) reads last as the edge case. Hidden only for Random
                (re-rolling every poll until it hits is meaningless). Time is NOT hidden
                any more: the engine polls every family whenever ConditionTimeout > 0, and
                the Wait ▾ "wait for condition" preset arms exactly that on a TimeWindow —
                hiding the field made the preset's central parameter invisible and
                uneditable for one of its six conditions. */}
            {!isIfRandom && (
            <Field
              label="Wait for condition"
              hint={'0 = check once.'}
            >
              <NumberInput
                value={parseInt(conditionTimeout, 10) || 0}
                onChange={(n) => setConditionTimeout(String(n))}
                min={0}
                step={500}
                thousands
                suffix="ms" suffixInside
                inputWidth="w-31"
                inputHeight="h-8"
                ariaLabel="Wait for condition in milliseconds"
              />
            </Field>
            )}

            {/* While only — the runaway guard. Sits right under Wait-for-condition so the
                loop's two "how long can this go on" knobs read as one pair. */}
            {isWhile && (
            <Field
              label="Max iterations"
              hint={'0 = default (1000).'}
            >
              <NumberInput
                value={parseInt(loopMaxIterations, 10) || 0}
                onChange={(n) => setLoopMaxIterations(String(n))}
                min={0}
                step={1}
                thousands
                suffix="×" suffixInside
                inputWidth="w-31"
                inputHeight="h-8"
                ariaLabel="Maximum loop iterations"
              />
            </Field>
            )}

            {/* On Probe Error is an If/While knob — never Assert's. Its "Halt" setting makes
                the probe RETHROW, which on an Assert would skip HandleAssertFailure entirely —
                no "Assert failed" framing, and On failure below silently ignored. The engine
                instead routes a broken probe through the same failure path as a false one.
                On a While, TreatAsFalse reads false and EXITS the loop (fail-safe), Halt
                stops the run — both honored, so the knob renders. */}
            {carriesConditionProbe(actionType) && (
            <Field
              label="On Probe Error"
            >
              <SegmentedControl<'TreatAsFalse' | 'Halt'>
                ariaLabel="On probe error"
                grow
                value={ifOnProbeError === 'Halt' ? 'Halt' : 'TreatAsFalse'}
                onChange={(v) => setIfOnProbeError(v)}
                options={[
                  { value: 'TreatAsFalse', label: 'Treat as false' },
                  { value: 'Halt', label: 'Halt' },
                ]}
              />
            </Field>
            )}

            {isAssert && (
            <Field
              label="On failure"
              hint={'Continue does not fail a data-loop row.'}
            >
              {/* Same tri-state BrowserAssert uses (persisted as ''|'Continue'|'StopReplay');
                  only the label reads "Abort", which is what the failure actually does. */}
              <SegmentedControl<'Halt' | 'Continue' | 'StopReplay'>
                ariaLabel="On assert failure"
                grow
                value={assertOnFail}
                onChange={setAssertOnFail}
                options={[
                  { value: 'Halt', label: 'Abort' },
                  { value: 'Continue', label: 'Continue' },
                  { value: 'StopReplay', label: 'Stop quietly' },
                ]}
              />
            </Field>
            )}

            {/* Hairline between the shared If chrome and the family-specific fields —
                the family's first Field label is header enough; no text needed. */}
            <div className="border-t border-border-subtle" />
          </>
          )}

          {/* If Window (WindowOpen) — state-based probe reusing the Window Target matching
              semantics: empty field = wildcard, at least one criterion required. */}
          {isIfWindow && (
          <>
            <WindowTargetFields
              value={{ processName: windowProcessName, windowTitle, titleMatchMode: windowTitleMatchMode }}
              onChange={(p) => {
                if (p.processName !== undefined) setWindowProcessName(p.processName);
                if (p.windowTitle !== undefined) setWindowTitle(p.windowTitle);
                if (p.titleMatchMode !== undefined) setWindowTitleMatchMode(p.titleMatchMode);
              }}
              processLabel="Process Name"
              processHint={'Empty = match by title only.'}
              titleHint={'Case-insensitive. Fill at least one.'}
            />
            <Checkbox
              checked={windowMatchForegroundOnly}
              onChange={setWindowMatchForegroundOnly}
              label="Foreground window only"
              title={tt('Must be in front, not just open.', 'Precisa estar em primeiro plano, não só aberta.')}
            />
            {/* Exists-anywhere Test — reuses the ActivateWindow probe (window:testProbe) verbatim;
                the two editors are mutually exclusive so they share the same probe state. */}
            <div>
              <button
                onClick={handleTestWindowProbe}
                data-probe
                disabled={windowProbeRequestId !== null || (!windowProcessName.trim() && !windowTitle.trim())}
                className="w-full h-8 flex items-center justify-center gap-1.5 px-2.5 rounded text-xs font-medium border border-accent-solid/40 bg-accent-solid/10 hover:bg-accent-solid/20 text-accent-light transition-colors disabled:opacity-60"
              >
                <PlayCircle size={13} />
                {windowProbeRequestId ? 'Testing…' : 'Test'}
              </button>
              {windowProbeResult && (
                <div
                  className={`mt-1.5 ${RESULT_CARD}`}
                  style={resultCardStyle(windowProbeResult.found)}
                >
                  <div className="flex items-center gap-1.5">
                    {windowProbeResult.found ? <Check size={11} /> : <X size={11} />}
                    <span className="font-medium">
                      {windowProbeResult.found
                        ? `Found — ${[windowProbeResult.matchProcess, windowProbeResult.matchTitle].filter(Boolean).join(' · ')}`
                        : (windowProbeResult.error || 'Not found')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </>
          )}

          {/* If Clipboard (ClipboardMatch) — branches on the clipboard's current TEXT. */}
          {isIfClipboard && (
          <>
            <Field label="Match Type">
              <SegmentedControl<'contains' | 'equals' | 'regex'>
                ariaLabel="Clipboard match type"
                grow
                value={clipboardPatternType}
                onChange={setClipboardPatternType}
                options={[
                  { value: 'contains', label: 'Contains' },
                  { value: 'equals', label: 'Equals' },
                  { value: 'regex', label: 'Regex' },
                ]}
              />
            </Field>
            <Field
              label="Pattern"
              hint={'Text only, case-insensitive.'}
            >
              <input
                type="text"
                value={clipboardPattern}
                onChange={(e) => setClipboardPattern(e.target.value)}
                spellCheck={false}
                className="input-field"
              />
            </Field>
          </>
          )}

          {/* If Random — probabilistic branch. TRUE with probability percent/100. */}
          {isIfRandom && (
            <Field
              label="Chance"
              className="w-31"
            >
              <NumberInput
                value={parseInt(randomPercent, 10) || 0}
                onChange={(n) => setRandomPercent(String(Math.max(0, Math.min(100, n))))}
                min={0}
                max={100}
                suffix="%" suffixInside
                inputWidth="w-full"
                inputHeight="h-8"
                className="w-full"
                ariaLabel="Random chance percent"
              />
            </Field>
          )}

          {/* If Variable — compares the runtime variable (name) against the operand. */}
          {isIfVariable && (
          <>
            <Field
              label="Variable Name"
            >
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="name"
                spellCheck={false}
                className="input-field"
              />
            </Field>
            <Field label="Operator">
              <SegmentedControl<'eq' | 'neq' | 'contains' | 'gt' | 'lt'>
                ariaLabel="Comparison operator"
                grow
                value={conditionOperator}
                onChange={setConditionOperator}
                options={[
                  { value: 'eq', label: '=', tip: tt('Text match, case-insensitive', 'Texto, sem diferenciar maiúsculas') },
                  { value: 'neq', label: '≠' },
                  { value: 'contains', label: 'has', tip: tt('Contains', 'Contém') },
                  { value: 'gt', label: '>', tip: tt('Numeric when both are numbers', 'Numérico quando ambos são números') },
                  { value: 'lt', label: '<', tip: tt('Numeric when both are numbers', 'Numérico quando ambos são números') },
                ]}
              />
            </Field>
            <Field
              label="Value"
              hint={'Tokens resolve here. Test reads them as empty.'}
            >
              <input
                type="text"
                value={conditionOperand}
                onChange={(e) => setConditionOperand(e.target.value)}
                spellCheck={false}
                className="input-field"
              />
            </Field>
          </>
          )}

          {/* If Process running — matches a process by image name, window or not. */}
          {isIfProcess && (
            <Field
              label="Process Name"
              hint={'Matches even without a window.'}
            >
              <ProcessNameInput value={windowProcessName} onChange={setWindowProcessName} />
            </Field>
          )}

          {/* If File exists — TRUE when the resolved path exists (file or folder). */}
          {isIfFile && (
            <Field
              label="Path"
              hint={'File or folder. Tokens resolve at run time.'}
            >
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="C:\\flags\\go.txt"
                spellCheck={false}
                className="input-field"
              />
            </Field>
          )}

          {/* If Time / day-of-week — TRUE inside the time window AND on a selected day. */}
          {isIfTime && (
          <>
            <div className="flex gap-2.5">
              <Field label="From" className="flex-1">
                <input
                  type="time"
                  value={timeStart}
                  onChange={(e) => setTimeStart(e.target.value)}
                  className="input-field"
                />
              </Field>
              <Field label="To" className="flex-1" hint={'Overnight OK (e.g. 22:00–02:00)'}>
                <input
                  type="time"
                  value={timeEnd}
                  onChange={(e) => setTimeEnd(e.target.value)}
                  className="input-field"
                />
              </Field>
            </div>
            <Field label="Days" hint={'None = every day.'}>
              {/* Independent toggle chips, NOT a segmented track — multi-select must not
                  look like an exclusive choice. Same XOR bitmask write as before. */}
              <div className="flex gap-1">
                {(['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const).map((lbl, bit) => {
                  const on = (daysOfWeek & (1 << bit)) !== 0;
                  return (
                    <button
                      key={bit}
                      type="button"
                      onClick={() => setDaysOfWeek(daysOfWeek ^ (1 << bit))}
                      className={`w-7 h-6 rounded text-[10px] font-medium border transition-colors ${
                        on
                          ? 'text-accent border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                          : 'text-text-tertiary border-border-subtle bg-bg-card hover:text-text-secondary'
                      }`}
                      data-tip={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][bit]}
                    >
                      {lbl}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
          )}

          {/* If Browser Element (BrowserElementState) — one instant state check against the
              live page via the extension's waitElement evaluator (timeout=0). Reuses
              BrowserWaitElement's probe fields: key = selector, waitMode, browserText =
              text pattern. A disconnected extension reads as "not found", never a halt. */}
          {isIfBrowser && (
          <>
            <Field
              label="CSS Selector"
              labelAdornment={selectorForTier ? (
                // Same tier shield as the browser six-pack — pure display (the tier memo
                // is computed unconditionally from the same key/textMatch/textMode state).
                <span
                  style={{ color: tierMeta.color, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  data-tip={tt(`${tier} · ${tierMeta.label}`, `${tier} · ${tierMeta.labelPtBr}`)}
                >
                  <tierMeta.Icon size={12} />
                  <span className="text-[10px] font-semibold normal-case">{tier}</span>
                </span>
              ) : undefined}
              hint={'Extension offline = reads as not found.'}
            >
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={textMatch.trim() ? buildTextSelector(textMode, textMatch.trim()) : key}
                  onChange={(e) => { setKey(e.target.value); setTextMatch(''); invalidatePickedAlternatives(); }}
                  placeholder=".btn-save"
                  spellCheck={false}
                  className="input-field flex-1"
                />
                <button
                  onClick={() => {
                    const requestId = Math.random().toString(36).slice(2, 10);
                    setPickElementRequestId(requestId);
                    setIsPicking(true);
                    setShowAlternatives(false);
                    send({ type: 'browser:pickElement', payload: { requestId } });
                  }}
                  disabled={isPicking}
                  className={`h-8 w-8 flex items-center justify-center rounded border transition-colors ${
                    isPicking
                      ? 'bg-accent-solid/20 border-accent-solid text-accent-light'
                      : 'bg-bg-input border-border-default text-text-tertiary hover:text-text-primary hover:border-text-tertiary'
                  }`}
                >
                  <Crosshair size={14} />
                </button>
              </div>
              {/* The ranked fallbacks. handleSave already PERSISTS these for the If (the
                  isBrowserSelectorAction guard includes If + BrowserElementState), so the list was
                  being written to disk on an editor that never rendered it — pick here, and the
                  alternatives silently vanished from view while still driving the replay. */}
              {showAlternatives && alternatives.length > 0 && (
                <div className="mt-1.5 rounded border border-border-default bg-bg-elevated p-1.5 space-y-1">
                  <div className="flex items-center justify-between px-1">
                    <span className="label-micro text-text-tertiary">Alternatives</span>
                    <button
                      onClick={() => setShowAlternatives(false)}
                      className="flex items-center text-text-tertiary hover:text-text-primary"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  {alternatives.map((alt, i) => {
                    const m = TIER_META[alt.tier] || TIER_META.C;
                    return (
                      <button
                        key={i}
                        onClick={() => { setKey(alt.selector); setTextMatch(''); setShowAlternatives(false); }}
                        className="w-full text-left px-2 py-1 rounded text-[11px] hover:bg-bg-card transition-colors flex items-center gap-1.5"
                        data-tip={alt.description}
                      >
                        <span style={{ color: m.color, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <m.Icon size={10} />
                          <span className="text-[10px] font-bold">{alt.tier}</span>
                        </span>
                        <span className="font-mono text-text-secondary truncate">{alt.selector}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>
            <Field label="State">
              <select
                value={waitMode}
                onChange={(e) => setWaitMode(e.target.value)}
                className="input-field font-sans"
              >
                <option value="appears">Visible</option>
                <option value="disappears">Not present / hidden</option>
                <option value="enabled">Enabled</option>
                <option value="text-match">Text matches</option>
              </select>
            </Field>
            {waitMode === 'text-match' && (
              <Field
                label="Text Pattern"
                hint={'Plain text = exact. Or text*=  text~=  text/regex/'}
              >
                <input
                  type="text"
                  value={browserText}
                  onChange={(e) => setBrowserText(e.target.value)}
                  spellCheck={false}
                  className="input-field"
                />
              </Field>
            )}

            {/* "Check now". Reports a BRANCH, not success/failure — a condition that reads false
                is working correctly, and calling that an error is what would send the user off to
                re-pick a selector that was fine. Runs the same instant probe the replay's If runs,
                against the active tab. */}
            <div>
              <button
                onClick={handleTestCondition}
                disabled={condRequestId !== null}
                className="w-full h-8 flex items-center justify-center gap-1.5 px-2.5 rounded text-xs font-medium border border-accent-solid/40 bg-accent-solid/10 hover:bg-accent-solid/20 text-accent-light transition-colors disabled:opacity-60"
              >
                <PlayCircle size={13} />
                {condRequestId ? 'Checking…' : 'Check now'}
              </button>
              {condResult && (
                <div
                  className={`mt-1.5 ${RESULT_CARD}`}
                  style={resultCardStyle(condResult.connected && condResult.satisfied)}
                >
                  <div className="flex items-center gap-1.5">
                    {condResult.connected ? (condResult.satisfied ? <Check size={11} /> : <X size={11} />) : <X size={11} />}
                    <span className="font-medium">
                      {condResult.lost
                        ? 'No response from the browser extension'
                        : !condResult.connected
                        ? 'Extension not connected'
                        : condResult.satisfied ? 'Condition is TRUE now' : 'Condition is FALSE now'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-text-tertiary">
                    {condResult.lost
                      ? 'Timed out. Is Chrome and the extension running?'
                      : !condResult.connected
                      ? 'Could not reach the page — reads as NOT found.'
                      : condResult.negate
                        ? `Element state: ${condResult.raw ? 'matched' : 'not matched'} · inverted by "Negate"`
                        : 'The replay would take this branch right now.'}
                  </div>
                </div>
              )}
            </div>
          </>
          )}

          {/* Else / EndIf are pure block markers with nothing to configure — the
              orientation note rides the quiet left-rail card in the If family's teal
              so the otherwise-empty panel reads as intentional, not broken. */}
          {(isElse || isEndIf) && (
            <div
              className="border-l-2 rounded px-2.5 py-2 text-[11px] leading-relaxed"
              style={calloutStyle('neutral', 'var(--color-action-if-fg)', 'var(--color-text-secondary)')}
            >
              {isElse
                ? 'The FALSE branch. Set the condition on the If row.'
                : 'Closes the block. Set the condition on the If row.'}
            </div>
          )}

          {/* Loop markers — the Else/EndIf stub mold in the loop tint (If fallback). Pure
              jumps: no delay (the validator zeroes it), nothing to configure here. */}
          {(actionType === 'EndLoop' || actionType === 'BreakLoop'
            || actionType === 'ContinueLoop' || actionType === 'ForEachRow') && (
            <div
              className="border-l-2 rounded px-2.5 py-2 text-[11px] leading-relaxed"
              style={calloutStyle('neutral', 'var(--color-action-loop-fg, var(--color-action-if-fg))', 'var(--color-text-secondary)')}
            >
              {actionType === 'EndLoop'
                ? 'Closes the block. Set the loop on its opening row.'
                : actionType === 'BreakLoop'
                ? 'Exits the innermost loop.'
                : actionType === 'ContinueLoop'
                ? 'Jumps back to the innermost loop’s opening row.'
                : 'Runs its block once per row of the active data table. {row:column} reads the current row.'}
            </div>
          )}

          {/* Stop / Return — flow leaves in the Else/EndIf stub mold, tinted with the flow
              family (pause fallback) instead of the If teal. Delay + Notes still apply. */}
          {(actionType === 'Stop' || actionType === 'Return') && (
            <div
              className="border-l-2 rounded px-2.5 py-2 text-[11px] leading-relaxed"
              style={calloutStyle('neutral', 'var(--color-action-flow-fg, var(--color-action-pause-fg))', 'var(--color-text-secondary)')}
            >
              {actionType === 'Stop'
                ? 'Ends the whole run here, with no error.'
                : 'Ends this pass only — remaining passes and data rows still run.'}
            </div>
          )}

          {/* WaitImage Settings — also rendered for IF rows whose ConditionType is
              ImageFound (isIfImage). The probe internals (reference image, search
              region, confidence) are shared; the time-axis fields (Timeout, OnTimeout,
              Wait-for-disappear, Click-on-match) only apply to the polling WaitImage
              action and are gated below with !hasConditionFields.

              hasConditionFields, NOT carriesConditionProbe: the two differ by exactly one row
              type — Assert — and Assert is condition-bearing, so the engine ignores every one of
              those four fields on it just as it does on an If. Gating on carriesConditionProbe
              rendered them for an Assert/ImageFound row, i.e. four controls with no effect. That
              row can only be reached by hand-editing a profile today (HandleActionsInsertAssert
              deliberately refuses Image/Pixel), which is precisely why the gate was worth fixing
              while it is still latent rather than after someone hits it. */}
          {(isWaitImage || isIfImage) && (
          <>
            {/* Thumbnail + Recapture + Test match — thumbnail is clickable to open the cropper
                for fine-tuning the reference (no need to revisit the screen state). */}
            <Field label="Reference Image">
              <button
                type="button"
                onClick={() => action?.imageBase64 && setCropperOpen(true)}
                disabled={!action?.imageBase64}
                className="w-full rounded border border-border-default bg-bg-elevated overflow-hidden block hover:border-accent-solid/60 transition-colors disabled:cursor-default disabled:hover:border-border-default"
              >
                {action?.imageBase64 ? (
                  <img
                    src={`data:image/png;base64,${action.imageBase64}`}
                    alt="Reference"
                    className="w-full max-h-[140px] object-contain bg-bg-input"
                  />
                ) : (
                  <div className="flex items-center justify-center h-[80px] text-xs text-text-disabled">
                    No image captured
                  </div>
                )}
              </button>
              {/* Recapture + Test match share the row below the thumbnail — both act
                  on the captured reference (one regenerates it, the other validates
                  it against the live screen) so they're sibling operations on the
                  same artefact. */}
              <div className="mt-2 flex gap-2.5">
                <button
                  onClick={() => {
                    // Don't close the panel — backend handles minimise/overlay/save
                    // asynchronously and pushes actions:updated when done. The effect
                    // that re-seeds local state on `action` change will pick up the
                    // new imageBase64 / imagePath automatically, so the thumbnail
                    // updates in place. Matches Wait Pixel's "Pick from screen"
                    // behaviour where the editor stays open through the capture.
                    // Same exclusive overlay as Configure search region: it minimises the window
                    // and kills the stop hotkey for as long as it is up. Never during a run.
                    if (refuseDuringRun()) return;
                    send({ type: 'waitimage:recapture', payload: { index: actionIndex } });
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 h-8 px-2.5 rounded text-xs font-medium border border-border-default bg-bg-elevated hover:bg-bg-card text-text-secondary hover:text-text-primary transition-colors"
                >
                  <RefreshCw size={12} />
                  Recapture
                </button>
                <button
                  onClick={handleTestMatch}
                  data-probe
                  disabled={!action?.imagePath || testMatchRequestId != null}
                  className="flex-1 flex items-center justify-center gap-1.5 h-8 px-2.5 rounded text-xs font-medium border border-accent-solid/40 bg-accent-solid/10 hover:bg-accent-solid/20 text-accent-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <PlayCircle size={13} />
                  {testMatchRequestId != null ? 'Testing…' : 'Test match'}
                </button>
              </div>
              {/* Test match result — icon headline + mono only on the value spans (the
                  browser Test card dialect). Success also auto-sets the Search Region
                  (see handler above); the note confirms that side-effect. */}
              {testMatchResult && !testMatchRequestId && (
                <div
                  className={`mt-2 ${RESULT_CARD}`}
                  style={resultCardStyle(!!testMatchResult.found && !testMatchResult.error)}
                >
                  {testMatchResult.error ? (
                    <div className="flex items-center gap-1.5 font-medium">
                      <X size={11} className="shrink-0" />
                      <span>{testMatchResult.error}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 font-medium">
                        {testMatchResult.found ? <Check size={11} className="shrink-0" /> : <X size={11} className="shrink-0" />}
                        <span>
                          Best match{' '}
                          <span className="font-mono">{Math.round(testMatchResult.score * 100)}% at ({testMatchResult.x}, {testMatchResult.y})</span>
                          {testMatchResult.found ? '' : ' — below tolerance'}
                        </span>
                      </div>
                      {testMatchResult.found && (
                        <div className="mt-1 text-[10px] opacity-80">
                          {'Search region set around this match.'}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </Field>

            {/* Search Region (ROI) — placed right under the Test result so the auto-set
                feedback sits next to the field it just modified.

                No region is the EXPENSIVE default, and it used to be drawn like an absence:
                "Full screen" in disabled italic, the visual language of "nothing here", with
                the only reason to care parked in the Configure button's hover tooltip — a
                gesture nobody makes on a button they have no reason to touch. Measured, a
                full-screen tick costs ~440 ms against a 500 ms poll (a 400x300 region: ~4 ms),
                so the cadence the user configured silently doubles and a 30 s wait pegs a core
                while it is supposed to be idling.

                So the empty state states the cost instead of hiding it, on two channels (ink
                AND icon, never colour alone), and the reason moved out of the hover into the
                Field's own hint line — the same mechanism Tolerance uses right below. Both go
                quiet the moment a region exists: this is a nudge toward a better setup, not a
                scold to live with. */}
            <Field
              label="Search Region"
              hint={waitImageSearchRegion
                ? undefined
                // False positives lead: a wrong match somewhere else on the desktop makes the
                // macro CLICK in the wrong place, which is damage the user sees. Slowness is
                // the second argument, not the first.
                : 'Whole screen can match the wrong thing — ~440 ms per check instead of ~4 ms.'}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex-1 h-8 px-2 flex items-center text-[11px] font-mono bg-bg-input border border-border-default rounded text-text-secondary">
                  {waitImageSearchRegion
                    ? `${waitImageSearchRegion.x}, ${waitImageSearchRegion.y}  ·  ${waitImageSearchRegion.w} × ${waitImageSearchRegion.h}`
                    : (
                      <span className="flex items-center gap-1.5" style={{ color: 'var(--color-warning-ink)' }}>
                        <Maximize size={11} className="shrink-0" />
                        Full screen
                      </span>
                    )}
                </div>
                <button
                  onClick={handleConfigureSearchRegion}
                  className="h-8 px-2.5 flex items-center gap-1.5 rounded text-xs font-medium border border-border-default bg-bg-elevated hover:bg-bg-card text-text-secondary hover:text-text-primary transition-colors"
                  data-tip={tt('Faster, fewer false positives.', 'Mais rápido, menos falsos positivos.')}
                >
                  <Frame size={12} />
                  Configure
                </button>
                {waitImageSearchRegion && (
                  <button
                    onClick={() => setWaitImageSearchRegion(null)}
                    className="h-8 px-2 flex items-center rounded text-xs text-text-tertiary hover:text-[var(--color-recording-fg)] hover:bg-bg-card transition-colors"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </Field>

            {/* TOLERANCE — own row with helper text. Mirrors Pixel's tolerance section
                (which also sits before the time-axis fields) so the two probe editors
                read in parallel: "what to look for → search region → how forgiving →
                wait behavior → test it". */}
            <Field
              label="Tolerance (%)"
              hint={'Higher = stricter.'}
            >
              <Slider
                value={parseInt(confidence, 10) || 80}
                min={10}
                max={100}
                step={5}
                onChange={(n) => setConfidence(String(n))}
                suffix="%"
              />
            </Field>

            {/* WAIT UNTIL — WaitImage only. IF rows route "wait for absence" via the
                CONDITION section's Found / NOT Found toggle. */}
            {!hasConditionFields(actionType) && (
            <Field label="Wait Until">
              <SegmentedControl<'appears' | 'disappears'>
                ariaLabel="Wait until"
                grow
                value={waitImageInvert ? 'disappears' : 'appears'}
                onChange={(v) => setWaitImageInvert(v === 'disappears')}
                options={[
                  { value: 'appears', label: 'Appears' },
                  { value: 'disappears', label: 'Disappears' },
                ]}
              />
            </Field>
            )}

            {/* TIMEOUT + ON TIMEOUT — WaitImage only. Side-by-side row identical in
                shape to the Pixel editor's matching block. Edited in milliseconds
                (min 1000 — the backend clamps non-Pause timeouts to ≥1s anyway), step
                1000 so the +/- spinner moves a second at a time. */}
            {!hasConditionFields(actionType) && (
            <div className="flex gap-2.5">
              <Field label="Timeout" className="w-31 shrink-0">
                <NumberInput
                  value={(() => { const n = parseFloat(timeout); return Number.isFinite(n) && n > 0 ? n : 5000; })()}
                  onChange={(n) => setTimeout_(String(n))}
                  min={1000}
                  step={1000}
                  thousands
                  suffix="ms" suffixInside
                  inputWidth="w-full"
                  inputHeight="h-8"
                  className="w-full"
                  ariaLabel="Timeout in milliseconds"
                />
              </Field>
              <Field label="On Timeout" className="flex-1">
                <SegmentedControl<'StopReplay' | 'Continue'>
                  ariaLabel="On timeout"
                  grow
                  value={waitImageOnTimeout === 'Continue' ? 'Continue' : 'StopReplay'}
                  onChange={(v) => setWaitImageOnTimeout(v)}
                  options={[
                    { value: 'StopReplay', label: 'Halt' },
                    { value: 'Continue', label: 'Continue' },
                  ]}
                />
              </Field>
            </div>
            )}

            {/* After Match — bare Checkbox (no Field wrapper; the label carries the
                meaning). Suppressed on IF rows (the user routes click via a regular
                LeftClick in the TRUE branch) and when waiting for disappearance (no
                found-location to click on). */}
            {!hasConditionFields(actionType) && !waitImageInvert && (
              <Checkbox
                checked={waitImageClickOnMatch}
                onChange={setWaitImageClickOnMatch}
                label="Click on found location"
              />
            )}

          </>
          )}

          {/* WaitPixelColor Settings — also rendered for IF rows whose ConditionType is
              PixelColorMatch (isIfPixel). The probe primitives (pixel coords, target
              colour, tolerance) are shared verbatim with WaitPixelColor; the polling-
              specific knobs (Timeout, OnTimeout, Invert, ClickOnMatch) are gated with
              !isIf below — IF rows do an instant single-shot probe with no timeout. */}
          {(isWaitPixelColor || isIfPixel) && (
          <>
            {/* Coords + Pick + Test match — the canonical sibling X/Y row (Click-editor
                parity; the old "Pixel to Watch" wrapper double-labelled the block). Pick
                captures the coords/colour, Test validates them, so they pair below. */}
            <div>
              <div className="flex gap-2.5">
                <Field label="X" className="flex-1">
                  <NumberInput
                    value={pixelX === '' ? null : (Number.isFinite(parseInt(pixelX, 10)) ? parseInt(pixelX, 10) : null)}
                    onChange={(n) => setPixelX(String(n))}
                    onClear={() => setPixelX('')}
                    placeholder="—"
                    inputWidth="w-full"
                    inputHeight="h-8"
                    ariaLabel="Pixel X"
                  />
                </Field>
                <Field label="Y" className="flex-1">
                  <NumberInput
                    value={pixelY === '' ? null : (Number.isFinite(parseInt(pixelY, 10)) ? parseInt(pixelY, 10) : null)}
                    onChange={(n) => setPixelY(String(n))}
                    onClear={() => setPixelY('')}
                    placeholder="—"
                    inputWidth="w-full"
                    inputHeight="h-8"
                    ariaLabel="Pixel Y"
                  />
                </Field>
              </div>
              {/* Test match + Pick share one row — Test validates the current pixel, Pick
                  (re)captures X/Y + colour. Both h-8, flex-1, so neither clips or wraps. */}
              {/* Pair order = config → validate: Pick captures the coords/colour, Test
                  validates them against the live screen. Test carries the accent (the
                  one validate-against-world rank). */}
              <div className="mt-2 flex gap-2.5">
                <button
                  type="button"
                  onClick={handlePickPixelColor}
                  disabled={pickColorRequestId != null}
                  className="flex-1 h-8 flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium border border-border-default bg-bg-elevated hover:bg-bg-card text-text-secondary hover:text-text-primary rounded whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Pipette size={13} />
                  {pickColorRequestId != null ? 'Picking…' : 'Pick'}
                </button>
                <button
                  type="button"
                  onClick={handleTestPixelMatch}
                  className="flex-1 h-8 flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium border border-accent-solid/40 bg-accent-solid/10 hover:bg-accent-solid/20 text-accent-light rounded whitespace-nowrap transition-colors"
                >
                  <PlayCircle size={13} />
                  Test match
                </button>
              </div>
              {testPixelResult && (
                <div
                  className={`mt-2 ${RESULT_CARD}`}
                  style={resultCardStyle(!!testPixelResult.matches && !testPixelResult.error)}
                >
                  <div className="flex items-center gap-1.5 font-medium">
                    {(!!testPixelResult.matches && !testPixelResult.error)
                      ? <Check size={11} className="shrink-0" />
                      : <X size={11} className="shrink-0" />}
                    <span>
                      {testPixelResult.error ? (
                        testPixelResult.error
                      ) : (
                        <>
                          Sampled <span className="font-mono">{testPixelResult.sampledHex ?? 'no read'}</span>
                          {' · '}Target <span className="font-mono">{pixelColor} ± {pixelTolerance}</span>
                          {testPixelResult.matches ? '' : ' — out of tolerance'}
                        </>
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* TARGET COLOUR — swatch + hex input. The eyedropper above writes both, but
                the user can also type or paste a hex code directly. Normalisation
                (uppercase + leading #) happens on Save, not on every keystroke, so the
                input stays predictable while editing. */}
            <Field label="Target Colour">
              <div className="flex items-center gap-2.5">
                {(() => {
                  // Six digits only — PixelColorService.ParseHex rejects three-digit shorthand, so
                  // a swatch that renders #F00 as red is confirming a value the backend will read
                  // as "no colour set". Here the failure at least surfaces as a Wait timeout in the
                  // run report; in the automation panel the same lie was silent.
                  const validHex = /^#?[0-9A-Fa-f]{6}$/.test(pixelColor.trim());
                  return (
                    <span
                      className={`w-8 h-8 rounded border shrink-0 ${validHex ? 'border-border-default' : 'border-dashed border-border-default'}`}
                      style={{ background: validHex ? (pixelColor.trim().startsWith('#') ? pixelColor.trim() : '#' + pixelColor.trim()) : 'transparent' }}
                    />
                  );
                })()}
                <input
                  type="text"
                  value={pixelColor}
                  onChange={(e) => setPixelColor(e.target.value)}
                  placeholder="#RRGGBB"
                  className="flex-1 h-8 px-2 text-ui font-mono text-text-primary bg-bg-input border border-border-default rounded outline-none focus:border-accent-solid"
                />
              </div>
            </Field>

            {/* TOLERANCE — per-channel band. Slider + numeric input so users can either
                drag for feel or type an exact value. Range capped at 50 (out of 255)
                because anything higher starts matching unrelated colours; expert users
                who really want > 50 can still type it. */}
            <Field
              label="Tolerance (Per Channel)"
              hint={'5–15 for compressed colours.'}
            >
              <Slider
                value={parseInt(pixelTolerance, 10) || 0}
                min={0}
                max={50}
                inputMax={255}
                onChange={(n) => setPixelTolerance(String(n))}
              />
            </Field>

            {/* WAIT UNTIL — WaitPixelColor only. Same shape (own row, dropdown) and
                same label as the WaitImage editor above. IF rows express the same
                concept via the CONDITION section's Found / NOT Found toggle. */}
            {!hasConditionFields(actionType) && (
            <Field label="Wait Until">
              <SegmentedControl<'matches' | 'stopsMatching'>
                ariaLabel="Wait until"
                grow
                value={pixelInvert ? 'stopsMatching' : 'matches'}
                onChange={(v) => setPixelInvert(v === 'stopsMatching')}
                options={[
                  { value: 'matches', label: 'Matches' },
                  { value: 'stopsMatching', label: 'Stops matching' },
                ]}
              />
            </Field>
            )}

            {/* TIMEOUT + ON TIMEOUT — WaitPixelColor only. Side-by-side row identical
                in shape to the WaitImage editor above. Edited in milliseconds (min 1000,
                step 1000) — same unit as every other action duration. */}
            {!hasConditionFields(actionType) && (
            <div className="flex gap-2.5">
              <Field label="Timeout" className="w-31 shrink-0">
                <NumberInput
                  value={(() => { const n = parseFloat(timeout); return Number.isFinite(n) && n > 0 ? n : 5000; })()}
                  onChange={(n) => setTimeout_(String(n))}
                  min={1000}
                  step={1000}
                  thousands
                  suffix="ms" suffixInside
                  inputWidth="w-full"
                  inputHeight="h-8"
                  className="w-full"
                  ariaLabel="Timeout in milliseconds"
                />
              </Field>
              <Field label="On Timeout" className="flex-1">
                <SegmentedControl<'StopReplay' | 'Continue'>
                  ariaLabel="On timeout"
                  grow
                  value={pixelOnTimeout === 'Continue' ? 'Continue' : 'StopReplay'}
                  onChange={(v) => setPixelOnTimeout(v)}
                  options={[
                    { value: 'StopReplay', label: 'Halt' },
                    { value: 'Continue', label: 'Continue' },
                  ]}
                />
              </Field>
            </div>
            )}

            {/* After Match — bare Checkbox (no Field wrapper). IF rows route click via
                a regular LeftClick in the TRUE branch. */}
            {!hasConditionFields(actionType) && !pixelInvert && (
              <Checkbox
                checked={pixelClickOnMatch}
                onChange={setPixelClickOnMatch}
                label="Click on found location"
              />
            )}

          </>
          )}

          {/* Pause Settings */}
          {isPause && (
          <>
            <Field label="Resume Hotkey">
              {/* Same capture pattern as the KeyDown/KeyUp Key field (and the grid / Settings
                  hotkeys): focus → empty + "New key..." + accent pulse; Esc is a regular
                  captured key (users CAN bind Pause-resume to Escape); cancel is click-away
                  or the 4 s idle timer. Reuses keyFieldRef + the shared arm/disarm helpers —
                  the Pause input and the KeyDown/KeyUp input are gated on different action
                  types so they're never rendered simultaneously. */}
              <input
                ref={keyFieldRef}
                type="text"
                readOnly
                value={pauseHotkeyFocused ? '' : (key || '')}
                placeholder="Click to capture…"
                // Arm on click or Enter/Space, never bare focus — keyboard
                // navigation must not flip the low-level hook into capture mode
                // (a Tab-through would swallow the next keypress as the hotkey).
                onClick={() => {
                  if (pauseHotkeyFocused) return;
                  setPauseHotkeyFocused(true);
                  armKeyCaptureTimer();
                  send({ type: 'hotkey:capture', payload: { enabled: true, ownerId: captureOwnerIdRef.current } });
                }}
                onKeyDown={(e) => {
                  if (pauseHotkeyFocused || (e.key !== 'Enter' && e.key !== ' ')) return;
                  e.preventDefault();
                  setPauseHotkeyFocused(true);
                  armKeyCaptureTimer();
                  send({ type: 'hotkey:capture', payload: { enabled: true, ownerId: captureOwnerIdRef.current } });
                }}
                onBlur={() => {
                  setPauseHotkeyFocused(false);
                  disarmKeyCaptureTimer();
                  send({ type: 'hotkey:capture', payload: { enabled: false, ownerId: captureOwnerIdRef.current } });
                }}
                className={`w-full h-8 px-2 text-ui font-mono bg-bg-input border rounded outline-none cursor-pointer placeholder:text-accent-light/50 ${
                  pauseHotkeyFocused
                    ? 'text-accent-light border-accent-solid animate-pulse'
                    : 'text-text-primary border-border-default'
                }`}
              />
            </Field>
            <Field label="Timeout">
              <NumberInput
                value={parseInt(timeout, 10) || 0}
                onChange={(n) => setTimeout_(String(n))}
                min={0}
                step={1000}
                thousands
                suffix="ms" suffixInside
                inputWidth="w-full"
                inputHeight="h-8"
                ariaLabel="Timeout in milliseconds"
              />
              {/* Quick presets — the shared DurationChips recipe (Send Keystroke / Insert
                  Pause dialog parity). ∞ (0 ms) = no timeout, resume by hotkey only.
                  String-backed state preserved: onSelect writes String(ms). */}
              <div className="mt-1.5">
                <DurationChips
                  presets={TIMEOUT_PRESETS}
                  value={(() => { const p = parseFloat(timeout); return isNaN(p) ? 0 : p; })()}
                  onSelect={(ms) => setTimeout_(String(ms))}
                  infinityTip={tt('Wait forever for the resume hotkey', 'Espera para sempre pela tecla de retomada')}
                />
              </div>
              {/* Foot-gun line — with neither a resume hotkey nor a timeout the Pause is silently
                  skipped at replay (ExecutePause early-returns). It used to be a left-rail callout
                  that MOUNTED on that state, so clearing the hotkey pushed Delay and Notes 46 px
                  down the panel, under the cursor that had just cleared it. A reserved line says
                  the same sentence in the same warning ink and never moves anything — the rule
                  the Form line two fields up already follows.
                  `parseFloat(…) > 0` is false for NaN, which is what an empty field parses to. */}
              <FieldError
                show={!key.trim() && !(parseFloat(timeout) > 0)}
                className="text-[11px] text-warning-ink mt-1.5 truncate"
              >
                {'No hotkey and no timeout — this Pause is skipped.'}
              </FieldError>
            </Field>
          </>
          )}

          {/* Browser Action Settings */}
          {isBrowser && (
          <>
            {/* Selector / URL */}
            <div>
              <label className="label-micro text-text-tertiary mb-1.5 flex items-center gap-1.5">
                {isBrowserNavigate ? 'URL' : 'CSS Selector'}
                {/* #2 — Tier shield indicator (only for non-Navigate selectors) */}
                {!isBrowserNavigate && selectorForTier && (
                  <span
                    style={{ color: tierMeta.color, display: 'inline-flex', alignItems: 'center', gap: 3 }}
                    data-tip={tt(`${tier} · ${tierMeta.label}`, `${tier} · ${tierMeta.labelPtBr}`)}
                  >
                    <tierMeta.Icon size={12} />
                    <span className="text-[10px] font-semibold normal-case">{tier}</span>
                  </span>
                )}
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={key}
                  onChange={(e) => { setKey(e.target.value); invalidatePickedAlternatives(); }}
                  className="input-field flex-1"
                  placeholder={isBrowserNavigate ? 'https://example.com' : '.btn-save'}
                />
                {!isBrowserNavigate && (
                  <button
                    onClick={() => {
                      const requestId = Math.random().toString(36).slice(2, 10);
                      setPickElementRequestId(requestId);
                      setIsPicking(true);
                      setShowAlternatives(false);
                      send({ type: 'browser:pickElement', payload: { requestId } });
                    }}
                    disabled={isPicking}
                    className={`h-8 w-8 flex items-center justify-center rounded border transition-colors ${
                      isPicking
                        ? 'bg-accent-solid/20 border-accent-solid text-accent-light'
                        : 'bg-bg-input border-border-default text-text-tertiary hover:text-text-primary hover:border-text-tertiary'
                    }`}
                  >
                    <Crosshair size={14} />
                  </button>
                )}
              </div>

              {/* #2 — Alternatives popover (after pick) */}
              {showAlternatives && alternatives.length > 0 && (
                <div className="mt-1.5 rounded border border-border-default bg-bg-elevated p-1.5 space-y-1">
                  <div className="flex items-center justify-between px-1">
                    <span className="label-micro text-text-tertiary">Alternatives</span>
                    <button
                      onClick={() => setShowAlternatives(false)}
                      className="flex items-center text-text-tertiary hover:text-text-primary"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  {alternatives.map((alt, i) => {
                    const m = TIER_META[alt.tier] || TIER_META.C;
                    return (
                      <button
                        key={i}
                        onClick={() => { setKey(alt.selector); setTextMatch(''); setShowAlternatives(false); }}
                        className="w-full text-left px-2 py-1 rounded text-[11px] hover:bg-bg-card transition-colors flex items-center gap-1.5"
                        data-tip={alt.description}
                      >
                        <span style={{ color: m.color, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <m.Icon size={10} />
                          <span className="text-[10px] font-bold">{alt.tier}</span>
                        </span>
                        <span className="font-mono text-text-secondary truncate">{alt.selector}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* #1 — Text Match — alternative to CSS selector for Click/RightClick/Wait.
                Hidden for BrowserType, BrowserNavigate, and BrowserSelectOption (which uses
                its own "OPTION" field below for the value to match inside the <select>). */}
            {!isBrowserNavigate && !isBrowserType && !isBrowserSelect && (
            <div>
              <label
                className="label-micro text-text-tertiary mb-1.5 block"
                data-tip={tt('Takes priority over CSS selector when filled', 'Tem prioridade sobre o seletor CSS quando preenchido')}
              >
                Text Match
              </label>
              <div className="flex gap-1.5">
                <select
                  value={textMode}
                  onChange={(e) => setTextMode(e.target.value as TextMode)}
                  className="h-8 px-1.5 text-[11px] bg-bg-input border border-border-default rounded text-text-secondary outline-none focus:border-accent-solid"
                >
                  {TEXT_MODES.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={textMatch}
                  // Same invalidation as the CSS field above: a non-empty Text Match BECOMES the
                  // effective selector (handleSave: textMatch wins over key), so the picked
                  // element's fallbacks would ride along behind a primary generated for nothing
                  // like them.
                  onChange={(e) => { setTextMatch(e.target.value); invalidatePickedAlternatives(); }}
                  className="input-field flex-1"
                  placeholder={textMode === 'regex' ? 'e.g. ^Sign in$' : 'e.g. Sign in'}
                />
              </div>
              {/* Reserved slot — same per-keystroke flicker as the window-target title field. */}
              <FieldError
                show={!!regexError}
                className="text-[10px] mt-1 font-mono"
                style={{ color: 'var(--color-recording-fg)' }}
                tip={regexError ? `Invalid regex: ${regexError}` : undefined}
              >
                Invalid regex: {regexError}
              </FieldError>
            </div>
            )}

            {/* New Tab — only for BrowserNavigate */}
            {isBrowserNavigate && (
              <Checkbox
                checked={newTab}
                onChange={setNewTab}
                label="Open in new tab"
              />
            )}

            {/* #7 — Navigate post-checks, grouped under one section header. "Ready
                Element" (was "Wait Element") kills the name collision with the
                Wait Element ACTION type. */}
            {isBrowserNavigate && (
            <>
              <Section title="After Navigation" />
              <Field label="URL Pattern" hint={'Glob (*) or /regex/.'}>
                <input
                  type="text"
                  value={urlWaitPattern}
                  onChange={(e) => setUrlWaitPattern(e.target.value)}
                  className="input-field"
                  placeholder="*/dashboard*"
                />
              </Field>
              <Field label="Ready Element">
                <input
                  type="text"
                  value={postNavigateSelector}
                  onChange={(e) => setPostNavigateSelector(e.target.value)}
                  className="input-field"
                  placeholder="#app-ready"
                />
              </Field>
            </>
            )}

            {/* Text — only for BrowserType. Uses the same Lexical-based editor as the
                SendText dialog so tokens (`{Enter}`, `{Clipboard}`, etc.) render as
                inline chips directly inside the input — no separate preview row needed.
                Chip buttons below insert at the cursor via the imperative handle.
                tokenScope="browser" names the engine behind the field (the Chrome extension
                presses the keys); since extension 1.4.18 its key grammar is Send Text's, so the
                same tokens chip here. The hint says what the field cannot show: that the
                extension presses them, and that repeat and pause work. */}
            {isBrowserType && (
            <Field
              label="Text to Type"
              hint={'The extension presses the key tokens like Send Text does: {enter}, {tab:2}, {space}, {home}, {delay:500}…'}
            >
              <div className="min-h-8 bg-bg-input border border-border-default rounded focus-within:border-accent-solid text-ui font-mono">
                <Suspense fallback={null}>
                  <LexicalTokenEditor
                    density="sheet"
                    /* Key by actionIndex so opening a different action re-initialises the
                       editor with that action's text. Without this the Lexical state
                       would persist across action switches and the displayed content
                       wouldn't match the action's browserText.
                       The id + payload are in the key for the same reason the SendText surface
                       above carries them: this panel stays open across actions:updated pushes,
                       so an EXTERNAL change to THIS row (an undo while the sheet is open)
                       re-seeds the browserText state without remounting the editor, and
                       InitialContentPlugin's didInit guard means the editor would keep drawing
                       the pre-undo text. action.browserText is the DISK value, so it does not
                       change while the user types and this does not remount per keystroke. */
                    key={`bt:${actionIndex ?? -1}:${seedNonce}`}
                    initialText={browserText}
                    onChange={setBrowserText}
                    apiRef={browserTextEditorRef}
                    tokenAutocomplete
                    tokenScope="browser"
                  />
                </Suspense>
              </div>
              {/* Chip palette. Three chips, all visible — the "⋯" expander that used to hide
                  fourteen more was removed because none of them were ever reached: any token
                  can still be typed, and the full palette lives in the Insert Text editor. */}
              <div className="flex flex-wrap gap-1 mt-2">
                {[
                  { var: '{Clipboard}', label: 'Clipboard' },
                  { var: '{Enter}', label: 'Enter' },
                  { var: '{DateTime}', label: 'DateTime' },
                ].map(item => (
                  <button
                    key={item.var}
                    type="button"
                    onClick={() => browserTextEditorRef.current?.insertText(item.var)}
                    className="h-6 px-2 inline-flex items-center text-[11px] font-mono bg-bg-surface border border-border-default rounded text-text-secondary hover:text-accent hover:border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </Field>
            )}

            {/* #5 — Type options, grouped under one section header. */}
            {isBrowserType && (
            <div className="space-y-1.5">
              <Section title="Typing" />
              <Checkbox
                checked={typeAppend}
                onChange={setTypeAppend}
                label="Keep existing text"
              />
              <Checkbox
                checked={typePaste}
                onChange={setTypePaste}
                label="Paste"
                title={tt('Instant, not key by key', 'Instantâneo, não tecla a tecla')}
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-secondary">Char delay</label>
                <NumberInput
                  // typeDelay '' = no pause between characters. The engine used to pick a
                  // default from the text length; since 2.37.0 content.js reads a blank field
                  // as 0 and keeps one event per character, so "auto" would name a behaviour
                  // that no longer exists. Pass null so the placeholder shows; onClear puts
                  // the field back to blank.
                  value={typeDelay === '' ? null : (Number.isFinite(parseInt(typeDelay, 10)) ? parseInt(typeDelay, 10) : null)}
                  onChange={(n) => setTypeDelay(String(n))}
                  onClear={() => setTypeDelay('')}
                  min={0}
                  disabled={typePaste}
                  placeholder="none"
                  thousands
                  suffix="ms" suffixInside
                  inputWidth="w-16"
                  inputHeight="h-8"
                  ariaLabel="Char delay (ms)"
                />
              </div>
            </div>
            )}

            {/* Select Option — for BrowserSelectOption only. The OPTION field reuses the
                shared `browserText` state (saved as action.BrowserText on disk); the MATCH BY
                dropdown picks how the extension interprets that value when looking for an
                option inside the <select>. */}
            {isBrowserSelect && (
            <>
              {/* Match By FIRST (choose how, then type what — the mode-aware Option
                  placeholder below then teaches the expected format). */}
              <Field
                label="Match By"
                hint={'Native <select> only.'}
              >
                <SegmentedControl<'text' | 'value' | 'index'>
                  ariaLabel="Option match mode"
                  grow
                  value={selectMatchMode}
                  onChange={setSelectMatchMode}
                  options={[
                    { value: 'text', label: 'Text', tip: tt('The visible label', 'O rótulo visível') },
                    { value: 'value', label: 'Value', tip: tt('The value attribute', 'O atributo value') },
                    { value: 'index', label: 'Index', tip: tt('0-based position', 'Posição (base 0)') },
                  ]}
                />
              </Field>
              <Field label="Option">
                <input
                  type="text"
                  value={browserText}
                  onChange={(e) => setBrowserText(e.target.value)}
                  className="input-field"
                  placeholder={selectMatchMode === 'index' ? '0' : selectMatchMode === 'value' ? 'option-value' : 'Option label'}
                />
              </Field>
            </>
            )}

            {/* #6 — WaitElement / Assert state mode (shared) */}
            {(isBrowserWait || isBrowserAssert) && (
            <Field label={isBrowserAssert ? 'Assert Condition' : 'Wait Condition'}>
              <select
                value={waitMode}
                onChange={(e) => setWaitMode(e.target.value)}
                className="input-field font-sans"
              >
                <option value="appears">{isBrowserAssert ? 'Is present' : 'Appears'}</option>
                <option value="disappears">{isBrowserAssert ? 'Is NOT present' : 'Disappears'}</option>
                <option value="enabled">{isBrowserAssert ? 'Is enabled' : 'Enabled'}</option>
                <option value="text-match">Text matches</option>
              </select>
              {/* Foot-gun warning: text-match mode needs an actual Text Match string.
                  Without it, the effective selector falls back to the raw CSS key
                  (handleSave / handleTestAction both call buildTextSelector only when
                  textMatch is non-empty) — extension then receives waitMode='text-match'
                  on a plain selector and the action times out silently. */}
              {waitMode === 'text-match' && !textMatch.trim() && (
                <div
                  className="mt-1.5 flex items-start gap-2 border-l-2 rounded px-2.5 py-2 text-[11px] leading-relaxed"
                  style={calloutStyle('warn')}
                >
                  <ShieldAlert size={13} className="shrink-0 mt-px" />
                  <span>{'Text Pattern is empty — this Wait will time out.'}</span>
                </div>
              )}
            </Field>
            )}

            {/* BrowserAssert — what to do when the condition isn't met within the timeout.
                Halt stops the replay LOUDLY (the point of an assertion); Continue logs and
                moves on. "Wait Condition" above uses "Is NOT present" instead of a Negate. */}
            {isBrowserAssert && (
            <Field label="On Fail">
              <SegmentedControl<'Halt' | 'Continue' | 'StopReplay'>
                ariaLabel="On assertion fail"
                grow
                value={assertOnFail}
                onChange={setAssertOnFail}
                options={[
                  { value: 'Halt', label: 'Halt' },
                  { value: 'Continue', label: 'Continue' },
                  { value: 'StopReplay', label: 'Stop quietly' },
                ]}
              />
            </Field>
            )}

            {/* Test action, then the timing pair (Timeout + Delay) directly below it, so the
                cluster reads Test action -> Timeout -> Delay. */}
            <div>
              <button
                onClick={handleTestAction}
                disabled={testRequestId !== null}
                className="w-full h-8 flex items-center justify-center gap-1.5 px-2.5 rounded text-xs font-medium border border-accent-solid/40 bg-accent-solid/10 hover:bg-accent-solid/20 text-accent-light transition-colors disabled:opacity-60"
              >
                <PlayCircle size={13} />
                {testRequestId ? 'Running…' : 'Test action'}
              </button>
              {testResult && (
                <div
                  className={`mt-1.5 ${RESULT_CARD}`}
                  style={resultCardStyle(testResult.success)}
                >
                  <div className="flex items-center gap-1.5">
                    {testResult.success ? <Check size={11} /> : <X size={11} />}
                    <span className="font-medium">
                      {testResult.success
                        ? `Success in ${testResult.durationMs}ms`
                        : (testResult.error?.code || 'Failed')}
                    </span>
                  </div>
                  {!testResult.success && testResult.error && (
                    <>
                      <div className="mt-0.5 text-text-secondary">{testResult.error.message}</div>
                      {testResult.error.tip && (
                        <div className="mt-0.5 text-text-tertiary italic">{testResult.error.tip}</div>
                      )}
                    </>
                  )}
                  {/* A PASS that only passed because a fallback caught it is not the same as a
                      pass, and looked identical until now. Say which tier saved it and offer the
                      one-click fix, while the action still works — the day the fallback drifts
                      too there is nothing left to fall back to. */}
                  {testResult.success && testResult.matchedVia && (
                    <div className="mt-1 pt-1 border-t border-border-subtle">
                      <div className="flex items-center gap-1.5 text-text-secondary">
                        {(() => {
                          // The tier crosses the bridge as a plain string; fall back to C rather
                          // than trusting it to be one of the four.
                          const m = TIER_META[testResult.matchedVia.tier as keyof typeof TIER_META] || TIER_META.C;
                          return (
                            <span style={{ color: m.color, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                              <m.Icon size={10} />
                              <span className="text-[10px] font-bold">{testResult.matchedVia.tier}</span>
                            </span>
                          );
                        })()}
                        <span>{'Primary selector failed — matched via fallback'}</span>
                      </div>
                      <button
                        onClick={() => { setKey(testResult.matchedVia!.selector); setTextMatch(''); }}
                        className="mt-0.5 w-full text-left font-mono truncate text-text-tertiary hover:text-text-primary transition-colors"
                        data-tip={tt('Use as primary', 'Usar como primário')}
                      >
                        {testResult.matchedVia.selector}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Timeout + Delay — ONE row (both w-31). Cluster order Test → Timeout →
                Delay preserved (2.7.5). The engine reads action.Timeout for all six command
                types; Delay is the browser-local copy of the shared field (same delay/
                setDelay state, so handleSave persistence is unchanged; the shared trailing
                Delay is suppressed for isBrowser to avoid a duplicate). */}
            <div className="flex gap-2.5">
              <Field label="Timeout" className="w-31 shrink-0">
                <NumberInput
                  value={parseInt(timeout, 10) || 5000}
                  onChange={(n) => setTimeout_(String(n))}
                  min={1000}
                  step={1000}
                  thousands
                  suffix="ms" suffixInside
                  inputWidth="w-full"
                  inputHeight="h-8"
                  className="w-full"
                  ariaLabel="Timeout in milliseconds"
                />
              </Field>
              <Field label="Delay" className="w-31 shrink-0">
                <NumberInput
                  value={parseInt(delay, 10) || 0}
                  onChange={(n) => setDelay(String(n))}
                  min={0}
                  thousands
                  suffix="ms" suffixInside
                  inputWidth="w-full"
                  inputHeight="h-8"
                  className="w-full"
                  ariaLabel="Delay in milliseconds"
                />
              </Field>
            </div>
          </>
          )}

          {/* Key — only for KeyDown/KeyUp and SendText. For KeyDown/KeyUp the input is
              read-only and consumes keydown events to capture the key directly; the visible
              value goes through getDisplayKey() so it matches the grid's display rules
              (e.g. raw `D3` shows as `3`, raw `162` shows as `Ctrl`).

              A SendText row does NOT reach here through any OPEN path — ActionTable's
              openEditorForRow sends it to the Insert Text dialog, the type picker has no text
              family, and no sheet:openIndex site in WebViewBridge.cs inserts a SendText. It
              reaches here only when the row at actionIndex TURNS INTO a SendText under an
              already-open panel: the [action] seed effect above re-runs on every
              actions:updated push, and undo/redo, Ctrl+V and Alt+arrow are window-level
              keydown listeners the backdrop does not stop. Narrow, but live — and the bridge
              nulls KeyHtml for exactly the save this branch performs. Not dead code. */}
          {showKey && (
          <Field label={isSendText ? 'Text' : 'Key'}>
            {isKeyAction ? (
              // Capture-mode visual matches the grid's Key column edit, the SettingsPanel
              // global hotkey inputs, and the ProfilePanel Assign Hotkey dialog. While
              // focused: empty value + "New key..." placeholder + accent border + animate-
              // pulse, so it's unmistakeable that the next key press lands here. On blur,
              // restores the human-readable value (via getDisplayKey).
              <input
                ref={keyFieldRef}
                type="text"
                readOnly
                value={keyFieldFocused ? '' : getDisplayKey(key)}
                onFocus={() => { setKeyFieldFocused(true); armKeyCaptureTimer(); }}
                onBlur={() => { setKeyFieldFocused(false); disarmKeyCaptureTimer(); }}
                onKeyDown={handleKeyCapture}
                placeholder="Click to capture…"
                className={`w-full h-8 px-2 text-ui font-mono bg-bg-input border rounded outline-none cursor-pointer placeholder:text-accent-light/50 ${
                  keyFieldFocused
                    ? 'text-accent-light border-accent-solid animate-pulse'
                    : 'text-text-primary border-border-default'
                }`}
              />
            ) : (
              // SendText payload. Same Lexical editor the BrowserType field mounts below, so the
              // app's two text surfaces stop diverging: tokens ({Clipboard}, {Enter}, …) render
              // as inline chips instead of raw braces. Plain mode ONLY (no richMode): this edit
              // persists through actions:edit field 'key', which the bridge treats as a
              // plain-text edit and which nulls KeyHtml — so the warning below stays true.
              <>
                <div className="min-h-[3.25rem] bg-bg-input border border-border-default rounded focus-within:border-accent-solid text-ui font-mono">
                  <Suspense fallback={null}>
                    <LexicalTokenEditor
                      /* Remount key. actionIndex alone is NOT enough here: this panel stays open
                         across actions:updated pushes and re-seeds from the row (see the [action]
                         effect above), which is the only way a SendText row reaches this branch
                         at all. InitialContentPlugin reads initialText ONCE behind a didInit
                         guard, so without id + payload in the key the editor would keep drawing
                         the previous row's text while `key` state had already moved on.
                         action.key is the DISK value — it does not change while the user types,
                         so this does not remount per keystroke. */
                      key={`st:${actionIndex ?? -1}:${seedNonce}`}
                      initialText={key}
                      onChange={setKey}
                      apiRef={sendTextEditorRef}
                      density="sheet"
                      tokenAutocomplete
                    />
                  </Suspense>
                </div>
                {/* Chip palette — same three tokens and the same recipe as the BrowserType
                    palette below. The full palette stays in the Insert Text dialog; any other
                    token can still be typed and chips on the fly. */}
                <div className="flex flex-wrap gap-1 mt-2">
                  {[
                    { var: '{Clipboard}', label: 'Clipboard' },
                    { var: '{Enter}', label: 'Enter' },
                    { var: '{DateTime}', label: 'DateTime' },
                  ].map(item => (
                    <button
                      key={item.var}
                      type="button"
                      onClick={() => sendTextEditorRef.current?.insertText(item.var)}
                      className="h-6 px-2 inline-flex items-center text-[11px] font-mono bg-bg-surface border border-border-default rounded text-text-secondary hover:text-accent hover:border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] transition-colors"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                {action?.keyHtml && (
                  // Rich payload warning — unchanged and still correct: this surface edits only
                  // the PLAIN flavor, and a saved key change drops the formatting (the bridge
                  // nulls KeyHtml). Kept a plain hint, NOT common/FieldError: this is not a
                  // validation line, and action.keyHtml cannot flip while the panel is open
                  // without the remount key above firing anyway, so it cannot cause a jump.
                  <div className="mt-1 text-[10px] text-warning-ink leading-snug">
                    {'Saving here drops the formatting.'}
                  </div>
                )}
              </>
            )}
          </Field>
          )}

          {/* Set Variable — name + value pair written into the replay run's variable store.
              Labels stay English per the locked i18n rule; guidance lives in the hints. */}
          {isSetVariable && (
            <>
              <Field
                label="Variable Name"
                hint={'Read it back with {var:name}.'}
              >
                <input
                  type="text"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="name"
                  spellCheck={false}
                  className="input-field"
                />
              </Field>
              <Field label="Mode">
                <SegmentedControl<'set' | 'cycle' | 'add'>
                  ariaLabel="Variable mode"
                  grow
                  value={variableMode}
                  onChange={setVariableMode}
                  options={[
                    { value: 'set', label: 'Set' },
                    { value: 'cycle', label: 'Cycle' },
                    { value: 'add', label: 'Add' },
                  ]}
                />
              </Field>
              <Field
                label={variableMode === 'cycle' ? 'List (one item per line)' : variableMode === 'add' ? 'Amount' : 'Value'}
                hint={variableMode === 'cycle'
                  ? 'One line per run, then back to the first.'
                  : variableMode === 'add'
                    ? 'Added to the current value (unset counts as 0). Negative subtracts.'
                    : 'Tokens resolve here. Empty deletes the variable.'}
              >
                <textarea
                  rows={variableMode === 'cycle' ? 4 : 2}
                  value={variableValue}
                  onChange={(e) => setVariableValue(e.target.value)}
                  placeholder={variableMode === 'cycle' ? 'item 1\nitem 2\nitem 3' : variableMode === 'add' ? '1' : undefined}
                  spellCheck={false}
                  className="w-full min-h-[3.25rem] px-2 py-1.5 text-ui font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid resize-y"
                />
              </Field>
            </>
          )}

          {/* Copy to Slot — captures the focused app's current selection (synthetic Ctrl+C)
              into a named clipboard slot; only field is the slot name (saved via the generic
              key block). The card explains the read-back token — the panel is tiny otherwise. */}
          {isCopyToSlot && (
            <>
              <Field label="Mode">
                <SegmentedControl<'capture' | 'clear'>
                  ariaLabel="Slot mode"
                  grow
                  value={slotMode}
                  onChange={setSlotMode}
                  options={[
                    { value: 'capture', label: 'Capture' },
                    { value: 'clear', label: 'Clear' },
                  ]}
                />
              </Field>
              <Field
                label="Slot"
                hint={slotMode === 'clear'
                  ? 'Blank clears all slots.'
                  : 'Read it back with {clip:slot}.'}
              >
                <input
                  type="text"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={slotMode === 'clear' ? 'all slots' : '1'}
                  spellCheck={false}
                  className="input-field"
                />
              </Field>
            </>
          )}

          {/* Activate Window — find → launch-if-missing → wait → focus. The matcher block
              mirrors the If-Window editor (same shared window* state); then LAUNCH, then
              the Test → Timeout → policy timing cluster (browser-editor convention). */}
          {isActivateWindow && (
          <>
            {/* Verb — what to do with the matched window. Maximize focuses then maximizes;
                Minimize / Close act on the existing window (no launch, no focus). */}
            <Field
              label="Action"
            >
              <SegmentedControl<'Activate' | 'Maximize' | 'Minimize' | 'Close'>
                ariaLabel="Window action"
                grow
                value={windowVerb}
                onChange={setWindowVerb}
                options={[
                  { value: 'Activate', label: 'Activate' },
                  { value: 'Maximize', label: 'Maximize' },
                  { value: 'Minimize', label: 'Minimize' },
                  { value: 'Close', label: 'Close' },
                ]}
              />
            </Field>
            {/* Section header — the matcher trio reads as one "which window" block. */}
            <Section title="Match Window" />
            <WindowTargetFields
              value={{ processName: windowProcessName, windowTitle, titleMatchMode: windowTitleMatchMode }}
              onChange={(p) => {
                if (p.processName !== undefined) setWindowProcessName(p.processName);
                if (p.windowTitle !== undefined) setWindowTitle(p.windowTitle);
                if (p.titleMatchMode !== undefined) setWindowTitleMatchMode(p.titleMatchMode);
              }}
              processHint={'Empty = match by title only.'}
              titleHint={'Case-insensitive.'}
            />
            {/* nth-match — pick the Nth matching window (1-based, Z-order front→back). */}
            {/* The hint names the launch interaction above 1 because it is genuinely surprising:
                "no window matched" means "fewer than N matched", so the Launch path below fires
                whenever there are fewer than N — not only when there are none. Left as behaviour
                (an app that opens a new window per invocation really does reach N that way) and
                stated here instead. */}
            <Field
              label="Match #"
              hint={parseInt(matchIndex, 10) > 1
                ? 'Counted front→back. Above 1, Launch fires when FEWER than this many match.'
                : '1 = frontmost.'}
            >
              <NumberInput
                value={parseInt(matchIndex, 10) || 1}
                onChange={(n) => setMatchIndex(String(Math.max(1, n)))}
                min={1}
                inputWidth="w-20" inputHeight="h-8"
              />
            </Field>
            {/* Section header — the optional launch pair (Activate/Maximize only). */}
            {(windowVerb === 'Activate' || windowVerb === 'Maximize') && (
            <>
            <Section title="Launch" />
            <Field
              label="Path"
              hint={'Opened only when no window matches.'}
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={launchPath}
                  onChange={(e) => setLaunchPath(e.target.value)}
                  placeholder="notepad.exe · https://… · C:\path\app.exe"
                  spellCheck={false}
                  className="flex-1 min-w-0 h-8 px-2 text-ui font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid"
                />
                <button
                  type="button"
                  onClick={handleBrowseLaunch}
                  className="shrink-0 h-8 px-2.5 flex items-center gap-1 rounded text-xs border border-border-default bg-bg-input hover:bg-bg-elevated text-text-secondary transition-colors"
                >
                  <FolderOpen size={13} />
                  Browse…
                </button>
              </div>
            </Field>
            <Field label="Args">
              <input
                type="text"
                value={launchArgs}
                onChange={(e) => setLaunchArgs(e.target.value)}
                disabled={!launchPath.trim()}
                spellCheck={false}
                className="w-full h-8 px-2 text-ui font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid disabled:opacity-50"
              />
            </Field>
            </>
            )}

            {/* Placement — ONE block, nothing to expand. It used to be two toggle chips that
                each revealed their own pair of fields and a capture button that only appeared
                once one of them was on: three clicks in three places to reach four numbers that
                are always read and written together. Now both rows are always on screen, the
                checkbox says what gets applied, and the capture that fills all four sits at the
                top of the block where it belongs.
                Activate verb only — Maximize is its own placement; Minimize/Close don't place. */}
            {windowVerb === 'Activate' && (
            <div className="rounded border border-border-subtle bg-bg-card px-2.5 py-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="label-micro text-text-tertiary">Placement</span>
                <button
                  type="button"
                  onClick={handleCaptureGeometry}
                  disabled={captureGeoRequestId !== null || (!windowProcessName.trim() && !windowTitle.trim())}
                  className="shrink-0 h-6 px-2 flex items-center gap-1.5 rounded text-[11px] font-medium border border-border-default bg-bg-input hover:bg-bg-elevated text-text-secondary transition-colors disabled:opacity-60"
                >
                  <Frame size={12} />
                  {captureGeoRequestId ? 'Reading…' : 'Read from window'}
                </button>
              </div>

              {/* Two groups, identical shape: the checkbox is the group's heading and says what
                  gets applied; its pair of inputs sits on the line below. The inputs stay MOUNTED
                  and go disabled with the checkbox — values survive a toggle and nothing reflows.
                  Two lines per group rather than one: at 340 px the panel cannot fit a word-label
                  column and two steppers on the same row without squeezing a 4-digit coordinate
                  into ~40 px. */}
              <div className="space-y-1.5">
                <Checkbox checked={restorePosition} onChange={setRestorePosition} label="Position" />
                <div className="flex items-center gap-2">
                  <AxisInput axis="X" value={windowX} onChange={setWindowX} disabled={!restorePosition} />
                  <AxisInput axis="Y" value={windowY} onChange={setWindowY} disabled={!restorePosition} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Checkbox checked={restoreSize} onChange={setRestoreSize} label="Size" />
                <div className="flex items-center gap-2">
                  <AxisInput axis="W" value={windowWidth} onChange={setWindowWidth} disabled={!restoreSize} min={0} />
                  <AxisInput axis="H" value={windowHeight} onChange={setWindowHeight} disabled={!restoreSize} min={0} />
                </div>
              </div>

              {captureGeoError && (
                <div className={RESULT_CARD} style={resultCardStyle(false)}>
                  <div className="flex items-center gap-1.5">
                    <X size={11} />
                    <span>{captureGeoError}</span>
                  </div>
                </div>
              )}
            </div>
            )}

            {/* Test (exists-anywhere probe) + result card, then Timeout + On Timeout. */}
            <div>
              <button
                onClick={handleTestWindowProbe}
                data-probe
                disabled={windowProbeRequestId !== null || (!windowProcessName.trim() && !windowTitle.trim())}
                className="w-full h-8 flex items-center justify-center gap-1.5 px-2.5 rounded text-xs font-medium border border-accent-solid/40 bg-accent-solid/10 hover:bg-accent-solid/20 text-accent-light transition-colors disabled:opacity-60"
              >
                <PlayCircle size={13} />
                {windowProbeRequestId ? 'Testing…' : 'Test'}
              </button>
              {windowProbeResult && (
                <div
                  className={`mt-1.5 ${RESULT_CARD}`}
                  style={resultCardStyle(windowProbeResult.found)}
                >
                  <div className="flex items-center gap-1.5">
                    {windowProbeResult.found ? <Check size={11} /> : <X size={11} />}
                    <span className="font-medium">
                      {windowProbeResult.found
                        ? `Found — ${[windowProbeResult.matchProcess, windowProbeResult.matchTitle].filter(Boolean).join(' · ')}`
                        : (windowProbeResult.error || 'Not found')}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Timeout + failure policy apply to the find/wait — Activate/Maximize only.
                Minimize/Close act on the existing window with no wait. */}
            {(windowVerb === 'Activate' || windowVerb === 'Maximize') && (
            <div className="flex gap-2.5">
              <Field label="Timeout" className="w-31">
                <NumberInput
                  value={parseInt(timeout, 10) || 10000}
                  onChange={(n) => setTimeout_(String(n))}
                  min={1000}
                  step={1000}
                  thousands
                  suffix="ms" suffixInside
                  inputWidth="w-full"
                  inputHeight="h-8"
                  className="w-full"
                  ariaLabel="Wait-for-window timeout in milliseconds"
                />
              </Field>
              <Field label="On Timeout" className="flex-1">
                <SegmentedControl<'Halt' | 'Continue'>
                  ariaLabel="On timeout"
                  grow
                  value={activateOnTimeout}
                  onChange={setActivateOnTimeout}
                  options={[
                    { value: 'Halt', label: 'Halt' },
                    { value: 'Continue', label: 'Continue' },
                  ]}
                />
              </Field>
            </div>
            )}

            {/* Passive guidance when the profile has a Window Target — coordinates keep
                translating against the PROFILE target regardless of this action. Neutral
                left-rail card (no tint) — informational, not a warning. */}
            {profiles.find(p => p.name === activeProfile)?.hasEffectiveTarget && (
              <div
                className="border-l-2 rounded px-2.5 py-2 text-[11px] leading-relaxed"
                style={calloutStyle('neutral')}
              >
                {'Clicks still follow the profile’s Window Target, not this window.'}
              </div>
            )}
          </>
          )}

          {/* HOLD — how long the button stays down between this row's press and its release.
              Above Position on purpose: it is what makes the row a hold rather than a click,
              so it reads first. Same presets and same 10..60000 range as the Send Keystroke
              dialog's hold mode, because the two are the same idea on different hardware. */}
          {isHoldClick && (
            // Label and value on ONE row, the shape the Send Keystroke dialog's hold uses and the
            // shape every other duration in this panel uses. It was a full-width field under a
            // stacked label with a hint below — 124 px for one number, in the one editor that
            // does not fit its own window (a hold with a point needed 894 px of the 780 the panel
            // has at 1280×800). The hint went with it: "Button stays down for this long, then
            // releases" is the label, the unit and the presets saying the same thing a fourth
            // time, which is exactly what the hint rule says not to keep.
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label className="text-[12px] font-medium text-text-secondary">Hold</label>
                <NumberInput
                  value={holdMs}
                  onChange={(n) => setHoldMs(clampHoldMs(n))}
                  min={MIN_HOLD_MS}
                  max={MAX_HOLD_MS}
                  step={holdMs >= 1000 ? 1000 : 100}
                  thousands
                  suffix="ms" suffixInside
                  inputWidth="w-24"
                  inputHeight="h-8"
                  ariaLabel="Hold duration in milliseconds"
                />
              </div>
              <DurationChips presets={DURATION_PRESETS} value={holdMs} onSelect={(ms) => setHoldMs(clampHoldMs(ms))} />
            </div>
          )}

          {/* POSITION — where this click resolves its point. A SegmentedControl rather than a
              switch because the choice is between two named PLACES, not an on/off attribute of a
              value: a bare "At cursor" toggle leaves the OFF state unnamed and makes the X/Y block
              vanishing below read as a bug. Combined clicks only (isAtCursorEligible) — a paired
              half's replay case reads X/Y directly and can't honour it. */}
          {isAtCursorEligible && (
            <Field
              label="Position"
              hint={atCursor
                ? 'Mouse position when the step runs.'
                : undefined}
            >
              <SegmentedControl<'point' | 'cursor'>
                value={atCursor ? 'cursor' : 'point'}
                onChange={(v) => setAtCursor(v === 'cursor')}
                ariaLabel="Click position source"
                grow
                options={[
                  {
                    value: 'point',
                    label: 'This point',
                  },
                  {
                    value: 'cursor',
                    label: 'At cursor',
                    tip: tt('Wherever the mouse is at run time', 'Onde o mouse estiver na hora'),
                  },
                ]}
              />
            </Field>
          )}

          {/* X / Y — Pick button (only on click halves, since scroll actions don't really
              use X/Y but happen to live in showCoords). Lets the user click somewhere on
              screen to fill both coords without manual typing or re-recording.
              Hidden entirely under At cursor — two dead numeric inputs plus a Pick button that
              writes nothing is exactly the phantom-coordinate state showCoords exists to prevent.
              The stored X/Y is never written while hidden, so switching back restores it. */}
          {showCoords && !atCursor && (
            <div className="space-y-2.5">
              {/* Row 1: X / Y at full width — no longer squeezed by the action buttons. */}
              <div className="flex gap-2.5">
                <Field label="X" className="flex-1">
                  {/* x === '' means "no override" — the action keeps its recorded coord.
                      Pass null so the "—" placeholder shows instead of "0" which would be
                      a legitimate top-left coordinate but is here ambiguous with unset. */}
                  <NumberInput
                    value={x === '' ? null : (Number.isFinite(parseInt(x, 10)) ? parseInt(x, 10) : null)}
                    onChange={(n) => setX(String(n))}
                    onClear={() => setX('')}
                    placeholder="—"
                    inputWidth="w-full"
                    inputHeight="h-8"
                    ariaLabel="X coordinate"
                  />
                </Field>
                <Field label="Y" className="flex-1">
                  <NumberInput
                    value={y === '' ? null : (Number.isFinite(parseInt(y, 10)) ? parseInt(y, 10) : null)}
                    onChange={(n) => setY(String(n))}
                    onClear={() => setY('')}
                    placeholder="—"
                    inputWidth="w-full"
                    inputHeight="h-8"
                    ariaLabel="Y coordinate"
                  />
                </Field>
              </div>
              {/* Which space those two numbers are in. Only shown when it is NOT the obvious
                  one — an absolute profile needs no caption, a relative one very much does,
                  because 40,60 looks identical either way. */}
              {coordsAreRelative && (
                <div className="text-[11px] text-text-tertiary flex items-center gap-1.5 flex-wrap">
                  <Crosshair size={11} className="shrink-0 opacity-70" />
                  <span>
                    {relativeTargetLabel
                      ? `Relative to ${relativeTargetLabel}'s top-left corner`
                      : 'Relative to the target window\'s top-left corner'}
                  </span>
                </div>
              )}
              {/* Row 2: coordinate tools — "Pick from screen" gets the room to read clearly;
                  Copy / Paste stay as compact icon buttons on the right. */}
              {isClickHalf && (
                <div className="flex items-stretch gap-1.5">
                  <button
                    type="button"
                    onClick={handlePickPosition}
                    disabled={pickPositionRequestId != null}
                    className="flex-1 h-8 flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium border border-border-default bg-bg-elevated hover:bg-bg-card text-text-secondary hover:text-text-primary rounded whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Crosshair size={13} />
                    {pickPositionRequestId != null ? 'Picking…' : 'Pick from screen'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyCoords}
                    style={coordCopyFlash ? { borderColor: 'var(--color-replay-fg)', color: 'var(--color-replay-fg)', backgroundColor: 'var(--color-replay-bg)' } : undefined}
                    className={`h-8 shrink-0 flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium border rounded transition-colors ${
                      coordCopyFlash
                        ? ''
                        : 'border-border-default bg-bg-elevated hover:bg-bg-card text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {coordCopyFlash ? <Check size={13} /> : <Copy size={13} />} {coordCopyFlash ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePasteCoords}
                    style={coordPasteError ? { borderColor: 'var(--color-recording-fg)', color: 'var(--color-recording-fg)', backgroundColor: 'var(--color-recording-bg)' } : undefined}
                    className={`h-8 shrink-0 flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium border rounded transition-colors ${
                      coordPasteError
                        ? ''
                        : 'border-border-default bg-bg-elevated hover:bg-bg-card text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {coordPasteError ? <X size={13} /> : <ClipboardPaste size={13} />} Paste
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Click × N — inline repeat of THIS click (a step in the sequence, distinct from the
              auto-Clicker's spam mode), mirroring Keystroke × N. Single clicks (Left/Right/Middle)
              AND Double/TripleClick reach here (isRepeatableClick); paired halves are excluded. The
              replay engine loops the whole click (down→up + focus tap if on, or the full
              multi-click) Times times with the Gap between cycles, applying the optional ±% gap
              jitter and ±px position jitter (the latter inert under At cursor — see the Position
              control). A multi-click defaults to a larger Gap so repeats stay distinct. Reuses
              the Send Keystroke dialog's exact NumberInput + enable-dot pattern. Gap and both
              jitters dim until Times > 1. */}
          {isRepeatableClick && (
            <div className="flex flex-col gap-2.5">
              {/* Times rides the section header. It is the field the other three depend on — Gap,
                  Gap jitter and Position jitter are all inert until it is above 1 — so putting it
                  ON the header reads as "Repeat: how many", and the three knobs below are the
                  refinements. It also buys back a whole row in the one editor that overflows its
                  own window. `Section` already reserves this slot; nothing new was invented for
                  it. */}
              <Section
                title="Repeat"
                adornment={
                  <span className="flex items-center gap-2">
                    <label className="text-[12px] font-medium text-text-secondary">Times</label>
                    <NumberInput
                      value={repeatCount}
                      onChange={(n) => setRepeatCount(clampRepeatCount(n))}
                      min={1}
                      max={999}
                      inputWidth="w-24"
                      inputHeight="h-8"
                      ghostSuffix="ms"
                      ariaLabel="Times to repeat"
                    />
                  </span>
                }
              />
              <div className="flex items-center justify-between gap-3">
                <label
                  className={`text-[12px] font-medium transition-colors ${repeatCount > 1 ? 'text-text-secondary' : 'text-text-tertiary'}`}
                  data-tip={isMultiClick
                    ? tt('Keep it above your system double-click speed (~½ s).', 'Mantenha acima da velocidade de duplo-clique do sistema (~½ s).')
                    : undefined}
                >
                  {'Gap'}
                </label>
                <NumberInput
                  value={repeatGapMs}
                  onChange={(n) => setRepeatGapMs(clampRepeatGap(n))}
                  min={0}
                  max={5000}
                  disabled={repeatCount <= 1}
                  thousands
                  suffix="ms" suffixInside
                  inputWidth="w-24"
                  inputHeight="h-8"
                  ariaLabel={isMultiClick ? 'Gap between multi-clicks (ms)' : 'Gap between clicks (ms)'}
                />
              </div>
              {/* Gap jitter — OFF by default (hollow dot). Adds a random ±% to each gap so a
                  click burst isn't a fixed-interval metronome — a constant gap is the clearest
                  "it's a bot" tell. Enable dot sits RIGHT of the label so the label lines up
                  with the two rows above. Inert until Times > 1, like Gap. */}
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setJitterOn(v => !v)}
                  disabled={repeatCount <= 1}
                  aria-pressed={jitterOn}
                  className="flex items-center gap-1.5 disabled:cursor-not-allowed"
                  data-tip={tt('Random ±% on each gap — less robotic.', 'Variação ±% aleatória em cada intervalo — menos robótico.')}
                >
                  <CheckboxBox checked={jitterOn && repeatCount > 1} />
                  <span className={`text-[12px] font-medium transition-colors ${jitterOn && repeatCount > 1 ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                    Gap jitter
                  </span>
                </button>
                <NumberInput
                  value={jitterPct}
                  onChange={(n) => setJitterPct(clampRepeatJitter(n))}
                  min={1}
                  max={100}
                  disabled={!jitterOn || repeatCount <= 1}
                  suffix="%" suffixInside
                  inputWidth="w-24"
                  inputHeight="h-8"
                  ariaLabel="Gap jitter (%)"
                />
              </div>
              {/* Position jitter — the positional twin of Gap jitter, same row format (enable dot
                  RIGHT of the label, inert until Times > 1). Scatters the click POINT by ±px on
                  every cycle, so "click × 3" lands on three nearby pixels of the same target
                  instead of hammering one exact coordinate — scattering only the timing still
                  leaves a perfectly fixed position, which is the other half of the bot signature.
                  OFF by default: pure desktop automation wants the exact point.
                  Inert under At cursor as well, and the tip says why: every event carries
                  MOUSEEVENTF_MOVE, so an offset cycle would move the cursor and the NEXT cycle
                  would read that moved cursor as its own origin — a random walk instead of a
                  scatter. Disabled rather than hidden: this cluster is a fixed four-row block and
                  dropping a row mid-block makes the drawer jump. */}
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setPosJitterOn(v => !v)}
                  disabled={repeatCount <= 1 || atCursor}
                  aria-pressed={posJitterOn && !atCursor}
                  className="flex items-center gap-1.5 disabled:cursor-not-allowed"
                  data-tip={atCursor
                    ? tt('Not at cursor — the scatter would move the cursor it reads',
                         'Não no cursor — o desvio moveria o cursor que ele lê')
                    : tt('Random ±px on the click point — less robotic.', 'Variação ±px aleatória no ponto do clique — menos robótico.')}
                >
                  <CheckboxBox checked={posJitterOn && repeatCount > 1 && !atCursor} />
                  <span className={`text-[12px] font-medium transition-colors ${posJitterOn && repeatCount > 1 && !atCursor ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                    Position jitter
                  </span>
                </button>
                <NumberInput
                  value={posJitterPx}
                  onChange={(n) => setPosJitterPx(clampRepeatPosJitter(n))}
                  min={1}
                  max={500}
                  disabled={!posJitterOn || repeatCount <= 1 || atCursor}
                  suffix="px" suffixInside
                  inputWidth="w-24"
                  inputHeight="h-8"
                  ariaLabel="Position jitter (px)"
                />
              </div>
            </div>
          )}

          {/* Delay — hidden for conditional structural rows. IF rows don't have a
              meaningful "delay AFTER" (the probe is instant and the branch is taken
              before the next action fires its own delay); Else/EndIf are pure markers
              the engine walks past with zero work. Keeping the field would just invite
              users to set a value that gets silently ignored. Also suppressed for browser
              actions — they render their own Delay inside the Test/Timeout/Delay cluster
              (bound to the same delay state), so this would be a duplicate. */}
          {/* Loop markers are pure jumps: the engine never pays their delay and the
              load-time validator zeroes it — an editable field here would persist a
              value that silently reverts on the next load. While is NOT a marker
              (its delay is the per-iteration settle knob) and keeps the field. */}
          {!isConditional && !isBrowser
            && actionType !== 'EndLoop' && actionType !== 'BreakLoop'
            && actionType !== 'ContinueLoop' && actionType !== 'ForEachRow' && (
          <Field label="Delay" className="w-31">
            <NumberInput
              value={parseInt(delay, 10) || 0}
              onChange={(n) => setDelay(String(n))}
              min={0}
              thousands
              suffix="ms" suffixInside
              inputWidth="w-full"
              inputHeight="h-8"
              className="w-full"
              ariaLabel="Delay in milliseconds"
            />
          </Field>
          )}

          {/* Notes */}
          <Field label="Notes">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              // Two lines at rest, growing with the text up to ~8 — the field was a fixed four
              // lines in every editor, filled in one action out of eighteen in the sample profile.
              rows={2}
              ref={notesRef}
              onInput={(e) => growTextarea(e.currentTarget)}
              className="w-full min-h-[3.25rem] max-h-40 px-2 py-1.5 text-xs bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid resize-none placeholder:text-text-tertiary"
              placeholder="Add a note…"
            />
          </Field>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border-subtle shrink-0">
          {/* Dirty state, in the span the footer already reserves (~111 px beside the two 84 px
              buttons; opacity toggle, never reflows). Three readings, two channels each (text +
              ink): at rest with edits pending, "Unsaved changes" in tertiary; armed by Esc,
              "Esc again discards" in warning ink; armed by a click on another row, "Click again
              to discard". Every string is measured to fit the span unwrapped — the buttons stay
              shrink-0 / nowrap so "Save" never wraps. */}
          <span
            className={`flex-1 min-w-0 truncate text-[11px] transition-opacity duration-150 pointer-events-none ${armedBy ? 'text-warning-ink' : 'text-text-tertiary'}`}
            style={{ opacity: armedBy || hasUnsavedChanges ? 1 : 0 }}
          >
            {armedBy === 'esc' ? 'Esc again discards' : armedBy === 'switch' ? 'Click again to discard' : 'Unsaved changes'}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {/* Cancel is the explicit one-click discard; while there is something to lose its label
                says exactly that (same 84 px minimum, so nothing moves). */}
            <Button variant="secondary" size="md" className="min-w-[84px]" onClick={discardAndClose}>
              {hasUnsavedChanges ? 'Discard' : 'Cancel'}
            </Button>
            <Button variant="primary" size="md" className="min-w-[84px]" onClick={handleSave}
              disabled={!!regexError || runActive || mergeConflict}
              // A disabled control still shows its tip (index.css restores pointer-events on
              // [data-tip][disabled]) precisely so it can say WHY it is off. Announcing a shortcut
              // that is currently refused, without the reason, is the one thing it must not do.
              data-tip={runActive
                ? tt('Locked while a run is active', 'Travado enquanto um run está ativo')
                : mergeConflict
                  ? (mergeShapeChanged
                    ? tt('The merge is checked against the other half, which this Save does not touch — save the button or point change on its own first',
                         'A fusão é conferida contra a outra metade, que este Save não toca — salve a troca de botão ou de ponto sozinha primeiro')
                    : tt('The merge keeps the Down half, so the edits on this Up half would be lost — save them on their own first',
                         'A fusão mantém a metade Down, então as edições desta metade Up se perderiam — salve-as sozinhas primeiro'))
                  : tt('Save · Ctrl+S', 'Salvar · Ctrl+S')}>
              <Check size={14} />
              Save
            </Button>
          </div>
        </div>
      </div>

      {/* Crop modal — only mounted when explicitly opened; portals to body so it sits above
          the side panel even though it's rendered from inside this component tree. */}
      {cropperOpen && action?.imageBase64 && (
        <ImageCropper
          imageBase64={action.imageBase64}
          onSave={handleCropSave}
          onCancel={() => setCropperOpen(false)}
        />
      )}
    </>,
    document.body
  );
}
