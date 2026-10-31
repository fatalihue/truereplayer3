import { useMemo } from 'react';
import { useBridge } from '../bridge/BridgeContext';

/**
 * The window itself: the compact view (rule 10 of the plan) and the tray. A module of its own, small,
 * because the title bar's Compact view is part of the opening and useSettings' commands are not.
 */
export function useWindow() {
  const { send } = useBridge();
  return useMemo(() => ({
    /** The compact view: the window small and always on top, with the compact layout. */
    setCompact: (on: boolean) => send({ type: 'window:compact', payload: { on } }),
    /** The window to the tray, everything still running (the compact layout's ×). */
    hideToTray: () => send({ type: 'window:hideToTray', payload: {} }),
  }), [send]);
}
