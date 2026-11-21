import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, Check, ChevronLeft, Ellipsis, Folder, LayoutGrid, MousePointerClick, Pencil, Plus, Settings, TriangleAlert } from 'lucide-react';
import { create } from 'zustand';
import type { DeckDeck, DeckTile } from '../../../bridge/messageTypes';
import { useBridge } from '../../../bridge/BridgeContext';
import { fmtNum, t, tn } from '../../../i18n';
import { useToast } from '../../../state/ToastContext';
import { Switch } from '../../inspector/fields';
import { freeName, keycaps } from '../../library/model';
import { Menu } from '../../Menu';
import { anchorBelow, anchorFromEvent, fromKeyboard, type MenuAnchor } from '../../menuAnchor';
import { useApp } from '../../store';
import { useShellBand } from '../../useShellBand';
import {
  addPage, bringBackHidden, createDeck, deleteDeck, deleteFolder, deletePage, duplicateDeck, moveTile, moveTileToPage, overwriteUnreadable,
  renameFolder, setEnabled, shiftPage, updateDeck,
} from '../../deck/deckEdit';
import { DECK_LIMITS, DECK_SIZES, hiddenTiles, isBackSlot, slotsOf, tilesOf, type DeckView } from '../../deck/deckModel';
import { addExampleDeck, editOnScreen, exportDeck, importDeck, useDeck, useDeckSync } from '../../deck/deckStore';
import { askSettings, goToTile, openDeck, pickSlot, showGeneral, showView, useDeckUi } from '../../deck/deckUi';
import { DeckImportDialog } from './DeckImport';
import { DeckPanel } from './DeckPanels';
import {
  appsText, closeSlot, focusLater, focusPlace, IconGlyph, labelOf, RenameField, TileFace, useShownDeck, useShownView, useTileStateText,
} from './deckShared';
import '../../inspector/editors.css';
import '../../inspector/windowEditors.css';
import '../remaps/remaps.css';
import './deck.css';

/**
 * ② Deck (branch deck, Fase 5; plan .claude/planos/deck-2026-11-19.md): the decks of buttons the engine
 * draws on screen (DeckHost, a native window that never takes the focus). The decks on the left, in the
 * library's place and form; the deck chosen in the middle, drawn as the screen draws it; on the right the
 * button chosen, or the deck's own settings, or the Deck's (the gear). The decks are the engine's
 * (DeckService, deck.json) and every edit goes back whole; the deck on screen follows it at once.
 *
 * Rule 1: no button reads the whole store. The grid reads the deck once, and each button only whether it
 * is the one chosen and the one live state it shows.
 */
