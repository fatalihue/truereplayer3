import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowRightLeft, Download, Ellipsis, Gamepad2, Globe, Info, Keyboard, ListChecks, Lock, Plus, X } from 'lucide-react';
import { useBridge } from '../../../bridge/BridgeContext';
import { t, tn } from '../../../i18n';
import { useEditorTools } from '../../../logic/useEditorTools';
import { useRemaps } from '../../../logic/useRemaps';
import { useToast } from '../../../state/ToastContext';
import { DraftField, Keys, Segmented, Switch } from '../../inspector/fields';
import { MacroPicker } from '../../inspector/MacroPicker';
import { keycaps } from '../../library/model';
import { Menu } from '../../Menu';
import { anchorBelow, type MenuAnchor } from '../../menuAnchor';
import {
  EVERYWHERE, FNS, fnInfo, KEYS, legendOf, MODES, MOUSE_CODES, trKeyName, type FnKind, type Game, type KeyCap, type KeyFn,
} from '../../mk/mkModel';
import {
  addExe, addGame, fnAt, gameOf, globalsOf, layerKeyOf, listedGames, openGame, overwriteUnreadable, pickKey, remapsWith, removeExe,
  removeGame, renameGame, setGameFn, setGameOn, useMk, type Source, type Variant,
} from '../../mk/mkStore';
import { Popover } from '../../Popover';
import { useApp } from '../../store';
import { openPage } from '../../ui';
import { MOUSE_TARGETS, mouseTarget } from '../remaps/remapModel';
import '../../inspector/editors.css';
import '../../inspector/windowEditors.css';
import '../remaps/remaps.css';
import './teclado.css';

/**
 * ② Teclado (branch teclado; plan .claude/planos/teclado-no-tr3-2026-11-10.md): TrueReplayerMK as a
 * mode of TR3. The games on the left, in the library's place and form; the keyboard in the middle,
 * each key's function in the colour of TR3's step that does the same; the key on the right, in the
 * classes of "Remap settings". The games are the engine's (TecladoService, teclado.json) and every
 * edit goes back whole; a key's macro is a macro of TR3's library, opened in TR3's editor. Phase 1:
 * nothing happens in the games yet — the foreground event and the hook are phases 2 and 3.
 */
export default function TecladoPage() {
  const key = useMk(s => s.key);
  const open = useMk(s => s.open);
  const hasGames = useMk(s => s.games.length > 0);
  // Esc closes the key, as the Key Remaps' panel does.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || !useMk.getState().key) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      pickKey(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const empty = !hasGames && open !== EVERYWHERE;
  return (
    <section className="shell-page tk" aria-label={t('teclado.page')}>
      <Games />
      <div className="tk-main">
        <Warn />
        {empty ? <EmptyMain /> : (
          <>
            <Head />
            <Bar />
            <div className="tk-scroll">
              <Board />
              <Legend />
              <Notes />
            </div>
          </>
        )}
      </div>
      {key && !empty ? <KeyPanel code={key} /> : <EmptyPanel />}
    </section>
  );
}

// ── What the screens read ──

const SHORT = tn('teclado.short');

/** The Key Remaps under the open game (variant A), or everywhere (B). */
function useGlobals(): Record<string, KeyFn> {
  const remaps = useApp(a => a.settings.remaps);
  const variant = useMk(s => s.variant);
  const game = useMk(gameOf);
  return globalsOf(remaps, variant === 'beside' && game ? game.exes : null);
}

const globalName = (variant: Variant) => (variant === 'beside' ? t('common.pages.remaps') : t('teclado.games.everywhere'));

