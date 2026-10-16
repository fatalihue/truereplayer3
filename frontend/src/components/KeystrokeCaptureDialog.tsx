import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { Keyboard } from 'lucide-react';
import { NumberInput } from './common/NumberInput';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { SegmentedControl } from './common/SegmentedControl';
import { KeyCaps } from './common/KeyCaps';
import { splitCombo } from './common/KbdTag';
import { compactKey } from '../utils/keyNames';
import { CheckboxBox } from './Checkbox';
import { DurationChips, DURATION_PRESETS } from './common/DurationChips';
import { calloutStyle } from './common/Callout';
import { MIN_HOLD_MS, MAX_HOLD_MS, DEFAULT_HOLD_MS } from '../utils/actionCost';
import { useBridge } from '../bridge/BridgeContext';
import { useLanguage, useTt } from '../state/LanguageContext';
import { formatMs } from '../utils/displayUtils';
import { useWindowFocused } from '../hooks/useWindowFocused';
import { AnnounceOnChange } from './common/AnnounceOnChange';

/**
 * Unified "Send Keystroke" dialog. One capture pad + a Press/Hold mode toggle covers
 * everything keyboard-related the user could want to insert manually:
 *
 *   Press mode (default):
 *     • Times = 1 → single press of a key or combo  (Ctrl+S, F5, A, Alt+Tab, Win+A)
 *     • Times > 1 → press N times with configurable gap (Tab × 5, F5 × 10)
 *
 *   Hold mode:
 *     • Press a single key, keep it down for the configured duration
 *     • Preset chips for common holds (100 ms tap → 30 s, the same ladder Insert Pause uses)
 *     • Modifier keys are stripped on save — backend SimulateKey only handles
 *       single keys; the warning chip surfaces this whenever the captured value
 *       contains a "+", so the user is never surprised.
 *
 * Capture goes through the backend low-level keyboard hook (hotkey:capture /
 * hotkey:captured) because the WebView2 JS layer never sees Win+letter combos —
 * the Windows Shell intercepts them at OS level. The hook composes the combo and
 * forwards it here. Capture is automatically suspended while a numeric input is
 * focused so the user can type "5" into Times without re-capturing "5" as a combo.
 *
 * Replaces the three legacy dialogs / menu entries (Send Key, Send Keystroke,
 * Press Key × N, Hold Key) — keeps the underlying ActionType split intact
 * (Keystroke for press flows, HoldKey for hold flows) so no profile migration
 * is required.
 */

/** Human-readable label for the chip. */
function keystrokeDisplay(keystroke: string): string {
  return keystroke.replace(/\bVK_93\b/, 'Menu');
}

/** The same combo in keycap spelling (PgDn, Esc, Del…) for the semantics strip, so the sentence
 *  names the keys exactly as the hero caps above it draw them. Split and re-joined by the caps'
 *  own rule, so a literal "+" key survives. Display only — the payload keeps the canonical names. */
function keystrokeSentence(keystroke: string): string {
  // Guarded: splitCombo reads an empty string as the lone "+" key.
  if (!keystroke) return '';
  return splitCombo(keystrokeDisplay(keystroke)).map(compactKey).join('+');
}

// ── Constants (match the C# clamps) ──

const DEFAULT_REPEAT_DELAY_MS = 30;
const MAX_REPEAT = 999;
const MAX_REPEAT_DELAY = 5000;

// Gap jitter — OFF by default (the field stays 0/absent so existing macros replay
// byte-identically). When the user turns it on, this is the ±% seeded into the input.
const DEFAULT_JITTER_PCT = 20;
const MAX_JITTER_PCT = 100;

// Range and default live in utils/actionCost, shared with the Sheet, the Insert Click dialog and
// the run estimate — the four surfaces that have to agree on what an unset dwell means.

// Hold durations come from the app-wide ladder (DURATION_PRESETS). No ∞ here: a key can't be
// held indefinitely — the backend caps a hold at MAX_HOLD_MS and an unbounded hold would freeze
// the replay with the key stuck down — so this dialog passes the ladder without the mode chip.