export default function DeckPage() {
  useDeckSync();
  const loaded = useDeck(s => s.loaded);
  const empty = useDeck(s => s.config.decks.length === 0);
  const general = useDeckUi(s => s.panel === 'general');
  useImported();
  // Esc closes the place chosen, as the Teclado closes its key, and then the Deck's settings; a field keeps its own Esc.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.closest('[role="menu"], [role="dialog"]'))) return;
      const ui = useDeckUi.getState();
      // A panel that goes with the focus in it hands the focus to what opened it (Fase 8).
      const inPanel = !!el?.closest('.dk-panel');
      if (ui.slot !== null) closeSlot();
      else if (ui.panel === 'general') {
        showGeneral(false);
        if (inPanel) focusLater('.dk-gear');
      } else if (ui.settingsAsked) {
        askSettings(false);
        if (inPanel) focusLater('.dk-more');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Until the engine's first deck:state the page holds no decks, and an edit made then would save that
  // empty list over deck.json and its backup: nothing is drawn, nor editable, before it (the Teclado's rule).
  if (!loaded) return <section className="shell-page dk" aria-label={t('deck.page')} aria-busy="true" />;
  return (
    <section className="shell-page dk" data-empty={(empty && !general) || undefined} aria-label={t('deck.page')}>
      <Decks />
      <div className="dk-main">
        <Warn />
        {empty ? <EmptyMain /> : <Shown />}
      </div>
      {(!empty || general) && <DeckPanel />}
      <DeckImportDialog />
    </section>
  );
}

/**
 * Decks that came in (Fase 7: an imported .trdeck, the example): the first one opens, and a toast says what came —
 * and what did not: the macros its buttons run that this library lacks, a hotkey taken here, a file past the limit.
 */
function useImported() {
  const { subscribe } = useBridge();
  const { showToast } = useToast();
  useEffect(() => subscribe((m) => {
    if (m.type !== 'deck:imported') return;
    const { decks, left, example } = m.payload;
    if (decks.length === 0) {
      if (left > 0) showToast(t('deck.file.full', { max: DECK_LIMITS.decks }), { type: 'info', duration: 6000 });
      return;
    }
    openDeck(decks[0].id);
    const frases = [example
      ? t('deck.file.exampleAdded', { deck: decks[0].name })
      : decks.length === 1 ? t('deck.file.imported', { deck: decks[0].name }) : t('deck.file.importedMany', { count: decks.length, n: fmtNum(decks.length) })];
    const missing = decks.reduce((n, d) => n + (d.missingMacros ?? 0), 0);
    if (missing > 0) frases.push(t('deck.file.missingMacros', { count: missing, n: fmtNum(missing) }));
    // Each deck by its name: with several in the file, "its hotkey" would say none (Fase 8).
    for (const d of decks) {
      // Why it stayed behind: no Ctrl, Alt or Win (it would take its key from every app), or taken here.
      if (d.hotkeyBare) frases.push(t('deck.file.hotkeyBare', { deck: d.name }));
      else if (d.hotkeyDropped) frases.push(t('deck.file.hotkeyDropped', { deck: d.name }));
    }
    if (left > 0) frases.push(t('deck.file.full', { max: DECK_LIMITS.decks }));
    const told = frases.length > 1;
    showToast(frases.join(' '), { type: told ? 'info' : 'success', duration: told ? 9000 : undefined });
  }), [subscribe, showToast]);
}

/** The nine anchors, as a place in a sentence. */
const ANCHORS = tn('deck.anchors');

// ── The decks (as the library) ──

/**
 * A right-click on a deck (or Shift+F10, the Menu key) opens that deck and its ⋯ menu at the cursor. The
 * menu lives in the head, where Rename acts on the open deck; the list only asks for it, and only the
 * head reads the ask (the Teclado's games do the same).
 */
const useDeckMenu = create<{ ask: { id: string; anchor: MenuAnchor; keyboard: boolean; seq: number } | null }>(() => ({ ask: null }));
let menuSeq = 0;

function Decks() {
  const decks = useDeck(s => s.config.decks);
  const enabled = useDeck(s => s.config.enabled);
  const shown = useShownDeck();
  const general = useDeckUi(s => s.panel === 'general');
  // 1024–1279 and narrower, the list folds into avatars (deck.css): the names go to the accessible name and the tip.
  const folded = useShellBand() !== 'wide';
  const full = decks.length >= DECK_LIMITS.decks;
  const title = t('deck.list.title');
  const [more, setMore] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement; keyboard: boolean } | null>(null);
  const create = () => {
    const deck = createDeck(freeName(t('deck.list.newName'), decks.map(d => d.name)));
    if (deck) openDeck(deck.id);
  };
  const fullTip = full ? t('deck.list.full', { max: DECK_LIMITS.decks }) : undefined;
  return (
    <aside className="dk-decks" aria-label={title}>
      <div className="lib-header">
        <span className="lib-title">{title}</span>
        <button type="button" className="insp-icon-button dk-gear" aria-pressed={general} aria-label={t('deck.list.general')}
          data-tip={t('deck.list.general')} data-tip-pos="end" onClick={() => showGeneral(!general)}>
          <Settings aria-hidden="true" />
        </button>
        <button type="button" className="lib-new" disabled={full}
          aria-label={folded ? t('deck.list.new') : undefined}
          data-tip={full ? t('deck.list.full', { max: DECK_LIMITS.decks }) : folded ? t('deck.list.new') : undefined} data-tip-pos="end"
          onClick={create}>
          <Plus aria-hidden="true" />
          <span>{t('common.actions.new')}</span>
        </button>
        {/* Fase 7: a deck from a .trdeck, and the example deck. */}
        <button type="button" className="insp-icon-button dk-list-more" aria-label={t('deck.list.more')} aria-haspopup="menu" aria-expanded={!!more}
          data-tip={t('deck.list.more')} data-tip-pos="end"
          onClick={(e) => setMore(more ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget, keyboard: e.detail === 0 })}>
          <Ellipsis aria-hidden="true" />
        </button>
        {more && (
          <Menu anchor={more.anchor} label={t('deck.list.more')} toggle={more.button} focusFirst={more.keyboard} onClose={() => setMore(null)}
            entries={[
              { label: t('deck.list.import'), disabled: full, tip: fullTip, onSelect: importDeck },
              { label: t('deck.list.example'), disabled: full, tip: fullTip, onSelect: addExampleDeck },
            ]} />
        )}
      </div>
      <div className="dk-master">
        <span className="dk-master-text">{t('deck.list.on')}</span>
        <Switch label={t('deck.list.on')} checked={enabled} onChange={setEnabled} />
      </div>
      <div className="dk-decks-list">
        {decks.map(d => <DeckRow key={d.id} deck={d} open={shown?.id === d.id} folded={folded} />)}
        {decks.length === 0 && <span className="dk-decks-none">{t('deck.list.none')}</span>}
      </div>
      <p className="dk-decks-foot">{t('deck.list.foot')}</p>
    </aside>
  );
}

