import type en from '../en-US/engine-copy.ts';
import type { Catalogo } from '../tipos.ts';

// O cabeçalho segue as colunas da lista (Passo, Detalhes, Delay, Nota), não a palavra do inglês: a
// coluna Key leva a tecla, o slot, a janela, o programa ou o seletor, e "Tecla" diria só uma delas.
// As durações levam o espaço entre o número e a unidade, e "min" para os minutos.
export default {
  head: {
    action: 'Passo',
    key: 'Detalhes',
    delay: 'Delay',
    notes: 'Notas',
  },

  summary: 'Passos: {{n}} | Delay total: {{total}}',

  duration: {
    millis: '{{ms}} ms',
    seconds: '{{s}} s',
    minutes: '{{m}} min {{s}} s',
  },

  key: {
    clearAll: 'limpar todos os slots',
    clearSlot: 'limpar {{clip}}',
    changes: 'muda',
    fromScreen: '{{name}} ← tela',
    fromScreenNumber: '{{name}} ← tela #',
    window: {
      maximize: 'Maximizar · {{window}}',
      minimize: 'Minimizar · {{window}}',
      close: 'Fechar · {{window}}',
      launch: '{{window}} — abrir',
      maximizeLaunch: 'Maximizar · {{window}} — abrir',
      run: 'abrir: {{path}}',
    },
  },
} satisfies Catalogo<typeof en>;
