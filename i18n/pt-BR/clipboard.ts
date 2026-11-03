import type en from '../en-US/clipboard.ts';
import type { Catalogo } from '../tipos.ts';

// "clipboard" é coringa: fica, em minúscula no meio da frase ("Cola o clipboard inteiro", "Histórico do
// clipboard"), e com maiúscula só no começo de um título (Clipboard, a fonte). Os nomes dos
// modificadores no token (trim, upper, lines…) não aparecem aqui: os rótulos se traduzem, os nomes
// ficam no token.
export default {
  heads: {
    clipboard: 'Clipboard',
    row: 'Coluna de dados',
    rownext: 'Coluna de dados (próxima linha)',
    var: 'Variável',                      // a variável da execução, palavra comum (não a condição Variable)
    clip: 'Slot do clipboard',
    winclip: 'Histórico do clipboard',
    counter: 'Repetição da execução',
    loop: 'Volta do loop',
    datarow: 'Número da linha de dados',
    uuid: 'UUID',
    timestamp: 'Timestamp',               // o nome do token {timestamp}; "carimbo de data/hora" é longo e ninguém fala
    env: 'Variável de ambiente',
  },

  back: 'Editor',
  backTip: 'Descarta as alterações',
  refresh: 'Atualizar',

  identity: {
    column: 'Coluna de dados',
    variableName: 'Nome da variável',
    slotName: 'Nome do slot',
    historyItem: 'Item do histórico',
    unit: 'Unidade',
    mostRecent: '1 = o mais recente',
    seconds: 'Segundos',
    milliseconds: 'Milissegundos',
    columnPlaceholder: 'coluna',
    namePlaceholder: 'nome',
    envPlaceholder: 'USERNAME',
    hints: {
      row: 'Célula desta coluna na linha de dados atual.',
      rownext: 'Cada uso pega a próxima linha (1º → linha 1, 2º → linha 2…). Reinicia a cada execução.',
      var: 'Valor guardado pelo Set Variable com este nome.',
      clip: 'O que o Copy to Slot ou a hotkey de captura guardou neste slot.',
      winclip: 'Mais recente primeiro. Requer o histórico do Win+V ativado; pode ter de tudo, até senhas.',
      timestamp: 'Unix time: segundos desde 1970-01-01 UTC, ou milissegundos.',
      env: 'O valor vem desta máquina quando a macro roda. Pode ter tudo o que o sistema ou um app guardou — até chaves.',
    },
    nameColumn: 'Digite o nome da coluna para montar este token',
    nameIt: 'Dê um nome para montar este token',
  },

  steps: {
    sequence: 'Sequência',
    trim: 'Aparar',                       // o Trim do Power Query em pt-BR
    replace: 'Substituir',
    splitAt: 'Cortar em',
    dropCount: 'Remover contagem',
    lines: 'Linhas',
    extract: 'Extrair',
    limit: 'Limitar tamanho',
    cleanUp: 'Limpar',
    countPad: 'Contar e preencher',
    textCase: 'Maiúsculas e minúsculas',
    fallback: 'Padrão',
  },

  sequence: {
    onePerUse: 'Uma linha por uso',
    onHint: 'Cada uso pega a próxima linha; uma nova cópia recomeça. A prévia sempre mostra a linha 1.',
    offHint: 'Cola o clipboard inteiro.',
  },

  trim: {
    whitespace: 'Remover espaços das pontas',
  },

  replace: {
    findPlaceholder: 'localizar',
    find: 'Localizar',
    findTip: 'Toda ocorrência, sem diferenciar maiúsculas. { } e : não são aceitos.',
    withPlaceholder: '(nada)',
    with: 'Substituir por',
    withTip: 'Vazio, exclui a ocorrência. { } e : não são aceitos.',
  },

  split: {
    label: 'Cortar em um delimitador',
    off: 'Desativado',
    before: 'Antes',
    after: 'Depois',
    delimiter: 'Delimitador',
    delimiterTip: 'Corta aqui — o delimitador é descartado. Espaços e : são aceitos; { } não.',
    delimiterTipAbsent: 'Corta aqui — o delimitador é descartado. Espaços e : são aceitos; { } não. Ausente = resultado vazio.',
    lastMatch: 'Última ocorrência',
    absentHint: 'Sem o delimitador no texto = nada, e não o texto inteiro.',
  },

  dropCount: {
    suffix: 'Sufixo da contagem',
    suffixTip: 'Remove os dígitos do começo + este texto (ex.: "1x "). { } não são aceitos.',
    hint: 'Só remove uma contagem no começo com este sufixo exato: "1x Caixa" → "Caixa".',
  },

  openEnd: 'fim',

  lines: {
    all: 'Todas',                         // sob o título Linhas; uma palavra (segmentado)
    range: 'Intervalo',
    pick: 'Números',                      // as linhas escolhidas pelos números
    firstLine: 'Primeira linha',
    lastLine: 'Última linha',
    numbers: 'Números das linhas',
    numbersTip: 'Números de linha separados por vírgula; podem se repetir',
    sort: 'Ordenar A–Z',
    dedupe: 'Sem duplicatas',             // "Remover duplicatas" mal cabe nos ~107 px do popover
    reverse: 'Inverter',
    joinWith: 'Juntar com',
    separator: 'Separador',
    joinTip: 'Junta as linhas com isto — vazio é aceito. { } e : não são aceitos.',
  },

  extract: {
    everything: 'Tudo',
    line: 'Linha nº',
    word: 'Palavra nº',
    words: 'Palavras',
    firstWord: 'Primeira palavra',
    lastWord: 'Última palavra',
    wordsTip: 'Intervalo de palavras; um lado em branco fica sem limite.',
  },

  // Segmentado de 3 na largura do inglês (quebrava a linha com "caracteres"): o título "Limitar
  // tamanho" e o campo N ao lado dizem que são caracteres.
  limit: {
    none: 'Sem limite',
    first: 'Primeiros N',
    last: 'Últimos N',
  },

  cleanUp: {
    noAccents: 'Remover acentos',
    digitsOnly: 'Só dígitos',
  },

  countPad: {
    countLines: 'Contar linhas',
    zeroPad: 'Preencher com zeros até',
  },

  textCase: {
    none: 'Original',                     // o texto como veio
    upper: 'MAIÚSCULAS',
    lower: 'minúsculas',
    sentence: 'Frase',
    title: 'Título',
  },

  fallback: {
    placeholder: 'quando vazio',
    label: 'Texto padrão',
    tip: 'Usado quando o resultado fica vazio. Espaços e : são aceitos; { } não.',
    hint: 'Com uma variável não definida, um delimitador ausente ou uma linha além do fim, cola isto em vez de nada.',
  },

  source: {
    clipboardNow: 'Clipboard agora',
    cell: 'Célula (primeira linha)',
    slotText: 'Texto do slot',
    variableValue: 'Valor da variável',
    itemText: 'Texto do item',
    value: 'Valor',
    now: 'Agora',
    lastRun: 'da última execução',
    previewTime: 'hora da prévia',
  },
  // Concordam com o que a caixa mostra: a variável (definida), o item e o valor (lido, contado, gerado).
  unknown: {
    column: 'Nenhuma coluna com esse nome na tabela de dados',
    variable: 'Não definida — as variáveis são limpas no início de cada execução',
    slot: 'Nada capturado neste slot ainda',
    history: 'Lido do Windows quando a macro roda',
    counted: 'Contado enquanto a macro roda',
    generated: 'Gerado quando a macro roda',
    machine: 'Lido da máquina quando a macro roda',
    duringRun: 'Só se sabe enquanto a macro roda',
  },
  result: 'Resultado',
  token: 'Token',
  empty: '(vazio)',
  reading: 'Lendo…',
  noPreview: {
    noSource: 'Sem prévia até haver algo para transformar.',
    readAtRun: 'Sem prévia — este valor é lido quando a macro roda.',
    refUnfinished: 'Termine o nome depois do @ — até lá, o token mantém o número fixo.',
    fromVariable: 'Resolvido quando a macro roda — o índice vem de uma variável.',
  },

  readOnly: {
    refArg: 'Somente leitura: o argumento de linha vem de uma variável, que estes controles não conseguem mostrar. O token ainda roda; uma variável inválida não gera nada.',
    unknown: 'Somente leitura: um modificador aqui não pode ser reconstruído como foi escrito (desconhecido, repetido ou fora de ordem).',
    editToChange: 'Edite o texto do token no editor para alterá-lo.',
    refArgSurface: 'Somente leitura: o argumento de linha vem de uma variável, que estes controles não conseguem mostrar. O token ainda roda; uma variável inválida não gera nada. Edite o texto do token no editor para alterá-lo.',
    unknownSurface: 'Somente leitura: um modificador aqui não pode ser reconstruído como foi escrito (desconhecido, repetido ou fora de ordem). Edite o texto do token direto no editor.',
  },

  arg: {
    refTip: 'Pegar este número de uma variável — @nome, @counter, @loop, @row ou @datarow',
    refTipShort: 'Usar uma variável — @nome, @counter, @loop, @row ou @datarow',
    numTip: 'Voltar a um número fixo',
    refPlaceholder: '@nome',
  },
} satisfies Catalogo<typeof en>;
