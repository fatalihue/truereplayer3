// O motor: a captura na tela (Source/ScreenOverlayWindow.cs) — a barra que ele desenha no alto do
// monitor do cursor enquanto a pessoa escolhe um ponto, uma cor ou uma área — e as recusas da troca de
// forma de um clique entre uma linha e duas, Down + Up (Source/ActionModeConverter.cs).
//
// A barra, da esquerda para a direita: o título e o "para quê" (os dois vêm de quem abre a captura;
// aqui ficam só os títulos padrão); as teclas de um ponto ou a dica de uma área; os botões. Quando
// falta largura no monitor, ela larga primeiro o "para quê", depois as teclas ou a dica; o título e os
// botões ficam sempre. Orçamento: o pt-BR do tamanho do inglês, poucas letras a mais. As teclas dos
// chips (Scroll, Shift, Arrows, Enter, Esc) ficam no código, iguais nos dois idiomas.
export default {
  // Os títulos padrão, quando quem abre a captura não manda o seu · verbo + objeto.
  title: {
    pickColor: 'Pick the color',        // um ponto, para a cor (os conta-gotas)
    pickPoint: 'Pick the point',        // um ponto, para as coordenadas
    drawArea: 'Draw the area',          // uma área, sem imagem (a região de pesquisa)
    captureImage: 'Capture the image',  // uma área, com a imagem (a imagem de referência)
  },
  // A legenda das teclas de um ponto: o rótulo depois de cada chip ("Scroll zoom · Shift slow ·
  // Arrows 1 px · Enter pick"). Uma ou duas palavras, em minúscula.
  keys: {
    zoom: 'zoom',                       // depois de Scroll: a roda muda o zoom da lupa · nome
    slow: 'slow',                       // depois de Shift: o cursor anda devagar · adjetivo
    nudge: '1 px',                      // depois de Arrows: as setas movem 1 pixel
    pick: 'pick',                       // depois de Enter: escolhe o ponto do cursor · verbo
  },
  hint: 'Drag to draw · drag the edges to adjust',  // a dica de uma área, quando quem abre não manda a sua
  // Os botões, à direita, com o chip da tecla ao lado (Esc, Enter) · verbo.
  cancel: 'Cancel',
  keepCurrent: 'Keep current',          // no lugar de Cancel, quando a área salva abre desenhada: Esc a mantém
  done: 'Done',                         // confirma a área desenhada
  slowBadge: 'SLOW',                    // o selo na lupa com o Shift apertado · maiúsculas, ~40 px na borda do disco

  // Por que um clique não troca de forma: a frase vai num aviso, sozinha ("nada mudou") ou depois de
  // "— 1 row left as-is." (WebViewBridge.cs). Uma frase inteira cada. Os rótulos citados são os do
  // Inspector: Times (o campo Repeat do clique, editors.repeat, com a unidade times), at cursor
  // (editors.click.atCursor), focus click (list.focusClick); a forma de duas linhas é a do menu
  // Convert ▸ Two rows (list.menu.twoRows).
  convert: {
    onlyWholeClick: 'Only a whole click can be split into Down + Up.',
    multiClick: 'A double or triple click is one unit — switch it to a single click first.',
    repeating: "A repeating click can't be split — set Times to 1 first.",
    atCursor: "An at-cursor click can't be split — the halves read a stored point.",
    focusClick: "A focus click can't be split — the halves don't fire the focus tap.",
    selectPair: "Select a click's Down half and the Up half that follows it.",
    notSameButton: "These two halves are not the same button's press and release.",
    drag: 'These halves press and release at different points — that is a drag, and only the paired form can express it.',
    mixedSkip: 'One half is turned off and the other is not — merging would switch the whole click on or off.',
  },
} as const;
