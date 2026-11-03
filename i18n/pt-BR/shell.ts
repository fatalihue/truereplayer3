import type en from '../en-US/shell.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  busy: 'Não durante uma execução ou gravação',

  notBuilt: '{{what}} — ainda não existe',

  keys: {
    clickerOn: 'O Clicker está ativado — volte às macros para salvar.',
    saved: 'Salvo',
    notSaved: 'Não salvo — {{error}}',
    couldNotWrite: 'não foi possível gravar o arquivo',
    reverted: 'De volta a quando você a abriu',
  },

  refuse: {
    automations: 'Feche o diálogo aberto e abra {{>common.pages.automations}} de novo.',
    browser: 'Feche o diálogo aberto e abra {{>settings.categories.browser}} de novo.',
  },

  import: {
    title: 'Importar do {{tr2}}',
    intro: 'Uma cópia do que o {{tr2}} tem. O {{tr2}} não muda.',
    notFound: 'Os dados do {{tr2}} não estão neste computador.',
    closeTr2First: 'Feche o {{tr2}} antes: os arquivos dele não podem mudar durante a cópia.',
    // "Abrir com o Windows" é o nome que o ajuste "Run on startup" tem em pt-BR.
    stayOff: 'As automações e o “{{>settings.rows.runOnStartup.label}}” ficam desativados aqui até você ativá-los.',
    backupFirst: 'O que o {{app}} tem agora fica guardado antes em Documentos\\{{dir}}\\Backups.',
    restarts: 'O {{app}} reinicia para terminar.',
    importing: 'Importando…',
    restarting: 'Reiniciando…',

    macros: { zero: 'Nenhuma macro', one: '{{count}} macro', other: '{{count}} macros' },
    folders: { zero: 'nenhuma pasta', one: '{{count}} pasta', other: '{{count}} pastas' },
    images: { zero: 'nenhuma imagem', one: '{{count}} imagem', other: '{{count}} imagens' },
    remaps: { zero: 'Nenhum remap', one: '{{count}} remap', other: '{{count}} remaps' },
    macrosInFolders: '{{macros}} em {{folderCount}}',
    macrosWithImages: '{{macros}} com {{imageCount}}',
    macrosInFoldersWithImages: '{{macros}} em {{folderCount}}, com {{imageCount}}',
    settings: 'Configurações e hotkeys',
    remapsLabel: 'Key Remaps',
    appearance: 'Tema e snippets',

    done: {
      zero: 'Nenhuma macro importada do {{tr2}}. As automações estão desativadas no {{app}} — ative-as em {{>common.pages.automations}}.',
      one: '{{count}} macro importada do {{tr2}}. As automações estão desativadas no {{app}} — ative-as em {{>common.pages.automations}}.',
      other: '{{count}} macros importadas do {{tr2}}. As automações estão desativadas no {{app}} — ative-as em {{>common.pages.automations}}.',
    },
    doneNoCount: 'Importado do {{tr2}}. As automações estão desativadas no {{app}} — ative-as em {{>common.pages.automations}}.',
  },

  coexist: {
    title: 'O {{tr2}} tentou abrir',
    why: 'Só um pode ficar aberto por vez: atalhos, teclas remapeadas, automações e a extensão do navegador entrariam em conflito.',
    switchCloses: 'O {{app}} fecha — tudo já está salvo — e o {{tr2}} abre.',
    closeAndOpen: 'Feche o {{app}} — tudo já está salvo — e abra o {{tr2}} de novo.',
    stay: 'Ficar aqui',
    switchTo: 'Ir para o {{tr2}}',
    closeApp: 'Fechar o {{app}}',
  },
} satisfies Catalogo<typeof en>;
