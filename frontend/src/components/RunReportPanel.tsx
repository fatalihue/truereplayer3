import { Fragment, useEffect, useMemo, useState } from 'react';
import { ListChecks, CheckCircle2, CircleDashed, XCircle, MinusCircle, TriangleAlert, RefreshCw, Repeat } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { Callout } from './common/Callout';
import type { RunReport, RunStep } from '../bridge/messageTypes';
import { runDurationMs } from '../utils/runReportStats';

// Structured codes the extension emits (content.js mkError) plus the two the native bridge
// synthesises on timeout. Translated here rather than in the backend because the CODES are the
// stable contract — the prose around them is presentation.
//
// This list is checked against the real emitters, not guessed: the extension's codes are all
// ELEMENT_-prefixed (ELEMENT_COVERED, not COVERED), and an unlisted code is not a problem —
// the row falls back to the raw message, which is still the extension's own English sentence.
function explainCode(code: string | null): string | null {
  switch (code) {
    case 'ELEMENT_NOT_FOUND':
      return 'No element matched the selector.';
    case 'ELEMENT_HIDDEN':
      return 'Found, but not visible on screen.';
    case 'ELEMENT_DISABLED':
      return 'Found, but disabled.';
    case 'ELEMENT_COVERED':
      return 'Found, but something is on top of it.';
    case 'SELECTOR_INVALID':
      return 'The selector is not valid CSS.';
    case 'NAVIGATION_TIMEOUT':
      return 'The page did not finish loading in time.';
    case 'INVALID_URL':
      return 'That is not a URL the browser can open.';
    case 'OPTION_NOT_FOUND':
      return 'No option in the list matched.';
    case 'OPTION_DISABLED':
      return 'The option matched, but it is disabled.';
    case 'NOT_A_SELECT':
      return 'That element is not a dropdown list.';
    case 'TAB_GONE':
      return 'The tab this run was acting on was closed.';
    case 'NO_CONTENT_SCRIPT':
      // Browser actions run on whichever Chrome tab is active, so this fires when that tab is a
      // page extensions cannot touch (chrome://, the Web Store) or one that needs a reload.
      return 'The active Chrome tab cannot be automated.';
    default:
      return null;
  }
}

const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
// "21:40 · " — the run's start, machine locale; empty when the backend sent no timestamp.
const fmtStart = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + ' · ';
};

// One tally of the summary strip: a dot in the status colour plus the count.
function Tally({ color, n, label }: { color: string; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} aria-hidden="true" />
      {n} {label}
    </span>
  );
}

// The icon is the row's only statement of its status, so it is named for assistive tech —
// lucide renders icons aria-hidden, and a row read as "3 Click 45 ms" said nothing about whether
// the step passed. Same words as the summary tallies.
function StatusIcon({ status }: { status: RunStep['status'] }) {
  if (status === 'failed') return <XCircle size={13} role="img" aria-label="failed" style={{ color: 'var(--color-recording-fg)' }} />;
  if (status === 'skipped') return <MinusCircle size={13} role="img" aria-label="skipped" className="text-text-disabled" />;
  // In flight — the step is filed on START, so this is reachable whenever the report is opened
  // during a run. A dashed OUTLINE, not a tinted tick: the difference from a pass has to survive
  // on the presets where hue is weakest, so it is carried by shape first and colour second.
  if (status === 'running') return <CircleDashed size={13} role="img" aria-label="in progress" className="text-text-tertiary" />;
  return <CheckCircle2 size={13} role="img" aria-label="ok" style={{ color: 'var(--color-replay-fg)' }} />;
}

// The detail lines (page, fallback tier, failure card) hang under the step's text: 52 px clears
// the row-number column (w-7 + gap-2) and the status icon. One constant for the three of them.
const STEP_DETAIL_INDENT = 'ml-13';

/**
 * Last-run diagnostic timeline. Exists for one question: "my browser macro worked yesterday and
 * silently does nothing today — which step broke, and why?" The engine already knew the answer
 * (structured error code, tip, and which selector TIER matched) and used to discard it.
 *
 * Read-only and last-run-only. It is a debugging aid for the run you just watched, not a log.
 */