function DeckRow({ deck, open, folded }: { deck: DeckDeck; open: boolean; folded: boolean }) {
  const sub = deckSub(deck);
  return (
    <button type="button" className="dk-deck-row" aria-current={open || undefined} data-off={!deck.on || undefined}
      aria-label={folded ? `${deck.name}, ${sub}` : undefined} data-tip={folded ? deck.name : undefined} data-tip-pos="end"
      onClick={() => { if (!open) openDeck(deck.id); }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!open) openDeck(deck.id);
        useDeckMenu.setState({ ask: { id: deck.id, anchor: anchorFromEvent(e), keyboard: fromKeyboard(e), seq: ++menuSeq } });
      }}>
      <DeckAvatar deck={deck} />
      <span className="dk-deck-text">
        <span className="dk-deck-name">{deck.name}</span>
        <span className="dk-deck-sub">{sub}</span>
      </span>
    </button>
  );
}

/** A deck's picture in the list: its own icon, or its initial. */
function DeckAvatar({ deck }: { deck: DeckDeck }) {
  const icon = deck.icon;
  return (
    <span className="dk-avatar" aria-hidden="true">
      {icon?.kind === 'emoji' && icon.value ? <span className="dk-avatar-emoji">{icon.value}</span>
        : icon?.kind === 'lucide' ? <IconGlyph icon={icon} fallback="layout-grid" className="dk-avatar-icon" />
        : (Array.from(deck.name.trim())[0] ?? '?').toLocaleUpperCase()}
    </span>
  );
}

/** A deck in a few words: how it shows. */
function deckSub(deck: DeckDeck): string {
  if (!deck.on) return t('deck.list.sub.off');
  if (deck.mode === 'summon') return deck.hotkey ? t('deck.list.sub.summon', { key: keycaps(deck.hotkey) }) : t('deck.list.sub.summonNoKey');
  if (deck.showWhen.kind === 'apps' && deck.showWhen.apps.length > 0) return t('deck.list.sub.fixedApps', { apps: appsText(deck.showWhen.apps) });
  return t('deck.list.sub.fixedAlways');
}

/** deck.json could not be read (DeckService's quarantine): what is shown, where edits go, and the way out. */
function Warn() {
  const failed = useDeck(s => s.loadFailed);
  const backup = useDeck(s => s.loadedFromBackup);
  const detail = useDeck(s => s.loadFailureDetail);
  const pending = useDeck(s => s.pendingFile);
  // Fase 8: deck.json could not be written — the engine's sentence (the decks hold for this session only).
  const saveFailed = useDeck(s => s.saveFailed);
  if (!failed) {
    return saveFailed ? (
      <div className="rm-warn" role="alert">
        <div className="rm-warn-body"><p className="rm-warn-text">{saveFailed}</p></div>
      </div>
    ) : null;
  }
  return (
    <div className="rm-warn" role="alert">
      <div className="rm-warn-body">
        <p className="rm-warn-text">{backup ? t('deck.warn.backup', { pending }) : t('deck.warn.noBackup', { pending })}</p>
        {detail && <p className="rm-warn-detail">{detail}</p>}
      </div>
      <button type="button" className="insp-button" onClick={overwriteUnreadable}>{t('deck.warn.replace')}</button>
    </div>
  );
}

/** No deck yet: what the Deck is for, and the way to the first one. */
function EmptyMain() {
  return (
    <div className="rm-empty">
      <span className="rm-empty-icon" aria-hidden="true"><LayoutGrid /></span>
      <span className="rm-empty-title">{t('deck.empty.title')}</span>
      <span className="rm-empty-text">{t('deck.empty.text')}</span>
      <div className="dk-empty-actions">
        <button type="button" className="insp-button dk-empty-add" data-variant="primary"
          onClick={() => {
            const names = useDeck.getState().config.decks.map(d => d.name);
            const deck = createDeck(freeName(t('deck.list.newName'), names));
            if (deck) openDeck(deck.id);
          }}>
          <Plus aria-hidden="true" />
          {t('deck.empty.create')}
        </button>
        {/* Fase 7: a deck ready to use (media, volume, a few Windows shortcuts), and one from a file. */}
        <button type="button" className="insp-button dk-empty-example" onClick={addExampleDeck}>
          <LayoutGrid aria-hidden="true" />
          {t('deck.empty.example')}
        </button>
        <button type="button" className="insp-link dk-empty-import" onClick={importDeck}>{t('deck.list.import')}</button>
      </div>
    </div>
  );
}

