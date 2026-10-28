import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronDown, ChevronsLeft, FolderOpen, Hash, MoreHorizontal, Pin, Plus, Search, SearchX, X } from 'lucide-react';
import type { ProfileEntry, ProfileFolder, ProfileOrderData } from '../../bridge/messageTypes';
import { useTt } from '../../state/LanguageContext';
import { DragGhost } from './DragGhost';
import { FolderCard } from './FolderCard';
import { MacroRow } from './MacroRow';
import { descriptionTip, displayOrder, isTagSearch, searchOf, type Sections } from './model';
import { useLibraryDrag } from './useLibraryDrag';

/** What the arrows walk, in the order on screen: macros, folder headers, a folder's "+ New macro". */
const ITEM = '.lib-macro, .lib-folder-header, .lib-new-in-folder';

/**
 * ③ The library as a panel: the header (Macros, New ▾, ⋯ and the button that folds it), the search,
 * and the list — pinned, the folders, Ungrouped; a flat list of what matches while searching.
 *
 * One stop on Tab. Inside it the arrows walk the macros and folders, → and ← open and close a
 * folder (← on a macro goes to its folder), Enter and Space open a macro or a folder, and Shift+F10
 * (or the Menu key) is the menu of whatever has the focus.
 */
export function LibraryPanel({ profiles, order, sections, active, locked, peek, menuFor, onFold, onOpen, onToggleFolder, onMacroMenu, onFolderMenu, onNewMenu, onMoreMenu, onNewMacro, onMove, onReorder, onRun }: {
  profiles: ProfileEntry[];
  order: ProfileOrderData;
  /** The library's sections, worked out once by the container for both of its forms. */
  sections: Sections;
  active: string | null;
  locked: boolean;
  /** Folded by the window and opened for a moment, over the steps. */
  peek: boolean;
  /** Which header menu is open, for its button's pressed look. */
  menuFor: 'new' | 'more' | null;
  onFold: () => void;
  onOpen: (name: string) => void;
  onToggleFolder: (name: string) => void;
  onMacroMenu: (e: MouseEvent<HTMLElement>, name: string) => void;
  onFolderMenu: (e: MouseEvent<HTMLElement>, name: string) => void;
  /** `keyboard`: opened with Enter or Space, so the first item takes the focus. */
  onNewMenu: (button: HTMLElement, keyboard: boolean) => void;
  onMoreMenu: (button: HTMLElement, keyboard: boolean) => void;
  onNewMacro: (folder: string | null) => void;
  onMove: (macro: string, folder: string | null) => void;
  onReorder: (folders: ProfileFolder[]) => void;
  /** A macro dropped on the steps: a Run Macro step there. */
  onRun: (macro: string, index: number) => void;
}) {
  const tt = useTt();
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<string | null>(null);
  const drag = useLibraryDrag({ listRef, order, profiles, onMove, onReorder, onRun });

  const match = searchOf(query);
  const found = match ? displayOrder(sections).filter(match) : null;
  // A folder whose every macro is disabled reads as disabled too.
  const offByFolder = new Map(sections.folders.map(({ folder, macros }) =>
    [folder.name, macros.length > 0 && macros.every(p => p.isDisabled)]));

  const open = (name: string) => {
    if (!drag.justDragged()) onOpen(name);
  };
  const toggle = (name: string) => {
    if (!drag.justDragged()) onToggleFolder(name);
  };

  // One Tab stop: the item that had the focus last, else the open macro, else the first item. Only
  // the old stop and the new one are touched: the rows render with tabIndex -1 and keep it.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const last = lastFocus.current;
    const stop = (last !== null
      ? Array.from(list.querySelectorAll<HTMLElement>(ITEM)).find(el => (el.dataset.name ?? el.dataset.folder) === last)
      : undefined)
      ?? list.querySelector<HTMLElement>('.lib-macro[aria-current="true"]')
      ?? list.querySelector<HTMLElement>(ITEM);
    const current = list.querySelector<HTMLElement>(':is(' + ITEM + ')[tabindex="0"]');
    if (current === stop) return;
    if (current) current.tabIndex = -1;
    if (stop) stop.tabIndex = 0;
  });

  // The tooltip of a name: the whole name when it is cut, and the description. Whether a name is
  // cut is a fact of the layout, so it is read for the one name under the pointer, as it arrives:
  // pointerover comes before the mouseover the tooltip layer reads data-tip on. Measuring every
  // name after each render cost ~30 ms of the launch and a layout of the whole list per switch.
  const lockedTip = tt('Stop the run to open another macro', 'Pare a execução para abrir outro macro');
  const tipFor = (target: EventTarget) => {
    const cell = (target as Element).closest?.<HTMLElement>('[data-name-cell]');
    if (!cell) return;
    const head = cell.firstElementChild as HTMLElement | null;
    const cut = !!head && head.scrollWidth > head.clientWidth;
    const row = cell.closest('.lib-macro');
    const tip = [
      locked && row?.getAttribute('aria-current') !== 'true' ? lockedTip : null,
      cut ? cell.dataset.full ?? null : null,
      descriptionTip(cell.dataset.desc) || null,
    ].filter(Boolean).join(' — ');
    if (tip) {
      cell.setAttribute('data-tip', tip);
      cell.setAttribute('data-tip-pos', 'below-start');
    } else {
      cell.removeAttribute('data-tip');
      cell.removeAttribute('data-tip-pos');
    }
  };

  // Opened over the steps for a moment: the focus goes into it (to the open macro, else the first
  // item), and a press anywhere else, or Esc, folds it back. Esc is heard on the document: the
  // button that opened the panel is outside it. A menu or a dialog takes its own Esc first.
  useEffect(() => {
    if (!peek) return;
    const list = listRef.current;
    (list?.querySelector<HTMLElement>('.lib-macro[aria-current="true"]') ?? list?.querySelector<HTMLElement>(ITEM))?.focus({ preventScroll: false });
    const outside = (e: Event) => {
      const t = e.target as Element;
      // The rail's Macros is the toggle: its own click takes the panel away.
      if (panelRef.current?.contains(t) || t.closest?.('.shell-menu-layer, [role="dialog"], [data-library-toggle]')) return;
      onFold();
    };
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.shell-menu-layer, [role="dialog"]')) return;
      e.preventDefault();
      onFold();
    };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', escape);
    };
  }, [peek, onFold]);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = listRef.current;
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLElement>(ITEM));
    const current = document.activeElement as HTMLElement;
    const at = items.indexOf(current);
    const go = (i: number) => {
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, i))]?.focus();
    };
    switch (e.key) {
      case 'ArrowDown': go(at + 1); break;
      case 'ArrowUp':
        if (at <= 0) { e.preventDefault(); searchRef.current?.focus(); }
        else go(at - 1);
        break;
      case 'Home': go(0); break;
      case 'End': go(items.length - 1); break;
      case 'ArrowRight':
        if (current.dataset.folder && current.getAttribute('aria-expanded') === 'false') {
          e.preventDefault();
          onToggleFolder(current.dataset.folder);
        }
        break;
      case 'ArrowLeft': {
        if (current.dataset.folder && current.getAttribute('aria-expanded') === 'true') {
          e.preventDefault();
          onToggleFolder(current.dataset.folder);
        } else if (!current.dataset.folder) {
          const header = current.closest('.lib-folder')?.querySelector<HTMLElement>('[data-folder]');
          if (header) { e.preventDefault(); header.focus(); }
        }
        break;
      }
    }
  };

  const row = (entry: ProfileEntry) => (
    <MacroRow
      key={entry.name}
      entry={entry}
      open={entry.name === active}
      locked={locked && entry.name !== active}
      dragging={drag.dragging?.kind === 'macro' && drag.dragging.name === entry.name}
      tt={tt}
      onOpen={open}
      onMenu={onMacroMenu}
      onPress={drag.pressMacro}
    />
  );
  const gap = (i: number) => {
    if (drag.dragging?.kind !== 'folder' || drag.gap !== i) return null;
    const from = order.folders.findIndex(f => f.name === drag.dragging!.name);
    return from === i || from + 1 === i ? null : <div className="lib-drop-gap" />;
  };
  const tags = isTagSearch(query);
  const draggingMacro = drag.dragging?.kind === 'macro';

  return (
    <div
      ref={panelRef}
      className="lib-panel"
      data-peek={peek || undefined}
    >
      <div className="lib-header">
        <span className="lib-title">Macros</span>
        <button
          type="button"
          className="lib-new"
          aria-haspopup="menu"
          aria-expanded={menuFor === 'new'}
          onClick={(e) => onNewMenu(e.currentTarget, e.detail === 0)}
        >
          <Plus aria-hidden="true" />
          New
          <ChevronDown aria-hidden="true" />
        </button>
        <button
          type="button"
          className="lib-icon-button"
          aria-label="More macro actions"
          aria-haspopup="menu"
          aria-expanded={menuFor === 'more'}
          data-tip={tt('More macro actions', 'Mais ações de macros')}
          onClick={(e) => onMoreMenu(e.currentTarget, e.detail === 0)}
        >
          <MoreHorizontal aria-hidden="true" />
        </button>
        <button
          type="button"
          className="lib-icon-button"
          aria-label={peek ? 'Close macro list' : 'Collapse macro list'}
          data-tip={peek ? tt('Close macro list', 'Fechar a lista de macros') : tt('Collapse macro list', 'Recolher a lista de macros')}
          onClick={onFold}
        >
          <ChevronsLeft aria-hidden="true" />
        </button>
      </div>

      <div className="lib-search">
        <label className="lib-search-field" data-tags={tags || undefined}>
          {tags ? <Hash aria-hidden="true" /> : <Search aria-hidden="true" />}
          <input
            ref={searchRef}
            type="text"
            aria-label="Search macros"
            placeholder="Search · # for tags"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                listRef.current?.querySelector<HTMLElement>(ITEM)?.focus();
              } else if (e.key === 'Escape' && query) {
                e.preventDefault();
                setQuery('');
              }
            }}
          />
          {query && (
            <button type="button" className="lib-search-clear" aria-label="Clear search" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>
              <X aria-hidden="true" />
            </button>
          )}
        </label>
      </div>

      <div
        ref={listRef}
        className="lib-list"
        role="group"
        aria-label="Macro list"
        onKeyDown={onListKey}
        onPointerOver={(e) => tipFor(e.target)}
        onFocus={(e) => {
          const t = e.target as HTMLElement;
          if (!t.matches(ITEM)) return;
          lastFocus.current = t.dataset.name ?? t.dataset.folder ?? null;
          for (const el of listRef.current?.querySelectorAll<HTMLElement>(ITEM) ?? []) el.tabIndex = el === t ? 0 : -1;
        }}
      >
        {found ? (
          found.length > 0 ? found.map(row) : (
            <div className="lib-empty">
              <SearchX aria-hidden="true" />
              <span>No results for "{query.trim()}"</span>
              <button type="button" className="lib-link" onClick={() => setQuery('')}>Clear search</button>
            </div>
          )
        ) : profiles.length === 0 ? (
          <div className="lib-empty">
            <FolderOpen aria-hidden="true" />
            <span>No macros yet</span>
            <button type="button" className="lib-link" onClick={() => onNewMacro(null)}>New macro</button>
          </div>
        ) : (
          <>
            {sections.pinned.length > 0 && (
              <>
                <div className="lib-heading"><Pin aria-hidden="true" />Pinned</div>
                {sections.pinned.map(row)}
              </>
            )}
            {sections.folders.map(({ folder, macros }, i) => (
              <Fragment key={folder.name}>
                {gap(i)}
                <FolderCard
                  folder={folder}
                  count={macros.length}
                  allOff={offByFolder.get(folder.name) ?? false}
                  dropping={draggingMacro && drag.target === folder.name}
                  dragging={drag.dragging?.kind === 'folder' && drag.dragging.name === folder.name}
                  onToggle={toggle}
                  onMenu={onFolderMenu}
                  onPress={drag.pressFolder}
                  onNewMacro={onNewMacro}
                >
                  {macros.map(row)}
                </FolderCard>
              </Fragment>
            ))}
            {gap(sections.folders.length)}
            <div className="lib-loose" data-drop={(draggingMacro && drag.target === '') || undefined}>
              {/* While a macro is dragged, Ungrouped is always there to drop it on — taking it out
                  of its folder — even when nothing is loose yet. */}
              {(sections.loose.length > 0 || draggingMacro) && (sections.pinned.length > 0 || sections.folders.length > 0) && (
                <div className="lib-heading" data-after="">Ungrouped</div>
              )}
              {sections.loose.map(row)}
            </div>
          </>
        )}
      </div>

      {drag.dragging && <DragGhost {...drag.dragging} />}
    </div>
  );
}
