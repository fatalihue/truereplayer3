import { useEffect, useRef, useState } from 'react';
import { Play, Pause as PauseIcon, MousePointerClick, Folder, List, Gauge, Clock, Repeat, Unplug, Chrome, Timer, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useAppState, useClickerLive, useHighlightedAction } from '../state/AppStateContext';
import { useBridge } from '../bridge/BridgeContext';
import { usePauseTick } from '../hooks/usePauseTick';
import { useBrowserConnection } from '../hooks/useBrowserConnection';
import { useTt, useLanguage } from '../state/LanguageContext';
import type { RunReport } from '../bridge/messageTypes';
import { describeClickerConfig, formatClickerStats, formatRate } from '../utils/clickerFormat';
import { formatKeyCombo } from '../utils/displayUtils';
import { APP_VERSION } from '../appVersion';

// What the bar keeps of the last finished run: enough to say "18/18 in 12.4 s" or "stopped at
// step 7" beside the profile it belongs to, and to open the full report on click. Derived from the
// replay:report the backend pushes on its own at the end of every run (WebViewBridge, the
// ready-after-replaying edge), so no new message and nothing polled.
interface LastRunSummary { profile: string; total: number; ok: number; failedRow: number | null; durationMs: number; }

// Per-action cost the estimate adds on top of the delays: the engine's dispatch, a click's hold,
// a keystroke's press/release. Deliberately a floor — smooth mouse moves (distance-bound) and
// waits (timeout-bound) cannot be read off the grid and are left out; the tooltip says so.
const PER_ACTION_OVERHEAD_MS = 30;

