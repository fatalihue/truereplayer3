import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowRightLeft, Ban, Download, Ellipsis, Gamepad2, Keyboard, ListChecks, Lock, LockOpen, Mouse, Plus, X } from 'lucide-react';
import { create } from 'zustand';
import { APP_NAME } from '../../../appIdentity';
import { useBridge } from '../../../bridge/BridgeContext';
import type { RemapEntryDto, TecladoMacroReport } from '../../../bridge/messageTypes';
import { splitCombo } from '../../../components/common/KbdTag';
import { LANG, t, tn } from '../../../i18n';
import { useEditorTools } from '../../../logic/useEditorTools';
import { isPureModifier, SINGLE_KEY_CAPTURE_IDLE_MS, useKeyCapture } from '../../../logic/useKeyCapture';
import { useToast } from '../../../state/ToastContext';
import { DraftField, Keys, Segmented, Switch } from '../../inspector/fields';
import { MacroPicker } from '../../inspector/MacroPicker';
import { freeName, keycaps } from '../../library/model';
import { stepName } from '../../list/stepTypes';
import { Menu } from '../../Menu';
import { anchorBelow, anchorFromEvent, fromKeyboard, type MenuAnchor } from '../../menuAnchor';
import {
  codesOfTr, currentKeys, FAMILIES, FNS, fnInfo, legendOf, MODES, modeLabel, MOUSE_CODES, type FnKind, type Game, type KeyCap, type KeyFn,
} from '../../mk/mkModel';
import {
  addExe, addGame, exportGame, fnFor, gameOf, layerKeyOf, lockGame, openGame, overwriteUnreadable, pickKey, removeExe,
  removeGame, renameGame, setGameFn, setGameOn, setLayoutPref, type Source,
} from '../../mk/mkEdit';
import { familyOf, useMk } from '../../mk/mkStore';
import { Popover } from '../../Popover';
import { whenOpen } from '../../recordNew';
import { useApp, useShell } from '../../store';
import { openPage, useUi } from '../../ui';
import { useShellBand } from '../../useShellBand';
import { MOUSE_TARGETS, mouseTarget } from '../remaps/remapModel';
import { COLUMNS, labelTop, labelY, MouseDrawing, type MouseCode, type MouseOut, type MousePartState } from './mouseDrawing';
import '../../inspector/editors.css';
import '../../inspector/windowEditors.css';
import '../remaps/remaps.css';
import './teclado.css';

/**
 * ② Teclado (branch teclado; plan .claude/planos/teclado-no-tr3-2026-11-10.md): TrueReplayerMK as a
 * mode of TR3. The games on the left, in the library's place and form; the keyboard in the middle,
 * each key's function in the colour of TR3's step that does the same; the key on the right, in the
 * classes of "Remap settings". The games are the engine's (TecladoService, teclado.json) and every
 * edit goes back whole; a key's macro is a macro of TR3's library, opened in TR3's editor. The game
 * in front comes from the foreground event (phase 2); the keys change in the game with the hook
 * (phase 3). The Key Remaps stay on their page and only show under a game's keys (decision 1).
 *
 * Rule 1: no key reads the whole store. The drawing reads the open game, the view and the Key Remaps
 * under it once, and each key only whether it is the one chosen, so the engine's teclado:live (the
 * game in front, the layer held) draws none of them again.
 */
export default function TecladoPage() {
  const loaded = useMk(s => s.loaded);
  const key = useMk(s => s.key);
  const hasGames = useMk(s => s.games.length > 0);
  // A new drawing (another layout, or Windows' labels arriving) remounts what draws and names keys.
  const drawingVersion = useMk(s => s.drawingVersion);
  // Esc closes the key, as the Key Remaps' panel does.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || !useMk.getState().key) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      closeKey();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Until the engine's first teclado:state the page holds no games, and an edit made then would save
  // that empty list over teclado.json and its backup: nothing is drawn, nor editable, before it.
  if (!loaded) return <section className="shell-page tk" aria-label={t('teclado.page')} aria-busy="true" />;
  const empty = !hasGames;
  return (
    <section className="shell-page tk" data-empty={empty || undefined} aria-label={t('teclado.page')}>
      <Games />
      <div className="tk-main">
        <Warn />
        {empty ? <EmptyMain /> : (
          <>
            <Head />
            <Bar />
            <div className="tk-scroll">
              <Board key={drawingVersion} />
              <Legend />
              <Notes />
            </div>
          </>
        )}
      </div>
      {/* No game, no key to choose: the panel and its "choose a key" wait for the first game. */}
      {empty ? null : key ? <KeyPanel key={`${drawingVersion}-${key}`} code={key} /> : <EmptyPanel />}
    </section>
  );
}

/** Closes the key's panel (Esc, ×); the focus goes back to that key in the drawing, as the Key Remaps give it back to the row. */
function closeKey() {
  const code = useMk.getState().key;
  pickKey(null);
  if (code) setTimeout(() => document.querySelector<HTMLElement>(`.tk [data-code="${CSS.escape(code)}"]`)?.focus({ preventScroll: true }), 0);
}

// ── What the screens read ──

// Only the page reads the Key Remaps under a game (rule 6: remapModel stays out of the opening).
/**
 * The Key Remaps under a game's keys: the "everywhere" ones and the "only in one app" ones of its
 * .exe. They stay on the Key Remaps page; here they only show as what a key without a function does.
 * A rule keeps the engine's name of its key ("Spacebar", "Shift", "Num1"): every position it stands
 * for gets it (codesOfTr).
 */
function globalsOf(remaps: { enabled: boolean; entries: RemapEntryDto[] }, exes: string[]): Record<string, KeyFn> {
  const out: Record<string, KeyFn> = {};
  if (!remaps.enabled) return out;
  const lower = exes.map(e => e.toLowerCase().replace(/\.exe$/, ''));
  for (const r of remaps.entries) {
    if (!r.enabled) continue;
    const scope = (r.process ?? '').toLowerCase().replace(/\.exe$/, '');
    if (scope && !lower.includes(scope)) continue;
    const fn: KeyFn = !r.to ? { kind: 'off' } : mouseTarget(r.to) ? { kind: 'mouse', mouse: r.to } : { kind: 'key', combo: r.to };
    for (const code of codesOfTr(r.from)) out[code] = fn;
  }
  return out;
}

const SHORT = tn('teclado.short');
const LAYOUTS = tn('teclado.bar.layouts');

/** One of the mouse's buttons that take a function (the middle, the side ones, the wheel), not a key. */
const isMouseCode = (code: string) => (MOUSE_CODES as readonly string[]).includes(code);

/** The Key Remaps under a game's keys, read once by whoever draws or edits them. */
function useGlobals(game: Game | null): Record<string, KeyFn> {
  const remaps = useApp(a => a.settings.remaps);
  return globalsOf(remaps, game ? game.exes : []);
}

/** Where a key's function comes from when the game does not change it. */
const globalName = () => t('common.pages.remaps');

/** What the key shows under its name: one word, or the start of it. */
function labelOf(fn: KeyFn): string {
  switch (fn.kind) {
    case 'key': return fn.combo ? keycaps(fn.combo) : SHORT.choose;
    case 'mouse': return SHORT[fn.mouse as keyof typeof SHORT] ?? SHORT.choose;
    case 'macro': return fn.macro || SHORT.choose;
    case 'text': return fn.text || SHORT.choose;
    // No word on an off key: its icon and its dashed border say it, and "Desligada" did not fit a key.
    case 'off': return '';
    case 'layer': return SHORT.layer;
    default: return '';
  }
}

