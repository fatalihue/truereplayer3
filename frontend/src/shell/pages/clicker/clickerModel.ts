import type { ClickerPresetFields } from '../../../bridge/messageTypes';
import { fmtNum, t, tn } from '../../../i18n';
import { PRESET_KEYS } from '../../../logic/useClicker';
import {
  CLICK_PERIOD_CEILING_MS, CLICK_PERIOD_FLOOR_MS, clickPeriodMs, delayForCps, effectiveCps, formatRate, formatTenths, holdCapsRate, maxCps,
} from '../../../utils/clickerFormat';

/**
 * The Clicker's settings without React (phase 3, slice 6): what a preset holds, where a click lands,
 * and the sentences and numbers the page says them in (the catalog's clicker area, numbers in this
 * build's language). The rate math is the engine's (utils/clickerFormat), the same today's panel
 * uses; the bounds are today's panel's.
 */

export type Fields = ClickerPresetFields;
export type FieldKey = keyof Fields;
/** The settings a preset holds: every Clicker setting but the hotkeys. */
export const FIELD_KEYS = PRESET_KEYS as FieldKey[];

export const MAX_PRESETS = 24;
export const MAX_NAME = 40;
export const MAX_CLICKS = 100000;
export const MAX_TIME_S = 86400;
export const MAX_SPREAD_PX = 500;

const num = (s: string | undefined) => parseInt(s ?? '', 10) || 0;
// The bridge leaves null keys out (no area, no point): undefined and null are the same here.
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const fieldsOf = (s: Fields): Fields => Object.fromEntries(FIELD_KEYS.map(k => [k, s[k] ?? null])) as unknown as Fields;
export const sameFields = (a: Partial<Fields>, b: Partial<Fields>) => FIELD_KEYS.every(k => same(a[k], b[k]));
/** The keys whose value `to` changes, with that value. */
export function diffFields(from: Partial<Fields>, to: Partial<Fields>): Partial<Fields> {
  const out: Partial<Record<FieldKey, unknown>> = {};
  for (const k of FIELD_KEYS) if (k in to && !same(from[k], to[k])) out[k] = to[k] ?? null;
  return out as Partial<Fields>;
}

// The three places a click lands. The engine keeps one of them on: a patch turns the others off
// before it turns one on, so no moment has two.
const MODES: FieldKey[] = ['cursorClickUsePositionJitter', 'cursorClickUseArea', 'cursorClickUseFixed'];
export function orderPatch(patch: Partial<Fields>): [FieldKey, unknown][] {
  const rank = ([k, v]: [FieldKey, unknown]) => (!MODES.includes(k) ? 0 : v ? 2 : 1);
  return (Object.entries(patch) as [FieldKey, unknown][]).sort((a, b) => rank(a) - rank(b));
}

export type Where = 'cursor' | 'area' | 'fixed';
/** In the engine's order: an area wins over a point, a point over the spread around the cursor. */
export const whereOf = (f: Fields): Where => (f.cursorClickUseArea && f.cursorClickArea ? 'area' : f.cursorClickUseFixed ? 'fixed' : 'cursor');

/** The buttons, as the engine names them. */
export const BUTTONS = ['Left', 'Right', 'Middle'] as const;
type Button = typeof BUTTONS[number];
/** The button a run clicks: the engine's own, which clicks the left one for anything else. */
const buttonOf = (f: Fields): Button => ((BUTTONS as readonly string[]).includes(f.cursorClickButton) ? f.cursorClickButton as Button : 'Left');
/** The button as the Button control names it: "Left". */
const buttonName = (f: Fields) => tn('clicker.buttons')[buttonOf(f)];

