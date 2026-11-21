// Deck (branch deck; plan .claude/planos/deck-2026-11-19.md): the edits of the decks. Each goes to the
// page at once and whole to the engine (deck:save), whose deck:state then settles it — the engine's
// normalization is what the page ends up holding.
import type { DeckConfig, DeckDeck, DeckTile } from '../../bridge/messageTypes';
import { DECK_LIMITS, freeSlot, isBackSlot, newDeck, newId, slotsOf, tilesOf, type DeckView } from './deckModel';
import { postToEngine, saveConfig, useDeck } from './deckStore';

/** The explicit "replace the unreadable deck.json" the quarantine waits for (the page's notice). */
export const overwriteUnreadable = () => postToEngine({ type: 'deck:overwriteUnreadable', payload: {} });

/**
 * An edit, whole. Never before the engine's first deck:state: until then the page holds the empty config,
 * and saving it would replace every deck, in deck.json and in its backup too.
 */
export function commit(config: DeckConfig) {
  if (!useDeck.getState().loaded) return;
  useDeck.setState({ config });
  saveConfig(config);
}

const current = () => useDeck.getState().config;
export const deckById = (id: string): DeckDeck | null => current().decks.find(d => d.id === id) ?? null;

/** The Deck's master switch. */
export const setEnabled = (enabled: boolean) => commit({ ...current(), enabled });

/** The Deck's own settings: captures, the press while a macro runs, the hotkey for every deck. */
export const setGeneral = (patch: Partial<Pick<DeckConfig, 'showInCaptures' | 'busyPress' | 'toggleAllHotkey'>>) =>
  commit({ ...current(), ...patch });

export const addDeck = (deck: DeckDeck) => commit({ ...current(), decks: [...current().decks, deck] });

export function updateDeck(id: string, patch: Partial<DeckDeck>) {
  commit({ ...current(), decks: current().decks.map(d => (d.id === id ? { ...d, ...patch } : d)) });
}

export const removeDeck = (id: string) => commit({ ...current(), decks: current().decks.filter(d => d.id !== id) });

/**
 * A new deck named `name`, after the others. Null when the Deck holds as many as it can. Where a fixed deck
 * already is, it lands 32 DIP further in, as the engine places an imported one (DeckService.Nudge), so the two
 * both show (Fase 8).
 */
export function createDeck(name: string): DeckDeck | null {
  if (current().decks.length >= DECK_LIMITS.decks) return null;
  const deck = newDeck(name);
  deck.place = nudged(deck.place, current().decks);
  addDeck(deck);
  return deck;
}

/** A place 32 DIP further in for each fixed deck already at it (same monitor, anchor and offset), as cascaded windows. */
export function nudged(place: DeckDeck['place'], others: DeckDeck[]): DeckDeck['place'] {
  const step = 32;
  const sx = place.anchor.includes('right') ? -step : step;
  const sy = place.anchor.startsWith('bottom') ? -step : step;
  let p = { ...place };
  const taken = () => others.some(o => o.mode === 'fixed' && o.place.anchor === p.anchor && (o.place.monitor ?? '') === (p.monitor ?? '')
    && Math.abs(o.place.dx - p.dx) < step / 2 && Math.abs(o.place.dy - p.dy) < step / 2);
  for (let i = 0; i < 12 && taken(); i++) p = { ...p, dx: p.dx + sx, dy: p.dy + sy };
  return p;
}

/**
 * A copy of a deck under another name, right after it, with ids of its own (a folder button follows its
 * folder's new id). Off, so the copy does not show over the original until it has a place of its own.
 */
export function duplicateDeck(id: string, name: string): DeckDeck | null {
  const decks = current().decks;
  const at = decks.findIndex(d => d.id === id);
  if (at < 0 || decks.length >= DECK_LIMITS.decks) return null;
  const from = decks[at];
  const folderIds = new Map(from.folders.map(f => [f.id, newId('f-')]));
  const copyTiles = (tiles: DeckTile[]) => tiles.map(t => (t.action.kind === 'folder' && t.action.folder && folderIds.has(t.action.folder)
    ? { ...t, action: { ...t.action, folder: folderIds.get(t.action.folder) } }
    : { ...t }));
  const copy: DeckDeck = {
    ...structuredClone(from),
    id: newId('d-'),
    name,
    on: false,
    // A copy has no hotkey of its own: two decks on one key, only the first one answers it.
    hotkey: undefined,
    pages: from.pages.map(p => ({ id: newId('p-'), tiles: copyTiles(p.tiles) })),
    folders: from.folders.map(f => ({ id: folderIds.get(f.id) ?? newId('f-'), name: f.name, tiles: copyTiles(f.tiles) })),
  };
  commit({ ...current(), decks: [...decks.slice(0, at + 1), copy, ...decks.slice(at + 1)] });
  return copy;
}

