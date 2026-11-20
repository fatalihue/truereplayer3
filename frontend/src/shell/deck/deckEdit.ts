// Deck (branch deck; plan .claude/planos/deck-2026-11-19.md): the edits of the decks. Each goes to the
// page at once and whole to the engine (deck:save), whose deck:state then settles it — the engine's
// normalization is what the page ends up holding.
import type { DeckConfig, DeckDeck } from '../../bridge/messageTypes';
import { postToEngine, useDeck } from './deckStore';

/** The explicit "replace the unreadable deck.json" the quarantine waits for (the page's notice). */
export const overwriteUnreadable = () => postToEngine({ type: 'deck:overwriteUnreadable', payload: {} });

/**
 * An edit, whole. Never before the engine's first deck:state: until then the page holds the empty config,
 * and saving it would replace every deck, in deck.json and in its backup too.
 */
export function commit(config: DeckConfig) {
  if (!useDeck.getState().loaded) return;
  useDeck.setState({ config });
  postToEngine({ type: 'deck:save', payload: { config } });
}

const current = () => useDeck.getState().config;

/** The Deck's master switch. */
export const setEnabled = (enabled: boolean) => commit({ ...current(), enabled });

export const addDeck = (deck: DeckDeck) => commit({ ...current(), decks: [...current().decks, deck] });

export function updateDeck(id: string, patch: Partial<DeckDeck>) {
  commit({ ...current(), decks: current().decks.map(d => (d.id === id ? { ...d, ...patch } : d)) });
}

export const removeDeck = (id: string) => commit({ ...current(), decks: current().decks.filter(d => d.id !== id) });
