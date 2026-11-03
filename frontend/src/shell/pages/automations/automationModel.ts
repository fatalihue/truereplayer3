import type { AutomationEntry, TriggerConfig } from '../../../bridge/messageTypes';
import { fmtHora, fmtNum, LANG, t, tn } from '../../../i18n';
import { rangeParts } from '../../../utils/activeHours';
import { effectiveOperator, isNumberMode, parsesAsNumber, regexProblem } from '../../../utils/screenText';

/**
 * What the Automations page (phase 3, slices 8 and 9) and the Inspector's Automation section know
 * about a trigger: how a new one starts, how two are compared, why one can never fire, and how a
 * row reads (its trigger, its status, when it ran). TrueReplayer 2's AutomationPanel was the
 * reference. The protocol says "profile"; the interface says "macro". The words are the catalog's
 * (the automations area of i18n/); the days, the times and the numbers are the build's language's (Intl).
 */

/**
 * A new automation: every 5 minutes, off, as today (paineis-008). 0 is the per-condition default.
 * No colour yet, as the engine's own default: Pixel color asks for one (Pick) when it is chosen.
 */
export function defaultTrigger(): TriggerConfig {
  return {
    kind: 'interval',
    armed: false,
    intervalSeconds: 300,
    timeOfDay: null,
    daysOfWeek: 0,
    conditionType: 'WindowOpen',
    windowProcessName: '',
    windowTitle: '',
    windowTitleMatchMode: 'contains',
    windowMatchForegroundOnly: false,
    useRelativeCoordinates: false,
    filePath: '',
    pixelX: 0,
    pixelY: 0,
    pixelColor: null,
    pixelTolerance: 10,
    imagePath: null,
    imageConfidence: 0.8,
    imageBase64: null,
    searchRegion: null,
    clipboardPattern: '',
    cooldownSeconds: 0,
    retrigger: 'edge',
    pollIntervalMs: 0,
  };
}

/** The empty page's starting points (the EmptyStates board): each asks for the macro, then makes it. */
export const STARTS: { label: string; icon: 'timer' | 'clock' | 'text'; patch: Partial<TriggerConfig> }[] = [
  { label: t('automations.starts.interval'), icon: 'timer', patch: { kind: 'interval', intervalSeconds: 600 } },
  { label: t('automations.starts.schedule'), icon: 'clock', patch: { kind: 'schedule', timeOfDay: '09:00', daysOfWeek: 0 } },
  { label: t('automations.starts.text'), icon: 'text', patch: { kind: 'condition', conditionType: 'ScreenText', conditionOperator: 'contains' } },
];

// ── Two triggers compared as the engine keeps them ──

// Keys sorted, null and absent the same: the bridge leaves a null out (WhenWritingNull), and a key
// a change added lands at the end of the object.
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v === null || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) {
    const x = (v as Record<string, unknown>)[k];
    if (x !== null && x !== undefined) out[k] = canonical(x);
  }
  return out;
}
// The Text on screen fields as WebViewBridge.ParseTriggerConfig stores them: only for that type,
// the operator resolved for the mode, an empty operand absent, the colour as #RRGGBB.
function stored(trigger: TriggerConfig): TriggerConfig {
  if (trigger.conditionType !== 'ScreenText') {
    return { ...trigger, conditionOperator: null, conditionOperand: null, ocrReadAs: null, ocrTextColor: null, ocrColorTolerance: null };
  }
  const number = isNumberMode(trigger.ocrReadAs);
  const hex = (trigger.ocrTextColor ?? '').trim();
  const tol = trigger.ocrColorTolerance;
  return {
    ...trigger,
    ocrReadAs: number ? 'number' : null,
    conditionOperator: trigger.conditionOperator == null ? trigger.conditionOperator : effectiveOperator(trigger.conditionOperator, number),
    conditionOperand: trigger.conditionOperand ? trigger.conditionOperand : null,
    ocrTextColor: /^#?[0-9A-Fa-f]{6}$/.test(hex) ? ('#' + hex.replace(/^#/, '')).toUpperCase() : null,
    ocrColorTolerance: typeof tol === 'number' && Number.isFinite(tol) ? Math.min(255, Math.max(0, Math.trunc(tol))) : null,
  };
}
/** A trigger as the engine stores it, for comparing: the thumbnail never counts, and armed only when asked. */
export const shapeOf = (trigger: TriggerConfig | null, withArmed = false): string =>
  (trigger ? JSON.stringify(canonical({ ...stored(trigger), imageBase64: null, armed: withArmed && trigger.armed })) : '');

// ── Why one never fires (mirrors TriggerService.DescribeUnfireable) ──

