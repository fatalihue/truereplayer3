import type { MouseEvent, ReactNode } from 'react';
import { ArrowUpFromDot, CornerDownLeft, Hourglass, Repeat, Repeat2, Zap, type LucideIcon } from 'lucide-react';
import type { ProfileEntry, TriggerMode } from '../../bridge/messageTypes';
import { keycaps, targetLabel } from './model';

const MODES: Partial<Record<TriggerMode, { Icon: LucideIcon; en: string; pt: string }>> = {
  onRelease: { Icon: ArrowUpFromDot, en: 'On release', pt: 'Ao soltar' },
  whilePressed: { Icon: Zap, en: 'While pressed', pt: 'Enquanto pressionado' },
  toggle: { Icon: Repeat, en: 'Toggle', pt: 'Alternar' },
  doubleTap: { Icon: Repeat2, en: 'Double-tap', pt: 'Toque duplo' },
  hold: { Icon: Hourglass, en: 'Hold (long-press)', pt: 'Segurar (pressão longa)' },
};

type Tt = (en: string, pt: string) => string;

/**
 * One macro in the library: what it looks like, what fires it, and that it is the open one. The
 * chips only show (D4): the hotkey, hotstring and window target are changed in the Inspector.
 * Clicking opens it (never closes it, D1); the menu, the drag and the keys belong to the library.
 *
 * One component per row, with the icon and the name drawn by plain functions: a library of a
 * hundred macros renders a hundred of these at launch, and each extra component per row was a
 * hundred more to mount.
 */
export function MacroRow({ entry, open, locked, dragging, tt, onOpen, onMenu, onPress }: {
  entry: ProfileEntry;
  open: boolean;
  /** A recording or a replay is running: the open macro cannot change. */
  locked: boolean;
  dragging: boolean;
  tt: Tt;
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
        <span className="lib-armed" role="img" aria-label="Automation armed" data-tip={tt('Automation armed', 'Automação armada')} data-tip-pos="end" />
      )}
      {mode && (
        <span className="lib-mode" data-tip={tt(mode.en, mode.pt)} data-tip-pos="end">
          <mode.Icon aria-label={mode.en} />
        </span>
      )}
      {entry.hotkey && chip(keycaps(entry.hotkey), {
        conflict: entry.hotkeyConflict,
        tip: entry.hotkeyConflict
          ? tt('Another macro uses this hotkey for the same window — only one fires',
               'Outro macro usa este hotkey na mesma janela — só um dispara')
          : undefined,
      })}
      {entry.hotstring && chip(entry.hotstring, {
        hotstring: true,
        icon: entry.hotstringInstant ? <Zap aria-hidden="true" /> : <CornerDownLeft aria-hidden="true" />,
        tip: entry.hotstringInstant
          ? tt('Hotstring — fires as you type it', 'Hotstring — dispara ao digitar')
          : tt('Hotstring — fires on Enter, Space or Tab', 'Hotstring — dispara com Enter, Espaço ou Tab'),
      })}
    </button>
  );
}

/**
 * A trigger chip. A long one is cut at its START ("…Shift+F1"): the modifiers repeat across the
 * library, the key at the end is what tells two apart, and the name beside it needs the room. The
 * tooltip says what the chip is and, when it is cut, all of it.
 */
function chip(text: string, { tip, conflict, hotstring, icon }: { tip?: string; conflict?: boolean; hotstring?: boolean; icon?: ReactNode }) {
  return (
    <span className="lib-chip" data-conflict={conflict || undefined} data-hotstring={hotstring ? '' : undefined}>
      {icon}
      {/* bdi keeps the text left-to-right inside the right-to-left box, so a "/id" hotstring or the
          "+" key at the end of "Ctrl++" are not moved to the other side. */}
      <span className="lib-chip-text" data-tip={tip ? `${text} — ${tip}` : text} data-tip-reveal={tip ? undefined : ''} data-tip-pos="end">
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
