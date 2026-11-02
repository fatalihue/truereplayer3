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
//   1. NAME-ONLY IS NOT ENOUGH — and the walker knows it now. splitTokenSegments applies the
//      engine's argument shapes too (engineAcceptsToken in tokenNormalize, which used to be this
//      module's private TOKEN_ARG_GATE): {var:Ação} fails the `[A-Za-z0-9_]+` gate of the
//      variable/slot regexes and pastes LITERALLY (a column may hold spaces since 2.37.0), and {date:x},
//      {random:abc} and {clipboard:} are literal because those resolvers reject the argument or
//      require a non-empty modifier group. Every segment the walker hands back has therefore
//      already passed the gate; the 'literal' branches below stay as the belt to that brace, so
//      a consumer that feeds this module a token from elsewhere still cannot print a value
//      replay never pastes.
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
import { splitTokenSegments, parseSendTextSegments, SEGMENTING_TOKEN_NAMES, engineAcceptsToken } from './tokenNormalize';
import {
  applyTransformPreview,
  parseChainToken,
  previewIsRuntimeDependent,
  hasNextModifier,
} from './clipboardModifiers';
import { resolveDateToken } from './dateFormat';

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
  | 'runtime-counter'    // run repeat number — no value outside a run
  | 'runtime-loop'       // innermost While / For Each iteration — no value outside a run
  | 'runtime-datarow'    // the data row number — no value outside a run
  | 'runtime-row'        // the action's own grid row — no value outside a run
  | 'runtime-rowcursor'  // {row:col} with loop-over-data OFF — the row comes from the run cursor
  | 'runtime-norows'     // {row:col} against a Data table with no rows at all
  | 'runtime-cursor'     // an auto-advancing read whose cursor lives in the run
  | 'unmodeled-chain'    // a chain this builder cannot model, so it will not guess
  | 'unknown-column'     // no such column in the data table
  | 'unset'              // nothing stored under that name yet
  | 'generated'          // a fresh identifier every use ({uuid})
  | 'runtime-env';       // an environment variable — the machine has it, this editor does not

export type PreviewPiece =
  | { kind: 'text'; text: string }
  | { kind: 'resolved'; text: string; token: string; note?: string }
  | { kind: 'pending'; token: string; label: string; reason: PendingReason };

/** Why a placeholder is one, said in its tip — [English, Portuguese]. */
export const PREVIEW_REASON_TIP: Record<PendingReason, [string, string]> = {
  literal: [
    'Sent verbatim, braces included — the argument is not a shape the engine accepts.',
    'Enviado literalmente, com as chaves — o argumento não está numa forma que o motor aceita.',
  ],
  'key-press': [
    'Sent as a key press between the text blocks, not as characters.',
    'Enviado como tecla entre os blocos de texto, não como caracteres.',
  ],
  delay: ['A pause in the typing, not text.', 'Uma pausa na digitação, não texto.'],
  random: ['Drawn fresh every run.', 'Sorteado a cada execução.'],
  pick: ['One of the options, drawn fresh every run.', 'Uma das opções, sorteada a cada execução.'],
  ask: [
    'The run pauses and asks you for this value.',
    'A execução pausa e pergunta este valor.',
  ],
  runtime: ['Only the engine has this value, and only while the macro runs.', 'Só o motor tem este valor, e só enquanto a macro roda.'],
  'runtime-clipreading': ['Reading the clipboard…', 'Lendo a área de transferência…'],
  'runtime-counter': ['The run repeat number — there is no value outside a run.', 'O número da repetição da execução — não existe valor fora de uma execução.'],
  'runtime-loop': ['The iteration of the innermost While / For Each block — there is no value outside a run.', 'A volta do bloco While / For Each mais interno — não existe valor fora de uma execução.'],
  'runtime-datarow': ['The number of the current data row — there is no value outside a run.', 'O número da linha de dados atual — não existe valor fora de uma execução.'],
  'runtime-row': ["The action's own grid row — there is no value outside a run.", 'A linha da action na grade — não existe valor fora de uma execução.'],
  'runtime-rowcursor': [
    'Loop over data is off: each run takes the NEXT row, and that position lives between runs.',
    'Loop over data desligado: cada execução pega a PRÓXIMA linha, e essa posição vive entre as execuções.',
  ],
  'runtime-norows': [
    'The Data table has no rows, so this resolves to nothing at replay.',
    'A tabela de dados não tem linhas, então isto resolve como vazio no replay.',
  ],
  'runtime-cursor': [
    'Auto-advancing: the line depends on how many runs came before.',
    'Auto-avança: a linha depende de quantas execuções já houve.',
  ],
  'unmodeled-chain': [
    'The builder cannot model this chain, so it shows no result. It still runs.',
    'O construtor não consegue modelar esta cadeia, então não mostra resultado. Ela roda normalmente.',
  ],
  'unknown-column': ['No column by that name in the Data table.', 'Nenhuma coluna com esse nome na tabela de dados.'],
  unset: ['Nothing stored under that name yet.', 'Nada guardado com esse nome ainda.'],
  generated: ['A fresh identifier at every use — store it in a variable to reuse one.', 'Um identificador novo a cada uso — guarde numa variável para reaproveitar.'],
  'runtime-env': [
    'Read from this machine’s environment when the macro runs; the editor cannot see it.',
    'Lido do ambiente desta máquina quando a macro roda; o editor não enxerga.',
  ],
};

