// O motor: as frases dele para as exceções que a pessoa encontra (S.Reason, Source/Strings.cs). No
// en-US o motor mostra a mensagem do próprio .NET, como sempre (ela já está em inglês e diz o
// caminho); estas frases são as do pt-BR, e o inglês aqui só as espelha. Cada uma entra depois de um
// dois-pontos ("Não foi possível salvar a macro: o arquivo está em uso por outro programa."), por isso
// começa em minúscula e termina sem ponto.
export default {
  fileInUse: 'the file is in use by another program',
  accessDenied: 'Windows denied access to the file or folder',
  fileNotFound: 'the file is not there anymore',
  folderNotFound: 'the folder is not there anymore',
  pathTooLong: 'the path is too long for Windows',
  diskFull: 'the disk is full',
} as const;
