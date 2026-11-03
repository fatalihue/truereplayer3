// O cabeçalho da macro aberta (shell/header/): o nome, os chips do que a dispara, a linha sob o nome,
// o transporte (MacroHeader.tsx e Transport.tsx), o progresso de uma execução (RunProgress.tsx) e os
// painéis Record ▾ e Replay ▾ (RunOptions.tsx). Os botões Record, Replay, Stop e Continue dizem só o
// verbo e vêm de common.actions.
export default {
  region: 'Macro',                                        // nome do cabeçalho para o leitor de tela · nome

  // O nome da macro: um campo que se lê como título.
  name: {
    label: 'Macro name',                                  // nome do campo, para o leitor de tela
    taken: 'A macro with that name already exists.',      // sob o nome, em vermelho, enquanto se digita o nome de outra macro
    untitled: "Type a name. It's saved already.",         // sob o nome de uma macro nova ("Untitled macro"), que já nasce salva
  },

  // Os chips ao lado do nome. Só mostram: mudam no Inspector. Quase tudo aqui é dica (data-tip).
  chips: {
    hotkeyConflict: 'Another macro uses this hotkey for the same window — only one fires',
    hotstringInstant: 'Hotstring — fires as you type it',          // a hotstring dispara na hora
    hotstringOnEnd: 'Hotstring — fires on Enter, Space or Tab',    // dispara com a tecla que a termina (teclas: glossário)
    window: 'Window',                                   // texto do chip da janela-alvo sem título nem processo · nome
    // what = o app e o título, já montados (library/model, targetLabel), como "Notepad · “Sem título”".
    target: 'Window target: {{what}}',
    targetFromFolder: 'Window target, from the folder {{folder}}: {{what}}',  // folder = a pasta de quem a macro herda a janela-alvo
    automation: '1 automation',                         // texto do chip: uma macro tem no máximo uma automação
    automationNotArmed: 'Its automation is not armed',  // "its" é a macro
    automationArmed: 'Its automation is armed',
    automationsOff: 'Automations are switched off',     // a chave geral das automações, na barra de status, desativada
  },

  // A linha sob o nome: "18 steps · about 3.5 s per loop · last run 14:02, no errors". Corta com
  // reticências. count = os passos; duration = o tempo já formatado ("450 ms", "3.5 s", "2 min 5 s");
  // time = a hora da última execução, no formato do idioma ("2:02 PM", "14:02").
  meta: {
    noSteps: 'No steps yet',
    steps: { one: '{{count}} step', other: '{{count}} steps' },
    // Gravando: clock = o relógio da gravação ("0:04"); count = os passos já gravados.
    recording: { one: 'Recording · {{clock}} · {{count}} step', other: 'Recording · {{clock}} · {{count}} steps' },
    // Na aba Data Loop, no modo de uma linha por execução: a linha que o próximo Replay usa. row = o
    // número da linha; name = o primeiro valor dela, do usuário (a tela o isola num <bdi>).
    nextRow: {
      zero: 'No steps yet · next replay uses row {{row}}',
      one: '{{count}} step · next replay uses row {{row}}',
      other: '{{count}} steps · next replay uses row {{row}}',
    },
    nextRowNamed: {
      zero: 'No steps yet · next replay uses row {{row}}, {{name}}',
      one: '{{count}} step · next replay uses row {{row}}, {{name}}',
      other: '{{count}} steps · next replay uses row {{row}}, {{name}}',
    },
    // Quanto custa uma volta; a dica diz o que entra na conta.
    about: 'about {{duration}}',
    aboutPerRow: 'about {{duration}} per row',            // o Data Loop roda uma volta por linha
    aboutPerLoop: 'about {{duration}} per loop',          // Loops acima de 1
    estimateWhy: 'Delays + ~30 ms per step, plus holds and × N gaps. Moves and waits are not counted.',  // dica
    // A dica com mais de uma volta: count = as linhas ou os loops (sempre 2 ou mais); duration = o total.
    estimateRows: {
      one: '{{count}} row: about {{duration}} in all. {{>header.meta.estimateWhy}}',
      other: '{{count}} rows: about {{duration}} in all. {{>header.meta.estimateWhy}}',
    },
    estimateLoops: {
      one: '{{count}} loop: about {{duration}} in all. {{>header.meta.estimateWhy}}',
      other: '{{count}} loops: about {{duration}} in all. {{>header.meta.estimateWhy}}',
    },
    // Como foi a última execução desta macro, no fim da linha (a cor vem do resultado). step = o
    // passo que parou a execução; macro = a outra macro, rodada por um Run Macro, em que ela parou.
    lastRun: {
      ok: 'last run {{time}}, no errors',
      halted: 'last run {{time}}, stopped at step {{step}}',
      haltedIn: 'last run {{time}}, stopped at step {{step}} in {{macro}}',
      failed: 'last run {{time}}, it failed',
      stopped: 'last run {{time}}, stopped by you',
      // Chegou ao fim, mas passos falharam no caminho (a política de pular absorveu as falhas).
      partial: { one: 'last run {{time}}, {{count}} step failed', other: 'last run {{time}}, {{count}} steps failed' },
    },
  },

  // Como a última execução terminou, sozinho, como um trecho entre " · " (model.ts, lastRunOutcome):
  // o Dock o mostra no fim da linha dele. As lacunas são as de meta.lastRun.
  outcome: {
    ok: 'no errors',
    halted: 'stopped at step {{step}}',
    haltedIn: 'stopped at step {{step}} in {{macro}}',
    failed: 'it failed',
    stopped: 'stopped by you',
    partial: { one: '{{count}} step failed', other: '{{count}} steps failed' },
  },

  // O transporte, à direita do nome.
  recordOptions: 'Recording options',     // nome do ▾ do Record e do painel que ele abre
  runOptions: 'Run options',              // nome do ▾ do Replay e do painel que ele abre
  macroActions: 'Macro actions',          // nome do ⋯ e do menu dele
  perRow: 'per row',                      // dentro do Replay, quando o Data Loop roda uma volta por linha · orçamento: curto
  perRowTip: 'One pass per row of the Data Loop table',  // dica do Replay nesse modo
  // Dica do Replay desativado com o modo Clicker ligado: o que traz as macros de volta. keys = a
  // hotkey do modo.
  clickerOnKey: 'The Clicker is on — {{keys}} brings the macros back',
  clickerOnRail: 'The Clicker is on — {{>common.pages.macros}}, in the rail, brings them back',
  // O "Loop 3 of 3" que fica depois da execução, até a próxima. total pode ser ∞.
  loopDone: 'Loop {{current}} of {{total}}',

  // Onde a execução está, ao lado do Stop (corta com reticências; a dica mostra tudo).
  progress: {
    clicking: 'Clicking · {{clicks}}',                   // o Clicker; clicks = os cliques, já com milhar
    // Um passo Pause segura a execução: o que a solta. step = o passo; key = a tecla que solta;
    // seconds = os segundos que faltam.
    waiting: 'Waiting at step {{step}}',
    waitingKey: 'Waiting at step {{step}} · {{key}}',
    waitingSeconds: 'Waiting at step {{step}} · {{seconds}} s',
    waitingKeyOrSeconds: 'Waiting at step {{step}} · {{key}} or {{seconds}} s',
    // Dentro de uma macro que um Run Macro rodou: o passo é o dela. macro = o nome dela.
    stepIn: 'Step {{current}} of {{total}} in {{macro}}',
    running: 'Running {{macro}}',
    step: 'Step {{current}} of {{total}}',
    starting: 'Starting',                                 // antes do primeiro passo
    // Com Loops, a volta vem depois de qualquer um dos textos acima (text). total pode ser ∞.
    withLoop: '{{text}} · Loop {{current}} of {{total}}',
    clickingLabel: 'Clicking in progress',                // nome da barra de progresso, para o leitor de tela
    replayLabel: 'Replay in progress',                    // o mesmo, numa execução
  },

  // Record ▾: o que a gravação captura (chaves do app, para toda macro) e onde os passos entram.
  // O painel tem 16,5 rem; as linhas de detalhe têm folga curta.
  record: {
    capture: 'Capture',                                   // título da seção · nome
    mouse: 'Mouse clicks',
    scroll: 'Mouse scroll',
    keyboard: 'Keyboard',
    combined: 'One step per click or key',
    combinedDetail: 'Off records press and release apart',  // sob a linha · orçamento: 148–166 px, +30% ganha uma linha
    browser: 'Browser actions',
    browserDetail: 'Through the browser extension',         // sob a linha · orçamento: 148–166 px
    // Onde a gravação entra: no ponto de inserção, depois do último passo selecionado. step = o número dele.
    intoEmpty: 'Records into the empty macro',
    atInsert: 'Records at the insert point, after step {{step}}',
    atEnd: 'Records at the end, after step {{step}}',
    hotkey: 'Start or stop',                              // rótulo da hotkey de gravar, ao lado da tecla
  },

  // Replay ▾: como a macro aberta roda, salvo com ela. O painel tem 20 rem. Loops e Game Mode ficam
  // em inglês (glossário) e não estão aqui.
  replay: {
    heading: 'Run options · saved with the macro',
    loopsTip: 'The Data Loop table runs the macro once per row instead.',  // dica de Loops com o Data Loop por linha
    interval: 'Interval',                                 // rótulo do campo, em ms
    intervalTip: 'Between loops',
    jitter: 'Jitter',                                     // rótulo do campo, em %
    jitterTip: 'Random ±% on each delay — less robotic.',
    appDefault: 'Default',                                // ao lado do campo, enquanto a macro segue o do app
    appDefaultTip: "The app's jitter. Type a number to give this macro its own.",
    useDefault: 'Use default',                            // botão: volta ao do app
    useDefaultTip: "Back to the app's jitter ({{value}} %)",  // value = o do app, em %
    returnCursor: 'Return cursor',
    returnCursorTip: 'The cursor goes back to where it was when the run started.',
    gameModeTip: 'The cursor walks a path so games accept the move. Off jumps at once.',
    fastApproach: 'Fast approach',
    fastApproachTip: 'Teleports long moves, walks only the last stretch. Turn off if a game misclicks.',
    fastApproachOff: 'Only with Game Mode on.',           // dica da linha desativada
    hotkey: 'Replay or stop',                             // rótulo da hotkey de reproduzir, ao lado da tecla
    // A escolha de cada linha: o padrão do app (e o que ele é agora) ou um valor só da macro.
    choiceDefaultOn: 'Default (on)',
    choiceDefaultOff: 'Default (off)',
    choiceOn: 'On',
    choiceOff: 'Off',
  },
} as const;
