// ── {date} / {time} / {datetime} with an offset and a format ─────────────────
// The TypeScript half of ActionExecution.ResolveDateTimeTokens, for the Preview tab, the chip
// popover and the argument gate. Same grammar, segment for segment:
//
//   {date:+7}   {date:-1:yyyy-MM-dd}   {time:HH:mm}   {datetime:+1mo:dd/MM/yyyy HH:mm}   {date:D}
//
// The segments after the head are split on ':'. Every segment shaped like an offset — [+-]N with an
// optional unit: d (days, the default), w, mo (months), y, h, min or m (minutes), s — is applied in
// order; the remaining segments, re-joined with ':', are the .NET format: a custom pattern, or a
// single letter naming a standard one. No format → the classic dd/MM/yyyy · HH:mm:ss ·
// dd/MM/yyyy - HH:mm:ss.
//
// The engine formats with the machine's culture and the two separators pinned to '/' and ':'
// (TokenCulture), so a pattern prints as typed while month and day names follow the machine. This
// port takes the names from Intl for the locale it is given; the culture-dependent STANDARD
// formats (d D t T f F g G y m) use the pt-BR patterns for a Portuguese locale and en-US otherwise,
// which is why the Preview tab keeps saying names follow the machine at replay.
//
// A format .NET throws on — an unterminated quote, a trailing backslash, an unknown single letter —
// makes the engine leave the token LITERAL; resolveDateToken returns null for exactly those.
//
// Pure and React-free on purpose: the gate imports it, and it is proven head-lessly against the
// engine on a fixed instant.

export type DateHead = 'date' | 'time' | 'datetime';
export type DateUnit = 'd' | 'w' | 'mo' | 'y' | 'h' | 'min' | 's';

export interface DateOffset { n: number; unit: DateUnit }
export interface DateTokenArgs { offsets: DateOffset[]; format: string | null }

export const DEFAULT_DATE_FORMAT: Record<DateHead, string> = {
  date: 'dd/MM/yyyy',
  time: 'HH:mm:ss',
  datetime: 'dd/MM/yyyy - HH:mm:ss',
};

// ActionExecution.DateOffsetRegex, verbatim. Six digits at most: the engine parses the number as
// an int, and anything longer is a format segment on both sides.
const OFFSET_RE = /^([+-]\d{1,6})(d|w|mo|y|h|min|m|s)?$/i;

export function parseDateOffset(seg: string): DateOffset | null {
  const m = OFFSET_RE.exec(seg);
  if (!m) return null;
  const u = (m[2] ?? '').toLowerCase();
  const unit: DateUnit = u === '' || u === 'd' ? 'd' : u === 'm' || u === 'min' ? 'min' : (u as DateUnit);
  return { n: Number(m[1]), unit };
}

/** `mods` = the segments after the head, i.e. token.slice(1, -1).split(':').slice(1). */
export function parseDateTokenArgs(mods: readonly string[]): DateTokenArgs {
  const offsets: DateOffset[] = [];
  const formatParts: string[] = [];
  for (const seg of mods) {
    const o = parseDateOffset(seg);
    if (o) offsets.push(o);
    else formatParts.push(seg);
  }
  const joined = formatParts.join(':');
  return { offsets, format: joined.trim().length > 0 ? joined : null };
}

// ── Offsets: wall-clock arithmetic, as DateTime.Add* does on a Local instant ──
// setDate/setHours keep the clock reading across a DST change, which is what adding ticks to a
// wall-clock DateTime does; adding milliseconds would shift the reading by an hour.
function addDays(d: Date, n: number): Date { const r = new Date(d.getTime()); r.setDate(r.getDate() + n); return r; }
function addHours(d: Date, n: number): Date { const r = new Date(d.getTime()); r.setHours(r.getHours() + n); return r; }
function addMinutes(d: Date, n: number): Date { const r = new Date(d.getTime()); r.setMinutes(r.getMinutes() + n); return r; }
function addSeconds(d: Date, n: number): Date { const r = new Date(d.getTime()); r.setSeconds(r.getSeconds() + n); return r; }
// DateTime.AddMonths clamps the day to the target month (Jan 31 + 1 = Feb 28); AddYears is the
// same clamp twelve months at a time (Feb 29 + 1y = Feb 28).
function addMonths(d: Date, n: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth() + n;
  const last = new Date(y, m + 1, 0).getDate();
  const r = new Date(d.getTime());
  r.setFullYear(y, m, Math.min(d.getDate(), last));
  return r;
}

