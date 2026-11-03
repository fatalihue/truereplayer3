// A lista de passos (shell/list/): o vazio, o cabeçalho, as linhas, a coluna Details de cada passo
// (details.tsx), o menu do clique direito no passo (stepMenu.ts) e os avisos dela; e a entrega do
// Send Text (utils/sendTextStatus.ts), que a célula do passo e o Inspector mostram.
// Os nomes dos passos (Left Click, If, Send Text…) e das famílias das condições (Image found, Pixel
// color…) são glossário e ficam fora do catálogo: vêm de shell/list/stepTypes.ts e de details.tsx.
//
// Nas lacunas: number = a posição de um passo na lista (1, 2, 3…, sem separador de milhar, como a
// coluna do número); n = uma contagem já formatada (fmtNum: 1,000 / 1.000); name = o nome de um
// passo (glossário) ou de uma variável.
export default {
  // O que a lista mostra no lugar dos passos.
  openMacro: 'Open a macro from the library.',          // nenhuma macro aberta
  waitingFirst: 'Waiting for the first click or key…',  // gravando numa macro ainda vazia

  // O cabeçalho das colunas: só o substantivo. A coluna Step tem 10,75 rem; a Delay, 4,75 rem.
  head: {
    step: 'Step',
    details: 'Details',
    delay: 'Delay',                 // coringa (glossário)
    note: 'Note',                   // a nota do passo
    selectAll: 'Select all steps',  // a caixa de marcar do cabeçalho, para o leitor de tela · verbo
  },
  steps: 'Steps',                   // nome da lista, para o leitor de tela
  menuName: 'Step {{number}}',      // nome do menu do clique direito, para o leitor de tela
  // A linha "para quê" da barra da captura na tela, depois de "Pick the point · ", quando o menu do
  // passo pede Pick from screen. name = o nome do passo (glossário): "for step 7, Left Click".
  pickFor: 'for step {{number}}, {{name}}',
  focusClick: 'Focus click',        // o clique que clica duas vezes para dar o foco: o ícone da linha e o item do menu · nome

  // A linha de cada passo (StepRow).
  row: {
    select: 'Select step {{number}}',  // dica da caixa de marcar que aparece no lugar do número
    running: 'Running',             // o ícone no lugar do número, no passo que roda agora
    paused: 'Paused',               // o mesmo ícone, com um passo Pause segurando a execução
    not: 'NOT',                     // o selo de uma condição negada, ao lado do nome do passo · curto, maiúsculas
    // Ao lado de um Run Macro que roda uma vez por linha do Data Loop · apertado: divide os 10,75 rem
    // da coluna com o nome do passo.
    perRow: '· per row',
    focusClickTip: '{{>list.focusClick}}: clicks twice, a few pixels apart',
    atCursor: 'At the cursor',      // o ícone de um clique que vai onde o cursor está, para o leitor de tela
    atCursorTip: 'Clicks at the cursor position',
    skipped: 'Skipped',             // o ícone de um passo pulado, para o leitor de tela
  },

  // Os blocos (If, While, For Each Row): as dicas dos marcadores e a fileira "+ Add Else".
  block: {
    noEndIf: 'No matching End If',      // um If sem o End If dele
    noEndLoop: 'No matching End Loop',  // um While ou For Each Row sem o End Loop dele
    noLoop: 'No matching loop',         // um End Loop solto
    noIf: 'No matching If',             // um End If, Else If ou Else solto
    endsAt: 'Ends at step {{number}}',  // dica do If, While ou For Each Row: onde o bloco termina
    // Dica do End If ou End Loop. name = o passo que abre o bloco; number = a posição dele;
    // count e n = os passos dentro do bloco.
    closes: { one: 'Closes {{name}} · step {{number}} · {{n}} step', other: 'Closes {{name}} · step {{number}} · {{n}} steps' },
    branch: 'Branch of If · step {{number}}',  // dica do Else If e do Else: o If de que são ramo
    addElseIf: 'Add Else If',           // botão da fileira dentro do bloco If · verbo
    addElse: 'Add Else',
  },

  // Os avisos da lista.
  toasts: {
    pickBusy: 'Another pick is open — finish it first.',  // Pick from screen com outra captura na tela aberta
    pointSet: 'Point set to {{x}}, {{y}}',                // o ponto escolhido na tela foi para o passo; o aviso tem Undo
    locked: 'Not deleted — the steps are locked while a run is on.',  // a tecla Delete durante uma execução
    // A tecla Delete, o menu e o lote quando o que sai é maior que a seleção · n ≥ 2 sempre.
    deletedBlocks: 'Deleted {{n}} steps — the selection touched a block marker, so whole blocks went with it.',
  },

  // A coluna Details: o que o passo faz, numa linha curta que corta com reticências.
  details: {
    upTo: 'up to {{seconds}} s',          // Wait Image, depois da semelhança: "95% · up to 10 s" · seconds = o timeout, formatado
    changes: 'changes',                   // Wait Text no modo Changes: espera o texto da região mudar · verbo, minúscula
    keyOrTime: '{{key}} or {{ms}} ms',    // Pause: a tecla que solta ou o tempo, o que vier primeiro · key = a tecla (glossário)
    skipped: 'Skipped: no key and no time',  // Pause sem tecla e sem tempo: a execução pula o passo
    holdFor: '{{key}} for {{ms}} ms',     // Hold Key: a tecla e por quanto tempo fica apertada
    clearAll: 'clear all slots',          // Copy to Slot no modo Clear, sem slot escolhido
    clearSlot: 'clear {{clip}}',          // Copy to Slot no modo Clear · clip = o token do slot, como {clip:a}
    toSlot: 'selection → {{clip}}',       // Copy to Slot: a seleção do app da frente vai para o slot
    rows: { one: '{{n}} row', other: '{{n}} rows' },  // For Each Row: as linhas da tabela do Data Loop
    // Set Variable no modo Cycle · name = a variável; count e n = os itens da lista do ciclo.
    cycle: { one: '{{name}} ⟳ {{n}} item', other: '{{name}} ⟳ {{n}} items' },
    fromScreen: '{{name}} ← screen',      // Set Variable no modo Screen: o valor é lido da tela
    fromScreenNumber: '{{name}} ← screen #',  // o mesmo, lido como número
    has: '{{name}} has {{value}}',        // condição Variable com o operador Contains · name = a variável
    // O texto da tela que o passo espera (Wait Text, Text on screen): text = o que foi digitado.
    textHas: 'has "{{text}}"',            // operador Contains
    textRegex: 'regex {{text}}',          // operador Regex (padrão)
    maxTimes: 'max {{n}}×',               // While: o teto de voltas, depois da condição
    // Activate Window. window = o processo e o título da janela, com "#2" quando vale a segunda que
    // casa; path = o programa que abre quando nenhuma janela casa. Os verbos são os do Inspector.
    window: {
      maximize: 'Maximize · {{window}}',
      minimize: 'Minimize · {{window}}',
      close: 'Close · {{window}}',
      launch: '{{window}} — launch',      // ativa a janela, ou abre o programa se nenhuma casa
      maximizeLaunch: 'Maximize · {{window}} — launch',
      run: 'run: {{path}}',               // só o programa a abrir, sem janela para procurar
    },
  },

  // O menu do clique direito no passo, e os mesmos itens no Ctrl+K. Item de menu: verbo no
  // infinitivo, sem artigo. Os que agem na seleção dizem quantos passos são: count e n = o número.
  menu: {
    openMacro: 'Open macro',            // num Run Macro: abre a macro que ele chama
    resetCycle: 'Reset cycle position', // num Set Variable no modo Cycle
    resetCycleTip: 'The next run starts at the first item of the list',
    selectBlock: 'Select block',
    selectBlockTip: 'Selects the whole block, both markers included',
    selectedBlock: 'Selected {{n}} steps',  // aviso de Select block · n ≥ 2 sempre (os dois marcadores)
    pickFromScreen: 'Pick from screen', // num clique com ponto: escolhe o ponto na tela
    changeClickType: { one: 'Change click type', other: 'Change click type ({{n}})' },  // abre os tipos de clique (glossário)
    duplicate: { one: '{{>common.actions.duplicate}}', other: '{{>common.actions.duplicate}} ({{n}})' },
    duplicateTip: 'The selection touches a block marker, so whole blocks are duplicated',
    copy: { one: '{{>common.actions.copy}}', other: '{{>common.actions.copy}} ({{n}})' },
    pasteBelow: 'Paste below',
    skip: { one: 'Skip', other: 'Skip ({{n}})' },  // marca os passos para a execução pular · verbo
    skipTip: 'Keeps the steps, skips them at run time',
    skipped: { one: 'Skipped {{n}} step(s)', other: 'Skipped {{n}} step(s)' },  // aviso de Skip
    enable: { one: 'Enable', other: 'Enable ({{n}})' },  // o contrário de Skip, com todos já pulados · verbo
    enableTip: 'Puts these steps back in the run',
    enabled: { one: 'Enabled {{n}} step(s)', other: 'Enabled {{n}} step(s)' },  // aviso de Enable
    convert: 'Convert',                 // abre o submenu Convert ▸
    deleteBlock: 'Delete block',        // num If sozinho: sai o bloco inteiro
    deleteBlockTip: 'Deletes the whole If block, End If included',
    deleteLoop: 'Delete loop',          // num While ou For Each Row sozinho
    deleteLoopTip: 'Deletes the whole loop, End Loop included',
    deleteArm: 'Delete arm',            // num Else If sozinho: sai só esse ramo
    deleteArmTip: 'Deletes only this Else If arm',
    delete: { one: '{{>common.actions.delete}}', other: '{{>common.actions.delete}} ({{n}})' },
    deleteWiderTip: 'The selection touches a block marker, so whole blocks go',

    // Convert ▸: a forma de um clique (uma linha, ou Down e Up em duas) e as coordenadas da macro.
    twoRows: 'Two rows',
    twoRowsTip: 'Down and Up as separate rows — needed for a drag',
    oneRow: 'One row',
    oneRowTip: 'Press and release together',
    // Aviso depois de One row, quando a metade Up tinha nota.
    oneRowNotes: '{{>list.menu.oneRow}} keeps the Down half: the notes of the Up half are gone. Ctrl+Z brings them back.',
    toRelative: 'Coordinates to relative',
    toAbsolute: 'Coordinates to absolute',
    allToOneRow: 'All clicks and keys to one row',
    allToOneRowTip: 'Joins every Down + Up pair in the macro',
    allToTwoRows: 'All clicks and keys to two rows',
    allToTwoRowsTip: 'Splits every click and key of the macro into Down + Up',

    // More ▸: as ferramentas mais raras.
    copyFailed: 'Copy failed',          // aviso de erro de um dos Copy abaixo
    copyTable: 'Copy as table',         // a macro inteira, no formato de tabela do motor
    copyCoordinates: 'Copy coordinates',
    coordinatesCopied: 'Copied {{x}}, {{y}}',  // aviso
    copyUrl: 'Copy URL',                // num Open URL
    urlCopied: 'URL copied',
    copySelector: 'Copy selector',      // num passo de navegador: o seletor CSS
    selectorCopied: 'Selector copied',
    copyText: 'Copy text',              // num Send Text
    textCopied: 'Text copied',
    selectSimilar: 'Select similar',    // seleciona os passos do mesmo tipo e do mesmo alvo
    selectedSimilar: { one: 'Selected {{n}} similar step(s)', other: 'Selected {{n}} similar step(s)' },  // aviso
    focusClick: { one: '{{>list.focusClick}}', other: '{{>list.focusClick}} ({{n}})' },  // liga e desliga · item com marca
    focusClickTip: 'Clicks twice, a few pixels apart, so a small target takes the focus',
    collapse: 'Collapse to × N',        // junta pares Key Down + Key Up de uma tecla num Keystroke × N
    // count e n = os pares Down + Up que viram um passo só (1 também: um par vira Keystroke × 1).
    collapseTip: { one: 'Folds {{n}} presses into one step', other: 'Folds {{n}} presses into one step' },
    collapseHint: 'Select adjacent Key Down + Key Up pairs of the same key',  // dica com o item desativado
    expand: 'Expand × N',               // o contrário: um passo por pressionamento
    expandTip: 'Splits it back into one step per press',
    expandHint: 'Select one Keystroke × N step with a single key (no combo)',  // dica com o item desativado
  },

  // A entrega do Send Text: a dica do selo na célula do passo, a linha de estado do editor no
  // Inspector e o bloco Delivery da aba Preview. Rich, Plain, Markdown e Discord são as opções de
  // Message do editor; Paste e Type, as do modo de envio. Os porquês servem à linha de estado (na dica)
  // e ao bloco Delivery: uma frase só, para os dois lugares não divergirem.
  sendText: {
    // As dicas do selo de entrega na célula do passo, quando a formatação não chega.
    badgeRichSplit: 'Rich, but a key or delay token splits the text, so replay pastes it as plain. Move the token to an end, split the action, or use Markdown/Discord.',
    badgeTypeDropsRich: 'Type sends keystrokes, no clipboard, so the formatting is not sent. It stays saved: use Paste, or Markdown/Discord to type the marks.',

    whyRichSplits: 'Rich needs ONE run of text. A key or delay token with text on both sides splits it, so this pastes as plain. Move the token to an end, split the action, or use Markdown/Discord.',
    whyTypeDropsRich: 'Type has no clipboard, so HTML formatting is never sent. It returns with Paste; Markdown/Discord keep their marks while typing.',
    whyPlainUnderType: 'Kept with the action, not sent while Plain. This action types, so use Markdown or Discord — Rich cannot be typed.',
    whyPlainUnderPaste: 'Kept with the action, not sent while Plain. Switch to Rich, Markdown or Discord to send it.',

    // A linha de estado do editor: uma linha, que corta; a dica tem o porquê inteiro.
    richDropped: 'Formatting will be dropped at replay',
    typingNoFormatting: 'Typing sends no formatting',
    plainKept: 'Plain delivery — formatting is kept, but not sent',
    chipHint: 'Click any chip in the editor to edit its parameters',  // com tokens no texto e nada errado

    // O bloco Delivery da aba Preview: como vai (Transport), em que forma (Flavor) e o que acontece
    // com a formatação (Formatting). ms = a pausa entre as letras, formatada.
    typedPaced: 'Typed key by key · {{ms}} ms per character',
    typedUnpaced: 'Typed key by key · no pause',
    pasted: 'Pasted with Ctrl+V',
    flavorRich: 'Rich · formatting travels as HTML',
    flavorMarkdown: 'Markdown · marks like *bold* in the text',
    flavorDiscord: 'Discord · marks like **bold** in the text',
    flavorPlain: 'Plain · text only',
    // O que acontece com a formatação · concorda com "formatação" (feminino) em português.
    noneInText: 'None in this text',
    droppedAtReplay: 'Dropped at replay',
    notSent: 'Not sent',
    keptNotSent: 'Kept, not sent',
    sentAsHtml: 'Sent as HTML with the paste',
    sentAsMarks: 'Sent as marks in the text',
  },
} as const;
