import type en from '../en-US/tips.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  recording: {
    title: 'Faça a tarefa agora, em qualquer app',
    body: 'Cada clique e cada tecla vira um passo aqui embaixo.',
    pressKey: 'Aperte {{key}} para parar.',
    pressStop: 'Use {{>common.actions.stop}} para terminar.',
    hide: 'Ocultar esta dica',
  },
  card: {
    title: 'Sua primeira macro está salva',
    hide: 'Ocultar estas dicas',
    recorded: { zero: 'Nenhum passo gravado', one: '{{count}} passo gravado', other: '{{count}} passos gravados' },
    tryIt: 'Experimente',
    runWithShortcut: 'Rode sem voltar ao {{app}}',
    changeShortcut: 'Alterar o atalho',
    addShortcut: 'Adicionar um atalho',
  },
} satisfies Catalogo<typeof en>;
