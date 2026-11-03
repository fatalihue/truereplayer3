// O motor: o Copiar como texto (o Copy as table do menu More ▸ do passo e do Ctrl+K;
// Source/ClipboardService.cs), todos os passos da macro numa tabela que vai para uma planilha ou um
// e-mail, com a linha do resumo em cima; e a coluna Key dela (ActionItem.DisplayKey, que o relatório
// da execução também cita: "Wait Image timed out (…)").
// A tabela segue o idioma da interface: o cabeçalho, o resumo, as durações e a coluna Key. Os nomes
// dos passos (Left Click, Run Macro, For Each Row…) são glossário e ficam fora do catálogo, iguais nos
// dois idiomas: são os da lista (frontend/src/shell/list/stepTypes.ts). Os dias da condição Time
// saem da cultura do idioma (S.Culture), não daqui.
// Os textos da coluna Key que a lista também mostra são os da coluna Details dela (list.details), no
// mesmo idioma: a tabela colada se lê como a lista.
export default {
  // O cabeçalho das colunas: só o substantivo. "#", "X" e "Y" não têm idioma e ficam no código.
  head: {
    action: 'Action',   // o nome do passo (glossário); a coluna que a lista chama de Step
    key: 'Key',         // o que o passo usa: a tecla, o slot, a janela, o programa, o seletor, a condição…; a coluna que a lista chama de Details
    delay: 'Delay',     // coringa (glossário)
    notes: 'Notes',     // a nota de cada passo
  },

  // A linha de cima da tabela (o "# " do texto fica no código). n = os passos, já formatado (S.Num);
  // total = a soma dos delays, já escrita como uma das durações abaixo.
  summary: 'Actions: {{n}} | Total delay: {{total}}',

  // As durações da coluna Delay e do resumo, curtas. ms = os milissegundos (menos de 1000);
  // s = os segundos, com uma casa decimal (S.Fixed: 1.5 / 1,5); m = os minutos inteiros.
  duration: {
    millis: '{{ms}}ms',
    seconds: '{{s}}s',          // também o tempo de um passo Pause na coluna Key ("F4 / 1.5s"), com até duas casas
    minutes: '{{m}}m {{s}}s',
  },

  // A coluna Key: o resumo de cada passo, numa linha curta.
  key: {
    clearAll: 'clear all slots',              // Copy to Slot no modo Clear, sem slot escolhido
    clearSlot: 'clear {{clip}}',              // Copy to Slot no modo Clear · clip = o token do slot, como {clip:a}
    changes: 'changes',                       // Wait Text no modo Changes: espera o texto da região mudar · verbo, minúscula
    fromScreen: '{{name}} ← screen',          // Set Variable no modo Screen: o valor é lido da tela · name = a variável
    fromScreenNumber: '{{name}} ← screen #',  // o mesmo, lido como número
    // Activate Window. window = o processo e o título da janela ("chrome · Gmail"), com " #2" quando
    // vale a segunda que casa; path = o programa que abre quando não há janela para procurar (cortado
    // com "..." depois de 37 letras). Os verbos são os do Inspector.
    window: {
      maximize: 'Maximize · {{window}}',
      minimize: 'Minimize · {{window}}',
      close: 'Close · {{window}}',
      launch: '{{window}} — launch',                     // ativa a janela, ou abre o programa se nenhuma casa
      maximizeLaunch: 'Maximize · {{window}} — launch',
      run: 'run: {{path}}',                              // só o programa a abrir, sem janela para procurar
    },
  },
} as const;
