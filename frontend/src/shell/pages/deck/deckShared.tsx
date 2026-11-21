// Deck page (branch deck, Fase 5): what the page's grid and its panel both draw and read — the deck and the
// grid shown, a button's label and face as the native window draws them (DeckWindow.DrawTile, LabelOf).
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AppWindow, ArrowRightLeft, ChevronLeft, Circle, Command, ExternalLink, Folder, Keyboard, LayoutGrid, MousePointerClick, Play, Plus,
  SkipBack, SkipForward, Square, TriangleAlert, Type, Volume1, Volume2, VolumeX, Zap, type LucideIcon,
} from 'lucide-react';
import type { DeckDeck, DeckIcon, DeckTile } from '../../../bridge/messageTypes';
import { t, tn } from '../../../i18n';
import { SWATCH_CHECK_INK } from '../../../themes';
import { keycaps, lightSwatch } from '../../library/model';
import { useMk } from '../../mk/mkStore';
import { useApp } from '../../store';
import { defaultIconName, openLabel, type DeckView } from '../../deck/deckModel';
import { useDeck } from '../../deck/deckStore';
import { pickSlot, useDeckUi } from '../../deck/deckUi';

/** The deck shown: the one open, or the first. */
export function useShownDeck(): DeckDeck | null {
  const open = useDeckUi(s => s.open);
  return useDeck(s => s.config.decks.find(d => d.id === open) ?? s.config.decks[0] ?? null);
}

/** The grid shown, kept to what the deck has: a page past the last, or a folder deleted, is its first page. */
export function useShownView(deck: DeckDeck | null): DeckView {
  const view = useDeckUi(s => s.view);
  if (!deck) return { kind: 'page', index: 0 };
  if (view.kind === 'page') return view.index < deck.pages.length ? view : { kind: 'page', index: 0 };
  return deck.folders.some(f => f.id === view.id) ? view : { kind: 'page', index: 0 };
}

/** The view as a key: a field typed in one grid's button never lands in another's. */
export const viewKey = (view: DeckView) => (view.kind === 'page' ? `p${view.index}` : `f:${view.id}`);

/** The focus to a control of the page once what an action drew is in (Fase 8): a place, the gear, the deck's ⋯. */
export function focusLater(selector: string) {
  setTimeout(() => document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true }), 0);
}

/** The focus to a place of the grid, once the grid drawn after an edit is in (Fase 8). */
export const focusPlace = (slot: number) => focusLater(`.dk-grid [data-slot="${slot}"]`);

/** The place chosen goes; the focus goes back to it in the grid. */
export function closeSlot() {
  const slot = useDeckUi.getState().slot;
  pickSlot(null);
  if (slot !== null) focusPlace(slot);
}

/** A TR3 command's label under its icon, as the window writes it (engine-deck.command). */
export const COMMAND_SHORT = tn('deck.commandShort');
/** A media or volume key by its name, as the window writes it (engine-deck.keyNames). */
export const KEY_NAMES: Readonly<Record<string, string>> = tn('deck.keys.names');

/** Keys as the button shows them: a media or volume key by its name, the rest as key caps. */
export const keysText = (combo: string) => KEY_NAMES[combo] ?? keycaps(combo);

/** What a button says without a label of its own (DeckWindow.LabelOf). */
export function defaultLabel(tile: DeckTile, deck: DeckDeck): string {
  const a = tile.action;
  switch (a.kind) {
    case 'macro': return a.macro ?? '';
    case 'keys': return a.combo ? keysText(a.combo) : '';
    case 'text': return (a.text ?? '').replace(/[\r\n]+/g, ' ');
    case 'open': return a.target ? openLabel(a.target) : '';
    case 'folder': return deck.folders.find(f => f.id === a.folder)?.name ?? '';
    case 'tr3': return a.command ? COMMAND_SHORT[a.command] : '';
    default: return '';
  }
}

export const labelOf = (tile: DeckTile, deck: DeckDeck) => tile.label || defaultLabel(tile, deck);

/** The apps of "only with these apps", by name without .exe. */
export const appsText = (apps: string[]) => apps.map(a => a.replace(/\.exe$/i, '')).join(', ');

