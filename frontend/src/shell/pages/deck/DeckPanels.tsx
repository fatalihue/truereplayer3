import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  AppWindow, Crop, Ellipsis, ExternalLink, Folder, FolderOpen, Image as ImageIcon, Keyboard, LayoutGrid, ListChecks, Plus, Settings, Smile, Type, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import { useBridge } from '../../../bridge/BridgeContext';
import type {
  DeckAction, DeckAnchor, DeckCommand, DeckDeck, DeckIcon, DeckTile, ProfileEntry, SettingsState,
} from '../../../bridge/messageTypes';
import { splitCombo } from '../../../components/common/KbdTag';
import { t, tn } from '../../../i18n';
import { useEditorTools } from '../../../logic/useEditorTools';
import { isPureModifier, SINGLE_KEY_CAPTURE_IDLE_MS, useKeyCapture } from '../../../logic/useKeyCapture';
import { useToast } from '../../../state/ToastContext';
import { DraftField, Keys, Segmented, Switch } from '../../inspector/fields';
import { emojiCategories, loadEmojiPicker } from '../../inspector/emoji';
import { appIsLight } from '../../inspector/inspectorState';
import { MacroPicker } from '../../inspector/MacroPicker';
import { useAsk } from '../../inspector/probes';
import { ColorGrid } from '../../library/ColorGrid';
import { freeName, keycaps } from '../../library/model';
import { preload, useLoaded } from '../../lazyModule';
import { Menu, type MenuEntry } from '../../Menu';
import { anchorBelow, type MenuAnchor } from '../../menuAnchor';
import { Popover } from '../../Popover';
import { whenOpen } from '../../recordNew';
import { useApp } from '../../store';
import { openPage } from '../../ui';
import {
  addFolder, deckById, deleteTile, duplicateTile, moveTileToPage, patchTile, setEnabled, setGeneral, setTile, updateDeck,
} from '../../deck/deckEdit';
import {
  ACTION_KINDS, DECK_COMMANDS, DECK_LIMITS, defaultIconName, isBackSlot, macrosNamed, SPECIAL_KEYS, tilesOf, type ActionKind, type DeckView,
} from '../../deck/deckModel';
import { postToEngine, useDeck } from '../../deck/deckStore';
import { askSettings, goToTile, pickSlot, showGeneral, showView, useDeckUi, useFocusAsk } from '../../deck/deckUi';
import { hotkeysOf } from '../remaps/remapModel';
import { closeSlot, defaultLabel, focusLater, focusPlace, IconGlyph, labelOf, TileIcon, useShownDeck, useShownView, viewKey } from './deckShared';

// The icon set of the picker: a chunk of its own, brought when the picker is first pointed at (rule 6).
const loadIconSet = () => import('../../deck/deckIconSet');

const KIND_ICON: Record<ActionKind, LucideIcon> = { macro: ListChecks, keys: Keyboard, text: Type, open: ExternalLink, folder: Folder, tr3: Zap };
const KINDS = tn('deck.kinds');
const KIND_HINTS = tn('deck.kindHints');
const COMMANDS = tn('deck.tr3.commands');
const COMMAND_HINTS = tn('deck.tr3.hints');
const SPECIAL = tn('deck.keys.names');
const BUSY_HINTS = tn('deck.macro.busy');
const ANCHORS = tn('deck.anchors');

/**
 * The panel on the right: the button chosen, an empty place chosen (what will it do?), or — with no place
 * chosen — the deck's settings; the gear in the list puts the Deck's own there instead.
 */
export function DeckPanel() {
  const panel = useDeckUi(s => s.panel);
  const slot = useDeckUi(s => s.slot);
  const deck = useShownDeck();
  const view = useShownView(deck);
  if (panel === 'general' || !deck) return <GeneralPanel />;
  if (slot === null) return <DeckSettingsPanel key={deck.id} deck={deck} />;
  const tile = tilesOf(deck, view).find(x => x.slot === slot) ?? null;
  const key = `${deck.id}-${viewKey(view)}-${slot}`;
  if (isBackSlot(view, slot)) return <DeckSettingsPanel key={deck.id} deck={deck} />;
  return tile ? <ButtonPanel key={key} deck={deck} view={view} tile={tile} /> : <NewButtonPanel key={key} deck={deck} view={view} slot={slot} />;
}

/** Where a place is, in a line: the deck, the page or the folder, and the place's number. */
function whereOf(deck: DeckDeck, view: DeckView, slot: number): string {
  if (view.kind === 'folder') {
    const folder = deck.folders.find(f => f.id === view.id);
    return t('deck.panel.whereFolder', { deck: deck.name, folder: folder?.name || t('deck.folder.unnamed'), n: slot + 1 });
  }
  return t('deck.panel.wherePage', { deck: deck.name, page: view.index + 1, n: slot + 1 });
}

/**
 * The arrows in a group of radios, as the Teclado's functions: they move to the next option that is not
 * disabled, round, and choose it; Home and End go to the ends. Where choosing costs something — a button's
 * kind starts its action over — `choose` is false: the arrows only move, and Enter or Space choose (Fase 8).
 * `cols` makes the group a grid (the nine anchors): up and down move a row.
 */
function radioKeys(e: ReactKeyboardEvent<HTMLDivElement>, choose = true, cols = 0) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  if (items.length === 0) return;
  const at = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
  const n = items.length;
  const next = e.key === 'Home' ? 0
    : e.key === 'End' ? n - 1
    : cols && e.key === 'ArrowDown' ? (at + cols) % n
    : cols && e.key === 'ArrowUp' ? (at - cols + n) % n
    : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (at + 1) % n
    : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (at - 1 + n) % n
    : null;
  if (next === null) return;
  e.preventDefault();
  items[next].focus();
  if (choose) items[next].click();
}

// The kind just chosen on an empty place: the button's panel that takes its place puts the focus back on it (Fase 8).
let focusKind: ActionKind | null = null;

/** The action a kind starts with: a button still being set up does nothing until it names what it does. */
function startAction(kind: ActionKind, deck: DeckDeck): DeckAction {
  switch (kind) {
    case 'macro': return { kind: 'macro' };
    case 'keys': return { kind: 'keys' };
    case 'text': return { kind: 'text', text: '', send: 'type' };
    case 'open': return { kind: 'open' };
    case 'folder': return deck.folders[0] ? { kind: 'folder', folder: deck.folders[0].id } : { kind: 'none' };
    case 'tr3': return { kind: 'tr3', command: 'record' };
  }
}

/** Why a kind cannot be chosen here, or null. */
function whyNot(kind: ActionKind, view: DeckView): string | null {
  return kind === 'folder' && view.kind === 'folder' ? t('deck.folder.inside') : null;
}

/**
 * The kinds, as a group of radios with the icon of each (the Teclado's functions). Choosing a kind starts the
 * button's action over, so the arrows only move here, and Enter or Space choose.
 */
