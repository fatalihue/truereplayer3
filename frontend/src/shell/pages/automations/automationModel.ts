import type { AutomationEntry, TriggerConfig } from '../../../bridge/messageTypes';
import { rangeParts } from '../../../utils/activeHours';
import { effectiveOperator, isNumberMode, parsesAsNumber, regexProblem } from '../../../utils/screenText';

/**
 * What the Automations page (phase 3, slices 8 and 9) and the Inspector's Automation section know
 * about a trigger: how a new one starts, how two are compared, why one can never fire, and how a
 * row reads (its trigger, its status, when it ran). Today's components/AutomationPanel is the
 * reference; it leaves in phase 6. The protocol says "profile"; the interface says "macro".
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
  { label: 'Every 10 minutes', icon: 'timer', patch: { kind: 'interval', intervalSeconds: 600 } },
  { label: 'Every day at 09:00', icon: 'clock', patch: { kind: 'schedule', timeOfDay: '09:00', daysOfWeek: 0 } },
  { label: 'When text shows on screen', icon: 'text', patch: { kind: 'condition', conditionType: 'ScreenText', conditionOperator: 'contains' } },
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
function stored(t: TriggerConfig): TriggerConfig {
  if (t.conditionType !== 'ScreenText') {
    return { ...t, conditionOperator: null, conditionOperand: null, ocrReadAs: null, ocrTextColor: null, ocrColorTolerance: null };
  }
  const number = isNumberMode(t.ocrReadAs);
  const hex = (t.ocrTextColor ?? '').trim();
  const tol = t.ocrColorTolerance;
  return {
    ...t,
    ocrReadAs: number ? 'number' : null,
    conditionOperator: t.conditionOperator == null ? t.conditionOperator : effectiveOperator(t.conditionOperator, number),
    conditionOperand: t.conditionOperand ? t.conditionOperand : null,
    ocrTextColor: /^#?[0-9A-Fa-f]{6}$/.test(hex) ? ('#' + hex.replace(/^#/, '')).toUpperCase() : null,
    ocrColorTolerance: typeof tol === 'number' && Number.isFinite(tol) ? Math.min(255, Math.max(0, Math.trunc(tol))) : null,
  };
}
/** A trigger as the engine stores it, for comparing: the thumbnail never counts, and armed only when asked. */
export const shapeOf = (t: TriggerConfig | null, withArmed = false): string =>
  (t ? JSON.stringify(canonical({ ...stored(t), imageBase64: null, armed: withArmed && t.armed })) : '');

// ── Why one never fires (mirrors TriggerService.DescribeUnfireable) ──

