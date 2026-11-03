import type en from '../en-US/titlebar.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  search: 'Pesquisar macros, passos e comandos',
  searchShort: 'Pesquisar',

  state: {
    ready: 'Pronto',
    clicker: 'Clicker',
    recording: 'Gravando',
    recordingMacro: 'Gravando · {{name}}',
    replaying: 'Reproduzindo',
    replayingMacro: 'Reproduzindo · {{name}}',
    waiting: 'Esperando',
    waitingMacro: 'Esperando · {{name}}',
    startingIn: 'Começa em {{seconds}} s',
    clicking: 'Clicando · {{clicks}}',
    paused: 'Pausado · {{clicks}}',
  },

  compact: 'Janela compacta',
  compactTip: 'Janela compacta · também no Ctrl+K',
} satisfies Catalogo<typeof en>;
