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
// Strings are tt(en, ptBr) PAIRS, not resolved text — the same shape the palette's PaletteChip.tip
// already used — so this module never needs a React context and every caller resolves with its
// own useTt(). Data only, no JSX: it stays a .ts and cannot leak a component across a
// react-refresh boundary.
import { hasNextModifier } from './clipboardModifiers';
import type { KnownTokenName } from './tokenNormalize';

export type Tt = (en: string, ptBr: string) => string;

export interface TokenDescription {
  /** What the token does. Surface-neutral: true on a chip, in the popover and in the grid. */
  tip: readonly [string, string];
  /**
   * PALETTE-ONLY replacement. Three tokens need to tell the user "click the chip after
   * inserting to add transforms" — advice that is nonsense once you are already looking at the
   * chip. Stored as a full string rather than a suffix because winclip weaves its clause into
   * the middle of the sentence, and a mechanical join would rewrite copy that already shipped.
   */
  paletteTip?: readonly [string, string];
}

// Base entry per name. Record<KnownTokenName, …> is load-bearing: tsc fails if the engine
// whitelist in tokenNormalize gains a name and this table does not.
const BY_NAME: Record<KnownTokenName, TokenDescription> = {
  clipboard: { tip: ['Paste the clipboard text', 'Cola o texto da área de transferência'] },
  date: { tip: ['Current date (dd/MM/yyyy)', 'Data atual (dd/MM/aaaa)'] },
  time: { tip: ['Current time (HH:mm:ss)', 'Hora atual (HH:mm:ss)'] },
  datetime: { tip: ['Current date and time', 'Data e hora atuais'] },
  enter: { tip: ['Press Enter', 'Pressiona Enter'] },
  tab: { tip: ['Press Tab', 'Pressiona Tab'] },
  space: { tip: ['Press Space', 'Pressiona Espaço'] },
  backspace: { tip: ['Press Backspace', 'Pressiona Backspace'] },
  delete: { tip: ['Press Delete', 'Pressiona Delete'] },
  escape: { tip: ['Press Escape', 'Pressiona Esc'] },
  // {esc} is a real alias of {escape}, not an escape hatch — see the banner in tokenNormalize.
  esc: { tip: ['Press Escape', 'Pressiona Esc'] },
  home: { tip: ['Press Home', 'Pressiona Home'] },
  end: { tip: ['Press End', 'Pressiona End'] },
  pageup: { tip: ['Press Page Up', 'Pressiona Page Up'] },
  pagedown: { tip: ['Press Page Down', 'Pressiona Page Down'] },
  up: { tip: ['Press Up arrow', 'Pressiona seta ↑'] },
  down: { tip: ['Press Down arrow', 'Pressiona seta ↓'] },
  left: { tip: ['Press Left arrow', 'Pressiona seta ←'] },
  right: { tip: ['Press Right arrow', 'Pressiona seta →'] },
  delay: { tip: ['Pause typing for N ms', 'Pausa a digitação por N ms'] },
  random: { tip: ['Fresh random number each run', 'Número aleatório novo a cada execução'] },
  pick: {
    tip: ['Types ONE of the options, chosen at random each run', 'Digita UMA das opções, sorteada a cada execução'],
    paletteTip: ['Types ONE of the options, chosen at random each run — click the chip to edit the list', 'Digita UMA das opções, sorteada a cada execução — clique no chip para editar a lista'],
  },
  var: { tip: ['Value stored by a Set Variable action', 'Valor gravado por uma action Set Variable'] },
  counter: { tip: ['Current loop iteration (1, 2, 3…)', 'Iteração atual do loop (1, 2, 3…)'] },
  // Bare {row}. The {row:Column} form is a different token entirely — see ROW_COLUMN below.
  row: { tip: ["Current action's grid row number (not the data table)", 'Número da linha da action na grade (não é a tabela de dados)'] },
  rownext: {
    tip: ['Auto-advancing: each use pulls the NEXT data row for the column (1st action → row 1, 2nd → row 2…). Resets each run — swap the list, keep the fields.', 'Auto-avança: cada uso pega a PRÓXIMA linha da tabela para a coluna (1ª action → linha 1, 2ª → linha 2…). Reinicia a cada execução — troque a lista, mantenha os campos.'],
    paletteTip: ['Auto-advancing: each use pulls the NEXT data row for the column (1st action → row 1, 2nd → row 2…). Resets each run — swap the list, keep the fields. Click the chip after inserting to add transforms.', 'Auto-avança: cada uso pega a PRÓXIMA linha da tabela para a coluna (1ª action → linha 1, 2ª → linha 2…). Reinicia a cada execução — troque a lista, mantenha os campos. Clique no chip depois de inserir para adicionar transformações.'],
  },
  clip: { tip: ['Selection captured by a Copy to Slot action or the capture hotkey', 'Seleção capturada por uma action Copy to Slot ou pelo hotkey de captura'] },
  winclip: {
    tip: ['Windows Win+V history — {winclip:1} is the last thing copied. Needs clipboard history on; may hold anything recently copied, including passwords.', 'Histórico do Windows (Win+V) — {winclip:1} é a última coisa copiada. Precisa do histórico ligado; pode conter qualquer coisa copiada recentemente, inclusive senhas.'],
    paletteTip: ['Windows Win+V history — {winclip:1} is the last thing copied (click the chip to change which item). Needs clipboard history on; may hold anything recently copied, including passwords.', 'Histórico do Windows (Win+V) — {winclip:1} é a última coisa copiada (clique no chip para trocar o item). Precisa do histórico ligado; pode conter qualquer coisa copiada recentemente, inclusive senhas.'],
  },
  input: { tip: ['Prompt for a value at replay time (pauses the run)', 'Pergunta um valor durante a execução (pausa o replay)'] },
};

