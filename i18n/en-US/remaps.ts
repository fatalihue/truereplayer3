// Key Remaps (shell/pages/remaps/): a página das regras (RemapsPage.tsx), o painel "Remap settings" ao
// lado, as frases que remapModel.ts monta (a regra em palavras, o que falta para o rascunho valer, os
// avisos das hotkeys que a regra toca, a leitura de um arquivo) e as recusas da captura
// (logic/useRemaps.ts). O título da página é common.pages.remaps; Edit, Delete, Import, Export e Undo
// vêm de common.actions.
//
// "Key Remaps" é recurso do glossário e "remap" é coringa: ficam, no masculino em pt-BR ("Novo remap",
// "os remaps"). As teclas ficam como o keycap as escreve (Caps, Esc, F1). Nas lacunas: from, to e key =
// uma tecla como o keycap a escreve ou o nome de um destino do mouse (mouse, abaixo); app = o processo,
// sem ".exe" ("RobloxPlayerBeta"), do usuário; max = o limite de regras (32).
export default {
  // O cabeçalho da página.
  head: {
    // Sob o título, numa linha que corta com reticências · orçamento: 448 px em 760 px, quebra com +15%:
    // uma frase do tamanho do inglês ou menor.
    sub: 'Turn a key into another key, a mouse button or nothing, everywhere or in one app',
    paused: 'Paused',             // selo ao lado da chave geral, com os atalhos desativados · os remaps (masculino plural)
    pausedTip: 'Shortcuts are off, and the remaps pause with them',  // dica do selo
    use: 'Use remaps',            // rótulo e nome da chave geral da página · verbo
    newRemap: 'New remap',        // botão do cabeçalho e título do painel de uma regra nova · o mesmo nome do Ctrl+K
    limit: '{{max}} is the limit',  // dica do New remap com a lista cheia
  },

  // O aviso de quando o remaps.json não pôde ser lido (o motor o põe de quarentena). pending = o arquivo
  // que recebe as mudanças ("remaps.pending.json"). Os nomes de arquivo ficam.
  unreadable: {
    backup: 'remaps.json could not be read, so the last backup is shown. Changes go to {{pending}} until the file is replaced.',
    noBackup: 'remaps.json could not be read and there is no backup, so the list shows empty. Changes go to {{pending}} until the file is replaced.',
    replace: 'Replace remaps.json',  // botão · verbo
  },

  // A página sem nenhuma regra.
  empty: {
    title: 'No remaps yet',
    text: 'A remap turns one key into another key, a mouse button or nothing — everywhere or in one app.',
    common: 'Common ones',          // título dos botões de regras comuns, sob a frase
    // O nome de cada botão comum, para o leitor de tela (o botão mostra "Caps → Esc"): from e to são
    // teclas (Caps, Esc, Insert, F1) · verbo
    add: 'Add {{from}} to {{to}}',
    addNothing: 'Add {{from}} to nothing',
  },

  // O que a regra faz e onde, nas palavras de sempre: a coluna It does, a coluna Where, os filtros e as
  // opções do painel.
  nothing: 'Nothing',               // a regra sem destino: a tecla não faz nada · opção do segmentado de 3 (95 px)
  everywhere: 'Everywhere',         // a regra vale em todos os apps · filtro, coluna Where e opção do segmentado de 2 (143 px)

  // Os cabeçalhos das colunas, que também dão nome às seções do painel: só o substantivo.
  fields: {
    from: 'When I press',           // a tecla que a regra troca · coluna de 9,375 rem
    does: 'It does',                // o que a tecla passa a fazer · também o nome do segmentado do painel
    where: 'Where',                 // em que app a regra vale
  },

  // A tabela das regras.
  table: {
    on: 'On',                       // cabeçalho da coluna das chaves de cada regra · orçamento: 3,5 rem
    actions: 'Actions',             // cabeçalho da coluna do ⋯, só para o leitor de tela
    edit: 'Edit {{rule}}',          // nome do botão da tecla de uma regra (leitor de tela) · rule = a regra em palavras (rule.to…)
    onlyIn: 'Only in {{app}}',      // a coluna Where de uma regra de um app só
    none: 'No remaps in this filter.',
  },

  // A barra sobre a lista: os filtros (cada um com a contagem dele), a contagem e o arquivo.
  filter: {
    label: 'Filter remaps',         // nome do grupo dos filtros (leitor de tela) · verbo
    all: 'All',                     // todos os remaps (masculino plural) · os outros filtros são everywhere, o nome de cada app e off
    off: 'Off',                     // os remaps desativados (masculino plural)
  },
  count: '{{n}} of {{max}}',        // a contagem à direita da barra · n = os remaps da lista
  importTip: 'Adds the file’s remaps to yours',  // dica do Import (common.actions.import)
  exportTitle: 'Export remaps',     // título da janela Salvar do Windows, no Export
  // O que a contagem diz por 5 s depois de um Import ou de um Export.
  note: {
    saved: { one: 'Saved {{count}} remap', other: 'Saved {{count}} remaps' },  // count = os remaps do arquivo salvo
    saveFailed: 'Could not save the file',
    readFailed: 'Could not read that file',
    added: 'Added {{added}}',       // added = os remaps do arquivo que entraram
    addedSkipped: 'Added {{added}} · skipped {{skipped}}',  // skipped = os repetidos (mesma tecla, mesmo app) e os que passaram do limite
  },
  // Por que um arquivo não entra no Import.
  file: {
    notJson: 'That file is not valid JSON',
    notRemaps: 'That is not a remaps file',
    noneUsable: 'No usable remaps in that file',
  },

  // O ⋯ de uma regra, na linha e no painel: o nome do botão e do menu, e os itens que não são de
  // common.actions · infinitivo, sem artigo.
  menu: {
    label: 'Remap actions',
    turnOff: 'Turn off',            // desativa a regra
    turnOn: 'Turn on',
  },

  // A nota sob a tabela: a chave dos atalhos também pausa os remaps. key = a hotkey dos atalhos, como o
  // keycap a escreve ("Ctrl+Alt+Shift+R").
  // O caminho para o Teclado (branch teclado): as teclas de um jogo ficam lá.
  tecladoNote: {
    text: 'To change keys only with a game in front, and run macros from its keys, use the Keyboard.',
    open: 'Open the Keyboard',
  },

  shortcutsNote: {
    key: 'The Shortcuts key ({{key}}) also pauses remaps, so one key silences everything the app does with the keyboard. The status bar shows when that happens.',
    noKey: 'Turning Shortcuts off also pauses remaps, so one switch silences everything the app does with the keyboard. The status bar shows when that happens.',
  },

  // O painel "Remap settings": a regra aberta, que se aplica enquanto se edita.
  panel: {
    label: 'Remap settings',        // nome do painel (leitor de tela)
    close: 'Close remap settings',  // o × do painel: o nome · verbo
    // A linha sob o título: onde a regra vale e, desativada, que está desativada · corta com reticências.
    sub: {
      everywhere: 'Remap · everywhere',
      app: 'Remap · only in {{app}}',
      everywhereOff: 'Remap · everywhere · off',
      appOff: 'Remap · only in {{app}} · off',
    },
    captureFrom: 'Capture the key to remap',  // nome do botão que captura a tecla apertada (leitor de tela)
    captureTo: 'Capture the key it sends',    // o mesmo, para a tecla enviada · "it" é o remap
    another: 'Another key',         // opção do segmentado de 3 · orçamento: 95 px
    mouse: 'Mouse',                 // opção do segmentado de 3
    nothingHint: 'The key does nothing while the remap is on.',  // sob o segmentado, com Nothing escolhido
    // Sob a tecla do remap, quando ela é um botão lateral do mouse: o gancho segura a mensagem do botão, nunca
    // o Raw Input, por onde um jogo como o Roblox lê o mouse (medido em 12-11-2026).
    sideRaw: 'A game that reads the mouse directly also gets the original side button.',
    oneApp: 'Only in one app',      // opção do segmentado de 2 · orçamento: 143 px
    mouseTarget: 'Mouse target',    // nome da lista dos destinos do mouse (leitor de tela)
    app: 'App',                     // rótulo e nome do campo do app · nome
    appPlaceholder: 'RobloxPlayerBeta.exe',  // exemplo no campo vazio: um nome de processo, igual nos dois idiomas
    // Sob o campo: o app digitado roda agora? app = o nome como foi digitado, com ".exe" se tiver.
    running: '{{app}} · running now',
    notRunning: '{{app}} · not running now',
    // O que a tecla faz nos outros apps, numa regra de um app só. key = a tecla; typed = o que ela digita (q).
    elsewhereTypes: 'In every other app, {{key}} still types {{typed}}.',
    elsewhereUsual: 'In every other app, {{key}} works as usual.',
    foot: 'Applies as you type · Ctrl+Z undoes',  // rodapé do painel
  },

  // A caixa que captura uma tecla, no painel: a linha sob a tecla. A caixa vazia diz inspector.fields.noKey.
  capture: {
    listening: 'Listening — press one key',
    change: 'Click, then press a key to change it',  // com uma tecla já capturada
    press: 'Click, then press a key',                // sem tecla ainda
  },

  // Os destinos do mouse (o que a regra faz, com Mouse escolhido), na ordem da lista do painel: o nome
  // que a página mostra, na lista, na coluna It does e no título do painel. No meio de uma frase
  // (rule.to), em minúscula.
  mouse: {
    LeftClick: 'Left click',
    MiddleClick: 'Middle click',
    RightClick: 'Right click',
    XButton1: 'Side button 1',
    XButton2: 'Side button 2',
    ScrollUp: 'Scroll up',
    ScrollDown: 'Scroll down',
  },

  // A regra em palavras: o nome da chave dela e do botão de editar ("Caps to Esc", "F1 disabled") e o
  // aviso de quando ela sai. to = a tecla, ou o destino do mouse em minúscula ("left click").
  rule: {
    to: '{{from}} to {{to}}',
    toIn: '{{from}} to {{to}} in {{app}}',
    off: '{{from}} disabled',               // a regra sem destino: a tecla não faz nada · from pode ser um botão lateral
    offIn: '{{from}} disabled in {{app}}',
    // A regra com a seta, como o título do painel a escreve: "Caps → Esc", "F1 → Nothing", "Q → Left click".
    arrow: '{{from}} → {{to}}',
    arrowNothing: '{{from}} → Nothing',
    arrowPending: '{{from}} → …',           // o título enquanto falta apertar a tecla enviada
    removed: 'Removed the remap {{rule}}',  // aviso, com Undo · rule = a regra com a seta ("Q → Left click")
  },

  // O que falta para o rascunho do painel virar regra, sob as seções (em vermelho, as recusas).
  problem: {
    pressFrom: 'Press the key to remap.',
    takenInApp: 'That key is already remapped in this app.',
    taken: 'That key is already remapped.',
    pressTo: 'Press the key it sends.',
    same: 'Source and target are the same key.',
    nameApp: 'Name the app, or pick one that is running.',
    limit: '{{max}} remaps is the limit.',
  },
  // A captura recusa a tecla e segue esperando a próxima (logic/useRemaps.ts).
  refuse: {
    combo: 'Single keys only — combos are not remappable.',
    wheel: 'The scroll wheel can be a target, not a source.',
  },

  // As hotkeys do app que a regra toca (o motivo nº 1 do suporte: "a hotkey não dispara"). Cada uma é
  // um nome que entra nas listas hits e named abaixo, com as teclas entre parênteses ao lado.
  hotkeys: {
    record: 'the Record hotkey',
    replay: 'the Replay hotkey',
    shortcuts: 'the Shortcuts hotkey',
    front: 'the Bring to front hotkey',
    clicker: 'the Open the Clicker hotkey',
    clip: 'the clip slot hotkey',
    screenText: 'the Copy text from the screen hotkey',
    macro: 'macro "{{name}}"',              // a hotkey de uma macro · name = o nome dela
    // A lista de duas ou mais: first = as de antes da última, separadas por vírgula; last = a última.
    and: '{{first}} and {{last}}',
  },
  // A tecla apertada é parte de hotkeys do app, e o remap passa na frente: elas param de disparar. Sob a
  // tecla, em amarelo. hits = a lista das hotkeys; count = quantas são.
  fromWarn: {
    one: 'Also {{hits}} — the remap overrides it and that hotkey stops firing.',
    other: 'Also {{hits}} — the remap overrides them and those hotkeys stop firing.',
  },
  // A tecla enviada é a tecla principal de hotkeys do app. to = a tecla enviada ou o destino do mouse;
  // named = a lista das hotkeys (com as teclas, as que têm modificadores); from = a tecla apertada;
  // count = quantas hotkeys.
  toNote: {
    // Um destino do mouse não dispara a hotkey: o motor ignora a entrada simulada.
    mouse: {
      one: '{{to}} is also {{named}} — a remapped press will not trigger it (hotkeys ignore injected input).',
      other: '{{to}} is also {{named}} — a remapped press will not trigger them (hotkeys ignore injected input).',
    },
    key: { one: '{{to}} is also {{named}} — {{from}} will trigger it.', other: '{{to}} is also {{named}} — {{from}} will trigger them.' },
    keyHeld: {
      one: '{{to}} is also {{named}} — {{from}} will trigger it with those modifiers held.',
      other: '{{to}} is also {{named}} — {{from}} will trigger them with those modifiers held.',
    },
    // A tecla apertada ainda por capturar.
    noFrom: { one: '{{to}} is also {{named}} — the remapped key will trigger it.', other: '{{to}} is also {{named}} — the remapped key will trigger them.' },
    noFromHeld: {
      one: '{{to}} is also {{named}} — the remapped key will trigger it with those modifiers held.',
      other: '{{to}} is also {{named}} — the remapped key will trigger them with those modifiers held.',
    },
  },
} as const;
