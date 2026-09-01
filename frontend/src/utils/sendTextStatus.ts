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
      text: tt('Formatting will be dropped at replay', 'A formatação será descartada no replay'),
      tip: tt(
        'Rich formatting is attached only when the payload is ONE run of text. An {Enter}, {Tab} or {Delay:N} with text on BOTH sides splits it, so this action pastes as plain text. Fixes: move the key token to the start or the end, split it into two Insert Text actions, or switch Delivery to Markdown or Discord — those paste their marks as literal text and are not affected by this rule.',
        'A formatação só é anexada quando o texto forma UM bloco contínuo. Um {Enter}, {Tab} ou {Delay:N} com texto dos DOIS lados divide esse bloco, e a ação cola como texto puro. Saídas: mova o token de tecla para o início ou o fim, divida em duas ações Insert Text, ou troque o Delivery para Markdown ou Discord — esses colam as marcas como texto literal e não são afetados por esta regra.',
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
      text: tt('Typing sends no formatting', 'Digitar não envia formatação'),
      tip: tt(
        'Type sends keystrokes, one character at a time — there is no clipboard, so the HTML flavor is never attached. The formatting stays saved with the action and comes back the moment you switch to Paste. To keep it WHILE typing, switch Delivery to Markdown or Discord: their marks are literal characters and are typed exactly as written.',
        'O modo Type envia teclas, um caractere por vez — não existe área de transferência, então o formato HTML nunca é anexado. A formatação continua salva na ação e volta assim que você escolher Paste. Para mantê-la DIGITANDO, troque o Delivery para Markdown ou Discord: as marcas deles são caracteres literais e são digitadas exatamente como estão.',
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
      text: tt('Plain delivery — formatting is kept, but not sent',
               'Entrega Plain — a formatação fica salva, mas não é enviada'),
      // The REMEDY is method-dependent even though the diagnosis is not: under Type, "switch to
      // Rich" is advice that delivers nothing (rung 2 is the proof — typing has no clipboard, so
      // there is no HTML flavor to attach). Rungs 1 and 2 got their method leg with the transport
      // axis; this one is the third, and it needs it here rather than as a fourth rung because the
      // CONDITION is genuinely method-independent — only the way out changes.
      tip: sendMethod === 'type'
        ? tt(
          'The formatting stays saved with the action and comes back if you change Delivery. It is simply not sent while Plain is selected — and since this action TYPES, switch to Markdown or Discord: their marks are literal characters and are typed exactly as written. Rich cannot be typed at all.',
          'A formatação continua salva na ação e volta se você trocar o Delivery. Ela apenas não é enviada enquanto Plain estiver selecionado — e como esta ação DIGITA, troque para Markdown ou Discord: as marcas deles são caracteres literais e são digitadas exatamente como estão. Rich não tem como ser digitado.',
        )
        : tt(
          'The formatting stays saved with the action and comes back if you switch Delivery to Rich. It is simply not sent while Plain is selected — switch to Rich, Markdown or Discord to send it.',
          'A formatação continua salva na action e volta se você trocar o Delivery para Rich. Ela apenas não é enviada enquanto Plain estiver selecionado — troque para Rich, Markdown ou Discord para enviá-la.',
        ),
    };
  }

  // RUNG 4 — the old permanent hint, now earned.
  if (tokenCount > 0) {
    return {
      tone: 'muted',
      text: tt('Click any chip in the editor to edit its parameters',
               'Clique em qualquer chip no editor para editar seus parâmetros'),
    };
  }

  return null;
}
