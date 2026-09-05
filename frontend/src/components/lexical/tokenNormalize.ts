// Canonical form for `{Variable[:mods]}` tokens. Used both as the chip display
// string and as the stored __token value so the editor never shows `{enter}`
// next to `{Enter}` next to `{ENTER}` — every chip looks the same regardless
// of how the user typed/pasted it.
//
// Rules:
//   - Variable name: title-cased (first letter upper, rest lower) UNLESS it's
//     a known compound — DateTime, PageUp, PageDown follow the camelCase form
//     used by MDN's KeyboardEvent.code and most language stdlibs.
//   - Alphabetic modifiers: lower (the backend already lower-cases them, and
//     visually they read as parameters next to numeric modifiers like `:10`).
//   - Numeric modifiers: kept as-is.
//
// Backend processing is case-insensitive so this is purely cosmetic; existing
// saved actions that contain `{enter}` continue to work and get normalised on
// next edit.
import { verbatimArgIndices } from './clipboardModifiers';

const COMPOUND_NAMES: Record<string, string> = {
  datetime: 'DateTime',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  winclip: 'WinClip',
  rownext: 'RowNext',
};

// {input:...} is the one token whose WHOLE argument is free text — the Ask-Input label plus its
// menu options, which may themselves contain ':'. It survives via the split+rejoin on ':' below,
// so {input:Label|menu:a,b,c} and {input:Enter time (HH:MM)} both round-trip unchanged.
//
// {var:Name} and {clip:Name} used to live here too, back when their whole argument was a name.
// They now carry a modifier tail like {row:Column[:mods]}, so they moved to NAME_FIRST_ARG_NAMES:
// the FIRST arg stays verbatim (case-folding {var:MyVar} would rewrite the user's text on every
// open/close, and backend lookups are case-insensitive anyway) while the segments after it are
// clipboard-style modifiers and follow the modifier rules.
// {pick:a|b|c} joins {input} here for the same reason: its whole argument is free text (the
// '|'-separated options, which may carry spaces, ':' and accents). Without this, the pure-alpha
// segment fold below would rewrite the OPTIONS on every chip creation ({Pick:Sim} → {Pick:sim}).
const VERBATIM_ARG_NAMES = new Set(['input', 'pick']);

// Heads whose first argument is a user-chosen name/column, followed by an optional modifier chain.
const NAME_FIRST_ARG_NAMES = new Set(['row', 'rownext', 'var', 'clip']);

export function normalizeToken(token: string): string {
  if (token.length < 2 || token[0] !== '{' || token[token.length - 1] !== '}') {
    return token;
  }
  const inner = token.slice(1, -1);
  if (!inner) return token;
  const parts = inner.split(':');
  const name = parts[0];
  if (!name) return token;
  const lowerName = name.toLowerCase();
  const normalizedName =
    COMPOUND_NAMES[lowerName] ?? name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  const mods = parts.slice(1);
  const keepArgsVerbatim = VERBATIM_ARG_NAMES.has(lowerName);
  // {row:Column}, {rownext:Column}, {var:Name} and {clip:Name} all carry a verbatim name as
  // their first arg, with the modifier chain starting after it.
  const isRow = NAME_FIRST_ARG_NAMES.has(lowerName);
  // The modifier tail starts after the column name for row/rownext, at the top otherwise.
  const verbatimArgs = keepArgsVerbatim ? new Set<number>() : verbatimArgIndices(mods, isRow ? 1 : 0);
  const normalizedMods = mods.map((p, idx) => {
    // Name-bearing tokens ({var:Name}/{clip:Name}/{input:...}) keep args untouched.
    if (keepArgsVerbatim) return p;
    // {row:Column:mods} — the first arg is the user's column name (verbatim);
    // later args are clipboard-style modifiers and follow the rules below. (A
    // column literally named "join" would shield the next segment from folding —
    // cosmetic only, the backend lower-cases modifiers itself.)
    if (isRow && idx === 0) return p;
    // The freeform-text arguments — a join separator or a split delimiter — are TEXT, and
    // case-folding them rewrites what the user typed (join:AND ≠ join:and on screen). Which
    // segments those are comes from the arity walk itself, so this can never disagree with the
    // engine about who owns a segment.
    if (verbatimArgs.has(idx)) return p;
    return /^[a-zA-Z]+$/.test(p) ? p.toLowerCase() : p;
  });
  return `{${[normalizedName, ...normalizedMods].join(':')}}`;
}

