import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AppWindow, Ban, Palette, Pencil, Power, Trash2,
} from 'lucide-react';
import { useImport } from '../../logic/useImport';
import { useMacro } from '../../logic/useMacro';
import { macroMenuEntries } from '../macroMenu';
import { Menu, type MenuEntry } from '../Menu';
import { anchorBelow, anchorFromEvent, fromKeyboard, type MenuAnchor } from '../menuAnchor';
import { useApp } from '../store';
import { closeDialog, openDialog, setLibraryPeek, useUi } from '../ui';
import { useShellBand } from '../useShellBand';
import { ColorGrid } from './ColorGrid';
import { LibraryFolded } from './LibraryFolded';
import { LibraryPanel } from './LibraryPanel';
import { libraryMenus, newMacro } from './libraryMenus';
import { displayOrder, neighbourOf, sectionsOf } from './model';
import './library.css';

// Not part of opening the app (rule 6): the dialogs load when the first one opens, and the import
// dialogs when an import first needs them.
const LibraryDialog = lazy(() => import('./LibraryDialogs'));
const ImportFlow = lazy(() => import('./ImportFlow'));

// The same key the shell of today keeps its folded library under, so the choice carries over.
const FOLDED_KEY = 'ui:sidebarCollapsed';
function readFolded(): boolean {
  try { return localStorage.getItem(FOLDED_KEY) === '1'; } catch { return false; }
}
function writeFolded(folded: boolean) {
  try { localStorage.setItem(FOLDED_KEY, folded ? '1' : '0'); } catch { /* storage off: the choice lasts the session */ }
}

type MenuState =
  | { kind: 'macro' | 'folder'; name: string; anchor: MenuAnchor; keyboard: boolean; seq: number }
  | { kind: 'new' | 'more'; anchor: MenuAnchor; keyboard: boolean; seq: number; button: HTMLElement };

/**
 * ③ The macro library: the panel, or folded into avatars — by the window below 1280 px, or by hand
 * (D28). Folded by the window, "Expand macro list" lays the panel over the steps until a macro is
 * opened, Esc, or a press elsewhere; folded by hand, it unfolds. The menus and dialogs of both
 * forms live here, and so does the rule that there is always a macro open while any exists (D1):
 * when the open one goes, the one next to it opens.
 */
