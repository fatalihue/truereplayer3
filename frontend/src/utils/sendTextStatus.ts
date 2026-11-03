// The Insert Text status strip's RIGHT slot is one line and one message. This is the ladder
// that picks it: FIRST MATCH WINS, top to bottom.
//
// The THREE warning rungs are PAIRWISE DISJOINT by construction, now on two axes: rungs 1 and 2
// both fire only on 'rich' and split on the METHOD (paste vs type); rung 3 is the only 'plain'
// rung. So they can never contend for the slot and no tie-break is needed. A future rung that is
// disjoint from neither axis goes below every warning and above the hint, and this comment gets
// the new rule.
//
// The neutral chip hint is LAST and gated on tokenCount: it used to preach "click any chip" at a
// document with no chips in it, which is where the slot's whole width was going.
//
// Pure and React-free on purpose: the ladder is the part worth testing head-lessly, and a
// component import would drag JSX into a node harness.

import { fmtNum, t } from '../i18n';
import type { SendMode, SendMethod } from './sendTextTypes';

// Re-exported so the modules that already import SendMode from here keep working.
export type { SendMode } from './sendTextTypes';
export type StatusTone = 'warn' | 'muted';

export interface StatusNote {
  /** One line. Never interpolate the user's text into it (common/FieldError's rule). */
  text: string;
  /** Untruncated / extra detail for the portal tooltip. */
  tip?: string;
  tone: StatusTone;
}

// The WHY sentences, shared by the ladder's tooltips and by the Preview tab's Delivery block, where
// they are visible text. One key each in the catalog (i18n/<language>/list.ts, sendText), on purpose:
// the hint sweep of 2026-09-05 made these the canonical sentences, and a second spelling in the
// Preview tab is exactly how two surfaces drift.
const whyRichSplits = () => t('list.sendText.whyRichSplits');
const whyTypeDropsRich = () => t('list.sendText.whyTypeDropsRich');
const whyPlainUnderType = () => t('list.sendText.whyPlainUnderType');
const whyPlainUnderPaste = () => t('list.sendText.whyPlainUnderPaste');

export interface StatusInputs {
  sendMode: SendMode;
  /** Delivery METHOD. Orthogonal to sendMode — see utils/sendTextTypes. */
  sendMethod: SendMethod;
  /** $hasDeliberateFormatting() of the LIVE document, pushed up by the editor. */
  hasFormatting: boolean;
  tokenCount: number;
  /**
   * The ==1 predicate says this payload splits — see richFlavorSurvives in
   * lexical/tokenNormalize.ts. Computed by the caller so this module stays free of the
   * token grammar. NOT method-gated: rung 1 applies the method gate, so this input keeps
   * exactly one meaning.
   */
  richWillDegrade: boolean;
}

