// Teclado (branch teclado; plan .claude/planos/teclado-no-tr3-2026-11-10.md): TrueReplayerMK as a mode
// of TrueReplayer 3. The functions a key takes, the keyboard's drawing and the names the engine uses.

import { Ban, Keyboard, Layers, ListChecks, Mouse, Type, type LucideIcon } from 'lucide-react';
import { tn } from '../../i18n';

/** A key's functions, the ones of the MK plan ("O produto (v1)"). 'default' is a key with none. */
export type FnKind = 'default' | 'key' | 'mouse' | 'macro' | 'text' | 'off' | 'layer';
export type MacroMode = 'once' | 'times' | 'hold' | 'toggle';

/** A key's function as the page holds it (the engine's TecladoKeyFunction, plus 'default'). */
export interface KeyFn {
  kind: FnKind;
  /** Another key: the key or combo, in the engine's key names ("Space", "Ctrl+Shift+1"). */
  combo?: string;
  /** Mouse: one of the Key Remaps' mouse targets (LeftClick, XButton1, ScrollUp…). */
  mouse?: string;
  /** Macro: the library macro's name. */
  macro?: string;
  mode?: MacroMode;
  times?: number;
  interval?: number;
  keepOriginal?: boolean;
  /** Text: the sentence, and whether Enter follows. */
  text?: string;
  enter?: boolean;
}

/** A game: the MK's "profile per game". The screen always says "game"; TR3's own are "macros". */
export interface Game {
  id: string;
  name: string;
  exes: string[];
  on: boolean;
  /** The bottom layer, in effect whenever the game is in front. */
  base: Record<string, KeyFn>;
  /** The hold layer: a key with no function here inherits from the base. */
  layer: Record<string, KeyFn>;
}

// ── The drawing: ABNT2, the owner's Windows layout. The grid moves in quarters of a key. ──

export interface KeyCap {
  /** The physical position (KeyboardEvent.code), which is what a game keeps: the same game works on ABNT2 and US. */
  code: string;
  /** What is printed on the cap. */
  legend: string;
  /** Column and row on the grid (column in quarters of a key, from 1). */
  col: number;
  row: number;
  /** Width in quarters and height in rows. */
  w: number;
  h: number;
  /** ISO's L-shaped Enter: its top is a quarter wider than its bottom. */
  isoEnter?: boolean;
  block: 'main' | 'nav' | 'num';
}

type Item = [code: string, legend: string, units?: number] | number;

