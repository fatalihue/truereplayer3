// O que olha a tela (shell/inspector/): a imagem de referência (ImageProbe.tsx) e o recorte dela
// (ReferenceCrop.tsx), o ponto e a cor (PixelCheck) e o texto lido na tela (ScreenTextCheck, em
// screenChecks.tsx), que o If, as esperas, o Set Variable e as automações usam; e as esperas Wait
// Image, Wait Pixel Color e Wait Text (WaitImageEditor.tsx, WaitPixelEditor.tsx, WaitTextEditor.tsx).
// Os campos de região, tolerância e cor (probeKit.tsx) e o Timeout das esperas (WaitTiming.tsx) são
// da área do Inspector; aqui ficam os textos que cada um deles recebe.
//
// Nas lacunas: ms = um tempo em milissegundos, formatado (fmtNum: 30,000 / 30.000); x, y, w e h =
// coordenadas e tamanhos em pixels, sem separador de milhar, como o motor os dá. As lacunas que o
// código desenha à parte (um valor em fonte mono no meio da frase) dizem isso no comentário.
export default {
  // O que a imagem, o ponto e o texto dividem.
  noAnswer: 'No answer from the app.',  // resultado de um teste que o motor não respondeu
  pick: 'Pick',                       // botão: escolhe na tela um ponto ou a cor do texto · verbo
  picking: 'Picking…',                // o mesmo botão, esperando o clique na tela
  testMatch: 'Test match',            // botão: procura agora a imagem ou a cor · em par, 144 px
  testing: 'Testing…',
  tolerance: 'Tolerance',             // rótulo e nome do campo da imagem; rótulo do ponto
  regionSet: 'Search region set around this match.',  // depois de um teste que achou, sem região antes
  // Numa espera pelo sumiço (Disappears): o que o teste diz da espera agora.
  stillOnScreen: 'Still on the screen: the wait goes on.',
  offScreen: 'Not on the screen: the wait ends now.',

  // A imagem de referência: a do Wait Image, a da condição Image found e a das automações.
  image: {
    reference: 'Reference image',     // rótulo da seção e título do recorte
    // Sob a imagem: o tamanho dela e como recortar · w e h = o tamanho em pixels.
    sizeHint: '{{w}} × {{h}} px · press the image to crop it',
    crop: 'Crop reference image',     // nome do botão que é a própria imagem, para o leitor de tela
    cropTip: 'Crop it to the part that matters',
    alt: 'The reference image',       // texto alternativo da imagem
    none: 'No image yet',             // no lugar da imagem, antes da primeira captura
    capture: 'Capture',               // botão em par, 144 px · verbo
    recapture: 'Recapture',
    recaptureTip: 'Capture the image again on the screen',
    chooseFile: 'Choose file…',       // botão em par, 144 px: uma imagem do disco no lugar da captura
    chooseFileTip: 'Use a picture from a file',
    save: 'Save image…',              // botão em par, 144 px
    saveTip: 'Save the image as a PNG file',
    // O resultado de Test match. score = a semelhança em % e point = "x, y", os dois em fonte mono,
    // desenhados à parte (probes.ts, withValues).
    best: 'Best match {{score}} at {{point}}',
    bestBelow: 'Best match {{score}} at {{point}} — below the tolerance',
    // Sob o resultado, quando a condição passa com a imagem não encontrada (a resposta Not found).
    notFoundFails: 'Set to pass when not found: right now it does not pass.',
    notFoundPasses: 'Set to pass when not found: right now it passes.',
    // A região de pesquisa, enquanto é a tela inteira, e a dica do botão Draw.
    wholeHint: 'The whole screen can match the wrong thing, and takes ~440 ms per check instead of ~4 ms.',
    drawTip: 'Faster, and fewer false matches',
    toleranceHint: 'Higher is stricter.',
  },

  // O ponto e a cor: o Wait Pixel Color, a condição Pixel color e a das automações.
  pixel: {
    point: 'Point',                   // rótulo
    x: 'Pixel X',                     // nome do campo, para o leitor de tela
    y: 'Pixel Y',
    pickTip: 'Click a point of the screen: its place and its color',
    target: 'Target color',           // rótulo e nome do campo
    perChannel: 'per channel',        // ao lado do rótulo Tolerance
    toleranceHint: '5–15 for compressed colors.',
    toleranceField: 'Tolerance per channel',  // nome do campo, para o leitor de tela
    setFirst: 'Set X, Y and the target color first.',  // Test match sem o ponto ou sem a cor
    // O resultado de Test match. sampled = a cor lida e target = a cor-alvo com a tolerância
    // ("#2ECC71 ± 10"), as duas em fonte mono, desenhadas à parte.
    sampled: 'Sampled {{sampled}} · Target {{target}}',
    sampledOut: 'Sampled {{sampled}} · Target {{target}} — out of tolerance',
    notFoundFails: 'Set to pass when not found: right now it does not pass.',
    notFoundPasses: 'Set to pass when not found: right now it passes.',
    // Numa espera para a cor sair (Stops matching).
    stillColor: 'Still that color: the wait goes on.',
    notColor: 'Not that color: the wait ends now.',
  },

  // O texto lido na tela (OCR): a condição Text on screen, o Wait Text, o Set Variable no modo Screen e
  // as automações.
  text: {
    region: 'Region to read',         // rótulo do campo da região
    regionRequired: 'Required — reading the whole screen every check is too slow.',  // numa automação
    regionWhole: 'The whole screen takes ~0.5 s per read. Draw a region.',
    regionTip: 'Faster, and reads only what you mean',  // dica do botão Draw
    // Set Variable (Screen) e Wait Text (Changes): o que a região guarda ou observa.
    readAs: 'Read as',                // rótulo e nome do segmentado
    asText: 'Text',                   // opção: o texto inteiro
    number: 'Number',                 // opção: o primeiro número da região · segmentado de 4, 71 px
    numberTip: 'The first number in the region',
    storesText: 'Stores what the region reads.',
    storesNumber: 'Stores the first number in the region.',
    watchesText: 'Watches what the region reads.',
    watchesNumber: 'Watches the first number in the region.',
    // A condição e o Wait Text: como o texto se compara.
    section: 'Text',                  // rótulo
    equalsTip: 'The whole region reads exactly this',
    compare: 'Compare',               // nome do segmentado =, ≠, >, <, para o leitor de tela
    toFind: 'Text to find',           // nome do campo, para o leitor de tela
    placeholder: 'Victory',           // exemplo do texto a encontrar
    regexPlaceholder: '^Level \\d+',  // exemplo de padrão (Regex): Level é palavra do exemplo
    // Sob o campo: o que falta, ou como se compara.
    enterNumber: 'Enter a number to compare with',
    notNumber: 'Not a number',
    enterPattern: 'Enter the pattern to look for',
    noCompile: 'This pattern does not compile',
    noCompileYet: 'This pattern does not compile. Regex is saved once it does.',  // o modo Regex espera o padrão
    enterText: 'Enter the text to look for',
    numberHint: 'The first number in the region.',  // numa automação, que não resolve tokens
    numberHintTokens: 'The first number in the region. Tokens resolve at run time.',
    textHint: 'Ignores case, spaces and accents.',
    textHintTokens: 'Ignores case, spaces and accents. Tokens resolve at run time.',
    // A cor do texto a ler (HUDs de jogo).
    color: 'Text color',              // rótulo e nome do campo
    colorAny: 'Any',                  // o campo vazio: qualquer cor
    colorHint: 'Any. Pick the text color to read game HUDs over a busy scene.',
    colorTip: 'Pick the color of the text on the screen',  // dica do botão Pick
    everyColor: 'Read every color',   // o × que tira a cor: nome e dica
    colorTolerance: 'Color tolerance',  // rótulo e nome do campo
    colorToleranceHint: 'Per channel, 0–255. Higher keeps more pixels.',
    testNow: 'Test now',              // botão · verbo
    reading: 'Reading…',
    // O resultado de Test now. text = o que a região leu, cortado em 80 letras; number = o primeiro
    // número dele, em fonte mono, desenhado à parte.
    nothing: 'Nothing readable',
    reads: 'Reads “{{text}}”',
    readsMatch: 'Reads “{{text}}” — a match',
    readsNoMatch: 'Reads “{{text}}” — no match yet',
    readsNumber: 'Reads “{{text}}” · number {{number}}',
    readsNumberMatch: 'Reads “{{text}}” · number {{number}} — a match',
    readsNumberNoMatch: 'Reads “{{text}}” · number {{number}} — no match yet',
    notFoundFails: 'Set to pass when not found: right now it does not pass.',
    notFoundPasses: 'Set to pass when not found: right now it passes.',
    whatWasRead: 'What was read',     // texto alternativo da imagem do que foi lido
    useText: 'Use this text',         // link: o texto lido vira o texto a encontrar
  },

  // O recorte da imagem de referência, no Inspector expandido.
  crop: {
    fit: 'Fit',                       // opção do zoom, ao lado de 100% e 200% · verbo
    zoom: 'Zoom',                     // nome do segmentado, para o leitor de tela
    // Sob o título: o passo da imagem. name = o nome do passo (glossário); number = a posição dele;
    // total = os passos da macro.
    sub: '{{name}} · step {{number}} of {{total}} · expanded',
    keepTip: 'Keep the crop (Enter)', // dica de Done
    smallerTip: 'Pick a smaller region first',  // Done desativado: o recorte é a imagem inteira
    collapse: 'Collapse editor',      // nome do botão que sai sem recortar, para o leitor de tela
    leaveTip: 'Leave without cropping (Esc)',
    // A linha sobre a imagem · w, h, x e y = o recorte; iw e ih = o tamanho da imagem.
    readout: 'Selection {{w}} × {{h}} px · at {{x}}, {{y}} · image {{iw}} × {{ih}}',
    loading: 'Loading…',
    area: 'Crop region',              // nome da área da imagem, para o leitor de tela
    keys: 'Drag to select · arrows nudge · Shift+arrows resize · Ctrl ×10 · Enter keeps the crop',  // rodapé
    undo: 'Ctrl+Z brings the old image back',  // rodapé, à direita
  },

  // As esperas: o que esperam e a frase que resume cada uma (D13).
  wait: {
    until: 'Wait until',              // rótulo e nome do segmentado
    // Opções de segmentado: de 2 no Wait Image e no Wait Pixel Color (143 px); de 3 no Wait Text (95 px).
    appears: 'Appears',
    disappears: 'Disappears',
    changes: 'Changes',               // Wait Text: a região passa a ler outra coisa · verbo
    changesTip: 'Waits for the region to read something else',
    matches: 'Matches',               // Wait Pixel Color: o ponto fica com a cor
    stopsMatching: 'Stops matching',  // …e o ponto perde a cor
    clickOnFound: 'Click on found location',  // rótulo da linha e nome da chave
    // A frase de cada uma, sob os campos. ms = o timeout. "goes on" e "stops" são o que o timeout faz
    // (On timeout: Continue ou Halt); click, com a chave Click on found location ligada.
    image: {
      goesOn: 'Waits up to {{ms}} ms for the image. If it never shows, the run goes on.',
      stops: 'Waits up to {{ms}} ms for the image. If it never shows, the run stops.',
      clickGoesOn: 'Waits up to {{ms}} ms for the image, then clicks where it is. If it never shows, the run goes on.',
      clickStops: 'Waits up to {{ms}} ms for the image, then clicks where it is. If it never shows, the run stops.',
      goneGoesOn: 'Waits up to {{ms}} ms for the image to go. If it stays, the run goes on.',
      goneStops: 'Waits up to {{ms}} ms for the image to go. If it stays, the run stops.',
    },
    pixel: {
      goesOn: 'Waits up to {{ms}} ms for the point to show the color. If it never does, the run goes on.',
      stops: 'Waits up to {{ms}} ms for the point to show the color. If it never does, the run stops.',
      clickGoesOn: 'Waits up to {{ms}} ms for the point to show the color, then clicks it. If it never does, the run goes on.',
      clickStops: 'Waits up to {{ms}} ms for the point to show the color, then clicks it. If it never does, the run stops.',
      goneGoesOn: 'Waits up to {{ms}} ms for the point to lose the color. If it keeps it, the run goes on.',
      goneStops: 'Waits up to {{ms}} ms for the point to lose the color. If it keeps it, the run stops.',
    },
    text: {
      goesOn: 'Waits up to {{ms}} ms for the text. If it never shows, the run goes on.',
      stops: 'Waits up to {{ms}} ms for the text. If it never shows, the run stops.',
      clickGoesOn: 'Waits up to {{ms}} ms for the text, then clicks it. If it never shows, the run goes on.',
      clickStops: 'Waits up to {{ms}} ms for the text, then clicks it. If it never shows, the run stops.',
      goneGoesOn: 'Waits up to {{ms}} ms for the text to go. If it stays, the run goes on.',
      goneStops: 'Waits up to {{ms}} ms for the text to go. If it stays, the run stops.',
      changesGoesOn: 'Waits up to {{ms}} ms for the region to read something else. If it never does, the run goes on.',
      changesStops: 'Waits up to {{ms}} ms for the region to read something else. If it never does, the run stops.',
    },
  },
} as const;