/** Deletes a deck; the function returned puts it back where it was (if there is still room). */
export function deleteDeck(id: string): () => void {
  const decks = current().decks;
  const at = decks.findIndex(d => d.id === id);
  const deck = decks[at];
  if (!deck) return () => {};
  removeDeck(id);
  return () => {
    const now = current().decks;
    if (now.length >= DECK_LIMITS.decks || now.some(d => d.id === deck.id)) return;
    const i = Math.min(at, now.length);
    commit({ ...current(), decks: [...now.slice(0, i), deck, ...now.slice(i)] });
  };
}

// ── The buttons of a grid ──

/** The deck with a grid's buttons replaced. */
function withTiles(deck: DeckDeck, view: DeckView, tiles: DeckTile[]): Pick<DeckDeck, 'pages' | 'folders'> {
  const sorted = [...tiles].sort((a, b) => a.slot - b.slot);
  if (view.kind === 'page') return { pages: deck.pages.map((p, i) => (i === view.index ? { ...p, tiles: sorted } : p)), folders: deck.folders };
  return { pages: deck.pages, folders: deck.folders.map(f => (f.id === view.id ? { ...f, tiles: sorted } : f)) };
}

/** Puts a button in a place, or clears the place (null). A folder's Back place takes none. */
export function setTile(deckId: string, view: DeckView, slot: number, tile: DeckTile | null) {
  const deck = deckById(deckId);
  if (!deck || isBackSlot(view, slot)) return;
  const rest = tilesOf(deck, view).filter(t => t.slot !== slot);
  updateDeck(deckId, withTiles(deck, view, tile ? [...rest, { ...tile, slot }] : rest));
}

/**
 * A button for a macro on a deck (the macro's Deck section, Fase 6): at the first free place of the first page
 * with room. Where it went, or null when every page of the deck is full.
 */
export function addMacroTile(deckId: string, macro: string): { page: number; slot: number } | null {
  const deck = deckById(deckId);
  if (!deck) return null;
  for (let page = 0; page < deck.pages.length; page++) {
    const view: DeckView = { kind: 'page', index: page };
    const slot = freeSlot(deck, view);
    if (slot < 0) continue;
    setTile(deckId, view, slot, { slot, action: { kind: 'macro', macro } });
    return { page, slot };
  }
  return null;
}

/** Has the deck a free place on one of its pages? */
export const hasRoom = (deck: DeckDeck) => deck.pages.some((_, page) => freeSlot(deck, { kind: 'page', index: page }) >= 0);

/** Changes a button where it is. */
export function patchTile(deckId: string, view: DeckView, slot: number, patch: Partial<DeckTile>) {
  const deck = deckById(deckId);
  const tile = deck && tilesOf(deck, view).find(t => t.slot === slot);
  if (!deck || !tile) return;
  setTile(deckId, view, slot, { ...tile, ...patch, slot });
}

/** Deletes a button; the function returned puts it back in its place, if the place is still free. */
export function deleteTile(deckId: string, view: DeckView, slot: number): () => void {
  const deck = deckById(deckId);
  const tile = deck && tilesOf(deck, view).find(t => t.slot === slot);
  if (!deck || !tile) return () => {};
  setTile(deckId, view, slot, null);
  return () => {
    const now = deckById(deckId);
    if (!now || tilesOf(now, view).some(t => t.slot === slot)) return;
    if (view.kind === 'folder' && !now.folders.some(f => f.id === view.id)) return;
    if (view.kind === 'page' && !now.pages[view.index]) return;
    setTile(deckId, view, slot, tile);
  };
}

/** Moves a button to another place of its grid; a button there takes the place it left. */
export function moveTile(deckId: string, view: DeckView, from: number, to: number) {
  const deck = deckById(deckId);
  if (!deck || from === to || isBackSlot(view, to) || to < 0 || to >= slotsOf(deck)) return;
  const tiles = tilesOf(deck, view).map(t => (t.slot === from ? { ...t, slot: to } : t.slot === to ? { ...t, slot: from } : t));
  updateDeck(deckId, withTiles(deck, view, tiles));
}

/** A copy of a button in the first free place after it. False when the grid has no free place. */
export function duplicateTile(deckId: string, view: DeckView, slot: number): number | null {
  const deck = deckById(deckId);
  const tile = deck && tilesOf(deck, view).find(t => t.slot === slot);
  if (!deck || !tile) return null;
  const taken = new Set(tilesOf(deck, view).map(t => t.slot));
  const n = slotsOf(deck);
  for (let i = 1; i < n; i++) {
    const at = (slot + i) % n;
    if (!taken.has(at) && !isBackSlot(view, at)) {
      setTile(deckId, view, at, { ...tile, slot: at });
      return at;
    }
  }
  return null;
}

