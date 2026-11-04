import type en from '../en-US/engine-profiles.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  alerts: {
    pickerBusy: 'Não foi possível abrir o diálogo de arquivos: {{holder}} ainda está aberta e não respondeu. Aperte Esc ou clique nela com o botão direito e tente de novo.',
    pickerFailed: 'Não foi possível abrir o diálogo de arquivos ({{reason}}).',
    savedImagesMissing: {
      zero: 'A macro "{{name}}" foi salva com todas as imagens de referência.',
      one: 'A macro "{{name}}" foi salva, mas {{n}} imagem de referência não estava no disco e não pôde ser copiada — capture-a de novo na nova macro.',
      other: 'A macro "{{name}}" foi salva, mas {{n}} imagens de referência não estavam no disco e não puderam ser copiadas — capture-as de novo na nova macro.',
    },
    saveGone: 'Não foi possível salvar a macro "{{name}}": ela não está mais na lista de macros (foi renomeada ou excluída fora do app?).',
  },

  order: {
    locked: 'Não foi possível ler as suas pastas e macros fixadas — outro programa está usando o arquivo. As macros aparecem fora das pastas até ele poder ser lido; o arquivo não foi alterado.',
    backedUp: 'Não foi possível ler as suas pastas e macros fixadas. O arquivo ilegível foi copiado para {{file}}, e a organização recomeçou do zero.',
    reset: 'Não foi possível ler as suas pastas e macros fixadas, e a organização recomeçou do zero.',
    stillUnreadable: 'As suas pastas e macros fixadas ainda não podem ser lidas, então essa mudança não foi salva. O arquivo não foi alterado.',
    reloaded: 'As suas pastas e macros fixadas ainda não tinham sido carregadas — já voltaram, mas essa mudança não foi aplicada. Faça-a de novo.',
    saveFailed: 'Não foi possível salvar as suas pastas e macros fixadas: {{reason}}. A mudança fica guardada nesta sessão e será gravada de novo.',
  },

  collision: {
    hotkey: "A hotkey '{{hotkey}}' está atribuída a {{n}} macros com a mesma janela-alvo ('{{target}}'): {{names}} — só uma vai disparar",
    hotkeyNoTarget: "A hotkey '{{hotkey}}' está atribuída a {{n}} macros sem janela-alvo: {{names}} — só uma vai disparar",
    hotstring: "A hotstring '{{hotstring}}' está atribuída a {{n}} macros com a mesma janela-alvo ('{{target}}'): {{names}} — só uma vai disparar",
    hotstringNoTarget: "A hotstring '{{hotstring}}' está atribuída a {{n}} macros sem janela-alvo: {{names}} — só uma vai disparar",
  },

  cancel: 'Cancelar',

  unsaved: {
    title: 'Mudanças não salvas',
    actions: 'Os passos desta macro têm mudanças não salvas. Salvar antes de {{beforeWhat}}?',
    runSettings: 'Você mudou as configurações de execução desta macro. Salvar antes de {{beforeWhat}}?',
    save: 'Salvar',
    discard: 'Descartar',
    before: {
      closing: 'fechar',
      continuing: 'continuar',
      updating: 'atualizar',
      switching: 'trocar de macro',
      creating: 'criar uma nova macro',
      exporting: 'exportar',
    },
  },

  unapplied: {
    title: 'Mudanças não aplicadas',
    body: '{{sentence}} Fechar agora descarta essas mudanças.',
    closeAnyway: 'Fechar mesmo assim',
  },

  saveAs: {
    imageFailed: 'Não foi possível copiar a imagem de referência "{{image}}" desta macro para "{{name}}".\n\nNada foi salvo, então as suas imagens continuam intactas. Libere espaço no disco (ou feche o que estiver com o arquivo aberto) e salve de novo.',
    failed: 'Não foi possível salvar a macro:\n{{reason}}',
    errorTitle: 'Erro',
  },

  picker: {
    program: 'Escolha um programa para abrir',
    image: 'Escolha uma imagem de referência',
    saveImage: 'Salvar a imagem de referência',
    export: 'Exportar macros',
    import: 'Importar macros',
  },

  filter: {
    programs: 'Programas',
    pictures: 'Imagens',
    png: 'Imagem PNG',
    json: 'Arquivo JSON',
    macros: 'Macros do TrueReplayer',
    allFiles: 'Todos os arquivos',
  },

  names: {
    folder: 'Pasta',
    examples: 'Exemplos',
    saveAs: 'macro',
    export: 'macros-{{date}}',
    beforeImport: 'Antes de importar {{stamp}}',
  },

  tr2: {
    closeFirst: 'Feche o {{app}} primeiro: os arquivos dele não podem mudar enquanto são copiados.',
    chooseParts: 'Escolha o que importar.',
    failed: 'Não foi possível importar, e nada foi alterado: {{reason}}',
    arrived: 'O {{tr2}} agora é o {{app}}: suas macros, configurações, Key Remaps e o tema vieram junto.',
  },

  image: {
    tooBig: 'Esse arquivo tem {{size}} MB; uma imagem de referência pode ter até {{max}} MB.',
    notPicture: 'Esse arquivo não é uma imagem que o Windows consiga ler. Escolha um PNG, JPEG, BMP ou GIF.',
  },
} satisfies Catalogo<typeof en>;