export function RunReportPanel({ onClose }: { onClose: () => void }) {
  const { send, subscribe } = useBridge();
  const [report, setReport] = useState<RunReport | null>(null);

  useEffect(() => {
    send({ type: 'replay:reportRequest', payload: {} });
    return subscribe((msg) => {
      if (msg.type === 'replay:report') setReport(msg.payload);
    });
  }, [send, subscribe]);

  // Memoised because `?? []` builds a NEW array on every render, which made the stats useMemo
  // below recompute every time regardless of whether the report actually changed.
  const steps = useMemo(() => report?.steps ?? [], [report]);
  const stats = useMemo(() => {
    const failed = steps.filter((s) => s.status === 'failed').length;
    // Steps filed but not finished — non-zero only while a run is in progress. Surfaced because
    // the panel is a SNAPSHOT: without it, a report pulled mid-run is indistinguishable from a
    // finished one that happened to stop early.
    const running = steps.filter((s) => s.status === 'running').length;
    // The engine's own clock when the report carries it. Summing the step costs — which is all
    // this did — measures the time INSIDE the steps and nothing between them, so the panel and
    // the status-bar chip that opens it printed two different durations for the same execution,
    // one click apart. The sum is still shown, as what it actually is.
    const dur = runDurationMs(report, steps);
    const total = dur.totalMs;
    // A fallback match is not a failure, but it IS the early warning that the primary selector
    // is dead — surface it at the same level as a failure count.
    const drifting = steps.filter((s) => s.matchedTier).length;
    // A run is bound to ONE tab, so more than one distinct page across the steps means something
    // redirected it. Only worth showing when it happened — on a normal run this is 0 or 1.
    const pages = [...new Set(steps.map((s) => s.tabUrl).filter(Boolean))] as string[];
    // Row numbers restart at 1 inside every RunProfile sub-call, so on a chained run the `row`
    // column is ambiguous on its own. More than one distinct profile here is what turns the
    // per-profile grouping on — a plain single-profile run must look exactly as it did before.
    const profiles = [...new Set(steps.map((s) => s.profile).filter(Boolean))] as string[];
    const ok = steps.filter((s) => s.status === 'ok').length;
    const skipped = steps.filter((s) => s.status === 'skipped').length;
    // Index (not row: rows restart inside every sub-call) of the first failure, for the jump link.
    const firstFailedIdx = steps.findIndex((s) => s.status === 'failed');
    return { failed, running, total, wallClock: dur.wallClock, actionsMs: dur.actionsMs, drifting, pages, profiles, ok, skipped, firstFailedIdx };
  }, [report, steps]);

  return (
    <DialogShell
      icon={<ListChecks size={14} className="text-accent-hover" />}
      title="Run report"
      // Height tracks the window instead of a fixed cap: this is a diagnostic LIST, and the
      // 640px ceiling meant a maximised window showed the same six rows as a small one — the
      // chain reports 2.21.0 exists to make readable are exactly the long ones. Divided by
      // --ui-zoom for the same reason PANEL_SIZE is (DialogShell:41): raw vh is measured before
      // the app's 0.9 zoom scales it down, so 85vh would paint as 76vh.
      size="xl"
      cardClassName="h-[calc(85vh/var(--ui-zoom))]"
      // Above the Sheet (z-60/70): the palette opens this over whatever is up, the Sheet included,
      // and at the default z-50 it painted under it — unreachable, with the focus pulled into it.
      zClass="z-(--z-dialog-raised)"
      onClose={onClose}
      showClose
      footer={<DialogFooter secondary={{ label: <><RefreshCw size={12} /> Refresh</>, onClick: () => send({ type: 'replay:reportRequest', payload: {} }) }} primary={{ label: 'Close', onClick: onClose }} />}
    >
      {/* flex-1 min-h-0, not h-full: the card is `flex flex-col` and this is a direct flex item,
          so an intrinsic height ignores the space the header and footer leave over (DialogShell:38). */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {steps.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center text-minor text-text-tertiary px-8 leading-relaxed">
            {'No run yet. Play a profile to see each step here: the selector that matched, how long it took and why it failed.'}
          </div>
        ) : (
          <>
            {/* Summary strip — what ran, when, how long, and the pass / skip / fail tally, read
                first; it used to sit in the footer in 11 px. The jump goes to the first failure. */}
            <div className="mb-2 flex items-center gap-x-3 gap-y-1 flex-wrap rounded border border-border-subtle bg-bg-card px-3 py-2 text-minor text-text-secondary">
              {stats.profiles[0] && <span className="font-semibold text-text-primary truncate">{stats.profiles[0]}</span>}
              <span
                className="tabular-nums"
                data-tip={stats.wallClock
                  ? `Wall clock, minus time paused. Inside the steps: ${fmtMs(stats.actionsMs)}.`
                  : 'Sum of the step costs — this report predates the engine clock.'}
              >{fmtStart(report?.startedAt)}{steps.length} steps · {fmtMs(stats.total)}</span>
              <span className="flex items-center gap-3 tabular-nums">
                <Tally color="var(--color-replay)" n={stats.ok} label="ok" />
                {stats.skipped > 0 && <Tally color="var(--color-text-tertiary)" n={stats.skipped} label="skipped" />}
                {stats.failed > 0 && <Tally color="var(--color-recording)" n={stats.failed} label="failed" />}
                {stats.running > 0 && <Tally color="var(--color-accent)" n={stats.running} label="in progress" />}
              </span>
              {stats.firstFailedIdx >= 0 && (
                <button
                  type="button"
                  onClick={() => document.getElementById(`run-step-${stats.firstFailedIdx}`)?.scrollIntoView({ block: 'center' })}
                  className="ml-auto text-minor font-medium text-accent hover:underline"
                >
                  step {steps[stats.firstFailedIdx].row} →
                </button>
              )}
            </div>
            {stats.drifting > 0 && (
              <Callout tone="error" className="mb-2" icon={<TriangleAlert size={12} />} still>
                {stats.drifting === 1
                  ? '1 step matched via a fallback selector — the one you picked no longer matches. Re-pick it before the fallback drifts too.'
                  : `${stats.drifting} steps matched via a fallback selector — the ones you picked no longer match. Re-pick them before the fallbacks drift too.`}
              </Callout>
            )}
            <div className="space-y-px">
              {steps.map((s, idx) => (
                <Fragment key={idx}>
                {/* Chain grouping. A header only where the executing profile CHANGES, rather than
                    a name on every row: a run stays in one profile for a stretch at a time, so a
                    repeated column would be noise, and the change points are exactly where the row
                    numbers reset. Same ink as the status bar's chain read-out so the two describe
                    one thing.

                    A → B → A is normal, not a duplicate header: the steps are filed in START
                    order, so a caller's RunProfile row is followed by the callee's rows and then
                    by the caller's remaining rows — the caller legitimately appears on both sides
                    of the profile it invoked. Under Loop the whole alternation repeats per
                    iteration. */}
                {stats.profiles.length > 1 && s.profile !== (idx > 0 ? steps[idx - 1].profile : null) && (
                  <div className={`flex items-center gap-1.5 px-2 pb-0.5 text-caption font-mono ${idx > 0 ? 'pt-2' : ''}`}
                    style={{ color: 'var(--color-action-runprofile-fg)' }}>
                    <Repeat size={10} className="shrink-0" />
                    <span className="truncate" data-tip={s.profile}>{s.profile}</span>
                  </div>
                )}
                <div
                  id={`run-step-${idx}`}
                  className={`rounded px-2 py-1.5 ${s.status === 'failed' ? 'bg-bg-card' : 'hover:bg-bg-elevated/50'}`}>
                  <div className="flex items-center gap-2 text-minor">
                    <span className="w-7 shrink-0 text-right font-mono text-caption text-text-disabled">{s.row}</span>
                    <StatusIcon status={s.status} />
                    <span className="text-text-primary shrink-0">{s.actionType}</span>
                    {/* data-tip, never a native title= (the house rule), and REVEAL so the tooltip
                        only appears when the column actually cut the text off — otherwise it just
                        repeats text the reader can already see. */}
                    {s.detail && (
                      <span className="font-mono text-caption text-text-tertiary truncate min-w-0" data-tip={s.detail} data-tip-reveal>
                        {s.detail}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-caption text-text-disabled">
                      {/* An in-flight step has DurationMs 0 because the stopwatch has not stopped
                          yet. Rendering that as "0 ms" is the same lie the green tick was. */}
                      {s.status === 'running' ? '…' : fmtMs(s.durationMs)}
                    </span>
                  </div>

                  {/* The fallback-tier line is the whole reason this panel exists — a step that
                      PASSED can still be the one telling you the macro is about to break. */}
                  {/* On a passing step this is noise unless the run spanned more than one page.
                      On a FAILING one it is the first question the failure raises — the same
                      "no element matched" reads completely differently once you can see the run
                      was on a login page. So a failure always names its page. */}
                  {s.tabUrl && (s.status === 'failed' || stats.pages.length > 1) && (
                    <div className={`${STEP_DETAIL_INDENT} mt-0.5 text-caption font-mono text-text-tertiary truncate`} data-tip={s.tabUrl} data-tip-reveal>
                      {s.tabUrl}
                    </div>
                  )}

                  {s.matchedTier && (
                    <div className={`${STEP_DETAIL_INDENT} mt-0.5 text-caption leading-snug`} style={{ color: 'var(--color-recording-fg)' }}>
                      {/* A span, not <b>: preflight gives <b> `bolder` = 700, off the 400/500/600 scale. */}
                      {'matched via fallback'} <span className="font-semibold">tier {s.matchedTier}</span>
                      {s.matchedSelector && <span className="font-mono"> · {s.matchedSelector}</span>}
                    </div>
                  )}

                  {/* The failed step gets the same card a failed probe gets in the sheet. */}
                  {s.status === 'failed' && (
                    <Callout tone="error" className={`${STEP_DETAIL_INDENT} mt-1`} still>
                      {s.errorCode && <div className="font-mono text-caption tracking-wide opacity-80">{s.errorCode}</div>}
                      <div>{explainCode(s.errorCode) ?? s.errorMessage}</div>
                      {s.tip && <div className="mt-0.5 text-text-secondary">{s.tip}</div>}
                    </Callout>
                  )}
                </div>
                </Fragment>
              ))}
            </div>
            {(report?.overflow ?? 0) > 0 && (
              <div className="mt-2 text-caption text-text-tertiary text-center">
                {`+${report!.overflow} more steps not recorded (report is capped).`}
              </div>
            )}
          </>
        )}
      </div>
    </DialogShell>
  );
}
