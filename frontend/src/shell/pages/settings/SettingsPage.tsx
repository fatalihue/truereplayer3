import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronRight, RotateCcw } from 'lucide-react';
import { APP_VERSION } from '../../../appVersion';
import { useBridge } from '../../../bridge/BridgeContext';
import type { SettingsState } from '../../../bridge/messageTypes';
import { DialogFooter, DialogShell } from '../../../components/common/DialogShell';
import { useAppActions, useSettings } from '../../../logic/useSettings';
import { useTt } from '../../../state/LanguageContext';
import { useApp } from '../../store';
import { useUi, type SettingsCategory } from '../../ui';
import { useUpdates } from '../../updates';
import { CATEGORIES, onResetAsked, type Category, type Group, type Row } from './categories';
import '../../inspector/editors.css';
import './settings.css';

// The categories of this build: the ones not built yet show, disabled, only in the development build.
const SHOWN = CATEGORIES.filter(c => c.built || import.meta.env.DEV);
const BUILT = SHOWN.filter(c => c.built);
const isShown = (row: Row, s: SettingsState) => !row.shown || row.shown(s);

/**
 * ② Settings (phase 3; the concept's SettingsHotkeys board): the categories on the left, with the
 * search over every setting and, at their foot, the version and the update; the category's settings
 * on the right. Each applies at once, as in today's panel: Settings has no undo, and Reset asks first.
 */
export function SettingsPage() {
  const category = useUi(s => s.settingsCategory);
  const resetAsked = useUi(s => s.settingsReset);
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    onResetAsked(() => setConfirm(true));
    return () => onResetAsked(() => {});
  }, []);
  // The categories in chunks of their own come in once the page is up, when the page has nothing to
  // do: the arrows and Ctrl+K reach a category without the pointer passing over its tab first.
  useEffect(() => {
    const id = requestIdleCallback(() => { for (const c of BUILT) c.warm?.(); }, { timeout: 2000 });
    return () => cancelIdleCallback(id);
  }, []);
  // The confirmation, asked by the row's Reset… or by Ctrl+K's Reset all settings… (settingsReset,
  // set before the page was here); closing it answers both.
  const closeReset = () => {
    setConfirm(false);
    useUi.setState({ settingsReset: false });
  };
  const current = BUILT.find(c => c.id === category) ?? BUILT[0];
  const pick = (id: SettingsCategory) => {
    setQuery('');
    useUi.setState({ settingsCategory: id });
  };
  return (
    <section className="shell-page set" aria-label="Settings">
      <div className="set-nav">
        <span className="set-title">Settings</span>
        <input
          className="set-search"
          type="search"
          aria-label="Search settings"
          placeholder="Search settings"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              setQuery('');
            }
          }}
        />
        <Categories current={current.id} onPick={pick} />
        <Foot />
      </div>
      <div className="set-body">
        {query.trim() ? <Results query={query} onGo={pick} /> : <CategoryView key={current.id} category={current} />}
      </div>
      {(confirm || resetAsked) && <ResetDialog onClose={closeReset} />}
    </section>
  );
}

/** The categories, one tab each: ↑ ↓ Home End move between them, and the panel follows (settings-074). */
function Categories({ current, onPick }: { current: SettingsCategory; onPick: (id: SettingsCategory) => void }) {
  const tt = useTt();
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const at = BUILT.findIndex(c => c.id === current);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? BUILT.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + BUILT.length) % BUILT.length;
    onPick(BUILT[next].id);
    listRef.current?.querySelector<HTMLElement>(`#set-tab-${BUILT[next].id}`)?.focus();
  };
  return (
    <div ref={listRef} className="set-cats" role="tablist" aria-orientation="vertical" aria-label="Settings categories" onKeyDown={onKeyDown}>
      {SHOWN.map(({ id, label, built, Badge, warm }) => (
        <button
          key={id}
          id={`set-tab-${id}`}
          type="button"
          role="tab"
          className="set-cat"
          aria-selected={id === current}
          aria-controls="set-panel"
          tabIndex={id === current ? 0 : -1}
          disabled={!built}
          data-tip={built ? undefined : tt(`${label} — not built yet`, `${label} — ainda não feito`)}
          onPointerEnter={warm}
          onFocus={warm}
          onClick={() => onPick(id)}
        >
          {label}
          {Badge && <Badge />}
        </button>
      ))}
    </div>
  );
}

/** A category: its groups of settings, or its panel (the browser extension). */
function CategoryView({ category }: { category: Category }) {
  const { Panel, Intro } = category;
  return (
    <div id="set-panel" className="set-content" role="tabpanel" aria-labelledby={`set-tab-${category.id}`}>
      <h2 className="set-heading">{category.label}</h2>
      {Intro && <Intro />}
      {Panel ? <Panel /> : category.groups?.map(g => <GroupView key={g.title} group={g} />)}
    </div>
  );
}

