import { useState, useEffect, useId, useRef } from 'react';
import { Download } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { Button } from './common/Button';

type Phase =
  | { step: 'hidden' }
  | { step: 'available'; version: string; currentVersion: string; notes: string[] }
  | { step: 'downloading'; percent: number; version: string; currentVersion: string }
  | { step: 'installing'; version: string; currentVersion: string }
  | { step: 'complete'; version: string; currentVersion: string };

// Master switch for the user-facing update overlay.
//   true  → splash visible throughout the auto-update flow (checking → downloading →
//           installing → complete), matching mockup/update-splash.html. When the backend
//           has AutoApplyUpdates on (current default), the "available" gate is skipped:
//           the overlay transitions straight to downloading without a confirmation button.
//   false → component stays mounted but renders nothing; backend silently downloads +
//           applies + restarts with no feedback.
const UPDATE_OVERLAY_ENABLED = true;

/**
 * The update splash. It is the first thing a user sees after every release, and until the
 * 2026-09-04 sweep it was the one surface entirely outside the design system: 396 characters
 * of inline style on the card, a 14 px radius on a 4/6/8/12 scale, a gradient button, and
 * keyframes injected by a <style> tag that ignored the animations toggle. Same layout as
 * before — icon, title, the two version tiles, what's new, one wide button — now on the
 * dialog tokens (--radius-dialog, --shadow-dialog, the app's Button) with every motion gated
 * in index.css like the dialogs' own.
 */
