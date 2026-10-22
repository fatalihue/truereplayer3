import { useReplay } from '../../logic/useReplay';
import { keycaps } from '../library/model';
import { useApp, useShell } from '../store';
import { formatClock } from './model';
import { runSeconds, useNow } from './useNow';

/**
 * Where the run is, beside its Stop: "Step 7 of 18 · Loop 2 of 3" and the clock without pauses.
 * Inside a macro it runs, the step is that macro's ("Step 3 of 11 in Aceitar Trade", D20). Held by
 * a Pause step, it says what lets it go ("Waiting at step 13 · F8 or 3 s") and offers Continue.
 * Mounted only while a run is on, so its once-a-second clock costs nothing at rest; the line under
 * the header is drawn by CSS.
 */
export function RunProgress() {
  const total = useApp(a => a.actions.length);
  const chain = useApp(a => a.replayChain);
  const pause = useApp(a => a.pauseState);
  const clicker = useApp(a => a.settings.useCursorClick);
  const highlight = useShell(s => s.highlight);
  const loop = useShell(s => s.live.loopProgress);
  const chainStep = useShell(s => s.live.chainStep);
  const clicks = useShell(s => s.live.clickerStats.count);
  const clock = useShell(s => s.runClock);
  const now = useNow(true);
  const replay = useReplay();

  const current = highlight != null ? highlight + 1 : 0;
  let text: string;
  if (clicker) {
    text = `Clicking · ${clicks.toLocaleString('en-US')}`;
  } else if (pause.isPaused) {
    const left = pause.timeoutMs > 0
      ? Math.max(0, Math.ceil((pause.timeoutMs - (Math.max(now, pause.startedAt) - pause.startedAt)) / 1000))
      : 0;
    const ways = [pause.hotkey ? keycaps(pause.hotkey) : '', pause.timeoutMs > 0 ? `${left} s` : ''].filter(Boolean).join(' or ');
    text = `Waiting at step ${current}${ways ? ` · ${ways}` : ''}`;
  } else if (chain.length >= 2) {
    const inner = chain[chain.length - 1];
    text = chainStep.active ? `Step ${chainStep.current} of ${chainStep.total} in ${inner}` : `Running ${inner}`;
  } else {
    text = current > 0 ? `Step ${current} of ${total}` : 'Starting';
  }
  if (!clicker && loop.active) text += ` · Loop ${loop.current} of ${loop.total === 0 ? '∞' : loop.total}`;

  return (
    <div className="hdr-progress">
      <span className="hdr-progress-text" data-tip={text} data-tip-reveal="">{text}</span>
      <span className="hdr-progress-clock">{formatClock(runSeconds(clock, now))}</span>
      {pause.isPaused && (
        <button type="button" className="hdr-continue" onClick={replay.resume}>Continue</button>
      )}
      <span className="replay-progress-line hdr-progress-line" role="progressbar" aria-label={clicker ? 'Clicking in progress' : 'Replay in progress'} data-tone={clicker ? 'clicker' : undefined} />
    </div>
  );
}