/** The function in a sentence, for the accessible name and the tip. */
function sentenceOf(fn: KeyFn): string {
  switch (fn.kind) {
    case 'key': return t('teclado.sentence.key', { key: labelOf(fn) });
    case 'mouse': return t('teclado.sentence.mouse', { button: mouseTarget(fn.mouse ?? '')?.label ?? labelOf(fn) });
    case 'macro': {
      if (!fn.mode) return t('teclado.sentence.macro', { macro: labelOf(fn) });
      // "N vezes" says its number ("3 vezes"); the other modes their name.
      return t('teclado.sentence.macroMode', { macro: labelOf(fn), mode: modeLabel(fn.mode, fn.times).toLowerCase() });
    }
    case 'text': return t('teclado.sentence.text', { text: fn.text ?? '' });
    case 'off': return t('teclado.sentence.off');
    case 'layer': return t('teclado.sentence.layer');
    default: return t('teclado.sentence.default');
  }
}

/** The first letter of a name, a whole emoji included (slice(0, 1) cut one in half). */
const initialOf = (name: string) => (Array.from(name.trim())[0] ?? '?').toLocaleUpperCase();

/**
 * The arrows in a group of radios (the Function, the Button), as the Key Remaps' mouse targets: they
 * move to the next option that is not disabled, round, and choose it; Home and End go to the ends.
 */
function radioKeys(e: ReactKeyboardEvent<HTMLDivElement>) {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  if (items.length === 0) return;
  const at = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement));
  const next = e.key === 'Home' ? 0
    : e.key === 'End' ? items.length - 1
    : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (at + 1) % items.length
    : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (at - 1 + items.length) % items.length
    : null;
  if (next === null) return;
  e.preventDefault();
  items[next].focus();
  items[next].click();
}

// ── The games (as the library) ──

/**
 * A right-click on a game in the list (or Shift+F10, the Menu key) opens that game and its ⋯ menu at
 * the cursor. The menu lives in the head, where Rename and Add .exe act on the open game; the list
 * only asks for it here, and only the head reads the ask, so neither the list nor the keyboard draws
 * again (rule 1).
 */
const useGameMenu = create<{ ask: { id: string; anchor: MenuAnchor; keyboard: boolean; seq: number } | null }>(() => ({ ask: null }));
let gameMenuSeq = 0;

function Games() {
  const games = useMk(s => s.games);
  const open = useMk(s => s.open);
  const front = useMk(s => s.front);
  const locked = useMk(s => s.locked);
  // 1024–1279 and narrower, the list folds into initials (teclado.css): the names go to the accessible
  // name and the tip, as the folded library does.
  const folded = useShellBand() !== 'wide';
  const [adding, setAdding] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const title = t('teclado.games.title');
  const addLabel = t('teclado.add.label');
  const row = (g: Game) => (
    <button key={g.id} type="button" className="tk-game" aria-current={open === g.id || undefined} data-off={!g.on || undefined}
      aria-label={folded ? g.name : undefined} data-tip={folded ? g.name : undefined} data-tip-pos="end"
      onClick={() => openGame(g.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        // The open game keeps its chosen key: only another game is opened (openGame closes the key).
        if (open !== g.id) openGame(g.id);
        useGameMenu.setState({ ask: { id: g.id, anchor: anchorFromEvent(e), keyboard: fromKeyboard(e), seq: ++gameMenuSeq } });
      }}>
      <span className="tk-avatar" aria-hidden="true">{initialOf(g.name)}</span>
      <span className="tk-game-text">
        <span className="tk-game-name">{g.name}</span>
        <span className="tk-game-exe">{g.exes.join(' · ')}</span>
      </span>
      {/* The locked game is in front with any window: its padlock says so, in the dot's place. */}
      {locked === g.id
        ? <Lock className="tk-game-lock" role="img" aria-label={t('teclado.games.locked')} data-tip={t('teclado.games.locked')} data-tip-pos="end" />
        : front === g.id && <span className="tk-front-dot" role="img" aria-label={t('teclado.games.inFront')} data-tip={t('teclado.games.inFront')} data-tip-pos="end" />}
    </button>
  );
  return (
    <aside className="tk-games" aria-label={title}>
      <div className="lib-header">
        <span className="lib-title">{title}</span>
        <button type="button" className="lib-new" aria-haspopup="dialog" aria-expanded={!!adding}
          aria-label={folded ? addLabel : undefined} data-tip={folded ? addLabel : undefined} data-tip-pos="end"
          onClick={(e) => setAdding(adding ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
          <Plus aria-hidden="true" />
          <span>{t('common.actions.add')}</span>
        </button>
      </div>
      {adding && (
        <AddPopover anchor={adding.anchor} toggle={adding.button} label={addLabel}
          onPick={(exe) => { addGame(exe); setAdding(null); }} onClose={() => setAdding(null)} />
      )}
      <div className="tk-games-list">
        {games.map(row)}
        {games.length === 0 && <span className="tk-games-none">{t('teclado.games.none')}</span>}
      </div>
      <p className="tk-games-foot">{t('teclado.games.foot')}</p>
    </aside>
  );
}

/**
 * A game by its program: the ones open now (process:list, as the Key Remaps' app field), or the .exe
 * typed, for a game that is not running.
 */
function AddPopover({ anchor, toggle, label, onPick, onClose }: {
  anchor: MenuAnchor; toggle: HTMLButtonElement; label: string; onPick: (exe: string) => void; onClose: () => void;
}) {
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
  return (
    <Popover anchor={anchor} label={label} toggle={toggle} focusFirst onClose={onClose}>
      <div className="insp-procs tk-add">
        <input className="insp-procs-filter" type="text" aria-label={t('teclado.add.filter')} placeholder={t('teclado.add.filter')}
          value={filter} spellCheck={false} onChange={(e) => setFilter(e.target.value)} />
        <div className="insp-procs-list" role="listbox" aria-label={label}>
          {list === null ? <span className="insp-procs-none">{t('teclado.add.loading')}</span>
            : shown.length === 0 ? <span className="insp-procs-none">{t('teclado.add.none')}</span>
            : shown.map(p => (
              <button key={`${p.name}\u0000${p.title}`} type="button" role="option" aria-selected={false} onClick={() => onPick(p.name)}>
                <span className="insp-procs-name">{p.name}</span>
                {p.title && <span className="insp-procs-title">{p.title}</span>}
              </button>
            ))}
        </div>
        <span className="tk-add-label">{t('teclado.add.typed')}</span>
        <div className="insp-line">
          <label className="insp-box">
            <input className="insp-mono" type="text" aria-label={t('teclado.add.typed')} placeholder={t('teclado.add.typedPlaceholder')}
              value={typed} spellCheck={false} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && typedOk) { e.preventDefault(); onPick(typed.trim()); } }} />
          </label>
          <button type="button" className="insp-button" disabled={!typedOk} onClick={() => onPick(typed.trim())}>{t('common.actions.add')}</button>
        </div>
      </div>
    </Popover>
  );
}

