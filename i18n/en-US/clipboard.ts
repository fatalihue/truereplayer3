// O construtor da cadeia de modificadores dos tokens que têm cadeia: {clipboard:…}, {row:coluna:…},
// {rownext:coluna:…}, {var:nome:…}, {clip:nome:…}, {winclip:N:…}, {counter}, {loop}, {datarow},
// {uuid}, {timestamp} e {env:NOME}. Mora em dois lugares que mostram os mesmos passos, na mesma ordem
// e com as mesmas palavras:
// - a superfície grande (components/lexical/ClipboardSurface.tsx), o Transform… do Send Text
//   expandido, com a coluna dos passos (até 560 px) e a coluna da prévia à direita (320 px ou mais);
// - o corpo do popover do chip (ClipboardModifierBody.tsx), com 300 px de largura: as opções lá são
//   botões de rádio e caixas de marcar, algumas em duas colunas de ~107 px de rótulo.
// E as peças do popover (popoverAtoms.tsx).
//
// Os NOMES dos modificadores no token (trim, replace, before, after, dropnum, range, lines, sort,
// dedupe, reverse, join, words, line, word, first, last, noaccents, digits, count, pad, upper, lower,
// sentence, title, default) ficam como estão: são o arquivo, e não aparecem aqui. Aqui ficam os
// rótulos, as opções e as explicações que a tela mostra.
// Os títulos dos passos são rótulos pequenos em maiúsculas (label-micro) ao lado do número do passo.
export default {
  // O título da superfície, ao lado de ‹ Editor: a FONTE que o token lê, não "Advanced Clipboard"
  // (Advanced… é o botão que a abre, não o nome dela) · nome.
  heads: {
    clipboard: 'Clipboard',                 // {clipboard} · glossário (coringa)
    row: 'Data column',                     // {row:coluna}: a célula de uma coluna da tabela do Data Loop
    rownext: 'Data column (next row)',      // {rownext:coluna}: cada uso pega a linha seguinte
    var: 'Variable',                        // {var:nome}: uma variável da execução (não a condição Variable do If)
    clip: 'Clipboard slot',                 // {clip:nome}: o que o Copy to Slot guardou no slot
    winclip: 'Clipboard history',           // {winclip:N}: o histórico do Win+V
    counter: 'Run repeat',                  // {counter}: o número da repetição da execução (1, 2, 3…)
    loop: 'Loop iteration',                 // {loop}: a volta do While ou For Each mais interno
    datarow: 'Data row number',             // {datarow}: o número da linha de dados atual
    uuid: 'UUID',                           // {uuid} · marca
    timestamp: 'Timestamp',                 // {timestamp}: o nome do token (Unix time)
    env: 'Environment variable',            // {env:NOME}: uma variável de ambiente da máquina
  },

  // A barra do topo da superfície.
  back: 'Editor',                           // botão ‹ Editor, que volta ao texto da mensagem · nome
  backTip: 'Discards changes',              // dica do ‹ Editor quando quem abriu a superfície não dá outra
  refresh: 'Refresh',                       // botão sobre a caixa da fonte: lê o clipboard de novo · verbo

  // O cartão acima dos passos: QUAL coluna, variável, slot, item do histórico ou unidade. Não é um
  // passo e não tem número. As fontes sem identidade (clipboard, counter, loop, datarow, uuid) não
  // têm cartão.
  identity: {
    column: 'Data column',                  // rótulo do campo do nome da coluna ({row}, {rownext})
    variableName: 'Variable name',          // rótulo do campo ({var}, {env})
    slotName: 'Slot name',                  // rótulo do campo ({clip})
    historyItem: 'History item',            // rótulo do número ({winclip}), e o nome dele para o leitor de tela
    unit: 'Unit',                           // rótulo da unidade ({timestamp}), e o nome do segmentado
    mostRecent: '1 = most recent',          // ao lado do número do item do histórico
    seconds: 'Seconds',                     // opção do segmentado da unidade
    milliseconds: 'Milliseconds',           // opção do segmentado da unidade
    columnPlaceholder: 'column',            // texto do campo vazio do nome da coluna · minúscula
    namePlaceholder: 'name',                // texto do campo vazio do nome ({var}, {clip}) · minúscula
    envPlaceholder: 'USERNAME',             // texto do campo vazio de {env}: uma variável real do Windows, igual em todo idioma
    // A linha sob o campo, uma por fonte · quebra a linha.
    hints: {
      row: 'Cell of this column in the current data row.',
      rownext: 'Each use takes the next row (1st → row 1, 2nd → row 2…). Resets each run.',   // 1st, 2nd = o 1º uso, o 2º uso
      var: 'Value stored by Set Variable under this name.',
      clip: 'What Copy to Slot or the capture hotkey stored in this slot.',
      // Uma linha na largura da coluna (~500 px): é o cartão que empurra os passos para baixo da dobra.
      winclip: 'Newest first. Needs Win+V history on; may hold anything any app copied — passwords too.',
      timestamp: 'Unix time: seconds since 1970-01-01 UTC, or milliseconds.',
      // "keys" são chaves secretas (de API, de produto), não teclas.
      env: 'Read from this machine when the macro runs. May hold anything the system or an app stored — keys too.',
    },
    // Em vermelho, sob o campo vazio: sem o nome, o token não se monta (e o Insert fica desativado).
    nameColumn: 'Name the column to build this token',
    nameIt: 'Name it to build this token',   // {var}, {clip}, {env}
  },

  // Os títulos dos passos, na ordem em que o motor os aplica. Também o nome do grupo de opções de
  // cada um, para o leitor de tela · nome ou verbo curto, sem artigo.
  steps: {
    sequence: 'Sequence',                   // só no clipboard: uma linha por uso
    trim: 'Trim',                           // tira os espaços das pontas
    replace: 'Replace',
    splitAt: 'Split at',                    // corta o texto em um delimitador
    dropCount: 'Drop count',                // tira uma contagem do começo ("1x Caixa" → "Caixa")
    lines: 'Lines',
    extract: 'Extract',
    limit: 'Limit length',
    cleanUp: 'Clean up',                    // tira acentos ou deixa só os dígitos
    countPad: 'Count & pad',                // conta as linhas e completa com zeros
    textCase: 'Case',                       // maiúsculas e minúsculas
    fallback: 'Default',                    // o texto que entra quando o resultado fica vazio
  },

  // Sequence (só no clipboard).
  sequence: {
    onePerUse: 'One line per use',          // caixa de marcar
    onHint: 'Each use takes the next line; a new copy starts over. The preview always shows line 1.',
    offHint: 'Pastes the whole clipboard.', // no popover, com a caixa desmarcada
  },

  trim: {
    whitespace: 'Trim whitespace',          // caixa de marcar
  },

  // Replace: dois campos, o que procurar → pelo que trocar.
  replace: {
    findPlaceholder: 'find',                // texto do campo vazio · minúscula · campo de 92 px no popover
    find: 'Find',                           // nome do campo, para o leitor de tela
    findTip: 'Every match, ignoring case. { } : not allowed.',
    withPlaceholder: '(nothing)',           // texto do campo vazio: vazio, a ocorrência some
    with: 'Replace with',                   // nome do campo, para o leitor de tela
    withTip: 'Empty deletes the match. { } : not allowed.',
  },

  // Split at: o modo (segmentado), o delimitador e a caixa Last match.
  split: {
    label: 'Split at a delimiter',          // nome do segmentado, para o leitor de tela
    // As opções · no popover, três de ~67 px de texto cada (o segmentado ocupa a largura).
    off: 'Off',
    before: 'Before',                       // fica o que vem antes do delimitador
    after: 'After',
    delimiter: 'Delimiter',                 // nome do campo, para o leitor de tela
    delimiterTip: 'Cut here — the delimiter is dropped. Spaces and : allowed, { } not.',
    // A dica do popover, que não tem a linha de baixo (absentHint).
    delimiterTipAbsent: 'Cut here — the delimiter is dropped. Spaces and : allowed, { } not. Absent = empty result.',
    lastMatch: 'Last match',                // caixa de marcar: corta na última ocorrência · ~136 px no popover
    absentHint: 'No delimiter in the text = nothing, not the whole text.',
  },

  // Drop count: o sufixo depois dos dígitos.
  dropCount: {
    suffix: 'Count suffix',                 // nome do campo, para o leitor de tela
    suffixTip: 'Strips leading digits + this text (e.g. "1x "). { } not allowed.',
    hint: 'Strips only a leading count with this exact suffix: "1x Caixa" → "Caixa".',   // o exemplo é um texto do usuário
  },

  // O fim aberto de um intervalo (Range, Words): texto do segundo campo vazio · minúscula · 54 px.
  openEnd: 'end',

  // Lines: o que pegar (todas, um intervalo, números escolhidos), e as operações nas linhas.
  lines: {
    // As opções · no popover são botões de rádio com os campos ao lado (rótulo de ~118 px).
    all: 'All lines',
    range: 'Range',
    pick: 'Pick #s',                        // escolhe as linhas pelos números ("3,1,2")
    firstLine: 'First line',                // nome do campo, para o leitor de tela
    lastLine: 'Last line',
    numbers: 'Line numbers',                // nome do campo dos números, para o leitor de tela
    numbersTip: 'Comma-separated line numbers; repeats allowed',
    // Caixas de marcar · no popover em duas colunas, ~107 px de rótulo.
    sort: 'Sort A–Z',
    dedupe: 'Dedupe',                       // tira as linhas repetidas
    reverse: 'Reverse',                     // inverte a ordem das linhas
    joinWith: 'Join with',                  // junta as linhas com o separador do campo ao lado
    separator: 'Separator',                 // nome do campo, para o leitor de tela
    joinTip: 'Joins lines with this — empty allowed. { } : not allowed.',
  },

  // Extract: tudo, uma linha, uma palavra ou um intervalo de palavras.
  extract: {
    everything: 'Everything',
    line: 'Line #',                         // a linha número N
    word: 'Word #',
    words: 'Words',                         // um intervalo de palavras
    firstWord: 'First word',                // nome do campo, para o leitor de tela
    lastWord: 'Last word',
    wordsTip: 'Word range; a blank side is open-ended.',
  },

  // Limit length · no popover, botões de rádio com o campo ao lado (rótulo de ~158 px).
  limit: {
    none: 'None',                           // sem limite
    first: 'First N chars',
    last: 'Last N chars',
  },

  // Clean up · caixas de marcar; no popover em duas colunas, ~107 px de rótulo.
  cleanUp: {
    noAccents: 'Remove accents',
    digitsOnly: 'Digits only',
  },

  // Count & pad · caixas de marcar; Zero-pad to tem o número ao lado (rótulo de ~158 px no popover).
  countPad: {
    countLines: 'Count lines',              // o valor vira o número de linhas não vazias
    zeroPad: 'Zero-pad to',                 // completa com zeros à esquerda até N caracteres
  },

  // Case · as opções escritas como ficam; no popover em duas colunas, ~107 px de rótulo.
  textCase: {
    none: 'None',                           // não muda nada
    upper: 'UPPER',
    lower: 'lower',
    sentence: 'Sentence',                   // só a primeira letra em maiúscula
    title: 'Title',                         // a primeira letra de cada palavra em maiúscula
  },

  // Default: o texto que entra quando o resultado fica vazio.
  fallback: {
    placeholder: 'when empty',              // texto do campo vazio · minúscula
    label: 'Default text',                  // nome do campo, para o leitor de tela
    tip: 'Used when the result is empty. Spaces and : allowed, { } not.',
    hint: 'An unset variable, a missing delimiter or a line past the end pastes this instead of nothing.',
  },

  // A prévia: o que entra (a fonte), o que sai (Result) e o que se grava (Token). Os rótulos são
  // pequenos, em maiúsculas.
  source: {
    clipboardNow: 'Clipboard now',          // o texto do clipboard, lido agora
    cell: 'Cell (first row)',               // {row}, {rownext}: a célula da primeira linha da tabela
    slotText: 'Slot text',                  // {clip}
    variableValue: 'Variable value',        // {var}, {env}
    itemText: 'Item text',                  // {winclip}; não "History item", que é o campo de cima
    value: 'Value',                         // {counter}, {loop}, {datarow}, {uuid}
    now: 'Now',                             // {timestamp}: o relógio
    // As notas depois do rótulo, em minúscula: "Variable value · from the last run".
    lastRun: 'from the last run',           // as variáveis são limpas a cada execução: o valor é o da última
    previewTime: 'preview time',            // a hora em que a prévia foi feita, não a da execução
  },
  // Por que a caixa da fonte está sem texto. Cada motivo é DIFERENTE, e dizer o errado é pior que não
  // dizer nada: "nada capturado ainda" o usuário resolve; "só o motor tem" ele não resolve. Uma frase
  // inteira por motivo · itálico, quebra a linha.
  unknown: {
    column: 'No column by that name in the data table',            // {row}, {rownext}
    variable: 'Not set — variables are cleared at the start of every run',   // {var}
    slot: 'Nothing captured in this slot yet',                     // {clip}
    history: 'Read from Windows when the macro runs',              // {winclip}
    counted: 'Counted while the macro runs',                       // {counter}, {loop}, {datarow}
    generated: 'Generated when the macro runs',                    // {uuid}
    machine: 'Read from the machine when the macro runs',          // {env}
    duringRun: 'Known only while the macro runs',                  // o popover, para toda fonte que só a execução conhece
  },
  result: 'Result',                         // rótulo da caixa do resultado
  token: 'Token',                           // rótulo da caixa do token que se grava · coringa
  empty: '(empty)',                         // a fonte ou o resultado sem texto · itálico
  reading: 'Reading…',                      // o clipboard ainda sendo lido · itálico
  // Por que o Result não mostra a prévia · itálico, uma frase inteira cada.
  noPreview: {
    noSource: 'No preview until there is something to transform.',              // a superfície, sem fonte
    readAtRun: 'No preview — this value is read when the macro runs.',          // o popover, sem fonte
    refUnfinished: 'Finish the name after @ — until then the token keeps the fixed number.',  // um @ sem nome; em vermelho
    fromVariable: 'Resolved when the macro runs — the index comes from a variable.',          // um argumento @nome
  },

  // A cadeia tem algo que estes controles não remontam: tudo fica só para ler. Um aviso, não um erro:
  // o token roda.
  readOnly: {
    // Um intervalo de linhas ou de palavras com @nome no lugar dos números.
    refArg: 'Read-only: the line argument comes from a variable, which these controls can’t show. It still runs; an invalid variable yields nothing.',
    // Um modificador desconhecido, repetido ou fora da ordem do motor.
    unknown: 'Read-only: a modifier here can’t be rebuilt as written (unknown, repeated or reordered).',
    editToChange: 'Edit the token text in the editor to change it.',   // a linha do popover, sob o token
    // Na superfície, o aviso já diz a saída, numa caixa só.
    refArgSurface: 'Read-only: the line argument comes from a variable, which these controls can’t show. It still runs; an invalid variable yields nothing. Edit the token text in the editor to change it.',
    unknownSurface: 'Read-only: a modifier here can’t be rebuilt as written (unknown, repeated or reordered). Edit the token text in the editor instead.',
  },

  // O argumento numérico que pode vir de uma variável (Line #, Word #, os N caracteres, Zero-pad to):
  // o número, e o botão @ que troca para uma referência.
  arg: {
    // Dicas do botão @ · @counter, @loop, @row e @datarow são nomes reservados e ficam.
    refTip: 'Take this number from a variable instead — @name, @counter, @loop, @row or @datarow',   // a superfície
    refTipShort: 'Use a variable instead — @name, @counter, @loop, @row or @datarow',                 // o popover
    numTip: 'Back to a fixed number',       // dica do botão @ com a referência ligada
    refPlaceholder: '@name',                // texto do campo vazio da referência: @ e o nome de uma variável · 76 px
  },
} as const;
