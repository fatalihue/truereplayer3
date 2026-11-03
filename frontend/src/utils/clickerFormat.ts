// Shared formatters for Clicker live stats — consumed by StatusBar (compact one-line
// readout) and ClickerDashboard (large hero + grid). Keeping one source of truth so the
// "rate >= 10 → integer, else 1 decimal" rule + MM:SS convention stay consistent.
import { LANG } from '../i18n';

export interface ClickerStatsView {
  elapsed: string;     // "M:SS"
  rate: number;        // clicks per second (raw)
  rateLabel: string;   // "9.8" or "120"
}

// The decimal mark is this build's language's ("9.8" / "9,8"), with no thousands: a rate is at most
// 200 a second, and what the Rate field shows is typed back. Made on first use, never at the
// opening: an Intl object is not free.
let whole: Intl.NumberFormat | undefined;
let oneDecimal: Intl.NumberFormat | undefined;
let upToOneDecimal: Intl.NumberFormat | undefined;

// Integer-only above 10 CPS — at high rates a trailing ".0" reads as noise; at low
// rates the decimal carries useful precision (1.2/s vs 1.8/s).
// Shared by the MEASURED rate (dashboard) and the TARGET rate (settings, status bar) so
// the two can never format differently for the same number.
export function formatRate(rate: number): string {
  // Decided on the value AS ROUNDED to one decimal: 9.96 rounds to "10.0", the very ".0" this rule
  // exists to drop, and a measured rate lands there (996 clicks in 100 s).
  return Math.round(rate * 10) / 10 >= 10
    ? (whole ??= new Intl.NumberFormat(LANG, { maximumFractionDigits: 0, useGrouping: false })).format(rate)
    : (oneDecimal ??= new Intl.NumberFormat(LANG, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })).format(rate);
}

/** A number with one decimal at most and no thousands, in this build's language: "9.8" / "9,8", "20", "1.5". */
export function formatTenths(x: number): string {
  return (upToOneDecimal ??= new Intl.NumberFormat(LANG, { maximumFractionDigits: 1, useGrouping: false })).format(x);
}