// ── What the ENGINE calls a token ────────────────────────────────────────────
// ONE source of truth for "will the replay engine substitute this `{...}`, or is
// it literal text the user typed?". Three surfaces ask that question — the Lexical
// chipping pipeline, the "N tokens" figure in the Insert Text status strip, and the
// read-only SendTextPreview in the grid — and they used to answer it three different
// ways. The preview answered "yes" to EVERY `{...}`, so a literal `{xpto}` was drawn
// as a live chip promising a substitution that replay would never make, and the user
// could not tell it apart from a real one until the macro ran.
//
// Ported name-by-name from the matchers in Source/ActionExecution.cs:
// SpecialKeyPlaceholders (keyed WITH the braces — "{enter}" … "{esc}") plus the
// {delay:N} branch of ParseSendTextSegments; ClipboardTokenRegex; WinClipTokenRegex;
// RandomTokenRegex; InputTokenRegex; VarTokenRegex; RowDataTokenRegex;
// RowNextTokenRegex; ClipSlotTokenRegex; and the literal {date}/{time}/{datetime}/
// {counter}/{row} replaces in ResolveDateTimeTokens / ResolveRunStateTokens.
//
// SCOPE — this is a NAME test, exactly as wide as the chip pipeline's whitelist. It
// deliberately does NOT re-check each name's argument shape, which the engine also
// enforces: a bare {var} (VarTokenRegex requires ':name') or {winclip:abc} (requires
// digits) is counted and drawn here but pastes literally at replay. Narrowing it per
// name would split the preview from the chip pipeline again — the very divergence
// this set exists to close — so that is a separate finding, not a silent difference.
export const KNOWN_TOKEN_NAME_LIST = [
  'clipboard',
  'date',
  'time',
  'datetime',
  'enter',
  'tab',
  'space',
  'backspace',
  'delete',
  'escape',
  // {esc} is a REAL alias, not an escape hatch: SpecialKeyPlaceholders maps both
  // "{escape}" and "{esc}" to VK 0x1B and ParseSendTextSegments runs them down the
  // identical path, repeat count included ({esc:3} = three presses) — and the Chrome
  // extension's BrowserType parser accepts both too. It sat outside this set on the
  // theory that it was "SendText's literal-brace escape" and chipping it would hide
  // the escape mechanism; there is no such mechanism. Literal braces are escaped by
  // EscapeBracesForParser, which uses private-use sentinel CHARACTERS, and nothing in
  // either parser gives `esc` a meaning other than the Escape key. The cost of the
  // theory was that {esc} alone among the key tokens got no chip and no editor.
  'esc',
  'home',
  'end',
  'pageup',
  'pagedown',
  'up',
  'down',
  'left',
  'right',
  'delay',
  'random',
  // Run-state tokens (2.8.0): first-class chips like everything else the
  // backend resolves — {var:name}, {counter}, {row}, {row:column} (which also
  // takes the clipboard-style modifier chain: {row:column:trim:upper}).
  'var',
  'counter',
  'row',
  // {rownext:column} — like {row:column} but auto-advancing: each use pulls the NEXT
  // data row for that column (1st use → row 1, 2nd → row 2…), resetting each run.
  'rownext',
  // Clipboard slots: {clip:name} reads a selection captured by Copy to Slot /
  // the capture hotkey. Disjoint from {clipboard} (different name).
  'clip',
  // Windows clipboard history: {winclip:N} reads item N of the Win+V history
  // (1 = most recent). Distinct from {clip:name} (in-app slots) and {clipboard}.
  'winclip',
  // Ask-Input (Text Blaze style): {input:Label} / {input:Label|menu:a,b,c} prompts the user at
  // replay time. A spaced label or the |menu: variant falls outside the editor's TYPING grammar,
  // so those chip only via insertToken (the palette prompt); a bare {input:Name} chips when typed.
  // Both shapes are tokens to the walker below, because both resolve.
  'input',
  // Random text choice: {pick:a|b|c} draws one '|'-separated option per use. Options are
  // free text (VERBATIM_ARG_NAMES), so like {input} it chips via insertToken / on load.
  'pick',
] as const;

