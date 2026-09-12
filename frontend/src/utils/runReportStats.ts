/**
 * How long the run took — one answer, for every surface that shows it.
 *
 * The status bar's chip reads the engine's own clock (`elapsedMs`, wall time minus the time the
 * user had it paused). The Run report, one click away, kept summing the per-step costs, which is
 * a different and always smaller number: it counts the time INSIDE the steps and nothing between
 * them. The same execution therefore reported two durations on two surfaces, and the panel's own
 * type already warned that the sum is not the duration.
 */

export interface DurationFacts {
  /** The engine's clock. Absent on reports from a build that predates the field. */
  elapsedMs?: number | null;
}

export interface DurationStep {
  durationMs: number;
  status?: string;
}

export interface RunDuration {
  /** What to show. */
  totalMs: number;
  /** True when it came from the engine's clock rather than the legacy sum. */
  wallClock: boolean;
  /** The sum of step costs, kept for the "time inside the steps" reading. */
  actionsMs: number;
}

export function runDurationMs(report: DurationFacts | null | undefined, steps: DurationStep[]): RunDuration {
  const actionsMs = steps.reduce((a, s) => a + (s.durationMs || 0), 0);
  // A report pulled while the run is still going carries elapsedMs 0 — ResetRunReport cleared it
  // and FinishRunReport has not run yet. `?? ` accepts 0 happily, so the chip froze at "0 ms" and
  // the real number, pushed at the end, never replaced it. Two gates, because either one alone
  // lets a case through: a step still running says "not finished", and 0 says "never stamped".
  const running = steps.some((s) => s.status === 'running');
  const wall = !running && report?.elapsedMs != null && report.elapsedMs > 0 ? report.elapsedMs : null;
  return { totalMs: wall ?? actionsMs, wallClock: wall != null, actionsMs };
}
