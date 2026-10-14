import { useState, useRef, useEffect, useCallback } from 'react';
import { Mouse, Crosshair } from 'lucide-react';
import { NumberInput } from './common/NumberInput';
import { DialogShell, DialogFooter } from './common/DialogShell';
import { DurationChips, DURATION_PRESETS } from './common/DurationChips';
import { SegmentedControl } from './common/SegmentedControl';
import { calloutStyle } from './common/Callout';
import { Section } from './sheet/Field';
import { useBridge } from '../bridge/BridgeContext';
import { useLanguage, useTt } from '../state/LanguageContext';
import { formatMs } from '../utils/displayUtils';
import { MIN_HOLD_MS, MAX_HOLD_MS, DEFAULT_HOLD_MS, DEFAULT_CLICK_GAP_MS, DEFAULT_MULTICLICK_GAP_MS } from '../utils/actionCost';

export type ClickButton = 'Left' | 'Right' | 'Middle';
export type ClickActionType =
  | 'LeftClick' | 'RightClick' | 'MiddleClick'
  | 'DoubleClick' | 'TripleClick'
  | 'LeftClickHold' | 'RightClickHold' | 'MiddleClickHold';

export interface ClickResult {
  actionType: ClickActionType;
  /** Omitted when atCursor — the row resolves its point at replay time. */
  x?: number;
  y?: number;
  atCursor: boolean;
  /** Hold mode only. */
  holdDurationMs?: number;
  /** Click mode only; omitted for a single shot so the row persists nothing. */
  repeat?: number;
  repeatDelayMs?: number;
  /** Write it as TWO rows, Down then Up. Mutually exclusive with hold / multi-click / atCursor. */
  paired?: boolean;
  /** Paired only, optional: the Up half's own point — omitted, it reuses the press point. */
  upX?: number;
  upY?: number;
}

interface ClickDialogProps {
  onConfirm: (result: ClickResult) => void;
  onClose: () => void;
}

/**
 * Insert Click — the mouse twin of the Send Keystroke dialog, and the ONLY way to put a click
 * in a profile without recording one. Until this existed a click could come from the recorder,
 * or from "Pick from screen" on a row that already was one, and from nowhere else: a profile
 * assembled by hand could type, wait, branch and loop, but not click.
 *
 * Same shape as its keyboard twin, deliberately: ONE dialog with a Mode toggle (Click / Hold)
 * standing in for what would otherwise be two toolbar buttons and two dialogs, with the
 * underlying ActionType split left intact — LeftClick…TripleClick for taps, *ClickHold for
 * holds — so nothing about stored profiles changes.
 *
 * The point comes from the same native picker the Sheet uses (mouse:pickPosition →
 * mouse:positionPicked, correlated by requestId): the app minimises, the next click anywhere on
 * screen is the answer. "At cursor" is the other way to answer the question — it says the point
 * is not knowable until run time — and it is the only mode that may confirm without a pick.
 *
 * What is deliberately NOT here: gap jitter, position jitter and focus click. All three are
 * refinements of a row that already does the right thing, all three are off by default, and all
 * three are one click away in the Sheet the inserted row opens into. The dialog carries what
 * changes WHAT THE ROW DOES; the Sheet carries what tunes it.
 */

/** Range shared with the Sheet's Hold field and the Send Keystroke dialog's hold mode, so the key
 *  hold and the mouse hold clamp alike (C# clamps 10..60000 identically). The numbers live in
 *  utils/actionCost, next to the run estimate that reads the same dwell. The PRESETS are the
 *  app-wide ladder — see DURATION_PRESETS. */
const clampHold = (v: number) => Math.max(MIN_HOLD_MS, Math.min(MAX_HOLD_MS, Math.floor(v)));

const MAX_REPEAT = 999;
const MAX_REPEAT_DELAY = 5000;
const clampRepeat = (v: number) => Math.max(1, Math.min(MAX_REPEAT, Math.floor(v)));
const clampGap = (v: number) => Math.max(0, Math.min(MAX_REPEAT_DELAY, Math.floor(v)));

