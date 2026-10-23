import type { ActionItem } from '../../bridge/messageTypes';

/**
 * The blocks of a step list — If…End If and the loops — as the list draws them, in one O(n) walk
 * with a typed stack: an End If only closes an If and an End Loop only a loop, so a crossed,
 * hand-edited pair cannot mis-nest. Pure, and in primitives per row (numbers, strings, flags), so a
 * row whose block facts did not change keeps equal props and is not redrawn.
 */
export interface RowBlock {
  /** Nesting level: a top-level If is 0 and its body 1. */
  depth: number;
  /** What the row is to its block: the opener, the closer, an arm (Else If, Else), or a body row (null). */
  kind: 'opener' | 'closer' | 'arm' | null;
  /** The opener of the block the row belongs to — its own for a marker — or null outside every block. */
  owner: number | null;
  /** The opener whose rail each rail of this row draws, left to right, comma-joined ("3,7"). */
  rails: string;
  /** A marker with nothing to pair with: an orphan Else, End If or End Loop, or an opener never closed. */
  broken: boolean;
}

/** The "+ Add Else" row a block shows before the row its chain ends at (its Else, else its End If). */
export interface GhostRow {
  opener: number;
  depth: number;
  rails: string;
  /** No Else yet: the terminal Else can still be added. */
  canElse: boolean;
}

export interface BlockMap {
  rows: RowBlock[];
  /** Opener index → closer index, for the blocks that close. */
  closerOf: Map<number, number>;
  /** Row index → the ghost row drawn just before it. */
  ghostBefore: Map<number, GhostRow>;
}

export function blockMap(steps: ActionItem[]): BlockMap {
  const n = steps.length;
  const rows = new Array<RowBlock>(n);
  const closerOf = new Map<number, number>();
  const elseOf = new Map<number, number>();
  const stack: { kind: 'If' | 'Loop'; idx: number }[] = [];
  const open = () => stack.map(s => s.idx).join(',');
  const join = (a: string, b: number) => (a ? `${a},${b}` : String(b));

  for (let i = 0; i < n; i++) {
    const t = steps[i].actionType;
    const top = stack[stack.length - 1];
    if (t === 'If' || t === 'While' || t === 'ForEachRow') {
      const rails = join(open(), i);
      stack.push({ kind: t === 'If' ? 'If' : 'Loop', idx: i });
      rows[i] = { depth: stack.length - 1, kind: 'opener', owner: i, rails, broken: false };
    } else if (t === 'ElseIf' || t === 'Else') {
      // An arm PEEKS: it sits at its block's own depth and changes no rail.
      if (top?.kind === 'If') {
        if (t === 'Else') elseOf.set(top.idx, i);
        rows[i] = { depth: stack.length - 1, kind: 'arm', owner: top.idx, rails: open(), broken: false };
      } else {
        rows[i] = { depth: 0, kind: 'arm', owner: null, rails: String(i), broken: true };
      }
    } else if (t === 'EndIf' || t === 'EndLoop') {
      if (top && top.kind === (t === 'EndIf' ? 'If' : 'Loop')) {
        rows[i] = { depth: stack.length - 1, kind: 'closer', owner: top.idx, rails: open(), broken: false };
        closerOf.set(top.idx, i);
        stack.pop();
      } else {
        rows[i] = { depth: 0, kind: 'closer', owner: null, rails: String(i), broken: true };
      }
    } else {
      rows[i] = { depth: stack.length, kind: null, owner: top?.idx ?? null, rails: open(), broken: false };
    }
  }
  // An opener the walk never closed.
  for (const s of stack) rows[s.idx] = { ...rows[s.idx], broken: true };

  // "+ Add Else" sits where a new arm would land: before the terminal Else, else before the End If.
  const ghostBefore = new Map<number, GhostRow>();
  for (const [opener, closer] of closerOf) {
    if (steps[opener].actionType !== 'If') continue;
    const anchor = elseOf.get(opener) ?? closer;
    ghostBefore.set(anchor, {
      opener,
      depth: rows[opener].depth,
      rails: rows[anchor].rails,
      canElse: !elseOf.has(opener),
    });
  }
  return { rows, closerOf, ghostBefore };
}

/** The number of rails a row draws: one per enclosing block, and a marker's own on top. */
export const railCount = (b: RowBlock) => (b.kind ? b.depth + 1 : b.depth);

/** How far the step's pill sits from the cell's edge: past its rails, or flush outside every block. */
export const indentRem = (b: RowBlock) => (railCount(b) > 0 ? b.depth * 0.875 + 0.5 : 0);

// Level 0 takes the theme's If colour; deeper levels cycle four block colours, so a nested block
// reads apart from its parent (lista-012). Theme tokens only.
const LEVEL_COLORS = [
  'var(--color-action-if-fg)',
  'var(--color-block-1)',
  'var(--color-block-2)',
  'var(--color-block-3)',
  'var(--color-block-4)',
];
export const blockColor = (level: number) => LEVEL_COLORS[((level % 5) + 5) % 5];
