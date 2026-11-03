// ── What a {token} MEANS ────────────────────────────────────────────────────
//
// ONE source of truth for the human explanation of a token, the way tokenNormalize owns the
// answer to "is this a token at all". Three surfaces need it and only one had it: the Insert
// palette (SendTextDialog's chip arrays), the in-editor chip (lexical/TokenChip) and the grid
// preview (SendTextPreview). The palette's ~300-character explanation of {clipboard:next}
// vanished the instant the user clicked the chip and it BECAME a chip.
//
// Keyed by token NAME, lower-cased, because a chip carries a whole token — {Clipboard:trim:upper},
// {row:First Name:trim} — while the explanation is per name. The two names whose ARGUMENT changes
// the meaning ({clipboard:next} vs a plain {clipboard} with a chain; bare {row}, the action-row
// counter, vs {row:Column}, the data cell) get a VARIANT, checked first.
//
// The text is the catalog's (i18n/<language>/tokens.ts), put in at compile time: t() in the tables
// below becomes the build's text, so this module still needs no React context and every surface
// reads the same sentence. Data only, no JSX: it stays a .ts and cannot leak a component across a
// react-refresh boundary.
import { t } from '../../i18n';
import { hasNextModifier } from './clipboardModifiers';
import type { KnownTokenName } from './tokenNormalize';

export interface TokenDescription {
  /** What the token does. Surface-neutral: true on a chip, in the popover and in the grid. */
  tip: string;
  /**
   * PALETTE-ONLY replacement. Three tokens need to tell the user "click the chip after
   * inserting to add transforms" — advice that is nonsense once you are already looking at the
   * chip. Stored as a full sentence rather than a suffix, so each language words the whole of it.
   */
  paletteTip?: string;
}

// Base entry per name. Record<KnownTokenName, …> is load-bearing: tsc fails if the engine
// whitelist in tokenNormalize gains a name and this table does not.
const BY_NAME: Record<KnownTokenName, TokenDescription> = {
  clipboard: { tip: t('tokens.desc.clipboard') },
  // The three clock tokens take an offset and a format since 2.37.0; the chip popover builds
  // both, so the palette says where to click. A token that already carries them gets the
  // VARIANT below instead of a tip promising dd/MM/yyyy.
  date: { tip: t('tokens.desc.date'), paletteTip: t('tokens.palette.date') },
  time: { tip: t('tokens.desc.time'), paletteTip: t('tokens.palette.time') },
  datetime: { tip: t('tokens.desc.datetime'), paletteTip: t('tokens.palette.datetime') },
  enter: { tip: t('tokens.desc.enter') },
  tab: { tip: t('tokens.desc.tab') },
  space: { tip: t('tokens.desc.space') },
  backspace: { tip: t('tokens.desc.backspace') },
  delete: { tip: t('tokens.desc.delete') },
  escape: { tip: t('tokens.desc.escape') },
  // {esc} is a real alias of {escape}, not an escape hatch — see the banner in tokenNormalize.
  esc: { tip: t('tokens.desc.esc') },
  home: { tip: t('tokens.desc.home') },
  end: { tip: t('tokens.desc.end') },
  pageup: { tip: t('tokens.desc.pageup') },
  pagedown: { tip: t('tokens.desc.pagedown') },
  up: { tip: t('tokens.desc.up') },
  down: { tip: t('tokens.desc.down') },
  left: { tip: t('tokens.desc.left') },
  right: { tip: t('tokens.desc.right') },
  delay: { tip: t('tokens.desc.delay') },
  random: { tip: t('tokens.desc.random') },
  // {pick} is not chain-bearing, so the name prompt has no Advanced… button for it — the chip
  // really is the only way to edit the list, and the palette has to say so.
  pick: { tip: t('tokens.desc.pick'), paletteTip: t('tokens.palette.pick') },
  var: { tip: t('tokens.desc.var') },
  counter: { tip: t('tokens.desc.counter') },
  // The block-level twin of {counter}: While and For Each keep their own count, and outside a
  // block it reads the run repeat, so it is "the loop I am in" at every depth.
  loop: { tip: t('tokens.desc.loop') },
  datarow: { tip: t('tokens.desc.datarow') },
  // Bare {row}. The {row:Column} form is a different token entirely — see ROW_COLUMN below.
  row: { tip: t('tokens.desc.row') },
  // No paletteTip: the name prompt for {rownext:} now offers an Advanced… button, so the old
  // "click the chip after inserting to add transforms" is advice for a route that is no longer
  // the only one.
  rownext: { tip: t('tokens.desc.rownext') },
  clip: { tip: t('tokens.desc.clip') },
  // The "can hold anything recently copied, including passwords" caution is NOT lost by trimming
  // here — it lives in full in ClipboardSurface's IDENTITY_HINTS, which is the surface you are
  // looking at when you actually pick an item. A hover tip is the wrong place for a paragraph.
  // {winclip:N} is a direct-insert chip with no name prompt, so the chip really is the only way to
  // change the index.
  winclip: { tip: t('tokens.desc.winclip'), paletteTip: t('tokens.palette.winclip') },
  input: { tip: t('tokens.desc.input') },
  // Generated and machine values (2.37.0). Each occurrence of {uuid} is a NEW id — a Set Variable
  // is how a macro reuses one — and that is the whole point of saying "each use" here.
  uuid: { tip: t('tokens.desc.uuid'), paletteTip: t('tokens.palette.uuid') },
  timestamp: { tip: t('tokens.desc.timestamp'), paletteTip: t('tokens.palette.timestamp') },
  env: { tip: t('tokens.desc.env') },
};

