// O glossário fechado: o que fica em inglês nos dois idiomas (plano de idiomas, §2.1 e §2.2).
//
// Um termo entra aqui só por uma das três regras do §2.1, numa linha, com o motivo:
//   1. é nome de algo que existe no arquivo ou no motor (passo, condição, token, tecla, formato);
//   2. é nome próprio de recurso ou painel do TrueReplayer, da lista fechada;
//   3. é coringa: termo técnico que a tela mostra como nome de campo, de seção ou de chip, e que liga
//      a um nome do glossário, ou é como o público fala, ou cuja tradução padrão é bem mais longa ou
//      muda o sentido.
//
// Quem lê esta lista:
// - tools/gen-i18n.mjs: onde o texto em inglês usa um termo conferido, o pt-BR usa o mesmo;
// - a regra "texto solto" do lint (eslint.gate.config.js): um texto que é só glossário não precisa
//   do catálogo, porque é igual nos dois idiomas;
// - os roteiros de largura e a varredura pseudo (.claude/planos/fatias/idiomas-*).

/** Os 48 passos, como a lista os escreve (shell/list/stepTypes.ts). Regra 1. */
export const PASSOS = [
  'Left Click', 'Right Click', 'Middle Click', 'Double Click', 'Triple Click',
  'Hold Left Click', 'Hold Right Click', 'Hold Middle Click',
  'Left Click Down', 'Left Click Up', 'Right Click Down', 'Right Click Up', 'Middle Click Down', 'Middle Click Up',
  'Keystroke', 'Key Down', 'Key Up', 'Hold Key', 'Scroll Up', 'Scroll Down', 'Send Text', 'Pause',
  'Wait Image', 'Wait Pixel Color', 'Wait Text',
  'If', 'Else If', 'Else', 'End If', 'While', 'End Loop', 'For Each Row', 'Break', 'Next', 'Assert', 'Stop', 'Return',
  'Set Variable', 'Copy to Slot', 'Activate Window', 'Run Macro',
  'Open URL', 'Click Element', 'Right Click Element', 'Type Text', 'Select Option', 'Wait Element', 'Assert Element',
] as const;

/** Os nomes que o Add step dá a alguns passos (shell/insert/catalog.ts). Regra 1. */
export const NOMES_ADD_STEP = ['Click', 'Key', 'Text', 'Scroll', 'Wait until…', 'For Each Data Row', 'Break loop', 'Next iteration'] as const;

/** As 11 condições do If, do While, do Assert e das automações (shell/inspector/checks.ts). Regra 1. */
export const CONDICOES = [
  'Image found', 'Pixel color', 'Text on screen', 'Window open', 'Process running', 'File exists',
  'Clipboard', 'Variable', 'Browser element', 'Random', 'Time',
] as const;

/** As teclas, na grafia do keycap (utils/keyNames.ts). Regra 1; o guia pt-BR da Microsoft também mantém Enter, Esc, Tab e Shift (§5.6.4). */
export const TECLAS = [
  'Ctrl', 'Alt', 'Shift', 'Win', 'Enter', 'Esc', 'Tab', 'Backspace', 'Del', 'Ins', 'Home', 'End',
  'PgUp', 'PgDn', 'PrtSc', 'ScrLk', 'NumLk', 'Caps', 'Space',
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  // O teclado numérico, como o keycap escreve ("Ctrl+Alt+Shift+Num0").
  ...Array.from({ length: 10 }, (_, i) => `Num${i}`), 'Num+', 'Num-', 'Num*', 'Num/', 'Num.',
] as const;

/** Os recursos e painéis do TrueReplayer. Regra 2. "Macros" é igual nos dois idiomas. */
export const RECURSOS = [
  'Clicker', 'Data Loop', 'Key Remaps', 'Live Variables', 'Run Report', 'Game Mode', 'Screen Text', 'Inspector', 'Dock', 'Macros',
] as const;

/** Os coringas, com o motivo de cada um. Regra 3. */
export const CORINGAS = {
  clipboard: 'o chip {clipboard} e a condição Clipboard; "área de transferência" tem 21 letras',
  delay: 'o campo de todo passo; "atraso" muda o sentido',
  timeout: 'o campo das esperas; "tempo limite" tem 12 letras',
  loop: 'End Loop, Break loop e Data Loop',
  token: 'os {tokens} do Send Text',
  slot: 'Copy to Slot e {clip:N}',
  snippet: 'a seção do Send Text; "trecho" perde o sentido',
  hotkey: 'o gatilho; "tecla de atalho" tem 15 letras',
  hotstring: 'o gatilho; não tem par em português',
  preset: 'os do Clicker; "predefinição" tem 12 letras',
  tag: 'as da macro e o # da busca',
  remap: 'o item de Key Remaps',
} as const;

/** Marcas e padrões. */
export const MARCAS = [
  'TrueReplayer', 'TrueReplayer 2', 'TrueReplayer 3', 'Windows', 'Chrome', 'Edge', 'WebView2', 'OCR', 'CSS', 'URL',
  'Regex', 'Markdown', 'Discord', 'UUID', 'CSV', 'TSV', 'JSON', 'HEX', 'RGB', 'Unix time', 'DevTools', 'DISM', 'Roblox',
] as const;

/**
 * Nomes do glossário que também são palavra comum do inglês: "Stop" é o passo e é o verbo do botão,
 * "Pause" é o passo e é o verbo do Clicker, "Text" é o nome do Add step e é o rótulo "Texto". Nenhuma
 * conferência automática decide qual é qual: um texto que é só uma delas passa pelo catálogo (a chave
 * diz o papel, §3.1), e o build não cobra a palavra no pt-BR.
 */
export const AMBIGUOS = [
  'Pause', 'Stop', 'Return', 'Next', 'Break', 'If', 'Else', 'While', 'Assert',
  'Click', 'Key', 'Text', 'Scroll', 'Variable', 'Random', 'Time',
  'Win', 'Enter', 'Tab', 'Del', 'Ins', 'Home', 'End', 'Caps', 'Space', 'Edge', 'Windows',
  // A condição Clipboard e o coringa clipboard são a mesma palavra: no meio da frase em português ela
  // vai em minúscula ("Histórico do clipboard"), e o coringa (sem caixa) segue conferido.
  'Clipboard',
] as const;

/**
 * As chaves em que o build não confere o glossário nem a terminologia, com o motivo: o termo do inglês
 * está ali em outro papel (o verbo, o nome comum), ou a frase em português diz o mesmo de outro jeito.
 * Uma linha por chave.
 */
export const ISENCOES: Readonly<Record<string, string>> = {
  'tokenEditor.date.shift': 'o deslocamento da data ({date:+7}), não a tecla Shift',
};
