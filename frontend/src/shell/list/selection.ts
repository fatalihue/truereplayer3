import { create } from 'zustand';
import type { ActionItem } from '../../bridge/messageTypes';
import { stepKey } from './stepTypes';

/**
 * Which steps are selected, by their key (the engine's id), not by position: a moved step stays
 * selected wherever it lands, and a deleted one simply stops being in the list. The anchor is
 * where Shift+click and Shift+arrows extend from; the cursor is the row the arrows move.
 *
 * The selection also places the insertion point (lista-032): new steps — a recording, a paste,
 * the Add step catalog — go AFTER the last selected step, or at the end with nothing selected.
 */
interface SelectionState {
  keys: ReadonlySet<string>;
  anchor: string | null;
  cursor: string | null;
}

const EMPTY: ReadonlySet<string> = new Set();

export const useSelection = create<SelectionState>(() => ({ keys: EMPTY, anchor: null, cursor: null }));

const keysOf = (steps: ActionItem[], indices: Iterable<number>) => {
  const out = new Set<string>();
  for (const i of indices) if (steps[i]) out.add(stepKey(steps[i], i));
  return out;
};

/** The selected positions, in list order. Keys no longer in the list are left out. */
export function selectedIndices(steps: ActionItem[], keys: ReadonlySet<string> = useSelection.getState().keys): number[] {
  if (keys.size === 0) return [];
  const out: number[] = [];
  steps.forEach((s, i) => { if (keys.has(stepKey(s, i))) out.push(i); });
  return out;
}

/** Where a new step goes: after the last selected step, or at the end. */
export function insertPoint(steps: ActionItem[], keys: ReadonlySet<string> = useSelection.getState().keys): number {
  const sel = selectedIndices(steps, keys);
  return sel.length > 0 ? sel[sel.length - 1] + 1 : steps.length;
}

export const selection = {
  clear: () => useSelection.setState({ keys: EMPTY, anchor: null, cursor: null }),
  /** Exactly these rows; the anchor and the cursor go to `focus` (the first by default). */
  set: (steps: ActionItem[], indices: number[], focus = indices[0]) => {
    const k = focus != null && steps[focus] ? stepKey(steps[focus], focus) : null;
    useSelection.setState({ keys: keysOf(steps, indices), anchor: k, cursor: k });
  },
  /** One row, as a plain click or an arrow key selects it. */
  only: (steps: ActionItem[], index: number) => selection.set(steps, [index]),
  /** Adds or removes one row, keeping the rest (Ctrl+click, Space, the row's checkbox). */
  toggle: (steps: ActionItem[], index: number) => {
    const k = stepKey(steps[index], index);
    const keys = new Set(useSelection.getState().keys);
    if (keys.has(k)) keys.delete(k); else keys.add(k);
    useSelection.setState({ keys, anchor: k, cursor: k });
  },
  /** The range from the anchor to `index` (Shift+click adds it; Shift+arrows replace with it). */
  range: (steps: ActionItem[], index: number, add: boolean) => {
    const { anchor, keys } = useSelection.getState();
    const from = anchor === null ? -1 : steps.findIndex((s, i) => stepKey(s, i) === anchor);
    const a = from < 0 ? index : from;
    const next = new Set(add ? keys : EMPTY);
    for (let i = Math.min(a, index); i <= Math.max(a, index); i++) next.add(stepKey(steps[i], i));
    useSelection.setState({ keys: next, cursor: stepKey(steps[index], index), anchor: from < 0 ? stepKey(steps[index], index) : anchor });
  },
  all: (steps: ActionItem[]) => useSelection.setState({ keys: keysOf(steps, steps.keys()) }),
};
