import { useEffect, useRef, useState, type MutableRefObject } from 'react';

interface Edit {
  text: string;
  /** The value the field showed when the typing began. */
  from: string;
  owner: string | null;
}
interface Latest {
  value: string;
  owner: string | null;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}

/**
 * A whole number typed into a field (settings-073, rule 3): digits only, sent on Enter, when the
 * field is left and when the panel holding it closes — and only when it changed, inside the bounds
 * (an empty field takes the lower one). Esc drops what was typed. The number shows at once and
 * gives way to the engine's echo.
 *
 * The value belongs to `owner`, the open macro. When another macro opens under the focus, or the
 * value moves under the typing (an undo), what was typed is dropped instead of being written over
 * the value now shown.
 */
export function NumberField({ label, unit, value, min, max, owner = null, tip, onCommit }: {
  label: string;
  unit: string;
  value: string;
  min: number;
  max: number;
  owner?: string | null;
  tip?: string;
  onCommit: (n: number) => void;
}) {
  const [shown, setShown] = useState<{ text: string; from: string; owner: string | null; typing: boolean } | null>(null);
  const edit = useRef<Edit | null>(null);
  const latest = useRef<Latest>({ value, owner, min, max, onCommit });
  useEffect(() => { latest.current = { value, owner, min, max, onCommit }; });
  // Leaving with the panel sends it too: the panel closes on a press elsewhere before any blur.
  useEffect(() => () => { send(edit, latest); }, []);

  if (shown && (shown.from !== value || shown.owner !== owner)) setShown(null);
  useEffect(() => {
    if (!shown || shown.typing) return;
    // Sent, and the echo did not move the value (the engine kept it): show the value again.
    const id = setTimeout(() => setShown(null), 1000);
    return () => clearTimeout(id);
  }, [shown]);

  const commit = () => {
    const sent = send(edit, latest);
    if (sent !== null) setShown({ text: String(sent), from: value, owner, typing: false });
    else if (shown?.typing) setShown(null);
  };

  return (
    <label className="ro-field" data-tip={tip}>
      <span className="ro-field-label">{label}</span>
      <span className="ro-field-box">
        <input
          type="text"
          inputMode="numeric"
          aria-label={label}
          value={shown ? shown.text : value}
          onChange={(e) => {
            // A number past the bound can be typed; it comes back to the bound when sent.
            const text = e.target.value.replace(/\D/g, '').slice(0, 9);
            if (edit.current) edit.current.text = text;
            else edit.current = { text, from: value, owner };
            setShown({ text, from: value, owner, typing: true });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              // Not stopped: the panel closes with the same Esc, and there is nothing left to send.
              edit.current = null;
              setShown(null);
            }
          }}
          onBlur={commit}
        />
        <span className="ro-field-unit">{unit}</span>
      </span>
    </label>
  );
}

/** Sends what was typed, if it is still the owner's and changed anything: the number sent, or null. */
function send(edit: MutableRefObject<Edit | null>, latest: MutableRefObject<Latest>): number | null {
  const typed = edit.current;
  edit.current = null;
  const now = latest.current;
  if (!typed || typed.owner !== now.owner || typed.from !== now.value) return null;
  const parsed = typed.text === '' ? now.min : Number.parseInt(typed.text, 10);
  const n = Math.min(now.max, Math.max(now.min, parsed));
  if (String(n) === typed.from) return null;
  now.onCommit(n);
  return n;
}
