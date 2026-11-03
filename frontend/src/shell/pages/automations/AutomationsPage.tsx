import { useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { Check, ChevronRight, Clock, Ellipsis, Play, Plus, ScanText, Search, Timer, TriangleAlert, X, Zap } from 'lucide-react';
import type { AutomationEntry, TriggerConfig } from '../../../bridge/messageTypes';
import { useBridge } from '../../../bridge/BridgeContext';
import { fmtNum, t, tn } from '../../../i18n';
import { useAutomationRefresh, useAutomations } from '../../../logic/useAutomations';
import { useMacro } from '../../../logic/useMacro';
import { useToast } from '../../../state/ToastContext';
import { clockSeconds, phaseLockRisk, rangeParts } from '../../../utils/activeHours';
import { isModalDialogOpen } from '../../../utils/modalDialog';
import { DraftField, Segmented, Switch } from '../../inspector/fields';
import { MacroPicker } from '../../inspector/MacroPicker';
import { VALUE_A } from '../../inspector/probes';
import { selection } from '../../list/selection';
import { Menu } from '../../Menu';
import { anchorBelow, type MenuAnchor } from '../../menuAnchor';
import { Popover } from '../../Popover';
import { useApp, useShell } from '../../store';
import { openMacroSettings, openPage, useUi } from '../../ui';
import {
  defaultCooldown, defaultPollMs, defaultTrigger, phraseOf, secondsText, STARTS, statusOf, triggerText, triggerWords,
  UNIT_SECONDS, unitOf, weekDays, whenText, whyCannotFire, type Status, type Unit,
} from './automationModel';
import { Condition, CropView } from './AutomationCondition';
import { useAutomationImages } from './automationImages';
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
  const cropping = useAutomationsUi(s => s.crop !== null && s.crop === s.open);
  const [pick, setPick] = useState<Pick | null>(null);
  // A captured or cropped reference image lands on the automation it was asked for.
  useAutomationImages(cmds);

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
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || el.tagName === 'TEXTAREA'
        || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)));
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
    <section className="shell-page am" aria-label={t('common.pages.automations')} data-panel={entry ? '' : undefined} data-crop={(entry && cropping) || undefined}>
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
      {entry && (cropping
        ? <aside className="am-panel am-crop" aria-label={t('automations.panel.label')}><CropView entry={entry} /></aside>
        : <Panel key={entry.profile} entry={entry} />)}
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
  const cmds = useAutomations();
  const on = useRunAutomations();
  const left = useMacrosLeft();
  const none = useApp(a => a.profiles.length === 0);
  return (
    <header className="am-head">
      <div className="am-titles">
        <h1 className="am-title">{t('common.pages.automations')}</h1>
        <p className="am-sub">{t('automations.head.sub')}</p>
      </div>
      <div className="am-head-end">
        <span className="am-run">
          {t('automations.head.runAll')}
          <Switch
            label={t('automations.head.runAll')}
            checked={on}
            tip={on ? t('automations.head.runAllOnTip') : t('automations.head.runAllOffTip')}
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
          data-tip={left.length > 0 ? undefined : none ? t('automations.head.noMacro') : t('automations.head.allTaken')}
          onClick={(e) => onNew(e.currentTarget)}
        >
          <Plus aria-hidden="true" />
          {t('automations.head.new')}
        </button>
      </div>
    </header>
  );
}

/** "Pick the macro it runs": the macros with no automation, by a search (↑ ↓ and Enter, Esc closes). */
function PickMacro({ at, onPick, onClose }: { at: Pick; onPick: (name: string) => void; onClose: () => void }) {
  const names = useMacrosLeft();
  return (
    <Popover anchor={at.anchor} label={t('automations.pick.title')} toggle={at.button} focusFirst onClose={onClose}>
      <div className="am-pick">
        <span className="am-pick-title">{t('automations.pick.title')}</span>
        <MacroPicker names={names} value={null} autoFocus label={t('automations.pick.list')} onPick={onPick} />
      </div>
    </Popover>
  );
}

// ── None yet (the EmptyStates board) ──

const START_ICONS = { timer: Timer, clock: Clock, text: ScanText };

