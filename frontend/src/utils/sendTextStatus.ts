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

export function pickStatusNote(
  { sendMode, sendMethod, hasFormatting, tokenCount, richWillDegrade }: StatusInputs,
  tt: (en: string, ptBr: string) => string,
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
      text: 'Formatting will be dropped at replay',
      tip: tt(
        'Rich needs ONE run of text. A key or delay token with text on both sides splits it, so this pastes as plain. Move the token to an end, split the action, or use Markdown/Discord.',
        'Rich precisa de UM bloco de texto. Um token de tecla ou delay com texto dos dois lados divide o bloco, e a ação cola como texto puro. Mova o token para uma ponta, divida a ação ou use Markdown/Discord.',
      ),
    };
  }

  // RUNG 2 — the other way Rich fails to arrive, and the CERTAIN one. Typing has no clipboard, so
  // the HTML flavor is never built at all (ResolveSendTextDelivery nulls it structurally). Unlike
  // rung 1 this is not a prediction about the payload, it is a fact about the transport — which is
  // also why it can never contend with rung 1: that one is gated on 'paste'.
  if (sendMethod === 'type' && sendMode === 'rich' && hasFormatting) {
    return {
      tone: 'warn',
      text: 'Typing sends no formatting',
      tip: tt(
        'Type has no clipboard, so HTML formatting is never sent. It returns with Paste; Markdown/Discord keep their marks while typing.',
        'Type não usa a área de transferência, então a formatação HTML nunca é enviada. Ela volta com Paste; Markdown/Discord mantêm as marcas ao digitar.',
      ),
    };
  }

  // RUNG 3 — Plain nulls sendHtml (ActionExecution.cs:3608), so authored bold reaches the target
  // as nothing. Only fires when there IS formatting to drop: Plain on an unformatted document is
  // not a warning, it is just Plain. Markdown/Discord are NOT here — they drop the HTML too, but
  // they still carry the formatting, as literal *bold* markers baked into the text.
  if (sendMode === 'plain' && hasFormatting) {
    return {
      tone: 'warn',
      text: 'Plain delivery — formatting is kept, but not sent',
      // The REMEDY is method-dependent even though the diagnosis is not: under Type, "switch to
      // Rich" is advice that delivers nothing (rung 2 is the proof — typing has no clipboard, so
      // there is no HTML flavor to attach). Rungs 1 and 2 got their method leg with the transport
      // axis; this one is the third, and it needs it here rather than as a fourth rung because the
      // CONDITION is genuinely method-independent — only the way out changes.
      tip: sendMethod === 'type'
        ? tt(
          'Kept with the action, not sent while Plain. This action types, so use Markdown or Discord — Rich cannot be typed.',
          'Fica salva na ação, não é enviada em Plain. Esta ação digita, então use Markdown ou Discord — Rich não se digita.',
        )
        : tt(
          'Kept with the action, not sent while Plain. Switch to Rich, Markdown or Discord to send it.',
          'Fica salva na ação, não é enviada em Plain. Troque para Rich, Markdown ou Discord para enviar.',
        ),
    };
  }

  // RUNG 4 — the old permanent hint, now earned.
  if (tokenCount > 0) {
    return {
      tone: 'muted',
      text: 'Click any chip in the editor to edit its parameters',
    };
  }

  return null;
}
