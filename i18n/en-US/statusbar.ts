// A barra de status (shell/StatusBar.tsx e shell/statusbar/StatusLive.tsx): as três chaves gerais, a
// extensão do navegador, o "salvo" e a versão. Cada estado de cada chave é uma frase inteira, porque
// em português "ativados" concorda com o item.
export default {
  switches: 'Master switches',                   // nome do grupo das chaves, para o leitor de tela

  shortcutsOn: 'Shortcuts On',
  shortcutsOff: 'Shortcuts Off',
  shortcutsPaused: 'Shortcuts Paused by Clicker',  // com a página do Clicker aberta
  // Desativados, o motor também deixa passar as hotkeys gerais que agem fora do app (Settings › Hotkeys:
  // a de gravar, a de reproduzir e as duas de copiar); as de gravar e reproduzir ainda param o que roda.
  shortcutsOnTip: "The macros' hotkeys and hotstrings fire. Off pauses them, the Key Remaps, and the record, replay and copy hotkeys.",
  shortcutsOffTip: "Off: the macros' hotkeys and hotstrings, the Key Remaps, and the record, replay and copy hotkeys are paused — record and replay only stop what is already running.",
  shortcutsPausedTip: "Paused while the Clicker page is open: the macros' hotkeys and hotstrings wait for it to close.",

  // count = as automações armadas.
  automationsOn: { one: 'Automations On · {{count}} armed', other: 'Automations On · {{count}} armed' },
  automationsOff: 'Automations Off',
  automationsOnTip: 'The armed automations run their macros when their trigger comes. Off holds them all.',
  automationsOffTip: 'Off: no automation runs, armed or not.',

  // count = os remaps ligados.
  remapsOn: { one: 'Key Remaps On · {{count}} active', other: 'Key Remaps On · {{count}} active' },
  remapsOff: 'Key Remaps Off',
  remapsPaused: 'Key Remaps paused',             // ligados, com os atalhos desligados
  remapsOnTip: 'The key remaps are in effect. They also pause while recording.',
  remapsOffTip: 'Off: every key does what it always does.',
  remapsPausedTip: 'On, but paused while the Shortcuts are off.',

  // A extensão do navegador; o clique abre Settings › Browser extension.
  extensionConnected: 'Extension connected',
  extensionNotConnected: 'Extension not connected',
  extensionReload: 'Extension needs reload',     // carregada numa versão mais velha que a do app
  extensionConnectedTip: 'The browser extension is connected',
  extensionNotConnectedTip: 'Browser actions fail and browser conditions read as not found. Click to connect the extension.',
  // current = a versão carregada; expected = a que o app espera.
  extensionReloadTip: 'Version {{current}} is loaded and this app expects {{expected}}. Reload it in chrome://extensions.',

  saved: 'Saved {{time}}',                       // time = a hora da última gravação do arquivo
  savedTip: 'Changes save as you go',
  notSaved: 'Not saved',                         // a dica é o erro do motor
} as const;
