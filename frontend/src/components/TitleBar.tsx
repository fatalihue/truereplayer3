import { Search } from 'lucide-react';
import { useAppState } from '../state/AppStateContext';

// The TR monogram (memory/asset-mark-tr.svg): five round-capped strokes in a 24-unit box. Kept
// inline so the mark paints with theme tokens — the same drawing the tray .ico files and the
// Assets tiles are generated from (memory/tool-make-icons.mjs). 2.6 is the small-size stroke: at
// the 14px this renders, 2.2 would come out as a 1.3px line and fuzz.
const MARK_PATHS = ['M3.5 5.5h11.5', 'M8.5 5.5V19', 'M14 10.5V19', 'M14 10.5h3.2a2.6 2.6 0 0 1 0 5.2H14', 'M16.4 15.7l3 3.3'];

// Right margin reserved for the Windows native caption-button strip
// (minimize / maximize / close), which is overlaid on the right edge of the
// custom title bar. Without this gap the status badge would sit underneath the
// caption buttons. Matches the previous `mr-[140px]` (140px = margin-right: 140px).
const CAPTION_BUTTONS_WIDTH_PX = 140;

const statusConfig = {
  ready:     { dot: 'bg-replay',    text: 'Ready',     bg: 'bg-replay-bg',    border: 'border-replay/20' },
  recording: { dot: 'bg-recording', text: 'Recording', bg: 'bg-recording-bg', border: 'border-recording/20' },
  // bg was a literal rgba(96,205,255,…) — a stale cyan frozen from an old accent
  // that never followed theme changes. accent/10 tracks every preset.
  replaying: { dot: 'bg-accent',    text: 'Replaying', bg: 'bg-accent/10',    border: 'border-accent/20' },
};

interface TitleBarProps {
  onOpenCommandPalette?: () => void;
}

export function TitleBar({ onOpenCommandPalette }: TitleBarProps) {
  const { status, settings } = useAppState();
  const cfg = statusConfig[status];
  // The mark takes the mode's colour, mirroring the three tray icons the backend swaps:
  // recording red while a capture is live, clicker purple in Clicker mode, accent otherwise.
  // Fill and ink are the paired tokens (the -ink rung is contrast-picked per theme), never a
  // literal, so every preset paints its own pair.
  const markFill = status === 'recording'
    ? 'var(--color-recording)'
    : settings.useCursorClick ? 'var(--color-clicker)' : 'var(--color-accent-solid)';
  const markInk = status === 'recording'
    ? 'var(--color-recording-ink)'
    : settings.useCursorClick ? 'var(--color-clicker-ink)' : 'var(--color-accent-ink)';

  return (
    <div className="drag-region flex items-center h-[48px] px-4 bg-bg-base border-b border-border-subtle shrink-0">
      {/* Logo */}
      <div className="no-drag flex items-center gap-2.5">
        <div
          className="w-5 h-5 rounded-[5px] flex items-center justify-center transition-colors"
          style={{ background: markFill, color: markInk }}
          aria-hidden="true"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            {MARK_PATHS.map((d) => <path key={d} d={d} />)}
          </svg>
        </div>
        <span className="text-xs text-text-secondary">TrueReplayer</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Command Palette Trigger */}
      {onOpenCommandPalette && (
        <button
          onClick={onOpenCommandPalette}
          className="no-drag flex items-center gap-2 px-3 py-1 bg-bg-surface border border-border-subtle rounded-ui hover:border-border-default hover:bg-bg-elevated transition-colors cursor-pointer min-w-[260px]"
        >
          {/* tertiary, not disabled — this is a live control's label (~2:1 as disabled) */}
          <Search size={13} className="text-text-tertiary" />
          <span className="text-xs text-text-tertiary flex-1 text-left">Search profiles, actions, commands...</span>
          <div className="flex gap-0.5">
            <span className="kbd">Ctrl</span>
            <span className="kbd">K</span>
          </div>
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Status badge — while recording (red) OR replaying (accent) it emits an expanding ring
          (.rec-badge-pulse / .replay-badge-pulse in index.css) so the live state is unmistakable
          without a full-viewport frame. */}
      <div
        className={`no-drag flex items-center gap-1.5 px-2.5 py-1 rounded-full ${cfg.bg} border ${cfg.border} ${status === 'recording' ? 'rec-badge-pulse' : status === 'replaying' ? 'replay-badge-pulse' : ''}`}
        style={{ marginRight: CAPTION_BUTTONS_WIDTH_PX }}
      >
        {/* Dot pulses only while a run is LIVE — an idle "Ready" pulsing forever
            was motion with no meaning (and ignored the Animations toggle: inline
            style bypassed the data-animations gate; the class rule respects it). */}
        <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${status !== 'ready' ? 'status-dot-pulse' : ''}`} />
        <span className="text-[11px] font-medium text-text-primary">{cfg.text}</span>
      </div>
    </div>
  );
}
