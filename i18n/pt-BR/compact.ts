import type en from '../en-US/compact.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  view: 'Janela compacta',
  layout: 'Layout compacto',
  noMacro: 'Nenhuma macro aberta',
  chooseMacro: 'Escolher macro',
  chooseMacroNamed: 'Escolher macro, {{name}}',
  back: 'Voltar à janela inteira',

  state: {
    recording: 'Gravando',
    clicking: 'Clicando',
    waiting: 'Esperando no passo {{step}}',
    replaying: 'Reproduzindo',
    clickerOpen: 'Clicker aberto',
    stoppedAt: 'Parou no passo {{step}}',
    ready: 'Pronto',
  },

  detail: {
    recording: { zero: '{{clock}} · {{count}} passos', one: '{{clock}} · {{count}} passo', other: '{{clock}} · {{count}} passos' },
    clicking: '{{rate}}/s · {{clicks}}',
    clickingOf: '{{rate}}/s · {{clicks}} de {{total}}',
    keyOrSeconds: '{{key}} ou {{seconds}} s',
    loop: 'loop {{current}} de {{total}}',
    step: 'passo {{current}} de {{total}}',
    loopStep: 'loop {{loop}} de {{loops}} · passo {{step}} de {{steps}}',
    keyStarts: '{{key}} inicia',
    chooseAbove: 'escolha uma acima',
    steps: { zero: '{{count}} passos', one: '{{count}} passo', other: '{{count}} passos' },
    // "last run" fica "rodou às", como no cabeçalho: a linha corta com reticências.
    stepsLastRun: {
      zero: '{{count}} passos · rodou às {{time}}',
      one: '{{count}} passo · rodou às {{time}}',
      other: '{{count}} passos · rodou às {{time}}',
    },
  },

  start: 'Iniciar',
  openReport: 'Abrir o Run Report',
  runAgain: 'Rodar de novo',
} satisfies Catalogo<typeof en>;
