import type en from '../en-US/engine-errors.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  fileInUse: 'o arquivo está em uso por outro programa',
  accessDenied: 'o Windows negou o acesso ao arquivo ou à pasta',
  fileNotFound: 'o arquivo não existe mais',
  folderNotFound: 'a pasta não existe mais',
  pathTooLong: 'o caminho é longo demais para o Windows',
  diskFull: 'o disco está cheio',
} satisfies Catalogo<typeof en>;
