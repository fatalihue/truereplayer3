import type { useSteps } from '../../logic/useSteps';
import { drafts, loadInspectorBody, loadSendTextEditor } from '../inspector/inspectorState';
import { preload } from '../lazyModule';
import { arrival, insertPoint } from '../list/selection';
import { useShell } from '../store';

export type StepCommands = ReturnType<typeof useSteps>;
export type Insert = (cmds: StepCommands, at: number) => void;

/** A step made in the Inspector first: the draft opens there, with its editors on the way. */
const draft = (make: (at: number, macro: string | null) => Parameters<typeof drafts.start>[0], also?: () => Promise<unknown>): Insert =>
  (_cmds, at) => {
    drafts.start(make(at, useShell.getState().app.activeProfile));
    void preload(loadInspectorBody);
    if (also) void preload(also);
  };

/**
 * The inserts, shared by the insert row's buttons and the Add step catalog. A Click is born at the
 * cursor and a Pause waits 1 s, the old Pause dialog's default; the Inspector then picks the point
 * and the key. Wait Image is the engine's capture-first insert: the step lands only once the image
 * is captured. The engine keeps no Key without its key, no Text without text and no If or While
 * without its check, so those open in the Inspector first — listening for the key, with the text
 * editor, with the Check list — and are born from there.
 */
export const inserts = {
  click: ((cmds, at) => cmds.insertClick({ actionType: 'LeftClick', atCursor: true, insertIndex: at })) as Insert,
  key: draft((at, macro) => ({ kind: 'key', at, macro })),
  text: draft((at, macro) => ({ kind: 'text', at, macro }), loadSendTextEditor),
  pause: ((cmds, at) => cmds.insertPause({ key: '', timeoutMs: 1000, insertIndex: at })) as Insert,
  waitImage: ((cmds, at) => cmds.insertAction({ actionType: 'WaitImage', insertIndex: at })) as Insert,
  if: draft((at, macro) => ({ kind: 'check', opener: 'If', at, macro })),
  while: draft((at, macro) => ({ kind: 'check', opener: 'While', at, macro })),
};

/** Sends an insert at the insertion point, and has the list select the step when it lands. */
export function insertHere(insert: Insert, cmds: StepCommands) {
  const { actions, activeProfile } = useShell.getState().app;
  const at = insertPoint(actions);
  arrival.expect(at, activeProfile);
  insert(cmds, at);
}
