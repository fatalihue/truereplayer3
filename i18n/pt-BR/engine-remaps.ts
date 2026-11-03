import type en from '../en-US/engine-remaps.ts';
import type { Catalogo } from '../tipos.ts';

// O remap é masculino ("os remaps"); "Key Remaps" é o nome do recurso e fica.
export default {
  open: 'Abrir Key Remaps',

  unreadable: {
    title: 'Key Remaps: arquivo ilegível',
    backup: {
      zero: 'Não foi possível ler o remaps.json, então o último backup foi carregado (nenhum remap). O arquivo não é substituído — as mudanças vão para {{pending}}.',
      one: 'Não foi possível ler o remaps.json, então o último backup foi carregado ({{n}} remap). O arquivo não é substituído — as mudanças vão para {{pending}}.',
      other: 'Não foi possível ler o remaps.json, então o último backup foi carregado ({{n}} remaps). O arquivo não é substituído — as mudanças vão para {{pending}}.',
    },
    noBackup: 'Não foi possível ler o remaps.json e não há backup, então a lista aparece vazia. O arquivo NÃO foi substituído — veja o log da sessão.',
  },

  notSaved: {
    title: 'Remaps não salvos',
    empty: 'Não foi possível ler o remaps.json, então nada foi gravado no disco. Sua mudança vale só para esta sessão.',
    pending: 'Não foi possível ler o remaps.json, então sua mudança foi para {{pending}}. Ela vale para esta sessão.',
  },

  detail: {
    read: 'Não foi possível abrir o arquivo: {{reason}}',
    parse: 'O arquivo não é um JSON válido: {{reason}}',
    unknown: 'O motivo é desconhecido.',
  },
} satisfies Catalogo<typeof en>;