/** Every token NAME the engine resolves, as a union — the key type of the description table
 *  in tokenDescriptions.ts, so tsc fails if this whitelist gains a name and that table does
 *  not gain an entry. */
export type KnownTokenName = typeof KNOWN_TOKEN_NAME_LIST[number];

// Unchanged in type and contents; every existing consumer (splitTokenSegments below,
// LexicalTokenEditor's TokenAutoTransformPlugin) keeps asking the same ReadonlySet<string>.
export const KNOWN_TOKEN_NAMES: ReadonlySet<string> = new Set<string>(KNOWN_TOKEN_NAME_LIST);

export interface TokenSegment {
  kind: 'text' | 'token';
  value: string;
}

/**
 * Splits `text` into alternating literal runs and engine-resolved token runs.
 *
 * This is a port of how the ENGINE finds a token, which is deliberately WIDER than the
 * editor's typing grammar (lexical/typingGrammar's TOKEN_REGEX, which only auto-chips tokens
 * whose arguments are `[a-zA-Z0-9,_-]`). Three rules, each taken from the C# side:
 *
 *   1. A token spans '{' to the FIRST '}'. Every engine matcher bounds its argument with
 *      `[^}]` — ClipboardTokenRegex is `\{clipboard(?::([^}]+))?\}` — and ParseSendTextSegments
 *      scans forward to the first '}'. So an argument may hold ANY character except '}',
 *      including spaces and '@'. That is where the count was wrong: `{clipboard:join: - }`
 *      is a join whose separator is " - ", which the engine keeps RAW and substitutes
 *      happily, but the typing grammar rejects the spaces, so the status strip said "0 tokens"
 *      about a payload holding one.
 *   2. The NAME is everything before the first ':' (engine: `inner.Split(':')[0]`), compared
 *      case-insensitively — every engine matcher is IgnoreCase / OrdinalIgnoreCase.
 *   3. A run whose name is unknown re-anchors the scan at start+1 instead of skipping past its
 *      '}'. The engine's regexes are leftmost-first over the whole string, so the `{clipboard}`
 *      inside `{x{clipboard}` IS found there and must be found here; skipping would hide it.
 *
 * `scope` names the engine(s) behind the payload (TokenScope below); the default is SendText's.
 * A name the scope does not resolve is handled exactly like an unknown one — rule 3.
 */
export function splitTokenSegments(text: string, scope: TokenScope = 'desktop'): TokenSegment[] {
  const segments: TokenSegment[] = [];
  let lastIndex = 0;   // start of the literal run still waiting to be emitted
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const close = text.indexOf('}', open + 1);
    // No closing brace left in the string — every later '{' is past this point, so
    // none of them can close either. Nothing after here is a token.
    if (close < 0) break;
    const inner = text.slice(open + 1, close);
    const colon = inner.indexOf(':');
    const name = (colon < 0 ? inner : inner.slice(0, colon)).toLowerCase();
    if (!tokenResolvesIn(name, colon >= 0, scope)) {
      i = open + 1;   // rule 3 — re-anchor, don't skip the run
      continue;
    }
    if (open > lastIndex) segments.push({ kind: 'text', value: text.slice(lastIndex, open) });
    segments.push({ kind: 'token', value: text.slice(open, close + 1) });
    lastIndex = close + 1;
    i = close + 1;
  }
  if (lastIndex < text.length) segments.push({ kind: 'text', value: text.slice(lastIndex) });
  return segments;
}