/** "M:SS" — the one clock format every Clicker surface uses (elapsed, the Time limit, the ETA). */
export function formatClock(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// ── Engine truth ────────────────────────────────────────────────────────────────────
//
// These mirror ReplayService.ToggleCursorClickReplay (Source/ActionExecution.cs). The UI
// used to compute its rate as 1000/delay, which ignored the hold and the interval — so the
// shipped default reported 10/s while the engine ran ~9.1/s, and the "200/s" preset was
// simply unreachable. Anything here that drifts from the C# is a bug on this side; keep
// the two in step.
//
// Jitter is deliberately absent: it is a symmetric scatter (Random.Next(-v, v+1)), so it
// perturbs individual periods without moving the mean. Adding it here would be wrong.

/** Math.Clamp(config.DelayMs, MinClickPeriodMs, ...) — ActionExecution.cs MinClickPeriodMs. */
export const CLICK_PERIOD_FLOOR_MS = 5;
/** Math.Clamp(holdMs, 0, 2000) — ActionExecution.cs safeHold. */
export const CLICK_HOLD_MAX_MS = 2000;
/** ActionExecution.cs MaxClickPeriodMs — the ceiling on BOTH the delay and the loop interval. */
export const CLICK_PERIOD_CEILING_MS = 60000;

/** One full cycle: the engine schedules against this, with hold absorbed INSIDE it. Both halves
 *  are clamped exactly as ActionExecution clamps them (basePeriod to [5, 60000], loopInterval to
 *  [0, 60000]); the UI bounds its own inputs, but a hand-edited setting or preset reached the
 *  engine's cap while this kept promising the raw number. */
export function clickPeriodMs(delayMs: number, intervalMs: number): number {
  const base = Math.min(CLICK_PERIOD_CEILING_MS, Math.max(CLICK_PERIOD_FLOOR_MS, Number.isFinite(delayMs) ? delayMs : 0));
  return base + Math.min(CLICK_PERIOD_CEILING_MS, Math.max(0, Number.isFinite(intervalMs) ? intervalMs : 0));
}

/**
 * Ceiling for the current hold/interval: the fastest the engine can go once the delay is
 * pushed down to its own floor.
 *
 * The hold does NOT stack on top of the interval, which is what this used to assume. In the
 * engine the period is `basePeriod + loopInterval` and the hold is spent INSIDE the tick; when
 * the hold outlasts that period the scheduler's `wait` goes non-positive and it RESYNCS
 * (`nextTickMs = elapsed`) instead of banking the debt, so the hold replaces the period rather
 * than adding to it. Two competing floors, whichever is larger — exactly the `safeHold >=
 * nominalPeriod` branch of the engine's own start banner, including its `hold + 1`.
 *
 * The old form added the hold to the floor AND the interval on top, understating the ceiling
 * whenever both were set: at hold 200 / gap 300 it reported 2.0/s for a config the engine runs
 * at ~3.3/s, and delayForCps then stored a delay meaning something the user never asked for.
 */
export function maxCps(holdMs: number, intervalMs: number): number {
  const hold = Math.min(CLICK_HOLD_MAX_MS, Math.max(0, Number.isFinite(holdMs) ? holdMs : 0));
  return 1000 / Math.max(clickPeriodMs(CLICK_PERIOD_FLOOR_MS, intervalMs), hold + 1);
}

/**
 * Inverse of the asked rate (1000 / clickPeriodMs): the delay to store for a requested clicks/second.
 * `clamped` reports that the request was out of reach, so the caller can say so instead
 * of silently storing a number that means something else.
 */
export function delayForCps(
  cps: number,
  holdMs: number,
  intervalMs: number,
): { ms: number; clamped: boolean } {
  if (!Number.isFinite(cps) || cps <= 0) return { ms: 100, clamped: true };
  const interval = Math.max(0, Number.isFinite(intervalMs) ? intervalMs : 0);
  const raw = Math.round(1000 / cps) - interval;
  // The engine floors the DELAY at MinClickPeriodMs and nothing else — Math.Clamp(config.DelayMs,
  // MinClickPeriodMs, MaxClickPeriodMs). The hold never raises that floor; it caps the achieved
  // RATE, which is what maxCps models. Flooring the delay at hold + 1 here (the old form) stored a
  // needlessly large delay whenever a gap was set: asking for 3/s at hold 200 / gap 300 stored
  // 201ms and delivered 2.0/s, when 33ms delivers exactly the 3/s requested.
  const ms = Math.min(60000, Math.max(CLICK_PERIOD_FLOOR_MS, raw));
  // Two independent ways to be out of reach, and the caller needs to hear about both: the delay
  // itself had to be clamped, or the hold caps the rate below the request even at this delay.
  // Epsilon so asking for exactly the ceiling does not read as clamped on a float compare.
  const clamped = ms !== raw || cps > maxCps(holdMs, intervalMs) + 1e-9;
  return { ms, clamped };
}

// ── Hold-aware rate ─────────────────────────────────────────────────────────────────
//
// 1000 / clickPeriodMs is the rate the delay and gap ASK for. The hold is spent inside the
// period, so it changes nothing until it outlasts that period — then the scheduler's wait
// goes non-positive, it resyncs (`nextTickMs = elapsed`), and the hold (plus one) becomes the
// period. That is the `safeHold >= nominalPeriod` branch of the engine's own start banner, and
// it is why a 100 ms delay with a 200 ms hold runs at ~5/s, not 10/s. Every readout of "what
// rate will this produce" (the Rate row's ≈, the status bar, the dashboard recall) goes through
// this, never through the asked rate alone. Identity: effectiveCps == min(1000 / clickPeriodMs, maxCps).

/** Clicks per second the run actually delivers, hold included. */
export function effectiveCps(delayMs: number, intervalMs: number, holdMs: number): number {
  const hold = Math.min(CLICK_HOLD_MAX_MS, Math.max(0, Number.isFinite(holdMs) ? holdMs : 0));
  return 1000 / Math.max(clickPeriodMs(delayMs, intervalMs), hold + 1);
}

/** True when the hold, not the delay/gap, sets the rate — the one case the Rate field alone cannot show. */
export function holdCapsRate(delayMs: number, intervalMs: number, holdMs: number): boolean {
  const hold = Math.min(CLICK_HOLD_MAX_MS, Math.max(0, Number.isFinite(holdMs) ? holdMs : 0));
  return hold + 1 > clickPeriodMs(delayMs, intervalMs);
}

// ── Configuration summary ──────────────────────────────────────────────────────────
//
// One reading of the Clicker settings for every surface that recalls them: the dashboard's
// config line, the empty state's sentence (which used to look at useLoops alone and said "at
// cursor" with an Area set), and whatever comes next. Three surfaces re-deriving the same bits
// is how they drifted; this is the single place that knows the engine's precedence
// (Area > Fixed > Position) and that both limits are optional and independent.

/** The fields the summary reads. SettingsState satisfies it structurally, so this file imports none of the app's types. */
export interface ClickerConfigInput {
  cursorClickButton: string;
  cursorClickDelay: string;
  cursorClickHold: string;
  cursorClickUseInterval: boolean;
  cursorClickInterval: string;
  cursorClickUseLoops: boolean;
  cursorClickLoops: string;
  cursorClickUseMaxDuration: boolean;
  cursorClickMaxDuration: string;
  cursorClickUseArea: boolean;
  cursorClickArea: { x: number; y: number; w: number; h: number } | null;
  cursorClickUseFixed: boolean;
  cursorClickFixedPoint: { x: number; y: number } | null;
  cursorClickUsePositionJitter: boolean;
  cursorClickPositionJitter: string;
  cursorClickUseJitter: boolean;
  cursorClickDelayJitter: string;
}

export interface ClickerConfigSummary {
  /** Compact recall, joined by the caller: "Left · 5/s · 5000 clicks or 120 s · Area 800×600 · ±10% rate · +200 ms gap". */
  bits: string[];
  /** The delivered rate, hold included (0 when the delay is unset) — what the status bar prints. */
  rateCps: number;
  /** Where the clicks land, as the tail of "start clicking …": "at the cursor", "inside the 800×600 area". */
  where: string;
  /** How the run ends, as a clause: "it runs until you press it again", "it stops after 50 clicks". */
  stop: string;
  /** No limit armed — the run only ends by hand. */
  unbounded: boolean;
}