// {clipboard:next} is a direct-insert chip, and the palette's Advanced… button opens on a PLAIN
// {clipboard}, so the chip is still the only route to a chain on this one.
const CLIPBOARD_NEXT: TokenDescription = { tip: t('tokens.variants.clipboardNext'), paletteTip: t('tokens.palette.clipboardNext') };

// No "(loop over data)" qualifier and no paletteTip.
//
// The qualifier was WRONG, and a real replay proved it: with the toggle OFF the engine still
// substitutes a row — it uses a cursor that advances between runs (Model B). Saying "loop over
// data" implied the token needs that setting to work at all. The name prompt also offers an
// Advanced… button now, so the old "click the chip to add transforms" is no longer the only route.
const ROW_COLUMN: TokenDescription = { tip: t('tokens.variants.rowColumn') };

// A clock token carrying an offset and/or a format: the base tip's "(dd/MM/yyyy)" would be a lie.
const DATE_SHIFTED: TokenDescription = { tip: t('tokens.variants.dateShifted') };
const TIME_SHIFTED: TokenDescription = { tip: t('tokens.variants.timeShifted') };
const DATETIME_SHIFTED: TokenDescription = { tip: t('tokens.variants.datetimeShifted') };

// A run counter carrying a chain ({counter:pad:3}): the base tip's "(1, 2, 3…)" would promise the
// bare number.
const COUNTER_SHAPED: TokenDescription = { tip: t('tokens.variants.counterShaped') };
const LOOP_SHAPED: TokenDescription = { tip: t('tokens.variants.loopShaped') };
const DATAROW_SHAPED: TokenDescription = { tip: t('tokens.variants.datarowShaped') };
const UUID_SHAPED: TokenDescription = { tip: t('tokens.variants.uuidShaped') };
// The unit is the FIRST segment; anything after it is the chain, and a chain alone is still seconds.
const TIMESTAMP_MS: TokenDescription = { tip: t('tokens.variants.timestampMs') };
const TIMESTAMP_SHAPED: TokenDescription = { tip: t('tokens.variants.timestampShaped') };

