import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Crop, Crosshair, Ellipsis, Lock, MousePointerClick, Pause, Play, Plus, Square, TriangleAlert, X } from 'lucide-react';
import type { ClickerPreset } from '../../../bridge/messageTypes';
import { useBridge } from '../../../bridge/BridgeContext';
import { fmtHora, t, tn } from '../../../i18n';
import { matchingPreset, useClicker } from '../../../logic/useClicker';
import { useReplay } from '../../../logic/useReplay';
import { useToast } from '../../../state/ToastContext';
import { formatRate } from '../../../utils/clickerFormat';
import { isModalDialogOpen } from '../../../utils/modalDialog';
import { DraftField, Segmented, Switch } from '../../inspector/fields';
import { keycaps } from '../../library/model';
import { Menu } from '../../Menu';
import { anchorBelow, type MenuAnchor } from '../../menuAnchor';
import { useApp, useShell } from '../../store';
import { useUi } from '../../ui';
import { ConflictNote, HotkeyField } from '../settings/hotkeys';
import {
  bits, BUTTONS, clicksLimit, clock, delayFor, displayOf, endWords, fieldsOf, grouped, limitText, MAX_CLICKS, MAX_NAME, MAX_PRESETS,
  MAX_SPREAD_PX, MAX_TIME_S, presetLine, progressOf, quickRates, rateLine, rateNote, rateOf, rateShort, rateShown, sameFields,
  sentence, spreadPx, takesSec, takesWords, timeLimitS, whereOf, type FieldKey, type Fields, type Where,
} from './clickerModel';
import {
  choosePreset, commitFields, engineFields, fieldsNow, recordDelete, sendFields, settle, stepFields, undoDelete, useClickerUi, useFields,
} from './clickerStore';
import '../../inspector/editors.css';
import './clicker.css';

/**
 * ② The Clicker (phase 3, slices 6 and 7; the concept's Clicker and ClickerRunning boards): the engine's Clicker mode as a page.
 * It is open exactly while the mode is on — the rail, its hotkey and the tray turn the mode on and
 * the page comes; leaving the page turns it off ("both only while this page is open"). The presets
 * on the left, the run in the middle (Start, Pause, what it will do), "Clicker settings" on the
 * right, applying as you type, with the page's own Ctrl+Z. The selected preset takes every edit.
 * Today's Settings › Clicker (SettingsPanel's ClickerSection and ClickerPresetRow) is the reference.
 */
export default function ClickerPage() {
  const clicker = useClicker();
  const settings = useApp(a => a.settings);
  const running = useApp(a => a.status === 'replaying');
  const latest = useRef({ clicker, running });
  useEffect(() => { latest.current = { clicker, running }; });

  // Leaving the page turns the mode off. A remount in place (the development build's double mount)
  // is not leaving: the page is still the Clicker's then.
  useEffect(() => () => {
    if (useUi.getState().page !== 'clicker' && useShell.getState().app.settings.useCursorClick) latest.current.clicker.setMode(false);
  }, []);

  // The echo settles what was sent.
  useEffect(() => { settle(fieldsOf(settings)); }, [settings]);
  // On a visit with no preset selected, the one the settings match is the selected one. Only then:
  // after a Delete, a preset that happens to match is not chosen for the user, or the next edits
  // would go into it unasked.
  useEffect(() => {
    if (useClickerUi.getState().selected) return;
    const match = matchingPreset(useShell.getState().app.settings);
    if (match) useClickerUi.setState({ selected: match.name });
  }, []);
  // The preset the toast's Undo brought back is the selected one again, while the settings are its own.
  const presets = settings.cursorClickPresets;
  useEffect(() => {
    if (!back || useClickerUi.getState().selected) return;
    const restored = (presets ?? []).find(p => sameName(p.name, back));
    if (!restored) return;
    back = null;
    if (sameFields(fieldsOf(restored), engineFields())) useClickerUi.setState({ selected: restored.name });
  }, [presets]);
  useSaveIntoPreset(running);
  useUnseedSpread();

  // The monitors, for the drawing of the display the area or the point is on: asked on each visit.
  const { subscribe } = useBridge();
  useEffect(() => subscribe((message) => {
    if (message.type === 'screen:displays') useClickerUi.setState({ displays: message.payload.displays });
  }), [subscribe]);
  useEffect(() => { latest.current.clicker.askDisplays(); }, []);
  // When a run ends, for "Last run 14:10 · …": the moment its reason arrives (not a visit that finds it there).
  const endReason = useShell(s => s.live.clickerStats.endReason);
  const lastReason = useRef(endReason);
  useEffect(() => {
    const before = lastReason.current;
    lastReason.current = endReason;
    if (endReason && !before) useClickerUi.setState({ endedAt: Date.now() });
  }, [endReason]);

  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z): the page's own history. Not while it clicks; a text field keeps its own.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && useClickerUi.getState().peek) { useClickerUi.setState({ peek: false }); return; }
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || el.tagName === 'TEXTAREA'
        || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)));
      if (typing || isModalDialogOpen()) return;
      e.preventDefault();
      if (latest.current.running) return;
      stepFields(key === 'z' && !e.shiftKey, sendOf(latest.current.clicker), presetStepsOf(latest.current.clicker));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const peek = useClickerUi(s => s.peek);
  return (
    <section className="shell-page ck" aria-label={t('common.pages.clicker')} data-peek={peek || undefined}>
      <Presets running={running} />
      <div className="ck-main">
        <Head running={running} />
        <Center running={running} />
      </div>
      <Settings running={running} />
    </section>
  );
}

