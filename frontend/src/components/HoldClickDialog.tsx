import { useState, useRef, useEffect, useCallback } from 'react';
import { Timer, Crosshair } from 'lucide-react';
import { NumberInput } from './common/NumberInput';
import { DialogShell, DialogFooter } from './common/DialogShell';
import { DurationChips } from './common/DurationChips';
import { SegmentedControl } from './common/SegmentedControl';
import { useBridge } from '../bridge/BridgeContext';
import { useLanguage } from '../state/LanguageContext';
import { formatMs } from '../utils/displayUtils';

export type HoldClickButton = 'Left' | 'Right' | 'Middle';

export interface HoldClickResult {
  button: HoldClickButton;
  holdDurationMs: number;
  /** Omitted when atCursor — the row resolves its point at replay time. */
  x?: number;
  y?: number;
  atCursor: boolean;
}

interface HoldClickDialogProps {
  onConfirm: (result: HoldClickResult) => void;
  onClose: () => void;
}

/**
 * Insert Click & Hold — the mouse twin of the Send Keystroke dialog's Hold mode.
 *
 * Pattern B (the PauseDialog shape): the dialog gathers button + point + duration UP FRONT and
 * only then inserts, so Cancel leaves no orphan row behind. That matters more here than for any
 * other insert: this is the FIRST click row the app can create without recording one, and the
 * expensive half is the coordinate — a half-built click row in the grid would be a click at 0,0.
 *
 * The point comes from the same native picker the Sheet uses (mouse:pickPosition →
 * mouse:positionPicked, correlated by requestId): the app minimises, the next click anywhere on
 * screen is the answer. "At cursor" is the other way to answer the question — it says the point
 * is not knowable until run time — and it is the only mode that may confirm without a pick.
 */

/** Shared with the Sheet's Hold field and the Send Keystroke dialog's hold mode: one range and
 *  one set of presets for both halves of the feature (C# clamps 10..60000 identically). */
const HOLD_PRESETS = [100, 500, 1000, 5000, 30000];
const MIN_HOLD_MS = 10;
const MAX_HOLD_MS = 60000;
const DEFAULT_HOLD_MS = 1000;
const clampHold = (v: number) => Math.max(MIN_HOLD_MS, Math.min(MAX_HOLD_MS, Math.floor(v)));

/** Coarser steps once we're in whole-second territory; 100 ms below 1 s. Same rule the
 *  Send Keystroke and Pause dialogs use, so every duration spinner in the app feels alike. */
const stepFor = (ms: number) => (ms >= 1000 ? 1000 : 100);

export function HoldClickDialog({ onConfirm, onClose }: HoldClickDialogProps) {
  const { language } = useLanguage();
  const { send, subscribe } = useBridge();

  const [button, setButton] = useState<HoldClickButton>('Left');
  const [holdMs, setHoldMs] = useState<number>(DEFAULT_HOLD_MS);
  const [mode, setMode] = useState<'point' | 'cursor'>('point');
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  // Single in-flight pick, correlated by id — the Sheet's pattern. A reply whose id doesn't
  // match is a stale round-trip from a picker this dialog no longer owns and must be ignored,
  // or a late answer would write a point over one the user already picked.
  const [pickRequestId, setPickRequestId] = useState<string | null>(null);
  const pickRequestIdRef = useRef<string | null>(null);
  useEffect(() => { pickRequestIdRef.current = pickRequestId; }, [pickRequestId]);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      if (msg.type !== 'mouse:positionPicked') return;
      const r = msg.payload;
      if (!pickRequestIdRef.current || r.requestId !== pickRequestIdRef.current) return;
      // cancelled covers the refused case too (refused rides ALONG with cancelled, never
      // instead of it — see the message's note), so one branch handles both: nothing was
      // picked, the previous point stands, and the button comes back out of "Picking…".
      if (!r.cancelled && r.x != null && r.y != null) setPoint({ x: r.x, y: r.y });
      setPickRequestId(null);
    });
    return unsub;
  }, [subscribe]);

  const handlePick = useCallback(() => {
    const requestId = Math.random().toString(36).slice(2, 10);
    setPickRequestId(requestId);
    send({ type: 'mouse:pickPosition', payload: { requestId } });
  }, [send]);

  // At cursor needs no point; This point needs one. A pick still in flight is not an answer yet.
  const canConfirm = pickRequestId == null && (mode === 'cursor' || point != null);

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(mode === 'cursor'
      ? { button, holdDurationMs: clampHold(holdMs), atCursor: true }
      : { button, holdDurationMs: clampHold(holdMs), atCursor: false, x: point!.x, y: point!.y });
  };

  const holdLabel = `${formatMs(clampHold(holdMs), language)} ms`;

  return (
    <DialogShell
      icon={<Timer size={14} style={{ color: 'var(--color-action-mouse-fg)' }} />}
      title="Insert Click & Hold"
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
        {/* BUTTON — which one is held. Three named things, so a segmented control rather than
            a dropdown: all the options fit, and the choice reads without opening anything. */}
        <div className="flex flex-col gap-1.5">
          <span className="label-micro text-text-tertiary">Button</span>
          <SegmentedControl<HoldClickButton>
            value={button}
            onChange={setButton}
            ariaLabel="Mouse button to hold"
            grow
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
          <SegmentedControl<'point' | 'cursor'>
            value={mode}
            onChange={setMode}
            ariaLabel="Click position source"
            grow
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
              className={mode === 'point' ? undefined : 'invisible'}
              aria-hidden={mode !== 'point'}
            >
              <div className="flex items-stretch gap-1.5">
                <button
                  type="button"
                  onClick={handlePick}
                  disabled={mode !== 'point' || pickRequestId != null}
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
              className={mode === 'cursor' ? 'flex items-center' : 'invisible'}
              aria-hidden={mode !== 'cursor'}
            >
              <span className="text-[11px] leading-relaxed text-text-tertiary">
                {'The point is read from the mouse when the step runs.'}
              </span>
            </div>
          </div>
        </div>

        {/* HOLD — label + field on one row (the Pause dialog's row style), presets below.
            No ∞ preset: a hold with no end would latch the button down for the rest of the
            run, and the engine's 60 s ceiling exists to make that unreachable. */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <label className="text-[12px] font-medium text-text-secondary">Hold</label>
            <NumberInput
              value={holdMs}
              onChange={(n) => setHoldMs(clampHold(n))}
              min={MIN_HOLD_MS}
              max={MAX_HOLD_MS}
              step={stepFor(holdMs)}
              thousands
              inputWidth="w-24"
              inputHeight="h-8"
              suffix="ms" suffixInside
              ariaLabel="Hold duration in milliseconds"
            />
          </div>
          <DurationChips presets={HOLD_PRESETS} value={holdMs} onSelect={(ms) => setHoldMs(clampHold(ms))} />
        </div>

        {/* Live-semantics strip — the three inputs read back as one sentence. Same always-render
            -all, show-one construction as the rest of this dialog, for the same height reason.
            The unanswered state is a config error (Add stays disabled) → recording tone. */}
        {(() => {
          const tone = canConfirm ? 'var(--color-action-mouse-fg)' : 'var(--color-recording)';
          const btn = button.toLowerCase();
          const messages = [
            `Presses the ${btn} button at ${point ? `${point.x}, ${point.y}` : '—'}, holds ${holdLabel}, releases.`,
            `Presses the ${btn} button wherever the mouse is, holds ${holdLabel}, releases.`,
            'Pick a point on screen, or switch to At cursor.',
          ];
          const active = mode === 'cursor' ? 1 : point ? 0 : 2;
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
