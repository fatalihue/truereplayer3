// O trilho, à esquerda (shell/Rail.tsx): os cinco destinos. Os nomes deles estão em common.pages.
export default {
  nav: 'Destinations',                                     // nome do trilho para o leitor de tela
  backToMacros: 'Back to the macros — the Clicker stops',  // dica de Macros com o Clicker ligado
  // Dica de Automations enquanto há automações armadas; o selo mostra o número.
  automationsArmed: { one: '{{>common.pages.automations}} · {{count}} armed', other: '{{>common.pages.automations}} · {{count}} armed' },
} as const;
