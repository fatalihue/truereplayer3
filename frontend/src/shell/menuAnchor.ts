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
