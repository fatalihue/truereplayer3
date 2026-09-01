// What the grid is allowed to SAY about a SendText row's delivery.
//
// Lives in its own module rather than beside the component that renders it: a non-component
// export from a .tsx file breaks fast refresh for that file (react-refresh/only-export-components),
// and this is pure data logic with a head-lessly testable answer — the same reason
// tokenDescriptions.ts is a .ts.
import { richFlavorSurvives } from './tokenNormalize';
import type { SendMode, SendMethod } from '../../utils/sendTextTypes';

/** Which explanation the `degraded` tint is carrying — the caller owns the copy. */
export type DeliveryBadgeTip = 'rich-split' | 'type-drops-rich';
export type DeliveryBadge = { label: 'rich' | 'md' | 'type'; degraded: boolean; tip?: DeliveryBadgeTip };

/**
 * The badge for a SendText row, or null for a row that pastes plain.
 *
 * It used to be `keyHtml && sendMode !== 'plain'` — a promise of formatting made from the mere
 * EXISTENCE of a rich flavor, with no knowledge of the rule that decides whether the engine will
 * actually attach it. A rich row whose payload is split by a key/delay token got a confident
 * "rich" badge and then pasted plain, and nothing on screen told it apart from a row that really
 * does paste formatted. `degraded` closes that: it asks the same predicate the engine's ==1 gate
 * answers (richFlavorSurvives, ported in tokenNormalize.ts).
 *
 * `degraded` changes the badge's COLOUR and gives it a tooltip; it never changes the LABEL. The
 * label states the configured delivery, which is a fact this function knows for certain, while
 * the predicate behind `degraded` reasons about the AUTHORED payload and can disagree with a
 * particular run in both directions (see that file's banner). Colouring a suspicion is honest;
 * relabelling the row 'plain' on it would be a second lie in the opposite direction.
 *
 * Markdown/Discord are never degraded: the engine sends KeyMarkdown as PLAIN text with
 * sendHtml = null, so the ==1 gate is not on their path — every segment is pasted and the marks,
 * being literal characters, ride along.
 */
export function sendTextDeliveryBadge(action: {
  key: string;
  keyHtml?: string | null;
  sendMode?: SendMode | null;
  sendMethod?: SendMethod | null;
}): DeliveryBadge | null {
  // TRANSPORT FIRST, and before the keyHtml guard: a typed row usually carries no formatting at
  // all, and the transport decides whether the text arrives AT ALL — more than this badge has ever
  // been able to say. sendMethod is a STORED FACT, the same class of certainty as
  // sendMode === 'plain', so it may LABEL; only richFlavorSurvives (a fallible predicate over the
  // authored payload) stays confined to the `degraded` channel.
  //
  // Degraded here when the row carries rich formatting typing certainly cannot deliver. Silence
  // would rebuild the exact bug `degraded` was written to close, one notch worse: certain, not
  // suspected. A typed row NEVER gets a confident 'rich' badge.
  if (action.sendMethod === 'type') {
    const richAuthored = Boolean(action.keyHtml) && (!action.sendMode || action.sendMode === 'rich');
    return { label: 'type', degraded: richAuthored, tip: richAuthored ? 'type-drops-rich' : undefined };
  }
  if (!action.keyHtml || action.sendMode === 'plain') return null;
  if (action.sendMode === 'markdown' || action.sendMode === 'discord') return { label: 'md', degraded: false };
  // 'rich', or null/undefined — and null is the PRIMARY path, not a legacy edge: NormalizeSendMode
  // in the bridge maps 'rich', empty and every unknown string to null, so that is what every rich
  // row on disk carries. The engine treats an empty mode as rich, so it must be judged by the
  // same rule rather than skipped.
  return { label: 'rich', degraded: !richFlavorSurvives(action.key), tip: 'rich-split' };
}
