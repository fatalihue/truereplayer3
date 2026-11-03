import type en from '../en-US/examples.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  title: 'Exemplos',
  intro: 'Macros curtas que mostram tokens de texto, variáveis, condições e tabelas. Cada uma digita no Bloco de Notas, para você ver funcionando. Usar uma copia a macro para a sua biblioteca, na pasta dos exemplos.',
  search: 'Pesquisar exemplos',

  groups: {
    tokens: 'Tokens de texto',
    variables: 'Variáveis',
    conditions: 'Condições',
    together: 'Tudo junto',
    more: 'Mais',
  },

  steps: { zero: '0 passos', one: '{{count}} passo', other: '{{count}} passos' },
  runs: 'Roda {{names}}, que vem junto.',
  runBy: 'Rodada por {{name}}.',
  inLibrary: 'Na sua biblioteca',
  use: 'Usar este exemplo',
  useName: 'Usar o exemplo {{name}}',
  copying: 'Copiando…',

  count: { zero: 'Nenhum exemplo', one: '{{count}} exemplo', other: '{{count}} exemplos' },
  noMatch: 'Nenhum exemplo corresponde a “{{query}}”.',

  copied: '“{{name}}” está na sua biblioteca, na pasta dos exemplos. Abra o Bloco de Notas e reproduza.',
  copyFailed: 'Não foi possível copiar o exemplo.',
} satisfies Catalogo<typeof en>;
