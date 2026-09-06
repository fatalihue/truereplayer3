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

/** Lower-cased column name → usage, scanning the serialised form of every action. */
export function scanRowTokenUsage(actions: readonly unknown[]): Map<string, ColumnUsage> {
  const usage = new Map<string, ColumnUsage>();
  for (const a of actions) {
    const s = JSON.stringify(a);
    // A fresh /g instance per action — a shared one carries lastIndex from call to call.
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
  return usage;
}

/** The head to draw an orphan with: the one the author wrote, {row:} first when both appear. */
export function orphanHead(u: ColumnUsage): RowTokenHead {
  return u.heads.has('row') ? 'row' : 'rownext';
}