/** Spinner step: 1 s once we're past 1 s, 100 ms below — match HoldKeyDialog's feel. */
const stepFor = (v: number) => v >= 1000 ? 1000 : 100;

// ── Component ──

type Mode = 'press' | 'hold';

export type SendKeystrokeResult =
  | { actionType: 'Keystroke'; key: string; repeat: number; repeatDelayMs: number; repeatDelayJitterPct: number }
  | { actionType: 'HoldKey'; key: string; holdDurationMs: number };

interface KeystrokeCaptureDialogProps {
  /**
   * Edit-mode seeds. When `initialKey` is set, the dialog opens in edit mode:
   * captured value pre-filled, Save button label, Esc closes (instead of re-arming
   * capture). `initialActionType` chooses the starting mode (Press for Keystroke,
   * Hold for HoldKey).
   */
  initialActionType?: 'Keystroke' | 'HoldKey';
  initialKey?: string;
  initialRepeat?: number;
  initialRepeatDelayMs?: number;
  initialRepeatDelayJitterPct?: number;
  initialHoldDurationMs?: number;
  onConfirm: (result: SendKeystrokeResult) => void;
  onClose: () => void;
}

export function KeystrokeCaptureDialog({
  initialActionType,
  initialKey,
  initialRepeat,
  initialRepeatDelayMs,
  initialRepeatDelayJitterPct,
  initialHoldDurationMs,
  onConfirm,
  onClose,
}: KeystrokeCaptureDialogProps) {
  const tt = useTt();
  // For the semantics strip's durations — same locale grouping the chips and the grid use.
  const { language } = useLanguage();
  // Caption → field ties, so a click on a row's caption lands in its field (and pauses capture,
  // through the same focusin the field itself fires).
  const timesId = useId();
  const gapId = useId();
  const holdId = useId();

  // `isEditing` flips Esc behaviour and the button label. Decoupled from mode so
  // we can edit a Keystroke row, switch to Hold, and save — converting the row's
  // ActionType without leaving the dialog.
  const isEditing = initialKey != null;

  // Mode follows the edited row's ActionType on insert/edit. Insert flow defaults
  // to Press because that's the most common keyboard intent (tap once / tap N
  // times); Hold is a deliberate choice the user toggles into.
  const [mode, setMode] = useState<Mode>(initialActionType === 'HoldKey' ? 'hold' : 'press');

  // Capture state — seeded from initialKey on edit so Save is enabled immediately.
  const [captured, setCaptured] = useState<string | null>(initialKey ?? null);

  // Manual text entry — the escape hatch for values the low-level hook can never
  // produce: {var:name}/{clipboard} tokens (resolved by the replay engine, possibly
  // into a whole combo) and hand-typed combos. Auto-enters manual mode when editing
  // a row whose key already contains a token, so the value is immediately editable.
  const [manualEntry, setManualEntry] = useState(() => (initialKey ?? '').includes('{'));
  // Ref mirror for the capture subscription below — while typing manually, a stray
  // key press must not overwrite the typed value via 'hotkey:captured'.
  const manualEntryRef = useRef(manualEntry);
  useEffect(() => { manualEntryRef.current = manualEntry; });
  const manualInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (manualEntry) manualInputRef.current?.focus();
  }, [manualEntry]);

  // Press-mode state.
  const [repeat, setRepeat] = useState<number>(initialRepeat ?? 1);
  const [repeatDelay, setRepeatDelay] = useState<number>(initialRepeatDelayMs ?? DEFAULT_REPEAT_DELAY_MS);
  // Gap jitter is stored as a single number (0 = off), but the dialog keeps the on/off and the
  // ±% value on separate tracks — mirroring the app's EnableChip — so toggling off and back on
  // restores the last value instead of snapping to 0. Off by default.
  const [jitterOn, setJitterOn] = useState<boolean>((initialRepeatDelayJitterPct ?? 0) > 0);
  const [jitterPct, setJitterPct] = useState<number>(
    initialRepeatDelayJitterPct && initialRepeatDelayJitterPct > 0 ? initialRepeatDelayJitterPct : DEFAULT_JITTER_PCT,
  );

  // Hold-mode state. Two-track (state + ref) because the Insert button can fire
  // immediately after a preset click before React's batched state has flushed —
  // reading from a synchronous ref on commit avoids a real "saves the previous
  // value" bug we hit in the original HoldKeyDialog.
  const initialMs = initialHoldDurationMs ?? DEFAULT_HOLD_MS;
  const [holdMs, setHoldMsState] = useState<number>(initialMs);
  const holdMsRef = useRef<number>(initialMs);
  const setHoldMs = useCallback((next: number | ((v: number) => number)) => {
    setHoldMsState(prev => {
      const value = typeof next === 'function' ? next(prev) : next;
      holdMsRef.current = value;
      return value;
    });
  }, []);

  // Re-sync when reopening the dialog on a different row (parent toggles mount
  // via `{editState && <Dialog />}` but React may reuse the instance at the same
  // JSX position). Without this, a second Edit click could open with stale values.
  // Re-seed every state field, not just the hold duration — otherwise mode /
  // captured / repeat / gap keep the previous row's values when the instance is
  // reused.
  useEffect(() => {
    setMode(initialActionType === 'HoldKey' ? 'hold' : 'press');
    setCaptured(initialKey ?? null);
    setManualEntry((initialKey ?? '').includes('{'));
    setRepeat(initialRepeat ?? 1);
    setRepeatDelay(initialRepeatDelayMs ?? DEFAULT_REPEAT_DELAY_MS);
    setJitterOn((initialRepeatDelayJitterPct ?? 0) > 0);
    setJitterPct(initialRepeatDelayJitterPct && initialRepeatDelayJitterPct > 0 ? initialRepeatDelayJitterPct : DEFAULT_JITTER_PCT);
    const ms = initialHoldDurationMs ?? DEFAULT_HOLD_MS;
    setHoldMsState(ms);
    holdMsRef.current = ms;
  }, [initialActionType, initialKey, initialRepeat, initialRepeatDelayMs, initialRepeatDelayJitterPct, initialHoldDurationMs]);

  // Stable refcount slot — see InputHookManager.RegisterCapture. Per-mount ID so
  // enable/disable target the same slot, and a sibling consumer (Settings hotkey
  // field, Pause dialog) can't accidentally turn the hook off via shared state.
  const ownerIdRef = useRef(`keystroke-capture-${crypto.randomUUID()}`);
  const { send, subscribe } = useBridge();
  // Display-only — the capture gate itself lives in InputHookManager.CaptureHotkeyMode.
  const windowFocused = useWindowFocused();

  // (Esc focus handling moved into DialogShell — it focuses the card on mount.)

  // Capture mode wiring. Mount → enable backend low-level capture; subscribe to
  // composed combos. Numeric inputs (Times / Gap / Hold duration) suspend capture
  // on focus so typing "5" lands as text instead of re-capturing "5" as a combo,
  // and resume it on blur. Pure-modifier captures ("Win", "Ctrl+Alt") are kept
  // visible in the chip but don't replace an already-captured real combo — that
  // matches the old "wait for the real key" filter while still letting the user
  // see what modifiers are held mid-press.
  useEffect(() => {
    // Manual mode OWNS the keyboard — never arm the low-level hook while it is on.
    // An armed hook swallows EVERY keystroke system-wide (InputHookManager returns 1
    // for all keys in capture mode), which on the auto-manual edit flow left the
    // autofocused input dead and Esc unable to close the dialog: the input's focusin
    // fired BEFORE this effect attached its listener, so nothing ever disabled the
    // hook. Keying the effect on manualEntry makes the toggle authoritative.
    // Read the ref ONCE here rather than in the cleanup. The id is assigned at mount and
    // never reassigned, so this is behaviour-identical — but a ref read inside cleanup is
    // the shape that releases the WRONG owner the day someone does make it reassignable.
    const ownerId = ownerIdRef.current;
    send({ type: 'hotkey:capture', payload: { enabled: !manualEntry, ownerId } });
    const isPureModifier = (combo: string) =>
      /^(Win|Ctrl|Alt|Shift)(\+(Win|Ctrl|Alt|Shift))*$/.test(combo);

    const unsub = subscribe((msg) => {
      if (msg.type !== 'hotkey:captured') return;
      // Addressed to the most recently registered capture owner — another consumer that armed
      // after this dialog gets the key, not this one (RemapSection filters the same way).
      if (msg.payload.owner && msg.payload.owner !== ownerId) return;
      // Manual mode owns the value — a key pressed while the manual input is NOT
      // focused (capture re-armed by focusout) must not clobber the typed text.
      if (manualEntryRef.current) return;
      const combo = msg.payload.combo;
      setCaptured((prev) => {
        // Don't overwrite an already-captured combo with a bare modifier press —
        // user is probably holding modifiers for the next combo.
        if (prev !== null && isPureModifier(combo)) return prev;
        return combo;
      });
    });

    const handleFocusIn = (e: FocusEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') {
        send({ type: 'hotkey:capture', payload: { enabled: false, ownerId } });
      }
    };
    const handleFocusOut = (e: FocusEvent) => {
      // Never re-arm on blur while manual mode is on — the hook must stay off for
      // the whole manual session, not just while the text input has focus.
      if ((e.target as HTMLElement)?.tagName === 'INPUT' && !manualEntryRef.current) {
        send({ type: 'hotkey:capture', payload: { enabled: true, ownerId } });
      }
    };
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      send({ type: 'hotkey:capture', payload: { enabled: false, ownerId } });
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      unsub();
    };
  }, [send, subscribe, manualEntry]);

  // Clamp helpers — applied on commit (handleConfirm) and on +/− spinner clicks.
  // Free-form typing is allowed to fall below the lower bound in transient states
  // so the input doesn't snap while the user is still typing.
  const clampRepeat = (v: number) => Math.max(1, Math.min(MAX_REPEAT, Math.floor(v)));
  const clampDelay = (v: number) => Math.max(0, Math.min(MAX_REPEAT_DELAY, Math.floor(v)));
  const clampJitter = (v: number) => Math.max(1, Math.min(MAX_JITTER_PCT, Math.floor(v)));
  const clampHold = (v: number) => Math.max(MIN_HOLD_MS, Math.min(MAX_HOLD_MS, Math.floor(v)));

  // Derived values used by the renderer + commit.
  // Parsed with splitCombo, the rule the keycaps already use: a trailing empty segment IS the + key.
  // A plain split('+') read "Ctrl++" (Ctrl with the + key, what the capture produces on layouts where
  // + has a key of its own) as Ctrl with an EMPTY key — Hold saved Key = "" and the row did nothing
  // at replay, with Add still enabled — and counted a lone "+" as a combo with modifiers.
  const comboParts = captured ? splitCombo(captured.trim()) : [];
  const hasModifiers = comboParts.length > 1;
  // For Hold mode, only the last part of the combo gets used on commit — that's
  // the actual key the OS will keep pressed. Modifiers in the captured string
  // would confuse SimulateKey (no virtual-key code for "Ctrl+S"), so we strip
  // them at save time and warn in the UI.
  const heldKey = comboParts.length > 0 ? comboParts[comboParts.length - 1] : '';

  const handleConfirm = () => {
    // Trim on commit: manual entry can produce whitespace-only or trailing-space
    // values the capture hook never could — a whitespace key would silently no-op
    // at replay with zero diagnostics.
    if (!captured?.trim()) return;
    if (mode === 'hold' && !heldKey.trim()) return;
    if (mode === 'hold') {
      onConfirm({
        actionType: 'HoldKey',
        key: heldKey.trim(),
        holdDurationMs: clampHold(holdMsRef.current),
      });
    } else {
      onConfirm({
        actionType: 'Keystroke',
        key: captured.trim(),
        repeat: clampRepeat(repeat),
        repeatDelayMs: clampDelay(repeatDelay),
        // 0 = off. Jitter only applies across repeats, so a single press (or jitter
        // toggled off) always commits 0 — the backend then stores null (schema-clean).
        repeatDelayJitterPct: jitterOn && repeat > 1 ? clampJitter(jitterPct) : 0,
      });
    }
  };

  // Title flips by intent: edit vs insert, then by mode.
  const title = isEditing
    ? (mode === 'hold' ? 'Edit Hold Key' : 'Edit Keystroke')
    : 'Send Keystroke';

  return (
    <DialogShell
      icon={<Keyboard size={14} style={{ color: 'var(--color-action-key-fg)' }} />}
      title={title}
      onClose={onClose}
      // Capture dialog: a stray click outside must not discard a captured combo
      // (or the Times/Gap/Hold tuning) — dismissal is Esc or Cancel only.
      closeOnBackdrop={false}
      // Truthful per state — NEVER advertises Enter while the hook is armed
      // (outside input focus, Enter would be CAPTURED as the combo, not confirm).
      // Manual mode owns the keyboard, so there Enter/Esc read as usual.
      footerHint={manualEntry
        ? 'Enter confirms · Esc cancels'
        : captured
          ? 'Press another combo to replace'
          : ''}
      footer={<DialogFooter secondary={{ label: 'Cancel', onClick: onClose }} primary={{ label: isEditing ? 'Save' : 'Add', onClick: handleConfirm, disabled: !captured?.trim() || (mode === 'hold' && !heldKey.trim()) }} />}
      onCardKeyDown={(e) => {
        // Enter confirms ONLY when a numeric input is focused — in that state the
        // backend capture is paused (handleFocusIn in the capture effect) so the
        // Enter press doesn't double as a captured combo. Outside of input focus,
        // Enter is captured as the "Enter" hotkey by the backend hook and arrives
        // via 'hotkey:captured', so we deliberately do NOT confirm on it here.
        // Esc is owned by DialogShell.
        //
        // The EVENT TARGET, not document.activeElement: NumberInput blurs itself on Enter (to
        // commit) before this card handler runs, so by now the focus is on <body> and the check
        // read "not an input" for Times / Gap / Hold — Enter there never confirmed.
        if (e.key === 'Enter') {
          const focusedTag = (e.target as HTMLElement | null)?.tagName;
          if (focusedTag === 'INPUT' && captured !== null) {
            e.preventDefault();
            e.stopPropagation();
            handleConfirm();
          }
        }
      }}
    >
        <div className="px-5 py-5 flex flex-col gap-4">
          {/* KEY — the capture pad and its manual escape hatch, under one label. The pad was the
              only unlabelled control in this dialog; the identical pad in Insert Pause has
              carried a RESUME HOTKEY label since it was written, and the Insert Click dialog now
              labels its Mode track for the same reason. A label costs 20 px once and tells a
              first-time reader what the big dashed box is FOR before they press anything. */}
          <div className="flex flex-col gap-1.5">
          <span className="label-micro text-text-tertiary">Key</span>
          {/* Capture pad — universal for both modes. Single press detects whatever
              modifiers the user is holding; Hold mode silently uses only the last
              key, with a warning chip when modifiers got dropped. The border style
              reports the hook state truthfully: dashed = low-level capture armed,
              solid = manual mode (hook off, the keyboard is yours). */}
          <div
            className={`bg-bg-input border rounded py-5 px-4 text-center min-h-[140px] flex flex-col justify-center transition-colors ${
              manualEntry ? 'border-border-default' : 'border-dashed'
            }`}
            style={manualEntry ? undefined : {
              borderColor: 'color-mix(in srgb, var(--color-action-key-fg) 40%, transparent)',
              ...(captured ? { background: 'color-mix(in srgb, var(--color-action-key-fg) 4%, var(--color-bg-input))' } : null),
            }}
          >
            {manualEntry ? (
              <>
                <input
                  ref={manualInputRef}
                  type="text"
                  value={captured ?? ''}
                  onChange={(e) => setCaptured(e.target.value || null)}
                  placeholder="F5 · Ctrl+S · {var:name}"
                  spellCheck={false}
                  // Named: the KEY caption above is a plain span, so without this the field was
                  // announced by its placeholder alone.
                  aria-label="Key"
                  // The field primitive; bg-elevated stays because the pad around it is already
                  // bg-input, and the recipe's own fill would melt into it. Key ink + centred,
                  // like the hero caps it stands in for.
                  className="input-field bg-bg-elevated text-center text-[color:var(--color-action-key-fg)]"
                />
                <div className="mt-2.5 text-caption text-text-tertiary leading-relaxed">
                  {mode === 'hold' ? (
                    // Hold goes through SimulateKey (single virtual-key) — a token
                    // resolving to a combo would silently no-op, so don't teach it here.
                    <>For Hold, a <code className="text-accent-light">{'{var:name}'}</code> token must
                      resolve to a <span className="text-text-secondary">single key</span> (F5, W, Space…).</>
                  ) : (
                    <>Tokens like <code className="text-accent-light">{'{var:name}'}</code> or{' '}
                      <code className="text-accent-light">{'{clipboard}'}</code> resolve at replay —
                      even into a full combo like Ctrl+V.</>
                  )}
                </div>
              </>
            ) : captured === null ? (
              <>
                {/* The hook only captures while TrueReplayer is the FOREGROUND app, so the pad
                    must not promise "press any key" while the user is in another window —
                    it would be inviting a press that (correctly) goes to that other app. */}
                <div className="text-minor text-text-secondary mb-1">
                  {windowFocused
                    ? 'Press any key or combo'
                    : 'Click TrueReplayer to capture keys'}
                </div>
                <div className="text-caption font-mono text-text-tertiary">A · F5 · Ctrl+S · Win+A</div>
              </>
            ) : (
              <KeyCaps combo={captured} fg="var(--color-action-key-fg)" />
            )}
          </div>

          {/* Capture ↔ manual toggle. Manual is the only way to put a {var}/{clipboard}
              token (or a combo the OS shell would swallow) into the Key field — the
              low-level hook can never capture those. */}
          <button
            type="button"
            onClick={() => setManualEntry(v => !v)}
            // min-h-6: the 24 px target floor (the bare caption line is 16 px). Same in both
            // labels, so the card height does not move when it flips.
            className="self-center mt-0.5 min-h-6 text-caption text-text-secondary hover:text-text-primary underline decoration-dotted transition-colors"
          >
            {manualEntry ? 'Back to key capture' : 'Type manually · {var} tokens'}
          </button>
          </div>

          {/* Mode toggle — switches the body below between Press and Hold settings. */}
          <div className="flex flex-col gap-1.5">
            <span className="label-micro text-text-tertiary">Mode</span>
            <SegmentedControl<Mode>
              ariaLabel="Keystroke mode"
              grow
              value={mode}
              onChange={setMode}
              options={[
                { value: 'press', label: 'Press' },
                { value: 'hold', label: 'Hold' },
              ]}
            />
          </div>

          {/* ── Mode body ──
              Both bodies live in the SAME grid cell (row 1, column 1), so this wrapper is always as
              tall as the taller of the two and the dialog never resizes when you switch tabs. The
              inactive one keeps its space but is visibility:hidden, which also takes it out of the
              tab order and off the pointer — no aria-hidden needed for that, but it is set so screen
              readers agree with what is painted.

              Why stacking rather than a min-h-[Npx] on one wrapper: font size, border radius and row
              height are all user-adjustable theme settings, so any hardcoded pixel height would be
              correct at one setting and wrong at the rest. Measuring the real content costs nothing
              and survives every theme.

              Both bodies are therefore always MOUNTED. That is safe here: every value they edit
              (repeat, repeatDelay, jitter, holdMs) is state owned by this component, not by the
              inputs, and no NumberInput in this dialog passes autoFocus (its mount effect
              early-returns when false), so nothing steals focus from the capture pad. */}
          <div className="grid">
            {/* ── PRESS mode body ── */}
            <div
              className={`flex flex-col gap-2.5 ${mode === 'press' ? '' : 'invisible pointer-events-none'}`}
              style={{ gridArea: '1 / 1' }}
              aria-hidden={mode !== 'press'}
            >
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor={timesId}
                  className="text-minor font-medium text-text-secondary"
                >Times to repeat</label>
                <NumberInput
                  id={timesId}
                  value={repeat}
                  onChange={(n) => setRepeat(clampRepeat(n))}
                  min={1}
                  max={MAX_REPEAT}
                  inputWidth="w-24"
                  ghostSuffix="ms"
                  // The visible caption, word for word: a name that does not contain what the
                  // screen shows ("Repeat count" did not) cannot be spoken by voice control.
                  ariaLabel="Times to repeat"
                />
              </div>

              {/* Gap stays visible but dims when Times = 1 — communicates the field
                  exists for repeat-flavoured presses without making the dialog
                  jump in height when the user increments Times. */}
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor={gapId}
                  className={`text-minor font-medium transition-colors ${repeat > 1 ? 'text-text-secondary' : 'text-text-tertiary'}`}
                >
                  Gap between presses
                </label>
                <NumberInput
                  id={gapId}
                  value={repeatDelay}
                  onChange={(n) => setRepeatDelay(clampDelay(n))}
                  min={0}
                  max={MAX_REPEAT_DELAY}
                  disabled={repeat <= 1}
                  thousands
                  suffix="ms" suffixInside
                  inputWidth="w-24"
                  ariaLabel="Gap between presses (ms)"
                />
              </div>

              {/* Gap jitter — OFF by default. Adds a random ±% to each gap so a repeat burst
                  doesn't fire on a perfectly fixed interval — a constant gap is the clearest
                  "it's a bot" tell. Like Gap, the whole row is inert until Times > 1.
                  Box BEFORE the label, matching the identical row in the click editor: this is
                  the same setting on the other side of the app, and it was the one place still
                  using the enable-dot form. */}
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setJitterOn(v => !v)}
                  disabled={repeat <= 1}
                  // A checkbox, as drawn — and checked exactly when the box is: with Times = 1
                  // the box shows empty, and aria-pressed={jitterOn} said "on" over it.
                  role="checkbox"
                  aria-checked={jitterOn && repeat > 1}
                  className="flex items-center gap-1.5 disabled:cursor-not-allowed"
                  data-tip={tt('Random ±% on each gap — less robotic.', 'Variação ±% aleatória em cada intervalo — menos robótico.')}
                >
                  <CheckboxBox checked={jitterOn && repeat > 1} />
                  <span className={`text-minor font-medium transition-colors ${jitterOn && repeat > 1 ? 'text-text-secondary' : 'text-text-tertiary'}`}>
                    Gap jitter
                  </span>
                </button>
                <NumberInput
                  value={jitterPct}
                  onChange={(n) => setJitterPct(clampJitter(n))}
                  min={1}
                  max={MAX_JITTER_PCT}
                  disabled={!jitterOn || repeat <= 1}
                  suffix="%" suffixInside
                  inputWidth="w-24"
                  ariaLabel="Gap jitter (%)"
                />
              </div>
            </div>

            {/* ── HOLD mode body ── */}
            <div
              className={`flex flex-col gap-2.5 ${mode === 'hold' ? '' : 'invisible pointer-events-none'}`}
              style={{ gridArea: '1 / 1' }}
              aria-hidden={mode !== 'hold'}
            >
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor={holdId}
                  className="text-minor font-medium text-text-secondary"
                >Hold duration</label>
                {/* Step is dynamic (stepFor returns 1000 once we're at/above 1s, 100
                    below it). NumberInput's step is constant per render, so we recompute
                    via the parent's clamp on each change. */}
                <NumberInput
                  id={holdId}
                  value={holdMs}
                  onChange={(n) => setHoldMs(clampHold(n))}
                  min={MIN_HOLD_MS}
                  max={MAX_HOLD_MS}
                  step={stepFor(holdMs)}
                  inputWidth="w-24"
                  thousands
                  suffix="ms" suffixInside
                  ariaLabel="Hold duration (ms)"
                />
              </div>

              {/* Preset chips. onSelect goes through setHoldMs (the two-track
                  state+ref setter) so a preset click followed by an immediate Add
                  still commits the fresh value — presets are shortcuts, not locks. */}
              <DurationChips presets={DURATION_PRESETS} value={holdMs} onSelect={setHoldMs} />

              {/* Modifier-strip warning. Captured combo like "Ctrl+S" can't be held
                  by the backend (SimulateKey takes a single virtual-key code), so
                  Save will use only the last token. Surfaced explicitly rather than
                  silently stripped — left-rail card, warning tone.

                  ALWAYS RENDERED, visibility-toggled: this used to mount only when the captured
                  value contained a "+", which grew the dialog the moment the user captured a combo.
                  Its space is reserved from the start so appearing costs no layout. The text is
                  fixed and the <kbd> holds a single key name in BOTH states (heldKey is the last
                  token of the combo, so "Ctrl+S" gives "S" — never longer than the plain-key case),
                  which is what keeps the reserved height honest instead of merely close. */}
              <div
                className={`warning-band rounded-r px-2.5 py-2 text-caption leading-relaxed text-text-secondary ${hasModifiers ? '' : 'invisible'}`}
                aria-hidden={!hasModifiers}
              >
                {'Hold takes a single key: this saves as'}{' '}
                {/* Fixed-width cap: the key name sits INSIDE the sentence, so a wide name ("Space",
                    "ScrollDown") used to push the wrap to one more line and grow the dialog by
                    16 px on capture — measured. 10ch fits every compact key name; anything longer
                    truncates rather than reflowing the band. */}
                <kbd className="inline-block w-[10ch] max-w-[10ch] truncate align-bottom text-center px-1 py-px bg-bg-elevated border border-border-default rounded font-mono text-caption text-warning-ink">
                  {/* nbsp when nothing is captured: an empty cap has no line box and the band
                      was 4 px shorter before the first key. */}
                  {compactKey(keystrokeDisplay(heldKey)) || ' '}
                </kbd>{' '}
                {'and drops the modifiers. For a combo, add a Hold row for the modifier above the action.'}
              </div>
            </div>
          </div>

          {/* Live-semantics strip — the same always-render-all, show-one construction as Insert
              Click and Insert Pause, for the same height reason. This was the only one of the
              three insert dialogs without one, so it was the only one where "what will this row
              actually do?" had to be assembled by reading four controls and knowing that Hold
              drops the modifiers.
              Neutral while nothing is captured: that state is the question still being asked, not
              a mistake — Add is disabled, but the user has done nothing wrong yet. The key colour
              once there is an answer.
              `truncate` on each line, which the click dialog's strip does not need: manual entry
              accepts free text of any length, and without it a long typed value would wrap and
              take the card's height with it. */}
          {(() => {
            const answered = !!captured?.trim();
            const shown = keystrokeSentence(captured?.trim() ?? '');
            const n = clampRepeat(repeat);
            // Middot before the burst for the same reason the click dialog uses one: the value in
            // front of it can contain punctuation of its own.
            const times = n > 1 ? ` · ${n}×, ${formatMs(clampDelay(repeatDelay), language)} ms apart` : '';
            const messages = [
              'Press a key or combo, or type one manually.',
              `Presses ${shown}${times}.`,
              // Says the STRIPPED key, because that is what a hold sends — the warning band above
              // explains why, and these two must never disagree about which key is held.
              `Holds ${keystrokeSentence(heldKey)} for ${formatMs(clampHold(holdMs), language)} ms.`,
            ];
            const active = !answered ? 0 : mode === 'hold' ? 2 : 1;
            return (
              <div
                className="border-l-2 rounded px-2.5 py-2 text-caption leading-relaxed grid"
                style={calloutStyle('neutral', answered ? 'var(--color-action-key-fg)' : undefined)}
              >
                {/* The key arrives from the native hook, not from anything the focus is on, so this
                    is where a screen reader hears it — on the state change only (a key typed into
                    the manual field is already heard there, so it is not part of the trigger). */}
                <AnnounceOnChange when={`${active}|${manualEntry ? '' : (captured ?? '')}`} text={messages[active]} />
                {messages.map((m, i) => (
                  <span
                    key={i}
                    style={{ gridArea: '1 / 1' }}
                    className={`truncate ${i === active ? '' : 'invisible'}`}
                    aria-hidden={i !== active}
                  >
                    {m}
                  </span>
                ))}
              </div>
            );
          })()}
        </div>
    </DialogShell>
  );
}
