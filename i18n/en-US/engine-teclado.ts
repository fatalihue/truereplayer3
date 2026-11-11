// O motor: o que o Teclado diz sozinho (Source/TecladoService.cs, branch teclado) — a notificação do
// Windows quando o teclado.json não pôde ser lido na abertura, e o porquê da falha que a página mostra
// sob o aviso de quarentena (teclado.loadFailureDetail, TecladoPage.tsx). O molde é o dos Key Remaps
// (engine-remaps.ts). Os nomes de arquivo ficam. pending = o arquivo que recebe as mudanças
// ("teclado.pending.json").
export default {
  open: 'Open the Keyboard',           // botão da notificação: abre a página Teclado

  // O teclado.json não pôde ser lido na abertura (o motor não o sobrescreve).
  unreadable: {
    title: 'Keyboard: file unreadable',
    // n = quantos jogos o backup tinha, já formatado (S.Num)
    backup: {
      one: 'teclado.json could not be read, so the last backup was loaded ({{n}} game). The file is not overwritten — edits go to {{pending}}.',
      other: 'teclado.json could not be read, so the last backup was loaded ({{n}} games). The file is not overwritten — edits go to {{pending}}.',
    },
    noBackup: 'teclado.json could not be read and there is no backup, so no game changes any key. The file was NOT overwritten — see the session log.',
  },

  // O porquê, numa linha sob o aviso da página. reason = o erro: a frase do motor (S.Reason) ou o texto
  // do .NET (o do JSON diz a linha e a coluna).
  detail: {
    read: 'The file could not be opened: {{reason}}',
    parse: 'The file is not valid JSON: {{reason}}',
    unknown: 'The reason is unknown.',
  },
} as const;
