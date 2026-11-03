// A janela compacta, e a faixa estreita (abaixo de 520 px) da janela inteira (shell/compact/
// CompactView.tsx): a macro, o que ela está fazendo e os botões que importam agora. A linha de estado
// é o estado em negrito (state) e, depois de " · ", o detalhe (detail); ela corta com reticências.
// Os botões Stop, Pause, Resume, Continue, Replay e Record dizem só o verbo e vêm de common.actions.
export default {
  view: 'Compact view',                         // nome da janela compacta, para o leitor de tela
  layout: 'Compact layout',                     // o mesmo, na faixa estreita da janela inteira
  noMacro: 'No macro open',                     // no lugar do nome da macro, e o estado
  chooseMacro: 'Choose macro',                  // nome do menu das macros
  chooseMacroNamed: 'Choose macro, {{name}}',   // nome do botão do nome; name = a macro aberta, Clicker ou "No macro open"
  back: 'Back to the full window',              // nome e dica do botão que sai da janela compacta

  // O estado, em negrito. step = o número do passo.
  state: {
    recording: 'Recording',
    clicking: 'Clicking',                       // o Clicker rodando
    waiting: 'Waiting at step {{step}}',        // um passo Pause segura a execução
    replaying: 'Replaying',
    clickerOpen: 'Clicker open',                // a página do Clicker aberta, parado
    stoppedAt: 'Stopped at step {{step}}',      // a última execução parou num passo; a linha de baixo diz por quê
    ready: 'Ready',
  },

  // O detalhe, depois do estado.
  detail: {
    recording: { one: '{{clock}} · {{count}} step', other: '{{clock}} · {{count}} steps' },  // clock = o relógio da gravação ("0:04")
    // O Clicker: rate = cliques por segundo; clicks = os cliques; total = o limite de cliques. Já com milhar.
    clicking: '{{rate}}/s · {{clicks}}',
    clickingOf: '{{rate}}/s · {{clicks}} of {{total}}',
    keyOrSeconds: '{{key}} or {{seconds}} s',   // o que solta o Pause: a tecla ou os segundos que faltam
    // Reproduzindo: a volta e o passo. total e loops podem ser ∞.
    loop: 'loop {{current}} of {{total}}',
    step: 'step {{current}} of {{total}}',
    loopStep: 'loop {{loop}} of {{loops}} · step {{step}} of {{steps}}',
    keyStarts: '{{key}} starts',                // a hotkey que inicia o Clicker
    chooseAbove: 'choose one above',            // sem macro aberta: o nome em cima abre a lista
    steps: { one: '{{count}} step', other: '{{count}} steps' },
    // Pronto, com a hora da última execução desta macro (time = "14:02").
    stepsLastRun: { one: '{{count}} step · last run {{time}}', other: '{{count}} steps · last run {{time}}' },
  },

  start: 'Start',                               // botão: inicia o Clicker · verbo
  openReport: 'Open run report',                // botão: abre o Run Report no Dock da janela inteira
  runAgain: 'Run again',                        // botão: roda a macro de novo
} as const;