// ── Will the RICH flavor survive this payload? ───────────────────────────────
// SimulateClipboardPaste attaches the HTML flavor only when the resolved plain text
// produced EXACTLY ONE non-empty text segment (Source/ActionExecution.cs:7163):
//
//     if (!string.IsNullOrEmpty(html) && segments.Count(s => !string.IsNullOrEmpty(s.Text)) == 1)
//
// so an {Enter}/{Tab}/{Delay:N} with text on BOTH sides silently downgrades the whole action
// to a plain paste — and so does a payload of nothing BUT keys, since 0 is not 1 either.
// Keys at the BORDERS are fine: their marker spans are stripped from the html by
// PrepareRichHtmlForSend (ActionExecution.cs:7104-7120) and they act at the segment level,
// around the paste.
//
// ORDERING — read this before touching the walk. ResolveTokens runs FIRST, over the whole
// string (ActionExecution.cs:7141), and ParseSendTextSegments runs over its OUTPUT (:7150).
// So {date}, {clipboard}, {var:x}, {random:1-10}, {pick:a|b} are already TEXT by the time the
// segment walk happens and can never split. Neither can their VALUES: that resolve pass is
// called with escapeBracesInSubstitution: true, which rewrites '{' / '}' inside substituted
// values to the private-use sentinels below (EscapeBracesForParser, :8136), and the walk emits
// sentinels as literal text. A clipboard holding "{enter}" therefore stays text.
//
// THIS PREDICTS THE AUTHORED PAYLOAD, AND THE ENGINE JUDGES THE RESOLVED ONE. They differ, in
// BOTH directions, and neither error is hypothetical — do not "simplify" this to a guarantee:
//
//   * OVER-warn — a token that resolves to the EMPTY string between two splitters collapses a
//     predicted 2-run payload to 1 run at replay. At least four paths resolve empty: an unset
//     {var:x}, {random:a-b} with unparsable bounds (:6867), {pick:} with no usable option
//     (:6884-6886), and {input:Label} on the static Test-Action path where InputProvider is
//     null (:6767-6768).
//   * UNDER-warn — the same empty resolution can collapse a predicted 1-run payload to 0 runs,
//     and `== 1` rejects 0 as well: `{clip:sig}{Enter}` counts 1 here and pastes plain when the
//     slot is empty. Deletion can also CREATE a splitter: `a{en{var:x}ter}b` with x unset
//     resolves to `a{enter}b`, which is 2 runs at replay and 1 run here.
//
// So this is a statement about STRUCTURE, which is the actionable part and the overwhelmingly
// common case, not a proof about a particular run. Callers must word themselves accordingly:
// the grid badge keeps asserting the configured delivery and carries the doubt in its colour
// and tooltip, rather than asserting an outcome this cannot actually guarantee.

// Ported key-for-key from SpecialKeyPlaceholders (ActionExecution.cs:7994-8010) WITHOUT the
// braces — the walk re-wraps the bare name exactly as the C# lookup does — plus 'delay', whose
// branch sits immediately above the key branch in ParseSendTextSegments. A STRICT SUBSET of
// KNOWN_TOKEN_NAMES above: every name here also resolves, but not every name there splits.
// ('delay' is in the set for completeness; the delay branch below returns before the set is
// consulted, mirroring the C#'s branch order.)
export const SEGMENTING_TOKEN_NAMES: ReadonlySet<string> = new Set([
  'delay',
  'enter', 'tab', 'space', 'backspace', 'delete', 'escape', 'esc',
  'home', 'end', 'pageup', 'pagedown', 'up', 'down', 'left', 'right',
]);

