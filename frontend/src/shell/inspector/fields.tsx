import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { splitCombo } from '../../components/common/KbdTag';
import { isPureModifier, useKeyCapture } from '../../logic/useKeyCapture';
import { useSteps } from '../../logic/useSteps';
import { useLanguage } from '../../state/LanguageContext';
import { formatMs } from '../../utils/displayUtils';
import { compactKey } from '../../utils/keyNames';
import { applyEdits, pendingEdits } from './inspectorState';

/** A labelled part of an editor: the label over its controls, and a line under them. */
export function Section({ label, aside, hint, children }: { label: string; aside?: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="insp-section">
      <span className="insp-label">{label}{aside && <span className="insp-label-aside"> {aside}</span>}</span>
      {children}
      {hint && <span className="insp-hint">{hint}</span>}
    </div>
  );
}

/** One choice among a few, applied on the press (Button, Clicks, Position, Action, Set | Add). */
export function Segmented<T extends string>({ label, value, options, onChange, disabled }: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean; tip?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="insp-seg" role="group" aria-label={label}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled || o.disabled}
          data-tip={o.tip}
          onClick={() => { if (o.value !== value) onChange(o.value); }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** An on/off that applies on the press (Vary the gap, Vary the point, Focus click). */
export function Switch({ label, checked, onChange, disabled, tip }: { label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; tip?: string }) {
  return (
    <button type="button" role="switch" className="insp-switch" aria-label={label} aria-checked={checked} disabled={disabled} data-tip={tip} onClick={() => onChange(!checked)} />
  );
}

/** Quick durations under a field (DurationChips): the current one lit; ∞ is "no timeout" (0). */
export function Chips({ values, current, onPick, disabled, forever }: { values: number[]; current: number; onPick: (ms: number) => void; disabled?: boolean; forever?: boolean }) {
  const { language } = useLanguage();
  return (
    <div className="insp-chips">
      {values.map(v => (
        <button key={v} type="button" aria-pressed={v === current} disabled={disabled} onClick={() => onPick(v)}>{formatMs(v, language)} ms</button>
      ))}
      {forever && (
        <button type="button" aria-pressed={current === 0} disabled={disabled} data-tip="Wait for the resume key, with no time limit" onClick={() => onPick(0)}>∞ No timeout</button>
      )}
    </div>
  );
}

// ── The field that applies as you type ──

/** Typing sends this long after the last key, as well as on Enter and when the field is left (rule 3). */
const IDLE_MS = 600;

export interface DraftFieldProps {
  /** What the step holds now, as text ('' for nothing). */
  stored: string;
  /** The step the typing belongs to, by id, and its field (the engine's actions:edit name). */
  stepId: string;
  field: string;
  /** The accessible name. */
  label: string;
  kind: 'int' | 'text' | 'mono';
  min?: number;
  max?: number;
  /** A minus sign is allowed (coordinates). */
  signed?: boolean;
  /** An emptied field keeps the stored value ('keep', the default), sends the lower bound ('min') or clears it ('clear'). */
  empty?: 'keep' | 'min' | 'clear';
  prefix?: string;
  unit?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Sends the value; one edit of `field` when absent. */
  onApply?: (value: string) => void;
}

interface Latest {
  props: DraftFieldProps;
  cmds: ReturnType<typeof useSteps>;
  /** What the field stands on: the stored value, or the one just sent until its echo comes. */
  base: string;
}
interface Typed { text: string; base: string }

/**
 * A field of the Inspector (D12, rule 3): what is typed shows at once and goes to the engine when the
 * typing stops, on Enter, when the field is left and when the step's editor goes — only when it
 * changed, inside its bounds. While typing is unsent the field holds the automations back
 * (pendingEdits). The value just sent stays shown until the engine's echo replaces it; a value that
 * moves under the typing (an undo) drops what was typed instead of writing over it.
 */
export function DraftField(props: DraftFieldProps) {
  const { stored, stepId, field, kind, disabled } = props;
  const cmds = useSteps();
  const [typing, setTyping] = useState<Typed | null>(null);
  const [sent, setSent] = useState<{ value: string; over: string } | null>(null);
  // The echo came, or something else moved the value: the step's value shows again.
  if (sent && stored !== sent.over) setSent(null);
  const base = sent && stored === sent.over ? sent.value : stored;
  if (typing && typing.base !== base) setTyping(null);

  const edit = useRef<Typed | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Latest>({ props, cmds, base });
  useEffect(() => { latest.current = { props, cmds, base }; });
  // No echo within a second (the engine kept the value): the step's value shows again.
  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => setSent(null), 1000);
    return () => clearTimeout(id);
  }, [sent]);
  // The editor going (another step selected, the selection cleared) sends what was typed.
  useEffect(() => () => { flush(timer, edit, latest); }, []);

  const commit = () => {
    const value = flush(timer, edit, latest);
    if (value !== null) setSent({ value, over: stored });
    setTyping(null);
  };
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; });

  return (
    <label className="insp-box" data-disabled={disabled || undefined}>
      {props.prefix && <span className="insp-box-prefix">{props.prefix}</span>}
      <input
        type="text"
        inputMode={kind === 'int' ? 'numeric' : undefined}
        aria-label={props.label}
        className={kind === 'text' ? undefined : 'insp-mono'}
        value={typing ? typing.text : base}
        placeholder={props.placeholder}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          const text = clean(e.target.value, props);
          const from = edit.current?.base ?? base;
          edit.current = { text, base: from };
          setTyping({ text, base: from });
          pendingEdits.add(`${stepId}:${field}`);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => commitRef.current(), IDLE_MS);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            // Sent as it stands; the Inspector then gives the focus back to the list (D12).
            commit();
          }
        }}
        onBlur={commit}
      />
      {props.unit && <span className="insp-box-unit">{props.unit}</span>}
    </label>
  );
}

