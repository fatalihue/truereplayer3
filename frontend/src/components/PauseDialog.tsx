import { useState, useRef, useEffect, useId } from 'react';
import { Hourglass } from 'lucide-react';
import { NumberInput } from './common/NumberInput';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { KeyCaps } from './common/KeyCaps';
import { DurationChips, TIMEOUT_PRESETS } from './common/DurationChips';
import { calloutStyle } from './common/Callout';
import { useKeyCapture, keepRealCombo } from '../logic/useKeyCapture';
import { useLanguage } from '../state/LanguageContext';
import { useWindowFocused } from '../hooks/useWindowFocused';
import { formatMs } from '../utils/displayUtils';
import { AnnounceOnChange } from './common/AnnounceOnChange';
import { splitCombo } from './common/KbdTag';
import { compactKey } from '../utils/keyNames';

interface PauseDialogProps {
  /**
   * Edit-mode seeds. When ANY initial* is passed the dialog opens in edit mode:
   * capture pad pre-filled with the existing resume hotkey, timeout pre-filled,
   * the primary button reads "Save", and Esc closes (instead of re-arming).
   * `initialKey === undefined` ⇒ insert mode (the toolbar mount passes nothing).
   * An empty-string initialKey is a valid edit seed (a timeout-only Pause).
   */
  initialKey?: string;
  initialTimeoutMs?: number;
  // Resolves with the resume hotkey ('' = none) and the timeout in MILLISECONDS
  // (0 = no timeout). The caller decides whether that's an insert or an edit.
  onConfirm: (key: string, timeoutMs: number) => void;
  onClose: () => void;
}

/**
 * Insert / Edit Pause dialog. Reformulated to mirror the Send Keystroke
 * (KeystrokeCaptureDialog) layout: a big capture pad that grabs the resume
 * hotkey the instant a key is pressed — no click-to-focus-then-press dance — plus
 * a timeout section below. The pad is the headline because "wait until I press X"
 * is the most expressive Pause; the timeout covers "wait N then continue".
 *
 * Both fields are optional, with one rule: at least one must be set (a Pause with
 * neither a hotkey nor a timeout is silently skipped at replay, so Add/Save stays
 * disabled until one is configured).
 *
 *   • Hotkey only          — wait until the captured key is pressed
 *   • Timeout only         — wait N ms then continue
 *   • Both                 — whichever fires first resumes; the engine cancels the other
 *
 * Capture goes through the backend low-level hook (hotkey:capture / hotkey:captured)
 * because the WebView2 JS layer never sees Win+letter combos — the Windows Shell
 * eats them at OS level. The hook stays armed for the dialog's lifetime and is
 * suspended only while a numeric input is focused (so typing "5000" into the
 * timeout doesn't get re-captured as the "5"/"0" keys). Mirrors the exact wiring
 * KeystrokeCaptureDialog uses.
 */

/** Timeout is shown/edited in ms (matches the grid + Send Keystroke's ms knobs). The chips are
 *  the app-wide ladder plus the ∞ MODE chip — see TIMEOUT_PRESETS in common/DurationChips.
 *  ∞ (ms=0) pairs with a captured hotkey to form a "wait forever until X is pressed" Pause. */

/** Coarser steps once we're in whole-second territory; 100 ms below 1 s. */
const stepFor = (ms: number) => (ms >= 1000 ? 1000 : 100);

// The Pause timeout ceiling, 24 h — mirrors MaxPauseTimeoutMs in WebViewBridge.cs. Without it the
// field took any number, and past Int32 the backend's parse threw after this dialog had already
// closed: Add inserted nothing and Save kept the old value, both without a word.
const MAX_PAUSE_TIMEOUT_MS = 86_400_000;

