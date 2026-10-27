import {
  AppWindow, Ban, Copy, Eraser, ExternalLink, Folder, FolderInput, FolderMinus, Info, Keyboard, Pencil, Pin,
  PinOff, Power, RotateCcw, Trash2, Type, Upload,
} from 'lucide-react';
import type { ProfileEntry, ProfileOrderData } from '../bridge/messageTypes';
import type { useMacro } from '../logic/useMacro';
import { folderOf } from './library/model';
import { selection } from './list/selection';
import type { MenuEntry } from './Menu';
import { focusName, openDialog, openMacroSettings, type SettingsSection } from './ui';

type Tt = (en: string, pt: string) => string;

/**
 * The macro's menu: a right-click on it in the library, and ⋯ in its header when it is the open
 * one. Renaming the open macro types in its header; any other gets the dialog.
 */
export function macroMenuEntries({ name, profiles, order, active, locked, hasSteps, macro, tt }: {
  name: string;
  profiles: ProfileEntry[];
  order: ProfileOrderData;
  active: string | null;
  /** Recording or replaying: the engine refuses the revert then, so the item says so first. */
  locked: boolean;
  /**
   * The open macro has steps (Clear all steps… is off with none). A yes or no, not the count: the
   * count changes with every switch, and the library would draw once more for nothing.
   */
  hasSteps: boolean;
  macro: ReturnType<typeof useMacro>;
  tt: Tt;
}): MenuEntry[] {
  const entry = profiles.find(p => p.name === name);
  if (!entry) return [];
  const inFolder = folderOf(name, order);
  const isOpen = name === active;
  // The macro's own settings are in the Inspector with no step chosen: another macro opens first.
  const openSettings = (section: SettingsSection) => {
    if (!isOpen) macro.open(name);
    selection.clear();
    openMacroSettings(name, section);
  };
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
    { label: 'Hotkey…', icon: Keyboard, onSelect: () => openSettings('hotkey') },
    { label: 'Hotstring…', icon: Type, onSelect: () => openSettings('hotstring') },
    { label: 'Window target…', icon: AppWindow, onSelect: () => openSettings('target') },
    { label: 'Edit info…', icon: Info, onSelect: () => openSettings('info') },
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
      {
        label: 'Clear all steps…',
        icon: Eraser,
        disabled: locked || !hasSteps,
        tip: locked ? tt('Stop the run first', 'Pare a execução antes')
          : !hasSteps ? tt('There are no steps to clear', 'Não há passos para limpar') : undefined,
        onSelect: () => openDialog({ kind: 'clearSteps', name }),
      },
      'separator' as const,
    ] : []),
    entry.isDisabled
      ? { label: 'Enable', icon: Power, onSelect: () => macro.toggleDisabled(name) }
      : { label: 'Disable', icon: Ban, onSelect: () => macro.toggleDisabled(name) },
    'separator',
    { label: 'Delete macro…', icon: Trash2, danger: true, onSelect: () => openDialog({ kind: 'deleteMacro', name }) },
  ];
}