const CLIPBOARD_NEXT: TokenDescription = {
  tip: ['Auto-advancing: each use takes the NEXT line of the clipboard instead of the whole thing (1st use → line 1, 2nd → line 2…). Copy something new and it starts over; past the last line it resolves empty. Blank lines are skipped.', 'Auto-avança: cada uso pega a PRÓXIMA linha do clipboard em vez do conteúdo inteiro (1º uso → linha 1, 2º → linha 2…). Copiou algo novo, recomeça; depois da última linha resolve vazio. Linhas em branco são puladas.'],
  paletteTip: ['Auto-advancing: each use takes the NEXT line of the clipboard instead of the whole thing (1st use → line 1, 2nd → line 2…). Copy something new and it starts over; past the last line it resolves empty. Blank lines are skipped. Click the chip after inserting to add transforms.', 'Auto-avança: cada uso pega a PRÓXIMA linha do clipboard em vez do conteúdo inteiro (1º uso → linha 1, 2º → linha 2…). Copiou algo novo, recomeça; depois da última linha resolve vazio. Linhas em branco são puladas. Clique no chip depois de inserir para adicionar transformações.'],
};

const ROW_COLUMN: TokenDescription = {
  tip: ['Data table column of the current row (loop over data)', 'Coluna da tabela de dados na linha atual (loop over data)'],
  paletteTip: ['Data table column of the current row (loop over data) — click the chip after inserting to add transforms (trim, UPPERCASE…)', 'Coluna da tabela de dados na linha atual (loop over data) — clique no chip depois de inserir para adicionar transformações (trim, MAIÚSCULAS…)'],
};

// Tokens whose ARGUMENT changes what they mean. Checked before BY_NAME; first match wins.
const VARIANTS: readonly { name: string; when: (token: string, mods: string[]) => boolean; desc: TokenDescription }[] = [
  { name: 'clipboard', when: (token) => hasNextModifier(token), desc: CLIPBOARD_NEXT },
  { name: 'row', when: (_token, mods) => mods.length > 0, desc: ROW_COLUMN },
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
}

/** Ready-to-render tooltip text for a token. Empty string when the name is unknown. */
export function tokenTip(token: string, tt: Tt, opts: TokenTipOptions = {}): string {
  const { withRaw = true, palette = false } = opts;
  const entry = describeToken(token);
  if (!entry) return '';
  const pair = (palette && entry.paletteTip) || entry.tip;
  const text = tt(pair[0], pair[1]);
  const split = splitToken(token);
  // The tooltip surface is white-space: normal, so a newline would collapse — the raw token is
  // joined with a visible em dash, not a line break.
  return withRaw && split && split.mods.length > 0 ? `${text} — ${token}` : text;
}
