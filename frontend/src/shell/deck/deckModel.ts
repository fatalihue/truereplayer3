// Deck (branch deck; plan .claude/planos/deck-2026-11-19.md): the shapes and bounds the page builds decks
// with. The wire types live in bridge/messageTypes (DeckConfig …); the bounds are DeckService's, so an
// edit the page makes is one the engine keeps as it is.
import type { DeckAction, DeckCommand, DeckConfig, DeckDeck, DeckTile } from '../../bridge/messageTypes';

/** DeckService's bounds. */
export const DECK_LIMITS = {
  decks: 16,
  grid: 8,
  pages: 10,
  folders: 32,
  apps: 8,
  name: 60,
  label: 40,
  combo: 40,
  text: 4000,
  target: 2048,
  args: 512,
} as const;

/** A button's side in DIP, by the grid's size. */
export const DECK_SIZES = { s: 48, m: 64, l: 80 } as const;

/** The opacities away from the mouse; 0 = invisible until the mouse comes. */
export const REST_OPACITIES = [100, 85, 70, 50, 0] as const;

/** An id as the engine makes them: a prefix and ten hex digits. */
export const newId = (prefix: 'd-' | 'p-' | 'f-') => prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 10);

/** A new deck with the engine's defaults: fixed, always shown, 5×3 medium buttons at the bottom right, one empty page. */
export function newDeck(name: string): DeckDeck {
  return {
    id: newId('d-'),
    name,
    on: true,
    mode: 'fixed',
    showWhen: { kind: 'always', apps: [] },
    summon: { at: 'cursor', hold: false, keysOnly: false, closeAfterPick: true },
    grid: { cols: 5, rows: 3, size: 'm' },
    place: { anchor: 'bottom-right', dx: -24, dy: -24 },
    look: { restOpacity: 100, collapse: false, edgeHide: false, locked: false, header: true },
    pages: [{ id: newId('p-'), tiles: [] }],
    folders: [],
  };
}

/** The library macros the buttons run, each once, in the order the decks name them (DeckService.MacrosNamed). */
export function macrosNamed(config: DeckConfig): string[] {
  const seen = new Set<string>();
  for (const deck of config.decks) {
    for (const tiles of [...deck.pages.map(p => p.tiles), ...deck.folders.map(f => f.tiles)]) {
      for (const tile of tiles) {
        if (tile.action.kind === 'macro' && tile.action.macro) seen.add(tile.action.macro);
      }
    }
  }
  return [...seen];
}

// ── Fase 5: what the page draws and edits ──

/** Where a grid lives: one of the deck's pages, or one of its folders (which opens in the deck's place). */
export type DeckView = { kind: 'page'; index: number } | { kind: 'folder'; id: string };

/** The buttons of a grid. */
export function tilesOf(deck: DeckDeck, view: DeckView): DeckTile[] {
  if (view.kind === 'page') return deck.pages[view.index]?.tiles ?? [];
  return deck.folders.find(f => f.id === view.id)?.tiles ?? [];
}

/** The places the grid shows: the rest keep their buttons, out of sight, until the grid grows back. */
export const slotsOf = (deck: DeckDeck) => deck.grid.cols * deck.grid.rows;

/** A folder's first place is its Back (DeckWindow.DrawBack): no button goes there. */
export const isBackSlot = (view: DeckView, slot: number) => view.kind === 'folder' && slot === 0;

/** The TR3 commands a button can give, in the order the panel lists them. */
export const DECK_COMMANDS: readonly DeckCommand[] = ['record', 'stopAll', 'clicker', 'teclado', 'remaps', 'automations', 'shortcuts', 'show'];

/** The action kinds a button can have, in the panel's order (none is a button still being set up). */
export const ACTION_KINDS = ['macro', 'keys', 'text', 'open', 'folder', 'tr3'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** A media or volume key's own icon (DeckWindow.DefaultIcon), by the name the engine sends it by. */
const SPECIAL_ICONS: Record<string, string> = {
  MediaPlayPause: 'play', MediaNextTrack: 'skip-forward', MediaPrevTrack: 'skip-back', MediaStop: 'square',
  VolumeUp: 'volume-2', VolumeDown: 'volume-1', VolumeMute: 'volume-x',
};

/** The lucide icon a button shows when it has none of its own (DeckWindow.DefaultIcon). */
export function defaultIconName(a: DeckAction): string {
  switch (a.kind) {
    case 'macro': return 'play';
    case 'keys': return SPECIAL_ICONS[a.combo ?? ''] ?? 'keyboard';
    case 'text': return 'type';
    case 'open': return 'external-link';
    case 'folder': return 'folder';
    case 'tr3':
      switch (a.command) {
        case 'record': return 'circle';
        case 'stopAll': return 'square';
        case 'clicker': return 'mouse-pointer-click';
        case 'teclado': return 'keyboard';
        case 'remaps': return 'arrow-right-left';
        case 'automations': return 'zap';
        case 'shortcuts': return 'command';
        default: return 'app-window';
      }
    default: return 'plus';
  }
}

/** What an Open button says without a label of its own: the address's host, or the file's name (DeckWindow.OpenLabel). */
export function openLabel(target: string): string {
  try {
    const url = new URL(target);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.host;
  } catch { /* not an address */ }
  const trimmed = target.replace(/[\\/]+$/, '');
  const file = trimmed.slice(Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/')) + 1);
  const dot = file.lastIndexOf('.');
  const name = dot > 0 ? file.slice(0, dot) : file;
  return name || target;
}

/**
 * The keys a keyboard capture does not give — the media, the volume, F13–F24 — by the names the engine
 * sends (InputHookManager.DeckKeyName and KeyUtils: MediaPlayPause, VolumeUp …).
 */
export const SPECIAL_KEYS = {
  media: ['MediaPlayPause', 'MediaNextTrack', 'MediaPrevTrack', 'MediaStop'],
  volume: ['VolumeUp', 'VolumeDown', 'VolumeMute'],
  extra: Array.from({ length: 12 }, (_, i) => `F${i + 13}`),
} as const;

/** The first free place of a grid, or -1 when every place it shows is taken. */
export function freeSlot(deck: DeckDeck, view: DeckView): number {
  const taken = new Set(tilesOf(deck, view).map(t => t.slot));
  for (let slot = 0; slot < slotsOf(deck); slot++) {
    if (!taken.has(slot) && !isBackSlot(view, slot)) return slot;
  }
  return -1;
}

/** The buttons a grid keeps out of sight: their places are past the grid's size. */
export const hiddenTiles = (deck: DeckDeck, view: DeckView) => tilesOf(deck, view).filter(t => t.slot >= slotsOf(deck));
