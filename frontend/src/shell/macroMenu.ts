import {
  AppWindow, Ban, Copy, Eraser, ExternalLink, Folder, FolderInput, FolderMinus, Info, Keyboard, Pencil, Pin,
  PinOff, Power, RotateCcw, Trash2, Type, Upload, X,
} from 'lucide-react';
import type { ProfileEntry, ProfileOrderData } from '../bridge/messageTypes';
import type { useMacro } from '../logic/useMacro';
import { folderOf } from './library/model';
import { selection } from './list/selection';
import type { MenuEntry } from './Menu';
import { focusName, openDialog, openMacroSettings, openPage, type SettingsSection } from './ui';

type Tt = (en: string, pt: string) => string;

// The macro closed by hand, until another one opens.
let closedByHand: string | null = null;

/**
 * Closing the open macro, as TrueReplayer 2 deselects (D29, which revises D1): profile:click on the
 * open one takes the screen back to "no macro open", where every launch starts. Clicking it in the
 * library, and Close macro in its menu and in Ctrl+K. The library then opens no neighbour for it,
 * now or if it goes later.
 */
export const closedMacro = {
  close: (macro: ReturnType<typeof useMacro>, name: string) => {
    closedByHand = name;
    macro.click(name);
  },
  /** The macro that was the last one open was closed by hand. */
  was: (name: string) => closedByHand === name,
  /** A macro is open again. */
  clear: () => { closedByHand = null; },
};

/**
 * The macro's menu: a right-click on it in the library, and ⋯ in its header when it is the open
 * one. Renaming the open macro types in its header; any other gets the dialog.
 */
export function macroMenuEntries({ name, profiles, order, active, locked, clicker, hasSteps, macro, tt }: {
  name: string;
  profiles: ProfileEntry[];
  order: ProfileOrderData;
  active: string | null;
  /** Recording or replaying: the engine refuses the revert then, so the item says so first. */
  locked: boolean;
  /**
   * The Clicker is on: the steps are not the user's to change then, as everywhere in the shell, so
   * the revert and the clear wait for it too (casca-060; today's Clear all is off in the Clicker).
   */
  clicker: boolean;
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
  // Ctrl+K runs this menu from any page, so the macros' page comes first, as Macros in the rail
  // brings it: on a hidden page the Trigger's key capture listened unseen, and could set a hotkey.
  const openSettings = (section: SettingsSection) => {
    openPage('macros');
    if (!isOpen) macro.open(name);
    selection.clear();
    openMacroSettings(name, section);
  };
  // Why the steps can't change now: a run or a recording first, then the Clicker.
  const stepsLocked = locked || clicker;
  const lockTip = locked ? tt('Stop the run first', 'Pare a execução antes') : tt('The Clicker is on', 'O Clicker está ligado');
  return [
    { label: 'Rename…', icon: Pencil, onSelect: () => { if (isOpen) { openPage('macros'); focusName(name); } else openDialog({ kind: 'renameMacro', name }); } },
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
    // Only the open macro has a copy from when it was opened, and its steps on screen; and only it
    // closes (D29).
    ...(isOpen ? [
      {
        label: 'Close macro',
        icon: X,
        disabled: stepsLocked,
        tip: stepsLocked ? lockTip : undefined,
        onSelect: () => closedMacro.close(macro, name),
      },
      {
        label: 'Revert to when I opened it',
        icon: RotateCcw,
        disabled: stepsLocked,
        tip: stepsLocked ? lockTip : undefined,
        onSelect: () => openDialog({ kind: 'revertMacro', name }),
      },
      {
        label: 'Clear all steps…',
        icon: Eraser,
        disabled: stepsLocked || !hasSteps,
        tip: stepsLocked ? lockTip
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
