import type en from '../en-US/engine-run.ts';
import type { Catalogo } from '../tipos.ts';

// "A execução" (run) e "o passo" (step), como no Dock; as linhas da tabela do Data Loop são "linhas", e
// a posição de um passo na macro é "passo" (o inglês do motor diz "row" para as duas). As condições,
// o Assert e as esperas falam como o editor deles: "atendida", "na frente" (Só a janela da frente),
// "deu timeout" (Se der timeout), "Parar sem erro" (Stop quietly).
export default {
  errors: {
    noRows: 'A tabela de dados não tem linhas — adicione dados ou escolha "Uma linha por vez".',
    run: 'A execução parou com um erro: {{reason}}',
  },

  // A linha pulada é feminina; a concordância vai pelas puladas (n), e o total fica em "de {{total}} linhas".
  summary: {
    dataLoop: {
      zero: 'Data Loop concluído — nenhuma das {{total}} linhas foi pulada por erro',
      one: 'Data Loop concluído — {{n}} de {{total}} linhas foi pulada por erro (linha {{row}}: {{reason}})',
      other: 'Data Loop concluído — {{n}} de {{total}} linhas foram puladas por erro (a primeira foi a linha {{row}}: {{reason}})',
    },
    forEach: {
      zero: 'For Each Data Row: nenhuma linha pulada por erro',
      one: 'For Each Data Row: {{n}} linha pulada por erro',
      other: 'For Each Data Row: {{n}} linhas puladas por erro',
    },
    forEachFirst: {
      zero: 'For Each Data Row: nenhuma linha pulada por erro',
      one: 'For Each Data Row: {{n}} linha pulada por erro — {{reason}}',
      other: 'For Each Data Row: {{n}} linhas puladas por erro — primeiro erro: {{reason}}',
    },
    // "Macro chamada 'X'" se leria como "a macro de nome X": diz quem a chamou.
    calledMacro: {
      zero: "Macro '{{name}}', chamada pelo Run Macro: nenhuma das {{total}} linhas foi pulada",
      one: "Macro '{{name}}', chamada pelo Run Macro: {{n}} de {{total}} linhas foi pulada",
      other: "Macro '{{name}}', chamada pelo Run Macro: {{n}} de {{total}} linhas foram puladas",
    },
    calledMacroFirst: {
      zero: "Macro '{{name}}', chamada pelo Run Macro: nenhuma das {{total}} linhas foi pulada",
      one: "Macro '{{name}}', chamada pelo Run Macro: {{n}} de {{total}} linhas foi pulada — {{reason}}",
      other: "Macro '{{name}}', chamada pelo Run Macro: {{n}} de {{total}} linhas foram puladas — primeiro erro: {{reason}}",
    },
    error: 'erro',
  },

  report: {
    atCursor: 'no cursor',
    atCursorPoint: 'no cursor → {{x}}, {{y}}',
    skippedBlock: 'bloco pulado',
    noDataRows: 'nenhuma linha de dados',
    overRows: { zero: 'nenhuma linha de dados', one: '{{n}} linha de dados', other: '{{n}} linhas de dados' },
    // O While e o For Each Row: os dois no masculino (o loop).
    exited: 'saiu do {{loop}} aberto no passo {{row}}',
    jumped: 'voltou ao {{loop}} aberto no passo {{row}}',
    quietStop: '— o Assert falhou · execução parada sem erro',
    quietStopAfter: '{{detail}} — o Assert falhou · execução parada sem erro',
    endedByStop: 'execução encerrada pelo Stop',
    endedPass: 'encerrou esta volta',
    textChanged: 'mudou → "{{text}}"',
    textGone: 'sumiu',
    textFound: 'encontrado "{{text}}"',
    readNothing: '{{name}} ← nada lido',
    stepFailed: 'Não foi possível concluir o passo: {{reason}}',
  },

  // A resposta concorda com "a condição": verdadeira ou falsa.
  condition: {
    none: 'condição',
    not: 'NÃO {{name}}',
    isTrue: '{{condition}} → verdadeira',
    isFalse: '{{condition}} → falsa',
    trueRead: '{{condition}} → verdadeira · leu "{{text}}"',
    falseRead: '{{condition}} → falsa · leu "{{text}}"',
    trueReadNothing: '{{condition}} → verdadeira · não leu nada',
    falseReadNothing: '{{condition}} → falsa · não leu nada',
    probeFailed: 'Não foi possível verificar a condição: {{reason}}',
  },

  // Cada motivo é uma oração inteira, com o próprio sujeito, e se lê depois de "falhou:".
  assert: {
    failed: "O Assert '{{label}}' falhou: {{reason}}",
    element: 'elemento',
    unspecified: '(não especificada)',
    bridgeOff: 'a extensão do navegador não está conectada',
    bridgeLost: 'a extensão do navegador se desconectou',
    checkFailed: 'não foi possível verificar a condição ({{reason}})',
    windowNotOpen: 'a janela {{window}} não estava aberta',
    windowOpen: 'a janela {{window}} estava aberta',
    windowNotFront: 'a janela {{window}} não estava na frente',
    windowFront: 'a janela {{window}} estava na frente',
    processNotRunning: "o processo '{{name}}' não estava rodando",
    processRunning: "o processo '{{name}}' estava rodando",
    fileNotFound: 'arquivo não encontrado: {{path}}',
    fileExists: 'o arquivo existe: {{path}}',
    variableNotMatched: "a variável '{{name}}' não satisfez {{op}} {{value}}",
    variableMatched: "a variável '{{name}}' satisfez {{op}} {{value}}",
    variableNotContained: "a variável '{{name}}' não continha {{value}}",
    variableContained: "a variável '{{name}}' continha {{value}}",
    clipboardNotMatched: 'o clipboard não correspondeu ao padrão',
    clipboardMatched: 'o clipboard correspondeu ao padrão',
    // "Período" para o horário da condição Time: "janela", aqui, se confundiria com a do Windows.
    timeInside: 'o horário atual estava dentro do período {{when}}',
    timeInsideUnset: 'o horário atual estava dentro do período (nenhum dia ou horário definido)',
    timeWrongDay: 'hoje ({{today}}) não é um dos dias {{days}}',
    timeOutside: 'o horário atual estava fora do período {{window}}',
    timeNotMet: 'o período exigido não foi atendido ({{when}})',
    timeNotMetUnset: 'o período exigido não foi atendido (nenhum dia ou horário definido)',
    imageNotFound: 'a imagem não estava na tela',
    imageFound: 'a imagem estava na tela',
    pixelNotMatched: 'o pixel não correspondeu à cor',
    pixelMatched: 'o pixel correspondeu à cor',
    notMet: 'a condição não foi atendida',
    met: 'a condição foi atendida',
  },

  activate: {
    failed: "Activate Window: '{{label}}' — {{reason}}",
    launchFailed: 'não foi possível abrir: {{reason}}',
    notFound: 'janela não encontrada',
    noForeground: 'não foi possível trazer a janela para a frente',
    notResponding: 'a janela-alvo não está respondendo',
  },

  type: {
    focusLost: 'Send Text parou de digitar: a janela que recebia o texto não está mais em primeiro plano',
  },

  chain: {
    noMacro: 'nenhuma macro escolhida',
    cycle: 'ciclo bloqueado ({{path}})',
    tooDeep: 'encadeamento com mais de {{n}} níveis',
    noLookup: 'a consulta de macros não está disponível',
    loadFailed: 'não foi possível carregar a macro ({{reason}})',
    notFound: 'macro não encontrada',
    disabled: 'a macro está desativada',
    folderFailed: 'não foi possível ler a janela-alvo da pasta dela ({{reason}})',
  },

  target: {
    minimised: "a janela-alvo '{{name}}' está minimizada",
    notFound: "janela-alvo '{{name}}' não encontrada",
    minimisedAlert: "A janela-alvo '{{name}}' está minimizada — restaure-a e tente de novo. Uma janela minimizada não tem posição na tela onde pôr as coordenadas relativas.",
    notFoundAlert: "Janela-alvo '{{name}}' não encontrada — abra-a e tente de novo",
  },

  wait: {
    textTimedOut: 'O Wait Text deu timeout — última leitura: "{{text}}"',
    textSetup: 'Wait Text: {{reason}}',
    imageTimedOut: 'O Wait Image deu timeout',
    imageTimedOutNamed: 'O Wait Image deu timeout ({{name}})',
    pixelTimedOut: 'O Wait Pixel Color deu timeout ({{color}})',
  },
} satisfies Catalogo<typeof en>;