/** X and Y are the only numbers this dialog sends that had no clamp, and they are the only two
 *  the backend reads with GetInt32 — which THROWS on a JSON number that is not an Int32. The
 *  coordinate inputs are not in textMode, so NumberInput applies no digit strip: "300.5" and
 *  "99999999999" both reach the wire as Number, pass the ValueKind guard, and blow up inside
 *  HandleInsertClick before it has written anything. The exception lands in HandleMessage's catch,
 *  whose whole body is a [Conditional("DEBUG")] Debug.WriteLine — removed from Release — so in a
 *  shipped build the dialog closes and NO row appears, with nothing in the log either.
 *  Floored and bounded here for the same reason hold, repeat and gap are: the wire carries what
 *  the backend can read. Negative coordinates are legal (a monitor left of the primary). */
const MAX_COORD = 2_000_000;
const clampCoord = (v: number) => Math.max(-MAX_COORD, Math.min(MAX_COORD, Math.trunc(v) || 0));

/** Per-type inter-repeat gap, mirroring ActionItem.DefaultRepeatDelayMs /
 *  DefaultDoubleClickRepeatDelayMs and the Sheet's clickDefaultGap: a multi-click burst has to
 *  clear the system double-click window or the repeats blur into one long chain. */
const defaultGapFor = (clicks: Clicks) => (clicks === 'single' ? DEFAULT_CLICK_GAP_MS : DEFAULT_MULTICLICK_GAP_MS);

/** Spinner step: 1 s once we're past 1 s, 100 ms below. Same rule every duration spinner in the
 *  app uses, so they all feel alike. */
const stepFor = (ms: number) => (ms >= 1000 ? 1000 : 100);

type Mode = 'click' | 'hold';
type Clicks = 'single' | 'double' | 'triple';
/** Combined = one row that owns press→release. Paired = two rows, Down then Up. */
type Form = 'combined' | 'paired';

