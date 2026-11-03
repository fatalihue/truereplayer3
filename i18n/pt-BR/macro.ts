import type en from '../en-US/macro.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  menu: {
    moveToFolder: 'Mover para pasta',
    noFolders: 'Nenhuma pasta',
    removeFromFolder: 'Remover da pasta',
    hotkey: 'Hotkey…',
    hotstring: 'Hotstring…',
    windowTarget: 'Janela-alvo…',
    editInfo: 'Editar informações…',
    openInExplorer: 'Abrir no Explorador',
    close: 'Fechar macro',
    revert: 'Reverter para quando abri',
    clearSteps: 'Limpar todos os passos…',
    enable: 'Ativar',
    disable: 'Desativar',
    delete: 'Excluir macro…',
  },
  locked: {
    run: 'Pare a execução antes',
    clicker: 'O Clicker está ativado',
    noSteps: 'Não há passos para limpar',
  },
} satisfies Catalogo<typeof en>;