type Clicker = ReturnType<typeof useClicker>;
const sendOf = (clicker: Clicker) => (key: FieldKey, value: unknown) => clicker.set(key, value as string | boolean | number | object | null);
// The history's Delete (paineis-156): the engine's restore, which the page selects once it is back, and the Delete again.
const presetStepsOf = (clicker: Clicker) => ({
  restore: (name: string) => { back = name; clicker.undoDeletePreset(name); },
  remove: (name: string) => clicker.deletePreset(name),
});
const sameName = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
// The preset the toast's Undo is bringing back, until it is in the list.
let back: string | null = null;

/**
 * Before the selection moves (another preset, New): the selected preset takes what was edited last,
 * which its own save would otherwise get 150 ms later, after the move. The engine takes the messages
 * in order, so the save snapshots every value sent before it.
 */
function flushSave(clicker: Clicker) {
  const { selected, expect } = useClickerUi.getState();
  if (!selected || expect) return;
  const preset = (useShell.getState().app.settings.cursorClickPresets ?? []).find(p => sameName(p.name, selected));
  if (preset && !sameFields(fieldsOf(preset), fieldsNow())) clicker.savePreset(selected);
}

/**
 * "Edits save into the one that is selected": once the engine holds settings the selected preset
 * does not, the preset is saved again from them (clicker:savePreset takes the engine's settings).
 * Not while values are on their way, nor before an apply or an undo has landed; and once per
 * settings, so a value the engine stores differently cannot make it save over and over.
 */
let savedFrom = '';
function useSaveIntoPreset(running: boolean) {
  const clicker = useClicker();
  const selected = useClickerUi(s => s.selected);
  const expect = useClickerUi(s => s.expect);
  const waiting = useClickerUi(s => Object.keys(s.pending).length > 0);
  const engineKey = useApp(a => JSON.stringify(fieldsOf(a.settings)));
  const presetKey = useApp(a => {
    const p = selected ? (a.settings.cursorClickPresets ?? []).find(x => sameName(x.name, selected)) : undefined;
    return p ? JSON.stringify(fieldsOf(p)) : '';
  });
  useEffect(() => {
    if (!selected || !presetKey || running) return;
    if (expect) {
      if (sameFields(engineFields(), expect)) useClickerUi.setState({ expect: null });
      return;
    }
    if (waiting || presetKey === engineKey || savedFrom === `${selected}\n${engineKey}`) return;
    const id = setTimeout(() => {
      savedFrom = `${selected}\n${engineKey}`;
      clicker.savePreset(selected);
    }, 150);
    return () => clearTimeout(id);
  }, [selected, presetKey, engineKey, expect, waiting, running, clicker]);
}

// ── Seeds: a switch turned on with no useful value gets one; turned off untouched, the old value comes back ──

const SEED_FLOOR: Partial<Record<FieldKey, number>> = { cursorClickLoops: 1, cursorClickDelayJitter: 2, cursorClickPositionJitter: 2 };
const SEED: Partial<Record<FieldKey, string>> = { cursorClickLoops: '100', cursorClickDelayJitter: '10', cursorClickPositionJitter: '10' };
/** The value a switch turned on brings, when the one there would do nothing. */
function seedOn(key: FieldKey, current: string): Partial<Fields> {
  if ((parseInt(current, 10) || 0) >= (SEED_FLOOR[key] ?? 0)) return {};
  useClickerUi.setState(s => ({ seeds: { ...s.seeds, [key]: current } }));
  return { [key]: SEED[key] } as Partial<Fields>;
}
/** The value the seed replaced, when the switch goes off with the seed untouched. */
function seedOff(key: FieldKey, current: string): Partial<Fields> {
  const prev = useClickerUi.getState().seeds[key];
  forgetSeed(key);
  return prev != null && current === SEED[key] ? ({ [key]: prev } as Partial<Fields>) : {};
}
const forgetSeed = (key: FieldKey) => useClickerUi.setState(s => ({ seeds: { ...s.seeds, [key]: undefined } }));

/** The spread goes off by other doors too (an area drawn, a point picked): its seed is put back there as well. */
function useUnseedSpread() {
  const clicker = useClicker();
  const on = useApp(a => a.settings.cursorClickUsePositionJitter);
  const was = useRef(on);
  useEffect(() => {
    const before = was.current;
    was.current = on;
    if (!before || on) return;
    const back = seedOff('cursorClickPositionJitter', fieldsNow().cursorClickPositionJitter);
    if (Object.keys(back).length) sendFields(back, sendOf(clicker));
  }, [on, clicker]);
}

// ── Presets ──