/** Moves a button to the first free place of one of the deck's pages. False when that page has none. */
export function moveTileToPage(deckId: string, view: DeckView, slot: number, page: number): number {
  const deck = deckById(deckId);
  const tile = deck && tilesOf(deck, view).find(t => t.slot === slot);
  if (!deck || !tile || !deck.pages[page]) return -1;
  const target: DeckView = { kind: 'page', index: page };
  if (view.kind === 'page' && view.index === page) return -1;
  const taken = new Set(tilesOf(deck, target).map(t => t.slot));
  let free = -1;
  for (let i = 0; i < slotsOf(deck); i++) if (!taken.has(i)) { free = i; break; }
  if (free < 0) return -1;
  const after = { ...deck, ...withTiles(deck, view, tilesOf(deck, view).filter(t => t.slot !== slot)) };
  updateDeck(deckId, withTiles(after, target, [...tilesOf(after, target), { ...tile, slot: free }]));
  // The place it took on the other page (Fase 8): the page that shows it next selects and focuses it there.
  return free;
}

/** The buttons past the grid's size, brought into its free places, in their order. How many came back. */
export function bringBackHidden(deckId: string, view: DeckView): number {
  const deck = deckById(deckId);
  if (!deck) return 0;
  const n = slotsOf(deck);
  const tiles = tilesOf(deck, view);
  const taken = new Set(tiles.filter(t => t.slot < n).map(t => t.slot));
  const free: number[] = [];
  for (let i = 0; i < n; i++) if (!taken.has(i) && !isBackSlot(view, i)) free.push(i);
  let moved = 0;
  const next = tiles.map((t) => {
    if (t.slot < n || moved >= free.length) return t;
    return { ...t, slot: free[moved++] };
  });
  if (moved > 0) updateDeck(deckId, withTiles(deck, view, next));
  return moved;
}

// ── Pages and folders ──

/** A new empty page at the end; its index, or -1 when the deck holds as many as it can. */
export function addPage(deckId: string): number {
  const deck = deckById(deckId);
  if (!deck || deck.pages.length >= DECK_LIMITS.pages) return -1;
  updateDeck(deckId, { pages: [...deck.pages, { id: newId('p-'), tiles: [] }] });
  return deck.pages.length;
}

/** Deletes a page (never the last one); the function returned puts it back. */
export function deletePage(deckId: string, index: number): () => void {
  const deck = deckById(deckId);
  const page = deck?.pages[index];
  if (!deck || !page || deck.pages.length <= 1) return () => {};
  updateDeck(deckId, { pages: deck.pages.filter((_, i) => i !== index) });
  return () => {
    const now = deckById(deckId);
    if (!now || now.pages.length >= DECK_LIMITS.pages || now.pages.some(p => p.id === page.id)) return;
    const at = Math.min(index, now.pages.length);
    updateDeck(deckId, { pages: [...now.pages.slice(0, at), page, ...now.pages.slice(at)] });
  };
}

/** Moves a page one place left (-1) or right (1). */
export function shiftPage(deckId: string, index: number, by: -1 | 1) {
  const deck = deckById(deckId);
  const to = index + by;
  if (!deck || to < 0 || to >= deck.pages.length) return;
  const pages = [...deck.pages];
  [pages[index], pages[to]] = [pages[to], pages[index]];
  updateDeck(deckId, { pages });
}

/** A new folder named `name`; its id, or null when the deck holds as many as it can. */
export function addFolder(deckId: string, name: string): string | null {
  const deck = deckById(deckId);
  if (!deck || deck.folders.length >= DECK_LIMITS.folders) return null;
  const id = newId('f-');
  updateDeck(deckId, { folders: [...deck.folders, { id, name, tiles: [] }] });
  return id;
}

export function renameFolder(deckId: string, id: string, name: string) {
  const deck = deckById(deckId);
  if (!deck) return;
  updateDeck(deckId, { folders: deck.folders.map(f => (f.id === id ? { ...f, name } : f)) });
}

/**
 * Deletes a folder and its buttons. The buttons that opened it stay, doing nothing until they get another
 * action (the engine's rule: a Folder button needs its folder). The function returned puts it all back.
 */
export function deleteFolder(deckId: string, id: string): () => void {
  const deck = deckById(deckId);
  const folder = deck?.folders.find(f => f.id === id);
  if (!deck || !folder) return () => {};
  const opens = (t: DeckTile) => t.action.kind === 'folder' && t.action.folder === id;
  const openers = deck.pages.map(p => p.tiles.filter(opens).map(t => t.slot));
  updateDeck(deckId, {
    folders: deck.folders.filter(f => f.id !== id),
    pages: deck.pages.map(p => ({ ...p, tiles: p.tiles.map(t => (opens(t) ? { ...t, action: { kind: 'none' as const } } : t)) })),
  });
  return () => {
    const now = deckById(deckId);
    if (!now || now.folders.length >= DECK_LIMITS.folders || now.folders.some(f => f.id === id)) return;
    updateDeck(deckId, {
      folders: [...now.folders, folder],
      pages: now.pages.map((p, i) => ({
        ...p,
        tiles: p.tiles.map(t => (openers[i]?.includes(t.slot) && t.action.kind === 'none' ? { ...t, action: { kind: 'folder' as const, folder: id } } : t)),
      })),
    });
  };
}