/** The deck shown: its head, its pages, its grid and the notes. */
function Shown() {
  const deck = useShownDeck();
  const view = useShownView(deck);
  if (!deck) return null;
  return (
    <>
      <Head deck={deck} />
      <Bar deck={deck} view={view} />
      <div className="dk-scroll">
        <Board deck={deck} view={view} />
        <Notes deck={deck} />
      </div>
    </>
  );
}

// ── The head ──

function Head({ deck }: { deck: DeckDeck }) {
  const { showToast } = useToast();
  const full = useDeck(s => s.config.decks.length >= DECK_LIMITS.decks);
  const moreRef = useRef<HTMLButtonElement>(null);
  const [own, setOwn] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement; keyboard: boolean } | null>(null);
  const [renaming, setRenaming] = useState(false);
  // The list's right-click on this deck: the same menu, at the cursor. Leaving the page forgets it.
  const ask = useDeckMenu(s => (s.ask && s.ask.id === deck.id ? s.ask : null));
  useEffect(() => () => useDeckMenu.setState({ ask: null }), []);
  const menu = own ? { ...own, seq: 0 } : ask ? { anchor: ask.anchor, button: null, keyboard: ask.keyboard, seq: ask.seq } : null;
  const setMenu = (next: { anchor: MenuAnchor; button: HTMLButtonElement; keyboard: boolean } | null) => {
    setOwn(next);
    if (useDeckMenu.getState().ask) useDeckMenu.setState({ ask: null });
  };
  const remove = () => {
    // The deck beside it opens (Fase 8): a place chosen in this one would show in the next one drawn.
    const decks = useDeck.getState().config.decks;
    const i = decks.findIndex(d => d.id === deck.id);
    const neighbor = decks[i + 1] ?? decks[i - 1] ?? null;
    const undo = deleteDeck(deck.id);
    if (neighbor) openDeck(neighbor.id);
    else pickSlot(null);
    showToast(t('deck.head.deleted', { deck: deck.name }), { type: 'success', duration: 10000, action: { label: t('common.actions.undo'), onClick: undo } });
  };
  const duplicate = () => {
    const names = useDeck.getState().config.decks.map(d => d.name);
    const copy = duplicateDeck(deck.id, freeName(t('deck.head.copyName', { deck: deck.name }), names));
    if (!copy) return;
    openDeck(copy.id);
    showToast(t('deck.head.duplicated', { deck: copy.name }), { type: 'info', duration: 6000 });
  };
  const summon = deck.mode === 'summon';
  // Fase 6: the deck edited in its own place on screen (a called deck is edited here only).
  const editing = useDeck(s => s.editing === deck.id);
  return (
    <header className="dk-head">
      <div className="dk-titles">
        <h1 className="dk-title">
          {renaming
            ? <RenameField name={deck.name} label={t('deck.head.renameLabel')} max={DECK_LIMITS.name} onDone={(name, byKey) => {
              if (name !== null && name.trim() && name.trim() !== deck.name) updateDeck(deck.id, { name: name.trim() });
              setRenaming(false);
              if (byKey) setTimeout(() => moreRef.current?.focus({ preventScroll: true }), 0);
            }} />
            : <span className="dk-title-text">{deck.name}</span>}
          <span className="dk-pill" data-tone={summon ? 'summon' : undefined}>{summon ? t('deck.head.summon') : t('deck.head.fixed')}</span>
        </h1>
        <p className="dk-sub">{headSub(deck)}</p>
      </div>
      <div className="dk-head-end">
        {!summon && (
          <button type="button" className="insp-button dk-edit" aria-pressed={editing} data-tip={editing ? undefined : t('deck.head.editTip')}
            onClick={() => editOnScreen(editing ? null : deck.id)}>
            {editing ? <Check aria-hidden="true" /> : <Pencil aria-hidden="true" />}
            {editing ? t('deck.head.editing') : t('deck.head.edit')}
          </button>
        )}
        <span className="dk-use">
          {t('deck.head.show')}
          <Switch label={t('deck.head.showLabel', { deck: deck.name })} checked={deck.on} onChange={(on) => updateDeck(deck.id, { on })} />
        </span>
        <span className="rm-sep" aria-hidden="true" />
        <button ref={moreRef} type="button" className="insp-icon-button dk-more" aria-label={t('deck.head.more')} aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget, keyboard: e.detail === 0 })}>
          <Ellipsis aria-hidden="true" />
        </button>
        {menu && (
          <Menu key={menu.seq} anchor={menu.anchor} label={menu.button ? t('deck.head.more') : deck.name} toggle={menu.button}
            focusFirst={menu.keyboard} onClose={() => setMenu(null)}
            entries={[
              { label: t('common.actions.rename'), onSelect: () => setRenaming(true) },
              { label: t('common.actions.duplicate'), disabled: full, tip: full ? t('deck.list.full', { max: DECK_LIMITS.decks }) : undefined, onSelect: duplicate },
              { label: t('deck.head.export'), onSelect: () => exportDeck(deck.id) },
              { label: t('deck.head.settings'), icon: Settings, onSelect: () => askSettings(true) },
              'separator',
              { label: t('common.actions.delete'), danger: true, onSelect: remove },
            ]} />
        )}
      </div>
    </header>
  );
}

