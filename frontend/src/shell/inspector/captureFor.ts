import { createContext, useContext } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { stepName } from '../list/stepTypes';
import { CHECKS } from './checks';
import { useCheckTarget } from './checkTarget';

/**
 * What a capture on the screen is for, as its bar says it (ScreenCapture board: "Pick the point ·
 * for step 7, Left Click", "Pick the color · for step 11, While · Pixel color"). The engine only
 * knows types, so the page names it and sends it as the request's captureFor.
 */
export function captureForStep(index: number, step: ActionItem): string {
  const check = step.conditionType && !step.actionType.startsWith('Wait')
    ? CHECKS.find(c => c.type === step.conditionType)?.name
    : undefined;
  return `for step ${index + 1}, ${stepName(step.actionType)}${check ? ` · ${check}` : ''}`;
}

/** The step the Inspector shows, said once by the Inspector for every tool inside it. */
export const CaptureForContext = createContext<string | undefined>(undefined);

/** "for step 7, Left Click" inside the Inspector; "for the Trade Roblox automation" in an automation's check. */
export function useCaptureFor(): string | undefined {
  const target = useCheckTarget();
  const step = useContext(CaptureForContext);
  return target ? target.captureFor : step;
}
