import type { useSteps } from '../../logic/useSteps';
import { drafts, loadBrowserEditors, loadInspectorBody, loadProbeEditors, loadSendTextEditor, loadSimpleEditors, loadWindowEditors } from '../inspector/inspectorState';
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

/** A step the engine makes as it is, opened in the Inspector when it lands (its editor on the way). */
const plain = (actionType: string, editors?: () => Promise<unknown>): Insert =>
  (cmds, at) => {
    cmds.insertAction({ actionType, insertIndex: at });
    void preload(loadInspectorBody);
    if (editors) void preload(editors);
  };

/** A browser step, born empty — no selector, no address — and filled in the Inspector. */
const browser = (actionType: string): Insert =>
  (cmds, at) => {
    cmds.addBrowserAction({ actionType, selector: '', insertIndex: at });
    void preload(loadInspectorBody);
    void preload(loadBrowserEditors);
  };

/**
 * The inserts, shared by the insert row's buttons and the Add step catalog. A Click is born at the
 * cursor and a Pause waits 1 s, the old Pause dialog's default; the Inspector then picks the point
 * and the key. The three waits are the engine's capture-first inserts: the step lands only once the
 * image is captured, the pixel picked or the region drawn (and read: a Wait Text is born with the
 * text it read). The engine keeps no Key without its key, no Text without text and no If, While or
 * Assert without its check, so those open in the Inspector first — listening for the key, with the
 * text editor, with the Check list — and are born from there; a Wait until is an Assert born
 * waiting 10 s and stopping quietly, and a Run Macro is born with the macro picked there. A Scroll
 * is born turning down, and the Inspector turns it; the loop jumps and the two endings have nothing
 * to set; a Set Variable, a Copy to Slot, an Activate Window and the browser steps are born empty
 * and filled in the Inspector.
 */
export const inserts = {
  click: ((cmds, at) => cmds.insertClick({ actionType: 'LeftClick', atCursor: true, insertIndex: at })) as Insert,
  key: draft((at, macro) => ({ kind: 'key', at, macro })),
  text: draft((at, macro) => ({ kind: 'text', at, macro }), loadSendTextEditor),
  scroll: plain('ScrollDown', loadSimpleEditors),
  pause: ((cmds, at) => cmds.insertPause({ key: '', timeoutMs: 1000, insertIndex: at })) as Insert,
  waitImage: plain('WaitImage', loadProbeEditors),
  waitPixel: ((cmds, at) => { cmds.insertWaitPixelColor({ insertIndex: at }); void preload(loadInspectorBody); void preload(loadProbeEditors); }) as Insert,
  waitText: plain('WaitText', loadProbeEditors),
  waitUntil: draft((at, macro) => ({ kind: 'check', opener: 'WaitUntil', at, macro }), loadProbeEditors),
  if: draft((at, macro) => ({ kind: 'check', opener: 'If', at, macro }), loadProbeEditors),
  while: draft((at, macro) => ({ kind: 'check', opener: 'While', at, macro }), loadProbeEditors),
  assert: draft((at, macro) => ({ kind: 'check', opener: 'Assert', at, macro }), loadProbeEditors),
  forEachRow: ((cmds, at) => { cmds.insertLoop({ kind: 'ForEachRow', insertIndex: at }); void preload(loadInspectorBody); }) as Insert,
  breakLoop: plain('BreakLoop'),
  nextIteration: plain('ContinueLoop'),
  stop: plain('Stop'),
  return: plain('Return'),
  setVariable: plain('SetVariable', loadSimpleEditors),
  copyToSlot: plain('CopyToSlot', loadSimpleEditors),
  activateWindow: plain('ActivateWindow', loadWindowEditors),
  runMacro: draft((at, macro) => ({ kind: 'macro', at, macro }), loadWindowEditors),
  openUrl: browser('BrowserNavigate'),
  clickElement: browser('BrowserClick'),
  rightClickElement: browser('BrowserRightClick'),
  typeText: browser('BrowserType'),
  selectOption: browser('BrowserSelectOption'),
  waitElement: browser('BrowserWaitElement'),
  assertElement: browser('BrowserAssert'),
};

/** Sends an insert at the insertion point, and has the list select the step when it lands. */
export function insertHere(insert: Insert, cmds: StepCommands) {
  const { actions, activeProfile } = useShell.getState().app;
  const at = insertPoint(actions);
  arrival.expect(at, activeProfile);
  insert(cmds, at);
}
