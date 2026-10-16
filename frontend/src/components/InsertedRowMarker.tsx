import { useLayoutEffect, useRef } from 'react';
import { useAppState } from '../state/AppStateContext';

/**
 * Flashes the rows that just landed in the grid — a paste, an insert from the toolbar, a
 * capture-first Wait Image, an undo that brings a row back — so "where did it go?" is answered
 * by the grid itself. Same doctrine as ReplayRowMarker: the flash is an attribute plus a CSS
 * transition (index.css, `tr[data-inserted]`), never render state, so it costs one querySelector
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
    const rows: HTMLTableRowElement[] = [];
    for (const i of fresh) {
      // data-row-index, not nth-child: the tbody also holds the "+ Add Else" ghost rows and the
      // drag drop-gap row (see ReplayRowMarker).
      const row = tbody.querySelector<HTMLTableRowElement>(`tr[data-row-index="${i}"]`);
      if (row) rows.push(row);
    }
    if (rows.length === 0) return;

    // Two steps, because the flash is a transition (index.css says why): "on" paints the tint
    // with no transition, a forced style read commits it as each row's starting value, and
    // "fade" lets it decay. All "on" writes go first so the reads cost one style pass — the
    // first read recalculates, the rest find the style already clean.
    for (const row of rows) row.setAttribute('data-inserted', 'on');
    for (const row of rows) void getComputedStyle(row).backgroundColor;
    for (const row of rows) {
      row.setAttribute('data-inserted', 'fade');
      const clear = () => {
        row.removeEventListener('transitionend', onEnd);
        row.removeAttribute('data-inserted');
      };
      // transitionend bubbles: a cell's own hover transition must not end the row's fade.
      const onEnd = (e: TransitionEvent) => {
        if (e.target === row && e.propertyName === 'background-color') clear();
      };
      row.addEventListener('transitionend', onEnd);
      // transitionend never fires in an occluded window (the DialogShell lesson) — a fallback
      // clears the mark so a hidden window cannot come back with a permanently flashed row.
      setTimeout(clear, 1000);
    }
  }, [actions, buttonStates.recordingActive, tbodyRef]);

  return null;
}
