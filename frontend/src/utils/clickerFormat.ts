// Shared formatters for Clicker live stats — consumed by StatusBar (compact one-line
// readout) and ClickerDashboard (large hero + grid). Keeping one source of truth so the
// "rate >= 10 → integer, else 1 decimal" rule + MM:SS convention stay consistent.

export interface ClickerStatsView {
  elapsed: string;     // "M:SS"
  rate: number;        // clicks per second (raw)
  rateLabel: string;   // "9.8" or "120"
}

// Integer-only above 10 CPS — at high rates a trailing ".0" reads as noise; at low
// rates the decimal carries useful precision (1.2/s vs 1.8/s).
// Shared by the MEASURED rate (dashboard) and the TARGET rate (settings, status bar) so
// the two can never format differently for the same number.
export function formatRate(rate: number): string {
  return rate >= 10 ? rate.toFixed(0) : rate.toFixed(1);
}

export function formatClickerStats(count: number, elapsedMs: number): ClickerStatsView {
  const sec = Math.max(0, Math.floor(elapsedMs / 1000));
  const mm = Math.floor(sec / 60);
  const ss = String(sec % 60).padStart(2, '0');
  const rate = elapsedMs > 0 ? (count * 1000) / elapsedMs : 0;
  return { elapsed: `${mm}:${ss}`, rate, rateLabel: formatRate(rate) };
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

/** One full cycle: the engine schedules against this, with hold absorbed INSIDE it. */
export function clickPeriodMs(delayMs: number, intervalMs: number): number {
  const base = Math.max(CLICK_PERIOD_FLOOR_MS, Number.isFinite(delayMs) ? delayMs : 0);
  return base + Math.max(0, Number.isFinite(intervalMs) ? intervalMs : 0);
}

/** Clicks per second the engine will actually produce for this configuration. */
export function targetCps(delayMs: number, intervalMs: number): number {
  return 1000 / clickPeriodMs(delayMs, intervalMs);
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
 * Inverse of targetCps: the delay to store for a requested clicks/second.
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

// Estimated time-to-finish, in "~Ns" or "~M:SS" form. Returns "—" when the run is
// unbounded (infinite loop) or we don't yet have enough samples to project.
export function formatEta(
  loopActive: boolean,
  total: number,
  current: number,
  rate: number,
): string {
  if (!loopActive || total <= 0 || current <= 0 || rate <= 0) return '—';
  const remaining = Math.max(0, total - current);
  const etaSec = Math.ceil(remaining / rate);
  if (etaSec >= 60) {
    const em = Math.floor(etaSec / 60);
    const es = String(etaSec % 60).padStart(2, '0');
    return `~${em}:${es}`;
  }
  return `~${etaSec}s`;
}

// ── Hold-aware rate ─────────────────────────────────────────────────────────────────
//
// targetCps above is the rate the delay and gap ASK for. The hold is spent inside the
// period, so it changes nothing until it outlasts that period — then the scheduler's wait
// goes non-positive, it resyncs (`nextTickMs = elapsed`), and the hold (plus one) becomes the
// period. That is the `safeHold >= nominalPeriod` branch of the engine's own start banner, and
// it is why a 100 ms delay with a 200 ms hold runs at ~5/s, not 10/s. Every readout of "what
// rate will this produce" (the Rate row's ≈, the status bar, the dashboard recall) goes through
// this, never through targetCps alone. Identity: effectiveCps == min(targetCps, maxCps).

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

/** The fields the summary reads. SettingsState satisfies it structurally, so this file stays import-free. */
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
  /** Where the clicks land, as the tail of "start clicking …": "at the cursor", "inside the 800×600 area". */
  where: string;
  /** How the run ends, as a clause: "it runs until you press it again", "it stops after 50 clicks". */
  stop: string;
  /** No limit armed — the run only ends by hand. */
  unbounded: boolean;
}

export function describeClickerConfig(s: ClickerConfigInput): ClickerConfigSummary {
  const delayMs = parseInt(s.cursorClickDelay, 10) || 0;
  const gapMs = s.cursorClickUseInterval ? (parseInt(s.cursorClickInterval, 10) || 0) : 0;
  const holdMs = parseInt(s.cursorClickHold, 10) || 0;
  const loops = s.cursorClickUseLoops ? (parseInt(s.cursorClickLoops, 10) || 0) : 0;
  const capSec = s.cursorClickUseMaxDuration ? Math.round((parseInt(s.cursorClickMaxDuration, 10) || 0) / 1000) : 0;
  const positionPx = s.cursorClickUsePositionJitter ? (parseInt(s.cursorClickPositionJitter, 10) || 0) : 0;
  const ratePct = s.cursorClickUseJitter ? (parseInt(s.cursorClickDelayJitter, 10) || 0) : 0;

  // Where — in the engine's precedence order, so the summary can never name a mode the run ignores.
  let where: string;
  let whereBit: string | null;
  if (s.cursorClickUseArea && s.cursorClickArea) {
    where = `inside the ${s.cursorClickArea.w}×${s.cursorClickArea.h} area`;
    whereBit = `Area ${s.cursorClickArea.w}×${s.cursorClickArea.h}`;
  } else if (s.cursorClickUseFixed) {
    if (s.cursorClickFixedPoint) {
      where = `at ${s.cursorClickFixedPoint.x}, ${s.cursorClickFixedPoint.y}`;
      whereBit = `Fixed ${s.cursorClickFixedPoint.x},${s.cursorClickFixedPoint.y}`;
    } else {
      where = 'where the cursor is when it starts';
      whereBit = 'Fixed at start';
    }
  } else if (positionPx > 0) {
    where = `around the cursor (±${positionPx} px)`;
    whereBit = `±${positionPx} px`;
  } else {
    where = 'at the cursor';
    whereBit = null;
  }

  // Stop — both limits optional and independent; whichever is reached first ends the run.
  const limitBits: string[] = [];
  if (loops > 0) limitBits.push(`${loops} clicks`);
  if (capSec > 0) limitBits.push(`${capSec} s`);
  const unbounded = limitBits.length === 0;
  const stop = unbounded
    ? 'it runs until you press it again'
    : limitBits.length === 2
      ? `it stops after ${limitBits[0]} or ${limitBits[1]}, whichever comes first`
      : `it stops after ${limitBits[0]}`;

  // The RATE leads: it is the single most important setting. Hold-aware — see effectiveCps.
  const bits: string[] = [s.cursorClickButton];
  if (delayMs > 0) bits.push(`${formatRate(effectiveCps(delayMs, gapMs, holdMs))}/s`);
  bits.push(unbounded ? 'no limit' : limitBits.join(' or '));
  if (whereBit) bits.push(whereBit);
  if (ratePct > 0) bits.push(`±${ratePct}% rate`);
  // "+N ms gap", not "every N ms": one iteration is one click, so the gap is ADDED to the
  // cadence and the rate above already includes it.
  if (gapMs > 0) bits.push(`+${gapMs} ms gap`);

  return { bits, where, stop, unbounded };
}
