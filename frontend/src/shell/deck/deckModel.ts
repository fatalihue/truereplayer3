// Deck (branch deck; plan .claude/planos/deck-2026-11-19.md): the shapes and bounds the page builds decks
// with. The wire types live in bridge/messageTypes (DeckConfig …); the bounds are DeckService's, so an
// edit the page makes is one the engine keeps as it is.
import type { DeckConfig, DeckDeck } from '../../bridge/messageTypes';

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
