import type { ProfileEntry, ProfileFolder, ProfileOrderData } from '../../bridge/messageTypes';
import { splitCombo } from '../../components/common/KbdTag';
import { compactKey } from '../../utils/keyNames';
import { cutGlyphs } from '../../utils/profileInitials';

/**
 * The library as the screen shows it, worked out from the engine's list and its order file. Pure,
 * so the rules (which macro goes where, what the search finds, which macro opens when the open one
 * goes) live in one place and can be checked without a screen.
 */

export interface FolderSection {
  folder: ProfileFolder;
  /** The macros in the folder, by name. */
  macros: ProfileEntry[];
}

export interface Sections {
  pinned: ProfileEntry[];
  folders: FolderSection[];
  loose: ProfileEntry[];
}

// One collator for every comparison: localeCompare with options builds a new one per call, which
// cost ~6 ms of the launch sorting the 139 macros of the measuring library.
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
const byName = (a: ProfileEntry, b: ProfileEntry) => collator.compare(a.name, b.name);

/**
 * Pinned, the folders in the order the user dragged them, and the rest — each section by name, as
 * the library has always sorted. A pinned macro in a folder shows in both. A macro the order file
 * does not list yet (a file dropped into the folder, the first moments after launch) is loose, so
 * the library never hides a macro that exists.
 */
export function sectionsOf(profiles: ProfileEntry[], order: ProfileOrderData): Sections {
  const byNameMap = new Map(profiles.map(p => [p.name, p]));
  const pick = (names: string[]) => names.flatMap(name => {
    const entry = byNameMap.get(name);
    return entry ? [entry] : [];
  });
  const pinned = pick(order.pinned).sort(byName);
  const folders = order.folders.map(folder => ({ folder, macros: pick(folder.items).sort(byName) }));
  const placed = new Set<string>([...order.pinned, ...order.folders.flatMap(f => f.items)]);
  const loose = profiles.filter(p => !placed.has(p.name)).sort(byName);
  return { pinned, folders, loose };
}

/** "#fps" searches the tags; anything else, the names. Both without case, by part of the word. */
export function searchOf(query: string): ((entry: ProfileEntry) => boolean) | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  if (q.startsWith('#')) {
    const tag = q.slice(1);
    // "#" alone shows everything: the user has typed the sign and not the tag yet.
    if (!tag) return () => true;
    return entry => !!entry.tags?.some(t => t.toLowerCase().includes(tag));
  }
  return entry => entry.name.toLowerCase().includes(q);
}

export const isTagSearch = (query: string) => query.trim().startsWith('#');

/** Every macro once, in the order the library shows them: pinned, folders, the rest. */
export function displayOrder(sections: Sections): ProfileEntry[] {
  const seen = new Set<string>();
  const out: ProfileEntry[] = [];
  for (const entry of [...sections.pinned, ...sections.folders.flatMap(f => f.macros), ...sections.loose]) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push(entry);
  }
  return out;
}

/** The folder a macro is in, or null. */
export function folderOf(name: string, order: ProfileOrderData): ProfileFolder | null {
  return order.folders.find(f => f.items.includes(name)) ?? null;
}

/**
 * A name nobody has yet: "Untitled macro", then "Untitled macro 2", "… 3". Names are files, and
 * Windows does not tell case apart, so neither does this.
 */
export function freeName(base: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, n => n.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** A name another macro (or folder) already has, ignoring case and the one being renamed. */
export function nameTaken(name: string, names: Iterable<string>, except?: string): boolean {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return false;
  for (const other of names) {
    if (other === except) continue;
    if (other.toLowerCase() === wanted) return true;
  }
  return false;
}

/**
 * The macro to open when the open one is gone (deleted from here, with its folder, or from disk):
 * the next one in the order the library showed, or the one before it at the end. There is no "no
 * macro open" any more (D1), so while any macro is left, one is open.
 */
export function neighbourOf(gone: string, before: string[], now: Set<string>): string | null {
  const at = before.indexOf(gone);
  if (at < 0) return before.find(n => now.has(n)) ?? null;
  for (let i = at + 1; i < before.length; i++) if (now.has(before[i])) return before[i];
  for (let i = at - 1; i >= 0; i--) if (now.has(before[i])) return before[i];
  return null;
}

/** What the window target is, for a tooltip: the .exe, else the title, else a word. */
export function targetLabel(processName?: string | null, windowTitle?: string | null): string {
  if (processName) return /\.exe$/i.test(processName) ? processName : `${processName}.exe`;
  if (windowTitle) return windowTitle;
  return 'Window target';
}

/** A hotkey as its keycaps read: "Ctrl+PgDn". */
export const keycaps = (combo: string) => splitCombo(combo).map(compactKey).join('+');

/**
 * What the zones waiting for the macros say while the Clicker is on: the way back is its hotkey,
 * or Macros in the rail when it has none (the default of a new install; casca-101).
 */
export const clickerOnNote = (modeKey: string) => (modeKey
  ? `The Clicker is on — ${keycaps(modeKey)} brings the macros back`
  : 'The Clicker is on — Macros, in the rail, brings them back');

/** The description on one tooltip line: whitespace folded, cut by what people see. */
export function descriptionTip(description?: string | null): string {
  const line = (description ?? '').replace(/\s+/g, ' ').trim();
  // No more UTF-16 units than the limit means no more characters either: nothing to cut.
  return line.length <= 110 ? line : cutGlyphs(line, 110);
}

/**
 * The macros a selection brings along because it runs them (Run Macro), followed down the chain.
 * They always go: an export without them arrives broken and fails without a word. Same lookup as
 * the engine's export — exact name, a reference to nothing brings nothing — and the ones already
 * chosen are not repeated.
 */
export function runsBroughtAlong(profiles: ProfileEntry[], chosen: Set<string>): string[] {
  const exact = new Map(profiles.map(p => [p.name, p]));
  const seen = new Set(Array.from(chosen, n => n.toLowerCase()));
  const queue = [...chosen];
  const extra: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const raw of exact.get(current)?.runProfileTargets ?? []) {
      const local = exact.get((raw ?? '').trim());
      if (!local) continue;
      const key = local.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      extra.push(local.name);
      queue.push(local.name);
    }
  }
  return extra;
}

/** Dark ink on a light swatch, white on a dark one. */
export function lightSwatch(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) > 150;
}
