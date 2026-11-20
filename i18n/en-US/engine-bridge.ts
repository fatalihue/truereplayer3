// O motor: os textos da ponte entre o motor e a página (Source/WebViewBridge.cs). Por canal: os
// avisos (alert, os toasts que o motor manda por alert:show, também os guardados até a janela
// aparecer), os campos de resultado que a página mostra como vêm (result), a barra da captura na tela
// (capture), os diálogos nativos (dialog), as notificações do Windows (notify), os nomes padrão que o
// motor grava (name) e a atualização (update). Todo aviso sai com o tipo (success, info ou error).
// - O inglês é o de antes, letra por letra (os roteiros da bateria comparam várias destas frases);
//   onde ele tinha "(s)" ou um ternário, um plural com as duas formas iguais ao texto de antes.
// - reason = o porquê de uma falha, já pronto (S.Reason: a frase do motor para os casos comuns, ou o
//   texto do .NET ou do Windows); n, ms… = números já escritos no idioma (S.Num); name = o nome de
//   uma macro; holder/what = o nome, para a pessoa, de algo aberto (InteractionScope.Describe).
// - O "Copy diagnostics" (material de suporte) e os logs ficam em inglês, fora do catálogo.
export default {
  alert: {
    // Soltar um arquivo na tela do primeiro uso. "Import…" é o botão da página (common.actions.importEllipsis).
    droppedUnreadable: 'Couldn\'t read the dropped file. Use Import… instead.',

    automation: {
      saveFailed: 'Could not save automation: {{reason}}',
      armFailed: 'Could not arm automation: {{reason}}',     // a chave de ligar a automação, nos dois sentidos
      // O porquê, que vem depois dos dois-pontos de saveFailed e armFailed (por isso em minúscula).
      unreadable: '"{{name}}" could not be read from disk.',
      fileGone: 'the file of "{{name}}" is no longer in the Profiles folder.',  // Profiles = a pasta, não se traduz
    },

    // Uma captura na tela (ou um seletor de arquivo) que não abriu porque outra coisa segura o lugar e
    // não respondeu. what = o que ia abrir (capture.what); holder = o que está aberto, dito para a pessoa
    // (InteractionScope.Describe: em pt-BR, sempre um nome feminino com o artigo, "a captura…").
    captureStuck: 'Couldn\'t start {{what}}: {{holder}} is still open and didn\'t respond. Press Esc or right-click on it, then try again.',

    image: {
      captureSaveFailed: 'Couldn\'t save the captured image: {{reason}}',
      cropOpenFailed: 'Could not open the reference image to crop it.',
      cropSaveFailed: 'Could not save the cropped image: {{reason}}',
    },

    undoFailed: 'Could not undo: {{reason}}',

    // As formas de um clique: combinado (uma linha) e pareado (Down + Up). n = passos ou pares.
    convert: {
      nothing: 'Nothing to convert',
      // Junto com o Save do editor: os campos foram, a forma não. why = o porquê do conversor
      // (engine-capture.convert, como a recusa do par).
      fieldsSaved: 'Fields saved, but the form was not changed — {{why}}',
      fieldsSavedNothing: 'Fields saved, but the form was not changed — nothing to convert',
      // A macro inteira (Ctrl+K). n = os passos que ela tem agora.
      combinedAll: { one: 'Converted to combined — {{n}} actions', other: 'Converted to combined — {{n}} actions' },
      pairedAll: { one: 'Converted to paired — {{n}} actions', other: 'Converted to paired — {{n}} actions' },
      // Os passos escolhidos no menu do passo.
      mergedOne: 'Merged into one row',
      merged: 'Merged {{n}} pairs',          // n ≥ 2
      splitOne: 'Split into Down + Up',
      split: 'Split {{n}} rows into Down + Up',  // n ≥ 2
      // O que vem depois da frase acima (done), quando parte do pedido ficou de fora. why = o porquê.
      leftSelections: { one: '{{done}} — 1 selection left as-is. {{why}}', other: '{{done}} — {{n}} selections left as-is. {{why}}' },
      leftRows: { one: '{{done}} — 1 row left as-is. {{why}}', other: '{{done}} — {{n}} rows left as-is. {{why}}' },
      // O tempo com o botão apertado que um clique em uma linha não guarda (abaixo de 200 ms). ms = a soma.
      dwellOne: '{{done}} — the {{ms}} ms the button stayed down was dropped. A merged click only carries a hold from 200 ms up; Ctrl+Z restores the two rows.',
      dwellMany: '{{done}} — {{ms}} ms of button-down time was dropped in total. A merged click only carries a hold from 200 ms up; Ctrl+Z restores the original rows.',
    },

    // No começo de uma execução com passos de navegador e a extensão desligada. n = esses passos.
    browserMissing: {
      one: 'Chrome extension not connected — 1 browser row will not work. Browser conditions read as "not found", so the macro can take the wrong branch without erroring.',
      other: 'Chrome extension not connected — {{n}} browser rows will not work. Browser conditions read as "not found", so the macro can take the wrong branch without erroring.',
    },

    saveFailed: 'Could not save "{{name}}": {{reason}}',     // salvar a macro aberta (também o salvar enquanto edita)

    targetNotOpen: 'Target window not open: {{label}}',      // Replay sem a janela-alvo aberta · label = o processo ou o título

    diagnosticsCopied: 'Diagnostics copied to the clipboard',
    diagnosticsFailed: 'Could not copy diagnostics',

    // Copiar e colar passos dentro do app.
    copy: {
      clipboardFailed: 'Could not copy the actions to the clipboard. Try again.',
      copied: { one: 'Copied {{n}} action(s)', other: 'Copied {{n}} action(s)' },
      none: 'No actions copied',                             // Colar sem nada copiado
      pasted: { one: 'Pasted {{n}} action(s)', other: 'Pasted {{n}} action(s)' },
    },

    // A edição de um passo, recusada.
    edit: {
      rowChanged: 'Not saved: that row changed while it was being edited (the list or the macro changed underneath).',
      invalidDelay: '"{{value}}" is not a valid delay. Use a whole number. Nothing was changed.',
      invalidCoord: '"{{value}}" is not a valid {{axis}}. Use a whole number. Nothing was changed.',  // axis = X ou Y
      negativeDelay: 'A delay can\'t be negative ({{value}} ms). Use 0 or more. Nothing was changed.',
      pointNotWhole: 'That point is not a whole number the screen can use — enter X and Y as integers.',
      atCursorSplit: 'An at-cursor click can\'t be split — the halves read a stored point.',  // "At cursor" do editor do clique
    },

    // O editor em lote (vários passos): Set e Add são as opções dele (inspector.batch.set/add).
    // ms = o delay digitado; value = o número de X ou Y, como digitado; axis = X ou Y; n = os passos.
    bulk: {
      none: '(none)',                        // no lugar do número, quando a mensagem não trouxe nenhum
      delayNoMode: 'The delay was not changed: the edit did not say whether to Set or Add.',
      delayInvalid: '{{value}} is not a valid delay. Use a whole number of milliseconds.',
      delayNegative: 'A delay can\'t be negative ({{ms}} ms). Use 0 or more, or Add to subtract. Nothing was changed.',
      delayNone: 'The selected rows have no delay to change (block markers carry none).',
      delayOverflow: 'Adding {{ms}} ms would push some of the selected rows past the longest possible delay. Nothing was changed.',
      delaySame: 'Nothing changed: the delay is already {{ms}} ms on the selected actions.',
      delayAddZero: 'Nothing changed: adding 0 ms leaves the delay where it was.',
      delayAtZero: 'Nothing changed: the selected actions are already at 0 ms.',
      delayAdded: { one: 'Added {{ms}} ms to the delay on {{n}} action(s)', other: 'Added {{ms}} ms to the delay on {{n}} action(s)' },
      // Depois de delayAdded (done), quando um Add negativo parou em 0. n = os passos que pararam.
      delayFloored: { one: '{{done}} — {{n}} stopped at 0 ms', other: '{{done}} — {{n}} stopped at 0 ms' },
      delaySet: { one: 'Set delay to {{ms}} ms on {{n}} action(s)', other: 'Set delay to {{ms}} ms on {{n}} action(s)' },
      coordNoMode: '{{axis}} was not changed: the edit did not say whether to Set or Add.',
      coordInvalid: '{{value}} is not a valid {{axis}} value. Use a whole number.',
      coordNoClicks: 'X/Y can only be set on mouse click actions.',
      coordOverflow: 'Adding {{value}} to {{axis}} would push some of the selected rows past the largest possible coordinate. Nothing was changed.',
      coordAddZero: 'Nothing changed: adding 0 leaves {{axis}} where it was.',
      coordSame: 'Nothing changed: {{axis}} is already {{value}} on the selected clicks.',
      coordAdded: { one: 'Added {{value}} to {{axis}} on {{n}} action(s)', other: 'Added {{value}} to {{axis}} on {{n}} action(s)' },
      coordSet: { one: 'Set {{axis}} to {{value}} on {{n}} action(s)', other: 'Set {{axis}} to {{value}} on {{n}} action(s)' },
    },

    // Os controles de execução do Data Loop e do modo Cycle do Set Variable.
    cycleReset: 'Cycle \'{{name}}\' reset to the first item',   // name = a variável · Cycle = o modo (editors.variable.cycle)
    nextRow: 'Next run starts at row {{row}}',                   // row = o número da linha, de 1
    rowReset: 'Data-loop row position reset to the first row',

    // A captura de uma imagem para um passo novo ou para a imagem de um passo.
    imageInsert: {
      conditionSaveFailed: 'Couldn\'t save the captured image, so no condition was inserted: {{reason}}',
      stepSaveFailed: 'Couldn\'t save the captured image, so no action was inserted: {{reason}}',
      recaptureSaveFailed: 'Couldn\'t save the recaptured image — the action still points at the old one: {{reason}}',
      fileUnusable: 'Couldn\'t use that file as the reference image: {{reason}}',  // Choose file… com um arquivo que não serve
      gone: 'That reference image isn\'t on disk any more. Capture it again.',
      savedAs: 'Saved {{file}}',                             // Save image… · file = o nome do arquivo gravado
      saveAsFailed: 'Couldn\'t save the image: {{reason}}',
      cropSaveFailed: 'Couldn\'t save the cropped image: {{reason}}',
    },

    // Ler o texto de uma região da tela: o passo novo e a hotkey "Copy text from the screen".
    screenText: {
      readFailed: 'Couldn\'t read the region: {{reason}}',
      // "Text color" é o campo do editor (probe.color).
      noneRead: 'No text read in that region — type it in the editor, or try Text color.',
      none: 'No text found in that region',
      clipboardBusy: 'Couldn\'t write to the clipboard — another app is holding it. Try again.',
      copiedLines: 'Copied {{n}} lines: "{{text}}"',         // n ≥ 2 · text = o começo do que foi lido
      copied: 'Copied: "{{text}}"',
      failed: 'Copy screen text failed: {{reason}}',
    },

    // Escolher um ponto com a janela-alvo fechada ou minimizada. label = o processo ou o título dela.
    target: {
      notOpenPick: 'Target window not open: {{label}}. Open it and pick again.',
      minimisedPick: 'Target window is minimised: {{label}}. Restore it and pick again.',
    },

    // Uma captura na tela pedida durante uma execução ou uma gravação: recusada, com o porquê (why).
    runRefuse: {
      replay: 'A replay is running — stop it first. {{why}}',
      recording: 'A recording is running — stop it first. {{why}}',
      picker: 'A full-screen picker would cover the run and swallow the Stop key.',  // o porquê de sempre
      detection: 'Window detection takes the next click you make, and the run is using the mouse.',
    },

    // A janela que as coordenadas de uma automação seguem ("Relative to a window", automations.condition.relative).
    anchor: {
      unnamedPoint: 'Name the anchor window first (process name or window title) — until then there is no origin to store the point against.',
      closedPoint: 'The anchor window is not open (or is minimised) — restore it and pick again, or turn off "Relative to a window".',
      unnamedRegion: 'Name the anchor window first (process name or window title) — until then there is no origin to store the region against.',
      closedRegion: 'The anchor window is not open (or is minimised) — restore it and set the region again, or turn off "Relative to a window".',
    },

    // Os presets do Clicker. max = o limite; name = o preset que o Undo ia trazer de volta.
    clickerPresetsFull: 'Clicker presets are limited to {{max}}. Delete one to save another.',
    clickerPresetsFullRestore: 'Clicker presets are limited to {{max}}. Delete one to restore "{{name}}".',

    // "Restart as administrator" (clicker.notices.restartAdmin): o pedido de permissão do Windows.
    admin: {
      cancelled: 'Restart as administrator was cancelled.',
      failed: 'Could not restart as administrator.',
    },

    // As macros da biblioteca: abrir, reverter, criar, renomear, duplicar, excluir. name = a macro.
    macro: {
      switchBusy: 'Stop the recording or replay before switching macros.',
      openGone: 'Could not open "{{name}}" — its file is no longer in the Profiles folder.',  // Profiles = a pasta
      openFailed: 'Could not open "{{name}}": {{reason}}',
      // "Revert" (library.revert): a macro volta a como estava quando foi aberta.
      revertBusy: 'Stop the recording or replay before reverting the macro.',
      revertNone: 'There is no open macro to revert.',
      revertUnreadable: 'its file could not be read back',   // o porquê, depois de revertFailed (minúscula)
      revertFailed: 'Could not revert "{{name}}": {{reason}}',
      invalidName: 'Invalid macro name.',
      nameTaken: 'A macro named "{{name}}" already exists',
      createFailed: 'Could not create macro: {{reason}}',
      updateFailed: 'Could not update "{{name}}": {{reason}}',  // ativar ou desativar a macro
      duplicateFailed: 'Could not duplicate "{{name}}": {{reason}}',
      // n = os passos Run Macro que chamavam a macro pelo nome antigo e agora chamam pelo novo.
      renamedRefs: { one: 'Renamed to \'{{name}}\' and updated {{n}} Run Macro reference.', other: 'Renamed to \'{{name}}\' and updated {{n}} Run Macro references.' },
      renameFailed: 'Could not rename "{{name}}": {{reason}}',
      imagesLeftBehind: 'Renamed to "{{name}}", but some reference images were in use and stayed under the old name. Its image steps may miss them until the next start, which moves them over.',
      // n = os passos Run Macro de outras macros que chamavam a excluída.
      deletedDangling: { one: 'Deleted \'{{name}}\'. {{n}} dangling reference in other macros will silently no-op at replay.', other: 'Deleted \'{{name}}\'. {{n}} dangling references in other macros will silently no-op at replay.' },
      deleteFailed: 'Could not delete "{{name}}": {{reason}}',
      // A macro de um pedido sumiu (renomeada ou excluída) antes de o pedido chegar, em geral um Undo.
      gone: '"{{name}}" no longer exists — it was renamed or deleted. Nothing was changed.',
    },

    // As hotkeys e as hotstrings. hotkey = a tecla, como a página a escreve; conflict = quem já a usa
    // (hotkey.by, abaixo).
    hotkey: {
      // Em pt-BR, quem usa (hotkey.by) começa sempre com um nome feminino sem artigo ("macro…",
      // "hotkey…"), e a frase traz o artigo junto da preposição: "pela", "com a".
      usedBy: '"{{hotkey}}" is already used by {{conflict}}.',
      hotstringUsedBy: 'Hotstring "{{sequence}}" is already used by {{conflict}}.',
      // Tirar a janela-alvo deixaria a hotkey valendo em todas as janelas, junto com outra.
      removeTargetHotkey: 'Cannot remove target: hotkey "{{hotkey}}" would conflict with {{conflict}}.',
      removeTargetHotstring: 'Cannot remove target: hotstring "{{sequence}}" would conflict with {{conflict}}.',
      removeFolderTargetHotkey: 'Cannot remove folder target: hotkey "{{hotkey}}" on "{{name}}" would conflict with {{conflict}}.',
      removeFolderTargetHotstring: 'Cannot remove folder target: hotstring "{{sequence}}" on "{{name}}" would conflict with {{conflict}}.',
      // Na abertura: uma hotkey do app que uma macro também usa. "Settings › Hotkeys" é o caminho da página.
      appVsMacro: '"{{hotkey}}" is used by {{conflict}}, so the macro "{{name}}" on the same keys won\'t fire. Change one of them (Settings › Hotkeys, or the macro\'s hotkey).',
      clickerSame: '"{{hotkey}}" is set as both Clicker Start and Clicker Pause.',
      saveFailed: 'Could not save the hotkey of "{{name}}": {{reason}}',
      removeFailed: 'Could not remove the hotkey of "{{name}}": {{reason}}',
      hotstringTooShort: 'Hotstring must be at least 2 characters (a-z, 0-9, - . / , ; =).',
      hotstringSaveFailed: 'Could not save the hotstring of "{{name}}": {{reason}}',
      hotstringRemoveFailed: 'Could not remove the hotstring of "{{name}}": {{reason}}',
      // Quem já usa a tecla: os rótulos de Settings › Hotkeys (settings.hotkeys.*.label) e da página do
      // Clicker. name = a macro; app = TrueReplayer 3.
      by: {
        macro: 'the macro "{{name}}"',
        record: '“{{>settings.hotkeys.record.label}}”',
        replay: '“Replay or stop”',
        shortcuts: '“Shortcuts on or off”',
        front: '“Bring {{app}} to the front”',
        clicker: '“Open the Clicker”',
        clip: '“Copy the selection to a clip slot”',
        screenText: '“Copy text from the screen”',
        clickerStart: 'the Clicker’s “Start and stop”',
        clickerPause: 'the Clicker’s “Pause”',
        // Deck (branch deck): a deck's hotkey (show and hide, or bring it), and the one for every deck.
        deck: 'the deck "{{deck}}"',
        deckAll: '“{{>deck.general.toggleAll}}”',
      },
    },

    // A janela-alvo de uma macro ou de uma pasta. label = o processo ou o título.
    window: {
      fillOne: 'Please specify at least a process name or window title.',
      regexInvalid: 'Invalid regex pattern.',
      regexInvalidCheck: 'Invalid regex pattern. Please check the syntax.',
      folderGone: 'The folder "{{name}}" no longer exists — it was renamed or deleted. Nothing was changed.',
      detectFailed: 'Could not start window detection — Windows refused the mouse hook. Type the process name or window title instead.',
      // O alvo e a conversão de uma vez (profile:setWindowTarget com convertDirection, o "Apply target &
      // convert" do diálogo de antes). Nenhuma tela do 3 manda isso hoje; o texto não cita o botão.
      convertNeedsTarget: 'Set a process name or window title before converting.',
      applyNotFound: 'Target window not found. Open it first, then convert again.',
      applyMinimised: 'Target window is minimised. Restore it, then convert again.',
      applyNoPosition: 'Could not read the target window\'s position. Try again.',
    },

    // Converter as coordenadas dos passos (Ctrl+K: palette.cmd.toRelative/toAbsolute). n = os passos.
    coords: {
      openFirst: 'Open "{{name}}" first — converting coordinates rewrites the actions of the macro that is currently loaded.',
      runningReplay: 'A replay is running — stop it first. Converting rewrites the coordinates of actions the run is still going to play.',
      runningRecording: 'A recording is running — stop it first. Converting now would leave this macro\'s actions in two coordinate spaces.',
      noTarget: 'Set a Window Target first (macro or folder).',
      notFound: 'Target window not found. Make sure it is open and visible.',
      minimised: 'Target window is minimised. Restore it and convert again.',
      noPosition: 'Could not get window position.',
      noActions: 'No actions to convert.',
      // name = a macro; folder = a pasta de quem ela herda a janela-alvo. Sai da paleta e do menu da lista;
      // o caminho cita os rótulos de Macro settings › Window target.
      inherited: '"{{name}}" inherits its window target from the folder "{{folder}}", so it inherits the coordinate space too — this conversion would be discarded at the next replay and leave the coordinates in the wrong space. Give this macro its own window target first: in {{>inspector.frame.macroSettings}} › {{>macroSettings.target.title}}, click {{>common.actions.edit}} and type a process or a title. Then convert again.',
      convertedRelative: { one: 'Converted {{n}} action(s) to relative coordinates.', other: 'Converted {{n}} action(s) to relative coordinates.' },
      convertedAbsolute: { one: 'Converted {{n}} action(s) to absolute coordinates.', other: 'Converted {{n}} action(s) to absolute coordinates.' },
    },

    // Ler o tamanho e a posição da janela-alvo ("Update window size & position", library.folderTarget.update).
    // w, h, x, y = os números da janela, em pixels.
    geometry: {
      inherited: '"{{name}}" inherits its window target from the folder "{{folder}}", so it inherits the geometry too. Capture it on the folder, or give this macro its own target first.',
      noTarget: 'Detect or set a Window Target first, then click Update.',
      minimised: 'Target window is minimised. Restore it to the size and position you want captured, then click Update again.',
      noSize: 'Could not get window dimensions.',
      folderCaptured: 'Folder geometry captured: {{w}}×{{h}} @ ({{x}}, {{y}})',
      windowCaptured: 'Window geometry captured: {{w}}×{{h}} @ ({{x}}, {{y}})',
    },

    // As pastas da biblioteca e o Explorer. name = a pasta ou a macro.
    folder: {
      taken: 'A folder named "{{name}}" already exists',
      profilesOpenFailed: 'Could not open the Profiles folder',   // Profiles = a pasta
      macroOpenFailed: 'Could not open the macro\'s folder',
      exportOpenFailed: 'Could not open the export folder',
      // O Delete All de uma pasta: arquivos que não puderam ser excluídos. names = as macros, com ", ".
      deleteFailedOne: 'Could not delete "{{name}}" — its file is read-only or in use. It stays in your list.',
      deleteFailedMany: 'Could not delete {{n}} macros — their files are read-only or in use: {{names}}. They stay in your list.',  // n ≥ 2
      // n = os passos Run Macro de outras macros que chamavam as excluídas.
      deletedDangling: {
        one: 'Deleted "{{name}}" and its macros. {{n}} Run Macro reference in other macros still point at them and will silently no-op at replay.',
        other: 'Deleted "{{name}}" and its macros. {{n}} Run Macro references in other macros still point at them and will silently no-op at replay.',
      },
      // Mover uma macro sem alvo próprio para outra pasta muda como o X/Y dela é lido.
      nowRelative: '"{{name}}" now reads its recorded X/Y relative to the folder\'s window. They were not converted — if its clicks land in the wrong place, load it and run "Convert coordinates to relative" (Ctrl+K).',
      nowAbsolute: '"{{name}}" now reads its recorded X/Y as screen positions. They were not converted — if its clicks land in the wrong place, load it and run "Convert coordinates to absolute" (Ctrl+K).',
    },

    export: {
      busy: 'Finish the current recording/replay before exporting.',
      noneLoaded: 'Export failed: none of the selected macros could be loaded.',
      failed: 'Export failed: {{reason}}',
    },

    // A importação de um arquivo .trprofile. n = macros.
    import: {
      busy: 'Finish the current recording/replay before importing.',
      tooLarge: 'That file is too large to import (over 50 MB).',
      parseError: 'That file isn\'t a valid TrueReplayer macro export.',
      noMacros: 'That export file contains no macros to import.',
      readError: 'Couldn\'t read that file: {{reason}}',
      failedGeneric: 'Import failed.',
      failed: 'Import failed: {{reason}}',
      expired: 'Import session expired — please try again.',
      // Nomes repetidos dentro do arquivo: as cópias ganham um número. "Farm (2)" é só um exemplo.
      duplicates: {
        one: 'This file lists {{n}} macro(s) under a name another macro in it already uses. The copies are shown with a number, e.g. "Farm (2)".',
        other: 'This file lists {{n}} macro(s) under a name another macro in it already uses. The copies are shown with a number, e.g. "Farm (2)".',
      },
      skippedInvalid: { one: 'Import skipped {{n}} macro(s) with invalid names.', other: 'Import skipped {{n}} macro(s) with invalid names.' },
      done: { one: 'Imported {{n}} macro(s).', other: 'Imported {{n}} macro(s).' },
      doneWithFolders: { one: 'Imported {{n}} macro(s). Folder organization imported.', other: 'Imported {{n}} macro(s). Folder organization imported.' },
      allSkipped: { one: 'All {{n}} macro(s) were skipped.', other: 'All {{n}} macro(s) were skipped.' },
      noneImported: 'No macros were imported.',
      // Teclado (branch teclado): the game the file carries, after its macros.
      tecladoAdded: '{{game}} was added to the Keyboard.',
      tecladoAddedOff: '{{game}} was added to the Keyboard turned off: another game already uses its .exe. Turn one or the other on with "Use".',
      tecladoFull: 'The game was not added: the Keyboard already has {{max}} games.',
    },

    settings: {
      resetBusy: 'Stop the recording or replay before resetting settings.',
      saveFailed: 'Couldn\'t save your settings to disk. They\'re kept for this session and will be retried on the next change and on exit.',
    },
  },

  result: {
    // O Run now de uma automação (a página mostra a frase como vem, AutomationsPage).
    testFire: {
      serviceNotReady: 'Automation service not ready.',
      disabled: 'Skipped: this macro is disabled, so its automation never runs. Enable it in the library first.',
      fired: 'Fired — the macro is running now.',
      busy: 'Skipped: a replay, recording or clicker run is already going. Automations wait for the engine to be free.',
      dirty: 'Skipped: the open macro has unsaved changes. Automations never fire over unsaved edits — save it first.',
      modal: 'Skipped: a dialog or key capture is open. Close it and try again.',
      notReady: 'Not ready: the app is still starting up.',
      nothingRan: 'Nothing ran. The macro may have no steps, or its Data Loop table may be empty while it loops over the data.',
      failed: 'Failed: {{reason}}',
    },

    // Os Test dos editores: imagem, texto da tela e cor de pixel (o erro sai sob o botão, como vem).
    probe: {
      testFailed: 'Test failed: {{reason}}',
      imageMissing: 'Reference image not found on disk.',
      pixelUnreadable: 'Couldn\'t sample pixel (off-screen or hardware-accelerated surface)',
      invalidColor: 'Invalid target colour',
      // A janela que as coordenadas da automação seguem ("Relative to a window").
      anchorUnnamed: 'Name the anchor window first (process name or window title) — until then there is no origin to test against.',
      anchorClosed: 'The anchor window is not open (or is minimised) — restore it and test again, or turn off "Relative to a window".',
      anchorUnnamedShort: 'Name the anchor window first (process name or window title).',
      anchorClosedShort: 'The anchor window is not open (or is minimised).',
    },

    // Os passos de navegador: a dica do Test action com a extensão desligada (a mensagem é a de
    // engine-browser.notConnected).
    browser: {
      notConnectedTip: 'Open Chrome with the TrueReplayer extension installed.',
    },

    // Os Test da janela: a janela-alvo, a condição Window open e o Activate Window. "Process name" e
    // "Title" são os campos (conditions.process.name, conditions.window.title).
    window: {
      fillOne: 'Fill at least one of Process name or Title to test.',
      regexInvalid: 'Invalid regex pattern.',
      noForeground: 'No foreground window detected.',
      fillFirst: 'Fill Process name or Title first.',
      noMatch: 'No window matches — open and position it first.',
      minimised: 'Window is minimised — restore it to the size and position you want captured.',
      noRect: 'Could not read the window rect.',
      // n = o número da janela que o passo procura (2 ou mais); Launch = a seção que abre um programa.
      notNth: 'Matching windows exist, but not #{{n}} — right now the action finds none (and runs its Launch path, if it has one).',
      // “Foreground window only” é a chave da condição (conditions.window.foreground).
      notForeground: 'A matching window exists, but it is not in the foreground — with “Foreground window only” the condition reads false until it is.',
    },

    // "Use this example" na galeria dos exemplos. name = o exemplo.
    examples: {
      busy: 'Finish the current recording/replay before copying an example.',
      missing: 'There is no example named "{{name}}".',
    },
  },

  capture: {
    // O que não pôde abrir, dentro de alert.captureStuck ("Couldn't start {{what}}: …").
    what: {
      image: 'the image capture',
      imageCondition: 'the image condition capture',
      pixelCondition: 'the pixel condition capture',
      screenText: 'the screen text capture',
      waitImage: 'the Wait Image capture',
      pixelColour: 'the pixel-colour capture',
      recapture: 'the recapture',
      position: 'the position pick',
      colour: 'the colour pick',
      region: 'the region picker',
      buttonIcon: 'the button icon capture',  // Deck: a button's icon cut from the screen
    },
    // O título da barra, em cima da captura: o que fazer · verbo no imperativo.
    title: {
      referenceImage: 'Capture the reference image',
      regionToRead: 'Draw the region to read',
      regionToCopy: 'Draw the region to copy',
      searchArea: 'Draw the search area',
      clickArea: 'Draw the click area',
      point: 'Pick the point',
      clickPoint: 'Pick the click point',
      color: 'Pick the color',
      aColor: 'Pick a color',                // só a cor, sem guardar o ponto
      buttonIcon: 'Cut out the button icon', // Deck: a picture of the screen becomes a button's icon
    },
    // A linha "para quem" da barra (encolhe quando falta largura). name = a macro da automação.
    for: {
      automation: 'for the {{name}} automation',
      // Os passos que o motor insere: n = o número do passo; name = o nome dele e condition = o da
      // condição, os da lista (glossário: Wait Image, Else If, Image found…).
      step: 'for step {{n}}, {{name}}',
      stepCondition: 'for step {{n}}, {{name}} · {{condition}}',
      copyHotkey: 'for the Copy text from the screen hotkey',  // o rótulo da hotkey (settings.hotkeys.screenText.label)
      copyText: 'for Copy text from the screen',
      clicker: 'for Clicker',
      deck: 'for a button of the deck {{name}}',  // name = o nome do deck (cada painel é "um deck", minúscula)
    },
    // A dica da barra, embaixo.
    hint: {
      automationWaits: 'Drag around what the automation waits for',
      stepWaits: 'Drag around what the step waits for',
      smallerFaster: 'Smaller regions read faster',
      insideOnly: 'The image is looked for only inside it',
      toClipboard: 'The text it reads goes to the clipboard',
      buttonIcon: 'Drag around the picture the button will show',
    },
  },

  // Os diálogos nativos (ContentDialog do WinUI) que a ponte abre.
  dialog: {
    cancel: 'Cancel',                        // botão · verbo
    // Excluir uma pasta com macros dentro. name = a pasta; n = as macros dela. Delete All apaga os
    // arquivos (File.Delete, sem Lixeira) e as imagens, como o Delete de uma macro.
    deleteFolder: {
      title: 'Delete Folder',
      body: {
        one: 'Folder "{{name}}" contains {{n}} macro.\nDelete only the folder or everything inside?\nWith “{{>engine-bridge.dialog.deleteFolder.deleteAll}}”, the macro\'s file and images are deleted. This can\'t be undone.',
        other: 'Folder "{{name}}" contains {{n}} macros.\nDelete only the folder or everything inside?\nWith “{{>engine-bridge.dialog.deleteFolder.deleteAll}}”, the macros\' files and images are deleted. This can\'t be undone.',
      },
      folderOnly: 'Folder Only',             // botão: só a pasta sai, as macros ficam
      deleteAll: 'Delete All',               // botão: a pasta e as macros dela
    },
    // O Reset do menu antigo (profile:reset): as configurações e os passos.
    resetSettings: {
      title: 'Reset Settings',
      body: 'This will reset all settings to their default values and clear all actions.',
      reset: 'Reset',                        // botão · verbo
    },
  },

  // As notificações do Windows (saem também com a janela escondida). name = a macro.
  notify: {
    // A tabela da Data Loop usada até o fim. n = as linhas dela.
    listDone: {
      titleMacro: '{{name}} used the whole list',
      title: 'The data list is done',
      body: { one: 'The only row is done. The next run starts over at row 1.', other: 'All {{n}} rows are done. The next run starts over at row 1.' },
      open: 'Open Data Loop',                // botão
    },
    // Uma execução que parou com erro, com o app atrás de outra janela. n = o passo que falhou.
    stopped: {
      titleMacroStep: '{{name}} stopped at step {{n}}',
      titleMacro: '{{name}} stopped',
      titleStep: 'The macro stopped at step {{n}}',
      title: 'The macro stopped',
      body: 'The run stopped with an error.', // quando o erro não traz texto
      openReport: 'Open run report',         // botão (compact.openReport)
      runAgain: 'Run again',                 // botão (compact.runAgain)
    },
  },

  // Os nomes que o motor dá: nascem no idioma da interface e depois são da pessoa (plano, §2.4).
  name: {
    // O nome sugerido pelo Save image… de uma imagem de referência. name = a macro.
    referenceImage: 'Reference image.png',
    macroReferenceImage: '{{name}} - reference image.png',
    // O Duplicate de uma macro (o nome do arquivo .json). name = a macro; n = 2, 3… O motor reconhece
    // as cópias nos dois idiomas (" - Copy", " - Cópia") ao procurar o próximo número livre.
    copy: '{{name}} - Copy',
    copyNumbered: '{{name}} - Copy ({{n}})',
  },

  // A atualização. reason = um dos porquês abaixo, que entra depois de "because" e de "Update postponed:".
  update: {
    reason: {
      recording: 'a recording is in progress',
      replaying: 'a replay is running',
      // what = o que está aberto, dito para a pessoa (InteractionScope.Describe: em pt-BR, sempre um nome
      // feminino com o artigo, para o "está aberta"): uma captura, um diálogo, um seletor de arquivo.
      open: '{{what}} is open',
      editor: 'an open editor has changes that haven\'t been applied',
      unsaved: 'the macro has unsaved changes',
      promptCancelled: 'the unsaved-changes prompt was cancelled',
    },
    postponed: 'Update postponed: {{reason}}',               // a mensagem de update:error (que também leva postponed: true)
    // O aviso. "Restart and update" é o link de Settings (settings.update.restart).
    postponedNotice: 'An update is ready but was not installed because {{reason}}. It will be offered again once the app is idle — or install it any time with Restart and update, at the foot of Settings.',
    checkFailed: 'Failed to check for updates',
    downloadFailed: 'Download failed',
    downloadFailedNotice: 'The update could not be downloaded. It will be retried on the next check.',
    failed: 'Update failed: {{reason}}',
    applyFailedNotice: 'The update could not be applied: {{reason}}. {{app}} is still running the current version.',  // app = TrueReplayer 3
  },
} as const;