/** Where the deck shows, in a line. */
function headSub(deck: DeckDeck): string {
  if (deck.mode === 'summon') {
    if (!deck.hotkey) return t('deck.head.sub.summonNoKey');
    return deck.summon.at === 'center' ? t('deck.head.sub.summonCenter', { key: keycaps(deck.hotkey) }) : t('deck.head.sub.summonCursor', { key: keycaps(deck.hotkey) });
  }
  const place = ANCHORS[deck.place.anchor];
  if (deck.showWhen.kind === 'apps' && deck.showWhen.apps.length > 0) return t('deck.head.sub.fixedApps', { place, apps: appsText(deck.showWhen.apps) });
  return t('deck.head.sub.fixedAlways', { place });
}

// ── The bar: the pages, or the folder open ──

function Bar({ deck, view }: { deck: DeckDeck; view: DeckView }) {
  const { showToast } = useToast();
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const count = tilesOf(deck, view).filter(tile => tile.slot < slotsOf(deck) && !isBackSlot(view, tile.slot)).length;
  const hidden = hiddenTiles(deck, view).length;
  const folder = view.kind === 'folder' ? deck.folders.find(f => f.id === view.id) ?? null : null;
  const page = view.kind === 'page' ? view.index : -1;
  const removePage = () => {
    const n = page + 1;
    const undo = deletePage(deck.id, page);
    showView({ kind: 'page', index: Math.max(0, page - 1) });
    showToast(t('deck.bar.pageDeleted', { n }), { type: 'success', duration: 10000, action: { label: t('common.actions.undo'), onClick: undo } });
  };
  const removeFolder = () => {
    if (!folder) return;
    const undo = deleteFolder(deck.id, folder.id);
    showView({ kind: 'page', index: 0 });
    showToast(t('deck.bar.folderDeleted', { name: folder.name || t('deck.folder.unnamed') }), {
      type: 'success', duration: 10000, action: { label: t('common.actions.undo'), onClick: undo },
    });
  };
  return (
    <div className="dk-bar">
      {folder ? (
        <>
          <button type="button" className="insp-button dk-back" onClick={() => showView({ kind: 'page', index: 0 })}>
            <ArrowLeft aria-hidden="true" />
            {t('deck.bar.pages')}
          </button>
          <span className="dk-crumb">
            <Folder aria-hidden="true" />
            {renaming
              ? <RenameField name={folder.name} label={t('deck.bar.folderName')} max={DECK_LIMITS.label} onDone={(name, byKey) => {
                if (name !== null && name.trim() !== folder.name) renameFolder(deck.id, folder.id, name.trim());
                setRenaming(false);
                // Back to the ⋯ that asked for it, as the deck's name does (Fase 8).
                if (byKey) setTimeout(() => moreRef.current?.focus({ preventScroll: true }), 0);
              }} />
              : <span className="dk-crumb-name">{folder.name || t('deck.folder.unnamed')}</span>}
          </span>
        </>
      ) : (
        <div className="dk-pages" role="group" aria-label={t('deck.bar.pagesLabel')}>
          {deck.pages.map((p, i) => (
            <button key={p.id} type="button" className="rm-chip dk-page" aria-pressed={i === page} data-page={i}
              aria-label={t('deck.bar.page', { n: i + 1 })} onClick={() => showView({ kind: 'page', index: i })}>
              {i + 1}
            </button>
          ))}
          <button type="button" className="rm-chip dk-page-add" aria-label={t('deck.bar.addPage')}
            data-tip={deck.pages.length >= DECK_LIMITS.pages ? t('deck.bar.pagesFull', { max: DECK_LIMITS.pages }) : t('deck.bar.addPage')}
            disabled={deck.pages.length >= DECK_LIMITS.pages}
            onClick={() => { const at = addPage(deck.id); if (at >= 0) showView({ kind: 'page', index: at }); }}>
            <Plus aria-hidden="true" />
          </button>
        </div>
      )}
      <button ref={moreRef} type="button" className="insp-icon-button" aria-label={folder ? t('deck.bar.folderMenu') : t('deck.bar.pageMenu')}
        aria-haspopup="menu" aria-expanded={!!menu}
        onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'start'), button: e.currentTarget })}>
        <Ellipsis aria-hidden="true" />
      </button>
      {menu && (
        <Menu anchor={menu.anchor} label={folder ? t('deck.bar.folderMenu') : t('deck.bar.pageMenu')} toggle={menu.button} onClose={() => setMenu(null)}
          entries={folder ? [
            { label: t('common.actions.rename'), onSelect: () => setRenaming(true) },
            'separator',
            { label: t('deck.bar.deleteFolder'), danger: true, onSelect: removeFolder },
          ] : [
            { label: t('deck.bar.moveLeft'), disabled: page <= 0, onSelect: () => { shiftPage(deck.id, page, -1); showView({ kind: 'page', index: page - 1 }); } },
            { label: t('deck.bar.moveRight'), disabled: page >= deck.pages.length - 1, onSelect: () => { shiftPage(deck.id, page, 1); showView({ kind: 'page', index: page + 1 }); } },
            'separator',
            { label: t('deck.bar.deletePage'), danger: true, disabled: deck.pages.length <= 1, tip: deck.pages.length <= 1 ? t('deck.bar.lastPage') : undefined, onSelect: removePage },
          ]} />
      )}
      <span className="rm-spacer" />
      {hidden > 0 && (
        <span className="dk-hidden">
          {t('deck.bar.hidden', { count: hidden })}
          <button type="button" className="insp-link" onClick={() => {
            const back = bringBackHidden(deck.id, view);
            if (back < hidden) showToast(t('deck.bar.noRoom'), { type: 'info', duration: 6000 });
          }}>{t('deck.bar.bringBack')}</button>
        </span>
      )}
      <span className="dk-count">{t('deck.bar.count', { count })}</span>
    </div>
  );
}

