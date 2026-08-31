// ── What this message will ACTUALLY paste ───────────────────────────────────
//
// The Advanced Clipboard surface has a live preview per modifier chain; the message as a whole
// had none, so a support macro mixing {date}, {clipboard:...}, {var:nome} and {row:coluna} could
// only be checked by running it.
//
// THE HARD PART IS HONESTY, and the surface already set the bar (see UNKNOWN_SOURCE_COPY there:
// "Each reason is DIFFERENT, and saying the wrong one is worse than saying nothing"). Every token
// this module cannot resolve for certain comes back as a labelled PENDING piece — never as a
// fabricated value. Three classes of trap, each of which would produce an authoritative-looking
// lie, are handled explicitly:
//
//   1. NAME-ONLY IS NOT ENOUGH. splitTokenSegments is deliberately a NAME test that does not
//      re-check arguments (see its banner). The engine does: {var:Ação} and {row:First Name}
//      fail the `[A-Za-z0-9_]+` gate on the four name-first regexes and paste LITERALLY, and
//      {date:x}, {counter:5} and {clipboard:} are literal too because those resolvers match an
//      exact string or require a non-empty modifier group. Previewing them as resolved would
//      print a value replay never pastes. TOKEN_ARG_GATE below re-classifies them.
//   2. {row:col} DEPENDS ON THE RUN, NOT THE TABLE — and "loop over data off" does NOT mean
//      "no row". With the toggle ON the engine runs one iteration per row, so the first
//      iteration is row 1 and previewing it is honest, labelled as the FIRST row rather than
//      "the" row. With it OFF the engine uses Model B, a cursor that persists BETWEEN runs and
//      advances each time (ActionExecution.cs:2299-2330; the Data panel says the same in as many
//      words), so a row IS substituted — just not one this editor can know. Only an empty table
//      is a knowable nothing.
//   3. STATE FROM THE LAST RUN IS NOT STATE FROM THIS ONE. Variables are cleared at the start of
//      every run, so a {var:x} value is historical and says so. Slots survive across runs, so
//      they do not.
//
// One deliberate NON-branch: argRefIsUnfinished. It describes a live editing state where the
// surface's field holds a bare "@" while the token still carries a number. This module parses a
// token STRING, and parseModifierParts only sets those fields when the argument already passes
// isArgRef — so a branch for it would be dead code wearing the costume of diligence.
import { splitTokenSegments, parseSendTextSegments, SEGMENTING_TOKEN_NAMES } from './tokenNormalize';
import {
  applyTransformPreview,
  parseChainToken,
  previewIsRuntimeDependent,
  hasNextModifier,
} from './clipboardModifiers';

/** Why a piece could not be resolved. Each one is a DIFFERENT statement to the user. */
export type PendingReason =
  | 'literal'            // the engine will paste the braces verbatim — a typo, effectively
  | 'key-press'          // a keystroke, not text
  | 'delay'              // a pause, not text
  | 'random'             // drawn fresh every run
  | 'pick'               // drawn fresh every run
  | 'ask'                // the run stops and asks
  | 'runtime'            // only the engine has the value (winclip, an @ref index)
  | 'runtime-clipreading' // the clipboard read has not come back yet
  | 'runtime-counter'    // loop iteration — no value outside a run
  | 'runtime-row'        // the action's own grid row — no value outside a run
  | 'runtime-rowcursor'  // {row:col} with loop-over-data OFF — the row comes from the run cursor
  | 'runtime-norows'     // {row:col} against a Data table with no rows at all
  | 'runtime-cursor'     // an auto-advancing read whose cursor lives in the run
  | 'unmodeled-chain'    // a chain this builder cannot model, so it will not guess
  | 'unknown-column'     // no such column in the data table
  | 'unset';             // nothing stored under that name yet

export type PreviewPiece =
  | { kind: 'text'; text: string }
  | { kind: 'resolved'; text: string; token: string; note?: string }
  | { kind: 'pending'; token: string; label: string; reason: PendingReason };

export interface PreviewSources {
  /** Current clipboard text, and whether the read has come back. */
  clipRaw: string;
  clipReady: boolean;
  /** The profile's data table. `loopOverData` picks WHICH row the engine uses, not whether
   *  it uses one at all — see the banner. */
  dataTable: { headers: string[]; rows: string[][]; loopOverData: boolean };
  /** Live run-state snapshot: variables are cleared each run, slots survive. */
  variables: Record<string, string>;
  slots: Record<string, string>;
}

