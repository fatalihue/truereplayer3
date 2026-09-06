// ── The TYPING grammar ──────────────────────────────────────────────────────
// What auto-chips AS YOU TYPE — and the one grammar in this directory that is deliberately
// NARROWER than the engine's. Modifier segments allow digits/letters plus ',', '-' and '_' so
// {Random:1-10}, {Clipboard:lines:3,1,2} and {var:my_name} chip as you type. Separators with other
// characters (e.g. join:" - ") stay plain text when typed — they still work at runtime, and chips
// built via the popover keep chip-ness regardless (insertToken bypasses this gate).
//
// Only auto-chipping asks this module. Anything that reports on a FINISHED payload — the token
// count in the Insert Text status strip, the grid preview, the editor's own load and paste paths —
// must instead ask splitTokenSegments (tokenNormalize), whose grammar is the engine's: gating
// those on this regex is what made a payload holding {clipboard:join: - } report "0 tokens".
//
// Pure and React-free on purpose, the sendTextStatus rule: the earliest-match walk below is the
// part worth proving head-lessly, and a component import would drag JSX into a node harness.
import { engineAcceptsToken, tokenResolvesIn, type TokenScope } from './tokenNormalize';

const TOKEN_REGEX = /\{[a-zA-Z]+(?::[a-zA-Z0-9,_-]+)*\}/;

/**
 * Anchored: "would the typing grammar have accepted this WHOLE token?" — asked by the editor's
 * load path to keep normalising exactly what it has always normalised (see buildNodesFromText).
 * Deliberately the strict branch alone: widening it to FREE_ARG_TOKEN_REGEX would re-normalise a
 * saved {input:Nome do cliente} on load, and that rewrite is the hazard the verbatim node exists
 * to prevent.
 */
export const TOKEN_REGEX_WHOLE = new RegExp(`^${TOKEN_REGEX.source}$`);

// The second branch, for the two heads whose WHOLE argument is free text — {input:…} and
// {pick:…}, tokenNormalize's VERBATIM_ARG_NAMES. A prompt label and a list of options carry
// spaces in the normal case ("Nome do cliente"), so the strict branch never chipped them as
// typed: the `{` autocomplete's "Ask input…" entry inserts `{input:` and hands the closing brace
// to the transform, and the finished token sat there as raw text until the editor was reopened
// (the load path asks the engine's grammar and chipped it then). Ported shape-for-shape from the
// engine's own matchers, so the chip is a promise the run keeps:
//
//     InputTokenRegex  \{input:([^}|]+)(?:\|menu:([^}]*))?\}   — a '|' not followed by "menu:"
//                                                                is literal on both sides
//     PickTokenRegex   \{pick:([^}]+)\}
//     DateTokenRegex   \{(datetime|date|time)(?::([^}]+))?\}   — an offset and/or a .NET format,
//                                                                which carries '/', '+', spaces
//     EnvTokenRegex    \{env:([A-Za-z0-9_()]+)(?::([^}]+))?\}   — the parentheses of
//                                                                ProgramFiles(x86); the chain after
//                                                                the name keeps the strict grammar
//     RowDataTokenRegex / RowNextTokenRegex                    — a column is [^:}]+ since 2.37.0
//                       \{row:([^:}]+)(?::([^}]+))?\}           ("Nome Completo"); the chain after
//                                                                it keeps the strict grammar
//
// '\n' is excluded only because a Lexical TextNode never holds one (line breaks are nodes).
const FREE_ARG_TOKEN_REGEX = /\{(?:input:[^}|\n]+(?:\|menu:[^}\n]*)?|pick:[^}\n]+|(?:datetime|date|time):[^}\n]+|env:[A-Za-z0-9_()]+(?::[a-zA-Z0-9,_-]+)*|(?:row|rownext):[^:}\n]+(?::[a-zA-Z0-9,_-]+)*)\}/i;

export interface TypedToken {
  /** Offset of the '{' in the text. */
  index: number;
  /** The whole `{...}` run, bytes as typed. */
  token: string;
}

/**
 * The first `{...}` in `text` that the typing grammar accepts AND the engine behind `scope`
 * substitutes — name and argument shape both (tokenResolvesIn + engineAcceptsToken) — or null.
 *
 * Candidates from both branches are walked by position and the first one that RESOLVES wins —
 * not the first that merely matches. The transform used to stop at the first syntactic match, so
 * an unknown name ahead of a real token ("{xpto} {enter}") kept the real one from ever chipping
 * while it was being typed; the engine, and the load path, find it (splitTokenSegments, rule 3).
 * Lexical re-runs the transform on the split-off remainder, so one hit per call is enough to chip
 * a whole run left to right.
 */
export function findTypedToken(text: string, scope: TokenScope): TypedToken | null {
  if (!text.includes('{')) return null;
  const candidates: TypedToken[] = [];
  for (const source of [new RegExp(TOKEN_REGEX.source, 'g'), new RegExp(FREE_ARG_TOKEN_REGEX.source, 'gi')]) {
    let m: RegExpExecArray | null;
    while ((m = source.exec(text)) !== null) candidates.push({ index: m.index, token: m[0] });
  }
  // The same offset from both branches (a spaceless {input:x} satisfies either) is the same
  // token; otherwise the longer run is the one the engine's first-'}' rule takes.
  candidates.sort((a, b) => a.index - b.index || b.token.length - a.token.length);
  for (const c of candidates) {
    const inner = c.token.slice(1, -1);
    const colon = inner.indexOf(':');
    const name = (colon < 0 ? inner : inner.slice(0, colon)).toLowerCase();
    if (tokenResolvesIn(name, colon >= 0, scope) && engineAcceptsToken(c.token)) return c;
  }
  return null;
}
