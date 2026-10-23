import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, type LucideIcon } from 'lucide-react';
import { placeAtAnchor, placeBeside, type MenuAnchor, type Size, type Spot } from './menuAnchor';

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  /** The icon's colour, when it carries data (a folder's own colour). */
  iconColor?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** A check at the end: the folder the macro is in, the colour the folder has. */
  checked?: boolean;
  /** A feature a later slice brings: shown disabled in the development build, left out otherwise. */
  notBuilt?: boolean;
  submenu?: MenuEntry[];
  /** A submenu that is not a list of items (the folder colours). It gets the menu's close. */
  panel?: (close: () => void) => ReactNode;
  tip?: string;
  /** The key that does the same from the list ("Ctrl+C", "Del"), drawn at the end. */
  shortcut?: string;
}
export type MenuEntry = MenuItem | 'separator';

/** Drops the items this build does not have, and the separators that leaves dangling. */
function visible(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    if (entry === 'separator') {
      if (out.length > 0 && out[out.length - 1] !== 'separator') out.push(entry);
    } else if (!entry.notBuilt || import.meta.env.DEV) {
      out.push(entry);
    }
  }
  while (out[out.length - 1] === 'separator') out.pop();
  return out;
}

/**
 * The shell's one menu: right-click menus, the library's New ▾ and ⋯, and the submenus inside them.
 * It floats in a portal, so no list that scrolls can clip it, and it is placed in two passes — laid
 * out out of sight, measured, then put where it fits — before the first paint.
 *
 * Keys: ↑ ↓ Home End move, → opens a submenu and ← closes it, Enter and Space choose (they are
 * buttons), Esc closes the submenu and then the menu, Tab closes. A press outside, a scroll or a
 * resize closes it too. The focus goes back to whatever had it when the menu opened.
 */
export function Menu({ anchor, entries, label, onClose, focusFirst = false, toggle }: {
  anchor: MenuAnchor;
  entries: MenuEntry[];
  label: string;
  onClose: () => void;
  /** Opened from the keyboard: the first item takes the focus, not the menu. */
  focusFirst?: boolean;
  /** The button that opened it and closes it again: a press there is the button's, not "outside". */
  toggle?: Element | null;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    const outside = (e: Event) => {
      const target = e.target as Node;
      if (layerRef.current?.contains(target) || (e.type === 'mousedown' && toggle?.contains(target))) return;
      onClose();
    };
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('scroll', outside, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose, toggle]);

  // The focus returns to the opener when the menu goes — unless the choice already moved it
  // somewhere real (a dialog the item opened takes it, and keeps it).
  useEffect(() => () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    }, 0);
  }, [opener]);

  return createPortal(
    <div ref={layerRef} className="shell-menu-layer">
      <MenuList
        entries={visible(entries)}
        label={label}
        place={(size) => placeAtAnchor(anchor, size)}
        focusFirst={focusFirst}
        onClose={onClose}
        onBack={onClose}
      />
    </div>,
    document.body,
  );
}

function MenuList({ entries, label, place, focusFirst, onClose, onBack, panel }: {
  entries: MenuEntry[];
  label: string;
  place: (size: Size) => Spot;
  focusFirst: boolean;
  onClose: () => void;
  /** Esc and ←: a submenu closes back to its item; the top list closes the menu. */
  onBack: () => void;
  panel?: ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  const [open, setOpen] = useState<{ index: number; rect: DOMRect; focusFirst: boolean } | null>(null);

  // Laid out out of sight, measured, then placed and focused — before the first paint, and once:
  // a re-render (a submenu opening) must not move the list or take the focus back.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || placed.current) return;
    placed.current = true;
    const r = el.getBoundingClientRect();
    const spot = place({ width: r.width, height: r.height });
    el.style.left = `${spot.left}px`;
    el.style.top = `${spot.top}px`;
    el.style.visibility = '';
    const target = focusFirst ? firstItem(el) : el;
    target?.focus({ preventScroll: true });
  }, [place, focusFirst]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      list[(to + list.length) % list.length]?.focus({ preventScroll: true });
    };
    switch (e.key) {
      case 'ArrowDown': move(at + 1); break;
      case 'ArrowUp': move(at < 0 ? list.length - 1 : at - 1); break;
      case 'Home': move(0); break;
      case 'End': move(list.length - 1); break;
      case 'ArrowRight': {
        const target = document.activeElement as HTMLElement | null;
        const index = Number(target?.dataset.menuIndex);
        if (target?.dataset.submenu && Number.isFinite(index)) {
          e.preventDefault();
          setOpen({ index, rect: target.getBoundingClientRect(), focusFirst: true });
        }
        break;
      }
      case 'ArrowLeft':
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onBack();
        break;
      case 'Tab':
        e.preventDefault();
        onClose();
        break;
    }
  };

  const sub = open !== null ? entries[open.index] : null;

  return (
    <>
      <div
        ref={listRef}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        className="shell-menu menu-surface pop-in"
        style={{ left: -9999, top: -9999, visibility: 'hidden' }}
        onKeyDown={onKeyDown}
      >
        {panel ?? entries.map((entry, i) => {
          if (entry === 'separator') return <div key={`sep-${i}`} role="separator" className="shell-menu-separator" />;
          const Icon = entry.icon;
          const hasSub = !!(entry.submenu || entry.panel);
          const disabled = entry.disabled || entry.notBuilt;
          return (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              className="menu-item shell-menu-item"
              data-danger={entry.danger || undefined}
              data-menu-index={i}
              data-submenu={hasSub || undefined}
              aria-haspopup={hasSub ? 'menu' : undefined}
              aria-expanded={hasSub ? open?.index === i : undefined}
              aria-current={entry.checked || undefined}
              aria-keyshortcuts={entry.shortcut}
              disabled={disabled}
              data-tip={entry.tip}
              onMouseEnter={(e) => {
                if (hasSub && !disabled) {
                  if (open?.index !== i) setOpen({ index: i, rect: e.currentTarget.getBoundingClientRect(), focusFirst: false });
                } else if (open) {
                  setOpen(null);
                }
              }}
              onClick={(e) => {
                if (hasSub) {
                  setOpen({ index: i, rect: e.currentTarget.getBoundingClientRect(), focusFirst: true });
                  return;
                }
                onClose();
                entry.onSelect?.();
              }}
            >
              <span className="shell-menu-icon" style={entry.iconColor ? { color: entry.iconColor } : undefined}>{Icon && <Icon aria-hidden="true" />}</span>
              <span className="shell-menu-label">{entry.notBuilt ? `${entry.label} — not built yet` : entry.label}</span>
              {entry.shortcut && <kbd className="kbd shell-menu-kbd" aria-hidden="true">{entry.shortcut}</kbd>}
              {entry.checked && <Check className="shell-menu-end" aria-hidden="true" />}
              {hasSub && <ChevronRight className="shell-menu-end" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {open && sub && sub !== 'separator' && (
        <MenuList
          key={open.index}
          entries={sub.submenu ? visible(sub.submenu) : []}
          panel={sub.panel?.(onClose)}
          label={sub.label}
          place={(size) => placeBeside(open.rect, size)}
          focusFirst={open.focusFirst}
          onClose={onClose}
          onBack={() => {
            setOpen(null);
            listRef.current?.querySelector<HTMLElement>(`[data-menu-index="${open.index}"]`)?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}

function firstItem(list: HTMLElement): HTMLElement | null {
  return list.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)');
}
