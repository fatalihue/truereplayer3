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

export interface Size { width: number; height: number }
export interface Spot { left: number; top: number }

/** Where a menu (or a Popover) goes: at its anchor, kept inside the window, above the button when there is no room below. */
export function placeAtAnchor(anchor: MenuAnchor, size: Size): Spot {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left: number;
  let top: number;
  if (anchor.kind === 'point') {
    left = anchor.x;
    top = anchor.y;
    if (top + size.height > vh - MARGIN) top = Math.max(MARGIN, top - size.height);
  } else {
    const { rect, align } = anchor;
    left = align === 'start' ? rect.left : rect.right - size.width;
    top = rect.bottom + 4;
    if (top + size.height > vh - MARGIN && rect.top - 4 - size.height >= MARGIN) top = rect.top - 4 - size.height;
  }
  if (left + size.width > vw - MARGIN) left = vw - MARGIN - size.width;
  return { left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) };
}

/** A submenu opens beside its item, on the side with room, top-aligned to it. */
export function placeBeside(item: DOMRect, size: Size): Spot {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = item.right + 2;
  if (left + size.width > vw - MARGIN && item.left - 2 - size.width >= MARGIN) left = item.left - 2 - size.width;
  let top = item.top - 5;
  if (top + size.height > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - size.height);
  return { left: Math.max(MARGIN, left), top };
}
