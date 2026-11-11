// Teclado (branch teclado; plan .claude/planos/teclado-no-tr3-2026-11-10.md): the edits of the games and
// the reads only the Keyboard page, the status bar's switch and the macro's Inspector section use. Out
// of mkStore, which the opening carries for the rail (rule 6): this module comes with them.
import type { TecladoConfig, TecladoGame } from '../../bridge/messageTypes';
import type { Game, KeyFn } from './mkModel';
import { applyDrawing, postToEngine, useMk, type LayoutPref, type MkState } from './mkStore';

/** "Lock to this game" (phase 7), or its undoing with null: the engine answers with teclado:live. Lasts until the app closes. */
export const lockGame = (id: string | null) => postToEngine({ type: 'teclado:lock', payload: { id } });

/** "Export" (phase 7): the game and the macros its keys run, in one .trprofile (the engine opens the Save dialog). */
export const exportGame = (id: string) => postToEngine({ type: 'teclado:export', payload: { id } });

export const overwriteUnreadable = () => postToEngine({ type: 'teclado:overwriteUnreadable', payload: {} });

/**
 * An edit: on the page at once, and whole to the engine, whose teclado:state then settles it. Never
 * before the engine's first teclado:state: the page opens before the app's state comes (the library
 * loads first), and a save of the empty list it holds until then would replace every game, in
 * teclado.json and in its backup too.
 */
function commit(games: Game[], enabled = useMk.getState().enabled, layoutPref = useMk.getState().layoutPref) {
  if (!useMk.getState().loaded) return;
  useMk.setState({ games, enabled, layoutPref });
  applyDrawing();
  const config: TecladoConfig = { version: 1, enabled, games: games as TecladoGame[], layout: layoutPref === 'auto' ? undefined : layoutPref };
  postToEngine({ type: 'teclado:save', payload: { config } });
}

export const setEnabled = (enabled: boolean) => commit(useMk.getState().games, enabled);

/** The drawing's layout chosen by hand, or 'auto' to follow Windows'. Kept in teclado.json. */
export const setLayoutPref = (pref: LayoutPref) => commit(useMk.getState().games, useMk.getState().enabled, pref);

// ── Reading ──

export const gameOf = (s: MkState) => s.games.find(g => g.id === s.open) ?? null;

/** Where a shown key's function comes from: its own, the base (on the layer), or the Key Remaps. */
export type Source = 'own' | 'base' | 'global';

/** A key's function in a game and a view (the page passes what it read once, rule 1: no key reads the whole store). */
export function fnFor(game: Game | null, view: 'base' | 'layer', code: string, globals: Record<string, KeyFn>): { fn: KeyFn; source: Source } {
  if (!game) return { fn: { kind: 'default' }, source: 'own' };
  const base = game.base[code];
  if (view === 'layer') {
    const own = game.layer[code];
    if (own) return { fn: own, source: 'own' };
    if (base) return { fn: base, source: 'base' };
  } else if (base) return { fn: base, source: 'own' };
  if (globals[code]) return { fn: globals[code], source: 'global' };
  return { fn: { kind: 'default' }, source: 'own' };
}

/** The game's layer key (the one with the Layer function on the base), or null. */
export const layerKeyOf = (game: Game | null) =>
  game ? Object.keys(game.base).find(code => game.base[code].kind === 'layer') ?? null : null;

// ── Editing ──

/**
 * Writes a key's function in the open game, in the view shown — or, with `where`, in that game and
 * view (a link made later, once the macro it names exists).
 */
export function setGameFn(code: string, fn: KeyFn, where?: { game: string; view: 'base' | 'layer' }) {
  const s = useMk.getState();
  const clean = fn.kind === 'default' ? null : fn;
  const target = where?.game ?? s.open;
  const view = where?.view ?? s.view;
  commit(s.games.map(g => {
    if (g.id !== target) return g;
    const side = view === 'layer' ? 'layer' : 'base';
    const next = { ...g[side] };
    if (clean) next[code] = clean; else delete next[code];
    // One layer key per game: a new layer key takes the function from the old one.
    if (side === 'base' && clean?.kind === 'layer') {
      for (const other of Object.keys(next)) if (other !== code && next[other].kind === 'layer') delete next[other];
    }
    return { ...g, [side]: next };
  }));
}

