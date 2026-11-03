import type en from '../en-US/dock.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  region: 'Run Report e Live Variables',
  tabsLabel: 'Dock',
  tabs: {
    report: 'Run Report',
    vars: 'Live Variables',
  },
  summary: {
    running: 'Rodando',
    // Curto: com o Send Text expandido, em 1000 px, "Nenhuma execução ainda" cortava, e o inglês cabe.
    none: 'Sem execução',
    // "Rodou às 14:02", como a linha sob o nome da macro (header.meta.lastRun). "passos: 3 de 4" vale
    // para qualquer total ("1 de 1 passos" não concorda), numa frase só.
    last: 'Rodou às {{time}} · passos: {{ok}} de {{total}} · {{duration}} · {{outcome}}',
    tip: 'Abrir o relatório da execução',
  },
  open: 'Abrir painel',
  close: 'Fechar painel',
  height: 'Altura do painel',

  report: {
    empty: 'Nenhuma execução ainda. Reproduza a macro para ver cada passo aqui: o que foi encontrado, quanto tempo levou e por que falhou.',
    starting: 'A execução está começando…',
    head: {
      zero: '{{macro}} · {{time}} · {{count}} passos · {{duration}}',
      one: '{{macro}} · {{time}} · {{count}} passo · {{duration}}',
      other: '{{macro}} · {{time}} · {{count}} passos · {{duration}}',
    },
    headNoTime: {
      zero: '{{macro}} · {{count}} passos · {{duration}}',
      one: '{{macro}} · {{count}} passo · {{duration}}',
      other: '{{macro}} · {{count}} passos · {{duration}}',
    },
    wallTip: 'Tempo de relógio, menos o tempo em pausa. Dentro dos passos: {{duration}}.',
    sumTip: 'A soma dos passos — este relatório é de antes do relógio do motor.',
    ok: '{{n}} ok',
    skipped: { zero: '{{count}} pulados', one: '{{count}} pulado', other: '{{count}} pulados' },
    failed: { zero: '{{count}} falharam', one: '{{count}} falhou', other: '{{count}} falharam' },
    firstFailed: 'passo {{row}} →',
    // "alternativa", como o seletor chama as de reserva (browser.selector.alternatives).
    drift: {
      zero: '{{count}} passos foram achados por alternativas do seletor — os que você escolheu não correspondem mais. Escolha-os de novo antes que as alternativas também deixem de corresponder.',
      one: '{{count}} passo foi achado por uma alternativa do seletor — o que você escolheu não corresponde mais. Escolha-o de novo antes que a alternativa também deixe de corresponder.',
      other: '{{count}} passos foram achados por alternativas do seletor — os que você escolheu não correspondem mais. Escolha-os de novo antes que as alternativas também deixem de corresponder.',
    },
    list: 'Passos da execução',
    select: 'Selecionar o passo {{row}}',
    running: 'Rodando…',
    fallback: 'achado pela alternativa de nível {{tier}}',
    fallbackSelector: 'achado pela alternativa de nível {{tier}} · {{selector}}',
    // "gravados" (record é gravar, §2.3): o relatório grava os passos.
    capped: {
      zero: '+{{n}} passos a mais não gravados (o relatório tem limite).',
      one: '+{{n}} passo a mais não gravado (o relatório tem limite).',
      other: '+{{n}} passos a mais não gravados (o relatório tem limite).',
    },
    live: { zero: '{{clock}} decorridos · nenhuma falha', one: '{{clock}} decorridos · {{count}} falha', other: '{{clock}} decorridos · {{count}} falhas' },
    liveLoop: {
      zero: 'Loop {{current}} de {{total}} · {{clock}} decorridos · nenhuma falha',
      one: 'Loop {{current}} de {{total}} · {{clock}} decorridos · {{count}} falha',
      other: 'Loop {{current}} de {{total}} · {{clock}} decorridos · {{count}} falhas',
    },
  },
  status: {
    ok: 'ok',
    failed: 'falhou',
    skipped: 'pulado',
    running: 'em andamento',
  },
  codes: {
    ELEMENT_NOT_FOUND: 'Nenhum elemento corresponde ao seletor.',
    ELEMENT_HIDDEN: 'Encontrado, mas não está visível na tela.',
    ELEMENT_DISABLED: 'Encontrado, mas desativado.',
    ELEMENT_COVERED: 'Encontrado, mas há algo por cima dele.',
    SELECTOR_INVALID: 'O seletor não é um CSS válido.',
    NAVIGATION_TIMEOUT: 'A página não terminou de carregar a tempo.',
    INVALID_URL: 'Essa não é uma URL que o navegador consiga abrir.',
    OPTION_NOT_FOUND: 'Nenhuma opção da lista corresponde.',
    OPTION_DISABLED: 'A opção corresponde, mas está desativada.',
    NOT_A_SELECT: 'Esse elemento não é uma lista suspensa.',
    // "guia", como o Chrome e o Edge chamam a aba deles em pt-BR (e o Open URL: "Abrir em nova guia").
    TAB_GONE: 'A guia em que esta execução agia foi fechada.',
    NO_CONTENT_SCRIPT: 'A guia ativa do Chrome não pode ser automatizada.',
  },

  vars: {
    empty: 'Nada ainda. As variáveis, as respostas de {input:} e as capturas de {clip:} aparecem aqui conforme acontecem.',
    variables: 'Variáveis',
    slots: 'Slots',
    row: 'Linha atual',
  },
} satisfies Catalogo<typeof en>;
