import { useMemo } from 'react';
import { create } from 'zustand';
import type { ProfileDataTable } from '../../bridge/messageTypes';
import { rowsToSave, useDataLoop, type DataTableToSave } from '../../logic/useDataLoop';
import { encodeTsv, parseTsv, sniffDelimiter, tokenizeTsvGrid } from '../../lib/tsv';
import { t } from '../../i18n';
import { useApp, useShell } from '../store';

/**
 * The Data Loop tab's own state (⑥), apart from the engine's table: what was sent and not echoed
 * yet, the rows on screen that are not in the table, which cell is active or open, the search and
 * the paste being prepared. It belongs to the open macro and starts over with another one.
 *
 * The table applies as it is edited (decision 2): every confirmed cell, column and row change is
 * one data:save, and the engine records it as one entry of the macro's undo (Ctrl+Z). What was sent
 * shows at once, until the engine sends the table back (rule 2).
 */

/** A column name is a {row:…} token's name unless it is empty or holds { } or :, the token's own characters. */
const VALID_NAME = /^[^{}:]+$/;
export const validName = (name: string) => VALID_NAME.test(name.trim());

/**
 * A blank's stand-in for an element inside a sentence of the catalog (a <code>, a <strong>): the
 * sentence is split there and the element drawn in its place, where each language puts it.
 */
export const CUT = '\u0001';

export interface Cell { r: number; c: number }
/** r = -1 is the header row, c = -1 the row numbers. */
export type Editing =
  | { kind: 'cell'; r: number; c: number; macro: string; seed: string | null }
  | { kind: 'header'; c: number; macro: string };

export interface PasteDraft {
  text: string;
  /** What the box opened with: unchanged, it is not work that could be lost. */
  prefill: string;
  mode: 'replace' | 'append';
  header: boolean;
}

interface DataTab {
  macro: string | null;
  /** The last table sent, shown until the engine's own copy matches it (or 1.5 s pass). */
  sent: DataTableToSave | null;
  /** Empty rows after the table's last row: on screen, and saved once they hold a value. */
  blank: number;
  editing: Editing | null;
  active: Cell | null;
  /** The search box, and the term it applies (a moment later, or on Enter). */
  find: string;
  term: string;
  /** Which of the matching rows the "k of N" points at; -1 before the first jump. */
  hit: number;
  paste: PasteDraft | null;
}

const START: Omit<DataTab, 'macro'> = { sent: null, blank: 0, editing: null, active: null, find: '', term: '', hit: -1, paste: null };

export const useDataTab = create<DataTab>(() => ({ macro: null, ...START }));

const EMPTY_ROW: string[] = [];

/** The table as a save writes it, from the engine's copy. */
function toSave(table: ProfileDataTable): DataTableToSave {
  return { headers: table.headers, rows: table.rows, loopOverData: table.loopOverData, onRowError: table.onRowError, notifyOnLapComplete: table.notifyOnLapComplete };
}

/** As the engine keeps it: no table at all goes back to the defaults (HandleDataSave stores null). */
function normalized(table: DataTableToSave): DataTableToSave {
  if (table.headers.length === 0 && table.rows.length === 0) return { headers: [], rows: [], loopOverData: false, onRowError: 'halt', notifyOnLapComplete: true };
  return { ...table, onRowError: table.onRowError === 'skip' ? 'skip' : 'halt', notifyOnLapComplete: table.notifyOnLapComplete !== false };
}

const sameList = (a: string[], b: string[]) => a === b || (a.length === b.length && a.every((v, i) => v === b[i]));

function sameTable(a: DataTableToSave, b: DataTableToSave): boolean {
  return a.loopOverData === b.loopOverData && a.onRowError === b.onRowError && a.notifyOnLapComplete === b.notifyOnLapComplete
    && sameList(a.headers, b.headers) && a.rows.length === b.rows.length && a.rows.every((r, i) => sameList(r, b.rows[i]));
}

export interface Shown extends DataTableToSave {
  /** The rows of the engine's table; the ones after them are blank and not saved. */
  saved: number;
  cursorRow: number;
}

function shownOf(engine: ProfileDataTable, sent: DataTableToSave | null, blank: number): Shown {
  const table = sent ?? toSave(engine);
  const rows = blank > 0 ? [...table.rows, ...Array.from({ length: blank }, () => EMPTY_ROW)] : table.rows;
  // A row wider than the headers (a table saved before the paste extended them) shows its extra
  // cells under colN columns, which the next edit saves: no cell is out of sight.
  const width = table.rows.reduce((m, r) => Math.max(m, r.length), table.headers.length);
  let headers = table.headers;
  if (width > headers.length) {
    headers = headers.slice();
    while (headers.length < width) headers.push(nextColName(headers));
  }
  // -1 is "never moved", which runs row 1.
  return { ...table, headers, rows, saved: table.rows.length, cursorRow: Math.max(0, engine.cursorRow ?? 0) };
}