function Empty({ onStart }: { onStart: (patch: Partial<TriggerConfig>, button: HTMLElement) => void }) {
  const left = useMacrosLeft();
  return (
    <div className="am-empty">
      <span className="am-empty-icon" aria-hidden="true"><Zap /></span>
      <span className="am-empty-title">{t('automations.empty.title')}</span>
      <span className="am-empty-text">{t('automations.empty.text')}</span>
      <span className="am-empty-from">{t('automations.empty.from')}</span>
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
              data-tip={left.length === 0 ? t('automations.head.noMacro') : undefined}
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
  { f: 'all', label: t('automations.filters.all') },
  { f: 'armed', label: t('automations.filters.armed') },
  { f: 'off', label: t('automations.filters.off') },
  { f: 'attention', label: t('automations.filters.attention') },
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
      <div className="am-chips" role="group" aria-label={t('automations.filterGroup')}>
        {FILTERS.filter(c => c.f === 'all' || counts[c.f] > 0).map(({ f, label }) => (
          <button key={f} type="button" className="am-chip" data-tone={f === 'attention' ? 'warn' : undefined} aria-pressed={filter === f}
            onClick={() => useAutomationsUi.setState({ filter: f })}>
            {label}{' '}<span className="am-chip-n">{fmtNum(counts[f])}</span>
          </button>
        ))}
      </div>
      <span className="am-spacer" />
      <label className="am-search">
        <Search aria-hidden="true" />
        <input
          type="text"
          aria-label={t('automations.search')}
          placeholder={t('automations.searchHint')}
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
            <th className="am-c">{t('automations.columns.on')}</th>
            <th>{t('automations.columns.macro')}</th>
            <th>{t('automations.columns.trigger')}</th>
            <th>{t('automations.columns.status')}</th>
            <th>{t('automations.columns.lastFired')}</th>
            <th className="am-n">{t('automations.columns.fires')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(e => <Row key={e.profile} entry={e} here={e.profile === open} on={on} />)}
        </tbody>
      </table>
      {rows.length === 0 && <p className="am-none" role="status">{query ? t('automations.noMatch', { query }) : t('automations.noneInFilter')}</p>}
      <p className="am-note">{t('automations.hotkeysNote')}</p>
    </div>
  );
}

/**
 * One automation's row. A row of its own, so a change to one automation draws that row alone: the
 * others keep their entry while only what was sent covers it.
 */
function Row({ entry: e, here, on }: { entry: AutomationEntry; here: boolean; on: boolean }) {
  const cmds = useAutomations();
  // A disabled macro's automation can be turned off, not on (the engine never runs it).
  const blocked = e.isDisabled && !e.trigger.armed;
  return (
    <tr data-open={here || undefined} data-off={!e.trigger.armed || undefined}
      onClick={(ev) => { if (!(ev.target as HTMLElement).closest('button')) openAutomation(e.profile); }}>
      <td className="am-c">
        <Switch
          label={t('automations.row.switch', { name: e.profile })}
          checked={e.trigger.armed}
          disabled={blocked}
          tip={blocked ? t('automations.row.disabledTip') : undefined}
          onChange={(v) => { const now = triggerNow(e.profile); if (now) commit(e.profile, { ...now, armed: v }, cmds); }}
        />
      </td>
      <td>
        <button type="button" className="am-edit" aria-current={here || undefined} aria-label={t('automations.row.edit', { name: e.profile })} onClick={() => openAutomation(e.profile)}>
          {e.profile}
        </button>
      </td>
      <td className="am-trigger"><TriggerCell trigger={e.trigger} /></td>
      <td><StatusCell status={statusOf(e, on)} /></td>
      <td className="am-mono am-when">{whenText(e.lastFiredAt)}</td>
      <td className="am-mono am-n">{fmtNum(e.fireCount)}</td>
    </tr>
  );
}

/**
 * The trigger's phrase ("Every 15 min", "When text on screen"), its main part drawn plain and the
 * rest quieter wherever the language puts it: the phrase is asked with a mark in the main part's
 * place and cut there (as the probes' answers are). Then the value watched for and the hours or days.
 */
function TriggerCell({ trigger }: { trigger: TriggerConfig }) {
  const w = triggerWords(trigger);
  const [before, after] = phraseOf(w.kind, VALUE_A).split(VALUE_A);
  return (
    <span className="am-trig" data-tip={triggerText(trigger)} data-tip-reveal>
      {before && <span className="am-lead">{before}</span>}{w.main}{after && <span className="am-lead">{after}</span>}
      {w.quote && <>{' '}<span className="am-quote">“{w.quote}”</span></>}
      {w.tail && <span className="am-tail"> · {w.tail}</span>}
    </span>
  );
}