const exeOf = (process: string) => (/\.exe$/i.test(process.trim()) ? process.trim() : `${process.trim()}.exe`);
// The .exe as the engine matches it (RemapService.NormalizeProcess): no case, no ".exe".
const exeKey = (exe: string) => exe.trim().toLowerCase().replace(/\.exe$/, '');

/**
 * With two games on one .exe (two setups of one game), the one turned on is the one that plays: so
 * turning one on turns off the others on its .exe — what "Use" is for, and what the import's notice
 * ("turn one or the other on with Use") counts on. Left both on, the first in the list won, quietly.
 */
function onlyOneOn(games: Game[], id: string): { games: Game[]; off: string[] } {
  const game = games.find(g => g.id === id);
  if (!game?.on) return { games, off: [] };
  const mine = new Set(game.exes.map(exeKey));
  const off: string[] = [];
  const next = games.map(g => {
    if (g.id === id || !g.on || !g.exes.some(e => mine.has(exeKey(e)))) return g;
    off.push(g.name);
    return { ...g, on: false };
  });
  return { games: next, off };
}

/** "Use": on or off. The names of the games it turned off (they shared its .exe), for the page to say. */
export function setGameOn(id: string, on: boolean): string[] {
  if (!useMk.getState().loaded) return [];
  const { games, off } = onlyOneOn(useMk.getState().games.map(g => (g.id === id ? { ...g, on } : g)), id);
  commit(games);
  return off;
}

/** A new game for a program (its .exe), opened; or the one that already has that .exe. */
export function addGame(process: string) {
  const exe = exeOf(process);
  const s = useMk.getState();
  if (!s.loaded) return;
  const known = s.games.find(g => g.exes.some(e => e.toLowerCase() === exe.toLowerCase()));
  if (known) { useMk.setState({ open: known.id, key: null, view: 'base' }); return; }
  const id = `g-${crypto.randomUUID().slice(0, 10)}`;
  commit([...s.games, { id, name: exe.replace(/\.exe$/i, ''), exes: [exe], on: true, base: {}, layer: {} }]);
  useMk.setState({ open: id, key: null, view: 'base' });
}

/** Removes a game; the returned function puts it back where it was (the toast's Undo). */
export function removeGame(id: string): () => void {
  const s = useMk.getState();
  const at = s.games.findIndex(g => g.id === id);
  if (at < 0) return () => undefined;
  const game = s.games[at];
  const rest = s.games.filter(g => g.id !== id);
  commit(rest);
  if (s.open === id) useMk.setState({ open: rest[0]?.id ?? '', key: null });
  return () => {
    const now = useMk.getState().games;
    if (now.some(g => g.id === id)) return;
    commit([...now.slice(0, at), game, ...now.slice(at)]);
  };
}

export function renameGame(id: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  commit(useMk.getState().games.map(g => (g.id === id ? { ...g, name: clean.slice(0, 60) } : g)));
}

/** Another .exe for a game; one turned on takes the .exe from the other games turned on (their names come back). */
export function addExe(id: string, process: string): string[] {
  const exe = exeOf(process);
  if (!useMk.getState().loaded) return [];
  const { games, off } = onlyOneOn(useMk.getState().games.map(g => (g.id === id && !g.exes.some(e => e.toLowerCase() === exe.toLowerCase()) ? { ...g, exes: [...g.exes, exe] } : g)), id);
  commit(games);
  return off;
}

export function removeExe(id: string, exe: string) {
  commit(useMk.getState().games.map(g => (g.id === id && g.exes.length > 1 ? { ...g, exes: g.exes.filter(e => e !== exe) } : g)));
}

export const openGame = (id: string) => useMk.setState({ open: id, key: null });
export const pickKey = (code: string | null) => useMk.setState({ key: code });
