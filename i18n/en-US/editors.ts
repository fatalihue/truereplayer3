// Os editores de cada tipo de passo nesta parte do Inspector: os cliques (ClickEditor.tsx), as teclas
// (KeyEditor.tsx: Keystroke, Hold Key, Key Down e Key Up), o Pause (PauseEditor.tsx), Scroll, Set
// Variable e Copy to Slot (simpleEditors.tsx), Activate Window e Run Macro (windowEditors.tsx).
// Os nomes dos passos ficam em inglês (glossário), e as teclas como o keycap as escreve.
//
// Opção de segmentado: uma palavra quando der. Os orçamentos (§4.2 do plano de idiomas): segmentado de
// 4 com 71 px por opção, de 3 com 95 px, de 2 com 143 px; botões em par com 144 px.
//
// Nas lacunas: number = a posição de um passo na lista (1, 2, 3…, sem separador de milhar); ms = uma
// duração já formatada (formatMs), sem a unidade; key = uma tecla ou combinação, como o keycap escreve
// (Ctrl+S); x e y = um ponto na tela, em px.
export default {
  // O que vários editores dizem igual.
  action: 'Action',                 // rótulo do que o passo faz (a tecla, a janela) · nome
  mode: 'Mode',                     // rótulo · nome
  holdLabel: 'Hold',                // rótulo sobre a duração de um Hold (clique e tecla)
  holdField: 'Hold duration in milliseconds',  // o campo, para o leitor de tela
  repeat: 'Repeat',                 // rótulo das repetições (clique e Run Macro)
  timesField: 'Times to repeat',    // o campo, para o leitor de tela
  varyGap: 'Vary the gap',          // a chave de ligar e o rótulo da linha
  varyGapTip: 'Random ±% on each gap — less robotic.',
  // O nome que um Set Variable ou um Copy to Slot escreve, fora do alfabeto que o motor lê.
  unusableName: 'Letters, digits and _ only — skipped at replay as written.',

  // Os cliques (Left Click e todos os outros): o botão, quantos cliques, onde e o resto.
  click: {
    button: 'Button',               // rótulo · nome
    buttonField: 'Mouse button',    // nome do segmentado, para o leitor de tela
    // As opções do segmentado de 3 (95 px).
    buttons: { Left: 'Left', Right: 'Right', Middle: 'Middle' },
    // O botão no meio de uma frase do resumo: "Clicks the left button…".
    buttonWord: { Left: 'left', Right: 'right', Middle: 'middle' },
    leftOnlyTip: 'Double and triple clicks use the left button',  // dica de um botão desligado
    clicks: 'Clicks',               // rótulo e nome do segmentado
    // As opções do segmentado de 4 (71 px): uma palavra.
    single: 'Single',
    double: 'Double',
    triple: 'Triple',
    hold: 'Hold',
    doubleTip: 'Left button only',
    tripleTip: 'Left button only — selects a paragraph',
    holdTip: 'Press, wait, release — still one step',
    // Numa metade (Down ou Up) de clique: a forma não muda aqui. Convert é o item do menu do passo.
    halfHint: 'A half of a click keeps its form; {{>list.menu.convert}} ▸ in the step menu joins the two.',
    position: 'Position',           // rótulo · nome
    positionField: 'Click position source',  // nome do segmentado, para o leitor de tela
    thisPoint: 'This point',        // opção do segmentado de 2 (143 px)
    atCursor: 'At cursor',
    atCursorTip: 'Wherever the mouse is at run time',
    // Sob o ponto, com a macro em coordenadas relativas · window = o título ou o processo da janela-alvo.
    relativeTo: "Relative to {{window}}'s top-left corner",
    relativeToTarget: "Relative to the target window's top-left corner",  // sem título nem processo
    x: 'X coordinate',              // o campo, para o leitor de tela
    y: 'Y coordinate',
    pick: 'Pick from screen',       // botão em par (144 px) · verbo
    picking: 'Picking…',            // o mesmo botão, enquanto a captura na tela está aberta
    pasteTip: 'A point copied as 640, 512',              // dica do Paste ao lado
    pasteFailed: 'No point like 640, 512 on the clipboard',  // a dica dele quando o clipboard não tinha um ponto
    was: 'Was {{x}}, {{y}} · Ctrl+Z undoes',             // o ponto de antes de escolher ou colar
    times: 'times',                 // unidade dentro do campo das repetições · curto
    gapField: 'Gap between clicks (ms)',  // o campo, para o leitor de tela
    // Unidade dentro do campo do intervalo, ao lado do número · apertado: o campo tem meia largura, e
    // com o Inspector em 18 rem sobra pouco para o número (o pt-BR fica do tamanho do inglês).
    gapUnit: 'ms gap',
    gapTip: 'Keep it above your system double-click speed (~½ s).',
    varyPoint: 'Vary the point',
    varyPointTip: 'Random ±px on the click point — less robotic.',
    varyPointCursorTip: 'Not at cursor — the scatter would move the cursor it reads',  // desligado com At cursor
    focusTip: 'Clicks twice, a few pixels apart, to focus a small target',  // a chave do Focus click
    // Release at: um ponto de soltar transforma o clique em um arraste (dois passos, Down e Up).
    releaseAt: 'Release at',        // rótulo · verbo
    releaseHint: 'Leave it empty and the release lands on the press point.',
    releaseTooClose: 'Release within 2 px of the press — the app reads that as one click, not a drag.',
    releaseNeedsBoth: 'A drag needs both X and Y for the release.',
    releaseX: 'Release X coordinate',  // o campo, para o leitor de tela
    releaseY: 'Release Y coordinate',
    pickRelease: 'Pick the release',   // botão · verbo
    withinTwo: 'Within 2 px of the press — the app reads it as one click.',  // um Down + Up que não arrasta
    oneClick: 'Make it one click',     // botão: junta o Down e o Up de volta · verbo
    releasesFrom: 'Releases the button pressed in step {{number}}.',  // numa metade Up
    // O resumo sob os campos, numa frase (D13) · button = buttonWord.
    summary: {
      single: 'Clicks the {{button}} button at {{x}}, {{y}}{{times}}.',
      singleCursor: 'Clicks the {{button}} button wherever the mouse is{{times}}.',
      double: 'Double-clicks at {{x}}, {{y}}{{times}}.',
      doubleCursor: 'Double-clicks wherever the mouse is{{times}}.',
      triple: 'Triple-clicks at {{x}}, {{y}}{{times}}.',
      tripleCursor: 'Triple-clicks wherever the mouse is{{times}}.',
      hold: 'Presses the {{button}} button at {{x}}, {{y}}, holds {{ms}} ms, releases.',
      holdCursor: 'Presses the {{button}} button wherever the mouse is, holds {{ms}} ms, releases.',
      down: 'Presses the {{button}} button at {{x}}, {{y}} and keeps it down.',
      // x2 e y2 = onde o Up logo abaixo solta.
      downThen: 'Presses the {{button}} button at {{x}}, {{y}}, then releases at {{x2}}, {{y2}}.',
      downDrag: 'Presses the {{button}} button at {{x}}, {{y}}, then releases at {{x2}}, {{y2}} — a drag.',
      up: 'Releases the {{button}} button at {{x}}, {{y}}.',
      // O que entra em {{times}} quando o clique se repete (com o espaço e o "·" do começo) · n = as
      // vezes (até 999).
      times: ' · {{n}}×, {{ms}} ms apart',
    },
  },

  // As teclas: Keystroke e Hold Key; Key Down e Key Up, as metades.
  key: {
    key: 'Key',                     // rótulo · nome (a tecla)
    capture: 'Capture a key',       // o botão da captura, para o leitor de tela · verbo
    orType: 'Or type it',           // sob a captura, sobre o campo
    typeField: 'Type the key',      // o campo, para o leitor de tela · verbo
    // Placeholders: teclas e um token, iguais nos dois idiomas.
    placeholderSingle: 'F5 · Ctrl · Space',
    placeholder: 'F5 · Ctrl+S · {var:name}',
    tokensHint: 'Typed keys accept tokens, like {var:name}.',
    tokensHintDraft: 'Typed keys accept tokens, like {var:name}. Enter adds the step.',  // a tecla de um passo sendo feito
    modeField: 'Keystroke mode',    // nome do segmentado, para o leitor de tela
    press: 'Press',                 // opção do segmentado de 2 (143 px) · verbo
    hold: 'Hold',
    // Com uma combinação: Hold fica só com a última tecla · key = a que fica; modifiers = as que saem.
    comboHint: '{{>editors.key.hold}} takes one key: switching keeps {{key}} and drops {{modifiers}}.',
    droppedHint: '{{>editors.key.hold}} takes a single key: this saved {{key}} and dropped {{modifiers}}. For a combo, add a {{>editors.key.hold}} row for the modifier above this one.',
    times: 'Times',                 // rótulo · nome
    gap: 'Gap',                     // rótulo · nome
    gapField: 'Gap between presses',  // o campo, para o leitor de tela
    gapJitter: 'Gap jitter (%)',      // o campo da variação, para o leitor de tela
    actionType: 'Action type',      // rótulo e nome do segmentado de Key Down | Key Up
    keyDown: 'Key Down',            // glossário
    keyUp: 'Key Up',                // glossário
    // O resumo sob os campos (D13).
    summary: {
      none: 'Press a key or combo, or type one.',
      hold: 'Holds {{key}} for {{ms}} ms.',
      repeat: 'Presses {{key}} {{n}} times, {{ms}} ms apart.',  // n = as vezes (2 a 999)
      press: 'Presses {{key}}.',
      noneHalf: 'Press a key, or type one.',
      down: 'Presses {{key}} and keeps it down.',
      up: 'Releases {{key}}.',
    },
  },

  // O Pause: a tecla que retoma, o timeout e o que vem primeiro.
  pause: {
    resumeKey: 'Resume key',        // rótulo · nome
    captureField: 'Capture the resume key',
    typeField: 'Type the resume key',
    placeholder: 'F8 · Esc · Ctrl+R',  // teclas, iguais nos dois idiomas
    timeoutField: 'Pause timeout in milliseconds',
    summary: {
      either: 'Resumes on {{key}} or after {{ms}} ms — whichever comes first.',
      key: 'Waits until {{key}} is pressed.',
      time: 'Waits {{ms}} ms, then continues.',
      none: 'No resume key and no timeout — this Pause is skipped.',
    },
  },

  // Scroll Up e Scroll Down: a direção.
  scroll: {
    direction: 'Direction',         // rótulo · nome
    hint: 'One notch of the mouse wheel, where the cursor is.',
    field: 'Scroll direction',      // nome do segmentado, para o leitor de tela
    up: 'Scroll Up ↑',              // glossário
    down: 'Scroll Down ↓',
  },

  // Set Variable: o nome e o que ele guarda.
  variable: {
    name: 'Variable name',          // rótulo e nome do campo
    nameHint: 'Read it back with {var:name}.',
    namePlaceholder: 'name',        // um nome de exemplo, no campo
    modeField: 'Variable mode',     // nome do segmentado, para o leitor de tela
    // As opções do segmentado de 4 (71 px): uma palavra · verbo (Set, Add) ou nome (Cycle, Screen).
    set: 'Set',
    cycle: 'Cycle',
    add: 'Add',
    screen: 'Screen',
    cycleTip: 'The next line of a list on each run, then back to the first',
    addTip: 'Adds a number to the current value (a counter)',
    screenTip: 'Reads text from a region of the screen (OCR)',
    waitUpTo: 'Wait up to',         // rótulo no modo Screen
    waitHint: '0 = read once. Nothing read deletes the variable.',
    waitField: 'Wait up to, in milliseconds',
    listLabel: 'List (one item per line)',  // rótulo no modo Cycle
    list: 'List',                   // o campo, para o leitor de tela
    amount: 'Amount',               // rótulo e campo no modo Add · nome
    value: 'Value',                 // rótulo e campo no modo Set · nome
    listHint: 'One line per run, then back to the first.',
    amountHint: 'Added to the current value (unset counts as 0). Negative subtracts.',
    valueHint: 'Tokens resolve here. Empty deletes the variable.',
    listPlaceholder: 'item 1\nitem 2\nitem 3',
  },

  // Copy to Slot: capturar a seleção ou limpar um slot.
  slot: {
    modeField: 'Slot mode',         // nome do segmentado, para o leitor de tela
    capture: 'Capture',             // opção do segmentado de 2 (143 px) · verbo
    clear: 'Clear',
    // As dicas das duas opções.
    captureTip: 'Copies the selection of the app in front into the slot',
    clearTip: 'Empties the slot; with no name, every slot',
    slot: 'Slot',                   // rótulo e campo · coringa
    blankHint: 'Blank clears all slots.',
    hint: 'Read it back with {clip:slot}.',
    placeholderAll: 'all slots',    // placeholder no modo Clear
  },

  // Activate Window: o que fazer com a janela, qual, o que abrir e onde pôr.
  window: {
    actionField: 'Window action',   // nome do segmentado, para o leitor de tela
    // As opções do segmentado de 4 (71 px): uma palavra · verbo.
    activate: 'Activate',
    maximize: 'Maximize',
    minimize: 'Minimize',
    close: 'Close',
    activateTip: 'Brings it to the front, or opens it',
    openOnlyTip: 'Only a window already open',  // Minimize e Close
    launch: 'Launch',               // rótulo: o programa que abre · verbo
    launchHint: 'Opened only when no window matches.',
    path: 'Path',                   // o campo, para o leitor de tela · nome
    pathPlaceholder: 'notepad.exe · https://… · C:\\path\\app.exe',
    browse: 'Browse…',              // botão · verbo
    browseTip: 'Choose a program on the disk',
    args: 'Args',                   // rótulo e campo: os argumentos do programa
    argsPlaceholder: 'Set a path first',
    placement: 'Placement',         // rótulo da seção da posição e do tamanho · nome
    read: 'Read from window',       // botão · verbo
    reading: 'Reading…',
    readTip: 'Reads where the matching window is now, and its size',
    readFailed: 'Could not read the window.',  // erro, quando o motor não diz o motivo
    noAnswer: 'No answer from the app.',
    position: 'Position',           // a chave de ligar e o rótulo da linha · nome
    size: 'Size',
    x: 'Window X',                  // os campos, para o leitor de tela
    y: 'Window Y',
    w: 'Window W',
    h: 'Window H',
    // O prefixo dentro dos campos da largura e da altura · uma letra.
    prefixW: 'W',
    prefixH: 'H',
    timeoutField: 'Wait-for-window timeout in milliseconds',
    targetNote: 'Clicks still follow the macro’s Window target, not this window.',
    // O resumo sob os campos (D13) · path = o programa a abrir.
    summary: {
      opens: 'Opens {{path}}, with no window to wait for.',
      noWindow: 'No window yet: fill in a process or a title.',
      minimize: 'Minimizes the window, when one matches. With none, nothing happens.',
      close: 'Closes the window, when one matches. With none, nothing happens.',
      // Activate e Maximize: a primeira frase, pelo que acontece com a janela…
      front: {
        plain: 'Brings the window to the front.',
        maximize: 'Brings the window to the front and maximizes it.',
        place: 'Brings the window to the front and places it.',
        move: 'Brings the window to the front and moves it.',
        resize: 'Brings the window to the front and resizes it.',
      },
      // …ou com um programa a abrir quando nenhuma janela casa…
      frontOpening: {
        plain: 'Brings the window to the front, opening {{path}} when none matches.',
        maximize: 'Brings the window to the front and maximizes it, opening {{path}} when none matches.',
        place: 'Brings the window to the front and places it, opening {{path}} when none matches.',
        move: 'Brings the window to the front and moves it, opening {{path}} when none matches.',
        resize: 'Brings the window to the front and resizes it, opening {{path}} when none matches.',
      },
      // …e a segunda, pelo que um timeout faz.
      waitsGoesOn: 'Waits up to {{ms}} ms; if the window never shows, the run goes on.',
      waitsStops: 'Waits up to {{ms}} ms; if the window never shows, the run stops.',
    },
  },

  // Run Macro: a macro que ele roda, quantas vezes, e a que está sendo feita.
  runMacro: {
    macro: 'Macro to run',          // rótulo e nome da lista
    // name = o nome da macro chamada.
    notInLibrary: '“{{name}}” is not in the library: choose another.',
    choose: 'Choose the macro to run.',
    disabled: '“{{name}}” is disabled: the run skips it.',
    perCall: 'per call',            // ao lado do rótulo Repeat
    repeatField: 'Repeat count',    // o campo, para o leitor de tela
    perRow: 'Run once per data row',  // o rótulo da linha e a chave de ligar
    perRowTip: 'Once per row of the called macro’s table. Overrides {{>editors.repeat}}.',
    note: 'Runs the called macro’s steps inline; its own loop and interval are ignored (use {{>editors.repeat}}). Disabled macros are skipped; up to 5 levels deep.',
    noOther: 'No other macro to call. Create one first.',  // o Run Macro sendo feito, sem macro para chamar
    adding: 'Adding…',
    keysHint: '↑ ↓ choose, Enter takes it.',
  },
} as const;
