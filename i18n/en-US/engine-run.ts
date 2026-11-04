// O motor: a execução das macros (Source/ActionExecution.cs). Os erros que param a execução e viram
// aviso (o status error:, que o WebViewBridge mostra), os resumos do fim da execução (OnRunSummary, que
// o WebViewBridge mostra como aviso info) e o que o Run Report mostra de cada passo (replay:report: o
// detalhe, a mensagem de erro e a dica), que o Dock e a janela compacta põem como chegam.
//
// Ficam em inglês, iguais nos dois idiomas e fora daqui: os nomes dos passos (Wait Image, Activate
// Window, For Each Row…; shell/list/stepTypes.ts) e das condições (Image found, Pixel color…; o motor
// tem a tabela delas, como details.tsx). As linhas do log (DiagnosticLog) também ficam em inglês e fora.
//
// Nas lacunas: reason = por que algo falhou: uma frase do motor (deste catálogo ou de outra área) ou o
// que o .NET ou o Windows escreveram, por S.Reason, que dá uma oração em minúscula, para vir depois de
// dois-pontos; name = o nome de uma macro, de uma janela, de um processo ou de uma variável, do
// usuário; label = a nota do passo ou o alvo dele (o seletor, a janela), do usuário; n = uma contagem
// já formatada (S.Num: 1,000 / 1.000); row = o número de um passo na macro ou de uma linha da tabela do
// Data Loop (1, 2, 3…, sem separador de milhar); count = uma contagem, que escolhe a forma; text = o
// que o OCR leu, cortado em 40 letras.
export default {
  // Os erros que param a execução e viram aviso de erro.
  errors: {
    // "Every row, in one go" com a tabela vazia: a execução nem começa. Cita a outra opção de "How
    // replay uses the rows" (dataLoop.settings.modes.next), que roda sem tabela.
    noRows: 'The data table has no rows — add data or pick "Next row each time".',
    // A exceção que derrubou a execução (um passo de navegador sob Abort, a condição de um If que dá
    // erro sob "Stop the run"…). Em inglês, a mensagem como sempre veio; o pt-BR põe a frase do app
    // antes, porque S.Reason dá uma oração em minúscula.
    run: '{{reason}}',
  },

  // Os resumos do fim da execução, quando a tabela do Data Loop pula as linhas que falham (If a row
  // fails › Skip the row). n = as linhas puladas (1 ou mais), count escolhe a forma; total = as linhas
  // da tabela; row = a primeira linha pulada; reason = por que ela falhou. O inglês diz row(s) em todas
  // as formas, como sempre disse.
  summary: {
    // "Every row, in one go": a execução inteira passou por todas as linhas.
    dataLoop: {
      one: 'Data loop finished — {{n}} of {{total}} row(s) skipped after errors (first: row {{row}}: {{reason}})',
      other: 'Data loop finished — {{n}} of {{total}} row(s) skipped after errors (first: row {{row}}: {{reason}})',
    },
    // Um bloco For Each Data Row (glossário) terminou.
    forEach: {
      one: 'For Each Data Row: {{n}} row(s) skipped after errors',
      other: 'For Each Data Row: {{n}} row(s) skipped after errors',
    },
    forEachFirst: {
      one: 'For Each Data Row: {{n}} row(s) skipped after errors — first: {{reason}}',
      other: 'For Each Data Row: {{n}} row(s) skipped after errors — first: {{reason}}',
    },
    // Um Run Macro com "Run once per data row": a macro chamada (name) passou pelas linhas da tabela dela.
    calledMacro: {
      one: "Called macro '{{name}}': {{n}} of {{total}} row(s) skipped",
      other: "Called macro '{{name}}': {{n}} of {{total}} row(s) skipped",
    },
    calledMacroFirst: {
      one: "Called macro '{{name}}': {{n}} of {{total}} row(s) skipped — first: {{reason}}",
      other: "Called macro '{{name}}': {{n}} of {{total}} row(s) skipped — first: {{reason}}",
    },
    error: 'error',   // o motivo de uma linha pulada que não deixou frase (reason acima) · nome
  },

  // O Run Report: o detalhe de cada passo, numa linha curta ao lado do nome do passo.
  report: {
    atCursor: 'at cursor',                   // um clique no cursor, ainda rodando (list.row.atCursor diz o mesmo)
    atCursorPoint: 'at cursor → {{x}}, {{y}}',  // o mesmo, depois do clique: x e y = onde ele caiu, em pixels
    // (Wait Text no modo Changes usa engine-copy.key.changes, o mesmo texto da coluna Details.)
    // For Each Row (glossário).
    skippedBlock: 'skipped block',           // o bloco está marcado como pulado (Skip)
    noDataRows: 'no data rows',              // a tabela do Data Loop está vazia: o bloco é pulado
    overRows: { one: 'over {{n}} data row(s)', other: 'over {{n}} data row(s)' },  // o bloco começou · count e n = as linhas
    // Break e Next (glossário): loop = While ou For Each Row (glossário); row = o passo que abre o loop.
    exited: 'exited the {{loop}} opened at row {{row}}',
    jumped: 'jumped to the {{loop}} opened at row {{row}}',
    // Um Assert (ou Assert Element) que falhou com "Stop quietly": a execução termina sem erro.
    // detail = o detalhe do passo (a nota ou o alvo dele).
    quietStop: '— assert failed · stopped run (quiet)',
    quietStopAfter: '{{detail}} — assert failed · stopped run (quiet)',
    endedByStop: 'run ended by Stop',        // o passo Stop (glossário) encerrou a execução, sem erro
    endedPass: 'ended this pass',            // o passo Return: encerrou só esta volta (do loop, da linha, da repetição)
    // Wait Text: o que o OCR leu quando a espera acabou.
    textChanged: 'changed → "{{text}}"',     // modo Changes: o texto mudou para este
    textGone: 'gone',                        // modo Disappears: o texto sumiu
    textFound: 'found "{{text}}"',           // o texto apareceu
    readNothing: '{{name}} ← nothing read',  // Set Variable no modo Screen: o OCR não leu nada · name = a variável
    // Um passo que falhou com uma exceção. Em inglês, a mensagem como sempre veio; o pt-BR põe a frase
    // do app antes, como em errors.run.
    stepFailed: '{{reason}}',
  },

  // O detalhe de um If, Else If ou While no Run Report: a condição e o que ela respondeu. condition = o
  // nome da condição (glossário: Image found, Pixel color…), ou not, mais " · " e a nota do passo
  // quando há uma.
  condition: {
    none: 'condition',                       // o passo sem condição escolhida · nome
    not: 'NOT {{name}}',                     // a condição negada, como o selo da lista (list.row.not) · name = a condição
    // O que a condição respondeu (já com a negação aplicada).
    isTrue: '{{condition}} → true',
    isFalse: '{{condition}} → false',
    // Text on screen: o que o OCR leu, para explicar o caminho que o If tomou.
    trueRead: '{{condition}} → true · read "{{text}}"',
    falseRead: '{{condition}} → false · read "{{text}}"',
    trueReadNothing: '{{condition}} → true · read nothing',
    falseReadNothing: '{{condition}} → false · read nothing',
    // A condição deu erro (a imagem não abre…) com "If the check itself errors › Stop the run". Em
    // inglês, a mensagem como sempre veio; o pt-BR põe a frase do app antes.
    probeFailed: '{{reason}}',
  },

  // Um Assert ou Assert Element que falhou com Abort: o aviso, o erro do passo no Run Report e o
  // motivo da linha pulada. label = a nota do passo, ou o alvo dele; reason = um dos motivos abaixo
  // (uma oração em minúscula, que se lê depois de dois-pontos).
  assert: {
    failed: "Assert failed: '{{label}}' — {{reason}}",
    element: 'element',                      // label de um Assert Element sem nota nem seletor · nome
    unspecified: '(unspecified)',            // window de uma condição Window open sem processo nem título (a janela)
    bridgeOff: 'browser bridge not connected',   // Assert Element com a extensão do Chrome desconectada
    bridgeLost: 'browser bridge disconnected',   // a extensão caiu no meio da verificação
    checkFailed: 'could not check the condition ({{reason}})',  // a condição deu erro
    // Os motivos, um por condição e por resposta: o que era exigido e não aconteceu. As formas sem
    // "not" são as da condição negada (o veredito "Not found"/"Not met"). window = o processo e o
    // título da janela ("chrome.exe · Gmail").
    windowNotOpen: 'window {{window}} was not open',
    windowOpen: 'window {{window}} was open',
    windowNotFront: 'window {{window}} was not in the foreground',   // com "Foreground window only"
    windowFront: 'window {{window}} was in the foreground',
    processNotRunning: "process '{{name}}' was not running",
    processRunning: "process '{{name}}' was running",
    fileNotFound: 'file not found: {{path}}',  // path = o caminho, como foi escrito
    fileExists: 'file exists: {{path}}',
    // Variable: op = a comparação como a lista a escreve (=, ≠, >, <); value = o valor, como foi escrito.
    variableNotMatched: "variable '{{name}}' did not match {{op}} {{value}}",
    variableMatched: "variable '{{name}}' matched {{op}} {{value}}",
    variableNotContained: "variable '{{name}}' did not contain {{value}}",  // o operador Contains (list.details.has)
    variableContained: "variable '{{name}}' contained {{value}}",
    clipboardNotMatched: 'clipboard did not match the pattern',
    clipboardMatched: 'clipboard matched the pattern',
    // Time: when = os dias e o horário, como a coluna Details os escreve ("Mon–Fri 09:00–18:00");
    // window = só o horário ("09:00–18:00"); days = só os dias; today = o nome do dia de hoje, no idioma.
    timeInside: 'the current time was inside {{when}}',
    timeInsideUnset: 'the current time was inside (no day or time window set)',
    timeWrongDay: 'today ({{today}}) is not one of {{days}}',
    timeOutside: 'the current time was outside {{window}}',
    timeNotMet: 'the required window was not met ({{when}})',
    timeNotMetUnset: 'the required window was not met (no day or time window set)',
    imageNotFound: 'the image was not on screen',
    imageFound: 'the image was on screen',
    pixelNotMatched: 'the pixel did not match the colour',
    pixelMatched: 'the pixel matched the colour',
    notMet: 'the condition was not met',     // uma condição sem motivo próprio
    met: 'the condition was met',
  },

  // Activate Window (glossário) que falhou com o timeout em Abort: o aviso, o erro do passo e o motivo
  // da linha pulada. label = o processo e o título da janela, ou o programa a abrir; reason = um dos
  // motivos abaixo.
  activate: {
    failed: "Activate Window: '{{label}}' — {{reason}}",
    launchFailed: 'launch failed: {{reason}}',  // o programa (a seção Launch, "Abrir" em pt-BR) não abriu
    notFound: 'window not found',            // nenhuma janela casou dentro do timeout
    noForeground: 'could not bring window to foreground',
    notResponding: 'target window not responding',  // a janela não responde (travada) até o timeout
  },

  // Send Text (glossário) no modo Type (Digitar): a janela que recebia o texto saiu do primeiro plano no
  // meio dele (fechou, ou outra veio para a frente), e o motor parou de digitar para o resto não cair
  // na outra. O aviso, o erro do passo e o motivo da linha pulada.
  type: {
    focusLost: 'Send Text stopped typing: the window receiving the text is no longer in the foreground',
  },

  // Run Macro (glossário) que não rodou a macro chamada: o detalhe do passo, pulado, depois do nome
  // da macro e de " — ".
  chain: {
    noMacro: 'no macro selected',
    cycle: 'cycle blocked ({{path}})',       // path = as macros da cadeia, "A → B → A"
    tooDeep: 'chain deeper than {{n}} levels',  // n = o limite de macros encadeadas
    noLookup: 'macro lookup unavailable',
    loadFailed: 'could not load macro ({{reason}})',
    notFound: 'macro not found',
    disabled: 'macro is disabled',
    folderFailed: "could not read its folder's window target ({{reason}})",
  },

  // As coordenadas relativas sem a janela-alvo: o aviso (que para a execução), o erro do passo e o
  // motivo da linha pulada. name = o processo da janela-alvo, ou o título dela.
  target: {
    minimised: "target window '{{name}}' is minimised",
    notFound: "target window '{{name}}' not found",
    minimisedAlert: "Target window '{{name}}' is minimised — restore it and retry. A minimised window has no on-screen position to place relative coordinates against.",
    notFoundAlert: "Target window '{{name}}' not found — open it and retry",
  },

  // As esperas que deram timeout com Abort: o erro do passo e o motivo da linha pulada.
  wait: {
    textTimedOut: 'Wait Text timed out — last read: "{{text}}"',
    textSetup: 'Wait Text: {{reason}}',      // a espera nem pôde ler (sem idioma de OCR, padrão inválido…)
    imageTimedOut: 'Wait Image timed out',
    imageTimedOutNamed: 'Wait Image timed out ({{name}})',  // name = a coluna Key do passo (engine-copy)
    pixelTimedOut: 'Wait Pixel Color timed out ({{color}})',  // color = a cor esperada, em HEX
  },
} as const;
