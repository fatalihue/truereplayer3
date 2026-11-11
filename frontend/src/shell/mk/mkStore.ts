// PROTÓTIPO MK (ver mkModel.ts). O estado do modo, com dados falsos: os jogos, a tecla escolhida,
// e o que o protótipo deixa simular (a variante dos Key Remaps, o jogo na frente, a camada segura).
import { create } from 'zustand';
import type { RemapEntryDto } from '../../bridge/messageTypes';
import { mouseTarget } from '../pages/remaps/remapModel';
import { codeOfTr, EVERYWHERE, trKeyName, type Game, type KeyFn } from './mkModel';

/** Os dois caminhos para os Key Remaps: ficam ao lado (A) ou viram o teclado (B). */
export type Variant = 'beside' | 'merged';

interface MkState {
  variant: Variant;
  games: Game[];
  /** O jogo aberto na página (ou EVERYWHERE, na variante B). */
  open: string;
  view: 'base' | 'layer';
  device: 'keyboard' | 'mouse';
  numpad: boolean;
  /** A tecla escolhida (posição física), ou null com o painel fechado. */
  key: string | null;
  /** A chave geral do modo, na barra de status. */
  enabled: boolean;
  /** Simulação: o jogo na frente agora (o evento de primeiro plano do Windows), e a camada segura. */
  front: string | null;
  holding: boolean;
  /** O cartão do protótipo, recolhido. */
  protoFolded: boolean;
}

const roblox: Game = {
  id: 'roblox',
  name: 'Roblox',
  exes: ['RobloxPlayerBeta.exe'],
  on: true,
  base: {
    CapsLock: { kind: 'layer' },
    KeyE: { kind: 'macro', macro: 'Coletar', mode: 'hold', interval: 120, keepOriginal: false },
    KeyR: { kind: 'macro', macro: 'Combo 1-2-3', mode: 'once', keepOriginal: false },
    KeyQ: { kind: 'key', combo: 'Space' },
    KeyF: { kind: 'mouse', mouse: 'RightClick' },
    KeyV: { kind: 'mouse', mouse: 'XButton1' },
    F1: { kind: 'text', text: 'gg! boa partida', enter: true },
    F2: { kind: 'text', text: '/e dance', enter: true },
    MetaLeft: { kind: 'off' },
    ContextMenu: { kind: 'off' },
  },
  layer: {
    KeyE: { kind: 'macro', macro: 'Farm automático', mode: 'toggle', interval: 200, keepOriginal: false },
    KeyQ: { kind: 'macro', macro: 'Trocar arma', mode: 'once', keepOriginal: false },
    Digit1: { kind: 'key', combo: 'Shift+1' },
    Digit2: { kind: 'key', combo: 'Shift+2' },
    KeyF: { kind: 'off' },
  },
};

const minecraft: Game = {
  id: 'minecraft',
  name: 'Minecraft',
  exes: ['javaw.exe', 'Minecraft.Windows.exe'],
  on: true,
  base: {
    CapsLock: { kind: 'key', combo: 'Ctrl' },
    KeyQ: { kind: 'off' },
    KeyV: { kind: 'macro', macro: 'Ponte rápida', mode: 'hold', interval: 90, keepOriginal: false },
    F1: { kind: 'text', text: '/home', enter: true },
  },
  layer: {},
};

const terraria: Game = {
  id: 'terraria',
  name: 'Terraria',
  exes: ['Terraria.exe'],
  on: false,
  base: {
    KeyZ: { kind: 'macro', macro: 'Pulo duplo', mode: 'once', keepOriginal: true },
  },
  layer: {},
};

// Variante B: a regra "só no EXCEL.EXE" dos Key Remaps vira uma entrada da mesma lista que os jogos.
const excel: Game = {
  id: 'excel',
  name: 'Excel',
  exes: ['EXCEL.EXE'],
  on: true,
  app: true,
  base: { F1: { kind: 'off' } },
  layer: {},
};

export const useMk = create<MkState>(() => ({
  variant: 'beside',
  games: [roblox, minecraft, terraria, excel],
  open: 'roblox',
  view: 'base',
  device: 'keyboard',
  numpad: false,
  key: 'KeyE',
  enabled: true,
  front: null,
  holding: false,
  protoFolded: true,
}));

