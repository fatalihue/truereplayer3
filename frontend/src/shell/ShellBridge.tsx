import { useEffect, type ReactNode } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { GetAppStateProvider } from '../state/AppStateContext';
import { receive, useShell } from './store';

const getApp = () => useShell.getState().app;

/** Feeds the store from the bridge, and hands the commands in logic/ the store's state to read. */
export function ShellBridge({ children }: { children: ReactNode }) {
  const { subscribe } = useBridge();
  // An effect of a child runs before the BridgeProvider's own, which sends ui:ready, so the
  // state:init that answers it always finds this subscription in place.
  useEffect(() => subscribe(receive), [subscribe]);
  return <GetAppStateProvider getState={getApp}>{children}</GetAppStateProvider>;
}
