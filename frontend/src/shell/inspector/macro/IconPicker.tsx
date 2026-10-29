import { useEffect, useState } from 'react';
import { Smile } from 'lucide-react';
import { useTt } from '../../../state/LanguageContext';
import { preload, useLoaded } from '../../lazyModule';
import { anchorBelow, type MenuAnchor } from '../../menuAnchor';
import { Popover } from '../../Popover';
// The emoji picker is not part of opening anything but itself (rule 6): it comes when the button is
// first pointed at or pressed, and the panel opens once it is in (it is placed once, by its size).
import { appIsLight, loadEmojiPicker } from '../inspectorState';

/**
 * Info › icon: the macro's emoji, which the folded library and the import and export lists show. A
 * press opens the picker, with its search and categories; choosing one applies it at once, and
 * Clear takes it away (biblioteca-142 to 145).
 */
export function IconPicker({ value, onPick, disabled }: { value: string | null; onPick: (emoji: string | null) => void; disabled?: boolean }) {
  const tt = useTt();
  const picker = useLoaded(loadEmojiPicker);
  const [open, setOpen] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement; keyboard: boolean } | null>(null);

  // The picker keeps Esc for its own search box, so Esc never reaches the panel: caught first here,
  // while it is open, it closes the picker and gives the keyboard back to the button.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(null);
      open.button.focus();
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, [open]);

  const Picker = picker?.default;
  return (
    <div className="insp-line">
      <button
        type="button"
        className="mset-icon"
        aria-label="Choose icon"
        aria-haspopup="dialog"
        aria-expanded={!!open}
        data-tip={tt('Choose an icon for the macro', 'Escolher um ícone para o macro')}
        disabled={disabled}
        onPointerEnter={() => { void preload(loadEmojiPicker); }}
        onClick={(e) => {
          if (open) { setOpen(null); return; }
          const button = e.currentTarget;
          const keyboard = e.detail === 0;
          void preload(loadEmojiPicker).then(() => setOpen({ anchor: anchorBelow(button, 'start'), button, keyboard }));
        }}
      >
        {value ? <span className="mset-icon-emoji">{value}</span> : <Smile aria-hidden="true" />}
      </button>
      {value && (
        <button type="button" className="insp-link" aria-label="Clear icon" disabled={disabled} onClick={() => onPick(null)}>
          Clear
        </button>
      )}
      {open && Picker && picker && (
        <Popover anchor={open.anchor} label="Choose icon" toggle={open.button} focusFirst={open.keyboard} onClose={() => setOpen(null)}>
          <Picker
            onEmojiClick={(data) => {
              onPick(data.emoji);
              setOpen(null);
              open.button.focus();
            }}
            theme={appIsLight() ? picker.Theme.LIGHT : picker.Theme.DARK}
            emojiStyle={picker.EmojiStyle.NATIVE}
            width={304}
            height={320}
            previewConfig={{ showPreview: false }}
            searchPlaceholder="Search emoji…"
          />
        </Popover>
      )}
    </div>
  );
}