export function Library() {
  const profiles = useApp(a => a.profiles);
  const order = useApp(a => a.profileOrder);
  const active = useApp(a => a.activeProfile);
  const locked = useApp(a => a.buttonStates.recordingActive || a.buttonStates.replayActive);
  const macro = useMacro();
  const imports = useImport();
  const band = useShellBand();
  const [folded, setFolded] = useState(readFolded);
  // Laid over the steps for a moment: from the folded library's Expand, or from the rail where the
  // window hides the library (520–759 px, one pane at a time).
  const peek = useUi(s => s.libraryPeek);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const dialog = useUi(s => s.dialog);
  const seq = useRef(0);

  const hidden = band === 'single' || band === 'compact';
  const bandFolds = band !== 'wide';
  // A peek only lives while the window keeps the library folded.
  useEffect(() => {
    if (peek && !bandFolds) setLibraryPeek(false);
  }, [peek, bandFolds]);
  // Ctrl+K's "Import macros…" starts the import here, where its dialogs live.
  useEffect(() => {
    useUi.setState({ startImport: imports.start });
    return () => useUi.setState({ startImport: null });
  }, [imports.start]);
  const showFolded = bandFolds || folded;
  const peeking = bandFolds && peek;
  const sections = sectionsOf(profiles, order);
  const ordered = displayOrder(sections);

  // The open macro is gone (deleted here, with its folder, or from disk): open the one next to it.
  // Remembered while a macro is open, because the engine may say "none open" a moment before the
  // list without it arrives.
  const lastOpen = useRef<{ name: string; order: string[] } | null>(null);
  useEffect(() => {
    const now = displayOrder(sectionsOf(profiles, order)).map(e => e.name);
    if (active != null) {
      lastOpen.current = { name: active, order: now };
      return;
    }
    const last = lastOpen.current;
    if (!last) return;
    const present = new Set(now);
    if (present.has(last.name)) return;
    lastOpen.current = null;
    const next = neighbourOf(last.name, last.order, present);
    if (next) macro.open(next);
  }, [active, profiles, order, macro]);

  const openMacro = (name: string) => {
    macro.open(name);
    setLibraryPeek(false);
  };
  const expand = () => {
    if (bandFolds) setLibraryPeek(true);
    else {
      setFolded(false);
      writeFolded(false);
    }
  };
  const fold = () => {
    if (peeking) setLibraryPeek(false);
    else {
      setFolded(true);
      writeFolded(true);
    }
  };
  const newMacroIn = (folder: string | null) => newMacro(macro, profiles, folder);

  const contextMenu = (kind: 'macro' | 'folder') => (e: MouseEvent<HTMLElement>, name: string) => {
    e.preventDefault();
    setMenu({ kind, name, anchor: anchorFromEvent(e), keyboard: fromKeyboard(e), seq: ++seq.current });
  };
  const headerMenu = (kind: 'new' | 'more') => (button: HTMLElement, keyboard: boolean) => {
    if (menu?.kind === kind) { setMenu(null); return; }
    setMenu({ kind, button, anchor: anchorBelow(button, kind === 'new' ? 'start' : 'end'), keyboard, seq: ++seq.current });
  };

  const macroEntries = (name: string) => macroMenuEntries({ name, profiles, order, active, locked, macro });

  const folderEntries = (name: string): MenuEntry[] => {
    const folder = order.folders.find(f => f.name === name);
    if (!folder) return [];
    const members = sections.folders.find(s => s.folder.name === name)?.macros ?? [];
    const allOff = members.length > 0 && members.every(m => m.isDisabled);
    return [
      { label: 'Rename…', icon: Pencil, onSelect: () => openDialog({ kind: 'renameFolder', name }) },
      {
        label: 'Color',
        icon: Palette,
        panel: (close) => <ColorGrid menu value={folder.color} onPick={(color) => { close(); macro.setFolderColor(name, color); }} />,
      },
      'separator',
      // The folder's window target uses the Inspector's editor (phase 2).
      { label: 'Window target…', icon: AppWindow, notBuilt: true },
      'separator',
      allOff
        ? { label: 'Enable all', icon: Power, onSelect: () => macro.toggleFolderDisabled(name) }
        : { label: 'Disable all', icon: Ban, onSelect: () => macro.toggleFolderDisabled(name) },
      'separator',
      { label: 'Delete folder', icon: Trash2, danger: true, onSelect: () => macro.deleteFolder(name) },
    ];
  };

  const { newEntries, moreEntries } = libraryMenus({ profiles, order, macro, startImport: imports.start });

  const menuEntries = !menu ? [] : menu.kind === 'macro' ? macroEntries(menu.name)
    : menu.kind === 'folder' ? folderEntries(menu.name)
    : menu.kind === 'new' ? newEntries : moreEntries;
  const menuLabel = !menu ? '' : menu.kind === 'macro' || menu.kind === 'folder' ? menu.name
    : menu.kind === 'new' ? 'New' : 'More macro actions';

  return (
    <aside className="shell-library" aria-label="Macros" data-folded={showFolded || undefined} data-peek={peeking || undefined}>
      {!hidden && showFolded && (
        <LibraryFolded
          macros={ordered}
          order={order}
          active={active}
          locked={locked}
          onExpand={expand}
          onOpen={openMacro}
          onMenu={contextMenu('macro')}
        />
      )}
      {(!hidden || peeking) && (!showFolded || peeking) && (
        <LibraryPanel
          profiles={profiles}
          order={order}
          sections={sections}
          active={active}
          locked={locked}
          peek={peeking}
          menuFor={menu?.kind === 'new' || menu?.kind === 'more' ? menu.kind : null}
          onFold={fold}
          onOpen={openMacro}
          onToggleFolder={macro.toggleFolderCollapsed}
          onMacroMenu={contextMenu('macro')}
          onFolderMenu={contextMenu('folder')}
          onNewMenu={headerMenu('new')}
          onMoreMenu={headerMenu('more')}
          onNewMacro={newMacroIn}
          onMove={macro.moveToFolder}
          onReorder={macro.reorder}
        />
      )}
      {menu && menuEntries.length > 0 && (
        <Menu
          key={menu.seq}
          anchor={menu.anchor}
          entries={menuEntries}
          label={menuLabel}
          focusFirst={menu.keyboard}
          toggle={menu.kind === 'new' || menu.kind === 'more' ? menu.button : null}
          onClose={() => setMenu(null)}
        />
      )}
      {/* In a portal: the library is hidden in the narrow layouts, and a dialog it opened (or an
          import that finished meanwhile) must still show. */}
      {createPortal(
        <Suspense fallback={null}>
          {dialog && <LibraryDialog dialog={dialog} profiles={profiles} order={order} onClose={closeDialog} />}
          {(imports.warning || imports.preview || imports.result) && <ImportFlow flow={imports} />}
        </Suspense>,
        document.body,
      )}
    </aside>
  );
}