function Presets({ running }: { running: boolean }) {
  const presets = useApp(a => a.settings.cursorClickPresets) ?? [];
  const selected = useClickerUi(s => s.selected);
  const naming = useClickerUi(s => s.naming);
  const clicker = useClicker();
  const full = presets.length >= MAX_PRESETS;
  const choose = (p: ClickerPreset) => {
    useClickerUi.setState({ peek: false });
    if (running || sameName(p.name, selected)) return;
    flushSave(clicker);
    choosePreset(p.name, fieldsOf(p), clicker.applyPreset);
  };
  return (
    <aside className="ck-presets" aria-label={t('clicker.presets.title')}>
      <div className="ck-presets-head">
        <h2 className="ck-presets-title" data-glossary="">{t('clicker.presets.title')}</h2>
        <button
          type="button"
          className="insp-button ck-small"
          aria-expanded={naming}
          disabled={full || running}
          data-tip={full ? t('clicker.presets.full', { n: MAX_PRESETS }) : t('clicker.presets.newTip')}
          onClick={() => useClickerUi.setState(naming ? { naming: false, draftName: '' } : { naming: true })}
        >
          <Plus aria-hidden="true" />
          {t('common.actions.new')}
        </button>
      </div>
      {naming && <NewPreset presets={presets} />}
      <div className="ck-presets-list">
        {presets.map(p => {
          const current = sameName(p.name, selected);
          return (
            <button key={p.name} type="button" className="ck-preset" aria-current={current || undefined} disabled={running && !current} onClick={() => choose(p)}>
              <span className="ck-preset-name">{p.name}</span>
              <span className="ck-preset-line">{presetLine(fieldsOf(p))}</span>
            </button>
          );
        })}
        {presets.length === 0 && !naming && <p className="ck-presets-none">{t('clicker.presets.none')}</p>}
      </div>
      <p className="ck-presets-foot">
        {running ? t('clicker.presets.footRunning') : t('clicker.presets.foot')}
      </p>
    </aside>
  );
}

/** New: a name, then Enter. The preset takes the settings on the page and becomes the selected one. */
function NewPreset({ presets }: { presets: ClickerPreset[] }) {
  const clicker = useClicker();
  const name = useClickerUi(s => s.draftName);
  const setName = (text: string) => useClickerUi.setState({ draftName: text });
  const [error, setError] = useState('');
  const close = () => useClickerUi.setState({ naming: false, draftName: '' });
  const save = () => {
    const n = name.trim().slice(0, MAX_NAME);
    if (!n) { close(); return; }
    if (presets.some(p => sameName(p.name, n))) { setError(t('clicker.presets.taken')); return; }
    flushSave(clicker);
    clicker.savePreset(n);
    useClickerUi.setState({ selected: n, naming: false, draftName: '' });
  };
  return (
    <div className="ck-name-wrap">
      <input
        className="ck-name"
        aria-label={t('clicker.presets.name')}
        placeholder={t('clicker.presets.namePlaceholder')}
        maxLength={MAX_NAME}
        spellCheck={false}
        autoComplete="off"
        autoFocus
        value={name}
        onChange={(e) => { setName(e.target.value); setError(''); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }}
        // A stray click keeps what was typed; an empty field goes.
        onBlur={() => { if (!name.trim()) close(); }}
      />
      {error && <p className="ck-name-error" role="alert">{error}</p>}
    </div>
  );
}

// ── The run ──

function Head({ running }: { running: boolean }) {
  const fields = useFields();
  const selected = useClickerUi(s => s.selected);
  const renaming = useClickerUi(s => s.renaming);
  const peek = useClickerUi(s => s.peek);
  const startKey = useApp(a => a.settings.cursorClickStartHotkey);
  const pauseKey = useApp(a => a.settings.cursorClickPauseHotkey);
  const paused = useApp(a => a.pauseState.isPaused);
  const countdownS = useShell(s => Math.ceil(s.live.clickerStats.countdownMs / 1000));
  const startedAt = useShell(s => s.runClock.startedAt);
  const counting = countdownS > 0;
  const replay = useReplay();
  const clicker = useClicker();
  const { showToast } = useToast();
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const takes = takesSec(fields);
  // casca-110: the countdown of a start from the button, before the first click.
  const sub = running
    ? (paused ? t('clicker.head.paused')
      : counting ? t('clicker.head.starting', { n: countdownS })
      : t('clicker.head.clickingSince', { time: fmtHora(new Date(startedAt)) }))
    : selected
      ? (takes === null ? t('clicker.head.presetUntil') : t('clicker.head.presetTakes', { duration: takesWords(takes) }))
      : (takes === null ? t('clicker.head.noPresetUntil') : t('clicker.head.noPresetTakes', { duration: takesWords(takes) }));
  const remove = () => {
    if (!selected) return;
    const name = selected;
    // A step of the page's history too: Ctrl+Z brings it back, as the toast's Undo does.
    recordDelete(name);
    clicker.deletePreset(name);
    showToast(t('clicker.presets.deleted', { name }), {
      type: 'success',
      duration: 10000,
      action: { label: t('common.actions.undo'), onClick: () => undoDelete(name, sendOf(clicker), presetStepsOf(clicker)) },
    });
  };
  return (
    <header className="ck-head">
      <div className="ck-titles">
        {renaming && selected
          ? <RenameField name={selected} />
          : <h1 className="ck-title" data-glossary={selected ? undefined : ''}>{selected ?? t('common.pages.clicker')}</h1>}
        <p className="ck-sub">{sub}</p>
      </div>
      <div className="ck-head-end">
        <button type="button" className="insp-button ck-presets-toggle" data-glossary="" aria-expanded={peek} onClick={() => useClickerUi.setState({ peek: !peek })}>
          {t('clicker.presets.title')}
          <ChevronDown aria-hidden="true" />
        </button>
        <button type="button" className="ck-start" data-running={running || undefined} onClick={replay.toggle}>
          {running ? <span className="ck-stop-square" aria-hidden="true" /> : <Play aria-hidden="true" />}
          {running ? t('common.actions.stop') : t('clicker.head.start')}
          {startKey && <kbd className="ck-key">{keycaps(startKey)}</kbd>}
        </button>
        {/* The countdown pauses by the key only; paused, Resume takes it on (casca-111). */}
        <button type="button" className="insp-button ck-pause" disabled={!running || (counting && !paused)} onClick={paused ? replay.resume : clicker.pause}>
          {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
          {paused ? t('common.actions.resume') : t('common.actions.pause')}
          {pauseKey && <kbd className="ck-key">{keycaps(pauseKey)}</kbd>}
        </button>
        {running && !counting && <HeadProgress />}
        <button
          type="button"
          className="insp-icon-button"
          aria-label={t('clicker.presets.actions')}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          disabled={!selected}
          data-tip={selected ? undefined : t('clicker.presets.noneSelected')}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}
        >
          <Ellipsis aria-hidden="true" />
        </button>
      </div>
      {menu && (
        <Menu
          anchor={menu.anchor}
          label={t('clicker.presets.actions')}
          toggle={menu.button}
          onClose={() => setMenu(null)}
          entries={[
            { label: t('common.actions.renameEllipsis'), onSelect: () => useClickerUi.setState({ renaming: true }) },
            'separator',
            { label: t('common.actions.delete'), danger: true, onSelect: remove },
          ]}
        />
      )}
    </header>
  );
}

