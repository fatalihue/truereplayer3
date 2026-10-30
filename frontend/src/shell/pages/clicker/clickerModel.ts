import type { ClickerPresetFields } from '../../../bridge/messageTypes';
import { PRESET_KEYS } from '../../../logic/useClicker';
import {
  CLICK_PERIOD_CEILING_MS, CLICK_PERIOD_FLOOR_MS, clickPeriodMs, delayForCps, effectiveCps, formatRate, holdCapsRate, maxCps,
} from '../../../utils/clickerFormat';

/**
 * The Clicker's settings without React (phase 3, slice 6): what a preset holds, where a click lands,
 * and the sentences and numbers the page says them in. The rate math is the engine's
 * (utils/clickerFormat), the same today's panel uses; the bounds are today's panel's.
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

export const delayMs = (f: Fields) => Math.max(1, num(f.cursorClickDelay) || 100);
export const gapMs = (f: Fields) => (f.cursorClickUseInterval ? num(f.cursorClickInterval) : 0);
export const holdMs = (f: Fields) => num(f.cursorClickHold);
/** The clicks a second a run delivers, the hold included. */
export const rateOf = (f: Fields) => effectiveCps(delayMs(f), gapMs(f), holdMs(f));
export const clicksLimit = (f: Fields) => (f.cursorClickUseLoops ? num(f.cursorClickLoops) : 0);
/** The time limit in seconds (ms on the wire). */
export const timeLimitS = (f: Fields) => (f.cursorClickUseMaxDuration ? Math.max(1, Math.round(num(f.cursorClickMaxDuration) / 1000)) : 0);
export const spreadPx = (f: Fields) => (f.cursorClickUsePositionJitter ? num(f.cursorClickPositionJitter) : 0);

export const grouped = (x: number) => x.toLocaleString('en-US');
const pad = (x: number) => String(x).padStart(2, '0');
/** "0:50", "12:00", "2:00:00". */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}
const tenths = (x: number) => String(Math.round(x * 10) / 10);
const periodWords = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${tenths(ms / 1000)} s`);

/** The rate, short: "20/s", or "every 30 s" when it is slower than one a second. */
export const rateShort = (cps: number) => (cps >= 1 ? `${formatRate(cps).replace(/\.0$/, '')}/s` : `every ${periodWords(1000 / cps)}`);
/** The rate, in words: "20 times a second", "once a second", "once every 30 s". */
function rateWords(cps: number): string {
  if (cps < 1) return `once every ${periodWords(1000 / cps)}`;
  const r = formatRate(cps).replace(/\.0$/, '');
  return r === '1' ? 'once a second' : `${r} times a second`;
}

/** The limits, short: "1,000", "2:00:00", "1,000 or 1:00", "no limit". */
function limitShort(f: Fields): string {
  const c = clicksLimit(f);
  const t = timeLimitS(f);
  if (c && t) return `${grouped(c)} or ${clock(t)}`;
  return c ? grouped(c) : t ? clock(t) : 'no limit';
}

/** A preset in the list: "Left · 20/s · area · 1,000". */
export function presetLine(f: Fields): string {
  const where = whereOf(f);
  const at = where === 'cursor' ? (spreadPx(f) > 0 ? `±${spreadPx(f)} px` : 'cursor') : where;
  return [f.cursorClickButton, rateShort(rateOf(f)), at, limitShort(f)].join(' · ');
}

/** The run in one sentence: "Left click, 20 times a second, at a random point inside the 400 × 300 area. Stops after 1,000 clicks." */
export function sentence(f: Fields): string {
  const where = whereOf(f);
  const at = where === 'area' && f.cursorClickArea ? `at a random point inside the ${f.cursorClickArea.w} × ${f.cursorClickArea.h} area`
    : where === 'fixed' ? (f.cursorClickFixedPoint ? `at ${f.cursorClickFixedPoint.x}, ${f.cursorClickFixedPoint.y}` : 'where the cursor is when it starts')
    : spreadPx(f) > 0 ? `around the cursor (±${spreadPx(f)} px)`
    : 'at the cursor';
  const c = clicksLimit(f);
  const t = timeLimitS(f);
  const clicks = `${grouped(c)} click${c === 1 ? '' : 's'}`;
  const stop = c && t ? `Stops after ${clicks} or ${clock(t)}, whichever comes first.`
    : c ? `Stops after ${clicks}.`
    : t ? `Stops after ${clock(t)}.`
    : 'Runs until you stop it.';
  return `${f.cursorClickButton} click, ${rateWords(rateOf(f))}, ${at}. ${stop}`;
}

/** How long a run takes, in seconds: the click limit at the rate, the time limit, the sooner one; null when only Stop ends it. */
export function takesSec(f: Fields): number | null {
  const c = clicksLimit(f);
  const t = timeLimitS(f);
  const r = rateOf(f);
  const all = [...(c && r > 0 ? [c / r] : []), ...(t ? [t] : [])];
  return all.length ? Math.min(...all) : null;
}
/** "about 50 s", "about 12 min", "about 2 h". */
export function takesWords(sec: number): string {
  if (sec < 60) return `about ${Math.max(1, Math.round(sec))} s`;
  if (sec < 3600) return `about ${Math.round(sec / 60)} min`;
  return `about ${tenths(sec / 3600)} h`;
}

/** Under the Rate: the period, which the hold and the gap fit inside. */
export const rateLine = (f: Fields) => `One click every ${periodWords(clickPeriodMs(delayMs(f), gapMs(f)))}. Hold and gap fit inside it.`;

/**
 * What the Rate field alone cannot say (settings-054): the hold setting the pace, or the last entry
 * landing on the shortest or the longest period. `clampedAt` is the delay that entry was clamped to.
 */
export function rateNote(f: Fields, clampedAt: number | null): string | null {
  const d = delayMs(f);
  const g = gapMs(f);
  const h = holdMs(f);
  if (holdCapsRate(d, g, h)) return `The ${h} ms hold sets the pace: ${formatRate(maxCps(h, g))}/s at most.`;
  if (clampedAt === null || clampedAt !== d) return null;
  return d >= CLICK_PERIOD_CEILING_MS
    ? `${CLICK_PERIOD_CEILING_MS / 1000} s is the longest period: one click a minute is the slowest.`
    : `${CLICK_PERIOD_FLOOR_MS} ms is the shortest period: ${formatRate(maxCps(h, g))}/s at most.`;
}

/** What the Rate field shows: the delivered clicks a second, or the delay in ms. */
export const rateShown = (f: Fields, unit: 'cps' | 'ms') => (unit === 'cps' ? rateOf(f).toFixed(1).replace(/\.0$/, '') : String(delayMs(f)));

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

/** The ready-made rates (settings-052): the ones the hold and the gap allow, or common delays. */
export const quickRates = (f: Fields, unit: 'cps' | 'ms') => (unit === 'cps'
  ? [1, 2, 5, 10, 20, 50].filter(c => c <= maxCps(holdMs(f), gapMs(f))).map(c => ({ value: String(c), label: `${c}/s` }))
  : [200, 100, 50, 25, 10].map(m => ({ value: String(m), label: `${m} ms` })));