// ── The BROWSER path: two engines, and only the keys differ ──────────────────
// A BrowserType payload is resolved in two places. The C# side runs the SAME ResolveTokensAsync
// over it (ResolveBrowserTextPlaceholdersAsync), so every DATA token above substitutes exactly as
// it does for SendText. The KEY tokens it leaves alone — ParseSendTextSegments never runs on that
// path — and hands the text to the Chrome extension, whose own parser is the whole key grammar
// there (ChromeExtension/content.js, KEY_CHIP_PATTERN):
//
//     /\{(enter|tab|esc|escape|backspace|delete|up|down|left|right)\}/gi
//
// Ten names, NO argument: {enter:3} does not match it and is typed out, and neither {space},
// {home}, {end}, {pageup}, {pagedown} nor {delay:N} exist there at all. Everything this set does
// not name reaches the page as literal text — so in the browser scope those are NOT tokens, and a
// surface that chips them (or offers them from the `{` catalog) is promising a key press the run
// never makes. Ported name-for-name; a name added to the extension's pattern is added here.
export const BROWSER_KEY_NAMES: ReadonlySet<string> = new Set([
  'enter', 'tab', 'esc', 'escape', 'backspace', 'delete', 'up', 'down', 'left', 'right',
]);

/**
 * Which engine(s) sit behind the payload being edited. 'desktop' is SendText (the C# resolver +
 * ParseSendTextSegments); 'browser' is BrowserType (the C# resolver + the extension's key parser).
 */
export type TokenScope = 'desktop' | 'browser';

/**
 * Would the engine behind `scope` substitute a token with this NAME (already lower-cased) and
 * argument? The one question every chip-or-text decision asks — the walker above, the typing
 * transform and the `{` catalog — so the three cannot answer it differently.
 */
export function tokenResolvesIn(name: string, hasArg: boolean, scope: TokenScope): boolean {
  if (!KNOWN_TOKEN_NAMES.has(name)) return false;
  if (scope === 'desktop') return true;
  // Data tokens resolve on the C# side for both paths; the key/delay family is the extension's.
  if (!SEGMENTING_TOKEN_NAMES.has(name)) return true;
  return BROWSER_KEY_NAMES.has(name) && !hasArg;
}

// ActionExecution.cs:8016-8017 — OpenBraceSentinel / CloseBraceSentinel. Runtime-only (nothing
// the user can author contains them), ported anyway so the walk is comparable line for line.
// Written as escapes on purpose: the C# source holds the RAW U+0001/U+0002 control characters,
// and a copy-paste of those into this file is invisible in every diff and editor.
const OPEN_BRACE_SENTINEL = '\u0001';
const CLOSE_BRACE_SENTINEL = '\u0002';

// int.TryParse(s, out n) under the default NumberStyles.Integer: AllowLeadingSign plus
// AllowLeadingWhite/AllowTrailingWhite, no group separators, and FAILURE outside Int32.
// The whitespace class is spelled out rather than written as \s: JS \s also matches U+00A0,
// U+FEFF, U+1680, U+2000-200A, U+2028/9, U+202F, U+205F and U+3000, none of which C# accepts —
// it allows only U+0009-U+000D and U+0020. With \s, `{enter:U+00A0 5}` would repeat 5 times here
// and once in the engine.
function tryParseInt32(s: string): number | null {
  if (!/^[ \t\n\v\f\r]*[+-]?[0-9]+[ \t\n\v\f\r]*$/.test(s)) return null;
  const n = Number(s.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, ''));
  if (!Number.isSafeInteger(n) || n < -2147483648 || n > 2147483647) return null;
  return n;
}

export type SendTextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'key'; name: string; count: number }
  | { kind: 'delay'; ms: number };

