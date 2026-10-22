import type { CSSProperties, ReactNode } from 'react';
import { ChevronDown, ChevronRight, Pin } from 'lucide-react';
import type { ProfileEntry, ProfileFolder } from '../bridge/messageTypes';
import { useMacro } from '../logic/useMacro';
import { firstGrapheme, railInitials } from '../utils/profileInitials';
import { useApp } from './store';

/**
 * ③ The macro library: the pinned macros, the folders and the rest, in the order the engine keeps.
 * A click opens the macro and never closes the open one (D1). The menus, folders, drag, rename and
 * delete are slice 2 of phase 1.
 */
export function Library() {
  const profiles = useApp(a => a.profiles);
  const order = useApp(a => a.profileOrder);
  const active = useApp(a => a.activeProfile);
  const macro = useMacro();

  // Each macro once, where the order puts it first; any the order misses goes at the end, so the
  // library never hides a macro that exists.
  const byName = new Map(profiles.map(p => [p.name, p]));
  const placed = new Set<string>();
  const take = (names: string[]) => names.flatMap(name => {
    const entry = byName.get(name);
    if (!entry || placed.has(name)) return [];
    placed.add(name);
    return [entry];
  });
  const pinned = take(order.pinned);
  const folders = order.folders.map(folder => ({ folder, items: take(folder.items) }));
  const loose = take(order.ungroupedOrder);
  const rest = profiles.filter(p => !placed.has(p.name)).sort((a, b) => a.name.localeCompare(b.name));

  const row = (entry: ProfileEntry) => (
    <MacroRow key={entry.name} entry={entry} open={entry.name === active} onOpen={macro.open} />
  );

  return (
    <aside className="shell-library" aria-label="Macros">
      <div className="shell-library-scroll">
        {pinned.length > 0 && (
          <section aria-label="Pinned">
            <h2 className="shell-library-heading"><Pin aria-hidden="true" /> Pinned</h2>
            {pinned.map(row)}
          </section>
        )}
        {folders.map(({ folder, items }) => (
          <FolderGroup key={folder.name} folder={folder} count={items.length} onToggle={macro.toggleFolderCollapsed}>
            {items.map(row)}
          </FolderGroup>
        ))}
        {loose.map(row)}
        {rest.map(row)}
      </div>
    </aside>
  );
}

function FolderGroup({ folder, count, onToggle, children }: {
  folder: ProfileFolder;
  count: number;
  onToggle: (name: string) => void;
  children: ReactNode;
}) {
  const Chevron = folder.collapsed ? ChevronRight : ChevronDown;
  return (
    <section className="shell-folder" aria-label={folder.name}>
      <button
        type="button"
        className="shell-folder-header"
        aria-expanded={!folder.collapsed}
        onClick={() => onToggle(folder.name)}
        style={{ '--folder-color': folder.color } as CSSProperties}
      >
        <Chevron aria-hidden="true" />
        <span className="shell-folder-dot" />
        <span className="shell-folder-name">{folder.name}</span>
        <span className="shell-folder-count">{count}</span>
      </button>
      {!folder.collapsed && children}
    </section>
  );
}

function MacroRow({ entry, open, onOpen }: { entry: ProfileEntry; open: boolean; onOpen: (name: string) => void }) {
  return (
    <button
      type="button"
      className="shell-macro"
      aria-current={open ? 'true' : undefined}
      data-disabled={entry.isDisabled || undefined}
      data-tip={entry.name}
      data-tip-pos="right"
      onClick={() => onOpen(entry.name)}
    >
      {/* The open library shows the first letter; folded into icons it needs the initials ("M067"),
          which tell apart names that start alike. */}
      <span className="shell-macro-icon" aria-hidden="true">{entry.iconEmoji || firstGrapheme(entry.name)}</span>
      <span className="shell-macro-initials" aria-hidden="true">{entry.iconEmoji || railInitials(entry.name)}</span>
      <span className="shell-macro-name">{entry.name}</span>
      {entry.hotkey && <span className="shell-macro-key">{entry.hotkey}</span>}
    </button>
  );
}
