import type { ActionItem } from '../bridge/messageTypes';
import { NO_COORD_TYPES, formatKeyCombo } from '../utils/displayUtils';

// What a step type is called in the new shell. The interface says "macro" (decision 3), so the
// step that runs another macro is "Run Macro"; the rest keep their names, with spaces. The Add step
// catalog (slice 5 of phase 1) is where the full set of 28 types gets its names and icons.
const NAMES: Record<string, string> = {
  RunProfile: 'Run Macro',
  ForEachRow: 'For Each Data Row',
};

export function stepName(actionType: string): string {
  return NAMES[actionType] ?? actionType.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** The one-line "what" of a step in the list: the key, the text, the macro it runs, or the point. */
export function stepSummary(step: ActionItem): string {
  const type = step.actionType;
  if (type === 'Keystroke' || type === 'KeyDown' || type === 'KeyUp' || type === 'HoldKey') return formatKeyCombo(step.key);
  if (NO_COORD_TYPES.has(type)) return oneLine(step.key);
  return `${step.x}, ${step.y}`;
}

function oneLine(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}
