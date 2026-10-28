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
/** The Send Text editor brings the rich editor (Lexical) along: a chunk of its own, loaded for a
 *  Send Text step or a Text being made, never for opening the app or for the first step clicked. */
export const loadSendTextEditor = () => import('./SendTextEditor');
/** …and the editors of the steps that probe (the waits, If, Else If, While, Assert), likewise. */
export const loadProbeEditors = () => import('./probeEditors');
/** …and the simple steps' (Scroll, Set Variable, Copy to Slot), likewise. */
export const loadSimpleEditors = () => import('./simpleEditors');
/** …and the windows' and macros' (Activate Window, Run Macro and the macro it runs), likewise. */
export const loadWindowEditors = () => import('./windowEditors');
/** …and the browser steps' (Open URL and the six that act on an element), likewise. */
export const loadBrowserEditors = () => import('./browserEditors');
/** The macro's own settings, shown with no step chosen: the page's first idle moment once the app's
 *  state is drawn, as the status bar's switches (never ahead of the library). */
export const loadMacroSettings = () => import('./macro/MacroSettings');

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
 * A step being made in the Inspector before it exists, at the insertion point it was asked for
 * (`at`, in `macro`). The engine keeps no Keystroke without its key and no Send Text without text,
 * so a Key is born when the key arrives and a Text with its first text; an If, a While, an Else If,
 * an Assert or a Wait until waits for its check (the Check list), and a Run Macro for the macro it
 * runs. Esc, the × and selecting another step leave nothing.
 *
 * A Text goes on being edited where it was typed: once born, the step it became is adopted, and
 * the same editor keeps the caret until the selection leaves it.
 */
export type Draft = { serial: number } & (
  | { kind: 'key'; at: number; macro: string | null }
  | { kind: 'text'; at: number; macro: string | null; born?: boolean; stepId?: string }
  | { kind: 'check'; opener: CheckOpener; at: number; macro: string | null; ifRowIndex?: number }
  | { kind: 'macro'; at: number; macro: string | null });
export type CheckOpener = 'If' | 'While' | 'ElseIf' | 'Assert' | 'WaitUntil';
export type TextDraft = Extract<Draft, { kind: 'text' }>;
type NewDraft = Draft extends infer D ? D extends Draft ? Omit<D, 'serial'> : never : never;
export const useDraft = create<{ draft: Draft | null }>(() => ({ draft: null }));
// Each draft is a new one, even at the same point: its editor starts empty.
let serial = 0;
export const drafts = {
  start: (draft: NewDraft) => useDraft.setState({ draft: { ...draft, serial: ++serial } as Draft }),
  end: () => { if (useDraft.getState().draft) useDraft.setState({ draft: null }); },
  /** The Text was sent to the engine; the step it becomes has not arrived yet. */
  born: () => {
    const { draft } = useDraft.getState();
    if (draft?.kind === 'text' && !draft.born) useDraft.setState({ draft: { ...draft, born: true } });
  },
  /** …and this is it. */
  adopt: (stepId: string | undefined) => {
    const { draft } = useDraft.getState();
    if (draft?.kind === 'text' && draft.born && !draft.stepId && stepId) useDraft.setState({ draft: { ...draft, stepId } });
  },
};

export type StepEdit = { field: string; value: string };

/** The step of today's duration spinners (a hold): 1 s from 1 s up, 100 ms below it. */
export const durationStep = (ms: number, dir: 1 | -1) => ((dir > 0 ? ms : ms - 1) >= 1000 ? 1000 : 100);

/** When an edit last went to the engine: a test that acts for real waits for its echo (the field
 *  left by the press on the test's own button sends just before it). */
export const lastEdit = { at: 0 };

/**
 * Sends edits to one step, found by its id now: it may have moved since the typing began. One
 * message, one undo entry. False when the step is gone or there is nothing to send.
 */
export function applyEdits(cmds: ReturnType<typeof useSteps>, stepId: string, edits: StepEdit[]): boolean {
  if (edits.length === 0) return false;
  const index = useShell.getState().app.actions.findIndex(s => s.id === stepId);
  if (index < 0) return false;
  cmds.editMany({ index, id: stepId, edits });
  lastEdit.at = performance.now();
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
// An editor whose heart is not its first control (the Send Text's message) marks it data-autofocus.
const firstField = () => document.querySelector<HTMLElement>('.insp-body [data-autofocus] [contenteditable="true"]')
  ?? document.querySelector<HTMLElement>(
    '.insp-body input:not(:disabled), .insp-body textarea:not(:disabled), .insp-body button:not(:disabled), .insp-body [tabindex="0"]',
  );
