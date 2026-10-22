import { useMemo } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { ActionItem, OutgoingMessage } from '../bridge/messageTypes';
import { armBodyEnd, snapIndicesToBlocks } from '../utils/conditionalBlocks';

type StepsType = Extract<OutgoingMessage['type'], `actions:${string}`>;
type MessageOf<T extends StepsType> = Extract<OutgoingMessage, { type: T }>;

export type DeleteMessage = MessageOf<'actions:delete' | 'actions:deleteConditional' | 'actions:deleteLoop' | 'actions:deleteElseIfArm'>;

/**
 * Which delete a selection MEANS: the message to send and how many rows it will actually take.
 * A lone If or loop opener takes its whole block; a lone Else If takes its own arm; anything else
 * snaps to whole blocks, so a selection that straddles a marker cannot orphan it.
 *
 * The Delete key, the row menu and the bulk bar all ask this, so an Else If selected on its own
 * means the same delete from each of them. `closerOf` gives the row that closes a block opener.
 */
export function deleteIntent(
  sel: number[],
  actions: ActionItem[],
  closerOf: (opener: number) => number | undefined,
): { message: DeleteMessage; count: number } {
  if (sel.length === 1) {
    const t = actions[sel[0]]?.actionType;
    if (t === 'If') {
      const end = closerOf(sel[0]);
      return {
        message: { type: 'actions:deleteConditional', payload: { ifRowIndex: sel[0] } },
        count: end != null ? end - sel[0] + 1 : 1,
      };
    }
    if (t === 'While' || t === 'ForEachRow') {
      const end = closerOf(sel[0]);
      return {
        message: { type: 'actions:deleteLoop', payload: { loopRowIndex: sel[0] } },
        count: end != null ? end - sel[0] + 1 : 1,
      };
    }
    if (t === 'ElseIf') {
      return {
        message: { type: 'actions:deleteElseIfArm', payload: { elseIfRowIndex: sel[0] } },
        count: armBodyEnd(actions, sel[0]) - sel[0] + 1,
      };
    }
  }
  const snapped = snapIndicesToBlocks(sel, actions);
  return { message: { type: 'actions:delete', payload: { indices: snapped } }, count: snapped.length };
}

/**
 * The open macro's steps, as commands: one per message, named after it, taking the message's own
 * payload. The engine owns the list — it answers every change with actions:updated, and every
 * change is one undo entry.
 */
export function useSteps() {
  const { send } = useBridge();
  return useMemo(() => {
    const cmd = <T extends StepsType>(type: T) =>
      (payload: MessageOf<T>['payload']) => send({ type, payload } as MessageOf<T>);
    return {
      // ── inserting ──
      insertAction: cmd('actions:insertAction'),
      insertClick: cmd('actions:insertClick'),
      insertKeystroke: cmd('actions:insertKeystroke'),
      insertHoldKey: cmd('actions:insertHoldKey'),
      insertPause: cmd('actions:insertPause'),
      insertWaitPixelColor: cmd('actions:insertWaitPixelColor'),
      insertConditional: cmd('actions:insertConditional'),
      insertLoop: cmd('actions:insertLoop'),
      insertAssert: cmd('actions:insertAssert'),
      addElseBranch: cmd('actions:addElseBranch'),
      addElseIfBranch: cmd('actions:addElseIfBranch'),
      addSendText: cmd('actions:addSendText'),
      addRunProfile: cmd('actions:addRunProfile'),
      addBrowserAction: cmd('actions:addBrowserAction'),
      // ── editing ──
      edit: cmd('actions:edit'),
      /** Several fields of one row in ONE message, so ONE undo entry. */
      editMany: cmd('actions:editMany'),
      editSendText: cmd('actions:editSendText'),
      editRunProfile: cmd('actions:editRunProfile'),
      replaceRange: cmd('actions:replaceRange'),
      bulkUpdateDelay: cmd('actions:bulkUpdateDelay'),
      bulkUpdateCoord: cmd('actions:bulkUpdateCoord'),
      bulkUpdateComment: cmd('actions:bulkUpdateComment'),
      bulkUpdateType: cmd('actions:bulkUpdateType'),
      toggleSkip: cmd('actions:toggleSkip'),
      toggleFocusClick: cmd('actions:toggleFocusClick'),
      resetCycle: cmd('actions:resetCycle'),
      convertMode: cmd('actions:convertMode'),
      // ── structure ──
      reorder: cmd('actions:reorder'),
      duplicate: cmd('actions:duplicate'),
      clear: cmd('actions:clear'),
      /** Sends the delete a selection means (deleteIntent). */
      removeSteps: (intent: { message: DeleteMessage }) => send(intent.message),
      /** Tells the engine which rows are selected (its Ctrl+C/V and bulk commands act on them). */
      reportSelection: (indices: number[]) => send({ type: 'selection:changed', payload: { indices } }),
      // ── clipboard and history ──
      copy: cmd('actions:copy'),
      copyInternal: cmd('actions:copyInternal'),
      paste: cmd('actions:paste'),
      undo: cmd('actions:undo'),
      redo: cmd('actions:redo'),
    };
  }, [send]);
}