/** The table on screen: what was sent, else the engine's, with the blank rows after it. */
export function useShown(): Shown {
  const engine = useApp(a => a.dataTable);
  const sent = useDataTab(s => s.sent);
  const blank = useDataTab(s => s.blank);
  return useMemo(() => shownOf(engine, sent, blank), [engine, sent, blank]);
}

export function shownNow(): Shown {
  const { sent, blank } = useDataTab.getState();
  return shownOf(useShell.getState().app.dataTable, sent, blank);
}

/** Anything the engine would refuse to hear now, or that a run is reading: the tab is read-only. */
export function lockedNow(): boolean {
  const app = useShell.getState().app;
  return app.status !== 'ready' || app.settings.useCursorClick;
}

// Another macro starts the tab over; the engine's copy matching what was sent ends the wait for it.
useShell.subscribe((s, prev) => {
  if (s.app.activeProfile !== prev.app.activeProfile) {
    useDataTab.setState({ macro: s.app.activeProfile, ...START });
    return;
  }
  if (s.app.dataTable === prev.app.dataTable) return;
  const { sent } = useDataTab.getState();
  if (sent && sameTable(normalized(toSave(s.app.dataTable)), sent)) useDataTab.setState({ sent: null });
});
// A run that starts closes what was being typed in the table: it is read-only while it runs.
useShell.subscribe((s, prev) => {
  if (s.app.status === prev.app.status && s.app.settings.useCursorClick === prev.app.settings.useCursorClick) return;
  if (lockedNow() && useDataTab.getState().editing) useDataTab.setState({ editing: null });
});

let settle = 0;

export function nextColName(headers: string[]): string {
  const taken = new Set(headers.map(h => h.trim().toLowerCase()));
  let n = headers.length + 1;
  while (taken.has(`col${n}`)) n++;
  return `col${n}`;
}

/** Why a name cannot be this column's, or null. Names ignore case, as the tokens do. */
export function nameProblem(name: string, headers: string[], c: number): string | null {
  const n = name.trim();
  if (n === '') return t('dataLoop.name.empty');
  if (!validName(n)) return t('dataLoop.name.invalid');
  const key = n.toLowerCase();
  if (headers.some((h, i) => i !== c && h.trim().toLowerCase() === key)) return t('dataLoop.name.taken', { name: n });
  return null;
}

type Save = (table: DataTableToSave) => void;

/**
 * Sends the grid as the table: the empty rows at its end stay on screen as blank rows, the rest is
 * saved. Nothing is sent when that changes nothing. Read-only while a run is on.
 */
function commit(save: Save, grid: { headers: string[]; rows: string[][] }, settings: Partial<DataTableToSave> = {}): boolean {
  if (lockedNow()) return false;
  const shown = shownNow();
  const rows = rowsToSave(grid.headers, grid.rows);
  const blank = grid.rows.length - rows.length;
  const base: DataTableToSave = { headers: shown.headers, rows: shown.rows.slice(0, shown.saved), loopOverData: shown.loopOverData, onRowError: shown.onRowError, notifyOnLapComplete: shown.notifyOnLapComplete };
  const table = normalized({ ...base, ...settings, headers: grid.headers, rows });
  if (sameTable(table, normalized(base))) {
    if (blank !== useDataTab.getState().blank) useDataTab.setState({ blank });
    return false;
  }
  save(table);
  useDataTab.setState({ sent: table, blank });
  window.clearTimeout(settle);
  settle = window.setTimeout(() => {
    if (useDataTab.getState().sent === table) useDataTab.setState({ sent: null });
  }, 1500);
  return true;
}

const withCell = (rows: string[][], r: number, c: number, value: string) => {
  const next = rows.slice();
  const row = (next[r] ?? EMPTY_ROW).slice();
  while (row.length <= c) row.push('');
  row[c] = value;
  next[r] = row;
  return next;
};

/** Each row as wide as the headers, so a column can be moved or put in between. */
const padded = (rows: string[][], width: number) => rows.map(r => {
  if (r.length >= width) return r;
  const row = r.slice();
  while (row.length < width) row.push('');
  return row;
});

/** Use sample data's table: example data, the same in both languages (its column names are tokens). */
export const SAMPLE = {
  headers: ['name', 'email', 'amount'],
  rows: [
    ['Maria', 'maria@example.com', '89.90'],
    ['João', 'joao@example.com', '149.00'],
    ['Ana', 'ana@example.com', '32.50'],
  ],
};

/** The paste box's placeholder: the sample's header and first two rows, as a spreadsheet copies them. */
export const SAMPLE_TEXT = encodeTsv(SAMPLE.headers, SAMPLE.rows.slice(0, 2));

