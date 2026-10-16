import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Play, Pause } from 'lucide-react';
import { useAppState, useHighlightedAction } from '../state/AppStateContext';

/**
 * Paints the "engine is on THIS row" treatment without putting the highlight index into
 * ActionTable's render.
 *
 * The grid is an inline `actions.map()` with no memo boundary (see the SortableRowShell note
 * in ActionTable — extracting the row would mean threading 30+ closure values through props),
 * so a component that reads `useHighlightedAction()` re-renders every row on every executed
 * action. Measured on the largest real macro (87 rows, 2298 DOM nodes in the grid): 19.5 ms
 * median / 45.6 ms p90 per push, scaling linearly with row count (2 rows 5.0 ms, 30 rows
 * 9.1 ms, 200 rows 41.1 ms) — to produce THREE DOM mutations. An 87-row lap spent ~1.3 s of
 * WebView main thread on nothing but moving a tint, and a While with delay 0 pushes once per
 * iteration (ActionExecution.cs), so the messages arrived faster than React could drain them.
 *
 * This component is the whole highlight consumer instead. It marks the row with
 * `data-replay="running" | "paused"` — index.css owns the tint, the inset bar and the pulse —
 * and portals the program-counter glyph into that row's slot. Cost is constant in row count:
 * one querySelector, one attribute write, one tiny portal.
 *
 * The glyph is not decoration. State here needs TWO channels (see the toggle-two-channel
 * convention): the replay-green wash alone sits close enough to the selection tint in some
 * themes that the executing row reads as "selected", so the row number swaps to a filled
 * play/pause glyph as the second channel.
 */
export function ReplayRowMarker({ tbodyRef }: { tbodyRef: React.RefObject<HTMLTableSectionElement | null> }) {
  const index = useHighlightedAction();
  const { actions, pauseState } = useAppState();
  // The row we actually wrote to, held by ELEMENT and not by index: on a reorder the index
  // that was marked no longer names the same row, and clearing the wrong one leaves a
  // permanently tinted row behind.
  const markedRef = useRef<HTMLTableRowElement | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // Paused-HERE, the same condition the row used to compute inline: the engine is parked on
  // this row AND the row is the Pause action itself. A Pause elsewhere in the list keeps the
  // ordinary running treatment.
  const paused = index !== null
    && pauseState.isPaused
    && actions[index]?.actionType === 'Pause';

  // Deps are [index, paused] and deliberately NOT `actions`: the effect calls scrollIntoView,
  // and keying it on an array identity would re-run it on every unrelated AppState push —
  // yanking the grid back under a user who scrolled it by hand mid-replay. Stale marks can't
  // survive a list change anyway, because highlightReducer nulls the index on 'actions:updated'
  // and that runs this effect with index === null.
  useLayoutEffect(() => {
    const prev = markedRef.current;
    if (prev) {
      prev.removeAttribute('data-replay');
      markedRef.current = null;
    }

    if (index === null) { setSlot(null); return; }
    // data-row-index, not nth-child: the tbody also holds the "+ Add Else" ghost rows and the
    // drag drop-gap row, so a positional selector would drift off by one inside any block.
    const row = tbodyRef.current?.querySelector<HTMLTableRowElement>(`tr[data-row-index="${index}"]`);
    // No row is normal, not an error: RunProfile executes rows from a sub-profile that are
    // absent from this grid, and the engine's row-index lookup already suppresses those.
    if (!row) { setSlot(null); return; }

    row.setAttribute('data-replay', paused ? 'paused' : 'running');
    markedRef.current = row;
    // `behavior: 'auto'` (instant jump) is intentional despite feeling less polished than
    // smooth scrolling. At higher replay speeds (10+ actions/sec) smooth scrolls queue up
    // faster than they complete — the animation never catches the latest row, the grid
    // visibly lags, and the main thread is occupied with overlapping scroll tweens instead
    // of paint work.
    row.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    setSlot(row.querySelector<HTMLElement>('[data-replay-slot]'));
  }, [index, paused, tbodyRef]);

  // Release the mark on unmount (profile switch tears the grid down) so a re-mounted grid
  // can't inherit a tinted row from the previous one.
  useLayoutEffect(() => () => {
    markedRef.current?.removeAttribute('data-replay');
    markedRef.current = null;
  }, []);

  if (!slot) return null;
  // Named, not aria-hidden: the glyph REPLACES the row number (index.css hides it under
  // tr[data-replay]), so a silent icon left the cell with nothing to read at all. role="img" +
  // aria-label is also what keeps lucide from stamping its default aria-hidden on the svg.
  return createPortal(
    paused
      ? <Pause size={10} role="img" aria-label="Paused" className="inline-block translate-y-[-1px]" style={{ color: 'var(--color-action-pause-fg)' }} fill="currentColor" />
      : <Play size={10} role="img" aria-label="Running" className="inline-block translate-y-[-1px]" style={{ color: 'var(--color-replay-fg)' }} fill="currentColor" />,
    slot,
  );
}