// ── The head ──

function Head() {
  const game = useMk(gameOf);
  const front = useMk(s => s.front);
  const holding = useMk(s => s.holding);
  const locked = useMk(s => s.locked);
  const enabled = useMk(s => s.enabled);
  // The general pause: on, but the Shortcuts off hold every game's keys (the status bar says "paused").
  const shortcuts = useApp(a => a.settings.profileKeyEnabled);
  const startImport = useUi(s => s.startImport);
  const { showToast } = useToast();
  const moreRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const [adding, setAdding] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const [renaming, setRenaming] = useState(false);
  // The list's right-click on a game: the same menu, at the cursor. Leaving the page forgets it.
  const ask = useGameMenu(s => s.ask);
  useEffect(() => () => useGameMenu.setState({ ask: null }), []);
  if (!game) return <header className="tk-head" />;
  const isLocked = locked === game.id;
  // "In front" only while the game's keys do change: the Teclado on and not paused, the game on.
  const isFront = front === game.id && !isLocked && enabled && shortcuts && game.on;
  // "Use" on one game turns off the others on its .exe (two setups of one game): said, with their names.
  const turnedOff = (names: string[]) => {
    if (names.length === 0) return;
    const games = new Intl.ListFormat(LANG, { type: 'conjunction' }).format(names);
    showToast(t('teclado.head.turnedOff', { count: names.length, games }), { type: 'info', duration: 6000 });
  };
  // Locked: its keys work with any window in front but the app's, until unlocked or the app closes.
  const lock = () => {
    lockGame(game.id);
    showToast(t('teclado.head.lockedToast', { game: game.name, app: APP_NAME }), { type: 'info', duration: 8000 });
  };
  const remove = () => {
    const undo = removeGame(game.id);
    showToast(t('teclado.head.deleted', { game: game.name }), {
      type: 'success',
      duration: 10000,
      action: { label: t('common.actions.undo'), onClick: undo },
    });
  };
  // The ⋯ under its button, or the right-click's at the cursor: the list opened this game and asked in
  // the same event, so the ask names the game shown (a click away closes either, as any menu).
  const shown: { anchor: MenuAnchor; button: HTMLButtonElement | null; keyboard: boolean; seq: number } | null = menu
    ? { ...menu, keyboard: false, seq: 0 }
    : ask && ask.id === game.id ? { anchor: ask.anchor, button: null, keyboard: ask.keyboard, seq: ask.seq } : null;
  const closeMenu = () => {
    setMenu(null);
    if (useGameMenu.getState().ask) useGameMenu.setState({ ask: null });
  };
  return (
    <header className="tk-head">
      <div className="tk-titles">
        <h1 className="tk-title">
          {renaming
            ? <RenameField name={game.name} onDone={(name, byKey) => {
              if (name !== null) renameGame(game.id, name);
              setRenaming(false);
              // Enter or Esc: the focus goes back to where the rename was asked; a click elsewhere keeps its own.
              if (byKey) setTimeout(() => moreRef.current?.focus({ preventScroll: true }), 0);
            }} />
            : game.name}
          {isFront && <span className="tk-pill" data-tone={holding ? 'layer' : undefined}>{holding ? t('teclado.head.inFrontLayer') : t('teclado.head.inFront')}</span>}
          {isLocked && (
            <span className="tk-pill" data-tone="locked" data-tip={t('teclado.head.lockedTip', { game: game.name, app: APP_NAME })}>
              <Lock aria-hidden="true" />
              {t('teclado.head.locked')}
            </span>
          )}
        </h1>
        <p className="tk-sub">
          {game.exes.map(exe => (
            <span key={exe} className="tk-exe">
              <code>{exe}</code>
              {game.exes.length > 1 && (
                <button type="button" className="tk-exe-x" aria-label={t('teclado.head.removeExe', { exe })} data-tip={t('teclado.head.removeExe', { exe })}
                  onClick={() => removeExe(game.id, exe)}>
                  <X aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
          <span className="tk-sub-text">{t('teclado.head.sub')}</span>
        </p>
      </div>
      <div className="tk-head-end">
        <span className="tk-use">{t('teclado.head.use')}<Switch label={t('teclado.head.useIn', { game: game.name })} checked={game.on} onChange={(on) => turnedOff(setGameOn(game.id, on))} /></span>
        <span className="rm-sep" aria-hidden="true" />
        <button type="button" className="insp-button tk-file" data-tip={t('teclado.head.exportTip')} onClick={() => exportGame(game.id)}>
          <Download aria-hidden="true" />
          {t('common.actions.export')}
        </button>
        <button ref={moreRef} type="button" className="insp-icon-button" aria-label={t('teclado.head.more')} aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
          <Ellipsis aria-hidden="true" />
        </button>
        {shown && (
          <Menu key={shown.seq} anchor={shown.anchor} label={shown.button ? t('teclado.head.more') : game.name} toggle={shown.button}
            focusFirst={shown.keyboard} onClose={closeMenu}
            entries={[
              { label: t('common.actions.rename'), onSelect: () => setRenaming(true) },
              {
                label: t('teclado.add.addExe'),
                // The popover gives the focus back to what had it when it opened: the ⋯, not the menu's item that goes.
                // From the right-click it opens where the menu was, with the ⋯ as its toggle.
                onSelect: () => {
                  moreRef.current?.focus({ preventScroll: true });
                  const button = shown.button ?? moreRef.current;
                  if (button) setAdding({ anchor: shown.anchor, button });
                },
              },
              isLocked
                ? { label: t('teclado.head.unlock'), icon: LockOpen, onSelect: () => lockGame(null) }
                : { label: t('teclado.head.lock'), icon: Lock, onSelect: lock },
              // The macros' import: a .trprofile with a Keyboard game brings the game in beside them.
              { label: t('common.actions.importEllipsis'), disabled: !startImport, onSelect: () => startImport?.() },
              'separator',
              { label: t('common.actions.delete'), danger: true, onSelect: remove },
            ]} />
        )}
        {adding && (
          <AddPopover anchor={adding.anchor} toggle={adding.button} label={t('teclado.add.addExe')}
            onPick={(exe) => { turnedOff(addExe(game.id, exe)); setAdding(null); }} onClose={() => setAdding(null)} />
        )}
      </div>
    </header>
  );
}

/** The game's name, typed in its place: Enter or leaving keeps it, Esc goes back. `byKey`: ended by Enter or Esc. */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null, byKey: boolean) => void }) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (next: string | null, byKey: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(next, byKey);
  };
  return (
    <input className="tk-rename" aria-label={t('teclado.head.renameLabel')} value={value} maxLength={60} spellCheck={false}
      ref={(el) => { if (el && document.activeElement !== el && !done.current) el.focus(); }}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(value, true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null, true); }
      }}
      onBlur={() => finish(value, false)} />
  );
}

/** teclado.json could not be read (TecladoService's quarantine): what is shown, where edits go, and the way out. */
function Warn() {
  const failed = useMk(s => s.loadFailed);
  const backup = useMk(s => s.loadedFromBackup);
  const detail = useMk(s => s.loadFailureDetail);
  const pending = useMk(s => s.pendingFile);
  if (!failed) return null;
  return (
    <div className="rm-warn" role="alert">
      <div className="rm-warn-body">
        <p className="rm-warn-text">{backup ? t('teclado.warn.backup', { pending }) : t('teclado.warn.noBackup', { pending })}</p>
        {detail && <p className="rm-warn-detail">{detail}</p>}
      </div>
      <button type="button" className="insp-button" onClick={overwriteUnreadable}>{t('teclado.warn.replace')}</button>
    </div>
  );
}