/** The table's edits, each one save (and one undo entry). */
export function useDataOps() {
  const dl = useDataLoop();
  return useMemo(() => {
    const save: Save = dl.save;
    const grid = () => {
      const s = shownNow();
      return { headers: s.headers, rows: s.rows };
    };
    return {
      setCell(r: number, c: number, value: string) {
        const g = grid();
        if ((g.rows[r]?.[c] ?? '') === value) return;
        commit(save, { headers: g.headers, rows: withCell(g.rows, r, c, value) });
      },
      /** Renames a column, or says why it cannot (D18: the name is checked as it is typed). */
      renameColumn(c: number, name: string): string | null {
        const g = grid();
        const problem = nameProblem(name, g.headers, c);
        if (problem) return problem;
        if (g.headers[c] === name.trim()) return null;
        const headers = g.headers.slice();
        headers[c] = name.trim();
        commit(save, { headers, rows: g.rows });
        return null;
      },
      /** A column at `at` (the end by default), named colN unless a free name is given; its index. */
      addColumn(at?: number, name?: string): number {
        const g = grid();
        const c = at ?? g.headers.length;
        const headers = g.headers.slice();
        headers.splice(c, 0, name !== undefined && nameProblem(name, g.headers, -1) === null ? name.trim() : nextColName(g.headers));
        const rows = c >= g.headers.length ? g.rows : padded(g.rows, g.headers.length).map(r => {
          const row = r.slice();
          row.splice(c, 0, '');
          return row;
        });
        commit(save, { headers, rows });
        return c;
      },
      /** Swaps a column with its neighbour. */
      moveColumn(c: number, to: number) {
        const g = grid();
        if (to < 0 || to >= g.headers.length) return;
        const headers = g.headers.slice();
        [headers[c], headers[to]] = [headers[to], headers[c]];
        const rows = padded(g.rows, g.headers.length).map(r => {
          const row = r.slice();
          [row[c], row[to]] = [row[to], row[c]];
          return row;
        });
        commit(save, { headers, rows });
      },
      deleteColumn(c: number) {
        const g = grid();
        commit(save, { headers: g.headers.filter((_, i) => i !== c), rows: g.rows.map(r => (r.length > c ? r.filter((_, i) => i !== c) : r)) });
      },
      /** A blank row at the end, on screen until it holds a value; its index. */
      addRow(): number {
        const s = shownNow();
        useDataTab.setState({ blank: useDataTab.getState().blank + 1 });
        return s.rows.length;
      },
      duplicateRow(r: number) {
        const g = grid();
        const rows = g.rows.slice();
        rows.splice(r + 1, 0, (g.rows[r] ?? EMPTY_ROW).slice());
        commit(save, { headers: g.headers, rows });
      },
      deleteRow(r: number) {
        const g = grid();
        commit(save, { headers: g.headers, rows: g.rows.filter((_, i) => i !== r) });
      },
      clear() {
        const g = grid();
        if (g.headers.length === 0 && g.rows.length === 0) return false;
        useDataTab.setState({ blank: 0 });
        return commit(save, { headers: [], rows: [] });
      },
      /** One column to name, and a row to fill. */
      startEmpty() {
        commit(save, { headers: ['col1'], rows: [EMPTY_ROW] });
      },
      useSample() {
        commit(save, { headers: SAMPLE.headers, rows: SAMPLE.rows });
      },
      setLoop(loopOverData: boolean) {
        commit(save, grid(), { loopOverData });
      },
      setOnRowError(onRowError: 'halt' | 'skip') {
        commit(save, grid(), { onRowError });
      },
      setNotify(notifyOnLapComplete: boolean) {
        commit(save, grid(), { notifyOnLapComplete });
      },
      /** The cursor onto a row of the table (not a blank one): the next run starts there. */
      setCursor(r: number) {
        if (lockedNow() || r >= shownNow().saved) return false;
        return dl.setCursor(r);
      },
      resetCursor() {
        if (lockedNow()) return;
        dl.resetCursor();
      },
      /** Applies a paste: the whole table, or rows added under it. False when it holds no columns. */
      applyPaste(draft: PasteDraft): boolean {
        const parsed = parseTsv(draft.text, draft.header);
        if (parsed.headers.length === 0) return false;
        const g = grid();
        if (draft.mode === 'replace') {
          // Wider rows than the header line become colN columns: no cell is dropped.
          const headers = parsed.headers.slice();
          const width = parsed.rows.reduce((m, r) => Math.max(m, r.length), headers.length);
          while (headers.length < width) headers.push(nextColName(headers));
          useDataTab.setState({ blank: 0 });
          commit(save, { headers, rows: parsed.rows });
          return true;
        }
        const kept = g.rows.slice(0, shownNow().saved);
        commit(save, draft.header ? appendByName(g.headers, kept, parsed) : appendByPosition(g.headers, kept, parsed.rows));
        return true;
      },
    };
  }, [dl]);
}

