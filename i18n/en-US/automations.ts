// A página Automations (shell/pages/automations/): a tabela das automações, com os filtros e a
// pesquisa (AutomationsPage.tsx); o painel "Automation settings" ao lado, com o Run now, o como roda
// (Every… / At a time / When…), o ritmo, as horas e a atividade; a condição de uma automação
// (AutomationCondition.tsx); e o que automationModel.ts diz de um gatilho: o estado, por que ele nunca
// dispara, a coluna Trigger e o cartão do Inspector (Macro settings › Automation usa cardWords e
// statusOf). Uma automação por macro: a macro é o nome dela.
// Os nomes das condições (Image found, Window open…) são glossário e vêm de shell/inspector/checks.ts;
// os campos de cada condição são os do Inspector (áreas conditions e probe).
//
// Nas lacunas: name = o nome da macro da automação; n = um número já formatado (fmtNum: 1,000 /
// 1.000); when = um instante do motor, já formatado (a hora hoje; o dia e a hora em outro dia);
// reason = o motivo, nas palavras do motor ou do espelho (why) dele.
export default {
  // O topo da página: o título (common.pages.automations), o subtítulo, a chave de todas e o botão.
  head: {
    // Uma linha que corta com reticências · orçamento: o do inglês.
    sub: 'Each one runs a macro by itself: every so often, at a set time, or when something shows up',
    runAll: 'Run automations',          // a chave geral das automações: o texto ao lado dela e o nome · verbo
    runAllOnTip: 'The automations that are on run their macros when their trigger comes. Off holds them all.',
    runAllOffTip: 'Off: no automation runs, on or not.',
    new: 'New automation',              // botão · o de Ctrl+K também
    noMacro: 'Create a macro first',    // dica do New automation (e dos cartões de início) sem macro nenhuma
    allTaken: 'Every macro has its automation: one per macro',  // dica do New automation com todas tomadas
  },

  // New automation: a escolha da macro que a automação roda (um popover com a lista).
  pick: {
    title: 'Pick the macro it runs',    // título e nome do popover · it = a automação (feminino em pt-BR)
    list: 'Macros without an automation',  // nome da lista, para o leitor de tela
  },

  // A página sem automação nenhuma, e os cartões para começar.
  empty: {
    title: 'No automations yet',
    text: 'An automation runs a macro by itself — on a timer, at a set time, or when something shows on screen.',
    from: 'Start from',                 // rótulo sobre os cartões
  },
  // Os cartões de início · orçamento: 185 px, quebra com +30%.
  starts: {
    interval: 'Every 10 minutes',
    schedule: 'Every day at 09:00',
    text: 'When text shows on screen',
  },

  // Os filtros por estado, acima da tabela: chips com o número ao lado (desenhado à parte).
  filters: {
    all: 'All',
    armed: 'Armed',                     // as ligadas que rodam (a automação, feminino em pt-BR)
    off: 'Off',                         // as desligadas
    attention: 'Needs attention',       // ligadas, mas que não rodam como deveriam
  },
  filterGroup: 'Filter by status',      // nome do grupo dos chips, para o leitor de tela
  search: 'Filter automations',         // nome do campo de filtro, para o leitor de tela
  searchHint: 'Filter by macro or trigger',  // placeholder · orçamento: 182 px
  // Os cabeçalhos da tabela · nome.
  columns: {
    on: 'On',                           // a coluna da chave de cada uma · orçamento: 56 px
    macro: 'Macro',
    trigger: 'Trigger',
    status: 'Status',
    lastFired: 'Last fired',
    fires: 'Fires',                     // quantas vezes disparou · orçamento: 48 px
  },
  noMatch: 'No automation matches “{{query}}”.',  // query = o que foi digitado no filtro
  noneInFilter: 'No automations in this filter.',
  hotkeysNote: 'Hotkeys and hotstrings are not automations: they live on each macro, in its settings.',
  // Uma linha da tabela.
  row: {
    switch: '{{name}} automation',      // nome da chave da linha, para o leitor de tela
    edit: 'Edit the automation of {{name}}',  // nome do botão com o nome da macro · verbo
    disabledTip: '{{>macroSettings.automation.disabledTip}}',  // a chave de uma macro desativada
  },

  // A coluna Status (automationModel.ts, statusOf) e o cartão do Inspector · orçamento: 125 px.
  status: {
    off: 'Off',                         // a automação desligada
    disabled: 'Macro is disabled',
    never: 'Never fires',               // como está, nunca dispara: o porquê vai na dica
    paused: 'Paused',                   // Run automations desligado
    next: 'Next at {{when}}',           // o próximo disparo de um intervalo ou de um horário
    watching: 'Watching',               // uma condição sendo vigiada
    notWatching: 'Not watching',        // o motor parou de vigiar: o motivo vai na dica
    armed: 'Armed',                     // ligada, à espera
  },
  // A dica do estado: por que ele é o que é.
  statusTip: {
    disabled: 'The macro is disabled, so its automation can’t run. Enable it in the library.',
    paused: '{{>automations.head.runAll}} is off: nothing runs until it is on.',
    conditionTrue: '{{>automations.status.watching}} · the condition is true now',
    conditionFalse: '{{>automations.status.watching}} · the condition is false now',
  },
  deleted: 'Deleted the automation of {{name}}',  // aviso, com Undo (common.actions.undo)

  // O painel "Automation settings": o cabeçalho, o menu ⋯ e o rodapé.
  panel: {
    label: 'Automation settings',       // nome do painel, para o leitor de tela
    runs: 'Runs this macro',            // sob o nome da macro, no cabeçalho
    // O mesmo, com a automação desligada · orçamento: o do inglês (o Run now ocupa o resto).
    runsOff: 'Runs this macro · off',
    runNow: 'Run now',                  // botão: roda a macro uma vez, já · verbo
    runNowTip: 'Runs the macro once now, as the automation would',
    actions: 'Automation actions',      // o botão ⋯ e o menu dele, para o leitor de tela
    close: 'Close automation settings', // o ×, para o leitor de tela · verbo
    // Os itens do menu ⋯ (Delete é common.actions.delete) · verbo.
    openMacro: 'Open macro',
    turnOn: 'Turn on',
    turnOff: 'Turn off',
    resetCounters: 'Reset counters',    // também o botão da Activity
    foot: 'Applies as you type · Ctrl+Z undoes',  // o rodapé do painel
  },
  // Os avisos no alto do painel: o que impede a automação, dito onde se conserta.
  notices: {
    disabled: 'The macro is disabled, so its automation can’t run or be turned on. Enable it in the library.',
    notWatching: 'On, but not watching: {{reason}}.',  // reason = o motivo nas palavras do motor
    noTarget: 'No target window — it acts on whichever window is focused when it fires.',
    setTarget: 'Set a window target',   // o link que abre a janela-alvo da macro · verbo
  },

  // Runs: como a automação dispara.
  runs: {
    title: 'Runs',                      // título da seção e nome do segmentado · "it runs…"
    // O segmentado de 3, no painel de 22,5 rem: opções curtas.
    kinds: {
      interval: 'Every…',
      schedule: 'At a time',
      condition: 'When…',
    },
    every: 'Every',                     // rótulo e nome do campo do intervalo: "Every [15] min"
    unit: 'Unit',                       // nome do segmentado s / min / h (as unidades ficam)
    // As dicas das unidades.
    units: {
      s: 'Seconds',
      min: 'Minutes',
      h: 'Hours',
    },
    intervalHint: 'At least 5 s. The first run comes one interval after it is turned on.',
    at: 'At',                           // rótulo e nome do campo da hora de um horário: "At [09:00]"
    daysHint: '{{>conditions.time.daysHint}}',
    never: 'Never fires as it is: {{reason}}',  // reason = um dos porquês de why, abaixo
  },
  // Only between these hours: o intervalo ou a condição só entre duas horas.
  hours: {
    only: 'Only between these hours',   // o texto ao lado da chave e o nome dela
    and: 'and',                         // entre os dois campos de hora: "[09:00] and [18:00]"
    half: 'Fill in both times — until then it runs at any hour.',
    overnight: 'An end before the start crosses midnight.',
    phaseLock: 'Interval longer than the hours it may run in — it may never fire. Shorten it or widen the hours.',
    phaseLockTip: 'This interval only comes at a few times of day — all may fall outside the hours',
  },
  // Rhythm: o ritmo de uma condição.
  rhythm: {
    title: 'Rhythm',                    // título da seção e nome do segmentado
    // O segmentado de 2, no painel de 22,5 rem · orçamento: 145 px cada.
    edge: 'Once each time it shows',
    edgeTip: 'Fires when it shows; again only after it goes away',
    level: 'Repeat while it shows',
    levelTip: 'Fires again after each wait while it stays',
    checkEvery: 'Check every',          // rótulo e nome do campo, em segundos: "Check every [2] s"
    imageHint: 'Image checks scan the whole screen — raise this if you can wait a few seconds.',
    cooldown: 'Wait between fires',     // rótulo do campo da espera entre dois disparos, em segundos
    cooldownField: 'Cooldown',          // o mesmo campo, para o leitor de tela
    // Sob os dois campos vazios: check = a verificação padrão, em segundos (0.5 / 0,5); cooldown = a
    // espera padrão, em segundos.
    usual: 'Empty = the usual: a check every {{check}} s, {{cooldown}} s between fires.',
  },
  // Activity: quantas vezes disparou e quando, o que pulou e por quê. Rótulo à esquerda, valor à direita.
  activity: {
    title: 'Activity',                  // título da seção
    fired: 'Fired',                     // rótulo
    firedValue: '{{n}}× · last {{when}}',  // n = as vezes; when = a última
    notYet: 'Not yet',                  // o valor de Fired sem disparo nenhum
    next: 'Next',                       // rótulo: o próximo disparo
    skipped: 'Skipped',                 // rótulo: os disparos que não rodaram
    // O valor de Skipped: n = todos os pulados; why = o motivo, quando é um só; list = os motivos com
    // o número de cada, separados por ", ".
    skippedOne: '{{n}} · {{why}}',
    skippedSeveral: '{{n}} · {{list}}',
    // Por que um disparo não rodou: sozinho (why) e com o número na frente (list).
    why: {
      busy: 'another macro was running',
      modal: 'a dialog was open',
      dirty: 'unsaved changes',
    },
    whyCounted: {
      busy: '{{n}} another macro was running',
      modal: '{{n}} a dialog was open',
      dirty: '{{n}} unsaved changes',
    },
    ignored: 'Ignored',                 // rótulo: as mudanças do clipboard que não contaram
    // count e n = as mudanças ignoradas (1 ou mais).
    ignoredValue: { one: '{{n}} clipboard change just after a replay', other: '{{n}} clipboard changes just after a replay' },
    lastResult: 'Last result',          // rótulo: o que o motor disse da última vez
  },

  // When…: a condição da automação, no mesmo editor do If (AutomationCondition.tsx).
  condition: {
    label: 'Condition',                 // rótulo da seção
    hint: 'The same condition editor as the If and While steps.',  // If e While são os passos (glossário)
    named: 'Condition: {{name}}',       // nome do botão da condição, para o leitor de tela · name = a condição (glossário)
    menu: 'Conditions',                 // nome do menu das condições, para o leitor de tela
    clipboardDesc: 'The copied text changes',  // a linha da condição Clipboard no menu: a de uma automação
    // O que a barra da captura na tela diz: "Pick the point · for the Trade Roblox automation".
    captureFor: 'for the {{name}} automation',
    relative: 'Relative to a window',   // o texto ao lado da chave e o nome dela
    relativeTip: 'Coordinates follow the window instead of the screen',
    relativeTo: 'Relative to {{window}}’s top-left corner',  // window = o processo ou o título da janela
    relativeToUnnamed: 'Relative to the window’s top-left corner — name it above',
    // Ao virar a chave, o ponto ou a região somem: os números estavam no outro espaço.
    clearedToWindow: 'Coordinates cleared — they were screen coordinates. Pick again to store them relative to the window.',
    clearedToScreen: 'Coordinates cleared — they were relative to the window. Pick again to store them as screen coordinates.',
    cropSub: 'Automation of {{name}} · {{>inspector.head.expanded}}',  // o subtítulo do recorte da imagem
  },

  // Por que um gatilho nunca dispara como está (automationModel.ts, whyCannotFire, o espelho de
  // TriggerService.DescribeUnfireable): uma frase que diz o que fazer.
  why: {
    noTime: 'Pick a time of day.',
    range: 'That is a range of hours, not a time of day — pick a single time.',
    anchor: 'The coordinates follow a window — fill in its process name or its title.',
    window: 'Fill in a process name or a window title — with both blank this can never match.',
    process: 'Fill in a process name.',
    file: 'Fill in a file or folder path.',
    image: 'Capture a reference image.',
    region: 'Draw the region to read — reading the whole screen every check is too slow.',
    textColor: 'Text color must be 6 hex digits (RRGGBB) — use {{>probe.pick}}, or clear it.',  // cita o botão Pick
    number: 'Enter a number to compare with.',
    pattern: 'Enter the pattern to watch for.',
    noCompile: 'This pattern does not compile.',
    text: 'Enter the text to watch for.',
    pixel: 'Pick the color, or type it as six hex digits (RRGGBB) — a three-digit shorthand is not accepted.',
  },

  // A coluna Trigger, a dica dela e o cartão do Inspector. A frase de cada tipo leva a parte principal
  // na lacuna, e a coluna desenha o resto mais apagado: "Every 15 min · 08:00–20:00", "At 23:00 · Mon
  // to Fri", "When text on screen “Aceitar”".
  trigger: {
    every: 'Every {{every}}',           // every = o intervalo, "15 min" (amount)
    at: 'At {{time}}',                  // time = a hora, HH:mm
    when: 'When {{what}}',              // what = o que a condição vigia (conditionWhat)
    anyHour: 'At any hour',             // o cartão de um intervalo sem horas
    checkEvery: 'every {{seconds}} s',  // no cartão de uma condição · seconds = 2 / 0.5 (0,5)
    condition: 'condition',             // o que vigia uma condição que o app não conhece
  },
  // O que a condição vigia, depois de When: os nomes das condições (glossário) no meio da frase.
  conditionWhat: {
    WindowOpen: 'window open',
    ProcessRunning: 'process running',
    FileExists: 'file exists',
    PixelColorMatch: 'pixel color',
    ImageFound: 'image found',
    ScreenText: 'text on screen',
    ClipboardChanged: 'clipboard changes',  // a condição Clipboard de uma automação: o texto copiado muda
  },
  // Os dias de um horário. Os nomes dos dias vêm do Intl, no idioma do build (automationModel.ts).
  days: {
    every: 'Every day',                 // nenhum dia ou todos
    weekends: 'Weekends',               // sábado e domingo
    range: '{{from}} to {{to}}',        // três dias ou mais em seguida · from e to = os nomes curtos ("Mon")
  },
  // Um intervalo: n = o número (fmtNum) e unit = a unidade, s / min / h, igual nos dois idiomas.
  amount: '{{n}} {{unit}}',
} as const;
