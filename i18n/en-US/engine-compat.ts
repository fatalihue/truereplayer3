// O motor: a validação e a compatibilidade das macros. Os nomes dos recursos que fixam a versão mínima
// do app que abre uma macro (Source/ProfileCompatibility.cs) e o conserto automático dos blocos If,
// While e For Each Row (Source/ConditionalBlockValidator.cs).
//
// Os recursos aparecem só no Info da macro, depois de "Required by:" (macroSettings.info.requiredBy),
// separados por vírgula: um nome curto cada, sem vírgula fora de parênteses (a barra separa as
// variantes). São os
// nomes que a página mostra: os passos, as condições e os tokens ficam em inglês (glossário), e as
// opções vêm das telas (Replay ▾, Macro settings, o Inspector, Automations). Os nomes que o roteiro
// e12-textos procura (Run Macro (macro chaining), Per-macro…, Macro sharing metadata) são o inglês de
// antes, letra por letra.
export default {
  // Um recurso por linha da tabela FeatureMatrix, na ordem dela.
  feature: {
    waitImage: 'Wait Image',
    relativeCoordinates: 'Relative coordinates',                       // a chave da janela-alvo (library.folderTarget.relative)
    triggerWhilePressedToggle: 'Trigger mode While pressed/Toggle',    // dois modos da hotkey (macroSettings.trigger, library.modes)
    triggerDoubleTapHold: 'Trigger mode Double-tap/Hold',              // os outros dois
    mouseButtonHotkey: 'Mouse-button hotkey',                          // uma hotkey num botão lateral do mouse
    waitPixelColor: 'Wait Pixel Color',
    conditionalBlocks: 'Conditional logic (If/Else/End If)',           // os blocos If
    conditionTimeout: 'If condition poll timeout',                     // o timeout de uma condição: esperar até ela passar
    // As condições do If (e do Else If, do While e do Assert), pelo nome que o Check mostra.
    conditionRandom: 'If Random condition',
    conditionVariable: 'If Variable condition',
    conditionProcess: 'If Process running condition',
    conditionFile: 'If File exists condition',
    conditionTime: 'If Time condition',
    conditionWindow: 'If Window open condition',
    conditionClipboard: 'If Clipboard condition',
    conditionBrowser: 'If Browser element condition',
    dataTable: 'Data Loop table',
    dataSkipOnError: 'Data Loop skip on error',                         // "If a row fails: Skip the row" (dataLoop)
    dataCellModifiers: 'Data Loop cell modifiers',                     // {row:Coluna:trim}…
    clipboardHistoryToken: 'Clipboard history token',                  // {winclip}
    nextRowToken: 'Sequential data-row token',                         // {rownext:Coluna}
    nextClipboardToken: 'Sequential clipboard token',                  // {clipboard:next}
    referenceArgument: 'Reference modifier argument',                  // um argumento que lê uma variável: {clipboard:line:@i}
    listModifiers: 'Clipboard list modifiers',                         // range, lines, sort, dedupe, reverse, join
    sliceModifiers: 'Text-slice modifiers',                            // words, after, before…
    colonDelimiter: 'Colon in split delimiter',                        // o "::" dentro de after/before
    dropCountModifier: 'Drop count modifier',                          // dropnum: tira o número do começo
    filterModifiers: 'Accent/digit filter modifiers',                  // noaccents e digits
    pickToken: 'Random choice token',                                  // {pick:a|b|c}
    inputToken: 'Ask-Input token',                                     // {input:Pergunta}: a execução pausa e pede um valor
    clipSlotToken: 'Clipboard slot token',                             // {clip:N}
    randomToken: 'Random number token',                                // {random:1-6}
    runStateTokens: 'Run-state tokens',                                // {var:nome}, {counter}, {row}
    stop: 'Stop action',                                               // o passo Stop
    returnLine: 'Return flow line',                                    // o passo Return
    whileLoop: 'While loop',
    loopControl: 'Loop control (Break/Next)',
    forEachDataRow: 'For Each Data Row block',
    assertStopQuietly: 'Assert quiet-stop policy',                     // o Assert com "On failure: Stop quietly" (conditions.stopQuietly)
    elseIf: 'Else If branch',
    nameTokenModifiers: 'Modifiers on slot/variable/history tokens',   // {clip:N:trim}, {var:nome:upper}, {winclip:2:trim}
    desktopAssert: 'Desktop Assert',                                   // o passo Assert (o da página é o Assert Element)
    copyToSlot: 'Copy to Slot',
    assertElement: 'Assert Element',
    browserActions: 'Browser actions',                                 // os passos do navegador (header.record.browser)
    holdKeyKeystroke: 'Hold Key/Keystroke',
    clickHold: 'Click and hold',                                       // Hold Left Click e os outros botões
    keystrokeJitter: 'Keystroke repeat jitter',                        // "Vary the gap" de um Keystroke repetido
    runMacro: 'Run Macro (macro chaining)',
    runMacroOverData: 'Run Macro over data',                           // "Run once per data row" (editors.runMacro.perRow)
    combinedClicks: 'Combined clicks (Left Click/Right Click/Middle Click)',  // o clique inteiro em um passo, sem as metades Down e Up
    focusClick: 'Focus click',                                         // list.focusClick
    clickRepeat: 'Click repeat (× N)',                                 // "Repeat" de um clique (editors.repeat)
    clickPointJitter: 'Click repeat position jitter',                  // "Vary the point" (editors.click.varyPoint)
    doubleClick: 'Double Click',
    tripleClick: 'Triple Click',
    clickAtCursor: 'Click at cursor',                                  // "At cursor" (editors.click.atCursor)
    activateWindow: 'Activate Window',
    activateWindowPlacement: 'Activate Window placement',              // "Placement" (editors.window.placement)
    activateWindowAction: 'Window action or Match # (Activate Window)',  // Maximize, Minimize, Close (editors.window.actionField) ou "Match #" (conditions.window.matchIndex)
    setVariableCycle: 'Set Variable Cycle mode',                       // as opções do Set Variable (editors.variable)
    setVariableAdd: 'Set Variable Add mode',
    loopTokens: 'Loop iteration tokens',                               // {loop}, {datarow}
    dateFormat: 'Date/time format and offset',                         // {date:+7}, {time:HH:mm}
    shapeModifiers: 'Replace/count/pad/default modifiers',             // os nomes dos modificadores, como se digitam
    counterModifiers: 'Modifiers on counter/loop/datarow tokens',
    machineTokens: 'UUID/timestamp/env tokens',
    typeTextKeys: 'Type Text key tokens (space/home/end/page, repeat, delay)',  // {space}, {tab:2}, {delay:N} no Type Text
    wideColumnNames: 'Data column names with spaces or accents',       // {row:Nome Completo}
    copyToSlotClear: 'Copy to Slot Clear mode',                        // editors.slot.clear
    richText: 'Rich text (Send Text)',                                 // o formato Rich (sendText.formats.rich)
    typedDelivery: 'Typed text delivery (Send Text)',                  // a entrega Type (sendText.methods.type)
    setVariable: 'Set Variable',
    automationTrigger: 'Automation trigger',                           // a automação da macro
    automationSearchRegion: 'Automation image search region',          // "Search region" (inspector.region.label)
    automationCheckEvery: 'Automation poll interval',                  // "Check every" (automations)
    automationWindowAnchor: 'Automation watcher window anchor',        // "Relative to a window" (automations)
    automationHours: 'Automation active hours',                        // "Only between these hours" (automations)
    // As opções de Replay ▾ que a macro guarda para si, em vez de seguir o app (header.replay).
    macroLoops: 'Per-macro loop count',
    macroGameMode: 'Per-macro Game Mode',
    macroReturnCursor: 'Per-macro cursor return',
    macroJitter: 'Per-macro jitter',
    macroFastApproach: 'Per-macro fast approach',
    waitText: 'Wait Text',
    conditionScreenText: 'Text on screen condition',
    setVariableScreen: 'Read screen text into a variable',             // Set Variable no modo Screen
    automationScreenText: 'Automation screen text',                    // uma automação com a condição Text on screen
    restoreSize: 'Restore size',                                       // library.folderTarget.restoreSize
    sharingMetadata: 'Macro sharing metadata',                         // a descrição, as tags e o ícone
  },

  // O conserto dos blocos ao abrir uma macro com If, While ou For Each Row sem par: o validador tira os
  // marcadores órfãos (um Else ou um End If que não fecha nada) e põe no fim os fechamentos que faltam.
  repair: {
    // O aviso (ProfileController), um por caso. name = o nome da macro; count = os marcadores, sempre 1
    // ou mais; n = o mesmo número.
    appended: {
      one: "Auto-repaired conditional blocks in '{{name}}': appended {{n}} closing marker",
      other: "Auto-repaired conditional blocks in '{{name}}': appended {{n}} closing markers",
    },
    removed: {
      one: "Auto-repaired conditional blocks in '{{name}}': removed {{n}} orphan",
      other: "Auto-repaired conditional blocks in '{{name}}': removed {{n}} orphans",
    },
    // Os dois: markers e orphans = os dois textos abaixo, cada um com o seu número.
    both: "Auto-repaired conditional blocks in '{{name}}': appended {{markers}}, removed {{orphans}}",
    markers: { one: '{{n}} closing marker', other: '{{n}} closing markers' },
    orphans: { one: '{{n}} orphan', other: '{{n}} orphans' },
    // A nota que o motor grava no passo de fechamento que ele pôs (a coluna Notes), uma por bloco.
    noteIf: 'auto-repaired: unmatched IF',
    noteWhile: 'auto-repaired: unmatched WHILE',
    noteForEachRow: 'auto-repaired: unmatched FOR EACH ROW',
  },
} as const;
