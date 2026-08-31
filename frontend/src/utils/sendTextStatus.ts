// The Insert Text status strip's RIGHT slot is one line and one message. This is the ladder
// that picks it: FIRST MATCH WINS, top to bottom.
//
// The two warning rungs are MODE-DISJOINT by construction — rung 1 only fires on 'rich', rung 2
// only on 'plain' — so they can never contend for the slot and no tie-break is needed. A future
// rung that is NOT mode-disjoint goes below both warnings and above the hint, and this comment
// gets the new rule.
//
// The neutral chip hint is LAST and gated on tokenCount: it used to preach "click any chip" at a
// document with no chips in it, which is where the slot's whole width was going.
//
// Pure and React-free on purpose: the ladder is the part worth testing head-lessly, and a
// component import would drag JSX into a node harness.

export type SendMode = 'rich' | 'markdown' | 'plain' | 'discord';
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
  /** $hasDeliberateFormatting() of the LIVE document, pushed up by the editor. */
  hasFormatting: boolean;
  tokenCount: number;
  /**
   * Rich delivery whose payload will lose its HTML flavor at replay — see richFlavorSurvives
   * in lexical/tokenNormalize.ts. Computed by the caller so this module stays free of the
   * token grammar.
   */
  richWillDegrade: boolean;
}

export function pickStatusNote(
  { sendMode, hasFormatting, tokenCount, richWillDegrade }: StatusInputs,
  tt: (en: string, ptBr: string) => string,
): StatusNote | null {
  // RUNG 1 — the silent one. The engine attaches the HTML flavor only when the resolved payload
  // is EXACTLY ONE text run (ActionExecution.cs:7163), so a key or delay token with text on both
  // sides makes a Rich action paste plain with nothing on screen saying so. Highest rung because
  // it is the only message here the user cannot deduce from the controls in front of them.
  if (richWillDegrade) {
    return {
      tone: 'warn',
      text: tt('Formatting will be dropped at replay', 'A formatação será descartada no replay'),
      tip: tt(
        'Rich formatting is attached only when the payload is ONE run of text. An {Enter}, {Tab} or {Delay:N} with text on BOTH sides splits it, so this action pastes as plain text. Fixes: move the key token to the start or the end, split it into two Insert Text actions, or switch Delivery to Markdown or Discord — those paste their marks as literal text and are not affected by this rule.',
        'A formatação só é anexada quando o texto forma UM bloco contínuo. Um {Enter}, {Tab} ou {Delay:N} com texto dos DOIS lados divide esse bloco, e a ação cola como texto puro. Saídas: mova o token de tecla para o início ou o fim, divida em duas ações Insert Text, ou troque o Delivery para Markdown ou Discord — esses colam as marcas como texto literal e não são afetados por esta regra.',
      ),
    };
  }

  // RUNG 2 — Plain nulls sendHtml (ActionExecution.cs:3608), so authored bold reaches the target
  // as nothing. Only fires when there IS formatting to drop: Plain on an unformatted document is
  // not a warning, it is just Plain. Markdown/Discord are NOT here — they drop the HTML too, but
  // they still carry the formatting, as literal *bold* markers baked into the text.
  if (sendMode === 'plain' && hasFormatting) {
    return {
      tone: 'warn',
      text: tt('Plain delivery — formatting is kept, but not sent',
               'Entrega Plain — a formatação fica salva, mas não é enviada'),
      tip: tt(
        'The formatting stays saved with the action and comes back if you switch Delivery to Rich. It is simply not sent while Plain is selected — switch to Rich, Markdown or Discord to send it.',
        'A formatação continua salva na action e volta se você trocar o Delivery para Rich. Ela apenas não é enviada enquanto Plain estiver selecionado — troque para Rich, Markdown ou Discord para enviá-la.',
      ),
    };
  }

  // RUNG 3 — the old permanent hint, now earned.
  if (tokenCount > 0) {
    return {
      tone: 'muted',
      text: tt('Click any chip in the editor to edit its parameters',
               'Clique em qualquer chip no editor para editar seus parâmetros'),
    };
  }

  return null;
}
