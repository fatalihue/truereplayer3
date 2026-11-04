// A aba Data Loop (shell/data/): a tabela da macro aberta (DataGrid.tsx), o vazio (DataLoop.tsx), as
// ferramentas na fileira de inserção (DataTools.tsx), a superfície Paste or import (DataPaste.tsx), as
// configurações no Inspector (DataSettings.tsx) e os nomes de coluna que a tabela recusa (model.ts).
// "Data Loop" é glossário (recurso) e fica; row = linha, column = coluna, table = tabela. Os dados de
// exemplo (name, email, amount, Maria…) e os nomes que o app dá às colunas (col1, col2…) são dado e
// ficam fora do catálogo.
//
// Nas lacunas: number = a posição de uma linha ou de um passo (1, 2, 3…, sem separador de milhar,
// como a coluna do número); n = uma contagem já formatada (fmtNum: 1,000 / 1.000); name = o nome de
// uma coluna ou de uma macro, do usuário; token = um token já montado ({row:nome}); macros = nomes de
// macros do usuário, separados por ", ".
export default {
  // Ditos em mais de um lugar da aba.
  noTable: 'No table yet',                 // o título do vazio da aba, e o subtítulo do Inspector sem tabela
  // As contagens · n = fmtNum(count). Juntas por " · " ("24 rows · 3 columns") no subtítulo do Inspector
  // e na prévia da colagem.
  rows: { one: '{{n}} row', other: '{{n}} rows' },
  columns: { one: '{{n}} column', other: '{{n}} columns' },
  pasteOrImport: 'Paste or import',        // o botão ▾ da fileira, o nome do menu e o título da superfície · verbo · orçamento: com as outras ferramentas, ~31 rem da fileira; abaixo de 35,5 rem fica só o ícone
  importCsv: 'Import CSV…',                // botão do vazio e item do menu Paste or import · verbo; CSV é marca
  emptyName: '(empty)',                    // no lugar do nome de uma coluna sem nome (a coluna)
  columnsLabel: 'Columns',                 // rótulo da lista das colunas (na colagem) e da seção do Inspector · nome
  // Os avisos.
  copyFailed: 'Could not copy — click inside the window and try again.',  // a área de transferência recusou
  readFailed: 'Could not read that file.',                                 // o CSV escolhido não abriu

  // A aba sem tabela (DataLoop.tsx): o que uma tabela faz e os jeitos de começar uma.
  empty: {
    // token = {row:name}, desenhado em <code> onde a frase o põe.
    text: 'Give the macro a list: one row per run, or every row in one go. Each column becomes a token, like {{token}}.',
    readOnly: '{{>insert.readOnlyRunning}}',   // no lugar dos botões, enquanto uma execução roda
    paste: 'Paste from a spreadsheet',         // botão principal, com a tecla Ctrl+V ao lado · verbo
    startEmpty: 'Start an empty table',        // link · verbo
    sample: 'Use sample data',                 // link · verbo
    sampleTip: 'Three rows of name, email and amount, to try the tokens',  // name, email e amount são as colunas do exemplo (dado)
  },

  // A linha do dock embaixo, nesta aba: o que as teclas e os cliques fazem agora.
  hint: {
    cell: 'Enter confirms · Alt+Enter breaks the line · Esc puts it back',  // uma célula aberta; "line" é a linha do texto da célula
    header: 'Enter renames the column · Esc keeps its name',                // o nome de uma coluna aberto
    cursor: 'Click a row number to make it the next row',                   // no modo de uma linha por vez
  },

  // A grade (DataGrid.tsx).
  grid: {
    label: 'Data Loop table',              // a grade, para o leitor de tela
    // O # do canto: copia o token {datarow} (o número da linha de dados; o {row} é o do passo na lista).
    numberLabel: '# — copy the {datarow} token',                  // para o leitor de tela · verbo
    numberTip: '{datarow} is the data row number — click to copy the token',
    // A coluna do fim, no cabeçalho: + Column.
    addColumn: 'Add column',               // o cabeçalho da coluna do fim, para o leitor de tela
    column: 'Column',                      // o botão tracejado "+ Column" · nome · orçamento: 7,5 rem, com o ícone
    addRow: 'Add row',                     // o botão tracejado sob a grade · verbo
    // O ⋯ de uma coluna e o menu dele.
    columnOptions: 'Column options',       // dica do ⋯ e nome do menu
    columnOptionsFor: 'Column options for {{name}}',               // o ⋯, para o leitor de tela · name = o nome da coluna
    columnOptionsForNumber: 'Column options for column {{number}}', // o mesmo, com a coluna sem nome
    rowMenu: 'Row {{number}}',             // o nome do menu de uma linha (clique direito, Shift+F10)
    // A célula aberta, para o leitor de tela.
    cellLabel: '{{name}}, row {{row}}',                  // name = o nome da coluna; row = o número da linha
    cellLabelUnnamed: 'Column {{column}}, row {{row}}',  // a coluna sem nome · column = o número dela
    columnName: 'Column name',             // o campo do nome de uma coluna, para o leitor de tela
    // O cabeçalho de uma coluna: o aviso, o nome repetido, quantos passos a leem.
    invalidTip: 'Not a token name ({ } and : are not allowed) — Fix it in the Inspector',  // "Fix" é o botão do Inspector
    duplicateTip: 'Duplicate column — the last one wins',  // outra coluna tem o mesmo nome: o token lê a última
    readTimes: { one: 'Read {{n}} time by the steps', other: 'Read {{n}} times by the steps' },  // dica do ×N · count e n = as leituras (1 ou mais); "read" concorda com a coluna
    unused: 'unused',                      // selo no cabeçalho, no lugar do ×N (a coluna) · orçamento: o cabeçalho tem 11,25 rem, com o nome
    // O número de uma linha, no modo de uma linha por vez: marca a próxima, e um clique a escolhe.
    nextLabel: 'Row {{number}}, the next replay uses it',  // a linha marcada, para o leitor de tela
    makeNextLabel: 'Make row {{number}} the next row',     // as outras, para o leitor de tela · verbo
    nextTip: 'The next replay uses this row',              // dica da linha marcada, e o item (desligado) do menu dela
    makeNext: 'Make it the next row',                      // dica das outras, e o item do menu · verbo
    next: 'next replay',                   // selo no fim da linha marcada · orçamento: 7,5 rem, com os botões da linha ao passar o mouse
    // Os botões da linha (ao passar o mouse) e os itens do menu dela · verbo.
    duplicateRow: 'Duplicate row',         // dica e item do menu
    duplicateRowLabel: 'Duplicate row {{number}}',  // para o leitor de tela
    deleteRow: 'Delete row',
    deleteRowLabel: 'Delete row {{number}}',
    // O menu de uma coluna · verbo.
    copyToken: 'Copy {{token}}',           // token = {row:nome da coluna}
    notToken: 'Not a token name',          // o mesmo item, desligado, quando o nome não serve de token
    tokenCopied: 'Token copied',           // aviso
    insertLeft: 'Insert column left',
    insertRight: 'Insert column right',
    moveLeft: 'Move left',
    moveRight: 'Move right',
    deleteColumn: 'Delete column',
    deleteColumnConfirm: 'Really delete column?',  // o mesmo item, em vermelho, pedindo o segundo clique
    // Aviso: uma célula com algo digitado fechou por fora, e o que foi digitado se perdeu. Uma frase
    // por motivo.
    discarded: {
      macro: 'Another macro was opened — the cell’s edit was discarded.',
      clicker: 'The Clicker turned on — the cell’s edit was discarded.',
      recording: 'A recording started — the cell’s edit was discarded.',
      run: 'A run started — the cell’s edit was discarded.',
    },
  },

  // Por que um nome não serve para a coluna: sob o campo do nome, em vermelho, enquanto se digita
  // (model.ts, nameProblem).
  name: {
    empty: 'A column needs a name',
    invalid: 'A column name can’t hold { } or :',
    taken: 'There is already a column named {{name}}',  // name = o nome digitado
  },

  // A superfície Paste or import (DataPaste.tsx): a tabela como texto, no lugar da grade.
  paste: {
    back: 'Table',                         // o botão de voltar à grade, no canto · nome
    backTip: 'Discards this paste',
    mode: 'Paste mode',                    // o segmentado, para o leitor de tela
    // As opções do segmentado de 2 (16 rem, ~124 px cada) · verbo. Replace table é também o botão de aplicar.
    replace: 'Replace table',
    append: 'Append rows',
    appendTip: 'Matches columns by name — by position when the first row isn’t the header',
    appendRows: { one: 'Append {{n}} row', other: 'Append {{n}} rows' },  // o botão de aplicar · count e n = as linhas coladas
    box: 'Table data, tab-separated',      // a caixa do texto, para o leitor de tela
    header: 'First row is the header',     // a caixa de marcar
    // Dica da caixa de marcar: o que acontece desmarcada.
    headerOffAppend: 'Off: every line is data, filled into the columns by position',  // acrescentando linhas
    headerOff: 'Off: the columns become col1…colN and every line is data',           // substituindo a tabela; col1…colN são os nomes que o app dá
    byPosition: 'Fills by position',       // rótulo da lista das colunas, acrescentando sem cabeçalho
    // Avisos da prévia, ao lado.
    invalid: 'Headers holding { } or : can’t be {row:…} tokens, but they still save.',
    short: 'Rows shorter than the header: the missing cells read as empty.',
    long: 'Rows longer than the header: the extra cells become new columns.',
    tail: 'Edit in place or paste over it.',  // com a tabela de hoje na caixa
    foot: 'Tabs, quotes and line breaks survive the paste · Ctrl+Enter applies',  // corta com reticências quando falta lugar
  },

  // As ferramentas da aba, na fileira de inserção (DataTools.tsx).
  tools: {
    label: 'Table tools',                  // o grupo, para o leitor de tela
    // O menu Paste or import · verbo.
    pasteTable: 'Paste a table…',
    pasteTableTip: 'The table as text: paste a spreadsheet’s rows over it, or edit it in bulk',
    importTip: 'A .csv, .tsv or .txt file; ; , and tab separate the columns',
    // O ⋯ da tabela: botão, dica e nome do menu.
    more: 'More table actions',
    copyTable: 'Copy table',               // item · verbo
    copyTableTip: 'As tab-separated text, ready to paste in a spreadsheet',
    copied: 'Table copied',                // aviso
    clearTable: 'Clear table',             // item · verbo
    clearConfirm: 'Confirm clear',         // o mesmo item, em vermelho, pedindo o segundo clique
    cleared: 'Table cleared',              // aviso, com Undo
  },

  // A busca na tabela (DataTools.tsx, FindBox): acende as células e não esconde linha.
  find: {
    label: 'Find in table',                // nome da caixa, para o leitor de tela
    placeholder: 'Find in table',          // placeholder · orçamento: ~94 px de texto na fileira estreita (a caixa tem 8 rem; 11,875 nas outras)
    // Ao lado da caixa: as linhas achadas · count e n = elas (fmtNum).
    found: { zero: 'No matches', one: '{{n}} row', other: '{{n}} rows' },
    hitOf: '{{number}} of {{total}}',      // depois de Enter: a linha achada em que está · total = fmtNum das achadas
    previous: 'Previous match',            // o ▲, para o leitor de tela
    previousTip: 'Previous (Shift+Enter)',
    next: 'Next match',                    // o ▼
    nextTip: 'Next (Enter)',
  },

  // As configurações da aba, no Inspector (DataSettings.tsx). O título é o nome do recurso, Data Loop.
  settings: {
    open: 'Data Loop settings',            // o botão da fileira que as traz (abaixo de 1024 px), para o leitor de tela
    openTip: 'How replay uses the rows, and the columns’ tokens',
    close: 'Close Data Loop settings',     // o × delas por cima da tabela, para o leitor de tela · verbo
    noTableHint: 'With a table, how replay walks its rows is set here.',
    large: 'Large table — the macro’s file grows with it.',  // de 1.000 linhas para cima: a tabela fica no arquivo da macro
    // Como a reprodução usa as linhas: a seção e o segmentado.
    uses: 'How replay uses the rows',      // rótulo da seção e nome do segmentado
    // As opções do segmentado de 2: ~158 px cada no Inspector padrão (22,5 rem) e ~122 px na largura
    // mínima dele (18 rem), em negrito quando escolhida. Chaves estáveis: a prévia do Send Text as cita.
    modes: {
      next: 'Next row each time',          // uma linha por reprodução, e a seguinte na próxima
      all: 'Every row, in one go',         // todas as linhas em uma reprodução, uma volta por linha
    },
    nextTip: 'Each replay uses one row, then moves to the next',
    allTip: 'One replay runs once per row; it overrides the Loops and the hotkey’s looping',
    // O cartão sob o segmentado.
    noRowsAll: 'No rows — replay won’t start.',
    noRowsNext: 'The table has no rows yet: each replay will use the next one.',
    // A linha marcada, em negrito dentro do cartão · name = o primeiro valor da linha, do usuário.
    row: 'row {{number}}',
    rowNamed: 'row {{number}} ({{name}})',
    // row = a linha marcada (row ou rowNamed, em negrito onde a frase o põe); next = o número da seguinte.
    nextMoves: 'The next replay uses {{row}} and then moves to row {{next}}. After the last row it starts over at row 1. A replay you stop has still used its row.',
    nextAlways: 'The next replay uses {{row}}, every time. A replay you stop has still used its row.',  // a tabela tem uma linha só
    // Todas de uma vez · count e n = as linhas (1 ou mais).
    allRows: {
      one: 'Each replay runs all {{n}} row, once per row — in place of the Loops and the hotkey’s looping.',
      other: 'Each replay runs all {{n}} rows, once per row — in place of the Loops and the hotkey’s looping.',
    },
    nextRow: 'Next row',                   // rótulo da linha · nome
    nextOf: '{{number}} of {{total}}',     // ao lado: a linha marcada e quantas há (total = fmtNum)
    backToFirst: 'Back to row 1',          // botão · verbo
    backToFirstTip: 'The next replay starts at the top of the table',
    wraps: 'Tell me when the list wraps',  // rótulo e nome da chave de ligar: o aviso de fim de volta
    wrapsTip: 'A chime and a tray balloon when a replay uses the last row',
    // O que uma linha que falha faz: a seção e o segmentado de 2. A opção Stop é common.actions.stop.
    fails: 'If a row fails',
    haltTip: 'The run stops at the first row that fails',
    skip: 'Skip the row',                  // opção · verbo
    skipTip: 'The row is logged and the run goes on with the next',
    // Sob o segmentado: para que caminhos a escolha vale. Uma frase por quantos são (1 a 3); a, b e c
    // são os caminhos abaixo, na ordem.
    scope1: 'Counts for {{a}}. Skipped rows are summed up when the run ends.',
    scope2: 'Counts for {{a}}, and for {{b}}. Skipped rows are summed up when the run ends.',
    scope3: 'Counts for {{a}}, and for {{b}}, and for {{c}}. Skipped rows are summed up when the run ends.',
    scopeAll: 'every row in one go',                               // o modo de todas as linhas
    scopeForEach: 'For Each Data Row blocks',                      // os blocos For Each Data Row desta macro
    scopeCaller: '“{{name}}” running this macro once per data row', // name = a macro que roda esta, uma vez por linha
    scopeCallers: '{{n}} macros running this one once per data row', // n = quantas (2 ou mais)
    // As colunas como tokens: a seção.
    columnsHint: 'Names ignore case. {datarow} is the data row number.',
    emptyColumn: '(empty, column {{number}})',  // uma coluna sem nome
    notToken: 'not a token name',          // ao lado do nome que não serve de token
    fix: 'Fix',                            // botão · verbo
    fixLabel: 'Fix column name {{name}}',  // o botão, para o leitor de tela
    fixLabelUnnamed: 'Fix column name column {{number}}',  // o mesmo, com a coluna sem nome
    fixTip: 'Puts _ in place of { } and :, and keeps it unique',
    // Quem lê a coluna, ao lado do token (a coluna; corta com reticências).
    usedOne: 'used by step {{number}}',
    usedList: 'used by steps {{list}} and {{last}}',  // 2 ou 3 passos · list = os números menos o último, separados por ", "
    usedMany: 'used by {{n}} steps',                  // 4 ou mais
    notUsedHere: 'not used here',          // nenhum passo daqui a lê, mas uma macro chamada pode ler
    notUsedYet: 'not used yet',
    // Dica de "not used here" · count = as macros; macros = os nomes. O inglês diz run(s) nos dois.
    inherited: {
      one: 'Not read by this macro’s steps. {{macros}} run(s) on this macro’s row (Run Macro without “once per data row”) and may read it — check before deleting it.',
      other: 'Not read by this macro’s steps. {{macros}} run(s) on this macro’s row (Run Macro without “once per data row”) and may read it — check before deleting it.',
    },
    copyToken: 'Copy token',               // dica do botão · verbo
    copyTokenLabel: 'Copy token {{token}}',  // o botão, para o leitor de tela
    copied: '{{token}} copied',            // aviso
    // Um token que nenhuma coluna responde: o alerta. token = o token ({row:cupom}), em <code> onde a
    // frase o põe; "it" é o token. Uma frase por quantos passos o leem (um; 2 ou 3, com list e last
    // como em usedList; 4 ou mais, n), e com From quando outra macro roda esta (macros = os nomes).
    orphan: {
      oneStep: 'Step {{number}} reads {{token}}, but there is no such column, so it types nothing.',
      someSteps: 'Steps {{list}} and {{last}} read {{token}}, but there is no such column, so it types nothing.',
      manySteps: '{{n}} steps read {{token}}, but there is no such column, so it types nothing.',
      oneStepFrom: 'Step {{number}} reads {{token}}, but there is no such column, so it types nothing when this macro runs on its own; run from {{macros}}, it reads that macro’s row.',
      someStepsFrom: 'Steps {{list}} and {{last}} read {{token}}, but there is no such column, so it types nothing when this macro runs on its own; run from {{macros}}, it reads that macro’s row.',
      manyStepsFrom: '{{n}} steps read {{token}}, but there is no such column, so it types nothing when this macro runs on its own; run from {{macros}}, it reads that macro’s row.',
    },
    addColumn: 'Add column {{name}}',      // botão do alerta · verbo · name = o nome que o token lê
    goToStep: 'Go to step {{number}}',     // botão do alerta · verbo
    // O rodapé · orçamento: 323 px, como o do Inspector.
    foot: 'Applies as you type · Ctrl+Z undoes',
  },
} as const;
