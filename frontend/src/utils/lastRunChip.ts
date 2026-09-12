/**
 * How the last run ended, as ONE decision.
 *
 * The status bar asked this question three times — once for the colour, once for the icon, once
 * for the label — and the three ternaries had drifted apart: all of them ranked "some steps
 * failed" ABOVE "the user pressed Stop", so aborting a batch that already had absorbed failures
 * reported "2 steps failed" and the interruption vanished from the screen. The one the user
 * performed outranks the one the policy absorbed.
 *
 * Extracted to utils/ rather than kept in the .tsx for the usual reason: a helper inside a
 * component cannot be exercised from Node without dragging React in with it.
 */

export type LastRunKind =
  /** The run HALTED on a failing step — it names the step. */
  | 'halted'
  /** The engine reported an error ending without a halting step. */
  | 'failed'
  /** The user pressed Stop. */
  | 'stopped'
  /** Reached the end, but rows failed on the way and the skip policy absorbed them. */
  | 'partial'
  /** Reached the end with nothing failed. */
  | 'ok';

export interface LastRunFacts {
  /** Set only when the run actually halted on that step. */
  failedRow: number | null;
  /** Steps that failed, however the run ended. */
  failedCount: number;
  outcome: 'completed' | 'stopped' | 'failed' | null;
  /** Profile the halting step belongs to — a sub-profile's rows restart at 1. */
  failedProfile?: string | null;
  /** The profile whose grid is on screen, to decide whether the row number is meaningful. */
  loadedProfile?: string | null;
}

export function lastRunKind(r: LastRunFacts): LastRunKind {
  if (r.failedRow != null) return 'halted';
  if (r.outcome === 'failed') return 'failed';
  if (r.outcome === 'stopped') return 'stopped';
  if (r.failedCount > 0) return 'partial';
  return 'ok';
}

export function lastRunLabel(r: LastRunFacts): string {
  switch (lastRunKind(r)) {
    case 'halted': {
      // Rows restart at 1 inside every RunProfile sub-call, so "stopped at step 7" pointed at
      // line 7 of a grid that was never running — often a line that does not even exist there.
      // Naming the profile is what makes the number mean something.
      const foreign = r.failedProfile && r.loadedProfile && r.failedProfile !== r.loadedProfile;
      return foreign
        ? `stopped at step ${r.failedRow} in ${r.failedProfile}`
        : `stopped at step ${r.failedRow}`;
    }
    case 'failed': return 'run failed';
    case 'stopped': return 'stopped by you';
    case 'partial': return `${r.failedCount} step${r.failedCount === 1 ? '' : 's'} failed`;
    default: return 'last run';
  }
}
