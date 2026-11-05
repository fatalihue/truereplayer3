import type en from '../en-US/settings.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  categories: {
    general: 'Geral',
    hotkeys: 'Hotkeys',
    appearance: 'Aparência',
    recording: 'Gravação e reprodução',
    screen: 'Screen Text',
    browser: 'Extensão do navegador',
    diagnostics: 'Diagnóstico',
  },
  language: {
    label: 'Idioma',
    hint: 'O idioma do app inteiro. Windows segue o idioma do Windows.',
    windows: 'Windows',
    english: 'English',
    portugues: 'Português',
  },

  categoriesLabel: 'Categorias das configurações',

  search: {
    field: 'Pesquisar configurações',
    results: 'Resultados da pesquisa',
    none: 'Nenhuma configuração corresponde a “{{query}}”',
  },

  update: {
    readyVersion: 'A versão {{version}} está pronta para instalar',
    ready: 'Uma atualização está pronta para instalar',
    restart: 'Reiniciar e atualizar',
    check: 'Procurar atualizações',
    checking: 'Procurando…',
    upToDate: 'Atualizado',
    failed: 'Falha ao procurar — tentar de novo',
  },

  reset: {
    button: 'Redefinir…',
    title: 'Redefinir todas as configurações',
    body: 'Todas as configurações voltam ao padrão.',
    keeps: 'Suas macros, os passos delas e os presets do Clicker ficam. Não é possível desfazer.',
  },
  busy: 'Pare a execução ou a gravação antes',

  groups: {
    window: 'Janela',
    startup: 'Inicialização',
    runEnds: 'Ao fim de uma execução',
    runEndsNote: 'Só com a janela atrás de outra — em geral, a do jogo.',
    interface: 'Interface',
    files: 'Seus arquivos',
    reset: 'Redefinir',
    recording: 'Gravação',
    playback: 'Reprodução',
    playbackNote: 'O padrão das macros que não têm o seu; cada macro pode ter o seu em {{>common.actions.replay}} ▾.',
    tuning: 'Ajuste do Game Mode',
    // O nome da chave Game move vem da página do Clicker (clicker.tuning.gameMove).
    tuningNote: 'Para todas as macros e para o {{>clicker.tuning.gameMove}} do Clicker.',
    textRecognition: 'Reconhecimento de texto',
    textRecognitionNote: 'Usado pelo Wait Text, pelo Text on screen, pelo modo {{>editors.variable.screen}} do Set Variable, pelas automações e pela hotkey “{{>settings.hotkeys.screenText.label}}”.',
    diagnostics: 'Quando algo dá errado',
    // As hotkeys do grupo são ações (verbos), e o título fica diferente da categoria "Gravação e reprodução".
    recordReplay: 'Gravar e reproduzir',
    clicker: 'Clicker',
    clickerNote: 'Só enquanto o Clicker está ativado.',
    screenClipboard: 'Tela e clipboard',
  },

  rows: {
    tray: {
      label: 'Fechar mantém o {{app}} na bandeja',
      hint: 'O X esconde a janela na bandeja em vez de fechar o app.',
      words: 'bandeja sistema minimizar fechar esconder',
    },
    compactRun: {
      label: 'Janela compacta ao rodar uma macro',
      hint: 'Quando uma execução começa e você alterna para outro app, a janela fica compacta.',
      words: 'compacta pequena mini picture in picture sempre visível por cima sobreposição rodar execução',
    },
    // O rótulo diz o que o ajuste faz; a dica, quando.
    runOnStartup: {
      label: 'Abrir com o Windows',
      hint: 'Abre quando você entra no Windows.',
      words: 'inicialização iniciar login entrar automático',
    },
    startMinimized: {
      label: 'Iniciar minimizado',
      hint: 'Aberto com o Windows, ele começa na bandeja.',
      words: 'escondido oculto bandeja',
      needsStartup: 'Ative o “{{>settings.rows.runOnStartup.label}}” antes',
    },
    runAsAdmin: {
      label: 'Executar como administrador',
      hint: 'A partir da próxima vez que o {{app}} abrir; o Windows pede permissão. Necessário para clicar em janelas executadas como administrador.',
      words: 'elevado UAC admin',
    },
    // "Piscar ao terminar" não passa na terminologia: replay é "reproduzir".
    runEndFlash: {
      label: 'Piscar ao terminar de reproduzir',
      hint: 'Pisca o botão na barra de tarefas.',
      words: 'avisar notificar barra de tarefas',
    },
    runEndSound: {
      label: 'Som ao terminar de reproduzir',
      hint: 'Toca o som do Windows — outro se a execução falhou.',
      words: 'avisar notificar bipe áudio',
    },
    dataFolder: {
      label: 'Abrir pasta de dados',
      hint: 'Suas macros, as imagens delas, as configurações, o tema e os snippets, em uma pasta só. Copie-a para guardar tudo.',
      words: 'documentos arquivos backup cópia copiar mover imagens Explorador',
    },
    importTr2: {
      label: 'Importar do {{tr2}}',
      hint: 'Uma cópia das macros, das configurações, dos remaps, do tema e dos snippets dele. O {{tr2}} não é alterado.',
      words: 'importar copiar migrar antigo versão anterior',
    },
    reset: {
      label: 'Redefinir todas as configurações',
      hint: 'Todas as configurações voltam ao padrão. Suas macros, os passos delas e os presets do Clicker ficam.',
      words: 'padrões restaurar fábrica',
    },

    realTiming: {
      label: 'Gravar o tempo real',
      hint: 'Desativado: cada clique e cada tecla gravados recebem o delay abaixo, em vez do tempo que você levou.',
      words: 'delay tempo',
    },
    delay: {
      label: 'Delay dos passos novos',
      hint: 'O delay com que um passo novo começa: o da fileira de inserção, o da extensão do navegador e o gravado com o tempo real desativado.',
      words: 'ms espera esperar',
    },
    returnCursor: {
      label: '{{>header.replay.returnCursor}}',
      hint: '{{>header.replay.returnCursorTip}}',
      words: 'mouse restaurar posição voltar',
    },
    gameMode: {
      label: 'Game Mode',
      hint: 'O cursor percorre um caminho para os jogos aceitarem o movimento; desativado, ele salta.',
      words: 'suave movimento Roblox caminho jogo',
    },
    fastApproach: {
      label: '{{>header.replay.fastApproach}}',
      hint: 'Teletransporta os movimentos longos e anda só o trecho final. Desative se um jogo errar o clique.',
      words: 'teletransporte acomodar',
    },
    jitter: {
      label: '{{>header.replay.jitter}}',
      hint: '{{>header.replay.jitterTip}}',
      words: 'variação aleatório aleatória delay',
      on: 'Variação ativada',
    },
    clickDelay: {
      label: 'Delay do clique',
      hint: 'Pausa antes de cada evento de botão. Vale também com o Game Mode desativado.',
      words: 'mouse botão apertar',
    },
    pathStep: {
      label: 'Passo do caminho',
      hint: 'Máx. de px por passo. Menor = mais suave, mais lento. ~20 para o Roblox.',
      words: 'suave px',
      noWalk: 'Sem percurso — um salto só',
    },
    // "Delay do passo" se confundiria com o delay dos passos da macro.
    stepDelay: {
      label: 'Delay entre passos',
      hint: 'Espera entre os passos do caminho.',
      words: 'suave ms',
    },
    distance: {
      label: 'Distância',
      hint: 'Trecho percorrido antes do alvo depois de um teletransporte. ~80 px.',
      words: 'aproximação rápida acomodar px',
    },

    ocrLanguage: {
      label: 'Idioma',
      hint: 'Português por padrão; um idioma que falta neste PC se instala daqui.',
      words: 'OCR instalar ler texto português inglês English',
      auto: 'Automático',
      autoWith: 'Automático ({{name}})',
      install: 'Instalar',
      installLabel: 'Instalar o reconhecimento de texto em {{name}}',
      installTip: 'Adiciona o pacote de OCR do Windows para este idioma. O Windows pede permissão; o download vem do Windows Update.',
    },

    copyDiagnostics: {
      label: 'Copiar diagnóstico',
      hint: 'A versão, o sistema e as linhas recentes do log, para relatar um bug.',
      words: 'suporte bug erro relatório sobre versão',
    },
    logs: {
      label: 'Abrir pasta dos logs',
      hint: 'Onde ficam os logs das sessões.',
      words: 'suporte log sessão',
    },
    reload: {
      label: 'Recarregar a interface',
      hint: 'Recarrega a interface; o motor e uma execução em andamento continuam.',
      words: 'atualizar travada congelada',
    },
  },

  ocrInstall: {
    restartApp: 'Reconhecimento de texto em {{name}} instalado — reinicie o {{app}} para usar.',
    restartWindows: 'Reconhecimento de texto em {{name}} instalado — reinicie o Windows para concluir.',
    done: 'Reconhecimento de texto em {{name}} instalado.',
    canceled: 'Instalação cancelada — o Windows precisa da sua permissão para adicionar o pacote.',
    failed: 'Não foi possível instalar o reconhecimento de texto em {{name}}: {{error}}',
    unknownError: 'erro desconhecido',
  },

  browser: {
    words: 'Chrome Edge Brave extensão sem compactação descompactada pasta caminho conectar',
    outdated: 'A versão {{current}} está carregada e este app espera a {{expected}}. Recarregue-a em chrome://extensions.',
    connected: 'A extensão do TrueReplayer está conectada.',
    disconnected: 'Conecte a extensão do TrueReplayer ao Chrome (ou ao Edge).',
    // Os nomes que o Chrome dá em pt-BR.
    steps: {
      open: 'Abra chrome://extensions (Edge: edge://extensions, Brave: brave://extensions).',
      developerMode: 'Ative o "Modo do desenvolvedor".',
      loadUnpacked: 'Clique em "Carregar sem compactação" e escolha esta pasta:',
    },
    copyPath: 'Copiar caminho',
    openFolder: 'Abrir pasta',
    missing: 'Esta pasta não existe. Reinstale o {{app}} para restaurá-la.',
    copied: 'O caminho foi copiado. A extensão se atualiza sozinha junto com o {{app}}.',
    copyFailed: 'Não foi possível copiar o caminho — selecione-o acima. A extensão se atualiza sozinha junto com o {{app}}.',
    updatesItself: 'A extensão se atualiza sozinha junto com o {{app}}.',
  },

  appearance: {
    intro: 'Temas, densidade e movimento. Cada mudança aparece na hora, no app inteiro, e o Ctrl+Z a desfaz.',
    words: 'tema temas cor cores destaque escuro claro Windows vívido vívidas pastel monocromático aleatório meu próprio salvar personalizado densidade compacta normal espaçosa movimento animações texto tamanho fonte cantos arredondamento raio zoom escala dados monoespaçada',
  },

  hotkeys: {
    intro: 'Teclas que funcionam em qualquer lugar do Windows, mesmo com o {{app}} em segundo plano. A hotkey de cada macro fica na própria macro.',
    noticeLabel: 'Hotkeys em teclas que outros apps usam',
    // O aviso só aparece com uma hotkey ou mais; o zero existe pela regra do plural.
    notice: {
      zero: 'Nenhuma hotkey ocupa teclas que outros apps usam.',
      one: '{{count}} hotkey ocupa uma tecla que outros apps usam. Enquanto o {{app}} roda, esses apps deixam de recebê-la.',
      other: '{{count}} hotkeys ocupam teclas que outros apps usam. Enquanto o {{app}} roda, esses apps deixam de recebê-las.',
    },
    useSuggested: 'Usar as teclas sugeridas',
    usedSuggested: 'As teclas sugeridas estão em uso.',
    keepMine: 'Manter as minhas',
    keptMine: 'Suas teclas ficam. Este aviso só volta se outra hotkey ocupar uma tecla que outros apps usam.',
    words: 'hotkey atalho tecla',
    record: {
      label: '{{>header.record.hotkey}}',
      hint: 'Inicia e para a gravação na macro aberta, ou em uma nova quando nenhuma está aberta',
      words: 'gravação',
    },
    replay: {
      label: '{{>header.replay.hotkey}}',
      hint: 'Roda a macro aberta, ou para o que estiver rodando',
      words: 'rodar executar execução tocar',
    },
    shortcuts: {
      label: 'Atalhos ativados ou desativados',
      hint: 'Silencia de uma vez as hotkeys e as hotstrings das macros, os Key Remaps e as hotkeys de gravar, reproduzir e copiar',
      words: 'macro teclas alternar silenciar pausar',
    },
    front: {
      label: 'Trazer o {{app}} para a frente',
      words: 'frente primeiro plano foco mostrar janela',
      noKeyWhy: 'o ícone da bandeja faz isso',
    },
    clicker: {
      label: 'Abrir o Clicker',
      hint: 'Apertada de novo, volta às macros',
      words: 'modo alternar Clicker macro',
    },
    clickerStart: {
      label: 'Iniciar/parar',
      hint: 'Inicia os cliques, ou os para',
      words: 'Clicker autoclicker cliques',
    },
    clickerPause: {
      label: 'Pausar',
      hint: 'Pausa os cliques, ou os retoma',
      words: 'Clicker autoclicker retomar',
    },
    clip: {
      label: 'Copiar a seleção para um slot',
      hint: 'Preenche o próximo {clip:N} para o Send Text',
      words: 'capturar captura slot clipboard seleção',
    },
    screenText: {
      label: 'Copiar texto da tela',
      hint: 'Lê uma região com o Screen Text',
      words: 'OCR ler região clipboard',
    },
  },

  field: {
    none: 'Sem tecla',
    press: 'Aperte a nova tecla…',
    change: 'Alterar',
    listening: 'Aguardando…',
    changeLabel: 'Alterar a hotkey “{{label}}”',
    listeningLabel: 'Aguardando a tecla da hotkey “{{label}}”',
    listeningTip: 'Uma tecla, uma combinação, um botão lateral ou um modificador com a roda · 4 s ou um clique fora cancelam',
    clearLabel: 'Limpar a hotkey “{{label}}”',
    clearTip: 'Sem tecla — a hotkey fica desativada',
    bareWheel: 'Use um modificador com a roda (ex.: Ctrl+ScrollDown) — uma hotkey só de roda bloquearia a rolagem em todo lugar.',
  },

  conflict: {
    tabs: 'Também alterna as guias no Chrome, no Edge e no VS Code',
    ins: 'A tecla Ins também alterna a digitação para o modo Sobrescrever',
    scrollLock: 'O Excel usa o ScrLk',
    minimize: 'O Excel também minimiza uma pasta de trabalho com ela',
    maximize: 'O Excel também maximiza ou restaura uma pasta de trabalho com ela',
    suggested: 'sugestão: {{key}}',
    suggestedNone: 'sugestão: sem tecla',
    suggestedNoneWhy: 'sugestão: sem tecla, {{why}}',
    withSuggestion: '{{note}} · {{suggestion}}',
  },

  region: {
    label: 'Região:',
    fixed: '{{w}}×{{h}} em ({{x}}, {{y}})',
    drag: 'arrastada a cada vez',
    fixedLabel: 'Região: {{w}}×{{h}} em ({{x}}, {{y}}) — desenhar outra',
    dragLabel: 'Região: arrastada a cada vez — fixar uma',
    needsHotkey: 'Defina a hotkey antes',
    fixedTip: '{{w}}×{{h}} em ({{x}}, {{y}}) — ou desenhe outra',
    dragTip: 'Arraste uma região a cada vez — ou fixe uma',
    clearLabel: 'Limpar a região',
    clearTip: 'Volta a arrastar uma região a cada vez',
  },
} satisfies Catalogo<typeof en>;
