import { useCallback, useLayoutEffect, useRef } from 'react';
import type { FocusEvent, KeyboardEvent, RefObject } from 'react';

/**
 * The WAI-ARIA toolbar pattern over an existing row of buttons: the row is ONE Tab stop, ←/→ move
 * between its tools, Home/End jump to the ends, and Tab leaves for whatever comes next.
 *
 * Owner decision 2026-10-16. Every tool used to carry tabIndex −1, so the main toolbar did not
 * exist for the keyboard at all — from the profile panel, Tab went straight to the grid. The −1
 * was there so a clicked button would not keep the focus (a later Space/Enter re-fired it); the
 * row's own onMouseDown preventDefault already guarantees that, so the roving stop keeps it.
 *
 * The tools are read from the DOM on every render rather than registered: the row folds its tail
 * into More ▾ when it runs out of room, items enable and disable with the run state, and menus
 * open inside it. A tool = a button under the row that is rendered, enabled, and not inside an
 * open menu / listbox / dialog. The props stay `tabIndex={-1}`; the hook writes 0 on exactly one
 * of them (React leaves an attribute alone while its prop does not change).
 */
export function useRovingToolbar(rowRef: RefObject<HTMLElement | null>) {
  const current = useRef<HTMLElement | null>(null);

  const tools = useCallback((): HTMLButtonElement[] => {
    const row = rowRef.current;
    if (!row) return [];
    return [...row.querySelectorAll<HTMLButtonElement>('button')].filter(b =>
      !b.disabled
      && b.getClientRects().length > 0
      && !b.closest('[role="menu"], [role="listbox"], [role="dialog"], .menu-surface'));
  }, [rowRef]);

  const settle = useCallback((list: HTMLButtonElement[]) => {
    if (!current.current || !list.includes(current.current as HTMLButtonElement)) current.current = list[0] ?? null;
    for (const b of list) {
      const want = b === current.current ? 0 : -1;
      if (b.tabIndex !== want) b.tabIndex = want;
    }
  }, []);

  // Every render: the set of tools can change with any of the toolbar's own state.
  useLayoutEffect(() => { settle(tools()); });

  const onFocus = useCallback((e: FocusEvent<HTMLElement>) => {
    const list = tools();
    const t = e.target as HTMLButtonElement;
    if (list.includes(t) && current.current !== t) { current.current = t; settle(list); }
  }, [tools, settle]);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const list = tools();
    const at = list.indexOf(e.target as HTMLButtonElement);
    if (at < 0) return; // inside an open menu or on something that is not a tool
    let next = -1;
    if (e.key === 'ArrowRight') next = (at + 1) % list.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else return;
    e.preventDefault();
    e.stopPropagation();
    current.current = list[next];
    settle(list);
    list[next].focus();
  }, [tools, settle]);

  return { onFocus, onKeyDown };
}
