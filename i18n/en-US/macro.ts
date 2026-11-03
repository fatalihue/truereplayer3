// O menu da macro (shell/macroMenu.ts): o clique direito numa macro da biblioteca e o ⋯ do cabeçalho
// da macro aberta. O Ctrl+K mostra os mesmos itens. Itens de menu: infinitivo, sem artigo (§4.2).
// Rename…, Duplicate, Pin, Unpin e Export… são common.actions.
export default {
  menu: {
    moveToFolder: 'Move to folder',           // submenu com as pastas
    noFolders: 'No folders',                  // o único item, desativado, do submenu quando não há pasta
    removeFromFolder: 'Remove from folder',   // no fim do submenu, com a macro numa pasta
    // Abrem as configurações da macro no Inspector, no campo de cada um.
    hotkey: 'Hotkey…',                        // coringa
    hotstring: 'Hotstring…',                  // coringa
    windowTarget: 'Window target…',
    editInfo: 'Edit info…',                   // a descrição e as tags
    openInExplorer: 'Open in Explorer',       // mostra o arquivo da macro no Explorador de Arquivos
    // Só na macro aberta.
    close: 'Close macro',                     // volta a "nenhuma macro aberta"
    revert: 'Revert to when I opened it',     // abre o diálogo que confirma
    clearSteps: 'Clear all steps…',           // abre o diálogo que confirma
    enable: 'Enable',                         // liga a macro desativada · verbo
    disable: 'Disable',
    delete: 'Delete macro…',                  // abre o diálogo que confirma
  },
  // As dicas dos itens desativados: por que não agora.
  locked: {
    run: 'Stop the run first',                // uma execução ou uma gravação está rodando
    clicker: 'The Clicker is on',
    noSteps: 'There are no steps to clear',   // Clear all steps… numa macro vazia
  },
} as const;
