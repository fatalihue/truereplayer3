// Os passos de navegador no Inspector (shell/inspector/browserEditors.tsx, browserText.tsx e
// selectorField.tsx): Open URL e os seis que agem em um elemento da página, com o seletor CSS, o
// escudo da estabilidade dele, o Text Match, o Test action e o Timeout. O campo do seletor também
// serve à condição Browser element. Os nomes dos passos (Open URL, Click Element, Type Text, Select
// Option, Wait Element, Assert Element…) são glossário e ficam fora do catálogo; o Delay deles está
// na faixa sob o cabeçalho, como o de todo passo.
export default {
  // O seletor CSS (selectorField.tsx).
  selector: {
    label: 'CSS selector',                // rótulo da seção e nome do campo · CSS é glossário
    placeholder: '.btn-save',             // exemplo no campo vazio, igual nos dois idiomas
    pick: 'Pick element',                 // nome do botão da mira (leitor de tela) · verbo
    pickTip: 'Pick an element on the page',
    pickingTip: 'Picking on the page · Esc cancels',  // a mesma dica, esperando o clique na página
    alternatives: 'Alternatives',         // título e nome do grupo dos seletores de reserva
    closeAlternatives: 'Close alternatives',
  },
  // O escudo ao lado do rótulo: "S · Stable". As letras S a C ficam; o nome é do seletor (masculino em pt-BR).
  tiers: {
    S: 'Stable',
    A: 'Strong',
    B: 'Decent',
    C: 'Fragile',
  },

  // O elemento pelo texto dele (Text Match), nos passos que aceitam.
  textMatch: {
    label: 'Text Match',                  // rótulo da seção
    mode: 'Text match mode',              // nome do segmentado (leitor de tela)
    field: 'Text match',                  // nome do campo (leitor de tela)
    // O segmentado de 4 (71 px cada).
    exact: 'Exact',
    contains: 'Contains',
    icontains: 'Contains (i)',
    regex: 'Regex',                       // glossário
    icontainsTip: 'Contains, in any case',
    hint: 'Filled, it finds the element by its text instead of the CSS selector.',  // sob o campo
    invalid: 'Invalid regex: {{error}}',  // erro sob o campo · error = a mensagem do navegador
    placeholder: 'e.g. Sign in',          // exemplo: o texto de um botão
    regexPlaceholder: 'e.g. ^Sign in$',
    foundBelow: 'The Text Match below finds it.',  // sob o seletor vazio, quando o Text Match acha o elemento
  },

  // Open URL.
  openUrl: {
    url: 'URL',                           // rótulo da seção e nome do campo · glossário
    hint: 'https:// is added if omitted.',
    missing: 'Enter the address to open.',  // erro sob o campo vazio
    placeholder: 'https://example.com',
    newTab: 'Open in new tab',            // a chave: o rótulo ao lado dela e o nome dela
    after: 'After navigation',            // subtítulo dos dois campos abaixo
    pattern: 'URL pattern',               // a URL que a página tem de ter para o passo seguir
    patternHint: 'Glob (*) or /regex/.',
    patternPlaceholder: '*/dashboard*',
    ready: 'Ready element',               // o seletor que a página tem de mostrar para o passo seguir
    readyPlaceholder: '#app-ready',
  },

  // Type Text.
  typeText: {
    text: 'Text to type',                 // rótulo da seção e nome do editor (leitor de tela)
    hint: 'The extension presses the key tokens like Send Text does: {enter}, {tab:2}, {space}, {home}, {delay:500}…',
    placeholder: 'Text to type…',         // o editor vazio
    placeholderTip: 'Type { for tokens, like {enter}',  // a segunda linha do editor vazio
    // Os botões que põem um token no cursor: os rótulos dos chips dos tokens, iguais nos dois idiomas.
    chips: {
      clipboard: 'Clipboard',
      enter: 'Enter',
      dateTime: 'DateTime',
    },
    typing: 'Typing',                     // subtítulo das chaves e do campo abaixo · nome
    keep: 'Keep existing text',           // a chave: não apaga o campo antes de digitar
    paste: 'Paste',                       // a chave: cola em vez de digitar · o modo, não o verbo do menu
    pasteTip: 'Instant, not key by key',
    charDelay: 'Char delay',              // rótulo · coringa (delay)
    charDelayField: 'Char delay (ms)',    // nome do campo (leitor de tela)
    pasteNoDelay: 'Paste types nothing key by key.',      // sob o campo, com Paste ativado
    emptyNoPause: 'Empty = no pause between characters.',
    none: 'none',                         // o texto do campo vazio · o delay (masculino em pt-BR)
  },

  // Select Option.
  selectOption: {
    matchBy: 'Match by',                  // rótulo da seção
    nativeOnly: 'Native <select> only.',
    mode: 'Option match mode',            // nome do segmentado (leitor de tela)
    // O segmentado de 3 (95 px cada) e as dicas.
    text: 'Text',
    textTip: 'The visible label',
    value: 'Value',
    valueTip: 'The value attribute',
    index: 'Index',
    indexTip: '0-based position',
    option: 'Option',                     // rótulo da seção e nome do campo
    valuePlaceholder: 'option-value',     // exemplo, igual nos dois idiomas
    labelPlaceholder: 'Option label',
  },

  // Wait Element e Assert Element: a condição e, no Assert, o que a falha faz.
  condition: {
    label: 'Condition',                   // rótulo da seção
    assertEmpty: 'Text pattern is empty — this Assert will fail.',  // erro, com Text matches sem o Text Match
    waitEmpty: 'Text pattern is empty — this Wait will time out.',
    assertMode: 'Assert condition',       // nome do segmentado (leitor de tela)
    waitMode: 'Wait condition',
    // As opções, duas por linha (143 px cada): como requisito, no Assert, e como espera, no Wait.
    present: 'Is present',
    notPresent: 'Is NOT present',
    isEnabled: 'Is enabled',
    textMatches: 'Text matches',
    appears: 'Appears',
    disappears: 'Disappears',
    enabled: 'Enabled',
    onFail: 'On fail',                    // rótulo da seção do Assert
    onFailMode: 'On assertion fail',      // nome do segmentado (leitor de tela)
    // O segmentado de 3 (95 px cada) e as dicas.
    halt: 'Halt',
    haltTip: 'The run stops with an error',
    continue: 'Continue',
    continueTip: 'Logged, and the run goes on',
    quiet: 'Stop quietly',
    quietTip: 'The run ends here, with no error',
  },

  // Test action: o passo feito de verdade na aba do navegador.
  test: {
    run: 'Test action',                   // botão · verbo
    running: 'Running…',                  // o mesmo botão, esperando a resposta
    success: 'Success in {{ms}} ms',      // o título do resultado · ms = a duração, formatada
    failed: 'Failed',                     // o título, quando a extensão não deu um código
    viaFallback: 'Primary selector failed — matched via fallback',
    usePrimary: 'Use as primary',         // link: o seletor de reserva vira o principal · verbo
    // Sem resposta no tempo que o teste pode levar.
    noResponse: 'No response from the browser extension.',
    noResponseTip: 'Check that Chrome and the TrueReplayer extension are still running.',
  },

  timeout: 'Timeout',                     // rótulo · coringa
  timeoutField: 'Timeout in milliseconds',  // nome do campo (leitor de tela)
} as const;