// Tokens whose ARGUMENT changes what they mean. Checked before BY_NAME; first match wins.
const VARIANTS: readonly { name: string; when: (token: string, mods: string[]) => boolean; desc: TokenDescription }[] = [
  { name: 'clipboard', when: (token) => hasNextModifier(token), desc: CLIPBOARD_NEXT },
  { name: 'row', when: (_token, mods) => mods.length > 0, desc: ROW_COLUMN },
  { name: 'date', when: (_token, mods) => mods.length > 0, desc: DATE_SHIFTED },
  { name: 'time', when: (_token, mods) => mods.length > 0, desc: TIME_SHIFTED },
  { name: 'datetime', when: (_token, mods) => mods.length > 0, desc: DATETIME_SHIFTED },
  { name: 'counter', when: (_token, mods) => mods.length > 0, desc: COUNTER_SHAPED },
  { name: 'loop', when: (_token, mods) => mods.length > 0, desc: LOOP_SHAPED },
  { name: 'datarow', when: (_token, mods) => mods.length > 0, desc: DATAROW_SHAPED },
  { name: 'uuid', when: (_token, mods) => mods.length > 0, desc: UUID_SHAPED },
  { name: 'timestamp', when: (_token, mods) => mods[0]?.toLowerCase() === 'ms', desc: TIMESTAMP_MS },
  { name: 'timestamp', when: (_token, mods) => mods.length > 0, desc: TIMESTAMP_SHAPED },
];

// Same split every other surface does — normalizeToken, splitTokenSegments and chainHeadKind all
// take the name as everything before the first ':', case-folded.
function splitToken(token: string): { name: string; mods: string[] } | null {
  if (token.length < 3 || token[0] !== '{' || token[token.length - 1] !== '}') return null;
  const inner = token.slice(1, -1);
  if (!inner) return null;
  const parts = inner.split(':');
  return { name: parts[0].toLowerCase(), mods: parts.slice(1) };
}

/** The entry for a whole token, or null when the name is not one the engine resolves. */
export function describeToken(token: string): TokenDescription | null {
  const split = splitToken(token);
  if (!split) return null;
  for (const v of VARIANTS) {
    if (v.name === split.name && v.when(token, split.mods)) return v.desc;
  }
  return BY_NAME[split.name as KnownTokenName] ?? null;
}

// The plain key-press tokens. A chip that reads "Enter" needs no hover saying "Press Enter", so
// tokenTip returns '' for these when asked to (skipKeys) — the popover header, which is text and
// not a hover, keeps the description.
const KEY_PRESS_TOKENS = new Set([
  'enter', 'tab', 'space', 'backspace', 'delete', 'escape', 'esc', 'home', 'end',
  'pageup', 'pagedown', 'up', 'down', 'left', 'right',
]);

export interface TokenTipOptions {
  /**
   * Append ` — {raw token}` when the token carries arguments, so the reader sees exactly what
   * will run. On by default: the in-editor chip renders `token.slice(1, -1)` (no braces) and the
   * grid chip sits inside a truncating cell, so neither reliably shows the full chain. Pass false
   * from the palette, where the chip is a generic SEED and not the user's token.
   */
  withRaw?: boolean;
  /** Prefer paletteTip when the entry has one. Palette only. */
  palette?: boolean;
  /** Return '' for the plain key-press tokens (see KEY_PRESS_TOKENS). Hover surfaces only. */
  skipKeys?: boolean;
}

/**
 * Ready-to-render tooltip text for a token, in the build's language (the catalog's). Empty string
 * when the name is unknown.
 */
export function tokenTip(token: string, opts: TokenTipOptions = {}): string {
  const { withRaw = true, palette = false, skipKeys = false } = opts;
  const entry = describeToken(token);
  if (!entry) return '';
  const split = splitToken(token);
  if (skipKeys && KEY_PRESS_TOKENS.has(split?.name ?? '')) return '';
  const text = (palette && entry.paletteTip) || entry.tip;
  // The tooltip surface is white-space: normal, so a newline would collapse — the raw token is
  // joined with a visible em dash, not a line break.
  return withRaw && split && split.mods.length > 0 ? `${text} — ${token}` : text;
}
