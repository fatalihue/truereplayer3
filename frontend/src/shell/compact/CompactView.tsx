import { useEffect, useState, type MouseEvent } from 'react';
import { ChevronDown, Maximize2 } from 'lucide-react';
import { useClicker } from '../../logic/useClicker';
import { useMacro } from '../../logic/useMacro';
import { useRecording } from '../../logic/useRecording';
import { useReplay } from '../../logic/useReplay';
import { useWindow } from '../../logic/useWindow';
import { dock } from '../dock/dockState';
import { formatClock } from '../header/model';
import { runSeconds, useNow } from '../header/useNow';
import { keycaps } from '../library/model';
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
  const stepsText = `${steps} step${steps === 1 ? '' : 's'}`;
  let state: string;
  let detail = '';
  let why = '';
  let actions: Action[] = [];
  let showClock = false;
  if (status === 'recording') {
    state = 'Recording';
    detail = ` · ${elapsed} · ${stepsText}`;
    actions = [{ label: 'Stop', keys: settings.recordingHotkey, run: recording.toggle, tone: 'stop' }];
  } else if (status === 'replaying' && clicker) {
    const seconds = Math.max(1, clicks.elapsedMs / 1000);
    const of = settings.cursorClickUseLoops && Number(settings.cursorClickLoops) > 0 ? ` of ${Number(settings.cursorClickLoops).toLocaleString('en-US')}` : '';
    state = 'Clicking';
    detail = ` · ${Math.round(clicks.count / seconds)}/s · ${clicks.count.toLocaleString('en-US')}${of}`;
    actions = [
      { label: pause.isPaused ? 'Resume' : 'Pause', keys: settings.cursorClickPauseHotkey, run: pause.isPaused ? replay.resume : clickerCmds.pause },
      { label: 'Stop', keys: settings.cursorClickStartHotkey, run: replay.toggle, tone: 'stop' },
    ];
    showClock = true;
  } else if (status === 'replaying' && pause.isPaused) {
    const left = pause.timeoutMs > 0 ? Math.max(0, Math.ceil((pause.timeoutMs - (Math.max(now, pause.startedAt) - pause.startedAt)) / 1000)) : 0;
    const ways = [pause.hotkey ? keycaps(pause.hotkey) : '', pause.timeoutMs > 0 ? `${left} s` : ''].filter(Boolean).join(' or ');
    state = `Waiting at step ${current}`;
    detail = ways ? ` · ${ways}` : '';
    actions = [
      { label: 'Continue', keys: pause.hotkey || undefined, run: replay.resume, tone: 'accent' },
      { label: 'Stop', run: replay.toggle, tone: 'stop' },
    ];
  } else if (status === 'replaying') {
    state = 'Replaying';
    detail = (loop.active ? ` · loop ${loop.current} of ${loop.total === 0 ? '∞' : loop.total}` : '') + (current > 0 ? ` · step ${current} of ${steps}` : '');
    actions = [{ label: 'Stop', keys: settings.replayHotkey, run: replay.toggle, tone: 'stop' }];
    showClock = true;
  } else if (clicker) {
    state = 'Clicker open';
    detail = settings.cursorClickStartHotkey ? ` · ${keycaps(settings.cursorClickStartHotkey)} starts` : '';
    actions = [{ label: 'Start', keys: settings.cursorClickStartHotkey, run: replay.toggle, tone: 'accent' }];
  } else if (!name) {
    state = 'No macro open';
    detail = profiles.length ? ' · choose one above' : '';
  } else if (lastRun?.outcome === 'failed' && lastRun.profile === name && lastRun.failedRow != null) {
    state = `Stopped at step ${lastRun.failedRow}`;
    why = lastRun.failedMessage ?? '';
    actions = [
      { label: 'Open run report', run: () => { app.setCompact(false); dock.show('report'); } },
      { label: 'Run again', run: replay.toggle, tone: 'accent' },
    ];
  } else {
    const at = lastRun?.profile === name && lastRun.startedAt ? new Date(lastRun.startedAt) : null;
    state = 'Ready';
    detail = ` · ${stepsText}${at && !Number.isNaN(at.getTime()) ? ` · last run ${at.toTimeString().slice(0, 5)}` : ''}`;
    actions = [
      { label: 'Replay', keys: settings.replayHotkey, run: replay.toggle, tone: 'accent' },
      { label: 'Record', run: recording.toggle, tone: 'record' },
    ];
  }

  const choose = (e: MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    setPicker(p => (p ? null : { anchor: anchorBelow(button, 'start'), button }));
  };
  const entries: MenuEntry[] = profiles.map(p => ({ label: p.name, checked: p.name === name, onSelect: () => macro.open(p.name) }));
  const title = clicker ? 'Clicker' : name || 'No macro open';

  return (
    <section className="cmp" aria-label={compactView ? 'Compact view' : 'Compact layout'} data-view={compactView || undefined} data-state={clicker && running ? 'clicking' : status}>
      {/* In the compact view Windows draws its own × at the top right (it hides to the tray there):
          the top leaves it room. */}
      <header className={`cmp-top${compactView ? ' drag-region' : ''}`} style={compactView ? { paddingRight: compactInset - 1 } : undefined}>
        <button type="button" className="cmp-macro no-drag" aria-label={`Choose macro, ${title}`} aria-haspopup="menu" disabled={running || clicker} onClick={choose}>
          <span className="cmp-macro-name">{title}</span>
          {!running && !clicker && <ChevronDown aria-hidden="true" />}
        </button>
        {compactView && (
          <>
            <button type="button" className="cmp-icon no-drag" aria-label="Back to the full window" data-tip="Back to the full window" onClick={() => app.setCompact(false)}>
              <Maximize2 aria-hidden="true" />
            </button>
          </>
        )}
      </header>
      <p className="cmp-state">
        <span className="cmp-dot" />
        <span className="cmp-state-text"><strong>{state}</strong>{detail}</span>
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
      {picker && <Menu anchor={picker.anchor} entries={entries} label="Choose macro" toggle={picker.button} onClose={() => setPicker(null)} />}
    </section>
  );
}
