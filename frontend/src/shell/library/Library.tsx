import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AppWindow, Ban, ChevronsDownUp, ChevronsUpDown, Copy, Download, Eraser, ExternalLink, FilePlus, Folder,
  FolderInput, FolderMinus, FolderOpen, FolderPlus, Info, Keyboard, Palette, Pencil, Pin, PinOff, Power,
  RotateCcw, Trash2, Type, Upload,
} from 'lucide-react';
import { useImport } from '../../logic/useImport';
import { useMacro } from '../../logic/useMacro';
import { Menu, type MenuEntry } from '../Menu';
import { anchorBelow, anchorFromEvent, fromKeyboard, type MenuAnchor } from '../menuAnchor';
import { useApp } from '../store';
import { useShellBand } from '../useShellBand';
import { ColorGrid } from './ColorGrid';
import type { LibraryDialogState } from './LibraryDialogs';
import { LibraryFolded } from './LibraryFolded';
import { LibraryPanel } from './LibraryPanel';
import { displayOrder, folderOf, freeName, neighbourOf, sectionsOf } from './model';
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
  const [peek, setPeek] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<LibraryDialogState | null>(null);
  const seq = useRef(0);

  const hidden = band === 'single' || band === 'compact';
  const bandFolds = band !== 'wide';
  // A peek only lives while the window keeps the library folded.
  if (peek && !bandFolds) setPeek(false);
  const showFolded = bandFolds || folded;
  const peeking = bandFolds && peek;
  const sections = sectionsOf(profiles, order);
  const ordered = displayOrder(sections);
  const names = profiles.map(p => p.name);

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
    setPeek(false);
  };
  const expand = () => {
    if (bandFolds) setPeek(true);
    else {
      setFolded(false);
      writeFolded(false);
    }
  };
  const fold = () => {
    if (peeking) setPeek(false);
    else {
      setFolded(true);
      writeFolded(true);
    }
  };
  const newMacro = (folder: string | null) => {
    // It is born saved and open, as "Untitled macro"; the name is typed in its header.
    macro.create(freeName('Untitled macro', names), folder);
    setPeek(false);
  };

  const contextMenu = (kind: 'macro' | 'folder') => (e: MouseEvent<HTMLElement>, name: string) => {
    e.preventDefault();
    setMenu({ kind, name, anchor: anchorFromEvent(e), keyboard: fromKeyboard(e), seq: ++seq.current });
  };
  const headerMenu = (kind: 'new' | 'more') => (button: HTMLElement, keyboard: boolean) => {
    if (menu?.kind === kind) { setMenu(null); return; }
    setMenu({ kind, button, anchor: anchorBelow(button, kind === 'new' ? 'start' : 'end'), keyboard, seq: ++seq.current });
  };

  const macroEntries = (name: string): MenuEntry[] => {
    const entry = profiles.find(p => p.name === name);
    if (!entry) return [];
    const inFolder = folderOf(name, order);
    const isOpen = name === active;
    return [
      { label: 'Rename…', icon: Pencil, onSelect: () => setDialog({ kind: 'renameMacro', name }) },
      { label: 'Duplicate', icon: Copy, onSelect: () => macro.duplicate(name) },
      {
        label: 'Move to folder',
        icon: FolderInput,
        submenu: order.folders.length === 0
          ? [{ label: 'No folders', disabled: true }]
          : [
              ...order.folders.map((f): MenuEntry => ({
                label: f.name,
                icon: Folder,
                iconColor: f.color,
                checked: inFolder?.name === f.name,
                onSelect: () => macro.moveToFolder(name, f.name),
              })),
              ...(inFolder ? ['separator' as const, { label: 'Remove from folder', icon: FolderMinus, onSelect: () => macro.moveToFolder(name, null) }] : []),
            ],
      },
      order.pinned.includes(name)
        ? { label: 'Unpin', icon: PinOff, onSelect: () => macro.unpin(name) }
        : { label: 'Pin', icon: Pin, onSelect: () => macro.pin(name) },
      'separator',
      // The triggers, the window target and the info are edited in the Inspector (phase 2).
      { label: 'Hotkey…', icon: Keyboard, notBuilt: true },
      { label: 'Hotstring…', icon: Type, notBuilt: true },
      { label: 'Window target…', icon: AppWindow, notBuilt: true },
      { label: 'Edit info…', icon: Info, notBuilt: true },
      'separator',
      { label: 'Export…', icon: Upload, onSelect: () => macro.exportMacros([name], true) },
      { label: 'Open in Explorer', icon: ExternalLink, onSelect: () => macro.openFolder(name) },
      'separator',
      // Only the open macro has a copy from when it was opened, and steps on screen (slice 3).
      ...(isOpen ? [
        { label: 'Revert to when I opened it', icon: RotateCcw, notBuilt: true },
        { label: 'Clear all steps…', icon: Eraser, notBuilt: true },
        'separator' as const,
      ] : []),
      entry.isDisabled
        ? { label: 'Enable', icon: Power, onSelect: () => macro.toggleDisabled(name) }
        : { label: 'Disable', icon: Ban, onSelect: () => macro.toggleDisabled(name) },
      'separator',
      { label: 'Delete macro…', icon: Trash2, danger: true, onSelect: () => setDialog({ kind: 'deleteMacro', name }) },
    ];
  };

  const folderEntries = (name: string): MenuEntry[] => {
    const folder = order.folders.find(f => f.name === name);
    if (!folder) return [];
    const members = sections.folders.find(s => s.folder.name === name)?.macros ?? [];
    const allOff = members.length > 0 && members.every(m => m.isDisabled);
    return [
      { label: 'Rename…', icon: Pencil, onSelect: () => setDialog({ kind: 'renameFolder', name }) },
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

  const newEntries: MenuEntry[] = [
    { label: 'New macro', icon: FilePlus, onSelect: () => newMacro(null) },
    { label: 'New folder', icon: FolderPlus, onSelect: () => setDialog({ kind: 'newFolder' }) },
  ];
  const moreEntries: MenuEntry[] = [
    { label: 'Import macros…', icon: Download, onSelect: imports.start },
    { label: 'Export macros…', icon: Upload, disabled: profiles.length === 0, onSelect: () => setDialog({ kind: 'export', names: [] }) },
    'separator',
    { label: 'Open macros folder', icon: FolderOpen, onSelect: () => macro.openFolder() },
    'separator',
    { label: 'Collapse all folders', icon: ChevronsDownUp, disabled: !order.folders.some(f => !f.collapsed), onSelect: () => macro.setAllFoldersCollapsed(true) },
    { label: 'Expand all folders', icon: ChevronsUpDown, disabled: !order.folders.some(f => f.collapsed), onSelect: () => macro.setAllFoldersCollapsed(false) },
  ];

  const menuEntries = !menu ? [] : menu.kind === 'macro' ? macroEntries(menu.name)
    : menu.kind === 'folder' ? folderEntries(menu.name)
    : menu.kind === 'new' ? newEntries : moreEntries;
  const menuLabel = !menu ? '' : menu.kind === 'macro' || menu.kind === 'folder' ? menu.name
    : menu.kind === 'new' ? 'New' : 'More macro actions';

  return (
    <aside className="shell-library" aria-label="Macros" data-folded={showFolded || undefined}>
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
      {!hidden && (!showFolded || peeking) && (
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
          onNewMacro={newMacro}
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
          {dialog && <LibraryDialog dialog={dialog} profiles={profiles} order={order} onClose={() => setDialog(null)} />}
          {(imports.warning || imports.preview || imports.result) && <ImportFlow flow={imports} />}
        </Suspense>,
        document.body,
      )}
    </aside>
  );
}
