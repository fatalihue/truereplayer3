import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { AppState } from '../bridge/messageTypes';
import { initialState } from './appStateReducers';

// The shell keeps the state in its store (shell/store.ts) and hands it to the parts below through
// these two contexts (ShellBridge): the getter to the commands in logic/, the value to the few
// reused parts that read it during render.
const AppStateContext = createContext<AppState>(initialState);
const GetAppStateContext = createContext<() => AppState>(() => initialState);

export function useAppState() {
  return useContext(AppStateContext);
}

/**
 * Reads the state at the moment it is called, without subscribing: for event handlers and the
 * commands in logic/. The getter itself never changes identity. During render use useAppState —
 * a value read here would not re-render when it changes.
 */
export function useGetAppState(): () => AppState {
  return useContext(GetAppStateContext);
}

/**
 * For a shell that keeps the state somewhere else (the new one, in its store): hands the commands in
 * logic/ its getter, so they read the same state without knowing where it lives.
 */
export function GetAppStateProvider({ getState, children }: { getState: () => AppState; children: ReactNode }) {
  return <GetAppStateContext.Provider value={getState}>{children}</GetAppStateContext.Provider>;
}

/**
 * The same shell's state for the parts it reuses that read it during render (the Send Text editor's
 * previews of a {row:} cell read the Data Loop table): only they re-render with it.
 */
export function AppStateValueProvider({ value, children }: { value: AppState; children: ReactNode }) {
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}
