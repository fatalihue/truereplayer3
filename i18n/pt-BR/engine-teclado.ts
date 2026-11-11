import type en from '../en-US/engine-teclado.ts';
import type { Catalogo } from '../tipos.ts';

// O jogo é masculino ("o jogo"); "Teclado" é o nome do modo e fica com maiúscula.
export default {
  open: 'Abrir o Teclado',

  unreadable: {
    title: 'Teclado: arquivo ilegível',
    backup: {
      zero: 'Não foi possível ler o teclado.json, então o último backup foi carregado (nenhum jogo). O arquivo não é substituído — as mudanças vão para {{pending}}.',
      one: 'Não foi possível ler o teclado.json, então o último backup foi carregado ({{n}} jogo). O arquivo não é substituído — as mudanças vão para {{pending}}.',
      other: 'Não foi possível ler o teclado.json, então o último backup foi carregado ({{n}} jogos). O arquivo não é substituído — as mudanças vão para {{pending}}.',
    },
    noBackup: 'Não foi possível ler o teclado.json e não há backup, então nenhum jogo muda tecla alguma. O arquivo NÃO foi substituído — veja o log da sessão.',
  },

  detail: {
    read: 'Não foi possível abrir o arquivo: {{reason}}',
    parse: 'O arquivo não é um JSON válido: {{reason}}',
    unknown: 'O motivo é desconhecido.',
  },
} satisfies Catalogo<typeof en>;
