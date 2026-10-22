import { create } from 'zustand';
import type { ActionItem, AppState, IncomingMessage } from '../bridge/messageTypes';
import {
  appStateReducer,
  clickerLiveReducer,
  highlightReducer,
  initialClickerLiveInternal,
  initialState,
  type ClickerLiveInternal,
} from '../state/appStateReducers';

/** What the last save of the open macro said (profile:saved, with save as you go on). */
export interface SaveStatus {
  ok: boolean;
  name: string;
  at?: string;
  error?: string;
}

/**
 * The new shell's state (rule 1 of the plan): one store, read through selectors, so each part of
 * the screen re-renders only for the slice it reads. The slices and their rules are the ones the
 * shell of today keeps in AppStateContext — the same three reducers fill them.
 */
export interface ShellState {
  app: AppState;
  /** The ~4 Hz run slices (Clicker counter, loop and chain progress). */
  live: ClickerLiveInternal;
  /** The step the run is executing, or null. */
  highlight: number | null;
  saved: SaveStatus | null;
}

export const useShell = create<ShellState>(() => ({
  app: initialState,
  live: initialClickerLiveInternal,
  highlight: null,
  saved: null,
}));

/** One slice of the app state, re-rendering only when that slice changes. */
export function useApp<T>(select: (app: AppState) => T): T {
  return useShell(s => select(s.app));
}

// ── Engine messages, applied once per frame (rule 4) ──
// A burst of pushes (a switch sends the list, the library and the loop chip) lands as one store
// update and one render. The timer caps the wait at about a frame: the browser holds the first
// frames while the page loads, and a hidden page (the tray) gets none at all.
const queue: IncomingMessage[] = [];
let frame = 0;
let timer = 0;

export function receive(message: IncomingMessage) {
  queue.push(message);
  // The whole state at launch, onto an empty screen: nothing to batch it with, and the user is
  // waiting for exactly this (measured: waiting for the first frame cost ~50 ms of the launch).
  if (message.type === 'state:init') {
    flush();
    return;
  }
  if (frame || timer) return;
  if (document.visibilityState !== 'hidden') frame = requestAnimationFrame(flush);
  timer = window.setTimeout(flush, 16);
}

function flush() {
  if (frame) cancelAnimationFrame(frame);
  if (timer) clearTimeout(timer);
  frame = 0;
  timer = 0;
  if (queue.length === 0) return;
  const batch = queue.splice(0);
  const before = useShell.getState();
  let { app, live, highlight, saved } = before;
  for (const message of batch) {
    app = appStateReducer(app, message);
    live = clickerLiveReducer(live, message);
    highlight = highlightReducer(highlight, message);
    if (message.type === 'profile:saved') saved = message.payload;
  }
  if (app.actions !== before.app.actions) {
    const actions = reconcile(before.app.actions, app.actions);
    if (actions !== app.actions) app = { ...app, actions };
  }
  if (app !== before.app || live !== before.live || highlight !== before.highlight || saved !== before.saved) {
    useShell.setState({ app, live, highlight, saved });
  }
}

/**
 * The engine sends the whole list on every change (rule 5 keeps that). A step equal to the one it
 * had keeps its old object, so its row — memoized by the React Compiler — does not re-render; and a
 * list where nothing changed keeps its old array, so the list does not either.
 */
function reconcile(before: ActionItem[], next: ActionItem[]): ActionItem[] {
  if (before.length === 0 || next.length === 0) return next;
  const byId = new Map<string, ActionItem>();
  for (const step of before) if (step.id) byId.set(step.id, step);
  let unchanged = next.length === before.length;
  const out = next.map((step, i) => {
    const old = step.id ? byId.get(step.id) : undefined;
    const kept = old && sameValue(old, step) ? old : step;
    if (kept !== before[i]) unchanged = false;
    return kept;
  });
  return unchanged ? before : out;
}

/** Deep equality for JSON values, which is all the engine sends. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) if (!sameValue(left[key], right[key])) return false;
  return true;
}
