import { useEffect, type ReactNode } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { AppStateValueProvider, GetAppStateProvider } from '../state/AppStateContext';
import { receive, useShell } from './store';

const getApp = () => useShell.getState().app;

/**
 * Feeds the store from the bridge, and hands the store's state to what reads it the way of today:
 * the commands in logic/ through the getter, and the few parts of today mounted in the shell through
 * the context (AppStateFromStore).
 */
export function ShellBridge({ children }: { children: ReactNode }) {
  const { subscribe } = useBridge();
  // An effect of a child runs before the BridgeProvider's own, which sends ui:ready, so the
  // state:init that answers it always finds this subscription in place.
  useEffect(() => subscribe(receive), [subscribe]);
  return (
    <GetAppStateProvider getState={getApp}>
      <AppStateFromStore>{children}</AppStateFromStore>
    </GetAppStateProvider>
  );
}

/** The state as a context value: a change re-renders only its readers, never the shell under it. */
function AppStateFromStore({ children }: { children: ReactNode }) {
  const app = useShell(s => s.app);
  return <AppStateValueProvider value={app}>{children}</AppStateValueProvider>;
}
