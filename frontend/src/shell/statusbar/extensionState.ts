import { useEffect } from 'react';
import { create } from 'zustand';
import { useBridge } from '../../bridge/BridgeContext';
import { useBrowserConnection, type BrowserConnection } from '../../hooks/useBrowserConnection';

/**
 * The browser extension's state, heard from the start: the engine says it once, right after
 * state:init, so whatever draws it later reads it here. "Outdated" is a loaded extension older than
 * this app expects (D25), until the versions match.
 */
interface ExtensionState {
  connection: BrowserConnection;
  outdated: { current: string; expected: string } | null;
}
export const useExtension = create<ExtensionState>(() => ({ connection: 'unknown', outdated: null }));

/** Mounted once, with the status bar, in the opening bundle. */
export function useExtensionWatch() {
  const connection = useBrowserConnection();
  const { subscribe } = useBridge();
  useEffect(() => { useExtension.setState({ connection }); }, [connection]);
  useEffect(() => subscribe((message) => {
    if (message.type !== 'browser:extensionOutdated') return;
    const { currentVersion, expectedVersion } = message.payload;
    if (typeof currentVersion !== 'string' || typeof expectedVersion !== 'string') return;
    useExtension.setState({ outdated: currentVersion === expectedVersion ? null : { current: currentVersion, expected: expectedVersion } });
  }), [subscribe]);
}