/** No game yet: what the page is for, and the way to add the first one (the same picker as the list's). */
function EmptyMain() {
  const [adding, setAdding] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const label = t('teclado.add.label');
  return (
    <div className="rm-empty">
      <span className="rm-empty-icon" aria-hidden="true"><Gamepad2 /></span>
      <span className="rm-empty-title">{t('teclado.empty.title')}</span>
      <span className="rm-empty-text">{t('teclado.empty.text')}</span>
      <button type="button" className="insp-button tk-empty-add" aria-haspopup="dialog" aria-expanded={!!adding}
        onClick={(e) => setAdding(adding ? null : { anchor: anchorBelow(e.currentTarget, 'start'), button: e.currentTarget })}>
        <Plus aria-hidden="true" />
        {label}
      </button>
      {adding && (
        <AddPopover anchor={adding.anchor} toggle={adding.button} label={label}
          onPick={(exe) => { addGame(exe); setAdding(null); }} onClose={() => setAdding(null)} />
      )}
    </div>
  );
}

// ── The bar ──

function Bar() {
  const device = useMk(s => s.device);
  const view = useMk(s => s.view);
  const numpad = useMk(s => s.numpad);
  const game = useMk(gameOf);
  // The layer key's legend follows the drawing in use.
  useMk(s => s.drawingVersion);
  const layerKey = layerKeyOf(game);
  const count = game ? Object.keys(view === 'layer' ? game.layer : game.base).length : 0;
  return (
    <div className="tk-bar">
      <div className="tk-seg-device">
        <Segmented<'keyboard' | 'mouse'> label={t('teclado.bar.device')} value={device}
          options={[{ value: 'keyboard', label: t('teclado.bar.keyboard') }, { value: 'mouse', label: t('teclado.bar.mouse') }]}
          onChange={(d) => useMk.setState({ device: d, key: null })} />
      </div>
      <div className="tk-seg-layer">
        <Segmented<'base' | 'layer'> label={t('teclado.bar.layerGroup')} value={view}
          options={[
            { value: 'base', label: t('teclado.bar.base') },
            {
              value: 'layer',
              label: layerKey ? t('teclado.bar.layerHold', { key: legendOf(layerKey) }) : t('teclado.bar.layer'),
              disabled: !layerKey,
              tip: !layerKey ? t('teclado.bar.noLayer') : undefined,
            },
          ]}
          onChange={(v) => useMk.setState({ view: v })} />
      </div>
      <span className="rm-spacer" />
      <span className="tk-count">
        {view === 'layer' ? t('teclado.bar.changedLayer', { count }) : t('teclado.bar.changed', { count })}
      </span>
      {/* The numpad and the layout are the keyboard drawing's: the mouse has neither. */}
      {device === 'keyboard' && (
        <>
          <button type="button" className="rm-chip" aria-pressed={numpad} onClick={toggleNumpad}>{t('teclado.bar.numpad')}</button>
          <LayoutButton />
        </>
      )}
    </div>
  );
}

/** Shows or hides the numpad; hiding it with one of its keys open closes that key, which the drawing no longer shows. */
function toggleNumpad() {
  const s = useMk.getState();
  const hidesKey = s.numpad && s.key !== null && currentKeys().some(k => k.code === s.key && k.block === 'num');
  useMk.setState(hidesKey ? { numpad: false, key: null } : { numpad: !s.numpad });
}

/** The drawing's layout: Windows' (Automatic) or one chosen by hand. A game keeps keys by position, so it changes nothing in the game. */
function LayoutButton() {
  const pref = useMk(s => s.layoutPref);
  const detected = useMk(s => s.detected);
  const family = useMk(familyOf);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  return (
    <>
      <button type="button" className="rm-chip tk-layout" aria-haspopup="menu" aria-expanded={!!menu}
        aria-label={t('teclado.bar.layoutButton', { layout: LAYOUTS[family] })}
        data-tip={t('teclado.bar.layoutTip')} onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
        {LAYOUTS[family]}
      </button>
      {menu && (
        <Menu anchor={menu.anchor} label={t('teclado.bar.layoutLabel')} toggle={menu.button} onClose={() => setMenu(null)}
          entries={[
            { label: t('teclado.bar.layoutAuto', { layout: LAYOUTS[detected] }), checked: pref === 'auto', onSelect: () => setLayoutPref('auto') },
            'separator',
            ...FAMILIES.map(f => ({ label: LAYOUTS[f], checked: pref === f, onSelect: () => setLayoutPref(f) })),
          ]} />
      )}
    </>
  );
}

// ── The drawing ──

function Board() {
  const device = useMk(s => s.device);
  const numpad = useMk(s => s.numpad);
  const view = useMk(s => s.view);
  const game = useMk(gameOf);
  const family = useMk(familyOf);
  const globals = useGlobals(game);
  const gridRef = useRef<HTMLDivElement>(null);
  const layerKey = layerKeyOf(game);
  if (device === 'mouse') return <MouseBoard game={game} view={view} globals={globals} layerKey={layerKey} />;
  const keys = currentKeys();
  const caps = numpad ? keys : keys.filter(k => k.block !== 'num');
  // The arrows move across the drawing (the MK plan: "setas andam pelo desenho do teclado").
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    const from = keys.find(k => k.code === (e.target as HTMLElement).dataset.code);
    if (!d || !from) return;
    e.preventDefault();
    const cx = from.col + from.w / 2;
    const cy = from.row + from.h / 2;
    let best: KeyCap | null = null;
    let bestScore = Infinity;
    for (const k of caps) {
      if (k === from) continue;
      const kx = k.col + k.w / 2;
      const ky = k.row + k.h / 2;
      const along = d[0] ? (kx - cx) * d[0] : (ky - cy) * d[1];
      if (along <= 0.01) continue;
      const across = d[0] ? Math.abs(ky - cy) * 8 : Math.abs(kx - cx);
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = k; }
    }
    if (best) {
      pickKey(best.code);
      gridRef.current?.querySelector<HTMLElement>(`[data-code="${best.code}"]`)?.focus();
    }
  };
  return (
    <div className="tk-board">
      <div ref={gridRef} className="tk-grid" data-numpad={numpad || undefined} role="group" aria-label={t('teclado.board.label', { layout: LAYOUTS[family] })} onKeyDown={onKeyDown}>
        {caps.map(k => <Key key={k.code} cap={k} game={game} view={view} globals={globals} layerKey={layerKey} />)}
      </div>
    </div>
  );
}

interface FaceProps { game: Game | null; view: 'base' | 'layer'; globals: Record<string, KeyFn>; layerKey: string | null }