/** Why a status is what it is; the engine's own reasons come as it says them. */
function statusTip(s: Status): string | undefined {
  switch (s.why) {
    case 'disabled': return t('automations.statusTip.disabled');
    case 'paused': return t('automations.statusTip.paused');
    case 'true': return t('automations.statusTip.conditionTrue');
    case 'false': return t('automations.statusTip.conditionFalse');
    case 'never':
    case 'stopped': return s.detail;
    default: return undefined;
  }
}

function StatusCell({ status }: { status: Status }) {
  return (
    <span className="am-status" data-tone={status.tone} data-tip={statusTip(status)}>
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
  return (name: string) => {
    const was = triggerNow(name);
    if (!was) return;
    commit(name, null, cmds);
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.am-new:not(:disabled)')?.focus());
    showToast(t('automations.deleted', { name }), {
      type: 'success',
      duration: 10000,
      action: {
        label: t('common.actions.undo'),
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
  const cmds = useAutomations();
  const macro = useMacro();
  const on = useRunAutomations();
  const { subscribe } = useBridge();
  const remove = useRemove();
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const [ran, setRan] = useState<{ ok: boolean; text: string } | null>(null);
  const fireRef = useRef<string | null>(null);
  const name = entry.profile;
  const trigger = entry.trigger;
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
    <aside className="am-panel" aria-label={t('automations.panel.label')} onKeyDown={onKeyDown}>
      <div className="am-panel-head">
        <span className="am-panel-icon" data-tone={status.tone} aria-hidden="true"><Zap /></span>
        <div className="am-panel-titles">
          <span className="am-panel-title">{name}</span>
          <span className="am-panel-sub">{trigger.armed ? t('automations.panel.runs') : t('automations.panel.runsOff')}</span>
        </div>
        <button
          type="button"
          className="insp-button am-run-now"
          disabled={entry.isDisabled}
          data-tip={entry.isDisabled ? t('automations.row.disabledTip') : t('automations.panel.runNowTip')}
          onClick={() => { setRan(null); fireRef.current = cmds.testFire(name); }}
        >
          <Play aria-hidden="true" />
          {t('automations.panel.runNow')}
        </button>
        <button type="button" className="insp-icon-button" aria-label={t('automations.panel.actions')} aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
          <Ellipsis aria-hidden="true" />
        </button>
        <button type="button" className="insp-icon-button" aria-label={t('automations.panel.close')} onClick={close}>
          <X aria-hidden="true" />
        </button>
      </div>
      {menu && (
        <Menu anchor={menu.anchor} label={t('automations.panel.actions')} toggle={menu.button} onClose={() => setMenu(null)}
          entries={[
            { label: t('automations.panel.openMacro'), onSelect: () => toMacro() },
            { label: trigger.armed ? t('automations.panel.turnOff') : t('automations.panel.turnOn'), disabled: entry.isDisabled && !trigger.armed, onSelect: toggle },
            { label: t('automations.panel.resetCounters'), disabled: !counted, onSelect: () => cmds.resetCounters(name) },
            'separator',
            { label: t('common.actions.delete'), danger: true, onSelect: () => remove(name) },
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
        <Runs name={name} trigger={trigger} change={change} cmds={cmds} />
        {trigger.kind === 'condition' && <Rhythm name={name} trigger={trigger} change={change} />}
        <Activity entry={entry} counted={counted} />
      </div>
      <div className="am-panel-foot"><Check aria-hidden="true" />{t('automations.panel.foot')}</div>
    </aside>
  );
}

/** What stands in the automation's way, said where it can be fixed (paineis-019, 021 and 022). */
function Notices({ entry, on, toTarget }: { entry: AutomationEntry; on: boolean; toTarget: () => void }) {
  const trigger = entry.trigger;
  const stopped = on && trigger.armed && !entry.isDisabled && !entry.running && !!entry.lastResult && entry.lastResult !== 'fired' && !whyCannotFire(trigger);
  return (
    <>
      {entry.isDisabled && (
        <p className="am-notice" data-tone="warn">{t('automations.notices.disabled')}</p>
      )}
      {stopped && <p className="am-notice" data-tone="warn">{t('automations.notices.notWatching', { reason: entry.lastResult ?? '' })}</p>}
      {!entry.hasEffectiveTarget && (
        <div className="am-notice">
          <span>{t('automations.notices.noTarget')}</span>
          <button type="button" className="insp-link" onClick={toTarget}>{t('automations.notices.setTarget')}</button>
        </div>
      )}
    </>
  );
}

const KINDS: { value: TriggerConfig['kind']; label: string }[] = [
  { value: 'interval', label: t('automations.runs.kinds.interval') },
  { value: 'schedule', label: t('automations.runs.kinds.schedule') },
  { value: 'condition', label: t('automations.runs.kinds.condition') },
];

/** Runs: every so often, at a time on some days, or when a condition shows up (paineis-023 to 067). */
function Runs({ name, trigger, change, cmds }: { name: string; trigger: TriggerConfig; change: Change; cmds: Cmds }) {
  const never = whyCannotFire(trigger);
  const at = trigger.timeOfDay && !rangeParts(trigger.timeOfDay) ? trigger.timeOfDay : '';
  const toKind = (kind: TriggerConfig['kind']) => change(now => (kind === 'schedule'
    // At a time keeps a time it can fire at; a range of hours, or nothing, gives way to 09:00.
    ? { kind, timeOfDay: now.timeOfDay && !rangeParts(now.timeOfDay) && clockSeconds(now.timeOfDay) !== null ? now.timeOfDay : '09:00' }
    // Leaving it, its time is not a range of hours: the automation runs at any hour.
    : { kind, ...(now.kind === 'schedule' ? { timeOfDay: null } : {}) }));
  return (
    <section className="am-sec am-runs" aria-label={t('automations.runs.title')}>
      <span className="am-sec-title">{t('automations.runs.title')}</span>
      <Segmented<TriggerConfig['kind']> label={t('automations.runs.title')} value={trigger.kind} options={KINDS} onChange={toKind} />
      {trigger.kind === 'interval' && (
        <>
          <IntervalField name={name} seconds={trigger.intervalSeconds} onSeconds={(s, control) => change({ intervalSeconds: s }, control)} />
          <span className="insp-hint">{t('automations.runs.intervalHint')}</span>
          <Hours name={name} trigger={trigger} change={change} />
        </>
      )}
      {trigger.kind === 'schedule' && (
        <>
          <div className="insp-row">
            <span className="insp-row-label">{t('automations.runs.at')}</span>
            <TimeBox label={t('automations.runs.at')} value={at} onApply={(v) => change({ timeOfDay: v || null }, 'at')} />
          </div>
          <Days mask={trigger.daysOfWeek} change={change} />
          <span className="insp-hint">{t('automations.runs.daysHint')}</span>
          {never && <p className="am-msg" data-tone="warn">{t('automations.runs.never', { reason: never })}</p>}
        </>
      )}
      {trigger.kind === 'condition' && <Condition name={name} trigger={trigger} never={never} change={change} cmds={cmds} />}
    </section>
  );
}

// The units stay as they are written (s, min, h), in both languages; their tips say them whole.
const UNITS: { value: Unit; label: string; tip: string }[] = [
  { value: 's', label: 's', tip: t('automations.runs.units.s') },
  { value: 'min', label: 'min', tip: t('automations.runs.units.min') },
  { value: 'h', label: 'h', tip: t('automations.runs.units.h') },
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
      <span className="insp-row-label">{t('automations.runs.every')}</span>
      <span className="am-every-n">
        <DraftField stepId={`automation:${name}`} field="intervalSeconds" label={t('automations.runs.every')} kind="int" min={shown === 's' ? 5 : 1} max={Math.floor(86400 / per)}
          stored={String(seconds / per)} onApply={(v) => write(clampInterval(Number(v) * per), 'interval')} />
      </span>
      <Segmented<Unit> label={t('automations.runs.unit')} value={shown} options={UNITS} onChange={(u) => {
        setUnit(u);
        write(clampInterval((seconds / per) * UNIT_SECONDS[u]), 'unit');
      }} />
    </div>
  );
}

/**
 * The days of a schedule, Mon to Sun, by their names in the build's language ("Mon", "Seg."); none is
 * every day. Days clicked in a row are one Ctrl+Z.
 */
function Days({ mask, change }: { mask: number; change: Change }) {
  return (
    <div className="insp-days am-days" role="group" aria-label={t('conditions.time.days')}>
      {weekDays().map(d => (
        <button key={d.bit} type="button" aria-pressed={(mask & d.bit) !== 0} aria-label={d.name} data-tip={d.name}
          onClick={() => change(now => ({ daysOfWeek: now.daysOfWeek ^ d.bit }), 'days')}>
          {d.label}
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
function Hours({ name, trigger, change }: { name: string; trigger: TriggerConfig; change: Change }) {
  const range = rangeParts(trigger.timeOfDay);
  const [pair, setPair] = useState(() => range ?? { from: '', to: '' });
  const [on, setOn] = useState(!!range);
  // A change from outside (an undo, another window) reads the hours again; this field's own writes
  // come back as the value its pair already says.
  const [seen, setSeen] = useState(trigger.timeOfDay);
  if (trigger.timeOfDay !== seen) {
    setSeen(trigger.timeOfDay);
    const said = on && pair.from && pair.to ? `${pair.from}-${pair.to}` : null;
    if ((range ? trigger.timeOfDay : null) !== said) {
      setOn(!!range);
      if (range) setPair(range);
    }
  }
  const write = (next: { from: string; to: string }, isOn: boolean) => {
    setPair(next);
    setOn(isOn);
    const value = isOn && next.from && next.to && rangeParts(`${next.from}-${next.to}`) ? `${next.from}-${next.to}` : null;
    if (value !== (range ? trigger.timeOfDay : null)) change({ timeOfDay: value }, 'hours');
  };
  const half = on && !!pair.from !== !!pair.to;
  return (
    <div className="am-hours">
      <div className="insp-row">
        <Switch label={t('automations.hours.only')} checked={on}
          onChange={(v) => write(v && !pair.from && !pair.to ? { from: '09:00', to: '18:00' } : pair, v)} />
        <span className="insp-row-label">{t('automations.hours.only')}</span>
      </div>
      {on && (
        <>
          <div className="am-hours-times">
            <TimeBox label={t('conditions.time.from')} value={pair.from} onApply={(v) => write({ ...pair, from: v }, on)} />
            <span className="am-and">{t('automations.hours.and')}</span>
            <TimeBox label={t('conditions.time.to')} value={pair.to} onApply={(v) => write({ ...pair, to: v }, on)} />
          </div>
          <span className="insp-hint am-hours-hint" data-tone={half ? 'warn' : undefined}>
            {half ? t('automations.hours.half') : t('automations.hours.overnight')}
          </span>
        </>
      )}
      {phaseLockRisk(trigger) && (
        <span className="am-msg" data-tone="warn" key={name} data-tip={t('automations.hours.phaseLockTip')}>
          {t('automations.hours.phaseLock')}
        </span>
      )}
    </div>
  );
}

/** Rhythm, for a condition: once each time it shows or again while it shows, how often it is checked, the wait between fires and the hours. */
function Rhythm({ name, trigger, change }: { name: string; trigger: TriggerConfig; change: Change }) {
  const type = trigger.conditionType;
  const poll = defaultPollMs(type);
  const cooldown = defaultCooldown(type);
  return (
    <section className="am-sec" aria-label={t('automations.rhythm.title')}>
      <span className="am-sec-title">{t('automations.rhythm.title')}</span>
      {/* The clipboard fires on a change, not while it lasts (D17). */}
      {type !== 'ClipboardChanged' && (
        <Segmented<'edge' | 'level'>
          label={t('automations.rhythm.title')}
          value={trigger.retrigger === 'level' ? 'level' : 'edge'}
          options={[
            { value: 'edge', label: t('automations.rhythm.edge'), tip: t('automations.rhythm.edgeTip') },
            { value: 'level', label: t('automations.rhythm.level'), tip: t('automations.rhythm.levelTip') },
          ]}
          onChange={(v) => change({ retrigger: v })}
        />
      )}
      <div className="insp-row">
        <span className="insp-row-label">{t('automations.rhythm.checkEvery')}</span>
        <span className="insp-row-end">
          {/* The seconds are written with the build's decimal sign ("0,5" in pt-BR): read back with either. */}
          <DraftField stepId={`automation:${name}`} field="pollIntervalMs" label={t('automations.rhythm.checkEvery')} kind="dec" min={0.1} max={600} step={0.25} format={(s) => secondsText(s * 1000)} unit="s" placeholder={secondsText(poll)}
            stored={trigger.pollIntervalMs > 0 ? secondsText(trigger.pollIntervalMs) : ''} filter={(v) => v.replace(/[^\d.,]/g, '')} parse={parseSeconds}
            onApply={(v) => change({ pollIntervalMs: v === '' ? 0 : Math.round(Number(v.replace(',', '.')) * 1000) }, 'poll')} />
        </span>
      </div>
      {type === 'ImageFound' && <span className="insp-hint">{t('automations.rhythm.imageHint')}</span>}
      <div className="insp-row">
        <span className="insp-row-label">{t('automations.rhythm.cooldown')}</span>
        <span className="insp-row-end">
          <DraftField stepId={`automation:${name}`} field="cooldownSeconds" label={t('automations.rhythm.cooldownField')} kind="int" min={0} max={86400} unit="s" empty="clear"
            placeholder={String(cooldown)} stored={trigger.cooldownSeconds > 0 ? String(trigger.cooldownSeconds) : ''}
            onApply={(v) => change({ cooldownSeconds: v === '' ? 0 : Number(v) }, 'cooldown')} />
        </span>
      </div>
      <span className="insp-hint">{t('automations.rhythm.usual', { check: secondsText(poll), cooldown: fmtNum(cooldown) })}</span>
      <Hours name={name} trigger={trigger} change={change} />
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

type Skip = 'busy' | 'modal' | 'dirty';
/** Why a fire was skipped, with how many times in front: "2 another macro was running". */
function skipCounted(why: Skip, n: number): string {
  switch (why) {
    case 'busy': return t('automations.activity.whyCounted.busy', { n: fmtNum(n) });
    case 'modal': return t('automations.activity.whyCounted.modal', { n: fmtNum(n) });
    case 'dirty': return t('automations.activity.whyCounted.dirty', { n: fmtNum(n) });
  }
}

/** Activity (paineis-072 to 074): how many times it fired and when, what was skipped and why, and the reset. */
function Activity({ entry, counted }: { entry: AutomationEntry; counted: boolean }) {
  const cmds = useAutomations();
  const reasons = ([[entry.skippedBusy, 'busy'], [entry.skippedModal, 'modal'], [entry.skippedDirty, 'dirty']] as const)
    .filter(([n]) => n > 0);
  const skipped = reasons.reduce((sum, [n]) => sum + n, 0);
  const next = entry.trigger.armed && entry.running && entry.trigger.kind !== 'condition' && entry.nextDueAt;
  const last = entry.lastResult && entry.lastResult !== 'fired' ? entry.lastResult : null;
  return (
    <section className="am-sec" aria-label={t('automations.activity.title')}>
      <span className="am-sec-title">{t('automations.activity.title')}</span>
      <Line label={t('automations.activity.fired')} value={entry.fireCount > 0
        ? t('automations.activity.firedValue', { n: fmtNum(entry.fireCount), when: whenText(entry.lastFiredAt) })
        : t('automations.activity.notYet')} />
      {next && <Line label={t('automations.activity.next')} value={whenText(entry.nextDueAt)} />}
      {skipped > 0 && (
        <Line label={t('automations.activity.skipped')} value={reasons.length === 1
          ? t('automations.activity.skippedOne', { n: fmtNum(skipped), why: tn('automations.activity.why')[reasons[0][1]] })
          : t('automations.activity.skippedSeveral', { n: fmtNum(skipped), list: reasons.map(([n, why]) => skipCounted(why, n)).join(', ') })} />
      )}
      {entry.skippedSuppressed > 0 && (
        <Line label={t('automations.activity.ignored')}
          value={t('automations.activity.ignoredValue', { count: entry.skippedSuppressed, n: fmtNum(entry.skippedSuppressed) })} />
      )}
      {last && <Line label={t('automations.activity.lastResult')} value={last} />}
      {counted && <button type="button" className="insp-button am-reset" onClick={() => cmds.resetCounters(entry.profile)}>{t('automations.panel.resetCounters')}</button>}
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
