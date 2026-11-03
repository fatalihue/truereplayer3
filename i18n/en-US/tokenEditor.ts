// O editor de tokens (frontend/src/components/lexical/): o campo do Send Text e do Type Text no
// Inspector (LexicalTokenEditor.tsx), com a barra de formatação do modo Rich e a lista que o `{` abre;
// o chip de cada token no campo (TokenChip.tsx) e o popover que o edita (TokenChipPopover.tsx); e a
// prévia da mensagem (messagePreview.ts), que a aba Preview do Inspector mostra
// (shell/inspector/textPreview.tsx).
//
// Ficam como se digitam, nos dois idiomas (glossário): os tokens ({clipboard}, {var:nome},
// {date:+7d}…), os modificadores, as teclas e os formatos (.NET: dd/MM/yyyy, HH:mm). Os nomes e as
// descrições dos tokens vêm de tokenCatalog.ts e tokenDescriptions.ts, de outra área.
// O popover tem 260 ou 300 px; os rótulos de seção dele são substantivos em caixa alta, e as frases
// quebram a linha.
export default {
  // O campo de texto, quando a tela que o usa não dá outro nome nem outro texto de exemplo.
  editor: {
    name: 'Text to send',                       // nome do campo, para o leitor de tela: o texto que o Send Text envia
    placeholder: 'Type the text to send…',      // o campo vazio · verbo
  },

  // A barra de formatação do modo Rich do Send Text. Os botões são só ícone: o nome (leitor de tela) é
  // o substantivo, como no Word, e a dica repete o nome com o atalho (Lexical: Ctrl+B, Ctrl+I, Ctrl+U).
  toolbar: {
    bold: 'Bold',
    boldTip: '{{>tokenEditor.toolbar.bold}} (Ctrl+B)',
    italic: 'Italic',
    italicTip: '{{>tokenEditor.toolbar.italic}} (Ctrl+I)',
    underline: 'Underline',
    underlineTip: '{{>tokenEditor.toolbar.underline}} (Ctrl+U)',
    strikethrough: 'Strikethrough',             // nome e dica
    code: 'Inline code',                        // nome e dica: o trecho em fonte de código, dentro da linha
    clearFormatting: 'Clear formatting',        // a borracha: nome · verbo
    clearFormattingTip: '{{>tokenEditor.toolbar.clearFormatting}} (Ctrl+\\)',
    nothingToClear: 'Select formatted text to clear it',  // dica da borracha desligada: o que fazer
    bulletList: 'Bullet list',                  // nome e dica
    numberedList: 'Numbered list',              // nome e dica
    link: 'Link',                               // nome e dica do botão que abre o campo do endereço
    removeLink: 'Remove link',                  // o mesmo botão, com o cursor dentro de um link · verbo
    linkUrl: 'Link URL',                        // nome do campo do endereço, para o leitor de tela
    urlExample: 'https://…',                    // texto de exemplo do campo do endereço · igual nos dois idiomas
    applyLink: 'Apply link',                    // nome e dica do ✓ ao lado do campo · verbo
    cancelLink: 'Cancel link',                  // nome do ✕ ao lado do campo, para o leitor de tela (a dica é common.actions.cancel)
  },

  // A lista que o `{` abre no campo: os tokens, filtrados pelo que se digita depois da chave.
  autocomplete: {
    name: 'Tokens',                             // nome da lista, para o leitor de tela · coringa
    // O rodapé da lista, uma linha em 256 px. brace = a chave { que abriu a lista e que fica no texto.
    keys: 'Enter inserts · Esc keeps the brace',
  },

  // O popover do chip: o cabeçalho (o token e o que ele faz, de tokenDescriptions.ts) e o rodapé.
  chip: {
    noDescription: 'Token substituted while replaying.',  // cabeçalho de um token que não tem descrição
    deleteToken: 'Delete token',                // botão do rodapé · verbo
    noParameters: 'No editable parameters.',    // o corpo, num token sem nada a ajustar ({row})
  },

  // Os editores do popover, um por tipo de token. Rótulos de seção: só o substantivo.
  delay: {
    label: 'Delay',                             // {delay:N}: a pausa em ms · coringa
  },
  repeat: {
    label: 'Repeat',                            // {enter:N}…: quantas vezes apertar · rótulo, antes do número
    times: { one: 'time', other: 'times' },     // depois do número de vezes, sem o número · count = esse número (1 a 100)
    limit: "{{n}} presses is the engine's limit for one token.",  // no teto · n = o teto (100), formatado
  },
  random: {
    label: 'Random number',                     // {random:1-10}
    to: 'to',                                   // entre os dois números: "1 to 10"
    inclusive: 'Inclusive.',                    // os dois extremos entram no sorteio
  },
  winclip: {
    label: 'Clipboard history',                 // {winclip:N}: o histórico do Win+V do Windows
    item: 'item',                               // antes do número do item · minúscula
    mostRecent: '1 = most recent',              // depois do número
    warning: 'May hold anything any app copied — passwords too.',
    source: 'Item text',                        // rótulo da caixa com o texto de origem (o do item, desconhecido aqui)
  },
  // {var:nome}, {clip:nome} e {env:NOME}: o nome e o que os modificadores recebem.
  name: {
    variable: 'Variable name',                  // rótulo do campo do nome, no {var:…}
    slot: 'Slot name',                          // no {clip:…}
    env: 'Environment variable',                // no {env:…}
    variableExample: 'name',                    // texto de exemplo do campo do {var:…} · minúscula
    envExample: 'USERNAME',                     // texto de exemplo do campo do {env:…}: uma variável que todo Windows tem · igual nos dois idiomas
    slotSource: 'Slot text',                    // rótulo da caixa com o texto de origem, no {clip:…}
    variableSource: 'Variable value',           // o mesmo, no {var:…} e no {env:…}
  },
  timestamp: {
    unit: 'Unit',                               // {timestamp}: rótulo da seção e nome do grupo de opções
    seconds: 'Seconds',
    milliseconds: 'Milliseconds',
    source: 'Now',                              // rótulo da caixa com o valor de agora
  },
  column: {
    label: 'Data column',                       // {row:Coluna} e {rownext:Coluna}: a coluna da tabela do Data Loop
    example: 'column',                          // texto de exemplo do campo · minúscula
    source: 'Cell (first row)',                 // rótulo da caixa com a célula da primeira linha da tabela
  },
  // {input:Pergunta} e {input:Pergunta|menu:a,b,c}: a execução pausa e pergunta.
  input: {
    label: 'Prompt label',                      // rótulo do campo com o texto da pergunta
    example: 'What to ask',                     // texto de exemplo desse campo
    answerAs: 'Answer also readable as {{token}}.',  // token = o {var:…} que lê a resposta, como {var:Nome}
    reuseHint: 'To reuse the answer as {var:…}, use letters, digits and _ only.',  // a pergunta tem espaço ou acento
    menu: 'Menu options (optional)',            // rótulo do campo das opções
    menuExample: 'Yes,No,Maybe',                // texto de exemplo: as opções separadas por vírgula, sem espaço
    menuHint: 'Comma-separated → shown as a dropdown.',
  },
  // {pick:a|b|c}: uma das opções, sorteada.
  pick: {
    label: 'Options',
    example: 'Olá! Tudo bem?\nOi, como posso ajudar?\nBom dia!',  // texto de exemplo: três opções, uma por linha
    hint: 'One per line.',
    readOnly: 'Read-only: an option holds a line break, which one option per line can’t show. It still runs; edit the token text in the editor to change it.',
  },
  // {date}, {time} e {datetime}: o deslocamento e o formato.
  date: {
    shift: 'Shift',                             // rótulo da seção: quanto a data anda (não a tecla Shift)
    several: 'Several offsets in this token — edit it by hand.',
    back: 'back',                               // botão de opção, depois do número: para o passado · minúscula
    ahead: 'ahead',                             // para o futuro · minúscula
    now: 'now',                                 // com o número 0 · minúscula
    limit: "{{n}} is the engine's limit for one shift.",  // no teto · n = o teto (999999), formatado
    // As unidades do deslocamento, botões de opção pequenos que quebram a linha.
    units: {
      days: 'days',
      weeks: 'weeks',
      months: 'months',
      years: 'years',
      hours: 'hours',
      minutes: 'minutes',
    },
    format: 'Format',                           // rótulo da seção do formato
    // Os formatos prontos, botões de opção pequenos. O formato HH:mm fica como se escreve.
    presets: {
      default: 'Default',                       // o formato padrão do token (dd/MM/yyyy, HH:mm:ss)
      iso: 'ISO',                               // ISO 8601 · igual nos dois idiomas
      long: 'Long',                             // o formato longo (D, F)
      twelveHour: '12-hour',                    // o relógio de 12 horas (h:mm tt)
    },
    pattern: '.NET pattern. MM = month, mm = minutes.',  // dica do campo do formato
    result: 'Resolves now to',                  // rótulo da seção com o resultado de agora
    invalid: 'Invalid format — the token is typed as text.',
  },
  // {counter}, {loop}, {datarow} e {uuid}: só a cadeia de modificadores.
  value: {
    source: 'Value',                            // rótulo da caixa com o texto de origem (desconhecido aqui)
  },

  // A prévia da mensagem (aba Preview do Inspector).
  preview: {
    // Por que uma peça fica pendente: a dica dela, depois vem " — {token}". Uma frase por motivo.
    reason: {
      literal: 'Sent verbatim, braces included — the argument is not a shape the engine accepts.',
      'key-press': 'Sent as a key press between the text blocks, not as characters.',
      delay: 'A pause in the typing, not text.',
      random: 'Drawn fresh every run.',
      pick: 'One of the options, drawn fresh every run.',
      ask: 'The run pauses and asks you for this value.',
      runtime: 'Only the engine has this value, and only while the macro runs.',
      'runtime-clipreading': 'Reading the clipboard…',
      'runtime-counter': 'The run repeat number — there is no value outside a run.',
      'runtime-loop': 'The iteration of the innermost While / For Each block — there is no value outside a run.',
      'runtime-datarow': 'The number of the current data row — there is no value outside a run.',
      'runtime-row': "The action's own grid row — there is no value outside a run.",  // {row}: a linha do próprio passo
      // O Data Loop em "uma linha por vez": a posição fica guardada de uma execução para a outra.
      'runtime-rowcursor': 'With “{{>dataLoop.settings.modes.next}}”, each run takes the NEXT row, and that position lives between runs.',
      'runtime-norows': 'The Data table has no rows, so this resolves to nothing at replay.',
      'runtime-cursor': 'Auto-advancing: the line depends on how many runs came before.',
      'unmodeled-chain': 'The builder cannot model this chain, so it shows no result. It still runs.',
      'unknown-column': 'No column by that name in the Data table.',
      unset: 'Nothing stored under that name yet.',
      generated: 'A fresh identifier at every use — store it in a variable to reuse one.',
      'runtime-env': 'Read from this machine’s environment when the macro runs; the editor cannot see it.',
    },
    // De onde veio um valor resolvido: a dica dele.
    note: {
      clock: 'Preview time. Month and day names follow the machine locale at replay.',
      'first-data-row': 'The FIRST data row. A run uses the row it is on; ForEach and Run Macro can use another table.',
      'last-run': 'From the LAST run — variables reset at every start.',
    },
    // O texto no lugar de uma peça pendente, dentro da mensagem · minúscula, curto.
    pending: {
      pause: 'pause {{ms}} ms',                 // {delay:N} · ms = a pausa, formatada
      runRepeat: 'run repeat',                  // {counter}: o número da repetição da execução
      blockIteration: 'block iteration',        // {loop}: a volta do bloco While / For Each
      dataRowNumber: 'data row number',         // {datarow}
      newUuid: 'new UUID',                      // {uuid}
      random: '{{range}} at random',            // {random:1-10} · range = os dois números, como no token (1-10)
      pick: 'one of {{n}}',                     // {pick:a|b|c} · n = quantas opções
      historyItem: 'history item {{n}}',        // {winclip:N} · n = o número do item
      actionRow: 'action row',                  // {row}: a linha do próprio passo
      clipboard: 'clipboard',                   // {clipboard}, enquanto a leitura não volta · coringa
      nextClipboardLine: 'next clipboard line', // {clipboard:next}
      nextRowOf: 'next row of {{column}}',      // {rownext:Coluna} · column = o nome da coluna
    },
  },
} as const;
