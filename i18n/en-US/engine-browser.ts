// O motor: os passos de navegador (Source/BrowserBridgeService.cs), a ponte com a extensão do Chrome.
// Os textos saem como a mensagem e a dica de uma falha: no cartão do Test action (browserEditors.tsx,
// o código como título, a mensagem e a dica embaixo), no Run Report (o Dock mostra o texto do código
// quando ele conhece o código, dock.codes, e a mensagem nos outros casos) e no aviso de erro de uma
// execução. Os nomes dos passos (Click Element, Type Text…) são glossário e ficam. As frases que a
// própria extensão manda (content.js, congelada) chegam em inglês e passam como vêm; os códigos
// (ELEMENT_NOT_FOUND…) ficam como código.
//
// Nas lacunas: seconds = o timeout do passo em segundos, inteiro e já formatado (S.Num); message = a
// mensagem de uma falha (do motor ou da extensão); tip = a dica dela; type = o identificador interno
// de um tipo de passo que o motor não conhece (nunca deveria aparecer).
export default {
  // A extensão não está ligada ao app: no Pick element, no Test action e num passo da execução.
  notConnected: 'Browser extension is not connected.',
  unknownError: 'Unknown error',          // a extensão mandou uma falha sem mensagem · frase sozinha
  unknownAction: 'Unknown browser action type: {{type}}',  // erro interno, inalcançável na prática

  // A conexão com a extensão caiu (o Chrome fechou, a extensão recarregou): o código é
  // EXTENSION_DISCONNECTED, que a página não traduz, então a mensagem aparece no Run Report.
  disconnected: {
    running: 'The browser bridge disconnected while the action was running.',
    beforeSend: 'The browser bridge disconnected before the action could be sent.',
    tip: 'Chrome or the TrueReplayer extension was closed, reloaded, or recycled. Reconnect and run again.',
  },

  // O passo esgotou o tempo sem resposta da página (o código é ELEMENT_NOT_FOUND ou, no Open URL,
  // NAVIGATION_TIMEOUT). Uma frase por passo: o nome dele (glossário) e o que faltou.
  timeout: {
    click: 'Click Element timed out after {{seconds}}s. Element not found or not visible.',
    rightClick: 'Right Click Element timed out after {{seconds}}s. Element not found or not visible.',
    type: 'Type Text timed out after {{seconds}}s. Target field not found or not visible.',
    waitElement: 'Wait Element timed out after {{seconds}}s. Element not found on the page.',
    navigate: "Page didn't finish loading after {{seconds}}s.",   // Open URL
    selectOption: "Select Option timed out after {{seconds}}s. The <select> element wasn't found.",
    generic: 'Browser action timed out after {{seconds}}s.',
  },
  // A dica de cada timeout, sob a mensagem. Os rótulos citados são os do Inspector: o campo Text Match
  // (browser.textMatch.label), o seletor CSS (browser.selector.label); a mira é o botão Pick element.
  timeoutTip: {
    click: 'Use the Text Match field to match by visible text, or pick the element with the crosshair.',  // Click e Right Click Element
    type: 'Refine the CSS selector or pick the element with the crosshair.',  // o Type Text não tem Text Match
    waitElement: 'Use the Text Match field or increase the timeout.',
    navigate: 'Check the URL and your internet connection.',
    selectOption: "Verify the CSS selector points to a native <select> and that the option's text/value matches exactly.",
    generic: 'Make sure the page is fully loaded.',
  },

  // A mensagem inteira de uma falha com dica (a que a execução põe no aviso e no relatório).
  withTip: '{{message}} Tip: {{tip}}',
} as const;