// ── The deck, drawn as the screen draws it ──

/** A button being dragged across the grid: where it came from and where it would land; x and y place the hint. */
interface Drag { from: number; to: number | null; page: number | null; x: number; y: number }

function Board({ deck, view }: { deck: DeckDeck; view: DeckView }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // The place the focus was last on: the one the Tab comes back to (a roving tab stop, Fase 8).
  const [focused, setFocused] = useState<number | null>(null);
  const chosen = useDeckUi(s => s.slot);
  // The room the middle gives the drawing: a deck wider than it is drawn smaller (zoom), never cut nor scrolled sideways.
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setRoom(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // What a drag reads when it ends: the deck and the grid of then, not of when it began (Fase 8).
  const live = useRef({ deck, view });
  useEffect(() => { live.current = { deck, view }; });
  // A drag going on when the page goes lets go of it.
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);
  const size = DECK_SIZES[deck.grid.size];
  // The deck's own width: the buttons, the 6 px gaps, the 8 px pad each side, the border and the 1 px inset.
  const natural = deck.grid.cols * size + (deck.grid.cols - 1) * 6 + 16 + 4;
  const scale = room !== null && room < natural ? Math.max(0.4, room / natural) : 1;
  const slots = slotsOf(deck);
  const bySlot = new Map(tilesOf(deck, view).filter(tile => tile.slot < slots).map(tile => [tile.slot, tile]));
  const folder = view.kind === 'folder' ? deck.folders.find(f => f.id === view.id) ?? null : null;
  const pages = folder ? 1 : deck.pages.length;
  const page = view.kind === 'page' ? view.index : 0;
  const summon = deck.mode === 'summon';
  const tabStop = focused !== null && focused < slots ? focused : chosen !== null && chosen < slots ? chosen : 0;
  // The arrows walk the places; Alt with an arrow carries the button along (moveTile).
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = Number((e.target as HTMLElement).dataset.slot);
    if (!Number.isInteger(at)) return;
    const cols = deck.grid.cols;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols };
    let next: number | null = null;
    if (e.key in step) next = at + step[e.key];
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = slots - 1;
    if (next === null || next < 0 || next >= slots) return;
    e.preventDefault();
    if (e.altKey && bySlot.has(at)) {
      if (isBackSlot(view, next)) return;
      moveTile(deck.id, view, at, next);
      pickSlot(next);
    }
    gridRef.current?.querySelector<HTMLElement>(`[data-slot="${next}"]`)?.focus();
  };
  // A press on a button and a move of a few pixels carries it: to another place (a button there takes its
  // place) or onto a page's number in the bar. The click that ends a drag does not also choose a button.
  // Fase 8: the button holds the pointer while it moves (a release outside the window still ends it), Esc lets
  // go of it where it was, and the page's number under it lights up.
  const startDrag = useCallback((e: ReactPointerEvent<HTMLButtonElement>, from: number) => {
    if (e.button !== 0) return;
    stopDrag.current?.();
    const el = e.currentTarget;
    const pointer = e.pointerId;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moving = false;
    let shown: Drag | null = null;
    let lit: HTMLElement | null = null;
    // The bar is not the board's to draw: the number under the button is marked in place.
    const light = (pageEl: HTMLElement | null) => {
      if (lit === pageEl) return;
      if (lit) delete lit.dataset.drop;
      lit = pageEl;
      if (lit) lit.dataset.drop = '';
    };
    const targetAt = (x: number, y: number) => {
      const under = document.elementFromPoint(x, y);
      const slotEl = under?.closest<HTMLElement>('.dk-grid [data-slot]');
      const pageEl = under?.closest<HTMLElement>('.dk-page[data-page]') ?? null;
      const at = slotEl ? Number(slotEl.dataset.slot) : null;
      const to = at !== null && at !== from && !isBackSlot(live.current.view, at) ? at : null;
      return { to, page: pageEl ? Number(pageEl.dataset.page) : null, pageEl };
    };
    const swallowClick = () => {
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', key, true);
      try { if (el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer); } catch { /* the button left the page */ }
      light(null);
      stopDrag.current = null;
      setDrag(null);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      if (!moving) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        moving = true;
        try { el.setPointerCapture(pointer); } catch { /* no longer a live pointer */ }
      }
      const { to, page: pageTo, pageEl } = targetAt(ev.clientX, ev.clientY);
      light(pageEl);
      // The board draws again when the target changes, or while the hint follows the pointer (over no target).
      if (shown && shown.to === to && shown.page === pageTo && (to !== null || pageTo !== null)) return;
      shown = { from, to, page: pageTo, x: ev.clientX, y: ev.clientY };
      setDrag(shown);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      finish();
      if (!moving || ev.type === 'pointercancel') return;
      const { deck: d, view: v } = live.current;
      const { to, page: pageTo } = targetAt(ev.clientX, ev.clientY);
      if (to !== null) {
        moveTile(d.id, v, from, to);
        pickSlot(to);
        focusPlace(to);
      } else if (pageTo !== null) {
        const at = moveTileToPage(d.id, v, from, pageTo);
        if (at >= 0) {
          goToTile(d.id, { kind: 'page', index: pageTo }, at);
          focusPlace(at);
        }
      }
      swallowClick();
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !moving) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish();
      // The release that comes after chooses nothing either.
      window.addEventListener('pointerup', swallowClick, { capture: true, once: true });
    };
    stopDrag.current = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', key, true);
  }, []);
  const title = folder ? (folder.name || t('deck.folder.unnamed')) : deck.name;
  const style = { '--dk-tile': `${size}px`, '--dk-cols': deck.grid.cols, zoom: scale < 1 ? scale : undefined } as CSSProperties;
  return (
    <div ref={boardRef} className="dk-board">
      <div className="dk-deck" style={style} data-size={deck.grid.size} data-off={!deck.on || undefined}>
        {deck.look.header && (
          <div className="dk-deck-head" aria-hidden="true">
            <span className="dk-deck-title">{title}</span>
            {pages > 1 && (
              <span className="dk-dots">
                {Array.from({ length: pages }, (_, i) => <span key={i} className="dk-dot" data-on={i === page || undefined} />)}
              </span>
            )}
          </div>
        )}
        <div ref={gridRef} className="dk-grid" role="group"
          aria-label={folder ? t('deck.board.labelFolder', { deck: deck.name, folder: title }) : t('deck.board.label', { deck: deck.name, n: page + 1 })}
          onKeyDown={onKeyDown}
          onFocus={(e) => { const at = Number((e.target as HTMLElement).dataset.slot); if (Number.isInteger(at)) setFocused(at); }}>
          {Array.from({ length: slots }, (_, slot) => {
            const tile = bySlot.get(slot) ?? null;
            const target = tile?.action.kind === 'folder' ? tile.action.folder ?? null : null;
            const opens = target && deck.folders.some(f => f.id === target) ? target : null;
            return (
              <Place key={slot} slot={slot} tile={tile} label={tile ? labelOf(tile, deck) : ''} folder={opens} back={isBackSlot(view, slot)}
                badge={summon && slot < 10 ? (slot === 9 ? '0' : String(slot + 1)) : null} tabStop={slot === tabStop}
                dragging={drag?.from === slot} dropping={drag !== null && drag.to === slot} onDragStart={startDrag} />
            );
          })}
        </div>
      </div>
      {drag && drag.to === null && drag.page === null && (
        <span className="dk-drag-hint" style={{ left: drag.x + 12, top: drag.y + 12 }} aria-hidden="true">{t('deck.board.dropHint')}</span>
      )}
    </div>
  );
}

