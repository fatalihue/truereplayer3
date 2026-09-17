import { useEffect, useRef, useState } from 'react';
import { useBridge } from '../bridge/BridgeContext';

export type BrowserConnection = 'unknown' | 'connected' | 'disconnected';

/**
 * How long the bridge has to stay down before the UI says so.
 *
 * The pipe loop is built to churn: BrowserBridgeService raises ConnectionChanged(false) from a
 * `finally` at the end of EVERY session and immediately re-listens, so a tab reload or a Chrome
 * service-worker recycle produces a false→true pair milliseconds apart. Drawing those would give
 * the user a light that blinks during normal use, which is worse than no light — a warning that
 * cries wolf is one you stop reading.
 *
 * So the two directions are deliberately asymmetric: connected paints immediately (good news is
 * never worth delaying), disconnected only after the bridge has been down continuously for this
 * long. A real drop outlasts it; a reconnect never reaches it.
 */
const DISCONNECT_GRACE_MS = 3000;

/**
 * The Chrome extension's connection state, as the status bar should present it.
 *
 * 'unknown' only survives until the first push. The backend seeds one browser:status right after
 * state:init precisely so a UI that mounts with the extension ALREADY connected — the normal
 * case — doesn't sit unknown until the first flap.
 */
export function useBrowserConnection(): BrowserConnection {
  const { subscribe } = useBridge();
  const [state, setState] = useState<BrowserConnection>('unknown');
  const graceTimer = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = subscribe((msg) => {
      if (msg.type !== 'browser:status') return;
      // A REPEATED "still down" does not restart the clock. The window measures how long the
      // bridge has been down, not how long since the last message about it — and a producer that
      // repeats itself used to reset the timer before it could ever expire, so the warning never
      // appeared at all. That is exactly what a permanently failing pipe did at 1 Hz; the service
      // now speaks only on the edge, and this keeps the window honest whatever it hears.
      if (!msg.payload.connected && graceTimer.current !== null) return;
      // Any real transition retires the pending grace period: a reconnect that lands inside the
      // window must cancel the "disconnected" that was scheduled, or the light flashes red
      // seconds after the bridge is already back.
      if (graceTimer.current !== null) {
        clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
      if (msg.payload.connected) {
        setState('connected');
        return;
      }
      graceTimer.current = window.setTimeout(() => {
        graceTimer.current = null;
        setState('disconnected');
      }, DISCONNECT_GRACE_MS);
    });
    return () => {
      unsubscribe();
      if (graceTimer.current !== null) {
        clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
    };
  }, [subscribe]);

  return state;
}