/** Why this trigger can never fire as it is, or null when it can. */
export function whyCannotFire(trigger: TriggerConfig): string | null {
  if (trigger.kind === 'schedule') {
    if (!trigger.timeOfDay) return t('automations.why.noTime');
    if (rangeParts(trigger.timeOfDay)) return t('automations.why.range');
  }
  if (trigger.kind !== 'condition') return null;
  if (trigger.useRelativeCoordinates && (trigger.conditionType === 'PixelColorMatch' || trigger.conditionType === 'ImageFound' || trigger.conditionType === 'ScreenText')
    && !(trigger.windowProcessName ?? '').trim() && !(trigger.windowTitle ?? '').trim()) {
    return t('automations.why.anchor');
  }
  switch (trigger.conditionType) {
    case 'WindowOpen':
      return (trigger.windowProcessName ?? '').trim() || (trigger.windowTitle ?? '').trim() ? null : t('automations.why.window');
    case 'ProcessRunning':
      return (trigger.windowProcessName ?? '').trim() ? null : t('automations.why.process');
    case 'FileExists':
      return (trigger.filePath ?? '').trim() ? null : t('automations.why.file');
    case 'ImageFound':
      return trigger.imagePath ? null : t('automations.why.image');
    case 'ScreenText': {
      if (!trigger.searchRegion) return t('automations.why.region');
      const number = isNumberMode(trigger.ocrReadAs);
      const operand = trigger.conditionOperand ?? '';
      const color = (trigger.ocrTextColor ?? '').trim();
      if (color && !/^#?[0-9A-Fa-f]{6}$/.test(color)) return t('automations.why.textColor');
      if (number) return parsesAsNumber(operand) ? null : t('automations.why.number');
      if (effectiveOperator(trigger.conditionOperator, false) === 'regex') {
        if (!operand) return t('automations.why.pattern');
        // regexProblem has one answer, a pattern that does not compile: said here as a sentence of the catalog.
        return regexProblem(operand) ? t('automations.why.noCompile') : null;
      }
      return operand.trim() ? null : t('automations.why.text');
    }
    case 'PixelColorMatch':
      return /^#?[0-9A-Fa-f]{6}$/.test((trigger.pixelColor ?? '').trim()) ? null : t('automations.why.pixel');
    default:
      return null;
  }
}

// ── How a row reads ──

export type Group = 'armed' | 'off' | 'attention';
/** Why a status is what it is, for its tooltip (said in the page, from the catalog). */
export type StatusWhy = 'disabled' | 'never' | 'paused' | 'true' | 'false' | 'stopped';
export interface Status {
  /** The filter it is counted in: on and fine, off, or on but not running as it should. */
  group: Group;
  tone: 'ok' | 'off' | 'paused' | 'warn';
  text: string;
  why?: StatusWhy;
  /** The reason in the engine's words, or the mirror's: shown in the panel too. */
  detail?: string;
}

/**
 * The Status column (paineis-010, 019 to 021): off is off; on, it is watching, waiting for its next
 * time, paused with Run automations, or it needs attention — its macro is disabled, it can never fire
 * as it is, or the engine stopped watching it.
 */
export function statusOf(e: AutomationEntry, runAutomations: boolean): Status {
  const trigger = e.trigger;
  if (!trigger.armed) return { group: 'off', tone: 'off', text: t('automations.status.off') };
  if (e.isDisabled) return { group: 'attention', tone: 'warn', text: t('automations.status.disabled'), why: 'disabled' };
  const never = whyCannotFire(trigger);
  if (never) return { group: 'attention', tone: 'warn', text: t('automations.status.never'), why: 'never', detail: never };
  if (!runAutomations) return { group: 'armed', tone: 'paused', text: t('automations.status.paused'), why: 'paused' };
  if (e.running) {
    if (trigger.kind !== 'condition' && e.nextDueAt) return { group: 'armed', tone: 'ok', text: t('automations.status.next', { when: whenText(e.nextDueAt) }) };
    // Only a condition that stays true or false has a state to tell; the clipboard fires on a change.
    const level = trigger.kind === 'condition' && trigger.conditionType !== 'ClipboardChanged';
    return { group: 'armed', tone: 'ok', text: t('automations.status.watching'), why: level ? (e.conditionTrue ? 'true' : 'false') : undefined };
  }
  if (e.lastResult && e.lastResult !== 'fired') return { group: 'attention', tone: 'warn', text: t('automations.status.notWatching'), why: 'stopped', detail: e.lastResult };
  return { group: 'armed', tone: 'ok', text: t('automations.status.armed') };
}

// The day before the time, in the build's language: "Nov 3", "3 nov." The words between the day and
// the month go ("3 de nov." does not fit the Last fired column), each language keeping its order.
// Made once, on first use, as the time's (fmtHora): the table says two instants a row on every state
// the engine sends (every 2 s while the page is open), and an Intl object is not free.
let dayFormat: Intl.DateTimeFormat | undefined;
const dayText = (d: Date) => (dayFormat ??= new Intl.DateTimeFormat(LANG, { day: 'numeric', month: 'short' }))
  .formatToParts(d).map(p => (p.type === 'literal' ? ' ' : p.value)).join('');

/** An instant the engine reported: the time alone today, the day before it otherwise (lastFiredAt survives restarts). */
export function whenText(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = fmtHora(d);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return time;
  return `${dayText(d)} ${time}`;
}

// ── How a trigger reads ──

/** With a capital first letter: a name alone, or a phrase that starts with a day ("seg. a sex." → "Seg. a sex."). */
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mon to Sun, as the engine's mask has them (Sun = 1 << 0). */
const BITS = [1 << 1, 1 << 2, 1 << 3, 1 << 4, 1 << 5, 1 << 6, 1 << 0];
export interface Day {
  bit: number;
  /** The short name as a phrase says it: "Mon", "seg.". */
  short: string;
  /** The same on the day's button: "Mon", "Seg.". */
  label: string;
  /** The whole name, the button's name and tip: "Monday", "Segunda-feira". */
  name: string;
}
let week: Day[] | undefined;
/**
 * Mon to Sun with their names in the build's language (Intl, plan §3.4). Made the first time a day is
 * said, not when this module loads: the Inspector loads it too, and an Intl object is not free.
 */
export function weekDays(): Day[] {
  if (!week) {
    const short = new Intl.DateTimeFormat(LANG, { weekday: 'short', timeZone: 'UTC' });
    const long = new Intl.DateTimeFormat(LANG, { weekday: 'long', timeZone: 'UTC' });
    // 2023-01-02 was a Monday.
    week = BITS.map((bit, i) => {
      const at = Date.UTC(2023, 0, 2 + i);
      const name = short.format(at);
      return { bit, short: name, label: capital(name), name: capital(long.format(at)) };
    });
  }
  return week;
}

/** The days a schedule runs: "Every day", "Mon to Fri", "Weekends", "Mon, Wed, Fri". */
export function daysText(mask: number): string {
  const on = BITS.map(bit => (mask & bit) !== 0);
  const n = on.filter(Boolean).length;
  if (n === 0 || n === 7) return t('automations.days.every');
  if (n === 2 && on[5] && on[6]) return t('automations.days.weekends');
  const days = weekDays();
  const first = on.indexOf(true);
  const last = on.lastIndexOf(true);
  if (n >= 3 && last - first + 1 === n) return capital(t('automations.days.range', { from: days[first].short, to: days[last].short }));
  return capital(days.filter((_, i) => on[i]).map(d => d.short).join(', '));
}

/** An interval's unit, and how many seconds it is. */
export type Unit = 's' | 'min' | 'h';
export const UNIT_SECONDS: Record<Unit, number> = { s: 1, min: 60, h: 3600 };
/** The unit that says these seconds in a whole number: hours, else minutes, else seconds. */
export const unitOf = (s: number): Unit => (s >= 3600 && s % 3600 === 0 ? 'h' : s >= 60 && s % 60 === 0 ? 'min' : 's');
/** "15 min", "2 h", "90 s". */
export function everyText(seconds: number): string {
  const s = Math.max(5, Math.trunc(seconds));
  const unit = unitOf(s);
  return t('automations.amount', { n: fmtNum(s / UNIT_SECONDS[unit]), unit });
}

/** How often a condition is checked when it says 0 (TriggerService.DefaultPollCadenceMs). */
export const defaultPollMs = (conditionType: string | null | undefined) =>
  (conditionType === 'PixelColorMatch' ? 250 : conditionType === 'ClipboardChanged' ? 500 : 1000);
/** The wait between a condition's fires when it says 0 (5 s for the clipboard, 30 s otherwise). */
export const defaultCooldown = (conditionType: string | null | undefined) => (conditionType === 'ClipboardChanged' ? 5 : 30);
// The build's decimal sign and no thousands: the Check every field reads this text back (DraftField
// takes a comma or a point), and it never goes past 600 s. Made on first use.
let seconds: Intl.NumberFormat | undefined;
/** Milliseconds as seconds, as the fields and the summaries say them: "2", "0.25" ("0,25"). */
export const secondsText = (ms: number) =>
  (seconds ??= new Intl.NumberFormat(LANG, { useGrouping: false, maximumFractionDigits: 3 })).format(Math.round(ms) / 1000);

/** What each condition watches, said after When: the conditions' names (glossary) inside a phrase. */
const WHAT: Readonly<Record<string, string | undefined>> = tn('automations.conditionWhat');
const NUMBER_OPS: Record<string, string> = { eq: '=', neq: '≠', gt: '>', lt: '<' };

/** What a condition watches, in a few words, and the value it watches for (shown quoted), if any. */
export function conditionWords(trigger: TriggerConfig): { what: string; value: string | null } {
  const what = WHAT[trigger.conditionType ?? ''] ?? (trigger.conditionType ?? t('automations.trigger.condition'));
  const trim = (v: string | null | undefined) => (v ?? '').trim() || null;
  switch (trigger.conditionType) {
    case 'WindowOpen': return { what, value: trim(trigger.windowTitle) ?? trim(trigger.windowProcessName) };
    case 'ProcessRunning': return { what, value: trim(trigger.windowProcessName) };
    case 'FileExists': return { what, value: trim(trigger.filePath)?.split(/[\\/]/).filter(Boolean).pop() ?? null };
    case 'PixelColorMatch': return { what, value: trim(trigger.pixelColor) };
    case 'ScreenText': {
      const operand = trim(trigger.conditionOperand);
      if (!operand) return { what, value: null };
      return { what, value: isNumberMode(trigger.ocrReadAs) ? `${NUMBER_OPS[effectiveOperator(trigger.conditionOperator, true)] ?? '='} ${operand}` : operand };
    }
    case 'ClipboardChanged': return { what, value: trim(trigger.clipboardPattern) };
    default: return { what, value: null };
  }
}

/** The hours an interval or a condition runs in ("09:00–18:00"), or null for any hour. */
export function hoursText(trigger: TriggerConfig): string | null {
  if (trigger.kind === 'schedule') return null;
  const r = rangeParts(trigger.timeOfDay);
  return r ? `${r.from}–${r.to}` : null;
}

export interface TriggerWords {
  /** Which phrase says it (phraseOf): "Every …", "At …" or "When …". */
  kind: TriggerConfig['kind'];
  /** What goes in the phrase: the interval, the time, or what the condition watches. */
  main: string;
  /** The value watched for, shown in quotes. */
  quote: string | null;
  /** The hours or the days, said after a dot. */
  tail: string | null;
}
/**
 * A kind's phrase with `main` in its place: "Every 15 min", "At 23:00", "When text on screen". The
 * Trigger column hands it a mark for `main` and draws the rest quieter, wherever the language puts it.
 */
export function phraseOf(kind: TriggerConfig['kind'], main: string): string {
  switch (kind) {
    case 'interval': return t('automations.trigger.every', { every: main });
    case 'schedule': return t('automations.trigger.at', { time: main });
    default: return t('automations.trigger.when', { what: main });
  }
}
/** The Trigger column: "Every 15 min · 08:00–20:00", "At 23:00 · Mon to Fri", "When text on screen “Aceitar”". */
export function triggerWords(trigger: TriggerConfig): TriggerWords {
  if (trigger.kind === 'interval') return { kind: 'interval', main: everyText(trigger.intervalSeconds), quote: null, tail: hoursText(trigger) };
  if (trigger.kind === 'schedule') return { kind: 'schedule', main: trigger.timeOfDay && !rangeParts(trigger.timeOfDay) ? trigger.timeOfDay : '—', quote: null, tail: daysText(trigger.daysOfWeek) };
  const c = conditionWords(trigger);
  return { kind: 'condition', main: c.what, quote: c.value, tail: hoursText(trigger) };
}
/** The same, as one line of plain text (the filter, the accessible names). */
export function triggerText(trigger: TriggerConfig): string {
  const w = triggerWords(trigger);
  return `${phraseOf(w.kind, w.main)}${w.quote ? ` “${w.quote}”` : ''}${w.tail ? ` · ${w.tail}` : ''}`;
}

/** The Inspector's card: a title and a line under it (the Running board: "Text on screen" · "“Aceitar” · every 2 s · 09:00–18:00"). */
export function cardWords(trigger: TriggerConfig): { title: string; sub: string } {
  if (trigger.kind === 'interval') return { title: phraseOf('interval', everyText(trigger.intervalSeconds)), sub: hoursText(trigger) ?? t('automations.trigger.anyHour') };
  if (trigger.kind === 'schedule') return { title: phraseOf('schedule', triggerWords(trigger).main), sub: daysText(trigger.daysOfWeek) };
  const c = conditionWords(trigger);
  const every = t('automations.trigger.checkEvery', { seconds: secondsText(trigger.pollIntervalMs > 0 ? trigger.pollIntervalMs : defaultPollMs(trigger.conditionType)) });
  return {
    title: capital(c.what),
    sub: [c.value ? `“${c.value}”` : null, every, hoursText(trigger)].filter(Boolean).join(' · '),
  };
}
