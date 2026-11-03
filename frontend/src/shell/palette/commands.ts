import { Ban, Copy, ExternalLink, Folder, FolderMinus, Pencil, Pin, PinOff, Power, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import type { ActionItem, ProfileEntry, ProfileOrderData } from '../../bridge/messageTypes';
import { t } from '../../i18n';
import { formatKeyCombo, isCoordinateClick } from '../../utils/displayUtils';
import type { MenuEntry, MenuItem } from '../Menu';
import { keycaps } from '../library/model';
import { stepName } from '../list/stepTypes';

/** The groups of Ctrl+K, in their order on screen (their names: palette.groups). */
export type PaletteGroup = 'macros' | 'steps' | 'commands';

/** One line of Ctrl+K: a macro to open, a step to go to, or a command to run. */
export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  /** What it is about, after the label ("Trade Roblox · step 17", "Macro", the folder). */
  detail?: string;
  /** The keys that do the same, drawn as caps at the end. */
  keys?: string;
  /** More words it is found by, never shown. */
  words?: string;
  /** A step's icon (the list's CSS masks), or a menu's own icon. */
  stepIcon?: string | null;
  icon?: MenuItem['icon'];
  disabled?: boolean;
  /** Why it is off, in its tip. */
  hint?: string;
  run: () => void;
}

// ── Search: every word typed starts a word of the line (accents and case aside); a longer one may
// also sit inside a word. Lines whose label matches come first, in their own order.

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const wordsOf = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

export function scoreOf(item: PaletteItem, tokens: string[]): number {
  if (tokens.length === 0) return 1;
  const label = wordsOf(item.label);
  const rest = wordsOf(`${item.detail ?? ''} ${item.words ?? ''} ${item.keys ?? ''}`);
  let score = 0;
  for (const token of tokens) {
    if (label.some(w => w.startsWith(token))) score += 3;
    else if (rest.some(w => w.startsWith(token))) score += 2;
    else if (token.length >= 3 && [...label, ...rest].some(w => w.includes(token))) score += 1;
    else return 0;
  }
  return score + (fold(item.label).startsWith(tokens.join(' ')) ? 2 : 0);
}
export const tokensOf = (query: string) => wordsOf(query);

// ── Macros ──

export function macroItems(order: ProfileOrderData, ordered: ProfileEntry[], active: string | null, open: (name: string) => void): PaletteItem[] {
  const folderOf = new Map<string, string>();
  for (const f of order.folders) for (const m of f.items) folderOf.set(m, f.name);
  return ordered.map(p => ({
    id: `macro:${p.name}`,
    group: 'macros' as const,
    label: p.name,
    detail: order.pinned.includes(p.name) ? t('palette.detail.pinned') : folderOf.get(p.name),
    keys: p.hotkey ? keycaps(p.hotkey) : undefined,
    words: [p.hotstring, p.isDisabled ? t('palette.words.disabled') : '', p.name === active ? t('palette.words.open') : ''].filter(Boolean).join(' '),
    run: () => open(p.name),
  }));
}

// ── Steps of the open macro ──

/** What a step is about, as plain text: the point, the key, the text, the check. */
function stepText(s: ActionItem): string {
  const type = s.actionType;
  if (isCoordinateClick(type)) return s.atCursor ? t('palette.step.atCursor') : `${s.x}, ${s.y}`;
  if (type === 'Keystroke' || type === 'HoldKey' || type === 'KeyDown' || type === 'KeyUp') return formatKeyCombo(s.key);
  if (type === 'Pause') {
    const time = s.timeout > 0 ? `${s.timeout} ms` : '';
    return s.key && time ? t('palette.step.keyOrTime', { key: s.key, time }) : s.key || time;
  }
  if (type === 'WaitImage') return `${Math.round((s.confidence || 0.8) * 100)}%`;
  if (type === 'If' || type === 'ElseIf' || type === 'While' || type === 'Assert') {
    return [s.conditionType?.replace(/([a-z])([A-Z])/g, '$1 $2'), s.key, s.conditionOperand, s.windowProcessName, s.windowTitle, s.filePath].filter(Boolean).join(' · ');
  }
  return (s.key ?? '').replace(/\s+/g, ' ').slice(0, 80);
}

export function stepItems(steps: ActionItem[], macro: string, go: (index: number) => void): PaletteItem[] {
  return steps.map((s, i) => ({
    id: `step:${s.id ?? i}`,
    group: 'steps' as const,
    label: stepName(s.actionType),
    detail: [stepText(s), t('palette.detail.stepOf', { macro, n: i + 1 })].filter(Boolean).join(' · '),
    words: s.comment,
    stepIcon: null,
    run: () => go(i),
  }));
}

// ── Commands from the menus that already exist ──

/**
 * A menu's items as commands — the same objects, so Ctrl+K never drifts from the menus ("listas à mão
 * divergem"). A submenu's items keep its name ("Convert › Coordinates to relative"); items a later
 * slice brings, and the folder colours' panel, stay out.
 */
export function fromMenu(source: string, entries: MenuEntry[], make: (item: MenuItem, path: string[]) => Partial<PaletteItem>, path: string[] = []): PaletteItem[] {
  const out: PaletteItem[] = [];
  for (const entry of entries) {
    if (entry === 'separator' || entry.notBuilt || entry.panel) continue;
    if (entry.submenu) {
      out.push(...fromMenu(source, entry.submenu, make, [...path, entry.label]));
      continue;
    }
    const run = entry.onSelect;
    if (!run) continue;
    const extra = make(entry, path);
    out.push({
      // The menu is part of the id: the step's Duplicate and the macro's are two commands.
      id: `${source}:${[...path, entry.label].join('/')}`,
      group: 'commands',
      label: [...path, entry.label].join(' › '),
      icon: entry.icon,
      keys: entry.shortcut,
      disabled: entry.disabled,
      hint: entry.tip,
      run,
      ...extra,
    });
  }
  return out;
}

/**
 * The macro menu's items, said with the macro's name, as the concept writes them ("Export Trade
 * Roblox…"). Each item is known by its icon (shell/macroMenu.ts), not by its label, which is in the
 * interface's language; a folder of Move to folder is one with the folder icon, its name the label.
 */
export function macroPhrase(item: MenuItem, name: string): string {
  switch (item.icon) {
    case Folder: return t('palette.macro.moveTo', { name, target: item.label });
    case FolderMinus: return t('palette.macro.takeOut', { name });
    case Pencil: return t('palette.macro.rename', { name });
    case Copy: return t('palette.macro.duplicate', { name });
    case Pin: return t('palette.macro.pin', { name });
    case PinOff: return t('palette.macro.unpin', { name });
    case Upload: return t('palette.macro.export', { name });
    case ExternalLink: return t('palette.macro.explorer', { name });
    case RotateCcw: return t('palette.macro.revert', { name });
    case X: return t('palette.macro.close', { name });
    case Ban: return t('palette.macro.disable', { name });
    case Power: return t('palette.macro.enable', { name });
    case Trash2: return t('palette.macro.delete', { name });
    default: return t('palette.macro.item', { label: item.label, name });
  }
}

/** A shortcut of the settings ("Ctrl+F10") as the caps show it. */
export const shortcut = (combo: string | null | undefined) => (combo ? keycaps(combo) : undefined);
