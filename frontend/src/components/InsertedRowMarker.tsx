import { useLayoutEffect, useRef } from 'react';
import { useAppState } from '../state/AppStateContext';

/**
 * Flashes the rows that just landed in the grid — a paste, an insert from the toolbar, a
 * capture-first Wait Image, an undo that brings a row back — so "where did it go?" is answered
 * by the grid itself. Same doctrine as ReplayRowMarker: the flash is an attribute plus a CSS
 * animation (index.css, `tr[data-inserted]`), never render state, so it costs one querySelector
 * per NEW row and nothing per unchanged row.
 *
 * What does not flash, on purpose: the first fill of an empty grid and a profile switch (every
 * id is new — a whole-grid flash says nothing), and rows arriving while a recording is live
 * (they land several a second, on a surface the user is not looking at). Both come down to one
 * test: flash only a small set of new ids inside a grid that already had rows.
 */
export function InsertedRowMarker({ tbodyRef }: { tbodyRef: React.RefObject<HTMLTableSectionElement | null> }) {
  const { actions, buttonStates } = useAppState();
  const prevIds = useRef<Set<string> | null>(null);

  useLayoutEffect(() => {
    // Same id rule as the grid's sortable ids, so a row without an id (an upgrade-window
    // payload) is keyed by position here too and never mis-flashed.
    const ids = actions.map((a, i) => a.id ?? `row-${i}`);
    const prev = prevIds.current;
    prevIds.current = new Set(ids);
    if (!prev || prev.size === 0 || buttonStates.recordingActive) return;
    if (document.documentElement.getAttribute('data-animations') !== 'true') return;

    const fresh: number[] = [];
    ids.forEach((id, i) => { if (!prev.has(id)) fresh.push(i); });
    // A whole-grid replacement is not an insert; 20 is well above any paste the toolbar makes.
    if (fresh.length === 0 || fresh.length > 20 || fresh.length >= ids.length) return;

    const tbody = tbodyRef.current;
    if (!tbody) return;
    for (const i of fresh) {
      // data-row-index, not nth-child: the tbody also holds the "+ Add Else" ghost rows and the
      // drag drop-gap row (see ReplayRowMarker).
      const row = tbody.querySelector<HTMLTableRowElement>(`tr[data-row-index="${i}"]`);
      if (!row) continue;
      row.setAttribute('data-inserted', '');
      const clear = () => row.removeAttribute('data-inserted');
      row.addEventListener('animationend', clear, { once: true });
      // animationend never fires in an occluded window (the DialogShell lesson) — a fallback
      // clears the mark so a hidden window cannot come back with a permanently flashed row.
      setTimeout(clear, 1000);
    }
  }, [actions, buttonStates.recordingActive, tbodyRef]);

  return null;
}
