import type { ActionItem, ProfileDataTable, ProfileLoopState } from '../../bridge/messageTypes';
import type { LastRunSummary } from '../../logic/useReplay';
import { actionCostMs } from '../../utils/actionCost';
import { skippedRowMask } from '../../utils/conditionalBlocks';
import { lastRunKind } from '../../utils/lastRunChip';
import { replayPasses } from '../../utils/replayPasses';

/**
 * What the macro's header says, worked out from the store. Pure, like the library's model, so the
 * numbers it promises can be checked without a screen.
 */

/**
 * One pass, as the list can promise it: the delays, ~30 ms a step, holds and the gaps of × N
 * (utils/actionCost). The steps the engine skips cost nothing. Moves and waits cannot be read off
 * the list and are left out; the tooltip says so.
 */
export function onePassMs(actions: ActionItem[]): number {
  const skipped = skippedRowMask(actions);
  return actions.reduce((sum, a, i) => (skipped[i] ? sum : sum + actionCostMs(a)), 0);
}

/** One pass per row of the Data Loop table, when it drives the run. */
export const runsPerRow = (table: ProfileDataTable) => table.loopOverData && table.rows.length > 0;

/**
 * How many passes Replay makes: one per data row, else the macro's Loops (1 when they are off).
 * The macro's own Toggle or While-pressed hotkey loops without end, but only that hotkey: the
 * button and the global Replay hotkey run the count, which is what this describes.
 */
export function passesOf(loop: ProfileLoopState, table: ProfileDataTable): number {
  return replayPasses({
    perRow: runsPerRow(table),
    forcedInfinite: false,
    loopEnabled: loop.enabled,
    loopCount: loop.count,
    rowCount: table.rows.length,
  }) ?? 1;
}

/** The Loops field: the count while they are on, 1 while they are off — the passes they make. */
export const loopsShown = (loop: ProfileLoopState) => (loop.enabled ? loop.count : '1');

/** "450 ms", "3.5 s", "2 min 5 s", "1 h 4 min". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 59_950) return `${Number((ms / 1000).toFixed(1))} s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 3600) {
    const s = seconds % 60;
    return s ? `${Math.floor(seconds / 60)} min ${s} s` : `${seconds / 60} min`;
  }
  const minutes = Math.round(seconds / 60);
  const m = minutes % 60;
  return m ? `${Math.floor(minutes / 60)} h ${m} min` : `${minutes / 60} h`;
}

/** A clock that runs: "0:04", "12:30", "1:02:03". */
export function formatClock(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = String(totalSeconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "14:02" (or "2:02 PM"), in the user's own clock. */
export function timeOfDay(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "1 step", "18 steps". */
export const stepCount = (n: number) => (n === 1 ? '1 step' : `${n} steps`);

/**
 * How the last run of the open macro ended, after "last run 14:02,". The user's own Stop outranks
 * failures the skip policy absorbed (utils/lastRunChip). A run that halted inside a macro it ran
 * names that macro: its steps are not the ones on screen.
 */
export function lastRunOutcome(run: LastRunSummary, open: string): string {
  switch (lastRunKind(run)) {
    case 'halted':
      return run.failedProfile && run.failedProfile !== open
        ? `stopped at step ${run.failedRow} in ${run.failedProfile}`
        : `stopped at step ${run.failedRow}`;
    case 'failed': return 'it failed';
    case 'stopped': return 'stopped by you';
    case 'partial': return `${stepCount(run.failedCount)} failed`;
    default: return 'no errors';
  }
}
