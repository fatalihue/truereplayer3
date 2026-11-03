// A página do Clicker (shell/pages/clicker/): a lista dos presets à esquerda, a execução no meio e as
// configurações à direita, que aplicam ao digitar (o Ctrl+Z da página desfaz). "Clicker" é recurso e
// "preset" é coringa (glossário): ficam em inglês. Em pt-BR: "o preset" no masculino, "a hotkey" no
// feminino (como em macroSettings) e "a execução" (a run) no feminino.
//
// Nas lacunas:
// - name = o nome de um preset (do usuário);
// - n = um número já escrito no idioma (fmtNum: "1,000" / "1.000"); quando escolhe o plural, count vai ao lado;
// - time = uma hora do dia (fmtHora: "02:10 PM" / "14:10");
// - clock = uma duração de relógio ("0:51", "2:00:00");
// - rate = cliques por segundo já escrito ("9.8" / "9,8"); period = um período com a unidade ("100 ms", "1.5 s");
// - x, y = coordenadas e w, h = largura e altura, em px e sem milhar.
// Os botões que dizem só o verbo (New, Stop, Pause, Resume, Rename…, Delete, Undo) vêm de common.actions.
export default {
  // A lista dos presets: a coluna da esquerda e, abaixo de 80 rem, por cima da página.
  presets: {
    title: 'Presets',              // título da lista, o nome dela e o botão do cabeçalho que a mostra · coringa
    newTip: 'Keeps the settings on this page under a name',  // dica do botão New
    full: '{{n}} is the limit',    // dica do New com a lista cheia · n = 24, o máximo de presets
    none: 'No presets yet. {{>common.actions.new}} keeps the settings on this page under a name.',  // a lista vazia
    foot: 'A preset keeps every setting on this page. Edits save into the one that is selected.',   // rodapé da lista
    footRunning: 'Switching presets waits until this run stops.',  // o mesmo rodapé, enquanto clica
    name: 'Preset name',           // nome do campo do nome, no New e no Rename… (leitor de tela)
    namePlaceholder: 'Name, then Enter',  // o campo do New, vazio · Enter é tecla (glossário)
    taken: 'A preset has that name already.',  // erro sob o campo do nome
    deleted: 'Deleted preset "{{name}}"',      // aviso do Delete, com Undo
    actions: 'Preset actions',     // nome do botão ⋯ do cabeçalho e do menu dele (Rename…, Delete)
    noneSelected: 'No preset selected',  // dica do ⋯ desativado
  },

  // O cabeçalho da execução: o título (o preset escolhido, ou Clicker), a linha sob ele e os botões.
  head: {
    start: 'Start',                // botão: começa a clicar · verbo
    paused: 'Paused',              // a linha sob o título, pausado · o Clicker (masculino em pt-BR)
    // A contagem antes do primeiro clique, com o botão: n = os segundos que faltam.
    starting: 'Starting in {{n}} s — move the mouse to the target',
    clickingSince: 'Clicking since {{time}}',  // clicando, desde a hora em que começou
    // Parado: se há preset escolhido, e quanto a execução leva (duration = clicker.about) ou até quando.
    presetTakes: 'Clicker preset · takes {{duration}}',
    presetUntil: 'Clicker preset · runs until you stop it',
    noPresetTakes: 'No preset · takes {{duration}}',
    noPresetUntil: 'No preset · runs until you stop it',
  },
  // Quanto a execução leva, no "takes …" do cabeçalho · n em segundos ou minutos (inteiros), ou em
  // horas (com uma casa decimal); as unidades são iguais nos dois idiomas.
  about: {
    seconds: 'about {{n}} s',
    minutes: 'about {{n}} min',
    hours: 'about {{n}} h',
  },
  // O progresso no cabeçalho, enquanto clica com um limite: "412 of 1,000" e "~0:29 left", numa linha
  // só sobre uma barra de 10,5 rem · orçamento: o tamanho do inglês.
  progress: {
    label: 'Run progress',         // nome da barra (leitor de tela)
    of: '{{done}} of {{total}}',   // done e total = cliques (com milhar) ou relógios ("0:21 of 1:00")
    left: '~{{clock}} left',       // o tempo que falta para o limite
  },

  // O meio, parado: o que uma execução vai fazer.
  readyTitle: 'Ready to click',
  // Os rótulos sob os números das quatro células (cerca de 7 rem cada) · nome.
  cells: {
    rate: 'Rate',                  // cliques por segundo
    clicks: 'Clicks',              // o limite de cliques
    timeLimit: 'Time limit',
    takes: 'Takes',                // quanto a execução leva ("~0:50")
    elapsed: 'Elapsed',            // clicando: o tempo desde o começo
    limit: 'Limit',                // clicando: o limite de cliques ou de tempo
    left: 'Left',                  // clicando: o tempo que falta (não o botão esquerdo)
  },
  // O meio, clicando: o número grande e a palavra sob ele, e o aviso da janela de administrador.
  run: {
    startingIn: 'starting in',     // sob os segundos da contagem · minúscula
    clicks: 'clicks',              // sob o número de cliques
    clicksPaused: 'clicks · paused',
    elevated: 'The window under the cursor runs as administrator, so Windows drops these clicks.',
    restartAdmin: 'Restart as administrator',  // botão do aviso · verbo
  },
  // A linha das teclas sob o meio (paineis-149): "PgDn starts and stops · PgUp pauses · both only while
  // this page is open". key = a tecla, que a página desenha numa caixa onde a lacuna estiver. Sem a
  // tecla, o botão de cima faz o mesmo: a frase cita o nome do botão.
  keys: {
    none: 'No Clicker hotkeys: {{>clicker.head.start}} and {{>common.actions.pause}} above do it.',
    startsStops: '{{key}} starts and stops',
    stops: '{{key}} stops',
    pauses: '{{key}} pauses',
    resumes: '{{key}} resumes',
    startAbove: '{{>clicker.head.start}} above starts',
    stopAbove: '{{>common.actions.stop}} above stops',
    pauseAbove: '{{>common.actions.pause}} above pauses',
    resumeAbove: '{{>common.actions.resume}} above resumes',
    bothWhileOpen: 'both only while this page is open',  // as duas hotkeys (feminino em pt-BR)
    whileOpen: 'only while this page is open',           // a única hotkey
  },
  // A última execução, sob o meio parado (paineis-142): "Last run 14:10 · 1,000 clicks in 0:51 · limit
  // reached". end = clicker.end. Sem a hora (a página aberta depois de um recarregamento), a forma noTime.
  lastRun: {
    at: { one: 'Last run {{time}} · {{n}} click in {{clock}} · {{end}}', other: 'Last run {{time}} · {{n}} clicks in {{clock}} · {{end}}' },
    noTime: { one: 'Last run · {{n}} click in {{clock}} · {{end}}', other: 'Last run · {{n}} clicks in {{clock}} · {{end}}' },
    // Em aviso, depois de " · ": os cliques que o Windows recusou porque outro app bloqueou a entrada.
    blocked: {
      one: '{{n}} click was rejected by Windows — input was blocked',
      other: '{{n}} clicks were rejected by Windows — input was blocked',
    },
  },
  // Como a última execução acabou, no fim da linha acima · a execução (feminino em pt-BR).
  end: {
    stopped: 'stopped',            // parada pelo usuário
    time: "time's up",             // o limite de tempo
    clicks: 'limit reached',       // o limite de cliques
    error: 'failed',
    finished: 'finished',
  },
  // O monitor em que a área ou o ponto está, desenhado em escala: n = o número do monitor (o principal
  // é o 1); w × h = o tamanho dele; x, y = onde a área (o canto de cima à esquerda) ou o ponto está.
  display: {
    areaLabel: 'Display {{n}} with the click area drawn on it',    // nome da figura (leitor de tela)
    pointLabel: 'Display {{n}} with the click point marked on it',
    area: 'Display {{n}} · {{w}} × {{h}} · area at {{x}}, {{y}}',  // a legenda sob a figura
    point: 'Display {{n}} · {{w}} × {{h}} · point at {{x}}, {{y}}',
  },
  // A frase do que a execução vai fazer, sob "Ready to click": "Left click, 20 times a second, at a
  // random point inside the 400 × 300 area. Stops after 1,000 clicks." Cada lacuna de full é uma parte
  // inteira: click = sentence.click, rate = as três formas do ritmo, where = as cinco de onde, stop = a
  // segunda frase.
  sentence: {
    full: '{{click}}, {{rate}}, {{where}}. {{stop}}',
    click: { Left: 'Left click', Right: 'Right click', Middle: 'Middle click' },  // pelo botão escolhido
    timesPerSecond: '{{rate}} times a second',  // rate a partir de 1, nunca 1 (que é oncePerSecond)
    oncePerSecond: 'once a second',
    onceEvery: 'once every {{period}}',          // mais devagar que um por segundo: period = "30 s"
    inArea: 'at a random point inside the {{w}} × {{h}} area',
    atPoint: 'at {{x}}, {{y}}',
    atStart: 'where the cursor is when it starts',  // o ponto fixo ainda não escolhido
    around: 'around the cursor (±{{px}} px)',     // a dispersão ao redor do cursor
    atCursor: 'at the cursor',
    stopsBoth: {
      one: 'Stops after {{n}} click or {{clock}}, whichever comes first.',
      other: 'Stops after {{n}} clicks or {{clock}}, whichever comes first.',
    },
    stopsClicks: { one: 'Stops after {{n}} click.', other: 'Stops after {{n}} clicks.' },
    stopsTime: 'Stops after {{clock}}.',
    untilStopped: 'Runs until you stop it.',
  },
  // A linha de cada preset na lista: "Left · 20/s · area · 1,000" (o botão vem de clicker.buttons) ·
  // uma linha só, que corta com reticências em 13,6 rem de texto mono (cerca de 33 letras): o pt-BR
  // não passa do tamanho do inglês.
  line: {
    where: { cursor: 'cursor', area: 'area', fixed: 'fixed' },  // onde clica · minúscula, curto
    both: '{{n}} or {{clock}}',    // os dois limites: cliques ou tempo
    noLimit: 'no limit',           // sem limite de cliques nem de tempo
  },
  // O ritmo mais devagar que um por segundo, na lista, na linha de baixo e na célula Rate (7 rem de
  // texto mono): "every 30 s" · orçamento: o tamanho do inglês.
  every: 'every {{period}}',
  // As configurações numa linha, enquanto clica (paineis-145): "Left · 20/s · 1,000 clicks · area
  // 400×300 · ±10% rate · +200 ms gap" · centrada, quebra linha.
  bits: {
    noLimit: 'no limit',           // sem limite de cliques nem de tempo
    clicks: { one: '{{n}} click', other: '{{n}} clicks' },
    clicksOr: { one: '{{n}} click or {{clock}}', other: '{{n}} clicks or {{clock}}' },
    area: 'area {{w}}×{{h}}',
    point: 'point {{x}}, {{y}}',
    pointAtStart: 'point at start',  // o ponto fixo ainda não escolhido
    jitter: '±{{n}}% rate',          // a variação do ritmo · n = a porcentagem
    gap: '+{{ms}} ms gap',           // o intervalo a mais entre cliques
  },

  // A coluna da direita: as configurações, que aplicam ao digitar.
  settings: {
    title: 'Clicker settings',     // título da coluna e o nome dela (leitor de tela)
    savedIn: 'Saved in {{name}}',  // sob o título: o preset em que as mudanças ficam · as configurações (feminino plural)
    notInPreset: 'Not in a preset · {{>common.actions.new}} keeps them',  // sob o título, sem preset escolhido
    readOnly: 'Read-only while it clicks. Stop to change.',  // a faixa sobre as configurações, enquanto clica
    foot: 'Applies as you type · Ctrl+Z undoes',  // rodapé da coluna · Ctrl+Z é tecla (glossário)
  },
  // A seção Click: o botão e o ritmo.
  click: {
    title: 'Click',                // seção · nome: o clique (não o passo Click)
    button: 'Button',              // rótulo do segmentado e o nome dele
    rate: 'Rate',                  // rótulo e nome do campo: cliques por segundo, ou ms entre cliques
    chooseRate: 'Choose a rate',   // nome do ▾ ao lado do campo, que abre os ritmos prontos
    rates: 'Rates',                // nome do menu dos ritmos prontos
    unit: 'Rate unit',             // nome do segmentado /s | ms (as opções são unidades)
    // Sob o campo: o período em que o tempo segurado (Hold) e o intervalo (Gap) cabem.
    period: 'One click every {{period}}. Hold and gap fit inside it.',
    // O que o campo não diz: o tempo segurado ditando o ritmo, ou o último valor preso no período
    // mais curto ou no mais longo. ms e s = o tempo; rate = o máximo de cliques por segundo.
    holdCaps: 'The {{ms}} ms hold sets the pace: {{rate}}/s at most.',
    longest: '{{s}} s is the longest period: one click a minute is the slowest.',
    shortest: '{{ms}} ms is the shortest period: {{rate}}/s at most.',
  },
  // Os botões do mouse: as opções do segmentado de 3 (95 px cada) e a lista dos presets.
  buttons: { Left: 'Left', Right: 'Right', Middle: 'Middle' },
  // A seção Where: o cursor, uma área ou um ponto fixo.
  where: {
    title: 'Where',
    // As opções do segmentado de 3 (95 px cada) · uma palavra quando der.
    options: { cursor: 'Cursor', area: 'Area', fixed: 'Fixed point' },
    spread: 'Spread',              // rótulo e nome do campo ±px · nome
    spreadSwitch: 'Spread around the cursor',  // nome da chave dele (leitor de tela)
    spreadHint: 'A random point up to {{px}} px from the cursor on every click.',
    atCursor: 'Every click lands where the cursor is.',  // a mesma linha, sem a dispersão
    at: 'at {{x}}, {{y}}',         // no cartão da área, sob o tamanho dela: o canto de cima à esquerda
    redraw: '{{>inspector.region.redraw}}',  // botão do cartão da área · verbo
    clearArea: 'Clear area',       // nome do × do cartão
    areaHint: 'A new random point inside the box on every click.',
    atStart: 'At start',           // o cartão do ponto fixo ainda não escolhido, no lugar das coordenadas
    onPoint: 'Every click on this point',            // sob as coordenadas
    whereStarts: 'Where the cursor is when it starts',  // sob o "At start"
    pickAgain: 'Pick again',       // botão do cartão: escolhe outro ponto na tela
    pickPoint: 'Pick a point',     // o mesmo, sem ponto
    clearPoint: 'Clear fixed point',  // nome do × do cartão
    pointHint: 'One point every click. Without one, it locks where the cursor is at start.',
    // A linha "para quê" da barra da captura na tela, depois de "Draw the click area · " (o motor a
    // desenha): name = o preset escolhido.
    captureFor: 'for Clicker',
    captureForPreset: 'for Clicker, {{name}}',
  },
  // A seção Stop after: os limites, cada um com a chave, o rótulo e o campo.
  stop: {
    title: 'Stop after',
    clicks: 'Clicks',              // rótulo da linha
    clicksSwitch: 'Limit clicks',  // nome da chave (leitor de tela)
    clicksField: 'Click limit',    // nome do campo
    time: 'Time',                  // rótulo da linha · o tempo (não a condição Time)
    timeSwitch: 'Limit time',
    timeField: 'Time limit',
    hint: 'Whichever comes first. Paused time does not count.',
  },
  // A seção Tuning: a variação do ritmo, o tempo segurado, o intervalo e o movimento de jogo.
  tuning: {
    title: 'Tuning',
    jitter: 'Jitter',              // rótulo e nome do campo ±% · variação (terminologia)
    jitterSwitch: 'Rate jitter',   // nome da chave
    hold: 'Hold',                  // rótulo e nome do campo: quanto o botão fica apertado (ms)
    gap: 'Gap',                    // rótulo, chave e campo: a espera a mais entre cliques (ms)
    gameMove: 'Game move',         // rótulo e nome da chave (não o Game Mode)
    gameMoveHint: 'Game move walks the cursor instead of jumping, for games like Roblox. Costs a few ms per click.',
    noWalk: 'No effect at the cursor: there is nowhere to walk.',  // aviso: Game move com o clique no cursor
  },
  // A seção Hotkeys: as do Clicker, que valem só com a página aberta (o Pause é common.actions.pause).
  hotkeys: {
    title: 'Hotkeys',              // seção · coringa
    startStop: 'Start and stop',   // rótulo da linha e nome do campo · orçamento: 77 px (quebra com +15%)
  },
} as const;
