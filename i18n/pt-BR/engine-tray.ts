import type en from '../en-US/engine-tray.ts';
import type { Catalogo } from '../tipos.ts';

// Os estados são os da janela compacta e da barra de título (Pronto, Gravando, Reproduzindo,
// Clicando, Clicker aberto) e as chaves, as da barra de status (Atalhos, Automações, armadas,
// ativos). Os itens do menu do clique direito têm cada um a sua letra de acesso, sem repetir no
// mesmo menu: A, P, G, T, E, K, C, F, S e R; no submenu, R, D e L. Recarregar a interface e Abrir
// pasta dos logs são os textos da página (Settings › Diagnostics e o Ctrl+K).
export default {
  tip: {
    ready: '{{app}} — Pronto',
    readyArmed: {
      zero: '{{app}} — Pronto · {{n}} automações armadas',
      one: '{{app}} — Pronto · {{n}} automação armada',
      other: '{{app}} — Pronto · {{n}} automações armadas',
    },
    readyPaused: '{{app}} — Pronto · automações pausadas',
    recording: '{{app}} — Gravando',
    recordingMacro: '{{app}} — Gravando {{macro}}',
    replaying: '{{app}} — Reproduzindo',
    replayingMacro: '{{app}} — Reproduzindo {{macro}}',
    replayingLoop: '{{app}} — Reproduzindo, loop {{current}} de {{total}}',
    replayingMacroLoop: '{{app}} — Reproduzindo {{macro}}, loop {{current}} de {{total}}',
    clicking: '{{app}} — Clicando',
    clickerOpen: '{{app}} — Clicker aberto',
    clickerOpenKey: '{{app}} — Clicker aberto · {{key}} inicia',
    shortcutsRemapsPaused: '{{app}} — Atalhos e remaps pausados',
    shortcutsPaused: '{{app}} — Atalhos pausados',
    notices: {
      zero: '{{app}} — {{n}} avisos enquanto você estava fora',
      one: '{{app}} — {{n}} aviso enquanto você estava fora',
      other: '{{app}} — {{n}} avisos enquanto você estava fora',
    },
  },

  menu: {
    open: '&Abrir o {{app}}',
    stopRecording: '&Parar a gravação',
    stopClicker: '&Parar o Clicker',
    stopMacro: '&Parar {{macro}}',
    stop: '&Parar',
    recordNew: '&Gravar uma nova macro',
    shortcuts: 'A&talhos',
    automations: 'Automaçõ&es…',
    remaps: '&Key Remaps',
    clicker: '&Clicker',
    settings: 'Con&figurações',
    troubleshoot: '&Solucionar problemas',
    reloadUi: '&Recarregar a interface',
    devTools: 'Abrir o &DevTools',
    logs: 'Abrir pasta dos &logs',
    quit: 'Sai&r',
  },

  panel: {
    open: 'Abrir',
    notices: {
      zero: '{{n}} avisos enquanto você estava fora',
      one: '{{n}} aviso enquanto você estava fora',
      other: '{{n}} avisos enquanto você estava fora',
    },
    clear: 'Limpar',
    noMacro: 'Nenhuma macro aberta',
    macros: 'Macros',
    macrosEmpty: 'As macros fixadas e as que têm hotkey aparecem aqui, menos as desativadas.',
    running: 'Rodando',
    allMacros: 'Todas as macros…',
    shortcuts: 'Atalhos',
    automations: 'Automações',
    remaps: 'Key Remaps',
    armed: { zero: '· {{n}} armadas', one: '· {{n}} armada', other: '· {{n}} armadas' },
    active: { zero: '· {{n}} ativos', one: '· {{n}} ativo', other: '· {{n}} ativos' },
    clicker: 'Clicker',
    clickerOpen: 'Clicker · aberto',
    settings: 'Configurações',
    quit: 'Sair do {{app}}',
  },

  card: {
    recording: {
      zero: 'Gravando · {{n}} passos · {{clock}}',
      one: 'Gravando · {{n}} passo · {{clock}}',
      other: 'Gravando · {{n}} passos · {{clock}}',
    },
    clicking: 'Clicando · {{clicks}} · {{clock}}',
    replaying: 'Reproduzindo · {{clock}}',
    replayingLoop: 'Reproduzindo · loop {{current}} de {{total}} · {{clock}}',
    clickerOpen: 'Clicker aberto',
    clickerOpenKey: 'Clicker aberto · {{key}} inicia',
    ready: { zero: 'Pronto · {{n}} passos', one: 'Pronto · {{n}} passo', other: 'Pronto · {{n}} passos' },
    noMacro: 'Abra uma macro na janela para rodá-la daqui.',
    stop: 'Parar',
    replay: 'Reproduzir',
  },
} satisfies Catalogo<typeof en>;