/** What the key shows under its name: one word, or the start of it. */
function labelOf(fn: KeyFn): string {
  switch (fn.kind) {
    case 'key': return fn.combo ? keycaps(fn.combo) : SHORT.choose;
    case 'mouse': return SHORT[fn.mouse as keyof typeof SHORT] ?? SHORT.choose;
    case 'macro': return fn.macro || SHORT.choose;
    case 'text': return fn.text || SHORT.choose;
    case 'off': return SHORT.off;
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
      const mode = MODES.find(m => m.value === fn.mode)?.label.toLowerCase();
      return mode ? t('teclado.sentence.macroMode', { macro: labelOf(fn), mode }) : t('teclado.sentence.macro', { macro: labelOf(fn) });
    }
    case 'text': return t('teclado.sentence.text', { text: fn.text ?? '' });
    case 'off': return t('teclado.sentence.off');
    case 'layer': return t('teclado.sentence.layer');
    default: return t('teclado.sentence.default');
  }
}

// ── The games (as the library) ──

function Games() {
  const variant = useMk(s => s.variant);
  // The selector returns the state's own array; the list filtered is made in the render (a new array
  // per read would make useSyncExternalStore render without end).
  const all = useMk(s => s.games);
  const games = listedGames({ games: all, variant });
  const open = useMk(s => s.open);
  const front = useMk(s => s.front);
  const remaps = useApp(a => a.settings.remaps);
  const [adding, setAdding] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const merged = variant === 'merged';
  const everywhereCount = remaps.entries.filter(e => !e.process).length;
  const title = merged ? t('teclado.games.titleMerged') : t('teclado.games.title');
  const row = (g: Game) => (
    <button key={g.id} type="button" className="tk-game" aria-current={open === g.id || undefined} data-off={!g.on || undefined}
      onClick={() => openGame(g.id)}>
      <span className="tk-avatar" aria-hidden="true">{g.name.slice(0, 1).toUpperCase()}</span>
      <span className="tk-game-text">
        <span className="tk-game-name">{g.name}</span>
        <span className="tk-game-exe">{g.exes.join(' · ')}</span>
      </span>
      {front === g.id && <span className="tk-front-dot" role="img" aria-label={t('teclado.games.inFront')} data-tip={t('teclado.games.inFront')} data-tip-pos="end" />}
    </button>
  );
  const plainGames = games.filter(g => !g.app);
  return (
    <aside className="tk-games" aria-label={title}>
      <div className="lib-header">
        <span className="lib-title">{title}</span>
        <button type="button" className="lib-new" aria-haspopup="dialog" aria-expanded={!!adding}
          onClick={(e) => setAdding(adding ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
          <Plus aria-hidden="true" />
          <span>{t('common.actions.add')}</span>
        </button>
      </div>
      {adding && (
        <AddPopover anchor={adding.anchor} toggle={adding.button} label={t('teclado.add.label')}
          onPick={(exe) => { addGame(exe); setAdding(null); }} onClose={() => setAdding(null)} />
      )}
      <div className="tk-games-list">
        {merged && (
          <>
            <span className="lib-heading">{t('teclado.games.always')}</span>
            <button type="button" className="tk-game" aria-current={open === EVERYWHERE || undefined} data-off={!remaps.enabled || undefined}
              onClick={() => openGame(EVERYWHERE)}>
              <span className="tk-avatar" aria-hidden="true"><Globe /></span>
              <span className="tk-game-text">
                <span className="tk-game-name">{t('teclado.games.everywhere')}</span>
                <span className="tk-game-exe">{t('teclado.games.everywhereSub', { count: everywhereCount })}</span>
              </span>
            </button>
          </>
        )}
        <span className="lib-heading" data-after={merged || undefined}>{t('teclado.games.heading')}</span>
        {plainGames.map(row)}
        {plainGames.length === 0 && <span className="tk-games-none">{t('teclado.games.none')}</span>}
        {merged && games.some(g => g.app) && (
          <>
            <span className="lib-heading" data-after>{t('teclado.games.otherApps')}</span>
            {games.filter(g => g.app).map(row)}
          </>
        )}
      </div>
      <p className="tk-games-foot">{merged ? t('teclado.games.footMerged') : t('teclado.games.foot')}</p>
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
  const open = useMk(s => s.open);
  const front = useMk(s => s.front);
  const holding = useMk(s => s.holding);
  const remaps = useApp(a => a.settings.remaps);
  const { setEnabled } = useRemaps();
  const { showToast } = useToast();
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const [adding, setAdding] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const [renaming, setRenaming] = useState(false);
  if (open === EVERYWHERE) {
    return (
      <header className="tk-head">
        <div className="tk-titles">
          <h1 className="tk-title">{t('teclado.games.everywhere')}</h1>
          <p className="tk-sub">{t('teclado.head.everywhereSub')}</p>
        </div>
        <div className="tk-head-end">
          <span className="tk-use">{t('teclado.head.use')}<Switch label={t('teclado.head.useEverywhere')} checked={remaps.enabled} onChange={setEnabled} /></span>
        </div>
      </header>
    );
  }
  if (!game) return <header className="tk-head" />;
  const isFront = front === game.id;
  const soon = () => showToast(t('teclado.head.soon'), { type: 'info' });
  const remove = () => {
    const undo = removeGame(game.id);
    showToast(t('teclado.head.deleted', { game: game.name }), {
      type: 'success',
      duration: 10000,
      action: { label: t('common.actions.undo'), onClick: undo },
    });
  };
  return (
    <header className="tk-head">
      <div className="tk-titles">
        <h1 className="tk-title">
          {renaming
            ? <RenameField name={game.name} onDone={(name) => { if (name !== null) renameGame(game.id, name); setRenaming(false); }} />
            : game.name}
          {isFront && game.on && <span className="tk-pill" data-tone={holding ? 'layer' : undefined}>{holding ? t('teclado.head.inFrontLayer') : t('teclado.head.inFront')}</span>}
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
          <span className="tk-sub-text">{game.app ? t('teclado.head.subApp') : t('teclado.head.sub')}</span>
        </p>
      </div>
      <div className="tk-head-end">
        <span className="tk-use">{t('teclado.head.use')}<Switch label={t('teclado.head.useIn', { game: game.name })} checked={game.on} onChange={(on) => setGameOn(game.id, on)} /></span>
        <span className="rm-sep" aria-hidden="true" />
        <button type="button" className="insp-button tk-file" data-tip={t('teclado.head.exportTip')} onClick={soon}>
          <Download aria-hidden="true" />
          {t('common.actions.export')}
        </button>
        <button type="button" className="insp-icon-button" aria-label={t('teclado.head.more')} aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
          <Ellipsis aria-hidden="true" />
        </button>
        {menu && (
          <Menu anchor={menu.anchor} label={t('teclado.head.more')} toggle={menu.button} onClose={() => setMenu(null)}
            entries={[
              { label: t('common.actions.rename'), onSelect: () => setRenaming(true) },
              { label: t('teclado.add.addExe'), onSelect: () => setAdding({ anchor: menu.anchor, button: menu.button }) },
              { label: t('teclado.head.lock'), icon: Lock, onSelect: soon },
              { label: t('common.actions.import'), onSelect: soon },
              'separator',
              { label: t('common.actions.delete'), danger: true, onSelect: remove },
            ]} />
        )}
        {adding && (
          <AddPopover anchor={adding.anchor} toggle={adding.button} label={t('teclado.add.addExe')}
            onPick={(exe) => { addExe(game.id, exe); setAdding(null); }} onClose={() => setAdding(null)} />
        )}
      </div>
    </header>
  );
}

/** The game's name, typed in its place: Enter or leaving keeps it, Esc goes back. */
function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (next: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  return (
    <input className="tk-rename" aria-label={t('teclado.head.renameLabel')} value={value} maxLength={60} spellCheck={false}
      ref={(el) => { if (el && document.activeElement !== el && !done.current) el.focus(); }}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(value); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      }}
      onBlur={() => finish(value)} />
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

function EmptyMain() {
  return (
    <div className="rm-empty">
      <span className="rm-empty-icon" aria-hidden="true"><Gamepad2 /></span>
      <span className="rm-empty-title">{t('teclado.empty.title')}</span>
      <span className="rm-empty-text">{t('teclado.empty.text')}</span>
    </div>
  );
}

// ── The bar ──

function Bar() {
  const device = useMk(s => s.device);
  const view = useMk(s => s.view);
  const numpad = useMk(s => s.numpad);
  const open = useMk(s => s.open);
  const game = useMk(gameOf);
  const globals = useGlobals();
  const layerKey = layerKeyOf(game);
  const everywhere = open === EVERYWHERE;
  const count = everywhere ? Object.keys(globals).length
    : game ? Object.keys(view === 'layer' ? game.layer : game.base).length : 0;
  return (
    <div className="tk-bar">
      <div className="tk-seg-device">
        <Segmented<'keyboard' | 'mouse'> label={t('teclado.bar.device')} value={device}
          options={[{ value: 'keyboard', label: t('teclado.bar.keyboard') }, { value: 'mouse', label: t('teclado.bar.mouse') }]}
          onChange={(d) => useMk.setState({ device: d, key: null })} />
      </div>
      <div className="tk-seg-layer">
        <Segmented<'base' | 'layer'> label={t('teclado.bar.layerGroup')} value={everywhere ? 'base' : view}
          options={[
            { value: 'base', label: t('teclado.bar.base') },
            {
              value: 'layer',
              label: layerKey ? t('teclado.bar.layerHold', { key: legendOf(layerKey) }) : t('teclado.bar.layer'),
              disabled: everywhere || !layerKey,
              tip: everywhere ? t('teclado.bar.noLayerEverywhere') : !layerKey ? t('teclado.bar.noLayer') : undefined,
            },
          ]}
          onChange={(v) => useMk.setState({ view: v })} />
      </div>
      <span className="rm-spacer" />
      <span className="tk-count">
        {view === 'layer' && !everywhere ? t('teclado.bar.changedLayer', { count }) : t('teclado.bar.changed', { count })}
      </span>
      <button type="button" className="rm-chip" aria-pressed={numpad} onClick={() => useMk.setState({ numpad: !numpad })}>{t('teclado.bar.numpad')}</button>
      <span className="tk-layout" data-tip={t('teclado.bar.layoutTip')}>{t('teclado.bar.layout')}</span>
    </div>
  );
}

// ── The drawing ──

function Board() {
  const device = useMk(s => s.device);
  const numpad = useMk(s => s.numpad);
  const caps = numpad ? KEYS : KEYS.filter(k => k.block !== 'num');
  const gridRef = useRef<HTMLDivElement>(null);
  if (device === 'mouse') return <MouseBoard />;
  // The arrows move across the drawing (the MK plan: "setas andam pelo desenho do teclado").
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    const from = KEYS.find(k => k.code === (e.target as HTMLElement).dataset.code);
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
      <div ref={gridRef} className="tk-grid" data-numpad={numpad || undefined} role="group" aria-label={t('teclado.board.label')} onKeyDown={onKeyDown}>
        {caps.map(k => <Key key={k.code} cap={k} />)}
      </div>
    </div>
  );
}

function Key({ cap }: { cap: KeyCap }) {
  const state = useMk();
  const globals = useGlobals();
  const { fn, source } = fnAt(state, cap.code, globals);
  const selected = state.key === cap.code;
  const game = gameOf(state);
  const held = state.view === 'layer' && cap.code === layerKeyOf(game);
  const Icon = source === 'own' ? fnInfo(fn.kind).Icon : null;
  const label = held ? t('teclado.board.held') : labelOf(fn);
  const rule = sentenceOf(fn);
  const words = fn.kind === 'default' ? cap.legend
    : `${cap.legend}: ${source === 'base' ? t('teclado.board.fromBase', { rule })
      : source === 'global' ? t('teclado.board.fromGlobal', { rule, source: globalName(state.variant) })
      : rule}`;
  return (
    <div className="tk-slot" data-iso={cap.isoEnter || undefined}
      style={{ gridColumn: `${cap.col} / span ${cap.w}`, gridRow: `${cap.row} / span ${cap.h}` }}>
      <button
        type="button"
        className="tk-key"
        data-code={cap.code}
        data-fn={fn.kind !== 'default' && source === 'own' ? fn.kind : undefined}
        data-source={source !== 'own' ? source : undefined}
        data-held={held || undefined}
        aria-pressed={selected}
        aria-label={words}
        data-tip={fn.kind !== 'default' ? words : undefined}
        tabIndex={selected || (!state.key && cap.code === 'Escape') ? 0 : -1}
        onClick={() => pickKey(selected ? null : cap.code)}
      >
        <span className="tk-leg">{cap.legend}</span>
        {Icon && <Icon className="tk-ico" aria-hidden="true" />}
        {source === 'base' && <span className="tk-inh" aria-hidden="true">↧</span>}
        {source === 'global' && <span className="tk-inh" aria-hidden="true">{state.variant === 'beside' ? <ArrowRightLeft /> : <Globe />}</span>}
        {label && <span className="tk-fn" data-one={!label.includes(' ') || undefined}>{label}</span>}
      </button>
      {source === 'own' && fn.kind !== 'default' && state.open !== EVERYWHERE && (
        <button type="button" className="tk-x" aria-label={t('teclado.board.clear', { key: cap.legend })} data-tip={t('common.actions.clear')} tabIndex={-1}
          onClick={() => setGameFn(cap.code, { kind: 'default' })}>
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** The mouse: middle, the side buttons and the wheel take a function; left and right stay out. */
function MouseBoard() {
  const state = useMk();
  const globals = useGlobals();
  return (
    <div className="tk-mouse" role="group" aria-label={t('teclado.board.mouseLabel')}>
      {[t('teclado.board.left'), t('teclado.board.right')].map(name => (
        <div key={name} className="tk-slot">
          <button type="button" className="tk-key" disabled data-tip={t('teclado.board.mouseOutTip')}>
            <span className="tk-leg">{name}</span>
            <span className="tk-fn">{t('teclado.board.alwaysNormal')}</span>
          </button>
        </div>
      ))}
      {MOUSE_CODES.map(code => {
        const { fn, source } = fnAt(state, code, globals);
        const info = fnInfo(fn.kind);
        const selected = state.key === code;
        return (
          <div key={code} className="tk-slot">
            <button type="button" className="tk-key" aria-pressed={selected} data-fn={fn.kind !== 'default' && source === 'own' ? fn.kind : undefined}
              onClick={() => pickKey(selected ? null : code)}>
              <span className="tk-leg">{legendOf(code)}</span>
              {info.Icon && <info.Icon className="tk-ico" aria-hidden="true" />}
              <span className="tk-fn">{labelOf(fn)}</span>
            </button>
          </div>
        );
      })}
      <p className="tk-mouse-note">{t('teclado.board.mouseNote')}</p>
    </div>
  );
}

// ── The legend and the notes ──

function Legend() {
  const view = useMk(s => s.view);
  const variant = useMk(s => s.variant);
  const open = useMk(s => s.open);
  return (
    <div className="tk-legend" aria-label={t('teclado.legend.label')}>
      {FNS.filter(f => f.kind !== 'default').map(f => (
        <span key={f.kind} className="tk-legend-item" data-fn={f.kind}>
          <span className="tk-swatch" data-fn={f.kind} aria-hidden="true" />
          {f.Icon && <f.Icon aria-hidden="true" />}
          {f.kind === 'off' ? t('teclado.legend.off') : f.label}
        </span>
      ))}
      {view === 'layer' && open !== EVERYWHERE && (
        <span className="tk-legend-item" data-inh>
          <span className="tk-swatch" data-inh aria-hidden="true" />
          {t('teclado.legend.fromBase')}
        </span>
      )}
      {open !== EVERYWHERE && (
        <span className="tk-legend-item" data-inh>
          <span className="tk-swatch" data-inh aria-hidden="true" />
          {variant === 'beside' ? <ArrowRightLeft aria-hidden="true" /> : <Globe aria-hidden="true" />}
          {variant === 'beside' ? t('teclado.legend.fromRemaps') : t('teclado.legend.fromEverywhere')}
        </span>
      )}
    </div>
  );
}

function Notes() {
  const variant = useMk(s => s.variant);
  const open = useMk(s => s.open);
  const app = useMk(s => !!gameOf(s)?.app);
  if (open === EVERYWHERE) {
    return (
      <div className="tk-notes">
        <p className="tk-note"><Info aria-hidden="true" /><span>{t('teclado.notes.everywhere')}</span></p>
      </div>
    );
  }
  return (
    <div className="tk-notes">
      <p className="tk-note"><Gamepad2 aria-hidden="true" /><span>{app ? t('teclado.notes.frontApp') : t('teclado.notes.front')}</span></p>
      {variant === 'beside'
        ? <p className="tk-note"><ArrowRightLeft aria-hidden="true" /><span>{t('teclado.notes.beside')}</span></p>
        : <p className="tk-note"><Globe aria-hidden="true" /><span>{t('teclado.notes.merged')}</span></p>}
    </div>
  );
}

// ── The key ──

function EmptyPanel() {
  return (
    <aside className="tk-panel" data-empty aria-label={t('teclado.panel.emptyTitle')}>
      <div className="tk-empty">
        <span className="rm-empty-icon" aria-hidden="true"><Keyboard /></span>
        <span className="tk-empty-title">{t('teclado.panel.emptyTitle')}</span>
        <span className="tk-empty-text">{t('teclado.panel.emptyText')}</span>
      </div>
    </aside>
  );
}

function KeyPanel({ code }: { code: string }) {
  const state = useMk();
  const globals = useGlobals();
  const remaps = useApp(a => a.settings.remaps);
  const { save } = useRemaps();
  const game = gameOf(state);
  const everywhere = state.open === EVERYWHERE;
  const layer = state.view === 'layer' && !everywhere;
  const layerKey = layerKeyOf(game);
  const { fn, source } = fnAt(state, code, globals);
  const legend = legendOf(code);
  const where = everywhere ? t('teclado.games.everywhere')
    : layer ? t('teclado.panel.whereLayer', { game: game?.name ?? '', key: legendOf(layerKey ?? '') })
    : t('teclado.panel.whereBase', { game: game?.name ?? '' });
  // The function chosen in the list: its own, or Default when the key only inherits.
  const kind: FnKind = source === 'own' ? fn.kind : 'default';
  const set = (next: KeyFn) => {
    if (everywhere) save(remapsWith(remaps.entries, code, next));
    else setGameFn(code, next);
  };
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
    if (everywhere && (k === 'macro' || k === 'text' || k === 'layer')) return t('teclado.panel.whyEverywhere');
    if (layer && k === 'layer') return t('teclado.panel.whyLayerKey');
    if (layer && code === layerKey) return t('teclado.panel.whyHolding');
    if (code.startsWith('Wheel') && k === 'layer') return t('teclado.panel.whyWheel');
    return null;
  };
  const global = !everywhere ? globals[code] : undefined;
  const title = t('teclado.panel.title', { key: legend });
  return (
    <aside className="tk-panel" aria-label={title}>
      <div className="rm-panel-head">
        <span className="rm-panel-icon" aria-hidden="true">{legend.length <= 3 ? legend : <Keyboard />}</span>
        <div className="rm-panel-titles">
          <span className="rm-panel-title">{title}</span>
          <span className="rm-panel-sub">{where}</span>
        </div>
        <button type="button" className="insp-icon-button" aria-label={t('teclado.panel.close')} onClick={() => pickKey(null)}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="rm-panel-body">
        <section className="rm-sec" aria-label={t('teclado.panel.function')}>
          <span className="rm-label">{t('teclado.panel.function')}</span>
          <div className="tk-fns" role="radiogroup" aria-label={t('teclado.panel.function')}>
            {FNS.map(f => {
              const off = whyOff(f.kind);
              const name = f.kind === 'default' && layer ? t('teclado.panel.sameAsBase')
                : f.kind === 'default' && global ? t('teclado.panel.follows', { source: globalName(state.variant) })
                : f.label;
              const aside = f.kind === 'default' && source !== 'own' ? sentenceOf(fn) : null;
              return (
                <button key={f.kind} type="button" role="radio" className="rm-radio" data-fn={f.kind} aria-checked={kind === f.kind}
                  disabled={!!off} data-tip={off ?? undefined} data-tip-pos="start" onClick={() => choose(f.kind)}>
                  {f.Icon ? <f.Icon aria-hidden="true" /> : <span className="tk-fn-none" aria-hidden="true" />}
                  {name}
                  {aside && <span className="tk-fn-aside">{aside}</span>}
                </button>
              );
            })}
          </div>
        </section>
        <Options code={code} legend={legend} fn={fn} kind={kind} source={source} patch={patch} />
        {global && source === 'own' && fn.kind !== 'default' && game && (
          <p className="rm-msg" data-tone="warn">
            {state.variant === 'beside'
              ? t('teclado.panel.conflictBeside', { key: legend, rule: sentenceOf(global), game: game.name })
              : t('teclado.panel.conflictMerged', { key: legend, rule: sentenceOf(global), game: game.name })}
          </p>
        )}
      </div>
      <div className="rm-panel-foot">
        {everywhere ? t('teclado.panel.footEverywhere') : t('teclado.panel.foot', { game: game?.name ?? '' })}
      </div>
    </aside>
  );
}

function Options({ code, legend, fn, kind, source, patch }: {
  code: string; legend: string; fn: KeyFn; kind: FnKind; source: Source; patch: (p: Partial<KeyFn>) => void;
}) {
  const state = useMk();
  const game = gameOf(state);
  const everywhere = state.open === EVERYWHERE;
  const isLayerKey = state.view === 'base' && !everywhere && fn.kind === 'layer';
  switch (kind) {
    case 'default': {
      const rule = sentenceOf(fn);
      return (
        <p className="rm-hint">
          {source === 'base' ? t('teclado.panel.defaultFromBase', { key: legend, rule })
            : source === 'global' ? t('teclado.panel.defaultFromGlobal', { key: legend, source: globalName(state.variant), rule })
            : /^Key[A-Z]$/.test(code) ? t('teclado.panel.defaultTypes', { key: legend, typed: legend.toLowerCase() })
            : t('teclado.panel.defaultNormal', { key: legend })}
        </p>
      );
    }
    case 'key':
      return (
        <section className="rm-sec" aria-label={t('teclado.panel.keyOut')}>
          <span className="rm-label">{t('teclado.panel.keyOut')}</span>
          <ComboCapture value={fn.combo ?? ''} onCapture={(combo) => patch({ combo })} />
          <p className="rm-hint">{t('teclado.panel.keyHint')}</p>
        </section>
      );
    case 'mouse':
      return (
        <section className="rm-sec" aria-label={t('teclado.panel.button')}>
          <span className="rm-label">{t('teclado.panel.button')}</span>
          <div className="rm-mouse" role="radiogroup" aria-label={t('teclado.panel.mouseLabel')}>
            {MOUSE_TARGETS.map(m => (
              <button key={m.name} type="button" role="radio" className="rm-radio" aria-checked={fn.mouse === m.name}
                onClick={() => patch({ mouse: m.name })}>
                {m.label}
              </button>
            ))}
          </div>
        </section>
      );
    case 'macro':
      return <MacroOptions key={code} legend={legend} fn={fn} patch={patch} />;
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
          {everywhere ? t('teclado.panel.offEverywhere', { key: legend }) : t('teclado.panel.offGame', { key: legend, game: game?.name ?? '' })}
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

/** Macro: a macro of TR3's library, its mode, the repetitions, and the way to TR3's editor. */
function MacroOptions({ legend, fn, patch }: { legend: string; fn: KeyFn; patch: (p: Partial<KeyFn>) => void }) {
  const profiles = useApp(a => a.profiles);
  const order = useApp(a => a.profileOrder);
  const { send } = useBridge();
  const { showToast } = useToast();
  const names = profiles.map(p => p.name);
  const chosen = profiles.find(p => p.name === fn.macro) ?? null;
  const folder = order.folders.find(f => f.items.includes(fn.macro ?? ''))?.name;
  const mode = fn.mode ?? 'once';
  // The library's picker (the Run Macro step's) opens to change it; with a macro chosen, its card stays.
  const [picking, setPicking] = useState(false);
  const openInEditor = () => {
    if (!chosen) return;
    send({ type: 'profile:open', payload: { name: chosen.name } });
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
            <button type="button" className="insp-button tk-macro-swap" onClick={() => setPicking(true)}>{t('teclado.macro.swap')}</button>
          </div>
        ) : (
          <MacroPicker names={names} value={fn.macro ?? null} label={t('teclado.macro.label')} autoFocus={picking}
            onPick={(macro) => { patch({ macro }); setPicking(false); }} />
        )}
        <div className="insp-line">
          <button type="button" className="insp-button" disabled={!chosen} onClick={openInEditor}>{t('teclado.macro.openEditor')}</button>
          <button type="button" className="insp-button" onClick={() => showToast(t('teclado.macro.recordSoon', { key: legend }), { type: 'info' })}>
            <span className="tk-rec" aria-hidden="true" />
            {t('teclado.macro.recordNew')}
          </button>
        </div>
      </section>
      <section className="rm-sec" aria-label={t('teclado.macro.mode')}>
        <span className="rm-label">{t('teclado.macro.mode')}</span>
        <Segmented label={t('teclado.macro.mode')} value={mode} wrap options={MODES} onChange={(m) => patch({ mode: m })} />
        {mode === 'times' && (
          <div className="insp-row">
            <span className="insp-row-label">{t('teclado.macro.times')}</span>
            <span className="insp-row-end">
              <DraftField stepId={`teclado-${legend}`} field="times" label={t('teclado.macro.times')} kind="int" min={2} max={999} unit="×"
                stored={String(fn.times ?? 3)} onApply={(v) => patch({ times: Number(v) })} />
            </span>
          </div>
        )}
        {mode !== 'once' && (
          <div className="insp-row">
            <span className="insp-row-label">{t('teclado.macro.interval')}</span>
            <span className="insp-row-end">
              <DraftField stepId={`teclado-${legend}`} field="interval" label={t('teclado.macro.interval')} kind="int" min={0} max={60000} unit="ms"
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

/**
 * The key that goes out, captured in the panel. Phase 1 listens to the keys the page sees; the
 * engine's hook capture (KeyCapture, useKeyCapture) takes its place with the hook in phase 3.
 */
function ComboCapture({ value, onCapture }: { value: string; onCapture: (combo: string) => void }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      if (e.key === 'Escape') { setListening(false); return; }
      const parts = [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', e.metaKey && 'Win'].filter(Boolean) as string[];
      parts.push(trKeyName(e.code));
      onCapture(parts.join('+'));
      setListening(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, onCapture]);
  return (
    <button type="button" className="insp-capture rm-capture" aria-pressed={listening} data-listening={listening || undefined}
      onClick={() => setListening(on => !on)} onBlur={() => setListening(false)}>
      {value ? <Keys combo={value} /> : <span className="insp-capture-none">{t('inspector.fields.noKey')}</span>}
      <span className="insp-capture-hint">
        {listening ? t('teclado.panel.captureListening') : value ? t('teclado.panel.captureChange') : t('teclado.panel.capturePress')}
      </span>
    </button>
  );
}
