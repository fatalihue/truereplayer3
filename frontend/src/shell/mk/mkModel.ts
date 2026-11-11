// PROTÓTIPO (não vai para o main nem para release): como o TrueReplayerMK ficaria dentro do TR3,
// como um modo da casca. Dados falsos, sem motor e sem ponte nova; os textos são literais em pt-BR
// (no código de verdade iriam para o catálogo i18n/). Pedido do dono em 10-11-2026 para decidir
// entre o MK unificado (modo do TR3) e separado (o app em Rust + Slint).

import { Ban, Keyboard, Layers, ListChecks, Mouse, Type, type LucideIcon } from 'lucide-react';

/** As funções de uma tecla, as do plano do MK ("O produto (v1)"). */
export type FnKind = 'default' | 'key' | 'mouse' | 'macro' | 'text' | 'off' | 'layer';
export type MacroMode = 'once' | 'times' | 'hold' | 'toggle';

export interface KeyFn {
  kind: FnKind;
  /** Outra tecla: a tecla ou a combinação, no nome do TR3 ("Space", "Ctrl+Shift+1"). */
  combo?: string;
  /** Mouse: o nome do alvo, os mesmos dos Key Remaps (LeftClick, XButton1, ScrollUp…). */
  mouse?: string;
  /** Macro: o nome da macro na biblioteca do TR3. */
  macro?: string;
  mode?: MacroMode;
  times?: number;
  interval?: number;
  keepOriginal?: boolean;
  /** Texto: a frase, e se aperta Enter no fim. */
  text?: string;
  enter?: boolean;
}

/** Um jogo: o "perfil por jogo" do MK. Na tela é sempre "jogo"; o TR3 chama as dele de "macro". */
export interface Game {
  id: string;
  name: string;
  exes: string[];
  on: boolean;
  /** Um app que não é jogo (só na variante B, vindo de uma regra "só no app" dos Key Remaps). */
  app?: boolean;
  /** A camada de baixo, que vale sempre com o jogo na frente. */
  base: Record<string, KeyFn>;
  /** A camada de segurar: uma tecla sem função aqui herda da base. */
  layer: Record<string, KeyFn>;
}

/** "Em qualquer lugar": os Key Remaps de hoje, quando eles viram o teclado (variante B). */
export const EVERYWHERE = 'everywhere';

// ── O desenho: ABNT2, que é o layout do Windows do dono. A grade anda em quartos de tecla. ──

export interface KeyCap {
  /** A posição física (KeyboardEvent.code), que é o que o perfil guarda: o mesmo perfil vale no ABNT2 e no US. */
  code: string;
  /** O que está impresso na tecla. */
  legend: string;
  /** Coluna e linha na grade (coluna em quartos de tecla, a partir de 1). */
  col: number;
  row: number;
  /** Largura em quartos e altura em linhas. */
  w: number;
  h: number;
  /** O Enter em L do ISO: a parte de cima é ¼ mais larga que a de baixo. */
  isoEnter?: boolean;
  block: 'main' | 'nav' | 'num';
}

type Item = [code: string, legend: string, units?: number] | number;

