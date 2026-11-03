import { useEffect, useState, type MouseEvent } from 'react';
import { ChevronDown, Maximize2 } from 'lucide-react';
import { fmtNum, t } from '../../i18n';
import { useClicker } from '../../logic/useClicker';
import { useMacro } from '../../logic/useMacro';
import { useRecording } from '../../logic/useRecording';
import { useReplay } from '../../logic/useReplay';
import { useWindow } from '../../logic/useWindow';
import { dock } from '../dock/dockState';
import { formatClock } from '../header/model';
import { runSeconds, useNow } from '../header/useNow';
import { keycaps } from '../library/model';
import { insertPoint } from '../list/selection';
import { Menu, type MenuEntry } from '../Menu';
import { anchorBelow, type MenuAnchor } from '../menuAnchor';
import { useApp, useShell } from '../store';
import './compact.css';

type Action = { label: string; keys?: string; run: () => void; tone?: 'stop' | 'accent' | 'record' };

/**
 * The compact layout (CompactWindow board; the Responsive board under 520 px): the macro, what it is
 * doing, and the one or two buttons that matter now — in its six states (Ready, Replaying, waiting for
 * a key, Recording, the Clicker, stopped with an error). In the compact view (rule 10) it is the whole
 * window: its top drags it (the engine snaps it to a corner), "Back to the full window" leaves, and the
 * × Windows draws at the top right hides it to the tray.
 */
