import { useMemo } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { useGetAppState } from '../state/AppStateContext';
import type { ProfileDataTable } from '../bridge/messageTypes';

/** What a save writes: the table without the run cursor, which is runtime state and never saved. */
export type DataTableToSave = Omit<ProfileDataTable, 'cursorRow'>;

/**
 * The rows the engine stores. Parity with the old parseTsv: trailing all-empty rows are dropped,
 * and the kept rows are padded to the header count so the wire shape is rectangular. A row already
 * as wide is kept as it is (the same array), so a table edited cell by cell redraws one row.
 */
export function rowsToSave(headers: string[], rows: string[][]): string[][] {
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((c) => c.trim() === '')) end--;
  return rows.slice(0, end).map((r) => {
    if (r.length >= headers.length) return r;
    const row = [...r];
    while (row.length < headers.length) row.push('');
    return row;
  });
}

/** The open macro's Data Loop table, as commands. */
export function useDataLoop() {
  const { send } = useBridge();
  const getState = useGetAppState();
  return useMemo(() => ({
    /** Asks the engine for the table again — a freshness ping when an editor opens. */
    request: () => send({ type: 'data:request', payload: {} }),
    /** Saves the table, rows normalised by rowsToSave. */
    save: (table: DataTableToSave) =>
      send({ type: 'data:save', payload: { ...table, rows: rowsToSave(table.headers, table.rows) } }),
    /**
     * Parks the run cursor on a row (0-based), so the next run starts there. The cursor points into
     * the SAVED table — the engine ignores a row past its end (HandleActionsResetRow) — so a row that
     * exists only in an unsaved edit is refused here: false, and nothing is sent.
     */
    setCursor: (row: number) => {
      if (row >= getState().dataTable.rows.length) return false;
      send({ type: 'actions:resetRow', payload: { row } });
      return true;
    },
    /** Back to row 1: the next run starts at the top of the table. */
    resetCursor: () => send({ type: 'actions:resetRow', payload: {} }),
  }), [send, getState]);
}
