import type en from '../en-US/engine-capture.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  // No imperativo, como os títulos que quem abre a captura manda (engine-bridge, capture.title:
  // "Escolha o ponto", "Desenhe a região a ler"): a mesma barra, a mesma forma.
  title: {
    pickColor: 'Escolha a cor',
    pickPoint: 'Escolha o ponto',
    drawArea: 'Desenhe a área',
    captureImage: 'Capture a imagem',
  },
  keys: {
    zoom: 'zoom',
    slow: 'lento',
    nudge: '1 px',
    pick: 'escolher',
  },
  // Curta, para a barra não largar a dica antes do inglês ("arraste as bordas para ajustar" passava
  // de 50 letras).
  hint: 'Arraste para desenhar · ajuste pelas bordas',
  // Como os botões da página (common.actions.cancel e done).
  cancel: 'Cancelar',
  keepCurrent: 'Manter a atual',        // a área atual
  done: 'Concluído',
  slowBadge: 'LENTO',

  // Os rótulos do Inspector em pt-BR: Repetir (com a unidade vezes), No cursor ("o clique no cursor",
  // como editors.click.varyPointCursorTip), Clique de foco, Duas linhas; e as metades Down e Up, como
  // o menu Convert ▸ diz.
  convert: {
    onlyWholeClick: 'Só um clique inteiro pode ser separado em Down + Up.',
    multiClick: 'Um clique duplo ou triplo é uma unidade só — mude-o para um clique simples primeiro.',
    repeating: 'Um clique com repetição não pode ser separado — defina Repetir como 1 primeiro.',
    atCursor: 'Um clique no cursor não pode ser separado — as metades leem um ponto guardado.',
    focusClick: 'Um clique de foco não pode ser separado — as metades não dão o toque de foco.',
    // A mesma frase que o aviso da conversão diz quando não há par (engine-bridge, convert.selectPair).
    selectPair: 'Selecione a metade Down de um clique e a metade Up que vem logo depois.',
    notSameButton: 'Estas duas metades não apertam e soltam o mesmo botão.',
    drag: 'Estas metades apertam e soltam em pontos diferentes — isso é um arrasto, e só a forma em duas linhas consegue representá-lo.',
    mixedSkip: 'Uma metade está desativada e a outra não — juntar ativaria ou desativaria o clique inteiro.',
  },
} satisfies Catalogo<typeof en>;