export function applyDateOffsets(now: Date, offsets: readonly DateOffset[]): Date {
  let d = new Date(now.getTime());
  for (const o of offsets) {
    switch (o.unit) {
      case 'd': d = addDays(d, o.n); break;
      case 'w': d = addDays(d, 7 * o.n); break;
      case 'mo': d = addMonths(d, o.n); break;
      case 'y': d = addMonths(d, 12 * o.n); break;
      case 'h': d = addHours(d, o.n); break;
      case 'min': d = addMinutes(d, o.n); break;
      case 's': d = addSeconds(d, o.n); break;
    }
  }
  return d;
}

// ── The .NET format port ─────────────────────────────────────────────────────
const pad = (n: number, w: number) => String(n).padStart(w, '0');

function intlPart(d: Date, locale: string, opts: Intl.DateTimeFormatOptions, type: string): string {
  try {
    return new Intl.DateTimeFormat(locale, opts).formatToParts(d).find((p) => p.type === type)?.value ?? '';
  } catch {
    return '';
  }
}

function dayPeriod(d: Date, locale: string): string {
  const p = intlPart(d, locale, { hour: 'numeric', hour12: true }, 'dayPeriod');
  return p || (d.getHours() < 12 ? 'AM' : 'PM');
}

function tzOffset(d: Date, run: number): string {
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const h = Math.floor(Math.abs(off) / 60);
  const m = Math.abs(off) % 60;
  return run === 1 ? `${sign}${h}` : run === 2 ? `${sign}${pad(h, 2)}` : `${sign}${pad(h, 2)}:${pad(m, 2)}`;
}

// One specifier run — the character and how many times it repeats. null = not a specifier at
// all, and the caller emits the run as literal text, as .NET does.
function specifier(d: Date, c: string, run: number, locale: string): string | null {
  switch (c) {
    case 'd':
      return run === 1 ? String(d.getDate())
        : run === 2 ? pad(d.getDate(), 2)
        : run === 3 ? intlPart(d, locale, { weekday: 'short' }, 'weekday')
        : intlPart(d, locale, { weekday: 'long' }, 'weekday');
    case 'M':
      return run === 1 ? String(d.getMonth() + 1)
        : run === 2 ? pad(d.getMonth() + 1, 2)
        : run === 3 ? intlPart(d, locale, { month: 'short' }, 'month')
        : intlPart(d, locale, { month: 'long' }, 'month');
    case 'y': {
      const y = d.getFullYear();
      return run === 1 ? String(y % 100) : run === 2 ? pad(y % 100, 2) : pad(y, run);
    }
    case 'H': return run === 1 ? String(d.getHours()) : pad(d.getHours(), 2);
    case 'h': { const h = d.getHours() % 12 || 12; return run === 1 ? String(h) : pad(h, 2); }
    case 'm': return run === 1 ? String(d.getMinutes()) : pad(d.getMinutes(), 2);
    case 's': return run === 1 ? String(d.getSeconds()) : pad(d.getSeconds(), 2);
    case 'f':
    case 'F': {
      // Fractions of a second in ticks (seven digits); 'F' drops the trailing zeros.
      if (run > 7) throw new Error('too many fraction digits');
      const frac = String(d.getMilliseconds() * 10000).padStart(7, '0').slice(0, run);
      return c === 'f' ? frac : frac.replace(/0+$/, '');
    }
    case 't': { const p = dayPeriod(d, locale); return run === 1 ? p.slice(0, 1) : p; }
    case 'z': return tzOffset(d, run);
    case 'K': return tzOffset(d, 3);
    case 'g': return intlPart(d, locale, { era: 'short', year: 'numeric' }, 'era') || 'A.D.';
    default: return null;
  }
}

