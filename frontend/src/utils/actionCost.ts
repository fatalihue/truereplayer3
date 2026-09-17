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
 * What ONE row costs: its delay, the per-action floor, and the time the row itself spends.
 *
 * The row spends time two ways the grid can read exactly, and both used to be invisible to the
 * estimate:
 *   • a HOLD keeps the button or key down for its dwell (see rowDwellMs);
 *   • × N replays the row `repeatCount` times with a gap between cycles — (N-1) gaps, not N,
 *     because the gap is between them.
 * Neither is a guess the way a smooth move (distance-bound) or a wait (timeout-bound) is: both
 * are integers sitting on the row, already drawn in the Details column.
 */
export function actionCostMs(a: ActionItem): number {
  const base = (a.delay > 0 ? a.delay : 0) + PER_ACTION_OVERHEAD_MS;
  const dwell = rowDwellMs(a);
  const repeats = Math.max(1, Math.min(999, a.repeatCount ?? 1));
  if (repeats === 1) return base + dwell;
  const gap = Math.max(0, Math.min(5000, a.repeatDelayMs ?? clickDefaultGap(a.actionType)));
  return base + repeats * dwell + (repeats - 1) * gap;
}
