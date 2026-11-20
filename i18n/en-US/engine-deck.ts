// O motor: o que o Deck diz sozinho (Source/DeckService.cs, branch deck) — a notificação do Windows
// quando o deck.json não pôde ser lido na abertura, e o porquê da falha que a página mostra sob o aviso
// de quarentena (deck.loadFailureDetail). O molde é o do Teclado (engine-teclado.ts). Os nomes de
// arquivo ficam. pending = o arquivo que recebe as mudanças ("deck.pending.json"). "Deck" é o nome do
// recurso (glossário); "deck", em minúscula, é cada painel.
export default {
  open: 'Open the Deck',                // botão da notificação: abre a página Deck

  // O deck.json não pôde ser lido na abertura (o motor não o sobrescreve).
  unreadable: {
    title: 'Deck: file unreadable',
    // n = quantos decks o backup tinha, já formatado (S.Num)
    backup: {
      one: 'deck.json could not be read, so the last backup was loaded ({{n}} deck). The file is not overwritten — edits go to {{pending}}.',
      other: 'deck.json could not be read, so the last backup was loaded ({{n}} decks). The file is not overwritten — edits go to {{pending}}.',
    },
    noBackup: 'deck.json could not be read and there is no backup, so no deck shows on screen. The file was NOT overwritten — see the session log.',
  },

  // O porquê, numa linha sob o aviso da página. reason = o erro: a frase do motor (S.Reason) ou o texto
  // do .NET (o do JSON diz a linha e a coluna).
  detail: {
    read: 'The file could not be opened: {{reason}}',
    parse: 'The file is not valid JSON: {{reason}}',
    unknown: 'The reason is unknown.',
  },

  // O rótulo de um botão "TR3" sem rótulo próprio, sob o ícone, na janela do deck (DeckWindow): cabe em
  // ~50 DIP a 11 px, então curto. Os nomes de recurso ficam como são.
  command: {
    record: 'Record',
    stopAll: 'Stop all',
    clicker: 'Clicker',
    teclado: 'Keyboard',
    remaps: 'Key Remaps',
    automations: 'Automations',
    shortcuts: 'Shortcuts',
    show: 'Show TR3',
  },

  // The first button of a folder open in the deck's place (DeckWindow): it goes back to the pages. Short.
  back: 'Back',

  // The media and volume keys a Keys button sends, as the label under its icon (DeckWindow.LabelOf) and on the
  // Deck page (deck.keys.names cites these). Short: they fit a 64 DIP button.
  keyNames: {
    MediaPlayPause: 'Play/pause',
    MediaNextTrack: 'Next',
    MediaPrevTrack: 'Previous',
    MediaStop: 'Stop',
    VolumeUp: 'Volume +',
    VolumeDown: 'Volume −',
    VolumeMute: 'Mute',
  },

  // The deck's tip (DeckTip): over a button under the mouse, or for a moment after a press that could not do
  // what the button says. One short sentence. name = a macro's name as the user wrote it; combo = the keys
  // as the button has them ("Ctrl+Shift+K"); reason = the engine's sentence for the error (S.Reason).
  tip: {
    missing: 'The macro {{name}} does not exist.',
    clicker: 'TR3 is in Clicker mode: macros wait.',
    recording: 'TR3 is recording.',
    busy: '{{name}} is running.',
    running: 'A macro is running.',
    modal: 'A TR3 window is waiting for an answer.',
    unsaved: 'The open macro has unsaved changes.',
    couldNotStart: '{{name}} could not start.',
    openFailed: 'Could not open: {{reason}}',
    keysInvalid: 'These keys cannot be sent: {{combo}}',
  },
} as const;