export const delayMs = (f: Fields) => Math.max(1, num(f.cursorClickDelay) || 100);
export const gapMs = (f: Fields) => (f.cursorClickUseInterval ? num(f.cursorClickInterval) : 0);
export const holdMs = (f: Fields) => num(f.cursorClickHold);
/** The clicks a second a run delivers, the hold included. */
export const rateOf = (f: Fields) => effectiveCps(delayMs(f), gapMs(f), holdMs(f));
export const clicksLimit = (f: Fields) => (f.cursorClickUseLoops ? num(f.cursorClickLoops) : 0);
/** The time limit in seconds (ms on the wire). */
export const timeLimitS = (f: Fields) => (f.cursorClickUseMaxDuration ? Math.max(1, Math.round(num(f.cursorClickMaxDuration) / 1000)) : 0);
export const spreadPx = (f: Fields) => (f.cursorClickUsePositionJitter ? num(f.cursorClickPositionJitter) : 0);

/** A count with this build's thousands: "1,000" / "1.000". */
export const grouped = (x: number) => fmtNum(x);
const pad = (x: number) => String(x).padStart(2, '0');
/** "0:50", "12:00", "2:00:00". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
/** A period with its unit, the same in every language: "100 ms", "1.5 s" / "1,5 s". */
const periodWords = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${formatTenths(ms / 1000)} s`);
/** The clicks a second with no trailing zero: "9", "9.5", "20" (formatRate keeps the ".0" below 10). */
const rateNumber = (cps: number) => (Math.round(cps * 10) / 10 >= 10 ? formatRate(cps) : formatTenths(cps));

/** The rate, short: "20/s", or "every 30 s" when it is slower than one a second. */
export const rateShort = (cps: number) => (cps >= 1 ? `${rateNumber(cps)}/s` : t('clicker.every', { period: periodWords(1000 / cps) }));
/** The rate, in words: "20 times a second", "once a second", "once every 30 s". */
function rateWords(cps: number): string {
  if (cps < 1) return t('clicker.sentence.onceEvery', { period: periodWords(1000 / cps) });
  return Math.round(cps * 10) / 10 === 1 ? t('clicker.sentence.oncePerSecond') : t('clicker.sentence.timesPerSecond', { rate: rateNumber(cps) });
}

/** The limits, short: "1,000", "2:00:00", "1,000 or 1:00", "no limit". */
function limitShort(f: Fields): string {
  const c = clicksLimit(f);
  const secs = timeLimitS(f);
  if (c && secs) return t('clicker.line.both', { n: grouped(c), clock: clock(secs) });
  return c ? grouped(c) : secs ? clock(secs) : t('clicker.line.noLimit');
}

/** A preset in the list: "Left · 20/s · area · 1,000". */
export function presetLine(f: Fields): string {
  const where = whereOf(f);
  const at = where === 'cursor' && spreadPx(f) > 0 ? `±${spreadPx(f)} px` : tn('clicker.line.where')[where];
  return [buttonName(f), rateShort(rateOf(f)), at, limitShort(f)].join(' · ');
}

/** The run in one sentence: "Left click, 20 times a second, at a random point inside the 400 × 300 area. Stops after 1,000 clicks." */
export function sentence(f: Fields): string {
  const where = whereOf(f);
  const area = f.cursorClickArea;
  const point = f.cursorClickFixedPoint;
  const at = where === 'area' && area ? t('clicker.sentence.inArea', { w: area.w, h: area.h })
    : where === 'fixed' ? (point ? t('clicker.sentence.atPoint', { x: point.x, y: point.y }) : t('clicker.sentence.atStart'))
    : spreadPx(f) > 0 ? t('clicker.sentence.around', { px: spreadPx(f) })
    : t('clicker.sentence.atCursor');
  const c = clicksLimit(f);
  const secs = timeLimitS(f);
  const stop = c && secs ? t('clicker.sentence.stopsBoth', { count: c, n: grouped(c), clock: clock(secs) })
    : c ? t('clicker.sentence.stopsClicks', { count: c, n: grouped(c) })
    : secs ? t('clicker.sentence.stopsTime', { clock: clock(secs) })
    : t('clicker.sentence.untilStopped');
  return t('clicker.sentence.full', { click: tn('clicker.sentence.click')[buttonOf(f)], rate: rateWords(rateOf(f)), where: at, stop });
}

/** How long a run takes, in seconds: the click limit at the rate, the time limit, the sooner one; null when only Stop ends it. */
export function takesSec(f: Fields): number | null {
  const c = clicksLimit(f);
  const secs = timeLimitS(f);
  const r = rateOf(f);
  const all = [...(c && r > 0 ? [c / r] : []), ...(secs ? [secs] : [])];
  return all.length ? Math.min(...all) : null;
}
/** "about 50 s", "about 12 min", "about 1.5 h". */
export function takesWords(sec: number): string {
  if (sec < 60) return t('clicker.about.seconds', { n: Math.max(1, Math.round(sec)) });
  if (sec < 3600) return t('clicker.about.minutes', { n: Math.round(sec / 60) });
  return t('clicker.about.hours', { n: formatTenths(sec / 3600) });
}

/** Under the Rate: the period, which the hold and the gap fit inside. */
export const rateLine = (f: Fields) => t('clicker.click.period', { period: periodWords(clickPeriodMs(delayMs(f), gapMs(f))) });

/**
 * What the Rate field alone cannot say (settings-054): the hold setting the pace, or the last entry
 * landing on the shortest or the longest period. `clampedAt` is the delay that entry was clamped to.
 */
export function rateNote(f: Fields, clampedAt: number | null): string | null {
  const d = delayMs(f);
  const g = gapMs(f);
  const h = holdMs(f);
  if (holdCapsRate(d, g, h)) return t('clicker.click.holdCaps', { ms: h, rate: formatRate(maxCps(h, g)) });
  if (clampedAt === null || clampedAt !== d) return null;
  return d >= CLICK_PERIOD_CEILING_MS
    ? t('clicker.click.longest', { s: CLICK_PERIOD_CEILING_MS / 1000 })
    : t('clicker.click.shortest', { ms: CLICK_PERIOD_FLOOR_MS, rate: formatRate(maxCps(h, g)) });
}

/**
 * What the Rate field shows: the delivered clicks a second (one decimal at most, this build's mark;
 * delayFor reads a comma or a point back), or the delay in ms.
 */
export const rateShown = (f: Fields, unit: 'cps' | 'ms') => (unit === 'cps' ? formatTenths(rateOf(f)) : String(delayMs(f)));

/** The delay to store for what was typed, and whether it had to be clamped; null for a typo. */
export function delayFor(raw: string, unit: 'cps' | 'ms', f: Fields): { ms: number; clamped: boolean } | null {
  const n = parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const g = gapMs(f);
  if (unit === 'cps') {
    const { ms } = delayForCps(n, holdMs(f), g);
    return { ms, clamped: ms !== Math.round(1000 / n) - g };
  }
  const asked = Math.round(n);
  const ms = Math.min(CLICK_PERIOD_CEILING_MS, Math.max(CLICK_PERIOD_FLOOR_MS, asked));
  return { ms, clamped: ms !== asked };
}

// ── A run (slice 7) ──

/** The settings in one line while it clicks (paineis-145): "Left · 20/s · 1,000 clicks · area 400×300 · ±10% rate". */
export function bits(f: Fields): string {
  const c = clicksLimit(f);
  const secs = timeLimitS(f);
  const limit = c && secs ? t('clicker.bits.clicksOr', { count: c, n: grouped(c), clock: clock(secs) })
    : c ? t('clicker.bits.clicks', { count: c, n: grouped(c) })
    : secs ? clock(secs) : t('clicker.bits.noLimit');
  const where = whereOf(f);
  const area = f.cursorClickArea;
  const point = f.cursorClickFixedPoint;
  const at = where === 'area' && area ? t('clicker.bits.area', { w: area.w, h: area.h })
    : where === 'fixed' ? (point ? t('clicker.bits.point', { x: point.x, y: point.y }) : t('clicker.bits.pointAtStart'))
    : spreadPx(f) > 0 ? `±${spreadPx(f)} px` : null;
  const jitter = f.cursorClickUseJitter ? num(f.cursorClickDelayJitter) : 0;
  const gap = gapMs(f);
  return [buttonName(f), rateShort(rateOf(f)), limit, at, jitter ? t('clicker.bits.jitter', { n: jitter }) : null, gap ? t('clicker.bits.gap', { ms: gap }) : null]
    .filter(Boolean).join(' · ');
}

/** Why a run ended (clicker:ended; paineis-142). */
export function endWords(reason: string | null): string {
  const end = tn('clicker.end');
  return reason === 'stopped' ? end.stopped : reason === 'time' ? end.time : reason === 'clicks' ? end.clicks : reason === 'error' ? end.error : end.finished;
}

/** The limit while it clicks: "1,000", "1:00", "1,000 · 1:00", "∞". */
export function limitText(f: Fields): string {
  const c = clicksLimit(f);
  const secs = timeLimitS(f);
  return c && secs ? `${grouped(c)} · ${clock(secs)}` : c ? grouped(c) : secs ? clock(secs) : '∞';
}

/**
 * How far a run is, toward the limit nearest to ending it: the share done, "412 of 1,000" or
 * "0:21 of 1:00", and the seconds left (the clicks left at the measured rate, the time left; null
 * with no sample yet or no limit). Null with no limit armed.
 */
export function progressOf(f: Fields, count: number, elapsedMs: number): { pct: number; text: string; leftSec: number | null } | null {
  const c = clicksLimit(f);
  const secs = timeLimitS(f);
  if (!c && !secs) return null;
  const rate = elapsedMs > 0 ? (count * 1000) / elapsedMs : 0;
  const byClicks = c ? count / c : -1;
  const byTime = secs ? elapsedMs / (secs * 1000) : -1;
  const left = [...(c && rate > 0 && count > 0 ? [Math.max(0, c - count) / rate] : []), ...(secs ? [Math.max(0, secs - elapsedMs / 1000)] : [])];
  const leftSec = left.length ? Math.ceil(Math.min(...left)) : null;
  const pct = Math.min(1, Math.max(byClicks, byTime));
  const text = byClicks >= byTime
    ? t('clicker.progress.of', { done: grouped(count), total: grouped(c) })
    : t('clicker.progress.of', { done: clock(elapsedMs / 1000), total: clock(secs) });
  return { pct, text, leftSec };
}

/** A monitor, in virtual-desktop pixels (screen:displays). */
export interface Display { x: number; y: number; w: number; h: number; primary: boolean }
/**
 * The display the area or the point is on, with its number (the main one first, then left to
 * right): null in cursor mode, before the engine has said its monitors, or off every one of them.
 */
export function displayOf(displays: Display[] | null, f: Fields): { display: Display; n: number } | null {
  if (!displays?.length) return null;
  const where = whereOf(f);
  const at = where === 'area' && f.cursorClickArea ? { x: f.cursorClickArea.x + f.cursorClickArea.w / 2, y: f.cursorClickArea.y + f.cursorClickArea.h / 2 }
    : where === 'fixed' && f.cursorClickFixedPoint ? f.cursorClickFixedPoint
    : null;
  if (!at) return null;
  const sorted = [...displays].sort((a, b) => Number(b.primary) - Number(a.primary) || a.x - b.x || a.y - b.y);
  const i = sorted.findIndex(d => at.x >= d.x && at.x < d.x + d.w && at.y >= d.y && at.y < d.y + d.h);
  return i < 0 ? null : { display: sorted[i], n: i + 1 };
}

/** The ready-made rates (settings-052): the ones the hold and the gap allow, or common delays. */
export const quickRates = (f: Fields, unit: 'cps' | 'ms') => (unit === 'cps'
  ? [1, 2, 5, 10, 20, 50].filter(c => c <= maxCps(holdMs(f), gapMs(f))).map(c => ({ value: String(c), label: `${c}/s` }))
  : [200, 100, 50, 25, 10].map(m => ({ value: String(m), label: `${m} ms` })));
