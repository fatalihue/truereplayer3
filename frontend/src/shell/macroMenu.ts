import {
  AppWindow, Ban, Copy, Eraser, ExternalLink, Folder, FolderInput, FolderMinus, Info, Keyboard, Pencil, Pin,
  PinOff, Power, RotateCcw, Trash2, Type, Upload,
} from 'lucide-react';
import type { ProfileEntry, ProfileOrderData } from '../bridge/messageTypes';
import type { useMacro } from '../logic/useMacro';
import { folderOf } from './library/model';
import type { MenuEntry } from './Menu';
import { focusName, openDialog } from './ui';

type Tt = (en: string, pt: string) => string;

/**
 * The macro's menu: a right-click on it in the library, and ⋯ in its header when it is the open
 * one. Renaming the open macro types in its header; any other gets the dialog.
 */
export function macroMenuEntries({ name, profiles, order, active, locked, macro, tt }: {
  name: string;
  profiles: ProfileEntry[];
  order: ProfileOrderData;
  active: string | null;
  /** Recording or replaying: the engine refuses the revert then, so the item says so first. */
  locked: boolean;
  macro: ReturnType<typeof useMacro>;
  tt: Tt;
}): MenuEntry[] {
  const entry = profiles.find(p => p.name === name);
  if (!entry) return [];
  const inFolder = folderOf(name, order);
  const isOpen = name === active;
  return [
    { label: 'Rename…', icon: Pencil, onSelect: () => (isOpen ? focusName(name) : openDialog({ kind: 'renameMacro', name })) },
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
    // Only the open macro has a copy from when it was opened, and its steps on screen.
    ...(isOpen ? [
      {
        label: 'Revert to when I opened it',
        icon: RotateCcw,
        disabled: locked,
        tip: locked ? tt('Stop the run first', 'Pare a execução antes') : undefined,
        onSelect: () => openDialog({ kind: 'revertMacro', name }),
      },
      // Clearing goes with the list's own editing (phase 2).
      { label: 'Clear all steps…', icon: Eraser, notBuilt: true },
      'separator' as const,
    ] : []),
    entry.isDisabled
      ? { label: 'Enable', icon: Power, onSelect: () => macro.toggleDisabled(name) }
      : { label: 'Disable', icon: Ban, onSelect: () => macro.toggleDisabled(name) },
    'separator',
    { label: 'Delete macro…', icon: Trash2, danger: true, onSelect: () => openDialog({ kind: 'deleteMacro', name }) },
  ];
}
