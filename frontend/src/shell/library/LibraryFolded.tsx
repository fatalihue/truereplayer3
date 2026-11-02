import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { ChevronsRight } from 'lucide-react';
import type { ProfileEntry, ProfileOrderData } from '../../bridge/messageTypes';
import { useTt } from '../../state/LanguageContext';
import { glyphCount, railInitials } from '../../utils/profileInitials';
import { descriptionTip, folderOf, keycaps, targetLabel } from './model';

/**
 * ③ folded: the library as a column of avatars (below 80 rem of window, or beside the expanded
 * Inspector). The macros keep the library's order — pinned, folders, the rest — and as many as the
 * column holds show; the last place becomes "+N" when they do not all fit, and the open macro is
 * never the one left out. Each avatar says in its tooltip everything the row would. The button on
 * top lays the panel over the steps, and takes it away again.
 */
export function LibraryFolded({ macros, order, active, locked, peek, onExpand, onOpen, onMenu }: {
  macros: ProfileEntry[];
  order: ProfileOrderData;
  active: string | null;
  locked: boolean;
  /** The panel is laid over the steps. */
  peek: boolean;
  onExpand: () => void;
  onOpen: (name: string) => void;
  onMenu: (e: MouseEvent<HTMLElement>, name: string) => void;
}) {
  const tt = useTt();
  const columnRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);

  // How many avatars the column holds: a 2 rem avatar plus the 0.375 rem gap, in the root's rem.
  useLayoutEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setRoom(Math.max(1, Math.floor((el.clientHeight + 0.375 * rem) / (2.375 * rem))));
    };
    // Measure-then-render: how many fit is only known once the column is laid out.
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    return () => watcher.disconnect();
  }, []);

  const fits = macros.length <= room;
  let shown = fits ? macros : macros.slice(0, Math.max(0, room - 1));
  const open = macros.find(m => m.name === active);
  if (open && shown.length > 0 && !shown.includes(open)) shown = [...shown.slice(0, -1), open];
  const hidden = macros.filter(m => !shown.includes(m));
  const armed = hidden.filter(m => m.triggerArmed).length;
  const conflicts = hidden.filter(m => m.hotkeyConflict).length;
  // Pinned, folders, the rest: a line where one group gives way to the next (drawn in the gap the
  // avatars already keep, so as many still fit).
  const groupOf = (entry: ProfileEntry) => (order.pinned.includes(entry.name) ? 0 : folderOf(entry.name, order) ? 1 : 2);

  return (
    <nav className="lib-folded" aria-label="Macros, collapsed">
      {/* A toggle (data-library-toggle): the press is not the "elsewhere" that takes the panel away
          before its own click would lay it again. */}
      <button
        type="button"
        className="lib-icon-button"
        aria-label={peek ? 'Close macro list' : 'Expand macro list'}
        aria-expanded={peek}
        data-library-toggle=""
        data-tip={peek ? tt('Close macro list', 'Fechar a lista de macros') : tt('Expand macro list', 'Abrir a lista de macros')}
        data-tip-pos="right"
        onClick={onExpand}
      >
        <ChevronsRight aria-hidden="true" />
      </button>
      <span className="lib-folded-divider" />
      <div ref={columnRef} className="lib-avatars">
        {room > 0 && shown.map((entry, i) => {
          const folder = folderOf(entry.name, order);
          const newGroup = i > 0 && groupOf(entry) !== groupOf(shown[i - 1]);
          const initials = railInitials(entry.name);
          const inherited = entry.effectiveTargetSource === 'folder' || undefined;
          const tip = [
            entry.name,
            entry.hotkey ? keycaps(entry.hotkey) : null,
            entry.hotstring ? `${entry.hotstringInstant ? '⚡' : '↵'}${entry.hotstring}` : null,
            folder?.name ?? null,
            entry.hasEffectiveTarget ? targetLabel(entry.effectiveTargetProcessName, entry.effectiveTargetWindowTitle) : null,
            entry.isDisabled ? tt('disabled', 'desativado') : null,
            descriptionTip(entry.description) || null,
          ].filter(Boolean).join(' · ');
          return (
            <button
              key={entry.name}
              type="button"
              className="lib-avatar"
              aria-label={entry.name}
              aria-current={entry.name === active ? 'true' : undefined}
              aria-disabled={locked || undefined}
              data-folder={folder ? '' : undefined}
              data-group-start={newGroup || undefined}
              data-conflict={entry.hotkeyConflict || undefined}
              data-disabled={entry.isDisabled || undefined}
              data-long={!entry.iconEmoji && !entry.appIconBase64 && glyphCount(initials) > 2 ? '' : undefined}
              data-tip={tip}
              data-tip-pos="right"
              style={folder ? { '--folder-color': folder.color } as CSSProperties : undefined}
              onClick={() => { if (!locked) onOpen(entry.name); }}
              onContextMenu={(e) => onMenu(e, entry.name)}
            >
              {entry.iconEmoji
                ? <span className="lib-emoji">{entry.iconEmoji}</span>
                : entry.appIconBase64
                  ? <img src={`data:image/png;base64,${entry.appIconBase64}`} alt="" data-inherited={inherited} />
                  : initials}
              {entry.triggerArmed && <span className="lib-armed" />}
            </button>
          );
        })}
        {room > 0 && hidden.length > 0 && (
          <button
            type="button"
            className="lib-more"
            aria-label={`${hidden.length} more macros`}
            data-conflict={conflicts > 0 || undefined}
            data-tip={[
              tt(`${hidden.length} more`, `${hidden.length} a mais`),
              armed > 0 ? tt(`${armed} armed`, `${armed} armada${armed > 1 ? 's' : ''}`) : null,
              conflicts > 0 ? tt(`${conflicts} in conflict`, `${conflicts} em conflito`) : null,
            ].filter(Boolean).join(' · ')}
            data-tip-pos="right"
            onClick={onExpand}
          >
            +{hidden.length}
            {armed > 0 && <span className="lib-armed" />}
          </button>
        )}
      </div>
    </nav>
  );
}