/** Why this trigger can never fire as it is, or null when it can. */
export function whyCannotFire(t: TriggerConfig): string | null {
  if (t.kind === 'schedule') {
    if (!t.timeOfDay) return 'Pick a time of day.';
    if (rangeParts(t.timeOfDay)) return 'That is a range of hours, not a time of day — pick a single time.';
  }
  if (t.kind !== 'condition') return null;
  if (t.useRelativeCoordinates && (t.conditionType === 'PixelColorMatch' || t.conditionType === 'ImageFound' || t.conditionType === 'ScreenText')
    && !(t.windowProcessName ?? '').trim() && !(t.windowTitle ?? '').trim()) {
    return 'The coordinates follow a window — fill in its process name or its title.';
  }
  switch (t.conditionType) {
    case 'WindowOpen':
      return (t.windowProcessName ?? '').trim() || (t.windowTitle ?? '').trim() ? null : 'Fill in a process name or a window title — with both blank this can never match.';
    case 'ProcessRunning':
      return (t.windowProcessName ?? '').trim() ? null : 'Fill in a process name.';
    case 'FileExists':
      return (t.filePath ?? '').trim() ? null : 'Fill in a file or folder path.';
    case 'ImageFound':
      return t.imagePath ? null : 'Capture a reference image.';
    case 'ScreenText': {
      if (!t.searchRegion) return 'Draw the region to read — reading the whole screen every check is too slow.';
      const number = isNumberMode(t.ocrReadAs);
      const operand = t.conditionOperand ?? '';
      const color = (t.ocrTextColor ?? '').trim();
      if (color && !/^#?[0-9A-Fa-f]{6}$/.test(color)) return 'Text color must be 6 hex digits (RRGGBB) — use Pick, or clear it.';
      if (number) return parsesAsNumber(operand) ? null : 'Enter a number to compare with.';
      if (effectiveOperator(t.conditionOperator, false) === 'regex') {
        if (!operand) return 'Enter the pattern to watch for.';
        const bad = regexProblem(operand);
        return bad ? `${bad}.` : null;
      }
      return operand.trim() ? null : 'Enter the text to watch for.';
    }
    case 'PixelColorMatch':
      return /^#?[0-9A-Fa-f]{6}$/.test((t.pixelColor ?? '').trim()) ? null : 'Pick the color, or type it as six hex digits (RRGGBB) — a three-digit shorthand is not accepted.';
    default:
      return null;
  }
}

// ── How a row reads ──

export type Group = 'armed' | 'off' | 'attention';
/** Why a status is what it is, for its tooltip (said in the page, in both languages). */
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
  const t = e.trigger;
  if (!t.armed) return { group: 'off', tone: 'off', text: 'Off' };
  if (e.isDisabled) return { group: 'attention', tone: 'warn', text: 'Macro is disabled', why: 'disabled' };
  const never = whyCannotFire(t);
  if (never) return { group: 'attention', tone: 'warn', text: 'Never fires', why: 'never', detail: never };
  if (!runAutomations) return { group: 'armed', tone: 'paused', text: 'Paused', why: 'paused' };
  if (e.running) {
    if (t.kind !== 'condition' && e.nextDueAt) return { group: 'armed', tone: 'ok', text: `Next at ${whenText(e.nextDueAt)}` };
    // Only a condition that stays true or false has a state to tell; the clipboard fires on a change.
    const level = t.kind === 'condition' && t.conditionType !== 'ClipboardChanged';
    return { group: 'armed', tone: 'ok', text: 'Watching', why: level ? (e.conditionTrue ? 'true' : 'false') : undefined };
  }
  if (e.lastResult && e.lastResult !== 'fired') return { group: 'attention', tone: 'warn', text: 'Not watching', why: 'stopped', detail: e.lastResult };
  return { group: 'armed', tone: 'ok', text: 'Armed' };
}

// Made once: toLocaleTimeString builds a formatter on every call, and the table says two times a
// row on every state the engine sends (every 2 s while the page is open).
const CLOCK = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat([], { day: 'numeric', month: 'short' });

/** An instant the engine reported: the time alone today, the day before it otherwise (lastFiredAt survives restarts). */
export function whenText(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = CLOCK.format(d);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return time;
  return `${DAY.format(d)} ${time}`;
}

// ── How a trigger reads ──

/** Mon to Sun, as the engine's mask has them (Sun = 1 << 0). */
export const WEEK = [
  { bit: 1 << 1, short: 'Mon', name: 'Monday', pt: 'Segunda' },
  { bit: 1 << 2, short: 'Tue', name: 'Tuesday', pt: 'Terça' },
  { bit: 1 << 3, short: 'Wed', name: 'Wednesday', pt: 'Quarta' },
  { bit: 1 << 4, short: 'Thu', name: 'Thursday', pt: 'Quinta' },
  { bit: 1 << 5, short: 'Fri', name: 'Friday', pt: 'Sexta' },
  { bit: 1 << 6, short: 'Sat', name: 'Saturday', pt: 'Sábado' },
  { bit: 1 << 0, short: 'Sun', name: 'Sunday', pt: 'Domingo' },
];

/** The days a schedule runs: "Every day", "Mon to Fri", "Weekends", "Mon, Wed, Fri". */
export function daysText(mask: number): string {
  const on = WEEK.map(d => (mask & d.bit) !== 0);
  const n = on.filter(Boolean).length;
  if (n === 0 || n === 7) return 'Every day';
  if (n === 2 && on[5] && on[6]) return 'Weekends';
  const first = on.indexOf(true);
  const last = on.lastIndexOf(true);
  if (n >= 3 && last - first + 1 === n) return `${WEEK[first].short} to ${WEEK[last].short}`;
  return WEEK.filter((_, i) => on[i]).map(d => d.short).join(', ');
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
  return `${s / UNIT_SECONDS[unit]} ${unit}`;
}

/** How often a condition is checked when it says 0 (TriggerService.DefaultPollCadenceMs). */
export const defaultPollMs = (conditionType: string | null | undefined) =>
  (conditionType === 'PixelColorMatch' ? 250 : conditionType === 'ClipboardChanged' ? 500 : 1000);
