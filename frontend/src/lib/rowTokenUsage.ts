// Where the profile's actions reference data-table columns — the "×N / unused" figures and the
// orphan rows of the Data panel's "Columns · tokens" list.
//
// Both heads count. {row:Nome} reads the cell of the current row and {rownext:Nome} the cell of
// the NEXT row, but both read the SAME column of the same table (BuildRowDict for the former, the
// per-column cursor over the same table for the latter — ActionExecution.cs, ResolveRunStateTokens
// / ResolveRowNextTokens). A column referenced only by {rownext:} is in use, and a {rownext:Ghost}
// is exactly as orphaned as a {row:Ghost}. The scan used to see only {row:}, so a column driven by
// the sequential token read "unused" and its misspelt twin raised no warning.
//
// The column is [^:}]+ (the engine's RowDataTokenRegex / RowNextTokenRegex since 2.37.0 — spaces
// and accents included) and the key is trimmed and case-insensitive, matching BuildRowDict; the
// optional tail matches modifier chains ({row:name:trim:upper}) so a transformed token still counts
// as usage of its column, and it is NON-EMPTY on purpose ([^}]+): a dangling {row:name:} stays
// literal at runtime, so counting it would claim usage the engine never resolves.
//
// Pure and React-free so it can be proven head-lessly against the engine's regexes.

export type RowTokenHead = 'row' | 'rownext';

export interface ColumnUsage {
  /** Occurrences across every action field, both heads together. */
  count: number;
  /** Which heads referenced the column — an orphan row is drawn with the head it was written with. */
  heads: Set<RowTokenHead>;
}

const ROW_TOKEN_SOURCE = /\{(row|rownext):([^:}]+)(?::[^}]+)?\}/.source;

/**
 * Every string an action holds, at any depth.
 *
 * The scan used to run over JSON.stringify(action), which broke twice now that a column name may
 * contain almost anything: the serialiser escapes the value, so a header like `Obs "urgente"`
 * became `Obs \"urgente\"` and never matched its own token — the column read "unused" and the
 * token was listed as an orphan. Tabs and newlines fared worse (`\t`, `\n`). And matching across
 * the blob let a token run past the end of its own field: `{id:2,note:"{row:abc",other:"def}"}`
 * invented the column `abc","other"`.
 */
/**
 * Serialisations of a document this scan has already read in its authoritative form. `keyHtml` and
 * `keyMarkdown` are built from the SAME Lexical nodes as `key`, so every token appears twice — and
 * appears ESCAPED: a column named `Cliente & Cia` is `{row:Cliente &amp; Cia}` in the HTML, which
 * this scan reads as a column nobody has. The Data panel then drew an orphan warning for a token
 * that works, and counted every real occurrence twice.
 */
const DERIVED_FIELDS = new Set(['keyHtml', 'keyMarkdown']);

function collectStrings(v: unknown, out: string[]): void {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out);
  else if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (DERIVED_FIELDS.has(k)) continue;
      collectStrings((v as Record<string, unknown>)[k], out);
    }
  }
}

// The fields the engine resolves tokens in, per ActionType — the twin of ProfileCompatibility's
// AnyTokenField, which lists ActionExecution's ResolveTokens callers. A row whose TYPE changed keeps
// its old fields (switching type clears none of them), so scanning every string counted a
// {row:Nome} left in the Key of what is now a Wait as a live use: the column read "×1" while no run
// ever reads it, and deleting it looked unsafe when it was not.
const KEY_TYPES = new Set(['sendtext', 'keystroke', 'keydown', 'keyup', 'holdkey']);
const BROWSER_TEXT_TYPES = new Set(['browsertype', 'browserselectoption']);
const CONDITION_TYPES = new Set(['if', 'elseif', 'while', 'assert']);

function tokenFields(action: unknown): unknown[] {
  if (!action || typeof action !== 'object') return [];
  const a = action as Record<string, unknown>;
  const type = String(a.actionType ?? '').toLowerCase();
  const out: unknown[] = [];
  if (KEY_TYPES.has(type)) out.push(a.key);
  if (BROWSER_TEXT_TYPES.has(type)) out.push(a.browserText);
  if (type === 'setvariable') out.push(a.variableValue);
  if (CONDITION_TYPES.has(type)) {
    const condition = String(a.conditionType ?? '').toLowerCase();
    if (condition === 'variable') out.push(a.conditionOperand);
    if (condition === 'fileexists') out.push(a.filePath);
    if (condition === 'screentext') out.push(a.conditionOperand);
  }
  if (type === 'waittext') out.push(a.conditionOperand);
  if (type === 'activatewindow') out.push(a.launchPath, a.launchArgs);
  return out;
}

/** Lower-cased column name → usage, scanning the fields the engine resolves on each action. */
export function scanRowTokenUsage(actions: readonly unknown[]): Map<string, ColumnUsage> {
  const usage = new Map<string, ColumnUsage>();
  for (const a of actions) {
    const fields: string[] = [];
    collectStrings(tokenFields(a), fields);
    for (const s of fields) {
      // A fresh /g instance per string — a shared one carries lastIndex from call to call.
      const re = new RegExp(ROW_TOKEN_SOURCE, 'gi');
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        const key = m[2].trim().toLowerCase();
        const entry = usage.get(key) ?? { count: 0, heads: new Set<RowTokenHead>() };
        entry.count++;
        entry.heads.add(m[1].toLowerCase() as RowTokenHead);
        usage.set(key, entry);
      }
    }
  }
  return usage;
}

/** The head to draw an orphan with: the one the author wrote, {row:} first when both appear. */
export function orphanHead(u: ColumnUsage): RowTokenHead {
  return u.heads.has('row') ? 'row' : 'rownext';
}
