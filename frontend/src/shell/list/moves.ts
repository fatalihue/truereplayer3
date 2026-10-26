import type { ActionItem } from '../../bridge/messageTypes';
import { deleteIntent, type useSteps } from '../../logic/useSteps';
import { snapIndicesToBlocks } from '../../utils/conditionalBlocks';
import type { BlockMap } from './blocks';
import { selection } from './selection';

/**
 * Moving the selected steps one place up or down — Alt+↑/↓ and the batch editor's Move up / Move
 * down: whole blocks for any marker the selection touches. The engine puts the rows back together
 * at the target, counted on the list as it is.
 */
export function moveTarget(steps: ActionItem[], sel: number[], dir: 'up' | 'down'): { indices: number[]; targetIndex: number } | null {
  if (sel.length === 0) return null;
  const rows = snapIndicesToBlocks(sel, steps);
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (dir === 'up') return first > 0 ? { indices: rows, targetIndex: first - 1 } : null;
  return last < steps.length - 1 ? { indices: rows, targetIndex: last + 2 } : null;
}

/** Sends the move; false at the edge, where there is nowhere to go. */
export function moveSteps(steps: ActionItem[], sel: number[], dir: 'up' | 'down', cmds: ReturnType<typeof useSteps>): boolean {
  const move = moveTarget(steps, sel, dir);
  if (move) cmds.reorder(move);
  return !!move;
}

/**
 * Deletes what a selection means (deleteIntent) — the Delete key, the step menu and the batch
 * editor — says so when whole blocks went with it, and clears the selection. Returns how many
 * steps went, or 0 when whole blocks went too (that was said already).
 */
export function deleteSteps(
  steps: ActionItem[],
  sel: number[],
  blocks: BlockMap,
  cmds: ReturnType<typeof useSteps>,
  tell: (text: string) => void,
  tt: (en: string, pt: string) => string,
): number {
  const intent = deleteIntent(sel, steps, (o) => blocks.closerOf.get(o));
  const wider = intent.message.type === 'actions:delete' && intent.count > sel.length;
  if (wider) {
    tell(tt(`Deleted ${intent.count} steps — the selection touched a block marker, so whole blocks went with it.`,
            `${intent.count} passos apagados — a seleção tocou um marcador de bloco, então blocos inteiros foram junto.`));
  }
  cmds.removeSteps(intent);
  selection.clear();
  return wider ? 0 : intent.count;
}