/** Rename…: the preset's name in place of the title. Enter or leaving it renames; Esc keeps the name. */
function RenameField({ name }: { name: string }) {
  const clicker = useClicker();
  const presets = useApp(a => a.settings.cursorClickPresets) ?? [];
  const [text, setText] = useState(name);
  const [error, setError] = useState('');
  // Esc or Enter ends it once: the blur of the field going away is not a second answer.
  const finished = useRef(false);
  const done = (save: boolean) => {
    if (finished.current) return;
    const n = text.trim().slice(0, MAX_NAME);
    if (save && n && n !== name) {
      if (presets.some(p => sameName(p.name, n) && !sameName(p.name, name))) { setError(t('clicker.presets.taken')); return; }
      clicker.renamePreset(name, n);
      useClickerUi.setState({ selected: n });
    }
    finished.current = true;
    useClickerUi.setState({ renaming: false });
  };
  return (
    <span className="ck-rename">
      <input
        className="ck-title-input"
        aria-label={t('clicker.presets.name')}
        maxLength={MAX_NAME}
        spellCheck={false}
        autoComplete="off"
        autoFocus
        value={text}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => { setText(e.target.value); setError(''); }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') { e.preventDefault(); done(true); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        }}
        onBlur={() => done(true)}
      />
      {error && <span className="ck-name-error" role="alert">{error}</span>}
    </span>
  );
}

/** In the header while it clicks: "412 of 1,000 · ~0:29 left", over a thin bar (paineis-144). Only with a limit. */
function HeadProgress() {
  const fields = useFields();
  const count = useShell(s => s.live.clickerStats.count);
  const elapsed = useShell(s => s.live.clickerStats.elapsedMs);
  const p = progressOf(fields, count, elapsed);
  if (!p) return null;
  return (
    <div className="ck-progress" role="progressbar" aria-label={t('clicker.progress.label')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.pct * 100)}>
      <span className="ck-progress-text">
        <span>{p.text}</span>
        {p.leftSec !== null && <span className="ck-progress-left">{t('clicker.progress.left', { clock: clock(p.leftSec) })}</span>}
      </span>
      <span className="ck-bar"><span style={{ width: `${p.pct * 100}%` }} /></span>
    </div>
  );
}

function Center({ running }: { running: boolean }) {
  return running ? <Run /> : <Ready />;
}

/** Stopped: what a run will do, on the display it will do it on, and how the last one went. */
function Ready() {
  const fields = useFields();
  const c = clicksLimit(fields);
  const secs = timeLimitS(fields);
  const takes = takesSec(fields);
  return (
    <div className="ck-center">
      <div className="ck-ready">
        <span className="ck-ready-title">{t('clicker.readyTitle')}</span>
        <span className="ck-sentence">{sentence(fields)}</span>
      </div>
      <Figure />
      <div className="ck-cells">
        <Cell value={rateShort(rateOf(fields))} label={t('clicker.cells.rate')} />
        <Cell value={c ? grouped(c) : '∞'} label={t('clicker.cells.clicks')} off={!c} />
        <Cell value={secs ? clock(secs) : '∞'} label={t('clicker.cells.timeLimit')} off={!secs} />
        <Cell value={takes === null ? '—' : `~${clock(takes)}`} label={t('clicker.cells.takes')} off={takes === null} />
      </div>
      <HotkeyLine running={false} paused={false} />
      <LastRun />
    </div>
  );
}

/**
 * Clicking (the ClickerRunning board; paineis-140 to 144, 147 and 150): the count, or the seconds
 * of the countdown; the measured rate, the time, the limit and what is left; the settings in one
 * line; and the window that runs as administrator, whose clicks Windows drops.
 */
