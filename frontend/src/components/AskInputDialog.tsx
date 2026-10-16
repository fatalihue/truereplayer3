import { useState, useRef, useEffect } from 'react';
import { Keyboard } from 'lucide-react';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { useBridge } from '../bridge/BridgeContext';


/**
 * Runtime "Ask-Input" modal for the {input:Label} token. When the replay resolver hits an
 * {input:…} token it PAUSES the run and asks the host to prompt the user; the answer is sent
 * back and substituted. `options` non-null renders a click-to-pick list ({input:Label|menu:a,b,c},
 * a formmenu); null renders a text field. Cancelling (button / Esc) ABORTS the run — the backend
 * treats a cancel like a Stop — so backdrop-dismiss is disabled to avoid an accidental abort.
 */
interface AskInputDialogProps {
  label: string;
  options: string[] | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

function AskInputDialog({ label, options, onSubmit, onCancel }: AskInputDialogProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const isMenu = options != null && options.length > 0;

  useEffect(() => {
    if (!isMenu) inputRef.current?.focus();
  }, [isMenu]);

  return (
    <DialogShell
      icon={<Keyboard size={14} className="text-accent-solid" />}
      title="Input needed"
      size="sm"
      // Above every editor layer (the Sheet is z-60/70, the panels opened over it z-80, their
      // prompts z-90): a run's prompt arrives from outside any stack, and at the default z-50 it
      // sat dimmed under an open Sheet, whose scrim took the clicks meant for the menu options.
      zClass="z-(--z-prompt)"
      onClose={onCancel}
      closeOnBackdrop={false}
      footerHint={isMenu
        ? 'Esc cancels the run'
        : 'Enter submits · Esc cancels the run'}
      footer={isMenu ? undefined : <DialogFooter secondary={{ label: 'Cancel', onClick: onCancel }} primary={{ label: 'Submit', onClick: () => onSubmit(value) }} />}
      onCardKeyDown={(e) => {
        if (!isMenu && e.key === 'Enter') { e.preventDefault(); onSubmit(value); }
      }}
    >
      <div className="px-4 py-4 flex flex-col gap-3">
        <p className="text-body text-text-primary break-words">{label}</p>
        {isMenu ? (
          <div className="flex flex-col gap-1.5 max-h-[300px] overflow-y-auto">
            {options!.map((opt, i) => (
              <button
                key={i}
                onClick={() => onSubmit(opt)}
                className="text-left px-3 h-8 rounded border border-border-subtle bg-bg-card hover:bg-bg-surface text-ui text-text-secondary hover:text-text-primary transition-colors truncate"
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            // The prompt above is a plain <p>; without this the run-blocking field was announced
            // as a bare "edit text" with nothing saying what it asks for.
            aria-label={label}
            className="input-field font-sans"
          />
        )}
      </div>
    </DialogShell>
  );
}

/**
 * Global host mounted once (App overlays): subscribes to the Ask-Input bridge messages and renders
 * the modal for the current pending request. inputDismiss (Stop mid-prompt — backend already
 * resolved the await) just clears the UI without sending a result.
 */
export function AskInputHost() {
  const { send, subscribe } = useBridge();
  const [req, setReq] = useState<{ requestId: string; label: string; options: string[] | null } | null>(null);

  useEffect(() => subscribe((m) => {
    if (m.type === 'replay:inputRequest') {
      setReq(m.payload);
    } else if (m.type === 'replay:inputDismiss') {
      setReq((cur) => (cur && cur.requestId === m.payload.requestId ? null : cur));
    }
  }), [subscribe]);

  if (!req) return null;

  const finish = (value: string, cancelled: boolean) => {
    send({ type: 'replay:inputResult', payload: { requestId: req.requestId, value, cancelled } });
    setReq(null);
  };

  return (
    <AskInputDialog
      key={req.requestId}
      label={req.label}
      options={req.options}
      onSubmit={(v) => finish(v, false)}
      onCancel={() => finish('', true)}
    />
  );
}
