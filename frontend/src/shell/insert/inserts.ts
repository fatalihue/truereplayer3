import type { useSteps } from '../../logic/useSteps';
import { drafts, loadInspectorBody } from '../inspector/inspectorState';
import { preload } from '../lazyModule';
import { arrival, insertPoint } from '../list/selection';
import { useShell } from '../store';

export type StepCommands = ReturnType<typeof useSteps>;
export type Insert = (cmds: StepCommands, at: number) => void;

/**
 * The inserts, shared by the insert row's buttons and the Add step catalog. A Click is born at the
 * cursor and a Pause waits 1 s, the old Pause dialog's default; the Inspector then picks the point
 * and the key. Wait Image is the engine's capture-first insert: the step lands only once the image
 * is captured. A Key opens in the Inspector listening for its key, and is born with it.
 */
export const inserts = {
  click: ((cmds, at) => cmds.insertClick({ actionType: 'LeftClick', atCursor: true, insertIndex: at })) as Insert,
  key: ((_cmds, at) => {
    drafts.start({ kind: 'key', at, macro: useShell.getState().app.activeProfile });
    void preload(loadInspectorBody);
  }) as Insert,
  pause: ((cmds, at) => cmds.insertPause({ key: '', timeoutMs: 1000, insertIndex: at })) as Insert,
  waitImage: ((cmds, at) => cmds.insertAction({ actionType: 'WaitImage', insertIndex: at })) as Insert,
};

/** Sends an insert at the insertion point, and has the list select the step when it lands. */
export function insertHere(insert: Insert, cmds: StepCommands) {
  const { actions, activeProfile } = useShell.getState().app;
  const at = insertPoint(actions);
  arrival.expect(at, activeProfile);
  insert(cmds, at);
}
