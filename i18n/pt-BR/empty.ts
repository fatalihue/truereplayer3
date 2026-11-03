import type en from '../en-US/empty.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  steps: {
    title: 'Nenhum passo ainda',
    text: 'Grave a tarefa ou adicione passos um a um. Passos copiados de outra macro são colados aqui com Ctrl+V.',
  },
  library: {
    title: 'Nenhuma macro ainda',
    text: 'Cada macro que você criar aparece aqui, salva na hora.',
  },
  noMatch: {
    title: 'Nenhuma macro corresponde a “{{query}}”',
    create: 'Criar macro “{{name}}”',
    examples: 'Pesquisar nos exemplos',
  },
} satisfies Catalogo<typeof en>;
