// O motor: o que a pessoa vê dos guardas do app (Source/InteractionScope.cs, AutomationGuard.cs e
// EditScope.cs) — o nome do que está aberto e segura o app, a frase do diálogo de fechar quando um editor
// tem mudanças que não foram aplicadas, e por que o resultado de uma captura ou de um seletor não foi
// aplicado. As linhas do último resultado de uma automação (pulada porque algo estava aberto) ficam na
// área engine-automations. Em pt-BR, "a macro" e "a automação" no feminino.
export default {
  // InteractionScope.Describe: o nome, para a pessoa, do que está aberto e segura o app (uma captura na
  // tela, a janela de um arquivo, um diálogo), no lugar do nome interno ("insert WaitImage overlay",
  // "file picker: launch target", "dialog: save macro"). Entra no meio de uma frase de outra área ("…
  // ainda está aberta e não respondeu", "porque … está aberta", "pulado (… estava aberta)"): começa em
  // minúscula, com o artigo, e termina sem ponto. Em pt-BR é SEMPRE um nome feminino singular (a captura,
  // a escolha, a detecção, a janela, a pergunta), para o "aberta" de qualquer frase concordar com todos.
  // Em inglês, os diálogos levam o título deles (o motor os mostra em inglês).
  scope: {
    imageCapture: 'the reference image capture',          // a captura na tela da imagem de referência (Image found, Wait Image, a automação)
    colorPick: 'the screen capture to pick a color',      // a captura na tela que escolhe a cor de um ponto (Pixel color, Wait Pixel Color)
    pointPick: 'the screen capture to pick a point',      // a captura na tela que escolhe um ponto
    regionCapture: 'the screen capture to draw a region', // a captura na tela que desenha uma região (Screen Text, a região de pesquisa)
    screenCapture: 'the screen capture',                  // outra captura na tela (a área ou o ponto do Clicker)
    windowPick: 'the window detection',                   // o botão Detect window, esperando o clique na janela-alvo
    pickProgram: 'the window to choose a program',        // o seletor de arquivo do programa a abrir
    pickImage: 'the window to choose a reference image',  // o seletor de arquivo de uma imagem de referência
    saveImage: 'the window to save the reference image',  // o Salvar de Save image…
    saveFile: 'the window to save a file',                // o Salvar de um arquivo que a página pede
    saveMacroFile: 'the window to save the macro',        // o Salvar como de uma macro
    openMacroFile: 'the window to open a macro',          // o Abrir de uma macro
    exportMacros: 'the window to export macros',          // o Salvar do Export…
    importMacros: 'the window to import macros',          // o Abrir do Import…
    fileWindow: 'the file window',                        // outro seletor de arquivo
    saveMacro: 'the Save Macro dialog',                   // o diálogo Overwrite / Save as New
    unsavedChanges: 'the Unsaved Changes dialog',         // o "Save before…?" das mudanças não salvas
    unappliedChanges: 'the Unapplied Changes dialog',     // o diálogo de fechar com um editor que tem mudanças
    deleteFolder: 'the Delete Folder dialog',             // o diálogo de excluir uma pasta com macros
    resetSettings: 'the Reset Settings dialog',           // o diálogo de redefinir as configurações
    otherDialog: 'another dialog',                        // outro diálogo
    unknown: 'another window',                            // qualquer outra coisa
  },

  // AutomationGuard.DescribeUnappliedEdits: a frase do diálogo de fechar o app quando um editor aberto tem
  // mudanças que ainda não foram para a macro. Vem antes de outra frase do diálogo. Um editor: single, com
  // o nome dele em start; dois ou mais: several, com a lista (S.List: "a, b and c"), o primeiro nome em
  // start (a maiúscula do começo da frase) e os outros em inside.
  unapplied: {
    single: "{{editor}} has changes that haven't been applied.",
    several: "{{editors}} have changes that haven't been applied.",
    // Os editores, no começo da frase.
    start: {
      sheet: 'The action editor',
      rowDialog: 'A row editor',
      insertDialog: 'An insert dialog',
      dataPanel: 'The data table',                 // a tabela do Data Loop
      automationPanel: 'The Automations panel',    // o painel de uma automação, na página Automations
      inspector: 'The Inspector',
      unknown: 'An open editor',
    },
    // Os mesmos, no meio da lista.
    inside: {
      sheet: 'the action editor',
      rowDialog: 'a row editor',
      insertDialog: 'an insert dialog',
      dataPanel: 'the data table',
      automationPanel: 'the Automations panel',
      inspector: 'the Inspector',
      unknown: 'an open editor',
    },
  },

  // EditScope: por que o resultado de uma captura na tela ou de um seletor de arquivo não foi aplicado —
  // a macro aberta ou a lista de passos mudou enquanto ele estava aberto (uma automação disparou, um
  // desfazer). Saem como aviso. from e to = nomes de macro.
  editScope: {
    macroChanged: 'The active macro changed from "{{from}}" to "{{to}}" — this was not applied.',
    listChanged: 'The action list changed while this was open — this was not applied.',
    noAnchor: 'No anchor was captured for this operation.',   // um defeito do app: a operação não guardou o passo em que escreveria
    stepRemoved: 'That action was removed while this was open — this was not applied.',
  },
} as const;
