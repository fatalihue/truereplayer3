import { useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import type { ProfileEntry, ProfileFolder, ProfileOrderData } from '../../bridge/messageTypes';
import { folderOf } from './model';

export type DragKind = 'macro' | 'folder';

/** A folder card carries data-drag-item ("folder:Name"); a macro row, its data-name. */
const dragKey = (el: HTMLElement) => el.dataset.dragItem ?? `macro:${el.dataset.name}`;

const START = 5;   // px the pointer moves before a press becomes a drag
const EDGE = 40;   // px from the list's top or bottom where it scrolls by itself
const SPEED = 14;  // px per frame at the very edge

/**
 * Dragging in the library: a macro onto a folder (or onto Ungrouped, out of its folder), and a
 * folder up or down among the folders — the only way to order them.
 *
 * Mouse events, not HTML drag and drop (WebView2 shows the system's drag image and cursor for
 * that). The pointer is read every event and the work is done once a frame: the card under the
 * pointer moves by transform, and the target only re-renders when it changes. Esc cancels. When
 * the engine's new order arrives, the rows slide from where they were (transform only, with the
 * animations setting on).
 */
export function useLibraryDrag({ listRef, order, profiles, onMove, onReorder }: {
  listRef: RefObject<HTMLElement | null>;
  order: ProfileOrderData;
  profiles: ProfileEntry[];
  onMove: (macro: string, folder: string | null) => void;
  onReorder: (folders: ProfileFolder[]) => void;
}) {
  const [dragging, setDragging] = useState<{ kind: DragKind; name: string; x: number; y: number } | null>(null);
  /** A macro drag: the folder under the pointer, '' for Ungrouped, null for neither. */
  const [target, setTarget] = useState<string | null>(null);
  /** A folder drag: the place it would go, 0 to the number of folders. */
  const [gap, setGap] = useState<number | null>(null);
  const justDragged = useRef(false);
  const flip = useRef<{ tops: Map<string, number>; selector: string; at: number } | null>(null);

  const press = (e: MouseEvent<HTMLElement>, kind: DragKind, name: string) => {
    if (e.button !== 0) return;
    const list = listRef.current;
    if (!list) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const folders = order.folders;
    let active = false;
    let pointer = { x: startX, y: startY };
    let frame = 0;
    let scrollFrame = 0;
    let overTarget: string | null = null;
    let overGap: number | null = null;
    let folderCards: { name: string; el: HTMLElement }[] = [];
    let loose: HTMLElement | null = null;

    const inside = (el: Element) => {
      const r = el.getBoundingClientRect();
      return pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;
    };

    const update = () => {
      frame = 0;
      if (kind === 'macro') {
        let found: string | null = null;
        for (const card of folderCards) if (inside(card.el)) found = card.name;
        if (found === null && loose && inside(loose)) found = '';
        if (found !== overTarget) {
          overTarget = found;
          setTarget(found);
        }
      } else {
        // The first folder whose middle is below the pointer; past them all, the end. Continuous,
        // so the space between cards and the body of an open folder are not dead zones.
        let best = folders.length;
        for (let i = 0; i < folders.length; i++) {
          const card = folderCards.find(c => c.name === folders[i].name);
          if (!card) continue;
          const r = card.el.getBoundingClientRect();
          if (pointer.y < r.top + r.height / 2) { best = i; break; }
        }
        if (best !== overGap) {
          overGap = best;
          setGap(best);
        }
      }
      if (!scrollFrame) scrollFrame = requestAnimationFrame(scroll);
    };

    const scroll = () => {
      scrollFrame = 0;
      const r = list.getBoundingClientRect();
      let delta = 0;
      if (pointer.y < r.top + EDGE) delta = -SPEED * Math.min(1, (r.top + EDGE - pointer.y) / EDGE);
      else if (pointer.y > r.bottom - EDGE) delta = SPEED * Math.min(1, (pointer.y - (r.bottom - EDGE)) / EDGE);
      if (delta === 0) return;
      list.scrollTop += delta;
      // What is under the pointer moved with the list.
      if (!frame) frame = requestAnimationFrame(update);
    };

    const move = (ev: globalThis.MouseEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      if (!active) {
        if (Math.abs(pointer.x - startX) + Math.abs(pointer.y - startY) < START) return;
        active = true;
        folderCards = Array.from(list.querySelectorAll<HTMLElement>('[data-drag-item^="folder:"]'))
          .map(el => ({ name: dragKey(el).slice('folder:'.length), el }));
        loose = list.querySelector<HTMLElement>('.lib-loose');
        document.body.style.cursor = 'grabbing';
        setDragging({ kind, name, x: pointer.x, y: pointer.y });
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
      document.body.style.cursor = '';
      // The click that ends a drag is not a click on the row or the folder under it.
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 0);
      if (commit && kind === 'macro' && overTarget !== null) {
        const to = overTarget === '' ? null : overTarget;
        if ((folderOf(name, order)?.name ?? null) !== to) {
          snapshot(list, '.lib-macro');
          onMove(name, to);
        }
      } else if (commit && kind === 'folder' && overGap !== null) {
        const from = folders.findIndex(f => f.name === name);
        // Dropping it where it is, or right after itself, leaves the order as it is.
        if (from >= 0 && overGap !== from && overGap !== from + 1) {
          const next = [...folders];
          const [moved] = next.splice(from, 1);
          next.splice(overGap > from ? overGap - 1 : overGap, 0, moved);
          snapshot(list, '[data-drag-item^="folder:"]');
          onReorder(next);
        }
      }
      setDragging(null);
      setTarget(null);
      setGap(null);
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

  // Where every row or folder was when it was dropped, to slide it from there once the new order
  // is on screen. Measured without the drop gap, which pushes the cards below it down.
  const snapshot = (list: HTMLElement, selector: string) => {
    if (document.documentElement.getAttribute('data-animations') !== 'true') return;
    const gaps = Array.from(list.querySelectorAll<HTMLElement>('.lib-drop-gap'));
    const scrollTop = list.scrollTop;
    for (const g of gaps) g.style.display = 'none';
    const tops = new Map<string, number>();
    for (const el of list.querySelectorAll<HTMLElement>(selector)) tops.set(dragKey(el), el.getBoundingClientRect().top);
    for (const g of gaps) g.style.display = '';
    list.scrollTop = scrollTop;
    flip.current = { tops, selector, at: performance.now() };
  };

  useLayoutEffect(() => {
    const pending = flip.current;
    const list = listRef.current;
    if (!pending || !list) return;
    flip.current = null;
    // An answer that took too long (or never came) is not this drop's.
    if (performance.now() - pending.at > 800) return;
    const view = list.getBoundingClientRect();
    for (const el of list.querySelectorAll<HTMLElement>(pending.selector)) {
      const before = pending.tops.get(dragKey(el));
      if (before === undefined) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom < view.top || r.top > view.bottom) continue;
      const delta = before - r.top;
      if (Math.abs(delta) < 2 || Math.abs(delta) > view.height) continue;
      el.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    }
  }, [order, profiles, listRef]);

  return {
    /** The drag under way (where it started, for the card that follows the pointer), or null. */
    dragging,
    target,
    gap,
    pressMacro: (e: MouseEvent<HTMLElement>, name: string) => press(e, 'macro', name),
    pressFolder: (e: MouseEvent<HTMLElement>, name: string) => press(e, 'folder', name),
    /** True for the click that a drag ends with. */
    justDragged: () => justDragged.current,
  };
}
