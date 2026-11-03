// O motor: o que o Key Remaps diz sozinho (Source/RemapService.cs) — as notificações do Windows quando o
// remaps.json não pôde ser lido na abertura ou quando uma mudança não foi gravada nele, e o porquê da
// falha que a página mostra sob o aviso de quarentena (remaps.loadFailureDetail, RemapsPage.tsx).
// "Key Remaps" é recurso do glossário e "remap" é coringa: ficam, no masculino em pt-BR ("os remaps").
// Os nomes de arquivo ficam. pending = o arquivo que recebe as mudanças ("remaps.pending.json").
export default {
  open: 'Open Key Remaps',             // botão das notificações: abre a página Key Remaps

  // O remaps.json não pôde ser lido na abertura (o motor não o sobrescreve).
  unreadable: {
    title: 'Key remaps: file unreadable',
    // n = quantos remaps o backup tinha, já formatado (S.Num)
    backup: {
      one: 'remaps.json could not be read, so the last backup was loaded ({{n}} remap). The file is not overwritten — edits go to {{pending}}.',
      other: 'remaps.json could not be read, so the last backup was loaded ({{n}} remaps). The file is not overwritten — edits go to {{pending}}.',
    },
    noBackup: 'remaps.json could not be read and there is no backup, so the list shows empty. The file was NOT overwritten — see the session log.',
  },

  // Uma mudança feita com o remaps.json ilegível: vale nesta sessão, mas não foi gravada nele.
  notSaved: {
    title: 'Key remaps not saved',
    empty: 'remaps.json could not be read, so nothing was written to disk. Your change is active for this session only.',
    pending: 'remaps.json could not be read, so your change went to {{pending}}. It is active for this session.',
  },

  // O porquê, numa linha sob o aviso da página. reason = o erro: a frase do motor (S.Reason) ou o texto
  // do .NET (o do JSON diz a linha e a coluna).
  detail: {
    read: 'The file could not be opened: {{reason}}',
    parse: 'The file is not valid JSON: {{reason}}',
    unknown: 'The reason is unknown.',
  },
} as const;
