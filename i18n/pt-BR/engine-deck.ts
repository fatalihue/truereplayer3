import type en from '../en-US/engine-deck.ts';
import type { Catalogo } from '../tipos.ts';

// "Deck" é o nome do recurso e fica com maiúscula; cada painel é "um deck" (masculino), em minúscula.
export default {
  open: 'Abrir o Deck',

  unreadable: {
    title: 'Deck: arquivo ilegível',
    backup: {
      zero: 'Não foi possível ler o deck.json, então o último backup foi carregado (nenhum deck). O arquivo não é substituído — as mudanças vão para {{pending}}.',
      one: 'Não foi possível ler o deck.json, então o último backup foi carregado ({{n}} deck). O arquivo não é substituído — as mudanças vão para {{pending}}.',
      other: 'Não foi possível ler o deck.json, então o último backup foi carregado ({{n}} decks). O arquivo não é substituído — as mudanças vão para {{pending}}.',
    },
    noBackup: 'Não foi possível ler o deck.json e não há backup, então nenhum deck aparece na tela. O arquivo NÃO foi substituído — veja o log da sessão.',
  },

  detail: {
    read: 'Não foi possível abrir o arquivo: {{reason}}',
    parse: 'O arquivo não é um JSON válido: {{reason}}',
    unknown: 'O motivo é desconhecido.',
  },

  command: {
    record: 'Gravar',
    stopAll: 'Parar tudo',
    clicker: 'Clicker',
    teclado: 'Teclado',
    remaps: 'Key Remaps',
    automations: 'Automações',
    shortcuts: 'Atalhos',
    show: 'Mostrar o TR3',
  },

  back: 'Voltar',

  keyNames: {
    MediaPlayPause: 'Tocar/pausar',
    MediaNextTrack: 'Próxima',
    MediaPrevTrack: 'Anterior',
    MediaStop: 'Parar',
    VolumeUp: 'Volume +',
    VolumeDown: 'Volume −',
    VolumeMute: 'Sem som',
  },

  tip: {
    missing: 'A macro {{name}} não existe.',
    clicker: 'O TR3 está no modo Clicker: as macros esperam.',
    recording: 'O TR3 está gravando.',
    busy: '{{name}} está rodando.',
    running: 'Uma macro está rodando.',
    modal: 'Uma janela do TR3 espera uma resposta.',
    unsaved: 'A macro aberta tem mudanças não salvas.',
    couldNotStart: 'Não foi possível começar {{name}}.',
    openFailed: 'Não foi possível abrir: {{reason}}',
    keysInvalid: 'Estas teclas não podem ser enviadas: {{combo}}',
    noRoom: 'Não há lugar livre aqui.',
    iconFailed: 'Não foi possível tirar um ícone deste arquivo.',
    imageFailed: 'Não foi possível ler esta imagem.',
  },

  editDone: 'Concluir',

  menu: {
    openFolder: 'Abrir a pasta',
    recordHere: 'Gravar aqui',
    macro: 'Macro',
    noMacros: 'Nenhuma macro ainda',
    allMacros: 'Todas as macros…',
    keys: 'Teclas…',
    text: 'Texto…',
    open: 'Abrir…',
    folder: 'Pasta',
    folderName: 'Pasta',
    command: 'Comando do TR3',
    icon: 'Ícone',
    iconList: 'Da lista…',
    iconApp: 'De um programa…',
    iconCapture: 'Recortar da tela',
    iconPicture: 'Arquivo de imagem…',
    iconDefault: 'Usar o padrão',
    color: 'Cor',
    noColor: 'Sem cor',
    duplicate: 'Duplicar',
    delete: 'Excluir o botão',
    editInTr3: 'Editar no TR3',
    editOnScreen: 'Editar na tela',
    doneEditing: 'Concluir a edição',
    openInTr3: 'Abrir no TR3',
    hide: 'Esconder por agora',
  },

  recordName: '{{deck}} {{n}}',

  picker: {
    export: 'Exportar o deck',
    import: 'Importar um deck',
    filter: 'Deck do TR3',
  },
  file: {
    notDeck: 'Este arquivo não é um deck do TR3.',
    unreadable: 'Não foi possível ler o arquivo do deck: {{reason}}',
  },

  example: {
    name: 'Mídia e sistema',
    clipboard: 'Clipboard',
    snip: 'Recorte',
    files: 'Arquivos',
    calculator: 'Calculadora',
  },
} satisfies Catalogo<typeof en>;