function fmtDuration(ms: number, language: 'en' | 'pt-BR'): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toLocaleString(language === 'pt-BR' ? 'pt-BR' : 'en-US', { maximumFractionDigits: 1 })} s`;
}

// Thin vertical divider between status segments.
const Sep = () => <div className="w-px h-3 bg-border-subtle mx-3 shrink-0" />;

export function StatusBar() {
  const { statusBar, status, replayChain, pauseState, settings, actions } = useAppState();
  // Separate contexts on purpose: the live slices update ~4×/s during a run and the highlight
  // advances once per executed action; keeping them out of AppState is what stops every other
  // panel re-rendering at those cadences.
  const { clickerStats, loopProgress, chainStep } = useClickerLive();
  const highlightedActionIndex = useHighlightedAction();
  // Debounced on the way DOWN only — see the hook. Read here rather than in AppState so a
  // reconnect can't re-render every consumer of the store.
  const browserConnection = useBrowserConnection();
  const tt = useTt();
  const { language } = useLanguage();
  const { send, subscribe } = useBridge();

  // Last finished run, from the automatic end-of-run report push. A report requested mid-run
  // carries a 'running' step and is not a finished run; skipped rows count for neither side.
  const [lastRun, setLastRun] = useState<LastRunSummary | null>(null);
  useEffect(() => subscribe((msg) => {
    if (msg.type !== 'replay:report') return;
    const r = msg.payload as RunReport;
    if (!r.startedAt || r.steps.length === 0 || r.steps.some(s => s.status === 'running')) return;
    const counted = r.steps.filter(s => s.status !== 'skipped');
    const failed = r.steps.find(s => s.status === 'failed');
    setLastRun({
      profile: r.steps[0].profile || r.profile,
      total: counted.length,
      ok: counted.filter(s => s.status === 'ok').length,
      failedRow: failed ? failed.row : null,
      durationMs: r.steps.reduce((a, s) => a + s.durationMs, 0),
    });
  }), [subscribe]);

  // The delays added up plus a per-action floor — the number the grid can promise before a run.
  const estimateMs = actions.reduce((sum, a) => sum + (a.delay > 0 ? a.delay : 0) + PER_ACTION_OVERHEAD_MS, 0);
  const isReplaying = status === 'replaying';
  const isClicker = settings.useCursorClick;
  // The engine's stack already includes the root profile at index 0, so we only
  // render "Running ..." when the chain has at least 2 entries (root + a sub-call).
  // While running A alone, replayChain is ['A'] and we leave the chain hidden.
  const chainLabel = replayChain.length >= 2 ? replayChain.join(' → ') : null;
  // Step counter for the DEEPEST frame — the one the chain label ends with, and the only one
  // actually executing. The main progress read-out to the left can't say this: it is derived
  // from the grid highlight, which is blind to rows that aren't in the loaded profile, so it
  // sits frozen on the caller's RunProfile row until the sub-call returns. Rendered only while
  // the engine is feeding it, so a chain shows plain "A → B" rather than a stale "(4/11)" in
  // the gap between entering a sub-profile and its first step landing.
  const chainStepLabel = chainLabel && chainStep.active
    ? `${chainStep.current}/${chainStep.total}`
    : null;

  // Elapsed timer. Anchored to Date.now() rather than an accumulating per-tick
  // counter (setInterval is throttled in background tabs / under load, which made
  // the old `prev + 1` drift below wall-clock). Paused intervals are subtracted so a
  // pause no longer inflates the count. Limitation: no backend macro elapsed exists,
  // so this measures from when the UI observes the start/pause edges; a sub-second
  // offset vs the engine's true start is possible, but it no longer drifts.
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);          // Date.now() at the replay-start edge.
  const pausedAccumRef = useRef(0);    // total resolved paused ms.
  const pauseStartRef = useRef(0);     // Date.now() captured when the current pause began.
  const wasPausedRef = useRef(false);  // previous isPaused, to detect edges.

  useEffect(() => {
    if (!isReplaying) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      startRef.current = 0;
      pausedAccumRef.current = 0;
      pauseStartRef.current = 0;
      wasPausedRef.current = false;
      setElapsed(0);
      return;
    }

    if (startRef.current === 0) {
      startRef.current = Date.now();
      pausedAccumRef.current = 0;
      pauseStartRef.current = 0;
      wasPausedRef.current = false;
    }

    // Pause-begin edge: capture the pause start while pauseState.startedAt is still set.
    if (!wasPausedRef.current && pauseState.isPaused) {
      pauseStartRef.current = pauseState.startedAt > 0 ? pauseState.startedAt : Date.now();
    }
    // Resume edge: fold the just-ended pause in using the CAPTURED start (pauseState.startedAt
    // is already 0 here because replay:resumed zeroes it in the same dispatch).
    if (wasPausedRef.current && !pauseState.isPaused && pauseStartRef.current > 0) {
      pausedAccumRef.current += Math.max(0, Date.now() - pauseStartRef.current);
      pauseStartRef.current = 0;
    }
    wasPausedRef.current = pauseState.isPaused;

    const compute = () => {
      // While paused, freeze: subtract the in-progress pause using the captured start.
      const livePause = pauseState.isPaused && pauseStartRef.current > 0
        ? Math.max(0, Date.now() - pauseStartRef.current)
        : 0;
      const ms = Date.now() - startRef.current - pausedAccumRef.current - livePause;
      setElapsed(Math.max(0, Math.floor(ms / 1000)));
    };
    compute();

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(compute, 1000);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isReplaying, pauseState.isPaused, pauseState.startedAt]);

  const total = statusBar.actionCount;
  const current = highlightedActionIndex != null ? highlightedActionIndex + 1 : 0;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, '0');

  usePauseTick(pauseState);

  const pauseRemainingSec = pauseState.timeoutMs > 0
    ? Math.max(0, Math.ceil((pauseState.timeoutMs - (Date.now() - pauseState.startedAt)) / 1000))
    : 0;

  // Clicker mode shows whether it's mid-run (live stats) or idle (config summary).
  const clickerRunning = isReplaying || clickerStats.count > 0;
  // Target rate — the cadence the ENGINE will produce, not 1000/delay: the interval is part of
  // the period and the hold can cap it. One reading shared with the dashboard and the empty
  // state (describeClickerConfig), so the three surfaces cannot disagree by construction.
  const clickerTargetCps = describeClickerConfig(settings).rateCps;

  return (
    <div className="flex items-center h-[26px] px-4 bg-bg-base border-t border-border-subtle shrink-0 text-[11px] font-small">
      {isClicker ? (
        /* ── CLICKER MODE ── profile/action-count are meaningless here, so the bar
            shows the clicker's own context instead: button + target rate when idle,
            live Clicked/rate/elapsed once it's running. */
        clickerRunning ? (() => {
          // Button-start countdown: nothing has been clicked yet, so "Clicked 0 · 0.0/s" would
          // read as a broken run. Say what the engine is waiting for instead.
          if (isReplaying && clickerStats.countdownMs > 0) {
            return (
              <span className="flex items-center gap-2 font-mono" style={{ color: 'var(--color-clicker-fg)' }}>
                <MousePointerClick size={11} className="shrink-0" />
                <span className="text-text-secondary">Starting in</span>
                <strong className="text-text-primary">{Math.ceil(clickerStats.countdownMs / 1000)} s</strong>
                <span className="text-text-secondary">— move the mouse to the target</span>
              </span>
            );
          }
          const { elapsed: clickerElapsed, rateLabel } = formatClickerStats(clickerStats.count, clickerStats.elapsedMs);
          return (
            <span className="flex items-center gap-2 font-mono" style={{ color: 'var(--color-clicker-fg)' }}>
              <MousePointerClick size={11} className="shrink-0" />
              <span className="text-text-secondary">Clicked</span>
              <strong className="text-text-primary">{clickerStats.count.toLocaleString()}</strong>
              <span className="text-text-disabled">·</span>
              <strong className="text-text-primary">{rateLabel}/s</strong>
              <span className="text-text-disabled">·</span>
              <span className="flex items-center gap-1 text-text-secondary"><Clock size={10} />{clickerElapsed}</span>
              {/* The window under the cursor runs elevated and we do not: SendInput says yes,
                  Windows drops the click, and the counter keeps climbing. This bar is often the
                  only part of the window visible behind the target, so it carries the word. */}
              {clickerStats.warning === 'elevatedTarget' && (
                <>
                  <div className="w-px h-3 bg-border-subtle shrink-0" />
                  <span
                    className="flex items-center gap-1 text-[11px] font-medium whitespace-nowrap"
                    style={{ color: 'var(--color-warning-ink)' }}
                    data-tip={tt('Windows drops clicks on elevated windows — run as administrator', 'O Windows descarta cliques em janelas elevadas — rode como administrador')}
                  >
                    <AlertTriangle size={10} className="shrink-0" />
                    elevated target
                  </span>
                </>
              )}
              {/* Pause was drawn only in the macro branch, so a paused clicker showed frozen
                  stats with nothing saying why — and this bar is usually the only part of the
                  window visible behind a game. */}
              {pauseState.isPaused && (
                <>
                  <div className="w-px h-3 bg-border-subtle shrink-0" />
                  <PauseIcon size={10} className="shrink-0" style={{ color: 'var(--color-action-pause-fg)' }} fill="currentColor" />
                  <span className="text-[11px] font-medium whitespace-nowrap" style={{ color: 'var(--color-action-pause-fg)' }}>
                    {/* Keycap spelling (PgUp, Ctrl + F9), the same the Keys tab shows for this key. */}
                    PAUSED{settings.cursorClickPauseHotkey && ` — ${formatKeyCombo(settings.cursorClickPauseHotkey)}`}
                  </span>
                  <button
                    onClick={() => send({ type: 'replay:resume', payload: {} })}
                    className="px-2 py-0.5 text-[10px] font-medium rounded border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors shrink-0"
                  >
                    Resume
                  </button>
                </>
              )}
            </span>
          );
        })() : (
          <>
            <span className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--color-clicker-fg)' }}>
              <MousePointerClick size={11} />
              Clicker
            </span>
            <Sep />
            <span className="text-text-secondary">{settings.cursorClickButton} button</span>
            {clickerTargetCps > 0 && (
              <>
                <Sep />
                <span className="flex items-center gap-1.5 text-text-tertiary">
                  <Gauge size={11} />
                  <span className="text-text-secondary font-mono">~{formatRate(clickerTargetCps)}/s</span>
                </span>
              </>
            )}
          </>
        )
      ) : (
        /* ── MACRO MODE ── idle shows the active profile + action count; a live replay
            replaces them with the progress read-out (which already carries the count
            via current/total). The loop counter persists across the run→ready edge. */
        <>
          {!isReplaying && (
            <>
              <span className="flex items-center gap-1.5 text-text-tertiary">
                <Folder size={11} />
                <span className="text-text-primary font-medium">{statusBar.profileName ?? 'No profile'}</span>
              </span>
              <Sep />
              <span className="flex items-center gap-1.5 text-text-tertiary">
                <List size={11} />
                <span className="text-text-secondary">{statusBar.actionCount} actions</span>
              </span>
              {/* Two readouts the bar did not carry: what the grid will cost, and how the last run
                  ended. Both are readouts, not controls — the report itself stays where the
                  palette put it; the chip only opens it. Hidden when the loaded profile is not
                  the one that ran, so a switch cannot pin another profile's result to this name.
                  Visible text stays English (labels); the tooltips are the bilingual half. */}
              {actions.length > 0 && (
                <>
                  <Sep />
                  <span
                    className="flex items-center gap-1.5 text-text-tertiary"
                    data-tip={tt('Delays + ~30 ms per action. Moves and waits not counted.', 'Atrasos + ~30 ms por ação. Movimentos e esperas não entram.')}
                  >
                    <Timer size={11} />
                    <span className="text-text-secondary font-mono">~{fmtDuration(estimateMs, language)}</span>
                  </span>
                </>
              )}
              {lastRun && lastRun.profile === statusBar.profileName && (
                <>
                  <Sep />
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('cmd:runreport'))}
                    className="flex items-center gap-1.5 px-1 -mx-1 rounded hover:bg-bg-elevated transition-colors"
                    style={{ color: lastRun.failedRow == null ? 'var(--color-replay-fg)' : 'var(--color-recording-fg)' }}
                    data-tip={tt('Open the run report', 'Abrir o relatório da execução')}
                  >
                    {lastRun.failedRow == null ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                    <span className="font-medium">{lastRun.failedRow == null ? 'last run' : `stopped at step ${lastRun.failedRow}`}</span>
                    <span className="font-mono text-text-secondary">{lastRun.ok}/{lastRun.total} · {fmtDuration(lastRun.durationMs, language)}</span>
                  </button>
                </>
              )}
            </>
          )}

          {isReplaying && (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <Play size={10} className="text-accent shrink-0" fill="currentColor" />
              <span className="text-[11px] font-medium font-mono text-accent shrink-0">
                {current} / {total}
              </span>
              <div className="h-[2px] bg-bg-elevated rounded-full overflow-hidden shrink-0" style={{ flex: '0 1 160px' }}>
                <div
                  className="h-full bg-accent-solid rounded-full transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="flex items-center gap-1 text-[11px] text-text-tertiary font-mono shrink-0">
                <Clock size={10} />{minutes}:{seconds}
              </span>
              {chainLabel && (
                <>
                  <div className="w-px h-3 bg-border-subtle shrink-0" />
                  <span
                    className="flex items-center gap-1.5 text-[11px] font-mono whitespace-nowrap min-w-0"
                    style={{ color: 'var(--color-action-runprofile-fg)' }}
                    data-tip={chainStepLabel ? `${chainLabel} · ${chainStepLabel}` : chainLabel}
                  >
                    <Repeat size={10} className="shrink-0" />
                    {/* The NAME is what gives: it's user text of unbounded length, and the whole
                        of it is already in the tooltip. The counter is the new information and is
                        never more than a few characters, so it stays whole. Without min-w-0 the
                        nowrap span refuses to shrink at all and pushes the clock and the version
                        off the right edge — reachable with one long profile name, and the bar is
                        already tight below the ~1074 px auto-collapse width. */}
                    <span className="truncate">{chainLabel}</span>
                    {chainStepLabel && (
                      <span className="text-text-tertiary shrink-0">({chainStepLabel})</span>
                    )}
                  </span>
                </>
              )}
              {pauseState.isPaused && (
                <>
                  <div className="w-px h-3 bg-border-subtle shrink-0" />
                  <PauseIcon size={10} className="shrink-0" style={{ color: 'var(--color-action-pause-fg)' }} fill="currentColor" />
                  <span className="text-[11px] font-medium whitespace-nowrap" style={{ color: 'var(--color-action-pause-fg)' }}>
                    PAUSED
                    {pauseState.hotkey && ` — Press ${formatKeyCombo(pauseState.hotkey)}`}
                    {pauseState.hotkey && pauseState.timeoutMs > 0 ? ' or ' : pauseState.timeoutMs > 0 ? ' — ' : ''}
                    {pauseState.timeoutMs > 0 && `wait ${pauseRemainingSec}s`}
                  </span>
                  <button
                    onClick={() => send({ type: 'replay:resume', payload: {} })}
                    className="px-2 py-0.5 text-[10px] font-medium rounded border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors shrink-0"
                  >
                    Resume
                  </button>
                </>
              )}
            </div>
          )}

          {/* Loop counter — survives the replaying→ready transition (the backend keeps
              loopProgress.active true briefly after the final iteration) so the user can
              read the final "Loop 100/100". total === 0 → infinite (∞). */}
          {loopProgress.active && (
            <>
              <Sep />
              <span className="flex items-center gap-1.5 text-[11px] font-mono text-text-secondary shrink-0">
                <Repeat size={10} className="text-text-tertiary" />
                Loop <strong className="text-text-primary">{loopProgress.current}</strong>
                <span className="text-text-disabled">/</span>
                <strong className="text-text-primary">{loopProgress.total === 0 ? '∞' : loopProgress.total}</strong>
              </span>
            </>
          )}
        </>
      )}

      {/* Spacer only when the replay progress row isn't already using flex-1 — otherwise
          two flex-1 elements would split the space and squeeze the chain label. */}
      {!(isReplaying && !isClicker) && <div className="flex-1" />}

      {/* Chrome extension — a pilot light, the same grammar the ActionBar uses: at rest it is
          the quietest mark on the bar, and only the failure state gets ink and words. Gated on
          the Browser Actions setting, because the extension is irrelevant to someone who never
          uses it and a permanent icon they can't act on is just furniture.

          'unknown' draws nothing: the backend seeds the real state right after state:init, so
          this is a sub-frame condition, and guessing "connected" there would be a lie the one
          time it mattered. Two channels on the failure (icon AND label), never colour alone —
          the replay/recording hues already prove colour alone doesn't survive 37 themes. */}
      {settings.browserSelectorEnabled && browserConnection !== 'unknown' && (
        browserConnection === 'connected' ? (
          <Chrome
            size={11}
            className="shrink-0 ml-3 text-text-disabled"
            // Icon-only, so the tooltip is its ONLY label — the case the tooltip policy keeps.
            data-tip={tt('Chrome extension connected', 'Extensão do Chrome conectada')}
          />
        ) : (
          <span
            className="flex items-center gap-1.5 shrink-0 ml-3 text-[11px] font-medium whitespace-nowrap"
            // --color-warning-ink, not raw --color-warning: the ink rung is the one mixed
            // toward the theme's text to clear 4.5:1, and this is TEXT on the bar's surface.
            style={{ color: 'var(--color-warning-ink)' }}
            // Kept even though the label already reads "Extension disconnected": what the tooltip
            // adds is the CONSEQUENCE the label can't fit — that conditions fail silently rather
            // than loudly — plus what to do about it.
            data-tip={tt(
              'Browser actions fail and browser conditions read as "not found". Open Chrome with the extension enabled.',
              'Ações de browser falham e condições de browser leem "não encontrado". Abra o Chrome com a extensão ativa.',
            )}
          >
            <Unplug size={11} className="shrink-0" />
            Extension disconnected
          </span>
        )
      )}

      <span className="text-[11px] text-text-secondary shrink-0 ml-3">{APP_VERSION}</span>
    </div>
  );
}
