/**
 * How many passes the next Replay will make — the engine's precedence chain, in one place.
 *
 * The ActionBar's Loop chip already answers this for the user ("per row" / "∞" / "12×"), and the
 * order below IS the engine's (StartReplay + SetForceInfiniteLoop): loop-over-data beats a forced
 * infinite trigger, which beats the profile's own count. The status bar's duration estimate did
 * not ask at all — it costed ONE pass — so a profile set to repeat 12× promised a twelfth of the
 * time it was going to take, and a 40-row data profile promised a fortieth.
 *
 * Returns null for "unbounded", which no estimate can put a number on.
 */

export interface PassFacts {
  /** The data table drives the run (loop over data ON with rows present). */
  perRow: boolean;
  /** The LIVE run is unbounded — the engine's loop total is 0. Only a profile's own Toggle /
   *  While-pressed hotkey starts one; the Replay button and the global Replay hotkey run the
   *  count, so the trigger mode alone must never set this. */
  forcedInfinite: boolean;
  /** The profile's own repeat switch. */
  loopEnabled: boolean;
  /** The profile's repeat count, as the store holds it (a string, straight from the input). */
  loopCount: string;
  /** Rows in the data table. */
  rowCount: number;
}

export function replayPasses(f: PassFacts): number | null {
  if (f.perRow) return f.rowCount > 0 ? f.rowCount : null;
  if (f.forcedInfinite) return null;
  if (!f.loopEnabled) return 1;
  const n = Number.parseInt(f.loopCount, 10);
  // count 0 means "forever" to the engine, and a blank or broken field falls back to one pass —
  // the same reading the chip makes, so the two cannot disagree.
  if (!Number.isFinite(n) || n < 0) return 1;
  return n === 0 ? null : n;
}

/**
 * The estimate for a whole Replay: one pass, repeated, with the configured gap in between.
 * The gap falls BETWEEN passes, so N passes carry N-1 gaps — charging N of them added an
 * interval the run never waits, which is exactly the kind of small lie that makes a user stop
 * trusting the number.
 */
export function estimateAllPassesMs(onePassMs: number, passes: number | null, intervalMs: number): number | null {
  if (passes == null) return null;
  const gaps = Math.max(0, passes - 1) * Math.max(0, intervalMs);
  return onePassMs * passes + gaps;
}
