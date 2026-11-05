import type en from '../en-US/library.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  newMacro: 'Nova macro',
  newFolder: 'Nova pasta',
  pinned: 'Fixadas',
  ungrouped: 'Sem pasta',
  windowTarget: 'Janela-alvo',
  swatch: 'Cor {{color}}',
  cantRunItself: 'Uma macro não pode rodar a si mesma',

  clickerOn: {
    key: 'O Clicker está ativado — {{keys}} traz as macros de volta',
    rail: 'O Clicker está ativado — {{>common.pages.macros}}, no trilho, traz as macros de volta',
  },

  panel: {
    more: 'Mais ações de macros',
    collapseFolders: 'Recolher todas as pastas',
    expandFolders: 'Expandir todas as pastas',
    search: 'Pesquisar macros',
    searchHint: 'Pesquisar · # para tags',
    list: 'Lista de macros',
    locked: 'Pare a execução para abrir outra macro',
  },

  row: {
    armed: 'Automação armada',
    conflict: '{{chip}} — Outra macro usa esta hotkey na mesma janela — só uma dispara',
    hotstringInstant: '{{chip}} — Hotstring — dispara ao digitar',
    hotstringEnd: '{{chip}} — Hotstring — dispara com Enter, Space ou Tab',
  },
  modes: {
    onRelease: 'Ao soltar',
    whilePressed: 'Enquanto apertada',
    toggle: 'Alternar',
    doubleTap: 'Toque duplo',
    hold: 'Segurar (longo)',
  },

  folder: {
    count: { zero: 'Nenhuma macro', one: '{{count}} macro', other: '{{count}} macros' },
    more: 'Mais ações de {{name}}',
    actions: 'Ações da pasta',
    newMacroIn: 'Nova macro em {{name}}',
  },

  folded: {
    nav: 'Macros, recolhidas',
    expand: 'Expandir lista de macros',
    close: 'Fechar lista de macros',
    disabled: 'desativada',
    more: { zero: 'Nenhuma macro a mais', one: 'Mais {{count}} macro', other: 'Mais {{count}} macros' },
    moreTip: '{{n}} a mais',
    armed: { zero: 'nenhuma armada', one: '{{count}} armada', other: '{{count}} armadas' },
    conflicts: '{{n}} em conflito',
  },

  menu: {
    fromExample: 'De um exemplo…',
    importMacros: 'Importar macros…',
    exportMacros: 'Exportar macros…',
    openFolder: 'Abrir pasta das macros',
  },
  folderMenu: {
    color: 'Cor',
    windowTarget: 'Janela-alvo…',
    enableAll: 'Ativar todas',
    disableAll: 'Desativar todas',
    delete: 'Excluir pasta',
  },

  rename: {
    macroTitle: 'Renomear macro',
    folderTitle: 'Renomear pasta',
    macroPlaceholder: 'Novo nome…',
    folderPlaceholder: 'Novo nome da pasta…',
    macroTaken: 'Já existe uma macro com esse nome.',
    folderTaken: 'Já existe uma pasta com esse nome.',
  },
  newFolderDialog: {
    placeholder: 'Nome da pasta…',
    name: 'Nome da pasta',
    preview: 'prévia',
    create: 'Criar',
  },
  delete: {
    title: 'Excluir macro',
    question: 'Excluir a macro {{name}}?',
    note: 'O arquivo e as imagens dela são excluídos. Isso não pode ser desfeito.',
  },
  revert: {
    title: 'Reverter macro',
    question: 'Deixar {{name}} como estava quando você a abriu?',
    note: 'As alterações desde então são perdidas, e o Ctrl+Z não as traz de volta.',
    button: 'Reverter',
  },
  clear: {
    title: 'Limpar todos os passos',
    question: {
      zero: 'Limpar os passos de {{name}}?',
      one: 'Limpar o único passo de {{name}}?',
      other: 'Limpar todos os {{n}} passos de {{name}}?',
    },
    note: 'O Ctrl+Z os traz de volta.',
    button: 'Limpar tudo',
  },
  folderTarget: {
    title: 'Janela-alvo da pasta',
    intro: 'Para cada macro de {{name}} sem um alvo próprio.',
    set: 'Definir alvo',
    readNote: 'Leia primeiro a nota sobre as macros desta pasta',
    relative: 'Coordenadas relativas',
    relativeTip: 'Os pontos dos passos das macros acompanham a janela quando ela se move',
    focus: 'Trazer para a frente',
    focusTip: 'Traz a janela para a frente antes de rodar. Ativado, as hotkeys e as hotstrings funcionam de qualquer janela.',
    restorePosition: 'Restaurar posição',
    restorePositionTip: 'Devolve a janela à posição capturada, antes de rodar',
    restoreSize: 'Restaurar tamanho',
    restoreSizeTip: 'Devolve a janela ao tamanho capturado, antes de rodar',
    update: 'Atualizar tamanho e posição da janela',
    updateTip: 'Lê onde a janela está agora, e o tamanho dela, para {{>library.folderTarget.restorePosition}} e {{>library.folderTarget.restoreSize}}',
    noteWasRelative: {
      zero: 'Nenhuma macro desta pasta usa o alvo dela.',
      one: '{{count}} macro desta pasta usa o alvo dela, com X/Y definidos para coordenadas relativas. Ela não é convertida: se os cliques dela caírem no lugar errado, abra-a e rode “{{>palette.cmd.toAbsolute}}” (Ctrl+K).',
      other: '{{count}} macros desta pasta usam o alvo dela, com X/Y definidos para coordenadas relativas. Elas não são convertidas: se os cliques de uma delas caírem no lugar errado, abra-a e rode “{{>palette.cmd.toAbsolute}}” (Ctrl+K).',
    },
    noteWasAbsolute: {
      zero: 'Nenhuma macro desta pasta usa o alvo dela.',
      one: '{{count}} macro desta pasta usa o alvo dela, com X/Y definidos para coordenadas absolutas. Ela não é convertida: se os cliques dela caírem no lugar errado, abra-a e rode “{{>palette.cmd.toRelative}}” (Ctrl+K).',
      other: '{{count}} macros desta pasta usam o alvo dela, com X/Y definidos para coordenadas absolutas. Elas não são convertidas: se os cliques de uma delas caírem no lugar errado, abra-a e rode “{{>palette.cmd.toRelative}}” (Ctrl+K).',
    },
    gotIt: 'Entendi',
    removed: 'Janela-alvo ({{target}}) removida da pasta "{{name}}"',
    targetFallback: 'alvo',
  },

  export: {
    title: 'Exportar macros',
    filter: 'Filtrar macros',
    filterPlaceholder: 'Filtrar macros…',
    clearFilter: 'Limpar filtro',
    selectAll: 'Selecionar tudo',
    none: 'Nenhuma macro para exportar.',
    noMatch: 'Nenhuma macro corresponde a "{{filter}}"',
    steps: { zero: '0 passos', one: '{{n}} passo', other: '{{n}} passos' },
    selected: { zero: 'Nenhuma selecionada', one: '{{count}} selecionada', other: '{{count}} selecionadas' },
    hiddenByFilter: { zero: 'nenhuma oculta pelo filtro', one: '{{count}} oculta pelo filtro', other: '{{count}} ocultas pelo filtro' },
    organization: 'Incluir organização das pastas',
    organizationTip: 'Fixadas, pastas, ordem e janelas-alvo das pastas',
    alongTip: 'Rodadas pelas macros escolhidas: {{names}}',
    along: {
      zero: 'Nenhuma macro rodada pela seleção',
      one: '+{{count}} macro rodada pela seleção está incluída',
      other: '+{{count}} macros rodadas pela seleção estão incluídas',
    },
  },
} satisfies Catalogo<typeof en>;
