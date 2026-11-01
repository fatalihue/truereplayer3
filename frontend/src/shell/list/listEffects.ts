import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { useShell } from '../store';
import { arrival, selectedIndices, selection, useSelection } from './selection';
import { stepKey } from './stepTypes';

/**
 * The list's effects that write to the DOM instead of rendering: lighting a block's rails, the
 * flash of a step that just arrived, selecting the one the shell asked for, the set size for a
 * screen reader, and following the run. Each costs a query or two and no row
 * render, which is what keeps them cheap at a thousand steps (the doctrine of the shell of today's
 * ReplayRowMarker and InsertedRowMarker).
 */

/**
 * Lights a block's rails — the bracket a code editor shows at the caret. The block under the
 * pointer (data-lit) and the block of the one selected step (data-lit-sel), each by one attribute
 * query over the rails that carry its opener.
 */
export function useLitBlocks(bodyRef: RefObject<HTMLElement | null>, steps: ActionItem[], owners: readonly (number | null)[]) {
  const hover = useRef<string | null>(null);
  const sel = useRef<string | null>(null);

  // A new list redraws the rails: drop the marks, and light the selected step's block again
  // whenever the selection changes.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    light(body, null, 'data-lit', hover);
    light(body, null, 'data-lit-sel', sel);
    const apply = (keys: ReadonlySet<string>) => {
      const one = keys.size === 1 ? selectedIndices(steps, keys) : [];
      const owner = one.length === 1 ? owners[one[0]] : null;
      light(body, owner == null ? null : String(owner), 'data-lit-sel', sel);
    };
    apply(useSelection.getState().keys);
    return useSelection.subscribe((s, prev) => { if (s.keys !== prev.keys) apply(s.keys); });
  }, [steps, owners, bodyRef]);

  return {
    over: (target: EventTarget) => {
      const row = (target as Element).closest?.('.step, .step-ghost');
      light(bodyRef.current, row?.getAttribute('data-block-open') ?? null, 'data-lit', hover);
    },
    leave: () => light(bodyRef.current, null, 'data-lit', hover),
  };
}

function light(body: HTMLElement | null, open: string | null, attr: 'data-lit' | 'data-lit-sel', mark: { current: string | null }) {
  if (!body || mark.current === open) return;
  if (mark.current !== null) body.querySelectorAll(`[${attr}]`).forEach(el => el.removeAttribute(attr));
  mark.current = open;
  if (open !== null) body.querySelectorAll(`.step-rail[data-rail-block="${open}"]`).forEach(el => el.setAttribute(attr, ''));
}

/**
 * Flashes the steps that just arrived — a paste, a duplicate, an undo that brings one back — so
 * "where did it go?" is answered by the list. Not on the first fill, a macro switch (every key is
 * new), more than 20 at once, or while recording.
 */
export function useInsertFlash(bodyRef: RefObject<HTMLElement | null>, steps: ActionItem[], recording: boolean) {
  const prev = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    const keys = steps.map(stepKey);
    const before = prev.current;
    prev.current = new Set(keys);
    if (!before || before.size === 0 || recording) return;
    if (document.documentElement.getAttribute('data-animations') !== 'true') return;
    const fresh = keys.filter(k => !before.has(k));
    if (fresh.length === 0 || fresh.length > 20 || fresh.length >= keys.length) return;
    const body = bodyRef.current;
    if (!body) return;
    const rows = fresh.flatMap(k => body.querySelector<HTMLElement>(`.step[data-key="${CSS.escape(k)}"]`) ?? []);
    // "on" lands the tint with no transition, a style read commits it, and "fade" lets it go.
    for (const row of rows) row.setAttribute('data-inserted', 'on');
    for (const row of rows) void getComputedStyle(row).backgroundColor;
    for (const row of rows) {
      row.setAttribute('data-inserted', 'fade');
      const clear = () => { row.removeEventListener('transitionend', end); row.removeAttribute('data-inserted'); };
      const end = (e: TransitionEvent) => { if (e.target === row && e.propertyName === 'background-color') clear(); };
      row.addEventListener('transitionend', end);
      // transitionend never comes in a hidden window.
      setTimeout(clear, 1000);
    }
  }, [steps, recording, bodyRef]);
}

/**
 * Selects the step the shell asked for (arrival) when it lands: it becomes the selection, so the
 * insertion point moves after it, and the list brings it into view. That is the new step at the
 * asked index, or the first new one when the list moved under a long capture. A list that changes
 * with nothing new keeps waiting; another macro drops the wait.
 */
export function useArrival(bodyRef: RefObject<HTMLElement | null>, steps: ActionItem[], open: string | null) {
  const prev = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    const keys = steps.map(stepKey);
    const before = prev.current;
    prev.current = new Set(keys);
    const want = arrival.peek();
    if (!want || !before) return;
    if (want.macro !== open) { arrival.clear(); return; }
    const at = keys[want.at] !== undefined && !before.has(keys[want.at]) ? want.at : keys.findIndex(k => !before.has(k));
    if (at < 0) return;
    arrival.clear();
    want.onArrive?.(steps[at]);
    if (want.count > 1) selection.set(steps, Array.from({ length: Math.min(want.count, steps.length - at) }, (_, i) => at + i));
    else selection.only(steps, at);
    bodyRef.current?.querySelector(`.step[data-index="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [steps, open, bodyRef]);
}

/**
 * How many steps the list has, on each row (aria-setsize; StepRow draws aria-posinset): a block of
 * rows off screen is out of the accessibility tree (content-visibility), and a screen reader would
 * count only the rows drawn. Written here, not rendered: one step more would redraw every row.
 */
export function useSetSize(bodyRef: RefObject<HTMLElement | null>, steps: ActionItem[], open: string | null) {
  // The macro too: its steps can arrive a frame before it is the open one, and the rows are drawn
  // only then, with the same steps.
  useLayoutEffect(() => {
    const size = String(steps.length);
    bodyRef.current?.querySelectorAll('.step').forEach(row => {
      if (row.getAttribute('aria-setsize') !== size) row.setAttribute('aria-setsize', size);
    });
  }, [steps, open, bodyRef]);
}

/**
 * Follows the run: the list goes to the top when a run starts, and keeps the step the engine is on
 * in view (an instant jump: smooth scrolls queue up faster than they finish at replay speed). Not
 * while the window is hidden in the tray (rule 12): each jump forces a style pass and a layout, at
 * every step of the run, for a list nobody sees. It catches up the moment the page shows.
 */
export function useRunFollow(scrollRef: RefObject<HTMLElement | null>, bodyRef: RefObject<HTMLElement | null>) {
  const highlight = useShell(s => s.highlight);
  const replaying = useShell(s => s.app.status === 'replaying');
  useEffect(() => {
    if (replaying && scrollRef.current && !document.hidden) scrollRef.current.scrollTop = 0;
  }, [replaying, scrollRef]);
  useLayoutEffect(() => {
    if (highlight === null) return;
    const follow = () => {
      if (!document.hidden) bodyRef.current?.querySelector(`.step[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    };
    follow();
    document.addEventListener('visibilitychange', follow);
    return () => document.removeEventListener('visibilitychange', follow);
  }, [highlight, bodyRef]);
}