function Run() {
  const fields = useFields();
  const stats = useShell(s => s.live.clickerStats);
  const paused = useApp(a => a.pauseState.isPaused);
  const clicker = useClicker();
  const counting = stats.countdownMs > 0;
  const rate = stats.elapsedMs > 0 ? (stats.count * 1000) / stats.elapsedMs : 0;
  const p = progressOf(fields, stats.count, stats.elapsedMs);
  const left = counting || !p || p.leftSec === null ? null : p.leftSec;
  const limit = limitText(fields);
  return (
    <div className="ck-center">
      <div className="ck-hero">
        <span className="ck-hero-n">{counting ? Math.ceil(stats.countdownMs / 1000) : grouped(stats.count)}</span>
        <span className="ck-hero-label">{counting ? t('clicker.run.startingIn') : paused ? t('clicker.run.clicksPaused') : t('clicker.run.clicks')}</span>
      </div>
      <div className="ck-cells">
        <Cell value={counting ? '—' : `${formatRate(rate)}/s`} label={t('clicker.cells.rate')} off={counting} />
        <Cell value={clock(stats.elapsedMs / 1000)} label={t('clicker.cells.elapsed')} />
        <Cell value={limit} label={t('clicker.cells.limit')} off={limit === '∞'} />
        <Cell value={left === null ? '—' : `~${clock(left)}`} label={t('clicker.cells.left')} off={left === null} />
      </div>
      {p && <span className="ck-bar ck-bar-wide"><span style={{ width: `${p.pct * 100}%` }} /></span>}
      <span className="ck-bits">{bits(fields)}</span>
      {stats.warning === 'elevatedTarget' && (
        <div className="ck-alert" role="alert">
          <TriangleAlert aria-hidden="true" />
          <div className="ck-alert-body">
            <span className="ck-alert-text">{t('clicker.run.elevated')}</span>
            <span><button type="button" className="insp-button ck-small" onClick={clicker.restartAsAdmin}>{t('clicker.run.restartAdmin')}</button></span>
          </div>
        </div>
      )}
      <HotkeyLine running paused={paused} />
    </div>
  );
}

function Cell({ value, label, off }: { value: string; label: string; off?: boolean }) {
  return (
    <div className="ck-cell" data-off={off || undefined}>
      <span className="ck-cell-value">{value}</span>
      <span className="ck-cell-label">{label}</span>
    </div>
  );
}

// Where the key goes in a clause of the catalog: a character no text has (the tips cut theirs the same way).
const KEY_MARK = '\uE000';
/** A clause with its key cap where the language puts it ("PgDn starts and stops"); the line's gap spaces them. */
function withKey(clause: string, key: string): ReactNode {
  const [before, after = ''] = clause.split(KEY_MARK);
  return <>{before.trim() || null}<kbd className="ck-key">{keycaps(key)}</kbd>{after.trim() || null}</>;
}

/**
 * "PgDn starts and stops · PgUp pauses · both only while this page is open" (paineis-149, nativo-110
 * and 111). With one key only, the button above stands in for the other.
 */
function HotkeyLine({ running, paused }: { running: boolean; paused: boolean }) {
  const startKey = useApp(a => a.settings.cursorClickStartHotkey);
  const pauseKey = useApp(a => a.settings.cursorClickPauseHotkey);
  if (!startKey && !pauseKey) return <p className="ck-keys">{t('clicker.keys.none')}</p>;
  return (
    <p className="ck-keys">
      {startKey
        ? withKey(running ? t('clicker.keys.stops', { key: KEY_MARK }) : t('clicker.keys.startsStops', { key: KEY_MARK }), startKey)
        : running ? t('clicker.keys.stopAbove') : t('clicker.keys.startAbove')}
      <span className="ck-dot" aria-hidden="true">·</span>
      {pauseKey
        ? withKey(paused ? t('clicker.keys.resumes', { key: KEY_MARK }) : t('clicker.keys.pauses', { key: KEY_MARK }), pauseKey)
        : paused ? t('clicker.keys.resumeAbove') : t('clicker.keys.pauseAbove')}
      {!running && <><span className="ck-dot" aria-hidden="true">·</span>{startKey && pauseKey ? t('clicker.keys.bothWhileOpen') : t('clicker.keys.whileOpen')}</>}
    </p>
  );
}

/**
 * "Last run 14:10 · 1,000 clicks in 0:51 · limit reached" (paineis-142), and the clicks Windows
 * refused because another app blocked the input (paineis-146). A run stopped in its countdown, with
 * nothing clicked and nothing refused, leaves no line.
 */
function LastRun() {
  const stats = useShell(s => s.live.clickerStats);
  const endedAt = useClickerUi(s => s.endedAt);
  if (stats.count === 0 && stats.blocked === 0) return null;
  const reason = stats.endReason;
  const Icon = reason === 'stopped' ? Square : reason === 'error' ? TriangleAlert : Check;
  const ran = { count: stats.count, n: grouped(stats.count), clock: clock(stats.elapsedMs / 1000), end: endWords(reason) };
  return (
    <p className="ck-last">
      <Icon aria-hidden="true" />
      <span>
        {endedAt
          ? t('clicker.lastRun.at', { count: ran.count, n: ran.n, time: fmtHora(new Date(endedAt)), clock: ran.clock, end: ran.end })
          : t('clicker.lastRun.noTime', { count: ran.count, n: ran.n, clock: ran.clock, end: ran.end })}
        {stats.blocked > 0 && (
          <span className="ck-last-warn">{` · ${t('clicker.lastRun.blocked', { count: stats.blocked, n: grouped(stats.blocked) })}`}</span>
        )}
      </span>
    </p>
  );
}

// The points a run might click, drawn inside the area: fixed, the drawing is a picture, not a forecast.
const DOTS: [number, number, number][] = [[0.3, 0.3, 1], [0.66, 0.6, 0.6], [0.14, 0.74, 0.4]];

/**
 * The display the area or the point is on, with it drawn to scale (the Clicker board: "Display 1 ·
 * 1920 × 1080 · area at 760, 390"). In cursor mode there is nothing to draw.
 */
