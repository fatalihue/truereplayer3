import type en from '../en-US/sendText.ts';
import type { Catalogo } from '../tipos.ts';

// Rich, Plain, Paste e Type são Formatado, Simples, Colar e Digitar, como em list.sendText; Markdown e
// Discord são marcas. clipboard, token, snippet, slot, hotkey e delay são coringas.
export default {
  message: 'Mensagem',
  formats: {
    rich: 'Formatado',
    markdown: 'Markdown',
    discord: 'Discord',
    plain: 'Simples',
  },
  formatTips: {
    rich: 'Formatação real (Gmail, Crisp, Word)',
    markdown: '*negrito* / _itálico_ como texto — para WhatsApp',
    discord: '**negrito** / ~~tachado~~ como texto — para Discord',
    plain: 'Só o texto: a formatação fica no passo, sem ser enviada',
  },

  delivery: 'Entrega',
  methods: {
    paste: 'Colar',
    type: 'Digitar',
  },
  methodTips: {
    paste: 'Ctrl+V — o único jeito de enviar a formatação',
    type: 'Tecla a tecla — para apps que ignoram o Ctrl+V',
  },
  typeHint: 'Digitar envia tecla a tecla, para apps que não deixam colar.',
  pasteHint: 'Colar passa pelo clipboard e depois o devolve como estava.',
  charDelay: 'Delay por letra em milissegundos',

  placeholder: 'Digite o texto a enviar…',
  placeholderTip: 'Digite { para os tokens, como {enter} ou {date}',

  // Uma linha de números: o 0 também leva o número ("0 caracteres").
  counts: {
    chars: { zero: '{{n}} caracteres', one: '{{n}} caractere', other: '{{n}} caracteres' },
    tokens: { zero: '{{n}} tokens', one: '{{n}} token', other: '{{n}} tokens' },
    lines: { zero: '{{n}} linhas', one: '{{n}} linha', other: '{{n}} linhas' },
  },

  actions: {
    insert: 'Inserir',
    transform: 'Transformar…',
  },

  insert: {
    panel: 'Inserir',
    tabs: {
      tokens: 'Tokens',
      snippets: 'Snippets',
      emoji: 'Emoji',
    },
    noTable: 'Esta macro ainda não tem tabela do Data Loop.',
    badColumn: 'Não é um nome de token válido ({ } : não são aceitos)',
    // Os nomes dos passos do construtor em pt-BR (clipboard.steps): Aparar, Cortar em, Linhas, Maiúsculas e minúsculas.
    transformTip: 'Montar uma transformação {clipboard:...}: aparar, cortar, linhas, maiúsculas…',
    more: 'Mais…',
    less: 'Menos',
    hint: 'Um token entra onde está o cursor. Um clique em um token da mensagem o altera.',
    searchEmoji: 'Pesquisar emoji…',
  },

  // Os mesmos nomes dos campos do popover do token (tokenEditor.name, column e input).
  prompt: {
    field: {
      var: 'Nome da variável',
      row: 'Coluna de dados',
      clip: 'Nome do slot',
      input: 'Texto da pergunta',
      env: 'Variável de ambiente',
    },
    example: {
      var: 'nome',
      row: 'coluna',
      input: 'O que perguntar',
    },
    hints: {
      input: 'Depois, um clique no chip adiciona as opções de uma lista suspensa.',
      clip: 'A hotkey de captura preenche os slots 1–9.',
      env: 'Lida desta máquina quando a macro roda — USERNAME, USERPROFILE, TEMP…',
    },
    transformTip: 'Transformações: aparar, cortar, linhas, maiúsculas…',
    closeTip: '{{>common.actions.close}} (Esc)',
  },

  snippets: {
    title: 'Snippets',
    search: 'Pesquisar snippets',
    searchHint: 'Pesquisar snippets…',
    export: 'Exportar snippets',
    import: 'Importar snippets',
    importTip: '{{>sendText.snippets.import}} (somados aos seus)',
    saveAs: 'Salvar como snippet',
    needsText: 'Digite algo primeiro',
    name: 'Nome do snippet',
    nameHint: 'Nome do snippet…',
    text: 'Texto do snippet',
    textHint: 'Texto do snippet…',
    save: 'Salvar snippet',
    none: 'Nenhum snippet salvo ainda',
    saveCurrent: 'Salvar o texto atual como snippet',
    noMatch: 'Nenhum snippet corresponde a “{{query}}”',
    edit: 'Editar snippet',
    delete: 'Excluir snippet',
    confirmDelete: 'Excluir o snippet?',
    cancelTip: '{{>common.actions.cancel}} (Esc)',
    saved: { zero: 'Nenhum snippet salvo', one: '{{n}} snippet salvo', other: '{{n}} snippets salvos' },
    added: { zero: 'Nenhum snippet adicionado', one: '{{n}} snippet adicionado', other: '{{n}} snippets adicionados' },
    // Duas contagens numa frase não concordam as duas: rótulo e número, que vale para 1 e para 10.
    addedSkipped: 'Snippets adicionados: {{n}} · incompletos ignorados: {{skipped}}',
    saveFailed: 'Não foi possível salvar o arquivo',
    readFailed: 'Não foi possível ler esse arquivo',
    notJson: 'Esse arquivo não é um JSON válido',
    notSnippets: 'Esse não é um arquivo de snippets',
    newerVersion: 'Esse arquivo é de uma versão mais nova',
    noSnippets: 'Nenhum snippet aproveitável nesse arquivo',
  },

  preview: {
    title: 'Prévia, com os valores de hoje',
    empty: 'Nada a enviar ainda',
    marksAdded: 'As marcas de formatação (*negrito*) entram no envio.',
    // count nunca é 0 aqui (a linha só aparece com um nome ou mais); o zero repete o plural.
    fromRun: {
      zero: '{{names}} vêm da última execução, em Live Variables. A execução real usa o valor que houver no momento.',
      one: '{{names}} vem da última execução, em Live Variables. A execução real usa o valor que houver no momento.',
      other: '{{names}} vêm da última execução, em Live Variables. A execução real usa o valor que houver no momento.',
    },
    fromRow: {
      zero: '{{names}} vêm da primeira linha da tabela do Data Loop; uma execução usa a linha em que estiver.',
      one: '{{names}} vem da primeira linha da tabela do Data Loop; uma execução usa a linha em que estiver.',
      other: '{{names}} vêm da primeira linha da tabela do Data Loop; uma execução usa a linha em que estiver.',
    },
    clock: 'As datas e as horas são as de agora; a execução usa o momento em que envia.',
    transport: 'Envio',
    flavor: 'Formato',
    formatting: 'Formatação',
    tokens: 'Tokens',
    warning: 'Aviso',
    noTokens: 'Nenhum',
    tokensLine: '{{names}} · preenchidos ao reproduzir',
    tokensLineMore: '{{names}} e mais {{n}} · preenchidos ao reproduzir',
  },

  transform: {
    name: 'Transformar',
    backEdit: 'Volta à mensagem — as alterações já estão nela',
    backInsert: 'Volta à mensagem, sem inserir nada',
    deleteToken: 'Excluir token',
    order: 'Os passos se aplicam na ordem mostrada',
    asWritten: 'O token fica como está escrito',
    live: 'Cada alteração vai para a mensagem · Ctrl+Z desfaz',
    nameFirst: 'Dê um nome primeiro',
  },

  // Os nomes das opções do editor (Formatado, Digitar), em maiúsculas pequenas.
  badge: {
    rich: 'formatado',
    md: 'md',
    type: 'digitar',
    degraded: '(degradado)',
  },
} satisfies Catalogo<typeof en>;