// Linhas da grade: 1 = Fn, 2 = o vão, 3 a 7 = as cinco fileiras.
const MAIN: [row: number, items: Item[]][] = [
  [1, [['Escape', 'Esc'], 1, ['F1', 'F1'], ['F2', 'F2'], ['F3', 'F3'], ['F4', 'F4'], 0.5, ['F5', 'F5'], ['F6', 'F6'], ['F7', 'F7'], ['F8', 'F8'], 0.5, ['F9', 'F9'], ['F10', 'F10'], ['F11', 'F11'], ['F12', 'F12']]],
  [3, [['Backquote', "'"], ['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'], ['Digit4', '4'], ['Digit5', '5'], ['Digit6', '6'], ['Digit7', '7'], ['Digit8', '8'], ['Digit9', '9'], ['Digit0', '0'], ['Minus', '-'], ['Equal', '='], ['Backspace', 'Backspace', 2]]],
  [4, [['Tab', 'Tab', 1.5], ['KeyQ', 'Q'], ['KeyW', 'W'], ['KeyE', 'E'], ['KeyR', 'R'], ['KeyT', 'T'], ['KeyY', 'Y'], ['KeyU', 'U'], ['KeyI', 'I'], ['KeyO', 'O'], ['KeyP', 'P'], ['BracketLeft', '´'], ['BracketRight', '[']]],
  [5, [['CapsLock', 'Caps', 1.75], ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'], ['KeyF', 'F'], ['KeyG', 'G'], ['KeyH', 'H'], ['KeyJ', 'J'], ['KeyK', 'K'], ['KeyL', 'L'], ['Semicolon', 'Ç'], ['Quote', '~'], ['Backslash', ']']]],
  [6, [['ShiftLeft', 'Shift', 1.25], ['IntlBackslash', '\\'], ['KeyZ', 'Z'], ['KeyX', 'X'], ['KeyC', 'C'], ['KeyV', 'V'], ['KeyB', 'B'], ['KeyN', 'N'], ['KeyM', 'M'], ['Comma', ','], ['Period', '.'], ['Slash', ';'], ['IntlRo', '/'], ['ShiftRight', 'Shift', 1.75]]],
  [7, [['ControlLeft', 'Ctrl', 1.25], ['MetaLeft', 'Win', 1.25], ['AltLeft', 'Alt', 1.25], ['Space', 'Espaço', 6.25], ['AltRight', 'AltGr', 1.25], ['MetaRight', 'Win', 1.25], ['ContextMenu', 'Menu', 1.25], ['ControlRight', 'Ctrl', 1.25]]],
];
// O bloco do meio começa em 15¼ teclas; o numérico, em 18½.
const NAV: [row: number, items: Item[]][] = [
  [1, [['PrintScreen', 'PrtSc'], ['ScrollLock', 'ScrLk'], ['Pause', 'Pause']]],
  [3, [['Insert', 'Ins'], ['Home', 'Home'], ['PageUp', 'PgUp']]],
  [4, [['Delete', 'Del'], ['End', 'End'], ['PageDown', 'PgDn']]],
  [6, [1, ['ArrowUp', '↑']]],
  [7, [['ArrowLeft', '←'], ['ArrowDown', '↓'], ['ArrowRight', '→']]],
];
const NUM: [row: number, items: Item[]][] = [
  [3, [['NumLock', 'NumLk'], ['NumpadDivide', '/'], ['NumpadMultiply', '*'], ['NumpadSubtract', '-']]],
  [4, [['Numpad7', '7'], ['Numpad8', '8'], ['Numpad9', '9']]],
  [5, [['Numpad4', '4'], ['Numpad5', '5'], ['Numpad6', '6']]],
  [6, [['Numpad1', '1'], ['Numpad2', '2'], ['Numpad3', '3']]],
  [7, [['Numpad0', '0', 2], ['NumpadDecimal', ',']]],
];

function place(rows: [number, Item[]][], startUnits: number, block: KeyCap['block']): KeyCap[] {
  const out: KeyCap[] = [];
  for (const [row, items] of rows) {
    let at = startUnits;
    for (const item of items) {
      if (typeof item === 'number') { at += item; continue; }
      const [code, legend, units = 1] = item;
      out.push({ code, legend, col: Math.round(at * 4) + 1, row, w: Math.round(units * 4), h: 1, block });
      at += units;
    }
  }
  return out;
}

export const TKL_UNITS = 18.25;
export const FULL_UNITS = 22.5;

export const KEYS: KeyCap[] = [
  ...place(MAIN, 0, 'main'),
  // O Enter em L: uma peça só, que ocupa as duas fileiras.
  { code: 'Enter', legend: 'Enter', col: 13.5 * 4 + 1, row: 4, w: 6, h: 2, isoEnter: true, block: 'main' },
  ...place(NAV, 15.25, 'nav'),
  ...place(NUM, 18.5, 'num'),
  // As duas teclas altas do numérico.
  { code: 'NumpadAdd', legend: '+', col: 21.5 * 4 + 1, row: 4, w: 4, h: 2, block: 'num' },
  { code: 'NumpadEnter', legend: 'Enter', col: 21.5 * 4 + 1, row: 6, w: 4, h: 2, block: 'num' },
];

export const legendOf = (code: string) => KEYS.find(k => k.code === code)?.legend ?? code;

// As posições cujo nome no TR3 (KeyUtils, remaps.json) é o próprio código.
const SAME_NAME = new Set([
  'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'CapsLock', 'Escape', 'Tab', 'Space', 'Enter', 'Backspace',
  'PrintScreen', 'ScrollLock', 'Pause', 'NumLock',
]);

/** O nome do TR3 de uma posição física (o que os Key Remaps guardam). */
export function trKeyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(code) || SAME_NAME.has(code)) return code;
  const named: Record<string, string> = {
    ControlLeft: 'LCtrl', ControlRight: 'RCtrl', ShiftLeft: 'LShift', ShiftRight: 'RShift', AltLeft: 'LAlt', AltRight: 'RAlt',
    MetaLeft: 'LWin', MetaRight: 'RWin', ContextMenu: 'Apps', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  };
  return named[code] ?? legendOf(code);
}

/** A posição física de um nome do TR3, para desenhar uma regra dos Key Remaps no teclado. */
export const codeOfTr = (name: string): string | null => KEYS.find(k => trKeyName(k.code).toLowerCase() === name.toLowerCase())?.code ?? null;

// ── As funções na tela: o nome, o ícone e a cor, que é a do passo do TR3 que faz o mesmo ──

export const FNS: { kind: FnKind; label: string; Icon: LucideIcon | null; hint: string }[] = [
  { kind: 'default', label: 'Padrão', Icon: null, hint: 'A tecla segue normal.' },
  { kind: 'key', label: 'Outra tecla', Icon: Keyboard, hint: 'Uma tecla ou combinação; espelha apertar, repetir e soltar.' },
  { kind: 'mouse', label: 'Mouse', Icon: Mouse, hint: 'Um botão ou a roda.' },
  { kind: 'macro', label: 'Macro', Icon: ListChecks, hint: 'Uma macro da biblioteca do TR3.' },
  { kind: 'text', label: 'Texto', Icon: Type, hint: 'Digita uma frase: chat ou comando.' },
  { kind: 'off', label: 'Desligar', Icon: Ban, hint: 'A tecla não faz nada no jogo.' },
  { kind: 'layer', label: 'Camada', Icon: Layers, hint: 'Segurar libera a Camada.' },
];
export const fnInfo = (kind: FnKind) => FNS.find(f => f.kind === kind)!;

export const MODES: { value: MacroMode; label: string }[] = [
  { value: 'once', label: 'Uma vez' },
  { value: 'times', label: 'N vezes' },
  { value: 'hold', label: 'Enquanto segura' },
  { value: 'toggle', label: 'Alternar' },
];
