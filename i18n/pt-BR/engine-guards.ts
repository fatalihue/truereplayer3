import type en from '../en-US/engine-guards.ts';
import type { Catalogo } from '../tipos.ts';

// Os nomes de scope são todos femininos e singulares (a captura, a escolha, a detecção, a janela, a
// pergunta): as frases que os citam dizem "aberta" sem saber qual veio. Os diálogos não citam o título
// (o diálogo diz o dele): dizem a pergunta que fazem.
export default {
  scope: {
    imageCapture: 'a captura da imagem de referência',
    colorPick: 'a escolha da cor na tela',
    pointPick: 'a escolha do ponto na tela',
    regionCapture: 'a captura da região na tela',
    screenCapture: 'a captura na tela',
    windowPick: 'a detecção da janela',
    pickProgram: 'a janela para escolher um programa',
    pickImage: 'a janela para escolher uma imagem de referência',
    saveImage: 'a janela para salvar a imagem de referência',
    saveFile: 'a janela para salvar um arquivo',
    saveMacroFile: 'a janela para salvar a macro',
    openMacroFile: 'a janela para abrir uma macro',
    exportMacros: 'a janela para exportar macros',
    importMacros: 'a janela para importar macros',
    fileWindow: 'a janela de arquivo',
    saveMacro: 'a pergunta sobre como salvar a macro',
    unsavedChanges: 'a pergunta sobre as mudanças não salvas',
    unappliedChanges: 'a pergunta sobre as mudanças não aplicadas',
    deleteFolder: 'a pergunta sobre excluir a pasta',
    resetSettings: 'a pergunta sobre redefinir as configurações',
    otherDialog: 'outra pergunta',
    unknown: 'outra janela',
  },

  unapplied: {
    single: '{{editor}} tem mudanças que ainda não foram aplicadas.',
    several: '{{editors}} têm mudanças que ainda não foram aplicadas.',
    start: {
      sheet: 'O editor de ações',
      rowDialog: 'Um editor de linha',
      insertDialog: 'Uma janela de inserção',
      dataPanel: 'A tabela do Data Loop',
      automationPanel: 'O painel de Automações',
      inspector: 'O Inspector',
      unknown: 'Um editor aberto',
    },
    inside: {
      sheet: 'o editor de ações',
      rowDialog: 'um editor de linha',
      insertDialog: 'uma janela de inserção',
      dataPanel: 'a tabela do Data Loop',
      automationPanel: 'o painel de Automações',
      inspector: 'o Inspector',
      unknown: 'um editor aberto',
    },
  },

  editScope: {
    macroChanged: 'A macro aberta mudou de “{{from}}” para “{{to}}” — isto não foi aplicado.',
    listChanged: 'A lista de passos mudou enquanto isto estava aberto — isto não foi aplicado.',
    noAnchor: 'Esta operação não guardou o passo em que escreveria.',
    stepRemoved: 'Esse passo foi removido enquanto isto estava aberto — isto não foi aplicado.',
  },
} satisfies Catalogo<typeof en>;
