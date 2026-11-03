import type en from '../en-US/dates.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  unknown: 'Desconhecida',
  justNow: 'agora mesmo',
  minutes: { zero: 'agora mesmo', one: 'há {{count}} min', other: 'há {{count}} min' },
  hours: { zero: 'há menos de 1 h', one: 'há {{count}} h', other: 'há {{count}} h' },
  days: { zero: 'hoje', one: 'há {{count}} dia', other: 'há {{count}} dias' },
  months: { zero: 'este mês', one: 'há {{count}} mês', other: 'há {{count}} meses' },
  years: { zero: 'este ano', one: 'há {{count}} ano', other: 'há {{count}} anos' },
} satisfies Catalogo<typeof en>;
