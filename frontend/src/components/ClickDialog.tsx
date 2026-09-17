import { useState, useRef, useEffect, useCallback } from 'react';
import { Mouse, Crosshair } from 'lucide-react';
import { NumberInput } from './common/NumberInput';
import { DialogShell, DialogFooter } from './common/DialogShell';
import { DurationChips } from './common/DurationChips';
import { SegmentedControl } from './common/SegmentedControl';
import { useBridge } from '../bridge/BridgeContext';
import { useLanguage, useTt } from '../state/LanguageContext';
import { formatMs } from '../utils/displayUtils';

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

/** Shared with the Sheet's Hold field and the Send Keystroke dialog's hold mode: one range and
 *  one set of presets for both halves of the feature (C# clamps 10..60000 identically). */
const HOLD_PRESETS = [100, 500, 1000, 5000, 30000];
const MIN_HOLD_MS = 10;
const MAX_HOLD_MS = 60000;
const DEFAULT_HOLD_MS = 1000;
const clampHold = (v: number) => Math.max(MIN_HOLD_MS, Math.min(MAX_HOLD_MS, Math.floor(v)));

const MAX_REPEAT = 999;
const MAX_REPEAT_DELAY = 5000;
const clampRepeat = (v: number) => Math.max(1, Math.min(MAX_REPEAT, Math.floor(v)));
const clampGap = (v: number) => Math.max(0, Math.min(MAX_REPEAT_DELAY, Math.floor(v)));

/** Per-type inter-repeat gap, mirroring ActionItem.DefaultRepeatDelayMs /
 *  DefaultDoubleClickRepeatDelayMs and the Sheet's clickDefaultGap: a multi-click burst has to
 *  clear the system double-click window or the repeats blur into one long chain. */
