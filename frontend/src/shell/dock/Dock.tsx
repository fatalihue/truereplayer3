import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useLanguage, useTt } from '../../state/LanguageContext';
import { formatDuration, lastRunOutcome, timeOfDay } from '../header/model';
import { preload, useLoaded } from '../lazyModule';
import { useApp, useShell } from '../store';
import { dock, loadDockPanel, useDock, useDockPx, type DockTab } from './dockState';
import './dock.css';

const TABS: { id: DockTab; label: string }[] = [
  { id: 'report', label: 'Run Report' },
  { id: 'vars', label: 'Live Variables' },
];

/**
 * ⑨ The dock under the steps (Main board: "Run Report · Live Variables · Last run 14:02 · 18 of 18
 * steps · 3.4 s · no errors · Open panel"). The bar is in the opening bundle; the panel's code comes
 * the first time it opens. The tabs are one Tab stop with ← → inside (D2). The panel is as tall as
 * its top edge is dragged, and what sits above the dock (the toasts) moves with it.
 */
export function Dock() {
  const active = useApp(a => a.activeProfile);
  const status = useApp(a => a.status);
  const lastRun = useShell(s => s.lastRun);
  const open = useDock(s => s.open);
  const tab = useDock(s => s.tab);
  const height = useDock(s => s.height);
  const { language } = useLanguage();
  const tt = useTt();
  const ref = useRef<HTMLElement>(null);
  const panel = useLoaded(loadDockPanel);
  useEffect(() => {
    if (open && !panel) void preload(loadDockPanel);
  }, [open, panel]);

  // The dock's height, for the toasts (components/Toast) to stand above it, as its ResizeObserver
  // gives it after the frame's own layout. Read in the commit, it forced a layout of the whole page
  // on the launch's way to the library; and as a variable on the shell, it restyled all of it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const watch = new ResizeObserver(([entry]) => useDockPx.setState({ px: Math.round(entry.borderBoxSize[0]?.blockSize ?? 0) }));
    watch.observe(el);
    return () => {
      watch.disconnect();
      useDockPx.setState({ px: 0 });
    };
  }, [active]);

  if (!active) return null;
  const run = lastRun && lastRun.profile === active ? lastRun : null;
  const summary = status === 'replaying' ? 'Running'
    : run ? `Last run ${timeOfDay(run.startedAt)} · ${run.ok} of ${run.total} steps · ${formatDuration(run.durationMs, language)} · ${lastRunOutcome(run, active)}`
    : 'No run yet';
  const Panel = panel?.default;

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const at = TABS.findIndex(t => t.id === tab);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    if (open) dock.show(TABS[next].id);
    else useDock.setState({ tab: TABS[next].id });
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <section ref={ref} className="dock" aria-label="Run Report and Live Variables" data-open={open || undefined} style={{ '--dock-panel': `${height}rem` } as CSSProperties}>
      <div className="dock-bar">
        <div className="dock-tabs" role="tablist" aria-label="Dock" onKeyDown={onTabKey}>
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`dock-tab-${t.id}`}
              aria-selected={t.id === tab}
              aria-controls={open && t.id === tab ? 'dock-panel' : undefined}
              tabIndex={t.id === tab ? 0 : -1}
              data-open={open && t.id === tab ? '' : undefined}
              onClick={() => dock.show(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="dock-summary"
          data-run={run && status !== 'replaying' ? (run.failedCount > 0 || run.outcome === 'failed' ? 'failed' : run.outcome === 'stopped' ? 'stopped' : 'ok') : undefined}
          data-tip={tt('Open the run report', 'Abrir o relatório da execução')}
          onClick={() => dock.show('report')}
        >
          {summary}
        </button>
        <button
          type="button"
          className="dock-toggle"
          aria-label={open ? 'Close panel' : 'Open panel'}
          aria-expanded={open}
          data-tip={open ? tt('Close panel', 'Fechar o painel') : tt('Open panel', 'Abrir o painel')}
          onClick={() => dock.setOpen(!open)}
        >
          <span className="step-icon" data-icon={open ? 'arrow-down' : 'arrow-up'} />
        </button>
      </div>
      {open && (
        <div id="dock-panel" className="dock-panel" role="tabpanel" aria-labelledby={`dock-tab-${tab}`}>
          {Panel && <Panel tab={tab} />}
        </div>
      )}
    </section>
  );
}
