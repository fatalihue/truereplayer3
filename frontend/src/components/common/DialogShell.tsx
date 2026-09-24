import { useEffect, useId, useRef, useState, type ReactNode, type KeyboardEvent, type MouseEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { DialogLayerContext } from './dialogLayer';

/**
 * Shared chrome for the modal-dialog family — the scrim + card + header/footer
 * skeleton that PauseDialog/SendTextDialog/etc. each hand-rolled (five nearly
 * identical copies, per the 2026-07 audit), now with:
 *
 *   • dialog semantics (role=dialog aria-modal aria-label) — there were none
 *   • symmetric motion: cards animate IN on mount and OUT on dismissal.
 *     Dismissals (Esc / backdrop / an explicit close affordance calling
 *     requestClose) play the exit animation; CONFIRM paths should keep calling
 *     onClose directly — completing an action is user-initiated "done", which
 *     renders instantly by design (same doctrine as the command palette).
 *   • one Escape implementation (preventDefault + stopPropagation, matching the
 *     careful layering the sheet established).
 *
 * Enter-key behavior stays per-dialog via onCardKeyDown — the capture dialogs
 * (Pause / Keystroke) have Enter semantics tied to the low-level hook that a
 * shared shell must not own.
 */

/**
 * The one size for the app's four full-window panels — Automation, Insert Text, Data Loop and
 * the Theme Editor. They used to be 880/1080/1080/920 px wide with heights of 82vh, 90vh, 90vh
 * and a hardcoded 560px body, so four windows that do the same kind of job opened at four
 * different sizes and all of them left scrim showing.
 *
 * 90 % of the window on BOTH axes. Divided by --ui-zoom because `zoom` on <html> scales what it
 * paints while viewport units keep resolving against the UNZOOMED viewport: a plain `90vh`
 * paints at 90 % x zoom, which is 81 % of the window at the default 90 % zoom and a clipped
 * 180 % at the 200 % the Theme Editor lets the user pick. Dividing cancels the zoom exactly, so
 * this reads 90 % at every setting (verified 50 / 80 / 95 / 130 / 200 %).
 *
 * Pair it with PANEL_MAX_WIDTH: the shell's default max-width clamp is itself in raw vw, so it
 * would claw back the width this just gained.
 *
 * Panels using this must give their body `flex-1 min-h-0` — the card is `flex flex-col` and
 * children are direct flex items, so a body with an intrinsic height ignores the extra space.
 */
export const PANEL_SIZE = 'w-[calc(90vw/var(--ui-zoom))] h-[calc(90vh/var(--ui-zoom))]';

/** No clamp: PANEL_SIZE already leaves a 5 % gutter per side and is the single source of truth. */
export const PANEL_MAX_WIDTH = 'max-w-none';

/**
 * The five widths a dialog can have. The 2026-09-04 sweep measured ten (340, 380, 400, 440,
 * 460, 480, 520, 560, 640, 720 px and the 90 % panel), one per dialog, each written as a
 * `w-[…px]` at the call site, so nothing in a width said whether it was a prompt or a tool.
 *
 *   sm   360   prompts — Rename, Delete, Assign Hotkey / Hotstring, Input needed, discard prompts
 *   md   440   editors — Keystroke, Pause, Run Profile, Open URL, Window Target, Export
 *   lg   560   readers — Profile Info, Import complete, the security warning
 *   xl   720   reviews — Import Profiles, Run report
 *   full  90 % of the window (PANEL_SIZE) — Automation, Insert Text, Data Loop, Theme Editor
 *   auto  content-sized — only the image cropper, whose width is the image
 */
export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full' | 'auto';

const SIZE_CLASSES: Record<DialogSize, string> = {
  sm: 'w-[360px]',
  md: 'w-[440px]',
  lg: 'w-[560px]',
  xl: 'w-[720px]',
  full: PANEL_SIZE,
  auto: 'w-auto',
};

/** One footer action — label, handler, and the two things a footer button ever varies by. */
export interface FooterAction {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Portal tooltip on the button — also shown while disabled (index.css keeps pointer-events
   *  on [data-tip][disabled]) so a blocked primary can say WHY it is blocked. */
  tip?: string;
  autoFocus?: boolean;
  className?: string;
}

/**
 * THE footer of a dialog: secondary (Cancel / Close) then primary, right-aligned, both 32 px
 * with an 84 px minimum so a Cancel / OK pair reads as a pair. `extra` slots a third button
 * between them (a discard prompt's "Discard"), `danger` paints the primary red for the dialogs
 * whose primary action destroys something (Delete Profile, Clear table). The tertiary
 * left-anchored action (Remove, Reset) is not here — it is the shell's `footerStart` slot, so
 * the two never fight over the left edge with the hint text.
 *
 * Seven footer recipes across seventeen dialogs collapsed into this (2026-09-04 sweep).
 */
export function DialogFooter({ secondary, extra, primary, danger = false }: {
  secondary?: FooterAction;
  extra?: ReactNode;
  primary?: FooterAction;
  danger?: boolean;
}) {
  return (
    <>
      {secondary && (
        <Button variant="secondary" size="md" className={`min-w-[84px] ${secondary.className ?? ''}`} onClick={secondary.onClick} disabled={secondary.disabled} data-tip={secondary.tip} autoFocus={secondary.autoFocus}>
          {secondary.label}
        </Button>
      )}
      {extra}
      {primary && (
        <Button variant={danger ? 'destructive' : 'primary'} size="md" className={`min-w-[84px] ${primary.className ?? ''}`} onClick={primary.onClick} disabled={primary.disabled} data-tip={primary.tip} autoFocus={primary.autoFocus}>
          {primary.label}
        </Button>
      )}
    </>
  );
}

export interface DialogShellProps {
  /** Icon rendered before the title (usually the action's Lucide icon, size 14). */
  icon?: ReactNode;
  title: string;
  /** Muted 11 px note on the title's baseline — WHICH thing the dialog edits ("Action #3"),
   *  the pairing the sheet header uses. Not part of the headline and not the aria-label. */
  titleMeta?: ReactNode;
  /** Width on the five-step scale above. Default md (440). */
  size?: DialogSize;
  /** Extra classes on the card — height caps. **Divide every viewport unit by `--ui-zoom`**:
   *  `max-h-[calc(90vh/var(--ui-zoom))]`, never a raw `90vh`. `zoom` on <html> scales what is
   *  PAINTED while `vh` keeps resolving against the unzoomed viewport, so a raw 90vh paints as
   *  ~104vh at 115 % and the footer lands below the window edge. This example used to be the raw
   *  form, which is where the copies of the bug kept coming from. */
  cardClassName?: string;
  /** Stacking layer. Default z-50; a dialog opened from INSIDE another layer (the sheet is
   *  z-70, the Insert Text shell z-50) passes a higher one so it paints above its opener.
   *  A dialog opened from OUTSIDE every stack — a tray push, the palette, a run's Ask-Input —
   *  can land over an open Sheet, so it passes z-[80] (its own prompts z-[90]; Ask-Input z-[90]). */
  zClass?: string;
  /** Left-anchored tertiary action in the footer (Remove, Reset ▾). Replaces the hint text
   *  when present — the two share the left edge and never both appear. */
  footerStart?: ReactNode;
  /** Tailwind max-width clamp for the card. Default preserves the historical 90vw
   *  clamp; space-hungry dialogs (Insert Text) pass a tighter-gutter clamp like
   *  'max-w-[calc(100vw-24px)]' to use the whole window at the minimum app size. */
  maxWidthClass?: string;
  /** Called after the exit animation completes (or immediately when animations are off). */
  onClose: () => void;
  /** Veto a dismissal BEFORE the exit animation starts. Return false to abort — nothing
   *  visual happens and the dialog stays put. Use it for "you have unsaved changes"
   *  prompts: intercepting `onClose` instead does NOT work, because by the time onClose
   *  runs the shell has already committed to leaving (`leaving=true` applies the fade-out
   *  and a 400 ms fallback timer), so a callback that declines to close leaves the dialog
   *  faded out but still mounted — an invisible modal that traps the whole app. */
  canClose?: () => boolean;
  /** Dismiss when the scrim is clicked. Default true; capture dialogs pass false. */
  closeOnBackdrop?: boolean;
  /** Render an X close button in the header (wired to the shell's own requestClose,
   *  so it plays the exit animation). Off by default — most dialogs close via footer. */
  showClose?: boolean;
  /** Veto a backdrop-click close. Called with the scrim click event; return true to
   *  IGNORE the click (e.g. clicks in the OS title-bar guard zone: (e)=>e.clientY<40).
   *  Only consulted when closeOnBackdrop is on. */
  scrimMouseDownGuard?: (e: MouseEvent<HTMLDivElement>) => boolean;
  /** Left-aligned hint text in the footer (e.g. "Enter to confirm · Esc to cancel"). */
  footerHint?: ReactNode;
  /** Right-aligned footer actions (Button components). Omit for footerless dialogs.
   *  Function form receives requestClose so a Cancel button can play the exit
   *  animation instead of unmounting instantly via onClose. */
  footer?: ReactNode | ((requestClose: () => void) => ReactNode);
  /** Extra keydown handling on the card (Enter rules etc.). Esc is already handled. */
  onCardKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

// What the focus trap cycles through.
const TABBABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

export function DialogShell({
  icon,
  title,
  titleMeta,
  size = 'md',
  cardClassName = '',
  zClass = 'z-50',
  footerStart,
  maxWidthClass,
  onClose,
  canClose,
  closeOnBackdrop = true,
  showClose = false,
  scrimMouseDownGuard,
  footerHint,
  footer,
  onCardKeyDown,
  children,
}: DialogShellProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  // This shell's id for the layers its content floats over it — see dialogLayer.ts.
  const layerId = useId();
  const [leaving, setLeaving] = useState(false);
  // Width: the size step. The full panel size must not be clawed back by the default 90vw
  // clamp (see PANEL_MAX_WIDTH).
  const widthClasses = SIZE_CLASSES[size];
  const maxWidthClasses = maxWidthClass ?? (size === 'full' ? PANEL_MAX_WIDTH : 'max-w-[calc(100vw-24px)]');
  // Where the last mousedown landed — a drag that merely ENDS on the scrim
  // (text selection pulled outside the card) must not count as a backdrop click.
  const pressOnScrim = useRef(false);

  // Focus the card so Esc works without a click first (the convention every
  // hand-rolled dialog already followed).
  useEffect(() => {
    // Take focus only when nothing inside the card has it already: a dialog that focuses its own
    // input (autoFocus, or a parent layout effect — the ProfilePanel dialogs do this) must not be
    // robbed of it by the trap's initial focus. Layout effects run before this passive one, so
    // the parent's focus lands first and this check sees it.
    const card = cardRef.current;
    if (card && !card.contains(document.activeElement)) card.focus();
  }, []);

  // Exit fallback — animationend never fires if the window is occluded/minimized
  // (Chromium pauses CSS animations) or data-animations flips mid-flight; without
  // this the dialog would strand in the leaving state.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onClose, 400);
    return () => clearTimeout(t);
  }, [leaving, onClose]);

  const requestClose = () => {
    if (leaving) return; // re-entry guard (double Esc, Esc during exit)
    // Veto FIRST — before any state that commits to leaving. Everything below this line is
    // one-way.
    if (canClose && !canClose()) return;
    // With animations off there's no animationend to wait for — close now.
    if (document.documentElement.getAttribute('data-animations') !== 'true') {
      onClose();
      return;
    }
    setLeaving(true);
  };

  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-black/50 dialog-scrim ${leaving ? 'dialog-leaving' : ''}`}
      onMouseDown={(e) => {
        // Pressing the scrim itself must not steal focus from the card —
        // otherwise Chromium focuses <body> and the card's Esc handler goes
        // dead on closeOnBackdrop=false dialogs. Target-guarded: mousedown
        // bubbles from card children, and preventing THOSE would block
        // focusing the card's inputs.
        pressOnScrim.current = e.target === e.currentTarget;
        if (pressOnScrim.current) e.preventDefault();
      }}
      onClick={closeOnBackdrop
        ? (e) => { if (pressOnScrim.current && e.target === e.currentTarget && !scrimMouseDownGuard?.(e)) requestClose(); }
        : undefined}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`dialog-card bg-bg-elevated border border-border-subtle rounded-dialog shadow-dialog ${widthClasses} ${maxWidthClasses} ${cardClassName} flex flex-col outline-none`}
        onClick={(e) => e.stopPropagation()}
        // Only the card's OWN dialog-out end may unmount — animationend bubbles,
        // so a child's finishing animation must not close the dialog early.
        onAnimationEnd={(e) => {
          if (leaving && e.target === e.currentTarget) onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            requestClose();
            return;
          }
          // Focus trap — Tab cycles within the card. Without this, Tab walks out
          // into the app behind the scrim, where Space/Enter can actuate
          // background controls through a modal.
          //
          // The card AND the layers its content floats over it: a chip popover and the name prompt
          // are portals at the end of <body> — outside the card's DOM, inside its React tree, which
          // is why their keys reach this handler at all. Scanning the card alone left the trap blind
          // with the focus in a layer, and Tab from the layer's last field walked straight out to
          // the app. A layer declares itself with data-dialog-layer — THIS shell's id, so a dialog
          // stacked on top never rings the layers of the one underneath (dialogLayer.ts). Between
          // the card's own fields the browser's order is kept; the edges and the layers are driven
          // from here.
          if (e.key === 'Tab') {
            // A key a handler below already used (the token list's Tab commits an entry) is not
            // focus navigation.
            if (e.nativeEvent.defaultPrevented) return;
            const card = cardRef.current;
            if (!card) return;
            const inCard = Array.from(card.querySelectorAll<HTMLElement>(TABBABLE));
            const inLayers = Array.from(document.querySelectorAll('[data-dialog-layer]'))
              .filter((layer) => layer.getAttribute('data-dialog-layer') === layerId)
              .flatMap((layer) => Array.from(layer.querySelectorAll<HTMLElement>(TABBABLE)));
            const ring = [...inCard, ...inLayers];
            if (!ring.length) { e.preventDefault(); return; }
            const at = ring.indexOf(document.activeElement as HTMLElement);
            const atEdge = e.shiftKey ? at === 0 : at === inCard.length - 1;
            if (at === -1 || at >= inCard.length || atEdge) {
              e.preventDefault();
              const next = at === -1
                ? (e.shiftKey ? ring.length - 1 : 0)
                : (at + (e.shiftKey ? -1 : 1) + ring.length) % ring.length;
              ring[next].focus();
            }
            return;
          }
          // A bare Enter on a focused button belongs to THAT button — the browser turns the
          // keydown into a click on it. Forwarding it to the dialog's Enter rule meant the rule
          // ran FIRST (the click is the keydown's default action, dispatched after bubbling), so
          // Enter with the focus on Cancel ran the primary action: in Delete Profile that deleted
          // the profile and its images, with no undo, for the user who had just tabbed to Cancel
          // to back out. The button still activates on its own; we only stop the key from being
          // read as a dialog-level shortcut.
          //
          // Modifier combos are dialog-level by design (Ctrl+Enter saves the Data panel and the
          // Insert Text dialog from anywhere in the card, including a focused footer button), so
          // they still go through.
          if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button')) {
              // Still contain the key: a modal must not leak keystrokes to app-level shortcuts,
              // which is the whole job of ImportPreviewDialog's handler.
              e.stopPropagation();
              return;
            }
          }
          onCardKeyDown?.(e);
        }}
      >
        {/* Header — icon always sits in a fixed 14 px slot so titles align across dialogs
            whether or not the caller passed one. */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          {icon && <span className="shrink-0 flex items-center">{icon}</span>}
          {/* Title and meta share one BASELINE (items-baseline, as the sheet header pairs its
              name with "Action #n"); centring two type sizes would float the small one. */}
          <div className="min-w-0 flex items-baseline gap-2">
            <h3 className="text-sm font-semibold text-text-primary truncate">{title}</h3>
            {titleMeta != null && <span className="text-[11px] text-text-tertiary shrink-0">{titleMeta}</span>}
          </div>
          {showClose && (
            <IconButton size="sm" aria-label="Close" className="ml-auto" onClick={requestClose}>
              <X size={14} />
            </IconButton>
          )}
        </div>

        <DialogLayerContext.Provider value={layerId}>{children}</DialogLayerContext.Provider>

        {/* Footer — left edge: a tertiary action OR the hint, never both; right edge: the
            actions (a DialogFooter, or hand-composed buttons for the four panels). */}
        {(footer || footerHint || footerStart) && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle">
            {footerStart ?? <span className="text-[11px] text-text-tertiary min-w-0">{footerHint}</span>}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {typeof footer === 'function' ? footer(requestClose) : footer}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