// The text comes from the catalog.
export function pickStatusNote(
  { sendMode, sendMethod, hasFormatting, tokenCount, richWillDegrade }: StatusInputs,
): StatusNote | null {
  // RUNG 1 — the silent one. The engine attaches the HTML flavor only when the resolved payload
  // is EXACTLY ONE text run (ActionExecution.cs:7163), so a key or delay token with text on both
  // sides makes a Rich action paste plain with nothing on screen saying so. Highest rung because
  // it is the only message here the user cannot deduce from the controls in front of them.
  // The 'paste' leg is not decoration: without it this rung actively LIES under Type — "move the
  // key token to the start or the end" restores nothing when there is no clipboard. Rung 2 owns
  // that case, which is also why the two can never contend.
  if (richWillDegrade && sendMethod === 'paste') {
    return {
      tone: 'warn',
      text: t('list.sendText.richDropped'),
      tip: whyRichSplits(),
    };
  }

  // RUNG 2 — the other way Rich fails to arrive, and the CERTAIN one. Typing has no clipboard, so
  // the HTML flavor is never built at all (ResolveSendTextDelivery nulls it structurally). Unlike
  // rung 1 this is not a prediction about the payload, it is a fact about the transport — which is
  // also why it can never contend with rung 1: that one is gated on 'paste'.
  if (sendMethod === 'type' && sendMode === 'rich' && hasFormatting) {
    return {
      tone: 'warn',
      text: t('list.sendText.typingNoFormatting'),
      tip: whyTypeDropsRich(),
    };
  }

  // RUNG 3 — Plain nulls sendHtml (ActionExecution.cs:3608), so authored bold reaches the target
  // as nothing. Only fires when there IS formatting to drop: Plain on an unformatted document is
  // not a warning, it is just Plain. Markdown/Discord are NOT here — they drop the HTML too, but
  // they still carry the formatting, as literal *bold* markers baked into the text.
  if (sendMode === 'plain' && hasFormatting) {
    return {
      tone: 'warn',
      text: t('list.sendText.plainKept'),
      // The REMEDY is method-dependent even though the diagnosis is not: under Type, "switch to
      // Rich" is advice that delivers nothing (rung 2 is the proof — typing has no clipboard, so
      // there is no HTML flavor to attach). Rungs 1 and 2 got their method leg with the transport
      // axis; this one is the third, and it needs it here rather than as a fourth rung because the
      // CONDITION is genuinely method-independent — only the way out changes.
      tip: sendMethod === 'type' ? whyPlainUnderType() : whyPlainUnderPaste(),
    };
  }

  // RUNG 4 — the old permanent hint, now earned.
  if (tokenCount > 0) {
    return {
      tone: 'muted',
      text: t('list.sendText.chipHint'),
    };
  }

  return null;
}

// ── The Preview tab's "Delivery" block ──────────────────────────────────────────────────────
// Same inputs as the ladder plus the per-character pause, the same rungs in the same order, a
// different job: the status strip has ONE line and speaks only when something is wrong; the
// Preview tab has the room to say what will happen either way — transport, flavor, what becomes
// of the formatting and WHY. The verdict/why pairs reuse the ladder's sentences so the two
// surfaces cannot disagree about the same payload.

export interface DeliveryInputs extends StatusInputs {
  /** Per-character pause under Type; null/0 = unpaced. Ignored under Paste. */
  charDelayMs: number | null;
}

export interface DeliveryFacts {
  transport: string;
  flavor: string;
  /** `tone: 'warn'` mirrors a warning rung of the ladder; `why` is that rung's sentence. */
  formatting: { verdict: string; why: string | null; tone: 'ok' | 'warn' | 'muted' };
}

export function describeDelivery({ sendMode, sendMethod, hasFormatting, richWillDegrade, charDelayMs }: DeliveryInputs): DeliveryFacts {
  const transport = sendMethod === 'type'
    ? (charDelayMs ? t('list.sendText.typedPaced', { ms: fmtNum(charDelayMs) }) : t('list.sendText.typedUnpaced'))
    : t('list.sendText.pasted');
  const flavor = sendMode === 'rich' ? t('list.sendText.flavorRich')
    : sendMode === 'markdown' ? t('list.sendText.flavorMarkdown')
    : sendMode === 'discord' ? t('list.sendText.flavorDiscord')
    : t('list.sendText.flavorPlain');
  let formatting: DeliveryFacts['formatting'];
  if (!hasFormatting) {
    formatting = { verdict: t('list.sendText.noneInText'), why: null, tone: 'muted' };
  } else if (richWillDegrade && sendMethod === 'paste') {
    formatting = { verdict: t('list.sendText.droppedAtReplay'), why: whyRichSplits(), tone: 'warn' };   // rung 1
  } else if (sendMethod === 'type' && sendMode === 'rich') {
    formatting = { verdict: t('list.sendText.notSent'), why: whyTypeDropsRich(), tone: 'warn' };        // rung 2
  } else if (sendMode === 'plain') {
    formatting = { verdict: t('list.sendText.keptNotSent'), why: sendMethod === 'type' ? whyPlainUnderType() : whyPlainUnderPaste(), tone: 'warn' };   // rung 3
  } else if (sendMode === 'rich') {
    formatting = { verdict: t('list.sendText.sentAsHtml'), why: null, tone: 'ok' };
  } else {
    formatting = { verdict: t('list.sendText.sentAsMarks'), why: null, tone: 'ok' };
  }
  return { transport, flavor, formatting };
}
