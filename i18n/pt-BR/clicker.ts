import type en from '../en-US/clicker.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  presets: {
    title: 'Presets',
    newTip: 'Guarda as configurações desta página com um nome',
    full: '{{n}} é o limite',
    none: 'Nenhum preset ainda. {{>common.actions.new}} guarda as configurações desta página com um nome.',
    foot: 'Um preset guarda todas as configurações desta página. As alterações são salvas no preset selecionado.',
    footRunning: 'A troca de preset espera esta execução parar.',
    name: 'Nome do preset',
    namePlaceholder: 'Nome, depois Enter',
    taken: 'Já existe um preset com esse nome.',
    deleted: 'Preset "{{name}}" excluído',
    actions: 'Ações do preset',
    noneSelected: 'Nenhum preset selecionado',
  },

  head: {
    start: 'Iniciar',
    paused: 'Pausado',
    starting: 'Começa em {{n}} s — leve o mouse até o alvo',
    clickingSince: 'Clicando desde as {{time}}',
    presetTakes: 'Preset do Clicker · leva {{duration}}',
    presetUntil: 'Preset do Clicker · roda até você parar',
    noPresetTakes: 'Sem preset · leva {{duration}}',
    noPresetUntil: 'Sem preset · roda até você parar',
  },
  about: {
    seconds: 'cerca de {{n}} s',
    minutes: 'cerca de {{n}} min',
    hours: 'cerca de {{n}} h',
  },
  // "left" vira "falta", antes do relógio: a linha tem o tamanho do inglês.
  progress: {
    label: 'Progresso da execução',
    of: '{{done}} de {{total}}',
    left: 'falta ~{{clock}}',
  },

  readyTitle: 'Pronto para clicar',
  // "Takes" vira o substantivo, como os outros rótulos.
  cells: {
    rate: 'Ritmo',
    clicks: 'Cliques',
    timeLimit: 'Limite de tempo',
    takes: 'Duração',
    elapsed: 'Decorrido',
    limit: 'Limite',
    left: 'Restante',
  },
  // A janela de administrador é assunto do Windows: "executada", como o "Executar como administrador" dele.
  run: {
    startingIn: 'começa em',
    clicks: 'cliques',
    clicksPaused: 'cliques · pausado',
    elevated: 'A janela sob o cursor é executada como administrador, então o Windows descarta estes cliques.',
    restartAdmin: 'Reiniciar como administrador',
  },
  // Sem a tecla, o nome do botão vai entre vírgulas: "Iniciar, acima, inicia".
  keys: {
    none: 'Sem hotkeys do Clicker: {{>clicker.head.start}} e {{>common.actions.pause}}, acima, fazem isso.',
    startsStops: '{{key}} inicia e para',
    stops: '{{key}} para',
    pauses: '{{key}} pausa',
    resumes: '{{key}} retoma',
    startAbove: '{{>clicker.head.start}}, acima, inicia',
    stopAbove: '{{>common.actions.stop}}, acima, para',
    pauseAbove: '{{>common.actions.pause}}, acima, pausa',
    resumeAbove: '{{>common.actions.resume}}, acima, retoma',
    bothWhileOpen: 'as duas só com esta página aberta',
    whileOpen: 'só com esta página aberta',
  },
  lastRun: {
    at: {
      zero: 'Última execução às {{time}} · {{n}} cliques em {{clock}} · {{end}}',
      one: 'Última execução às {{time}} · {{n}} clique em {{clock}} · {{end}}',
      other: 'Última execução às {{time}} · {{n}} cliques em {{clock}} · {{end}}',
    },
    noTime: {
      zero: 'Última execução · {{n}} cliques em {{clock}} · {{end}}',
      one: 'Última execução · {{n}} clique em {{clock}} · {{end}}',
      other: 'Última execução · {{n}} cliques em {{clock}} · {{end}}',
    },
    blocked: {
      zero: '{{n}} cliques foram recusados pelo Windows — a entrada estava bloqueada',
      one: '{{n}} clique foi recusado pelo Windows — a entrada estava bloqueada',
      other: '{{n}} cliques foram recusados pelo Windows — a entrada estava bloqueada',
    },
  },
  // Concordam com "a execução" da frase de lastRun.
  end: {
    stopped: 'parada',
    time: 'tempo esgotado',
    clicks: 'limite atingido',
    error: 'falhou',
    finished: 'concluída',
  },
  display: {
    areaLabel: 'Monitor {{n}} com a área de clique desenhada',
    pointLabel: 'Monitor {{n}} com o ponto de clique marcado',
    area: 'Monitor {{n}} · {{w}} × {{h}} · área em {{x}}, {{y}}',
    point: 'Monitor {{n}} · {{w}} × {{h}} · ponto em {{x}}, {{y}}',
  },
  // "Stops after" vira "Termina depois de": "Para depois de" se lê como a preposição.
  sentence: {
    full: '{{click}}, {{rate}}, {{where}}. {{stop}}',
    click: { Left: 'Clique esquerdo', Right: 'Clique direito', Middle: 'Clique do meio' },
    timesPerSecond: '{{rate}} vezes por segundo',
    oncePerSecond: 'uma vez por segundo',
    onceEvery: 'uma vez a cada {{period}}',
    inArea: 'em um ponto aleatório dentro da área de {{w}} × {{h}}',
    atPoint: 'em {{x}}, {{y}}',
    atStart: 'onde o cursor estiver ao iniciar',
    around: 'ao redor do cursor (±{{px}} px)',
    atCursor: 'no cursor',
    stopsBoth: {
      zero: 'Termina depois de {{n}} cliques ou {{clock}}, o que vier primeiro.',
      one: 'Termina depois de {{n}} clique ou {{clock}}, o que vier primeiro.',
      other: 'Termina depois de {{n}} cliques ou {{clock}}, o que vier primeiro.',
    },
    stopsClicks: { zero: 'Termina depois de {{n}} cliques.', one: 'Termina depois de {{n}} clique.', other: 'Termina depois de {{n}} cliques.' },
    stopsTime: 'Termina depois de {{clock}}.',
    untilStopped: 'Roda até você parar.',
  },
  // A linha corta com reticências, e "Esquerdo" tem 4 letras a mais que "Left": "fixed" vira "fixo"
  // (o segmentado diz "Ponto fixo" ao lado) e "no limit" vira "∞", como nas células do meio.
  line: {
    where: { cursor: 'cursor', area: 'área', fixed: 'fixo' },
    both: '{{n}} ou {{clock}}',
    noLimit: '∞',
  },
  // "cada", sem o "a": "a cada 30 s" não cabe em uma linha da célula Ritmo.
  every: 'cada {{period}}',
  bits: {
    noLimit: 'sem limite',
    clicks: { zero: '{{n}} cliques', one: '{{n}} clique', other: '{{n}} cliques' },
    clicksOr: { zero: '{{n}} cliques ou {{clock}}', one: '{{n}} clique ou {{clock}}', other: '{{n}} cliques ou {{clock}}' },
    area: 'área {{w}}×{{h}}',
    point: 'ponto {{x}}, {{y}}',
    pointAtStart: 'ponto ao iniciar',
    jitter: 'ritmo ±{{n}}%',
    gap: '+{{ms}} ms de intervalo',
  },

  settings: {
    title: 'Configurações do Clicker',
    savedIn: 'Salvas em {{name}}',
    notInPreset: 'Em nenhum preset · {{>common.actions.new}} as guarda',
    readOnly: 'Só leitura enquanto clica. Pare para alterar.',
    foot: 'Aplica ao digitar · Ctrl+Z desfaz',
  },
  // "Rate" é "Ritmo" em toda a página (o campo, a célula, a variação e "dita o ritmo"); "Hold" é o
  // "tempo segurado" na frase, como no cabeçalho da macro.
  click: {
    title: 'Clique',
    button: 'Botão',
    rate: 'Ritmo',
    chooseRate: 'Escolher ritmo',
    rates: 'Ritmos',
    unit: 'Unidade do ritmo',
    period: 'Um clique a cada {{period}}. O tempo segurado e o intervalo cabem nele.',
    holdCaps: 'O tempo segurado de {{ms}} ms dita o ritmo: no máximo {{rate}}/s.',
    longest: '{{s}} s é o período mais longo: um clique por minuto é o mais lento.',
    shortest: '{{ms}} ms é o período mais curto: no máximo {{rate}}/s.',
  },
  buttons: { Left: 'Esquerdo', Right: 'Direito', Middle: 'Meio' },
  // "Spread" é um rótulo de campo: o substantivo, "Dispersão".
  where: {
    title: 'Onde',
    options: { cursor: 'Cursor', area: 'Área', fixed: 'Ponto fixo' },
    spread: 'Dispersão',
    spreadSwitch: 'Dispersão ao redor do cursor',
    spreadHint: 'Um ponto aleatório a até {{px}} px do cursor em cada clique.',
    atCursor: 'Cada clique cai onde o cursor está.',
    at: 'em {{x}}, {{y}}',
    redraw: '{{>inspector.region.redraw}}',
    clearArea: 'Limpar área',
    areaHint: 'Um novo ponto aleatório dentro da área em cada clique.',
    atStart: 'Ao iniciar',
    onPoint: 'Todo clique neste ponto',
    whereStarts: 'Onde o cursor estiver ao iniciar',
    pickAgain: 'Escolher outro',
    pickPoint: 'Escolher ponto',
    clearPoint: 'Limpar ponto fixo',
    pointHint: 'O mesmo ponto em todo clique. Sem um ponto escolhido, fixa onde o cursor estiver ao iniciar.',
    captureFor: 'para o Clicker',
    captureForPreset: 'para o Clicker, {{name}}',
  },
  stop: {
    title: 'Parar depois de',
    clicks: 'Cliques',
    clicksSwitch: 'Limitar cliques',
    clicksField: 'Limite de cliques',
    time: 'Tempo',
    timeSwitch: 'Limitar tempo',
    timeField: 'Limite de tempo',
    hint: 'O que vier primeiro. O tempo pausado não conta.',
  },
  // Com o "Game move", o cursor desliza até o ponto: "deslizar" na dica e no aviso.
  tuning: {
    title: 'Ajuste fino',
    jitter: 'Variação',
    jitterSwitch: 'Variação do ritmo',
    hold: 'Segurar',
    gap: 'Intervalo',
    gameMove: 'Movimento de jogo',
    gameMoveHint: 'Com o Movimento de jogo, o cursor desliza em vez de saltar, para jogos como Roblox. Custa alguns ms por clique.',
    noWalk: 'Sem efeito no cursor: não há para onde deslizar.',
  },
  hotkeys: {
    title: 'Hotkeys',
    startStop: 'Iniciar/parar',
  },
} satisfies Catalogo<typeof en>;
