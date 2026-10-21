/**
 * Where a new step goes: before the first selected step, so the selection flows down past the new
 * ones, or at the end when nothing is selected. Recording starts there, and the toolbar's inserts
 * follow the same rule.
 */
export function insertIndexAtSelection(selection: ReadonlySet<number>, stepCount: number): number {
  return selection.size > 0 ? Math.min(...selection) : stepCount;
}
