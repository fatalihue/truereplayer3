// As dicas de uma vez (shell/tips/Tips.tsx), sobre a lista de passos: uma durante a primeira gravação e
// um cartão depois dela, com o que fazer em seguida. Para quem é novo; cada uma aparece uma vez.
export default {
  // Durante a primeira gravação.
  recording: {
    title: 'Do the task now, in any app',
    body: 'Each click and key becomes a step below.',
    pressKey: 'Press {{key}} to stop.',                      // key = a tecla da gravação, desenhada como tecla
    pressStop: 'Press {{>common.actions.stop}} to finish.',  // sem tecla de gravação: o botão Stop do cabeçalho
    hide: 'Hide this tip',                                   // o × do canto: nome e dica · verbo
  },
  // Depois da primeira gravação: uma lista do que fazer, cada item marcado quando feito.
  card: {
    title: 'Your first macro is saved',   // título e nome do cartão para o leitor de tela
    hide: 'Hide these tips',              // o × do canto · verbo
    recorded: { one: 'Recorded {{count}} step', other: 'Recorded {{count}} steps' },  // já feito · count = os passos gravados
    tryIt: 'Try it',                      // o botão ao lado é Replay (common.actions.replay)
    // O botão ao lado dá uma hotkey à macro. Não "from any app": com uma janela-alvo e sem Bring to
    // focus, a hotkey só dispara com ela na frente. app = TrueReplayer 3.
    runWithShortcut: 'Run it without coming back to {{app}}',
    changeShortcut: 'Change the shortcut',
    addShortcut: 'Add a shortcut',
  },
} as const;
