import type en from '../en-US/remaps.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  head: {
    // Do tamanho do inglês (429 contra 434 px): "em todo lugar", como o filtro e a opção.
    sub: 'Uma tecla vira outra, um botão do mouse ou nada, em todo lugar ou em um app',
    paused: 'Pausados',
    pausedTip: 'Os atalhos estão desativados, e os remaps pausam com eles',
    use: 'Usar remaps',
    newRemap: 'Novo remap',
    limit: 'O limite é {{max}}',
  },

  unreadable: {
    backup: 'Não foi possível ler o remaps.json, então aparece o último backup. As mudanças vão para {{pending}} até o arquivo ser substituído.',
    noBackup: 'Não foi possível ler o remaps.json e não há backup, então a lista aparece vazia. As mudanças vão para {{pending}} até o arquivo ser substituído.',
    replace: 'Substituir remaps.json',
  },

  empty: {
    title: 'Nenhum remap ainda',
    text: 'Um remap faz uma tecla virar outra tecla, um botão do mouse ou nada — em todo lugar ou em um app.',
    common: 'Os mais comuns',
    add: 'Adicionar {{from}} para {{to}}',
    // "sem efeito", como rule.off: vale para a tecla e para o botão lateral, sem gênero.
    addNothing: 'Adicionar {{from}} sem efeito',
  },

  nothing: 'Nada',
  everywhere: 'Em todo lugar',

  fields: {
    from: 'Ao apertar',
    does: 'Faz',
    where: 'Onde',
  },

  table: {
    on: 'Ativado',
    actions: 'Ações',
    edit: 'Editar {{rule}}',
    onlyIn: 'Só em {{app}}',
    none: 'Nenhum remap neste filtro.',
  },

  filter: {
    label: 'Filtrar remaps',
    all: 'Todos',
    off: 'Desativados',
  },
  count: '{{n}} de {{max}}',
  importTip: 'Soma os remaps do arquivo aos seus',
  exportTitle: 'Exportar remaps',
  note: {
    saved: { zero: 'Nenhum remap salvo', one: '{{count}} remap salvo', other: '{{count}} remaps salvos' },
    saveFailed: 'Não foi possível salvar o arquivo',
    readFailed: 'Não foi possível ler esse arquivo',
    // Com dois-pontos, a contagem não pede concordância ("Adicionados: 1").
    added: 'Adicionados: {{added}}',
    addedSkipped: 'Adicionados: {{added}} · pulados: {{skipped}}',
  },
  file: {
    notJson: 'Esse arquivo não é um JSON válido',
    notRemaps: 'Esse não é um arquivo de remaps',
    noneUsable: 'Nenhum remap utilizável nesse arquivo',
  },

  menu: {
    label: 'Ações do remap',
    turnOff: 'Desativar',
    turnOn: 'Ativar',
  },

  // O caminho para o Teclado (branch teclado): as teclas de um jogo ficam lá.
  tecladoNote: {
    text: 'Para mudar teclas só com um jogo na frente, e rodar macros pelas teclas dele, use o Teclado.',
    open: 'Abrir o Teclado',
  },

  shortcutsNote: {
    key: 'A tecla dos atalhos ({{key}}) também pausa os remaps, e assim uma única tecla silencia tudo o que o app faz com o teclado. A barra de status mostra quando isso acontece.',
    noKey: 'Desativar os atalhos também pausa os remaps, e assim uma única chave silencia tudo o que o app faz com o teclado. A barra de status mostra quando isso acontece.',
  },

  panel: {
    label: 'Configurações do remap',
    close: 'Fechar configurações do remap',
    // Sem o "só" de table.onlyIn: com "desativado", "Remap · só em RobloxPlayerBeta · desativado" cortava
    // no painel (197 de 188 px), e o inglês cabe. Ao lado de "em todo lugar", o "em" basta.
    sub: {
      everywhere: 'Remap · em todo lugar',
      app: 'Remap · em {{app}}',
      everywhereOff: 'Remap · em todo lugar · desativado',
      appOff: 'Remap · em {{app}} · desativado',
    },
    captureFrom: 'Capturar a tecla do remap',
    captureTo: 'Capturar a tecla que ele envia',
    another: 'Outra tecla',
    mouse: 'Mouse',
    nothingHint: 'A tecla não faz nada enquanto o remap está ativado.',
    // "Direto", como o aviso do Teclado (teclado.mouseNote).
    sideRaw: 'Um jogo que lê o mouse direto recebe também o botão lateral original.',
    oneApp: 'Só em um app',
    mouseTarget: 'Ação do mouse',
    app: 'App',
    appPlaceholder: 'RobloxPlayerBeta.exe',
    running: '{{app}} · rodando agora',
    notRunning: '{{app}} · não está rodando agora',
    elsewhereTypes: 'Em todos os outros apps, {{key}} ainda digita {{typed}}.',
    elsewhereUsual: 'Em todos os outros apps, {{key}} funciona como sempre.',
    foot: 'Aplica ao digitar · Ctrl+Z desfaz',
  },

  capture: {
    listening: 'Esperando — aperte uma tecla',
    change: 'Clique e aperte outra tecla',
    press: 'Clique e aperte uma tecla',
  },

  mouse: {
    LeftClick: 'Clique esquerdo',
    MiddleClick: 'Clique do meio',
    RightClick: 'Clique direito',
    XButton1: 'Botão lateral 1',
    XButton2: 'Botão lateral 2',
    ScrollUp: 'Rolar para cima',
    ScrollDown: 'Rolar para baixo',
  },

  rule: {
    to: '{{from}} para {{to}}',
    toIn: '{{from}} para {{to}} em {{app}}',
    // "sem efeito", e não "desativada": a regra pode ser de um botão lateral (masculino), e a chave da
    // regra, que tem este nome, já diz ativado ou desativado.
    off: '{{from}} sem efeito',
    offIn: '{{from}} sem efeito em {{app}}',
    arrow: '{{from}} → {{to}}',
    arrowNothing: '{{from}} → Nada',
    arrowPending: '{{from}} → …',
    removed: 'Remap {{rule}} removido',
  },

  problem: {
    pressFrom: 'Aperte a tecla do remap.',
    takenInApp: 'Essa tecla já tem um remap neste app.',
    taken: 'Essa tecla já tem um remap.',
    pressTo: 'Aperte a tecla que ele envia.',
    same: 'A origem e o destino são a mesma tecla.',
    nameApp: 'Digite o nome do app ou escolha um que esteja rodando.',
    limit: 'O limite é {{max}} remaps.',
  },
  refuse: {
    combo: 'Só uma tecla por vez — combinações não podem ter remap.',
    wheel: 'A roda do mouse pode ser o destino, não a origem.',
  },

  // Cada nome com o artigo: a lista entra no começo da frase, depois de "Também" (fromWarn, toNote),
  // e assim nenhuma preposição se contrai com ele ("em a", "de a").
  hotkeys: {
    record: 'a hotkey de Gravar',
    replay: 'a hotkey de Reproduzir',
    shortcuts: 'a hotkey dos atalhos',
    front: 'a hotkey de Trazer para a frente',
    clicker: 'a hotkey de Abrir o Clicker',
    clip: 'a hotkey de {{>settings.hotkeys.clip.label}}',  // "Copiar a seleção para um slot", como em Settings › Hotkeys
    screenText: 'a hotkey de Copiar texto da tela',
    macro: 'a macro "{{name}}"',
    and: '{{first}} e {{last}}',
  },
  // A hotkey e a macro são femininas: "dispará-la", "essa hotkey".
  fromWarn: {
    zero: 'Também {{hits}} usam esta tecla — o remap tem prioridade, e essas hotkeys param de disparar.',
    one: 'Também {{hits}} usa esta tecla — o remap tem prioridade, e essa hotkey para de disparar.',
    other: 'Também {{hits}} usam esta tecla — o remap tem prioridade, e essas hotkeys param de disparar.',
  },
  toNote: {
    mouse: {
      zero: 'Também {{named}} usam {{to}} — um aperto remapeado não vai dispará-las (as hotkeys ignoram entrada simulada).',
      one: 'Também {{named}} usa {{to}} — um aperto remapeado não vai dispará-la (as hotkeys ignoram entrada simulada).',
      other: 'Também {{named}} usam {{to}} — um aperto remapeado não vai dispará-las (as hotkeys ignoram entrada simulada).',
    },
    key: {
      zero: 'Também {{named}} usam {{to}} — {{from}} vai dispará-las.',
      one: 'Também {{named}} usa {{to}} — {{from}} vai dispará-la.',
      other: 'Também {{named}} usam {{to}} — {{from}} vai dispará-las.',
    },
    keyHeld: {
      zero: 'Também {{named}} usam {{to}} — {{from}} vai dispará-las com esses modificadores segurados.',
      one: 'Também {{named}} usa {{to}} — {{from}} vai dispará-la com esses modificadores segurados.',
      other: 'Também {{named}} usam {{to}} — {{from}} vai dispará-las com esses modificadores segurados.',
    },
    noFrom: {
      zero: 'Também {{named}} usam {{to}} — a tecla remapeada vai dispará-las.',
      one: 'Também {{named}} usa {{to}} — a tecla remapeada vai dispará-la.',
      other: 'Também {{named}} usam {{to}} — a tecla remapeada vai dispará-las.',
    },
    noFromHeld: {
      zero: 'Também {{named}} usam {{to}} — a tecla remapeada vai dispará-las com esses modificadores segurados.',
      one: 'Também {{named}} usa {{to}} — a tecla remapeada vai dispará-la com esses modificadores segurados.',
      other: 'Também {{named}} usam {{to}} — a tecla remapeada vai dispará-las com esses modificadores segurados.',
    },
  },
} satisfies Catalogo<typeof en>;
