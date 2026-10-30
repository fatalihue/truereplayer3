import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { Check, ChevronRight, Clock, Ellipsis, Play, Plus, ScanText, Search, Timer, TriangleAlert, X, Zap } from 'lucide-react';
import type { AutomationEntry, TriggerConfig } from '../../../bridge/messageTypes';
import { useBridge } from '../../../bridge/BridgeContext';
import { useAutomationRefresh, useAutomations } from '../../../logic/useAutomations';
import { useMacro } from '../../../logic/useMacro';
import { useTt } from '../../../state/LanguageContext';
import { useToast } from '../../../state/ToastContext';
import { clockSeconds, phaseLockRisk, rangeParts } from '../../../utils/activeHours';
import { isModalDialogOpen } from '../../../utils/modalDialog';
import { DraftField, Segmented, Switch } from '../../inspector/fields';
import { MacroPicker } from '../../inspector/MacroPicker';
import { selection } from '../../list/selection';
import { Menu } from '../../Menu';
import { anchorBelow, type MenuAnchor } from '../../menuAnchor';
import { NotBuilt } from '../../NotBuilt';
import { Popover } from '../../Popover';
import { useApp, useShell } from '../../store';
import { openMacroSettings, openPage, useUi } from '../../ui';
import {
  conditionWords, defaultCooldown, defaultPollMs, defaultTrigger, secondsText, STARTS, statusOf, triggerText, triggerWords,
  UNIT_SECONDS, unitOf, WEEK, whenText, whyCannotFire, type Status, type Unit,
} from './automationModel';
import {
  closePanel, commit, openAutomation, reconcile, setRunAutomations, stepHistory, triggerNow, useAutomationsUi, useEntries,
  useRunAutomations, type Cmds, type Filter,
} from './automationsStore';
import '../../inspector/editors.css';
import '../../inspector/windowEditors.css';
import './automations.css';

/**
 * ② Automations (phase 3, slice 8; the concept's Automations board): each macro's automation in a
 * table — its On, its trigger, its status, when it last fired and how many times — with the filters,
 * and "Automation settings" beside it, which applies as you type. Run automations is the switch of
 * them all; New automation asks for the macro first (one automation per macro, as the engine keeps
 * them). Ctrl+Z and Ctrl+Y undo and redo the page's changes. The conditions (When…) are slice 9's.
 * Today's components/AutomationPanel is the reference.
 */
export default function AutomationsPage() {
  // The next fire time and the counters move without a change to push them: asked every 2 s.
  useAutomationRefresh();
  const cmds = useAutomations();
  const cmdsRef = useRef(cmds);
  useEffect(() => { cmdsRef.current = cmds; });
  const entries = useEntries();
  const open = useAutomationsUi(s => s.open);
  const entry = open ? entries.find(e => e.profile === open) ?? null : null;
  const [pick, setPick] = useState<Pick | null>(null);

  // What the engine says, as it comes: what was sent stops covering it once the engine says the same.
  const engine = useApp(a => a.automation);
  useEffect(() => { reconcile(engine); }, [engine]);
  // An automation the panel held that is gone (deleted, an undo, its macro renamed): the panel goes too.
  useEffect(() => { if (open && !entry) closePanel(); }, [open, entry]);

  // Asked from outside the page: New automation (Ctrl+K), or one macro's (the Inspector).
  const ask = useUi(s => s.automationAsk);
  useEffect(() => {
    if (!ask) return;
    useUi.setState({ automationAsk: null });
    if (ask.kind === 'new') {
      // A frame later: the page may have just come, and the picker drops from where its button is laid out.
      requestAnimationFrame(() => {
        const button = document.querySelector<HTMLButtonElement>('.am-new');
        if (button && !button.disabled) setPick({ patch: {}, anchor: anchorBelow(button, 'end'), button });
      });
    } else if (triggerNow(ask.name)) {
      openAutomation(ask.name);
      requestAnimationFrame(() => document.querySelector('.am-table tr[data-open]')?.scrollIntoView({ block: 'nearest' }));
    } else if (ask.kind === 'create') {
      create(ask.name, {}, cmdsRef.current);
    }
  }, [ask]);

  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z), while the page is on screen; a text field keeps its own.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || t.tagName === 'TEXTAREA'
        || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)));
      if (typing || isModalDialogOpen()) return;
      e.preventDefault();
      const profiles = useShell.getState().app.profiles;
      const changed = stepHistory(key === 'z' && !e.shiftKey, cmdsRef.current, (name) => profiles.some(p => p.name === name));
      // With the panel open, it shows the automation the step changed (or goes, with it).
      const { open: now } = useAutomationsUi.getState();
      if (!changed || !now) return;
      if (triggerNow(changed)) openAutomation(changed);
      else if (now === changed) closePanel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const startPick = (patch: Partial<TriggerConfig>, button: HTMLElement) =>
    setPick(pick?.button === button ? null : { patch, anchor: anchorBelow(button, button.classList.contains('am-new') ? 'end' : 'start'), button });

  return (
    <section className="shell-page am" aria-label="Automations" data-panel={entry ? '' : undefined}>
      <div className="am-main">
        <Head onNew={(button) => startPick({}, button)} />
        {entries.length > 0
          ? (
            <>
              <Bar entries={entries} />
              <Table entries={entries} open={entry?.profile ?? null} />
            </>
          )
          : <Empty onStart={startPick} />}
      </div>
      {entry && <Panel key={entry.profile} entry={entry} />}
      {pick && (
        <PickMacro
          at={pick}
          onClose={() => setPick(null)}
          onPick={(name) => {
            setPick(null);
            create(name, pick.patch, cmdsRef.current);
          }}
        />
      )}
    </section>
  );
}

