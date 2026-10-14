import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useAppState } from '../state/AppStateContext';

// The brand mark: a vector reading of the original robot icon at its SMALL optical size (the
// same drawing memory/tool-make-icons-robot.mjs, variant A, puts in the 16-24 px frames of the
// tray .ico files). Illustration colours come from the --mark-* tokens in index.css — fixed on
// purpose, this is the app's icon — and only the signal ring takes the mode's colour, mirroring
// the three tray icons the backend swaps.

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
  // One green ring when a replay ends. The badge already rings while a run is live, so the end
  // gets the same channel; edge-detected here (replaying → ready) because it is a presentation
  // fact with a 1.5 s life, not state anything else reads.
  const prevStatus = useRef(status);
  const [runDone, setRunDone] = useState(false);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (was !== 'replaying' || status !== 'ready') return;
    setRunDone(true);
    // Clear on CLEANUP, which runs the moment status leaves 'ready'. Only clearing the timer left
    // runDone stuck true when a recording started inside the 1.5 s window (the common case: finish
    // a run, hit the record hotkey) — the next ready edge then pulsed the green "run finished"
    // ring at the end of the RECORDING, and the class stayed on the pill until the next real run.
    // Doing it on the early-return path instead would still paint one frame of the ring, since a
    // passive effect runs after paint.
    const t = setTimeout(() => setRunDone(false), 1500);
    return () => { clearTimeout(t); setRunDone(false); };
  }, [status]);
  // Signal ring in the mode's colour: recording red while a capture is live, clicker purple in
  // Clicker mode, the theme accent otherwise.
  const markRing = status === 'recording'
    ? 'var(--color-recording)'
    : settings.useCursorClick ? 'var(--color-clicker)' : 'var(--color-accent)';

  return (
    <div className="drag-region flex items-center h-titlebar px-4 bg-bg-base border-b border-border-subtle shrink-0">
      {/* Logo */}
      <div className="no-drag flex items-center gap-2.5">
        <svg width="20" height="20" viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
          <rect width="64" height="64" rx="14" fill="var(--mark-ground)" />
          <path d="M7 45 A26 26 0 1 1 57 45" fill="none" stroke={markRing} strokeWidth="6" strokeLinecap="round" className="transition-colors" />
          <ellipse cx="32" cy="32" rx="15" ry="16" fill="var(--mark-silver)" />
          <rect x="19.5" y="28" width="25" height="10.5" rx="5.25" fill="var(--mark-visor)" />
          <circle cx="27" cy="33.25" r="4.6" fill="var(--mark-eye)" />
          <path d="M13 54 c0 -4 8 -7 19 -7 s19 3 19 7 v1 h-38 z" fill="var(--mark-steel)" />
        </svg>
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
        className={`no-drag flex items-center gap-1.5 px-2.5 py-1 rounded-full ${cfg.bg} border ${cfg.border} ${status === 'recording' ? 'rec-badge-pulse' : status === 'replaying' ? 'replay-badge-pulse' : runDone ? 'status-done-pulse' : ''}`}
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