function Key({ cap, game, view, globals, layerKey }: FaceProps & { cap: KeyCap }) {
  const selected = useMk(s => s.key === cap.code);
  const anyKey = useMk(s => s.key !== null);
  return (
    <div className="tk-slot" data-iso={cap.isoEnter || undefined}
      style={{ gridColumn: `${cap.col} / span ${cap.w}`, gridRow: `${cap.row} / span ${cap.h}` }}>
      <KeyFace code={cap.code} legend={cap.legend} game={game} view={view} globals={globals} layerKey={layerKey} selected={selected}
        tabIndex={selected || (!anyKey && cap.code === 'Escape') ? 0 : -1} />
    </div>
  );
}

/**
 * What a key shows, on its face and, for a mouse button, on the drawing too: its function, where it
 * comes from, whether it is the layer key held, and the function in words (the accessible name, the tip).
 */
function faceOf(code: string, legend: string, { game, view, globals, layerKey }: FaceProps) {
  const { fn, source } = fnFor(game, view, code, globals);
  const held = view === 'layer' && code === layerKey;
  const rule = sentenceOf(fn);
  const words = fn.kind === 'default' ? legend
    : `${legend}: ${source === 'base' ? t('teclado.board.fromBase', { rule })
      : source === 'global' ? t('teclado.board.fromGlobal', { rule, source: globalName() })
      : rule}`;
  // The colour is the own function's; an inherited one shows untinted, with its mark.
  const mark = fn.kind !== 'default' && source === 'own' ? fn.kind : undefined;
  return { fn, source, held, words, mark };
}

/** A key's face, the keyboard's or a mouse button's: its legend, its function's mark, and the × that clears it. */
function KeyFace({ code, legend, game, view, globals, layerKey, selected, tabIndex }: FaceProps & {
  code: string; legend: string; selected: boolean; tabIndex: number;
}) {
  const { fn, source, held, words, mark } = faceOf(code, legend, { game, view, globals, layerKey });
  const Icon = source === 'own' ? fnInfo(fn.kind).Icon : null;
  const label = held ? t('teclado.board.held') : labelOf(fn);
  // An inherited Off has no word either (and none of the own key's dashed border): the Off icon, in
  // the inherited key's ink, tells it from a key that inherits nothing.
  const inheritedOff = source !== 'own' && fn.kind === 'off' && !held;
  return (
    <>
      <button
        type="button"
        className="tk-key"
        data-code={code}
        data-fn={mark}
        data-source={source !== 'own' ? source : undefined}
        data-held={held || undefined}
        data-mark={Icon || source !== 'own' ? '' : undefined}
        aria-pressed={selected}
        aria-label={words}
        data-tip={fn.kind !== 'default' ? words : undefined}
        tabIndex={tabIndex}
        onClick={() => pickKey(selected ? null : code)}
      >
        <span className="tk-leg">{legend}</span>
        {Icon && <Icon className="tk-ico" aria-hidden="true" />}
        {source === 'base' && <span className="tk-inh" aria-hidden="true">↧</span>}
        {source === 'global' && <span className="tk-inh" aria-hidden="true"><ArrowRightLeft /></span>}
        {label
          ? <span className="tk-fn" data-one={!label.includes(' ') || undefined}>{label}</span>
          : inheritedOff && <span className="tk-fn" aria-hidden="true"><Ban className="tk-fn-ico" /></span>}
      </button>
      {source === 'own' && fn.kind !== 'default' && (
        <button type="button" className="tk-x" aria-label={t('teclado.board.clear', { key: legend })} data-tip={t('common.actions.clear')} tabIndex={-1}
          onClick={() => setGameFn(code, { kind: 'default' })}>
          <X aria-hidden="true" />
        </button>
      )}
    </>
  );
}

const isOut = (id: MouseCode | MouseOut): id is MouseOut => id === 'MouseLeft' || id === 'MouseRight';
/** The five buttons that take a function, column by column, in the drawing's order (for the arrows). */
const MOUSE_COLUMNS = [COLUMNS.left, COLUMNS.right].map(c => c.filter((id): id is MouseCode => !isOut(id)));

/**
 * The mouse (plan teclado-mouse-desenho-2026-11-12.md): the drawing in the middle and the buttons'
 * faces beside it, each at its line's height, in the drawing's order. The middle, the side buttons
 * and the wheel take a function; left and right stay out, so you never lose the click.
 */
function MouseBoard(face: FaceProps) {
  // Each button's state, read once for the drawing (its face reads it again, as every key does).
  const parts = {} as Record<MouseCode, MousePartState>;
  for (const code of MOUSE_CODES) {
    const f = faceOf(code, legendOf(code), face);
    parts[code] = { fn: f.mark, source: f.source !== 'own' ? f.source : undefined, held: f.held, tip: f.words };
  }
  const column = (ids: (MouseCode | MouseOut)[]) => ids.map(id => (isOut(id) ? <OutKey key={id} id={id} /> : <MouseKey key={id} code={id} {...face} />));
  return (
    <div className="tk-mouse" role="group" aria-label={t('teclado.board.mouseLabel')} onKeyDown={mouseArrows}>
      <div className="tk-mboard">
        <div className="tk-mcol">{column(COLUMNS.left)}</div>
        <MouseDrawing parts={parts} outTip={t('teclado.board.mouseOutTip')} />
        <div className="tk-mcol">{column(COLUMNS.right)}</div>
      </div>
      <p className="tk-mouse-note">{t('teclado.board.mouseNote')}</p>
    </div>
  );
}

