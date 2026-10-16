import type { ActionItem } from '../../bridge/messageTypes';
import { hasConditionFields } from '../../utils/conditionalBlocks';
import { effectiveOperator, isNumberMode } from '../../utils/screenText';
import type { OcrRegion } from './ScreenTextFields';

// The Sheet's screen-text (OCR) persistence in ONE pure function, called by BOTH handleSave (send
// every edit) and hasFieldEdits (any edit at all?). The dirty-Esc guard has to mirror the save
// field for field or a stray Esc silently drops an edit — computing both from the same list makes
// that parity true by construction for everything this family owns.

export interface OcrEditState {
  actionType: string;
  variableMode: string;
  region: OcrRegion;
  readAs: 'text' | 'number';
  textOp: 'contains' | 'eq' | 'regex';
  numberOp: 'eq' | 'neq' | 'gt' | 'lt';
  operand: string;
  textColor: string;
  tolerance: string;
  timeout: string;
  defaultTimeoutMs: number;
  onTimeout: string;
  clickOnMatch: boolean;
  waitMode: string;
  conditionTimeout: string;
}

export const OCR_DEFAULT_TOLERANCE = 70;

const normHex = (s: string | null | undefined): string => {
  const t = (s ?? '').trim();
  if (!/^#?[0-9A-Fa-f]{6}$/.test(t)) return '';
  return ('#' + t.replace(/^#/, '')).toUpperCase();
};

export function collectOcrEdits(action: ActionItem, s: OcrEditState): { field: string; value: string }[] {
  const isWait = s.actionType === 'WaitText';
  const isCond = hasConditionFields(s.actionType) && action.conditionType === 'ScreenText';
  const isRead = s.actionType === 'SetVariable' && s.variableMode === 'screen';
  if (!isWait && !isCond && !isRead) return [];
  const out: { field: string; value: string }[] = [];
  const edit = (field: string, value: string) => out.push({ field, value });

  const currentRect = (action.waitImageSearchW && action.waitImageSearchH)
    ? `${action.waitImageSearchX || 0},${action.waitImageSearchY || 0},${action.waitImageSearchW},${action.waitImageSearchH}`
    : '';
  const newRect = s.region ? `${s.region.x},${s.region.y},${s.region.w},${s.region.h}` : '';
  if (newRect !== currentRect) edit('waitImageSearchRegion', newRect);

  const readAs = isNumberMode(s.readAs) ? 'number' : '';
  if ((isNumberMode(action.ocrReadAs) ? 'number' : '') !== readAs) edit('ocrReadAs', readAs);

  const color = normHex(s.textColor);
  if (normHex(action.ocrTextColor) !== color) edit('ocrTextColor', color);
  if (color) {
    const tol = Math.min(255, Math.max(0, Number.parseInt(s.tolerance, 10) || 0));
    if (tol !== (action.ocrColorTolerance ?? OCR_DEFAULT_TOLERANCE)) edit('ocrColorTolerance', String(tol));
  }

  if (isWait || isCond) {
    const op = isNumberMode(s.readAs) ? s.numberOp : s.textOp;
    // Against the EFFECTIVE stored operator: a row that never stored one (a Changes wait) reads
    // as the mode's default, so opening it is not an edit.
    if (effectiveOperator(action.conditionOperator, isNumberMode(s.readAs)) !== op) edit('conditionOperator', op);
    if ((action.conditionOperand ?? '') !== s.operand) edit('conditionOperand', s.operand);
  }

  if (isWait) {
    const newTimeout = Math.max(1000, Number.parseFloat(s.timeout) || s.defaultTimeoutMs);
    if (Math.round(newTimeout) !== (action.timeout || s.defaultTimeoutMs)) edit('timeout', String(Math.round(newTimeout)));
    const onTimeout = s.onTimeout === 'Continue' ? 'Continue' : '';
    if ((action.waitImageOnTimeout === 'Continue' ? 'Continue' : '') !== onTimeout) edit('waitImageOnTimeout', onTimeout);
    if (!!s.clickOnMatch !== !!action.waitImageClickOnMatch) edit('waitImageClickOnMatch', String(s.clickOnMatch));
    const wm = s.waitMode === 'disappears' || s.waitMode === 'changes' ? s.waitMode : '';
    const curWm = action.waitMode === 'disappears' || action.waitMode === 'changes' ? action.waitMode : '';
    if (wm !== curWm) edit('waitMode', wm);
  }

  if (isRead) {
    const ct = Math.max(0, Number.parseInt(s.conditionTimeout, 10) || 0);
    if (ct !== (action.conditionTimeout ?? 0)) edit('conditionTimeout', String(ct));
  }
  return out;
}
