// O motor: a bandeja (Source/WindowShellServices.cs, TrayIconService; Source/TrayPanel.cs; a linha da
// macro aberta no painel vem de Source/MainWindow.xaml.cs). São do Windows e saem com a janela
// escondida, então o texto vem daqui e é lido na hora de mostrar: a dica a cada mudança de estado, o
// menu a cada clique direito, o painel a cada vez que abre.
// Nas lacunas: app = o nome deste app (marca, igual nos dois idiomas); macro = o nome da macro
// aberta, já cortado; key = uma hotkey como o keycap a escreve ("Ctrl+Alt+Shift+W"); n = uma
// contagem, já formatada (S.Num); clock = o relógio da execução ("1:05").
export default {
  // A dica do ícone (passar o mouse): o app, um travessão e o estado. O Windows corta em 127 letras.
  tip: {
    ready: '{{app}} — Ready',
    // Parado, com automações armadas.
    readyArmed: { one: '{{app}} — Ready · {{n}} automation armed', other: '{{app}} — Ready · {{n}} automations armed' },
    // Parado, com automações armadas e a chave geral delas desativada.
    readyPaused: '{{app}} — Ready · automations paused',
    recording: '{{app}} — Recording',                  // sem macro aberta
    recordingMacro: '{{app}} — Recording {{macro}}',
    replaying: '{{app}} — Replaying',                  // sem macro aberta
    replayingMacro: '{{app}} — Replaying {{macro}}',
    // Uma execução com mais de uma volta · current = a volta; total = quantas, ou ∞.
    replayingLoop: '{{app}} — Replaying, loop {{current}} of {{total}}',
    replayingMacroLoop: '{{app}} — Replaying {{macro}}, loop {{current}} of {{total}}',
    clicking: '{{app}} — Clicking',                    // o Clicker rodando
    clickerOpen: '{{app}} — Clicker open',             // o modo Clicker, parado, sem hotkey para começar
    clickerOpenKey: '{{app}} — Clicker open · {{key}} starts',
    // Os atalhos desativados; os Key Remaps pausam com eles quando estão ativados.
    shortcutsRemapsPaused: '{{app}} — Shortcuts and remaps paused',
    shortcutsPaused: '{{app}} — Shortcuts paused',
    // Avisos guardados enquanto a janela estava escondida (o ícone de "precisa de atenção").
    notices: { one: '{{app}} — {{n}} notice while you were away', other: '{{app}} — {{n}} notices while you were away' },
  },

  // O menu do clique direito. O & marca a letra de acesso (sublinhada quando o menu abre pelo
  // teclado): uma letra diferente para cada item do mesmo menu. A tecla à direita vem do código.
  menu: {
    open: '&Open {{app}}',
    // Parar: só enquanto algo roda, com a hotkey que para de qualquer lugar.
    stopRecording: '&Stop recording',
    stopClicker: '&Stop the Clicker',
    stopMacro: '&Stop {{macro}}',     // macro = a macro rodando, cortada em 40 letras
    stop: '&Stop',                    // uma execução sem macro aberta
    recordNew: '&Record a new macro',
    shortcuts: 'S&hortcuts',          // chave: marcada com os atalhos ativados
    automations: '&Automations…',     // abre a página Automations
    remaps: '&Key Remaps',            // chave: marcada com os Key Remaps ativados
    clicker: '&Clicker',              // abre a página do Clicker; marcada no modo Clicker
    settings: 'Se&ttings',
    troubleshoot: 'Tro&ubleshoot',    // submenu com os três itens abaixo
    // Do submenu Troubleshoot: o caminho de volta quando a própria página quebrou. Os mesmos textos
    // da página (Settings › Diagnostics e o Ctrl+K).
    reloadUi: '&Reload UI',
    devTools: 'Open &DevTools',
    logs: 'Open &logs folder',
    quit: '&Quit',
  },

  // O painel do clique no ícone.
  panel: {
    open: 'Open',                     // botão do cabeçalho: mostra a janela · verbo
    // Os avisos guardados enquanto a janela estava escondida, com a hora de cada um.
    notices: { one: '{{n}} notice while you were away', other: '{{n}} notices while you were away' },
    clear: 'Clear',                   // link: tira os avisos guardados · verbo
    noMacro: 'No macro open',         // no lugar do nome da macro
    macros: 'Macros',                 // título da lista (glossário)
    // A lista vazia. Ela mostra as fixadas e as que têm hotkey, até cinco, e esconde as desativadas.
    macrosEmpty: 'Pinned macros and macros with a hotkey show up here, unless disabled.',
    running: 'Running',               // ao lado da macro da lista que está rodando
    allMacros: 'All macros…',         // link: mostra a página Macros
    // As chaves gerais, com o detalhe ao lado do nome.
    shortcuts: 'Shortcuts',
    automations: 'Automations',
    remaps: 'Key Remaps',
    // A chave do Teclado (branch teclado), e quantos jogos ele tem ativados.
    teclado: 'Keyboard',
    tecladoGames: { one: '· {{n}} game', other: '· {{n}} games' },
    // O jogo travado na página Teclado ("Travar neste jogo"), e o link que o destrava daqui.
    tecladoLocked: '· locked to {{game}}',
    tecladoUnlock: 'Unlock {{game}}',
    // A chave do Deck (branch deck), e quantos decks ele tem ativados.
    deck: 'Deck',
    deckCount: { one: '· {{n}} deck', other: '· {{n}} decks' },
    armed: { one: '· {{n}} armed', other: '· {{n}} armed' },     // as automações armadas
    active: { one: '· {{n}} active', other: '· {{n}} active' },  // os remaps ativados
    clicker: 'Clicker',               // botão: abre a página do Clicker
    clickerOpen: 'Clicker · open',    // o mesmo, com a página do Clicker aberta
    settings: 'Settings',             // botão do rodapé
    // O botão do rodapé diz só o verbo, como o menu do clique direito: com o nome do app ao lado, o
    // "Configurações" do pt-BR não cabia nos 320 px do painel. O nome para o leitor de tela leva o app.
    quit: 'Quit',                     // botão do rodapé · verbo
    quitName: 'Quit {{app}}',         // o nome do mesmo botão para o leitor de tela
  },

  // O cartão da macro aberta, no painel: a linha sob o nome e o botão dela.
  card: {
    recording: { one: 'Recording · {{n}} step · {{clock}}', other: 'Recording · {{n}} steps · {{clock}}' },
    clicking: 'Clicking · {{clicks}} · {{clock}}',   // clicks = os cliques, já formatados
    replaying: 'Replaying · {{clock}}',
    // current = a volta; total = quantas, ou ∞.
    replayingLoop: 'Replaying · loop {{current}} of {{total}} · {{clock}}',
    clickerOpen: 'Clicker open',
    clickerOpenKey: 'Clicker open · {{key}} starts',
    ready: { one: 'Ready · {{n}} step', other: 'Ready · {{n}} steps' },
    noMacro: 'Open a macro in the window to run it from here.',
    stop: 'Stop',                     // botão, enquanto algo roda · verbo
    replay: 'Replay',                 // botão: roda a macro aberta · verbo
  },
} as const;
