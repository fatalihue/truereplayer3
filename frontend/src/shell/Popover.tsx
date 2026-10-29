import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeAtAnchor, type MenuAnchor } from './menuAnchor';

/**
 * A panel that drops from a button and holds fields, not a list of items: Record ▾ and Replay ▾.
 * It floats in the menu layer and is placed the way a menu is, before the first paint. Unlike a
 * menu, the arrows belong to its fields, so it does not move the focus between items.
 *
 * Esc closes it and gives the focus back to the button. A press outside closes it too — except on a
 * menu one of its fields opened, which lives in the same layer — and so does the focus leaving it
 * for something else, or a resize. The fields send what they hold when they go (they commit on
 * unmount), so closing never drops a number that was typed.
 *
 * A host that puts the focus back itself says so (`restoreFocus` false): a rich text editor, whose
 * caret a plain focus() would move to its start.
 */
export function Popover({ anchor, label, toggle, focusFirst, onClose, restoreFocus = true, children }: {
  anchor: MenuAnchor;
  label: string;
  /** The button that opened it and closes it again: a press there is the button's. */
  toggle: Element | null;
  /** Opened from the keyboard: the first field takes the focus. */
  focusFirst: boolean;
  onClose: () => void;
  restoreFocus?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const [opener] = useState(() => (restoreFocus && document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    const outside = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target || target.closest('.shell-menu-layer') || toggle?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose, toggle]);

  useEffect(() => () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }, 0);
  }, [opener]);

  // Placed and focused once, before the first paint: the panel does not move while it is open.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || placed.current) return;
    placed.current = true;
    const r = el.getBoundingClientRect();
    const spot = placeAtAnchor(anchor, { width: r.width, height: r.height });
    el.style.left = `${spot.left}px`;
    el.style.top = `${spot.top}px`;
    el.style.visibility = '';
    const first = focusFirst ? el.querySelector<HTMLElement>('input, button:not(:disabled)') : null;
    (first ?? el).focus({ preventScroll: true });
  }, [anchor, focusFirst]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return createPortal(
    <div className="shell-menu-layer">
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className="shell-popover menu-surface pop-in"
        style={{ left: -9999, top: -9999, visibility: 'hidden' }}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // The focus left for somewhere that is neither the panel nor a menu it opened. A blur to
          // nothing (a press on the panel's own text, the window losing the focus) is not leaving.
          const next = e.relatedTarget as Element | null;
          if (next && !next.closest('.shell-menu-layer') && !toggle?.contains(next)) onClose();
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
