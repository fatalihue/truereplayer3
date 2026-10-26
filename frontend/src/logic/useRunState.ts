import { useCallback, useEffect, useState } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { RunReport } from '../bridge/messageTypes';

// What a run left behind, asked for by the surfaces that show it — the run's report and its live
// variables. Apart from useReplay so that only those surfaces (loaded on demand) carry it.

/**
 * The last run's report, asked for on mount. It is a snapshot: `refresh` asks again, and a report
 * pulled mid-run carries the unfinished steps as 'running'.
 */
export function useRunReport(): { report: RunReport | null; refresh: () => void } {
  const { send, subscribe } = useBridge();
  const [report, setReport] = useState<RunReport | null>(null);

  useEffect(() => {
    send({ type: 'replay:reportRequest', payload: {} });
    return subscribe((msg) => {
      if (msg.type === 'replay:report') setReport(msg.payload);
    });
  }, [send, subscribe]);

  const refresh = useCallback(() => send({ type: 'replay:reportRequest', payload: {} }), [send]);
  return { report, refresh };
}

// The replay engine's run state as the frontend already receives it — the same `replay:variables`
// push the Live Variables pane reads. The chain builder uses it so a {clip:name} or {var:name}
// transform can be previewed against the REAL value instead of an apology.
//
// Clip slots are the useful case: they survive between runs (capture with the hotkey, build the
// chain, see the result), which is exactly the workflow the preview rail exists for. Variables
// only outlive the run that set them, so a value found here is the LAST run's — surfaces must say
// so rather than imply it is current.
export type RunStateSnapshot = {
  variables: Record<string, string>;
  slots: Record<string, string>;
  rowData: Record<string, string> | null;
};

const EMPTY_RUN_STATE: RunStateSnapshot = { variables: {}, slots: {}, rowData: null };

export function useRunState(enabled: boolean): RunStateSnapshot {
  const { send, subscribe } = useBridge();
  const [snap, setSnap] = useState<RunStateSnapshot>(EMPTY_RUN_STATE);

  useEffect(() => subscribe((m) => {
    if (m.type === 'replay:variables') setSnap(m.payload);
  }), [subscribe]);

  // Pushes only happen on writes, so a surface opened long after the last one would show nothing
  // without asking.
  useEffect(() => {
    if (enabled) send({ type: 'replay:variablesRequest', payload: {} });
  }, [enabled, send]);

  return snap;
}

/**
 * Case-insensitive lookup, because the engine lowercases both keys before storing them
 * ({var:Cliente} and {var:cliente} are one variable) while the token keeps the user's spelling.
 * Returns undefined for "no entry", which callers must NOT flatten into "" — an absent slot means
 * "nothing captured yet", and previewing a chain against "" would claim the chain yields nothing.
 */
export function lookupRunState(
  bag: Record<string, string>,
  name: string,
): string | undefined {
  if (!name) return undefined;
  const direct = bag[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const key of Object.keys(bag)) {
    if (key.toLowerCase() === lower) return bag[key];
  }
  return undefined;
}
