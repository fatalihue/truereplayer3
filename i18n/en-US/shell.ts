// A casca: o que não é de uma área própria — o Ctrl+S e o desfazer da macro (shell/ShellKeys.tsx), o
// que o motor pede de fora da página (shell/watch.tsx), a importação do TrueReplayer 2
// (shell/importTr2.tsx, e o cartão do primeiro uso), o aviso de um aberto por vez (shell/coexist.tsx) e
// o "ainda não existe" do build de desenvolvimento (shell/Menu.tsx, shell/NotBuilt.tsx).
// Nas lacunas: app = o nome deste app e tr2 = o do TrueReplayer 2 (frontend/src/appIdentity.ts). São
// marcas, iguais nos dois idiomas.
export default {
  // Dica de um controle desligado durante uma execução ou gravação (Ctrl+K, os exemplos).
  busy: 'Not while a run or a recording is on',

  // Só no build de desenvolvimento: o que uma fatia ainda vai trazer. what = o nome da coisa (um item
  // de menu, "Click editor").
  notBuilt: '{{what}} — not built yet',

  // Ctrl+S e o desfazer da macro. Avisos.
  keys: {
    clickerOn: 'The Clicker is on — switch back to macros to save.',  // Ctrl+S com o Clicker ligado
    saved: 'Saved',                                                    // o Ctrl+S gravou a macro
    notSaved: 'Not saved — {{error}}',                                 // error = o erro do motor, ou couldNotWrite
    couldNotWrite: 'the file could not be written',                    // o erro quando o motor não diz qual · minúscula, vem depois do travessão
    reverted: 'Back to when you opened it',                            // a macro voltou a como estava ao abrir
  },

  // A bandeja pede uma página com um diálogo aberto por cima: o aviso pede para fechá-lo antes.
  refuse: {
    automations: 'Close the open dialog first, then open {{>common.pages.automations}} again.',
    browser: 'Close the open dialog first, then open {{>settings.categories.browser}} again.',
    deck: 'Close the open dialog first, then choose {{>engine-deck.menu.editInTr3}} on the deck again.',   // a deck's menu on screen (Fase 8)
  },

  // A importação do TrueReplayer 2: o diálogo, o cartão do primeiro uso e o aviso da abertura seguinte.
  import: {
    title: 'Import from {{tr2}}',              // título do diálogo e do cartão do primeiro uso · verbo
    intro: 'A copy of what {{tr2}} has. {{tr2}} itself is not changed.',
    notFound: "{{tr2}}'s data isn't on this computer.",
    closeTr2First: 'Close {{tr2}} first: its files must not change while they are copied.',  // o 2 está aberto
    // "Run on startup" é o ajuste de Settings › General que abre o app com o Windows.
    stayOff: 'Automations and “{{>settings.rows.runOnStartup.label}}” stay off here until you turn them on.',
    backupFirst: 'What {{app}} has now is kept in Documents\\{{dir}}\\Backups first.',  // dir = a pasta deste app em Documentos
    restarts: '{{app}} restarts to finish.',
    importing: 'Importing…',                   // o botão Import enquanto copia
    restarting: 'Restarting…',                 // o botão Import depois da cópia, até o app reiniciar

    // As partes que dá para trazer, cada uma uma linha com uma chave ao lado. count = quantos o 2 tem.
    macros: { one: '{{count}} macro', other: '{{count}} macros' },
    folders: { one: '{{count}} folder', other: '{{count}} folders' },
    images: { one: '{{count}} image', other: '{{count}} images' },
    remaps: { one: '{{count}} key remap', other: '{{count}} key remaps' },
    // macros, folderCount e imageCount = as contagens acima: "141 macros in 15 folders, with 2 images".
    macrosInFolders: '{{macros}} in {{folderCount}}',
    macrosWithImages: '{{macros}} with {{imageCount}}',
    macrosInFoldersWithImages: '{{macros}} in {{folderCount}}, with {{imageCount}}',
    settings: 'Settings and hotkeys',
    remapsLabel: 'Key remaps',                 // a linha dos remaps antes de o motor contar
    appearance: 'Theme and snippets',

    // O aviso da abertura que terminou a importação (15 s). count = as macros importadas.
    done: {
      one: 'Imported {{count}} macro from {{tr2}}. Automations are off in {{app}} — turn them on in {{>common.pages.automations}}.',
      other: 'Imported {{count}} macros from {{tr2}}. Automations are off in {{app}} — turn them on in {{>common.pages.automations}}.',
    },
    doneNoCount: 'Imported from {{tr2}}. Automations are off in {{app}} — turn them on in {{>common.pages.automations}}.',
  },

  // O TrueReplayer 2 foi aberto com este app aberto: só um roda por vez. O diálogo pergunta.
  coexist: {
    title: '{{tr2}} tried to open',
    why: 'Only one can run at a time: shortcuts, remapped keys, automations and the browser extension would clash.',
    switchCloses: 'Switching closes {{app}} — everything is already saved — and opens {{tr2}}.',
    closeAndOpen: 'Close {{app}} — everything is already saved — and open {{tr2}} again.',  // sem um 2 instalado para abrir
    stay: 'Stay here',                         // botão · verbo
    switchTo: 'Switch to {{tr2}}',             // botão · verbo · orçamento: o diálogo tem 22,5 rem, e os dois botões dividem a linha
    closeApp: 'Close {{app}}',                 // botão, sem um 2 instalado · verbo
  },
} as const;
