import type en from '../en-US/engine-browser.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  // Como o Inspector diz (inspector.missing.extension).
  notConnected: 'A extensão do navegador não está conectada.',
  unknownError: 'Erro desconhecido',
  unknownAction: 'Tipo de ação de navegador desconhecido: {{type}}',

  // A ponte é um detalhe interno: quem lê vê a extensão, como a barra de status diz ("Extensão
  // desconectada") e o relatório da execução também (engine-run, "a extensão do navegador se desconectou").
  disconnected: {
    running: 'A extensão do navegador se desconectou enquanto a ação rodava.',
    beforeSend: 'A extensão do navegador se desconectou antes de a ação ser enviada.',
    // Os verbos sem particípio evitam a concordância com "o Chrome ou a extensão".
    tip: 'O Chrome ou a extensão do TrueReplayer fechou, recarregou ou reiniciou. Reconecte e rode de novo.',
  },

  // "deu timeout", como o Inspector diz da espera (browser.condition.waitEmpty); o passo com artigo
  // (o passo). O fim de cada frase segue o texto dos códigos (dock.codes).
  timeout: {
    click: 'O Click Element deu timeout depois de {{seconds}} s. Elemento não encontrado ou não visível.',
    rightClick: 'O Right Click Element deu timeout depois de {{seconds}} s. Elemento não encontrado ou não visível.',
    type: 'O Type Text deu timeout depois de {{seconds}} s. Campo-alvo não encontrado ou não visível.',
    waitElement: 'O Wait Element deu timeout depois de {{seconds}} s. Elemento não encontrado na página.',
    navigate: 'A página não terminou de carregar em {{seconds}} s.',
    selectOption: 'O Select Option deu timeout depois de {{seconds}} s. O elemento <select> não foi encontrado.',
    generic: 'A ação de navegador deu timeout depois de {{seconds}} s.',
  },
  // O campo Text Match se chama "Texto" no Inspector em pt-BR (browser.textMatch.label); a mira é o
  // botão Escolher elemento.
  timeoutTip: {
    click: 'Use o campo Texto para achar pelo texto visível, ou escolha o elemento com a mira.',
    type: 'Ajuste o seletor CSS ou escolha o elemento com a mira.',
    waitElement: 'Use o campo Texto ou aumente o timeout.',
    navigate: 'Confira a URL e a sua conexão com a internet.',
    selectOption: 'Confira se o seletor CSS aponta para um <select> nativo e se o texto ou o valor da opção corresponde exatamente.',
    generic: 'Confira se a página carregou por completo.',
  },

  withTip: '{{message}} Dica: {{tip}}',
} satisfies Catalogo<typeof en>;