function custom(d: Date, format: string, locale: string): string {
  let out = '';
  let i = 0;
  while (i < format.length) {
    const c = format[i];
    if (c === '"' || c === "'") {
      const end = format.indexOf(c, i + 1);
      if (end < 0) throw new Error('unterminated quote');
      out += format.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '\\') {
      if (i + 1 >= format.length) throw new Error('trailing backslash');
      out += format[i + 1];
      i += 2;
      continue;
    }
    if (c === '%') { i++; continue; }          // "%d": the next character is a custom specifier
    if (c === '/' || c === ':') { out += c; i++; continue; }   // TokenCulture pins both separators
    let j = i;
    while (j < format.length && format[j] === c) j++;
    const piece = specifier(d, c, j - i, locale);
    out += piece === null ? format.slice(i, j) : piece;
    i = j;
  }
  return out;
}

// The culture-dependent standard patterns, as .NET's pt-BR and en-US DateTimeFormat carry them.
const PATTERNS = {
  pt: { shortDate: 'dd/MM/yyyy', longDate: "dddd, d 'de' MMMM 'de' yyyy", shortTime: 'HH:mm', longTime: 'HH:mm:ss', yearMonth: "MMMM 'de' yyyy", monthDay: "d 'de' MMMM" },
  en: { shortDate: 'M/d/yyyy', longDate: 'dddd, MMMM d, yyyy', shortTime: 'h:mm tt', longTime: 'h:mm:ss tt', yearMonth: 'MMMM yyyy', monthDay: 'MMMM d' },
};

function standard(d: Date, f: string, locale: string): string {
  const p = locale.toLowerCase().startsWith('pt') ? PATTERNS.pt : PATTERNS.en;
  switch (f) {
    case 'd': return custom(d, p.shortDate, locale);
    case 'D': return custom(d, p.longDate, locale);
    case 't': return custom(d, p.shortTime, locale);
    case 'T': return custom(d, p.longTime, locale);
    case 'f': return custom(d, `${p.longDate} ${p.shortTime}`, locale);
    case 'F': return custom(d, `${p.longDate} ${p.longTime}`, locale);
    case 'g': return custom(d, `${p.shortDate} ${p.shortTime}`, locale);
    case 'G': return custom(d, `${p.shortDate} ${p.longTime}`, locale);
    case 'y': case 'Y': return custom(d, p.yearMonth, locale);
    case 'm': case 'M': return custom(d, p.monthDay, locale);
    case 's': return custom(d, "yyyy'-'MM'-'dd'T'HH':'mm':'ss", locale);
    case 'u': return custom(d, "yyyy'-'MM'-'dd HH':'mm':'ss'Z'", locale);
    case 'o': case 'O': return custom(d, "yyyy'-'MM'-'dd'T'HH':'mm':'ss'.'fffffffK", locale);
    case 'r': case 'R': return custom(d, "ddd', 'dd MMM yyyy HH':'mm':'ss 'GMT'", 'en-US');
    default: throw new Error('unknown standard format');
  }
}

/** DateTime.ToString(format, TokenCulture): one character is a standard format, more is custom. Throws where .NET throws. */
export function formatDotNetDate(d: Date, format: string, locale: string): string {
  return format.length === 1 ? standard(d, format, locale) : custom(d, format, locale);
}

/**
 * The whole token, resolved as the engine resolves it at `now`: offsets applied, then the format
 * (or the head's default). null where the engine leaves the token literal — a format .NET rejects,
 * or an offset that leaves the calendar. Returns null for a token that is not a date head at all.
 */
export function resolveDateToken(token: string, now: Date, locale: string): string | null {
  const inner = token.slice(1, -1);
  const parts = inner.split(':');
  const head = parts[0].toLowerCase();
  if (head !== 'date' && head !== 'time' && head !== 'datetime') return null;
  // DateTokenRegex's argument group is (?::([^}]+))? — a colon followed by NOTHING ({date:}) is no
  // match at all, so the engine leaves that token literal.
  if (parts.length > 1 && inner.length === head.length + 1) return null;
  const args = parseDateTokenArgs(parts.slice(1));
  try {
    const when = applyDateOffsets(now, args.offsets);
    if (Number.isNaN(when.getTime()) || when.getFullYear() < 1 || when.getFullYear() > 9999) return null;
    return formatDotNetDate(when, args.format ?? DEFAULT_DATE_FORMAT[head], locale);
  } catch {
    return null;
  }
}