export function UpdateOverlay() {
  const { send, subscribe } = useBridge();
  const [phase, setPhase] = useState<Phase>({ step: 'hidden' });

  useEffect(() => {
    return subscribe((msg) => {
      // When disabled, swallow every update event so the overlay never appears.
      // The backend will trigger download + apply automatically.
      if (!UPDATE_OVERLAY_ENABLED) return;

      switch (msg.type) {
        case 'update:checking':
          // Non-blocking by design. The startup update check runs in the background, so the
          // app must be visible and usable immediately — a slow or unreachable release server
          // used to trap the user behind a full-screen blur before they could even see the UI.
          // We show NOTHING during checking; the overlay appears only once an update is actually
          // being downloaded/installed (or offered, in manual-gate mode). Manual "Check for
          // Updates" still gets feedback from the Settings panel's own button state.
          break;
        case 'update:available':
          // In silent (auto-apply) mode, skip the gate and transition straight into the
          // downloading splash — the backend has already kicked off HandleUpdateApply.
          // Without this, the user would see the "Download and install" button briefly and
          // then the splash would jump as the download started without their click.
          setPhase((prev) => {
            // Never walk the flow BACKWARDS. The overlay renders nothing during 'checking'
            // by design, so the Settings panel's "Check for Updates" button stays clickable
            // while the startup check is still in flight. Click it there and a second check
            // runs in parallel; both find the same new version and both send update:available.
            // This handler used to apply unconditionally, so the late one reset a splash that
            // had already reached 'installing' or 'complete' back to "downloading, 0%" —
            // with the process about to restart. _updateInProgress on the backend stops the
            // second DOWNLOAD; nothing stopped the second message.
            if (prev.step === 'downloading' || prev.step === 'installing' || prev.step === 'complete') {
              return prev;
            }
            if (msg.payload.autoApply) {
              return {
                step: 'downloading',
                percent: 0,
                version: msg.payload.version,
                currentVersion: msg.payload.currentVersion,
              };
            }
            return {
              step: 'available',
              version: msg.payload.version,
              currentVersion: msg.payload.currentVersion,
              notes: msg.payload.notes ?? [],
            };
          });
          break;
        case 'update:progress':
          setPhase((prev) => {
            if (prev.step === 'downloading') {
              // Clamp to [0,100]: a malformed/out-of-range backend percent would otherwise
              // overflow the progress-bar width and could spuriously trip the >=100 install gate.
              const percent = Math.max(0, Math.min(100, msg.payload.percent));
              return { ...prev, percent };
            }
            return prev;
          });
          break;
        case 'update:ready':
          setPhase((prev) => {
            if (prev.step === 'downloading' || prev.step === 'installing') {
              return { step: 'complete', version: prev.version, currentVersion: prev.currentVersion };
            }
            return prev;
          });
          break;
        case 'update:none':
          // No update: hide the splash — unless one is already being downloaded or installed.
          // update:none only ever answers a CHECK, and a check can overlap an apply (the backend
          // now runs one check at a time and none during an apply, and this is the other half):
          // a second check timing out answered "none" mid-download, the splash vanished, and the
          // install carried on underneath until the process simply restarted.
          setPhase((prev) => (prev.step === 'downloading' || prev.step === 'installing' || prev.step === 'complete' ? prev : { step: 'hidden' }));
          break;
        case 'update:error':
          // Failure: hide the splash, in EVERY phase. Unlike update:none this is also how the
          // apply itself says it failed (download failed, apply threw, postponed at the last
          // gate), so it must be able to take down a splash mid-download. Errors fall back to
          // silent so the user can keep using the app — they'll get the update on the next check.
          setPhase({ step: 'hidden' });
          break;
      }
    });
  }, [subscribe]);

  // Transition to installing when download reaches 100%
  useEffect(() => {
    if (phase.step === 'downloading' && phase.percent >= 100) {
      const timer = setTimeout(() => {
        setPhase({ step: 'installing', version: phase.version, currentVersion: phase.currentVersion });
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  // The splash is a modal: it covers the whole app, so it owns the keyboard while it is up. The
  // card carries role="dialog" aria-modal — which is also what isModalDialogOpen() reads, so
  // Ctrl+K and the grid shortcuts stand down under it (Ctrl+K used to open the palette invisibly
  // BELOW the splash, with the focus and Enter in it). Only while shown: hidden renders nothing.
  //
  // Focus: the CARD, in every phase, so keys never land on the app behind — never the button. The
  // 'available' splash is often UNASKED: the backend raises it on its own when a run or recording
  // ends with unsaved work (MaybeResumeDeferredUpdate) and from the startup check. Focused, the
  // button took the Enter/Space the user was already typing: one key started update:apply, whose
  // native "Save before updating?" defaults to Save, and a second one saved, installed and
  // restarted. One Tab from the card reaches the button. Re-run per phase — a focused control can
  // unmount when the download starts. Whatever had the focus before the splash gets it back if
  // the splash goes away again (update:none / update:error).
  const cardRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const visible = phase.step !== 'hidden';
  useEffect(() => {
    if (visible) {
      const was = document.activeElement;
      returnFocusRef.current = was instanceof HTMLElement && was !== document.body ? was : null;
      return;
    }
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    if (back?.isConnected && (!document.activeElement || document.activeElement === document.body)) back.focus();
  }, [visible]);
  useEffect(() => {
    if (phase.step === 'hidden') return;
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) card.focus();
  }, [phase.step]);
  const titleId = useId();
  const subtitleId = useId();

  if (phase.step === 'hidden') return null;

  const handleAccept = () => {
    if (phase.step !== 'available') return;
    setPhase({
      step: 'downloading',
      percent: 0,
      version: phase.version,
      currentVersion: phase.currentVersion,
    });
    send({ type: 'update:apply', payload: {} });
  };

  // After the 'hidden' early-return above, every remaining phase carries version metadata.
  const version = phase.version;
  const currentVersion = phase.currentVersion;
  const isComplete = phase.step === 'complete';
  const isInstalling = phase.step === 'installing';

  return (
    <div className="fixed inset-0 z-(--z-topmost) flex items-center justify-center">
      {/* Backdrop — the app's strong scrim token plus a blur, the same smoke the dialogs use.
          A press on it must not pull the focus out of the card onto <body> (DialogShell's rule). */}
      <div
        className="absolute inset-0 backdrop-blur-xl update-fade-in"
        style={{ background: 'var(--color-scrim-strong)' }}
        onMouseDown={(e) => e.preventDefault()}
      />

      {/* Card — the modal (see the focus effect above). Tab stays inside: there is at most one
          control, and with none the card itself holds the focus. No Esc: the splash has no
          dismiss — an apply that stops for any reason takes it down with update:error. */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          e.preventDefault();
          const card = cardRef.current;
          (card?.querySelector<HTMLElement>('button') ?? card)?.focus();
        }}
        className="relative w-[88%] max-w-[420px] rounded-dialog border border-border-default bg-bg-elevated shadow-dialog px-7 pt-7 pb-6 update-card-in"
      >
        {/* App icon */}
        <div className="relative w-14 h-14 mx-auto mb-3.5">
          <img
            src="app-icon.png"
            alt="TrueReplayer"
            className={`block w-14 h-14 rounded-[14px] object-cover shadow-overlay ${isComplete ? '' : 'update-logo-pulse'}`}
          />
          {isComplete && (
            <div className="absolute -bottom-0.5 -right-0.5 w-[22px] h-[22px] rounded-full bg-replay border-2 border-bg-elevated flex items-center justify-center">
              {/* replay is a user-chosen hue: the tick takes the ink pickInk derived for that
                  fill (--color-replay-ink), never a fixed white. */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <polyline
                  points="6 12 10 16 18 8"
                  stroke="var(--color-replay-ink)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="update-checkmark"
                />
              </svg>
            </div>
          )}
        </div>

        {/* Title + subtitle — one polite live region, so each phase (downloading → updating →
            done) is spoken as it lands; the percent below is left out of it on purpose. */}
        <div aria-live="polite" aria-atomic="true">
          <div id={titleId} className={`text-center text-[17px] font-semibold font-display tracking-tight mb-1 ${isComplete || isInstalling ? 'text-[color:var(--color-replay-fg)]' : 'text-text-primary'}`}>
            {phase.step === 'available' && 'Update available'}
            {phase.step === 'downloading' && 'Downloading update'}
            {phase.step === 'installing' && `Updating to v${version}`}
            {phase.step === 'complete' && 'Updated successfully!'}
          </div>
          <div id={subtitleId} className="text-center text-[11px] text-text-tertiary mb-[18px]">
            {phase.step === 'available' && 'A new version of TrueReplayer is ready'}
            {phase.step === 'downloading' && 'Do not close the app'}
            {phase.step === 'installing' && 'Closing TrueReplayer…'}
            {phase.step === 'complete' && 'You are now on the latest version'}
          </div>
        </div>

        {/* Version tiles (current ➜ new), or a single tile on the 'complete' phase. */}
        <div className="flex items-center justify-center gap-2.5 mb-4">
          {isComplete ? (
            <VersionTile label="Current version" value={version} accent className="min-w-[120px]" />
          ) : (
            <>
              <VersionTile label="Current version" value={currentVersion} />
              <span className="text-accent text-sm" aria-hidden="true">&#10132;</span>
              <VersionTile label="New version" value={version} accent />
            </>
          )}
        </div>

        {/* Changelog — only on 'available' phase (full list before the user decides) */}
        {phase.step === 'available' && phase.notes.length > 0 && (
          <div className="mb-[18px]">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-secondary mb-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent" aria-hidden="true" />
              What's new
            </div>
            <ul className="list-none p-0 m-0">
              {phase.notes.slice(0, 6).map((note, i) => (
                <li
                  key={i}
                  className="relative pl-4 py-0.5 text-xs leading-snug text-text-secondary before:content-[''] before:absolute before:left-1 before:top-[9px] before:w-1 before:h-1 before:rounded-full before:bg-text-disabled"
                >
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}
        {phase.step === 'complete' && <div className="h-3" />}

        {/* Progress bar (downloading / installing).
            Downloading shows the real percent. Installing pins the bar at 100 % and
            pulses (update-install-pulse) while the apply runs. */}
        {(phase.step === 'downloading' || phase.step === 'installing') && (
          <>
            <div className="mb-3">
              <div
                role="progressbar"
                aria-label="Update progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={phase.step === 'downloading' ? phase.percent : 100}
                className="w-full h-1.5 rounded-full overflow-hidden bg-[color-mix(in_srgb,var(--color-text-primary)_12%,transparent)]"
              >
                <div
                  className={`h-full rounded-full bg-accent-solid transition-[width] duration-300 ${phase.step === 'installing' ? 'update-install-pulse' : ''}`}
                  style={{ width: phase.step === 'downloading' ? `${phase.percent}%` : '100%' }}
                />
              </div>
              {phase.step === 'downloading' && (
                <div className="flex justify-between mt-1.5 text-[11px] text-text-tertiary tabular-nums">
                  <span>Downloading…</span>
                  <span className="text-accent font-semibold">{phase.percent}%</span>
                </div>
              )}
            </div>
            {phase.step === 'installing' && (
              <>
                <div className="text-center text-xs text-text-tertiary mt-1">Applying update, please wait…</div>
                <div className="text-center text-[11px] text-text-tertiary mt-3.5">The app will restart automatically</div>
              </>
            )}
          </>
        )}

        {/* Button — only on the "available" phase */}
        {phase.step === 'available' && (
          <Button variant="primary" size="md" className="w-full" onClick={handleAccept}>
            <Download size={14} />
            Download and install
          </Button>
        )}
      </div>
    </div>
  );
}

// One version tile: micro-label over the number. `accent` marks the NEW version (and the single
// tile on the complete phase) with the accent tint every "lit" chip in the app uses.
function VersionTile({ label, value, accent = false, className = '' }: { label: string; value: string; accent?: boolean; className?: string }) {
  return (
    <div
      className={`flex flex-col items-center rounded-overlay px-3.5 py-2 min-w-20 border ${
        accent
          ? 'bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]'
          : 'bg-bg-card border-border-subtle'
      } ${className}`}
    >
      <div className={`label-micro mb-0.5 ${accent ? 'text-accent' : 'text-text-tertiary'}`}>{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${accent ? 'text-accent' : 'text-text-secondary'}`}>v{value}</div>
    </div>
  );
}
