import { useApp, useShell } from './store';
import { BrandMark } from './BrandMark';
import { NotBuilt } from './NotBuilt';

// The native caption buttons (minimize, maximize, close) sit over the right edge of the title bar.
// They keep their device size whatever the UI scale is, so this gap stays in px.
const CAPTION_BUTTONS_PX = 140;

/** ① The title bar: the mark, Ctrl+K in the middle, and the state of the engine on the right. */
export function TitleBar() {
  const status = useApp(a => a.status);
  const clicker = useApp(a => a.settings.useCursorClick);
  const ring = status === 'recording' ? 'var(--color-recording)' : clicker ? 'var(--color-clicker)' : 'var(--color-accent)';
  return (
    <header className="shell-titlebar drag-region">
      <div className="shell-brand">
        <BrandMark ring={ring} />
        <span>TrueReplayer</span>
      </div>
      <div className="shell-titlebar-middle">
        <NotBuilt what="Ctrl+K" />
      </div>
      <StateBadge status={status} clicker={clicker} />
    </header>
  );
}

/**
 * The state of the engine, read-only (casca-019): "Ready", "Recording · Untitled macro",
 * "Replaying · Trade Roblox", "Waiting · Trade Roblox" while a Pause step holds the run, and
 * "Clicking · 412" for the Clicker. A ring goes out from it while something runs, and once, green,
 * when a run ends — drawn by CSS, in transform and opacity (rule 8).
 */
function StateBadge({ status, clicker }: { status: 'ready' | 'recording' | 'replaying'; clicker: boolean }) {
  const open = useApp(a => a.activeProfile);
  const paused = useApp(a => a.pauseState.isPaused);
  const clicks = useShell(s => (status === 'replaying' && clicker ? s.live.clickerStats.count : 0));
  const ended = useShell(s => s.runClock.replayEnded);
  let text: string;
  if (status === 'recording') text = open ? `Recording · ${open}` : 'Recording';
  else if (status === 'replaying') {
    if (clicker) text = `Clicking · ${clicks.toLocaleString('en-US')}`;
    else text = `${paused ? 'Waiting' : 'Replaying'}${open ? ` · ${open}` : ''}`;
  } else text = clicker ? 'Clicker' : 'Ready';
  const live = status !== 'ready' || undefined;
  return (
    <div
      role="status"
      className="shell-state"
      data-state={clicker && status === 'replaying' ? 'clicking' : status}
      data-live={live}
      data-done={(status === 'ready' && ended) || undefined}
      style={{ marginRight: CAPTION_BUTTONS_PX }}
    >
      <span className="shell-state-dot" />
      <span className="shell-state-text">{text}</span>
    </div>
  );
}
