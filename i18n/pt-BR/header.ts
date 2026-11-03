import type en from '../en-US/header.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  region: 'Macro',

  name: {
    label: 'Nome da macro',
    taken: 'Já existe uma macro com esse nome.',
    untitled: 'Digite um nome. A macro já está salva.',
  },

  chips: {
    hotkeyConflict: 'Outra macro usa esta hotkey na mesma janela — só uma dispara',
    hotstringInstant: 'Hotstring — dispara ao digitar',
    hotstringOnEnd: 'Hotstring — dispara com Enter, Space ou Tab',
    window: 'Janela',
    target: 'Janela-alvo: {{what}}',
    targetFromFolder: 'Janela-alvo, da pasta {{folder}}: {{what}}',
    automation: '1 automação',
    automationNotArmed: 'A automação dela não está armada',
    automationArmed: 'A automação dela está armada',
    automationsOff: 'As automações estão desativadas',
  },

  meta: {
    noSteps: 'Nenhum passo ainda',
    steps: { zero: 'Nenhum passo', one: '{{count}} passo', other: '{{count}} passos' },
    recording: {
      zero: 'Gravando · {{clock}} · {{count}} passos',
      one: 'Gravando · {{clock}} · {{count}} passo',
      other: 'Gravando · {{clock}} · {{count}} passos',
    },
    // "next replay": o verbo, porque a terminologia é "reproduzir" (Replay ▾ é o botão Reproduzir).
    nextRow: {
      zero: 'Nenhum passo ainda · ao reproduzir, usa a linha {{row}}',
      one: '{{count}} passo · ao reproduzir, usa a linha {{row}}',
      other: '{{count}} passos · ao reproduzir, usa a linha {{row}}',
    },
    nextRowNamed: {
      zero: 'Nenhum passo ainda · ao reproduzir, usa a linha {{row}}, {{name}}',
      one: '{{count}} passo · ao reproduzir, usa a linha {{row}}, {{name}}',
      other: '{{count}} passos · ao reproduzir, usa a linha {{row}}, {{name}}',
    },
    about: 'cerca de {{duration}}',
    aboutPerRow: 'cerca de {{duration}} por linha',
    aboutPerLoop: 'cerca de {{duration}} por loop',
    estimateWhy: 'Delays + ~30 ms por passo, mais o tempo segurado e os intervalos do × N. Movimentos e esperas não contam.',
    estimateRows: {
      zero: '{{count}} linhas: cerca de {{duration}} no total. {{>header.meta.estimateWhy}}',
      one: '{{count}} linha: cerca de {{duration}} no total. {{>header.meta.estimateWhy}}',
      other: '{{count}} linhas: cerca de {{duration}} no total. {{>header.meta.estimateWhy}}',
    },
    estimateLoops: {
      zero: '{{count}} loops: cerca de {{duration}} no total. {{>header.meta.estimateWhy}}',
      one: '{{count}} loop: cerca de {{duration}} no total. {{>header.meta.estimateWhy}}',
      other: '{{count}} loops: cerca de {{duration}} no total. {{>header.meta.estimateWhy}}',
    },
    // "last run 14:02" fica "rodou às 14:02": curto, e a macro é o sujeito de tudo o que vem depois.
    lastRun: {
      ok: 'rodou às {{time}}, sem erros',
      halted: 'rodou às {{time}}, parou no passo {{step}}',
      haltedIn: 'rodou às {{time}}, parou no passo {{step}} em {{macro}}',
      failed: 'rodou às {{time}}, falhou',
      stopped: 'rodou às {{time}}, você parou',
      partial: {
        zero: 'rodou às {{time}}, nenhum passo falhou',
        one: 'rodou às {{time}}, {{count}} passo falhou',
        other: 'rodou às {{time}}, {{count}} passos falharam',
      },
    },
  },

  outcome: {
    ok: 'sem erros',
    halted: 'parou no passo {{step}}',
    haltedIn: 'parou no passo {{step}} em {{macro}}',
    failed: 'falhou',
    stopped: 'você parou',
    partial: { zero: 'nenhum passo falhou', one: '{{count}} passo falhou', other: '{{count}} passos falharam' },
  },

  recordOptions: 'Opções de gravação',
  runOptions: 'Opções de execução',
  macroActions: 'Ações da macro',
  perRow: 'por linha',
  perRowTip: 'Uma volta por linha da tabela do Data Loop',
  clickerOnKey: 'O Clicker está ativado — {{keys}} traz as macros de volta',
  clickerOnRail: 'O Clicker está ativado — {{>common.pages.macros}}, no trilho, traz as macros de volta',
  loopDone: 'Loop {{current}} de {{total}}',

  progress: {
    clicking: 'Clicando · {{clicks}}',
    waiting: 'Esperando no passo {{step}}',
    waitingKey: 'Esperando no passo {{step}} · {{key}}',
    waitingSeconds: 'Esperando no passo {{step}} · {{seconds}} s',
    waitingKeyOrSeconds: 'Esperando no passo {{step}} · {{key}} ou {{seconds}} s',
    stepIn: 'Passo {{current}} de {{total}} em {{macro}}',
    running: 'Rodando {{macro}}',
    step: 'Passo {{current}} de {{total}}',
    starting: 'Iniciando',
    withLoop: '{{text}} · Loop {{current}} de {{total}}',
    clickingLabel: 'Clicando',
    replayLabel: 'Reproduzindo',
  },

  record: {
    capture: 'Captura',
    mouse: 'Cliques do mouse',
    scroll: 'Rolagem do mouse',
    keyboard: 'Teclado',
    combined: 'Um passo por clique ou tecla',
    combinedDetail: 'Desativado grava descer e subir à parte',
    browser: 'Ações do navegador',
    browserDetail: 'Pela extensão do navegador',
    intoEmpty: 'Grava na macro vazia',
    // Como o rodapé do Add step (insert.after): "no ponto de inserção" ganhava uma linha (228 de 212 px).
    atInsert: 'Grava depois do passo {{step}}',
    atEnd: 'Grava no fim, depois do passo {{step}}',
    hotkey: 'Iniciar ou parar',
  },

  replay: {
    heading: 'Opções de execução · salvas com a macro',
    loopsTip: 'A tabela do Data Loop roda a macro uma vez por linha, em vez disso.',
    interval: 'Intervalo',
    intervalTip: 'Entre os loops',
    jitter: 'Variação',
    jitterTip: 'Variação aleatória de ±% em cada delay — menos robótico.',
    appDefault: 'Padrão',
    appDefaultTip: 'A variação do app. Digite um número para esta macro ter a sua.',
    useDefault: 'Usar o padrão',
    useDefaultTip: 'Volta à variação do app ({{value}} %)',
    returnCursor: 'Devolver o cursor',
    returnCursorTip: 'O cursor volta para onde estava quando a execução começou.',
    gameModeTip: 'O cursor percorre um caminho para os jogos aceitarem o movimento. Desativado, ele salta direto.',
    fastApproach: 'Aproximação rápida',
    fastApproachTip: 'Teletransporta os movimentos longos e anda só o trecho final. Desative se um jogo errar o clique.',
    fastApproachOff: 'Só com o Game Mode ativado.',
    hotkey: 'Reproduzir ou parar',
    choiceDefaultOn: 'Padrão (ativado)',
    choiceDefaultOff: 'Padrão (desativado)',
    choiceOn: 'Ativado',
    choiceOff: 'Desativado',
  },
} satisfies Catalogo<typeof en>;
