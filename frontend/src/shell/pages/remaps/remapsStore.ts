import { create } from 'zustand';
import type { RemapEntryDto } from '../../../bridge/messageTypes';
import { useApp, useShell } from '../../store';
import type { Draft, RuleRef } from './remapModel';

/**
 * What Key Remaps' parts share (phase 3, slice 5): the rule open in "Remap settings" (an existing one
 * by its identity, or a new one being made), its working copy, the filter, the list just sent, and
 * the page's undo. The concept's panel "Applies as you type · Ctrl+Z undoes"; the engine's undo covers
 * the open macro only, so the page keeps its own history of the list, as Appearance does.
 */
export type Filter = { kind: 'all' } | { kind: 'everywhere' } | { kind: 'off' } | { kind: 'app'; app: string };
export interface Snap { enabled: boolean; entries: RemapEntryDto[] }
interface Remaps {
  /** The rule in the panel: an existing one, 'new' while one is being made, or none (no panel). */
  open: RuleRef | 'new' | null;
  /** The panel's working copy: what it shows, which may not be a rule yet (a key still to press). */
  draft: Draft | null;
  /** A key the capture refused (a combo, the wheel as the key pressed), with its side, until the next change. */
  refused: { side: 'from' | 'to'; text: string } | null;
  filter: Filter;
  /** The list last sent, over the engine's list it changed: on screen until the echo comes (rule 3). */
  sent: { snap: Snap; over: object } | null;
  past: Snap[];
  future: Snap[];
}
export const useRemapsUi = create<Remaps>(() => ({ open: null, draft: null, refused: null, filter: { kind: 'all' }, sent: null, past: [], future: [] }));

export const closePanel = () => useRemapsUi.setState({ open: null, draft: null, refused: null });

// ── The list (rule 3: the screen changes at once, the engine confirms after) ──

type Save = (entries: RemapEntryDto[], enabled: boolean) => void;
const engineList = () => useShell.getState().app.settings.remaps;

/** The list on screen: the one last sent, until the engine echoes a list of its own. */
export function useList(): Snap {
  const engine = useApp(a => a.settings.remaps);
  const sent = useRemapsUi(s => s.sent);
  return sent && sent.over === engine ? sent.snap : engine;
}
/** The same, read in a handler: what a change builds on, so two changes before an echo keep both. */
export function listNow(): Snap {
  const engine = engineList();
  const { sent } = useRemapsUi.getState();
  return sent && sent.over === engine ? sent.snap : engine;
}

let dropTimer = 0;
function send(next: Snap, save: Save) {
  useRemapsUi.setState({ sent: { snap: next, over: engineList() } });
  save(next.entries, next.enabled);
  // No echo within a second (the engine kept its list): the engine's list shows again.
  clearTimeout(dropTimer);
  dropTimer = window.setTimeout(() => {
    if (useRemapsUi.getState().sent?.snap === next) useRemapsUi.setState({ sent: null });
  }, 1000);
}

// ── The undo ──

/** Changes of one control closer than this are one step (an arrow held across the mouse targets). */
const MERGE_MS = 600;
const MAX_STEPS = 50;
// The last change: when, and the control it came from (null for one that is a step on its own).
// None yet is -Infinity, so a young page's first change is a step too.
let lastAt = -Infinity;
let lastControl: string | null = null;

/**
 * A change of the page's: the list before it becomes a step, and the engine saves the whole list.
 * A change from `control` close after another from it joins that step instead.
 */
export function commitList(next: Snap, save: Save, control?: string) {
  const before = listNow();
  const t = performance.now();
  if (!control || control !== lastControl || t - lastAt > MERGE_MS) useRemapsUi.setState(s => ({ past: [...s.past.slice(1 - MAX_STEPS), before], future: [] }));
  else if (useRemapsUi.getState().future.length) useRemapsUi.setState({ future: [] });
  lastAt = t;
  lastControl = control ?? null;
  send(next, save);
}

/** Ctrl+Z (or Ctrl+Y): the list one step back (or forward), and that step moved to the other side. */
export function stepList(back: boolean, save: Save): { before: Snap; after: Snap } | null {
  const { past, future } = useRemapsUi.getState();
  const to = (back ? past : future).at(-1);
  if (!to) return null;
  const now = listNow();
  useRemapsUi.setState(back
    ? { past: past.slice(0, -1), future: [...future, now] }
    : { future: future.slice(0, -1), past: [...past, now] });
  lastAt = -Infinity;
  lastControl = null;
  send(to, save);
  return { before: now, after: to };
}
