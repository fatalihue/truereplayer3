// Settings › Appearance (shell/pages/settings/appearance.tsx, appearancePreview.tsx e themeEditor.tsx): a
// galeria de temas, o destaque, a interface, as ações da página, a prévia ao vivo e as duas vistas do
// editor de tema (Edit colors… e Share or import…). O nome da página é settings.categories.appearance.
//
// Os nomes dos 37 temas (themePresets.ts: Dracula, Nord, Cotton Candy, Cream Paper…) e das fontes são
// nomes: ficam como dado, iguais nos dois idiomas, e a página marca com data-glossary o elemento em que
// um deles aparece sozinho (o cartão, a escolha, o item do menu). Os temas que a pessoa cria são
// conteúdo dela. Em pt-BR, "o tema" no masculino ("ao Dracula", "o Nord original").
//
// Nas lacunas: name = o nome de um tema (o aberto, um da galeria ou um da pessoa); hex e color = uma cor
// em #rrggbb, igual nos dois idiomas.
export default {
  // A galeria (ThemeSection e ThemeCard).
  theme: {
    title: 'Theme',                       // título da seção · nome
    // Os chips de filtro, o primeiro com quantos temas o app traz (n = 37, formatado). A fileira quebra
    // a linha; cada chip é uma palavra (o tema, masculino em pt-BR).
    all: 'All {{n}}',
    filters: {
      dark: 'Dark',
      light: 'Light',
      vivid: 'Vivid',
      pastel: 'Pastel',
      monochrome: 'Monochrome',
    },
    filterGroup: 'Filter themes',         // nome da fileira de chips (leitor de tela)
    random: 'Random theme',               // nome do botão do dado (leitor de tela)
    randomTip: 'A random theme from this filter',       // dica do dado
    randomNone: 'No other themes in this filter',       // a mesma dica, com o dado desativado
    search: 'Search themes',              // nome do campo de pesquisa e o texto dele vazio
    // A galeria vazia com uma pesquisa, por filtro. query = o que foi digitado.
    noMatch: {
      all: 'No themes match “{{query}}”.',
      dark: 'No dark themes match “{{query}}”.',
      light: 'No light themes match “{{query}}”.',
      vivid: 'No vivid themes match “{{query}}”.',
      pastel: 'No pastel themes match “{{query}}”.',
      monochrome: 'No monochrome themes match “{{query}}”.',
    },
    // A galeria vazia sem pesquisa, por filtro (todo filtro tem temas hoje: é a rede de segurança).
    none: {
      all: 'No themes.',
      dark: 'No dark themes.',
      light: 'No light themes.',
      vivid: 'No vivid themes.',
      pastel: 'No pastel themes.',
      monochrome: 'No monochrome themes.',
    },
    showAll: 'Show all {{n}} themes',     // link sob a galeria dobrada · n = 37, formatado
    showFewer: 'Show fewer themes',       // o mesmo link, com a galeria aberta
    myThemes: 'My themes',                // subtítulo dos temas da pessoa
    // Depois do subtítulo, nos filtros Vivid, Pastel e Monochrome: as cores de um tema da pessoa não
    // dizem se ele é vivo, pastel ou monocromático.
    uncategorised: '(not categorised)',
    deleteTheme: 'Delete the theme {{name}}',  // nome do ✕ de um tema da pessoa (leitor de tela)
    deleteTip: 'Delete this theme',            // dica do mesmo ✕
    deleted: 'Deleted the theme "{{name}}"',   // aviso depois do ✕, com Undo
  },

  // Follow Windows light and dark (FollowWindows e ThemeForWindows): um tema para cada modo do Windows.
  follow: {
    label: 'Follow Windows light and dark',  // a chave e o texto ao lado dela · uma linha que quebra
    dark: 'Dark',                         // rótulo antes da escolha do tema do modo escuro
    light: 'Light',                       // o mesmo, do modo claro
    darkTheme: 'Dark theme',              // nome do menu dos temas escuros (leitor de tela)
    lightTheme: 'Light theme',            // nome do menu dos temas claros
    darkChoice: 'Dark theme: {{name}}',   // nome do botão que abre o menu dos escuros (leitor de tela)
    lightChoice: 'Light theme: {{name}}', // o mesmo, dos claros
  },

  // O destaque (AccentSection): o do tema, seis amostras e outra cor qualquer.
  accent: {
    title: 'Accent',                      // título da seção · nome
    group: 'Accent color',                // nome do grupo das amostras (leitor de tela)
    // A primeira amostra: o destaque do próprio tema, com o nome da cor dele (color = hues).
    themeDefault: 'Theme default, {{color}}',
    // O nome da cor do destaque do tema, pelo matiz: minúscula, depois de "Theme default, ".
    hues: {
      white: 'white',
      black: 'black',
      gray: 'gray',
      red: 'red',
      orange: 'orange',
      yellow: 'yellow',
      lime: 'lime',
      green: 'green',
      teal: 'teal',
      cyan: 'cyan',
      blue: 'blue',
      violet: 'violet',
      purple: 'purple',
      pink: 'pink',
    },
    // As seis amostras (ACCENT_SWATCHES, themePresets.ts): o nome de cada uma, dito pelo leitor de tela
    // e na dica dela, antes do hex.
    swatches: {
      periwinkle: 'Periwinkle',
      teal: 'Teal',
      violet: 'Violet',
      amber: 'Amber',
      lime: 'Lime',
      red: 'Red',
    },
    custom: 'Custom…',                    // a pílula depois das amostras: abre o seletor de cor
    customTip: 'Accent · {{hex}} — click to change',  // dica dela · hex = o destaque de agora
    customColor: 'Custom accent color',   // nome do seletor de cor (leitor de tela)
    customColorValue: 'Custom accent color, {{hex}}',  // o mesmo, com uma cor só da pessoa escolhida
  },

  // A interface (InterfaceSection, Slider, ZoomField e FontField). Os rótulos ficam sobre o controle,
  // em duas colunas, e quebram a linha.
  interface: {
    title: 'Interface',                   // título da seção · nome
    density: 'Density',                   // rótulo e nome do segmentado
    // As opções do segmentado de 3 (a densidade, feminino em pt-BR): uma palavra.
    densities: {
      compact: 'Compact',
      normal: 'Normal',
      spacious: 'Spacious',
    },
    motion: 'Motion',                     // rótulo e nome do segmentado das animações
    // As opções do segmentado de 3. system cabe em 92 px (§4.2: quebra com +15%).
    motions: {
      system: 'Follow Windows',
      on: 'On',
      off: 'Off',
    },
    // Sob o segmentado, com Follow Windows escolhido: como o Windows está agora.
    motionOff: 'Windows has animation effects off',
    motionOn: 'Windows has animation effects on',
    textSize: 'Text size',                // rótulo do controle deslizante (em px)
    corners: 'Corner roundness',          // o mesmo, do raio dos cantos (em px)
    zoom: 'Zoom',                         // rótulo da escolha e nome do menu
    zoomChoice: 'Zoom: {{zoom}}%',        // nome do botão que abre o menu (leitor de tela) · zoom = o número
    zoomDefault: '{{zoom}}% (default)',   // o item do menu com o zoom padrão
    font: 'Font for data',                // rótulo da escolha e nome do menu: a fonte monoespaçada dos dados
    fontChoice: 'Font for data: {{font}}',  // nome do botão que abre o menu · font = o nome da fonte
  },

  // As ações da página (Actions).
  actions: {
    editColors: 'Edit colors…',           // botão · verbo: abre a vista das cores
    saveAs: 'Save as my theme…',          // botão · verbo: pede o nome
    // Dica do mesmo botão, desativado: o tema aberto está sem mudança.
    saveAsTip: 'This is {{name}} as it comes — change the accent or a color first',
    name: 'Name of your theme',           // nome do campo do nome (leitor de tela)
    namePlaceholder: 'Theme name',        // o texto do mesmo campo vazio
    // Aviso de erro: o nome novo tomaria o lugar de outro tema da pessoa. other = o nome do outro.
    clash: '“{{name}}” would replace “{{other}}” — pick another name.',
    saved: 'Saved as “{{name}}”, in {{>appearance.theme.myThemes}}.',  // a linha depois de salvar
    share: 'Share or import…',            // botão · verbo: abre a vista de compartilhar
    reset: 'Reset to {{name}}',           // botão que abre o menu de voltar ao tema como ele vem, e o nome do menu
    asItComes: 'This is {{name}} as it comes',  // dica do mesmo botão, desativado
    // Os dois itens do menu: só as cores, ou as cores e a interface.
    resetColors: 'Colors',
    resetAll: 'Colors and interface',
    resetDone: 'Back to {{name}} as it comes',  // aviso depois de um deles, com Undo
  },

  // A prévia ao vivo (appearancePreview.tsx): uma macro em uma janela pequena, no tema. Os passos dela
  // são nomes do glossário; o resto é exemplo, traduzido.
  preview: {
    title: 'Live preview',                // o rótulo sobre a prévia e o nome dela (leitor de tela)
    hint: 'Hover a theme to try it here before choosing.',  // sob a prévia
    editTip: '{{name}} — click to edit',  // dica de cada parte: abre a cor dela no editor · name = colors.names
    macro: 'Trade Roblox',                // o nome da macro de exemplo, na barra · Roblox é marca
    imageFile: 'btn-ok.png',              // a imagem que o Wait Image de exemplo espera · nome de arquivo
    ifDetail: 'has “Ready”',              // a condição do If de exemplo: o texto na tela tem “Ready”
    sentText: 'Olá! Tudo bem?',           // o texto do Send Text de exemplo · em português nos dois, como os exemplos
  },

  // Edit colors… (ColorsView e ColorRow, em themeEditor.tsx): as 31 cores nos grupos delas.
  colors: {
    title: 'Colors',                      // título da vista, depois da volta a Appearance
    // Ao lado do título: o tema aberto e quantas cores mudaram (count; nenhuma: só o nome).
    detail: { zero: '{{name}}', one: '{{name}} · {{count}} changed', other: '{{name}} · {{count}} changed' },
    // Os grupos: o título de cada um abre e fecha a lista dele.
    groups: {
      accent: 'Accent',
      backgrounds: 'Backgrounds',
      text: 'Text',
      borders: 'Borders',
      semantic: 'Semantic',               // as cores de estado: Recording, Replay e Clicker
      actionTypes: 'Action types',        // as cores das famílias de passos
    },
    // Depois do título de um grupo: quantas cores dele mudaram (count, 1 ou mais).
    changed: { one: '· {{count}} changed', other: '· {{count}} changed' },
    // O nome de cada cor: o rótulo da linha (6rem, corta com reticências; os tipos de ação quebram a
    // linha em 5,5rem), e o que a prévia diz da parte que ela pinta. Os nomes de passo ficam (glossário).
    names: {
      accent: 'Accent',
      accentSolid: 'Solid',               // o destaque como preenchimento (o botão principal)
      accentHover: 'Hover',               // o destaque com o ponteiro em cima
      bgBase: 'Base',                     // os fundos (masculino em pt-BR): o da janela
      bgSurface: 'Surface',
      bgCard: 'Card',
      bgElevated: 'Elevated',
      bgInput: 'Input',                   // o fundo dos campos de texto
      textPrimary: 'Primary',             // o texto (masculino em pt-BR)
      textSecondary: 'Secondary',
      textTertiary: 'Tertiary',
      textDisabled: 'Disabled',
      borderSubtle: 'Subtle',             // as bordas
      borderDefault: 'Default',
      borderStrong: 'Strong',
      recording: 'Recording',             // a gravação: o Record ligado e o que diz que grava · nome
      replay: 'Replay',                   // a reprodução: o botão Replay e o que diz que a macro roda · nome
      clicker: 'Clicker',
      mouse: 'Mouse',                     // as famílias de passos: os cliques
      key: 'Key',                         // as teclas (Keystroke, Key Down…)
      scroll: 'Scroll',                   // Scroll Up e Scroll Down
      sendText: 'Send Text',
      setVariable: 'Set Variable',
      wait: 'Wait',                       // uma cor para as três esperas: Wait Image, Wait Pixel Color e Wait Text
      browser: 'Browser',                 // os passos do navegador
      runMacro: 'Run Macro',
      pause: 'Pause',                     // o passo Pause
      conditional: 'Conditional',         // If, Else If e Else
      loop: 'Loop',
      flow: 'Stop / Return',
      activateWindow: 'Activate Window',
    },
    // Botão sob as três cores do grupo Accent: refaz Solid e Hover a partir do Accent · verbo. Em pt-BR
    // diz "as outras duas", que estão logo acima.
    derive: 'Derive solid & hover',
    recent: 'Recent',                     // rótulo das cores usadas nesta visita, no pé
    applyTo: 'Apply {{color}} to {{name}}',  // dica e nome de uma cor recente com o HSL de uma cor aberto
    copy: 'Copy {{color}}',               // nome de uma cor recente sem HSL aberto (leitor de tela)
    copyTip: '{{color}} — click to copy', // a dica dela
    copied: '{{color}} — copied!',        // a mesma dica, logo depois de copiar
    copyFailed: 'Could not copy the color — click inside the window and try again.',  // aviso de erro
    // Os nomes de cada linha para o leitor de tela, e as dicas das ferramentas dela. name = colors.names.
    swatch: '{{name}} color',             // o seletor de cor da amostra
    hex: '{{name}} hex',                  // o campo do #rrggbb
    pick: 'Pick {{name}} color from screen',  // o conta-gotas
    pickTip: 'Pick a color from the screen',  // dica do conta-gotas
    hsl: '{{name}} HSL sliders',          // o botão que abre os três controles do HSL
    hslTip: 'HSL sliders',                // dica dele
    reset: "Reset {{name}} to the theme's color",  // a volta à cor do tema, com a cor mudada
    resetTip: 'Back to the theme’s color',          // dica dela
    hue: '{{name}} hue',                  // os três controles do HSL (leitor de tela)
    saturation: '{{name}} saturation',
    lightness: '{{name}} lightness',
    // Dica do contraste da linha: o que foi medido, o contraste pintado e o mínimo que ele pede.
    // what = measures; ratio = o contraste, uma casa decimal; target = o mínimo (4.5 ou 3), formatados.
    contrastTip: '{{what}}: {{ratio}}:1 — wants {{target}}+',
    // Contra o que o contraste foi medido (themeChecks.ts), minúscula, no começo da dica.
    measures: {
      worstSurface: 'worst surface',
      uiBoundary: 'UI boundary',
      labelOnSolid: 'label on solid fill',
      accentAsText: 'accent as text',
      derivedInk: 'derived ink on its own wash',
    },
    // A linha "para quê" da barra da captura na tela, depois de "Pick the color · ", quando o conta-gotas
    // escolhe uma cor do tema.
    captureFor: 'for the theme',
  },

  // Share or import… (ShareView, em themeEditor.tsx): o tema em um JSON, para um arquivo ou o clipboard,
  // e um tema de volta.
  share: {
    title: 'Share or import',             // título da vista, depois da volta a Appearance
    exportTitle: 'Export this theme',     // subtítulo
    name: 'Theme name',                   // nome do campo do nome (leitor de tela)
    defaultName: 'My theme',              // o nome que o tema exportado leva, e o texto do campo vazio
    exportFile: 'Export to file',         // botão · verbo: abre o Salvar do Windows
    dialogTitle: 'Export theme',          // o título do Salvar do Windows
    fileFallback: 'theme',                // o nome do arquivo quando o nome do tema não dá um ("theme.json")
    saved: 'Saved {{file}}',              // aviso · file = o nome do arquivo salvo
    saveFailed: 'Could not save the theme: {{error}}',  // aviso de erro · error = o que o Windows disse
    copy: 'Copy to clipboard',            // botão · verbo
    copied: 'Copied',                     // o mesmo botão, por 2 s, depois de copiar
    copyFailed: 'Copy failed',            // o mesmo botão, por 2 s, quando não deu
    hint: 'One JSON with the theme’s colors, your changes to them and the interface settings.',
    importTitle: 'Import a theme',        // subtítulo
    importFile: 'Import from file',       // botão · verbo
    paste: 'Paste from clipboard',        // botão · verbo
    json: 'Theme JSON',                   // nome da caixa do JSON (leitor de tela)
    jsonPlaceholder: 'Paste theme JSON here…',  // o texto da caixa vazia
    apply: 'Apply theme',                 // botão sob a caixa, com texto nela · verbo
    imported: 'Imported the theme “{{name}}”',  // aviso, com Undo
    // Os erros, sob a caixa.
    invalidJson: 'Invalid JSON: paste the whole exported theme.',
    invalidTheme: 'Invalid theme: missing color keys or UI settings.',
    readFailed: 'Could not read the selected file.',
    clipboardFailed: 'Could not read the clipboard — paste the JSON manually.',
  },
} as const;
