/**
 * Where a new step goes: before the first selected step, or at the end when nothing is selected.
 * The selection keeps its index, so it lands on the new step. Recording, the toolbar's inserts and
 * the command palette's paste all start there.
 */
export function insertIndexAtSelection(selection: ReadonlySet<number>, stepCount: number): number {
  return selection.size > 0 ? Math.min(...selection) : stepCount;
}