// ── The engine's own argument shapes ────────────────────────────────────────
// Ported matcher by matcher from Source/ActionExecution.cs. A token whose NAME the walker
// accepts but whose ARGUMENT fails here is text, not a token.
const NAME_ARG = '[A-Za-z0-9_]+';   // VarTokenRegex / RowDataTokenRegex / RowNextTokenRegex / ClipSlotTokenRegex
const TOKEN_ARG_GATE: Record<string, RegExp> = {
  // ResolveDateTimeTokens does a Contains/Replace on the exact literals, so any argument is text.
  date: /^date$/i,
  time: /^time$/i,
  datetime: /^datetime$/i,
  // Same for {counter}; bare {row} is handled by the row entry below.
  counter: /^counter$/i,
  // ClipboardTokenRegex: \{clipboard(?::([^}]+))?\} — the modifier group needs at least one
  // character, so `{clipboard:}` is literal.
  clipboard: /^clipboard(:[^}]+)?$/i,
  // The four name-first regexes require the tight name charset, then an optional chain. The
  // chain is spelled (?::([^}]+))? — at least ONE character — so a trailing bare colon
  // ({var:x:}) does not match and the engine pastes it literally.
  var: new RegExp(`^var:${NAME_ARG}(:[^}]+)?$`, 'i'),
  clip: new RegExp(`^clip:${NAME_ARG}(:[^}]+)?$`, 'i'),
  rownext: new RegExp(`^rownext:${NAME_ARG}(:[^}]+)?$`, 'i'),
  // Bare {row} is a literal Replace; {row:Column[:chain]} is the regex.
  row: new RegExp(`^row(:${NAME_ARG}(:[^}]+)?)?$`, 'i'),
  // WinClipTokenRegex is \{winclip(?::(\d+))?(?::((?![0-9])[^}]+))?\} — BOTH groups optional, so
  // {winclip} (index defaults to 1), {winclip:upper} and {winclip:2:upper} all resolve. Gating on
  // a mandatory digit run made every chain buildWinClipToken emits preview as "literal" — i.e.
  // the panel told the user a token the chip popover had just built would paste verbatim.
  // The negative lookahead is what keeps {winclip:2-4} and a trailing bare colon literal on both
  // sides, so it has to be carried over too.
  winclip: /^winclip(:[0-9]+)?(:(?![0-9])[^}]+)?$/i,
  // RandomTokenRegex: \{random:(\d+)-(\d+)\}
  random: /^random:[0-9]+-[0-9]+$/i,
  // PickTokenRegex: \{pick:([^}]+)\}
  pick: /^pick:[^}]+$/i,
  // InputTokenRegex: \{input:([^}|]+)(?:\|menu:([^}]*))?\}
  input: /^input:[^}|]+(\|menu:[^}]*)?$/i,
};

/** Does the ENGINE accept this whole token, arguments included? */
function engineAccepts(token: string): boolean {
  const inner = token.slice(1, -1);
  const name = inner.split(':')[0].toLowerCase();
  // Key and delay tokens: the parser takes the name before the first ':' and does not constrain
  // what follows — an unparsable parameter just falls back to the default.
  if (SEGMENTING_TOKEN_NAMES.has(name)) return true;
  const gate = TOKEN_ARG_GATE[name];
  return gate ? gate.test(inner) : false;
}

function arg(token: string, n = 1): string {
  return token.slice(1, -1).split(':')[n] ?? '';
}

// {input:...} needs its OWN accessor: InputTokenRegex is \{input:([^}|]+)(?:\|menu:([^}]*))?\},
// so the label runs to the first '|' and MAY CONTAIN COLONS. Splitting on ':' like arg() does
// turns {input:Enviar|menu:sim,nao} into the label "Enviar|menu" and {input:Hora (HH:MM)} into
// "Hora (HH" — which then also becomes the wrong key in askedThisMessage, so the {var:Enviar}
// that reads the answer back is not recognised as shadowed.
function inputLabel(token: string): string {
  const m = /^input:([^}|]+)/i.exec(token.slice(1, -1));
  return m ? m[1].trim() : '';
}

// int.TryParse plus the engine's `n > 0` test — the same shape parseSendTextSegments uses.
function repeatCount(token: string): number {
  const inner = token.slice(1, -1);
  const c = inner.indexOf(':');
  if (c < 0) return 1;
  const raw = inner.slice(c + 1);
  if (!/^[ \t\n\v\f\r]*[+-]?[0-9]+[ \t\n\v\f\r]*$/.test(raw)) return 1;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, 100) : 1;
}

// BuildRowDict: trim + case-insensitive, and the LAST duplicate header wins.
function findColumn(headers: string[], column: string): number {
  const key = column.trim().toLowerCase();
  let idx = -1;
  headers.forEach((h, i) => { if (h.trim().toLowerCase() === key) idx = i; });
  return idx;
}

