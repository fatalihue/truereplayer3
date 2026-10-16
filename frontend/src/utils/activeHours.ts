// The active-hours arithmetic behind the Automation panel's schedule guard and its phase-lock
// warning. Pure and React-free so it can be proven head-lessly — the phase-lock warning shipped
// dead for want of two backslashes, and nothing would have caught that from the UI.
//
// Every reading here must agree with TriggerService.ParseActiveHours, which is the only opinion
// that decides behaviour: this side only warns.

/** The range form "HH:mm-HH:mm", or null. One helper because three places ask the same question —
 *  the summary, the schedule guard and the phase-lock warning. */
export function rangeParts(timeOfDay: string | null | undefined): { from: string; to: string } | null {
  const s = (timeOfDay ?? '').trim();
  const dash = s.indexOf('-');
  if (dash <= 0 || dash === s.length - 1) return null;
  const from = s.slice(0, dash).trim();
  const to = s.slice(dash + 1).trim();
  if (!from || !to || from === to) return null;
  // Compared as TIMES, as the backend compares them (TimeSpan equality): "09:00" and "9:00" are one
  // instant, a zero-width window it treats as unset. Compared as spellings, the panel labelled a
  // "09:00–9:00" window on an automation the daemon fires at any hour.
  const a = exactClockMs(from);
  if (a !== null && a === exactClockMs(to)) return null;
  return { from, to };
}

/** Milliseconds since midnight WITH the seconds and their fraction — equality the way TimeSpan
 *  sees it. clockSeconds drops the seconds on purpose (the window is read to the minute), so it
 *  would call "09:00:30" and "09:00" equal where the backend does not. Same clock grammar. */
function exactClockMs(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(\.\d+)?)?$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]), sec = m[3] != null ? Number(m[3]) : 0;
  if (h >= 24 || min >= 60 || sec >= 60) return null;
  return Math.round(((h * 60 + min) * 60 + sec + (m[4] ? Number(m[4]) : 0)) * 1000);
}

/** Seconds since midnight, or null when the half is not a clock. */
export function clockSeconds(hhmm: string): number | null {
  // The backslashes are not optional: `d{1,2}` matches the LETTER d, so this returned null for
  // every real clock and phaseLockRisk — the guard against "interval longer than the active
  // window", which can leave an automation armed and never firing — was dead from the day it
  // shipped. Seconds are accepted and ignored because the backend's ParseActiveHours uses
  // TimeSpan.TryParse, which takes "09:00:30"; this mirror must not be stricter than the side
  // that actually decides, or the warning goes quiet again on a hand-edited profile.
  // …and the MINUTE takes one or two digits for the same reason the hour does: TimeSpan.TryParse
  // accepts "9:0", so a hand-edited profile with a single-digit minute was read by the backend and
  // refused here — the warning went quiet again, by a narrower door than the one above. Optional
  // fractional seconds too ("09:00:30.5"), which TryParse also takes.
  // Deliberately NOT the day prefix TimeSpan also accepts: there, "1.09:00" means 33 hours and
  // "9" alone means nine DAYS, neither of which InsideActiveHours can ever match — reading them
  // as clocks would invent a window the backend does not have.
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  // The seconds COUNT, because they count for the backend: InsideActiveHours compares TimeSpans,
  // so "09:00:30-09:00:45" is a 15 s window there. Dropping them here made start == end and the
  // wrap branch read a full day — the one hand-edited window most likely to phase-lock went
  // silent (2026-10-16, a unit-test todo). They also have to be VALID, or the mirror ends up LOOSER
  // than the backend: TimeSpan.TryParse refuses "09:00:60", so accepting it here would invent an
  // active window, and a phase-lock warning about it, for a config the daemon cannot parse at all.
  const sec = m[3] != null ? Number(m[3]) : 0;
  if (sec >= 60) return null;
  return h < 24 && min < 60 ? h * 3600 + min * 60 + sec : null;
}

export const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * True when NO tick of this interval can ever land inside the window, for some starting phase.
 *
 * The ticks of a period P visit the clock at multiples of gcd(P, 24h): a 24 h interval hits one
 * instant a day, a 12 h interval two. If that spacing is WIDER than the window, a phase exists
 * where every tick misses — and the loop preserves phase when it skips, so the automation stays
 * armed, keeps reporting a next-due time, and never runs. Below the spacing, the pigeonhole
 * guarantees a hit and the pairing is always safe.
 *
 * A warning rather than a Save block: whether it actually locks depends on the arming moment, so
 * refusing the configuration outright would reject pairings that work.
 */
export function phaseLockRisk(t: { kind: string; timeOfDay?: string | null; intervalSeconds: number }): boolean {
  if (t.kind !== 'interval') return false;
  const r = rangeParts(t.timeOfDay);
  if (!r) return false;
  const start = clockSeconds(r.from);
  const end = clockSeconds(r.to);
  if (start == null || end == null) return false;
  // ParseActiveHours treats start == end as NO window (unset), so there is nothing to lock out.
  if (start === end) return false;
  const width = end > start ? end - start : 86400 - start + end;   // wraps midnight
  return gcd(Math.max(5, t.intervalSeconds), 86400) > width;
}
