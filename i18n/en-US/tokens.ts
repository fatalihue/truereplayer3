// Os tokens do Send Text ({clipboard}, {date}, {enter}…): o que cada um faz — a dica do chip no
// editor, o cabeçalho do popover dele e a dica dos chips da paleta (components/lexical/
// tokenDescriptions.ts) — e os grupos e os chips da paleta do painel Insert e da lista que o { abre
// (tokenCatalog.ts, shell/inspector/textInsert.tsx).
//
// Ficam como se digitam, nos dois idiomas (glossário): o token e a cadeia ({clipboard:trim},
// {var:nome}), as teclas (Enter, Esc, PgUp, Ctrl+V) e os formatos (.NET: dd/MM/yyyy, HH:mm:ss).
// Os chips da paleta que têm o nome do token (Date, Time, Enter, Delay, Counter, Loop, Clipboard…)
// também: são o rótulo que o chip mostra no editor depois de inserido, e moram em tokenCatalog.ts,
// como dado. Aqui ficam só os chips que descrevem o token com outras palavras.
// As descrições são frases curtas, sem ponto final, que dizem o que o token faz (3ª pessoa em pt-BR).
export default {
  // Os grupos da paleta (o painel Insert) e da lista do { · nome.
  groups: {
    dataTable: 'From the Data Loop table',  // as colunas da tabela do Data Loop, um chip por coluna
    values: 'Values',                       // data, hora, número sorteado, identificadores
    keys: 'Keys',                           // as teclas e o {delay}, na paleta
    keysTiming: 'Keys & timing',            // o mesmo grupo, na lista do {
    clipboard: 'Clipboard',                 // coringa
    runState: 'Run state',                  // o estado da execução: variáveis, contadores, linhas
  },

  // Os chips que não têm o nome do token · nome. As reticências: o chip pede um nome antes de inserir.
  // Orçamento: a lista do { tem 256 px e corta o rótulo com reticências; a paleta quebra a linha.
  chips: {
    clipSlot: 'Clip slot…',                 // {clip:N}: um slot de captura (Copy to Slot)
    clipboardNext: 'Clipboard line (next)', // {clipboard:next}: a próxima linha a cada uso
    clipboardHistory: 'Clipboard history',  // {winclip:1}: o histórico do Win+V
    variable: 'Variable…',                  // {var:nome}
    askInput: 'Ask input…',                 // {input:pergunta}: a execução pausa e pergunta um valor
    dataRow: 'Data row #',                  // {datarow}: o número da linha do Data Loop
    actionRow: 'Action row #',              // {row}: o número da linha do passo na lista
    rowColumn: 'Row column…',               // {row:Coluna}: a coluna, na linha atual
    rowColumnNext: 'Row column (next)…',    // {rownext:Coluna}: a coluna, na próxima linha a cada uso
  },

  // O que cada token faz, pelo nome. As teclas dizem a tecla como o keycap a escreve.
  desc: {
    clipboard: 'Paste the clipboard text',
    date: 'Current date (dd/MM/yyyy)',
    time: 'Current time (HH:mm:ss)',
    datetime: 'Current date and time',
    enter: 'Press Enter',
    tab: 'Press Tab',
    space: 'Press Space',
    backspace: 'Press Backspace',
    delete: 'Press Del',
    escape: 'Press Esc',
    esc: 'Press Esc',                       // {esc} é outro nome de {escape}
    home: 'Press Home',
    end: 'Press End',
    pageup: 'Press PgUp',
    pagedown: 'Press PgDn',
    up: 'Press Up arrow',
    down: 'Press Down arrow',
    left: 'Press Left arrow',
    right: 'Press Right arrow',
    delay: 'Pause typing for N ms',         // N = o número do token, como se digita
    random: 'Fresh random number each run',
    pick: 'Types ONE of the options, drawn each run',
    var: 'Value stored by a Set Variable action',
    counter: 'Run repeat number (1, 2, 3…)',  // qual repetição da macro está rodando
    loop: 'Iteration of the innermost While / For Each block (the run repeat outside one)',
    datarow: 'Number of the current data row (1 = first)',
    row: "Current action's grid row number (not the data table)",  // a posição do passo na lista
    rownext: 'Each use pulls the NEXT data row. Resets each run.',
    clip: 'Selection captured by Copy to Slot or the capture hotkey',
    winclip: 'Win+V history (must be enabled) — 1 is the most recent',
    input: 'Prompt for a value at replay time (pauses the run)',
    uuid: 'Fresh unique identifier (UUID) at each use',
    timestamp: 'Unix time — seconds since 1970 (UTC)',
    env: 'Value of an environment variable on this machine',
  },

  // Só na paleta: o mesmo, mais onde mexer depois de inserir (o chip abre o popover dele).
  palette: {
    date: '{{>tokens.desc.date}}. Click the chip to shift it or change the format.',
    time: '{{>tokens.desc.time}}. Click the chip to shift it or change the format.',
    datetime: '{{>tokens.desc.datetime}}. Click the chip to shift it or change the format.',
    pick: '{{>tokens.desc.pick}}. Click the chip to edit the list.',
    winclip: '{{>tokens.desc.winclip}}. Click the chip to change the item.',
    uuid: '{{>tokens.desc.uuid}}. Click the chip to shape it (upper, no dashes…).',
    timestamp: '{{>tokens.desc.timestamp}}. Click the chip for milliseconds.',
    clipboardNext: '{{>tokens.variants.clipboardNext}}. Click the chip to add transforms.',
  },

  // Quando o argumento muda o sentido do token, e a descrição do nome deixaria de ser verdade.
  variants: {
    clipboardNext: 'Each use takes the NEXT line; copying something new starts over',  // {clipboard:next}
    rowColumn: 'Data table column of the current row',                // {row:Coluna}
    dateShifted: 'Date with an offset and/or a custom format',        // {date:+7d}, {date:dd/MM}
    timeShifted: 'Time with an offset and/or a custom format',
    datetimeShifted: 'Date and time with an offset and/or a custom format',
    // Com uma cadeia de modificadores ({counter:pad:3}): o número não sai mais como está.
    counterShaped: 'Run repeat number, shaped by its modifiers',
    loopShaped: 'Iteration of the innermost While / For Each block, shaped by its modifiers',
    datarowShaped: 'Number of the current data row, shaped by its modifiers',
    uuidShaped: 'Fresh unique identifier (UUID) at each use, shaped by its modifiers',
    timestampMs: 'Unix time in milliseconds since 1970 (UTC)',        // {timestamp:ms}
    timestampShaped: 'Unix time (seconds), shaped by its modifiers',
  },
} as const;
