// Ctrl+K (shell/palette/CommandPalette.tsx e commands.ts): um campo que acha uma macro para abrir, um
// passo da macro aberta para ir até ele e todos os comandos. Cada comando tem o rótulo (verbo no
// infinitivo, como item de menu), um detalhe depois dele (de onde vem) e as palavras que também o
// acham, nunca mostradas. Os itens dos menus da macro, da biblioteca e do passo vêm desses menus (as
// áreas deles); aqui está só o que o Ctrl+K escreve por conta própria.
// Largura: o rótulo tem até 60% de 40 rem e corta com reticências; o detalhe ocupa o resto, e corta.
export default {
  search: 'Search macros, steps and commands',  // o campo (texto de exemplo e nome) e o nome do diálogo · verbo + objetos
  results: 'Results',                           // nome da lista de resultados, para o leitor de tela

  // Os títulos dos grupos de resultados (caixa pequena, em cima de cada grupo).
  groups: {
    macros: 'Macros',      // igual nos dois idiomas
    steps: 'Steps',        // os passos da macro aberta
    commands: 'Commands',
  },

  // O rodapé, uma linha: ↑↓ andam, Enter roda o que está marcado, ">" no começo procura só comandos.
  foot: '↑↓ move · Enter opens · type > for commands only',
  footNone: 'Search looks in macro names, step notes and every command.',  // quando nada bate

  // Nada bate com o que foi digitado. query = o texto digitado, entre aspas.
  noneMatch: 'No macros, steps or commands match “{{query}}”.',
  noCommandsMatch: 'No commands match “{{query}}”.',   // com ">" na frente: só comandos
  nothingMatches: 'Nothing matches “{{query}}”.',
  createMacro: 'Create macro “{{name}}”',               // a saída: cria uma macro com esse nome · name = o texto digitado
  lookInExamples: 'Look for “{{query}}” in the examples',  // a saída: abre os exemplos já pesquisando isso

  // As dicas de um comando desligado (ao passar o mouse): o porquê, curto.
  hint: {
    clickerOn: 'The Clicker is on',                 // o modo Clicker trava os passos da macro
    stopRecording: 'Stop the recording first',      // Replay durante uma gravação
    stopRun: 'Stop the run first',                  // Record durante uma execução
    onlyInLoop: 'Only inside a loop',               // Break loop e Next iteration fora de um loop
    nothingToUndo: 'Nothing to undo',
    nothingToRedo: 'Nothing to redo',
    noFolders: 'There are no folders',              // Collapse/Expand all folders sem pasta nenhuma
    automationPerMacro: 'Every macro has its automation: one per macro',  // New automation sem macro livre
    remapLimit: '{{max}} is the limit',             // New remap com a lista cheia · max = o número máximo
    stopRunOrRecording: 'Stop the run or the recording first',  // Reset all settings… durante uma execução
  },

  // Os comandos: verbo no infinitivo, sem artigo, como item de menu. name = o nome da macro aberta.
  cmd: {
    stopRun: 'Stop the run',
    replay: 'Replay {{name}}',
    stopRecording: 'Stop recording',
    recordInto: 'Record into {{name}}',             // grava passos novos nessa macro
    addStep: 'Add {{kind}}',                        // kind = o nome do passo no Add step (glossário: Click, Key, Wait until…)
    addElseIf: 'Add Else If to this If…',
    addElse: 'Add Else to this If',
    selectAll: 'Select all steps',
    paste: 'Paste steps',
    copyTable: 'Copy all steps as a table',
    toRelative: 'Convert coordinates to relative',
    toAbsolute: 'Convert coordinates to absolute',
    toCombined: 'Convert steps to combined',        // Down + Up viram uma linha só
    toPaired: 'Convert steps to paired',            // cada clique e tecla vira Down + Up
    collapseFolders: 'Collapse all folders',
    expandFolders: 'Expand all folders',
    shortcutsOff: 'Turn Shortcuts off',             // a chave geral dos atalhos (barra de status)
    shortcutsOn: 'Turn Shortcuts on',
    automationsOff: 'Turn Automations off',
    automationsOn: 'Turn Automations on',
    remapsOff: 'Turn Key Remaps off',
    remapsOn: 'Turn Key Remaps on',
    newAutomation: 'New automation',
    newRemap: 'New remap',
    resetAll: 'Reset all settings…',                // pergunta antes, em Settings
    extension: 'Connect browser extension',
    compact: '{{>titlebar.compact}}',               // o mesmo nome do botão da barra de título
    reload: 'Reload UI',
    dataFolder: 'Open data folder',
    logsFolder: 'Open logs folder',
    diagnostics: 'Copy diagnostics',
    manual: 'Open manual',
  },

  // O detalhe depois do rótulo: de onde a linha vem. Cinza, menor, e corta com reticências.
  detail: {
    pinned: 'Pinned',                  // uma macro fixada no topo da biblioteca (em pt-BR, a macro: feminino)
    stepOf: '{{macro}} · step {{n}}',  // depois do que o passo faz · macro = a macro aberta; n = o número do passo
    stepN: 'Step {{n}}',               // o passo selecionado, nos comandos do menu do passo · n = o número dele
    steps: { one: '{{count}} step', other: '{{count}} steps' },  // os passos selecionados, nos mesmos comandos (2 ou mais)
    ifAt: 'If at step {{n}}',          // o If do bloco · n = o número do passo do If
    macro: 'Macro',                    // os itens do menu da macro
    library: 'Library',                // os itens do New ▾ e do ⋯ da biblioteca, e as pastas
  },

  // O que um passo faz, como texto, no detalhe dele.
  step: {
    atCursor: 'at the cursor',         // um clique sem ponto: clica onde o cursor estiver · minúscula
    keyOrTime: '{{key}} or {{time}}',  // um Pause: a tecla que o solta ou o tempo · time = "500 ms"
  },

  // O menu da macro aberta dito com o nome dela ("Export Trade Roblox…"). name = o nome da macro;
  // target = o nome da pasta para onde ela vai. Verbo no infinitivo, como item de menu.
  macro: {
    rename: 'Rename {{name}}…',
    duplicate: 'Duplicate {{name}}',
    moveTo: 'Move {{name}} to {{target}}',
    takeOut: 'Take {{name}} out of its folder',
    pin: 'Pin {{name}}',
    unpin: 'Unpin {{name}}',
    export: 'Export {{name}}…',
    explorer: 'Open {{name}} in Explorer',           // o Explorador de Arquivos do Windows
    revert: 'Revert {{name}} to when you opened it',
    close: 'Close {{name}}',
    disable: 'Disable {{name}}',
    enable: 'Enable {{name}}',
    delete: 'Delete {{name}}…',
    item: '{{label}} · {{name}}',                    // os outros itens · label = o item do menu (Hotkey…, Window target…)
  },

  // As palavras que também acham cada linha, nunca mostradas: separadas por espaço, sem acento ou com,
  // tanto faz. Em pt-BR, palavras em português e os nomes do glossário como a tela os escreve.
  words: {
    disabled: 'disabled',              // uma macro desativada
    open: 'open',                      // a macro aberta
    examples: 'browse examples sample starter',      // From an example…, no New ▾ da biblioteca
    paste: 'clipboard',
    copyTable: 'tsv export spreadsheet clipboard',
    toRelative: 'window rebase',
    toAbsolute: 'screen rebase',
    toCombined: 'merge keystroke click',
    toPaired: 'split down up',
    folders: 'folders fold unfold open close all collapse expand',
    runReport: 'debug trace timeline failed why last run',
    liveVariables: 'debug variables slots clip row',
    shortcuts: 'profile keys hotkeys hotstrings pause',
    automations: 'triggers armed',
    remaps: 'remap keys',
    clicker: 'autoclicker auto clicker click mode presets cps rate',
    automationsPage: 'automation triggers trigger schedule timer interval every condition watch armed run by itself',
    newAutomation: 'add automation trigger schedule timer interval condition',
    remapsPage: 'remap remaps keys rebind swap caps disable mouse button',
    newRemap: 'add remap rebind key swap disable',
    // Settings, onde mora a escolha do idioma: achado por estas palavras nos DOIS idiomas.
    settings: 'preferences options configuration language idioma lingua portugues english',
    hotkeys: 'shortcut keys global record replay foreground clicker conflict suggested',
    appearance: 'theme themes dark light accent color colour density text size font zoom motion animations corner',
    recording: 'delay timing jitter game mode return cursor fast approach',
    screen: 'ocr language install read text',
    resetAll: 'defaults restore factory',
    extension: 'chrome edge brave extension unpacked install disconnected',
    compact: 'small mini picture in picture always on top overlay corner float',
    reload: 'refresh stuck frozen',
    dataFolder: 'documents files backup copy macros images settings explorer',
    logsFolder: 'diagnostics session log support',
    diagnostics: 'support version bug report system info about',
    manual: 'help docs documentation guide ajuda',
  },
} as const;
