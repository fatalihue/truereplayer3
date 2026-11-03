// As datas que a interface mostra (utils/dateFormat.ts): a aba Info da macro (Created e Updated, no
// histórico) e a prévia da importação (Exported e Updated). O dia e a hora saem pelo Intl do idioma
// do build; aqui ficam a data que falta e o "há quanto tempo".
export default {
  unknown: 'Unknown',      // no lugar de uma data que falta ou não se lê · a data (feminino em pt-BR)
  // Há quanto tempo, curto, depois de "Updated" ou de " · ". count = o número, 1 ou mais (com menos de
  // um minuto, justNow).
  justNow: 'just now',     // minúscula
  minutes: { one: '{{count}}m ago', other: '{{count}}m ago' },
  hours: { one: '{{count}}h ago', other: '{{count}}h ago' },
  days: { one: '{{count}}d ago', other: '{{count}}d ago' },
  months: { one: '{{count}}mo ago', other: '{{count}}mo ago' },
  years: { one: '{{count}}y ago', other: '{{count}}y ago' },
} as const;
