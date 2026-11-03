import type { ActionItem } from '../bridge/messageTypes';
import { t } from '../i18n';

// Screen text (OCR) — the frontend half of Source/ScreenTextMatcher.cs. One home for the two
// rules every surface needs to agree on: which operator a row REALLY means, and how it reads in
// the grid. Mirrors ScreenTextMatcher.EffectiveOperator / Summary; change both sides together.

export type OcrTextOp = 'contains' | 'eq' | 'regex';
export type OcrNumberOp = 'eq' | 'neq' | 'gt' | 'lt';

// Case-insensitive, as the C# IsNumberMode (OrdinalIgnoreCase) — a hand-edited "Number" reads the
// same on both sides.
export const isNumberMode = (readAs: string | null | undefined): boolean => (readAs ?? '').toLowerCase() === 'number';

/** An operator that does not fit the mode reads as the mode's default (Contains / =). */
export function effectiveOperator(op: string | null | undefined, number: boolean): string {
  const o = (op ?? '').trim().toLowerCase();
  if (number) return o === 'eq' || o === 'neq' || o === 'gt' || o === 'lt' ? o : 'eq';
  return o === 'contains' || o === 'eq' || o === 'regex' ? o : 'contains';
}

/** Grid summary: `has "Victory"`, `= "Ready"`, `regex ^Lv`, `< 30` — the C# DisplayKey's twin. */
export function screenTextSummary(a: Pick<ActionItem, 'ocrReadAs' | 'conditionOperator' | 'conditionOperand'>): string {
  const number = isNumberMode(a.ocrReadAs);
  const op = effectiveOperator(a.conditionOperator, number);
  let operand = a.conditionOperand ?? '';
  if (operand.length > 40) operand = operand.slice(0, 37) + '...';
  if (number) {
    const sym = op === 'neq' ? '≠' : op === 'gt' ? '>' : op === 'lt' ? '<' : '=';
    return operand ? `${sym} ${operand}` : '#';
  }
  if (!operand) return '';
  return op === 'eq' ? `= "${operand}"` : op === 'regex' ? t('list.details.textRegex', { text: operand }) : t('list.details.textHas', { text: operand });
}

/** True when the row reads the screen: Wait for Text, a Screen Text condition, Set Variable in Screen mode. */
export function readsScreenText(a: Pick<ActionItem, 'actionType' | 'conditionType' | 'variableMode'>): boolean {
  return a.actionType === 'WaitText'
    || a.conditionType === 'ScreenText'
    || (a.actionType === 'SetVariable' && a.variableMode === 'screen');
}

/**
 * Why a Regex operand will not compile, or null. The pattern runs in .NET, so JS is only a proxy:
 * syntax .NET accepts and JS rejects — inline options "(?i)", atomic "(?>", conditionals "(?(",
 * balancing groups "(?<a-b>", the \A \Z \z \G anchors — is let through rather than flagged
 * falsely; anything else JS refuses, .NET refuses too ("Level (\d+" with an unclosed group).
 * A pattern with a {token} is resolved at run time and is not judged here.
 */
export function regexProblem(pattern: string): string | null {
  // A token opens with a letter ({var:x}); a quantifier with a digit (\d{2}) is still judged.
  if (!pattern || /\{[A-Za-z]/.test(pattern)) return null;
  // Inline options need at least ONE flag letter: with `*`, a plain non-capturing "(?:" matched as
  // "options" and switched the check off for the whole pattern — "(?:Level (\d+)" passed unflagged.
  if (/\(\?[imnsx-]+[:)]|\(\?>|\(\?\(|\(\?<\w+-\w*>|\\[AZzG]/.test(pattern)) return null;
  try { new RegExp(pattern, 'i'); return null; }
  catch { return 'This pattern does not compile'; }
}

/** Number parse with the same separator rule as the C# matcher (used to validate the Value field). */
export function parsesAsNumber(input: string): boolean {
  let s = input.trim().replace(/ /g, '');
  if (s.startsWith('-') || s.startsWith('+')) s = s.slice(1);
  if (!s || !/^[\d.,]+$/.test(s)) return false;
  // C# decimal holds ~28 significant digits; past that TryParse fails there, so it fails here.
  if ((s.match(/\d/g) ?? []).length > 28) return false;
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both separators: the LAST is the decimal point, every copy of the other is grouping — then
    // what is left must be one plain decimal, exactly as C# TryParseNumber leaves it. "1.2,3.4"
    // and "1,2.3,4" used to pass here and throw at run time.
    const dec = lastDot > lastComma ? '.' : ',';
    const grp = dec === '.' ? ',' : '.';
    const normalized = s.split(grp).join('').replace(dec, '.');
    return /^\d*\.?\d*$/.test(normalized) && /\d/.test(normalized);
  }
  if (lastDot < 0 && lastComma < 0) return true;
  const sep = lastDot >= 0 ? '.' : ',';
  const parts = s.split(sep);
  const thousands = parts.length > 1 && parts[0].length >= 1 && parts[0].length <= 3
    && parts.slice(1).every(p => p.length === 3) && (parts.length > 2 || parts[0] !== '0');
  return thousands || (parts.length === 2 && /\d/.test(parts[0] + parts[1]));
}
