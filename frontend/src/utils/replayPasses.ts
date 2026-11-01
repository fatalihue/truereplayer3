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

import { tryParseInt32 } from './int32';

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
  // The engine's parse (StartReplay: int.TryParse), not parseInt: parseInt read "12abc" as 12,
  // "3.5" as 3 and an out-of-Int32 count as itself, where the engine fails the parse and runs ONE
  // pass. Only a hand-edited profile carries such a value (the UI clamps 1–999), but the estimate
  // should not promise twelve passes the run will not make.
  const n = tryParseInt32(f.loopCount);
  // count 0 means "forever" to the engine, and a blank or broken field falls back to one pass —
  // the same reading the chip makes, so the two cannot disagree.
  if (n === null || n < 0) return 1;
  return n === 0 ? null : n;
}
