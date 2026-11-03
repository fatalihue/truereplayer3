import type en from '../en-US/update.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  title: {
    available: 'Atualização disponível',
    downloading: 'Baixando a atualização',
    installing: 'Atualizando para a v{{version}}',
    complete: 'Atualização concluída',
  },
  sub: {
    available: 'Uma nova versão do {{app}} está pronta',
    downloading: 'Não feche o app',
    installing: 'Fechando o {{app}}…',
    complete: 'Você já está na versão mais recente',
  },
  currentVersion: 'Versão atual',
  newVersion: 'Nova versão',
  whatsNew: 'Novidades',
  progress: 'Progresso da atualização',
  downloadingBar: 'Baixando…',
  applying: 'Aplicando a atualização, aguarde…',
  restart: 'O app reinicia sozinho',
  install: 'Baixar e instalar',
} satisfies Catalogo<typeof en>;