interface Pick { patch: Partial<TriggerConfig>; anchor: MenuAnchor; button: HTMLElement }

/** A macro's automation made (off, every 5 minutes, or as the start chosen) and opened in the panel. */
function create(name: string, patch: Partial<TriggerConfig>, cmds: Cmds) {
  if (!triggerNow(name)) commit(name, { ...defaultTrigger(), ...patch, armed: false }, cmds);
  openAutomation(name);
  // The panel takes the focus at its first choice, ready to set the automation up.
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>('.am-panel .am-runs .insp-seg button[aria-pressed="true"]')?.focus();
    document.querySelector('.am-table tr[data-open]')?.scrollIntoView({ block: 'nearest' });
  });
}

/** The macros that have no automation yet, in the library's list of them. */
function useMacrosLeft(): string[] {
  const profiles = useApp(a => a.profiles);
  const entries = useEntries();
  return profiles.filter(p => !entries.some(e => e.profile === p.name)).map(p => p.name);
}

function Head({ onNew }: { onNew: (button: HTMLButtonElement) => void }) {
  const tt = useTt();
  const cmds = useAutomations();
  const on = useRunAutomations();
  const left = useMacrosLeft();
  const none = useApp(a => a.profiles.length === 0);
  return (
    <header className="am-head">
      <div className="am-titles">
        <h1 className="am-title">Automations</h1>
        <p className="am-sub">Each one runs a macro by itself: every so often, at a set time, or when something shows up</p>
      </div>
      <div className="am-head-end">
        <span className="am-run">
          Run automations
          <Switch
            label="Run automations"
            checked={on}
            tip={on
              ? tt('The automations that are on run their macros when their trigger comes. Off holds them all.', 'As automações ligadas rodam seus macros quando o gatilho chega. Desligado, todas esperam.')
              : tt('Off: no automation runs, on or not.', 'Desligado: nenhuma automação roda, ligada ou não.')}
            onChange={(v) => setRunAutomations(v, cmds)}
          />
        </span>
        <span className="am-sep" aria-hidden="true" />
        <button
          type="button"
          className="insp-button am-new"
          data-variant="primary"
          aria-haspopup="dialog"
          disabled={left.length === 0}
          data-tip={left.length > 0 ? undefined
            : none ? tt('Create a macro first', 'Crie um macro antes')
            : tt('Every macro has its automation: one per macro', 'Todo macro já tem a sua automação: uma por macro')}
          onClick={(e) => onNew(e.currentTarget)}
        >
          <Plus aria-hidden="true" />
          New automation
        </button>
      </div>
    </header>
  );
}

/** "Pick the macro it runs": the macros with no automation, by a search (↑ ↓ and Enter, Esc closes). */
function PickMacro({ at, onPick, onClose }: { at: Pick; onPick: (name: string) => void; onClose: () => void }) {
  const names = useMacrosLeft();
  return (
    <Popover anchor={at.anchor} label="Pick the macro it runs" toggle={at.button} focusFirst onClose={onClose}>
      <div className="am-pick">
        <span className="am-pick-title">Pick the macro it runs</span>
        <MacroPicker names={names} value={null} autoFocus label="Macros without an automation" onPick={onPick} />
      </div>
    </Popover>
  );
}

// ── None yet (the EmptyStates board) ──

const START_ICONS = { timer: Timer, clock: Clock, text: ScanText };

