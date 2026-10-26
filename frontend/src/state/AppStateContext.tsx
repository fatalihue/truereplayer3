import { createContext, useContext, useReducer, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { AppState, ClickerLiveState } from '../bridge/messageTypes';
import {
  appStateReducer,
  clickerLiveReducer,
  highlightReducer,
  initialClickerLive,
  initialClickerLiveInternal,
  initialState,
} from './appStateReducers';

const AppStateContext = createContext<AppState>(initialState);
const GetAppStateContext = createContext<() => AppState>(() => initialState);
const ClickerLiveContext = createContext<ClickerLiveState>(initialClickerLive);
const HighlightContext = createContext<number | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { subscribe } = useBridge();
  const [state, dispatch] = useReducer(appStateReducer, initialState);
  const [live, dispatchLive] = useReducer(clickerLiveReducer, initialClickerLiveInternal);
  const [highlight, dispatchHighlight] = useReducer(highlightReducer, null);

  // The committed state, for code that runs on a click rather than during render: the commands in
  // logic/ read it when they fire instead of subscribing their component to every change. Kept
  // current in a layout effect, so a handler never sees a state the screen has not shown yet.
  const stateRef = useRef(state);
  useLayoutEffect(() => { stateRef.current = state; }, [state]);
  const getState = useCallback(() => stateRef.current, []);

  useEffect(() => {
    return subscribe((message) => {
      // Three reducers, one subscription. Each ignores what it doesn't own and returns its
      // state unchanged, so a ~4 Hz clicker:stats push only invalidates the live context, a
      // per-action highlight push only the highlight one, and a profile reload only the main
      // one.
      dispatch(message);
      dispatchLive(message);
      dispatchHighlight(message);
    });
  }, [subscribe]);

  return (
    <GetAppStateContext.Provider value={getState}>
      <AppStateContext.Provider value={state}>
        <ClickerLiveContext.Provider value={live}>
          <HighlightContext.Provider value={highlight}>
            {children}
          </HighlightContext.Provider>
        </ClickerLiveContext.Provider>
      </AppStateContext.Provider>
    </GetAppStateContext.Provider>
  );
}

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
 * The same shell's state for the parts of today it still mounts that read it during render (the
 * Send Text editor's previews of a {row:} cell read the Data Loop table): only they re-render with it.
 */
export function AppStateValueProvider({ value, children }: { value: AppState; children: ReactNode }) {
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

/**
 * The ~4 Hz live run slices. Read this ONLY where the values are actually rendered (StatusBar,
 * ClickerDashboard) — pulling it into a component that merely happens to be nearby puts that
 * component back on the four-renders-a-second path this split exists to get it off.
 */
export function useClickerLive(): ClickerLiveState {
  return useContext(ClickerLiveContext);
}

/**
 * Index of the action row the replay engine is currently executing (null when idle). Pushed
 * once per executed action — read this ONLY where the value is actually rendered (ActionTable's
 * row tint / auto-scroll, StatusBar's progress read-out). Pulling it into a component that
 * merely happens to be nearby puts that component back on the per-action render path this
 * split exists to get it off.
 */
export function useHighlightedAction(): number | null {
  return useContext(HighlightContext);
}
