// O Send Text no Inspector (shell/inspector/SendTextEditor.tsx) e o modo expandido dele (Expand
// editor, textExpanded.tsx): o painel Insert (textInsert.tsx), os snippets (textSnippets.tsx), a
// prévia (textPreview.tsx) e o Transform… (textTransform.tsx); e o selo de entrega antes do texto, na
// célula do passo (components/SendTextPreview.tsx).
// As frases da entrega (por que a formatação não chega, a linha de estado, os valores do resumo da
// prévia) são de list.sendText; o que cada token faz, os grupos e os chips da paleta, de tokens.ts.
// Os tokens ({clipboard}, {enter}…), os nomes dos passos e as teclas ficam como estão (glossário).
//
// Os nomes dos formatos e dos métodos são os de list.sendText: Rich, Plain, Markdown e Discord
// (Message); Paste e Type (Delivery). Em pt-BR: Formatado, Simples, Markdown e Discord; Colar e Digitar.
// Nas lacunas: n = uma contagem já formatada (fmtNum: 1,234 / 1.234).
export default {
  // O formato da mensagem: o rótulo da seção e o nome do segmentado (leitor de tela) · só o substantivo.
  message: 'Message',
  // As opções do segmentado de 4 · orçamento: 71 px por opção, uma palavra.
  formats: {
    rich: 'Rich',             // a formatação vai como HTML
    markdown: 'Markdown',     // marca
    discord: 'Discord',       // marca
    plain: 'Plain',           // só o texto
  },
  // As dicas das mesmas opções: o que cada formato envia e para onde serve.
  formatTips: {
    rich: 'Real formatting (Gmail, Crisp, Word)',
    markdown: '*bold* / _italic_ as text — for WhatsApp',
    discord: '**bold** / ~~strike~~ as text — for Discord',
    plain: 'Only the text: the formatting stays with the step, unsent',
  },

  // Como o texto chega: o rótulo da seção e o nome do segmentado (leitor de tela) · só o substantivo.
  delivery: 'Delivery',
  // As opções do segmentado de 2 · orçamento: 143 px por opção · verbo.
  methods: {
    paste: 'Paste',
    type: 'Type',
  },
  methodTips: {
    paste: 'Ctrl+V — the only way that sends formatting',
    type: 'Key by key — for apps that ignore Ctrl+V',
  },
  // A linha sob o segmentado, pelo método escolhido. Paste e Type são as opções acima.
  typeHint: 'Type sends key by key, for apps that block pasting.',
  pasteHint: 'Paste goes through the clipboard and puts it back after.',
  charDelay: 'Per-character delay in milliseconds',  // nome do campo da pausa entre as letras, com Type (leitor de tela)

  // O campo da mensagem vazio: a frase e, embaixo, a dica menor. A { e os tokens ficam como estão.
  placeholder: 'Type the text to send…',
  placeholderTip: 'Type { for tokens, like {enter} or {date}',

  // As contagens sob a mensagem, juntas por " · ": "36 chars · 2 tokens · 2 lines". count = o número;
  // n = o mesmo número, formatado. Um Enter (o token) também conta como linha.
  counts: {
    chars: { one: '{{n}} char', other: '{{n}} chars' },
    tokens: { one: '{{n}} token', other: '{{n}} tokens' },
    lines: { one: '{{n}} line', other: '{{n}} lines' },
  },

  // Os verbos dos botões do painel Insert e do Transform…: infinitivo, sem artigo.
  actions: {
    insert: 'Insert',          // põe o token no cursor: o pedido do nome e o rodapé do Transform…
    transform: 'Transform…',   // abre o construtor da cadeia: o chip do grupo Clipboard e o botão do pedido do nome
  },

  // O painel Insert do modo expandido (textInsert.tsx). Os grupos e os chips de tokens são de tokens.ts.
  insert: {
    panel: 'Insert',           // nome das abas do painel, para o leitor de tela
    // As abas · coringas (token, snippet); Emoji é igual em pt-BR.
    tabs: {
      tokens: 'Tokens',
      snippets: 'Snippets',
      emoji: 'Emoji',
    },
    noTable: 'This macro has no Data Loop table yet.',      // no grupo da tabela, sem nenhuma coluna
    badColumn: 'Not a valid token name ({ } : not allowed)', // dica de uma coluna que não pode virar {row:…}
    transformTip: 'Build a {clipboard:...} transform: trim, split, lines, case…',  // dica do chip Transform… (os passos do construtor)
    more: 'More…',             // chip que mostra os chips raros do grupo
    less: 'Less',              // o mesmo chip com eles à mostra
    hint: 'A token goes in where the cursor is. Click a token in the message to change it.',
    searchEmoji: 'Search emoji…',  // o texto de dentro do campo de pesquisa da aba Emoji
  },

  // O pedido do nome de um chip (Variable…, Row column…, Clip slot…, Ask input…, Env…), junto do chip,
  // com o token como vai ficar e o que ele faz (tokens.ts) em cima.
  prompt: {
    // O nome do campo e do pedido, para o leitor de tela · só o substantivo.
    field: {
      var: 'Variable name',
      row: 'Data column',          // {row:…} e {rownext:…}: a coluna da tabela do Data Loop
      clip: 'Slot name',
      input: 'Prompt label',       // {input:…}: o texto da pergunta que a execução faz
      env: 'Environment variable',
    },
    // O texto de dentro do campo vazio. O do slot ("1") e o da variável de ambiente ("USERNAME") são
    // exemplos de valor e ficam no código, iguais nos dois idiomas.
    example: {
      var: 'name',                 // minúscula: o nome de uma variável
      row: 'column',               // minúscula: o nome de uma coluna
      input: 'What to ask',
    },
    // A linha sob o campo.
    hints: {
      input: 'Click the chip afterwards to add dropdown options.',
      clip: 'The capture hotkey fills slots 1–9.',
      env: 'Read from this machine when the macro runs — USERNAME, USERPROFILE, TEMP…',  // a variável (feminino); os nomes são do Windows
    },
    transformTip: 'Transforms: trim, split, lines, case…',  // dica do botão Transform… (os passos do construtor)
    closeTip: '{{>common.actions.close}} (Esc)',            // dica do × do canto
  },

  // A aba Snippets (textSnippets.tsx): os textos guardados nesta máquina · snippet é coringa.
  snippets: {
    title: 'Snippets',                 // o título da barra, enquanto não há nenhum
    search: 'Search snippets',         // nome do campo de pesquisa (leitor de tela)
    searchHint: 'Search snippets…',    // o texto de dentro do campo vazio
    export: 'Export snippets',         // botão: o nome e a dica; e o título da janela Salvar do Windows
    import: 'Import snippets',         // botão: o nome (leitor de tela)
    importTip: '{{>sendText.snippets.import}} (added to yours)',  // a dica: os do arquivo se somam aos seus
    saveAs: 'Save as snippet',         // botão: o nome e a dica; guarda o texto da mensagem com um nome
    needsText: 'Type something first', // dica dos botões de salvar com a mensagem vazia
    name: 'Snippet name',              // nome do campo (leitor de tela)
    nameHint: 'Snippet name…',         // o texto de dentro do campo vazio
    text: 'Snippet text',              // nome do campo do texto, ao editar
    textHint: 'Snippet text…',
    save: 'Save snippet',              // botão do formulário · verbo
    none: 'No saved snippets yet',     // a lista vazia
    saveCurrent: 'Save current text as a snippet',  // botão da lista vazia · verbo
    noMatch: 'No snippets match “{{query}}”',       // query = o que foi digitado na pesquisa
    edit: 'Edit snippet',              // botão da linha (o nome e a dica) e o título do formulário de edição
    delete: 'Delete snippet',          // botão da linha (o nome e a dica) e o ✓ que confirma
    confirmDelete: 'Delete snippet?',  // a pergunta, na própria linha (sem desfazer)
    cancelTip: '{{>common.actions.cancel}} (Esc)',  // dica do ✕ da pergunta
    // O resultado da exportação e da importação, na linha sob a barra.
    saved: { one: 'Saved {{n}} snippet', other: 'Saved {{n}} snippets' },
    added: { one: 'Added {{n}} snippet', other: 'Added {{n}} snippets' },
    addedSkipped: 'Added {{n}}, skipped {{skipped}} incomplete',  // n = os somados; skipped = os incompletos, que ficaram de fora
    saveFailed: 'Could not save the file',
    readFailed: 'Could not read that file',
    // Por que o arquivo não foi importado.
    notJson: 'That file is not valid JSON',
    notSnippets: 'That is not a snippets file',
    newerVersion: 'That file is from a newer version',
    noSnippets: 'No usable snippets in that file',
  },

  // A prévia do modo expandido (textPreview.tsx): a mensagem com os valores de hoje e como ela sai.
  // As dicas das marcas cinza e dos valores são de tokenEditor (messagePreview.ts); os valores do
  // resumo (Transport, Flavor, Formatting), de list.sendText.
  preview: {
    title: "Preview, with today's values",   // rótulo da seção
    empty: 'Nothing to send yet',            // a bolha, com a mensagem vazia
    marksAdded: 'Formatting marks (*bold*) are added on send.',  // Markdown e Discord, com formatação
    // De onde vieram os valores. names = os nomes das variáveis ou das colunas, já em lista ("a, b and
    // c"); count = quantos são (1 ou mais).
    fromRun: {
      one: '{{names}} comes from the last run, in Live Variables. The real run fills in the value it has at that moment.',
      other: '{{names}} come from the last run, in Live Variables. The real run fills in the value it has at that moment.',
    },
    fromRow: {
      one: '{{names}} is the Data Loop table’s first row; a run uses the row it is on.',
      other: '{{names}} are the Data Loop table’s first row; a run uses the row it is on.',
    },
    clock: 'Dates and times are now’s; the run uses the moment it sends.',
    // O resumo da entrega: os rótulos · só o substantivo.
    transport: 'Transport',
    flavor: 'Flavor',
    formatting: 'Formatting',
    tokens: 'Tokens',                        // coringa
    warning: 'Warning',                      // o ícone de alerta da formatação, para o leitor de tela
    noTokens: 'None',                        // a linha Tokens, sem tokens na mensagem (token: masculino)
    // A linha Tokens. names = os tokens da mensagem como os chips os escrevem (Enter, Var:nome),
    // separados por vírgula; n = os que passaram dos 8 mostrados.
    tokensLine: '{{names}} · filled in at replay',
    tokensLineMore: '{{names}} +{{n}} more · filled in at replay',
  },

  // O Transform… (textTransform.tsx): o construtor da cadeia, por cima das duas colunas.
  transform: {
    name: 'Transform',                       // nome do construtor, para o leitor de tela
    backEdit: 'Back to the message — the changes are in it already',  // dica do ‹ Editor, editando um token
    backInsert: 'Back to the message, inserting nothing',             // a mesma, montando um token novo
    deleteToken: 'Delete token',             // botão do rodapé, editando · verbo
    // A linha do rodapé.
    order: 'Steps apply in the order shown', // montando um novo · os passos são os do construtor
    asWritten: 'The token stays as it is written',  // uma cadeia que o construtor não sabe refazer
    live: 'Each change goes into the message · Ctrl+Z undoes',
    nameFirst: 'Name it first',              // dica do Insert, sem o nome que a fonte pede
  },

  // O selo de entrega antes do texto, na célula do passo (SendTextPreview.tsx), em maiúsculas
  // pequenas · curto: divide a célula com o texto, que corta com reticências.
  badge: {
    rich: 'rich',              // o formato Rich
    md: 'md',                  // Markdown ou Discord: as marcas vão no texto
    type: 'type',              // o método Type
    degraded: '(degraded)',    // depois do selo, só para o leitor de tela: a formatação não vai chegar
  },
} as const;
