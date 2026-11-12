// O Teclado (branch teclado): o TrueReplayerMK como modo do TR3. A página (shell/pages/teclado), a
// chave da barra de status (shell/mk/MkStatus.tsx) e a seção dos ajustes da macro
// (shell/mk/TecladoSection.tsx).
export default {
  page: 'Keyboard',                                    // o destino do trilho e o nome da página
  railPlaying: 'Keyboard · {{game}} in front',         // dica do trilho com um jogo na frente

  // A lista à esquerda, no lugar da biblioteca.
  games: {
    title: 'Games',
    inFront: 'In front now',
    locked: 'Locked',
    none: 'No game yet',
    foot: 'A game turns on by itself with its .exe in front. Outside games nothing changes: the macros and the Key Remaps apply.',
  },
  // Adicionar um jogo: os programas abertos, ou o .exe digitado.
  add: {
    label: 'Add a game',
    addExe: 'Add another .exe',
    filter: 'Filter by name or title',
    loading: 'Reading the open programs…',
    none: 'No open program matches',
    typed: 'Or type the .exe',
    typedPlaceholder: 'game.exe',
  },
  empty: {
    title: 'No game yet',
    text: 'Add a game by its .exe: its keys change only while it is in front.',
  },
  head: {
    inFront: 'In front',
    inFrontLayer: 'In front · Layer',
    sub: 'turns on by itself when the game is in front',
    use: 'Use',
    useIn: 'Use in {{game}}',
    exportTip: 'The game and the macros it uses, in one file',
    more: 'More game actions',
    renameLabel: 'Game name',
    lock: 'Lock to this game',
    // Travar (fase 7): as teclas do jogo valem com qualquer janela na frente, menos a do app, até destravar ou fechar o app.
    unlock: 'Unlock',
    locked: 'Locked',
    lockedTip: 'The keys of {{game}} work with any window in front except {{app}}’s. Unlock from the ⋯ menu or the tray.',
    lockedToast: 'The keys of {{game}} now work with any window in front except {{app}}’s, until you unlock or close the app.',
    removeExe: 'Remove {{exe}}',
    deleted: '{{game}} deleted',
    // "Usar" num jogo desativa os outros jogos ativados do mesmo .exe (duas configurações de um jogo).
    turnedOff: {
      one: '{{games}} was turned off: it uses the same .exe.',
      other: '{{games}} were turned off: they use the same .exe.',
    },
  },
  // Exportar e Importar (fase 7): o jogo vai no .trprofile das macros, ao lado das macros que as teclas dele rodam.
  file: {
    exported: {
      one: '{{game}} exported to {{file}}, with {{n}} macro.',
      other: '{{game}} exported to {{file}}, with {{n}} macros.',
    },
    summary: 'and the Keyboard game {{game}}',
    badge: 'Keyboard',
    cardLabel: 'Import the game {{game}} into the Keyboard',
    keys: { one: '{{count}} key with a function', other: '{{count}} keys with a function' },
    renamed: 'Comes in as {{name}}: a game with this name already exists.',
    exeTaken: 'Comes in turned off: {{other}} already uses its .exe. Turn one or the other on with "Use".',
    full: 'Does not come in: the Keyboard already has 64 games.',
    hintGame: 'and the game {{game}}',
  },
  // teclado.json não pôde ser lido (a quarentena do TecladoService, como a do remaps.json).
  warn: {
    backup: 'teclado.json could not be read. This is the last good copy, and changes go to {{pending}} until you replace the file.',
    noBackup: 'teclado.json could not be read, and there is no good copy. Changes go to {{pending}} until you replace the file.',
    replace: 'Replace the file',
  },
  bar: {
    device: 'Device',
    keyboard: 'Keyboard',
    mouse: 'Mouse',
    layerGroup: 'Layer',
    base: 'Base',
    layer: 'Layer',
    layerHold: 'Layer · hold {{key}}',
    noLayer: 'Give a key the Layer function to have a layer',
    changed: { zero: 'No key changed', one: '{{count}} key changed', other: '{{count}} keys changed' },
    changedLayer: { zero: 'No key changed on the layer', one: '{{count}} key changed on the layer', other: '{{count}} keys changed on the layer' },
    numpad: 'Numpad',
    // O desenho do teclado: ABNT2, ANSI ou ISO (nomes de norma, iguais nos dois idiomas).
    layouts: { abnt2: 'ABNT2', ansi: 'ANSI', iso: 'ISO' },
    layoutLabel: 'Drawing layout',
    layoutButton: 'Drawing layout: {{layout}}',          // o nome acessível do botão do layout
    layoutAuto: 'Automatic · {{layout}}',
    layoutTip: 'The drawing follows the Windows layout, or the one you choose here. A game keeps each key by its physical position, so changing the drawing does not change the functions.',
  },
  board: {
    label: '{{layout}} keyboard',                      // o nome acessível do desenho: ABNT2, ANSI ou ISO
    held: 'Held',                                      // a tecla de camada segura, na vista da Camada
    fromBase: '{{rule}} (from Base)',
    fromGlobal: '{{rule}} (from {{source}})',
    clear: 'Clear {{key}}',
    mouseLabel: 'Mouse',
    left: 'Left',
    right: 'Right',
    alwaysNormal: 'Always normal',
    mouseOutTip: 'Stays out, so you never lose the click',
    mouseNote: 'Left and right stay out, so you never lose the click. The wheel only takes one-touch functions. A game that reads the mouse directly also gets the original middle and side clicks.',
  },
  // Os botões do mouse que aceitam função.
  buttons: { MouseMiddle: 'Middle', MouseX1: 'Side 1', MouseX2: 'Side 2', WheelUp: 'Wheel ↑', WheelDown: 'Wheel ↓' },
  // O rótulo na face da tecla: uma palavra (o nome inteiro fica no painel e na dica).
  // Os nomes de tecla do desenho que o glossário de teclas não tem (os outros, como Ctrl e Esc, vêm de lá).
  caps: { AltGr: 'AltGr', Menu: 'Menu' },
  // O rótulo curto na tecla. A tecla desligada não tem: o ícone e a borda tracejada já dizem.
  short: {
    choose: 'Choose…',
    layer: 'Layer',
    LeftClick: 'Left',
    RightClick: 'Right',
    MiddleClick: 'Middle',
    XButton1: 'Side 1',
    XButton2: 'Side 2',
    ScrollUp: 'Wheel ↑',
    ScrollDown: 'Wheel ↓',
  },
  // A função em uma frase: o nome acessível e a dica da tecla.
  sentence: {
    key: 'Another key: {{key}}',
    mouse: 'Mouse: {{button}}',
    macro: 'Macro {{macro}}',
    macroMode: 'Macro {{macro}} ({{mode}})',
    text: 'Text: {{text}}',
    off: 'Off',
    layer: 'Layer (hold)',
    default: 'Default',
  },
  // As funções do plano do MK ("O produto (v1)").
  fns: { default: 'Default', key: 'Another key', mouse: 'Mouse', macro: 'Macro', text: 'Text', off: 'Turn off', layer: 'Layer' },
  modes: { once: 'Once', times: 'N times', hold: 'While held', toggle: 'Toggle' },
  // O modo "N vezes" numa frase (a dica da tecla, a seção da macro): com o número.
  modeTimes: { one: '{{count}} time', other: '{{count}} times' },
  legend: {
    label: 'Legend',
    off: 'Off',
    fromBase: '↧ From Base',
    fromRemaps: 'From the Key Remaps',
  },
  notes: {
    front: 'With the game in front, the key does what is set here; a macro starts on the press. Outside it, the key goes back to normal by itself, and whatever was held is released.',
    openRemaps: 'Open Key Remaps',
    beside: 'The Key Remaps stay on their page. A key with no function here follows its remap (the ⇄ mark); a key with a function here wins over the remap while the game is in front.',
  },
  // O painel da tecla, nas classes de "Remap settings".
  panel: {
    title: 'Key {{key}}',
    // O painel de um botão do mouse (o meio, um lateral, a roda).
    titleMouse: 'Mouse · {{key}}',
    whereBase: '{{game}} · Base',
    whereLayer: '{{game}} · Layer (hold {{key}})',
    close: 'Close the key',
    function: 'Function',
    sameAsBase: 'Same as Base',
    follows: 'Follows {{source}}',
    whyLayerKey: 'The layer key stays on Base',
    whyHolding: 'This is the key that holds the layer',
    whyWheel: 'The wheel only takes one-touch functions',
    conflictBeside: 'The Key Remaps also change {{key}} ({{rule}}). With {{game}} in front, the function here wins.',
    foot: 'Saved as you go. Applies with {{game}} in front.',
    emptyTitle: 'Choose a key',
    emptyText: 'Click a key in the drawing to give it a function. The arrows move across the keyboard.',
    // A visão Mouse: um botão, no desenho ou pelo nome ao lado dele.
    emptyTitleMouse: 'Choose a button',
    emptyTextMouse: 'Click a button in the drawing, or its name, to give it a function. The arrows move between the buttons.',
    defaultFromBase: 'On the layer, {{key}} inherits from Base: {{rule}}. Choose another function to change it only on the layer.',
    layerKeyHint: 'This is the key that holds the layer: its function stays on Base.', // a tecla de camada, vista na Camada
    defaultFromGlobal: 'With no function here, {{key}} follows {{source}}: {{rule}}.',
    defaultTypes: 'The key stays normal: {{key}} types {{typed}}.',
    defaultNormal: 'The key stays normal: {{key}} does what it always does.',
    defaultButton: 'The button stays normal: {{key}} does what it always does.',
    keyOut: 'Key that goes out',
    keyHint: 'Ctrl, Shift, Alt and Win join the combo. Press, repeat and release follow the real key.',
    capturePress: 'Click and press the key',
    captureChange: 'Click to change',
    captureListening: 'Press the key or the combo…',
    // Um modificador apertado sozinho: ele espera o resto, e um clique o usa sozinho (Caps → Ctrl).
    captureHeld: 'Press another key, or click to use {{key}} alone',
    button: 'Button',
    mouseLabel: 'Mouse button',
    text: 'Text',
    textLabel: 'Text the key types',
    textPlaceholder: 'gg! good game',
    enter: 'Enter at the end',
    textHint: 'For the game chat or a command, like /e dance. It goes out as the Send Text step sends it.',
    offGame: '{{key}} does nothing with {{game}} in front. Outside it, it stays normal.',
    layerHint: 'Holding {{key}} brings the layer; releasing it goes back to Base. While it is the layer key, {{key}} loses its own function. A key with no function on the layer inherits from Base.',
    seeLayer: 'See the layer →',
  },
  // A função Macro: uma macro da biblioteca do TR3.
  macro: {
    label: 'Library macro',
    steps: { one: '{{count}} step', other: '{{count}} steps' },
    folder: 'folder {{folder}}',
    hotkey: 'hotkey {{hotkey}}',
    swap: 'Change',
    openEditor: 'Open in the editor',
    recordNew: 'Record new',
    // O nome da macro que "Gravar nova" cria: o jogo e a tecla.
    newName: '{{game}} {{key}}',
    notFound: '{{macro}} is not in the library: the key works as usual.',
    empty: '{{macro}} has no steps: the key works as usual.',
    unsupported: 'A game key runs keys, clicks, the wheel and text. This macro has {{steps}}, so the key works as usual.',
    tokens: 'tokens {…}',
    mode: 'Mode',
    times: 'Times',
    interval: 'Gap between repetitions',
    once: 'Runs once. Pressing again while it runs does not restart it.',
    timesHint: { one: 'Runs {{count}} time.', other: 'Runs {{count}} times in a row.' },
    hold: 'Repeats while {{key}} is held and stops on release.',
    toggle: 'The first press starts it, the second stops it.',
    onPress: 'Starts on the press, without waiting for the release.',
    keepOriginal: 'Keep the original key',
    keepOn: 'The game gets {{key}} too.',
    keepOff: 'The game does not get {{key}}: only the macro runs.',
    outside: 'Outside games, {{macro}} still fires by its hotkey, {{hotkey}}.',
  },
  // A chave do Teclado na barra de status.
  status: {
    off: 'Keyboard Off',
    paused: 'Keyboard paused',
    gameOff: 'Keyboard · {{game}} off',
    front: 'Keyboard · {{game}} in front',
    frontLayer: 'Keyboard · {{game}} · Layer',
    idle: 'Keyboard On',                              // como "Shortcuts On"; com um jogo na frente, o nome dele
    locked: 'Keyboard · locked to {{game}}',
    offTip: 'Off: no key changes, in any game.',
    pausedTip: 'On, but paused while the shortcuts are off.',
    onTip: 'With a game in front, its keys change as set on the Keyboard. Turning it off brings every key back at once and releases whatever was held.',
    lockedTip: 'Locked: the keys of {{game}} work with any window in front except {{app}}’s. Turning it off brings every key back at once.',
  },
  // A seção dos ajustes da macro: as teclas de jogo que usam esta macro.
  section: {
    title: 'Keyboard',
    none: 'On no game key',
    noneSub: 'Give this macro to a key on the Keyboard',
    use: '{{game}} · {{key}}',
    useLayer: '{{game}} · {{key}} on the layer',
    sub: '{{mode}} · starts on the press',
  },
} as const;
