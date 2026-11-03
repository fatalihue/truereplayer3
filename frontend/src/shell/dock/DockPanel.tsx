import { Fragment, useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { RunStep } from '../../bridge/messageTypes';
import { fmtNum, t, tn } from '../../i18n';
import { useRunReport, useRunState } from '../../logic/useRunState';
import { runDurationMs } from '../../utils/runReportStats';
import { formatClock, formatDuration, timeOfDay } from '../header/model';
import { runSeconds, useNow } from '../header/useNow';
import { focusList } from '../inspector/inspectorState';
import { selection } from '../list/selection';
import { stepName } from '../list/stepTypes';
import { useApp, useShell } from '../store';
import { clampDock, DOCK_DEFAULT_REM, DOCK_MAX_REM, DOCK_MIN_REM, dock, useDock, type DockTab } from './dockState';
import './dockIcons.css';
import './dockPanel.css';

/** The run's report is pushed once, at the end; while a run is on, the open panel asks for it this often. */
const LIVE_MS = 500;

export default function DockPanel({ tab }: { tab: DockTab }) {
  const height = useDock(s => s.height);
  return (
    <>
      <Edge height={height} />
      {tab === 'report' ? <RunReportView /> : <LiveVariablesView />}
    </>
  );
}

// What the codes of a browser step's failure mean — the extension's codes (content.js mkError) and the
// two the bridge makes on a timeout. An unknown one shows the step's own message.
const CODES: Readonly<Record<string, string | undefined>> = tn('dock.codes');

const ICONS: Record<RunStep['status'], { icon: string; label: string }> = {
  ok: { icon: 'circle-check', label: t('dock.status.ok') },
  failed: { icon: 'circle-x', label: t('dock.status.failed') },
  skipped: { icon: 'circle-minus', label: t('dock.status.skipped') },
  running: { icon: 'circle-dashed', label: t('dock.status.running') },
};

/**
 * The Run Report in the dock (Running board): the last run, step by step — what matched, how long it
 * took, why it failed — and, while a run is on, the run so far ("Loop 2 of 3 · 0:04 elapsed · 0
 * failures", the step in course "Running…"). A step of the open macro is one click from the list.
 */
function RunReportView() {
  const { report, refresh } = useRunReport();
  const status = useApp(a => a.status);
  const active = useApp(a => a.activeProfile);
  const running = status === 'replaying';
  const listRef = useRef<HTMLDivElement>(null);
  // While a run is on, the report is asked for again and again — not while the page is hidden (the
  // window in the tray, rule 12); when it ends, the engine pushes it.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => { if (!document.hidden) refresh(); }, LIVE_MS);
    return () => clearInterval(id);
  }, [running, refresh]);

  const steps = report?.steps ?? [];
  if (steps.length === 0) {
    return <p className="dock-empty">{running ? t('dock.report.starting') : t('dock.report.empty')}</p>;
  }
  const failed = steps.filter(s => s.status === 'failed').length;
  const ok = steps.filter(s => s.status === 'ok').length;
  const skipped = steps.filter(s => s.status === 'skipped').length;
  const drifting = steps.filter(s => s.matchedTier).length;
  const pages = new Set(steps.map(s => s.tabUrl).filter(Boolean)).size;
  const profiles = new Set(steps.map(s => s.profile).filter(Boolean));
  const firstFailed = steps.findIndex(s => s.status === 'failed');
  const dur = runDurationMs(report, steps);
  const macro = [...profiles][0] ?? report?.profile ?? '';
  const startedAt = report?.startedAt ? timeOfDay(report.startedAt) : '';
  const total = formatDuration(dur.totalMs);
  const overflow = report?.overflow ?? 0;
  const goTo = (s: RunStep) => {
    if (!active || (s.profile && s.profile !== active)) return;
    const all = useShell.getState().app.actions;
    if (!all[s.row - 1]) return;
    selection.only(all, s.row - 1);
    document.querySelector(`.step[data-index="${s.row - 1}"]`)?.scrollIntoView({ block: 'nearest' });
    focusList();
  };

  return (
    <div className="dock-report">
      <div className="dock-head">
        {running ? <LiveHead failed={failed} /> : (
          <span
            className="dock-head-text"
            data-tip={dur.wallClock ? t('dock.report.wallTip', { duration: formatDuration(dur.actionsMs) }) : t('dock.report.sumTip')}
          >
            {startedAt
              ? t('dock.report.head', { count: steps.length, macro, time: startedAt, duration: total })
              : t('dock.report.headNoTime', { count: steps.length, macro, duration: total })}
          </span>
        )}
        <span className="dock-tallies">
          <span data-tone="ok">{t('dock.report.ok', { n: ok })}</span>
          {skipped > 0 && <span>{t('dock.report.skipped', { count: skipped })}</span>}
          {failed > 0 && <span data-tone="failed">{t('dock.report.failed', { count: failed })}</span>}
        </span>
        {firstFailed >= 0 && !running && (
          <button type="button" className="dock-link" onClick={() => listRef.current?.querySelector(`[data-run-index="${firstFailed}"]`)?.scrollIntoView({ block: 'center' })}>
            {t('dock.report.firstFailed', { row: steps[firstFailed].row })}
          </button>
        )}
      </div>
      {drifting > 0 && (
        <p className="dock-warning">
          <span className="step-icon" data-icon="triangle-alert" />
          {t('dock.report.drift', { count: drifting })}
        </p>
      )}
      <div ref={listRef} className="dock-steps" role="list" aria-label={t('dock.report.list')}>
        {steps.map((s, i) => {
          const mine = !!active && (!s.profile || s.profile === active);
          const icon = ICONS[s.status];
          return (
            <Fragment key={i}>
              {profiles.size > 1 && s.profile !== (i > 0 ? steps[i - 1].profile : null) && (
                <div className="dock-chain"><span className="step-icon" data-icon="repeat-2" />{s.profile}</div>
              )}
              <div className="dock-step" role="listitem" data-run-index={i} data-status={s.status}>
                <button type="button" className="dock-step-line" disabled={!mine} data-tip={mine ? t('dock.report.select', { row: s.row }) : undefined} onClick={() => goTo(s)}>
                  <span className="dock-step-row">{s.row}</span>
                  <span className="step-icon" data-icon={icon.icon} role="img" aria-label={icon.label} />
                  <span className="dock-step-type" data-glossary="">{stepName(s.actionType)}</span>
                  {s.detail && <span className="dock-step-detail" data-tip={s.detail} data-tip-reveal="">{s.detail}</span>}
                  <span className="dock-step-time">{s.status === 'running' ? t('dock.report.running') : formatDuration(s.durationMs)}</span>
                </button>
                {s.tabUrl && (s.status === 'failed' || pages > 1) && <div className="dock-step-more" data-tip={s.tabUrl} data-tip-reveal="">{s.tabUrl}</div>}
                {s.matchedTier && (
                  <div className="dock-step-more" data-tone="failed">
                    {s.matchedSelector
                      ? t('dock.report.fallbackSelector', { tier: s.matchedTier, selector: s.matchedSelector })
                      : t('dock.report.fallback', { tier: s.matchedTier })}
                  </div>
                )}
                {s.status === 'failed' && (
                  <div className="dock-failure">
                    {/* The code as the extension gives it, the same in every language. */}
                    {s.errorCode && <span className="dock-failure-code" data-glossary="">{s.errorCode}</span>}
                    <span>{(s.errorCode && CODES[s.errorCode]) || s.errorMessage}</span>
                    {s.tip && <span className="dock-failure-tip">{s.tip}</span>}
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
        {overflow > 0 && <p className="dock-capped">{t('dock.report.capped', { count: overflow, n: fmtNum(overflow) })}</p>}
      </div>
    </div>
  );
}

/** "Loop 2 of 3 · 0:04 elapsed · 0 failures", from the run's own state. */
function LiveHead({ failed }: { failed: number }) {
  const loop = useShell(s => s.live.loopProgress);
  const clock = useShell(s => s.runClock);
  const now = useNow(true);
  const elapsed = formatClock(runSeconds(clock, now));
  const total = loop.total === 0 ? '∞' : loop.total;
  return (
    <span className="dock-head-text" data-live="">
      {loop.active
        ? t('dock.report.liveLoop', { count: failed, clock: elapsed, current: loop.current, total })
        : t('dock.report.live', { count: failed, clock: elapsed })}
    </span>
  );
}

/**
 * Live Variables in the dock: the run's variables, its {clip:} slots and the Data Loop row it is on,
 * as they change. A value is one line (⏎ for its breaks), whole in the tip up to 220 characters.
 */
function LiveVariablesView() {
  const snap = useRunState(true);
  const running = useApp(a => a.status === 'replaying');
  const vars = Object.entries(snap.variables);
  const slots = Object.entries(snap.slots);
  const row = snap.rowData ? Object.entries(snap.rowData) : [];
  if (vars.length === 0 && slots.length === 0 && row.length === 0) {
    return <p className="dock-empty">{t('dock.vars.empty')}</p>;
  }
  return (
    <div className="dock-vars" data-live={running || undefined}>
      {vars.length > 0 && <Values title={t('dock.vars.variables')} rows={vars} />}
      {slots.length > 0 && <Values title={t('dock.vars.slots')} rows={slots.map(([k, v]) => [`clip:${k}`, v])} />}
      {row.length > 0 && <Values title={t('dock.vars.row')} rows={row.map(([k, v]) => [`row:${k}`, v])} />}
    </div>
  );
}

function Values({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="dock-values" aria-label={title}>
      <h3>{title}</h3>
      {rows.map(([name, value]) => {
        const line = value.replace(/\r?\n/g, ' ⏎ ');
        return (
          <div key={name} className="dock-value" data-tip={line.length > 220 ? `${line.slice(0, 220)}…` : line}>
            {/* A variable's name or a token's ({clip:1} as clip:1), the same in every language. */}
            <span className="dock-value-name" data-glossary="">{name}</span>
            <span className="dock-value-text">{line || '·'}</span>
          </div>
        );
      })}
    </section>
  );
}

/**
 * The top edge of the open panel: a drag makes it taller or shorter, the arrows by 1 rem, and a
 * double click puts the default back. While dragging, the height goes straight to the element; it
 * is kept once, on release.
 */
function Edge({ height }: { height: number }) {
  const drag = useRef<{ startY: number; startRem: number; rem: number; root: number; el: HTMLElement } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget.closest<HTMLElement>('.dock');
    if (!el) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    drag.current = { startY: e.clientY, startRem: height, rem: height, root, el };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const rem = clampDock(d.startRem + (d.startY - e.clientY) / d.root);
    if (rem === d.rem) return;
    d.rem = rem;
    d.el.style.setProperty('--dock-panel', `${rem}rem`);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.rem !== height) dock.setHeight(d.rem);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = e.key === 'ArrowUp' ? height + 1 : e.key === 'ArrowDown' ? height - 1
      : e.key === 'Home' ? DOCK_MAX_REM : e.key === 'End' ? DOCK_MIN_REM : null;
    if (next === null) return;
    e.preventDefault();
    dock.setHeight(next);
  };
  return (
    <div
      className="dock-edge"
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('dock.height')}
      aria-valuemin={DOCK_MIN_REM * 16}
      aria-valuemax={DOCK_MAX_REM * 16}
      aria-valuenow={Math.round(height * 16)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => dock.setHeight(DOCK_DEFAULT_REM)}
      onKeyDown={onKeyDown}
    />
  );
}