export function PauseDialog({ initialKey, initialTimeoutMs, onConfirm, onClose }: PauseDialogProps) {
  const { language } = useLanguage();
  const isEditing = initialKey !== undefined;
  // Caption → field tie: a click on "Timeout" lands in the field (and pauses capture with it).
  const timeoutId = useId();

  // Captured resume hotkey. null = none configured (empty pad). Seed from the
  // edited row; an empty initialKey collapses to null so the pad shows its prompt.
  const [captured, setCaptured] = useState<string | null>(initialKey ? initialKey : null);
  // Timeout in ms. Default 1 s for inserts (the common "small sync pause"); seeded
  // from the row on edit. 0 = no timeout (resume by hotkey only).
  const [timeoutMs, setTimeoutMs] = useState<number>(initialTimeoutMs ?? 1000);

  // Stable refcount slot ID — generated once per mount so enable/disable hit the
  // same backend HashSet entry (see InputHookManager.RegisterCapture). Keeps a
  // sibling capture consumer from stomping this dialog's slot on cleanup.
  const ownerIdRef = useRef(`pause-dialog-${crypto.randomUUID()}`);
  const keyCapture = useKeyCapture();
  // Display-only — the capture gate itself lives in InputHookManager.CaptureHotkeyMode.
  const windowFocused = useWindowFocused();

  // Re-sync when reopening the dialog on a different row (parent toggles mount
  // via `{editState && <Dialog />}` but React may reuse the instance at the same
  // JSX position). Without this, a second Edit click could open with stale values.
  // Mirrors the exact seed→state mapping the useState initializers use above.
  useEffect(() => {
    setCaptured(initialKey ? initialKey : null);
    setTimeoutMs(initialTimeoutMs ?? 1000);
  }, [initialKey, initialTimeoutMs]);

  // (Esc focus handling moved into DialogShell — it focuses the card on mount.)

  // Capture wiring — identical pattern to KeystrokeCaptureDialog. Hook on for the
  // dialog's lifetime; suspended while a numeric input is focused so typing into
  // the timeout doesn't re-capture digits as the resume key.
  useEffect(() => {
    // Read the ref ONCE here rather than in the cleanup — see KeystrokeCaptureDialog.
    const ownerId = ownerIdRef.current;
    keyCapture.arm(ownerId);

    // Addressed to the most recently registered capture owner — another consumer that armed
    // after this dialog gets the key, not this one (RemapSection filters the same way).
    const unsub = keyCapture.listen(ownerId, (combo) => {
      // Don't clobber an already-captured combo with a bare modifier press — the
      // user is likely holding modifiers while reaching for the next real key.
      setCaptured((prev) => keepRealCombo(prev, combo));
    });

    const handleFocusIn = (e: FocusEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') {
        keyCapture.release(ownerId);
      }
    };
    const handleFocusOut = (e: FocusEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') {
        keyCapture.arm(ownerId);
      }
    };
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      keyCapture.release(ownerId);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      unsub();
    };
  }, [keyCapture]);

  const canConfirm = !!captured || timeoutMs > 0;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm((captured ?? '').trim(), Math.min(MAX_PAUSE_TIMEOUT_MS, Math.max(0, timeoutMs)));
  };

  // Timeout for the mode hint — always milliseconds, consistent with the grid and
  // the ms NumberInput above (was "X second(s)" for clean multiples).
  const timeoutLabel = `${formatMs(timeoutMs, language)} ms`;

  return (
    <DialogShell
      icon={<Hourglass size={14} style={{ color: 'var(--color-action-pause-fg)' }} />}
      title={isEditing ? 'Edit pause' : 'Insert pause'}
      onClose={onClose}
      // Capture dialog: a stray click outside must not discard a configured
      // hotkey/timeout — dismissal is Esc or Cancel only.
      closeOnBackdrop={false}
      // Truthful per state — never advertises Enter while the hook is armed
      // (outside input focus, Enter would be CAPTURED as the resume key).
      footerHint={captured
        ? 'Press another key to replace'
        : ''}
      footer={<DialogFooter secondary={{ label: 'Cancel', onClick: onClose }} primary={{ label: isEditing ? 'Save pause' : 'Add pause', onClick: handleConfirm, disabled: !canConfirm }} />}
      onCardKeyDown={(e) => {
        // Enter confirms ONLY while a numeric input is focused (in that state the
        // backend capture is suspended, so Enter isn't doubling as a captured
        // key). Outside input focus the backend hook grabs Enter as the bound key
        // and forwards it via hotkey:captured — so no confirm here. Esc is owned
        // by DialogShell.
        // The EVENT TARGET, not document.activeElement: NumberInput blurs itself on Enter (to
        // commit) before this card handler runs, so the focus is already on <body> here and the
        // old check never saw an input — Enter in Timeout did not confirm.
        if (e.key === 'Enter') {
          const focusedTag = (e.target as HTMLElement | null)?.tagName;
          if (focusedTag === 'INPUT' && canConfirm) {
            e.preventDefault();
            e.stopPropagation();
            handleConfirm();
          }
        }
      }}
    >
        <div className="px-5 py-5 flex flex-col gap-4">
          {/* Resume hotkey — press any key/combo to set it directly. Optional:
              leaving it empty makes a timeout-only Pause (the strip below says so). */}
          <div className="flex flex-col gap-1.5">
            <span className="label-micro text-text-tertiary">Resume hotkey</span>
            <div
              className="bg-bg-input border border-dashed rounded py-5 px-4 text-center min-h-[140px] flex flex-col justify-center transition-colors"
              style={{
                borderColor: 'color-mix(in srgb, var(--color-action-pause-fg) 40%, transparent)',
                ...(captured ? { background: 'color-mix(in srgb, var(--color-action-pause-fg) 4%, var(--color-bg-input))' } : null),
              }}
            >
              {captured === null ? (
                <>
                  {/* The hook only captures while TrueReplayer is the FOREGROUND app, so the pad
                      must not promise "press any key" while the user is in another window —
                      it would be inviting a press that (correctly) goes to that other app. */}
                  <div className="text-minor text-text-secondary mb-1">
                    {windowFocused
                      ? 'Press any key — optional'
                      : 'Click TrueReplayer to capture keys'}
                  </div>
                  <div className="text-caption font-mono text-text-tertiary">F8 · Esc · Ctrl+R</div>
                </>
              ) : (
                <>
                  <KeyCaps combo={captured} fg="var(--color-action-pause-fg)" />
                  <button
                    type="button"
                    onClick={() => setCaptured(null)}
                    // min-h-6: the 24 px target floor. The pad's min-h-[140px] still holds its
                    // height with the taller button in it, so nothing moves on capture.
                    className="self-center mt-2.5 min-h-6 text-caption text-text-tertiary hover:text-text-secondary underline underline-offset-2"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Timeout — label + field on ONE row (Send Keystroke's row style),
              presets below. 0 (the ∞ preset) means "no timeout"; the Pause then
              resumes only via the captured hotkey above. */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={timeoutId} className="text-minor font-medium text-text-secondary">Timeout</label>
              <NumberInput
                id={timeoutId}
                value={timeoutMs}
                onChange={setTimeoutMs}
                min={0}
                max={MAX_PAUSE_TIMEOUT_MS}
                step={stepFor(timeoutMs)}
                thousands
                inputWidth="w-24"
                inputHeight="h-8"
                suffix="ms" suffixInside
                ariaLabel="Pause timeout in milliseconds"
              />
            </div>
            {/* No infinityTip: the row spells out "No timeout" in words, and the strip below
                states the resulting behaviour in full — a tooltip repeating either would be a
                third copy of the same sentence. */}
            <DurationChips
              presets={TIMEOUT_PRESETS}
              value={timeoutMs}
              onSelect={setTimeoutMs}
            />
          </div>

          {/* Live-semantics strip — merges the two orthogonal inputs into one
              sentence (the DataPanel RUN-card recipe). The no-hotkey-no-timeout
              case is a config error (the engine skips such a Pause) → recording
              tone, and Add/Save stays disabled. */}
          {(() => {
            // The shared callout recipe. The broken state takes the 'error' TONE — red rail,
            // recording-fg ink — rather than painting the raw recording hue as the text colour,
            // which is what the hand-written style here used to do.
            const style = canConfirm
              ? calloutStyle('neutral', 'var(--color-action-pause-fg)')
              : calloutStyle('error');
            // All four sentences are ALWAYS rendered, stacked in one grid cell with only the
            // live one visible, so the strip is as tall as its tallest message in every state
            // and the dialog never changes height. The warning wraps to two lines where
            // "Waits 1.000 ms then continues." takes one — measured at an 18 px jump, which
            // re-centres the whole dialog under the user's cursor mid-edit.
            // Reserved BY CONSTRUCTION, not by a min-height estimate: add or reword a message
            // and the reserve follows on its own, in whichever language is active. Same
            // gridArea overlay the Send Keystroke dialog uses for its Press/Hold bodies, and
            // the same doctrine as common/FieldError.
            const messages = [
              'Resumes on the hotkey or after the timeout — whichever comes first.',
              'Waits until the hotkey is pressed.',
              `Waits ${timeoutLabel} then continues.`,
              'No hotkey and no timeout — this Pause is skipped.',
            ];
            const active = captured && timeoutMs > 0 ? 0 : captured ? 1 : timeoutMs > 0 ? 2 : 3;
            return (
              <div
                className="border rounded px-2.5 py-2 text-caption leading-relaxed grid"
                style={style}
              >
                {/* A capture from the hook and the "skipped" refusal change this sentence without
                    the focus moving, so they are announced — on the state change only, not on
                    every digit typed into Timeout (see AnnounceOnChange). */}
                {/* The spoken line names the key (keycap spelling): the visible sentence does not,
                    so replacing F8 by F9 changed the trigger but not the words, and nothing was read. */}
                <AnnounceOnChange
                  when={`${active}|${captured ?? ''}`}
                  text={captured && active <= 1
                    ? `${messages[active]} Hotkey: ${splitCombo(captured.replace(/\bVK_93\b/, 'Menu')).map(compactKey).join(' + ')}.`
                    : messages[active]}
                />
                {messages.map((m, i) => (
                  <span
                    key={i}
                    style={{ gridArea: '1 / 1' }}
                    className={i === active ? undefined : 'invisible'}
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
