import { useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { snapIndicesToBlocks } from '../../utils/conditionalBlocks';
import { selectedIndices } from './selection';
import { PINNED_MARKERS } from './stepTypes';

const START = 8;   // px the pointer moves before a press becomes a drag (as in the shell of today)
const EDGE = 40;   // px from the list's top or bottom where it scrolls by itself
const SPEED = 14;  // px per frame at the very edge

export interface StepDrag {
  /** The steps that move: the selection when the pressed step is in it, else that step; whole blocks for any marker. */
  indices: number[];
  /** The step the pointer took, for the card that follows it. */
  lead: number;
  x: number;
  y: number;
}

/** Where the dragged steps would land: before step `index` (the step count for the end), drawn at `top`. */
export interface DropSlot {
  index: number;
  top: number;
}

/**
 * Dragging steps to reorder them (lista-047). A press on a step that moves 8 px starts it; the
 * steps that move dim, a card follows the pointer, and a line shows where they would land. The
 * list scrolls by itself near its edges, and Esc cancels. Else If, Else, End If and End Loop do
 * not move alone: their block moves with its opener. On release the engine reorders
 * (actions:reorder) and the steps slide from where they were. The selection is by step, so it
 * stays on the moved steps.
 *
 * Mouse events, not HTML drag and drop (WebView2 shows the system's drag image for that). The
 * pointer is read on every event and the work is done once a frame.
 */
export function useStepDrag({ scrollRef, bodyRef, steps, locked, onDrop }: {
  scrollRef: RefObject<HTMLElement | null>;
  bodyRef: RefObject<HTMLElement | null>;
  steps: ActionItem[];
  locked: boolean;
  onDrop: (indices: number[], targetIndex: number) => void;
}) {
  const [drag, setDrag] = useState<StepDrag | null>(null);
  const [slot, setSlot] = useState<DropSlot | null>(null);
  const justDragged = useRef(false);
  const flip = useRef<{ tops: Map<string, number>; at: number } | null>(null);

  const press = (e: MouseEvent<HTMLElement>, index: number) => {
    if (e.button !== 0 || locked) return;
    if ((e.target as Element).closest('button, input, .step-check')) return;
    if (PINNED_MARKERS.has(steps[index]?.actionType ?? '')) return;
    const scroller = scrollRef.current;
    const body = bodyRef.current;
    if (!scroller || !body) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let pointer = { x: startX, y: startY };
    let frame = 0;
    let scrollFrame = 0;
    let indices: number[] = [];
    let dimmed: HTMLElement[] = [];
    let over: DropSlot | null = null;

    const rowAt = (i: number) => body.querySelector<HTMLElement>(`.step[data-index="${i}"]`);

    const update = () => {
      frame = 0;
      const hit = document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLElement>('.step, .step-ghost');
      let target: number;
      if (hit && body.contains(hit)) {
        if (hit.classList.contains('step-ghost')) target = Number(hit.dataset.anchor);
        else {
          const r = hit.getBoundingClientRect();
          target = Number(hit.dataset.index) + (pointer.y < r.top + r.height / 2 ? 0 : 1);
        }
      } else {
        const r = body.getBoundingClientRect();
        target = pointer.y < r.top ? 0 : steps.length;
      }
      // Dropping a run of steps on itself, or right after itself, moves nothing.
      const contiguous = indices[indices.length - 1] - indices[0] === indices.length - 1;
      const still = contiguous && target >= indices[0] && target <= indices[indices.length - 1] + 1;
      let next: DropSlot | null = null;
      if (!still) {
        const row = target < steps.length ? rowAt(target) : rowAt(steps.length - 1);
        if (row) next = { index: target, top: target < steps.length ? row.offsetTop : row.offsetTop + row.offsetHeight };
      }
      if (next?.index !== over?.index || next?.top !== over?.top) {
        over = next;
        setSlot(next);
      }
      if (!scrollFrame) scrollFrame = requestAnimationFrame(scroll);
    };

    const scroll = () => {
      scrollFrame = 0;
      const r = scroller.getBoundingClientRect();
      let delta = 0;
      if (pointer.y < r.top + EDGE) delta = -SPEED * Math.min(1, (r.top + EDGE - pointer.y) / EDGE);
      else if (pointer.y > r.bottom - EDGE) delta = SPEED * Math.min(1, (pointer.y - (r.bottom - EDGE)) / EDGE);
      if (delta === 0) return;
      scroller.scrollTop += delta;
      // What is under the pointer moved with the list.
      if (!frame) frame = requestAnimationFrame(update);
    };

    const move = (ev: globalThis.MouseEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      if (!active) {
        if (Math.abs(pointer.x - startX) + Math.abs(pointer.y - startY) < START) return;
        active = true;
        const sel = selectedIndices(steps);
        indices = snapIndicesToBlocks(sel.includes(index) ? sel : [index], steps);
        // The dimming is written on the rows, not rendered: a drag must not redraw the list.
        dimmed = indices.flatMap(i => rowAt(i) ?? []);
        for (const el of dimmed) el.setAttribute('data-dragging', '');
        document.body.style.cursor = 'grabbing';
        setDrag({ indices, lead: index, x: pointer.x, y: pointer.y });
      }
      if (!frame) frame = requestAnimationFrame(update);
    };

    const finish = (commit: boolean) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('keydown', key, true);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      if (!active) return;
      for (const el of dimmed) el.removeAttribute('data-dragging');
      document.body.style.cursor = '';
      // The click that ends a drag is not a click on the step under it.
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 0);
      if (commit && over) {
        snapshot(body);
        onDrop(indices, over.index);
      }
      setDrag(null);
      setSlot(null);
    };
    const up = () => finish(true);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !active) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('keydown', key, true);
  };

  // Where every step on screen was when it was dropped, to slide it from there once the engine's
  // new order is drawn (transform only, with the animations setting on).
  const snapshot = (body: HTMLElement) => {
    if (document.documentElement.getAttribute('data-animations') !== 'true') return;
    const view = scrollRef.current?.getBoundingClientRect();
    if (!view) return;
    const tops = new Map<string, number>();
    for (const el of visibleRows(body, view)) tops.set(el.dataset.key ?? '', el.getBoundingClientRect().top);
    flip.current = { tops, at: performance.now() };
  };

  useLayoutEffect(() => {
    const pending = flip.current;
    const body = bodyRef.current;
    if (!pending || !body) return;
    flip.current = null;
    // An answer that took too long (or never came) is not this drop's.
    if (performance.now() - pending.at > 800) return;
    const view = scrollRef.current?.getBoundingClientRect();
    if (!view) return;
    for (const el of visibleRows(body, view)) {
      const before = pending.tops.get(el.dataset.key ?? '');
      if (before === undefined) continue;
      const delta = before - el.getBoundingClientRect().top;
      if (Math.abs(delta) < 2 || Math.abs(delta) > view.height) continue;
      el.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    }
  }, [steps, bodyRef, scrollRef]);

  return {
    drag,
    slot,
    press,
    /** True for the click that a drag ends with. */
    justDragged: () => justDragged.current,
  };
}

/** The step rows inside the scrolled view — the only ones worth measuring in a long list. */
function visibleRows(body: HTMLElement, view: DOMRect): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of body.querySelectorAll<HTMLElement>('.step')) {
    const r = el.getBoundingClientRect();
    if (r.bottom < view.top) continue;
    if (r.top > view.bottom) break;
    out.push(el);
  }
  return out;
}
