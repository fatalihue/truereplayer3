// Teclado (branch teclado; plan .claude/planos/teclado-no-tr3-2026-11-10.md). The mode's state on the
// page: the games and the master switch mirror the engine (teclado:state, TecladoService), every edit
// goes back whole (teclado:save) as the Key Remaps do, and the game in front comes from the
// foreground event (teclado:live, TecladoFront). The rest is the page's own: the game and key open,
// the view. The Key Remaps stay on their page (decision 1): here they only show under a game's keys.
//
// Rule 6: this module comes with the opening (the rail and the status read the game in front), so it
// holds only the state and the engine's side. The edits and the reads only the Keyboard page and the
// macro's Inspector section need are in mkEdit.ts, which comes with them.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useBridge } from '../../bridge/BridgeContext';
import type { OutgoingMessage, TecladoLive, TecladoMacroReport, TecladoState } from '../../bridge/messageTypes';
import type { Family, Game } from './mkModel';

/** The drawing's layout: chosen by hand, or 'auto' to follow Windows' (phase 5). */
export type LayoutPref = 'auto' | Family;

export interface MkState {
  /** The engine's games (teclado:state). */
  games: Game[];
  /** The engine's master switch (the status bar's "Teclado"). */
  enabled: boolean;
  /** The first teclado:state is in. Before it the page holds no games, and saves nothing. */
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
  /** The engine's teclado:live: the game in front (its id) and the layer key held. */
  front: string | null;
  holding: boolean;
  /** The game locked ("Lock to this game", phase 7): in front with any window but the app's, until unlocked. */
  locked: string | null;
  /** What each macro a key points to is to the executor (phase 4); a name missing here is not known yet. */
  macros: Record<string, TecladoMacroReport>;
  /** The drawing (phase 5): the layout chosen, the one Windows says, its labels, and a version bumped on every change. */
  layoutPref: LayoutPref;
  detected: Family;
  labels: Record<string, string> | null;
  drawingVersion: number;
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
  holding: false,
  locked: null,
  macros: {},
  layoutPref: 'auto',
  detected: 'abnt2',
  labels: null,
  drawingVersion: 0,
}));

// ── The engine's side ──

let send: ((message: OutgoingMessage) => void) | null = null;

/** A message to the engine, through the bridge the shell mounted (mkEdit's edits go out by it). */
export const postToEngine = (message: OutgoingMessage) => send?.(message);

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
      // An import brought a game in (phase 7): the page shows it, on whatever page the import began.
      else if (message.type === 'teclado:imported') useMk.setState({ open: message.payload.id, key: null, view: 'base' });
    });
    readLabels();
    window.addEventListener('focus', readLabels);
    return () => { off(); send = null; window.removeEventListener('focus', readLabels); };
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
    macros: state.macros ?? {},
    layoutPref: state.config?.layout ?? 'auto',
    detected: state.detectedLayout ?? s.detected,
    open: stillThere ? s.open : games[0]?.id ?? '',
    key: stillThere ? s.key : null,
  });
  applyDrawing();
}

// Only what the screen shows: the process in front comes with every window switch, and nothing here
// reads it — kept, it made every subscriber of the store draw again at each Alt+Tab.
function receiveLive(live: TecladoLive) {
  const s = useMk.getState();
  const front = live.front ?? null, holding = !!live.layer, locked = live.locked ?? null;
  if (front === s.front && holding === s.holding && locked === s.locked) return;
  useMk.setState({ front, holding, locked });
}

/** The family drawn: the one chosen, or the one Windows' layout says. */
export const familyOf = (s: Pick<MkState, 'layoutPref' | 'detected'>): Family => (s.layoutPref === 'auto' ? s.detected : s.layoutPref);

// The family and labels the drawing was last built for: a change bumps the version the page remounts on.
let drawn = 'abnt2|';

/** A new family or new labels: the drawing (mkModel.currentKeys) is built again on its next read. */
export function applyDrawing() {
  const s = useMk.getState();
  const key = `${familyOf(s)}|${s.labels ? JSON.stringify(s.labels) : ''}`;
  if (key === drawn) return;
  drawn = key;
  useMk.setState({ drawingVersion: s.drawingVersion + 1 });
}

// Windows' own labels for the character keys (the Keyboard Map API, in WebView2): read on mount and
// whenever the window comes back, since the layout may have been switched in between.
interface KeyboardMapApi { getLayoutMap?: () => Promise<{ forEach: (fn: (value: string, code: string) => void) => void }> }
function readLabels() {
  const api = (navigator as Navigator & { keyboard?: KeyboardMapApi }).keyboard;
  if (!api?.getLayoutMap) return;
  api.getLayoutMap().then((map) => {
    const labels: Record<string, string> = {};
    map.forEach((value, code) => { labels[code] = value; });
    // An empty map (a browser that has the API but no layout behind it) is no labels at all.
    if (Object.keys(labels).length === 0) return;
    useMk.setState({ labels });
    applyDrawing();
  }).catch(() => { /* no labels: the drawing keeps its own */ });
}
