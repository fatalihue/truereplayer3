// As configurações da macro aberta (shell/inspector/macro/): o Inspector sem passo escolhido, com o
// gatilho, a janela-alvo, a automação e as informações. Cada seção aplica ao mudar, e o Ctrl+Z desfaz.
// O título do Inspector ("Macro settings") é inspector.frame.macroSettings. Os campos da janela-alvo
// (fields, TargetFields.tsx) também servem ao diálogo da janela-alvo de uma pasta
// (library.folderTarget). Em pt-BR, "a macro" no feminino; hotkey, hotstring e tag são coringas
// (glossário), também no feminino ("a hotkey", "a tag").
//
// Nas lacunas: name = o nome da macro; folder = o nome de uma pasta.
export default {
  // O gatilho (TriggerSection.tsx): a hotkey, o modo dela e a hotstring.
  trigger: {
    title: 'Trigger',                     // título da seção · nome, em maiúsculas pelo CSS
    hotkey: 'Hotkey',                     // rótulo do campo e nome da caixa que captura a tecla · coringa
    modeGroup: 'Trigger mode',            // nome do segmentado dos modos (leitor de tela)
    // As opções do segmentado do modo, duas por linha (143 px cada). As cinco que não são o padrão
    // têm o ícone na biblioteca, com os mesmos nomes (library.modes).
    modes: {
      onPress: 'On press',                // o padrão: dispara ao apertar
      onRelease: '{{>library.modes.onRelease}}',
      whilePressed: '{{>library.modes.whilePressed}}',
      toggle: '{{>library.modes.toggle}}',
      doubleTap: '{{>library.modes.doubleTap}}',
      hold: '{{>library.modes.hold}}',
    },
    // As dicas das opções acima (o padrão e o ao soltar não têm).
    modeTips: {
      whilePressed: 'Loops while held; stops on release',
      toggle: 'Press to start looping, press again to stop',
      doubleTap: 'Two quick taps; a single tap is ignored',
      hold: 'Fires once after ~0.6 s held; does not stop on release',
    },
    // A linha sob a hotkey, com o modo escolhido (o padrão e o ao soltar não têm).
    modeHelp: {
      whilePressed: 'Loops while held.',
      toggle: 'Loops until pressed again.',
      doubleTap: 'Single taps are ignored.',
      hold: 'Fires after ~0.6 s held; a tap does nothing.',
    },
    removeHotkey: 'Remove hotkey',        // nome do × ao lado da hotkey (leitor de tela) · verbo
    removeHotkeyTip: 'Remove the hotkey', // dica do mesmo ×
    // Aviso depois do ×, com Undo. hotkey = a combinação, "Ctrl+F5".
    removedHotkey: 'Removed hotkey {{hotkey}} from "{{name}}"',

    hotstring: 'Hotstring',               // rótulo do campo e nome dele (leitor de tela) · coringa
    hotstringPlaceholder: 'e.g. /id',     // o texto do campo vazio
    // A linha sob o campo: a regra (sem hotstring), o erro com um caractere só, ou quando roda.
    hotstringHelp: 'Type it anywhere to run the macro: letters, digits and - . / , ; =',
    minLength: 'Min 2 characters.',
    runsInstant: 'Runs as soon as it is typed.',     // com o Instant trigger ativado
    runsOnEnd: 'Runs after Enter, Space or Tab.',    // com ele desativado · as teclas são do glossário
    removeHotstring: 'Remove hotstring',
    removeHotstringTip: 'Remove the hotstring',
    // Aviso depois do ×, com Undo. hotstring = a sequência, "/id".
    removedHotstring: 'Removed hotstring "{{hotstring}}" from "{{name}}"',
    instant: 'Instant trigger',           // a chave da hotstring: o rótulo ao lado dela e o nome dela
    instantTip: 'Fires on the last character, with no Enter, Space or Tab',
  },

  // A janela-alvo (WindowTargetSection.tsx): o cartão, as chaves e a conversão das coordenadas.
  target: {
    title: 'Window target',               // título da seção
    // O cartão sem janela-alvo.
    none: 'None',                         // o nome no cartão · a janela-alvo (feminino em pt-BR)
    noneSub: 'Runs on whatever window is in front.',
    add: 'Add',                           // link do cartão: abre os campos · verbo; a janela-alvo é "definida"
    // O cartão com a janela-alvo: o processo e, embaixo, o título que a janela tem de ter.
    anyProcess: 'Any process',            // o nome no cartão de uma janela-alvo só com título
    anyTitle: 'any title',                // minúscula: a linha sob o nome
    titleContains: 'title contains “{{title}}”',  // title = o texto do campo Title
    titleMatches: 'title matches “{{title}}”',    // o mesmo, com o modo Regex
    fromFolder: 'from ‘{{folder}}’',      // depois de " · ", quando a janela-alvo vem da pasta
    // A janela-alvo que vem da pasta: a nota sobre os campos, o link que abre a da pasta e a dica das
    // chaves, que ficam desativadas.
    folderNote: "The folder ‘{{folder}}’ gives this target. A process or a title typed here makes one of this macro's own.",
    editFolder: "Edit the folder's",      // link depois da nota · verbo
    folderTip: "From the folder ‘{{folder}}’. Edit it there, or set a process or a title here for this macro's own.",
    // Por que a mudança não foi: o título não compila como regex, ou o processo e o título vazios.
    invalidRegex: 'The title is not a valid regular expression, so it stays {{>macroSettings.fields.contains}}.',
    needsTarget: 'A window target needs a process or a title.',
    needsTargetOwn: 'A window target needs a process or a title. To have none, remove it.',  // a da própria macro
    // As chaves: os mesmos nomes do diálogo da janela-alvo da pasta. As dicas falam de uma macro.
    focus: '{{>library.folderTarget.focus}}',
    focusTip: 'Brings the window to the front before the run. With it on, the hotkey works from any window.',
    relative: '{{>library.folderTarget.relative}}',
    relativeTip: 'The points of the steps follow the window when it moves',
    restorePosition: '{{>library.folderTarget.restorePosition}}',
    restorePositionTip: 'Puts the window back where it was captured, before the run',
    restoreSize: '{{>library.folderTarget.restoreSize}}',
    restoreSizeTip: 'Puts the window back to the captured size, before the run',
    update: '{{>library.folderTarget.update}}',  // botão · verbo
    updateTip: 'Reads where the window is now, and its size, for {{>macroSettings.target.restorePosition}} and {{>macroSettings.target.restoreSize}}',
    remove: 'Remove window target',       // link no fim dos campos · verbo
    // Aviso depois de Remove, com Undo. target = o processo ou o título da janela-alvo removida.
    removed: 'Removed window target ({{target}}) from "{{name}}"',
    // A oferta depois que Relative coordinates muda com passos que guardam pontos. count = esses
    // passos (sempre 1 ou mais); n = o mesmo número, formatado.
    convertToRelative: {
      one: '{{n}} step captured in absolute coords. Convert to relative so they follow this window when it moves.',
      other: '{{n}} steps captured in absolute coords. Convert to relative so they follow this window when it moves.',
    },
    convertToAbsolute: {
      one: '{{n}} step captured in relative coords. Convert to absolute so they keep their current screen positions.',
      other: '{{n}} steps captured in relative coords. Convert to absolute so they keep their current screen positions.',
    },
    convert: 'Convert',                   // botão principal da oferta · verbo
    skip: 'Skip',                         // o outro botão: deixa os passos como estão · verbo
    notWhileRunning: 'Not while a run is active',  // dica de Convert desativado
  },

  // Os campos de qual janela (TargetFields.tsx): os da macro, aqui, e os do diálogo da pasta.
  fields: {
    process: 'Process',                   // rótulo do campo e nome dele (leitor de tela)
    processPlaceholder: 'notepad.exe',    // exemplo no campo vazio: o nome do processo, igual nos dois idiomas
    clearProcess: 'Clear the process',    // o × do campo: nome e dica · verbo
    fillIn: 'Fill in a process, a title or both.',  // sob o campo, com os dois vazios
    title: 'Title',                       // rótulo do campo do título e nome dele
    titleMode: 'Title match mode',        // nome do segmentado (leitor de tela)
    contains: 'Contains',                 // opção do segmentado de 2 (143 px)
    regex: 'Regex',                       // a outra · glossário
    regexTip: '.NET regular expression',
    caseInsensitive: 'Case-insensitive.', // sob o campo do título
    badRegex: 'This does not look like a valid regular expression.',  // o mesmo lugar, em erro
    titlePlaceholder: 'Part of the window title',
    titleRegexPlaceholder: 'e.g. (Chrome|Firefox)',
    clearTitle: 'Clear the title',
    // Os dois botões em par (144 px cada).
    detect: 'Detect window',
    detecting: 'Click the target window…',  // o mesmo botão, esperando o clique
    detectTip: 'The next window you click fills the process and the title',
    detectingTip: 'Click the window to target. Click here or press Esc to cancel.',
    testTip: 'Checks the window in FRONT right now against these fields.',  // Test é common.actions.test
    testing: 'Testing…',
    // O resultado do Test. window = o processo e o título da janela da frente, "chrome.exe / Inbox".
    matches: 'Matches — {{window}}',
    noMatch: 'No match — {{window}}',
    matchesNothing: 'Matches — nothing in front',
    noMatchNothing: 'No match — nothing in front',
  },

  // A automação da macro (AutomationSection.tsx). Add e Edit são common.actions; o que dispara e o
  // estado vêm da página Automations.
  automation: {
    title: 'Automation',                  // título da seção
    none: 'None',                         // o nome no cartão sem automação · a automação (feminino em pt-BR)
    noneSub: 'Runs it by itself: every so often, at a time, or when something shows up.',  // uma linha, corta
    on: 'Automation on',                  // nome da chave que arma a automação (leitor de tela)
    disabledTip: 'The macro is disabled — enable it in the library first',  // dica da chave desativada
  },

  // As informações (InfoSection.tsx e IconPicker.tsx): o ícone, a descrição, as tags e o histórico.
  info: {
    title: 'Info',                        // título da seção
    icon: 'Icon',                         // rótulo
    chooseIcon: 'Choose icon',            // nome do botão do ícone e do painel dos emojis · verbo
    chooseIconTip: 'Choose an icon for the macro',
    clearIcon: 'Clear icon',              // nome do link que tira o ícone (o texto dele é common.actions.clear)
    searchEmoji: 'Search emoji…',         // o texto do campo de busca do painel dos emojis
    // Os títulos das categorias do painel dos emojis.
    emojiCategories: {
      suggested: 'Frequently Used',
      smileysPeople: 'Smileys & People',
      animalsNature: 'Animals & Nature',
      foodDrink: 'Food & Drink',
      travelPlaces: 'Travel & Places',
      activities: 'Activities',
      objects: 'Objects',
      symbols: 'Symbols',
      flags: 'Flags',
    },
    description: 'Description',           // rótulo do campo e nome dele (leitor de tela)
    descriptionPlaceholder: 'What does this macro do?',
    // Erro sob o campo: count = os caracteres a mais; n = o mesmo número, formatado.
    tooLong: { one: 'Too long by {{n}} — trim it to save it.', other: 'Too long by {{n}} — trim it to save it.' },
    tags: 'Tags',                         // rótulo · coringa
    // O histórico, só para ler: o link que abre e fecha, e os rótulos dos fatos.
    history: 'History',
    hideHistory: 'Hide history',
    created: 'Created',                   // ao lado da data · a macro (feminino em pt-BR)
    updated: 'Updated',
    version: 'Macro version',
    minAppVersion: 'Min app version',
    anyVersion: 'Any',                    // a versão mínima, quando qualquer uma serve
    requiredBy: 'Required by: {{list}}',  // list = o que fixa a versão mínima, como o motor diz, separado por vírgulas
  },

  // As tags da macro (TagEditor.tsx e tags.ts).
  tags: {
    add: 'Add a tag',                     // nome do campo (leitor de tela) · verbo
    addPlaceholder: 'Add a tag…',         // o texto do campo vazio
    remove: 'Remove tag {{tag}}',         // nome do × de cada tag (leitor de tela) · tag = a tag, sem o #
    suggestions: 'Tag suggestions',       // nome da lista de sugestões (leitor de tela)
    used: 'used {{n}}×',                  // ao lado de cada sugestão · minúscula; n = as macros que a usam, formatado
    rule: 'Press Enter or comma to add. Spaces and accents are converted.',  // sob o campo
    mostUsedGroup: 'Most used tags',      // nome do grupo das mais usadas (leitor de tela)
    mostUsed: 'Most used',                // o rótulo antes delas
    // Dica de cada uma das mais usadas: count = as macros que a usam; n = o mesmo número, formatado.
    usedBy: { one: 'Used by {{n}} macro', other: 'Used by {{n}} macros' },
    // Por que a tag não entrou: a linha sob o campo.
    reject: {
      invalid: 'Letters, numbers and - _ + . only.',
      duplicate: 'This macro already has that tag.',
      full: 'Ten tags is the maximum.',
    },
  },
} as const;
