// Deck (branch deck, Fase 5): what the Deck page shows, kept while the page is away (the Teclado keeps its
// open game the same way). The macro's Deck section uses it too: "Open" lands on the button that runs it.
import { create } from 'zustand';
import type { DeckView } from './deckModel';

export interface DeckUiState {
  /** The deck shown, by its id; null shows the first. */
  open: string | null;
  /** The grid shown: one of the deck's pages, or one of its folders. */
  view: DeckView;
  /** The place chosen in the grid (a button, or an empty place). Null: the panel shows `panel`. */
  slot: number | null;
  /** With no place chosen, the panel holds the deck's settings, or the Deck's own (the gear). */
  panel: 'deck' | 'general';
  /**
   * The deck's settings asked for (the ⋯ menu's "Deck settings"). Wide, they rest in the panel whenever no
   * place is chosen; narrower, where the panel lies over the deck, they come only when asked.
   */
  settingsAsked: boolean;
}

const FIRST_PAGE: DeckView = { kind: 'page', index: 0 };

export const useDeckUi = create<DeckUiState>(() => ({ open: null, view: FIRST_PAGE, slot: null, panel: 'deck', settingsAsked: false }));

/** Another deck: its first page, nothing chosen, its settings in the panel. */
export const openDeck = (id: string) => useDeckUi.setState({ open: id, view: FIRST_PAGE, slot: null, panel: 'deck', settingsAsked: false });

/** Another grid of the deck shown. */
export const showView = (view: DeckView) => useDeckUi.setState({ view, slot: null });

/** A place of the grid chosen (null: none, and the deck's settings come back). */
export const pickSlot = (slot: number | null) => useDeckUi.setState({ slot, panel: 'deck', settingsAsked: false });

/** The deck's settings asked for, or put away again (narrow, the panel goes with them). */
export const askSettings = (on: boolean) => useDeckUi.setState(on ? { slot: null, panel: 'deck', settingsAsked: true } : { settingsAsked: false });

/** The Deck's own settings in the panel, or back to the deck's. */
export const showGeneral = (on: boolean) => useDeckUi.setState({ panel: on ? 'general' : 'deck', slot: null, settingsAsked: false });

/** A button chosen from outside the page (the macro's Deck section): its deck, its grid, its place. */
export const goToTile = (deckId: string, view: DeckView, slot: number) => useDeckUi.setState({ open: deckId, view, slot, panel: 'deck', settingsAsked: false });
