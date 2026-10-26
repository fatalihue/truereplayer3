import { ChevronsDownUp, ChevronsUpDown, Download, FilePlus, FolderOpen, FolderPlus, Upload } from 'lucide-react';
import type { ProfileEntry, ProfileOrderData } from '../../bridge/messageTypes';
import type { useMacro } from '../../logic/useMacro';
import type { MenuEntry } from '../Menu';
import { focusName, openDialog, setLibraryPeek } from '../ui';
import { freeName } from './model';

/**
 * A new macro: born saved and open, as "Untitled macro" (or the next free name), its name ready to
 * type in the header. From the library's New ▾, a folder's "+ New macro" and Ctrl+K.
 */
export function newMacro(macro: ReturnType<typeof useMacro>, profiles: ProfileEntry[], folder: string | null) {
  const name = freeName('Untitled macro', profiles.map(p => p.name));
  macro.create(name, folder);
  focusName(name);
  setLibraryPeek(false);
}

/**
 * The library's two menus: New ▾ and ⋯ (Menus board, "Biblioteca: New ▾ e ⋯"). One source, for the
 * library's buttons and for Ctrl+K (D5: New macro and New folder there too).
 */
export function libraryMenus({ profiles, order, macro, startImport }: {
  profiles: ProfileEntry[];
  order: ProfileOrderData;
  macro: ReturnType<typeof useMacro>;
  /** The import, which the library runs (its dialogs live there). */
  startImport: (() => void) | null;
}): { newEntries: MenuEntry[]; moreEntries: MenuEntry[] } {
  return {
    newEntries: [
      { label: 'New macro', icon: FilePlus, onSelect: () => newMacro(macro, profiles, null) },
      { label: 'New folder', icon: FolderPlus, onSelect: () => openDialog({ kind: 'newFolder' }) },
    ],
    moreEntries: [
      { label: 'Import macros…', icon: Download, disabled: !startImport, onSelect: () => startImport?.() },
      { label: 'Export macros…', icon: Upload, disabled: profiles.length === 0, onSelect: () => openDialog({ kind: 'export', names: [] }) },
      'separator',
      { label: 'Open macros folder', icon: FolderOpen, onSelect: () => macro.openFolder() },
      'separator',
      { label: 'Collapse all folders', icon: ChevronsDownUp, disabled: !order.folders.some(f => !f.collapsed), onSelect: () => macro.setAllFoldersCollapsed(true) },
      { label: 'Expand all folders', icon: ChevronsUpDown, disabled: !order.folders.some(f => f.collapsed), onSelect: () => macro.setAllFoldersCollapsed(false) },
    ],
  };
}