export function ClickDialog({ onConfirm, onClose }: ClickDialogProps) {
  const { language } = useLanguage();
  const tt = useTt();
  const { send, subscribe } = useBridge();

  const [mode, setMode] = useState<Mode>('click');
  const [button, setButton] = useState<ClickButton>('Left');
  const [clicks, setClicks] = useState<Clicks>('single');
  const [holdMs, setHoldMs] = useState<number>(DEFAULT_HOLD_MS);
  const [repeat, setRepeat] = useState<number>(1);
  const [gapMs, setGapMs] = useState<number>(DEFAULT_CLICK_GAP_MS);
  const [position, setPosition] = useState<'point' | 'cursor'>('point');
  const [form, setForm] = useState<Form>('combined');
  // Each coordinate is its OWN nullable axis rather than a {x,y} pair, because a point can now be
  // TYPED as well as picked and half a typed point is a real state: null means "no value here",
  // which a pair could only express by inventing a 0 — a legitimate top-left coordinate. The
  // press point is complete when both are set; the release point is complete, absent, or (the
  // state this split makes visible) half-filled, which the dialog refuses rather than rounding
  // into "same point". Same string-backed-with-a-sentinel problem the Sheet's X/Y solved with ''.
  const [pressX, setPressX] = useState<number | null>(null);
  const [pressY, setPressY] = useState<number | null>(null);
  // The Up half's own point. Empty = the release lands where the press did (the plain split);
  // set = a DRAG, which is the only thing in the app that needs two points in one gesture and
  // the reason this dialog grew a second picker at all.
  const [releaseX, setReleaseX] = useState<number | null>(null);
  const [releaseY, setReleaseY] = useState<number | null>(null);

  // Double/Triple are LEFT-button actions — MultiClickPairs emits LEFTDOWN/LEFTUP and there is
  // no right-button double-click type to emit instead. So the button control is not merely
  // ignored for them, it is DISABLED and pinned to Left: leaving "Right" lit while the row
  // replays a left double-click is the UI stating something false.
  // PAIRED pins three controls, and the app's own converter is why each one. A Down/Up pair is
  // two fragments: its replay cases read X/Y directly and never consult AtCursor, the halves do
  // not loop, and a hold or a multi-click is a whole gesture that cannot be cut in two — all
  // three are refusals ActionModeConverter.ToPaired already enforces. Pinning them here is the
  // same treatment the Button control gets under Double/Triple, for the same reason: a lit
  // segment the row will not honour is the UI stating something false.
  const paired = form === 'paired';
  const effectiveMode: Mode = paired ? 'click' : mode;
  // Clicks is inert under BOTH pins: a paired half cannot multi-click (ToPaired refuses it), and
  // a hold is ONE press that happens to last — its ActionType carries no click count at all.
  // Folding Hold in here is not cosmetic. `multi` reads this value, so a hold entered with the
  // user's last Double still selected kept Button pinned to Left in the UI while the hold branch
  // of `actionType` below built its name from the RAW `button`: the dialog showed Left and
  // inserted a RightClickHold. One pin, read by both, and the two can no longer disagree.
  const clicksInert = paired || effectiveMode === 'hold';
  const effectiveClicks: Clicks = clicksInert ? 'single' : clicks;
  const effectivePosition: 'point' | 'cursor' = paired ? 'point' : position;

  const multi = effectiveClicks !== 'single';
  const effectiveButton: ClickButton = multi ? 'Left' : button;

  // A point is what BOTH axes agree on. Half a RELEASE point is neither a drag nor a plain split,
  // so it is refused with a reason (Add goes disabled, the note says why) rather than silently
  // read as "same point" — the same rule the pinned segments follow one level up: never act on
  // something other than what the user can see.
  const point = pressX != null && pressY != null ? { x: pressX, y: pressY } : null;
  const upPoint = releaseX != null && releaseY != null ? { x: releaseX, y: releaseY } : null;
  // Whether the app will CALL it a drag, not merely whether the two points differ. The converter
  // treats halves within CLICK_COORD_TOLERANCE of each other as one click — the slack exists to
  // absorb the 1 px wobble a recorded click can have — so a release typed 1 px away is a pair that
  // Merge folds straight back into a plain click, dropping the release point without a word. The
  // dialog used to say "this is a drag" about exactly that pair, which made the app contradict
  // itself across two surfaces. Same number, so the two can only agree.
  const CLICK_COORD_TOLERANCE = 2;   // mirrors ActionModeConverter.ClickCoordTolerance
  const upIsDrag = upPoint != null && point != null
    && (Math.abs(upPoint.x - point.x) > CLICK_COORD_TOLERANCE
      || Math.abs(upPoint.y - point.y) > CLICK_COORD_TOLERANCE);
  const releaseHalfFilled = paired && (releaseX == null) !== (releaseY == null);

  // Single in-flight pick, correlated by id — the Sheet's pattern. A reply whose id doesn't
  // match is a stale round-trip from a picker this dialog no longer owns and must be ignored,
  // or a late answer would write a point over one the user already picked.
  const [pickRequestId, setPickRequestId] = useState<string | null>(null);
  const pickRequestIdRef = useRef<string | null>(null);
  useEffect(() => { pickRequestIdRef.current = pickRequestId; }, [pickRequestId]);
  // WHICH point the in-flight pick is for. A ref, not state: it is read inside the subscription,
  // which is registered once — state would be captured stale there. Still one pick at a time, so
  // one target is all there is to remember.
  const pickTargetRef = useRef<'press' | 'release'>('press');

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type !== 'mouse:positionPicked') return;
      const r = msg.payload;
      if (!pickRequestIdRef.current || r.requestId !== pickRequestIdRef.current) return;
      // cancelled covers the refused case too (refused rides ALONG with cancelled, never
      // instead of it — see the message's note), so one branch handles both: nothing was
      // picked, the previous point stands, and the button comes back out of "Picking…".
      if (!r.cancelled && r.x != null && r.y != null) {
        // Both axes together — a pick is one answer, never half of one.
        if (pickTargetRef.current === 'release') { setReleaseX(r.x); setReleaseY(r.y); }
        else { setPressX(r.x); setPressY(r.y); }
      }
      setPickRequestId(null);
    });
    return unsub;
  }, [subscribe]);

  const handlePick = useCallback((target: 'press' | 'release' = 'press') => {
    const requestId = Math.random().toString(36).slice(2, 10);
    pickTargetRef.current = target;
    setPickRequestId(requestId);
    send({ type: 'mouse:pickPosition', payload: { requestId } });
  }, [send]);

  // Switching the click count moves the gap to the NEW type's default when it is still sitting
  // on the OLD one — untouched means "I want the default", and 30 ms between double-clicks
  // blurs them into one chain. A gap the user actually typed is theirs and survives. Same rule
  // the Sheet's family picker applies for the same reason.
  const changeClicks = (next: Clicks) => {
    setGapMs(g => (g === defaultGapFor(clicks) ? defaultGapFor(next) : g));
    setClicks(next);
  };

  // Always a COMBINED name, even in the paired form: the `paired` flag on the payload says what
  // SHAPE to write it in, so there is one vocabulary on the wire and the backend's strict
  // IsCombinedClickType guard stays exactly as strict as it was.
  const actionType: ClickActionType = effectiveMode === 'hold'
    ? (`${button}ClickHold` as ClickActionType)
    : effectiveClicks === 'double' ? 'DoubleClick'
    : effectiveClicks === 'triple' ? 'TripleClick'
    : (`${button}Click` as ClickActionType);

  // At cursor needs no point; This point needs one. A pick still in flight is not an answer yet.
  // The RELEASE point is never required — omitted, both halves share the press point, which is
  // the plain split. Only a drag needs the second one, and a drag is the rarer ask. What IS
  // refused is half of one: see releaseHalfFilled.
  const canConfirm = pickRequestId == null
    && (effectivePosition === 'cursor' || point != null)
    && !releaseHalfFilled;

  const handleConfirm = () => {
    if (!canConfirm) return;
    const where = effectivePosition === 'cursor'
      ? { atCursor: true as const }
      : { atCursor: false as const, x: clampCoord(point!.x), y: clampCoord(point!.y) };
    if (paired) {
      onConfirm({
        actionType, ...where, paired: true,
        ...(upPoint ? { upX: clampCoord(upPoint.x), upY: clampCoord(upPoint.y) } : {}),
      });
      return;
    }
    if (effectiveMode === 'hold') {
      onConfirm({ actionType, ...where, holdDurationMs: clampHold(holdMs) });
      return;
    }
    // Omit the repeat pair for a single shot so the row persists nothing and stays
    // byte-identical to a recorded click — the same convention the keystroke insert follows.
    const n = clampRepeat(repeat);
    onConfirm(n > 1
      ? { actionType, ...where, repeat: n, repeatDelayMs: clampGap(gapMs) }
      : { actionType, ...where });
  };

  const holdLabel = `${formatMs(clampHold(holdMs), language)} ms`;
  // Carries its OWN preposition: "at 300, 400" needs one and "wherever the mouse is" does not,
  // and a fixed "at " prefix outside produced "at wherever the mouse is".
  // effectivePosition, not the raw one: under Two rows the cursor choice is pinned away, and the
  // sentence has to describe the row that will be written, not the segment the user last touched.
  const whereLabel = effectivePosition === 'cursor'
    ? 'wherever the mouse is'
    : point ? `at ${point.x}, ${point.y}` : 'at —';
  const btnLabel = effectiveButton.toLowerCase();

  /**
   * The point slot — one Pick button plus the two axes, each editable. Written once and used for
   * both points: they differ in exactly three things (which axes, which pick target, when they
   * are inert), and a second copy is how a pair of sibling controls starts drifting.
   *
   * The axes are INPUTS, not a readout. Until now the only way to answer "where" in this dialog
   * was to go to the screen and pick, so a coordinate the user already knew — from the grid, from
   * a note, from the row above — had to be re-picked or fixed afterwards in the Sheet. They also
   * hold their width: the old readout grew from 29 px to 85 px the moment a point arrived, and
   * the Pick button shrank under the cursor that had just clicked it.
   */
  const pointSlot = (target: 'press' | 'release') => {
    const isPress = target === 'press';
    const x = isPress ? pressX : releaseX;
    const y = isPress ? pressY : releaseY;
    const setX = isPress ? setPressX : setReleaseX;
    const setY = isPress ? setPressY : setReleaseY;
    // Everything in a stacked cell is always MOUNTED, so the half that is not live has to be
    // disabled as well as invisible — an invisible control still takes clicks and Tab focus.
    const inert = isPress ? effectivePosition !== 'point' : !paired;
    const complete = x != null && y != null;
    return (
      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          // Wrapped, not passed by reference: handlePick takes the target, and a bare
          // onClick={handlePick} would hand it the MouseEvent as that argument.
          onClick={() => handlePick(target)}
          disabled={inert || pickRequestId != null}
          className="flex-1 h-8 flex items-center justify-center gap-1.5 px-2.5 text-minor font-medium border border-border-default bg-bg-elevated hover:bg-bg-card text-text-secondary hover:text-text-primary rounded whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Crosshair size={13} />
          {/* The label names the ACTION, in all three states. The empty release slot used to read
              "Same point" — the STATE of the field, not what the button does — and pressing it did
              what it does everywhere else: minimise the app and open the full-screen picker, so
              the next click anywhere turned into a release point and produced exactly the drag the
              label said there wasn't. The only label in the dialog that described a state, and the
              only one that could be pressed to contradict itself. "Same point" is already said by
              the em-dash placeholder in X and Y and by the live strip below; getting BACK to it is
              the "Clear it?" link's job, not this button's. */}
          {pickRequestId != null ? 'Picking…' : complete ? 'Pick again' : 'Pick from screen'}
        </button>
        <span className="flex items-center gap-1.5 shrink-0">
          <span className="label-micro text-text-tertiary">X</span>
          <NumberInput
            value={x}
            onChange={setX}
            // integer: the drag verdict and the "at X, Y" line below read these values, and the
            // backend compares the STORED ints. A typed 100.9 used to preview as 100.9 and store
            // as 100, so near the 2 px tolerance the dialog could call it a drag and the Sheet
            // then merge the pair as a click.
            integer
            // Clearing is what makes "unset" reachable from the keyboard: blur an empty field and
            // the axis goes back to null, which for the release point means "same point".
            onClear={() => setX(null)}
            placeholder="—"
            disabled={inert}
            inputWidth="w-20"
            ariaLabel={isPress ? 'Press X coordinate' : 'Release X coordinate'}
          />
          <span className="label-micro text-text-tertiary">Y</span>
          <NumberInput
            value={y}
            onChange={setY}
            integer
            onClear={() => setY(null)}
            placeholder="—"
            disabled={inert}
            inputWidth="w-20"
            ariaLabel={isPress ? 'Press Y coordinate' : 'Release Y coordinate'}
          />
        </span>
      </div>
    );
  };

  return (
    <DialogShell
      icon={<Mouse size={14} style={{ color: 'var(--color-action-mouse-fg)' }} />}
      title="Insert Click"
      onClose={onClose}
      // A stray click outside must not discard a point the user went to the screen to pick —
      // the one input here that costs real effort to produce again.
      closeOnBackdrop={false}
      footer={<DialogFooter
        secondary={{ label: 'Cancel', onClick: onClose }}
        primary={{ label: 'Add', onClick: handleConfirm, disabled: !canConfirm }}
      />}
      onCardKeyDown={(e) => {
        if (e.key === 'Enter' && canConfirm) {
          e.preventDefault();
          e.stopPropagation();
          handleConfirm();
        }
      }}
    >
      <div className="px-5 py-5 flex flex-col gap-4">
        {/* MODE — a tap or a held press. The same two-way split, in the same place, as the Send
            Keystroke dialog's Press/Hold: one dialog per input device, not one per action type.
            Labelled like everything else here: it was the one bare track in the dialog, and its
            twin in Send Keystroke has carried a MODE label all along. */}
        <div className="flex flex-col gap-1.5">
          <span className="label-micro text-text-tertiary">Mode</span>
          <SegmentedControl<Mode>
            value={effectiveMode}
            onChange={setMode}
            ariaLabel="Click mode"
            grow
            // A REAL disabled, not `opacity-50 pointer-events-none`: that pair removes POINTER
            // hit-testing only, so a pinned segment stayed in the tab order and Tab-then-Enter
            // still chose it. Four pins here, same class of hole the Sheet had.
            disabled={paired}
            options={[
              { value: 'click', label: 'Click' },
              { value: 'hold', label: 'Hold' },
            ]}
          />
        </div>

        {/* BUTTON — three named things, so a segmented control rather than a dropdown: all the
            options fit, and the choice reads without opening anything. Pinned to Left (and
            disabled) under Double/Triple — see the note on `multi`. */}
        <div className="flex flex-col gap-1.5">
          <span className="label-micro text-text-tertiary">Button</span>
          <SegmentedControl<ClickButton>
            value={effectiveButton}
            onChange={setButton}
            ariaLabel="Mouse button"
            grow
            disabled={multi}
            options={[
              { value: 'Left', label: 'Left' },
              { value: 'Right', label: 'Right' },
              { value: 'Middle', label: 'Middle' },
            ]}
          />
        </div>

        {/* CLICKS — how many presses this one row performs. It used to sit INSIDE the mode cell
            below, which sized that cell to its three rows (136 px) while the other two bodies
            needed 63 and 78 — 73 px of dead space under the hold presets, in a dialog whose whole
            height doctrine is that nothing moves. It reads better here anyway: how many clicks is
            a property of the click, like which button, not a detail of one mode.
            Inert (dimmed, pinned to Single) under Hold and under Two rows — see clicksInert. */}
        <div className="flex flex-col gap-1.5">
          <span className="label-micro text-text-tertiary">Clicks</span>
          <SegmentedControl<Clicks>
            value={effectiveClicks}
            onChange={changeClicks}
            ariaLabel="Clicks per step"
            grow
            disabled={clicksInert}
            options={[
              { value: 'single', label: 'Single' },
              {
                value: 'double', label: 'Double',
                tip: tt('Left button only', 'Só o botão esquerdo'),
              },
              {
                value: 'triple', label: 'Triple',
                tip: tt('Left button only — selects a paragraph', 'Só o botão esquerdo — seleciona um parágrafo'),
              },
            ]}
          />
        </div>

        {/* POSITION — same two named places, and the same words, as the Sheet's Position
            control, so a row inserted here and a row edited there describe themselves alike. */}
        <div className="flex flex-col gap-1.5">
          <span className="label-micro text-text-tertiary">Position</span>
          {/* Pinned to This point under Paired — the halves' replay cases read X/Y directly and
              never consult the at-cursor flag, which is exactly why ToPaired refuses to split an
              at-cursor click. A lit "At cursor" here would promise a point resolved at run time
              on a row that will read the stored one. */}
          <SegmentedControl<'point' | 'cursor'>
            value={effectivePosition}
            onChange={setPosition}
            ariaLabel="Click position source"
            grow
            disabled={paired}
            options={[
              { value: 'point', label: 'This point' },
              { value: 'cursor', label: 'At cursor' },
            ]}
          />

          {/* The point slot. BOTH states are always mounted, stacked in one grid cell with only
              the live one visible, so the dialog is exactly as tall in either mode — swapping a
              32 px button row for a one-line note would resize the card under the user's cursor
              mid-edit (see the same construction in PauseDialog's semantics strip).
              The hidden half is also DISABLED, not merely invisible: an `invisible` button still
              takes clicks and Tab focus, which is a control the user cannot see operating the
              picker they did not ask for. */}
          <div className="grid mt-1">
            <div
              style={{ gridArea: '1 / 1' }}
              className={effectivePosition === 'point' ? undefined : 'invisible'}
              aria-hidden={effectivePosition !== 'point'}
            >
              {pointSlot('press')}
            </div>
            <div
              style={{ gridArea: '1 / 1' }}
              className={effectivePosition === 'cursor' ? 'flex items-center' : 'invisible'}
              aria-hidden={effectivePosition !== 'cursor'}
            >
              {/* Word for word the Sheet's hint for the same state. The two surfaces described one
                  idea in two sentences, and the one that survives is the shorter. */}
              <span className="text-caption leading-relaxed text-text-tertiary">
                {'Mouse position when the step runs.'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Mode body ──
            Both bodies live in the SAME grid cell, so the wrapper is always as tall as the taller
            of the two and the dialog never resizes when you switch tabs. Measured rather than
            pinned with a min-height: font size and row height are theme settings, so any hardcoded
            pixel would be right at one setting and wrong at the rest. Identical construction, and
            identical reasoning, to the Send Keystroke dialog's two bodies. */}
        <div className="grid">
          {/* ── CLICK mode ── */}
          <div
            className={`flex flex-col gap-2.5 ${effectiveMode === 'click' && !paired ? '' : 'invisible pointer-events-none'}`}
            style={{ gridArea: '1 / 1' }}
            aria-hidden={effectiveMode !== 'click' || paired}
          >
            {/* The × N cluster now reads as one GROUP under a header, exactly as it does in the
                Sheet: same title, same two labels. The two surfaces named the same pair of fields
                differently — "Times to repeat" / "Gap between clicks" here, "Times" / "Gap" under
                a Repeat header there — which is one concept carrying two vocabularies. The header
                is what lets the short labels stay unambiguous. */}
            <Section title="Repeat" />

            <div className="flex items-center justify-between gap-3">
              <label className="text-minor font-medium text-text-secondary">Times</label>
              <NumberInput
                value={repeat}
                onChange={(n) => setRepeat(clampRepeat(n))}
                min={1}
                max={MAX_REPEAT}
                inputWidth="w-24"
                inputHeight="h-8"
                ghostSuffix="ms"
                // The visible label is one word now, so the accessible name carries the sentence.
                ariaLabel="Times to repeat"
              />
            </div>

            {/* Gap stays visible but dims when Times = 1 — it communicates that the field exists
                for repeat-flavoured clicks without making the dialog jump when Times changes. */}
            <div className="flex items-center justify-between gap-3">
              <label className={`text-minor font-medium transition-colors ${repeat > 1 ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                Gap
              </label>
              <NumberInput
                value={gapMs}
                onChange={(n) => setGapMs(clampGap(n))}
                min={0}
                max={MAX_REPEAT_DELAY}
                disabled={repeat <= 1}
                thousands
                suffix="ms" suffixInside
                inputWidth="w-24"
                inputHeight="h-8"
                ariaLabel="Gap between clicks (ms)"
              />
            </div>
          </div>

          {/* ── HOLD mode ──
              Gated on effectiveMode, not the raw `mode`. Two rows FORCES the mode to click (a
              press and a release cannot be one held gesture), and while these two read the raw
              value a dialog left in Hold and then switched to Two rows painted BOTH bodies into
              the same grid cell — the hold duration and the release picker, one on top of the
              other, each announcing itself to screen readers. Every other gate in this file
              already reads the effective value; these two were the pair that did not. */}
          <div
            className={`flex flex-col gap-2.5 ${effectiveMode === 'hold' ? '' : 'invisible pointer-events-none'}`}
            style={{ gridArea: '1 / 1' }}
            aria-hidden={effectiveMode !== 'hold'}
          >
            <div className="flex items-center justify-between gap-3">
              <label className="text-minor font-medium text-text-secondary">Hold</label>
              <NumberInput
                value={holdMs}
                onChange={(n) => setHoldMs(clampHold(n))}
                min={MIN_HOLD_MS}
                max={MAX_HOLD_MS}
                step={stepFor(holdMs)}
                thousands
                suffix="ms" suffixInside
                inputWidth="w-24"
                inputHeight="h-8"
                ariaLabel="Hold duration in milliseconds"
              />
            </div>
            {/* No ∞ preset: a hold with no end would latch the button down for the rest of the
                run, and the engine's 60 s ceiling exists to make that unreachable. */}
            <DurationChips presets={DURATION_PRESETS} value={holdMs} onSelect={(ms) => setHoldMs(clampHold(ms))} />
          </div>

          {/* ── PAIRED body ── A THIRD body in the same cell, not a row bolted onto the section
              above: the paired form has a different set of controls, not the same ones greyed —
              × N and the multi-click count do not exist for halves, and the release point does
              not exist for anything else. Same stacked construction as the two above, so the
              card is the same height in all three. */}
          <div
            className={`flex flex-col gap-2.5 ${paired ? '' : 'invisible pointer-events-none'}`}
            style={{ gridArea: '1 / 1' }}
            aria-hidden={!paired}
          >
            <div className="flex flex-col gap-1.5">
              <span className="label-micro text-text-tertiary">Release at</span>
              {pointSlot('release')}
            </div>
            {/* Always rendered so the body's height does not move when a release point appears;
                the Clear affordance only lights up once there is something to clear. Three
                readings on one line: the empty default, the drag, and the half-filled refusal
                that Add is currently blocked on. Visible text, so English — tt() is for tooltips
                and toasts, and this line was carrying a bilingual string it should never have had. */}
            <button
              type="button"
              onClick={() => { setReleaseX(null); setReleaseY(null); }}
              disabled={releaseX == null && releaseY == null}
              className={`self-start text-caption leading-relaxed disabled:opacity-40 disabled:cursor-default transition-colors ${
                releaseHalfFilled ? 'text-warning-ink' : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {releaseHalfFilled
                ? 'A release needs both X and Y. Clear it?'
                : upPoint
                  ? (upIsDrag
                    ? 'Release somewhere else — this is a drag. Clear it?'
                    : 'Release within 2 px of the press — the app reads that as one click, not a drag. Clear it?')
                  : 'Leave it empty and the release lands on the press point.'}
            </button>
          </div>
        </div>

        {/* FORM — one row, or two. Until this control existed the dialog could only write the
            combined shape, the Sheet's picker could only change which BUTTON a row used, and the
            only way to get a paired click was to convert the WHOLE profile. So a hand-built DRAG
            (press at A, release at B) had no route at all — the recorder was its only source.
            LAST, directly above the sentence it changes: it is the rarest choice here, and it
            PINS three of the controls above it (Mode, Clicks, Position). Reading it second, as it
            used to sit, meant meeting three dimmed segments before the thing that dimmed them. */}
        <div className="flex flex-col gap-1.5">
          <span className="label-micro text-text-tertiary">Form</span>
          <SegmentedControl<Form>
            value={form}
            onChange={setForm}
            ariaLabel="Click form"
            grow
            options={[
              { value: 'combined', label: 'One row', tip: tt('Press and release together', 'Aperta e solta numa linha') },
              { value: 'paired', label: 'Two rows', tip: tt('Down and Up as separate rows — needed for a drag', 'Down e Up em linhas separadas — preciso para arrastar') },
            ]}
          />
        </div>

        {/* Live-semantics strip — every input reads back as one sentence. Same always-render-all,
            show-one construction as the rest of this dialog, for the same height reason.
            THREE tones, not two: a dialog that has only just opened has not been answered yet,
            and painting that opening state in recording red said "you did something wrong" to a
            user who had done nothing at all. Neutral while the question is open, the action's own
            colour once it can be answered, and red kept for the one state that really is broken —
            half a release point, which Add refuses. */}
        {(() => {
          const tone = canConfirm
            ? 'var(--color-action-mouse-fg)'
            : releaseHalfFilled ? 'var(--color-recording)' : undefined;
          // The middot is load-bearing: a picked point already contains a comma, so
          // "at 300, 400 5×, 600 ms apart" ran the coordinate and the burst together.
          const times = clampRepeat(repeat) > 1 ? ` · ${clampRepeat(repeat)}×, ${formatMs(clampGap(gapMs), language)} ms apart` : '';
          const messages = [
            `Presses the ${btnLabel} button ${whereLabel}, holds ${holdLabel}, releases.`,
            `Clicks the ${btnLabel} button ${whereLabel}${times}.`,
            `Double-clicks ${whereLabel}${times}.`,
            `Triple-clicks ${whereLabel}${times}.`,
            'Pick a point, type X and Y, or switch to At cursor.',
            // The two paired readings. The drag one is the whole reason the form exists, so it
            // says the word: a reader who did not know the app could build one now does.
            `Two rows: presses the ${btnLabel} button ${whereLabel}, then releases there.`,
            upIsDrag
              ? `Two rows: presses the ${btnLabel} button ${whereLabel}, then releases at ${upPoint?.x}, ${upPoint?.y} — a drag.`
              : `Two rows: presses the ${btnLabel} button ${whereLabel}, then releases at ${upPoint?.x}, ${upPoint?.y} — within 2 px, so the app reads it as one click.`,
            // Two rows pins At cursor away, so the unanswered line must not offer it: the old
            // single message sent the user to a segment that is disabled in this very state.
            'Pick a point, or type X and Y.',
            'A drag needs both X and Y for the release.',
          ];
          const active = releaseHalfFilled ? 8
            : !canConfirm ? (paired ? 7 : 4)
            : paired ? (upPoint ? 6 : 5)
            : effectiveMode === 'hold' ? 0
            : effectiveClicks === 'double' ? 2
            : effectiveClicks === 'triple' ? 3
            : 1;
          return (
            <div
              className="border-l-2 rounded px-2.5 py-2 text-caption leading-relaxed grid"
              style={calloutStyle('neutral', tone)}
            >
              {messages.map((m, i) => (
                <span
                  key={i}
                  style={{ gridArea: '1 / 1' }}
                  className={i === active ? undefined : 'invisible'}
                  aria-hidden={i !== active}
                >
                  {m}
                </span>
              ))}
            </div>
          );
        })()}
      </div>
    </DialogShell>
  );
}