interface PlaceProps {
  slot: number;
  tile: DeckTile | null;
  /** The button's label (its own, or the default the window writes). */
  label: string;
  /** The folder a Folder button opens, when the deck has it. */
  folder: string | null;
  /** The place of a folder's Back. */
  back: boolean;
  badge: string | null;
  /** The place the Tab stops at. */
  tabStop: boolean;
  dragging: boolean;
  dropping: boolean;
  onDragStart: (e: ReactPointerEvent<HTMLButtonElement>, slot: number) => void;
}

/**
 * One place of the grid. Its props are plain values (Fase 8): a drag across the grid draws again only the
 * places whose part in it changes, and an edit only those whose button changed.
 */
const Place = memo(function Place({ slot, tile, label, folder, back, badge, tabStop, dragging, dropping, onDragStart }: PlaceProps) {
  const selected = useDeckUi(s => s.slot === slot);
  const tabIndex = tabStop ? 0 : -1;
  if (back) {
    return (
      <button type="button" className="dk-tile" data-back="" data-slot={slot} tabIndex={tabIndex}
        aria-label={t('deck.board.back')} data-tip={t('deck.board.backTip')} onClick={() => showView({ kind: 'page', index: 0 })}>
        <ChevronLeft className="dk-icon" aria-hidden="true" />
        <span className="dk-label">{t('deck.board.back')}</span>
      </button>
    );
  }
  if (!tile) {
    return (
      <button type="button" className="dk-slot" data-slot={slot} aria-pressed={selected} tabIndex={tabIndex} data-drop={dropping || undefined}
        aria-label={t('deck.board.empty', { n: slot + 1 })} data-tip={t('deck.board.emptyTip')}
        onClick={() => pickSlot(selected ? null : slot)}>
        <Plus className="dk-slot-plus" aria-hidden="true" />
        {badge && <span className="dk-badge" aria-hidden="true">{badge}</span>}
      </button>
    );
  }
  return (
    <TilePlace slot={slot} tile={tile} label={label} folder={folder} badge={badge} tabIndex={tabIndex} selected={selected}
      dragging={dragging} dropping={dropping} onDragStart={onDragStart} />
  );
});

