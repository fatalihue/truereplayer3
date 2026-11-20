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
import type { DeckConfig, DeckImportPreview, DeckMacroReport, DeckState, OutgoingMessage } from '../../bridge/messageTypes';

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
  /** A .trdeck whose Open and Text buttons wait to be seen before it comes in (Fase 7), or null. */
  importAsk: DeckImportPreview | null;
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
  importAsk: null,
}));

/** A deck edited on screen, or none (the engine answers with deck:editing). */
export const editOnScreen = (deckId: string | null) => postToEngine({ type: 'deck:edit', payload: { deckId } });

// ── Fase 7: a deck to a .trdeck and back, and the example ──

/** A deck to a .trdeck: the engine asks where, and answers deck:exported. */
export const exportDeck = (deckId: string) => postToEngine({ type: 'deck:export', payload: { deckId } });
/** A .trdeck to import: the engine asks which, and answers deck:importPreview. */
export const importDeck = () => postToEngine({ type: 'deck:import', payload: {} });
/** The example deck ("Media and system"), added by the engine in the app's language: it answers deck:imported. */
export const addExampleDeck = () => postToEngine({ type: 'deck:example', payload: {} });

/** The answer to an import's warning: yes brings the decks in (deck:imported), no drops the file. */
export function answerImport(yes: boolean) {
  const ask = useDeck.getState().importAsk;
  if (!ask) return;
  useDeck.setState({ importAsk: null });
  postToEngine({ type: yes ? 'deck:importConfirm' : 'deck:importCancel', payload: { token: ask.token } });
}

/** A file with no button that opens something or types a text comes in at once; one with them asks first. */
function hearPreview(preview: DeckImportPreview) {
  const asks = preview.decks.some(d => d.opens.length > 0 || d.texts.length > 0);
  if (asks) useDeck.setState({ importAsk: preview });
  else postToEngine({ type: 'deck:importConfirm', payload: { token: preview.token } });
}

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
      else if (message.type === 'deck:importPreview') hearPreview(message.payload);
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