/** The arrows between the five buttons, as across the keyboard: up and down in a column, left and right to the nearest in the other. */
function mouseArrows(e: ReactKeyboardEvent<HTMLDivElement>) {
  const code = (e.target as HTMLElement).dataset.code as MouseCode | undefined;
  const col = code ? MOUSE_COLUMNS.findIndex(c => c.includes(code)) : -1;
  if (!code || col < 0 || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  const list = MOUSE_COLUMNS[col];
  const at = list.indexOf(code);
  let next: MouseCode | undefined;
  if (e.key === 'ArrowUp') next = list[at - 1];
  else if (e.key === 'ArrowDown') next = list[at + 1];
  else if ((e.key === 'ArrowRight') === (col === 0)) {
    const y = labelY(code);
    next = MOUSE_COLUMNS[1 - col].reduce((a, b) => (Math.abs(labelY(b) - y) < Math.abs(labelY(a) - y) ? b : a));
  }
  if (!next) return;
  pickKey(next);
  e.currentTarget.querySelector<HTMLElement>(`[data-code="${next}"]`)?.focus();
}

function MouseKey({ code, ...face }: FaceProps & { code: MouseCode }) {
  const selected = useMk(s => s.key === code);
  return (
    <div className="tk-slot tk-mco" data-part={code} style={{ top: labelTop(code) }}>
      <KeyFace code={code} legend={legendOf(code)} {...face} selected={selected} tabIndex={0} />
    </div>
  );
}

/** Left or right: drawn and named, but out. */
function OutKey({ id }: { id: MouseOut }) {
  return (
    <div className="tk-slot tk-mco" data-part={id} style={{ top: labelTop(id) }}>
      {/* aria-disabled, not disabled: a disabled button gets no pointer events, so its tip never showed. */}
      <button type="button" className="tk-key" data-out="" aria-disabled="true" data-tip={t('teclado.board.mouseOutTip')}>
        <span className="tk-leg">{id === 'MouseLeft' ? t('teclado.board.left') : t('teclado.board.right')}</span>
        <span className="tk-fn">{t('teclado.board.alwaysNormal')}</span>
      </button>
    </div>
  );
}

// ── The legend and the notes ──

function Legend() {
  const view = useMk(s => s.view);
  return (
    <div className="tk-legend" aria-label={t('teclado.legend.label')}>
      {FNS.filter(f => f.kind !== 'default').map(f => (
        <span key={f.kind} className="tk-legend-item" data-fn={f.kind}>
          <span className="tk-swatch" data-fn={f.kind} aria-hidden="true" />
          {f.Icon && <f.Icon aria-hidden="true" />}
          {f.kind === 'off' ? t('teclado.legend.off') : f.label}
        </span>
      ))}
      {view === 'layer' && (
        <span className="tk-legend-item" data-inh>
          <span className="tk-swatch" data-inh aria-hidden="true" />
          {t('teclado.legend.fromBase')}
        </span>
      )}
      <span className="tk-legend-item" data-inh>
        <span className="tk-swatch" data-inh aria-hidden="true" />
        <ArrowRightLeft aria-hidden="true" />
        {t('teclado.legend.fromRemaps')}
      </span>
    </div>
  );
}

function Notes() {
  return (
    <div className="tk-notes">
      <p className="tk-note"><Gamepad2 aria-hidden="true" /><span>{t('teclado.notes.front')}</span></p>
      <p className="tk-note">
        <ArrowRightLeft aria-hidden="true" />
        <span>
          {t('teclado.notes.beside')}{' '}
          <button type="button" className="insp-link" onClick={() => openPage('remaps')}>{t('teclado.notes.openRemaps')}</button>
        </span>
      </p>
    </div>
  );
}

// ── The key ──

function EmptyPanel() {
  // The Mouse view says button, on the drawing or by its name.
  const mouse = useMk(s => s.device === 'mouse');
  const title = mouse ? t('teclado.panel.emptyTitleMouse') : t('teclado.panel.emptyTitle');
  return (
    <aside className="tk-panel" data-empty aria-label={title}>
      <div className="tk-empty">
        <span className="rm-empty-icon" aria-hidden="true">{mouse ? <Mouse /> : <Keyboard />}</span>
        <span className="tk-empty-title">{title}</span>
        <span className="tk-empty-text">{mouse ? t('teclado.panel.emptyTextMouse') : t('teclado.panel.emptyText')}</span>
      </div>
    </aside>
  );
}

function KeyPanel({ code }: { code: string }) {
  const game = useMk(gameOf);
  const view = useMk(s => s.view);
  const globals = useGlobals(game);
  const layer = view === 'layer';
  const layerKey = layerKeyOf(game);
  const { fn, source } = fnFor(game, view, code, globals);
  const legend = legendOf(code);
  const where = layer ? t('teclado.panel.whereLayer', { game: game?.name ?? '', key: legendOf(layerKey ?? '') })
    : t('teclado.panel.whereBase', { game: game?.name ?? '' });
  // The function chosen in the list: its own, or Default when the key only inherits.
  const kind: FnKind = source === 'own' ? fn.kind : 'default';
  const set = (next: KeyFn) => setGameFn(code, next);
  const choose = (k: FnKind) => {
    if (k === kind) return;
    if (k === 'macro') set({ kind: 'macro', mode: 'once', interval: 100, keepOriginal: false });
    else if (k === 'text') set({ kind: 'text', text: '', enter: true });
    else if (k === 'mouse') set({ kind: 'mouse', mouse: 'XButton1' });
    else if (k === 'key') set({ kind: 'key', combo: '' });
    else set({ kind: k });
  };
  const patch = (p: Partial<KeyFn>) => set({ ...fn, ...p });
  const whyOff = (k: FnKind): string | null => {
    if (layer && k === 'layer') return t('teclado.panel.whyLayerKey');
    if (layer && code === layerKey) return t('teclado.panel.whyHolding');
    if (code.startsWith('Wheel') && k === 'layer') return t('teclado.panel.whyWheel');
    return null;
  };
  const global = globals[code];
  // A mouse button (phase 7) is no key: its own title and icon.
  const mouse = isMouseCode(code);
  const title = mouse ? t('teclado.panel.titleMouse', { key: legend }) : t('teclado.panel.title', { key: legend });
  return (
    <aside className="tk-panel" aria-label={title}>
      <div className="rm-panel-head">
        <span className="rm-panel-icon" aria-hidden="true">{mouse ? <Mouse /> : legend.length <= 3 ? legend : <Keyboard />}</span>
        <div className="rm-panel-titles">
          <span className="rm-panel-title">{title}</span>
          <span className="rm-panel-sub">{where}</span>
        </div>
        <button type="button" className="insp-icon-button" aria-label={t('teclado.panel.close')} onClick={closeKey}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="rm-panel-body">
        <section className="rm-sec" aria-label={t('teclado.panel.function')}>
          <span className="rm-label">{t('teclado.panel.function')}</span>
          <div className="tk-fns" role="radiogroup" aria-label={t('teclado.panel.function')} onKeyDown={radioKeys}>
            {FNS.map(f => {
              const off = whyOff(f.kind);
              const name = f.kind === 'default' && layer ? t('teclado.panel.sameAsBase')
                : f.kind === 'default' && global ? t('teclado.panel.follows', { source: globalName() })
                : f.label;
              const aside = f.kind === 'default' && source !== 'own' ? sentenceOf(fn) : null;
              return (
                <button key={f.kind} type="button" role="radio" className="rm-radio" data-fn={f.kind} aria-checked={kind === f.kind}
                  tabIndex={kind === f.kind ? 0 : -1} disabled={!!off} data-tip={off ?? undefined} data-tip-pos="start" onClick={() => choose(f.kind)}>
                  {f.Icon ? <f.Icon aria-hidden="true" /> : <span className="tk-fn-none" aria-hidden="true" />}
                  {name}
                  {aside && <span className="tk-fn-aside">{aside}</span>}
                </button>
              );
            })}
          </div>
        </section>
        <Options code={code} legend={legend} fn={fn} kind={kind} source={source} game={game} view={view} layerKey={layerKey} patch={patch} />
        {global && source === 'own' && fn.kind !== 'default' && game && (
          <p className="rm-msg" data-tone="warn">
            {t('teclado.panel.conflictBeside', { key: legend, rule: sentenceOf(global), game: game.name })}
          </p>
        )}
      </div>
      <div className="rm-panel-foot">{t('teclado.panel.foot', { game: game?.name ?? '' })}</div>
    </aside>
  );
}

function Options({ code, legend, fn, kind, source, game, view, layerKey, patch }: {
  code: string; legend: string; fn: KeyFn; kind: FnKind; source: Source; game: Game | null; view: 'base' | 'layer'; layerKey: string | null;
  patch: (p: Partial<KeyFn>) => void;
}) {
  const isLayerKey = view === 'base' && fn.kind === 'layer';
  switch (kind) {
    case 'default': {
      const rule = sentenceOf(fn);
      return (
        <p className="rm-hint">
          {/* The layer key, seen on the layer: every function is off for it there, so no "choose another". */}
          {view === 'layer' && code === layerKey ? t('teclado.panel.layerKeyHint')
            : source === 'base' ? t('teclado.panel.defaultFromBase', { key: legend, rule })
            : source === 'global' ? t('teclado.panel.defaultFromGlobal', { key: legend, source: globalName(), rule })
            : /^Key[A-Z]$/.test(code) ? t('teclado.panel.defaultTypes', { key: legend, typed: legend.toLowerCase() })
            : isMouseCode(code) ? t('teclado.panel.defaultButton', { key: legend })
            : t('teclado.panel.defaultNormal', { key: legend })}
        </p>
      );
    }
    case 'key':
      return (
        <section className="rm-sec" aria-label={t('teclado.panel.keyOut')}>
          <span className="rm-label">{t('teclado.panel.keyOut')}</span>
          <KeyOutCapture value={fn.combo ?? ''} onCapture={(combo) => patch({ combo })} />
          <p className="rm-hint">{t('teclado.panel.keyHint')}</p>
        </section>
      );
    case 'mouse': {
      const at = MOUSE_TARGETS.findIndex(m => m.name === fn.mouse);
      return (
        <section className="rm-sec" aria-label={t('teclado.panel.button')}>
          <span className="rm-label">{t('teclado.panel.button')}</span>
          <div className="rm-mouse" role="radiogroup" aria-label={t('teclado.panel.mouseLabel')} onKeyDown={radioKeys}>
            {MOUSE_TARGETS.map((m, i) => (
              <button key={m.name} type="button" role="radio" className="rm-radio" aria-checked={fn.mouse === m.name}
                tabIndex={i === Math.max(0, at) ? 0 : -1} onClick={() => { if (fn.mouse !== m.name) patch({ mouse: m.name }); }}>
                {m.label}
              </button>
            ))}
          </div>
        </section>
      );
    }
    case 'macro':
      return <MacroOptions key={code} code={code} legend={legend} gameName={game?.name ?? ''} wheel={code.startsWith('Wheel')} fn={fn} patch={patch} />;
    case 'text':
      return (
        <section className="rm-sec" aria-label={t('teclado.panel.text')}>
          <span className="rm-label">{t('teclado.panel.text')}</span>
          <DraftField stepId={`teclado-${code}`} field="text" label={t('teclado.panel.textLabel')} kind="text" multiline empty="clear"
            placeholder={t('teclado.panel.textPlaceholder')} stored={fn.text ?? ''} onApply={(text) => patch({ text })} />
          <div className="insp-row">
            <Switch label={t('teclado.panel.enter')} checked={!!fn.enter} onChange={(enter) => patch({ enter })} />
            <span className="insp-row-label">{t('teclado.panel.enter')}</span>
          </div>
          <p className="rm-hint">{t('teclado.panel.textHint')}</p>
        </section>
      );
    case 'off':
      return (
        <p className="rm-hint">
          {t('teclado.panel.offGame', { key: legend, game: game?.name ?? '' })}
        </p>
      );
    case 'layer':
      return (
        <section className="rm-sec" aria-label={t('teclado.fns.layer')}>
          <p className="rm-hint">{t('teclado.panel.layerHint', { key: legend })}</p>
          {isLayerKey && (
            <button type="button" className="insp-link" onClick={() => useMk.setState({ view: 'layer', key: null })}>{t('teclado.panel.seeLayer')}</button>
          )}
        </section>
      );
  }
}

/** Why a key's macro does not run from the key (the executor's report), or null when it does or is not known yet. */
function macroProblem(name: string, report: TecladoMacroReport | undefined): string | null {
  if (!report) return null;
  if (!report.found) return t('teclado.macro.notFound', { macro: name });
  if (report.empty) return t('teclado.macro.empty', { macro: name });
  if (report.unsupported.length === 0) return null;
  const steps = report.unsupported.map(s => s === 'tokens' ? t('teclado.macro.tokens') : stepName(s));
  return t('teclado.macro.unsupported', { steps: new Intl.ListFormat(LANG, { type: 'conjunction' }).format(steps) });
}

/** Runs `then` once the library has the macro (a name the engine refuses never comes, and nothing runs): at most a minute. */
function whenInLibrary(name: string, then: () => void) {
  const has = (profiles: { name: string }[]) => profiles.some(p => p.name === name);
  if (has(useShell.getState().app.profiles)) { then(); return; }
  let timer = 0;
  const stop = useShell.subscribe((s) => {
    if (!has(s.app.profiles)) return;
    stop();
    clearTimeout(timer);
    then();
  });
  timer = window.setTimeout(stop, 60000);
}

/** Macro: a macro of TR3's library, its mode, the repetitions, and the way to TR3's editor. */
function MacroOptions({ code, legend, gameName, wheel, fn, patch }: {
  code: string; legend: string; gameName: string; wheel: boolean; fn: KeyFn; patch: (p: Partial<KeyFn>) => void;
}) {
  const profiles = useApp(a => a.profiles);
  const order = useApp(a => a.profileOrder);
  const report = useMk(s => (fn.macro ? s.macros[fn.macro] : undefined));
  const { send } = useBridge();
  const names = profiles.map(p => p.name);
  const chosen = profiles.find(p => p.name === fn.macro) ?? null;
  const folder = order.folders.find(f => f.items.includes(fn.macro ?? ''))?.name;
  const mode = fn.mode ?? 'once';
  const problem = fn.macro ? macroProblem(fn.macro, report) : null;
  // The library's picker (the Run Macro step's) opens to change it; with a macro chosen, its card stays.
  const [picking, setPicking] = useState(false);
  const swapRef = useRef<HTMLButtonElement>(null);
  const stopPicking = () => {
    setPicking(false);
    setTimeout(() => swapRef.current?.focus({ preventScroll: true }), 0);
  };
  const openInEditor = () => {
    if (!chosen) return;
    send({ type: 'profile:open', payload: { name: chosen.name } });
    openPage('macros');
  };
  // A new macro for this key: created in the library, linked here, and open in the editor recording
  // from its first step, as the tray's "Record a new macro" does. In Clicker mode the engine refuses
  // a recording, so the macro only opens.
  const recordNew = () => {
    const app = useShell.getState().app;
    // The key's own name when it is words or numbers ("E", "F1", "Lateral 1"), else its position's
    // ("Period"): a macro's name cannot end in a dot, nor hold \ / : * ? " < > |.
    const keyName = /^[\p{L}\p{N}]+( [\p{L}\p{N}]+)*$/u.test(legend) ? legend : code;
    const base = t('teclado.macro.newName', { game: gameName, key: keyName }).replace(/[\\/:*?"<>|]/g, '').replace(/[. ]+$/, '').trim();
    const name = freeName(base || keyName, names);
    // The key points at the macro once the library has it: a name the engine refuses, or the open
    // macro's unsaved edits kept with Cancel, leave the key as it was instead of on a macro that is not there.
    const where = { game: useMk.getState().open, view: useMk.getState().view };
    const next: KeyFn = { ...fn, kind: 'macro', macro: name };
    whenInLibrary(name, () => setGameFn(code, next, where));
    if (app.status === 'ready' && !app.settings.useCursorClick)
      whenOpen(name, true, () => send({ type: 'recording:toggle', payload: { insertIndex: 0 } }));
    send({ type: 'profile:create', payload: { name } });
    openPage('macros');
  };
  const meta = chosen ? [
    folder ? t('teclado.macro.folder', { folder }) : null,
    t('teclado.macro.steps', { count: chosen.actionCount ?? 0 }),
    chosen.hotkey ? t('teclado.macro.hotkey', { hotkey: keycaps(chosen.hotkey) }) : null,
  ].filter(Boolean).join(' · ') : '';
  const hint = mode === 'once' ? t('teclado.macro.once')
    : mode === 'times' ? t('teclado.macro.timesHint', { count: fn.times ?? 3 })
    : mode === 'hold' ? t('teclado.macro.hold', { key: legend })
    : t('teclado.macro.toggle');
  return (
    <>
      <section className="rm-sec" aria-label={t('teclado.macro.label')}>
        <span className="rm-label">{t('teclado.macro.label')}</span>
        {chosen && !picking ? (
          <div className="tk-macro">
            <ListChecks className="tk-macro-icon" aria-hidden="true" />
            <span className="tk-macro-text">
              <span className="tk-macro-name">{chosen.name}</span>
              <span className="tk-where">{meta}</span>
            </span>
            <button ref={swapRef} type="button" className="insp-button tk-macro-swap" onClick={() => setPicking(true)}>{t('teclado.macro.swap')}</button>
          </div>
        ) : (
          // Changing it can be given up: Esc in the search, or Cancel, keeps the macro it had.
          <div onKeyDown={(e) => { if (e.key === 'Escape' && chosen) { e.preventDefault(); e.stopPropagation(); stopPicking(); } }}>
            <MacroPicker names={names} value={fn.macro ?? null} label={t('teclado.macro.label')} autoFocus={picking}
              onPick={(macro) => { patch({ macro }); if (picking) stopPicking(); }} />
            {chosen && <button type="button" className="insp-link tk-picker-cancel" onClick={stopPicking}>{t('common.actions.cancel')}</button>}
          </div>
        )}
        <div className="insp-line">
          <button type="button" className="insp-button" disabled={!chosen} onClick={openInEditor}>{t('teclado.macro.openEditor')}</button>
          <button type="button" className="insp-button" onClick={recordNew}>
            <span className="tk-rec" aria-hidden="true" />
            {t('teclado.macro.recordNew')}
          </button>
        </div>
        {problem && <p className="rm-msg" data-tone="warn">{problem}</p>}
      </section>
      <section className="rm-sec" aria-label={t('teclado.macro.mode')}>
        <span className="rm-label">{t('teclado.macro.mode')}</span>
        {/* A wheel notch is a touch: no "while held", no second touch to stop (TecladoService keeps it to these). */}
        <Segmented label={t('teclado.macro.mode')} value={mode} wrap onChange={(m) => patch({ mode: m })}
          options={wheel ? MODES.map(m => (m.value === 'hold' || m.value === 'toggle' ? { ...m, disabled: true, tip: t('teclado.panel.whyWheel') } : m)) : MODES} />
        {mode === 'times' && (
          <div className="insp-row">
            <span className="insp-row-label">{t('teclado.macro.times')}</span>
            <span className="insp-row-end">
              <DraftField stepId={`teclado-${code}`} field="times" label={t('teclado.macro.times')} kind="int" min={2} max={999} unit="×"
                stored={String(fn.times ?? 3)} onApply={(v) => patch({ times: Number(v) })} />
            </span>
          </div>
        )}
        {mode !== 'once' && (
          <div className="insp-row">
            <span className="insp-row-label">{t('teclado.macro.interval')}</span>
            <span className="insp-row-end">
              <DraftField stepId={`teclado-${code}`} field="interval" label={t('teclado.macro.interval')} kind="int" min={0} max={60000} unit="ms"
                stored={String(fn.interval ?? 100)} onApply={(v) => patch({ interval: Number(v) })} />
            </span>
          </div>
        )}
        <p className="rm-hint">{hint} {t('teclado.macro.onPress')}</p>
      </section>
      <section className="rm-sec" aria-label={t('teclado.macro.keepOriginal')}>
        <div className="insp-row">
          <Switch label={t('teclado.macro.keepOriginal')} checked={!!fn.keepOriginal} onChange={(keepOriginal) => patch({ keepOriginal })} />
          <span className="insp-row-label">{t('teclado.macro.keepOriginal')}</span>
        </div>
        <p className="rm-hint">{fn.keepOriginal ? t('teclado.macro.keepOn', { key: legend }) : t('teclado.macro.keepOff', { key: legend })}</p>
        {chosen?.hotkey && <p className="rm-msg">{t('teclado.macro.outside', { macro: chosen.name, hotkey: keycaps(chosen.hotkey) })}</p>}
      </section>
    </>
  );
}

// A side button or the wheel is the Mouse function's, not a key to send.
const NOT_A_KEY = new Set(['ScrollUp', 'ScrollDown', 'XButton1', 'XButton2']);

/**
 * The key that goes out, captured through the engine's hook (useKeyCapture, as the Key Remaps and the
 * Keystroke step do): Win+letter, AltGr, PrtSc and the numpad's own keys arrive under the engine's
 * names, and the app's hotkeys stay quiet meanwhile (a page listener let Ctrl+Home open the Clicker).
 * A modifier alone waits for the rest, and a second click on the box takes it alone (Caps → Ctrl, a
 * side button → Shift). Esc is a key here (Caps → Esc is the classic); a click elsewhere, or 4 s with
 * no key, stops listening and changes nothing.
 */
function KeyOutCapture({ value, onCapture }: { value: string; onCapture: (combo: string) => void }) {
  const capture = useKeyCapture();
  const [owner] = useState(() => `teclado-out-${crypto.randomUUID()}`);
  const [listening, setListening] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const onCaptureRef = useRef(onCapture);
  useEffect(() => { onCaptureRef.current = onCapture; });
  // Armed while listening; released on every way out, unmount included (an armed hook is an app with no keyboard).
  useEffect(() => {
    if (!listening) return;
    capture.arm(owner);
    const stop = () => { setListening(false); setHeld(null); };
    let idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
    const off = capture.listen(owner, (combo) => {
      if (typeof combo !== 'string' || combo === '') return;
      const parts = splitCombo(combo);
      const key = parts[parts.length - 1];
      if (!key || NOT_A_KEY.has(key)) return;
      clearTimeout(idle);
      idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
      if (isPureModifier(combo)) { setHeld(combo); return; }
      stop();
      onCaptureRef.current(combo);
    });
    return () => {
      clearTimeout(idle);
      off();
      capture.release(owner);
    };
  }, [listening, capture, owner]);
  const shown = held ?? value;
  return (
    <button type="button" className="insp-capture rm-capture" aria-pressed={listening} data-listening={listening || undefined}
      onClick={() => {
        if (listening && held) {
          // A modifier pressed alone and let go: the second click takes it as the key.
          const combo = held;
          setListening(false);
          setHeld(null);
          onCapture(combo);
          return;
        }
        setHeld(null);
        setListening(on => !on);
      }}
      onBlur={() => { setListening(false); setHeld(null); }}>
      {shown ? <Keys combo={shown} /> : <span className="insp-capture-none">{t('inspector.fields.noKey')}</span>}
      <span className="insp-capture-hint">
        {listening ? (held ? t('teclado.panel.captureHeld', { key: keycaps(held) }) : t('teclado.panel.captureListening'))
          : value ? t('teclado.panel.captureChange') : t('teclado.panel.capturePress')}
      </span>
    </button>
  );
}
