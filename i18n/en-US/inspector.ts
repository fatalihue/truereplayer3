// O Inspector (shell/inspector/): a moldura (Inspector.tsx e InspectorBody.tsx: o cabeçalho, a faixa do
// Delay, as Notas e o rodapé), os componentes que todos os editores usam (fields.tsx, probeKit.tsx,
// WaitTiming.tsx, MacroPicker.tsx), o editor em lote de vários passos (BatchEditor.tsx) e os avisos do
// que falta para um passo rodar: a extensão do navegador e a leitura de texto (missing.tsx).
// Os nomes dos passos (shell/list/stepTypes.ts) e das condições (checks.ts) são glossário e ficam fora
// do catálogo; o "para quê" da captura na tela usa list.pickFor (captureFor.ts).
//
// Nas lacunas: number = a posição de um passo na lista (1, 2, 3…, sem separador de milhar, como a
// coluna do número); n = uma contagem já formatada (fmtNum: 1,000 / 1.000); ms = uma duração já
// formatada (formatMs), sem a unidade; app = o nome deste app (frontend/src/appIdentity.ts).
export default {
  // A moldura com nada selecionado: o título, e a nota de só leitura no lugar do rodapé.
  frame: {
    macroSettings: 'Macro settings',        // título com uma macro aberta e nenhum passo escolhido · nome
    noMacro: 'No macro open',               // título sem macro aberta (toda abertura do app)
    noStep: 'No step selected',             // subtítulo sob "Macro settings"
    closeSettings: 'Close macro settings',  // o × das configurações por cima da lista (760–1023 px), para o leitor de tela · verbo
    // Os botões de voltar quando o Inspector cobre o resto (520–759 px, um painel por vez) · nome, curto.
    backToTable: 'Table',                   // volta à tabela da Data Loop
    backToSteps: 'Steps',                   // volta à lista de passos
    width: 'Inspector width',               // a alça da borda esquerda, para o leitor de tela
    // O rodapé durante uma gravação e durante uma execução: o mesmo que a fileira de inserção diz.
    readOnlyRecording: '{{>insert.readOnlyRecording}}',
    readOnlyRunning: '{{>insert.readOnlyRunning}}',
  },

  // O rodapé: o que vale para os campos · orçamento: 323 px, quebra (ganha uma linha) com +15%.
  foot: {
    applies: 'Applies as you type and saves on its own · Ctrl+Z undoes',  // um passo aberto
    batch: 'Each change is one undo step · Ctrl+Z undoes',               // o editor em lote
    // O Send Text expandido: o Inspector fica largo, então este tem mais lugar.
    wide: 'Applies as you type · Ctrl+Z undoes · drag the left edge to resize',
    // Um passo ainda sendo feito, antes de existir: o que falta e como desistir.
    draftKey: 'The step is added with its key · Esc cancels',
    draftText: 'The step is added with its first text · Esc cancels while it is empty',
    draftMacro: 'Choose the macro it runs · Esc cancels',       // Run Macro
    draftWait: 'Choose what it waits for · Esc cancels',        // Wait until…
    draftCheck: 'Choose what it checks · Esc cancels',          // If, While, Else If, Assert
  },

  // O cabeçalho: o nome do passo (glossário) e, embaixo, onde ele está. As partes do subtítulo se
  // juntam com " · ": "Step 3 of 9 · ↓ press · expanded".
  head: {
    stepOf: 'Step {{number}} of {{total}}',  // total = os passos da macro (sem separador, como number)
    press: '↓ press',         // uma metade Down de clique ou de tecla · curto
    release: '↑ release',     // uma metade Up
    expanded: 'expanded',     // com o editor expandido (o editor, masculino)
    // Um passo ainda sendo feito: onde ele vai entrar.
    newFirst: 'New step · the first step',             // a macro está vazia
    newAfter: 'New step · after step {{number}}',
    newAtEnd: 'New step · at the end, after step {{number}}',
    expand: 'Expand editor',          // botão do Send Text, para o leitor de tela · verbo
    collapse: 'Collapse editor',
    expandTip: 'Room for the tokens, the snippets, the emoji and a preview',
    collapseTip: 'Back to the narrow editor (Esc)',
    close: 'Close editor',            // o × do passo aberto, para o leitor de tela · verbo
    cancelNew: 'Cancel the new step', // o × do passo sendo feito
    clearSelection: 'Clear selection', // o × do editor em lote
  },

  // A faixa do Delay sob o cabeçalho e as Notas de todo passo.
  delay: 'Delay',                       // rótulo da faixa · coringa (glossário)
  delayField: 'Delay in milliseconds',  // o campo, para o leitor de tela
  notes: 'Notes',                       // rótulo e nome do campo das notas · nome
  addNote: 'Add a note…',               // placeholder das notas (um passo, e o lote)
  notBuilt: '{{name}} editor',          // só no build de desenvolvimento · name = o nome do passo (glossário)

  // A linha que um marcador de bloco, um salto ou um fim mostra no lugar de um editor: não há mais o
  // que ajustar. Os nomes dos passos ficam (glossário); {row:column} é um token.
  markers: {
    Else: 'The FALSE branch. Set the condition on the If step.',
    EndIf: 'Closes the block. Set the condition on the If step.',
    EndLoop: 'Closes the block. Set the loop on its opening step.',
    BreakLoop: 'Exits the innermost loop.',
    ContinueLoop: 'Jumps back to the innermost loop’s opening step.',
    ForEachRow: 'Runs its block once per row of the Data Loop table. {row:column} reads the current row.',
    Stop: 'Ends the whole run here, with no error.',
    Return: 'Ends this pass only — the remaining passes and data rows still run.',
  },

  // Os campos comuns (fields.tsx).
  fields: {
    increase: 'Increase',     // o ▲ na borda de um número, para o leitor de tela · verbo
    decrease: 'Decrease',     // o ▼
    noTimeout: '∞ No timeout',  // o chip do ∞ nas durações do Pause · timeout é coringa
    noTimeoutTip: 'Wait for the resume key, with no time limit',
    // A captura de uma tecla no próprio painel: o que o botão mostra.
    noKey: 'No key yet',
    listening: 'Listening — press a key · Esc cancels',  // uma tecla só (Key Down, Key Up)
    listeningMouse: 'Listening — press a key, a combo, a side button or the wheel · Esc cancels',  // a hotkey de uma macro
    listeningCombo: 'Listening — press a key or a combo · Esc cancels',
    capture: 'Click to capture a key',  // a linha do botão parado
  },

  // A região onde uma imagem é procurada ou um texto é lido (probeKit.tsx).
  region: {
    label: 'Search region',                 // rótulo padrão do campo · nome
    size: '{{w}} × {{h}} at {{x}}, {{y}}',  // a região desenhada: largura × altura, no ponto x, y (px)
    notDrawn: 'Not drawn yet',              // a região obrigatória de uma automação, ainda sem desenho (a região)
    whole: 'Whole screen',                  // sem região
    drawing: 'Drawing…',                    // o botão, enquanto a sobreposição do motor está aberta
    redraw: 'Redraw',                       // botão · verbo
    draw: 'Draw',
    clear: 'Search the whole screen',       // o × que volta à tela inteira: nome e dica · verbo
  },
  exact: '{{label}}, exact',  // o número ao lado de uma régua (as tolerâncias), para o leitor de tela · label = o nome da régua
  hex: '#RRGGBB',             // placeholder de uma cor · formato, igual nos dois idiomas

  // A lista dos processos rodando, para escolher um (probeKit.tsx).
  process: {
    pick: 'Pick a running process',   // o botão: nome e dica · verbo
    list: 'Running processes',        // o popover e a lista, para o leitor de tela
    filter: 'Filter processes',       // o campo do filtro, para o leitor de tela
    filterHint: 'Filter…',            // placeholder do filtro
    loading: 'Loading…',
    none: 'No processes match.',      // o filtro não casa nenhum
  },

  // O Timeout de uma espera e o que ele faz (WaitTiming.tsx): Wait Image, Wait Text, Wait Pixel Color
  // e Activate Window.
  wait: {
    timeout: 'Timeout',                       // rótulo · coringa (glossário)
    timeoutField: 'Timeout in milliseconds',  // o campo, para o leitor de tela (o rótulo padrão)
    onTimeout: 'On timeout',                  // rótulo e nome do segmentado
    // As opções do segmentado de 2 (143 px) · verbo.
    halt: 'Halt',
    haltTip: 'The run stops',
    continue: 'Continue',
    continueTip: 'The run goes on to the next step',
  },

  // A lista das macros para escolher (MacroPicker.tsx): Run Macro e Automations.
  picker: {
    search: 'Search macros…',       // placeholder da pesquisa
    empty: 'No macro to choose',    // não há macro para escolher
    noMatch: 'No macro matches',    // a pesquisa não casa nenhuma
  },

  // O editor em lote, com vários passos selecionados (InspectorBody.tsx e BatchEditor.tsx).
  batch: {
    // O título · count e n = os passos selecionados (2 ou mais).
    selected: { one: '{{n}} step selected', other: '{{n}} steps selected' },
    // O subtítulo: os números dos passos. list = os números menos o último, separados por ", ".
    numbers: 'Steps {{list}} and {{last}}',        // até 5 passos
    numbersMore: 'Steps {{list}} and {{n}} more',  // mais de 5: os 4 primeiros e quantos mais
    // As opções Set | Add (segmentado de 2, 6,5 rem: uma palavra curta) · verbo.
    set: 'Set',
    add: 'Add',
    setDelayTip: 'Every selected step gets this delay',
    addDelayTip: "Added to each step's delay. Negative subtracts, stopping at 0.",
    setPointTip: 'Every selected click gets this value',
    addPointTip: "Added to each click's current value. Negative subtracts.",
    // Por que o número digitado não serve (sob o campo, em vermelho).
    plusSets: '+ adds — pick {{>inspector.batch.add}}, or drop the + to set',
    negativeDelay: "A delay can't be negative — pick {{>inspector.batch.add}} to subtract",
    wholeMs: 'Use a whole number of ms — 0 or more',
    wholeDelta: 'Use a whole number — e.g. +50 or -20',
    wholeCoord: 'Use a whole number — e.g. 500 or -10',
    wholeCoordDelta: 'Use a whole number — e.g. +10 or -5',
    // O delay de hoje, sob o campo.
    delayNone: 'None of these steps has a delay.',
    delaySame: 'Now {{ms}} ms on all.',
    delayMixed: 'Now mixed: {{low}} to {{high}} ms.',  // low e high = o menor e o maior, formatados
    delayMode: 'Set or add the delay',  // nome do segmentado, para o leitor de tela
    delayAll: 'Delay for all',          // o campo, para o leitor de tela
    deltaHint: '+50 or -20',            // placeholder no modo Add
    position: 'Position',               // rótulo · nome
    // Ao lado de Position · count e k = os cliques com ponto; n = os passos selecionados.
    clicksOf: { one: '· {{k}} of the {{n}} is a click', other: '· {{k}} of the {{n}} are clicks' },
    axisMode: 'Set or add {{axis}}',    // nome do segmentado · axis = X ou Y
    axisOffset: '{{axis}} offset',      // o campo, para o leitor de tela
    pointHint: '500 or -10',            // placeholder no modo Set
    pointDeltaHint: '+10 or -5',        // placeholder no modo Add
    applyClicks: { one: 'Apply to {{n}} click', other: 'Apply to {{n}} clicks' },  // botão · count e n = os cliques
    notesAll: 'Notes for all',          // o campo, para o leitor de tela
    mixed: 'Mixed',                     // placeholder quando as notas dos passos são diferentes
    clearNotes: 'Clear notes on all {{n}}',  // link · n = os passos selecionados (2 ou mais)
    clearNotesTip: 'Remove the notes from the selected steps',
    actions: 'Actions',                 // rótulo · nome
    moveUp: 'Move up',                  // item da lista de ações · verbo
    moveDown: 'Move down',
    enableAll: 'Enable all {{n}}',      // n = os passos selecionados (2 ou mais), todos pulados
    skipAll: 'Skip all {{n}}',
    deleteSteps: { one: 'Delete {{n}} step', other: 'Delete {{n}} steps' },  // count e n = os passos selecionados
    // Os avisos · count e n = os passos.
    notesSet: { one: 'Set notes for {{n}} step(s)', other: 'Set notes for {{n}} step(s)' },
    notesCleared: { one: 'Cleared notes on {{n}} step(s)', other: 'Cleared notes on {{n}} step(s)' },
    deleted: { one: 'Deleted {{n}} step(s)', other: 'Deleted {{n}} step(s)' },  // o aviso tem Undo
  },

  // O que falta neste computador para o passo rodar, dito onde ele é editado (missing.tsx).
  missing: {
    extension: "The browser extension isn't connected",
    extensionText: 'Browser steps run through it, in Chrome or Edge.',
    setUp: 'Set up the extension',      // botão · verbo
    openScreenText: 'Open Screen Text',  // botão · verbo; Screen Text é glossário
    // A leitura de texto (OCR) no idioma de Settings › Screen Text · name = o idioma, como a lista de
    // lá o escreve ("Português", "English").
    installing: 'Installing {{name}} text reading…',
    installingText: 'Windows is adding it. Reads use it once it is in.',
    installed: '{{name}} text reading is installed',  // instalada, esperando o app reiniciar
    restart: 'Restart {{app}} to use it.',
    none: 'No text reading on this PC',
    noneText: 'Windows reads the screen with a language pack. Choose one in {{>common.pages.settings}} › {{>settings.categories.screen}}.',
    notInstalled: "{{name}} text reading isn't installed",
    notInstalledText: 'Windows reads the screen with it. It installs once, for every macro.',
    // O mesmo, quando outro idioma já está instalado · effective = esse idioma.
    notInstalledUntil: 'Windows reads the screen with it. It installs once, for every macro. Until then, reads use {{effective}}.',
    install: 'Install',                  // botão · verbo
    installTip: 'Windows asks for permission; the download comes from Windows Update.',
    // Os avisos da instalação pedida aqui.
    doneRestartApp: 'Installed — restart {{app}} to use it.',
    doneRestartWindows: 'Installed — restart Windows to finish.',
    done: 'Text reading installed.',
    canceled: 'Install canceled — Windows needs your permission to add the pack.',
    failed: "Couldn't install it: {{error}}",  // error = o motivo que o motor manda, ou unknownError
    unknownError: 'unknown error',
  },
} as const;
