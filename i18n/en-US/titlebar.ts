// A barra de título (shell/TitleBar.tsx) e o botão Compact view ao lado dos botões da janela
// (shell/CompactButton.tsx).
export default {
  // A busca do meio, que abre o Ctrl+K. A forma longa corta com reticências; abaixo de 19,5 rem vira a curta.
  search: 'Search macros, steps and commands',  // texto do botão e o nome dele · verbo + objetos
  searchShort: 'Search',                         // o mesmo botão com menos espaço · orçamento: o do inglês

  // O selo de estado, à direita: só leitura. name = o nome da macro aberta; clicks = o número de
  // cliques do Clicker, já formatado; seconds = a contagem antes do primeiro clique.
  state: {
    ready: 'Ready',                              // o motor parado
    clicker: 'Clicker',                          // o modo Clicker parado (glossário)
    recording: 'Recording',                      // gravando, sem macro aberta
    recordingMacro: 'Recording · {{name}}',
    replaying: 'Replaying',
    replayingMacro: 'Replaying · {{name}}',
    waiting: 'Waiting',                          // um passo Pause segura a execução
    waitingMacro: 'Waiting · {{name}}',
    startingIn: 'Starting in {{seconds}} s',     // o Clicker antes do primeiro clique
    clicking: 'Clicking · {{clicks}}',
    paused: 'Paused · {{clicks}}',               // o Clicker pausado
  },

  compact: 'Compact view',                       // nome do botão · nome
  compactTip: 'Compact view · also in Ctrl+K',   // dica do botão
} as const;
