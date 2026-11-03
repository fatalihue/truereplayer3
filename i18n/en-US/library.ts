// A biblioteca de macros (shell/library/): o painel, a coluna recolhida, as pastas, os menus New ▾ e ⋯
// (libraryMenus.ts, que o Ctrl+K também mostra), os diálogos (LibraryDialogs.tsx) e a exportação
// (ExportDialog.tsx). O menu da macro está em macro.ts. Em pt-BR, "a macro", no feminino.
export default {
  // Os nomes de sempre da biblioteca.
  newMacro: 'New macro',          // item do New ▾ (e do Ctrl+K) e o "+ New macro" no fim de uma pasta aberta
  newFolder: 'New folder',        // item do New ▾ (e do Ctrl+K) e o título do diálogo da pasta nova
  pinned: 'Pinned',               // título do grupo das macros fixadas, no topo da lista e na exportação
  ungrouped: 'Ungrouped',         // título do grupo das macros fora de pasta, na lista e na exportação
  windowTarget: 'Window target',  // dica do ícone de uma macro com janela-alvo sem processo nem título
  swatch: 'Color {{color}}',      // nome de uma cor da grade de cores (leitor de tela) · color = o código, "#3b82f6"
  cantRunItself: 'A macro can’t run itself',  // aviso: a macro aberta solta sobre os próprios passos

  // A nota das áreas que esperam as macros enquanto o Clicker está ligado (a lista, a fileira de
  // inserção, o Inspector, o Data Loop): o caminho de volta.
  clickerOn: {
    key: 'The Clicker is on — {{keys}} brings the macros back',  // keys = a hotkey do modo Clicker, "Ctrl+F9"
    rail: 'The Clicker is on — {{>common.pages.macros}}, in the rail, brings them back',  // sem hotkey: o destino do trilho
  },

  // O painel (LibraryPanel.tsx), de cima para baixo. O título é common.pages.macros, e o botão New é
  // common.actions.new.
  panel: {
    more: 'More macro actions',               // botão ⋯ do cabeçalho: o nome e a dica; também o nome do menu
    collapseFolders: 'Collapse all folders',  // botão das pastas com alguma aberta: o nome e a dica
    expandFolders: 'Expand all folders',      // o mesmo botão com todas fechadas
    search: 'Search macros',                  // nome do campo de busca (leitor de tela)
    searchHint: 'Search · # for tags',        // o texto de dentro do campo vazio; # pesquisa as tags · orçamento: o campo, ~12 rem
    list: 'Macro list',                       // nome da lista (leitor de tela)
    locked: 'Stop the run to open another macro',  // dica do nome de outra macro enquanto uma execução roda
  },

  // A linha de uma macro (MacroRow.tsx).
  row: {
    armed: 'Automation armed',  // o ponto de uma macro com automação armada: o nome e a dica
    // As dicas dos chips do gatilho. chip = o texto do chip: a hotkey ("Ctrl+F1") ou a hotstring ("/id").
    conflict: '{{chip}} — Another macro uses this hotkey for the same window — only one fires',
    hotstringInstant: '{{chip}} — Hotstring — fires as you type it',
    hotstringEnd: '{{chip}} — Hotstring — fires on Enter, Space or Tab',
  },
  // O modo do gatilho, no ícone ao lado da hotkey (o padrão, ao apertar, não tem ícone): o nome e a
  // dica. Os mesmos nomes do segmentado do gatilho no Inspector.
  modes: {
    onRelease: 'On release',
    whilePressed: 'While pressed',   // a hotkey (feminino em pt-BR) segue apertada
    toggle: 'Toggle',
    doubleTap: 'Double-tap',
    hold: 'Hold (long-press)',
  },

  // Uma pasta (FolderCard.tsx). name = o nome da pasta.
  folder: {
    count: { one: '{{count}} macro', other: '{{count}} macros' },  // nome do número ao lado do nome (leitor de tela)
    more: 'More actions for {{name}}',  // nome do ⋯ da pasta (leitor de tela)
    actions: 'Folder actions',          // dica do ⋯ da pasta
    newMacroIn: 'New macro in {{name}}',  // nome do "+ New macro" da pasta (leitor de tela)
  },

  // A coluna recolhida (LibraryFolded.tsx): avatares no lugar das linhas.
  folded: {
    nav: 'Macros, collapsed',       // nome da coluna (leitor de tela)
    expand: 'Expand macro list',    // botão do topo: o nome e a dica; põe o painel sobre os passos
    close: 'Close macro list',      // o mesmo botão com o painel aberto
    disabled: 'disabled',           // um dos fatos da dica do avatar, entre " · " · minúscula; a macro (feminino)
    // O avatar "+N" das macros que não couberam: o nome (leitor de tela) e os fatos da dica, entre " · ".
    more: { one: '{{count}} more macro', other: '{{count}} more macros' },
    moreTip: '{{n}} more',
    armed: { one: '{{count}} armed', other: '{{count}} armed' },  // count = as automações armadas entre elas (feminino)
    conflicts: '{{n}} in conflict',                               // n = as hotkeys em conflito entre elas
  },

  // Os itens do New ▾ (newMacro e newFolder, acima) e do ⋯ do cabeçalho (libraryMenus.ts): infinitivo, sem artigo.
  menu: {
    fromExample: 'From an example…',     // abre a galeria dos exemplos
    importMacros: 'Import macros…',
    exportMacros: 'Export macros…',
    openFolder: 'Open macros folder',    // abre a pasta das macros no Explorador
  },
  // O menu de uma pasta (Library.tsx): o clique direito e o ⋯ dela. Rename… é common.actions.renameEllipsis.
  folderMenu: {
    color: 'Color',                  // submenu com as 24 cores
    windowTarget: 'Window target…',  // abre o diálogo da janela-alvo da pasta
    enableAll: 'Enable all',         // ativa as macros da pasta (feminino em pt-BR)
    disableAll: 'Disable all',
    delete: 'Delete folder',
  },

  // Os diálogos (LibraryDialogs.tsx). name = o nome da macro ou da pasta, entre aspas e destacado.
  rename: {
    macroTitle: 'Rename macro',
    folderTitle: 'Rename folder',
    // O texto do campo vazio; sem as reticências, o nome do campo (leitor de tela).
    macroPlaceholder: 'New name…',
    folderPlaceholder: 'New folder name…',
    macroTaken: 'A macro with that name already exists.',   // erro sob o campo; Rename fica desativado
    folderTaken: 'A folder with that name already exists.',  // o mesmo, no diálogo da pasta nova também
  },
  newFolderDialog: {
    placeholder: 'Folder name…',  // o texto do campo vazio
    name: 'Folder name',          // nome do campo (leitor de tela) e a prévia enquanto o campo está vazio
    preview: 'preview',           // marca da prévia da pasta, à direita · minúscula
    create: 'Create',             // botão principal · verbo
  },
  delete: {
    title: 'Delete macro',
    question: 'Delete macro {{name}}?',
    note: "Its file and its images are deleted. This can't be undone.",
  },
  revert: {
    title: 'Revert macro',
    question: 'Put {{name}} back the way it was when you opened it?',
    note: "The changes since then are lost, and Ctrl+Z can't bring them back.",
    button: 'Revert',  // botão principal · verbo
  },
  clear: {
    title: 'Clear all steps',
    // count = os passos da macro aberta (o diálogo fecha sozinho com nenhum); n = o mesmo número, formatado.
    question: { one: 'Clear all {{n}} step of {{name}}?', other: 'Clear all {{n}} steps of {{name}}?' },
    note: 'Ctrl+Z brings them back.',
    button: 'Clear all',  // botão principal · verbo
  },
  // A janela-alvo de uma pasta: os campos do Inspector num diálogo, para as macros dela sem alvo próprio.
  folderTarget: {
    title: 'Folder window target',
    intro: 'For every macro in {{name}} without a target of its own.',
    set: 'Set target',  // botão principal · verbo
    readNote: "Read the note about this folder's macros first",  // dica de Set target enquanto a nota pede leitura
    // As chaves, com o nome ao lado e na dica.
    relative: 'Relative coordinates',
    relativeTip: "The points of its macros' steps follow the window when it moves",
    focus: 'Bring to focus',
    focusTip: 'Brings the window to the front before a run. With it on, the hotkeys work from any window.',
    restorePosition: 'Restore position',
    restorePositionTip: 'Puts the window back where it was captured, before a run',
    restoreSize: 'Restore size',
    restoreSizeTip: 'Puts the window back to the captured size, before a run',
    update: 'Update window size & position',  // botão · verbo
    updateTip: 'Reads where the window is now, and its size, for {{>library.folderTarget.restorePosition}} and {{>library.folderTarget.restoreSize}}',
    // A nota que segura Set target quando Relative coordinates muda e macros da pasta usam o alvo dela.
    // count = essas macros. A primeira: a pasta estava em relativas; a segunda, em absolutas. O nome do
    // comando vem do Ctrl+K (palette.cmd), para nunca ficar diferente do que ele mostra.
    noteWasRelative: {
      one: "{{count}} macro in this folder uses its target, with X/Y set for relative coords. They are not converted: if a macro's clicks land in the wrong place, open it and run “{{>palette.cmd.toAbsolute}}” (Ctrl+K).",
      other: "{{count}} macros in this folder use its target, with X/Y set for relative coords. They are not converted: if a macro's clicks land in the wrong place, open it and run “{{>palette.cmd.toAbsolute}}” (Ctrl+K).",
    },
    noteWasAbsolute: {
      one: "{{count}} macro in this folder uses its target, with X/Y set for absolute coords. They are not converted: if a macro's clicks land in the wrong place, open it and run “{{>palette.cmd.toRelative}}” (Ctrl+K).",
      other: "{{count}} macros in this folder use its target, with X/Y set for absolute coords. They are not converted: if a macro's clicks land in the wrong place, open it and run “{{>palette.cmd.toRelative}}” (Ctrl+K).",
    },
    gotIt: 'Got it',  // botão da nota
    // Aviso de Remove, com Undo. target = o processo ou o título do alvo removido; name = a pasta.
    removed: 'Removed folder target ({{target}}) from "{{name}}"',
    targetFallback: 'target',  // o alvo sem processo nem título, dentro do aviso acima
  },

  // A exportação (ExportDialog.tsx). Cancel e Export são common.actions.
  export: {
    title: 'Export macros',
    filter: 'Filter macros',             // nome do campo (leitor de tela)
    filterPlaceholder: 'Filter macros…', // o texto do campo vazio
    clearFilter: 'Clear filter',         // o x do campo e o botão sob "nenhuma corresponde"
    selectAll: 'Select all',             // a caixa que marca as macros que aparecem
    none: 'No macros to export.',        // a biblioteca está vazia
    noMatch: 'No macros match "{{filter}}"',  // filter = o texto do filtro
    // Os passos de cada macro, à direita da linha. count = os passos; n = o mesmo número, formatado.
    steps: { one: '{{n}} step', other: '{{n}} steps' },
    // O rodapé: as escolhidas e, depois de " · ", as escolhidas que o filtro esconde.
    selected: { one: '{{count}} selected', other: '{{count}} selected' },
    hiddenByFilter: { one: '{{count}} hidden by filter', other: '{{count}} hidden by filter' },
    organization: 'Include folder organization',            // a caixa sob a lista
    organizationTip: 'Pins, folders, order and folder targets',  // a dica dela
    // As macros que as escolhidas rodam (Run Macro) vão junto. names = os nomes, separados por vírgula.
    alongTip: 'Run by the chosen macros: {{names}}',
    along: { one: '+{{count}} macro it runs is included', other: '+{{count}} macros they run are included' },
  },
} as const;
