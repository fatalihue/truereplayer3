import { create } from 'zustand';
import type { useSteps } from '../../logic/useSteps';
import { useShell } from '../store';

/**
 * What the Inspector shares between its frame (in the opening bundle) and its editors (loaded with
 * the first step): the fields with typing not yet sent, which hold the automations back (D12), and
 * where the focus goes next.
 */

/** The editors are not part of opening the app (rule 6): they load with the first step selected, or
 *  earlier, when the pointer or the focus reaches the list. */
export const loadInspectorBody = () => import('./InspectorBody');

const NONE: ReadonlySet<string> = new Set();
export const usePendingEdits = create<{ fields: ReadonlySet<string> }>(() => ({ fields: NONE }));

export const pendingEdits = {
  /** A field has typing the engine has not had yet. */
  add: (field: string) => {
    const { fields } = usePendingEdits.getState();
    if (!fields.has(field)) usePendingEdits.setState({ fields: new Set(fields).add(field) });
  },
  /** …and now it has (or the typing was dropped). */
  remove: (field: string) => {
    const { fields } = usePendingEdits.getState();
    if (!fields.has(field)) return;
    const next = new Set(fields);
    next.delete(field);
    usePendingEdits.setState({ fields: next });
  },
};

/**
 * A step being made in the Inspector before it exists. A Key waits for its key there (Key in the
 * insert row and in the catalog): the engine keeps no Keystroke without one, so the step is born
 * when the key arrives, at the insertion point it was asked for, and Esc leaves nothing behind.
 */
export interface Draft {
  kind: 'key';
  /** Where the step goes, and in which macro. */
  at: number;
  macro: string | null;
}
export const useDraft = create<{ draft: Draft | null }>(() => ({ draft: null }));
export const drafts = {
  start: (draft: Draft) => useDraft.setState({ draft }),
  end: () => { if (useDraft.getState().draft) useDraft.setState({ draft: null }); },
};

export type StepEdit = { field: string; value: string };

/**
 * Sends edits to one step, found by its id now: it may have moved since the typing began. One
 * message, one undo entry. False when the step is gone or there is nothing to send.
 */
export function applyEdits(cmds: ReturnType<typeof useSteps>, stepId: string, edits: StepEdit[]): boolean {
  if (edits.length === 0) return false;
  const index = useShell.getState().app.actions.findIndex(s => s.id === stepId);
  if (index < 0) return false;
  cmds.editMany({ index, id: stepId, edits });
  return true;
}

/** The list takes the focus back (Esc in the Inspector, D12; Close editor). */
export function focusList() {
  document.querySelector<HTMLElement>('.steps-body')?.focus({ preventScroll: true });
}

// Enter on a step, or Edit in its menu, asks for the Inspector's first field. The editors take the
// ask when they draw the step (a new selection, or the chunk arriving); when nothing redraws, the
// next frame does.
let focusAsked = false;
export function focusInspector() {
  focusAsked = true;
  requestAnimationFrame(takeFocusAsk);
}
/** Gives the asked-for focus to the first field, once there is one. */
export function takeFocusAsk() {
  if (!focusAsked) return;
  const first = firstField();
  if (!first) return;
  focusAsked = false;
  first.focus();
}
const firstField = () => document.querySelector<HTMLElement>(
  '.insp-body input:not(:disabled), .insp-body button:not(:disabled), .insp-body [tabindex="0"]',
);
