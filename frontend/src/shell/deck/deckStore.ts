// Deck (branch deck; plan .claude/planos/deck-2026-11-19.md). The decks' state on the page: the config
// mirrors the engine (deck:state, DeckService), and every edit goes back whole (deck:save, deckEdit.ts),
// as the Teclado's does.
//
// Rule 6: nothing of the Deck comes with the opening. The decks are native windows the engine draws on
// its own, so the page needs their config only on the Deck page and in the macro's Deck section: those
// mount useDeckSync, which asks the engine (deck:get) and follows its answers from then on.
import { useEffect } from 'react';
import { create } from 'zustand';
import { useBridge } from '../../bridge/BridgeContext';
import type { DeckConfig, DeckMacroReport, DeckState, OutgoingMessage } from '../../bridge/messageTypes';

export interface DeckStoreState {
  /** The engine's config (deck:state). */
  config: DeckConfig;
  /** The first deck:state is in. Before it the page holds no decks, and saves nothing. */
  loaded: boolean;
  /** deck.json could not be read (DeckService.LoadFailed): what is shown, and where edits go. */
  loadFailed: boolean;
  loadedFromBackup: boolean;
  loadFailureDetail: string | null;
  pendingFile: string;
  /** The macros the buttons name, as the library has them (absent before the library loads). */
  macros: Record<string, DeckMacroReport>;
  /** The deck edited on screen (deck:editing, Fase 6), or null. */
  editing: string | null;
}

export const EMPTY_DECK_CONFIG: DeckConfig = { version: 1, enabled: true, showInCaptures: false, busyPress: 'swap', decks: [] };

export const useDeck = create<DeckStoreState>(() => ({
  config: EMPTY_DECK_CONFIG,
  loaded: false,
  loadFailed: false,
  loadedFromBackup: false,
  loadFailureDetail: null,
  pendingFile: 'deck.pending.json',
  macros: {},
  editing: null,
}));

/** A deck edited on screen, or none (the engine answers with deck:editing). */
export const editOnScreen = (deckId: string | null) => postToEngine({ type: 'deck:edit', payload: { deckId } });

let send: ((message: OutgoingMessage) => void) | null = null;
let mounts = 0;

/** A message to the engine, through the bridge the Deck's screens mounted (deckEdit's edits go out by it). */
export const postToEngine = (message: OutgoingMessage) => send?.(message);

/**
 * Mounted by each screen that shows decks: keeps the bridge's send for the edits, takes deck:state into
 * the store, and asks for it once at mount — the engine does not push it with the opening.
 */
export function useDeckSync() {
  const bridge = useBridge();
  useEffect(() => {
    send = bridge.send;
    mounts++;
    const off = bridge.subscribe((message) => {
      if (message.type === 'deck:state') receive(message.payload);
      // None edited comes without the field (the bridge leaves nulls out).
      else if (message.type === 'deck:editing') useDeck.setState({ editing: message.payload.deckId ?? null });
    });
    bridge.send({ type: 'deck:get', payload: {} });
    return () => {
      off();
      if (--mounts === 0) send = null;
    };
  }, [bridge]);
}

function receive(state: DeckState) {
  const s = useDeck.getState();
  useDeck.setState({
    config: state.config ?? EMPTY_DECK_CONFIG,
    loaded: true,
    loadFailed: !!state.loadFailed,
    loadedFromBackup: !!state.loadedFromBackup,
    loadFailureDetail: state.loadFailureDetail ?? null,
    pendingFile: state.pendingFile || s.pendingFile,
    macros: state.macros ?? {},
  });
}
