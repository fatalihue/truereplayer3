// Settings (shell/pages/settings/): a moldura da página (SettingsPage.tsx), as linhas de cada categoria
// (categories.tsx) e Settings › Hotkeys (hotkeys.tsx). Appearance, o painel dela e o editor de temas
// têm a área própria; daqui vêm só a frase sob o título dela e as palavras que a acham na busca.
//
// Cada linha tem o rótulo (rótulo da linha e, quando é o mesmo, o nome da chave ou do campo para o
// leitor de tela), a dica sob ele e as palavras que também a acham na busca, nunca mostradas:
// separadas por espaço, com acento ou sem (a busca ignora acentos). Em pt-BR, palavras em português e
// os nomes do glossário; cada catálogo tem as suas. Rótulos, dicas e frases quebram linha e não têm
// limite prático, salvo onde o comentário diz.
//
// Nas lacunas: app = o nome deste app e tr2 = o do TrueReplayer 2 (frontend/src/appIdentity.ts).
export default {
  // As categorias da página (a coluna da esquerda), que o Ctrl+K também cita.
  categories: {
    general: 'General',
    hotkeys: 'Hotkeys',                        // coringa
    appearance: 'Appearance',
    recording: 'Recording and playback',
    screen: 'Screen Text',                     // glossário
    browser: 'Browser extension',
    diagnostics: 'Diagnostics',
  },
  language: {
    label: 'Language',  // rótulo da linha e nome da lista (o leitor de tela lê) · nome
    hint: 'The language of the whole app. Windows follows the language of Windows.',  // sob o rótulo
    // As três opções da lista: cada idioma no próprio nome, para quem caiu no idioma errado achar o seu.
    windows: 'Windows',
    english: 'English',
    portugues: 'Português',
  },

  // A moldura: a lista das categorias (o título da página é common.pages.settings).
  categoriesLabel: 'Settings categories',  // nome da lista das categorias, para o leitor de tela

  // A busca sobre todas as configurações, no alto da coluna das categorias (~200 px).
  search: {
    field: 'Search settings',               // texto de exemplo do campo e nome dele · verbo + objeto
    results: 'Search results',              // nome da área dos resultados, para o leitor de tela
    none: 'No settings match “{{query}}”',  // nada bate · query = o texto digitado
  },

  // O rodapé da coluna das categorias: a versão e a atualização. Letra miúda, ~200 px, quebra linha.
  update: {
    readyVersion: '{{version}} is ready to install',  // uma atualização adiada espera · version = "3.0.1"
    ready: 'An update is ready to install',           // o mesmo, sem o número da versão
    restart: 'Restart and update',                    // link · verbo
    check: 'Check for updates',                       // link · verbo
    checking: 'Checking…',                            // o link enquanto procura
    upToDate: 'Up to date',                           // o link depois: o app está na última versão
    failed: 'Check failed — retry',                   // o link depois de um erro: procura de novo
  },

  // Reset all settings… (General › Reset): o botão da linha e o diálogo que pergunta antes. Os botões do
  // diálogo são common.actions.cancel e common.actions.reset.
  reset: {
    button: 'Reset…',                         // botão da linha: abre o diálogo · verbo
    title: 'Reset all settings',              // título do diálogo
    body: 'Every setting goes back to its default.',
    keeps: "Your macros, their steps and the Clicker presets stay. This can't be undone.",
  },
  // Dica de Reset… e de Import… desativados durante uma execução ou uma gravação: o porquê.
  busy: 'Stop the run or the recording first',

  // Os títulos dos grupos de linhas (caixa pequena, em cima de cada grupo) e as notas sob alguns.
  groups: {
    window: 'Window',                         // General e Hotkeys
    startup: 'Startup',                       // o que acontece quando o Windows abre o app
    runEnds: 'When a run ends',
    runEndsNote: 'Only while the window is behind another one — usually the game.',
    interface: 'Interface',
    files: 'Your files',
    reset: 'Reset',                           // título do grupo · nome
    recording: 'Recording',
    playback: 'Playback',
    // Replay ▾ é o botão Replay do cabeçalho, com a seta do painel dele.
    playbackNote: 'The default for macros without their own; each macro can set its own in {{>common.actions.replay}} ▾.',
    tuning: 'Game Mode tuning',
    // Game move é uma chave da página do Clicker (o movimento de jogo dos cliques).
    tuningNote: "For every macro, and for the Clicker's {{>clicker.tuning.gameMove}}.",
    textRecognition: 'Text recognition',
    // Quem lê o texto da tela: o passo, a condição, o modo Screen do Set Variable, as automações e a
    // hotkey de Settings › Hotkeys.
    textRecognitionNote: "Read by Wait Text, Text on screen, Set Variable's {{>editors.variable.screen}}, the automations and the {{>settings.hotkeys.screenText.label}} hotkey.",
    diagnostics: 'When something goes wrong',
    // Os grupos de Settings › Hotkeys.
    recordReplay: 'Recording and replay',
    clicker: 'Clicker',                       // glossário
    clickerNote: 'Only while the Clicker is on.',
    screenClipboard: 'Screen and clipboard',
  },

  // As linhas das categorias General, Recording and playback, Screen Text e Diagnostics.
  rows: {
    // General › Window.
    tray: {
      label: 'Close keeps {{app}} in the tray',  // também o nome da chave
      hint: 'The X hides the window in the tray instead of closing the app.',
      words: 'system tray minimize close',
    },
    compactRun: {
      label: 'Compact view while a macro runs',  // também o nome da chave · a janela compacta (titlebar.compact)
      hint: 'When a run starts and you switch to another app, the window turns into the compact view.',
      words: 'compact small picture in picture always on top overlay run',
    },
    // General › Startup. O aviso da importação do TrueReplayer 2 (shell) cita este rótulo.
    runOnStartup: {
      label: 'Run on startup',                   // também o nome da chave
      hint: 'Opens with Windows.',
      words: 'boot login autostart',
    },
    startMinimized: {
      label: 'Startup minimized',                // também o nome da chave
      hint: 'Opened with Windows, it starts in the tray.',
      words: 'hidden tray',
      needsStartup: 'Turn on {{>settings.rows.runOnStartup.label}} first',  // dica da chave desativada
    },
    runAsAdmin: {
      label: 'Run as administrator',             // também o nome da chave · o termo do Windows
      hint: 'From the next time {{app}} opens; Windows asks for permission. Needed to click in windows that run as administrator.',
      words: 'elevated uac admin',
    },
    // General › When a run ends.
    runEndFlash: {
      label: 'Flash on replay end',              // também o nome da chave
      hint: 'Flashes the taskbar button.',
      words: 'notify taskbar',
    },
    runEndSound: {
      label: 'Sound on replay end',              // também o nome da chave
      hint: 'Plays the Windows sound — another one if the run failed.',
      words: 'notify beep audio',
    },
    // General › Your files: a linha e o botão dela dizem o mesmo · verbo.
    dataFolder: {
      label: 'Open data folder',
      hint: 'Your macros, their images, the settings, the theme and the snippets, in one folder. Copy it to keep everything.',
      words: 'documents files backup copy move images explorer',
    },
    // General › TrueReplayer 2 (o título do grupo é o nome, uma marca). O botão é common.actions.importEllipsis.
    importTr2: {
      label: 'Import from {{tr2}}',
      hint: 'A copy of its macros, settings, remaps, theme and snippets. {{tr2}} is not changed.',
      words: 'import copy migrate old version previous',
    },
    // General › Reset.
    reset: {
      label: 'Reset all settings',
      hint: 'Every setting back to its default. Your macros, their steps and the Clicker presets stay.',
      words: 'defaults restore factory',
    },

    // Recording and playback › Recording.
    realTiming: {
      label: 'Record the real timing',           // também o nome da chave
      hint: 'Off: every recorded click and key gets the delay below instead of the time you took.',
      words: 'delay timing',
    },
    delay: {
      label: 'Delay for new steps',              // também o nome do campo, em ms
      hint: 'The delay a new step starts with: from the insert row, from the browser extension, and recorded ones when the real timing is off.',
      words: 'ms wait',
    },
    // Recording and playback › Playback: o padrão do app para as opções do Replay ▾ (área header).
    returnCursor: {
      label: '{{>header.replay.returnCursor}}',  // também o nome da chave
      hint: '{{>header.replay.returnCursorTip}}',
      words: 'mouse restore position',
    },
    gameMode: {
      label: 'Game Mode',                        // glossário · também o nome da chave
      hint: 'The cursor walks a path so games accept the move; off, it jumps.',
      words: 'smooth movement roblox path',
    },
    fastApproach: {
      label: '{{>header.replay.fastApproach}}',  // também o nome da chave · só com o Game Mode ativado
      hint: 'Teleports long moves and walks only the last stretch. Turn off if a game misclicks.',
      words: 'teleport settle',
    },
    jitter: {
      label: '{{>header.replay.jitter}}',        // também o nome do campo, em %
      hint: '{{>header.replay.jitterTip}}',
      words: 'variation random delay',
      on: 'Jitter on',                           // nome da chave ao lado do campo, para o leitor de tela
    },
    // Recording and playback › Game Mode tuning. Os campos levam o mesmo nome da linha.
    clickDelay: {
      label: 'Click delay',                      // em ms
      hint: 'Pause before each button event. Applies with Game Mode off too.',
      words: 'mouse button press',
    },
    pathStep: {
      label: 'Path step',                        // em px: o tamanho de cada passo do caminho do cursor
      hint: 'Max px per step. Lower = smoother, slower. ~20 for Roblox.',
      words: 'smooth px',
      noWalk: 'No walk — single jump',           // sob o campo, com 0: o cursor salta direto
    },
    stepDelay: {
      label: 'Step delay',                       // em ms: a espera entre os passos do caminho
      hint: 'Wait between the steps of the path.',
      words: 'smooth ms',
    },
    distance: {
      label: 'Distance',                         // em px
      hint: 'Walked stretch before the target after a teleport. ~80 px.',
      words: 'fast approach settle px',
    },

    // Screen Text › Text recognition: o idioma da leitura de texto. Os nomes dos idiomas vêm do motor,
    // cada um no próprio nome ("Português", "English"); o estado sob a lista é a área ocr.
    ocrLanguage: {
      label: 'Language',                         // rótulo da linha e nome da lista
      hint: 'Português by default; a language this PC lacks installs from here.',
      words: 'ocr install read text portuguese english',
      auto: 'Auto',                              // a última opção da lista: o idioma que o Windows dá
      autoWith: 'Auto ({{name}})',               // o mesmo, com o idioma que ele dá agora · name = o nome do idioma
      install: 'Install',                        // link ao lado do estado · verbo
      installLabel: 'Install {{name}} text recognition',  // nome do link, para o leitor de tela · name = o idioma
      installTip: 'Adds the Windows OCR pack for this language. Windows asks for permission; the download comes from Windows Update.',
    },

    // Diagnostics › When something goes wrong: cada linha e o botão dela dizem o mesmo · verbo.
    copyDiagnostics: {
      label: 'Copy diagnostics',
      hint: 'The version, the system and the recent log lines, for a bug report.',
      words: 'support bug report about version',
    },
    logs: {
      label: 'Open logs folder',
      hint: 'Where the session logs are kept.',
      words: 'support log session',
    },
    reload: {
      label: 'Reload UI',
      hint: 'Reloads the interface; the engine, and a run in progress, go on.',
      words: 'refresh stuck frozen',
    },
  },

  // Os avisos da instalação de um idioma da leitura de texto (Screen Text › Language › Install).
  // name = o nome do idioma, como a lista o escreve.
  ocrInstall: {
    restartApp: '{{name}} text recognition installed — restart {{app}} to use it.',
    restartWindows: '{{name}} text recognition installed — restart Windows to finish.',
    done: '{{name}} text recognition installed.',
    canceled: 'Install canceled — Windows needs your permission to add the pack.',
    failed: "Couldn't install {{name}} text recognition: {{error}}",  // error = o erro, como o motor o dá
    unknownError: 'unknown error',                // o erro, quando o motor não diz qual · minúscula
  },

  // Browser extension: se ela está conectada, como carregá-la e a pasta dela.
  browser: {
    words: 'chrome edge brave extension unpacked folder path connect',
    // O estado, no alto. current e expected = as versões da extensão ("1.4.26").
    outdated: 'Version {{current}} is loaded and this app expects {{expected}}. Reload it in chrome://extensions.',
    connected: 'The TrueReplayer extension is connected.',
    disconnected: 'Connect the TrueReplayer extension to Chrome (or Edge).',
    // Os três passos, numerados. Developer mode e Load unpacked são os nomes que o Chrome dá, entre aspas.
    steps: {
      open: 'Open chrome://extensions (Edge: edge://extensions, Brave: brave://extensions).',
      developerMode: 'Turn on "Developer mode".',
      loadUnpacked: 'Click "Load unpacked" and pick this folder:',  // a pasta vem embaixo
    },
    copyPath: 'Copy path',                        // botão · verbo
    openFolder: 'Open folder',                    // botão · verbo
    // A linha sob os botões: a pasta sumiu, o caminho foi copiado (ou não), ou só a atualização.
    missing: 'This folder is missing. Reinstall {{app}} to restore it.',
    copied: 'The path is copied. The extension updates itself along with {{app}}.',
    copyFailed: 'Could not copy the path — select it above. The extension updates itself along with {{app}}.',
    updatesItself: 'The extension updates itself along with {{app}}.',
  },

  // Appearance: a frase sob o título e as palavras que a acham na busca (o painel é de outra área).
  appearance: {
    intro: 'Themes, density and motion. Every change shows at once, in the whole app, and Ctrl+Z undoes it.',
    words: 'theme themes color colour accent dark light follow windows vivid pastel monochrome random my own save custom density compact normal spacious motion animations text size font corner roundness radius zoom scale data monospace',
  },

  // Settings › Hotkeys: as teclas do app, que funcionam mesmo com ele em segundo plano. hotkey é coringa
  // (a hotkey, no feminino). Os rótulos das linhas têm 234 px em 760 px de largura: "Bring TrueReplayer 3
  // to the front" é o mais longo, e o pt-BR fica do tamanho dele.
  hotkeys: {
    // Sem "anywhere in Windows": com os atalhos desativados, as de gravar, reproduzir e copiar passam para
    // o app da frente (a linha shortcuts, abaixo, diz isso).
    intro: 'Keys that work even with {{app}} in the background. Each macro’s own hotkey lives on the macro.',
    // O aviso das hotkeys em teclas que outros apps usam (quando uma instalação nova ganha outras).
    noticeLabel: 'Hotkeys on keys other apps use',  // nome da área do aviso, para o leitor de tela
    notice: {
      one: '{{count}} hotkey takes a key that other apps use. While {{app}} runs, those apps stop getting them.',
      other: '{{count}} hotkeys take keys that other apps use. While {{app}} runs, those apps stop getting them.',
    },
    useSuggested: 'Use the suggested keys',       // botão · verbo
    usedSuggested: 'The suggested keys are in use.',  // depois dele, no lugar do aviso
    keepMine: 'Keep mine',                        // botão: as teclas de agora ficam · verbo
    keptMine: 'Your keys stay. This notice comes back only if another hotkey takes a key other apps use.',
    words: 'hotkey shortcut key',                 // as palavras que acham toda linha desta categoria
    // As linhas: o rótulo é também o nome da hotkey nos nomes do campo (field.changeLabel…).
    record: {
      label: '{{>header.record.hotkey}}',         // a mesma hotkey do Record ▾
      hint: 'Starts and stops recording into the open macro, or into a new one when none is open',
      words: 'recording',
    },
    replay: {
      label: '{{>header.replay.hotkey}}',         // a mesma hotkey do Replay ▾
      hint: 'Runs the open macro, or stops whatever is running',
      words: 'run play',
    },
    shortcuts: {
      label: 'Shortcuts on or off',               // a chave geral dos atalhos (barra de status)
      hint: 'Silences macro hotkeys, hotstrings, Key Remaps and the record, replay and copy hotkeys at once',
      words: 'profile keys toggle silence pause',
    },
    front: {
      label: 'Bring {{app}} to the front',        // o mais longo: 234 px em 760
      words: 'foreground focus show window',
      noKeyWhy: 'the tray icon does it',          // depois de "suggested: no key, " (conflict.suggestedNoneWhy)
    },
    clicker: {
      label: 'Open the Clicker',
      hint: 'Pressed again, back to the macros',  // a hotkey, apertada de novo
      words: 'mode toggle clicker macro',
    },
    clickerStart: {
      label: 'Start and stop',                    // o mesmo nome da linha na página do Clicker (77 px lá)
      hint: 'Starts the clicks, or stops them',
      words: 'clicker autoclicker',
    },
    clickerPause: {
      label: 'Pause',                             // verbo (o passo Pause é outro, do glossário)
      hint: 'Pauses the clicks, or resumes them',
      words: 'clicker autoclicker resume',
    },
    clip: {
      label: 'Copy the selection to a clip slot',
      hint: 'Fills the next {clip:N} for Send Text',  // {clip:N} é o token
      words: 'capture slot clipboard selection',
    },
    screenText: {
      label: 'Copy text from the screen',
      hint: 'Reads a region with Screen Text',
      words: 'ocr read region clipboard',
    },
  },

  // O campo de uma hotkey (HotkeyField, também na página do Clicker): a tecla, Change e o ✕ que a tira.
  // label = o rótulo da linha (hotkeys.record.label…), o nome da hotkey.
  field: {
    none: 'No key',                               // no lugar da tecla, sem nenhuma · 6 rem com a tecla
    press: 'Press the new key…',                  // no lugar da tecla, enquanto espera
    change: 'Change',                             // botão · verbo
    listening: 'Listening…',                      // o mesmo botão, enquanto espera a tecla
    changeLabel: 'Change {{label}} hotkey',       // nome do botão, para o leitor de tela
    listeningLabel: 'Listening for the {{label}} hotkey',
    listeningTip: 'A key, a combo, a side button or a modifier with the wheel · 4 s or a click elsewhere cancels',
    clearLabel: 'Clear {{label}} hotkey',         // nome do ✕
    clearTip: 'No key — the hotkey is off',       // dica do ✕
    // Aviso de erro: a roda sozinha não pode ser hotkey.
    bareWheel: 'Use a modifier with the scroll wheel (e.g. Ctrl+ScrollDown) — a bare wheel hotkey would block scrolling everywhere.',
  },

  // Sob a dica de uma hotkey: o que outro app faz com a tecla dela e a tecla sugerida.
  conflict: {
    tabs: 'Also switches tabs in Chrome, Edge and VS Code',  // Ctrl+PgUp e Ctrl+PgDn
    ins: 'Ins also switches typing to overwrite',
    scrollLock: 'Excel uses ScrLk',
    minimize: 'Excel also minimizes a workbook with it',            // Ctrl+F9 · it = a tecla
    maximize: 'Excel also maximizes or restores a workbook with it',  // Ctrl+F10
    // A sugestão, depois da nota. key = a tecla sugerida, como o keycap a escreve ("Ctrl+F9").
    suggested: 'suggested {{key}}',
    suggestedNone: 'suggested: no key',
    suggestedNoneWhy: 'suggested: no key, {{why}}',  // why = hotkeys.front.noKeyWhy
    withSuggestion: '{{note}} · {{suggestion}}',     // a nota e a sugestão na mesma linha
  },

  // A hotkey Copy text from the screen: a região que ela lê, arrastada a cada vez ou uma fixa.
  // w e h = o tamanho em px; x e y = o canto, na tela.
  region: {
    label: 'Region:',                             // antes do link
    fixed: '{{w}}×{{h}} at ({{x}}, {{y}})',       // o link, com uma região fixa
    drag: 'drag one each time',                   // o link, sem região fixa · minúscula, depois de "Region:"
    fixedLabel: 'Region: {{w}}×{{h}} at ({{x}}, {{y}}) — draw another',  // nome do link, para o leitor de tela
    dragLabel: 'Region: drag one each time — fix one',
    needsHotkey: 'Set the hotkey first',          // dica do link desativado, sem hotkey
    fixedTip: '{{w}}×{{h}} at ({{x}}, {{y}}) — click to redraw',
    dragTip: 'Drag a region each time — click to fix one',
    clearLabel: 'Clear the region',               // nome do Clear ao lado (o texto é common.actions.clear)
    clearTip: 'Back to dragging a region each time',
  },
} as const;
