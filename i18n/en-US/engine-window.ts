// O motor: a janela e a abertura (Source/MainWindow.xaml.cs, Source/Program.cs e
// Source/CoexistenceGuard.cs). Os avisos que a janela manda à página (alert:show), os que a abertura
// guarda até a janela aparecer (ShowNoticeWhenSeen, que o painel da bandeja também lista) e os
// diálogos nativos de quando a página não existe ou quebrou: o MessageBox do Windows e o TaskDialog
// de um aberto por vez. Os botões OK do MessageBox seguem o idioma do Windows.
// Um diálogo é um texto só, com os parágrafos separados por uma linha em branco (\n\n).
// Nas lacunas: app = o nome deste app e tr2 = o do TrueReplayer 2 (Source/AppIdentity.cs), marcas
// iguais nos dois idiomas; name = o nome de uma macro; reason = o motivo de uma falha (S.Reason: em
// inglês, a mensagem do .NET; em português, a frase do motor para os casos comuns).
export default {
  // Avisos (alert:show) das hotkeys, que chegam com a janela atrás ou escondida.
  alerts: {
    // A hotkey de uma macro foi engolida porque a janela-alvo dela não está aberta em lugar nenhum.
    // process = o processo da janela-alvo, como a macro o guarda ("chrome").
    hotkeyIgnored: "Macro '{{name}}' hotkey ignored — '{{process}}' isn't running",
    // O mesmo, com a janela-alvo escolhida só pelo título (sem processo).
    hotkeyIgnoredNoProcess: "Macro '{{name}}' hotkey ignored — its target window isn't open",
    // Com os atalhos desativados, Record, Replay ou Capture to Slot foram para o app da frente.
    // combo = a tecla apertada; hotkey = a que ativa os atalhos de novo (Settings › Hotkeys).
    shortcutsOff: 'Shortcuts are off — {{combo}} went to the app in front. Press {{hotkey}} to turn them back on.',
    // O mesmo, sem uma hotkey para ativar os atalhos.
    shortcutsOffNoKey: 'Shortcuts are off — {{combo}} went to the app in front. Turn them back on in the status bar or the tray.',
    // A hotkey Capture to Slot copiou a seleção do app da frente · slot = o número do slot (1 a 9),
    // dentro do token {clip:N}, que fica como se digita.
    selectionCaptured: 'Selection captured → {clip:{{slot}}}',
    // A hotkey de uma macro não conseguiu abrir a macro (o arquivo travado, ilegível).
    couldNotStart: 'Could not start "{{name}}": {{reason}}',
  },

  // Avisos da abertura, guardados até a janela aparecer e listados no painel da bandeja.
  startup: {
    // Macros cujo arquivo não abriu · n = quantas, já formatado; names = os nomes, separados por vírgula.
    macrosNotLoaded: { one: "{{n}} macro(s) couldn't load: {{names}}", other: "{{n}} macro(s) couldn't load: {{names}}" },
    // O mesmo, com mais de cinco: names = só as cinco primeiras.
    manyMacrosNotLoaded: "{{n}} macros couldn't load (first 5: {{names}}, …)",
    // O appsettings.json estava preso por outro programa durante toda a leitura.
    settingsUnreadable: "Your settings file couldn't be read (another program was holding it), so this session runs on default settings and won't save changes to them. Restart {{app}} to load your settings.",
    // A carga da abertura falhou no meio.
    dataFailed: "Startup data couldn't load fully. Some macros or hotkeys may be unavailable.",
  },

  // MessageBox da janela: a página não abriu, não carregou ou quebrou.
  dialogs: {
    // O WebView2 não inicializou nem depois de três tentativas.
    webViewFailed: "{{app}} couldn't start its UI because the Microsoft Edge WebView2 Runtime failed to initialize.\n\nInstall or repair the WebView2 Runtime, then restart {{app}}.",
    // Os arquivos da página (wwwroot) não carregaram nem depois de duas tentativas.
    uiFilesMissing: "{{app}} couldn't load its UI files.\n\nThey may have been removed or quarantined by antivirus. Reinstall or repair {{app}}, and allow-list its install folder if your antivirus flagged it.",
    // A ligação da página com o motor falhou depois do WebView2.
    uiNotFinished: "{{app}} couldn't finish starting its UI.\n\nPlease restart {{app}}. If the problem persists, repair the Microsoft Edge WebView2 Runtime.",
    // O Save da pergunta de fechar não gravou a macro, e o app não fecha. O motivo vem na linha de baixo.
    saveFailed: "Error saving macro:\n{{reason}}\n\n{{app}} stayed open so your changes aren't lost.",
    // A página não respondeu nem depois de reiniciar o app. reload e logs = os itens do menu da
    // bandeja (Troubleshoot ▸), como o menu os escreve no idioma, sem a letra de acesso.
    recoveryExhausted: "{{app}}'s interface didn't finish loading, and restarting the app didn't help.\n\nThe app is still running — right-click its tray icon and choose \"{{reload}}\" to try again, or \"{{logs}}\" to see what failed.\n\nIf it keeps happening, allow-list {{app}}'s install folder in your antivirus, then reinstall or repair the app.",
    // O mesmo, quando a pasta dos logs existe · dir = o caminho dela.
    recoveryExhaustedLogs: "{{app}}'s interface didn't finish loading, and restarting the app didn't help.\n\nThe app is still running — right-click its tray icon and choose \"{{reload}}\" to try again, or \"{{logs}}\" to see what failed.\n\nIf it keeps happening, allow-list {{app}}'s install folder in your antivirus, then reinstall or repair the app.\n\nLogs: {{dir}}",
  },

  // A abertura sem o WebView2 instalado (Program.cs): o OK abre a página de download.
  missingWebView: {
    text: '{{app}} requires Microsoft Edge WebView2 Runtime.\n\nClick OK to open the download page.\nAfter installing, restart {{app}}.',
    title: '{{app}} — Missing Dependency',   // título da caixa
  },

  // Aberto com o TrueReplayer 2 aberto (CoexistenceGuard): o diálogo espera o 2 fechar e segue
  // sozinho. Exit é o item do menu da bandeja do TrueReplayer 2, que só existe em inglês.
  coexist: {
    heading: '{{tr2}} is open',
    text: 'Only one can run at a time: shortcuts, remapped keys, automations and the browser extension would clash.\n\nClose {{tr2}} from its tray menu (Exit asks about anything unsaved), and {{app}} opens by itself.',
    close: 'Close {{tr2}}…',   // botão: abre o menu da bandeja do 2, onde a pessoa escolhe Exit · verbo
    show: 'Show {{tr2}}',      // botão: traz a janela do 2 · verbo
    cancel: 'Cancel',          // botão: desiste, e este app não abre · verbo
  },
} as const;
