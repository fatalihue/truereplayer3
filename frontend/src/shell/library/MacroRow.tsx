import type { MouseEvent, ReactNode } from 'react';
import { ArrowUpFromDot, CornerDownLeft, Hourglass, Repeat, Repeat2, Zap, type LucideIcon } from 'lucide-react';
import type { ProfileEntry, TriggerMode } from '../../bridge/messageTypes';
import { t } from '../../i18n';
import { keycaps, targetLabel } from './model';

// The trigger modes that show an icon (On press, the default, has none), named as the Inspector's
// trigger names them.
const MODES: Partial<Record<TriggerMode, { Icon: LucideIcon; label: string }>> = {
  onRelease: { Icon: ArrowUpFromDot, label: t('library.modes.onRelease') },
  whilePressed: { Icon: Zap, label: t('library.modes.whilePressed') },
  toggle: { Icon: Repeat, label: t('library.modes.toggle') },
  doubleTap: { Icon: Repeat2, label: t('library.modes.doubleTap') },
  hold: { Icon: Hourglass, label: t('library.modes.hold') },
};

/**
 * One macro in the library: what it looks like, what fires it, and that it is the open one. The
 * chips only show (D4): the hotkey, hotstring and window target are changed in the Inspector.
 * Clicking opens it, and closes it when it is the open one (D29); the menu, the drag and the keys
 * belong to the library.
 *
 * One component per row, with the icon and the name drawn by plain functions: a library of a
 * hundred macros renders a hundred of these at launch, and each extra component per row was a
 * hundred more to mount.
 */
export function MacroRow({ entry, open, locked, dragging, onOpen, onMenu, onPress }: {
  entry: ProfileEntry;
  open: boolean;
  /** A recording or a replay is running: the open macro cannot change. */
  locked: boolean;
  dragging: boolean;
  onOpen: (name: string) => void;
  onMenu: (e: MouseEvent<HTMLElement>, name: string) => void;
  onPress: (e: MouseEvent<HTMLElement>, name: string) => void;
}) {
  const mode = entry.hotkey ? MODES[entry.triggerMode] : undefined;
  return (
    <button
      type="button"
      className="lib-macro"
      tabIndex={-1}
      data-name={entry.name}
      aria-current={open ? 'true' : undefined}
      aria-disabled={locked || undefined}
      data-disabled={entry.isDisabled || undefined}
      data-dragging={dragging || undefined}
      onMouseDown={(e) => onPress(e, entry.name)}
      onClick={() => { if (!locked) onOpen(entry.name); }}
      onContextMenu={(e) => onMenu(e, entry.name)}
    >
      {iconOf(entry)}
      {nameOf(entry.name, entry.description ?? '')}
      {entry.triggerArmed && (
        <span className="lib-armed" role="img" aria-label={t('library.row.armed')} data-tip={t('library.row.armed')} data-tip-pos="end" />
      )}
      {mode && (
        <span className="lib-mode" data-tip={mode.label} data-tip-pos="end">
          <mode.Icon aria-label={mode.label} />
        </span>
      )}
      {entry.hotkey && chip(keycaps(entry.hotkey), {
        conflict: entry.hotkeyConflict,
        tip: entry.hotkeyConflict ? t('library.row.conflict', { chip: keycaps(entry.hotkey) }) : undefined,
      })}
      {entry.hotstring && chip(entry.hotstring, {
        hotstring: true,
        icon: entry.hotstringInstant ? <Zap aria-hidden="true" /> : <CornerDownLeft aria-hidden="true" />,
        tip: entry.hotstringInstant
          ? t('library.row.hotstringInstant', { chip: entry.hotstring })
          : t('library.row.hotstringEnd', { chip: entry.hotstring }),
      })}
    </button>
  );
}

/**
 * A trigger chip. A long one is cut at its START ("…Shift+F1"): the modifiers repeat across the
 * library, the key at the end is what tells two apart, and the name beside it needs the room. The
 * tooltip says what the chip is and, when it is cut, all of it: `tip` is the whole of it, the chip's
 * text included; without one, the tooltip is the text, shown only when it is cut.
 */
function chip(text: string, { tip, conflict, hotstring, icon }: { tip?: string; conflict?: boolean; hotstring?: boolean; icon?: ReactNode }) {
  return (
    <span className="lib-chip" data-conflict={conflict || undefined} data-hotstring={hotstring ? '' : undefined}>
      {icon}
      {/* bdi keeps the text left-to-right inside the right-to-left box, so a "/id" hotstring or the
          "+" key at the end of "Ctrl++" are not moved to the other side. */}
      <span className="lib-chip-text" data-tip={tip ?? text} data-tip-reveal={tip ? undefined : ''} data-tip-pos="end">
        <bdi>{text}</bdi>
      </span>
    </span>
  );
}

/**
 * The macro's face, best source first: the icon the user chose, the app its window target opens
 * (faded when it comes from the folder), a window when that app's icon could not be read, and a
 * plain document. The two drawn glyphs are a CSS mask (library.css), not an SVG per row.
 */
function iconOf(entry: ProfileEntry) {
  const inherited = entry.effectiveTargetSource === 'folder' || undefined;
  const tip = entry.hasEffectiveTarget
    ? targetLabel(entry.effectiveTargetProcessName, entry.effectiveTargetWindowTitle)
      + (inherited ? ` · ${entry.effectiveTargetFolderName ?? ''}` : '')
    : undefined;
  let face;
  if (entry.iconEmoji) face = <span className="lib-emoji">{entry.iconEmoji}</span>;
  else if (entry.appIconBase64) face = <img src={`data:image/png;base64,${entry.appIconBase64}`} alt="" data-inherited={inherited} />;
  else if (entry.hasEffectiveTarget) face = <span className="lib-glyph" data-glyph="window" data-inherited={inherited} />;
  else face = <span className="lib-glyph" data-glyph="doc" />;
  return <span className="lib-macro-icon" aria-hidden="true" data-tip={tip} data-tip-pos="end">{face}</span>;
}

/**
 * The name, cut in the middle when it does not fit: the head shrinks and the last six characters
 * stay. The tooltip (the full name when it is cut, and the description) is put on by the library
 * when the pointer arrives, since whether a name is cut is a fact of the layout, not of the string.
 */
function nameOf(name: string, description: string) {
  const glyphs = Array.from(name);
  if (glyphs.length <= 14) {
    return (
      <span className="lib-name" data-name-cell="" data-full={name} data-desc={description || undefined}>
        <span className="lib-name-head">{name}</span>
      </span>
    );
  }
  return (
    <span className="lib-name" data-name-cell="" data-full={name} data-desc={description || undefined} aria-label={name}>
      <span className="lib-name-head">{glyphs.slice(0, -6).join('')}</span>
      <span className="lib-name-tail">{glyphs.slice(-6).join('')}</span>
    </span>
  );
}