/** What a typed key does to the text: digits only in a number (and one leading minus where allowed). */
function clean(text: string, p: DraftFieldProps): string {
  if (p.kind !== 'int') return text;
  const minus = p.signed && text.trim().startsWith('-') ? '-' : '';
  return minus + text.replace(/\D/g, '').slice(0, 9);
}

/** The value to send for what was typed, or null for nothing to send. */
function parseValue(text: string, p: DraftFieldProps): string | null {
  if (p.kind === 'text') return text;
  if (p.kind === 'mono') {
    const t = text.trim();
    return t === '' ? null : t;
  }
  if (text === '') return p.empty === 'min' ? String(p.min ?? 0) : p.empty === 'clear' ? '' : null;
  if (text === '-') return null;
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n)) return null;
  return String(Math.min(p.max ?? Number.MAX_SAFE_INTEGER, Math.max(p.min ?? Number.MIN_SAFE_INTEGER, n)));
}

/** Sends what was typed, if it still stands on the value it began from and changed it: the value sent, or null. */
function flush(timer: MutableRefObject<ReturnType<typeof setTimeout> | null>, edit: MutableRefObject<Typed | null>, latest: MutableRefObject<Latest>): string | null {
  if (timer.current) {
    clearTimeout(timer.current);
    timer.current = null;
  }
  const typed = edit.current;
  edit.current = null;
  const { props, cmds, base } = latest.current;
  pendingEdits.remove(`${props.stepId}:${props.field}`);
  if (!typed || typed.base !== base) return null;
  const value = parseValue(typed.text, props);
  if (value === null || value === base) return null;
  if (props.onApply) props.onApply(value);
  else applyEdits(cmds, props.stepId, [{ field: props.field, value }]);
  return value;
}

// ── Capturing a key in the panel ──

// The wheel and the side buttons arrive through the same hook (InputHookManager composes them like
// keys, for hotkeys), but no step can press them.
const NOT_A_KEY = new Set(['ScrollUp', 'ScrollDown', 'XButton1', 'XButton2']);

/** A combo as key caps. */
export function Keys({ combo }: { combo: string }) {
  if (!combo) return null;
  return (
    <span className="insp-keys">
      {splitCombo(combo).map((k, i) => <kbd key={i} className="insp-cap">{compactKey(k)}</kbd>)}
    </span>
  );
}

/**
 * The key captured in the panel ("Keystroke — captura no próprio painel"): a press on the box
 * listens through the engine's hook, so Win+letter, AltGr and keys the page never sees arrive too,
 * and global hotkeys stay quiet meanwhile. The first real key or combo answers; a lone modifier
 * waits for the rest (except for a single key, where Ctrl alone is a key). Esc, a press elsewhere
 * or the panel going away stop listening without changing anything — Esc itself is typed in the
 * field beside it.
 */
export function KeyCapture({ value, single, label, onCapture, onCancel, autoListen, disabled }: {
  value: string;
  /** One key, not a combo (Key Down / Key Up): the key that went down. */
  single?: boolean;
  label: string;
  onCapture: (key: string) => void;
  /** Esc while listening, besides stopping: a step still being made goes with it. */
  onCancel?: () => void;
  /** Listening from the start (a Key just asked for). */
  autoListen?: boolean;
  disabled?: boolean;
}) {
  const capture = useKeyCapture();
  const [owner] = useState(() => `inspector-key-${crypto.randomUUID()}`);
  const [listening, setListening] = useState(!!autoListen);
  const [held, setHeld] = useState<string | null>(null);
  if (listening && disabled) setListening(false);
  const onCaptureRef = useRef({ onCapture, onCancel });
  useEffect(() => { onCaptureRef.current = { onCapture, onCancel }; });

  // Armed while listening; released on every way out, unmount included (an armed hook is an app
  // with no keyboard, the Stop hotkey included).
  useEffect(() => {
    if (!listening) return;
    capture.arm(owner);
    const off = capture.listen(owner, (combo) => {
      if (typeof combo !== 'string' || combo === '') return;
      const parts = splitCombo(combo);
      const key = parts[parts.length - 1];
      if (!key || NOT_A_KEY.has(key)) return;
      if (key === 'Escape' || key === 'Esc') {
        setListening(false);
        setHeld(null);
        onCaptureRef.current.onCancel?.();
        return;
      }
      if (!single && isPureModifier(combo)) {
        setHeld(combo);
        return;
      }
      setListening(false);
      setHeld(null);
      onCaptureRef.current.onCapture(single ? key : combo);
    });
    return () => {
      off();
      capture.release(owner);
    };
  }, [listening, capture, owner, single]);

  const shown = held ?? value;
  return (
    <button
      type="button"
      className="insp-capture"
      aria-label={label}
      aria-pressed={listening}
      data-listening={listening || undefined}
      disabled={disabled}
      onClick={() => { setHeld(null); setListening(on => !on); }}
      onBlur={() => { setListening(false); setHeld(null); }}
    >
      {shown ? <Keys combo={shown} /> : <span className="insp-capture-none">No key yet</span>}
      <span className="insp-capture-hint">
        {listening ? (single ? 'Listening — press a key · Esc cancels' : 'Listening — press a key or a combo · Esc cancels') : 'Click to capture a key'}
      </span>
    </button>
  );
}
