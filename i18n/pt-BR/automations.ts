import type en from '../en-US/automations.ts';
import type { Catalogo } from '../tipos.ts';

// A automação é feminina ("Nova automação", "a automação está ativada"); a macro também. Entre o
// número e a unidade vai um espaço inseparável ( ), como o plano pede (§4.2).
export default {
  head: {
    sub: 'Cada uma roda uma macro sozinha: de tempos em tempos, em um horário ou quando algo aparece',
    runAll: 'Rodar automações',
    runAllOnTip: 'As automações ativadas rodam suas macros quando o gatilho chega. Desativado, todas esperam.',
    runAllOffTip: 'Desativado: nenhuma automação roda, ativada ou não.',
    new: 'Nova automação',
    noMacro: 'Crie uma macro antes',
    allTaken: 'Toda macro já tem a sua automação: uma por macro',
  },

  pick: {
    title: 'Escolha a macro que ela roda',
    list: 'Macros sem automação',
  },

  empty: {
    title: 'Nenhuma automação ainda',
    text: 'Uma automação roda uma macro sozinha — de tempos em tempos, em um horário definido ou quando algo aparece na tela.',
    from: 'Começar por',
  },
  starts: {
    interval: 'A cada 10 minutos',
    schedule: 'Todo dia às 09:00',
    text: 'Quando um texto aparecer',
  },

  filters: {
    all: 'Todas',
    armed: 'Armadas',
    off: 'Desativadas',
    attention: 'Precisam de atenção',
  },
  filterGroup: 'Filtrar por status',
  search: 'Filtrar automações',
  searchHint: 'Filtrar por macro ou gatilho',
  columns: {
    on: 'Ativada',
    macro: 'Macro',
    trigger: 'Gatilho',
    status: 'Status',
    lastFired: 'Último disparo',
    fires: 'Disparos',
  },
  noMatch: 'Nenhuma automação corresponde a “{{query}}”.',
  noneInFilter: 'Nenhuma automação neste filtro.',
  hotkeysNote: 'Hotkeys e hotstrings não são automações: elas ficam em cada macro, nas configurações dela.',
  row: {
    switch: 'Automação de {{name}}',
    edit: 'Editar a automação de {{name}}',
    disabledTip: '{{>macroSettings.automation.disabledTip}}',
  },

  status: {
    off: 'Desativada',
    disabled: 'Macro desativada',       // "A macro está desativada" não cabe nos 125 px
    never: 'Nunca dispara',
    paused: 'Pausada',
    next: 'Próximo: {{when}}',          // o próximo disparo; when pode ser "13 nov. 09:00", e "às" não serve
    watching: 'Vigiando',
    notWatching: 'Sem vigiar',
    armed: 'Armada',
  },
  statusTip: {
    disabled: 'A macro está desativada, então a automação dela não roda. Ative-a na biblioteca.',
    paused: '“{{>automations.head.runAll}}” está desativado: nada roda até você ativá-lo.',
    conditionTrue: '{{>automations.status.watching}} · a condição é verdadeira agora',
    conditionFalse: '{{>automations.status.watching}} · a condição é falsa agora',
  },
  deleted: 'Automação de {{name}} excluída',

  panel: {
    label: 'Configurações da automação',
    runs: 'Roda esta macro',
    // "Roda esta macro · desativada" não cabe ao lado do "Rodar agora": o estado basta.
    runsOff: 'Desativada',
    runNow: 'Rodar agora',
    runNowTip: 'Roda a macro uma vez agora, como a automação faria',
    actions: 'Ações da automação',
    close: 'Fechar as configurações da automação',
    openMacro: 'Abrir macro',
    turnOn: 'Ativar',
    turnOff: 'Desativar',
    resetCounters: 'Redefinir contadores',
    foot: 'Aplica ao digitar · Ctrl+Z desfaz',
  },
  notices: {
    disabled: 'A macro está desativada, então a automação dela não roda nem pode ser ativada. Ative-a na biblioteca.',
    notWatching: 'Ativada, mas sem vigiar: {{reason}}.',
    noTarget: 'Sem janela-alvo — ela age na janela que estiver em foco quando disparar.',
    setTarget: 'Definir uma janela-alvo',
  },

  runs: {
    // Lê-se com as opções: "Roda a cada…", "Roda em um horário", "Roda quando…".
    title: 'Roda',
    kinds: {
      interval: 'A cada…',
      schedule: 'Em um horário',
      condition: 'Quando…',
    },
    every: 'A cada',
    unit: 'Unidade',
    units: {
      s: 'Segundos',
      min: 'Minutos',
      h: 'Horas',
    },
    intervalHint: 'No mínimo 5 s. A primeira execução vem um intervalo depois de ativada.',
    at: 'Às',
    daysHint: '{{>conditions.time.daysHint}}',
    never: 'Nunca dispara assim: {{reason}}',
  },
  hours: {
    only: 'Só entre estes horários',
    and: 'e',
    half: 'Preencha os dois horários — até lá, ela roda a qualquer hora.',
    overnight: 'Um fim antes do início passa da meia-noite.',
    phaseLock: 'Intervalo maior que a faixa de horas em que pode rodar — talvez nunca dispare. Encurte o intervalo ou amplie a faixa.',
    phaseLockTip: 'Este intervalo só cai em alguns horários do dia — todos podem ficar fora da faixa',
  },
  rhythm: {
    title: 'Ritmo',
    edge: 'Uma vez por aparição',
    edgeTip: 'Dispara quando aparece; de novo só depois de sumir',
    level: 'Repetir enquanto aparece',  // 141 px em 145: o mais longo que cabe
    levelTip: 'Dispara de novo a cada espera, enquanto continua',
    checkEvery: 'Verificar a cada',
    imageHint: 'A verificação de imagem varre a tela inteira — aumente este valor se puder esperar alguns segundos.',
    cooldown: 'Espera entre disparos',
    cooldownField: 'Espera entre disparos',
    usual: 'Vazio = o padrão: uma verificação a cada {{check}} s, {{cooldown}} s entre disparos.',
  },
  activity: {
    title: 'Atividade',
    fired: 'Disparos',
    firedValue: '{{n}}× · último {{when}}',
    notYet: 'Nenhum ainda',
    next: 'Próximo',
    skipped: 'Pulados',
    skippedOne: '{{n}} · {{why}}',
    skippedSeveral: '{{n}} · {{list}}',
    why: {
      busy: 'outra macro estava rodando',
      modal: 'um diálogo estava aberto',
      dirty: 'mudanças não salvas',
    },
    // "2 por outra macro rodando": o "por" poupa a concordância com o número.
    whyCounted: {
      busy: '{{n}} por outra macro rodando',
      modal: '{{n}} por um diálogo aberto',
      dirty: '{{n}} por mudanças não salvas',
    },
    ignored: 'Ignoradas',
    ignoredValue: {
      zero: 'Nenhuma mudança do clipboard logo depois de uma reprodução',
      one: '{{n}} mudança do clipboard logo depois de uma reprodução',
      other: '{{n}} mudanças do clipboard logo depois de uma reprodução',
    },
    lastResult: 'Último resultado',
  },

  condition: {
    label: 'Condição',
    hint: 'O mesmo editor de condição dos passos If e While.',
    named: 'Condição: {{name}}',
    menu: 'Condições',
    clipboardDesc: 'O texto copiado muda',
    captureFor: 'para a automação de {{name}}',
    relative: 'Relativo a uma janela',
    relativeTip: 'As coordenadas seguem a janela em vez da tela',
    relativeTo: 'Relativo ao canto superior esquerdo de {{window}}',
    relativeToUnnamed: 'Relativo ao canto superior esquerdo da janela — identifique-a acima',
    clearedToWindow: 'Coordenadas limpas — eram coordenadas da tela. Escolha de novo para guardá-las em relação à janela.',
    clearedToScreen: 'Coordenadas limpas — eram relativas à janela. Escolha de novo para guardá-las como coordenadas da tela.',
    cropSub: 'Automação de {{name}} · {{>inspector.head.expanded}}',
  },

  why: {
    noTime: 'Escolha um horário.',
    range: 'Isso é uma faixa de horas, não um horário — escolha um horário só.',
    anchor: 'As coordenadas seguem uma janela — preencha o nome do processo ou o título dela.',
    window: 'Preencha o nome de um processo ou o título de uma janela — com os dois vazios, nunca casa.',
    process: 'Preencha o nome de um processo.',
    file: 'Preencha o caminho de um arquivo ou de uma pasta.',
    image: 'Capture uma imagem de referência.',
    region: 'Desenhe a região a ler — ler a tela inteira a cada verificação é lento demais.',
    textColor: 'A cor do texto precisa ter 6 dígitos hexadecimais (RRGGBB) — use “{{>probe.pick}}” ou limpe-a.',
    number: 'Digite um número para comparar.',
    pattern: 'Digite o padrão a vigiar.',
    noCompile: 'Este padrão não compila.',
    text: 'Digite o texto a vigiar.',
    pixel: 'Escolha a cor ou digite-a com seis dígitos hexadecimais (RRGGBB) — a forma curta, de três dígitos, não é aceita.',
  },

  trigger: {
    every: 'A cada {{every}}',
    at: 'Às {{time}}',
    when: 'Quando {{what}}',
    anyHour: 'Em qualquer horário',
    checkEvery: 'a cada {{seconds}} s',
    condition: 'condição',
  },
  // Os nomes das condições ficam (glossário), com a maiúscula de nome: "Quando Window open “Bloco de
  // Notas”". A do clipboard é uma frase: "Quando o clipboard muda".
  conditionWhat: {
    WindowOpen: 'Window open',
    ProcessRunning: 'Process running',
    FileExists: 'File exists',
    PixelColorMatch: 'Pixel color',
    ImageFound: 'Image found',
    ScreenText: 'Text on screen',
    ClipboardChanged: 'o clipboard muda',
  },
  days: {
    every: 'Todo dia',
    weekends: 'Fins de semana',
    range: '{{from}} a {{to}}',         // "seg. a sex.": o código põe a maiúscula na frase
  },
  amount: '{{n}} {{unit}}',
} satisfies Catalogo<typeof en>;
