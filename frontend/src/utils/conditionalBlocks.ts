import type { ActionItem } from '../bridge/messageTypes';

// Structural OPENER/CLOSER markers of the two block families. Kept local to this pure
// module so it has no React/component dependency. BreakLoop/ContinueLoop are deliberately
// NOT here: they are ordinary single rows INSIDE a block — selecting one must not drag the
// whole loop along, and deleting one is a granular edit.
const STRUCTURAL = new Set(['If', 'ElseIf', 'Else', 'EndIf', 'While', 'ForEachRow', 'EndLoop']);

// Stack-built map of each opener row → its matching closer row, across BOTH families with a
// TYPED stack: EndIf only closes an If, EndLoop only closes a While/ForEachRow — the kind
// check is what keeps a crossed hand-edited pair ("If, While, EndIf, EndLoop") from pairing
// an If with a loop closer. Mirrors the engine's BuildBlockMap (ActionExecution.cs) and the
// grid's blockInfo; an orphan/crossed closer simply gets no entry.
function buildCloserOf(actions: ActionItem[]): Map<number, number> {
  const closerOf = new Map<number, number>();
  const stack: { kind: 'If' | 'Loop'; idx: number }[] = [];
  for (let i = 0; i < actions.length; i++) {
    const t = actions[i]?.actionType;
    if (t === 'If') stack.push({ kind: 'If', idx: i });
    else if (t === 'While' || t === 'ForEachRow') stack.push({ kind: 'Loop', idx: i });
    else if (t === 'EndIf') {
      if (stack.length > 0 && stack[stack.length - 1].kind === 'If') closerOf.set(stack.pop()!.idx, i);
    } else if (t === 'EndLoop') {
      if (stack.length > 0 && stack[stack.length - 1].kind === 'Loop') closerOf.set(stack.pop()!.idx, i);
    }
  }
  return closerOf;
}

/**
 * Which rows the engine will NOT execute: the ones marked Skip, plus everything inside a block
 * whose OPENER is marked Skip — for all three opener families, because If, While and ForEachRow
 * all jump `i` past their closer when skipped (ActionExecution.cs).
 *
 * Transitive on purpose. The grid's own `isInSkippedBlock` reads only the innermost opener, so an
 * enabled If nested inside a disabled If came out as "not skipped" while the engine elided the
 * whole outer block. That made the status bar's duration estimate charge for delays nobody pays,
 * and left the nested rows painted as if they would run.
 */
export function skippedRowMask(actions: ActionItem[]): boolean[] {
  const mask = new Array<boolean>(actions.length).fill(false);
  const closerOf = buildCloserOf(actions);
  // `until` is the end of the outermost skipped block still open; anything before it is elided
  // regardless of how deeply it nests, which is what makes the walk transitive in one pass.
  let until = -1;
  for (let i = 0; i < actions.length; i++) {
    if (i > until) until = -1;
    const a = actions[i];
    const skippedHere = until >= 0 || !!a?.isSkipped;
    mask[i] = skippedHere;
    if (until < 0 && a?.isSkipped) {
      const closer = closerOf.get(i);
      if (closer !== undefined) until = closer;   // the block's rows, closer included
    }
  }
  return mask;
}

// Block-snap a selection: if it TOUCHES a structural marker, expand every selected index
// to the INNERMOST block span that encloses it, so a marker can never be operated on as a
// half-block and orphaned. A PURE body-row selection is returned untouched (referentially
// identical), so deleting/moving plain actions stays granular.
//
// INNERMOST, not "every enclosing span" — that was the original rule and it was wrong in exactly
// the case nesting exists for. Selecting the inner `If` of [If][If][ElseIf][EndIf][EndIf] returned
// all five rows, so deleting/duplicating/dragging an inner block took the outer one with it. The
// inner span is balanced on its own: removing or moving [1..3] leaves the outer If…EndIf intact,
// which is precisely why the grid's lone-opener path (ActionTable.handleDuplicate) has always used
// `closerOf.get(opener)` — its own closer, never the enclosing one. This makes the shared rule
// agree with it. The spans are properly nested by construction (the stack walk in buildCloserOf
// only pairs a closer with the top of the stack), so among the spans containing an index the one
// with the GREATEST opener is the smallest — no width comparison needed.
//
// This is the single source of truth for the "only snap when a marker is involved" rule shared
// by the grid (ActionTable: delete / drag / bulk Move / duplicate) and the global Alt+↑/↓ reorder
// handler (Toolbar), which has no access to the grid's memoised blockInfo. Pure + cheap (one O(n)
// stack walk per call, only on user-initiated mutations). Returns a sorted-ascending array when it
// expands, otherwise the original array.
export function snapIndicesToBlocks(indices: number[], actions: ActionItem[]): number[] {
  if (!indices.some((i) => STRUCTURAL.has(actions[i]?.actionType ?? ''))) return indices;
  const set = new Set(indices);
  const closerOf = buildCloserOf(actions);
  for (const sel of indices) {
    let bestOpen = -1;
    let bestClose = -1;
    for (const [openIdx, closeIdx] of closerOf) {
      if (openIdx <= sel && sel <= closeIdx && openIdx > bestOpen) {
        bestOpen = openIdx;
        bestClose = closeIdx;
      }
    }
    if (bestOpen >= 0) for (let i = bestOpen; i <= bestClose; i++) set.add(i);
  }
  return Array.from(set).sort((a, b) => a - b);
}

// Loop nesting depth at an INSERT position (the row would land before actions[insertIndex]).
// While/ForEachRow push, EndLoop pops, floor 0 (orphan closers in a hand-edited list must
// not drive the count negative). The Toolbar's Break/Next items gate on this — grey with a
// tooltip when 0, never hidden.
export function loopDepthAt(actions: ActionItem[], insertIndex: number): number {
  let depth = 0;
  const upTo = Math.min(Math.max(0, insertIndex), actions.length);
  for (let i = 0; i < upTo; i++) {
    const t = actions[i]?.actionType;
    if (t === 'While' || t === 'ForEachRow') depth++;
    else if (t === 'EndLoop') depth = Math.max(0, depth - 1);
  }
  return depth;
}

// ── Condition-bearing rows ───────────────────────────────────────────────────
// TS twin of ActionItem.CarriesConditionProbe (Source/ActionItem.cs). A row whose
// CONDITION owns probe data — image/pixel/window/clipboard/variable/… — as opposed to a
// pure structural marker. Extracted because the disjunction used to be written INLINE in a
// dozen places across four files: adding a third keyword to a dozen loose `===` chains is
// exactly how the C# side once shipped "the 8 image sites were really 12". Ask this, never
// `=== 'If'`, or the new keyword silently loses its probe rendering / image lifecycle.
export function carriesConditionProbe(actionType: string | null | undefined): boolean {
  return actionType === 'If' || actionType === 'ElseIf' || actionType === 'While';
}

// The wider family: every row the Sheet renders a CONDITION EDITOR for. Assert joins the
// probe openers here — it checks state the same way — but it is NOT a block row and never
// gets the On-Probe-Error policy, which is why this is a separate predicate rather than one
// widened set. Mirrors SheetPanel's `hasCondition`, whose three copies must stay in lockstep.
export function hasConditionFields(actionType: string | null | undefined): boolean {
  return carriesConditionProbe(actionType) || actionType === 'Assert';
}
