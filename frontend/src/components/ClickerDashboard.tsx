import { Pause as PauseIcon, Check, Square, AlertTriangle } from 'lucide-react';
import { useAppState, useClickerLive } from '../state/AppStateContext';
import { useBridge } from '../bridge/BridgeContext';
import { usePauseTick } from '../hooks/usePauseTick';
import { describeClickerConfig, formatClickerStats, formatClock, formatEta } from '../utils/clickerFormat';
import { KbdTag } from './common/KbdTag';

import { ClickerEmptyState } from './ClickerEmptyState';

// Live dashboard for Clicker runs. Four visual states:
//   idle + count==0 → defer to ClickerEmptyState
//   counting down   → the seconds left as the hero (button start in a cursor-relative mode)
//   replaying       → bright clicker color, optional progress bar + ETA
//   ready + count>0 → same layout, dimmed, with WHY the run ended
export function ClickerDashboard() {
  const { status, pauseState, settings } = useAppState();
  // Separate context on purpose: these two update ~4×/s during a run, and keeping them out of
  // AppState is what stops every other panel re-rendering at that cadence.
  const { clickerStats } = useClickerLive();
  const { send } = useBridge();
  usePauseTick(pauseState);

  const isReplaying = status === 'replaying';
  // `blocked` too, not just `count`: when another process holds BlockInput, SendInput returns 0,
  // every click is rejected and clickCount stays at 0 — so a run of a hundred rejected clicks
  // fell back to the empty state and the "N clicks were rejected by Windows" line, which only
  // renders below this gate, was never mounted. Gating on `blocked` rather than on "a run ended"
  // keeps a Stop during the 3 s countdown (reason 'stopped', nothing clicked, nothing blocked)
  // showing the instructions instead of a dead all-zeros panel.
  if (!isReplaying && clickerStats.count === 0 && clickerStats.blocked === 0) return <ClickerEmptyState />;

  // Button-start countdown (ClickerRunConfig.StartDelayMs): the engine is waiting for the user
  // to move the mouse off the button that has just become "Stop". Nothing has been clicked yet.
  const counting = isReplaying && clickerStats.countdownMs > 0;
  const countdownSec = Math.ceil(clickerStats.countdownMs / 1000);

  const { elapsed, rate, rateLabel } = formatClickerStats(clickerStats.count, clickerStats.elapsedMs);
  // The two limits. The click limit comes from SETTINGS (see below); the time limit rides on
  // clicker:stats (capMs; 0 = none). Either, both or neither may be armed.
  //
  // Unit note: formatEta does remaining = total - current, then etaSec = remaining / rate, so
  // total, current and rate must share a unit. Rate is clicks per second, and in Clicker mode the
  // backend runs exactly ONE click per loop iteration (ToggleCursorClickReplay increments
  // clickCount and iteration in lockstep), so the Loops setting is measured in CLICKS. If the
  // clicker ever runs N clicks per iteration, convert before passing.
  //
  // The click limit is read from SETTINGS rather than from loopProgress. The engine only emits
  // macro:loopProgress for `isInfinite || loopCount > 1`, so a run with Loops = 1 never set
  // `active` and the Limit cell fell through to "∞" for the most bounded run there is — and
  // during the 3 s countdown nothing had been emitted yet either, so every run started by
  // claiming to be unbounded. Settings are the same source describeClickerConfig reads two lines
  // up, which makes the cell and the config line structurally unable to disagree. The trade: a
  // settings edit mid-run shows the new limit rather than the running one.
  const settingsLoops = settings.cursorClickUseLoops ? parseInt(settings.cursorClickLoops, 10) : 0;
  const clickLimit = Number.isFinite(settingsLoops) && settingsLoops > 0 ? settingsLoops : 0;
  // The TIME limit comes from the same place, and for the same reason the click limit does: it
  // used to arrive on a stats frame, and during the 3 s countdown no frame has been sent yet — so
  // a run armed with only a time limit spent its whole countdown claiming to be unbounded ("∞")
  // and then snapped to a clock. The trade is the one the comment above already accepted for the
  // click limit: a settings edit mid-run shows the new limit rather than the running one. Three
  // consumers read this — the ETA, the time half of the progress bar, and the Limit cell — so
  // they now agree with each other and with the config line.
  const settingsCapMs = settings.cursorClickUseMaxDuration ? parseInt(settings.cursorClickMaxDuration, 10) : 0;
  const capMs = Number.isFinite(settingsCapMs) && settingsCapMs > 0 ? settingsCapMs : 0;
  // A finished run has no time-to-finish — gate on isReplaying so a completed limit renders
  // "—" instead of "~0s"; the countdown has no samples yet, so it reads "—" too.
  const etaText = formatEta(isReplaying && !counting, clickLimit, clickerStats.count, rate, capMs, clickerStats.elapsedMs);
  // Progress toward whichever armed limit is closer — the bar answers "how far along is this
  // run", and with both limits armed the nearer one is the one that will end it.
  // Progress uses the live click count, not loopProgress.current: with the limit now coming from
  // settings, a Loops = 1 run has a limit but never receives a loopProgress frame, and the two
  // are the same number anyway (one click per iteration in Clicker mode).
  const clickPct = clickLimit > 0 ? Math.min(100, (clickerStats.count / clickLimit) * 100) : null;
  const timePct = capMs > 0 ? Math.min(100, (clickerStats.elapsedMs / capMs) * 100) : null;
  const progressPct = clickPct === null && timePct === null ? null : Math.max(clickPct ?? 0, timePct ?? 0);
  // The Limit cell shows the TARGET, not the running count: the hero already IS the count, and
  // the old "LOOP 1284/5000" printed it twice in macro vocabulary — worse, an unbounded run
  // read "1284/∞", the same number as the hero with an infinity glued on.
  const limitText = clickLimit > 0 && capMs > 0
    ? `${clickLimit} · ${formatClock(capMs)}`
    : clickLimit > 0 ? String(clickLimit)
    : capMs > 0 ? formatClock(capMs)
    : '∞';

  // Why the run ended (clicker:ended). null = a run from before this message existed.
  const ended = clickerStats.endReason;
  const endLabel = ended === 'stopped' ? 'stopped'
    : ended === 'time' ? "time's up"
    : ended === 'clicks' ? 'limit reached'
    : ended === 'error' ? 'failed'
    : 'finished';
  const EndIcon = ended === 'stopped' ? Square : ended === 'error' ? AlertTriangle : Check;

  const pauseRemainingSec = pauseState.timeoutMs > 0
    ? Math.max(0, Math.ceil((pauseState.timeoutMs - (Date.now() - pauseState.startedAt)) / 1000))
    : 0;

  // Compact recall — shared with the empty state through describeClickerConfig, so the line
  // the user reads before the first run and the one they read after it can never disagree.
  // Hold-aware rate, the engine's precedence for the "where" (Area > Fixed > Position), and
  // both limits. The rate used to be 1000 / (delay + gap): with a 200 ms hold it printed 10/s
  // for a run the engine delivers at ~5/s.
  const summary = describeClickerConfig(settings);

  return (
    // Standard theme surface (same as the macro ActionTable) — no purple glass gradient or
    // clicker-tinted border. The clicker identity now lives only in the text/icon colours
    // (--color-clicker), mirroring how macro mode keeps its green identity on text alone.
    <div className="flex-1 flex flex-col items-center justify-center gap-6 bg-bg-surface min-h-0 relative overflow-hidden px-4">
      {/* tabular-nums prevents digit-width jitter as the count climbs. */}
      <div className="flex flex-col items-center">
        <div
          className="font-mono font-bold tabular-nums"
          style={{
            fontSize: 'clamp(56px, 10vw, 112px)',
            color: 'var(--color-clicker-fg)',
            lineHeight: 1,
            letterSpacing: '-0.02em',
          }}
        >
          {counting ? countdownSec : clickerStats.count.toLocaleString()}
        </div>
        <div
          className="text-[11px] uppercase tracking-[0.2em] mt-2 flex items-center gap-2"
          style={{ color: 'var(--color-clicker-fg)', opacity: 0.7 }}
        >
          {counting ? 'starting in' : 'clicks'}
          {!isReplaying && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span className="flex items-center gap-1">
                <EndIcon size={10} fill={ended === 'stopped' ? 'currentColor' : 'none'} />
                {endLabel}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 w-full max-w-[480px]">
        <StatCell value={counting ? '—' : `${rateLabel}/s`} label="Rate" dim={counting} />
        <StatCell value={elapsed} label="Elapsed" />
        <StatCell value={limitText} label="Limit" dim={limitText === '∞'} />
        <StatCell value={etaText} label="ETA" dim={etaText === '—'} />
      </div>

      {progressPct !== null && (
        <div className="w-full max-w-[480px]">
          <div className="h-[3px] bg-bg-elevated rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${progressPct}%`, background: 'var(--color-clicker)' }}
            />
          </div>
        </div>
      )}

      {/* Config recall (button · rate · limits · where …) — text-secondary, not
          text-disabled, so it stays readable. The faded disabled colour blended
          into the gradient and was hard to make out. */}
      <div className="text-[11px] text-text-secondary font-mono text-center max-w-[480px]">
        {summary.bits.join('  ·  ')}
      </div>

      {/* SendInput rejected some calls outright (BlockInput held by another app, never UIPI —
          UIPI is silent). The log always had this number; the dashboard reported a healthy run. */}
      {!isReplaying && clickerStats.blocked > 0 && (
        <div className="text-[11px] font-medium" style={{ color: 'var(--color-warning-ink)' }}>
          {`${clickerStats.blocked} ${clickerStats.blocked === 1 ? 'click was' : 'clicks were'} rejected by Windows — input was blocked`}
        </div>
      )}

      {/* UIPI: the window under the cursor runs elevated and we do not. SendInput says yes and
          Windows drops the click — the one failure the counter cannot see (see ClickerButton),
          found by comparing integrity levels at the stats cadence (ProcessIntegrity). */}
      {clickerStats.warning === 'elevatedTarget' && (
        <div className="text-[11px] font-medium text-center max-w-[480px]" style={{ color: 'var(--color-warning-ink)' }}>
          {'The window under the cursor runs as administrator — Windows drops these clicks. Run TrueReplayer as administrator.'}
        </div>
      )}

      {/* Pause — only while actively clicking and not already paused (pausing a countdown
          would be a stall with nothing to resume into). Pausing freezes the loop (and excludes
          the paused span from CPS); the overlay's Resume button below resumes it. */}
      {isReplaying && !counting && !pauseState.isPaused && (
        <button
          onClick={() => send({ type: 'clicker:pause', payload: {} })}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-ui border border-border-default text-[12px] font-medium transition-colors hover:bg-bg-elevated"
          style={{ color: 'var(--color-clicker-fg)' }}
        >
          <PauseIcon size={13} fill="currentColor" /> Pause
        </button>
      )}

      {/* KbdTag, not a raw <kbd>: it spells the key the way the keycap does (PgDn, not
          PageDown) and splits a combo into one cap per key — the same rendering the Keys tab
          uses for these two settings, so the dashboard and the panel name the key alike. */}
      <div className="text-[11px] text-text-tertiary flex items-center gap-1.5">
        {counting ? (
          <>
            {'Move the mouse to the target —'}
            <KbdTag combo={settings.cursorClickStartHotkey} accent />
            {'or Stop cancels'}
          </>
        ) : (
          <>
            {'Press'}
            <KbdTag combo={settings.cursorClickStartHotkey} accent />
            {isReplaying ? 'to stop' : 'to run again'}
            {isReplaying && (
              <>
                <span className="opacity-40">·</span>
                <KbdTag combo={settings.cursorClickPauseHotkey} accent />
                {'to pause'}
              </>
            )}
          </>
        )}
      </div>

      {pauseState.isPaused && (
        <div
          className="absolute inset-0 flex items-center justify-center backdrop-blur-sm"
          // Dim toward the theme's own base, not to black. This is an in-panel state overlay
          // on a themed surface, not a modal over the whole app (DialogShell's bg-black/50
          // stays as it is) — and a black wash over the 11 light presets read as a bug.
          style={{ background: 'color-mix(in srgb, var(--color-bg-base) 82%, transparent)' }}
        >
          <div
            className="flex flex-col items-center gap-3 px-6 py-5 rounded-ui border"
            style={{
              borderColor: 'var(--color-action-pause-fg)',
              background: 'var(--color-bg-base)',
            }}
          >
            <PauseIcon size={28} style={{ color: 'var(--color-action-pause-fg)' }} fill="currentColor" />
            <div className="text-[16px] font-semibold tracking-wider" style={{ color: 'var(--color-action-pause-fg)' }}>
              PAUSED
            </div>
            {/* The clicker fires OnReplayPaused("", 0), so both of these are always falsy for
                a clicker pause and this line never rendered — the overlay showed PAUSED and a
                button, and never named the hotkey that also resumes. Fall back to the
                configured pause key: this component only mounts in Clicker mode, so that is
                always the right one. A flex row (gap-x for the word spacing) because KbdTag
                renders block caps that have to sit on the text baseline. */}
            <div className="text-[11px] text-text-secondary flex flex-wrap items-center justify-center gap-x-1">
              {pauseState.hotkey || pauseState.timeoutMs > 0 ? (
                <>
                  {pauseState.hotkey && <>{'Press'}<KbdTag combo={pauseState.hotkey} accent /></>}
                  {pauseState.hotkey && pauseState.timeoutMs > 0 ? 'or' : ''}
                  {pauseState.timeoutMs > 0 && <>{'wait'}<span className="font-mono">{pauseRemainingSec}s</span></>}
                </>
              ) : (
                <>
                  {'Press'}
                  <KbdTag combo={settings.cursorClickPauseHotkey} accent />
                  {'or click Resume'}
                </>
              )}
            </div>
            <button
              onClick={() => send({ type: 'replay:resume', payload: {} })}
              className="px-3 py-1 text-[12px] font-medium rounded border border-border-default text-text-primary hover:bg-bg-elevated transition-colors"
            >
              Resume
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// `dim` greys cells whose value is "—" / "∞" so they read as N/A rather than broken. A value
// longer than seven characters ("5000 · 2:00", both limits armed) steps down one size so it
// stays inside its ~112 px cell instead of clipping.
function StatCell({ value, label, dim = false }: { value: string; label: string; dim?: boolean }) {
  return (
    <div
      // Solid surface (was bg-bg-surface/40) — the translucent cells contributed
      // to the glassy look and made the numbers harder to read on the gradient.
      className={`flex flex-col items-center py-2 px-1 rounded border border-border-subtle bg-bg-surface ${dim ? 'opacity-40' : ''}`}
    >
      <div className={`${value.length > 7 ? 'text-[14px]' : 'text-[18px]'} font-mono font-semibold text-text-primary tabular-nums leading-tight`}>
        {value}
      </div>
      {/* text-caption (11px) = the type-ramp floor for meaningful text; tracking
          eased 0.15em→0.12em so the absolute letterspacing (~1.3px) matches the
          old 9px look and the label doesn't spread in these narrow cells. */}
      <div className="text-caption uppercase tracking-[0.12em] text-text-tertiary mt-1">
        {label}
      </div>
    </div>
  );
}
