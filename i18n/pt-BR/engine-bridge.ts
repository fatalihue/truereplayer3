import type en from '../en-US/engine-bridge.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  alert: {
    droppedUnreadable: 'Não foi possível ler o arquivo que você soltou. Use Importar… para escolhê-lo.',

    automation: {
      saveFailed: 'Não foi possível salvar a automação: {{reason}}',
      armFailed: 'Não foi possível ativar ou desativar a automação: {{reason}}',
      unreadable: 'a macro "{{name}}" não pôde ser lida do disco.',
      fileGone: 'o arquivo de "{{name}}" não está mais na pasta Profiles.',
    },

    captureStuck: 'Não foi possível iniciar {{what}}: {{holder}} ainda está aberta e não respondeu. Aperte Esc ou clique nela com o botão direito e tente de novo.',

    image: {
      captureSaveFailed: 'Não foi possível salvar a imagem capturada: {{reason}}',
      cropOpenFailed: 'Não foi possível abrir a imagem de referência para cortá-la.',
      cropSaveFailed: 'Não foi possível salvar a imagem cortada: {{reason}}',
    },

    undoFailed: 'Não foi possível desfazer: {{reason}}',

    convert: {
      nothing: 'Nada para converter',
      fieldsSaved: 'Os campos foram salvos, mas a forma do clique não mudou — {{why}}',
      fieldsSavedNothing: 'Os campos foram salvos, mas a forma do clique não mudou — nada para converter',
      combinedAll: {
        zero: 'Passos convertidos para combinados — nenhum passo no total',
        one: 'Passos convertidos para combinados — {{n}} passo no total',
        other: 'Passos convertidos para combinados — {{n}} passos no total',
      },
      pairedAll: {
        zero: 'Passos convertidos para pareados — nenhum passo no total',
        one: 'Passos convertidos para pareados — {{n}} passo no total',
        other: 'Passos convertidos para pareados — {{n}} passos no total',
      },
      mergedOne: 'Par juntado em uma linha',
      merged: '{{n}} pares juntados',
      splitOne: 'Passo separado em Down + Up',
      split: '{{n}} passos separados em Down + Up',
      leftSelections: {
        zero: '{{done}} — nenhuma seleção ficou como estava. {{why}}',
        one: '{{done}} — 1 seleção ficou como estava. {{why}}',
        other: '{{done}} — {{n}} seleções ficaram como estavam. {{why}}',
      },
      leftRows: {
        zero: '{{done}} — nenhuma linha ficou como estava. {{why}}',
        one: '{{done}} — 1 linha ficou como estava. {{why}}',
        other: '{{done}} — {{n}} linhas ficaram como estavam. {{why}}',
      },
      dwellOne: '{{done}} — os {{ms}} ms com o botão apertado foram descartados. Um clique em uma linha só guarda o tempo apertado a partir de 200 ms; Ctrl+Z traz as duas linhas de volta.',
      dwellMany: '{{done}} — {{ms}} ms com o botão apertado foram descartados no total. Um clique em uma linha só guarda o tempo apertado a partir de 200 ms; Ctrl+Z traz as linhas originais de volta.',
    },

    browserMissing: {
      zero: 'A extensão do Chrome não está conectada.',
      one: 'A extensão do Chrome não está conectada — 1 linha de navegador não vai funcionar. As condições de navegador dão "não encontrado", e a macro pode seguir pelo caminho errado sem dar erro.',
      other: 'A extensão do Chrome não está conectada — {{n}} linhas de navegador não vão funcionar. As condições de navegador dão "não encontrado", e a macro pode seguir pelo caminho errado sem dar erro.',
    },

    saveFailed: 'Não foi possível salvar "{{name}}": {{reason}}',

    targetNotOpen: 'A janela-alvo não está aberta: {{label}}',

    diagnosticsCopied: 'Diagnóstico copiado para o clipboard',
    diagnosticsFailed: 'Não foi possível copiar o diagnóstico',

    copy: {
      clipboardFailed: 'Não foi possível copiar os passos para o clipboard. Tente de novo.',
      copied: { zero: 'Nenhum passo copiado', one: '{{n}} passo copiado', other: '{{n}} passos copiados' },
      none: 'Nenhum passo copiado',
      pasted: { zero: 'Nenhum passo colado', one: '{{n}} passo colado', other: '{{n}} passos colados' },
    },

    edit: {
      rowChanged: 'Não salvo: essa linha mudou enquanto era editada (a lista ou a macro mudou por baixo).',
      invalidDelay: '"{{value}}" não é um delay válido. Use um número inteiro. Nada foi alterado.',
      invalidCoord: '"{{value}}" não é um {{axis}} válido. Use um número inteiro. Nada foi alterado.',
      negativeDelay: 'Um delay não pode ser negativo ({{value}} ms). Use 0 ou mais. Nada foi alterado.',
      pointNotWhole: 'Esse ponto não é um número inteiro que a tela possa usar — digite X e Y como números inteiros.',
      atCursorSplit: 'Um clique no cursor não pode ser separado — as metades leem um ponto guardado.',
    },

    bulk: {
      none: '(nenhum)',
      delayNoMode: 'O delay não foi alterado: a edição não disse se era Definir ou Somar.',
      delayInvalid: '{{value}} não é um delay válido. Use um número inteiro de milissegundos.',
      delayNegative: 'Um delay não pode ser negativo ({{ms}} ms). Use 0 ou mais, ou Somar para subtrair. Nada foi alterado.',
      delayNone: 'Os passos selecionados não têm delay para alterar (os marcadores de bloco não têm).',
      delayOverflow: 'Somar {{ms}} ms levaria alguns dos passos selecionados além do maior delay possível. Nada foi alterado.',
      delaySame: 'Nada mudou: o delay já é {{ms}} ms nos passos selecionados.',
      delayAddZero: 'Nada mudou: somar 0 ms deixa o delay como estava.',
      delayAtZero: 'Nada mudou: os passos selecionados já estão em 0 ms.',
      delayAdded: { zero: 'Nenhum delay mudou', one: '{{ms}} ms somados ao delay de {{n}} passo', other: '{{ms}} ms somados ao delay de {{n}} passos' },
      delayFloored: { zero: '{{done}} — nenhum parou em 0 ms', one: '{{done}} — {{n}} parou em 0 ms', other: '{{done}} — {{n}} pararam em 0 ms' },
      delaySet: { zero: 'Nenhum delay mudou', one: 'Delay definido como {{ms}} ms em {{n}} passo', other: 'Delay definido como {{ms}} ms em {{n}} passos' },
      coordNoMode: 'O {{axis}} não foi alterado: a edição não disse se era Definir ou Somar.',
      coordInvalid: '{{value}} não é um valor de {{axis}} válido. Use um número inteiro.',
      coordNoClicks: 'X/Y só podem ser definidos em passos de clique do mouse.',
      coordOverflow: 'Somar {{value}} ao {{axis}} levaria alguns dos passos selecionados além da maior coordenada possível. Nada foi alterado.',
      coordAddZero: 'Nada mudou: somar 0 deixa o {{axis}} como estava.',
      coordSame: 'Nada mudou: o {{axis}} já é {{value}} nos cliques selecionados.',
      coordAdded: { zero: 'Nenhum passo mudou', one: '{{value}} somado ao {{axis}} de {{n}} passo', other: '{{value}} somado ao {{axis}} de {{n}} passos' },
      coordSet: { zero: 'Nenhum passo mudou', one: '{{axis}} definido como {{value}} em {{n}} passo', other: '{{axis}} definido como {{value}} em {{n}} passos' },
    },

    cycleReset: 'Ciclo \'{{name}}\' voltou ao primeiro item',
    nextRow: 'A próxima execução começa na linha {{row}}',
    rowReset: 'A posição do Data Loop voltou à primeira linha',

    imageInsert: {
      conditionSaveFailed: 'Não foi possível salvar a imagem capturada, então nenhuma condição foi inserida: {{reason}}',
      stepSaveFailed: 'Não foi possível salvar a imagem capturada, então nenhum passo foi inserido: {{reason}}',
      recaptureSaveFailed: 'Não foi possível salvar a nova imagem capturada — o passo continua com a antiga: {{reason}}',
      fileUnusable: 'Não foi possível usar esse arquivo como imagem de referência: {{reason}}',
      gone: 'Essa imagem de referência não está mais no disco. Capture-a de novo.',
      savedAs: 'Imagem salva como {{file}}',
      saveAsFailed: 'Não foi possível salvar a imagem: {{reason}}',
      cropSaveFailed: 'Não foi possível salvar a imagem cortada: {{reason}}',
    },

    screenText: {
      readFailed: 'Não foi possível ler a região: {{reason}}',
      noneRead: 'Nenhum texto lido nessa região — digite-o no editor ou tente a Cor do texto.',
      none: 'Nenhum texto encontrado nessa região',
      clipboardBusy: 'Não foi possível escrever no clipboard — outro app está com ele. Tente de novo.',
      copiedLines: '{{n}} linhas copiadas: "{{text}}"',
      copied: 'Copiado: "{{text}}"',
      failed: 'Não foi possível copiar o texto da tela: {{reason}}',
    },

    target: {
      notOpenPick: 'A janela-alvo não está aberta: {{label}}. Abra-a e escolha de novo.',
      minimisedPick: 'A janela-alvo está minimizada: {{label}}. Restaure-a e escolha de novo.',
    },

    runRefuse: {
      replay: 'Uma reprodução está rodando — pare-a antes. {{why}}',
      recording: 'Uma gravação está rodando — pare-a antes. {{why}}',
      picker: 'Uma escolha em tela cheia cobriria a execução e engoliria a tecla de parar.',
      detection: 'A detecção da janela usa o próximo clique que você der, e a execução está usando o mouse.',
    },

    anchor: {
      unnamedPoint: 'Identifique primeiro a janela que as coordenadas seguem (o nome do processo ou o título da janela) — até lá, não há origem para guardar o ponto.',
      closedPoint: 'A janela que as coordenadas seguem não está aberta (ou está minimizada) — restaure-a e escolha de novo, ou desative "Relativo a uma janela".',
      unnamedRegion: 'Identifique primeiro a janela que as coordenadas seguem (o nome do processo ou o título da janela) — até lá, não há origem para guardar a região.',
      closedRegion: 'A janela que as coordenadas seguem não está aberta (ou está minimizada) — restaure-a e defina a região de novo, ou desative "Relativo a uma janela".',
    },

    clickerPresetsFull: 'Os presets do Clicker são limitados a {{max}}. Exclua um para salvar outro.',
    clickerPresetsFullRestore: 'Os presets do Clicker são limitados a {{max}}. Exclua um para restaurar "{{name}}".',

    admin: {
      cancelled: 'A reinicialização como administrador foi cancelada.',
      failed: 'Não foi possível reiniciar como administrador.',
    },

    macro: {
      switchBusy: 'Pare a gravação ou a reprodução antes de trocar de macro.',
      openGone: 'Não foi possível abrir "{{name}}" — o arquivo dela não está mais na pasta Profiles.',
      openFailed: 'Não foi possível abrir "{{name}}": {{reason}}',
      revertBusy: 'Pare a gravação ou a reprodução antes de reverter a macro.',
      revertNone: 'Não há macro aberta para reverter.',
      revertUnreadable: 'o arquivo dela não pôde ser lido de volta',
      revertFailed: 'Não foi possível reverter "{{name}}": {{reason}}',
      invalidName: 'Nome de macro inválido.',
      nameTaken: 'Já existe uma macro chamada "{{name}}"',
      createFailed: 'Não foi possível criar a macro: {{reason}}',
      updateFailed: 'Não foi possível atualizar "{{name}}": {{reason}}',
      duplicateFailed: 'Não foi possível duplicar "{{name}}": {{reason}}',
      renamedRefs: {
        zero: 'Renomeada para \'{{name}}\'.',
        one: 'Renomeada para \'{{name}}\', e {{n}} referência do Run Macro foi atualizada.',
        other: 'Renomeada para \'{{name}}\', e {{n}} referências do Run Macro foram atualizadas.',
      },
      renameFailed: 'Não foi possível renomear "{{name}}": {{reason}}',
      imagesLeftBehind: 'Renomeada para "{{name}}", mas algumas imagens de referência estavam em uso e ficaram com o nome antigo. Os passos de imagem dela podem não encontrá-las até a próxima abertura, que as move.',
      deletedDangling: {
        zero: 'Macro \'{{name}}\' excluída.',
        one: 'Macro \'{{name}}\' excluída. {{n}} referência em outras macros ficou sem destino e não vai fazer nada ao reproduzir.',
        other: 'Macro \'{{name}}\' excluída. {{n}} referências em outras macros ficaram sem destino e não vão fazer nada ao reproduzir.',
      },
      deleteFailed: 'Não foi possível excluir "{{name}}": {{reason}}',
      gone: '"{{name}}" não existe mais — foi renomeada ou excluída. Nada foi alterado.',
    },

    hotkey: {
      usedBy: '"{{hotkey}}" já é usada pela {{conflict}}.',
      hotstringUsedBy: 'A hotstring "{{sequence}}" já é usada pela {{conflict}}.',
      removeTargetHotkey: 'Não é possível remover a janela-alvo: a hotkey "{{hotkey}}" entraria em conflito com a {{conflict}}.',
      removeTargetHotstring: 'Não é possível remover a janela-alvo: a hotstring "{{sequence}}" entraria em conflito com a {{conflict}}.',
      removeFolderTargetHotkey: 'Não é possível remover a janela-alvo da pasta: a hotkey "{{hotkey}}" de "{{name}}" entraria em conflito com a {{conflict}}.',
      removeFolderTargetHotstring: 'Não é possível remover a janela-alvo da pasta: a hotstring "{{sequence}}" de "{{name}}" entraria em conflito com a {{conflict}}.',
      appVsMacro: '"{{hotkey}}" é usada pela {{conflict}}, então a macro "{{name}}" com as mesmas teclas não vai disparar. Mude uma delas (Configurações › Hotkeys, ou a hotkey da macro).',
      clickerSame: '"{{hotkey}}" é ao mesmo tempo a hotkey “Iniciar/parar” e a “Pausar” do Clicker.',
      saveFailed: 'Não foi possível salvar a hotkey de "{{name}}": {{reason}}',
      removeFailed: 'Não foi possível remover a hotkey de "{{name}}": {{reason}}',
      hotstringTooShort: 'A hotstring precisa ter pelo menos 2 caracteres (a-z, 0-9, - . / , ; =).',
      hotstringSaveFailed: 'Não foi possível salvar a hotstring de "{{name}}": {{reason}}',
      hotstringRemoveFailed: 'Não foi possível remover a hotstring de "{{name}}": {{reason}}',
      by: {
        macro: 'macro "{{name}}"',
        record: 'hotkey “{{>settings.hotkeys.record.label}}”',
        replay: 'hotkey “Reproduzir ou parar”',
        shortcuts: 'hotkey “Atalhos ativados ou desativados”',
        front: 'hotkey “Trazer o {{app}} para a frente”',
        clicker: 'hotkey “Abrir o Clicker”',
        clip: 'hotkey “Copiar a seleção para um slot”',
        screenText: 'hotkey “Copiar texto da tela”',
        clickerStart: 'hotkey “Iniciar/parar” do Clicker',
        clickerPause: 'hotkey “Pausar” do Clicker',
      },
    },

    window: {
      fillOne: 'Informe pelo menos o nome de um processo ou o título de uma janela.',
      regexInvalid: 'Padrão de regex inválido.',
      regexInvalidCheck: 'Padrão de regex inválido. Confira a sintaxe.',
      folderGone: 'A pasta "{{name}}" não existe mais — foi renomeada ou excluída. Nada foi alterado.',
      detectFailed: 'Não foi possível iniciar a detecção da janela — o Windows recusou o acesso ao mouse. Digite o nome do processo ou o título da janela.',
      convertNeedsTarget: 'Defina o nome de um processo ou o título de uma janela antes de converter.',
      applyNotFound: 'Janela-alvo não encontrada. Abra-a e converta de novo.',
      applyMinimised: 'A janela-alvo está minimizada. Restaure-a e converta de novo.',
      applyNoPosition: 'Não foi possível ler a posição da janela-alvo. Tente de novo.',
    },

    coords: {
      openFirst: 'Abra "{{name}}" antes — converter as coordenadas reescreve os passos da macro que está aberta.',
      runningReplay: 'Uma reprodução está rodando — pare-a antes. Converter reescreve as coordenadas de passos que a execução ainda vai rodar.',
      runningRecording: 'Uma gravação está rodando — pare-a antes. Converter agora deixaria os passos desta macro em dois espaços de coordenadas.',
      noTarget: 'Defina uma janela-alvo antes (na macro ou na pasta).',
      notFound: 'Janela-alvo não encontrada. Confira se ela está aberta e visível.',
      minimised: 'A janela-alvo está minimizada. Restaure-a e converta de novo.',
      noPosition: 'Não foi possível ler a posição da janela.',
      noActions: 'Nenhum passo para converter.',
      inherited: '"{{name}}" herda a janela-alvo da pasta "{{folder}}", e com ela o espaço das coordenadas — esta conversão seria descartada na próxima reprodução e deixaria as coordenadas no espaço errado. Dê antes a esta macro uma janela-alvo própria: em {{>inspector.frame.macroSettings}} › {{>macroSettings.target.title}}, clique em {{>common.actions.edit}} e digite um processo ou um título. Depois converta de novo.',
      convertedRelative: {
        zero: 'Nenhum passo convertido para coordenadas relativas.',
        one: '{{n}} passo convertido para coordenadas relativas.',
        other: '{{n}} passos convertidos para coordenadas relativas.',
      },
      convertedAbsolute: {
        zero: 'Nenhum passo convertido para coordenadas absolutas.',
        one: '{{n}} passo convertido para coordenadas absolutas.',
        other: '{{n}} passos convertidos para coordenadas absolutas.',
      },
    },

    geometry: {
      inherited: '"{{name}}" herda a janela-alvo da pasta "{{folder}}", e com ela a geometria. Capture-a na pasta, ou dê antes a esta macro um alvo próprio.',
      noTarget: 'Detecte ou defina uma janela-alvo antes e depois clique em Atualizar tamanho e posição da janela.',
      minimised: 'A janela-alvo está minimizada. Restaure-a no tamanho e na posição que você quer capturar e clique de novo em Atualizar tamanho e posição da janela.',
      noSize: 'Não foi possível ler o tamanho da janela.',
      folderCaptured: 'Geometria da pasta capturada: {{w}}×{{h}} em ({{x}}, {{y}})',
      windowCaptured: 'Geometria da janela capturada: {{w}}×{{h}} em ({{x}}, {{y}})',
    },

    folder: {
      taken: 'Já existe uma pasta chamada "{{name}}"',
      profilesOpenFailed: 'Não foi possível abrir a pasta Profiles',
      macroOpenFailed: 'Não foi possível abrir a pasta da macro',
      exportOpenFailed: 'Não foi possível abrir a pasta da exportação',
      deleteFailedOne: 'Não foi possível excluir "{{name}}" — o arquivo dela é somente leitura ou está em uso. Ela continua na sua lista.',
      deleteFailedMany: 'Não foi possível excluir {{n}} macros — os arquivos delas são somente leitura ou estão em uso: {{names}}. Elas continuam na sua lista.',
      deletedDangling: {
        zero: 'Pasta "{{name}}" excluída com as macros dela.',
        one: 'Pasta "{{name}}" excluída com as macros dela. {{n}} referência do Run Macro em outras macros ainda aponta para elas e não vai fazer nada ao reproduzir.',
        other: 'Pasta "{{name}}" excluída com as macros dela. {{n}} referências do Run Macro em outras macros ainda apontam para elas e não vão fazer nada ao reproduzir.',
      },
      nowRelative: '"{{name}}" agora lê o X/Y gravado em relação à janela da pasta. Eles não foram convertidos — se os cliques dela caírem no lugar errado, abra-a e rode "Converter coordenadas para relativas" (Ctrl+K).',
      nowAbsolute: '"{{name}}" agora lê o X/Y gravado como posições da tela. Eles não foram convertidos — se os cliques dela caírem no lugar errado, abra-a e rode "Converter coordenadas para absolutas" (Ctrl+K).',
    },

    export: {
      busy: 'Termine a gravação ou a reprodução antes de exportar.',
      noneLoaded: 'A exportação falhou: nenhuma das macros selecionadas pôde ser carregada.',
      failed: 'A exportação falhou: {{reason}}',
    },

    // "Macros do TrueReplayer" é o nome do tipo de arquivo (o filtro do seletor de arquivo).
    import: {
      busy: 'Termine a gravação ou a reprodução antes de importar.',
      tooLarge: 'Esse arquivo é grande demais para importar (mais de 50 MB).',
      parseError: 'Esse arquivo não é uma exportação válida de Macros do TrueReplayer.',
      noMacros: 'Esse arquivo de exportação não tem macros para importar.',
      readError: 'Não foi possível ler esse arquivo: {{reason}}',
      failedGeneric: 'A importação falhou.',
      failed: 'A importação falhou: {{reason}}',
      expired: 'A importação expirou — tente de novo.',
      duplicates: {
        zero: 'Nenhuma macro do arquivo repete o nome de outra.',
        one: 'Este arquivo lista {{n}} macro com um nome que outra macro dele já usa. As cópias aparecem com um número, por exemplo "Fazenda (2)".',
        other: 'Este arquivo lista {{n}} macros com um nome que outra macro dele já usa. As cópias aparecem com um número, por exemplo "Fazenda (2)".',
      },
      skippedInvalid: {
        zero: 'A importação não pulou nenhuma macro.',
        one: 'A importação pulou {{n}} macro com nome inválido.',
        other: 'A importação pulou {{n}} macros com nomes inválidos.',
      },
      done: { zero: 'Nenhuma macro importada.', one: '{{n}} macro importada.', other: '{{n}} macros importadas.' },
      doneWithFolders: {
        zero: 'Nenhuma macro importada. A organização das pastas foi importada.',
        one: '{{n}} macro importada. A organização das pastas foi importada.',
        other: '{{n}} macros importadas. A organização das pastas foi importada.',
      },
      allSkipped: { zero: 'Nenhuma macro foi pulada.', one: 'A macro foi pulada.', other: 'Todas as {{n}} macros foram puladas.' },
      noneImported: 'Nenhuma macro foi importada.',
    },

    settings: {
      resetBusy: 'Pare a gravação ou a reprodução antes de redefinir as configurações.',
      saveFailed: 'Não foi possível salvar suas configurações no disco. Elas ficam nesta sessão, e o app tenta de novo na próxima mudança e ao sair.',
    },
  },

  result: {
    testFire: {
      serviceNotReady: 'O serviço das automações ainda não está pronto.',
      disabled: 'Pulada: esta macro está desativada, então a automação dela nunca roda. Ative-a na biblioteca antes.',
      fired: 'Disparada — a macro está rodando agora.',
      busy: 'Pulada: já há uma reprodução, gravação ou execução do Clicker em andamento. As automações esperam o motor ficar livre.',
      dirty: 'Pulada: a macro aberta tem alterações não salvas. As automações nunca disparam sobre edições não salvas — salve-a antes.',
      modal: 'Pulada: há um diálogo ou uma captura de tecla aberta. Feche e tente de novo.',
      notReady: 'Ainda não: o app está iniciando.',
      nothingRan: 'Nada rodou. A macro pode não ter passos, ou a tabela do Data Loop dela pode estar vazia enquanto ela percorre os dados.',
      failed: 'Falhou: {{reason}}',
    },

    probe: {
      testFailed: 'O teste falhou: {{reason}}',
      imageMissing: 'Imagem de referência não encontrada no disco.',
      pixelUnreadable: 'Não foi possível ler o pixel (fora da tela ou em uma superfície com aceleração de hardware)',
      invalidColor: 'Cor-alvo inválida',
      anchorUnnamed: 'Identifique primeiro a janela que as coordenadas seguem (o nome do processo ou o título da janela) — até lá, não há origem para o teste.',
      anchorClosed: 'A janela que as coordenadas seguem não está aberta (ou está minimizada) — restaure-a e teste de novo, ou desative "Relativo a uma janela".',
      anchorUnnamedShort: 'Identifique primeiro a janela que as coordenadas seguem (o nome do processo ou o título da janela).',
      anchorClosedShort: 'A janela que as coordenadas seguem não está aberta (ou está minimizada).',
    },

    browser: {
      notConnectedTip: 'Abra o Chrome com a extensão do TrueReplayer instalada.',
    },

    window: {
      fillOne: 'Preencha pelo menos o Nome do processo ou o Título para testar.',
      regexInvalid: 'Padrão de regex inválido.',
      noForeground: 'Nenhuma janela em primeiro plano encontrada.',
      fillFirst: 'Preencha antes o Nome do processo ou o Título.',
      noMatch: 'Nenhuma janela casa — abra-a e posicione-a antes.',
      minimised: 'A janela está minimizada — restaure-a no tamanho e na posição que você quer capturar.',
      noRect: 'Não foi possível ler o retângulo da janela.',
      notNth: 'Há janelas que casam, mas não a de número {{n}} — agora o passo não acha nenhuma (e abre o programa de Abrir, se tiver um).',
      notForeground: 'Uma janela casa, mas não está na frente — com “Só a janela da frente”, a condição dá falso até ela estar.',
    },

    examples: {
      busy: 'Termine a gravação ou a reprodução antes de copiar um exemplo.',
      missing: 'Não há exemplo chamado "{{name}}".',
    },
  },

  capture: {
    what: {
      image: 'a captura da imagem',
      imageCondition: 'a captura da imagem da condição',
      pixelCondition: 'a escolha da cor da condição',
      screenText: 'a captura do texto da tela',
      waitImage: 'a captura do Wait Image',
      pixelColour: 'a escolha da cor do pixel',
      recapture: 'a nova captura',
      position: 'a escolha da posição',
      colour: 'a escolha da cor',
      region: 'a escolha da região',
    },
    title: {
      referenceImage: 'Capture a imagem de referência',
      regionToRead: 'Desenhe a região a ler',
      regionToCopy: 'Desenhe a região a copiar',
      searchArea: 'Desenhe a área de pesquisa',
      clickArea: 'Desenhe a área dos cliques',
      point: 'Escolha o ponto',
      clickPoint: 'Escolha o ponto do clique',
      color: 'Escolha a cor',
      aColor: 'Escolha uma cor',
    },
    for: {
      automation: 'para a automação de {{name}}',
      step: 'para o passo {{n}}, {{name}}',
      stepCondition: 'para o passo {{n}}, {{name}} · {{condition}}',
      copyHotkey: 'para a hotkey Copiar texto da tela',
      copyText: 'para Copiar texto da tela',
      clicker: 'para o Clicker',
    },
    hint: {
      automationWaits: 'Arraste em volta do que a automação espera',
      stepWaits: 'Arraste em volta do que o passo espera',
      smallerFaster: 'Regiões menores são lidas mais rápido',
      insideOnly: 'A imagem é procurada só dentro dela',
      toClipboard: 'O texto lido vai para o clipboard',
    },
  },

  dialog: {
    cancel: 'Cancelar',
    deleteFolder: {
      title: 'Excluir pasta',
      // O diálogo só abre com uma macro ou mais (a pasta vazia é excluída sem pergunta); o zero existe
      // pela regra do plural.
      body: {
        zero: 'A pasta "{{name}}" está vazia.\nExcluir só a pasta ou tudo o que tem dentro?',
        one: 'A pasta "{{name}}" tem {{n}} macro.\nExcluir só a pasta ou tudo o que tem dentro?\nCom “{{>engine-bridge.dialog.deleteFolder.deleteAll}}”, o arquivo e as imagens dela são excluídos. Isso não pode ser desfeito.',
        other: 'A pasta "{{name}}" tem {{n}} macros.\nExcluir só a pasta ou tudo o que tem dentro?\nCom “{{>engine-bridge.dialog.deleteFolder.deleteAll}}”, os arquivos e as imagens delas são excluídos. Isso não pode ser desfeito.',
      },
      folderOnly: 'Só a pasta',
      deleteAll: 'Excluir tudo',
    },
    resetSettings: {
      title: 'Redefinir configurações',
      body: 'Isso volta todas as configurações ao padrão e limpa todos os passos.',
      reset: 'Redefinir',
    },
  },

  notify: {
    listDone: {
      titleMacro: '{{name}} usou a lista inteira',
      title: 'A lista de dados terminou',
      body: {
        zero: 'A lista não tem linhas. A próxima execução recomeça na linha 1.',
        one: 'A única linha foi usada. A próxima execução recomeça na linha 1.',
        other: 'As {{n}} linhas foram usadas. A próxima execução recomeça na linha 1.',
      },
      open: 'Abrir o Data Loop',
    },
    stopped: {
      titleMacroStep: '{{name}} parou no passo {{n}}',
      titleMacro: '{{name}} parou',
      titleStep: 'A macro parou no passo {{n}}',
      title: 'A macro parou',
      body: 'A execução parou com um erro.',
      openReport: 'Abrir o Run Report',
      runAgain: 'Rodar de novo',
    },
  },

  name: {
    referenceImage: 'Imagem de referência.png',
    macroReferenceImage: '{{name}} - imagem de referência.png',
    copy: '{{name}} - Cópia',
    copyNumbered: '{{name}} - Cópia ({{n}})',
  },

  update: {
    reason: {
      recording: 'uma gravação está em andamento',
      replaying: 'uma reprodução está rodando',
      open: '{{what}} está aberta',
      editor: 'um editor aberto tem alterações que não foram aplicadas',
      unsaved: 'a macro tem alterações não salvas',
      promptCancelled: 'a pergunta das alterações não salvas foi cancelada',
    },
    postponed: 'Atualização adiada: {{reason}}',
    postponedNotice: 'Uma atualização está pronta, mas não foi instalada porque {{reason}}. Ela volta a ser oferecida quando o app estiver livre — ou instale quando quiser com Reiniciar e atualizar, no fim das Configurações.',
    checkFailed: 'Não foi possível procurar atualizações',
    downloadFailed: 'Falha no download',
    downloadFailedNotice: 'Não foi possível baixar a atualização. Ela será tentada de novo na próxima verificação.',
    failed: 'A atualização falhou: {{reason}}',
    applyFailedNotice: 'Não foi possível aplicar a atualização: {{reason}}. O {{app}} continua na versão atual.',
  },
} satisfies Catalogo<typeof en>;