/** The icons a button shows without one of its own, and the window's own (DeckIcons.g.cs), by name. */
const KNOWN: Record<string, LucideIcon> = {
  play: Play, keyboard: Keyboard, type: Type, 'external-link': ExternalLink, folder: Folder, plus: Plus, circle: Circle, square: Square,
  'mouse-pointer-click': MousePointerClick, 'arrow-right-left': ArrowRightLeft, zap: Zap, command: Command, 'app-window': AppWindow,
  'triangle-alert': TriangleAlert, 'chevron-left': ChevronLeft, 'layout-grid': LayoutGrid,
  'skip-forward': SkipForward, 'skip-back': SkipBack, 'volume-2': Volume2, 'volume-1': Volume1, 'volume-x': VolumeX,
};

/** A picture the engine keeps for a button (Deck\images, Fase 6), as the page reads it (MainWindow.MapDeckImages). */
export const deckImageUrl = (file: string) => `https://deck.local/${encodeURIComponent(file)}`;

/** A picture of Deck\images; one that cannot load shows `fallback`, as the window falls back to the kind's icon. */
function DeckImage({ file, className, fallback }: { file: string; className: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === file) return <>{fallback}</>;
  return <img className={className} src={deckImageUrl(file)} alt="" draggable={false} aria-hidden="true" onError={() => setFailed(file)} />;
}

/**
 * An icon of the deck's: a chosen lucide icon as a mask of the SVG deck.json keeps (the same the native
 * window draws), a picture of Deck\images, one the page knows by name, or the default it falls back to.
 */
export function IconGlyph({ icon, fallback, className }: { icon?: DeckIcon; fallback: string; className?: string }) {
  const Known = (icon?.kind === 'lucide' && icon.name && KNOWN[icon.name]) || KNOWN[fallback] || Plus;
  if (icon?.kind === 'image' && icon.path)
    return <DeckImage file={icon.path} className={className ? `dk-glyph-img ${className}` : 'dk-glyph-img'} fallback={<Known className={className} aria-hidden="true" />} />;
  if (icon?.kind === 'lucide' && icon.svg) {
    const style = { '--dk-mask': `url("data:image/svg+xml,${encodeURIComponent(icon.svg)}")` } as CSSProperties;
    return <span className={className ? `dk-mask ${className}` : 'dk-mask'} style={style} aria-hidden="true" />;
  }
  return <Known className={className} aria-hidden="true" />;
}

/** A button's picture alone (the panel's head): its emoji, the chip of its colour, or its icon. */
export function TileIcon({ tile }: { tile: DeckTile }) {
  const macro = tile.action.kind === 'macro' ? tile.action.macro ?? null : null;
  const emojiOfMacro = useApp(a => (macro && !tile.icon ? a.profiles.find(p => p.name === macro)?.iconEmoji ?? null : null));
  const emoji = tile.icon?.kind === 'emoji' ? tile.icon.value : emojiOfMacro;
  if (emoji) return <span className="dk-emoji-small">{emoji}</span>;
  return <IconGlyph icon={tile.icon} fallback={defaultIconName(tile.action)} />;
}

/**
 * A button's face, as DeckWindow.DrawTile draws it: the icon (or the chip of its colour, with the icon in
 * the ink that reads on it), the label under it, and its state — the ring of a macro running or of the
 * recording, the wash and the mini-switch of a TR3 switch on, the alert of a macro that does not exist.
 */
