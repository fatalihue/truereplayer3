// Palavras e nomes usados em vários lugares da interface.
export default {
  // Os destinos do trilho, que também dão nome às páginas.
  pages: {
    macros: 'Macros',            // trilho e título da página · igual nos dois idiomas (glossário)
    clicker: 'Clicker',          // glossário
    automations: 'Automations',  // trilho, título da página e barra de status · nome
    remaps: 'Key Remaps',        // glossário
    settings: 'Settings',        // trilho e título da página · nome
  },

  // Os nomes que o app dá e que viram nome de arquivo: nascem no idioma da interface e depois são do
  // usuário (§2.4). shell/untitled.ts reconhece os dois idiomas.
  names: {
    untitledMacro: 'Untitled macro',  // a macro nova, ainda sem nome; "Untitled macro 2" a seguinte
  },

  // Botões e itens de menu que dizem só isto, em qualquer tela: infinitivo, sem artigo. Quando a tela
  // diz mais ("Delete macro…"), a frase inteira fica na área dela.
  actions: {
    cancel: 'Cancel',
    close: 'Close',
    ok: 'OK',
    save: 'Save',
    apply: 'Apply',
    done: 'Done',
    continue: 'Continue',
    delete: 'Delete',
    deleteEllipsis: 'Delete…',
    rename: 'Rename',
    renameEllipsis: 'Rename…',
    duplicate: 'Duplicate',
    open: 'Open',
    undo: 'Undo',
    redo: 'Redo',
    copy: 'Copy',
    paste: 'Paste',
    clear: 'Clear',
    clearSearch: 'Clear search',
    search: 'Search',
    import: 'Import',
    importEllipsis: 'Import…',
    export: 'Export',
    exportEllipsis: 'Export…',
    reset: 'Reset',
    more: 'More',
    test: 'Test',
    edit: 'Edit',
    add: 'Add',
    remove: 'Remove',
    new: 'New',
    pin: 'Pin',
    unpin: 'Unpin',
    record: 'Record',      // verbo · botão do cabeçalho
    replay: 'Replay',      // verbo · botão do cabeçalho
    stop: 'Stop',          // verbo (o passo Stop é outro, do glossário)
    pause: 'Pause',        // verbo (o passo Pause é outro, do glossário)
    resume: 'Resume',
  },
} as const;