function Figure() {
  const fields = useFields();
  const displays = useClickerUi(s => s.displays);
  const on = displayOf(displays, fields);
  if (!on) return null;
  const { display: d, n } = on;
  const area = whereOf(fields) === 'area' ? fields.cursorClickArea : null;
  const point = area ? null : fields.cursorClickFixedPoint;
  // 25 × 14 rem at most, in the display's own proportions (narrower with the page, never taller).
  const size = { width: d.w / d.h >= 25 / 14 ? '25rem' : `${(14 * d.w) / d.h}rem`, aspectRatio: `${d.w} / ${d.h}` };
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <figure className="ck-figure">
      <div className="ck-display" role="img" style={size}
        aria-label={area ? t('clicker.display.areaLabel', { n }) : t('clicker.display.pointLabel', { n })}>
        <span className="ck-taskbar" />
        {area && (
          <span className="ck-area" data-label-in={(area.y - d.y) / d.h < 0.12 || undefined}
            style={{ left: pct(area.x - d.x, d.w), top: pct(area.y - d.y, d.h), width: pct(area.w, d.w), height: pct(area.h, d.h) }}>
            <span className="ck-area-label">{area.w} × {area.h}</span>
            {DOTS.map(([x, y, o]) => <span key={x} className="ck-area-dot" style={{ left: pct(x, 1), top: pct(y, 1), opacity: o }} />)}
          </span>
        )}
        {point && <span className="ck-point" style={{ left: pct(point.x - d.x, d.w), top: pct(point.y - d.y, d.h) }} />}
      </div>
      <figcaption className="ck-figure-caption">
        {area ? t('clicker.display.area', { n, w: d.w, h: d.h, x: area.x, y: area.y })
          : point ? t('clicker.display.point', { n, w: d.w, h: d.h, x: point.x, y: point.y }) : null}
      </figcaption>
    </figure>
  );
}

// ── Clicker settings ──

function Settings({ running }: { running: boolean }) {
  const selected = useClickerUi(s => s.selected);
  return (
    <aside className="ck-settings" aria-label={t('clicker.settings.title')}>
      <div className="ck-settings-head">
        <span className="ck-settings-icon" aria-hidden="true"><MousePointerClick /></span>
        <div className="ck-settings-titles">
          <span className="ck-settings-title">{t('clicker.settings.title')}</span>
          <span className="ck-settings-sub">{selected ? t('clicker.settings.savedIn', { name: selected }) : t('clicker.settings.notInPreset')}</span>
        </div>
      </div>
      {running && <p className="ck-readonly"><Lock aria-hidden="true" />{t('clicker.settings.readOnly')}</p>}
      <fieldset className="ck-settings-body" disabled={running}>
        <ClickSection />
        <WhereSection />
        <StopSection />
        <TuningSection />
        <HotkeysSection />
      </fieldset>
      <div className="ck-settings-foot">{t('clicker.settings.foot')}</div>
    </aside>
  );
}

/** The page's change: one undo step, sent at once. */
function useCommit() {
  const clicker = useClicker();
  return (patch: Partial<Fields>, control?: string) => commitFields(patch, sendOf(clicker), control);
}

/** A section of the settings. `glossary`: its title is a name of the glossary, the same in every language. */
function Sec({ title, glossary, children }: { title: string; glossary?: boolean; children: ReactNode }) {
  return (
    <section className="ck-sec" aria-label={title}>
      <h2 className="ck-sec-title" data-glossary={glossary ? '' : undefined}>{title}</h2>
      {children}
    </section>
  );
}

/** A setting with its switch, its name and its value (a limit, a jitter, the gap). */
function Row({ label, toggle, children, off }: { label: string; toggle?: ReactNode; children?: ReactNode; off?: boolean }) {
  return (
    <div className="ck-row" data-off={off || undefined}>
      <span className="ck-row-switch">{toggle}</span>
      <span className="ck-row-label">{label}</span>
      {children && <span className="ck-row-field">{children}</span>}
    </div>
  );
}

function ClickSection() {
  const fields = useFields();
  const unit = useClickerUi(s => s.unit);
  const clampedAt = useClickerUi(s => s.clampedAt);
  const commit = useCommit();
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const commitRate = (raw: string) => {
    const r = delayFor(raw, unit, fieldsNow());
    if (!r) return;
    useClickerUi.setState({ clampedAt: r.clamped ? r.ms : null });
    commit({ cursorClickDelay: String(r.ms) });
  };
  const note = rateNote(fields, clampedAt);
  const buttons = tn('clicker.buttons');
  return (
    <Sec title={t('clicker.click.title')}>
      <span className="ck-label">{t('clicker.click.button')}</span>
      <Segmented
        label={t('clicker.click.button')}
        value={fields.cursorClickButton}
        options={BUTTONS.map(b => ({ value: b, label: buttons[b] }))}
        onChange={(b) => commit({ cursorClickButton: b })}
      />
      <span className="ck-label">{t('clicker.click.rate')}</span>
      <div className="ck-rate">
        <span className="ck-rate-field">
          <DraftField stepId="clicker" field={`rate-${unit}`} label={t('clicker.click.rate')} kind="mono" stored={rateShown(fields, unit)}
            parse={(text) => (delayFor(text, unit, fieldsNow()) ? text : null)} onApply={commitRate} />
          <button type="button" className="insp-icon-button ck-rate-menu" aria-label={t('clicker.click.chooseRate')} aria-haspopup="menu" aria-expanded={!!menu}
            onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
            <ChevronDown aria-hidden="true" />
          </button>
        </span>
        <Segmented<'cps' | 'ms'>
          label={t('clicker.click.unit')}
          value={unit}
          options={[{ value: 'cps', label: '/s' }, { value: 'ms', label: 'ms' }]}
          onChange={(u) => useClickerUi.setState({ unit: u })}
        />
      </div>
      {menu && (
        <Menu anchor={menu.anchor} label={t('clicker.click.rates')} toggle={menu.button} onClose={() => setMenu(null)}
          entries={quickRates(fields, unit).map(o => ({ label: o.label, checked: o.value === rateShown(fields, unit), onSelect: () => commitRate(o.value) }))} />
      )}
      <p className="ck-hint">{rateLine(fields)}</p>
      {note && <p className="ck-hint" data-tone="warn">{note}</p>}
    </Sec>
  );
}

