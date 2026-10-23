import type { ActionItem } from '../../bridge/messageTypes';
import { isClickHold } from '../../utils/displayUtils';

/**
 * What each step type is called and drawn as in the new shell. Names are prose with capitals, as
 * the concept writes them ("Left Click", "End If", "Run Macro"; the interface says "macro",
 * decision 3). The Add step catalog (slice 5) takes its names and icons from here too.
 */
const NAMES: Record<string, string> = {
  RunProfile: 'Run Macro',
  ForEachRow: 'For Each Row',
  ElseIf: 'Else If',
  EndIf: 'End If',
  EndLoop: 'End Loop',
  BreakLoop: 'Break',
  ContinueLoop: 'Next',
  CopyToSlot: 'Copy to Slot',
  LeftClickHold: 'Hold Left Click',
  RightClickHold: 'Hold Right Click',
  MiddleClickHold: 'Hold Middle Click',
  BrowserClick: 'Click Element',
  BrowserRightClick: 'Right Click Element',
  BrowserType: 'Type Text',
  BrowserSelectOption: 'Select Option',
  BrowserAssert: 'Assert Element',
  BrowserWaitElement: 'Wait Element',
  BrowserNavigate: 'Open URL',
};

export function stepName(actionType: string): string {
  return NAMES[actionType] ?? actionType.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * The step's icon: a lucide icon name, drawn as a CSS mask (stepIcons.css, written by
 * tools/gen-step-icons.mjs from the same names). Else and the two closers carry none — the
 * concept draws them as bare words, the brackets of a block.
 */
export function stepIcon(actionType: string): string | null {
  switch (actionType) {
    case 'Else': case 'EndIf': case 'EndLoop': return null;
    case 'BrowserAssert': case 'Assert': return 'shield-check';
    case 'HoldKey': return 'timer';
    case 'ScrollUp': return 'arrow-up';
    case 'ScrollDown': return 'arrow-down';
    case 'SendText': return 'type';
    case 'SetVariable': return 'braces';
    case 'CopyToSlot': return 'clipboard-copy';
    case 'WaitImage': return 'scan-search';
    case 'WaitPixelColor': return 'pipette';
    case 'WaitText': return 'scan-text';
    case 'RunProfile': return 'repeat-2';
    case 'ActivateWindow': return 'app-window';
    case 'Pause': return 'hourglass';
    case 'If': return 'git-branch';
    case 'ElseIf': return 'split';
    case 'Stop': return 'circle-stop';
    case 'Return': return 'corner-down-left';
    case 'While': return 'iteration-cw';
    case 'BreakLoop': return 'arrow-right-from-line';
    case 'ContinueLoop': return 'skip-forward';
    case 'ForEachRow': return 'table-2';
  }
  if (actionType.startsWith('Browser')) return 'globe';
  if (isClickHold(actionType)) return 'timer';
  if (actionType.includes('Click')) return 'mouse';
  if (actionType.startsWith('Key')) return 'keyboard';
  return 'zap';
}

/** Jump markers with no delay of their own: the Delay cell stays empty (the engine keeps them at 0). */
export const NO_DELAY_TYPES = new Set(['Else', 'EndIf', 'EndLoop', 'BreakLoop', 'ContinueLoop', 'ForEachRow']);

/** The block markers that cannot move on their own: dragging the opener carries the block. */
export const PINNED_MARKERS = new Set(['ElseIf', 'Else', 'EndIf', 'EndLoop']);

/** The step key the list, the selection and the drag agree on: the engine's id, else the position. */
export const stepKey = (step: ActionItem, index: number): string => step.id ?? `row-${index}`;
