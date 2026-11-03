// A galeria dos exemplos (shell/examples/Examples.tsx): os 19 exemplos dentro do app. O conteúdo deles
// (os nomes e as descrições, que vêm do motor) fica em pt-BR nos dois idiomas, por decisão do dono; só a
// galeria se traduz. O motor cria a pasta dos exemplos com o nome "Examples" (até a fatia do motor):
// o pt-BR diz "a pasta dos exemplos", sem citar o nome.
export default {
  title: 'Examples',                // título do diálogo e o nome dele para o leitor de tela
  intro: 'Short macros that show text tokens, variables, conditions and tables. Each one types into Notepad, so you can watch it work. Using one copies it into your library, in the Examples folder.',
  search: 'Search the examples',    // o campo de pesquisa: texto de exemplo e nome

  // Os grupos, pelo que cada exemplo ensina (títulos pequenos, em cima de cada grupo).
  groups: {
    tokens: 'Text tokens',
    variables: 'Variables',
    conditions: 'Conditions',
    together: 'All together',
    more: 'More',                   // os que não cabem nos outros
  },

  // Cada linha: o nome, o tamanho, a descrição, as notas e o botão.
  steps: { one: '{{count}} step', other: '{{count}} steps' },   // count = os passos do exemplo
  runs: 'Runs {{names}}, which comes along.',   // names = o exemplo que este roda (Run Macro), que vem junto
  runBy: 'Run by {{name}}.',                    // name = o exemplo que roda este
  inLibrary: 'In your library',                 // já copiado: o botão ao lado é Open (common.actions.open)
  use: 'Use this example',                      // botão · verbo
  useName: 'Use the example {{name}}',          // nome do botão para o leitor de tela · name = o nome do exemplo
  copying: 'Copying…',                          // o botão enquanto o motor copia

  count: { one: '{{count}} example', other: '{{count}} examples' },   // no rodapé
  noMatch: 'No example matches “{{query}}”.',   // a pesquisa não achou nada · query = o que foi digitado

  // Avisos. name = o nome do exemplo copiado, que abre na biblioteca.
  copied: '“{{name}}” is in your library, in Examples. Open Notepad, then Replay.',
  copyFailed: 'The example could not be copied.',   // quando o motor não diz o erro
} as const;
