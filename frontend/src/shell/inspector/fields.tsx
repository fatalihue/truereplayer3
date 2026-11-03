import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type MutableRefObject, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { splitCombo } from '../../components/common/KbdTag';
import { isPureModifier, SINGLE_KEY_CAPTURE_IDLE_MS, useKeyCapture } from '../../logic/useKeyCapture';
import { useSteps } from '../../logic/useSteps';
import { fmtNum, t } from '../../i18n';
import { formatMs } from '../../utils/displayUtils';
import { compactKey } from '../../utils/keyNames';
import { useCheckTarget, type CheckTarget } from './checkTarget';
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
export function Segmented<T extends string>({ label, value, options, onChange, disabled, wrap }: {
  label: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean; tip?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Two to a line, for labels too long to share one. */
  wrap?: boolean;
}) {
  return (
    <div className="insp-seg" role="group" aria-label={label} data-wrap={wrap || undefined}>
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

/** The × at the end of a field that clears it, and gives the focus back to the field. Its label, from
 *  the catalog, is the name and the tip. */
export function Clear({ label, onClear, disabled }: { label: string; onClear: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="insp-icon-button"
      aria-label={label}
      data-tip={label}
      disabled={disabled}
      onClick={(e) => {
        onClear();
        e.currentTarget.parentElement?.querySelector('input')?.focus();
      }}
    >
      <span className="step-icon" data-icon="x" />
    </button>
  );
}

/** Quick durations under a field (DurationChips): the current one lit; ∞ is "no timeout" (0). */
export function Chips({ values, current, onPick, disabled, forever }: { values: number[]; current: number; onPick: (ms: number) => void; disabled?: boolean; forever?: boolean }) {
  return (
    <div className="insp-chips">
      {values.map(v => (
        <button key={v} type="button" aria-pressed={v === current} disabled={disabled} onClick={() => onPick(v)}>{formatMs(v)} ms</button>
      ))}
      {forever && (
        <button type="button" aria-pressed={current === 0} disabled={disabled} data-tip={t('inspector.fields.noTimeoutTip')} onClick={() => onPick(0)}>{t('inspector.fields.noTimeout')}</button>
      )}
    </div>
  );
}

/**
 * A variation of the repeat: a switch and its amount (Vary the gap, Vary the point). On, it starts
 * at the amount used last in this editor (or `first`), as today; off clears it. The amount applies
 * as typed.
 */
export function Vary({ label, fieldLabel, tip, stepId, field, value, first, unit, max, disabled, onSwitch }: {
  label: string;
  /** The amount's accessible name (`label (unit)` when absent). */
  fieldLabel?: string;
  tip: string;
  stepId: string;
  field: string;
  value: number;
  first: number;
  unit: string;
  max: number;
  disabled: boolean;
  onSwitch: (value: string) => void;
}) {
  const [last, setLast] = useState(value > 0 ? value : first);
  if (value > 0 && value !== last) setLast(value);
  return (
    <div className="insp-row">
      <Switch label={label} tip={tip} checked={value > 0} disabled={disabled} onChange={(on) => onSwitch(on ? String(last) : '')} />
      <span className="insp-row-label">{label}</span>
      <span className="insp-row-end">
        <DraftField stepId={stepId} field={field} label={fieldLabel ?? `${label} (${unit})`} kind="int" min={1} max={max} prefix="±" unit={unit} stored={value > 0 ? String(value) : String(last)} disabled={disabled || value <= 0} />
      </span>
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
  /**
   * 'int' and 'dec' are numbers ('dec' with decimals, written by `format`); 'mono' is text in the
   * monospaced face; 'text' is text.
   */
  kind: 'int' | 'dec' | 'text' | 'mono';
  min?: number;
  max?: number;
  /** How a 'dec' writes a value it stepped to (seconds as "0.25"). */
  format?: (value: number) => string;
  /** A minus sign is allowed (coordinates). */
  signed?: boolean;
  /**
   * An emptied field goes back to the stored value ('keep', the default, as the numeric fields of
   * today: an erased Delay is not 0 ms), or clears it where empty means something ('clear').
   */
  empty?: 'keep' | 'clear';
  prefix?: string;
  unit?: string;
  placeholder?: string;
  disabled?: boolean;
  /** What a typed text sends, or null to send nothing (a colour that is not six hex digits). */
  parse?: (text: string) => string | null;
  /** What a key may put in the text, for text that takes only some characters (a hotstring). */
  filter?: (text: string) => string;
  maxLength?: number;
  /**
   * A number's step for ↑ ↓, the wheel and ▲ ▼: 1 by default, 500 or 1000 for long waits, or one
   * that depends on the value (durationStep).
   */
  step?: number | ((value: number, dir: 1 | -1) => number);
  /** Text that may hold line breaks (Notes): a box from 2 to 8 lines, where Enter is a new line. */
  multiline?: boolean;
  /** Told what is being typed (null when nothing is), for a hint that judges the text as it goes. */
  onText?: (text: string | null) => void;
  /** The field's tooltip (from the catalog). */
  tip?: string;
  /** Sends the value; one edit of `field` when absent (of the step, or of what the check edits: checkTarget). */
  onApply?: (value: string) => void;
}

interface Latest {
  props: DraftFieldProps;
  cmds: ReturnType<typeof useSteps>;
  target: CheckTarget | null;
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
 *
 * A number does what the numeric fields of today do (editor-passo-228 to 234): ↑ ↓, the wheel while
 * it has the focus, and ▲ ▼ at its edge (on hover or focus, off the Tab order) move it a step — sent
 * like typing, so a run of steps is one edit; out of the focus a duration or a count of passes reads
 * with its thousands.
 */
export function DraftField(props: DraftFieldProps) {
  const { stored, stepId, field, kind, disabled } = props;
  const cmds = useSteps();
  const target = useCheckTarget();
  const [focused, setFocused] = useState(false);
  const [typing, setTyping] = useState<Typed | null>(null);
  const [sent, setSent] = useState<{ value: string; over: string } | null>(null);
  // The echo came, or something else moved the value: the step's value shows again.
  if (sent && stored !== sent.over) setSent(null);
  const base = sent && stored === sent.over ? sent.value : stored;
  if (typing && typing.base !== base) setTyping(null);

  const edit = useRef<Typed | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Latest>({ props, cmds, target, base });
  useEffect(() => { latest.current = { props, cmds, target, base }; });
  // No echo within a second (the engine kept the value): the step's value shows again.
  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => setSent(null), 1000);
    return () => clearTimeout(id);
  }, [sent]);
  // The editor going (another step selected, the selection cleared) sends what was typed.
  useEffect(() => () => { flush(timer, edit, latest); }, []);

  // The pause in the typing sends what is good to send and leaves the rest being typed (an erased
  // number, a colour or a pattern half written); leaving the field, Enter or Esc settle it — sent,
  // or the step's value back.
  const commit = (settle = true) => {
    if (!settle && (!edit.current || parseValue(edit.current.text, latest.current.props) === null)) return;
    const value = flush(timer, edit, latest);
    if (value !== null) setSent({ value, over: stored });
    setTyping(null);
  };
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; });

  const type = (text: string) => {
    const from = edit.current?.base ?? base;
    edit.current = { text, base: from };
    setTyping({ text, base: from });
    pendingEdits.add(`${stepId}:${field}`);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commitRef.current(false), IDLE_MS);
  };
  // A step up or down from what shows (the lower bound when it is empty; a 'dec' starts from the
  // value its placeholder says is in effect), inside the bounds.
  const numeric = kind === 'int' || kind === 'dec';
  const shownText = typing ? typing.text : base;
  const now = kind === 'dec' ? Number.parseFloat(shownText.replace(',', '.')) : Number.parseInt(shownText, 10);
  const usual = kind === 'dec' ? Number.parseFloat((props.placeholder ?? '').replace(',', '.')) : Number.NaN;
  const at = Number.isFinite(now) ? now : usual;
  const stepBy = (dir: 1 | -1) => {
    if (!numeric || disabled) return;
    const from = Number.isFinite(now) ? now : Number.isFinite(usual) ? usual : (props.min ?? 0);
    const size = typeof props.step === 'function' ? props.step(from, dir) : (props.step ?? 1);
    const next = Number.isFinite(now) || Number.isFinite(usual) ? from + dir * size : from;
    const bounded = Math.min(props.max ?? Number.MAX_SAFE_INTEGER, Math.max(props.min ?? Number.MIN_SAFE_INTEGER, next));
    type(kind === 'dec' ? (props.format ?? String)(Math.round(bounded * 1000) / 1000) : String(bounded));
  };
  const stepRef = useRef(stepBy);
  useEffect(() => { stepRef.current = stepBy; });
  // What is being typed, for the caller's hint (the Regex that does not compile).
  const typedText = typing ? typing.text : null;
  const onTextRef = useRef(props.onText);
  useEffect(() => { onTextRef.current = props.onText; });
  useEffect(() => { onTextRef.current?.(typedText); }, [typedText]);
  // The wheel turns a focused number and leaves the panel where it is; a passive listener (React's)
  // could not keep the panel from scrolling.
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el || (kind !== 'int' && kind !== 'dec')) return;
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el || e.deltaY === 0) return;
      e.preventDefault();
      stepRef.current(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [kind]);

  // The thousands only where the number is a count of ms or of passes, as in the fields of today: a
  // coordinate, a percent or a number of times reads as typed.
  const grouped = kind === 'int' && (props.unit === 'ms' || props.unit === '×');
  const shown = typing ? typing.text
    : grouped && !focused && /^-?\d+$/.test(base) ? fmtNum(Number(base))
    : base;
  const box = {
    ref: inputRef,
    'aria-label': props.label,
    className: kind === 'text' ? undefined : 'insp-mono',
    value: shown,
    placeholder: props.placeholder,
    maxLength: props.maxLength,
    disabled,
    spellCheck: false,
    autoComplete: 'off',
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => type(clean(e.target.value, props)),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      // In a box of lines, Enter is a new line: the text goes when the typing stops or the box is left.
      // Ctrl+Enter goes on to the Inspector, which gives the focus back to the list (sent on the way).
      if (e.key === 'Enter' && !e.ctrlKey && !props.multiline) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        // Sent as it stands; the Inspector then gives the focus back to the list (D12).
        commit();
      } else if (numeric && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        stepBy(e.key === 'ArrowUp' ? 1 : -1);
      }
    },
    // The number trades its thousands for its digits in the focus event itself, and the digits
    // come selected, so what is typed takes their place instead of going after them (setting the
    // text had dropped the caret at its end). A click still puts the caret where it lands.
    onFocus: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      const was = el.value;
      flushSync(() => setFocused(true));
      if (el.value !== was) el.select();
    },
    onBlur: () => { setFocused(false); commit(); },
  };
  return (
    <label className="insp-box" data-disabled={disabled || undefined} data-multiline={props.multiline || undefined} data-tip={props.tip}>
      {props.prefix && <span className="insp-box-prefix">{props.prefix}</span>}
      {props.multiline
        ? <textarea {...box} rows={2} />
        : <input {...box} type="text" inputMode={kind === 'int' ? 'numeric' : kind === 'dec' ? 'decimal' : undefined} />}
      {props.unit && <span className="insp-box-unit">{props.unit}</span>}
      {numeric && !disabled && (
        <span className="insp-steppers">
          <button type="button" tabIndex={-1} aria-label={t('inspector.fields.increase')} disabled={props.max !== undefined && at >= props.max} onMouseDown={(e) => e.preventDefault()} onClick={() => stepBy(1)} />
          <button type="button" tabIndex={-1} aria-label={t('inspector.fields.decrease')} disabled={!Number.isFinite(at) || (props.min !== undefined && at <= props.min)} onMouseDown={(e) => e.preventDefault()} onClick={() => stepBy(-1)} />
        </span>
      )}
    </label>
  );
}

