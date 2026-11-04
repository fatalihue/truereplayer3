// O motor: as macros e os arquivos delas (Source/ProfileController.cs, ExampleLibrary.cs, Tr2Import.cs e
// ImageStorageService.cs). Os avisos de salvar, abrir e organizar as macros; os diálogos nativos (Save
// Macro, Unsaved Changes, Unapplied Changes e a caixa de erro do Salvar como antigo); os títulos e os
// filtros dos seletores de arquivo do Windows; os erros da importação do TrueReplayer 2 e das imagens de
// referência; e os nomes padrão que o motor grava, que nascem no idioma da interface e depois são do
// usuário, como o "Documento1" do Office (plano de idiomas, §2.4).
//
// Em pt-BR, "a macro" no feminino; hotkey e hotstring são coringas (glossário), também no feminino ("a
// hotkey"). Erro diz "Não foi possível…". O inglês é o de antes, letra por letra: os roteiros da bateria
// comparam várias destas frases (e12-textos, e9-textos, a4/a5 da importação, c2-dados).
//
// Nas lacunas: name = o nome de uma macro; reason = o motivo de uma falha, S.Reason(ex) (a frase do motor
// para os casos comuns, ou a mensagem do .NET ou do Windows como vem); n = um número já formatado (S.Num).
export default {
  // Os avisos (ProfileController.OnAlert, que os guarda até a janela aparecer). O tipo de cada um
  // (info ou error) vai no código, ao lado da chamada.
  alerts: {
    // Um seletor de arquivo não abre porque outra janela do app segura a vez (uma captura na tela, um
    // diálogo, outro seletor) e não respondeu ao pedido para fechar. holder = o que está aberto, como
    // InteractionScope.Describe o diz (engine-guards, scope): com o artigo e, em pt-BR, sempre feminino
    // ("a captura da imagem de referência"), por isso "aberta" e "nela". O inglês guarda as aspas de antes.
    // holder = InteractionScope.Describe: a name with its article ("the window to export macros"), no quotes.
    pickerBusy: 'Can\'t open the file dialog: {{holder}} is still open and didn\'t respond. Press Esc or right-click on it, then try again.',
    // O diálogo de arquivo do Windows falhou ao abrir (uma extensão do Explorer quebrada, uma pasta
    // inicial que não serve).
    pickerFailed: "The file dialog couldn't open ({{reason}}).",
    // O Salvar como antigo gravou a macro, mas imagens de referência que ela usa já não estavam no disco.
    // count = essas imagens (sempre 1 ou mais); n = o mesmo número.
    savedImagesMissing: {
      one: 'Saved "{{name}}", but {{n}} reference image(s) were missing on disk and could not be carried over — recapture them in the new macro.',
      other: 'Saved "{{name}}", but {{n}} reference image(s) were missing on disk and could not be carried over — recapture them in the new macro.',
    },
    // Salvar uma macro que saiu da lista no meio do caminho (renomeada ou excluída no Explorer).
    saveGone: 'Couldn\'t save "{{name}}": it\'s no longer in the macro list (renamed or deleted outside the app?).',
  },

  // A organização da biblioteca (Documents\TrueReplayer3\Profiles\profile-order.json): as pastas e as
  // macros fixadas (Pinned, na biblioteca). Avisos.
  order: {
    // O arquivo existe, mas outro programa o segura (um antivírus, o OneDrive): nada se perde.
    locked: "Couldn't read your macro organisation (folders/pins) — another program is holding the file. Macros are shown ungrouped until it can be read; the file was not changed.",
    // O arquivo estava estragado: uma cópia dele ficou ao lado, e a organização recomeçou do zero.
    // file = o nome da cópia ("profile-order.json.bak"), igual nos dois idiomas.
    backedUp: "Couldn't read your macro organisation (folders/pins). The unreadable file was backed up to {{file}}; your layout was reset.",
    // O mesmo, sem a cópia (ela também falhou).
    reset: "Couldn't read your macro organisation (folders/pins); your layout was reset.",
    // Uma mudança nas pastas enquanto o arquivo continua sem poder ser lido: ela não foi gravada.
    stillUnreadable: "Your macro organisation (folders/pins) still can't be read, so that change wasn't saved. The file was not changed.",
    // O mesmo, quando o arquivo voltou a ser lido: a organização dele vale, e a mudança se perdeu.
    reloaded: "Your folders and pins hadn't loaded yet — they're back now, but that change wasn't applied. Please repeat it.",
    // A gravação falhou; a mudança fica na memória e é gravada de novo na próxima vez.
    saveFailed: "Couldn't save your macro organisation (folders/pins): {{reason}}. The change is kept for this session and will be retried.",
  },

  // Duas macros com a mesma hotkey (ou hotstring) e a mesma janela-alvo: só uma dispara. Avisos, um por
  // combinação. hotkey = a combinação, como o keycap escreve ("Ctrl+F5"); hotstring = a sequência, em
  // minúsculas ("/id"); n = quantas macros (sempre 2 ou mais); names = os nomes delas, separados por
  // vírgula; target = a janela-alvo que elas dividem: o processo e o título, como "notepad.exe / Sem
  // título". O "with the same no target window" é o inglês de antes (o roteiro e9-textos o procura).
  collision: {
    hotkey: "Hotkey '{{hotkey}}' is bound to {{n}} macros with the same target '{{target}}': {{names}} — only one will fire",
    hotkeyNoTarget: "Hotkey '{{hotkey}}' is bound to {{n}} macros with the same no target window: {{names}} — only one will fire",
    hotstring: "Hotstring '{{hotstring}}' is bound to {{n}} macros with the same target '{{target}}': {{names}} — only one will fire",
    hotstringNoTarget: "Hotstring '{{hotstring}}' is bound to {{n}} macros with the same no target window: {{names}} — only one will fire",
  },

  // O Cancel dos três diálogos nativos abaixo (ContentDialog: o texto do botão é do app).
  cancel: 'Cancel',

  // O diálogo de antes de trocar de macro, fechar o app… com alterações que ainda não foram salvas.
  unsaved: {
    title: 'Unsaved Changes',
    // beforeWhat = um dos textos de before, abaixo: em pt-BR, um infinitivo depois de "antes de".
    actions: 'You have unsaved actions. Save before {{beforeWhat}}?',       // os passos mudaram
    runSettings: "You changed this macro's run settings. Save before {{beforeWhat}}?",  // só Replay ▾ (Loops, Interval, Game Mode…) mudou
    save: 'Save',          // botão · verbo
    discard: 'Discard',    // botão · verbo
    // O que vem depois de "Save before": o que a pessoa ia fazer.
    before: {
      closing: 'closing',                         // fechar o app
      continuing: 'continuing',                   // o padrão de quem não diz
      updating: 'updating',                       // instalar a atualização
      switching: 'switching macros',              // abrir outra macro pela biblioteca
      creating: 'creating a new macro',
      exporting: 'exporting',
    },
  },

  // O diálogo de fechar o app com um editor que tem alterações não aplicadas (o Inspector, a tabela do
  // Data Loop, as Automations…): fechar mesmo assim, ou ficar.
  unapplied: {
    title: 'Unapplied Changes',
    // sentence = a frase de AutomationGuard.DescribeUnappliedEdits, que diz quais editores e termina em
    // ponto; esta é a frase seguinte.
    body: '{{sentence}} Closing now discards them.',
    closeAnyway: 'Close Anyway',   // botão · verbo
  },

  // O Salvar como antigo (um arquivo .json escolhido no diálogo do Windows): a caixa de erro.
  saveAs: {
    // Uma imagem de referência da macro não pôde ser copiada para a pasta das imagens da nova, e nada
    // foi gravado. image = o nome do arquivo da imagem; name = o nome da nova macro.
    imageFailed: 'Could not copy this macro\'s reference image "{{image}}" into "{{name}}".\n\nNothing was saved, so the images you have are untouched. Free up some disk space (or close whatever has the file open) and save again.',
    failed: 'Error saving macro:\n{{reason}}',
    errorTitle: 'Error',   // o título da caixa (o OK é do Windows)
  },

  // Os títulos dos seletores de arquivo do Windows (os botões e o resto vêm no idioma do Windows).
  picker: {
    program: 'Select a program to launch',   // Browse… do Activate Window
    image: 'Choose a reference image',       // Choose file… de uma imagem de referência
    saveImage: 'Save the reference image',   // Save image…
    export: 'Export macros',
    import: 'Import macros',
  },

  // O nome de cada filtro dos seletores de arquivo; o padrão (*.png…) fica no código, igual nos dois.
  filter: {
    programs: 'Programs',
    pictures: 'Pictures',
    png: 'PNG image',
    json: 'JSON file',
    macros: 'TrueReplayer macros',   // os arquivos .trprofile
    allFiles: 'All files',
  },

  // Os nomes padrão que o motor grava (plano de idiomas, §2.4).
  names: {
    folder: 'Folder',          // uma pasta sem nome na organização, ao consertá-la ("Folder (2)" para a segunda)
    examples: 'Examples',      // a pasta onde "Use this example" põe as cópias; reconhecida nos dois idiomas
    saveAs: 'macro',           // o nome sugerido no Salvar como antigo (o arquivo; minúscula)
    export: 'macros-{{date}}', // o arquivo de exportar várias macros · date = o dia, 2026-11-03
    // A pasta, em Documents\TrueReplayer3\Backups, com o que o app tinha antes de importar o
    // TrueReplayer 2 · stamp = a data e a hora, "2026-11-03 091500".
    beforeImport: 'Before import {{stamp}}',
  },

  // Importar do TrueReplayer 2 (Settings ou o primeiro uso): por que não começou ou falhou. app = o nome
  // do outro app, "TrueReplayer 2".
  tr2: {
    closeFirst: 'Close {{app}} first: its files must not change while they are copied.',
    chooseParts: 'Choose something to import.',   // nenhuma parte marcada
    failed: 'The import failed and nothing was changed: {{reason}}',
  },

  // Uma imagem de referência escolhida num arquivo (Choose file…): por que não serve.
  image: {
    // size = o tamanho do arquivo e max = o limite, em MB inteiros, já formatados.
    tooBig: 'That file is {{size}} MB; a reference image can be up to {{max}} MB.',
    notPicture: "That file isn't a picture Windows can read. Choose a PNG, JPEG, BMP or GIF.",
  },
} as const;