const DEFAULT_CLICK_GAP_MS = 30;
const DEFAULT_MULTICLICK_GAP_MS = 600;
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
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [form, setForm] = useState<Form>('combined');
  // The Up half's own point. null = the release lands where the press did (the plain split);
  // set = a DRAG, which is the only thing in the app that needs two points in one gesture and
  // the reason this dialog grew a second picker at all.
  const [upPoint, setUpPoint] = useState<{ x: number; y: number } | null>(null);

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
  const effectiveClicks: Clicks = paired ? 'single' : clicks;
  const effectivePosition: 'point' | 'cursor' = paired ? 'point' : position;

  const multi = effectiveClicks !== 'single';
  const effectiveButton: ClickButton = multi ? 'Left' : button;

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
        if (pickTargetRef.current === 'release') setUpPoint({ x: r.x, y: r.y });
        else setPoint({ x: r.x, y: r.y });
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
  // the plain split. Only a drag needs the second one, and a drag is the rarer ask.
  const canConfirm = pickRequestId == null && (effectivePosition === 'cursor' || point != null);

  const handleConfirm = () => {
    if (!canConfirm) return;
    const where = effectivePosition === 'cursor'
      ? { atCursor: true as const }
      : { atCursor: false as const, x: point!.x, y: point!.y };
    if (paired) {
      onConfirm({
        actionType, ...where, paired: true,
        ...(upPoint ? { upX: upPoint.x, upY: upPoint.y } : {}),
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
  const whereLabel = position === 'cursor'
    ? 'wherever the mouse is'
    : point ? `at ${point.x}, ${point.y}` : 'at —';
  const btnLabel = effectiveButton.toLowerCase();

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
            Keystroke dialog's Press/Hold: one dialog per input device, not one per action type. */}
        <SegmentedControl<Mode>
          value={effectiveMode}
          onChange={setMode}
          ariaLabel="Click mode"
          grow
          className={paired ? 'opacity-50 pointer-events-none' : undefined}
          options={[
            { value: 'click', label: 'Click' },
            { value: 'hold', label: 'Hold' },
          ]}
        />

        {/* FORM — one row, or two. Until this control existed the dialog could only write the
            combined shape, the Sheet's picker could only change which BUTTON a row used, and the
            only way to get a paired click was to convert the WHOLE profile. So a hand-built DRAG
            (press at A, release at B) had no route at all — the recorder was its only source. */}
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
            className={multi ? 'opacity-50 pointer-events-none' : undefined}
            options={[
              { value: 'Left', label: 'Left' },
              { value: 'Right', label: 'Right' },
              { value: 'Middle', label: 'Middle' },
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
            className={paired ? 'opacity-50 pointer-events-none' : undefined}
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
              <div className="flex items-stretch gap-1.5">
                <button
                  type="button"
                  // Wrapped, not passed by reference: handlePick now takes the target, and a bare
                  // onClick={handlePick} would hand it the MouseEvent as that argument.
                  onClick={() => handlePick('press')}
                  disabled={effectivePosition !== 'point' || pickRequestId != null}
                  className="flex-1 h-8 flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium border border-border-default bg-bg-elevated hover:bg-bg-card text-text-secondary hover:text-text-primary rounded whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Crosshair size={13} />
                  {pickRequestId != null ? 'Picking…' : point ? 'Pick again' : 'Pick from screen'}
                </button>
                <div className="h-8 shrink-0 flex items-center px-2.5 rounded border border-border-subtle bg-bg-input text-xs font-mono tabular-nums text-text-secondary">
                  {point ? `${point.x}, ${point.y}` : '—'}
                </div>
              </div>
            </div>
            <div
              style={{ gridArea: '1 / 1' }}
              className={effectivePosition === 'cursor' ? 'flex items-center' : 'invisible'}
              aria-hidden={effectivePosition !== 'cursor'}
            >
              <span className="text-[11px] leading-relaxed text-text-tertiary">
                {'The point is read from the mouse when the step runs.'}
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
            <div className="flex flex-col gap-1.5">
              <span className="label-micro text-text-tertiary">Clicks</span>
              <SegmentedControl<Clicks>
                value={clicks}
                onChange={changeClicks}
                ariaLabel="Clicks per step"
                grow
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

            <div className="flex items-center justify-between gap-3">
              <label className="text-[12px] font-medium text-text-secondary">Times to repeat</label>
              <NumberInput
                value={repeat}
                onChange={(n) => setRepeat(clampRepeat(n))}
                min={1}
                max={MAX_REPEAT}
                inputWidth="w-24"
                inputHeight="h-8"
                ghostSuffix="ms"
                ariaLabel="Repeat count"
              />
            </div>

            {/* Gap stays visible but dims when Times = 1 — it communicates that the field exists
                for repeat-flavoured clicks without making the dialog jump when Times changes. */}
            <div className="flex items-center justify-between gap-3">
              <label className={`text-[12px] font-medium transition-colors ${repeat > 1 ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                Gap between clicks
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

          {/* ── HOLD mode ── */}
          <div
            className={`flex flex-col gap-2.5 ${mode === 'hold' ? '' : 'invisible pointer-events-none'}`}
            style={{ gridArea: '1 / 1' }}
            aria-hidden={mode !== 'hold'}
          >
            <div className="flex items-center justify-between gap-3">
              <label className="text-[12px] font-medium text-text-secondary">Hold</label>
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
            <DurationChips presets={HOLD_PRESETS} value={holdMs} onSelect={(ms) => setHoldMs(clampHold(ms))} />
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
              <div className="flex items-stretch gap-1.5">
                <button
                  type="button"
                  onClick={() => handlePick('release')}
                  disabled={!paired || pickRequestId != null}
                  className="flex-1 h-8 flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium border border-border-default bg-bg-elevated hover:bg-bg-card text-text-secondary hover:text-text-primary rounded whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Crosshair size={13} />
                  {pickRequestId != null ? 'Picking…' : upPoint ? 'Pick again' : 'Same point'}
                </button>
                <div className="h-8 shrink-0 flex items-center px-2.5 rounded border border-border-subtle bg-bg-input text-xs font-mono tabular-nums text-text-secondary">
                  {upPoint ? `${upPoint.x}, ${upPoint.y}` : '—'}
                </div>
              </div>
            </div>
            {/* Always rendered so the body's height does not move when a release point appears;
                the Clear affordance only lights up once there is something to clear. */}
            <button
              type="button"
              onClick={() => setUpPoint(null)}
              disabled={!upPoint}
              className="self-start text-[11px] leading-relaxed text-text-tertiary hover:text-text-secondary disabled:opacity-40 disabled:cursor-default transition-colors"
            >
              {upPoint
                ? tt('Release somewhere else — this is a drag. Clear it?', 'Solta em outro lugar — isto é um arrasto. Limpar?')
                : tt('Leave it empty and the release lands on the press point.', 'Deixe vazio e a soltura cai no ponto da pressão.')}
            </button>
          </div>
        </div>

        {/* Live-semantics strip — every input reads back as one sentence. Same always-render-all,
            show-one construction as the rest of this dialog, for the same height reason. The
            unanswered state is a config error (Add stays disabled) → recording tone. */}
        {(() => {
          const tone = canConfirm ? 'var(--color-action-mouse-fg)' : 'var(--color-recording)';
          // The middot is load-bearing: a picked point already contains a comma, so
          // "at 300, 400 5×, 600 ms apart" ran the coordinate and the burst together.
          const times = clampRepeat(repeat) > 1 ? ` · ${clampRepeat(repeat)}×, ${formatMs(clampGap(gapMs), language)} ms apart` : '';
          const messages = [
            `Presses the ${btnLabel} button ${whereLabel}, holds ${holdLabel}, releases.`,
            `Clicks the ${btnLabel} button ${whereLabel}${times}.`,
            `Double-clicks ${whereLabel}${times}.`,
            `Triple-clicks ${whereLabel}${times}.`,
            'Pick a point on screen, or switch to At cursor.',
            // The two paired readings. The drag one is the whole reason the form exists, so it
            // says the word: a reader who did not know the app could build one now does.
            `Two rows: presses the ${btnLabel} button ${whereLabel}, then releases there.`,
            `Two rows: presses the ${btnLabel} button ${whereLabel}, then releases at ${upPoint?.x}, ${upPoint?.y} — a drag.`,
          ];
          const active = !canConfirm ? 4
            : paired ? (upPoint ? 6 : 5)
            : effectiveMode === 'hold' ? 0
            : effectiveClicks === 'double' ? 2
            : effectiveClicks === 'triple' ? 3
            : 1;
          return (
            <div
              className="border-l-2 rounded px-2.5 py-2 text-[11px] leading-relaxed grid"
              style={{
                background: `color-mix(in srgb, ${tone} 8%, transparent)`,
                borderColor: tone,
                color: tone,
              }}
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
