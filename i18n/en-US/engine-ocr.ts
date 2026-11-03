// O motor: a leitura de texto na tela (OCR) — o serviço (Source/OcrService.cs) e o comparador
// (Source/ScreenTextMatcher.cs). Os textos aparecem no cartão do Test now (screenChecks.tsx: o erro
// como título; o tempo e a variante embaixo, "120 ms · 2× stretch"), nos avisos da instalação de um
// idioma (Settings › Screen Text e o Inspector: "Couldn't install …: {{error}}"), no Run Report e no
// estado das automações. Os nomes dos idiomas (Português, English) ficam no próprio idioma, iguais nos
// dois, e o "Value:" que o motor desenha ao lado de um número curto, para o OCR lê-lo, não é texto da
// tela: fica no código.
//
// Nas lacunas: app = o nome deste app (TrueReplayer 3); tag = a etiqueta de um idioma ("de-DE");
// code = o código de saída do DISM, em hexadecimal de 8 dígitos; value = o que a pessoa digitou para
// comparar; text = o texto a procurar, como foi digitado (cortado em 40 letras).
export default {
  // Nenhum idioma de OCR instalado: o erro de toda leitura (Test now, Wait Text, a condição Text on
  // screen, as automações). Settings › Screen Text › Install é o caminho na página (common.pages.
  // settings, settings.categories.screen, settings.rows.ocrLanguage.install); o resto é o caminho no
  // Windows, com os nomes das Configurações do Windows.
  noLanguage: 'No OCR language installed. Settings → Screen Text → Install, or Windows Settings → Time & language → Language & region → add a language with "Optical character recognition".',

  // Por que a instalação de um idioma falhou: entra depois de dois-pontos, no aviso da página
  // (settings.ocrInstall.failed, inspector.missing.failed).
  install: {
    notOffered: "'{{tag}}' is not a language {{app}} installs.",
    dismNotStarted: 'DISM did not start.',
    stillInstalling: 'Windows is still installing after 20 minutes. Check again later in Settings.',
    failed: 'Windows could not add the pack (DISM 0x{{code}}).',
  },

  // A preparação da imagem que deu a leitura, ao lado do tempo no cartão do Test now. 2× e 3× = a
  // imagem ampliada; stretch = o contraste esticado; colour key = só os pixels perto da cor do texto;
  // + label = com o rótulo que ajuda a ler um número curto; off-screen = a região estava fora da tela.
  variant: {
    double: '2×',
    doubleStretch: '2× stretch',
    doubleKey: '2× colour key',
    tripleKey: '3× colour key',
    doubleLabel: '2× + label',
    tripleKeyLabel: '3× colour key + label',
    offScreen: 'off-screen',
  },

  // O valor a comparar no modo Number não é um número: erro da leitura (Test now, Run Report).
  notNumber: "Value is not a number: '{{value}}'",

  // O resumo da condição na coluna Key do Copy as text e no detalhe do Run Report: os mesmos da coluna
  // Details da lista (list.details.textHas e textRegex). No modo Number o resumo é só o símbolo e o
  // número ("> 30"), igual nos dois idiomas.
  summary: {
    has: 'has "{{text}}"',                // operador Contains
    regex: 'regex {{text}}',              // operador Regex (padrão)
  },
} as const;
