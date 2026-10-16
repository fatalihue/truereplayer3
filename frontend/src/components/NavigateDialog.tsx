import { useState, useRef, useEffect, useId } from 'react';
import { Globe } from 'lucide-react';
import { Checkbox } from './Checkbox';
import { DialogShell, DialogFooter  } from './common/DialogShell';

interface NavigateDialogProps {
  onConfirm: (url: string, newTab: boolean) => void;
  onClose: () => void;
}

export function NavigateDialog({ onConfirm, onClose }: NavigateDialogProps) {
  const [url, setUrl] = useState('');
  const [newTab, setNewTab] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();

  // Focus the URL input on mount so the user can type immediately. Runs after
  // DialogShell's own card-focus effect (child effects fire before the parent's),
  // so the input keeps the final focus.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleConfirm = () => {
    const trimmed = url.trim();
    if (trimmed) onConfirm(trimmed, newTab);
  };

  return (
    <DialogShell
      icon={<Globe size={14} style={{ color: 'var(--color-action-browser-fg)' }} />}
      title="Open URL"
      onClose={onClose}
      // Text-entry dialog: a stray click on the scrim must not discard a
      // typed URL — dismissal is Esc or Cancel only.
      closeOnBackdrop={false}
      footerHint="Enter confirms · Esc cancels"
      footer={<DialogFooter secondary={{ label: 'Cancel', onClick: onClose }} primary={{ label: 'Add URL', onClick: handleConfirm, disabled: !url.trim() }} />}
      onCardKeyDown={(e) => {
        // Enter confirms from anywhere in the card (the URL input is the only
        // text field). Esc is owned by DialogShell.
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          handleConfirm();
        }
      }}
    >
      <div className="px-4 py-4 space-y-3">
        <input
          ref={inputRef}
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          // Named and described: the placeholder was its only label, and the https:// rule
          // below it was not tied to it.
          aria-label="URL"
          aria-describedby={hintId}
          // The field primitive (32 px, border-default — the hand-rolled border-subtle one
          // faded out on light presets). font-sans keeps today's face: whether input-field's
          // mono default fits a URL is the open D3 question, not this fix's to settle.
          className="input-field font-sans"
        />

        <Checkbox
          checked={newTab}
          onChange={setNewTab}
          label="Open in new tab"
        />

        <p id={hintId} className="text-caption text-text-tertiary">
          https:// is added if omitted.
        </p>
      </div>
    </DialogShell>
  );
}
