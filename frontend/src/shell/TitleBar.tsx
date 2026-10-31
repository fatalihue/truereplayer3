import { Search } from 'lucide-react';
import { APP_NAME } from '../appIdentity';
import { useApp, useShell } from './store';
import { BrandMark } from './BrandMark';
import { preload } from './lazyModule';
import { loadPalette, palette } from './palette/paletteState';

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
        <span>{APP_NAME}</span>
      </div>
      <div className="shell-titlebar-middle">
        {/* casca-018: the search that opens Ctrl+K. Out of the drag region, or a click would move the window.
            Its words shorten with the room it has (shell.css); its name stays whole. */}
        <button
          type="button"
          className="shell-search no-drag"
          aria-label="Search macros, steps and commands"
          aria-keyshortcuts="Control+K"
          onClick={palette.open}
          onPointerEnter={() => { void preload(loadPalette); }}
          onFocus={() => { void preload(loadPalette); }}
        >
          {/* lucide's, like the rail's: a CSS mask here was the opening's first SVG image (~2 ms). */}
          <Search aria-hidden="true" />
          <span className="shell-search-text" data-form="long">Search macros, steps and commands</span>
          <span className="shell-search-text" data-form="short">Search</span>
          <kbd className="shell-search-kbd">Ctrl</kbd>
          <kbd className="shell-search-kbd">K</kbd>
        </button>
      </div>
      <StateBadge status={status} clicker={clicker} />
      {/* Compact view (rule 10): the watch draws the button here at the first idle moment (watch.tsx),
          so the opening does not carry it; the slot keeps the bar from moving when it comes. */}
      <span id="tr-compact-slot" className="shell-compact-slot" style={{ marginRight: CAPTION_BUTTONS_PX }} />
    </header>
  );
}

/**
 * The state of the engine, read-only (casca-019): "Ready", "Recording · Untitled macro",
 * "Replaying · Trade Roblox", "Waiting · Trade Roblox" while a Pause step holds the run, and for
 * the Clicker "Starting in 3 s" before the first click (casca-110), "Clicking · 412", and
 * "Paused · 412". A ring goes out from it while something runs, and once, green, when a run ends —
 * drawn by CSS, in transform and opacity (rule 8).
 */
function StateBadge({ status, clicker }: { status: 'ready' | 'recording' | 'replaying'; clicker: boolean }) {
  const open = useApp(a => a.activeProfile);
  const paused = useApp(a => a.pauseState.isPaused);
  const clicks = useShell(s => (status === 'replaying' && clicker ? s.live.clickerStats.count : 0));
  const countdown = useShell(s => (status === 'replaying' && clicker ? Math.ceil(s.live.clickerStats.countdownMs / 1000) : 0));
  const ended = useShell(s => s.runClock.replayEnded);
  let text: string;
  if (status === 'recording') text = open ? `Recording · ${open}` : 'Recording';
  else if (status === 'replaying') {
    if (clicker) text = paused ? `Paused · ${clicks.toLocaleString('en-US')}` : countdown > 0 ? `Starting in ${countdown} s` : `Clicking · ${clicks.toLocaleString('en-US')}`;
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
    >
      <span className="shell-state-dot" />
      <span className="shell-state-text">{text}</span>
    </div>
  );
}
