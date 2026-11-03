// As condições do If, do Else If, do While, do Assert e do Wait until… (shell/inspector/): o editor da
// condição (ConditionEditor.tsx), o botão Check e o menu dele, a lista das condições de um passo sendo
// feito (CheckDraft.tsx), os campos das condições de estado (stateChecks.tsx: janela, processo,
// arquivo, Clipboard, Variable, Random, Time) e os da condição Browser element (screenChecks.tsx).
// Os nomes das 11 condições (Image found, Pixel color, Text on screen…) são glossário e moram em
// checks.ts, como dado. A imagem, o pixel e o texto da tela, que as esperas também usam, estão na área
// probe.
//
// Nas lacunas: name = o nome de uma condição (glossário); n = um número já formatado (fmtNum: 1,000 /
// 1.000); window = o processo e o título de uma janela, como o motor os deu.
export default {
  // O que cada condição olha, em uma linha: a dica do item no menu Check e a linha sob o nome na lista
  // das condições de um passo sendo feito. A chave é o tipo da condição no motor (checks.ts).
  desc: {
    ImageFound: 'An image on the screen — you capture it first',
    PixelColorMatch: 'The color of one point — you pick it first',
    ScreenText: 'Text read in a region — you draw it first',
    WindowOpen: 'A window, by its process or its title',
    ProcessRunning: 'A program running, with a window or not',
    FileExists: 'A file or a folder on the disk',
    ClipboardMatch: 'The text that was copied',
    Variable: 'A variable, compared with a value',
    BrowserElementState: 'An element of the page, through the extension',
    Random: 'A chance, in percent',
    TimeWindow: 'A time of day and days of the week',
  },

  // O veredito, um grupo por sujeito, para cada idioma concordar numa frase inteira: passesWhen é o
  // rótulo sobre as duas respostas e se lê junto com cada uma ("Passes when the image is" + "Found" /
  // "Not found"); treatAsNo é a resposta de "If the check itself errors" (If, Else If e While). As
  // condições sem sujeito próprio (Text on screen, Clipboard, Variable, Random e Time) usam check.
  // yes, no e treatAsNo são opções de segmentado de 2 · orçamento: 143 px cada.
  verdict: {
    check: { passesWhen: 'Passes when the check is', yes: 'Met', no: 'Not met', treatAsNo: 'Treat as not met' },
    image: { passesWhen: 'Passes when the image is', yes: 'Found', no: 'Not found', treatAsNo: 'Treat as not found' },
    color: { passesWhen: 'Passes when the color is', yes: 'Found', no: 'Not found', treatAsNo: 'Treat as not found' },
    window: { passesWhen: 'Passes when the window is', yes: 'Found', no: 'Not found', treatAsNo: 'Treat as not found' },
    process: { passesWhen: 'Passes when the process is', yes: 'Found', no: 'Not found', treatAsNo: 'Treat as not found' },
    file: { passesWhen: 'Passes when the file is', yes: 'Found', no: 'Not found', treatAsNo: 'Treat as not found' },
    element: { passesWhen: 'Passes when the element is', yes: 'Found', no: 'Not found', treatAsNo: 'Treat as not found' },
  },
  passesWhen: 'Passes when',          // nome do segmentado do veredito, para o leitor de tela

  // O editor da condição, depois do veredito.
  waitFor: 'Wait for it',             // rótulo: quanto tempo esperar a condição passar · it = a condição
  waitForHint: '0 = check once.',
  waitForField: 'Wait for it, in milliseconds',  // nome do campo, para o leitor de tela
  maxIterations: 'Max iterations',    // While: o teto de voltas · rótulo
  maxIterationsHint: '0 = the default, {{n}}.',  // n = o padrão do motor, 1000, formatado
  maxIterationsField: 'Maximum loop iterations', // nome do campo, para o leitor de tela
  // Assert (e Wait until…): o que uma falha faz. Opções de segmentado de 3 · orçamento: 95 px cada.
  onFailure: 'On failure',            // rótulo
  onFailureGroup: 'On assert failure',  // nome do segmentado, para o leitor de tela · Assert é o passo (glossário)
  onFailureHint: '{{>common.actions.continue}} does not fail a data-loop row.',  // cita a opção Continue
  abort: 'Abort',                     // opção: a execução para com erro · verbo
  abortTip: 'The run stops with an error',
  continueTip: 'The run goes on to the next step',  // dica da opção Continue (common.actions.continue)
  stopQuietly: 'Stop quietly',        // opção: a execução termina sem erro
  stopQuietlyTip: 'The run ends here, with no error',
  // If, Else If e While: o que faz uma condição que não consegue nem rodar (a imagem não abre…).
  onError: 'If the check itself errors',  // rótulo e nome do segmentado
  loopEnds: 'The loop ends',          // dica de treatAsNo num While
  ifOtherWay: 'The If goes the other way',  // dica de treatAsNo num If ou Else If
  stopRun: 'Stop the run',            // a outra opção · segmentado de 2, 143 px

  // O botão da condição escolhida, no topo do editor, e o menu dele.
  check: 'Check',                     // rótulo da seção · nome
  was: 'Was {{name}} · Ctrl+Z brings it back',  // depois de trocar a condição: name = a de antes (glossário)
  checkNamed: 'Check: {{name}}',      // nome do botão, para o leitor de tela · name = a condição
  checkNone: 'Check: none',           // o mesmo, sem condição
  choose: 'Choose a check',           // o botão, sem condição · verbo
  list: 'Checks',                     // nome do menu e da lista das condições, para o leitor de tela
  adding: 'Adding…',                  // no lugar da descrição da condição escolhida, enquanto o passo chega

  // As palavras de comparação de texto (janela, Clipboard e o texto da tela) · opção de segmentado de 3
  // ou de 4 · orçamento: 71 px no de 4.
  match: {
    contains: 'Contains',
    equals: 'Equals',
    regexTip: '.NET regular expression',  // dica da opção Regex (glossário)
  },
  value: 'Value',                     // o valor com que se compara: rótulo e nome do campo

  // Window open, e a janela de Activate Window e a das automações: o processo e o título.
  window: {
    process: 'Process',               // rótulo e nome do campo
    processHint: 'Empty = match by the title only.',
    processPlaceholder: 'notepad.exe',  // exemplo: o nome do processo, igual no Windows em português
    clearProcess: 'Clear the process',  // dica e nome do × do campo · verbo
    title: 'Title',                   // rótulo e nome do campo
    titleHint: 'Case-insensitive.',
    titleHintFill: 'Case-insensitive. Fill at least one.',  // nem processo nem título: um dos dois
    badRegex: 'This does not look like a valid regular expression.',
    titleMode: 'Title match mode',    // nome do segmentado Contains / Regex, para o leitor de tela
    titlePlaceholder: 'Part of the window title',
    regexPlaceholder: 'e.g. (Chrome|Firefox)',
    clearTitle: 'Clear the title',
    // Activate Window: qual das janelas que casam, contando da frente.
    matchIndex: 'Match #',            // rótulo e nome do campo
    matchIndexHint: '1 = frontmost.',
    // Launch é a seção de Activate Window que abre um programa quando nenhuma janela casa.
    matchIndexHintMore: 'Counted front→back. Above 1, Launch fires when FEWER than this many match.',
    foreground: 'Foreground window only',  // rótulo da linha e nome da chave
    foregroundTip: 'It must be in front, not just open',
    // Detect window: a próxima janela clicada preenche o processo e o título · botão em par, 144 px.
    detect: 'Detect window',
    detecting: 'Click the target window…',  // o mesmo botão, esperando o clique
    detectTip: 'The next window you click fills the process and the title',
    detectingTip: 'Click the window to check for. Click here or press Esc to cancel.',
    detectingActTip: 'Click the window to act on. Click here or press Esc to cancel.',  // em Activate Window
    found: 'Found — {{window}}',      // resultado do Test: a janela encontrada
    notFound: 'Not found',
  },

  // Process running.
  process: {
    name: 'Process name',             // rótulo e nome do campo
    hint: 'Matches even without a window.',
    placeholder: 'chrome.exe',        // exemplo: o nome do processo
  },

  // File exists: o caminho de um arquivo ou de uma pasta.
  file: {
    path: 'Path',                     // rótulo e nome do campo
    hint: 'A file or a folder.',      // numa automação, que não resolve tokens
    hintTokens: 'A file or a folder. Tokens resolve at run time.',
    placeholder: 'C:\\flags\\go.txt', // exemplo de caminho
  },

  // Clipboard: o texto copiado contra um padrão; numa automação, quando o texto copiado muda.
  clipboard: {
    matchType: 'Match type',          // rótulo
    matchTypeGroup: 'Clipboard match type',  // nome do segmentado, para o leitor de tela
    pattern: 'Pattern',               // rótulo e nome do campo
    patternHint: 'Text only, ignoring case.',
    contains: 'Contains',             // automação: rótulo e nome do campo do que o texto copiado tem
    changesHint: 'Empty = any change. The app’s own copies never count.',
    changesPlaceholder: 'text the clipboard must contain',
  },

  // Variable: uma variável da execução comparada com um valor.
  variable: {
    name: 'Variable name',            // rótulo e nome do campo
    namePlaceholder: 'name',
    operator: 'Operator',             // rótulo
    operatorGroup: 'Comparison operator',  // nome do segmentado, para o leitor de tela
    has: 'has',                       // a opção Contains, entre =, ≠, > e < · verbo, minúscula, curto
    eqTip: 'The same text, ignoring case',
    neqTip: 'Not the same text',
    hasTip: 'Contains it',
    numbersTip: 'As numbers when both are numbers',  // dica de > e de <
    valueHint: 'Tokens resolve at run time.',
  },

  // Random: passa tantas vezes em cem.
  random: {
    chance: 'Chance',                 // rótulo
    field: 'Random chance percent',   // nome do campo, para o leitor de tela
    never: 'At 0 % it never passes.',
    always: 'At 100 % it always passes.',
    passes: 'Passes {{pct}} % of the time.',  // pct = a chance, de 1 a 99
  },

  // Time: um horário (que pode virar a meia-noite) em alguns dias da semana. Os nomes dos dias vêm do
  // Intl, no idioma do build (stateChecks.tsx).
  time: {
    from: 'From',                     // rótulo e nome do campo do início
    to: 'To',                         // o fim
    overnight: 'Overnight works, like 22:00 to 02:00.',
    days: 'Days',                     // rótulo e nome do grupo dos dias
    daysHint: 'None = every day.',
  },

  // Browser element: um elemento da aba ativa, pelo seletor, em um estado.
  browser: {
    offlineHint: 'With the extension offline, it reads as not found.',  // sob o campo do seletor
    state: 'State',                   // rótulo e nome do segmentado
    // Opções de segmentado de 4 em duas por linha · orçamento: 143 px cada.
    visible: 'Visible',
    gone: 'Not present / hidden',
    enabled: 'Enabled',               // o elemento pode ser usado (não está desabilitado)
    textMatches: 'Text matches',
    textPattern: 'Text pattern',      // rótulo e nome do campo
    textPatternHint: 'Plain text is exact. Or text*=  text~=  text/regex/',  // as formas ficam como se digitam
    checkNow: 'Check now',            // botão: pergunta à página agora · verbo
    checking: 'Checking…',
    // O resultado de Check now: o título, e a linha sob ele.
    lost: 'No answer from the browser extension',
    offline: 'Extension not connected',
    isTrue: 'Condition is TRUE now',
    isFalse: 'Condition is FALSE now',
    lostHint: 'Is Chrome running, with the extension?',
    offlineMore: 'The page could not be reached — that reads as not found.',
    // A condição negada: o estado do elemento, que a resposta Not found do veredito inverte.
    negatedMatched: 'Element state: matched · turned around by "{{>conditions.verdict.element.no}}"',
    negatedNotMatched: 'Element state: not matched · turned around by "{{>conditions.verdict.element.no}}"',
    branch: 'The run would take this branch right now.',
  },
} as const;
