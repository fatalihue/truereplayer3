import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder, Plus } from 'lucide-react';
import type { ProfileFolder } from '../../bridge/messageTypes';
import { targetLabel } from './model';

/**
 * A folder: a card with its header and, open, its macros and its own "+ New macro" (D5). The whole
 * header opens and closes it; right-click (or Shift+F10) is the folder menu (D3); pressing and
 * dragging it reorders the folders.
 */
export function FolderCard({ folder, count, allOff, dropping, dragging, onToggle, onMenu, onPress, onNewMacro, children }: {
  folder: ProfileFolder;
  count: number;
  /** Every macro in it is disabled: the folder reads as disabled too. */
  allOff: boolean;
  /** A macro is being dragged over it. */
  dropping: boolean;
  dragging: boolean;
  onToggle: (name: string) => void;
  onMenu: (e: MouseEvent<HTMLElement>, name: string) => void;
  onPress: (e: MouseEvent<HTMLElement>, name: string) => void;
  onNewMacro: (folder: string) => void;
  children: ReactNode;
}) {
  const Chevron = folder.collapsed ? ChevronRight : ChevronDown;
  return (
    <section
      className="lib-folder"
      aria-label={folder.name}
      data-drag-item={`folder:${folder.name}`}
      data-collapsed={folder.collapsed || undefined}
      data-drop={dropping || undefined}
      data-dragging={dragging || undefined}
      data-off={allOff || undefined}
      style={{ '--folder-color': folder.color } as CSSProperties}
    >
      <button
        type="button"
        className="lib-folder-header"
        tabIndex={-1}
        data-folder={folder.name}
        aria-expanded={!folder.collapsed}
        onMouseDown={(e) => onPress(e, folder.name)}
        onClick={() => onToggle(folder.name)}
        onContextMenu={(e) => onMenu(e, folder.name)}
      >
        <Chevron aria-hidden="true" />
        <Folder className="lib-folder-icon" aria-hidden="true" />
        <span className="lib-folder-name">{folder.name}</span>
        {folder.appIconBase64 && (
          <img
            className="lib-folder-target"
            src={`data:image/png;base64,${folder.appIconBase64}`}
            alt=""
            data-tip={targetLabel(folder.windowTargetProcessName, folder.windowTargetWindowTitle)}
            data-tip-pos="end"
          />
        )}
        <span className="lib-folder-count" aria-label={count === 1 ? '1 macro' : `${count} macros`}>{count}</span>
      </button>
      {!folder.collapsed && (
        <div className="lib-folder-body">
          {children}
          <button
            type="button"
            className="lib-new-in-folder"
            tabIndex={-1}
            data-always={count === 0 || undefined}
            aria-label={`New macro in ${folder.name}`}
            onClick={() => onNewMacro(folder.name)}
          >
            <Plus aria-hidden="true" />
            New macro
          </button>
        </div>
      )}
    </section>
  );
}
