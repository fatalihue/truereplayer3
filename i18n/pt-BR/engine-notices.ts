import type en from '../en-US/engine-notices.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  stillRunning: {
    title: 'O {{app}} continua rodando',
    text: 'Fechar a janela mantém os atalhos, as automações e os remaps funcionando. Para sair, use o ícone da bandeja.',
    gotIt: 'Entendi',
    settings: 'Configurações',
  },
} satisfies Catalogo<typeof en>;
