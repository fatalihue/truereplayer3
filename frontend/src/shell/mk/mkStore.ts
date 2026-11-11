// Teclado (branch teclado; plan .claude/planos/teclado-no-tr3-2026-11-10.md). The mode's state on the
// page: the games and the master switch mirror the engine (teclado:state, TecladoService), every edit
// goes back whole (teclado:save) as the Key Remaps do, and the game in front comes from the
// foreground event (teclado:live, TecladoFront). The rest is the page's own: the game and key open,
// the view. The Key Remaps stay on their page (decision 1): here they only show under a game's keys.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useBridge } from '../../bridge/BridgeContext';
import type { OutgoingMessage, RemapEntryDto, TecladoConfig, TecladoGame, TecladoLive, TecladoState } from '../../bridge/messageTypes';
import { mouseTarget } from '../pages/remaps/remapModel';
import { codeOfTr, type Game, type KeyFn } from './mkModel';

interface MkState {
  /** The engine's games (teclado:state). */
  games: Game[];
  /** The engine's master switch (the status bar's "Teclado"). */
  enabled: boolean;
  /** The first teclado:state is in. */
  loaded: boolean;
  /** teclado.json could not be read (TecladoService.LoadFailed): what is shown, and where edits go. */
  loadFailed: boolean;
  loadedFromBackup: boolean;
  loadFailureDetail: string | null;
  pendingFile: string;
  /** The game open on the page. */
  open: string;
  view: 'base' | 'layer';
  device: 'keyboard' | 'mouse';
  numpad: boolean;
  /** The key chosen (physical position), or null with the panel closed. */
  key: string | null;
  /** The engine's teclado:live: the game in front (its id), the process, and the layer key held. */
  front: string | null;
  frontProcess: string | null;
  holding: boolean;
}

export const useMk = create<MkState>(() => ({
  games: [],
  enabled: true,
  loaded: false,
  loadFailed: false,
  loadedFromBackup: false,
  loadFailureDetail: null,
  pendingFile: 'teclado.pending.json',
  open: '',
  view: 'base',
  device: 'keyboard',
  numpad: false,
  key: null,
  front: null,
  frontProcess: null,
  holding: false,
}));

// ── The engine's side ──

let send: ((message: OutgoingMessage) => void) | null = null;

/**
 * Mounted once, in the shell: takes teclado:state and teclado:live into the store, and keeps the
 * bridge's send for the edits. The first state opens the first game.
 */
export function useTecladoSync() {
  const bridge = useBridge();
  useEffect(() => {
    send = bridge.send;
    const off = bridge.subscribe((message) => {
      if (message.type === 'teclado:state') receive(message.payload);
      else if (message.type === 'teclado:live') receiveLive(message.payload);
    });
    return () => { off(); send = null; };
  }, [bridge]);
}

function receive(state: TecladoState) {
  const games = (state.config?.games ?? []) as Game[];
  const s = useMk.getState();
  const stillThere = games.some(g => g.id === s.open);
  useMk.setState({
    games,
    enabled: state.config?.enabled ?? true,
    loaded: true,
    loadFailed: !!state.loadFailed,
    loadedFromBackup: !!state.loadedFromBackup,
    loadFailureDetail: state.loadFailureDetail ?? null,
    pendingFile: state.pendingFile || s.pendingFile,
    open: stillThere ? s.open : games[0]?.id ?? '',
    key: stillThere ? s.key : null,
  });
}

function receiveLive(live: TecladoLive) {
  useMk.setState({ front: live.front ?? null, frontProcess: live.process ?? null, holding: !!live.layer });
}

/** An edit: on the page at once, and whole to the engine, whose teclado:state then settles it. */
function commit(games: Game[], enabled = useMk.getState().enabled) {
  useMk.setState({ games, enabled });
  const config: TecladoConfig = { version: 1, enabled, games: games as TecladoGame[] };
  send?.({ type: 'teclado:save', payload: { config } });
}

export const setEnabled = (enabled: boolean) => commit(useMk.getState().games, enabled);
export const overwriteUnreadable = () => send?.({ type: 'teclado:overwriteUnreadable', payload: {} });

// ── Reading ──

export const gameOf = (s: MkState) => s.games.find(g => g.id === s.open) ?? null;

/** Where a shown key's function comes from: its own, the base (on the layer), or the Key Remaps. */
export type Source = 'own' | 'base' | 'global';

/**
 * The Key Remaps under a game's keys: the "everywhere" ones and the "only in one app" ones of its
 * .exe. They stay on the Key Remaps page; here they only show as what a key without a function does.
 */
export function globalsOf(remaps: { enabled: boolean; entries: RemapEntryDto[] }, exes: string[]): Record<string, KeyFn> {
  const out: Record<string, KeyFn> = {};
  if (!remaps.enabled) return out;
  const lower = exes.map(e => e.toLowerCase().replace(/\.exe$/, ''));
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

/** A key's function in the view shown. */
export function fnAt(s: MkState, code: string, globals: Record<string, KeyFn>): { fn: KeyFn; source: Source } {
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

/** The game's layer key (the one with the Layer function on the base), or null. */
export const layerKeyOf = (game: Game | null) =>
  game ? Object.keys(game.base).find(code => game.base[code].kind === 'layer') ?? null : null;

// ── Editing ──

/** Writes a key's function in the open game, in the view shown. */
export function setGameFn(code: string, fn: KeyFn) {
  const s = useMk.getState();
  const clean = fn.kind === 'default' ? null : fn;
  commit(s.games.map(g => {
    if (g.id !== s.open) return g;
    const side = s.view === 'layer' ? 'layer' : 'base';
    const next = { ...g[side] };
    if (clean) next[code] = clean; else delete next[code];
    // One layer key per game: a new layer key takes the function from the old one.
    if (side === 'base' && clean?.kind === 'layer') {
      for (const other of Object.keys(next)) if (other !== code && next[other].kind === 'layer') delete next[other];
    }
    return { ...g, [side]: next };
  }));
}

export const setGameOn = (id: string, on: boolean) => commit(useMk.getState().games.map(g => (g.id === id ? { ...g, on } : g)));

const exeOf = (process: string) => (/\.exe$/i.test(process.trim()) ? process.trim() : `${process.trim()}.exe`);

/** A new game for a program (its .exe), opened; or the one that already has that .exe. */
export function addGame(process: string) {
  const exe = exeOf(process);
  const s = useMk.getState();
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

export function addExe(id: string, process: string) {
  const exe = exeOf(process);
  commit(useMk.getState().games.map(g => (g.id === id && !g.exes.some(e => e.toLowerCase() === exe.toLowerCase()) ? { ...g, exes: [...g.exes, exe] } : g)));
}

export function removeExe(id: string, exe: string) {
  commit(useMk.getState().games.map(g => (g.id === id && g.exes.length > 1 ? { ...g, exes: g.exes.filter(e => e !== exe) } : g)));
}

export const openGame = (id: string) => useMk.setState({ open: id, key: null });
export const pickKey = (code: string | null) => useMk.setState({ key: code });
