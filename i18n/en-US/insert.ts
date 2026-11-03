// A fileira de inserção sobre os passos (shell/insert/InsertRow.tsx) e o catálogo Add step
// (AddStepCatalog.tsx e catalog.ts, que o Ctrl+K também lê). Os nomes dos passos ficam em inglês
// (glossário) e moram em catalog.ts, como dado; aqui ficam os grupos, as descrições e as palavras que
// a pesquisa conhece, que cada idioma tem as suas.
export default {
  // As abas da macro, à esquerda da fileira.
  tabs: 'Macro views',                          // nome das abas, para o leitor de tela
  steps: 'Steps',                               // a aba dos passos; o número vai ao lado · nome
  rows: { one: '{{count}} row', other: '{{count}} rows' },  // ao lado de Data Loop: as linhas da tabela
  // No lugar das ferramentas, enquanto nada pode ser inserido.
  readOnlyRecording: 'Read-only while recording',
  readOnlyRunning: 'Read-only while it runs',

  // As ferramentas da aba Steps.
  tools: 'Insert steps',                        // nome da barra, para o leitor de tela
  addStep: 'Add step',                          // botão que abre o catálogo, e o nome do catálogo · orçamento: o da fileira
  click: 'Click',                               // botão rápido · nome do Add step (glossário)
  clickTip: 'A left click at the cursor',
  key: 'Key',                                   // glossário
  keyTip: 'Opens in the Inspector, listening for the key',
  text: 'Text',                                 // glossário
  textTip: 'Opens in the Inspector: the step is added with its first text',
  undoTip: '{{>common.actions.undo}} (Ctrl+Z)',
  redoTip: '{{>common.actions.redo}} (Ctrl+Y)',

  // O catálogo Add step: os grupos à esquerda, os tipos de passo à direita, a pesquisa em cima.
  search: 'Search steps',                       // nome do campo, para o leitor de tela
  searchPlaceholder: { one: 'Search {{count}} step type', other: 'Search {{count}} step types' },  // count = os tipos oferecidos
  groupsLabel: 'Step groups',                   // nome da coluna dos grupos, para o leitor de tela
  matching: 'Matching steps',                   // nome da lista durante a pesquisa
  noMatch: 'No step type matches “{{query}}”.', // query = o que foi digitado
  onlyInLoop: 'Only inside a loop',             // dica de Break loop e Next iteration fora de um loop
  // Depois da descrição de For Each Data Row: as linhas da tabela do Data Loop.
  tableRows: { zero: 'the table is empty', one: '{{count}} row', other: '{{count}} rows' },
  notBuilt: 'not built yet',                    // um tipo ainda sem editor; só no build de desenvolvimento
  // O rodapé: onde o passo entra (no ponto de inserção, depois do último passo selecionado). step = o número dele.
  intoEmpty: 'Inserts into the empty macro',
  after: 'Inserts after step {{step}}',
  atEnd: 'Inserts at the end, after step {{step}}',
  keysHint: 'Enter inserts · Esc closes',

  // Os grupos (as abas à esquerda) · orçamento: 121 px, e os mais longos quebram a linha com +15%.
  groups: {
    input: 'Input',
    wait: 'Wait',
    flow: 'Conditions and loops',
    checks: 'Checks and endings',
    variables: 'Variables',
    windows: 'Windows and macros',
    browser: 'Browser',
  },

  // O que cada tipo de passo faz, em uma linha · orçamento: 311–478 px (Add step e Ctrl+K).
  desc: {
    click: 'A mouse click at a point or at the cursor',
    key: 'A key or a combination, pressed or held',
    text: 'Types or pastes text, with tokens',
    scroll: 'Turns the mouse wheel up or down',
    pause: 'Wait for a key or a timeout',
    waitImage: 'Until an image shows up on screen',
    waitPixel: 'Until a point on screen turns a color',
    waitText: 'Until text shows up on screen, read by OCR',
    waitUntil: 'Window open, process, clipboard, variable, file or time',   // as condições que ele espera (Window open: glossário)
    if: 'Runs the steps inside only when a check passes',
    while: 'Repeats the steps inside while a check passes',
    forEachRow: 'Repeats the steps inside once per Data Loop row',
    break: 'Leaves the loop it is in',
    next: 'Skips to the next pass of the loop',
    assert: 'Stops the run when a check fails',
    stop: 'Ends the run here',
    return: 'Ends this pass, or goes back to the macro that ran it',
    setVariable: 'Stores a value under a name',
    copyToSlot: 'Copies the selection of the app in front into a named slot',
    activateWindow: 'Brings a window to the front, or opens it',
    runMacro: 'Runs another macro, then comes back',
    openUrl: 'Opens a page in the browser',
    clickElement: 'Clicks an element of the page',
    rightClickElement: 'Right-clicks an element of the page',
    typeText: 'Types into a field of the page',
    selectOption: 'Picks an option in a list of the page',
    waitElement: 'Until an element shows up on the page',
    assertElement: 'Stops the run when the page lacks an element',
  },

  // As palavras que a pesquisa conhece além do nome e da descrição, separadas por espaço. Não
  // aparecem na tela. Em pt-BR: as palavras em português e os nomes do glossário que a tela mostra.
  words: {
    browser: 'browser web page site extension element selector',   // as de todo passo de navegador
    click: 'mouse left right middle double triple hold press tap',
    key: 'keystroke keyboard press hold shortcut hotkey combo',
    text: 'send type paste write string message',
    scroll: 'wheel mouse up down',
    pause: 'delay sleep time timeout resume hold',
    waitImage: 'picture screenshot find appear capture',
    waitPixel: 'pixel colour point',
    waitText: 'ocr read screen disappear change',
    waitUntil: 'condition state',
    if: 'condition branch check else image pixel window',
    while: 'loop repeat until condition',
    forEachRow: 'loop table rows csv',
    break: 'exit stop',
    next: 'continue skip',
    assert: 'require verify condition fail',
    stop: 'end halt finish',
    return: 'exit back',
    setVariable: 'var value counter cycle screen ocr',
    copyToSlot: 'clipboard copy clip',
    activateWindow: 'focus app program launch maximize minimize close',
    runMacro: 'profile call sub chain',
    openUrl: '{{>insert.words.browser}} url link website navigate',
    clickElement: '{{>insert.words.browser}}',
    rightClickElement: '{{>insert.words.browser}}',
    typeText: '{{>insert.words.browser}}',
    selectOption: '{{>insert.words.browser}} dropdown',
    waitElement: '{{>insert.words.browser}}',
    assertElement: '{{>insert.words.browser}}',
  },
} as const;
