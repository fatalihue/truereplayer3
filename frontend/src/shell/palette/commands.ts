import type { ActionItem, ProfileEntry, ProfileOrderData } from '../../bridge/messageTypes';
import { formatKeyCombo, isCoordinateClick } from '../../utils/displayUtils';
import type { MenuEntry, MenuItem } from '../Menu';
import { keycaps } from '../library/model';
import { stepName } from '../list/stepTypes';

/** One line of Ctrl+K: a macro to open, a step to go to, or a command to run. */
export interface PaletteItem {
  id: string;
  group: 'Macros' | 'Steps' | 'Commands';
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
  for (const t of tokens) {
    if (label.some(w => w.startsWith(t))) score += 3;
    else if (rest.some(w => w.startsWith(t))) score += 2;
    else if (t.length >= 3 && [...label, ...rest].some(w => w.includes(t))) score += 1;
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
    group: 'Macros' as const,
    label: p.name,
    detail: order.pinned.includes(p.name) ? 'Pinned' : folderOf.get(p.name),
    keys: p.hotkey ? keycaps(p.hotkey) : undefined,
    words: [p.hotstring, p.isDisabled ? 'disabled' : '', p.name === active ? 'open' : ''].filter(Boolean).join(' '),
    run: () => open(p.name),
  }));
}

// ── Steps of the open macro ──

/** What a step is about, as plain text: the point, the key, the text, the check. */
function stepText(s: ActionItem): string {
  const t = s.actionType;
  if (isCoordinateClick(t)) return s.atCursor ? 'at the cursor' : `${s.x}, ${s.y}`;
  if (t === 'Keystroke' || t === 'HoldKey' || t === 'KeyDown' || t === 'KeyUp') return formatKeyCombo(s.key);
  if (t === 'Pause') return [s.key, s.timeout > 0 ? `${s.timeout} ms` : ''].filter(Boolean).join(' or ');
  if (t === 'WaitImage') return `${Math.round((s.confidence || 0.8) * 100)}%`;
  if (t === 'If' || t === 'ElseIf' || t === 'While' || t === 'Assert') {
    return [s.conditionType?.replace(/([a-z])([A-Z])/g, '$1 $2'), s.key, s.conditionOperand, s.windowProcessName, s.windowTitle, s.filePath].filter(Boolean).join(' · ');
  }
  return (s.key ?? '').replace(/\s+/g, ' ').slice(0, 80);
}

export function stepItems(steps: ActionItem[], macro: string, go: (index: number) => void): PaletteItem[] {
  return steps.map((s, i) => ({
    id: `step:${s.id ?? i}`,
    group: 'Steps' as const,
    label: stepName(s.actionType),
    detail: [stepText(s), `${macro} · step ${i + 1}`].filter(Boolean).join(' · '),
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
      group: 'Commands',
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

/** The macro menu's items, said with the macro's name, as the concept writes them ("Export Trade Roblox…"). */
export function macroPhrase(label: string, path: string[], name: string): string {
  if (path[0] === 'Move to folder') return label === 'Remove from folder' ? `Take ${name} out of its folder` : `Move ${name} to ${label}`;
  switch (label) {
    case 'Rename…': return `Rename ${name}…`;
    case 'Duplicate': return `Duplicate ${name}`;
    case 'Pin': return `Pin ${name}`;
    case 'Unpin': return `Unpin ${name}`;
    case 'Export…': return `Export ${name}…`;
    case 'Open in Explorer': return `Open ${name} in Explorer`;
    case 'Revert to when I opened it': return `Revert ${name} to when you opened it`;
    case 'Close macro': return `Close ${name}`;
    case 'Disable': return `Disable ${name}`;
    case 'Enable': return `Enable ${name}`;
    case 'Delete macro…': return `Delete ${name}…`;
    default: return `${label} · ${name}`;
  }
}

/** A shortcut of the settings ("Ctrl+F10") as the caps show it. */
export const shortcut = (combo: string | null | undefined) => (combo ? keycaps(combo) : undefined);
