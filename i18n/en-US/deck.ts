// A página Deck (branch deck, Fase 5; plano .claude/planos/deck-2026-11-19.md): os decks de botões que o
// motor desenha na tela. "Deck" é o nome do recurso (glossário); "deck", em minúscula, é cada painel. Os
// nomes de macro, de deck e de pasta vêm do usuário. key = um atalho já escrito como keycaps ("Ctrl+Alt+D").
export default {
  page: 'Deck',  // trilho e título da página · nome do recurso

  // A coluna dos decks (à esquerda, no molde da biblioteca).
  list: {
    title: 'Decks',
    general: 'Deck settings',
    new: 'New deck',
    newName: 'Deck',  // o nome de um deck novo; "Deck 2" o seguinte
    full: 'The Deck holds up to {{max}} decks',
    on: 'Decks on',
    none: 'No deck yet',
    foot: 'A deck stays on top of every window and never takes the focus from the app in front.',
    // Fase 7: the list's ⋯ — a deck from a .trdeck file, and the example deck ("Media and system").
    more: 'More',
    import: 'Import a deck…',
    example: 'Add the example deck',
    sub: {
      off: 'Off',
      summon: 'Summoned with {{key}}',
      summonNoKey: 'Summoned · no hotkey yet',
      fixedApps: 'With {{apps}} in front',
      fixedAlways: 'Always on screen',
    },
  },

  // Os nove lugares de um deck fixo na área de trabalho do monitor (a âncora).
  anchors: {
    'top-left': 'Top left',
    top: 'Top',
    'top-right': 'Top right',
    left: 'Left',
    center: 'Center',
    right: 'Right',
    'bottom-left': 'Bottom left',
    bottom: 'Bottom',
    'bottom-right': 'Bottom right',
  },

  warn: {
    backup: 'deck.json could not be read. This is the last good copy, and changes go to {{pending}} until you replace the file.',
    noBackup: 'deck.json could not be read, and there is no good copy. Changes go to {{pending}} until you replace the file.',
    replace: 'Replace the file',
  },

  empty: {
    title: 'No deck yet',
    text: 'A deck is a panel of buttons that stays on screen, or comes with a hotkey. Each button runs a macro, sends keys, types a text or opens a program.',
    create: 'Create a deck',
    example: 'Start with the example',   // Fase 7: the example deck, ready to use
  },

  // Fase 7: a deck to a .trdeck file and back, and the example deck. deck = a deck's name; file = the file's name;
  // n = a number, formatted.
  file: {
    exported: '{{deck}} exported to {{file}}.',
    // Pictures its buttons name that were no longer in the app's folder.
    exportedMissing: {
      one: '{{n}} picture was not found and stayed out.',
      other: '{{n}} pictures were not found and stayed out.',
    },
    imported: '{{deck}} imported.',
    importedMany: {
      one: '{{n}} deck imported.',
      other: '{{n}} decks imported.',
    },
    hotkeyDropped: 'The hotkey of {{deck}} was already in use here, so it came without one.',
    hotkeyBare: 'The hotkey of {{deck}} had no Ctrl, Alt or Win, so it came without one.',   // Fase 8
    missingMacros: {
      one: '{{n}} macro the buttons run is not in this library.',
      other: '{{n}} macros the buttons run are not in this library.',
    },
    full: 'The Deck already holds {{max}} decks.',
    // Fase 8: room for some of the file's decks only (the first ones come in). total = the file's decks.
    room: {
      one: 'Only the first of the {{total}} decks comes in: the Deck holds {{max}}.',
      other: 'Only the first {{n}} of the {{total}} decks come in: the Deck holds {{max}}.',
    },
    exampleAdded: '{{deck}} added: media keys, volume and a few Windows shortcuts.',
    // The warning before an import whose buttons open things or type texts (the security warning's idea).
    title: 'Import a deck',
    // Beside the file's name: what it holds.
    decks: {
      one: '{{n}} deck',
      other: '{{n}} decks',
    },
    buttons: {
      one: '{{n}} button',
      other: '{{n}} buttons',
    },
    intro: 'Some buttons in this file do more than press keys. Check what they do before importing: a click on one of them does it.',
    opens: 'These buttons open:',
    texts: 'These buttons type or paste:',
    more: {
      one: 'and {{n}} more',
      other: 'and {{n}} more',
    },
    missing: 'Not in this library, so their buttons will show a warning: {{names}}.',
    // Fase 8: the hotkeys the decks bring (list = "Ctrl+Alt+D for Geral and …").
    hotkeys: 'Hotkeys that come with it: {{list}}.',
    hotkeyOf: '{{key}} for {{deck}}',
    confirm: 'Import',
  },

  head: {
    fixed: 'Fixed',
    summon: 'Summoned',
    show: 'Show',
    showLabel: 'Show {{deck}}',
    more: 'More deck actions',
    settings: 'This deck\'s settings',
    renameLabel: 'Name of the deck',
    copyName: '{{deck}} copy',
    deleted: '{{deck}} deleted',
    duplicated: '{{deck}} is a copy, off until you turn it on.',
    // Fase 6: the deck edited in its own place on screen (its corner, its buttons dragged, its menu). Pressed,
    // the button ends it; Done on the deck and Esc end it too.
    edit: 'Edit on screen',
    editTip: 'Move it, change its grid and drag its buttons on the deck itself. Esc ends.',
    editing: 'Done editing',
    export: 'Export…',                       // Fase 7: the deck and its pictures in a .trdeck file
    sub: {
      fixedAlways: '{{place}} · always on screen',
      fixedApps: '{{place}} · with {{apps}} in front',
      summonCursor: '{{key}} brings it at the mouse',
      summonCenter: '{{key}} brings it to the middle of the screen',
      summonNoKey: 'Give it a hotkey to bring it',
    },
  },

  // A barra: as páginas do deck, ou a pasta aberta.
  bar: {
    pagesLabel: 'Pages',
    page: 'Page {{n}}',
    addPage: 'Add a page',
    pagesFull: 'A deck holds up to {{max}} pages',
    pageMenu: 'Page actions',
    moveLeft: 'Move left',
    moveRight: 'Move right',
    deletePage: 'Delete page',
    lastPage: 'A deck keeps at least one page',
    pageDeleted: 'Page {{n}} deleted',
    pages: 'Pages',
    folderName: 'Folder name',
    folderMenu: 'Folder actions',
    deleteFolder: 'Delete folder',
    folderDeleted: 'Folder {{name}} deleted',
    count: { zero: 'No buttons', one: '{{count}} button', other: '{{count}} buttons' },
    hidden: { one: '{{count}} button past the grid', other: '{{count}} buttons past the grid' },
    bringBack: 'Bring back',
    noRoom: 'The grid has no free place for every button. Make it bigger to see them all.',
  },

  // O deck desenhado como na tela.
  board: {
    label: '{{deck}}, page {{n}}',
    labelFolder: '{{deck}}, folder {{folder}}',
    tile: '{{label}}, place {{n}}',
    tileNoLabel: 'Button in place {{n}}',
    // Fase 8: what the face shows of the button's state, read after its name. name = the line above.
    withState: '{{name}}, {{state}}',
    stateMissing: 'its macro does not exist',
    stateRunning: 'running',
    stateRecording: 'recording',
    stateOn: 'on',
    stateOff: 'off',
    empty: 'Empty place {{n}}',
    emptyTip: 'Add a button',
    back: '{{>engine-deck.back}}',
    backTip: 'Goes back to the pages',
    dropHint: 'Drop on a place or on a page',
  },

  notes: {
    off: 'The Deck is off: no deck shows on screen.',
    turnOn: 'Turn it on',
    paused: 'Shortcuts are off: the deck hotkeys wait until they are back on.',
    fixed: 'On screen, drag the deck by its header to move it. A click on a button never takes the focus from the app in front.',
    summon: '{{key}} brings the deck: 1 to 9 and 0 pick a button, the arrows and Enter too, and Esc closes it.',
    summonNoKey: 'A summoned deck comes only with its hotkey: give it one in this deck\'s settings.',
    edit: 'Changes show on the deck on screen at once. Drag a button to another place, or Alt+arrows.',
  },

  // O rótulo de um botão TR3 sem rótulo próprio: o mesmo da janela do deck.
  commandShort: {
    record: '{{>engine-deck.command.record}}',
    stopAll: '{{>engine-deck.command.stopAll}}',
    clicker: '{{>engine-deck.command.clicker}}',
    teclado: '{{>engine-deck.command.teclado}}',
    remaps: '{{>engine-deck.command.remaps}}',
    automations: '{{>engine-deck.command.automations}}',
    shortcuts: '{{>engine-deck.command.shortcuts}}',
    show: '{{>engine-deck.command.show}}',
  },

  // O que um botão faz: os tipos, e uma palavra de cada.
  kinds: {
    macro: 'Macro',
    keys: 'Keys',
    text: 'Text',
    open: 'Open',
    folder: 'Folder',
    tr3: 'TR3',
  },
  kindHints: {
    macro: 'runs a macro',
    keys: 'presses keys',
    text: 'types a text',
    open: 'a program, a file, a site',
    folder: 'more buttons',
    tr3: 'a TR3 switch',
  },

  // O painel do botão.
  panel: {
    label: 'Button {{label}}',
    thisButton: 'this button',
    untitled: 'Button',
    close: 'Close',
    menu: 'Button actions',
    moveTo: 'Move to',
    delete: 'Delete button',
    deleted: '{{label}} deleted',
    deletedUnnamed: 'Button deleted',   // a button with no label of its own nor a default one
    noRoom: 'This grid has no free place for a copy.',
    pageFull: 'Page {{n}} has no free place.',
    wherePage: '{{deck}} · page {{page}} · place {{n}}',
    whereFolder: '{{deck}} · {{folder}} · place {{n}}',
    does: 'What it does',
    newTitle: 'New button',
    newQuestion: 'What will this button do?',
    foot: 'Changes show on the deck on screen at once.',
  },

  macro: {
    label: 'Macro',
    swap: 'Change',
    openEditor: 'Open in the editor',
    recordNew: 'Record a new one',
    recordBusy: 'Not while TR3 records, plays or is in Clicker mode.',
    newName: '{{deck}} {{n}}',  // a macro gravada para um botão: "Geral 3"
    folder: 'In {{folder}}',
    steps: { zero: 'No steps', one: '{{count}} step', other: '{{count}} steps' },
    hotkey: 'Hotkey {{hotkey}}',
    missing: 'The macro {{name}} does not exist. The button comes back by itself when a macro with this name is in the library.',
    // O que um aperto faz com outra macro rodando (a configuração geral).
    busy: {
      swap: 'Pressed while its macro runs, it stops it. With another macro running, that one stops and this one starts.',
      stop: 'Pressed while its macro runs, it stops it. With another macro running, that one stops.',
      ignore: 'Pressed while its macro runs, it stops it. With another macro running, nothing happens.',
    },
  },

  keys: {
    label: 'Keys it presses',
    press: 'Click, then press the keys',
    change: 'Click to change',
    listening: 'Press the keys…',
    held: '{{key}}+… — or click again for {{key}} alone',
    special: 'Special keys',
    media: 'Media',
    volume: 'Volume',
    extra: 'F13 to F24',
    // The names the deck on screen writes under the icon (engine-deck.keyNames).
    names: {
      MediaPlayPause: '{{>engine-deck.keyNames.MediaPlayPause}}',
      MediaNextTrack: '{{>engine-deck.keyNames.MediaNextTrack}}',
      MediaPrevTrack: '{{>engine-deck.keyNames.MediaPrevTrack}}',
      MediaStop: '{{>engine-deck.keyNames.MediaStop}}',
      VolumeUp: '{{>engine-deck.keyNames.VolumeUp}}',
      VolumeDown: '{{>engine-deck.keyNames.VolumeDown}}',
      VolumeMute: '{{>engine-deck.keyNames.VolumeMute}}',
    },
    hint: 'The keys go to the app in front, as if pressed there.',
  },

  text: {
    label: 'Text',
    placeholder: 'What the button writes',
    how: 'How it goes',
    type: 'Type',
    paste: 'Paste',
    typeHint: 'Typed letter by letter, as a game reads it. Enter and Tab are keys.',
    pasteHint: 'Pasted at once; the clipboard gets back what it had.',
  },

  open: {
    label: 'What it opens',
    placeholder: 'C:\\…\\app.exe, a folder or https://…',
    browse: 'Browse…',
    browseTip: 'Choose a program',
    args: 'Arguments',
    argsPlaceholder: 'Optional',
    focus: 'Bring it to the front if it is already open',
    hint: 'A program, a file, a folder or an address, as Windows opens them (Win+R).',
  },

  folder: {
    label: 'Folder',
    newName: 'Folder',  // uma pasta nova; "Folder 2" a seguinte
    unnamed: 'Folder',
    new: 'New folder',
    open: 'Open the folder',
    count: { zero: 'empty', one: '{{count}} button', other: '{{count}} buttons' },
    inside: 'A folder does not open another folder.',
    hint: 'A folder opens in the deck\'s place, with Back as its first button.',
  },

  tr3: {
    label: 'Command',
    commands: {
      record: 'Record or stop',
      stopAll: 'Stop all',
      clicker: 'Clicker mode',
      teclado: 'Keyboard on or off',
      remaps: 'Key Remaps on or off',
      automations: 'Automations on or off',
      shortcuts: 'Shortcuts on or off',
      show: 'Show TR3',
    },
    hints: {
      record: 'Starts recording into the open macro, or stops it, as the record hotkey.',
      stopAll: 'Stops what runs: the macro, the recording, the Keyboard\'s macros and the text being typed.',
      clicker: 'Turns the Clicker mode on or off.',
      teclado: 'Turns the Keyboard on or off.',
      remaps: 'Turns the Key Remaps on or off.',
      automations: 'Turns the automations on or off.',
      shortcuts: 'Turns the Shortcuts on or off: the hotkeys of the macros and of the decks.',
      show: 'Brings the TR3 window to the front.',
    },
  },

  look: {
    label: 'Look',
    text: 'Label',
    textPlaceholder: 'No label',
    icon: 'Icon',
    chooseIcon: 'Choose an icon',
    iconDefault: 'The action\'s icon',
    macroEmoji: 'The macro\'s emoji',   // a macro button with no icon of its own shows its macro's emoji
    lucide: 'Icon from the list',
    emoji: 'Emoji',
    image: 'Picture',                        // a program's icon, a picture file or a cut of the screen
    useDefault: 'Use the default',
    color: 'Color',
    noColor: 'No color',
    colorEmoji: 'With an emoji, the color does not show.',
  },

  icons: {
    icons: 'Icons',
    emoji: 'Emoji',
    // Fase 6, the picker's third tab: a picture the engine keeps a copy of (Deck\images). "…" opens a dialog.
    picture: 'Picture',
    fromApp: 'From a program…',
    fromFile: 'Picture file…',
    fromScreen: 'Cut from the screen',
    pictureHint: 'TR3 keeps a copy, so the button keeps its picture if the file moves.',
    groups: {
      media: 'Media',
      system: 'System',
      files: 'Files and apps',
      games: 'Games',
      arrows: 'Arrows',
      edit: 'Text and marks',
    },
  },

  // As configurações do deck escolhido (o painel sem botão escolhido).
  settings: {
    label: 'Settings of {{deck}}',
    sub: 'This deck\'s settings',
    mode: 'Mode',
    fixedHint: 'Stays on screen. A hotkey can show and hide it.',
    summonHint: 'Out of sight until its hotkey brings it; it goes after a pick.',
    hotkey: 'Hotkey',
    hotkeyToggle: 'Show and hide hotkey',
    hotkeySummon: 'Hotkey that brings it',
    toggleHint: 'Optional. The hotkey of every deck is in the Deck settings (the gear).',
    summonNeedsKey: 'A summoned deck needs a hotkey: without one it never shows.',
    summonGroup: 'When it comes',
    at: 'Where it comes',
    atCursor: 'At the mouse',
    atCenter: 'Middle of the screen',
    hold: 'Hold the hotkey',
    holdHint: 'Shows while the hotkey is held; letting go over a button presses it.',
    keysOnly: 'Keys only',
    keysOnlyHint: 'The mouse goes through the deck, for games that read the mouse: pick with 1 to 9, 0, the arrows and Enter.',
    closeAfter: 'Close after a pick',
    closeAfterHint: 'Off, the deck stays until Esc, the hotkey or a click away.',
    when: 'When it shows',
    always: 'Always',
    apps: 'With these apps',
    appsNone: 'Add the program of an app: the deck shows only with it in front.',
    addApp: 'Add an app',
    removeApp: 'Remove {{exe}}',
    appFilter: 'Filter by name or title',
    appLoading: 'Reading the open programs…',
    appNone: 'No open program with that name',
    appTyped: 'Or type the .exe',
    appTypedPlaceholder: 'app.exe',
    grid: 'Grid',
    cols: 'Columns',
    rows: 'Rows',
    size: 'Button size',
    sizes: { s: 'Small', m: 'Medium', l: 'Large' },
    gridHint: 'A smaller grid keeps the buttons past it, out of sight, until it grows back.',
    look: 'Look',
    icon: 'The deck\'s icon',
    header: 'Header',
    headerHint: 'The name and the page dots. Without it, a 1 × 1 deck is a lone button.',
    opacity: 'Away from the mouse',
    opacities: { o100: '100%', o85: '85%', o70: '70%', o50: '50%', o0: 'Invisible' },
    collapse: 'Fold into a pill',
    collapseHint: 'Away from the mouse, the deck folds into its icon and name.',
    edgeHide: 'Hide at the edge',
    edgeHideHint: 'Against a screen edge, the deck slides out and comes back when the mouse gets there.',
    locked: 'Lock the place',
    lockedHint: 'The header stops moving the deck.',
    place: 'Place on the screen',
    placeReset: 'Back to the corner',
    placeHint: 'Or drag the deck on screen by its header.',
  },

  // As configurações do Deck (a engrenagem).
  general: {
    label: 'Deck settings',
    sub: 'For every deck',
    onHint: 'Off, no deck shows and no deck hotkey works.',
    toggleAll: 'Show and hide every deck',
    toggleAllHint: 'Hides the fixed decks for now, and brings them back.',
    busy: 'A macro button with another macro running',
    busyOptions: { swap: 'Swap', stop: 'Stop', ignore: 'Ignore' },   // ignore: nothing runs (the tip of the press says so)
    captures: 'Show in screen captures',
    capturesOff: 'Off: the decks stay out of screenshots, recordings and streams, and out of what Wait Image and Screen Text read.',
    capturesOn: 'On: the decks show in captures; while the app reads the screen, they move out of the way.',
    foot: 'These settings are for every deck.',
  },

  hotkey: {
    change: 'Change',
    listening: 'Listening…',
    press: 'Press the keys',
    none: 'None',
    changeLabel: 'Change the hotkey: {{label}}',
    listeningLabel: 'Listening for the hotkey: {{label}}',
    clear: 'Remove the hotkey',
    clearLabel: 'Remove the hotkey: {{label}}',
    mouse: 'A deck hotkey is a key of the keyboard.',
    // what = whose it is, a noun phrase: the app's (remaps.hotkeys: "the Record hotkey", 'macro "Farm"') or a deck's.
    taken: '{{key}} is already in use: {{what}}.',
    takenDeck: 'the hotkey of the deck {{deck}}',
    takenAll: 'the hotkey of every deck',
    takenClickerStart: 'the Clicker\'s start hotkey',
    takenClickerPause: 'the Clicker\'s pause hotkey',
    bare: 'Without Ctrl, Alt or Win, {{key}} stops reaching every other app while the Deck is on.',
  },

  // A seção "Deck" nas configurações da macro.
  section: {
    title: 'Deck',
    none: 'No deck button runs this macro',
    noneSub: 'Add one on the Deck page',
    use: '{{deck}} · {{where}}',
    page: 'page {{n}}',
    folder: 'folder {{folder}}',
    sub: 'Place {{n}}',
    subLabel: '{{label}} · place {{n}}',
    // Fase 6: a button for this macro on a deck, at its first free place (the first page with room).
    add: 'Add to a deck',
    newDeck: 'New deck',
    full: 'No free place on this deck',
    added: 'Added to {{deck}}, page {{n}}.',
  },
} as const;