// What the capture bar says the Clicker's pickers are for: the selected preset, when there is one.
const captureFor = () => {
  const preset = useClickerUi.getState().selected;
  return preset ? t('clicker.where.captureForPreset', { name: preset }) : t('clicker.where.captureFor');
};

function WhereSection() {
  const fields = useFields();
  const clicker = useClicker();
  const commit = useCommit();
  const where = whereOf(fields);
  const area = fields.cursorClickArea;
  const point = fields.cursorClickFixedPoint;
  const spreadOn = fields.cursorClickUsePositionJitter;
  const choose = (w: Where) => {
    if (w === 'cursor') commit({ cursorClickUseArea: false, cursorClickUseFixed: false });
    // No box yet: the box is drawn first, and the engine arms Area when it lands (Esc leaves all as it was).
    else if (w === 'area' && !area) clicker.pickAreaFor(captureFor());
    else {
      // The spread goes off with it, and a value it seeded goes back.
      const back = spreadOn ? seedOff('cursorClickPositionJitter', fields.cursorClickPositionJitter) : {};
      commit({ ...back, cursorClickUseArea: w === 'area', cursorClickUseFixed: w === 'fixed', cursorClickUsePositionJitter: false });
    }
  };
  const toggleSpread = (on: boolean) => commit(on
    ? { ...seedOn('cursorClickPositionJitter', fields.cursorClickPositionJitter), cursorClickUsePositionJitter: true, cursorClickUseArea: false, cursorClickUseFixed: false }
    : { ...seedOff('cursorClickPositionJitter', fields.cursorClickPositionJitter), cursorClickUsePositionJitter: false });
  const places = tn('clicker.where.options');
  return (
    <Sec title={t('clicker.where.title')}>
      <Segmented<Where>
        label={t('clicker.where.title')}
        value={where}
        options={[{ value: 'cursor', label: places.cursor }, { value: 'area', label: places.area }, { value: 'fixed', label: places.fixed }]}
        onChange={choose}
      />
      {where === 'cursor' && (
        <>
          <Row label={t('clicker.where.spread')} off={!spreadOn} toggle={<Switch label={t('clicker.where.spreadSwitch')} checked={spreadOn} onChange={toggleSpread} />}>
            <DraftField stepId="clicker" field="spread" label={t('clicker.where.spread')} kind="int" min={0} max={MAX_SPREAD_PX} prefix="±" unit="px" stored={fields.cursorClickPositionJitter}
              onApply={(v) => { forgetSeed('cursorClickPositionJitter'); commit({ cursorClickPositionJitter: v, ...(spreadOn ? {} : { cursorClickUsePositionJitter: true }) }); }} />
          </Row>
          <p className="ck-hint">{spreadOn && spreadPx(fields) > 0 ? t('clicker.where.spreadHint', { px: spreadPx(fields) }) : t('clicker.where.atCursor')}</p>
        </>
      )}
      {where === 'area' && area && (
        <>
          <div className="ck-card">
            <span className="ck-card-text">
              <span className="ck-card-value">{area.w} × {area.h}</span>
              <span className="ck-card-sub">{t('clicker.where.at', { x: area.x, y: area.y })}</span>
            </span>
            <button type="button" className="insp-button ck-small" onClick={() => clicker.pickAreaFor(captureFor())}><Crop aria-hidden="true" />{t('clicker.where.redraw')}</button>
            <button type="button" className="insp-icon-button ck-clear" aria-label={t('clicker.where.clearArea')} onClick={() => commit({ cursorClickUseArea: false, cursorClickArea: null })}><X aria-hidden="true" /></button>
          </div>
          <p className="ck-hint">{t('clicker.where.areaHint')}</p>
        </>
      )}
      {where === 'fixed' && (
        <>
          <div className="ck-card">
            <span className="ck-card-text">
              <span className="ck-card-value">{point ? `${point.x}, ${point.y}` : t('clicker.where.atStart')}</span>
              <span className="ck-card-sub">{point ? t('clicker.where.onPoint') : t('clicker.where.whereStarts')}</span>
            </span>
            <button type="button" className="insp-button ck-small" onClick={() => clicker.pickPointFor(captureFor())}><Crosshair aria-hidden="true" />{point ? t('clicker.where.pickAgain') : t('clicker.where.pickPoint')}</button>
            {point && <button type="button" className="insp-icon-button ck-clear" aria-label={t('clicker.where.clearPoint')} onClick={() => commit({ cursorClickFixedPoint: null })}><X aria-hidden="true" /></button>}
          </div>
          <p className="ck-hint">{t('clicker.where.pointHint')}</p>
        </>
      )}
    </Sec>
  );
}