function Empty({ onStart }: { onStart: (patch: Partial<TriggerConfig>, button: HTMLElement) => void }) {
  const tt = useTt();
  const left = useMacrosLeft();
  return (
    <div className="am-empty">
      <span className="am-empty-icon" aria-hidden="true"><Zap /></span>
      <span className="am-empty-title">No automations yet</span>
      <span className="am-empty-text">An automation runs a macro by itself — on a timer, at a set time, or when something shows on screen.</span>
      <span className="am-empty-from">Start from</span>
      <div className="am-empty-list">
        {STARTS.map(s => {
          const Icon = START_ICONS[s.icon];
          return (
            <button
              key={s.label}
              type="button"
              className="am-start"
              aria-haspopup="dialog"
              disabled={left.length === 0}
              data-tip={left.length === 0 ? tt('Create a macro first', 'Crie um macro antes') : undefined}
              onClick={(e) => onStart(s.patch, e.currentTarget)}
            >
              <Icon className="am-start-icon" aria-hidden="true" />
              <span className="am-start-label">{s.label}</span>
              <ChevronRight className="am-start-go" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── The list ──

const FILTERS: { f: Filter; label: string }[] = [
  { f: 'all', label: 'All' },
  { f: 'armed', label: 'Armed' },
  { f: 'off', label: 'Off' },
  { f: 'attention', label: 'Needs attention' },
];
/** The filter in effect: the one chosen, or All once nothing is left in it. */
function useShownFilter(entries: AutomationEntry[], on: boolean): Filter {
  const filter = useAutomationsUi(s => s.filter);
  return filter === 'all' || entries.some(e => statusOf(e, on).group === filter) ? filter : 'all';
}

/** The filters with their counts (a filter with nothing in it stays out), and the search. */
function Bar({ entries }: { entries: AutomationEntry[] }) {
  const on = useRunAutomations();
  const filter = useShownFilter(entries, on);
  // A filter left empty is All from then on, not again when something lands in it once more.
  const chosen = useAutomationsUi(s => s.filter);
  useEffect(() => { if (filter !== chosen) useAutomationsUi.setState({ filter }); }, [filter, chosen]);
  const query = useAutomationsUi(s => s.query);
  const counts: Record<Filter, number> = { all: entries.length, armed: 0, off: 0, attention: 0 };
  for (const e of entries) counts[statusOf(e, on).group]++;
  return (
    <div className="am-bar">
      <div className="am-chips" role="group" aria-label="Filter by status">
        {FILTERS.filter(c => c.f === 'all' || counts[c.f] > 0).map(({ f, label }) => (
          <button key={f} type="button" className="am-chip" data-tone={f === 'attention' ? 'warn' : undefined} aria-pressed={filter === f}
            onClick={() => useAutomationsUi.setState({ filter: f })}>
            {label}{' '}<span className="am-chip-n">{counts[f]}</span>
          </button>
        ))}
      </div>
      <span className="am-spacer" />
      <label className="am-search">
        <Search aria-hidden="true" />
        <input
          type="text"
          aria-label="Filter automations"
          placeholder="Filter by macro or trigger"
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => useAutomationsUi.setState({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || !query) return;
            e.preventDefault();
            useAutomationsUi.setState({ query: '' });
          }}
        />
      </label>
    </div>
  );
}

function Table({ entries, open }: { entries: AutomationEntry[]; open: string | null }) {
  const on = useRunAutomations();
  const filter = useShownFilter(entries, on);
  const query = useAutomationsUi(s => s.query).trim();
  const q = query.toLowerCase();
  const rows = entries.filter(e => (filter === 'all' || statusOf(e, on).group === filter)
    && (!q || e.profile.toLowerCase().includes(q) || triggerText(e.trigger).toLowerCase().includes(q)));
  return (
    <div className="am-scroll">
      <table className="am-table">
        <colgroup>
          <col className="am-col-on" />
          <col className="am-col-macro" />
          <col />
          <col className="am-col-status" />
          <col className="am-col-when" />
          <col className="am-col-fires" />
        </colgroup>
        <thead>
          <tr>
            <th className="am-c">On</th>
            <th>Macro</th>
            <th>Trigger</th>
            <th>Status</th>
            <th>Last fired</th>
            <th className="am-n">Fires</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(e => <Row key={e.profile} entry={e} here={e.profile === open} on={on} />)}
        </tbody>
      </table>
      {rows.length === 0 && <p className="am-none" role="status">{query ? `No automation matches “${query}”.` : 'No automations in this filter.'}</p>}
      <p className="am-note">Hotkeys and hotstrings are not automations: they live on each macro, in its settings.</p>
    </div>
  );
}

/**
 * One automation's row. A row of its own, so a change to one automation draws that row alone: the
 * others keep their entry while only what was sent covers it.
 */
function Row({ entry: e, here, on }: { entry: AutomationEntry; here: boolean; on: boolean }) {
  const tt = useTt();
  const cmds = useAutomations();
  // A disabled macro's automation can be turned off, not on (the engine never runs it).
  const blocked = e.isDisabled && !e.trigger.armed;
  return (
    <tr data-open={here || undefined} data-off={!e.trigger.armed || undefined}
      onClick={(ev) => { if (!(ev.target as HTMLElement).closest('button')) openAutomation(e.profile); }}>
      <td className="am-c">
        <Switch
          label={`${e.profile} automation`}
          checked={e.trigger.armed}
          disabled={blocked}
          tip={blocked ? tt('The macro is disabled — enable it in the library first', 'O macro está desativado — reative na biblioteca antes') : undefined}
          onChange={(v) => { const now = triggerNow(e.profile); if (now) commit(e.profile, { ...now, armed: v }, cmds); }}
        />
      </td>
      <td>
        <button type="button" className="am-edit" aria-current={here || undefined} aria-label={`Edit the automation of ${e.profile}`} onClick={() => openAutomation(e.profile)}>
          {e.profile}
        </button>
      </td>
      <td className="am-trigger"><TriggerCell t={e.trigger} /></td>
      <td><StatusCell status={statusOf(e, on)} /></td>
      <td className="am-mono am-when">{whenText(e.lastFiredAt)}</td>
      <td className="am-mono am-n">{e.fireCount}</td>
    </tr>
  );
}

function TriggerCell({ t }: { t: TriggerConfig }) {
  const w = triggerWords(t);
  return (
    <span className="am-trig" data-tip={triggerText(t)} data-tip-reveal>
      <span className="am-lead">{w.lead}</span>{' '}{w.main}
      {w.quote && <>{' '}<span className="am-quote">“{w.quote}”</span></>}
      {w.tail && <span className="am-tail"> · {w.tail}</span>}
    </span>
  );
}

/** Why a status is what it is, in both languages; the engine's own reasons come as it says them. */
function statusTip(s: Status, tt: (en: string, pt: string) => string): string | undefined {
  switch (s.why) {
    case 'disabled': return tt('The macro is disabled, so its automation can’t run. Enable it in the library.', 'O macro está desativado, então a automação não roda. Reative na biblioteca.');
    case 'paused': return tt('Run automations is off: nothing runs until it is on.', 'Run automations está desligado: nada roda até ele ligar.');
    case 'true': return tt('Watching · the condition is true now', 'Vigiando · a condição está verdadeira agora');
    case 'false': return tt('Watching · the condition is false now', 'Vigiando · a condição está falsa agora');
    case 'never':
    case 'stopped': return s.detail;
    default: return undefined;
  }
}

function StatusCell({ status }: { status: Status }) {
  const tt = useTt();
  return (
    <span className="am-status" data-tone={status.tone} data-tip={statusTip(status, tt)}>
      {status.tone === 'warn' ? <TriangleAlert aria-hidden="true" /> : <span className="am-dot" aria-hidden="true" />}
      {status.text}
    </span>
  );
}

// ── Automation settings ──

type Patch = Partial<TriggerConfig> | ((now: TriggerConfig) => Partial<TriggerConfig>);
type Change = (patch: Patch, control?: string) => void;

/** Deletes an automation, with an Undo that brings it back (as it was, armed or not). */
function useRemove() {
  const cmds = useAutomations();
  const { showToast } = useToast();
  const tt = useTt();
  return (name: string) => {
    const was = triggerNow(name);
    if (!was) return;
    commit(name, null, cmds);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.am-new:not(:disabled)')?.focus());
    showToast(tt(`Deleted the automation of ${name}`, `Automação de ${name} apagada`), {
      type: 'success',
      duration: 10000,
      action: {
        label: 'Undo',
        onClick: () => {
          if (triggerNow(name) || !useShell.getState().app.profiles.some(p => p.name === name)) return;
          commit(name, was, cmds);
        },
      },
    });
  };
}

/**
 * The automation open: how it runs (every so often, at a time, or when something shows up), its
 * rhythm, and what it did. Each change applies at once — a typed number when the typing stops — and
 * the page's Ctrl+Z undoes it.
 */
function Panel({ entry }: { entry: AutomationEntry }) {
  const tt = useTt();
  const cmds = useAutomations();
  const macro = useMacro();
  const on = useRunAutomations();
  const { subscribe } = useBridge();
  const remove = useRemove();
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const [ran, setRan] = useState<{ ok: boolean; text: string } | null>(null);
  const fireRef = useRef<string | null>(null);
  const name = entry.profile;
  const t = entry.trigger;
  const status = statusOf(entry, on);

  // Run now's answer: the one asked here (a late one belongs to no other automation).
  useEffect(() => subscribe((m) => {
    if (m.type !== 'automation:testFireResult' || m.payload.requestId !== fireRef.current) return;
    fireRef.current = null;
    setRan({ ok: m.payload.fired, text: m.payload.detail });
  }), [subscribe]);

  // Read in the handler, not from the render: a change before the last one's echo builds on it.
  const change: Change = (patch, control) => {
    const now = triggerNow(name);
    if (!now) return;
    commit(name, { ...now, ...(typeof patch === 'function' ? patch(now) : patch) }, cmds, control);
  };
  const toggle = () => change(now => ({ armed: !now.armed }));
  const counted = entry.fireCount > 0 || entry.skippedBusy > 0 || entry.skippedDirty > 0 || entry.skippedModal > 0 || entry.skippedSuppressed > 0;
  const toMacro = (section?: 'target') => {
    if (useShell.getState().app.activeProfile !== name) macro.open(name);
    if (section) {
      selection.clear();
      openMacroSettings(name, section);
    }
    openPage('macros');
  };
  const close = () => {
    // The focus goes back to the automation's row, or to New automation (found now: the row loses its mark on close).
    const back = document.querySelector<HTMLElement>('.am-table .am-edit[aria-current="true"]') ?? document.querySelector<HTMLElement>('.am-new');
    closePanel();
    requestAnimationFrame(() => back?.focus());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented || (e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
    close();
  };

  return (
    <aside className="am-panel" aria-label="Automation settings" onKeyDown={onKeyDown}>
      <div className="am-panel-head">
        <span className="am-panel-icon" data-tone={status.tone} aria-hidden="true"><Zap /></span>
        <div className="am-panel-titles">
          <span className="am-panel-title">{name}</span>
          <span className="am-panel-sub">{t.armed ? 'Runs this macro' : 'Runs this macro · off'}</span>
        </div>
        <button
          type="button"
          className="insp-button am-run-now"
          disabled={entry.isDisabled}
          data-tip={entry.isDisabled
            ? tt('The macro is disabled — enable it in the library first', 'O macro está desativado — reative na biblioteca antes')
            : tt('Runs the macro once now, as the automation would', 'Roda o macro uma vez agora, como a automação faria')}
          onClick={() => { setRan(null); fireRef.current = cmds.testFire(name); }}
        >
          <Play aria-hidden="true" />
          Run now
        </button>
        <button type="button" className="insp-icon-button" aria-label="Automation actions" aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
          <Ellipsis aria-hidden="true" />
        </button>
        <button type="button" className="insp-icon-button" aria-label="Close automation settings" onClick={close}>
          <X aria-hidden="true" />
        </button>
      </div>
      {menu && (
        <Menu anchor={menu.anchor} label="Automation actions" toggle={menu.button} onClose={() => setMenu(null)}
          entries={[
            { label: 'Open macro', onSelect: () => toMacro() },
            { label: t.armed ? 'Turn off' : 'Turn on', disabled: entry.isDisabled && !t.armed, onSelect: toggle },
            { label: 'Reset counters', disabled: !counted, onSelect: () => cmds.resetCounters(name) },
            'separator',
            { label: 'Delete', danger: true, onSelect: () => remove(name) },
          ]} />
      )}
      <div className="am-panel-body">
        {/* Always here, so a screen reader hears Run now's answer when it comes. */}
        <div className="am-sr" aria-live="polite">{ran?.text ?? ''}</div>
        {ran && (
          <p className="am-ran" data-ok={ran.ok || undefined}>
            {ran.ok ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
            {ran.text}
          </p>
        )}
        <Notices entry={entry} on={on} toTarget={() => toMacro('target')} />
        <Runs name={name} t={t} change={change} />
        {t.kind === 'condition' && <Rhythm name={name} t={t} change={change} />}
        <Activity entry={entry} counted={counted} />
      </div>
      <div className="am-panel-foot"><Check aria-hidden="true" />Applies as you type · Ctrl+Z undoes</div>
    </aside>
  );
}

/** What stands in the automation's way, said where it can be fixed (paineis-019, 021 and 022). */
function Notices({ entry, on, toTarget }: { entry: AutomationEntry; on: boolean; toTarget: () => void }) {
  const t = entry.trigger;
  const stopped = on && t.armed && !entry.isDisabled && !entry.running && !!entry.lastResult && entry.lastResult !== 'fired' && !whyCannotFire(t);
  return (
    <>
      {entry.isDisabled && (
        <p className="am-notice" data-tone="warn">The macro is disabled, so its automation can’t run or be turned on. Enable it in the library.</p>
      )}
      {stopped && <p className="am-notice" data-tone="warn">On, but not watching: {entry.lastResult}.</p>}
      {!entry.hasEffectiveTarget && (
        <div className="am-notice">
          <span>No target window — it acts on whichever window is focused when it fires.</span>
          <button type="button" className="insp-link" onClick={toTarget}>Set a window target</button>
        </div>
      )}
    </>
  );
}

const KINDS: { value: TriggerConfig['kind']; label: string }[] = [
  { value: 'interval', label: 'Every…' },
  { value: 'schedule', label: 'At a time' },
  { value: 'condition', label: 'When…' },
];

/** Runs: every so often, at a time on some days, or when a condition shows up (paineis-023 to 031). */
function Runs({ name, t, change }: { name: string; t: TriggerConfig; change: Change }) {
  const never = whyCannotFire(t);
  const at = t.timeOfDay && !rangeParts(t.timeOfDay) ? t.timeOfDay : '';
  const toKind = (kind: TriggerConfig['kind']) => change(now => (kind === 'schedule'
    // At a time keeps a time it can fire at; a range of hours, or nothing, gives way to 09:00.
    ? { kind, timeOfDay: now.timeOfDay && !rangeParts(now.timeOfDay) && clockSeconds(now.timeOfDay) !== null ? now.timeOfDay : '09:00' }
    // Leaving it, its time is not a range of hours: the automation runs at any hour.
    : { kind, ...(now.kind === 'schedule' ? { timeOfDay: null } : {}) }));
  return (
    <section className="am-sec am-runs" aria-label="Runs">
      <span className="am-sec-title">Runs</span>
      <Segmented<TriggerConfig['kind']> label="Runs" value={t.kind} options={KINDS} onChange={toKind} />
      {t.kind === 'interval' && (
        <>
          <IntervalField name={name} seconds={t.intervalSeconds} onSeconds={(s, control) => change({ intervalSeconds: s }, control)} />
          <span className="insp-hint">At least 5 s. The first run comes one interval after it is turned on.</span>
          <Hours name={name} t={t} change={change} />
        </>
      )}
      {t.kind === 'schedule' && (
        <>
          <div className="insp-row">
            <span className="insp-row-label">At</span>
            <TimeBox label="At" value={at} onApply={(v) => change({ timeOfDay: v || null }, 'at')} />
          </div>
          <Days mask={t.daysOfWeek} change={change} />
          <span className="insp-hint">None = every day.</span>
          {never && <p className="am-msg" data-tone="warn">Never fires as it is: {never}</p>}
        </>
      )}
      {t.kind === 'condition' && <Condition t={t} never={never} />}
    </section>
  );
}

/** The condition watched, as it stands; its editor (the If's) comes in slice 9. */
function Condition({ t, never }: { t: TriggerConfig; never: string | null }) {
  const c = conditionWords(t);
  return (
    <>
      <span className="am-label">Condition</span>
      <p className="am-cond">
        {c.what.charAt(0).toUpperCase() + c.what.slice(1)}
        {c.value && <>{' '}<span className="am-quote">“{c.value}”</span></>}
      </p>
      <NotBuilt what="The condition editor (slice 9)" />
      {never && <p className="am-msg" data-tone="warn">Never fires as it is: {never}</p>}
    </>
  );
}

const UNITS: { value: Unit; label: string; tip: string }[] = [
  { value: 's', label: 's', tip: 'Seconds' },
  { value: 'min', label: 'min', tip: 'Minutes' },
  { value: 'h', label: 'h', tip: 'Hours' },
];
const clampInterval = (s: number) => Math.min(86400, Math.max(5, Math.round(s)));

/**
 * Every N seconds, minutes or hours (5 s to 24 h). A unit chosen keeps its number: 15 min → 15 s.
 * The number and the unit are two controls of the undo: units clicked in a row are one step.
 */
function IntervalField({ name, seconds, onSeconds }: { name: string; seconds: number; onSeconds: (s: number, control: 'interval' | 'unit') => void }) {
  const [unit, setUnit] = useState<Unit>(() => unitOf(seconds));
  // A value that comes from outside (an undo, another window) is said in its own unit again; the
  // field's own writes keep the unit chosen.
  const [seen, setSeen] = useState(seconds);
  const [mine, setMine] = useState<number | null>(null);
  if (seconds !== seen) {
    setSeen(seconds);
    if (seconds !== mine) setUnit(unitOf(seconds));
  }
  // The unit chosen, while it says the seconds in a whole number.
  const shown: Unit = seconds % UNIT_SECONDS[unit] === 0 ? unit : unitOf(seconds);
  const per = UNIT_SECONDS[shown];
  const write = (s: number, control: 'interval' | 'unit') => {
    setMine(s);
    onSeconds(s, control);
  };
  return (
    <div className="insp-row am-every">
      <span className="insp-row-label">Every</span>
      <span className="am-every-n">
        <DraftField stepId={`automation:${name}`} field="intervalSeconds" label="Every" kind="int" min={shown === 's' ? 5 : 1} max={Math.floor(86400 / per)}
          stored={String(seconds / per)} onApply={(v) => write(clampInterval(Number(v) * per), 'interval')} />
      </span>
      <Segmented<Unit> label="Unit" value={shown} options={UNITS} onChange={(u) => {
        setUnit(u);
        write(clampInterval((seconds / per) * UNIT_SECONDS[u]), 'unit');
      }} />
    </div>
  );
}

/** The days of a schedule, Mon to Sun; none is every day. Days clicked in a row are one Ctrl+Z. */
function Days({ mask, change }: { mask: number; change: Change }) {
  const tt = useTt();
  return (
    <div className="insp-days am-days" role="group" aria-label="Days">
      {WEEK.map(d => (
        <button key={d.short} type="button" aria-pressed={(mask & d.bit) !== 0} aria-label={d.name} data-tip={tt(d.name, d.pt)}
          onClick={() => change(now => ({ daysOfWeek: now.daysOfWeek ^ d.bit }), 'days')}>
          {d.short}
        </button>
      ))}
    </div>
  );
}

/**
 * Only between these hours (paineis-027 to 029), for an interval or a condition. The two times live
 * here while one of them is still empty, and the switch remembers them: off and on again, they come
 * back. Today's ActiveHoursField is the reference.
 */
function Hours({ name, t, change }: { name: string; t: TriggerConfig; change: Change }) {
  const tt = useTt();
  const range = rangeParts(t.timeOfDay);
  const [pair, setPair] = useState(() => range ?? { from: '', to: '' });
  const [on, setOn] = useState(!!range);
  // A change from outside (an undo, another window) reads the hours again; this field's own writes
  // come back as the value its pair already says.
  const [seen, setSeen] = useState(t.timeOfDay);
  if (t.timeOfDay !== seen) {
    setSeen(t.timeOfDay);
    const said = on && pair.from && pair.to ? `${pair.from}-${pair.to}` : null;
    if ((range ? t.timeOfDay : null) !== said) {
      setOn(!!range);
      if (range) setPair(range);
    }
  }
  const write = (next: { from: string; to: string }, isOn: boolean) => {
    setPair(next);
    setOn(isOn);
    const value = isOn && next.from && next.to && rangeParts(`${next.from}-${next.to}`) ? `${next.from}-${next.to}` : null;
    if (value !== (range ? t.timeOfDay : null)) change({ timeOfDay: value }, 'hours');
  };
  const half = on && !!pair.from !== !!pair.to;
  return (
    <div className="am-hours">
      <div className="insp-row">
        <Switch label="Only between these hours" checked={on}
          onChange={(v) => write(v && !pair.from && !pair.to ? { from: '09:00', to: '18:00' } : pair, v)} />
        <span className="insp-row-label">Only between these hours</span>
      </div>
      {on && (
        <>
          <div className="am-hours-times">
            <TimeBox label="From" value={pair.from} onApply={(v) => write({ ...pair, from: v }, on)} />
            <span className="am-and">and</span>
            <TimeBox label="To" value={pair.to} onApply={(v) => write({ ...pair, to: v }, on)} />
          </div>
          <span className="insp-hint am-hours-hint" data-tone={half ? 'warn' : undefined}>
            {half ? 'Fill in both times — until then it runs at any hour.' : 'An end before the start crosses midnight.'}
          </span>
        </>
      )}
      {phaseLockRisk(t) && (
        <span className="am-msg" data-tone="warn" key={name}
          data-tip={tt('This interval only comes at a few times of day — all may fall outside the hours', 'Este intervalo só chega em alguns horários do dia — todos podem cair fora das horas')}>
          Interval longer than the hours it may run in — it may never fire. Shorten it or widen the hours.
        </span>
      )}
    </div>
  );
}

/** Rhythm, for a condition: once each time it shows or again while it shows, how often it is checked, the wait between fires and the hours. */
function Rhythm({ name, t, change }: { name: string; t: TriggerConfig; change: Change }) {
  const tt = useTt();
  const type = t.conditionType;
  const poll = defaultPollMs(type);
  const cooldown = defaultCooldown(type);
  return (
    <section className="am-sec" aria-label="Rhythm">
      <span className="am-sec-title">Rhythm</span>
      {/* The clipboard fires on a change, not while it lasts (D17). */}
      {type !== 'ClipboardChanged' && (
        <Segmented<'edge' | 'level'>
          label="Rhythm"
          value={t.retrigger === 'level' ? 'level' : 'edge'}
          options={[
            { value: 'edge', label: 'Once each time it shows', tip: tt('Fires when it shows; again only after it goes away', 'Dispara quando aparece; de novo só depois de sumir') },
            { value: 'level', label: 'Repeat while it shows', tip: tt('Fires again after each wait while it stays', 'Dispara de novo a cada espera enquanto continua') },
          ]}
          onChange={(v) => change({ retrigger: v })}
        />
      )}
      <div className="insp-row">
        <span className="insp-row-label">Check every</span>
        <span className="insp-row-end">
          <DraftField stepId={`automation:${name}`} field="pollIntervalMs" label="Check every" kind="mono" unit="s" placeholder={secondsText(poll)}
            stored={t.pollIntervalMs > 0 ? secondsText(t.pollIntervalMs) : ''} filter={(v) => v.replace(/[^\d.,]/g, '')} parse={parseSeconds}
            onApply={(v) => change({ pollIntervalMs: v === '' ? 0 : Math.round(Number(v) * 1000) }, 'poll')} />
        </span>
      </div>
      {type === 'ImageFound' && <span className="insp-hint">Image checks scan the whole screen — raise this if you can wait a few seconds.</span>}
      <div className="insp-row">
        <span className="insp-row-label">Wait between fires</span>
        <span className="insp-row-end">
          <DraftField stepId={`automation:${name}`} field="cooldownSeconds" label="Cooldown" kind="int" min={0} max={86400} unit="s" empty="clear"
            placeholder={String(cooldown)} stored={t.cooldownSeconds > 0 ? String(t.cooldownSeconds) : ''}
            onApply={(v) => change({ cooldownSeconds: v === '' ? 0 : Number(v) }, 'cooldown')} />
        </span>
      </div>
      <span className="insp-hint">Empty = the usual: a check every {secondsText(poll)} s, {cooldown} s between fires.</span>
      <Hours name={name} t={t} change={change} />
    </section>
  );
}

/** Seconds as typed ("2", "0.5", "1,5"), from 0.1 to 600, said back the way the field shows them; empty is the usual. */
function parseSeconds(text: string): string | null {
  const s = text.trim().replace(',', '.');
  if (s === '') return '';
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return secondsText(Math.min(600000, Math.max(100, Math.round(Number(s) * 1000))));
}

/** Activity (paineis-072 to 074): how many times it fired and when, what was skipped and why, and the reset. */
function Activity({ entry, counted }: { entry: AutomationEntry; counted: boolean }) {
  const cmds = useAutomations();
  const reasons = ([[entry.skippedBusy, 'another macro was running'], [entry.skippedModal, 'a dialog was open'], [entry.skippedDirty, 'unsaved changes']] as const)
    .filter(([n]) => n > 0);
  const skipped = reasons.reduce((sum, [n]) => sum + n, 0);
  const next = entry.trigger.armed && entry.running && entry.trigger.kind !== 'condition' && entry.nextDueAt;
  const last = entry.lastResult && entry.lastResult !== 'fired' ? entry.lastResult : null;
  return (
    <section className="am-sec" aria-label="Activity">
      <span className="am-sec-title">Activity</span>
      <Line label="Fired" value={entry.fireCount > 0 ? `${entry.fireCount}× · last ${whenText(entry.lastFiredAt)}` : 'Not yet'} />
      {next && <Line label="Next" value={whenText(entry.nextDueAt)} />}
      {skipped > 0 && (
        <Line label="Skipped" value={reasons.length === 1 ? `${skipped} · ${reasons[0][1]}` : `${skipped} · ${reasons.map(([n, why]) => `${n} ${why}`).join(', ')}`} />
      )}
      {entry.skippedSuppressed > 0 && (
        <Line label="Ignored" value={`${entry.skippedSuppressed} clipboard change${entry.skippedSuppressed === 1 ? '' : 's'} just after a replay`} />
      )}
      {last && <Line label="Last result" value={last} />}
      {counted && <button type="button" className="insp-button am-reset" onClick={() => cmds.resetCounters(entry.profile)}>Reset counters</button>}
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <span className="am-line">
      <span className="am-line-label">{label}</span>
      <span className="am-line-value">{value}</span>
    </span>
  );
}

// ── A time of day ──

const TIME_IDLE_MS = 600;
type TimeLive = { typed: { value: string; over: string } | null; value: string; onApply: (v: string) => void };

/** A time of day ("HH:mm"), applied when the typing stops, when it is left and on Enter — the arrows through the hours are one change. */
function TimeBox({ label, value, disabled, onApply }: { label: string; value: string; disabled?: boolean; onApply: (v: string) => void }) {
  const [typed, setTyped] = useState<{ value: string; over: string } | null>(null);
  if (typed && typed.over !== value) setTyped(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef<TimeLive>({ typed, value, onApply });
  useEffect(() => { live.current = { typed, value, onApply }; });
  // The panel going (another automation, the page left) sends what was typed.
  useEffect(() => () => sendTime(timer, live), []);
  return (
    <label className="insp-box am-time" data-disabled={disabled || undefined}>
      <input
        type="time"
        aria-label={label}
        className="insp-mono"
        value={typed ? typed.value : value}
        disabled={disabled}
        onChange={(e) => {
          const next = { value: e.target.value, over: value };
          setTyped(next);
          live.current = { ...live.current, typed: next };
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => sendTime(timer, live), TIME_IDLE_MS);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendTime(timer, live); } }}
        onBlur={() => sendTime(timer, live)}
      />
    </label>
  );
}
function sendTime(timer: MutableRefObject<ReturnType<typeof setTimeout> | null>, live: MutableRefObject<TimeLive>) {
  if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  const { typed, value, onApply } = live.current;
  if (!typed || typed.over !== value || typed.value === value) return;
  live.current = { ...live.current, typed: null };
  onApply(typed.value);
}