function GroupView({ group }: { group: Group }) {
  // Which rows show depends on a setting or two (Fast approach with Game Mode on): one string, so
  // the group draws again only when that changes.
  const visible = useApp(a => group.rows.map(r => (isShown(r, a.settings) ? '1' : '0')).join(''));
  const rows = group.rows.filter((_, i) => visible[i] === '1');
  if (rows.length === 0) return null;
  return (
    <section className="set-group" aria-label={group.title}>
      <h3 className="set-group-title">{group.title}</h3>
      {group.note && <p className="set-group-note">{group.note}</p>}
      {rows.map(r => <RowView key={r.id} row={r} />)}
    </section>
  );
}

function RowView({ row }: { row: Row }) {
  const { Control, Note } = row;
  return (
    <div className="set-row" data-row={row.id}>
      <div className="set-row-text">
        <span className="set-row-label">{row.label}</span>
        {row.hint && <span className="set-row-hint">{row.hint}</span>}
        {Note && <Note />}
      </div>
      <div className="set-row-control"><Control /></div>
    </div>
  );
}

/**
 * The search, over every setting of every category: its name, what it does, and more words for it.
 * The settings found keep their controls, under their category, which a press opens.
 */
function Results({ query, onGo }: { query: string; onGo: (id: SettingsCategory) => void }) {
  const settings = useApp(a => a.settings);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (text: string) => tokens.every(t => text.toLowerCase().includes(t));
  const found = BUILT.flatMap(c => {
    if (c.Panel) return hit(`${c.label} ${c.words ?? ''}`) ? [{ c, rows: [] as Row[] }] : [];
    const rows = (c.groups ?? []).flatMap(g => g.rows).filter(r => isShown(r, settings) && hit(`${r.label} ${r.hint ?? ''} ${r.words ?? ''} ${c.label}`));
    return rows.length > 0 ? [{ c, rows }] : [];
  });
  if (found.length === 0) return <p className="set-empty" role="status">No settings match “{query.trim()}”</p>;
  return (
    <div className="set-content" role="region" aria-label="Search results">
      {found.map(({ c, rows }) => (
        <section key={c.id} className="set-group" aria-label={c.label}>
          <button type="button" className="set-go" onClick={() => onGo(c.id)}>
            {c.label}
            <ChevronRight aria-hidden="true" />
          </button>
          {rows.map(r => <RowView key={r.id} row={r} />)}
        </section>
      ))}
    </div>
  );
}

/**
 * The version and the update, at the foot of the categories. The app updates by itself when idle
 * (D24); "ready to install" shows only while an install the engine put off waits (a run was on), with
 * Restart and update. Otherwise Check for updates, as in today's footer.
 */
function Foot() {
  const postponed = useUpdates(s => s.postponed);
  const app = useAppActions();
  const settings = useSettings();
  const { subscribe } = useBridge();
  const [check, setCheck] = useState<'idle' | 'checking' | 'none' | 'error'>('idle');
  useEffect(() => subscribe((msg) => {
    if (msg.type === 'update:none') setCheck(c => (c === 'checking' ? 'none' : c));
    else if (msg.type === 'update:error') setCheck(c => (c === 'checking' ? 'error' : c));
    else if (msg.type === 'update:available') setCheck('idle');
  }), [subscribe]);
  return (
    <div className="set-foot">
      <span className="set-version">TrueReplayer {APP_VERSION.replace(/^v/, '')}</span>
      {postponed ? (
        <>
          <span className="set-update" role="status">{postponed.version ? `${postponed.version} is ready to install` : 'An update is ready to install'}</span>
          <button type="button" className="set-link" onClick={app.applyUpdate}>Restart and update</button>
        </>
      ) : (
        <button
          type="button"
          className="set-link"
          disabled={check === 'checking'}
          onClick={() => { setCheck('checking'); settings.checkForUpdate(); }}
        >
          {check === 'checking' ? 'Checking…' : check === 'none' ? 'Up to date' : check === 'error' ? 'Check failed — retry' : 'Check for updates'}
        </button>
      )}
    </div>
  );
}

/** Reset all settings… (D23): every app setting back to its default; the macros and their steps stay. */
function ResetDialog({ onClose }: { onClose: () => void }) {
  const settings = useSettings();
  const busy = useApp(a => a.status !== 'ready');
  // A run or a recording that starts closes it: the engine would refuse the reset then.
  useEffect(() => { if (busy) onClose(); }, [busy, onClose]);
  return (
    <DialogShell
      icon={<RotateCcw size={14} style={{ color: 'var(--color-recording-fg)' }} />}
      title="Reset all settings"
      size="sm"
      onClose={onClose}
      footer={<DialogFooter danger secondary={{ label: 'Cancel', onClick: onClose, autoFocus: true }} primary={{ label: 'Reset', onClick: () => { settings.resetAll(); onClose(); } }} />}
    >
      <div className="p-4 flex flex-col gap-2">
        <p className="text-body text-text-secondary">Every setting goes back to its default.</p>
        <p className="text-minor text-text-tertiary">Your macros, their steps and the Clicker presets stay. This can't be undone.</p>
      </div>
    </DialogShell>
  );
}