/** The wait between a condition's fires when it says 0 (5 s for the clipboard, 30 s otherwise). */
export const defaultCooldown = (conditionType: string | null | undefined) => (conditionType === 'ClipboardChanged' ? 5 : 30);
/** Milliseconds as seconds, as the fields and the summaries say them: "2", "0.25". */
export const secondsText = (ms: number) => String(Math.round(ms) / 1000);

const CONDITIONS: Record<string, string> = {
  WindowOpen: 'window open',
  ProcessRunning: 'process running',
  FileExists: 'file exists',
  PixelColorMatch: 'pixel color',
  ImageFound: 'image found',
  ScreenText: 'text on screen',
  ClipboardChanged: 'clipboard changes',
};
const NUMBER_OPS: Record<string, string> = { eq: '=', neq: '≠', gt: '>', lt: '<' };

/** What a condition watches, in a few words, and the value it watches for (shown quoted), if any. */
export function conditionWords(t: TriggerConfig): { what: string; value: string | null } {
  const what = CONDITIONS[t.conditionType ?? ''] ?? (t.conditionType ?? 'condition');
  const trim = (v: string | null | undefined) => (v ?? '').trim() || null;
  switch (t.conditionType) {
    case 'WindowOpen': return { what, value: trim(t.windowTitle) ?? trim(t.windowProcessName) };
    case 'ProcessRunning': return { what, value: trim(t.windowProcessName) };
    case 'FileExists': return { what, value: trim(t.filePath)?.split(/[\\/]/).filter(Boolean).pop() ?? null };
    case 'PixelColorMatch': return { what, value: trim(t.pixelColor) };
    case 'ScreenText': {
      const operand = trim(t.conditionOperand);
      if (!operand) return { what, value: null };
      return { what, value: isNumberMode(t.ocrReadAs) ? `${NUMBER_OPS[effectiveOperator(t.conditionOperator, true)] ?? '='} ${operand}` : operand };
    }
    case 'ClipboardChanged': return { what, value: trim(t.clipboardPattern) };
    default: return { what, value: null };
  }
}

/** The hours an interval or a condition runs in ("09:00–18:00"), or null for any hour. */
export function hoursText(t: TriggerConfig): string | null {
  if (t.kind === 'schedule') return null;
  const r = rangeParts(t.timeOfDay);
  return r ? `${r.from}–${r.to}` : null;
}

export interface TriggerWords {
  /** "Every", "At" or "When", said quieter. */
  lead: string;
  main: string;
  /** The value watched for, shown in quotes. */
  quote: string | null;
  /** The hours or the days, said after a dot. */
  tail: string | null;
}
/** The Trigger column: "Every 15 min · 08:00–20:00", "At 23:00 · Mon to Fri", "When text on screen “Aceitar”". */
export function triggerWords(t: TriggerConfig): TriggerWords {
  if (t.kind === 'interval') return { lead: 'Every', main: everyText(t.intervalSeconds), quote: null, tail: hoursText(t) };
  if (t.kind === 'schedule') return { lead: 'At', main: t.timeOfDay && !rangeParts(t.timeOfDay) ? t.timeOfDay : '—', quote: null, tail: daysText(t.daysOfWeek) };
  const c = conditionWords(t);
  return { lead: 'When', main: c.what, quote: c.value, tail: hoursText(t) };
}
/** The same, as one line of plain text (the filter, the accessible names). */
export function triggerText(t: TriggerConfig): string {
  const w = triggerWords(t);
  return `${w.lead} ${w.main}${w.quote ? ` “${w.quote}”` : ''}${w.tail ? ` · ${w.tail}` : ''}`;
}

/** The Inspector's card: a title and a line under it (the Running board: "Text on screen" · "“Aceitar” · every 2 s · 09:00–18:00"). */
export function cardWords(t: TriggerConfig): { title: string; sub: string } {
  if (t.kind === 'interval') return { title: `Every ${everyText(t.intervalSeconds)}`, sub: hoursText(t) ?? 'At any hour' };
  if (t.kind === 'schedule') return { title: `At ${triggerWords(t).main}`, sub: daysText(t.daysOfWeek) };
  const c = conditionWords(t);
  const every = `every ${secondsText(t.pollIntervalMs > 0 ? t.pollIntervalMs : defaultPollMs(t.conditionType))} s`;
  return {
    title: c.what.charAt(0).toUpperCase() + c.what.slice(1),
    sub: [c.value ? `“${c.value}”` : null, every, hoursText(t)].filter(Boolean).join(' · '),
  };
}
