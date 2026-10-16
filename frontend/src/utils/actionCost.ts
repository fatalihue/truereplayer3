import type { ActionItem } from '../bridge/messageTypes';
import { isClickHold } from './displayUtils';

/**
 * What one row costs the wall clock, and the defaults the engine falls back to when a row leaves
 * a knob unset. One module, because these numbers were literals in four places (ClickDialog,
 * KeystrokeCaptureDialog, SheetPanel, and — missing entirely — the StatusBar estimate) and the
 * one that never got them is the one that PROMISES a number to the user.
 *
 * Every constant here mirrors a C# constant by name; a change on that side belongs in the same
 * commit, the same rule ActionModeConverter and KnownActionTypes already carry.
 */

/** ActionItem.DefaultHoldDurationMs — what HoldKey and *ClickHold wait when the field is 0. */
export const DEFAULT_HOLD_MS = 1000;
/** The clamp both editors advertise and ExecuteRepeated re-applies at replay. */
export const MIN_HOLD_MS = 10;
export const MAX_HOLD_MS = 60000;

/** ActionItem.DefaultRepeatDelayMs — the gap between cycles of a single click / Keystroke × N. */
export const DEFAULT_CLICK_GAP_MS = 30;
/**
 * ActionItem.DefaultDoubleClickRepeatDelayMs — a multi-click × N needs clearance wider than the
 * system double-click window, or consecutive repeats blur into one long chain instead of
 * registering as distinct multi-clicks. Keyed on GetDoubleClickTime, not on the number of pairs,
 * so a triple needs the identical value.
 */
export const DEFAULT_MULTICLICK_GAP_MS = 600;

/**
 * ActionModeConverter.ClickCoordTolerance — how far a pair's two halves may sit apart and still
 * merge. A merge is a press and a release at "the same" point, and a hand-built pair is rarely
 * pixel-identical, so the converter allows this much slop. Anything reasoning ABOUT whether a
 * merge will be accepted has to use the same number, or it refuses what the converter would take.
 */
export const CLICK_COORD_TOLERANCE_PX = 2;

/** ExecuteRepeatedCore's defaultGap, per type. Keep in lockstep with the C# side. */
export const clickDefaultGap = (type: string): number =>
  type === 'DoubleClick' || type === 'TripleClick' ? DEFAULT_MULTICLICK_GAP_MS : DEFAULT_CLICK_GAP_MS;

/**
 * Per-action cost the estimate adds on top of the delays: the engine's dispatch, a click's
 * press/release, a keystroke's. Deliberately a floor.
 */
export const PER_ACTION_OVERHEAD_MS = 30;

/**
 * The dwell a row holds the button or key down for, or 0 for a row that holds nothing.
 *
 * This is AUTHORED time, never part of a recorded gap — which is exactly why the engine lists the
 * hold family in LongWaitActionTypes and resyncs after them, so not one millisecond of it is
 * absorbed by the next row's delay. It is additive to the sum of delays, by the engine's own
 * construction, and an estimate that reads only `delay` is short by the whole thing.
 */
export function rowDwellMs(a: ActionItem): number {
  if (!isClickHold(a.actionType) && a.actionType !== 'HoldKey') return 0;
  const raw = a.holdDurationMs ?? 0;
  return raw > 0 ? Math.max(MIN_HOLD_MS, Math.min(MAX_HOLD_MS, raw)) : DEFAULT_HOLD_MS;
}

/**
 * ActionExecution.DoubleClickGapMs — MultiClickPairs sleeps this between consecutive press/release
 * pairs so the OS reads them as one multi-click instead of separate taps.
 */
export const MULTI_CLICK_PAIR_GAP_MS = 50;

/**
 * Time a row spends INSIDE itself, beyond any dwell: the gaps a multi-click holds between its own
 * pairs. A DoubleClick is two pairs (one gap), a TripleClick three (two).
 *
 * Not an exotic case any more, which is why it is worth charging: since the recorder's merge chain
 * (2.44.0) an ordinary recording PRODUCES these rows, and the engine also treats them as long
 * enough to resync after — the estimate was charging a flat per-action floor for a row the engine
 * itself classifies as taking real time.
 */
export function rowBodyMs(a: ActionItem): number {
  if (a.actionType === 'DoubleClick') return MULTI_CLICK_PAIR_GAP_MS;
  if (a.actionType === 'TripleClick') return MULTI_CLICK_PAIR_GAP_MS * 2;
  return 0;
}

/**
 * The rows the engine replays through ExecuteRepeated / ExecuteRepeatedCore (ActionExecution.cs:
 * `case "Keystroke"`, the five clicks and the three *ClickHold) — the only ones Times and the gap
 * apply to. Every other type runs once, whatever RepeatCount it carries: a HoldKey is a single
 * down / delay / up (so it pays its dwell ONCE however high Times is), and a KeyDown or SendText
 * that kept an old RepeatCount through a type change is not repeated either. RunProfile loops in
 * its own handler (HandleRunProfile) with nothing between passes, and the estimate charges the
 * call itself, not the called profile.
 */
const REPEATED_TYPES = new Set([
  'Keystroke', 'LeftClick', 'RightClick', 'MiddleClick', 'DoubleClick', 'TripleClick',
  'LeftClickHold', 'RightClickHold', 'MiddleClickHold',
]);

/**
 * What ONE row costs: its delay, the per-action floor, and the time the row itself spends.
 *
 * The row spends time two ways the grid can read exactly, and both used to be invisible to the
 * estimate:
 *   • a HOLD keeps the button or key down for its dwell (see rowDwellMs);
 *   • × N replays the row `repeatCount` times with a gap between cycles — (N-1) gaps, not N,
 *     because the gap is between them — for the REPEATED_TYPES only.
 * Neither is a guess the way a smooth move (distance-bound) or a wait (timeout-bound) is: both
 * are integers sitting on the row, already drawn in the Details column.
 */
export function actionCostMs(a: ActionItem): number {
  const base = (a.delay > 0 ? a.delay : 0) + PER_ACTION_OVERHEAD_MS;
  const dwell = rowDwellMs(a);
  const body = rowBodyMs(a);
  // Only a repeated type multiplies: charging (N-1) gaps to a HoldKey × 5 or a KeyDown × 4 that
  // the engine runs once invented time the run never spends (1150 ms for a 1 s HoldKey × 5).
  const repeats = REPEATED_TYPES.has(a.actionType) ? Math.max(1, Math.min(999, a.repeatCount ?? 1)) : 1;
  if (repeats === 1) return base + dwell + body;
  const gap = Math.max(0, Math.min(5000, a.repeatDelayMs ?? clickDefaultGap(a.actionType)));
  return base + repeats * (dwell + body) + (repeats - 1) * gap;
}
