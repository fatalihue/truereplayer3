// Os diálogos que não são de uma página: a importação de macros, que shell/library/ImportFlow.tsx abre
// em três passos (o aviso de segurança, SecurityWarningModal.tsx; a prévia, ImportPreviewDialog.tsx; o
// resultado, ImportResultDialog.tsx), e a pergunta de um token {input:…} no meio de uma execução
// (AskInputDialog.tsx). Em pt-BR, "a macro", no feminino.
//
// Nas lacunas: count = uma contagem, que escolhe a forma do plural; n = uma contagem já formatada
// (fmtNum: 1,000 / 1.000); version = um número de versão ("3.1.0", "2"); name = o nome de uma macro;
// date = uma data de utils/dateFormat.ts (formatDate: "Nov 3, 2026", ou dates.unknown, "Desconhecida",
// no feminino: a frase em pt-BR tem de aceitar as duas); when = há quanto tempo (formatRelative:
// "5m ago", "há 5 min").
export default {
  // O arquivo escolhido: quantas macros ele tem, ao lado do nome dele, no aviso de segurança (depois de
  // " · ") e no resumo da prévia.
  file: {
    macros: { one: '{{count}} macro', other: '{{count}} macros' },
  },

  // O aviso antes de importar (SecurityWarningModal.tsx), até a pessoa marcar "não mostrar".
  security: {
    title: 'Heads up',                    // título · curto
    intro: 'Macros run automated mouse and keyboard actions. Only import macros from sources you trust.',
    canTitle: 'Imported macros can:',     // abre a lista dos três riscos abaixo
    canClick: 'Click anywhere on screen',
    canType: 'Type any text (including passwords if a password field is focused)',
    canTrigger: 'Trigger automatically on windows you allow',
    dontShow: "Don't show this again",    // a caixa de marcar sob a lista
    escHint: 'Esc cancels',               // rodapé, à esquerda
    // Botão principal · verbo. Não é o fim: a prévia vem depois, e um rótulo que soasse como a
    // importação em si faria a pessoa cautelosa cancelar.
    continue: 'Continue to review',
  },

  // A prévia (ImportPreviewDialog.tsx): o resumo do arquivo, "selecionar tudo", a faixa dos conflitos
  // de nome e um cartão por macro. Cancel é common.actions.cancel.
  importPreview: {
    title: 'Import macros',               // título
    // O resumo do arquivo, sob o nome dele; os fatos lado a lado, sem separador.
    conflicts: { one: '{{count}} name conflict', other: '{{count}} name conflicts' },  // macros do arquivo com o nome de uma que já existe
    conflictsTip: 'Set per row below',    // dica do número acima: cada cartão escolhe o que fazer
    incompatible: { one: '{{count}} incompatible', other: '{{count}} incompatible' },  // macros que pedem uma versão mais nova (feminino)
    incompatibleTip: { one: 'Cannot be selected', other: 'Cannot be selected' },        // dica do número acima · count = o mesmo número
    organization: '+ folder organization',  // o arquivo traz as pastas, a ordem e as fixadas
    // A linha de baixo, menor. date pode ser dates.unknown.
    exported: 'Exported {{date}}',
    format: 'Format v{{version}}',        // a versão do formato do arquivo
    yourApp: 'Your app v{{version}}',     // a versão deste app
    selectAll: 'Select all',              // a linha que marca todas as compatíveis; ao lado, "3/5"
    // A faixa dos conflitos de nome das macros marcadas, com o segmentado que vale para todas.
    applyAll: { one: '{{count}} name conflict — apply to all:', other: '{{count}} name conflicts — apply to all:' },
    resolveAll: 'Resolve all name conflicts',   // nome do segmentado da faixa (leitor de tela)
    resolveOne: 'Resolve name conflict for {{name}}',  // nome do segmentado de um cartão (leitor de tela)
    // As opções do segmentado de um conflito (a de renomear é common.actions.rename) · verbo, uma
    // palavra. As dicas dizem a consequência e só aparecem na faixa.
    resolution: {
      overwrite: 'Overwrite',
      skip: 'Skip',
      renameTip: "Imports as 'Name (2)'",          // 'Name (2)' é um exemplo do nome que ela ganha
      overwriteTip: 'Replaces your local macro',
      skipTip: 'Not imported',
    },
    // O rodapé, à esquerda: quantas macros vão de fato entrar (as marcadas, menos as que ficam de fora
    // por Skip). willImport e skipped se juntam com " · "; total = as compatíveis do arquivo.
    willImport: { one: '{{count}} will be imported', other: '{{count}} will be imported' },
    skipped: { one: '{{count}} skipped', other: '{{count}} skipped' },
    willImportOf: { one: '{{count}} of {{total}} will be imported', other: '{{count}} of {{total}} will be imported' },
    importSelected: 'Import Selected ({{n}})',   // botão principal · verbo · n = as que vão entrar

    // Um cartão por macro, de cima para baixo.
    requires: 'Requires TrueReplayer {{version}} or newer',  // dica da caixa desativada de uma macro incompatível
    updated: 'Updated {{when}}',          // à direita do nome da macro (feminino em pt-BR)
    created: 'Created {{date}}',          // dica do texto acima · date pode ser dates.unknown
    // Os riscos: o que a macro faz nesta máquina depois de importada.
    hotstringTip: 'Fires when this text is typed.',  // dica do chip da hotstring
    repeats: 'repeats {{n}}×',            // a macro roda n vezes a cada disparo (n de 2 a 999) · minúscula
    targets: 'Targets: {{target}}',       // target = o processo ou o título da janela-alvo, em fonte mono
    trigger: 'Automation trigger',        // a macro traz uma automação
    triggerTip: 'Automation trigger — arrives disarmed',
    // As macros que ela roda (Run Macro): o rótulo e a dica de cada chip, pelo que acontece com ela.
    runs: 'Runs:',
    depBundled: 'Bundled — imported alongside',          // está no arquivo e entra junto
    depLocal: 'Not in the file — uses your local macro', // não está no arquivo, mas existe aqui
    depMissing: 'Missing here and locally — the step does nothing',
    // O tamanho, na última linha, em fonte menor. count = o número; n = o mesmo, formatado.
    steps: { one: '{{n}} step', other: '{{n}} steps' },
    images: { one: '{{n}} image', other: '{{n}} images' },        // as imagens de referência que vêm junto
    dataRows: { one: '{{n}} data row', other: '{{n}} data rows' }, // as linhas da tabela do Data Loop
    cantImport: 'Requires TrueReplayer {{version}} or newer — cannot import.',  // o aviso de uma macro incompatível
    // Um conflito de nome: a versão do arquivo → a que já existe aqui, cada uma com há quanto tempo
    // mudou, quando se sabe. As duas metades se juntam com " → ".
    incoming: 'Incoming v{{version}}',
    incomingWhen: 'Incoming v{{version}} · {{when}}',
    yours: 'Yours v{{version}}',          // a macro (feminino em pt-BR)
    yoursWhen: 'Yours v{{version}} · {{when}}',
    nameExists: 'Name exists:',           // antes do segmentado do conflito
  },

  // O resultado (ImportResultDialog.tsx), quando a importação tem o que ler: renomeadas, ignoradas,
  // imagens que faltaram, pastas, hotkeys em conflito. Close é common.actions.close. Os títulos das
  // seções levam o número entre parênteses (count).
  importResult: {
    title: 'Import complete',
    imported: { one: 'Imported ({{count}})', other: 'Imported ({{count}})' },  // as macros (feminino)
    renamed: '— renamed (“{{from}}” was taken)',  // depois do nome final de uma macro · from = o nome que ela tinha no arquivo
    skipped: { one: 'Skipped ({{count}})', other: 'Skipped ({{count}})' },
    skippedNote: 'Name conflicts resolved as {{>dialogs.importPreview.resolution.skip}}, or entries with invalid names.',
    images: { one: 'Reference images not restored ({{count}})', other: 'Reference images not restored ({{count}})' },
    imagesNote: 'See Logs for the per-file reason. WaitImage rows pointing at these will halt replay.',
    folders: 'Folders',                   // título da seção
    organization: 'Folder organization imported.',
    // names = os nomes das pastas, separados por vírgula, em negrito. count = quantas são.
    adopted: { one: 'Window target set on existing folder(s): {{names}}.', other: 'Window target set on existing folder(s): {{names}}.' },
    // A consequência que não pode passar sem ser lida. em e end cercam a palavra destacada ("your", a
    // janela-alvo de quem importa, não a de quem enviou): o que fica entre eles sai em negrito.
    kept: {
      one: "Kept your existing window target on folder(s): {{names}} — the imported macros there will use {{em}}your{{end}} target, not the sender's.",
      other: "Kept your existing window target on folder(s): {{names}} — the imported macros there will use {{em}}your{{end}} target, not the sender's.",
    },
    hotkeys: { one: 'Hotkey collisions ({{count}})', other: 'Hotkey collisions ({{count}})' },  // as frases da lista vêm do motor
  },

  // A pergunta de um token {input:…} (AskInputDialog.tsx): a execução espera a resposta. A pergunta e
  // as opções são da macro (conteúdo do usuário). Cancelar para a execução. Cancel é common.actions.cancel.
  askInput: {
    title: 'Input needed',                // título · diálogo estreito (360 px)
    menuHint: 'Esc cancels the run',      // rodapé com a lista de opções ({input:…|menu:a,b})
    fieldHint: 'Enter submits · Esc cancels the run',  // rodapé com o campo de texto
    submit: 'Submit',                     // botão principal · verbo
  },
} as const;