/** What a typed key does to the text: digits only in a number (and one leading minus where allowed). */
function clean(text: string, p: DraftFieldProps): string {
  if (p.filter) return p.filter(text);
  if (p.kind === 'dec') return text.replace(/[^\d.,]/g, '');
  if (p.kind !== 'int') return text;
  const minus = p.signed && text.trim().startsWith('-') ? '-' : '';
  return minus + text.replace(/\D/g, '').slice(0, 9);
}

/** The value to send for what was typed, or null for nothing to send. */
function parseValue(text: string, p: DraftFieldProps): string | null {
  if (p.parse) return p.parse(text);
  if (p.kind === 'text') return text;
  if (p.kind === 'mono') {
    const trimmed = text.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (text === '') return p.empty === 'clear' ? '' : null;
  if (text === '-') return null;
  const n = p.kind === 'dec' ? Number.parseFloat(text.replace(',', '.')) : Number.parseInt(text, 10);
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
  const { props, cmds, target, base } = latest.current;
  pendingEdits.remove(`${props.stepId}:${props.field}`);
  if (!typed || typed.base !== base) return null;
  const value = parseValue(typed.text, props);
  if (value === null || value === base) return null;
  if (props.onApply) props.onApply(value);
  else if (target) target.edit([{ field: props.field, value }]);
  else applyEdits(cmds, props.stepId, [{ field: props.field, value }]);
  return value;
}

// ── Capturing a key in the panel ──

// The wheel and the side buttons arrive through the same hook (InputHookManager composes them like
// keys, for hotkeys): a macro's hotkey takes them, but no step can press them.
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
 * waits for the rest (except for a single key, where Ctrl alone is a key). Esc, a press elsewhere,
 * 4 s with no key or the panel going away stop listening without changing anything — Esc itself is
 * typed in the field beside it.
 */
export function KeyCapture({ value, single, mouse, label, onCapture, onCancel, autoListen, disabled }: {
  value: string;
  /** One key, not a combo (Key Down / Key Up): the key that went down. */
  single?: boolean;
  /** The side buttons and the wheel count too (a macro's hotkey: the engine fires on them). */
  mouse?: boolean;
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
  // with no keyboard, the Stop hotkey included). Left alone, it gives up after the idle budget of
  // today's captures, counted again while a modifier waits for the rest.
  useEffect(() => {
    if (!listening) return;
    capture.arm(owner);
    const stop = () => { setListening(false); setHeld(null); };
    let idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
    const off = capture.listen(owner, (combo) => {
      if (typeof combo !== 'string' || combo === '') return;
      const parts = splitCombo(combo);
      const key = parts[parts.length - 1];
      if (!key || (!mouse && NOT_A_KEY.has(key))) return;
      if (key === 'Escape' || key === 'Esc') {
        stop();
        onCaptureRef.current.onCancel?.();
        return;
      }
      if (!single && isPureModifier(combo)) {
        setHeld(combo);
        clearTimeout(idle);
        idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
        return;
      }
      stop();
      onCaptureRef.current.onCapture(single ? key : combo);
    });
    return () => {
      clearTimeout(idle);
      off();
      capture.release(owner);
    };
  }, [listening, capture, owner, single, mouse]);

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
      {shown ? <Keys combo={shown} /> : <span className="insp-capture-none">{t('inspector.fields.noKey')}</span>}
      <span className="insp-capture-hint">
        {listening
          ? (single ? t('inspector.fields.listening')
            : mouse ? t('inspector.fields.listeningMouse')
            : t('inspector.fields.listeningCombo'))
          : t('inspector.fields.capture')}
      </span>
    </button>
  );
}
