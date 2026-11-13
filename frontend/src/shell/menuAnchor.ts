/**
 * Where a menu opens: at the cursor (a right-click, or Shift+F10 on a focused item), or under the
 * button that opened it, aligned to its start or end edge.
 */
export type MenuAnchor =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'below'; rect: DOMRect; align: 'start' | 'end' };

type ContextEvent = { clientX: number; clientY: number; button: number; currentTarget: Element };

/**
 * A context menu opened from the keyboard (Shift+F10, the Menu key) rather than the mouse. A
 * right-click is button 2; the keyboard's comes as button -1 in Edge, with the point at the
 * middle of the focused item — and as 0,0 in other engines.
 */
export const fromKeyboard = (e: ContextEvent) => e.button !== 2 || (e.clientX === 0 && e.clientY === 0);

/** The anchor for a context menu from its event: the cursor, or under the item from the keyboard. */
export function anchorFromEvent(e: ContextEvent): MenuAnchor {
  if (fromKeyboard(e)) {
    const r = e.currentTarget.getBoundingClientRect();
    return { kind: 'point', x: r.left + 12, y: r.bottom };
  }
  return { kind: 'point', x: e.clientX, y: e.clientY };
}

/** The anchor under a button. */
export function anchorBelow(button: Element, align: 'start' | 'end'): MenuAnchor {
  return { kind: 'below', rect: button.getBoundingClientRect(), align };
}

const MARGIN = 8;
/** Between a button and what drops from it. */
const GAP = 4;
/** A size measured in whole pixels (offsetHeight) may be short by a fraction of one: a fit is asked with a pixel to spare, so a panel that fits never scrolls by a hair. */
const SPARE = 1;

export interface Size { width: number; height: number }
/**
 * Where it goes, and the tallest it may be there: past that it scrolls, so no part of it is ever out
 * of the window. `bottom` is set when it went above its anchor: from the window's bottom edge to its
 * own, which stays against the anchor if its height changes.
 */
export interface Spot { left: number; top: number; maxHeight: number; bottom?: number }

/**
 * Where a menu (or a Popover) goes: at its anchor, kept inside the window. Under a button it opens
 * below, or above when only there does it fit whole; whole on neither side, it takes the side with
 * more room and is cut to it. At a point it opens there, or above it, or as high as the window lets.
 */
export function placeAtAnchor(anchor: MenuAnchor, size: Size): Spot {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const height = size.height + SPARE;
  let left: number;
  let top: number;
  let maxHeight: number;
  let bottom: number | undefined;
  if (anchor.kind === 'point') {
    left = anchor.x;
    top = anchor.y;
    if (top + height > vh - MARGIN) {
      top = Math.max(MARGIN, top - height);
      if (top > MARGIN) bottom = vh - anchor.y;
    }
    // Hanging from the point, it may grow up to the window's top; otherwise, down to its bottom.
    maxHeight = bottom === undefined ? vh - MARGIN - top : anchor.y - MARGIN;
  } else {
    const { rect, align } = anchor;
    left = align === 'start' ? rect.left : rect.right - size.width;
    const below = vh - MARGIN - (rect.bottom + GAP);
    const above = rect.top - GAP - MARGIN;
    if (height <= below || below >= above) {
      top = Math.max(MARGIN, rect.bottom + GAP);
      maxHeight = vh - MARGIN - top;
    } else {
      top = rect.top - GAP - Math.min(height, above);
      maxHeight = above;
      bottom = vh - (rect.top - GAP);
    }
  }
  if (left + size.width > vw - MARGIN) left = vw - MARGIN - size.width;
  return { left: Math.max(MARGIN, left), top, maxHeight: Math.max(0, maxHeight), bottom };
}

/** A submenu opens beside its item, on the side with room, top-aligned to it. */
export function placeBeside(item: DOMRect, size: Size): Spot {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = item.right + 2;
  if (left + size.width > vw - MARGIN && item.left - 2 - size.width >= MARGIN) left = item.left - 2 - size.width;
  const height = size.height + SPARE;
  let top = item.top - 5;
  if (top + height > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - height);
  return { left: Math.max(MARGIN, left), top, maxHeight: vh - MARGIN - top };
}