/** Where a resolved value came from, said in its tip — [English, Portuguese]. */
export const PREVIEW_NOTE_TIP: Record<string, [string, string]> = {
  clock: [
    'Preview time. Month and day names follow the machine locale at replay.',
    'Hora da prévia. Nomes de mês e dia seguem o idioma da máquina no replay.',
  ],
  'first-data-row': [
    'The FIRST data row. A run uses the row it is on; ForEach and Run Macro can use another table.',
    'A PRIMEIRA linha de dados. A execução usa a linha em que está; ForEach e Run Macro podem usar outra tabela.',
  ],
  'last-run': [
    'From the LAST run — variables reset at every start.',
    'Da ÚLTIMA execução — as variáveis zeram a cada início.',
  ],
};

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

// The engine's argument shapes moved to tokenNormalize (engineAcceptsToken) on 2026-09-05 so the
// walker applies them for every surface; this module keeps calling the same gate.
const engineAccepts = engineAcceptsToken;

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

// How many presses the ENGINE will emit for a {key:N}. Delegated to the ported walk rather than
// re-derived, for the same reason the delay branch below delegates: a second implementation of
// int.TryParse is a second chance to disagree with it, and this one did. `Number.isSafeInteger`
// accepts values int.TryParse rejects by OVERFLOW — {enter:3000000000} was previewed as "×100"
// (clamped) while the engine parses nothing, falls through, and emits ONE press.
// parseSendTextSegments is the line-by-line port and is fuzz-tested against the real C# (61,716
// cases, 0 mismatches), so counting its output is exact by construction.
function repeatCount(token: string): number {
  const first = parseSendTextSegments(token)[0];
  return first && first.kind === 'key' ? first.count : 1;
}

// BuildRowDict: trim + case-insensitive, and the LAST duplicate header wins.
function findColumn(headers: string[], column: string): number {
  const key = column.trim().toLowerCase();
  let idx = -1;
  headers.forEach((h, i) => { if (h.trim().toLowerCase() === key) idx = i; });
  return idx;
}

// The clock tokens go through the TS port of ResolveDateTimeTokens (dateFormat.ts): offsets,
// formats and the head's default. The engine formats with the machine's culture and '/' and ':'
// pinned, so what differs at replay is only the month and day NAMES — the panel's tip says so.
// No navigator in a node harness, hence the guard.
const previewLocale = (): string => (typeof navigator !== 'undefined' && navigator.language) || 'en-US';

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
      case 'datetime': {
        // null = a format .NET rejects, which the engine leaves literal (the gate already says
        // so, so this branch is the belt to that brace).
        const clock = resolveDateToken(token, now, previewLocale());
        if (clock === null) push({ kind: 'pending', token, label: token, reason: 'literal' });
        else push({ kind: 'resolved', text: clock, token, note: 'clock' });
        continue;
      }
      case 'counter':
        push({ kind: 'pending', token, label: 'run repeat', reason: 'runtime-counter' });
        continue;
      case 'loop':
        push({ kind: 'pending', token, label: 'block iteration', reason: 'runtime-loop' });
        continue;
      case 'datarow':
        push({ kind: 'pending', token, label: 'data row number', reason: 'runtime-datarow' });
        continue;
      // {uuid} is drawn fresh at every use, like {random}; {env:NAME} lives on the machine, where
      // a WebView cannot read it. Both stay pending whatever chain they carry. {timestamp} is a
      // clock and resolves below, through the chain block, like {date}.
      case 'uuid':
        push({ kind: 'pending', token, label: 'new UUID', reason: 'generated' });
        continue;
      case 'env': {
        const m = /^env:([^:}]+)/i.exec(token.slice(1, -1));
        push({ kind: 'pending', token, label: m ? m[1] : token, reason: 'runtime-env' });
        continue;
      }
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
      case 'timestamp':
        // Unix time from the SAME `now` the clock tokens use; ms is the unit the head carries.
        raw = String(head.ms ? now.getTime() : Math.floor(now.getTime() / 1000));
        note = 'clock';
        break;
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

