import { useCallback, useEffect, useMemo, useState } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { IncomingMessage, RunReport } from '../bridge/messageTypes';
import { runDurationMs } from '../utils/runReportStats';

/** Playing a macro, as commands. */
export function useReplay() {
  const { send } = useBridge();
  return useMemo(() => ({
    /**
     * Plays the open macro, or stops the run. The payload is empty on purpose — the engine resolves
     * the loop settings itself. Sending React's `settings` slice back is what made this run the
     * previous profile's count: no profile-activation path refreshes that slice.
     */
    toggle: () => send({ type: 'replay:toggle', payload: {} }),
    /** Resumes a paused run: a Pause step, or the Clicker paused by its button or hotkey. */
    resume: () => send({ type: 'replay:resume', payload: {} }),
  }), [send]);
}

// What the status bar keeps of the last finished run: enough to say "18/18 in 12.4 s" or "stopped at
// step 7" beside the profile it belongs to, and to open the full report on click. Derived from the
// replay:report the backend pushes on its own at the end of every run (WebViewBridge, the
// ready-after-replaying edge), so no new message and nothing polled.
export interface LastRunSummary {
  profile: string;
  total: number;
  ok: number;
  /** Set only when the run actually HALTED on that step. A failure the Data-loop's skip policy
   *  absorbed leaves this null — the run carried on to the end — and is reported by failedCount. */
  failedRow: number | null;
  /** Profile the halting step belongs to — rows restart at 1 inside every RunProfile sub-call. */
  failedProfile: string | null;
  /** What the halting step said, when it said something (the compact view's "stopped" line). */
  failedMessage: string | null;
  /** Steps that failed, however the run ended. Non-zero with a null failedRow means "finished,
   *  but some rows did not". */
  failedCount: number;
  durationMs: number;
  /** Whether the duration came from the engine's own clock. A report from a build without the
   *  field falls back to the sum of step costs, which is the old, smaller number. */
  durationIsWallClock: boolean;
  outcome: 'completed' | 'stopped' | 'failed' | null;
  /** When the run started (ISO), for "last run 14:02". */
  startedAt: string;
}

/**
 * The finished run a report describes, or null when it describes none: a report requested mid-run
 * carries a 'running' step and is not a finished run. Skipped rows count for neither side.
 */
export function summarizeRun(r: RunReport): LastRunSummary | null {
  if (!r.startedAt || r.steps.length === 0 || r.steps.some(s => s.status === 'running')) return null;
  const counted = r.steps.filter(s => s.status !== 'skipped');
  const failures = r.steps.filter(s => s.status === 'failed');
  // A failure only HALTED the run when nothing ran after it. Under the Data loop's skip policy
  // the engine faults the row and carries on, so the old "first failed step" reading printed
  // "stopped at step N" for a run that went all the way through.
  const lastIdx = r.steps.length - 1;
  const halted = failures.length > 0 && r.steps[lastIdx].status === 'failed';
  const dur = runDurationMs(r, r.steps);
  return {
    profile: r.steps[0].profile || r.profile,
    total: counted.length,
    ok: counted.filter(s => s.status === 'ok').length,
    failedRow: halted ? failures[failures.length - 1].row : null,
    // A chain halts in the DEEPEST frame, so the last failure's row counts lines in a
    // sub-profile — a number that often does not exist in the grid on screen. Carry the profile
    // so the label can say which one it means.
    failedProfile: halted ? (failures[failures.length - 1].profile ?? null) : null,
    failedMessage: halted ? failures[failures.length - 1].errorMessage : null,
    failedCount: failures.length,
    // The engine's own clock when the build provides it; the step sum is the legacy fallback.
    // One reader, shared with the Run report — the two used to print different numbers for the
    // same execution, one click apart.
    durationMs: dur.totalMs,
    durationIsWallClock: dur.wallClock,
    outcome: r.outcome ?? null,
    startedAt: r.startedAt,
  };
}

/** The last finished run (summarizeRun), kept until the next one finishes. */
export function useLastRun(): LastRunSummary | null {
  const { subscribe } = useBridge();
  const [lastRun, setLastRun] = useState<LastRunSummary | null>(null);
  useEffect(() => subscribe((msg) => {
    if (msg.type !== 'replay:report') return;
    const summary = summarizeRun(msg.payload);
    if (summary) setLastRun(summary);
  }), [subscribe]);
  return lastRun;
}

type AskInputRequest = Extract<IncomingMessage, { type: 'replay:inputRequest' }>['payload'];

/**
 * The question an Ask input step is waiting on, and its two answers. Stop pressed mid-prompt
 * arrives as replay:inputDismiss: the engine already resolved the wait, so the question just goes
 * away without a result.
 */
export function useAskInput() {
  const { send, subscribe } = useBridge();
  const [request, setRequest] = useState<AskInputRequest | null>(null);

  useEffect(() => subscribe((m) => {
    if (m.type === 'replay:inputRequest') {
      setRequest(m.payload);
    } else if (m.type === 'replay:inputDismiss') {
      setRequest((cur) => (cur && cur.requestId === m.payload.requestId ? null : cur));
    }
  }), [subscribe]);

  const finish = useCallback((value: string, cancelled: boolean) => {
    if (!request) return;
    send({ type: 'replay:inputResult', payload: { requestId: request.requestId, value, cancelled } });
    setRequest(null);
  }, [request, send]);
  /** Substitutes the answer, and the run goes on. */
  const submit = useCallback((value: string) => finish(value, false), [finish]);
  /** Aborts the run. */
  const cancel = useCallback(() => finish('', true), [finish]);

  return { request, submit, cancel };
}