/** Line-by-line port of ParseSendTextSegments (ActionExecution.cs:8026-8117). */
export function parseSendTextSegments(text: string): SendTextSegment[] {
  const segments: SendTextSegment[] = [];
  let i = 0;

  // AppendTextChar (ActionExecution.cs:8120-8132) — extends the last segment when it is a text
  // segment, otherwise starts a new one. This merging is what creates the RUNS the ==1 test
  // counts, so it is the load-bearing half of the port.
  const appendTextChar = (c: string) => {
    const last = segments[segments.length - 1];
    if (last && last.kind === 'text') last.text += c;
    else segments.push({ kind: 'text', text: c });
  };

  while (i < text.length) {
    const ch = text[i];

    // Sentinels stand in for literal '{' / '}' from placeholder substitution — plain text.
    if (ch === OPEN_BRACE_SENTINEL) { appendTextChar('{'); i++; continue; }
    if (ch === CLOSE_BRACE_SENTINEL) { appendTextChar('}'); i++; continue; }

    if (ch === '{') {
      // Find closing brace (skip sentinel close-braces — they belong to substituted text).
      let closeBrace = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === '}') { closeBrace = j; break; }
        // Sentinel inside what looked like a placeholder — bail out, treat '{' as literal.
        if (text[j] === OPEN_BRACE_SENTINEL || text[j] === CLOSE_BRACE_SENTINEL) break;
      }
      if (closeBrace === -1) { appendTextChar(ch); i++; continue; }

      const inner = text.slice(i + 1, closeBrace); // e.g. "enter", "enter:5", "delay:500"
      let name = inner;
      const colonIdx = inner.indexOf(':');
      let hasValidParam = false;
      let paramValue = 0;
      if (colonIdx >= 0) {
        name = inner.slice(0, colonIdx);
        const n = tryParseInt32(inner.slice(colonIdx + 1));
        if (n !== null && n > 0) { hasValidParam = true; paramValue = n; }
      }

      // Both C# lookups are OrdinalIgnoreCase (the Equals and the dictionary's comparer).
      const lower = name.toLowerCase();

      // {delay:N} — invalid/missing N → 500 ms, not a 1 ms no-op. Cap 60 s.
      if (lower === 'delay') {
        segments.push({ kind: 'delay', ms: hasValidParam ? Math.min(paramValue, 60000) : 500 });
        i = closeBrace + 1;
        continue;
      }

      // {key} or {key:N} — C#: SpecialKeyPlaceholders.TryGetValue("{" + name + "}", ...).
      if (SEGMENTING_TOKEN_NAMES.has(lower)) {
        // The C# pushes `count` SEPARATE key segments; carrying the count on one segment is the
        // ONE representational difference in this port, and it cannot move the answer: the ==1
        // test counts segments whose Text is non-empty, and no key segment has Text.
        segments.push({ kind: 'key', name: lower, count: hasValidParam ? Math.min(paramValue, 100) : 1 });
        i = closeBrace + 1;
        continue;
      }

      // Unknown placeholder, treat '{' as regular text. Note i++ and NOT closeBrace + 1: the
      // scan re-anchors one char in, so `{x{enter}` still finds the {enter} — the same
      // re-anchor rule 3 of splitTokenSegments above describes.
      appendTextChar(ch);
      i++;
    } else {
      appendTextChar(ch);
      i++;
    }
  }

  return segments;
}

/**
 * The engine's own count, verbatim: `segments.Count(s => !string.IsNullOrEmpty(s.Text))`.
 * IsNullOrEmpty, NOT IsNullOrWhiteSpace — a run of only spaces still counts.
 */
export function countSendTextTextSegments(text: string): number {
  let count = 0;
  for (const s of parseSendTextSegments(text)) if (s.kind === 'text' && s.text.length > 0) count++;
  return count;
}

/**
 * Will a rich (HTML) flavor attached to this payload actually be sent?
 * Mirrors `... == 1` at ActionExecution.cs:7163 — note EXACTLY one, so 0 is a drop too.
 * Answers only the segmentation half; the caller supplies "is there a rich flavor at all".
 * Read the banner above for the two ways this can disagree with a particular run.
 */
export function richFlavorSurvives(text: string): boolean {
  return countSendTextTextSegments(text) === 1;
}
