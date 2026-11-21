// Deck (branch deck). In Vite, without WebView2, a fake engine answers the Deck's messages with sample
// data (VITE_DECK_DEMO=1). It sits on top of whatever chrome.webview is there — the Teclado's fake engine
// when VITE_TECLADO_DEMO=1 too — and takes only deck:*, passing the rest along. Imported only in
// development (main.tsx), so none of it reaches the app's bundle (rule 6). The sample decks and macros
// are content, in Portuguese.
import type { DeckConfig, DeckDeck, DeckState, DeckTile } from '../../bridge/messageTypes';
import { FOLDER_COLORS } from '../../themes';
import { macrosNamed } from './deckModel';

type Listener = (event: { data: unknown }) => void;
type Msg = { type?: string; payload?: Record<string, unknown> };
interface Webview {
  postMessage: (message: unknown) => void;
  addEventListener: (type: string, listener: Listener) => void;
  removeEventListener: (type: string, listener: Listener) => void;
}

/** The library the fake engine knows: the Teclado's sample macros. A button naming another one shows as missing. */
const LIBRARY = ['Coletar', 'Pulo duplo', 'Combo 1-2-3', 'Farm automático', 'Trocar arma', 'Relatório diário', 'Responder e-mail'];

const tile = (slot: number, t: Partial<DeckTile> & Pick<DeckTile, 'action'>): DeckTile => ({ slot, ...t });

const deck = (d: Partial<DeckDeck> & Pick<DeckDeck, 'id' | 'name' | 'pages'>): DeckDeck => ({
  on: true,
  mode: 'fixed',
  showWhen: { kind: 'always', apps: [] },
  summon: { at: 'cursor', hold: false, keysOnly: false, closeAfterPick: true },
  grid: { cols: 4, rows: 2, size: 'm' },
  place: { anchor: 'bottom-right', dx: -24, dy: -24 },
  look: { restOpacity: 100, collapse: false, edgeHide: false, locked: false, header: true },
  folders: [],
  ...d,
});

let config: DeckConfig = {
  version: 1,
  enabled: true,
  showInCaptures: false,
  busyPress: 'swap',
  decks: [
    deck({
      id: 'd-geral',
      name: 'Geral',
      pages: [{
        id: 'p-geral',
        tiles: [
          tile(0, { icon: { kind: 'emoji', value: '🌾' }, action: { kind: 'macro', macro: 'Farm automático' } }),
          tile(1, { color: FOLDER_COLORS[0], icon: { kind: 'lucide', name: 'swords' }, action: { kind: 'macro', macro: 'Combo 1-2-3' } }),
          tile(2, { label: 'Ctrl+Shift+K', icon: { kind: 'lucide', name: 'keyboard' }, action: { kind: 'keys', combo: 'Ctrl+Shift+K' } }),
          tile(3, { label: 'Saudação', color: FOLDER_COLORS[4], icon: { kind: 'lucide', name: 'type' }, action: { kind: 'text', text: 'Olá! Tudo bem?', send: 'paste' } }),
          tile(4, { label: 'Mídia', color: FOLDER_COLORS[6], icon: { kind: 'lucide', name: 'folder' }, action: { kind: 'folder', folder: 'f-midia' } }),
          tile(5, { label: 'Teclado', icon: { kind: 'lucide', name: 'keyboard' }, action: { kind: 'tr3', command: 'teclado' } }),
          tile(6, { action: { kind: 'macro', macro: 'Macro apagada' } }),
        ],
      }],
      folders: [{
        id: 'f-midia',
        name: 'Mídia',
        tiles: [
          tile(1, { label: 'Tocar/pausa', icon: { kind: 'lucide', name: 'play' }, action: { kind: 'keys', combo: 'MediaPlayPause' } }),
          tile(2, { label: 'Próxima', icon: { kind: 'lucide', name: 'skip-forward' }, action: { kind: 'keys', combo: 'MediaNextTrack' } }),
        ],
      }],
    }),
    deck({
      id: 'd-roblox',
      name: 'Roblox',
      mode: 'summon',
      showWhen: { kind: 'apps', apps: ['RobloxPlayerBeta.exe'] },
      hotkey: 'Ctrl+Alt+D',
      grid: { cols: 3, rows: 2, size: 'l' },
      pages: [{
        id: 'p-roblox',
        tiles: [
          tile(0, { icon: { kind: 'emoji', value: '⚔️' }, action: { kind: 'macro', macro: 'Combo 1-2-3' } }),
          tile(1, { icon: { kind: 'emoji', value: '🔁' }, action: { kind: 'macro', macro: 'Trocar arma' } }),
          tile(2, { icon: { kind: 'emoji', value: '🦘' }, action: { kind: 'macro', macro: 'Pulo duplo' } }),
        ],
      }],
    }),
  ],
};

const state = (): DeckState => ({
  config,
  loadFailed: false,
  loadedFromBackup: false,
  pendingFile: 'deck.pending.json',
  macros: Object.fromEntries(macrosNamed(config).map(name => [name, { found: LIBRARY.includes(name) }])),
});

export function installDeckDemo() {
  const w = window as unknown as { chrome?: { webview?: Webview } };
  const before = w.chrome?.webview;
  const listeners = new Set<Listener>();
  const emit = (message: unknown) => queueMicrotask(() => listeners.forEach(l => l({ data: message })));
  const webview: Webview = {
    postMessage: (raw) => {
      const m = raw as Msg;
      switch (m?.type) {
        case 'deck:get':
        case 'deck:overwriteUnreadable':
          emit({ type: 'deck:state', payload: state() });
          break;
        case 'deck:save':
          config = (m.payload?.config as DeckConfig | undefined) ?? config;
          // The number of the save, echoed as the engine does (Fase 8).
          emit({ type: 'deck:state', payload: { ...state(), seq: typeof m.payload?.seq === 'number' ? m.payload.seq : undefined } });
          break;
        default:
          before?.postMessage(raw);
      }
    },
    addEventListener: (type, listener) => {
      if (type === 'message') listeners.add(listener);
      before?.addEventListener(type, listener);
    },
    removeEventListener: (type, listener) => {
      listeners.delete(listener);
      before?.removeEventListener(type, listener);
    },
  };
  w.chrome ??= {};
  w.chrome.webview = webview;
  console.info('[Deck] fake engine for the deck:* messages: sample data.');
}
