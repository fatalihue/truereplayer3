// O primeiro uso (shell/firstrun/FirstRun.tsx): sem macro nenhuma, a tela que faz a primeira, no lugar
// da macro. Três jeitos de começar, cada um num cartão (título, texto e botão), lado a lado; com os
// dados do TrueReplayer 2 neste computador, o primeiro jeito é trazê-los (o título e o aviso desse
// cartão estão em shell.import). Os títulos e os textos dos cartões quebram linha.
// Nas lacunas: app = o nome deste app; tr2 = o do TrueReplayer 2 (marcas, appIdentity.ts).
export default {
  title: 'Make your first macro',   // o título da tela e o nome dela para o leitor de tela
  lead: 'A macro is a list of steps — clicks, keys, text and waits — that {{app}} plays back for you, as many times as you want.',

  record: {
    title: 'Record it',             // o botão do cartão é Record (common.actions.record), com a tecla
    text: 'Do the task once. Every click and key you press becomes a step.',
  },
  build: {
    title: 'Build it step by step',
    text: 'Pick steps from the catalog — click, key, text, wait, if — and fill them in.',
    button: 'Add step',             // abre o catálogo do Add step, como o botão da fileira de inserção
  },
  example: {
    title: 'Start from an example',
    // Sem número: quantos são, a galeria diz no rodapé (examples.count), com a conta do pacote.
    text: 'Short macros that show text tokens, variables, conditions and tables. Each one types into Notepad, so you can watch it work.',
    button: 'Browse examples',
  },

  // O cartão do TrueReplayer 2 diz o que vem: "Your 141 macros in 15 folders, settings, key remaps and
  // theme, as a copy: …". parts = a lista (list), feita das partes que o 2 tem.
  tr2: {
    text: 'Your {{parts}}, as a copy: {{tr2}} stays as it is.',
    list: '{{first}} and {{last}}',   // first = as primeiras partes, separadas por vírgula; last = a última
    // As partes, no meio da frase (minúscula). As macros vêm de shell.import (macros, macrosInFolders).
    settings: 'settings',
    remaps: 'key remaps',
    theme: 'theme',
  },

  // A faixa tracejada embaixo: um arquivo de macro solto aqui entra.
  drop: 'Have a macro file? Drop it here, or',   // seguido do botão Import… (common.actions.importEllipsis)
  dropOnly: 'Only a .trprofile file, a macro export, comes in here.',   // aviso: o arquivo solto não é de macro
  dropUnreadable: 'That file can’t be read from here. Save it to a folder first, or use {{>common.actions.importEllipsis}}.',  // aviso

  // Como uma macro roda: as duas teclas globais e a da própria macro. O rótulo de cima é Record, Replay
  // (common.actions) e shortcut, com a tecla; o texto vai embaixo.
  how: {
    label: 'How a macro runs',      // nome da seção para o leitor de tela
    // Não "from any app": com os atalhos desativados, a tecla só para uma gravação que já começou.
    record: 'Starts recording. Press it again to stop.',   // a mesma forma do replay
    replay: 'Plays the macro. Press it again to stop.',
    shortcut: 'Shortcut',           // rótulo · nome
    // Não "from any app": com uma janela-alvo e sem Bring to focus, a tecla só dispara com ela na frente.
    shortcutText: 'Give the macro its own key to run it without coming back to {{app}}.',
  },
} as const;