function TilePlace({ slot, tile, label, folder, badge, tabIndex, selected, dragging, dropping, onDragStart }: {
  slot: number; tile: DeckTile; label: string; folder: string | null; badge: string | null; tabIndex: number; selected: boolean;
  dragging: boolean; dropping: boolean; onDragStart: (e: ReactPointerEvent<HTMLButtonElement>, slot: number) => void;
}) {
  // What the face shows of its state goes into the name a screen reader reads, too (Fase 8).
  const state = useTileStateText(tile);
  const name = label ? t('deck.board.tile', { label, n: slot + 1 }) : t('deck.board.tileNoLabel', { n: slot + 1 });
  return (
    <button type="button" className="dk-tile" data-slot={slot} aria-pressed={selected} tabIndex={tabIndex}
      aria-label={state ? t('deck.board.withState', { name, state }) : name}
      data-dragging={dragging || undefined} data-drop={dropping || undefined} data-unset={tile.action.kind === 'none' || undefined}
      onPointerDown={(e) => onDragStart(e, slot)}
      onClick={() => pickSlot(selected ? null : slot)}
      onDoubleClick={() => { if (folder) showView({ kind: 'folder', id: folder }); }}>
      <TileFace tile={tile} label={label} />
      {badge && <span className="dk-badge" aria-hidden="true">{badge}</span>}
    </button>
  );
}

// ── The notes ──

function Notes({ deck }: { deck: DeckDeck }) {
  const enabled = useDeck(s => s.config.enabled);
  const shortcuts = useApp(a => a.settings.profileKeyEnabled);
  const summon = deck.mode === 'summon';
  return (
    <div className="dk-notes">
      {!enabled && (
        <p className="dk-note" data-tone="warn">
          <TriangleAlert aria-hidden="true" />
          <span>
            {t('deck.notes.off')}{' '}
            <button type="button" className="insp-link" onClick={() => setEnabled(true)}>{t('deck.notes.turnOn')}</button>
          </span>
        </p>
      )}
      {!shortcuts && deck.hotkey && <p className="dk-note" data-tone="warn"><TriangleAlert aria-hidden="true" /><span>{t('deck.notes.paused')}</span></p>}
      <p className="dk-note">
        <LayoutGrid aria-hidden="true" />
        <span>{summon && deck.hotkey ? t('deck.notes.summon', { key: keycaps(deck.hotkey) }) : summon ? t('deck.notes.summonNoKey') : t('deck.notes.fixed')}</span>
      </p>
      <p className="dk-note"><MousePointerClick aria-hidden="true" /><span>{t('deck.notes.edit')}</span></p>
    </div>
  );
}