// The engine formats with the machine's CurrentCulture and no CultureInfo argument, so in a .NET
// custom format string the '/' and ':' are the CULTURE's separators. These match the pattern the
// engine asks for; the panel's tip says the separators come from the machine's locale rather than
// claiming this is exactly what will be typed.
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function clockNow(kind: 'date' | 'time' | 'datetime', now: Date): string {
  const d = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()}`;
  const t = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  return kind === 'date' ? d : kind === 'time' ? t : `${d} - ${t}`;
}

/**
 * Resolve a whole SendText payload into display pieces.
 *
 * `now` is a parameter rather than a `new Date()` inside, so the caller controls how often the
 * clock moves and the function stays pure and testable.
 */
export function resolveMessagePreview(text: string, src: PreviewSources, now: Date): PreviewPiece[] {
  const out: PreviewPiece[] = [];
  const segments = splitTokenSegments(text);

  // {input:Label} answers land in the run's variable store under Label, so a {var:Label} in the
  // same payload must NOT be previewed from the last run's value.
  //
  // A PRE-PASS, not an as-encountered set: ResolveTokensAsync runs ResolveInputTokensAsync as a
  // WHOLE-STRING pass before ResolveRunStateTokens ever sees the text, so the engine does not
  // care which came first. Collecting left-to-right would leave "{var:X} … {input:X}" previewing
  // the last run's value for a variable the current run is about to overwrite.
  const askedThisMessage = new Set<string>();
  for (const seg of segments) {
    if (seg.kind !== 'token') continue;
    if (seg.value.slice(1, -1).split(':')[0].toLowerCase() !== 'input') continue;
    if (!engineAccepts(seg.value)) continue;
    askedThisMessage.add(inputLabel(seg.value).toLowerCase());
  }

  const push = (p: PreviewPiece) => {
    const last = out[out.length - 1];
    if (p.kind === 'text' && last && last.kind === 'text') last.text += p.text;
    else out.push(p);
  };

  for (const seg of segments) {
    if (seg.kind !== 'token') { push({ kind: 'text', text: seg.value }); continue; }
    const token = seg.value;
    const name = token.slice(1, -1).split(':')[0].toLowerCase();

    // The walker said "this NAME resolves"; the engine also checks the ARGUMENT.
    if (!engineAccepts(token)) {
      push({ kind: 'pending', token, label: token, reason: 'literal' });
      continue;
    }

    // Keys and delays are not text at all.
    if (name === 'delay') {
      // Through the ported walk, never the raw argument: the engine falls back to 500 ms on an
      // unparsable parameter and clamps at 60 s, so {Delay:1500000} is a sixty-second pause and
      // {Delay:abc} is half a second — echoing the text would have said 1500000 and "abc".
      const first = parseSendTextSegments(token)[0];
      const ms = first && first.kind === 'delay' ? first.ms : 500;
      push({ kind: 'pending', token, label: `pause ${ms} ms`, reason: 'delay' });
      continue;
    }
    if (SEGMENTING_TOKEN_NAMES.has(name)) {
      const n = repeatCount(token);
      const key = name === 'esc' ? 'Escape' : name.charAt(0).toUpperCase() + name.slice(1);
      push({ kind: 'pending', token, label: n > 1 ? `${key} ×${n}` : key, reason: 'key-press' });
      continue;
    }

    switch (name) {
      case 'date':
      case 'time':
      case 'datetime':
        push({ kind: 'resolved', text: clockNow(name, now), token, note: 'clock' });
        continue;
      case 'counter':
        push({ kind: 'pending', token, label: 'loop iteration', reason: 'runtime-counter' });
        continue;
      case 'random':
        push({ kind: 'pending', token, label: `${arg(token)} at random`, reason: 'random' });
        continue;
      case 'pick': {
        // The engine splits on '|' and DROPS zero-length options, so "a||b" is two.
        const n = token.slice(1, -1).slice('pick:'.length).split('|').filter((o) => o.length > 0).length;
        push({ kind: 'pending', token, label: `one of ${n}`, reason: 'pick' });
        continue;
      }
      case 'input':
        push({ kind: 'pending', token, label: inputLabel(token), reason: 'ask' });
        continue;
      case 'winclip':
        // The index is optional and defaults to 1 (ActionExecution.cs:6715). Read it off the
        // gate's own shape rather than arg(), which would return a chain segment for
        // {winclip:upper}. Engine-only either way — there is nothing here to resolve against.
        push({
          kind: 'pending',
          token,
          label: `history item ${/^winclip:([0-9]+)/i.exec(token.slice(1, -1))?.[1] ?? '1'}`,
          reason: 'runtime',
        });
        continue;
      default:
        break;
    }

    // Bare {row} — the action's own grid row, which only exists during a run.
    if (name === 'row' && !token.slice(1, -1).includes(':')) {
      push({ kind: 'pending', token, label: 'action row', reason: 'runtime-row' });
      continue;
    }

    // Everything left is chain-bearing: {clipboard}, {row:col}, {rownext:col}, {var:x}, {clip:x}.
    const parsed = parseChainToken(token);
    if (!parsed) { push({ kind: 'pending', token, label: token, reason: 'literal' }); continue; }
    if (parsed.state.unmodeled) {
      push({ kind: 'pending', token, label: token, reason: 'unmodeled-chain' });
      continue;
    }
    // An @ref index is read from run state at replay — there is no number to slice with here.
    if (previewIsRuntimeDependent(parsed.state)) {
      push({ kind: 'pending', token, label: token, reason: 'runtime' });
      continue;
    }

    const head = parsed.head;
    let raw: string | null = null;
    let note: string | undefined;

    switch (head.kind) {
      case 'clipboard':
        if (!src.clipReady) {
          push({ kind: 'pending', token, label: 'clipboard', reason: 'runtime-clipreading' });
          continue;
        }
        // The auto-advancing read's cursor lives in the run; the preview would always claim line 1.
        if (hasNextModifier(token)) {
          push({ kind: 'pending', token, label: 'next clipboard line', reason: 'runtime-cursor' });
          continue;
        }
        raw = src.clipRaw;
        break;
      case 'rownext':
        // Same cursor problem, and it advances per USE rather than per run.
        push({ kind: 'pending', token, label: `next row of ${head.column}`, reason: 'runtime-cursor' });
        continue;
      case 'row': {
        const idx = findColumn(src.dataTable.headers, head.column);
        if (idx < 0) {
          push({ kind: 'pending', token, label: head.column, reason: 'unknown-column' });
          continue;
        }
        // An empty table is the ONE case where the answer is knowable and negative: RowData is
        // built from a row that does not exist, so replay pastes nothing.
        if (src.dataTable.rows.length === 0) {
          push({ kind: 'pending', token, label: head.column, reason: 'runtime-norows' });
          continue;
        }
        // WHICH row depends on the run, and there are two modes. Loop ON ("batch"): one
        // iteration per row, so the first iteration is row 1 and previewing it is honest.
        // Loop OFF is NOT "no row" — it is Model B, the cursor: the engine still stamps
        // _currentRowData, from a row position that persists BETWEEN runs in RunCursorService
        // and advances each time (ActionExecution.cs:2299-2330, and the Data panel says so:
        // "Loop off: each run advances one row"). The editor cannot see that cursor, so the
        // only honest answer is to name the mode instead of showing row 1.
        if (!src.dataTable.loopOverData) {
          push({ kind: 'pending', token, label: head.column, reason: 'runtime-rowcursor' });
          continue;
        }
        raw = src.dataTable.rows[0]?.[idx] ?? '';
        note = 'first-data-row';
        break;
      }
      case 'var': {
        // An {input:X} earlier in THIS message writes X into the run's variable store, so this
        // read gets the fresh answer at replay. Printing the last run's value here would be a
        // confident, wrong preview of a value the user is about to be asked for.
        if (askedThisMessage.has(head.name.trim().toLowerCase())) {
          push({ kind: 'pending', token, label: head.name, reason: 'ask' });
          continue;
        }
        const v = lookupCI(src.variables, head.name);
        if (v === undefined) {
          push({ kind: 'pending', token, label: head.name, reason: 'unset' });
          continue;
        }
        raw = v;
        note = 'last-run';
        break;
      }
      case 'clip': {
        const v = lookupCI(src.slots, head.name);
        if (v === undefined) {
          push({ kind: 'pending', token, label: head.name, reason: 'unset' });
          continue;
        }
        raw = v;
        break;
      }
      default:
        push({ kind: 'pending', token, label: token, reason: 'runtime' });
        continue;
    }

    push({ kind: 'resolved', text: applyTransformPreview(raw ?? '', parsed.state), token, note });
  }

  return out;
}

// Backend lookups on these dictionaries are case-insensitive.
function lookupCI(map: Record<string, string>, name: string): string | undefined {
  const key = name.trim().toLowerCase();
  for (const k of Object.keys(map)) if (k.trim().toLowerCase() === key) return map[k];
  return undefined;
}

