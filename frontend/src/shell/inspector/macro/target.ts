import type { ActionItem } from '../../../bridge/messageTypes';
import { t } from '../../../i18n';
import { carriesConditionProbe } from '../../../utils/conditionalBlocks';

/** Which window: the process and/or the title, by Contains or a .NET regex. */
export interface TargetValue {
  processName: string;
  windowTitle: string;
  titleMatchMode: 'contains' | 'regex';
}

export const asMode = (mode: string | null | undefined): 'contains' | 'regex' => (mode === 'regex' ? 'regex' : 'contains');

/** A title pattern the browser can compile: a check only, since the engine compiles its own (.NET). */
export function compiles(pattern: string): boolean {
  try { new RegExp(pattern); return true; } catch { return false; }
}

/** Why these fields cannot be a target yet: neither a process nor a title, or a pattern that does not compile. */
export function targetProblem(v: TargetValue): 'empty' | 'regex' | null {
  const title = v.windowTitle.trim();
  if (!v.processName.trim() && !title) return 'empty';
  if (v.titleMatchMode === 'regex' && title && !compiles(title)) return 'regex';
  return null;
}

/** "title contains “Roblox”", "title matches “^Roblox”" or "any title" (Macro settings board). */
export function titleCondition(v: TargetValue): string {
  const title = v.windowTitle.trim();
  if (!title) return t('macroSettings.target.anyTitle');
  return v.titleMatchMode === 'regex' ? t('macroSettings.target.titleMatches', { title }) : t('macroSettings.target.titleContains', { title });
}

// The clicks whose X/Y the engine's coordinate conversion moves (HandleConvertCoordinates' clickTypes):
// a click at the cursor counts too, since its dormant point comes back with "This point".
const CLICKS = new Set([
  'LeftClickDown', 'LeftClickUp', 'RightClickDown', 'RightClickUp', 'MiddleClickDown', 'MiddleClickUp',
  'LeftClick', 'RightClick', 'MiddleClick', 'DoubleClick', 'TripleClick',
  'LeftClickHold', 'RightClickHold', 'MiddleClickHold',
]);

/**
 * How many steps a coordinate conversion would move, by the engine's rule: the clicks, a region an
 * image or the screen's text is searched in, and a pixel's point — in a step or in an If, Else If or
 * While. One rule in two places, as in today's Window target dialog: change both together.
 */
export function convertibleSteps(steps: readonly ActionItem[]): number {
  let n = 0;
  for (const a of steps) {
    if (CLICKS.has(a.actionType)) { n++; continue; }
    const probe = carriesConditionProbe(a.actionType);
    const region = a.actionType === 'WaitImage' || a.actionType === 'WaitText'
      || (a.actionType === 'SetVariable' && a.variableMode === 'screen')
      || (probe && (a.conditionType === 'ImageFound' || a.conditionType === 'ScreenText'));
    if (region && (a.waitImageSearchW ?? 0) > 0 && (a.waitImageSearchH ?? 0) > 0) { n++; continue; }
    const pixel = a.actionType === 'WaitPixelColor' || (probe && a.conditionType === 'PixelColorMatch');
    if (pixel && typeof a.pixelX === 'number' && typeof a.pixelY === 'number') n++;
  }
  return n;
}