function StopSection() {
  const fields = useFields();
  const commit = useCommit();
  const loopsOn = fields.cursorClickUseLoops;
  const timeOn = fields.cursorClickUseMaxDuration;
  const seconds = String(Math.max(1, Math.round((parseInt(fields.cursorClickMaxDuration, 10) || 60000) / 1000)));
  return (
    <Sec title={t('clicker.stop.title')}>
      <Row label={t('clicker.stop.clicks')} off={!loopsOn} toggle={<Switch label={t('clicker.stop.clicksSwitch')} checked={loopsOn}
        onChange={(on) => commit({ ...(on ? seedOn('cursorClickLoops', fields.cursorClickLoops) : seedOff('cursorClickLoops', fields.cursorClickLoops)), cursorClickUseLoops: on })} />}>
        <DraftField stepId="clicker" field="loops" label={t('clicker.stop.clicksField')} kind="int" min={1} max={MAX_CLICKS} stored={fields.cursorClickLoops}
          onApply={(v) => { forgetSeed('cursorClickLoops'); commit({ cursorClickLoops: v, ...(loopsOn ? {} : { cursorClickUseLoops: true }) }); }} />
      </Row>
      <Row label={t('clicker.stop.time')} off={!timeOn} toggle={<Switch label={t('clicker.stop.timeSwitch')} checked={timeOn} onChange={(on) => commit({ cursorClickUseMaxDuration: on })} />}>
        <DraftField stepId="clicker" field="time" label={t('clicker.stop.timeField')} kind="int" min={1} max={MAX_TIME_S} unit="s" stored={seconds}
          onApply={(v) => commit({ cursorClickMaxDuration: String((parseInt(v, 10) || 60) * 1000), ...(timeOn ? {} : { cursorClickUseMaxDuration: true }) })} />
      </Row>
      <p className="ck-hint">{t('clicker.stop.hint')}</p>
    </Sec>
  );
}

function TuningSection() {
  const fields = useFields();
  const commit = useCommit();
  const jitterOn = fields.cursorClickUseJitter;
  const gapOn = fields.cursorClickUseInterval;
  const game = fields.cursorClickGameMove;
  // Game move walks the cursor to the point; at the cursor itself there is nowhere to walk.
  const noWalk = game && whereOf(fields) === 'cursor' && spreadPx(fields) === 0;
  return (
    <Sec title={t('clicker.tuning.title')}>
      <Row label={t('clicker.tuning.jitter')} off={!jitterOn} toggle={<Switch label={t('clicker.tuning.jitterSwitch')} checked={jitterOn}
        onChange={(on) => commit({ ...(on ? seedOn('cursorClickDelayJitter', fields.cursorClickDelayJitter) : seedOff('cursorClickDelayJitter', fields.cursorClickDelayJitter)), cursorClickUseJitter: on })} />}>
        <DraftField stepId="clicker" field="jitter" label={t('clicker.tuning.jitter')} kind="int" min={0} max={100} unit="%" stored={fields.cursorClickDelayJitter}
          onApply={(v) => { forgetSeed('cursorClickDelayJitter'); commit({ cursorClickDelayJitter: v, ...(jitterOn ? {} : { cursorClickUseJitter: true }) }); }} />
      </Row>
      <Row label={t('clicker.tuning.hold')}>
        <DraftField stepId="clicker" field="hold" label={t('clicker.tuning.hold')} kind="int" min={0} max={2000} unit="ms" stored={fields.cursorClickHold}
          onApply={(v) => commit({ cursorClickHold: v })} />
      </Row>
      <Row label={t('clicker.tuning.gap')} off={!gapOn} toggle={<Switch label={t('clicker.tuning.gap')} checked={gapOn} onChange={(on) => commit({ cursorClickUseInterval: on })} />}>
        <DraftField stepId="clicker" field="gap" label={t('clicker.tuning.gap')} kind="int" min={0} max={60000} unit="ms" stored={fields.cursorClickInterval}
          onApply={(v) => commit({ cursorClickInterval: v, ...(gapOn ? {} : { cursorClickUseInterval: true }) })} />
      </Row>
      <Row label={t('clicker.tuning.gameMove')} toggle={<Switch label={t('clicker.tuning.gameMove')} checked={game} onChange={(on) => commit({ cursorClickGameMove: on })} />} />
      <p className="ck-hint">{t('clicker.tuning.gameMoveHint')}</p>
      {noWalk && <p className="ck-hint" data-tone="warn">{t('clicker.tuning.noWalk')}</p>}
    </Sec>
  );
}

function HotkeysSection() {
  return (
    <Sec title={t('clicker.hotkeys.title')} glossary>
      <div className="ck-hotkey">
        <span className="ck-row-label">{t('clicker.hotkeys.startStop')}</span>
        <HotkeyField settingKey="cursorClickStartHotkey" label={t('clicker.hotkeys.startStop')} />
      </div>
      <ConflictNote settingKey="cursorClickStartHotkey" />
      <div className="ck-hotkey">
        <span className="ck-row-label">{t('common.actions.pause')}</span>
        <HotkeyField settingKey="cursorClickPauseHotkey" label={t('common.actions.pause')} />
      </div>
      <ConflictNote settingKey="cursorClickPauseHotkey" />
    </Sec>
  );
}
