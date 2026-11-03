// Os estados vazios com uma saída (shell/empty/Empties.tsx): a lista de uma macro sem passos e a
// biblioteca sem macros ou sem resultado na pesquisa. A biblioteca é estreita: as frases quebram linha,
// centradas.
export default {
  // A lista da macro aberta, sem passos. O botão é Record (common.actions.record), com a tecla.
  steps: {
    title: 'No steps yet',
    text: 'Record the task, or add steps one by one. Steps copied from another macro paste here with Ctrl+V.',
  },
  // A biblioteca sem macro nenhuma (o primeiro uso está ao lado).
  library: {
    title: 'No macros yet',
    text: 'Each macro you make shows up here, saved as you go.',
  },
  // A pesquisa da biblioteca não achou nada. query = o que foi digitado, entre aspas.
  noMatch: {
    title: 'No macros match “{{query}}”',
    create: 'Create macro “{{name}}”',          // link: cria uma macro com esse nome · name = o que foi digitado
    examples: 'Look for it in the examples',    // link: abre os exemplos já pesquisando o mesmo
  },
} as const;
