import { BookOpen, Download, FilePlus, FolderOpen, FolderPlus, Upload } from 'lucide-react';
import type { ProfileEntry } from '../../bridge/messageTypes';
import type { useMacro } from '../../logic/useMacro';
import type { MenuEntry } from '../Menu';
import { focusName, openDialog, openExamples, setLibraryPeek } from '../ui';
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
 * library's buttons and for Ctrl+K (D5: New macro and New folder there too). Collapse and Expand all
 * folders left the ⋯ for the header's own button (D29); Ctrl+K has them as one command.
 */
export function libraryMenus({ profiles, macro, startImport }: {
  profiles: ProfileEntry[];
  macro: ReturnType<typeof useMacro>;
  /** The import, which the library runs (its dialogs live there). */
  startImport: (() => void) | null;
}): { newEntries: MenuEntry[]; moreEntries: MenuEntry[] } {
  return {
    newEntries: [
      { label: 'New macro', icon: FilePlus, onSelect: () => newMacro(macro, profiles, null) },
      // The 19 examples inside the app (decision 4), copied into the Examples folder when used.
      { label: 'From an example…', icon: BookOpen, onSelect: () => openExamples() },
      { label: 'New folder', icon: FolderPlus, onSelect: () => openDialog({ kind: 'newFolder' }) },
    ],
    moreEntries: [
      { label: 'Import macros…', icon: Download, disabled: !startImport, onSelect: () => startImport?.() },
      { label: 'Export macros…', icon: Upload, disabled: profiles.length === 0, onSelect: () => openDialog({ kind: 'export', names: [] }) },
      'separator',
      { label: 'Open macros folder', icon: FolderOpen, onSelect: () => macro.openFolder() },
    ],
  };
}
