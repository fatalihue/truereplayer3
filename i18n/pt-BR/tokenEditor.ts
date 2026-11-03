import type en from '../en-US/tokenEditor.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  editor: {
    name: 'Texto a enviar',
    placeholder: 'Digite o texto a enviar…',
  },

  // Os nomes do Word em pt-BR. Os atalhos são os do editor (Lexical), iguais nos dois idiomas.
  toolbar: {
    bold: 'Negrito',
    boldTip: '{{>tokenEditor.toolbar.bold}} (Ctrl+B)',
    italic: 'Itálico',
    italicTip: '{{>tokenEditor.toolbar.italic}} (Ctrl+I)',
    underline: 'Sublinhado',
    underlineTip: '{{>tokenEditor.toolbar.underline}} (Ctrl+U)',
    strikethrough: 'Tachado',
    code: 'Código inline',
    clearFormatting: 'Limpar formatação',
    clearFormattingTip: '{{>tokenEditor.toolbar.clearFormatting}} (Ctrl+\\)',
    nothingToClear: 'Selecione um texto formatado para limpar',
    bulletList: 'Lista com marcadores',
    numberedList: 'Lista numerada',
    link: 'Inserir link',
    removeLink: 'Remover link',
    linkUrl: 'URL do link',
    urlExample: 'https://…',
    applyLink: 'Aplicar link',
    cancelLink: 'Cancelar link',
  },

  autocomplete: {
    name: 'Tokens',
    keys: 'Enter insere · Esc mantém a chave',
  },

  chip: {
    noDescription: 'Token substituído ao reproduzir.',
    deleteToken: 'Excluir token',
    noParameters: 'Nenhum parâmetro editável.',
  },

  delay: {
    label: 'Delay',
  },
  // "Repetir [3] vezes".
  repeat: {
    label: 'Repetir',
    times: { zero: 'vezes', one: 'vez', other: 'vezes' },
    limit: 'O motor aceita até {{n}} pressionamentos por token.',
  },
  random: {
    label: 'Número aleatório',
    to: 'a',
    inclusive: 'Inclui os dois extremos.',
  },
  // "clipboard" é coringa, em minúscula no meio da frase (o rótulo sai em caixa alta na tela de todo jeito).
  winclip: {
    label: 'Histórico do clipboard',
    item: 'item',
    mostRecent: '1 = o mais recente',
    warning: 'Pode conter qualquer coisa que um app copiou — até senhas.',
    source: 'Texto do item',
  },
  name: {
    variable: 'Nome da variável',
    slot: 'Nome do slot',
    env: 'Variável de ambiente',
    variableExample: 'nome',
    envExample: 'USERNAME',
    slotSource: 'Texto do slot',
    variableSource: 'Valor da variável',
  },
  timestamp: {
    unit: 'Unidade',
    seconds: 'Segundos',
    milliseconds: 'Milissegundos',
    source: 'Agora',
  },
  column: {
    label: 'Coluna de dados',
    example: 'coluna',
    source: 'Célula (primeira linha)',
  },
  input: {
    label: 'Texto da pergunta',
    example: 'O que perguntar',
    answerAs: 'A resposta também fica disponível como {{token}}.',
    reuseHint: 'Para reusar a resposta como {var:…}, use só letras, dígitos e _.',
    menu: 'Opções do menu (opcional)',
    menuExample: 'Sim,Não,Talvez',
    menuHint: 'Separadas por vírgula → viram uma lista suspensa.',
  },
  pick: {
    label: 'Opções',
    example: 'Olá! Tudo bem?\nOi, como posso ajudar?\nBom dia!',
    hint: 'Uma por linha.',
    readOnly: 'Só leitura: uma opção tem uma quebra de linha, que uma opção por linha não consegue mostrar. O token roda mesmo assim; para mudá-lo, edite o texto dele no editor.',
  },
  // "[7] [atrás] [adiante]" e, embaixo, as unidades: "7 dias atrás".
  date: {
    shift: 'Deslocamento',
    several: 'Este token tem vários deslocamentos — edite-o à mão.',
    back: 'atrás',
    ahead: 'adiante',
    now: 'agora',
    limit: 'O motor aceita até {{n}} por deslocamento.',
    units: {
      days: 'dias',
      weeks: 'semanas',
      months: 'meses',
      years: 'anos',
      hours: 'horas',
      minutes: 'minutos',
    },
    format: 'Formato',
    presets: {
      default: 'Padrão',
      iso: 'ISO',
      long: 'Longo',
      twelveHour: '12 horas',
    },
    pattern: 'Formato do .NET. MM = mês, mm = minutos.',
    result: 'Resultado agora',
    invalid: 'Formato inválido — o token é digitado como texto.',
  },
  value: {
    source: 'Valor',
  },

  // O "action" do inglês é o passo da lista; o modo do Data Loop é citado pela opção dele (dataLoop.settings.modes).
  preview: {
    reason: {
      literal: 'Enviado literalmente, com as chaves — o argumento não está em uma forma que o motor aceita.',
      'key-press': 'Enviado como tecla entre os blocos de texto, não como caracteres.',
      delay: 'Uma pausa na digitação, não texto.',
      random: 'Sorteado de novo a cada execução.',
      pick: 'Uma das opções, sorteada de novo a cada execução.',
      ask: 'A execução pausa e pergunta este valor a você.',
      runtime: 'Só o motor tem este valor, e só enquanto a macro roda.',
      'runtime-clipreading': 'Lendo o clipboard…',
      'runtime-counter': 'O número da repetição da execução — não há valor fora de uma execução.',
      'runtime-loop': 'A volta do bloco While / For Each mais interno — não há valor fora de uma execução.',
      'runtime-datarow': 'O número da linha de dados atual — não há valor fora de uma execução.',
      'runtime-row': 'A linha do próprio passo na lista — não há valor fora de uma execução.',
      'runtime-rowcursor': 'Com “{{>dataLoop.settings.modes.next}}”, cada execução pega a PRÓXIMA linha, e essa posição fica guardada entre as execuções.',
      'runtime-norows': 'A tabela de dados não tem linhas, então isto fica vazio ao reproduzir.',
      'runtime-cursor': 'Avança sozinho: a linha depende de quantas execuções vieram antes.',
      'unmodeled-chain': 'O construtor não consegue representar esta cadeia, então não mostra resultado. Ela roda mesmo assim.',
      'unknown-column': 'Nenhuma coluna com esse nome na tabela de dados.',
      unset: 'Nada guardado com esse nome ainda.',
      generated: 'Um identificador novo a cada uso — guarde-o em uma variável para reaproveitar.',
      'runtime-env': 'Lido do ambiente desta máquina quando a macro roda; o editor não tem acesso a ele.',
    },
    // "formato regional": o nome que o Windows dá ao ajuste que o motor segue (Hora e idioma › Idioma e região).
    note: {
      clock: 'Hora da prévia. Os nomes de mês e de dia seguem o formato regional do Windows ao reproduzir.',
      'first-data-row': 'A PRIMEIRA linha de dados. Uma execução usa a linha em que está; ForEach e Run Macro podem usar outra tabela.',
      'last-run': 'Da ÚLTIMA execução — as variáveis zeram a cada início.',
    },
    pending: {
      pause: 'pausa de {{ms}} ms',
      runRepeat: 'repetição da execução',
      blockIteration: 'volta do bloco',
      dataRowNumber: 'número da linha de dados',
      newUuid: 'novo UUID',
      random: '{{range}} ao acaso',
      pick: 'uma de {{n}}',
      historyItem: 'item {{n}} do histórico',
      actionRow: 'linha do passo',
      clipboard: 'clipboard',
      nextClipboardLine: 'próxima linha do clipboard',
      nextRowOf: 'próxima linha de {{column}}',
    },
  },
} satisfies Catalogo<typeof en>;