/** Os jogos que a lista mostra: o Excel só existe nela na variante B (na A ele é regra dos Key Remaps). */
export const listedGames = (s: { games: Game[]; variant: Variant }) => s.games.filter(g => !g.app || s.variant === 'merged');
export const gameOf = (s: MkState) => (s.open === EVERYWHERE ? null : listedGames(s).find(g => g.id === s.open) ?? null);

/** Onde a função de uma tecla mostrada vem: dela mesma, da base (na Camada) ou dos remaps gerais. */
export type Source = 'own' | 'base' | 'global';

/**
 * Os Key Remaps como teclas: os de "em qualquer lugar" e, para um jogo, os "só no app" do .exe dele.
 * Na variante A eles continuam na página Key Remaps e só aparecem aqui como herança; na B são o
 * teclado "Em qualquer lugar".
 */
export function globalsOf(remaps: { enabled: boolean; entries: RemapEntryDto[] }, exes: string[] | null): Record<string, KeyFn> {
  const out: Record<string, KeyFn> = {};
  if (!remaps.enabled) return out;
  const lower = (exes ?? []).map(e => e.toLowerCase().replace(/\.exe$/, ''));
  for (const r of remaps.entries) {
    if (!r.enabled) continue;
    const scope = (r.process ?? '').toLowerCase().replace(/\.exe$/, '');
    if (scope && !lower.includes(scope)) continue;
    const code = codeOfTr(r.from);
    if (!code) continue;
    out[code] = !r.to ? { kind: 'off' } : mouseTarget(r.to) ? { kind: 'mouse', mouse: r.to } : { kind: 'key', combo: r.to };
  }
  return out;
}

/** O teclado "Em qualquer lugar" escrito de volta como a lista dos Key Remaps (as regras "só no app" ficam). */
export function remapsWith(entries: RemapEntryDto[], code: string, fn: KeyFn): RemapEntryDto[] {
  const from = trKeyName(code);
  const rest = entries.filter(e => e.process || e.from.toLowerCase() !== from.toLowerCase());
  if (fn.kind === 'default') return rest;
  const to = fn.kind === 'off' ? '' : fn.kind === 'mouse' ? fn.mouse ?? '' : fn.combo ?? '';
  return [...rest, { from, to, enabled: true }];
}

/** A função de uma tecla na vista mostrada. */
export function fnAt(s: MkState, code: string, globals: Record<string, KeyFn>): { fn: KeyFn; source: Source } {
  if (s.open === EVERYWHERE) return { fn: globals[code] ?? { kind: 'default' }, source: 'own' };
  const game = gameOf(s);
  if (!game) return { fn: { kind: 'default' }, source: 'own' };
  const base = game.base[code];
  if (s.view === 'layer') {
    const own = game.layer[code];
    if (own) return { fn: own, source: 'own' };
    if (base) return { fn: base, source: 'base' };
  } else if (base) return { fn: base, source: 'own' };
  if (globals[code]) return { fn: globals[code], source: 'global' };
  return { fn: { kind: 'default' }, source: 'own' };
}

/** A tecla de camada do jogo (a que tem a função Camada na base), ou null. */
export const layerKeyOf = (game: Game | null) =>
  game ? Object.keys(game.base).find(code => game.base[code].kind === 'layer') ?? null : null;

/** Grava a função de uma tecla do jogo aberto, na vista mostrada. */
export function setGameFn(code: string, fn: KeyFn) {
  const s = useMk.getState();
  const clean = fn.kind === 'default' ? null : fn;
  useMk.setState({
    games: s.games.map(g => {
      if (g.id !== s.open) return g;
      const side = s.view === 'layer' ? 'layer' : 'base';
      const next = { ...g[side] };
      if (clean) next[code] = clean; else delete next[code];
      // Uma camada só por jogo: a tecla nova de Camada tira a função da antiga.
      if (side === 'base' && clean?.kind === 'layer') {
        for (const other of Object.keys(next)) if (other !== code && next[other].kind === 'layer') delete next[other];
      }
      return { ...g, [side]: next };
    }),
  });
}

export const openGame = (id: string) => useMk.setState(s => ({ open: id, view: id === EVERYWHERE ? 'base' : s.view, key: null }));
export const pickKey = (code: string | null) => useMk.setState({ key: code });
export const setGameOn = (id: string, on: boolean) => useMk.setState(s => ({ games: s.games.map(g => (g.id === id ? { ...g, on } : g)) }));