export default function CompactView() {
  const compactInset = useShell(s => s.compact);
  const compactView = compactInset > 0;
  const name = useApp(a => a.activeProfile);
  const status = useApp(a => a.status);
  const clicker = useApp(a => a.settings.useCursorClick);
  const settings = useApp(a => a.settings);
  const steps = useApp(a => a.actions.length);
  const profiles = useApp(a => a.profiles);
  const pause = useApp(a => a.pauseState);
  const highlight = useShell(s => s.highlight);
  const loop = useShell(s => s.live.loopProgress);
  const clicks = useShell(s => s.live.clickerStats);
  const clock = useShell(s => s.runClock);
  const lastRun = useShell(s => s.lastRun);
  const running = status !== 'ready';
  const now = useNow(running);
  const replay = useReplay();
  const recording = useRecording();
  // Where the header's Record puts the new steps: after the selection the list keeps, or at the end.
  const record = () => recording.toggleAt(insertPoint(useShell.getState().app.actions));
  const clickerCmds = useClicker();
  const macro = useMacro();
  const app = useWindow();
  const [picker, setPicker] = useState<{ anchor: MenuAnchor; button: HTMLElement } | null>(null);
  // In the compact view the title bar goes (shell.css): this layout's top drags the window.
  useEffect(() => {
    document.documentElement.toggleAttribute('data-compact-view', compactView);
    return () => document.documentElement.removeAttribute('data-compact-view');
  }, [compactView]);

  const elapsed = formatClock(runSeconds(clock, now));
  const current = highlight != null ? highlight + 1 : 0;
  // The state, in bold, and its detail after " · " (empty for none).
  let state: string;
  let detail = '';
  let why = '';
  let actions: Action[] = [];
  let showClock = false;
  if (status === 'recording') {
    state = t('compact.state.recording');
    detail = t('compact.detail.recording', { clock: elapsed, count: steps });
    actions = [{ label: t('common.actions.stop'), keys: settings.recordingHotkey, run: record, tone: 'stop' }];
  } else if (status === 'replaying' && clicker) {
    const seconds = Math.max(1, clicks.elapsedMs / 1000);
    const rate = fmtNum(Math.round(clicks.count / seconds));
    const limit = settings.cursorClickUseLoops && Number(settings.cursorClickLoops) > 0 ? Number(settings.cursorClickLoops) : 0;
    state = t('compact.state.clicking');
    detail = limit
      ? t('compact.detail.clickingOf', { rate, clicks: fmtNum(clicks.count), total: fmtNum(limit) })
      : t('compact.detail.clicking', { rate, clicks: fmtNum(clicks.count) });
    actions = [
      { label: pause.isPaused ? t('common.actions.resume') : t('common.actions.pause'), keys: settings.cursorClickPauseHotkey, run: pause.isPaused ? replay.resume : clickerCmds.pause },
      { label: t('common.actions.stop'), keys: settings.cursorClickStartHotkey, run: replay.toggle, tone: 'stop' },
    ];
    showClock = true;
  } else if (status === 'replaying' && pause.isPaused) {
    // What lets the Pause go: its key, the seconds left of its timeout, both or neither.
    const left = pause.timeoutMs > 0 ? Math.max(0, Math.ceil((pause.timeoutMs - (Math.max(now, pause.startedAt) - pause.startedAt)) / 1000)) : null;
    const key = pause.hotkey ? keycaps(pause.hotkey) : '';
    state = t('compact.state.waiting', { step: current });
    detail = key && left !== null ? t('compact.detail.keyOrSeconds', { key, seconds: left })
      : key || (left !== null ? `${left} s` : '');
    actions = [
      { label: t('common.actions.continue'), keys: pause.hotkey || undefined, run: replay.resume, tone: 'accent' },
      { label: t('common.actions.stop'), run: replay.toggle, tone: 'stop' },
    ];
  } else if (status === 'replaying') {
    const loops = loop.total === 0 ? '∞' : loop.total;
    state = t('compact.state.replaying');
    detail = loop.active && current > 0 ? t('compact.detail.loopStep', { loop: loop.current, loops, step: current, steps })
      : loop.active ? t('compact.detail.loop', { current: loop.current, total: loops })
      : current > 0 ? t('compact.detail.step', { current, total: steps })
      : '';
    actions = [{ label: t('common.actions.stop'), keys: settings.replayHotkey, run: replay.toggle, tone: 'stop' }];
    showClock = true;
  } else if (clicker) {
    state = t('compact.state.clickerOpen');
    detail = settings.cursorClickStartHotkey ? t('compact.detail.keyStarts', { key: keycaps(settings.cursorClickStartHotkey) }) : '';
    actions = [{ label: t('compact.start'), keys: settings.cursorClickStartHotkey, run: replay.toggle, tone: 'accent' }];
  } else if (!name) {
    state = t('compact.noMacro');
    detail = profiles.length ? t('compact.detail.chooseAbove') : '';
  } else if (lastRun?.outcome === 'failed' && lastRun.profile === name && lastRun.failedRow != null) {
    state = t('compact.state.stoppedAt', { step: lastRun.failedRow });
    why = lastRun.failedMessage ?? '';
    actions = [
      { label: t('compact.openReport'), run: () => { app.setCompact(false); dock.show('report'); } },
      { label: t('compact.runAgain'), run: replay.toggle, tone: 'accent' },
    ];
  } else {
    const at = lastRun?.profile === name && lastRun.startedAt ? new Date(lastRun.startedAt) : null;
    state = t('compact.state.ready');
    // The time is the 24-hour clock's ("14:02"), as it has always been here.
    detail = at && !Number.isNaN(at.getTime())
      ? t('compact.detail.stepsLastRun', { count: steps, time: at.toTimeString().slice(0, 5) })
      : t('compact.detail.steps', { count: steps });
    actions = [
      { label: t('common.actions.replay'), keys: settings.replayHotkey, run: replay.toggle, tone: 'accent' },
      { label: t('common.actions.record'), run: record, tone: 'record' },
    ];
  }

  const choose = (e: MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    setPicker(p => (p ? null : { anchor: anchorBelow(button, 'start'), button }));
  };
  const entries: MenuEntry[] = profiles.map(p => ({ label: p.name, checked: p.name === name, onSelect: () => macro.open(p.name) }));
  // Clicker is the same in both languages (glossary).
  const title = clicker ? 'Clicker' : name || t('compact.noMacro');

  return (
    <section className="cmp" aria-label={compactView ? t('compact.view') : t('compact.layout')} data-view={compactView || undefined} data-state={clicker && running ? 'clicking' : status}>
      {/* In the compact view Windows draws its own × at the top right (it hides to the tray there):
          the top leaves it room. */}
      <header className={`cmp-top${compactView ? ' drag-region' : ''}`} style={compactView ? { paddingRight: compactInset - 1 } : undefined}>
        <button type="button" className="cmp-macro no-drag" aria-label={t('compact.chooseMacroNamed', { name: title })} aria-haspopup="menu" disabled={running || clicker} onClick={choose}>
          <span className="cmp-macro-name">{title}</span>
          {!running && !clicker && <ChevronDown aria-hidden="true" />}
        </button>
        {compactView && (
          <>
            <button type="button" className="cmp-icon no-drag" aria-label={t('compact.back')} data-tip={t('compact.back')} onClick={() => app.setCompact(false)}>
              <Maximize2 aria-hidden="true" />
            </button>
          </>
        )}
      </header>
      <p className="cmp-state">
        <span className="cmp-dot" />
        <span className="cmp-state-text"><strong>{state}</strong>{detail && ` · ${detail}`}</span>
        {showClock && <span className="cmp-clock">{elapsed}</span>}
      </p>
      {why && <p className="cmp-why" title={why}>{why}</p>}
      {actions.length > 0 && (
        <div className="cmp-actions">
          {actions.map(a => (
            <button key={a.label} type="button" className="cmp-button" data-tone={a.tone} onClick={a.run}>
              {a.label}
              {a.keys && <kbd className="kbd">{keycaps(a.keys)}</kbd>}
            </button>
          ))}
        </div>
      )}
      {picker && <Menu anchor={picker.anchor} entries={entries} label={t('compact.chooseMacro')} toggle={picker.button} onClose={() => setPicker(null)} />}
    </section>
  );
}