export function TileFace({ tile, label }: { tile: DeckTile; label: string }) {
  const a = tile.action;
  const macro = a.kind === 'macro' ? a.macro ?? null : null;
  const missing = useDeck(s => (macro ? s.macros[macro]?.found === false : false));
  const emojiOfMacro = useApp(s => (macro && !tile.icon ? s.profiles.find(p => p.name === macro)?.iconEmoji ?? null : null));
  const ring = useRing(tile);
  const on = useSwitchState(tile);
  const emoji = tile.icon?.kind === 'emoji' ? tile.icon.value : emojiOfMacro;
  const fallback = defaultIconName(a);
  // The window's order (DeckWindow.DrawIcon): the alert, the emoji, a picture, the chip of the colour, the icon.
  const image = tile.icon?.kind === 'image' ? tile.icon.path : undefined;
  const glyph = image ? undefined : tile.icon;
  const ink = tile.color ? (lightSwatch(tile.color) ? SWATCH_CHECK_INK.onLight : SWATCH_CHECK_INK.onDark) : '';
  const plain = tile.color ? (
    <span className="dk-chip" style={{ '--swatch': tile.color, '--swatch-ink': ink } as CSSProperties} aria-hidden="true">
      <IconGlyph icon={glyph} fallback={fallback} className="dk-chip-icon" />
    </span>
  ) : <IconGlyph icon={glyph} fallback={fallback} className="dk-icon" />;
  let picture;
  if (missing) picture = <TriangleAlert className="dk-icon" data-missing="" aria-hidden="true" />;
  else if (emoji) picture = <span className="dk-emoji" aria-hidden="true">{emoji}</span>;
  else if (image) picture = <DeckImage file={image} className="dk-img" fallback={plain} />;
  else picture = plain;
  return (
    <>
      {picture}
      {label && <span className="dk-label">{label}</span>}
      {on !== null && <span className="dk-mini" data-on={on || undefined} aria-hidden="true" />}
      {ring && <span className="dk-ring" data-ring={ring} aria-hidden="true" />}
    </>
  );
}

/** What a button's face shows of its state, in words (its accessible name, Fase 8); null when it shows none. */
export function useTileStateText(tile: DeckTile): string | null {
  const a = tile.action;
  const macro = a.kind === 'macro' ? a.macro ?? null : null;
  const missing = useDeck(s => (macro ? s.macros[macro]?.found === false : false));
  const ring = useRing(tile);
  const on = useSwitchState(tile);
  if (missing) return t('deck.board.stateMissing');
  if (ring === 'replay') return t('deck.board.stateRunning');
  if (ring === 'record') return t('deck.board.stateRecording');
  if (on !== null) return on ? t('deck.board.stateOn') : t('deck.board.stateOff');
  return null;
}

/** The ring a button's state draws: a macro running (its own), the recording on Record, the Clicker clicking. */
function useRing(tile: DeckTile): 'replay' | 'record' | null {
  const a = tile.action;
  return useApp((s) => {
    // A macro's own run, or its recording (Record here, Fase 6: the macro being recorded is the open one).
    if (a.kind === 'macro') {
      if (!a.macro || s.activeProfile !== a.macro) return null;
      return s.status === 'replaying' && !s.settings.useCursorClick ? 'replay' : s.status === 'recording' ? 'record' : null;
    }
    if (a.kind === 'tr3' && a.command === 'record') return s.status === 'recording' ? 'record' : null;
    if (a.kind === 'tr3' && a.command === 'clicker') return s.status === 'replaying' && s.settings.useCursorClick ? 'replay' : null;
    return null;
  });
}

/** A TR3 switch's state (Clicker, Keyboard, Key Remaps, Automations, Shortcuts); null for any other button. */
function useSwitchState(tile: DeckTile): boolean | null {
  const a = tile.action;
  const command = a.kind === 'tr3' ? a.command : undefined;
  const app = useApp((s) => {
    switch (command) {
      case 'clicker': return s.settings.useCursorClick;
      case 'remaps': return s.settings.remaps.enabled;
      case 'automations': return s.automation.enabled;
      case 'shortcuts': return s.settings.profileKeyEnabled;
      default: return null;
    }
  });
  const teclado = useMk(s => s.enabled);
  return command === 'teclado' ? teclado : app;
}

/** A name typed in its place: Enter or leaving keeps it, Esc goes back. `byKey`: ended by Enter or Esc. */
export function RenameField({ name, label, max, onDone }: { name: string; label: string; max: number; onDone: (name: string | null, byKey: boolean) => void }) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (next: string | null, byKey: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(next, byKey);
  };
  return (
    <input className="dk-rename" aria-label={label} value={value} maxLength={max} spellCheck={false}
      ref={(el) => { if (el && document.activeElement !== el && !done.current) { el.focus(); el.select(); } }}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(value, true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null, true); }
      }}
      onBlur={() => finish(value, false)} />
  );
}
