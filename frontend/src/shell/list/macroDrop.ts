import { create } from 'zustand';
import { useShell } from '../store';
import { slotAt, type DropSlot } from './useStepDrag';

const EDGE = 40;   // px from the list's top or bottom where it scrolls by itself
const SPEED = 14;  // px per frame at the very edge

/**
 * A macro dragged from the library over the steps (lista-049): where its Run Macro would land, for
 * the list to draw the line there. Nothing while a run, a recording or the Clicker is on: the
 * drop is ignored then, as today.
 */
export const useMacroDrop = create<{ slot: DropSlot | null }>(() => ({ slot: null }));

let pointer = { x: 0, y: 0 };
let scrollFrame = 0;

/**
 * The Steps panel under the pointer (its list, or the "No steps yet" of an empty macro). By what
 * is on top there, not by the panel's box: the library laid over the steps is not the steps.
 */
const panelUnder = () => {
  const panel = document.getElementById('macro-panel-steps');
  const hit = document.elementFromPoint(pointer.x, pointer.y);
  return panel && hit && panel.contains(hit) ? panel : null;
};

function measure(): DropSlot | null {
  const { status, actions } = useShell.getState().app;
  if (status !== 'ready') return null;
  const panel = panelUnder();
  if (!panel) return null;
  const body = panel.querySelector<HTMLElement>('.steps-body');
  // An empty macro takes the step as its first.
  return body ? slotAt(body, pointer.x, pointer.y, actions.length) : { index: 0, top: 0 };
}

const set = (slot: DropSlot | null) => {
  const now = useMacroDrop.getState().slot;
  if (now?.index !== slot?.index || now?.top !== slot?.top) useMacroDrop.setState({ slot });
};

// Near the list's top or bottom edge it scrolls by itself, and the slot moves with it.
const scroll = () => {
  scrollFrame = 0;
  const scroller = document.querySelector<HTMLElement>('#macro-panel-steps .steps-scroll');
  if (!scroller || !useMacroDrop.getState().slot) return;
  const r = scroller.getBoundingClientRect();
  let delta = 0;
  if (pointer.y < r.top + EDGE) delta = -SPEED * Math.min(1, (r.top + EDGE - pointer.y) / EDGE);
  else if (pointer.y > r.bottom - EDGE) delta = SPEED * Math.min(1, (pointer.y - (r.bottom - EDGE)) / EDGE);
  if (delta === 0) return;
  scroller.scrollTop += delta;
  set(measure());
  scrollFrame = requestAnimationFrame(scroll);
};

export const macroDrop = {
  /** The pointer moved, once a frame, during a macro drag: true when it is over the steps. */
  over(x: number, y: number): boolean {
    pointer = { x, y };
    const slot = measure();
    set(slot);
    if (slot && !scrollFrame) scrollFrame = requestAnimationFrame(scroll);
    return slot !== null;
  },
  /** The drag ended: where its Run Macro goes, or null when it was not over the steps. */
  end(): number | null {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    const at = useMacroDrop.getState().slot?.index ?? null;
    set(null);
    return at;
  },
};
