// Os componentes comuns (frontend/src/components/ e components/common/), que todas as telas usam: os
// rótulos que eles mesmos põem quando quem os usa não dá outro. O × de um diálogo (DialogShell.tsx) é
// common.actions.close; os demais rótulos de um diálogo, de um botão ou de um segmentado vêm de quem
// os abre.
export default {
  // As setas ▲ e ▼ da borda direita de um campo numérico (NumberInput.tsx), para o leitor de tela · verbo.
  number: {
    increase: 'Increase',
    decrease: 'Decrease',
  },
  // Os avisos que sobem acima da barra de status (Toast.tsx e state/ToastContext.tsx).
  toast: {
    dismiss: 'Dismiss notification',  // o × de cada aviso (leitor de tela) · verbo
    // O botão do aviso de uma exportação: abre a pasta com o arquivo escolhido · verbo · orçamento: o
    // aviso tem no máximo 380 px, com a frase ao lado.
    showInFolder: 'Show in folder',
  },
  // O aviso de uma exportação (state/ToastContext.tsx), em frases inteiras que se somam: a primeira
  // sempre; as outras só quando acontecem. n = as macros exportadas; total = as pedidas; file = o nome
  // do arquivo gravado; names = as macros que elas rodam, em lista.
  export: {
    done: { one: 'Exported {{n}} macro.', other: 'Exported {{n}} macros.' },
    doneTo: { one: 'Exported {{n}} macro to {{file}}.', other: 'Exported {{n}} macros to {{file}}.' },
    partial: { one: 'Exported {{n}} of {{total}} macro.', other: 'Exported {{n}} of {{total}} macros.' },
    partialTo: { one: 'Exported {{n}} of {{total}} macro to {{file}}.', other: 'Exported {{n}} of {{total}} macros to {{file}}.' },
    notLoaded: '{{n}} could not be loaded.',
    included: { one: 'Included {{n}} macro they run: {{names}}.', other: 'Included {{n}} macros they run: {{names}}.' },
    missingImages: { one: '{{n}} reference image was missing and not included.', other: '{{n}} reference images were missing and not included.' },
  },
  // A tela que fica no lugar da interface quando ela quebra (common/ErrorBoundary.tsx), com o erro
  // técnico embaixo, em inglês (é para o suporte).
  crash: {
    title: 'The interface hit an error',
    body: "Your macros and recordings are safe — this only affected the window's rendering. Reload to continue; if it keeps happening, the text below says where.",
    reload: 'Reload interface',  // o botão · verbo
  },
} as const;