// Grid rows: 1 = F keys, 2 = the gap, 3 to 7 = the five rows. The legends are the keycaps' own
// spelling (utils/keyNames.ts), the same in both languages.
const MAIN: [row: number, items: Item[]][] = [
  [1, [['Escape', 'Esc'], 1, ['F1', 'F1'], ['F2', 'F2'], ['F3', 'F3'], ['F4', 'F4'], 0.5, ['F5', 'F5'], ['F6', 'F6'], ['F7', 'F7'], ['F8', 'F8'], 0.5, ['F9', 'F9'], ['F10', 'F10'], ['F11', 'F11'], ['F12', 'F12']]],
  [3, [['Backquote', "'"], ['Digit1', '1'], ['Digit2', '2'], ['Digit3', '3'], ['Digit4', '4'], ['Digit5', '5'], ['Digit6', '6'], ['Digit7', '7'], ['Digit8', '8'], ['Digit9', '9'], ['Digit0', '0'], ['Minus', '-'], ['Equal', '='], ['Backspace', 'Backspace', 2]]],
  [4, [['Tab', 'Tab', 1.5], ['KeyQ', 'Q'], ['KeyW', 'W'], ['KeyE', 'E'], ['KeyR', 'R'], ['KeyT', 'T'], ['KeyY', 'Y'], ['KeyU', 'U'], ['KeyI', 'I'], ['KeyO', 'O'], ['KeyP', 'P'], ['BracketLeft', '´'], ['BracketRight', '[']]],
  [5, [['CapsLock', 'Caps', 1.75], ['KeyA', 'A'], ['KeyS', 'S'], ['KeyD', 'D'], ['KeyF', 'F'], ['KeyG', 'G'], ['KeyH', 'H'], ['KeyJ', 'J'], ['KeyK', 'K'], ['KeyL', 'L'], ['Semicolon', 'Ç'], ['Quote', '~'], ['Backslash', ']']]],
  [6, [['ShiftLeft', 'Shift', 1.25], ['IntlBackslash', '\\'], ['KeyZ', 'Z'], ['KeyX', 'X'], ['KeyC', 'C'], ['KeyV', 'V'], ['KeyB', 'B'], ['KeyN', 'N'], ['KeyM', 'M'], ['Comma', ','], ['Period', '.'], ['Slash', ';'], ['IntlRo', '/'], ['ShiftRight', 'Shift', 1.75]]],
  [7, [['ControlLeft', 'Ctrl', 1.25], ['MetaLeft', 'Win', 1.25], ['AltLeft', 'Alt', 1.25], ['Space', 'Space', 6.25], ['AltRight', 'AltGr', 1.25], ['MetaRight', 'Win', 1.25], ['ContextMenu', 'Menu', 1.25], ['ControlRight', 'Ctrl', 1.25]]],
];
// The middle block starts at 15¼ keys; the numpad at 18½.
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
  // The L-shaped Enter: one piece over both rows.
  { code: 'Enter', legend: 'Enter', col: 13.5 * 4 + 1, row: 4, w: 6, h: 2, isoEnter: true, block: 'main' },
  ...place(NAV, 15.25, 'nav'),
  ...place(NUM, 18.5, 'num'),
  // The numpad's two tall keys.
  { code: 'NumpadAdd', legend: '+', col: 21.5 * 4 + 1, row: 4, w: 4, h: 2, block: 'num' },
  { code: 'NumpadEnter', legend: 'Enter', col: 21.5 * 4 + 1, row: 6, w: 4, h: 2, block: 'num' },
];

/** The mouse buttons that take a function (TecladoKeys.MouseCodes): left and right stay out. */
export const MOUSE_CODES = ['MouseMiddle', 'MouseX1', 'MouseX2', 'WheelUp', 'WheelDown'] as const;
const BUTTON_NAMES = tn('teclado.buttons');

/** What a position is called on screen: its keycap, or the mouse button's name. */
export const legendOf = (code: string) =>
  KEYS.find(k => k.code === code)?.legend ?? BUTTON_NAMES[code as keyof typeof BUTTON_NAMES] ?? code;

// The positions whose engine name (KeyUtils, remaps.json) is the code itself.
const SAME_NAME = new Set([
  'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'CapsLock', 'Escape', 'Tab', 'Space', 'Enter', 'Backspace',
  'PrintScreen', 'ScrollLock', 'Pause', 'NumLock',
]);

/** The engine's name for a physical position (what the Key Remaps keep). */
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

/** The physical position of an engine key name, to draw a Key Remaps rule on the keyboard. */
export const codeOfTr = (name: string): string | null => KEYS.find(k => trKeyName(k.code).toLowerCase() === name.toLowerCase())?.code ?? null;

// ── The functions on screen: the name, the icon, and the colour, which is the one of TR3's step that does the same ──

const FN_NAMES = tn('teclado.fns');
export const FNS: { kind: FnKind; label: string; Icon: LucideIcon | null }[] = [
  { kind: 'default', label: FN_NAMES.default, Icon: null },
  { kind: 'key', label: FN_NAMES.key, Icon: Keyboard },
  { kind: 'mouse', label: FN_NAMES.mouse, Icon: Mouse },
  { kind: 'macro', label: FN_NAMES.macro, Icon: ListChecks },
  { kind: 'text', label: FN_NAMES.text, Icon: Type },
  { kind: 'off', label: FN_NAMES.off, Icon: Ban },
  { kind: 'layer', label: FN_NAMES.layer, Icon: Layers },
];
export const fnInfo = (kind: FnKind) => FNS.find(f => f.kind === kind)!;

const MODE_NAMES = tn('teclado.modes');
export const MODES: { value: MacroMode; label: string }[] = (['once', 'times', 'hold', 'toggle'] as const).map(value => ({ value, label: MODE_NAMES[value] }));