function KindList({ value, view, onPick }: { value: ActionKind | null; view: DeckView; onPick: (kind: ActionKind) => void }) {
  const first = value ?? ACTION_KINDS[0];
  const ref = useRef<HTMLDivElement>(null);
  // Chosen on an empty place, the panel was another one: the focus comes back to the kind (a Macro's picker
  // takes it itself, being what comes next).
  useEffect(() => {
    if (!focusKind || focusKind !== value) return;
    if (focusKind !== 'macro') ref.current?.querySelector<HTMLElement>(`[data-kind="${focusKind}"]`)?.focus();
    focusKind = null;
  }, [value]);
  return (
    <div ref={ref} className="dk-kinds" role="radiogroup" aria-label={t('deck.panel.does')} onKeyDown={(e) => radioKeys(e, false)}>
      {ACTION_KINDS.map((k) => {
        const Icon = KIND_ICON[k];
        const off = whyNot(k, view);
        return (
          <button key={k} type="button" role="radio" className="rm-radio" data-kind={k} aria-checked={value === k}
            tabIndex={k === first ? 0 : -1} disabled={!!off} data-tip={off ?? undefined} data-tip-pos="start" onClick={() => onPick(k)}>
            <Icon aria-hidden="true" />
            <span className="dk-kind-name">{KINDS[k]}</span>
            <span className="dk-kind-hint">{KIND_HINTS[k]}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── An empty place ──

function NewButtonPanel({ deck, view, slot }: { deck: DeckDeck; view: DeckView; slot: number }) {
  const pick = (kind: ActionKind) => {
    focusKind = kind;
    const action = startAction(kind, deck);
    // A Folder with no folder yet makes the first one, named as the deck's next.
    if (kind === 'folder' && action.kind === 'none') {
      const id = addFolder(deck.id, freeName(t('deck.folder.newName'), deck.folders.map(f => f.name)));
      setTile(deck.id, view, slot, { slot, action: id ? { kind: 'folder', folder: id } : { kind: 'none' } });
      return;
    }
    setTile(deck.id, view, slot, { slot, action });
  };
  return (
    <aside className="rm-panel dk-panel" aria-label={t('deck.panel.newTitle')}>
      <PanelHead icon={<Plus />} title={t('deck.panel.newTitle')} sub={whereOf(deck, view, slot)} onClose={closeSlot} />
      <div className="rm-panel-body">
        <section className="rm-sec" aria-label={t('deck.panel.does')}>
          <span className="rm-label">{t('deck.panel.newQuestion')}</span>
          <KindList value={null} view={view} onPick={pick} />
        </section>
      </div>
      <div className="rm-panel-foot">{t('deck.panel.foot')}</div>
    </aside>
  );
}

function PanelHead({ icon, title, sub, menu, onClose, narrowClose }: {
  icon: ReactNode; title: string; sub: string; menu?: ReactNode; onClose?: () => void;
  /** The × only where the panel lies over the deck (the deck's settings rest in the panel when wide). */
  narrowClose?: boolean;
}) {
  return (
    <div className="rm-panel-head">
      <span className="rm-panel-icon" aria-hidden="true">{icon}</span>
      <div className="rm-panel-titles">
        <span className="rm-panel-title">{title}</span>
        <span className="rm-panel-sub">{sub}</span>
      </div>
      {menu}
      {onClose && (
        <button type="button" className={narrowClose ? 'insp-icon-button dk-close-narrow' : 'insp-icon-button'} aria-label={t('deck.panel.close')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ── A button ──

function ButtonPanel({ deck, view, tile }: { deck: DeckDeck; view: DeckView; tile: DeckTile }) {
  const { showToast } = useToast();
  const slot = tile.slot;
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const kind: ActionKind | null = tile.action.kind === 'none' ? null : tile.action.kind;
  const patch = (p: Partial<DeckTile>) => patchTile(deck.id, view, slot, p);
  const setAction = (a: Partial<DeckAction>) => {
    const now = deckById(deck.id);
    const cur = now && tilesOf(now, view).find(x => x.slot === slot);
    if (cur) patch({ action: { ...cur.action, ...a } });
  };
  const choose = (k: ActionKind) => {
    if (k === kind) return;
    if (k === 'folder' && !deck.folders[0]) {
      const id = addFolder(deck.id, freeName(t('deck.folder.newName'), deck.folders.map(f => f.name)));
      if (id) patch({ action: { kind: 'folder', folder: id } });
      return;
    }
    patch({ action: startAction(k, deck) });
  };
  const label = labelOf(tile, deck);
  // Each of these closes or changes the panel the ⋯ was in: the focus goes to the place in the drawing (Fase 8).
  const remove = () => {
    const undo = deleteTile(deck.id, view, slot);
    closeSlot();
    showToast(label ? t('deck.panel.deleted', { label }) : t('deck.panel.deletedUnnamed'), {
      type: 'success', duration: 10000, action: { label: t('common.actions.undo'), onClick: undo },
    });
  };
  const duplicate = () => {
    const at = duplicateTile(deck.id, view, slot);
    if (at === null) showToast(t('deck.panel.noRoom'), { type: 'info', duration: 6000 });
    else {
      pickSlot(at);
      focusPlace(at);
    }
  };
  const otherPages: MenuEntry[] = deck.pages.map((_, i) => ({
    label: t('deck.bar.page', { n: i + 1 }),
    disabled: view.kind === 'page' && view.index === i,
    onSelect: () => {
      const at = moveTileToPage(deck.id, view, slot, i);
      if (at >= 0) {
        // The button goes on being the one chosen, on the page it went to.
        goToTile(deck.id, { kind: 'page', index: i }, at);
        focusPlace(at);
      } else showToast(t('deck.panel.pageFull', { n: i + 1 }), { type: 'info', duration: 6000 });
    },
  }));
  return (
    <aside className="rm-panel dk-panel" aria-label={t('deck.panel.label', { label: label || t('deck.panel.thisButton') })}>
      <PanelHead
        icon={<TileIcon tile={tile} />}
        title={label || t('deck.panel.untitled')}
        sub={whereOf(deck, view, slot)}
        onClose={closeSlot}
        menu={(
          <button type="button" className="insp-icon-button" aria-label={t('deck.panel.menu')} aria-haspopup="menu" aria-expanded={!!menu}
            onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
            <Ellipsis aria-hidden="true" />
          </button>
        )} />
      {menu && (
        <Menu anchor={menu.anchor} label={t('deck.panel.menu')} toggle={menu.button} onClose={() => setMenu(null)}
          entries={[
            { label: t('common.actions.duplicate'), onSelect: duplicate },
            ...(deck.pages.length > 1 ? [{ label: t('deck.panel.moveTo'), submenu: otherPages }] : []),
            'separator',
            { label: t('deck.panel.delete'), danger: true, onSelect: remove },
          ]} />
      )}
      <div className="rm-panel-body">
        <section className="rm-sec" aria-label={t('deck.panel.does')}>
          <span className="rm-label">{t('deck.panel.does')}</span>
          <KindList value={kind} view={view} onPick={choose} />
        </section>
        {kind === 'macro' && <MacroOptions deck={deck} view={view} tile={tile} setAction={setAction} />}
        {kind === 'keys' && <KeysOptions tile={tile} setAction={setAction} />}
        {kind === 'text' && <TextOptions deck={deck} view={view} tile={tile} setAction={setAction} />}
        {kind === 'open' && <OpenOptions deck={deck} view={view} tile={tile} setAction={setAction} />}
        {kind === 'folder' && <FolderOptions deck={deck} view={view} tile={tile} setAction={setAction} />}
        {kind === 'tr3' && <Tr3Options tile={tile} setAction={setAction} />}
        <LookSection deck={deck} view={view} tile={tile} patch={patch} />
      </div>
      <div className="rm-panel-foot">{t('deck.panel.foot')}</div>
    </aside>
  );
}

interface OptionsProps { deck: DeckDeck; view: DeckView; tile: DeckTile; setAction: (a: Partial<DeckAction>) => void }

/** Macro: a macro of TR3's library, the way to TR3's editor, and a new one recorded for this button. */
function MacroOptions({ deck, tile, setAction }: OptionsProps) {
  const profiles = useApp(a => a.profiles);
  const order = useApp(a => a.profileOrder);
  const busy = useDeck(s => s.config.busyPress);
  // A recording can start only with TR3 at rest and out of Clicker mode: otherwise "Record a new one" waits.
  const canRecord = useApp(a => a.status === 'ready' && !a.settings.useCursorClick);
  const name = tile.action.macro ?? null;
  const missing = useDeck(s => (name ? s.macros[name]?.found === false : false));
  const { send } = useBridge();
  const names = profiles.map(p => p.name);
  const chosen = profiles.find(p => p.name === name) ?? null;
  const folder = order.folders.find(f => f.items.includes(name ?? ''))?.name;
  const [picking, setPicking] = useState(false);
  const swapRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const stopPicking = () => {
    setPicking(false);
    setTimeout(() => swapRef.current?.focus({ preventScroll: true }), 0);
  };
  // A deck's "All macros…" (Fase 6): the picker, open and in the focus.
  useFocusAsk('macro', () => {
    if (chosen && !picking) setPicking(true);
    else pickerRef.current?.querySelector<HTMLElement>('input, button')?.focus();
  });
  const openInEditor = () => {
    if (!chosen) return;
    send({ type: 'profile:open', payload: { name: chosen.name } });
    openPage('macros');
  };
  // A new macro for this button: linked here at once (the button shows it missing for the moment it takes to be
  // made — the link goes out while this page is still here to send it), created in the library, and open in the
  // editor recording from its first step (the Teclado's "Record a new one").
  const recordNew = () => {
    const base = t('deck.macro.newName', { deck: deck.name, n: tile.slot + 1 }).replace(/[\\/:*?"<>|]/g, '').replace(/[. ]+$/, '').trim();
    const macro = freeName(base || deck.name, [...names, ...macrosNamed(useDeck.getState().config)]);
    setAction({ macro });
    whenOpen(macro, true, () => send({ type: 'recording:toggle', payload: { insertIndex: 0 } }));
    send({ type: 'profile:create', payload: { name: macro } });
    openPage('macros');
  };
  const meta = chosen ? [
    folder ? t('deck.macro.folder', { folder }) : null,
    t('deck.macro.steps', { count: chosen.actionCount ?? 0 }),
    chosen.hotkey ? t('deck.macro.hotkey', { hotkey: keycaps(chosen.hotkey) }) : null,
  ].filter(Boolean).join(' · ') : '';
  return (
    <section className="rm-sec" aria-label={t('deck.macro.label')}>
      <span className="rm-label">{t('deck.macro.label')}</span>
      {chosen && !picking ? (
        <div className="dk-macro">
          <ListChecks className="dk-macro-icon" aria-hidden="true" />
          <span className="dk-macro-text">
            <span className="dk-macro-name">{chosen.name}</span>
            <span className="dk-where">{meta}</span>
          </span>
          <button ref={swapRef} type="button" className="insp-button dk-macro-swap" onClick={() => setPicking(true)}>{t('deck.macro.swap')}</button>
        </div>
      ) : (
        <div ref={pickerRef} onKeyDown={(e) => { if (e.key === 'Escape' && chosen) { e.preventDefault(); e.stopPropagation(); stopPicking(); } }}>
          <MacroPicker names={names} value={name} label={t('deck.macro.label')} autoFocus={picking || !name}
            onPick={(macro) => { setAction({ macro }); if (picking) stopPicking(); }} />
          {chosen && <button type="button" className="insp-link dk-picker-cancel" onClick={stopPicking}>{t('common.actions.cancel')}</button>}
        </div>
      )}
      {missing && name && <p className="rm-msg" data-tone="warn">{t('deck.macro.missing', { name })}</p>}
      <div className="insp-line">
        <button type="button" className="insp-button" disabled={!chosen} onClick={openInEditor}>{t('deck.macro.openEditor')}</button>
        <button type="button" className="insp-button" disabled={!canRecord} data-tip={canRecord ? undefined : t('deck.macro.recordBusy')} onClick={recordNew}>
          <span className="dk-rec" aria-hidden="true" />
          {t('deck.macro.recordNew')}
        </button>
      </div>
      <p className="rm-hint">{BUSY_HINTS[busy]}</p>
    </section>
  );
}

// A side button or the wheel is no key to send.
const NOT_A_KEY = new Set(['ScrollUp', 'ScrollDown', 'XButton1', 'XButton2']);
const SPECIAL_NAMES = new Set<string>([...SPECIAL_KEYS.media, ...SPECIAL_KEYS.volume]);

/** A combo as the button shows it: a media or volume key by its name, the rest as key caps. */
function ComboShown({ combo }: { combo: string }) {
  return SPECIAL_NAMES.has(combo) ? <span className="dk-special">{SPECIAL[combo as keyof typeof SPECIAL]}</span> : <Keys combo={combo} />;
}

/**
 * Keys: the combo it sends, captured through the engine's hook (useKeyCapture, as the Teclado's key out):
 * Win+letter and AltGr arrive, and the app's hotkeys stay quiet meanwhile. A modifier alone waits for the
 * rest; a second click on the box takes it alone. Esc is a key here. The media, volume and F13–F24 keys,
 * which a keyboard rarely has, come from Special keys.
 */
function KeysOptions({ tile, setAction }: Pick<OptionsProps, 'tile' | 'setAction'>) {
  const combo = tile.action.combo ?? '';
  const capture = useKeyCapture();
  const [owner] = useState(() => `deck-keys-${crypto.randomUUID()}`);
  const [listening, setListening] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const setRef = useRef(setAction);
  useEffect(() => { setRef.current = setAction; });
  const boxRef = useRef<HTMLButtonElement>(null);
  // A deck's "Keys…" (Fase 6): the box in the focus, listening.
  useFocusAsk('keys', () => {
    boxRef.current?.focus();
    setHeld(null);
    setListening(true);
  });
  useEffect(() => {
    if (!listening) return;
    capture.arm(owner);
    const stop = () => { setListening(false); setHeld(null); };
    let idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
    const off = capture.listen(owner, (got) => {
      if (typeof got !== 'string' || got === '') return;
      const parts = splitCombo(got);
      const key = parts[parts.length - 1];
      if (!key || NOT_A_KEY.has(key)) return;
      clearTimeout(idle);
      idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
      if (isPureModifier(got)) { setHeld(got); return; }
      stop();
      setRef.current({ combo: got });
    });
    return () => {
      clearTimeout(idle);
      off();
      capture.release(owner);
    };
  }, [listening, capture, owner]);
  const shown = held ?? combo;
  const pick = (name: string) => () => setAction({ combo: name });
  return (
    <section className="rm-sec" aria-label={t('deck.keys.label')}>
      <span className="rm-label">{t('deck.keys.label')}</span>
      <button ref={boxRef} type="button" className="insp-capture rm-capture dk-capture" aria-pressed={listening} data-listening={listening || undefined}
        aria-label={t('deck.keys.label')}
        onClick={() => {
          if (listening && held) {
            const alone = held;
            setListening(false);
            setHeld(null);
            setAction({ combo: alone });
            return;
          }
          setHeld(null);
          setListening(on => !on);
        }}
        onBlur={() => { setListening(false); setHeld(null); }}>
        {shown ? <ComboShown combo={shown} /> : <span className="insp-capture-none">{t('inspector.fields.noKey')}</span>}
        <span className="insp-capture-hint">
          {listening ? (held ? t('deck.keys.held', { key: keycaps(held) }) : t('deck.keys.listening'))
            : combo ? t('deck.keys.change') : t('deck.keys.press')}
        </span>
      </button>
      <div className="insp-line">
        <button type="button" className="insp-button" aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'start'), button: e.currentTarget })}>
          {t('deck.keys.special')}
        </button>
      </div>
      {menu && (
        <Menu anchor={menu.anchor} label={t('deck.keys.special')} toggle={menu.button} onClose={() => setMenu(null)}
          entries={[
            { label: t('deck.keys.media'), submenu: SPECIAL_KEYS.media.map(k => ({ label: SPECIAL[k], checked: combo === k, onSelect: pick(k) })) },
            { label: t('deck.keys.volume'), submenu: SPECIAL_KEYS.volume.map(k => ({ label: SPECIAL[k], checked: combo === k, onSelect: pick(k) })) },
            { label: t('deck.keys.extra'), submenu: SPECIAL_KEYS.extra.map(k => ({ label: k, checked: combo === k, onSelect: pick(k) })) },
          ]} />
      )}
      <p className="rm-hint">{t('deck.keys.hint')}</p>
    </section>
  );
}

/** Text: what goes out, typed letter by letter (what a game reads) or pasted (fast, the clipboard put back). */
function TextOptions({ deck, view, tile, setAction }: OptionsProps) {
  const send = tile.action.send ?? 'type';
  const ref = useRef<HTMLElement>(null);
  // A deck's "Text…" (Fase 6): the text in the focus.
  useFocusAsk('text', () => ref.current?.querySelector<HTMLElement>('textarea, input')?.focus());
  return (
    <section ref={ref} className="rm-sec" aria-label={t('deck.text.label')}>
      <span className="rm-label">{t('deck.text.label')}</span>
      <DraftField stepId={`deck:${deck.id}:${viewKey(view)}:${tile.slot}`} field="text" label={t('deck.text.label')} kind="text" multiline empty="clear"
        maxLength={DECK_LIMITS.text} placeholder={t('deck.text.placeholder')} stored={tile.action.text ?? ''} onApply={(text) => setAction({ text })} />
      <Segmented<'type' | 'paste'> label={t('deck.text.how')} value={send}
        options={[{ value: 'type', label: t('deck.text.type') }, { value: 'paste', label: t('deck.text.paste') }]}
        onChange={(v) => setAction({ send: v })} />
      <p className="rm-hint">{send === 'type' ? t('deck.text.typeHint') : t('deck.text.pasteHint')}</p>
    </section>
  );
}

/** Open: a program, a file, a folder or an address, its arguments, and "bring it to the front". */
function OpenOptions({ deck, view, tile, setAction }: OptionsProps) {
  const tools = useEditorTools();
  const id = `deck:${deck.id}:${viewKey(view)}:${tile.slot}`;
  const browse = useAsk('dialog:pickFileResult', (r) => { if (r.path) setAction({ target: r.path }); });
  const ref = useRef<HTMLElement>(null);
  // A deck's "Open…" (Fase 6): the target in the focus.
  useFocusAsk('open', () => ref.current?.querySelector<HTMLElement>('input, textarea')?.focus());
  return (
    <section ref={ref} className="rm-sec" aria-label={t('deck.open.label')}>
      <span className="rm-label">{t('deck.open.label')}</span>
      <div className="insp-line">
        {/* parse: a mono field sends nothing for an empty box, and an emptied target or argument must go (Fase 8). */}
        <DraftField stepId={id} field="target" label={t('deck.open.label')} kind="mono" empty="clear" maxLength={DECK_LIMITS.target} parse={(s) => s.trim()}
          placeholder={t('deck.open.placeholder')} stored={tile.action.target ?? ''} onApply={(target) => setAction({ target: target.trim() || undefined })} />
        <button type="button" className="insp-button" disabled={browse.waiting} data-tip={t('deck.open.browseTip')}
          onClick={() => browse.ask(requestId => tools.pickFile({ requestId, kind: 'executable' }))}>
          <FolderOpen aria-hidden="true" />
          {t('deck.open.browse')}
        </button>
      </div>
      <span className="dk-field-label">{t('deck.open.args')}</span>
      <DraftField stepId={id} field="args" label={t('deck.open.args')} kind="mono" empty="clear" maxLength={DECK_LIMITS.args} parse={(s) => s.trim()}
        placeholder={t('deck.open.argsPlaceholder')} stored={tile.action.args ?? ''} onApply={(args) => setAction({ args: args.trim() || undefined })} />
      <div className="insp-row">
        <Switch label={t('deck.open.focus')} checked={!!tile.action.focus} onChange={(focus) => setAction({ focus: focus || undefined })} />
        <span className="insp-row-label">{t('deck.open.focus')}</span>
      </div>
      <p className="rm-hint">{t('deck.open.hint')}</p>
    </section>
  );
}

/** Folder: which of the deck's folders it opens, a new one, and the way into it on this page. */
function FolderOptions({ deck, view, tile, setAction }: OptionsProps) {
  const current = tile.action.folder ?? null;
  const make = () => {
    const id = addFolder(deck.id, freeName(t('deck.folder.newName'), deck.folders.map(f => f.name)));
    if (id) setAction({ folder: id });
  };
  if (view.kind === 'folder') return <p className="rm-msg" data-tone="warn">{t('deck.folder.inside')}</p>;
  return (
    <section className="rm-sec" aria-label={t('deck.folder.label')}>
      <span className="rm-label">{t('deck.folder.label')}</span>
      <div className="dk-list" role="radiogroup" aria-label={t('deck.folder.label')} onKeyDown={radioKeys}>
        {deck.folders.map((f, i) => {
          const count = f.tiles.filter(x => x.slot > 0).length;
          return (
            <button key={f.id} type="button" role="radio" className="rm-radio" aria-checked={current === f.id}
              tabIndex={current === f.id || (!current && i === 0) ? 0 : -1} onClick={() => setAction({ folder: f.id })}>
              <Folder aria-hidden="true" />
              <span className="dk-kind-name">{f.name || t('deck.folder.unnamed')}</span>
              <span className="dk-kind-hint">{t('deck.folder.count', { count })}</span>
            </button>
          );
        })}
      </div>
      <div className="insp-line">
        <button type="button" className="insp-button" disabled={deck.folders.length >= DECK_LIMITS.folders} onClick={make}>
          <Plus aria-hidden="true" />
          {t('deck.folder.new')}
        </button>
        <button type="button" className="insp-button" disabled={!current} onClick={() => { if (current) showView({ kind: 'folder', id: current }); }}>
          <FolderOpen aria-hidden="true" />
          {t('deck.folder.open')}
        </button>
      </div>
      <p className="rm-hint">{t('deck.folder.hint')}</p>
    </section>
  );
}

/** TR3: one of the app's commands, as the tray's switches and the hotkeys give them. */
function Tr3Options({ tile, setAction }: Pick<OptionsProps, 'tile' | 'setAction'>) {
  const command = tile.action.command ?? 'record';
  return (
    <section className="rm-sec" aria-label={t('deck.tr3.label')}>
      <span className="rm-label">{t('deck.tr3.label')}</span>
      <div className="dk-list" role="radiogroup" aria-label={t('deck.tr3.label')} onKeyDown={radioKeys}>
        {DECK_COMMANDS.map(c => (
          <button key={c} type="button" role="radio" className="rm-radio" aria-checked={command === c}
            tabIndex={command === c ? 0 : -1} onClick={() => { if (c !== command) setAction({ command: c as DeckCommand }); }}>
            <IconGlyph fallback={defaultIconName({ kind: 'tr3', command: c })} />
            <span className="dk-kind-name">{COMMANDS[c]}</span>
          </button>
        ))}
      </div>
      <p className="rm-hint">{COMMAND_HINTS[command]}</p>
    </section>
  );
}

/** The look: the label, the icon (the default's, a lucide icon or an emoji) and the colour. */
function LookSection({ deck, view, tile, patch }: { deck: DeckDeck; view: DeckView; tile: DeckTile; patch: (p: Partial<DeckTile>) => void }) {
  const [picker, setPicker] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement; keyboard: boolean } | null>(null);
  const emoji = tile.icon?.kind === 'emoji';
  const pickRef = useRef<HTMLButtonElement>(null);
  const openPicker = (button: HTMLButtonElement, keyboard: boolean) =>
    void preload(loadIconSet).then(() => setPicker({ anchor: anchorBelow(button, 'start'), button, keyboard }));
  // A deck's "From the list…" (Fase 6): the picker, open.
  useFocusAsk('icon', () => {
    const button = pickRef.current;
    if (!button) return;
    button.scrollIntoView({ block: 'nearest' });
    button.focus({ preventScroll: true });
    openPicker(button, true);
  });
  // A picture the engine keeps (Deck\images): it opens the dialog or the capture, sets it, and deck:state brings it.
  const fromSource = (source: 'app' | 'picture' | 'capture') => postToEngine({
    type: 'deck:iconFrom',
    payload: { deckId: deck.id, folder: view.kind === 'folder' ? view.id : null, page: view.kind === 'page' ? view.index : 0, slot: tile.slot, source },
  });
  // A macro button with no icon of its own shows the macro's emoji (DeckWindow.DrawIcon): the panel says so, and a
  // colour does not show over it (Fase 8).
  const macro = tile.action.kind === 'macro' && !tile.icon ? tile.action.macro ?? null : null;
  const macroEmoji = useApp(a => (macro ? a.profiles.find(p => p.name === macro)?.iconEmoji || null : null));
  const iconName = !tile.icon ? (macroEmoji ? t('deck.look.macroEmoji') : t('deck.look.iconDefault'))
    : emoji ? t('deck.look.emoji') : tile.icon.kind === 'image' ? t('deck.look.image') : t('deck.look.lucide');
  return (
    <section className="rm-sec" aria-label={t('deck.look.label')}>
      <span className="rm-label">{t('deck.look.label')}</span>
      <span className="dk-field-label">{t('deck.look.text')}</span>
      <DraftField stepId={`deck:${deck.id}:${viewKey(view)}:${tile.slot}`} field="label" label={t('deck.look.text')} kind="text" empty="clear"
        maxLength={DECK_LIMITS.label} placeholder={defaultLabel(tile, deck) || t('deck.look.textPlaceholder')} stored={tile.label ?? ''}
        onApply={(label) => patch({ label: label.trim() || undefined })} />
      <span className="dk-field-label">{t('deck.look.icon')}</span>
      <div className="dk-icon-row">
        <button ref={pickRef} type="button" className="dk-icon-pick" aria-label={t('deck.look.chooseIcon')} aria-haspopup="dialog" aria-expanded={!!picker}
          data-tip={t('deck.look.chooseIcon')}
          onPointerEnter={() => { void preload(loadIconSet); }}
          onClick={(e) => {
            if (picker) { setPicker(null); return; }
            openPicker(e.currentTarget, e.detail === 0);
          }}>
          {emoji ? <span className="dk-emoji-small">{tile.icon?.value}</span>
            : macroEmoji ? <span className="dk-emoji-small">{macroEmoji}</span>
            : <IconGlyph icon={tile.icon} fallback={defaultIconName(tile.action)} />}
        </button>
        <span className="dk-icon-name">{iconName}</span>
        {tile.icon && <button type="button" className="insp-link" onClick={() => patch({ icon: undefined })}>{t('deck.look.useDefault')}</button>}
      </div>
      {picker && (
        <IconPicker anchor={picker.anchor} toggle={picker.button} keyboard={picker.keyboard}
          onPick={(icon) => { patch({ icon }); setPicker(null); picker.button.focus(); }}
          onSource={(source) => { setPicker(null); picker.button.focus(); fromSource(source); }}
          onClose={() => setPicker(null)} />
      )}
      <span className="dk-field-label">{t('deck.look.color')}</span>
      <ColorGrid value={tile.color ?? ''} onPick={(color) => patch({ color: color === tile.color ? undefined : color })} />
      <div className="insp-line">
        {tile.color && <button type="button" className="insp-link" onClick={() => patch({ color: undefined })}>{t('deck.look.noColor')}</button>}
      </div>
      {tile.color && (emoji || macroEmoji) && <p className="rm-hint">{t('deck.look.colorEmoji')}</p>}
    </section>
  );
}

type PictureSource = 'app' | 'picture' | 'capture';
const SOURCES: readonly (readonly [PictureSource, LucideIcon])[] = [['app', AppWindow], ['picture', ImageIcon], ['capture', Crop]];
const sourceLabel = (source: PictureSource) =>
  source === 'app' ? t('deck.icons.fromApp') : source === 'picture' ? t('deck.icons.fromFile') : t('deck.icons.fromScreen');

/**
 * The icon picker: the lucide icons by group (the Icons tab), the emoji picker of the macros' icon (the
 * Emoji tab) and, for a button (`onSource`), a picture — a program's icon, a picture file, a cut of the
 * screen — that the engine makes and keeps (the Picture tab, Fase 6). The emoji picker keeps Esc for its
 * own search, so it is caught first here and closes it.
 */
function IconPicker({ anchor, toggle, keyboard, onPick, onSource, onClose }: {
  anchor: MenuAnchor; toggle: HTMLButtonElement; keyboard: boolean; onPick: (icon: DeckIcon) => void;
  onSource?: (source: PictureSource) => void; onClose: () => void;
}) {
  const set = useLoaded(loadIconSet);
  const emojiLoaded = useLoaded(loadEmojiPicker);
  const [tab, setTab] = useState<'icons' | 'emoji' | 'picture'>('icons');
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      toggle.focus();
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, [onClose, toggle]);
  const groups = tn('deck.icons.groups');
  const Picker = emojiLoaded?.module.default;
  return (
    <Popover anchor={anchor} label={t('deck.look.chooseIcon')} toggle={toggle} focusFirst={keyboard} onClose={onClose}>
      <div className="dk-picker">
        <Segmented<'icons' | 'emoji' | 'picture'> label={t('deck.look.chooseIcon')} value={tab}
          options={[
            { value: 'icons', label: t('deck.icons.icons') },
            { value: 'emoji', label: t('deck.icons.emoji') },
            ...(onSource ? [{ value: 'picture' as const, label: t('deck.icons.picture') }] : []),
          ]}
          onChange={(v) => { setTab(v); if (v === 'emoji') void preload(loadEmojiPicker); }} />
        {tab === 'picture' && onSource ? (
          <>
            <div className="dk-picker-sources" role="group" aria-label={t('deck.icons.picture')}>
              {SOURCES.map(([source, Icon]) => (
                <button key={source} type="button" className="dk-picker-source" onClick={() => onSource(source)}>
                  <Icon aria-hidden="true" />
                  {sourceLabel(source)}
                </button>
              ))}
            </div>
            <p className="rm-hint">{t('deck.icons.pictureHint')}</p>
          </>
        ) : tab === 'icons' ? (
          <div className="dk-picker-groups">
            {set?.ICON_GROUPS.map(g => (
              <div key={g.id} className="dk-picker-group" role="group" aria-label={groups[g.id]}>
                <span className="dk-picker-title">{groups[g.id]}</span>
                <div className="dk-picker-grid">
                  {g.icons.map(([name, Icon]) => (
                    <button key={name} type="button" className="dk-picker-icon" aria-label={name} data-tip={name}
                      onClick={(e) => {
                        const svg = e.currentTarget.querySelector('svg');
                        if (svg) onPick({ kind: 'lucide', name, svg: set.deckIconSvg(svg) });
                      }}>
                      <Icon aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : Picker && emojiLoaded ? (
          <Picker
            onEmojiClick={(data) => onPick({ kind: 'emoji', value: data.emoji })}
            theme={appIsLight() ? emojiLoaded.module.Theme.LIGHT : emojiLoaded.module.Theme.DARK}
            emojiStyle={emojiLoaded.module.EmojiStyle.NATIVE}
            width={304}
            height={320}
            previewConfig={{ showPreview: false }}
            searchPlaceholder={t('macroSettings.info.searchEmoji')}
            searchClearButtonLabel={t('common.actions.clear')}
            categories={emojiCategories(emojiLoaded.module.Categories)}
            emojiData={emojiLoaded.emojiData}
          />
        ) : <div className="dk-picker-wait"><Smile aria-hidden="true" /></div>}
      </div>
    </Popover>
  );
}

// ── The deck's settings ──

/** The margin a deck keeps from its anchor's edges when the anchor is chosen here (the 24 DIP of a new deck). */
function placeFor(anchor: DeckAnchor): { dx: number; dy: number } {
  const m = 24;
  const dx = anchor.endsWith('left') || anchor === 'left' ? m : anchor.endsWith('right') || anchor === 'right' ? -m : 0;
  const dy = anchor.startsWith('top') ? m : anchor.startsWith('bottom') ? -m : 0;
  return { dx, dy };
}
const ANCHOR_GRID: DeckAnchor[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

function DeckSettingsPanel({ deck }: { deck: DeckDeck }) {
  const set = (patch: Partial<DeckDeck>) => updateDeck(deck.id, patch);
  const summon = deck.mode === 'summon';
  const asked = useDeckUi(s => s.settingsAsked);
  const [adding, setAdding] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const [picker, setPicker] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement; keyboard: boolean } | null>(null);
  const apps = deck.showWhen.apps;
  // "With these apps" with no app yet stays a choice of the page (Fase 8): the engine keeps a deck with no app as
  // "always" (DeckService.NormalizeShowWhen), so it is saved with the first app picked.
  const [wantsApps, setWantsApps] = useState(false);
  const when: 'always' | 'apps' = deck.showWhen.kind === 'apps' || wantsApps ? 'apps' : 'always';
  const opacities = tn('deck.settings.opacities');
  const sizes = tn('deck.settings.sizes');
  return (
    <aside className="rm-panel dk-panel" data-resting={!asked || undefined} aria-label={t('deck.settings.label', { deck: deck.name })}>
      <PanelHead icon={<Settings />} title={deck.name} sub={t('deck.settings.sub')} onClose={() => { askSettings(false); focusLater('.dk-more'); }} narrowClose />
      <div className="rm-panel-body">
        <section className="rm-sec" aria-label={t('deck.settings.mode')}>
          <span className="rm-label">{t('deck.settings.mode')}</span>
          <Segmented<'fixed' | 'summon'> label={t('deck.settings.mode')} value={deck.mode}
            options={[{ value: 'fixed', label: t('deck.head.fixed') }, { value: 'summon', label: t('deck.head.summon') }]}
            onChange={(mode) => set({ mode })} />
          <p className="rm-hint">{summon ? t('deck.settings.summonHint') : t('deck.settings.fixedHint')}</p>
        </section>

        <section className="rm-sec" aria-label={t('deck.settings.hotkey')}>
          <span className="rm-label">{summon ? t('deck.settings.hotkeySummon') : t('deck.settings.hotkeyToggle')}</span>
          <DeckHotkeyField value={deck.hotkey ?? ''} label={summon ? t('deck.settings.hotkeySummon') : t('deck.settings.hotkeyToggle')}
            except={{ deck: deck.id }} onChange={(hotkey) => set({ hotkey: hotkey || undefined })} />
          {summon && !deck.hotkey && <p className="rm-msg" data-tone="warn">{t('deck.settings.summonNeedsKey')}</p>}
          {!summon && <p className="rm-hint">{t('deck.settings.toggleHint')}</p>}
        </section>

        {summon ? (
          <section className="rm-sec" aria-label={t('deck.settings.summonGroup')}>
            <span className="rm-label">{t('deck.settings.at')}</span>
            <Segmented<'cursor' | 'center'> label={t('deck.settings.at')} value={deck.summon.at}
              options={[{ value: 'cursor', label: t('deck.settings.atCursor') }, { value: 'center', label: t('deck.settings.atCenter') }]}
              onChange={(at) => set({ summon: { ...deck.summon, at } })} />
            <SwitchRow label={t('deck.settings.hold')} hint={t('deck.settings.holdHint')} checked={deck.summon.hold}
              onChange={(hold) => set({ summon: { ...deck.summon, hold } })} />
            <SwitchRow label={t('deck.settings.keysOnly')} hint={t('deck.settings.keysOnlyHint')} checked={deck.summon.keysOnly}
              onChange={(keysOnly) => set({ summon: { ...deck.summon, keysOnly } })} />
            <SwitchRow label={t('deck.settings.closeAfter')} hint={t('deck.settings.closeAfterHint')} checked={deck.summon.closeAfterPick}
              onChange={(closeAfterPick) => set({ summon: { ...deck.summon, closeAfterPick } })} />
          </section>
        ) : (
          <section className="rm-sec" aria-label={t('deck.settings.when')}>
            <span className="rm-label">{t('deck.settings.when')}</span>
            <Segmented<'always' | 'apps'> label={t('deck.settings.when')} value={when}
              options={[{ value: 'always', label: t('deck.settings.always') }, { value: 'apps', label: t('deck.settings.apps') }]}
              onChange={(kind) => {
                setWantsApps(kind === 'apps');
                if (kind === 'always' || apps.length > 0) set({ showWhen: { ...deck.showWhen, kind } });
              }} />
            {when === 'apps' && (
              <>
                <div className="dk-apps">
                  {apps.map(exe => (
                    <span key={exe} className="dk-app">
                      <code>{exe}</code>
                      <button type="button" className="dk-app-x" aria-label={t('deck.settings.removeApp', { exe })} data-tip={t('deck.settings.removeApp', { exe })}
                        onClick={() => set({ showWhen: { ...deck.showWhen, apps: apps.filter(a => a !== exe) } })}>
                        <X aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  {apps.length === 0 && <span className="rm-hint">{t('deck.settings.appsNone')}</span>}
                </div>
                <div className="insp-line">
                  <button type="button" className="insp-button" aria-haspopup="dialog" aria-expanded={!!adding} disabled={apps.length >= DECK_LIMITS.apps}
                    onClick={(e) => setAdding(adding ? null : { anchor: anchorBelow(e.currentTarget, 'start'), button: e.currentTarget })}>
                    <Plus aria-hidden="true" />
                    {t('deck.settings.addApp')}
                  </button>
                </div>
                {adding && (
                  <AppPopover anchor={adding.anchor} toggle={adding.button} onClose={() => setAdding(null)}
                    onPick={(exe) => {
                      setAdding(null);
                      if (!apps.some(a => a.toLowerCase() === exe.toLowerCase())) set({ showWhen: { kind: 'apps', apps: [...apps, exe] } });
                    }} />
                )}
              </>
            )}
          </section>
        )}

        <section className="rm-sec" aria-label={t('deck.settings.grid')}>
          <span className="rm-label">{t('deck.settings.grid')}</span>
          <div className="dk-grid-fields">
            {/* A div: the DraftField is a <label> of its own, and its label prop names it. */}
            <div className="dk-num">
              <span aria-hidden="true">{t('deck.settings.cols')}</span>
              <DraftField stepId={`deck:${deck.id}`} field="cols" label={t('deck.settings.cols')} kind="int" min={1} max={DECK_LIMITS.grid}
                stored={String(deck.grid.cols)} onApply={(v) => set({ grid: { ...deck.grid, cols: Number(v) } })} />
            </div>
            <span className="dk-times" aria-hidden="true">×</span>
            <div className="dk-num">
              <span aria-hidden="true">{t('deck.settings.rows')}</span>
              <DraftField stepId={`deck:${deck.id}`} field="rows" label={t('deck.settings.rows')} kind="int" min={1} max={DECK_LIMITS.grid}
                stored={String(deck.grid.rows)} onApply={(v) => set({ grid: { ...deck.grid, rows: Number(v) } })} />
            </div>
          </div>
          <span className="dk-field-label">{t('deck.settings.size')}</span>
          <Segmented<'s' | 'm' | 'l'> label={t('deck.settings.size')} value={deck.grid.size}
            options={[{ value: 's', label: sizes.s }, { value: 'm', label: sizes.m }, { value: 'l', label: sizes.l }]}
            onChange={(size) => set({ grid: { ...deck.grid, size } })} />
          <p className="rm-hint">{t('deck.settings.gridHint')}</p>
        </section>

        <section className="rm-sec" aria-label={t('deck.settings.look')}>
          <span className="rm-label">{t('deck.settings.look')}</span>
          <span className="dk-field-label">{t('deck.settings.icon')}</span>
          <div className="dk-icon-row">
            <button type="button" className="dk-icon-pick" aria-label={t('deck.settings.icon')} aria-haspopup="dialog" aria-expanded={!!picker}
              data-tip={t('deck.settings.icon')}
              onPointerEnter={() => { void preload(loadIconSet); }}
              onClick={(e) => {
                if (picker) { setPicker(null); return; }
                const button = e.currentTarget;
                const keyboard = e.detail === 0;
                void preload(loadIconSet).then(() => setPicker({ anchor: anchorBelow(button, 'start'), button, keyboard }));
              }}>
              {deck.icon?.kind === 'emoji' ? <span className="dk-emoji-small">{deck.icon.value}</span> : <IconGlyph icon={deck.icon} fallback="layout-grid" />}
            </button>
            {deck.icon && <button type="button" className="insp-link" onClick={() => set({ icon: undefined })}>{t('deck.look.useDefault')}</button>}
          </div>
          {picker && (
            <IconPicker anchor={picker.anchor} toggle={picker.button} keyboard={picker.keyboard}
              onPick={(icon) => { set({ icon }); setPicker(null); picker.button.focus(); }} onClose={() => setPicker(null)} />
          )}
          <SwitchRow label={t('deck.settings.header')} hint={t('deck.settings.headerHint')} checked={deck.look.header}
            onChange={(header) => set({ look: { ...deck.look, header } })} />
          {!summon && (
            <>
              <span className="dk-field-label">{t('deck.settings.opacity')}</span>
              <Segmented<'100' | '85' | '70' | '50' | '0'> label={t('deck.settings.opacity')} value={String(deck.look.restOpacity) as '100'} wrap
                options={(['100', '85', '70', '50', '0'] as const).map(v => ({ value: v, label: opacities[`o${v}`] }))}
                onChange={(v) => set({ look: { ...deck.look, restOpacity: Number(v) as DeckDeck['look']['restOpacity'] } })} />
              <SwitchRow label={t('deck.settings.collapse')} hint={t('deck.settings.collapseHint')} checked={deck.look.collapse}
                onChange={(collapse) => set({ look: { ...deck.look, collapse } })} />
              <SwitchRow label={t('deck.settings.edgeHide')} hint={t('deck.settings.edgeHideHint')} checked={deck.look.edgeHide}
                onChange={(edgeHide) => set({ look: { ...deck.look, edgeHide } })} />
              <SwitchRow label={t('deck.settings.locked')} hint={t('deck.settings.lockedHint')} checked={deck.look.locked}
                onChange={(locked) => set({ look: { ...deck.look, locked } })} />
            </>
          )}
        </section>

        {!summon && (
          <section className="rm-sec" aria-label={t('deck.settings.place')}>
            <span className="rm-label">{t('deck.settings.place')}</span>
            {/* A 3×3 grid: up and down move a row. */}
            <div className="dk-anchors" role="radiogroup" aria-label={t('deck.settings.place')} onKeyDown={(e) => radioKeys(e, true, 3)}>
              {ANCHOR_GRID.map(a => (
                <button key={a} type="button" role="radio" className="dk-anchor" aria-checked={deck.place.anchor === a}
                  aria-label={ANCHORS[a]} data-tip={ANCHORS[a]} tabIndex={deck.place.anchor === a ? 0 : -1}
                  onClick={() => { if (a !== deck.place.anchor) set({ place: { ...deck.place, anchor: a, ...placeFor(a) } }); }} />
              ))}
            </div>
            <div className="insp-line">
              <button type="button" className="insp-link"
                onClick={() => set({ place: { ...deck.place, ...placeFor(deck.place.anchor) } })}>{t('deck.settings.placeReset')}</button>
            </div>
            <p className="rm-hint">{t('deck.settings.placeHint')}</p>
          </section>
        )}
      </div>
      <div className="rm-panel-foot">{t('deck.panel.foot')}</div>
    </aside>
  );
}

function SwitchRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="dk-switch-row">
      <div className="insp-row">
        <Switch label={label} checked={checked} onChange={onChange} />
        <span className="insp-row-label">{label}</span>
      </div>
      {hint && <p className="rm-hint">{hint}</p>}
    </div>
  );
}

/** An app by its program: the ones open now (process:list, as the Teclado's games), or the .exe typed. */
function AppPopover({ anchor, toggle, onPick, onClose }: { anchor: MenuAnchor; toggle: HTMLButtonElement; onPick: (exe: string) => void; onClose: () => void }) {
  const tools = useEditorTools();
  const { subscribe } = useBridge();
  const [list, setList] = useState<{ name: string; title: string }[] | null>(null);
  const [filter, setFilter] = useState('');
  const [typed, setTyped] = useState('');
  useEffect(() => subscribe((message) => {
    if (message.type === 'process:list') setList(message.payload.processes);
  }), [subscribe]);
  useEffect(() => { tools.listProcesses({}); }, [tools]);
  const f = filter.trim().toLowerCase();
  const shown = (list ?? []).filter(p => !f || p.name.toLowerCase().includes(f) || p.title.toLowerCase().includes(f));
  const typedOk = /^[^\\/:*?"<>|]+$/.test(typed.trim());
  const label = t('deck.settings.addApp');
  return (
    <Popover anchor={anchor} label={label} toggle={toggle} focusFirst onClose={onClose}>
      <div className="insp-procs dk-add">
        <input className="insp-procs-filter" type="text" aria-label={t('deck.settings.appFilter')} placeholder={t('deck.settings.appFilter')}
          value={filter} spellCheck={false} onChange={(e) => setFilter(e.target.value)} />
        <div className="insp-procs-list" role="listbox" aria-label={label}>
          {list === null ? <span className="insp-procs-none">{t('deck.settings.appLoading')}</span>
            : shown.length === 0 ? <span className="insp-procs-none">{t('deck.settings.appNone')}</span>
            : shown.map(p => (
              <button key={`${p.name}\u0000${p.title}`} type="button" role="option" aria-selected={false} onClick={() => onPick(p.name)}>
                <span className="insp-procs-name">{p.name}</span>
                {p.title && <span className="insp-procs-title">{p.title}</span>}
              </button>
            ))}
        </div>
        <span className="dk-add-label">{t('deck.settings.appTyped')}</span>
        <div className="insp-line">
          <label className="insp-box">
            <input className="insp-mono" type="text" aria-label={t('deck.settings.appTyped')} placeholder={t('deck.settings.appTypedPlaceholder')}
              value={typed} spellCheck={false} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typedOk) { e.preventDefault(); onPick(typed.trim()); } }} />
          </label>
          <button type="button" className="insp-button" disabled={!typedOk} onClick={() => onPick(typed.trim())}>{t('common.actions.add')}</button>
        </div>
      </div>
    </Popover>
  );
}

// ── The Deck's own settings (the gear) ──

function GeneralPanel() {
  const config = useDeck(s => s.config);
  const busy = tn('deck.general.busyOptions');
  return (
    <aside className="rm-panel dk-panel" aria-label={t('deck.general.label')}>
      <PanelHead icon={<LayoutGrid />} title={t('deck.page')} sub={t('deck.general.sub')} onClose={() => {
        showGeneral(false);
        // The gear opened them: the focus goes back to it (Fase 8).
        focusLater('.dk-gear');
      }} />
      <div className="rm-panel-body">
        <section className="rm-sec" aria-label={t('deck.list.on')}>
          <SwitchRow label={t('deck.list.on')} hint={t('deck.general.onHint')} checked={config.enabled} onChange={setEnabled} />
        </section>
        <section className="rm-sec" aria-label={t('deck.general.toggleAll')}>
          <span className="rm-label">{t('deck.general.toggleAll')}</span>
          <DeckHotkeyField value={config.toggleAllHotkey ?? ''} label={t('deck.general.toggleAll')} except={{ all: true }}
            onChange={(key) => setGeneral({ toggleAllHotkey: key || undefined })} />
          <p className="rm-hint">{t('deck.general.toggleAllHint')}</p>
        </section>
        <section className="rm-sec" aria-label={t('deck.general.busy')}>
          <span className="rm-label">{t('deck.general.busy')}</span>
          <Segmented<'swap' | 'stop' | 'ignore'> label={t('deck.general.busy')} value={config.busyPress}
            options={[{ value: 'swap', label: busy.swap }, { value: 'stop', label: busy.stop }, { value: 'ignore', label: busy.ignore }]}
            onChange={(busyPress) => setGeneral({ busyPress })} />
          <p className="rm-hint">{BUSY_HINTS[config.busyPress]}</p>
        </section>
        <section className="rm-sec" aria-label={t('deck.general.captures')}>
          <SwitchRow label={t('deck.general.captures')} hint={config.showInCaptures ? t('deck.general.capturesOn') : t('deck.general.capturesOff')}
            checked={config.showInCaptures} onChange={(showInCaptures) => setGeneral({ showInCaptures })} />
        </section>
      </div>
      <div className="rm-panel-foot">{t('deck.general.foot')}</div>
    </aside>
  );
}

// ── A deck's hotkey ──

/**
 * A deck's hotkey (show and hide, or call), or the one for every deck: Change listens through the engine's
 * hook, as Settings › Hotkeys does. A key with no key besides the modifiers waits for one; the mouse's
 * buttons and the wheel are no deck hotkey (the deck answers the keyboard). A combo another hotkey holds —
 * the app's, a macro's, another deck's — is refused here with whose it is: the deck would take it from
 * them, or never get it.
 */
function DeckHotkeyField({ value, label, except, onChange }: {
  value: string; label: string; except: { deck?: string; all?: boolean }; onChange: (combo: string) => void;
}) {
  const capture = useKeyCapture();
  const settings = useApp(a => a.settings);
  const profiles = useApp(a => a.profiles);
  const decks = useDeck(s => s.config.decks);
  const allKey = useDeck(s => s.config.toggleAllHotkey);
  const [owner] = useState(() => `deck-hotkey-${crypto.randomUUID()}`);
  const [listening, setListening] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const latest = useRef({ onChange, settings, profiles, decks, allKey, except, value });
  useEffect(() => { latest.current = { onChange, settings, profiles, decks, allKey, except, value }; });
  useEffect(() => {
    if (!listening) return;
    capture.arm(owner);
    const stop = () => { setListening(false); setHeld(null); };
    let idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
    const off = capture.listen(owner, (combo) => {
      if (typeof combo !== 'string' || combo === '') return;
      clearTimeout(idle);
      idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
      const parts = splitCombo(combo);
      const key = parts[parts.length - 1];
      if (NOT_A_KEY.has(key) || /^Mouse/i.test(key)) { setRefused(t('deck.hotkey.mouse')); return; }
      if (isPureModifier(combo)) { setHeld(combo); return; }
      stop();
      // Esc alone gives the change up (Fase 8): as a hotkey it would take Esc from every app.
      if (combo === 'Escape') { setRefused(null); return; }
      const l = latest.current;
      if (combo.toLowerCase() === l.value.toLowerCase()) { setRefused(null); return; }
      const taken = takenBy(combo, l);
      if (taken) { setRefused(t('deck.hotkey.taken', { key: keycaps(combo), what: taken })); return; }
      setRefused(null);
      l.onChange(combo);
    });
    return () => {
      clearTimeout(idle);
      off();
      capture.release(owner);
    };
  }, [listening, capture, owner]);
  // Without Ctrl, Alt or Win the key is taken from every app (a letter, Space, Enter, an arrow, F5, Shift+A…);
  // F13–F24 and the media and volume keys are the ones nothing types with (Fase 8).
  const bare = !!value && !splitCombo(value).some(p => /^(Ctrl|Alt|Win|AltGr|LeftCtrl|RightCtrl|LeftAlt|RightAlt)$/i.test(p))
    && !/^F(1[3-9]|2[0-4])$/i.test(value) && !SPECIAL_NAMES.has(value);
  return (
    <>
      <div className="dk-hk" data-listening={listening || undefined}>
        <span className="dk-hk-keys">
          {listening
            ? (held ? <kbd className="kbd">{keycaps(held)}</kbd> : <span className="dk-hk-wait">{t('deck.hotkey.press')}</span>)
            : value ? <kbd className="kbd">{keycaps(value)}</kbd> : <span className="dk-hk-none">{t('deck.hotkey.none')}</span>}
        </span>
        <button type="button" className="insp-button" aria-pressed={listening}
          aria-label={listening ? t('deck.hotkey.listeningLabel', { label }) : t('deck.hotkey.changeLabel', { label })}
          onClick={() => { setHeld(null); setRefused(null); setListening(on => !on); }}
          onBlur={() => { setListening(false); setHeld(null); }}>
          {listening ? t('deck.hotkey.listening') : t('deck.hotkey.change')}
        </button>
        {value && !listening && (
          <button type="button" className="insp-icon-button" aria-label={t('deck.hotkey.clearLabel', { label })} data-tip={t('deck.hotkey.clear')}
            onClick={() => { setRefused(null); onChange(''); }}>
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      {refused && <p className="rm-msg" data-tone="refused" role="alert">{refused}</p>}
      {bare && !refused && <p className="rm-msg" data-tone="warn">{t('deck.hotkey.bare', { key: keycaps(value) })}</p>}
    </>
  );
}

/** Whose hotkey a combo already is, in words, or null: the app's, a macro's, another deck's, every deck's. */
function takenBy(combo: string, l: {
  settings: SettingsState; profiles: ProfileEntry[]; decks: DeckDeck[]; allKey?: string; except: { deck?: string; all?: boolean };
}): string | null {
  const same = (k?: string | null) => !!k && k.toLowerCase() === combo.toLowerCase();
  const hit = hotkeysOf(l.settings, l.profiles).find(h => same(h.combo));
  if (hit) return hit.label;
  // The Clicker's own two: a summoned deck's hotkey is answered first, in every mode.
  if (same(l.settings.cursorClickStartHotkey)) return t('deck.hotkey.takenClickerStart');
  if (same(l.settings.cursorClickPauseHotkey)) return t('deck.hotkey.takenClickerPause');
  if (!l.except.all && same(l.allKey)) return t('deck.hotkey.takenAll');
  const deck = l.decks.find(d => d.id !== l.except.deck && same(d.hotkey));
  return deck ? t('deck.hotkey.takenDeck', { deck: deck.name }) : null;
}