export type DataOps = ReturnType<typeof useDataOps>;

/**
 * Append with no header line: by position — pasted column i fills column i, and cells past the
 * table's last column become new colN columns.
 */
function appendByPosition(have: string[], rows: string[][], pasted: string[][]) {
  const headers = have.slice();
  const widest = pasted.reduce((m, r) => Math.max(m, r.length), 0);
  while (headers.length < widest) headers.push(nextColName(headers));
  const added = pasted.map(r => {
    const out: string[] = Array(headers.length).fill('');
    r.forEach((cell, i) => { out[i] = cell; });
    return out;
  });
  return { headers, rows: [...rows, ...added] };
}

/**
 * Append with a header line: each pasted column goes to the table's column of that name (trimmed,
 * case ignored, the LAST one when the table repeats a name — the one {row:…} reads). A name the
 * table does not have becomes a new column; a name the paste repeats gets _2, _3…; cells past the
 * header line become colN columns. No cell is dropped.
 */
function appendByName(have: string[], rows: string[][], parsed: { headers: string[]; rows: string[][] }) {
  const headers = have.slice();
  const keyOf = (h: string) => h.trim().toLowerCase();
  const claimed = new Set<string>();
  const slot = parsed.headers.map((h) => {
    const key = keyOf(h);
    if (!claimed.has(key)) {
      claimed.add(key);
      for (let i = have.length - 1; i >= 0; i--) if (keyOf(have[i]) === key) return i;
    }
    let name = h.trim();
    if (headers.some(e => keyOf(e) === keyOf(name))) {
      const base = name;
      let n = 2;
      while (headers.some(e => keyOf(e) === keyOf(`${base}_${n}`))) n++;
      name = `${base}_${n}`;
    }
    headers.push(name);
    return headers.length - 1;
  });
  const widest = parsed.rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (let i = slot.length; i < widest; i++) {
    headers.push(nextColName(headers));
    slot.push(headers.length - 1);
  }
  const added = parsed.rows.map(r => {
    const out: string[] = Array(headers.length).fill('');
    r.forEach((cell, i) => { out[slot[i]] = cell; });
    return out;
  });
  return { headers, rows: [...padded(rows, headers.length), ...added] };
}

/** The table as text, as a spreadsheet copies it. */
export function tableText(): string {
  const s = shownNow();
  return encodeTsv(s.headers, s.rows.slice(0, s.saved));
}

/** Opens the paste surface: on the table as text (Replace), or on a text given (an import, a Ctrl+V). */
export function openPaste(text?: string) {
  const prefill = text === undefined ? tableText() : '';
  useDataTab.setState({ paste: { text: text ?? prefill, prefill, mode: 'replace', header: true }, editing: null });
}

/**
 * A CSV, TSV or text file, read as the spreadsheet that wrote it: the BOM names the encoding; with
 * none, UTF-8 first (strictly, so a stray byte fails over instead of turning into �), then
 * Windows-1252 — what Excel's plain CSV is on a Brazilian Windows. The separator is found (; , tab)
 * and the text re-written with tabs, for the paste surface.
 */
export async function readTableFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf, 0, Math.min(3, buf.byteLength));
  const bom = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le'
    : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be'
      : b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 'utf-8'
        : null;
  let text: string;
  if (bom) text = new TextDecoder(bom).decode(buf);
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      text = new TextDecoder('windows-1252').decode(buf);
    }
  }
  if (text.trim() === '') return '';
  const grid = tokenizeTsvGrid(text, sniffDelimiter(text));
  return encodeTsv(grid[0] ?? [], grid.slice(1));
}

// The table and the tools both ask for the matches of one search: worked out once per table and term.
let found: { rows: string[][]; term: string; out: number[] } | null = null;

/** The rows the search finds (it highlights them; it never hides any). */
export function matchingRows(rows: string[][], term: string): number[] {
  const needle = term.trim().toLowerCase();
  if (needle === '') return [];
  if (found && found.rows === rows && found.term === needle) return found.out;
  const out: number[] = [];
  rows.forEach((row, r) => { if (row.some(cell => cell.toLowerCase().includes(needle))) out.push(r); });
  found = { rows, term: needle, out };
  return out;
}

/** Hands the focus back to the table once what had it is gone (a cell's editor closing on its key). */
export function refocusTable() {
  setTimeout(() => {
    const now = document.activeElement;
    if (now && now !== document.body) return;
    (document.querySelector<HTMLElement>('.dl-sheet') ?? document.querySelector<HTMLElement>('.dl-panel'))?.focus({ preventScroll: true });
  }, 0);
}
