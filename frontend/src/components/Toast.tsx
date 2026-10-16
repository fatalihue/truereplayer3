import { useState } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { useToast, useToasts, type ToastType } from '../state/ToastContext';
import { Button } from './common/Button';
import { iconButtonClass } from './common/IconButton';

const iconMap: Record<ToastType, { Icon: React.ElementType; color: string }> = {
  success: { Icon: CheckCircle2, color: 'var(--color-replay-fg)' },
  error:   { Icon: XCircle,      color: 'var(--color-recording-fg)' },
  info:    { Icon: Info,          color: 'var(--color-accent)' },
};

// Clear of the bottom chrome BY CONSTRUCTION, not by luck. Measured against the running app:
// the StatusBar is 26px, the ActionBar's top sits 72 layout px above the viewport bottom, and
// the BulkActionBar (34 px — raised from h-8 in 5bf9fa8 to fit its 28 px buttons) stacks on top
// of it whenever rows are selected — so 106 is the worst case and this leaves 8px of air above it.
//
// It used to sit at bottom:40, which is inside the ActionBar: the toast landed squarely on
// Save/Load, and a notification that eats the click the user was about to make is worse than
// no notification. Bulk edits are exactly when toasts fire AND exactly when both of those bars
// are on screen.
const BOTTOM_CLEARANCE_PX = 114;

export function Toast() {
  // The list comes from its own context so every other consumer of useToast (which only ever calls
  // showToast) stops re-rendering on each show and auto-dismiss.
  const toasts = useToasts();
  const { dismissToast, pauseToast, resumeToast } = useToast();

  // Announced through ONE screen-reader-only region, ALWAYS mounted: a region created together
  // with its first message is not reliably spoken — this used to return null when empty and
  // carried no role, so no toast was ever heard. It holds the newest toast's text only; polite,
  // like every toast in the house (SKILL §6). The visible stack stays ONE list in arrival order:
  // splitting it into an error region and a status region re-sorted the toasts by type, so a new
  // info toast grew the bottom stack and shoved an error up and out from under the pointer that
  // was holding it — the mouseleave then resumed its countdown mid-read.
  //
  // It speaks only when a NEWER toast arrives (ids only grow): pointing it at "the last toast in
  // the list" re-read an older one whenever the newest was dismissed or expired first. A repeat of
  // the same message flips a zero-width space so the text node still changes and is read again.
  const [said, setSaid] = useState<{ id: number; text: string }>({ id: -1, text: '' });
  const newest = toasts.length > 0 ? toasts[toasts.length - 1] : null;
  if (newest && newest.id > said.id) {
    setSaid({ id: newest.id, text: newest.message + (newest.message === said.text.replace(/​$/, '') && !said.text.endsWith('​') ? '​' : '') });
  }

  const renderToast = (toast: (typeof toasts)[number]) => {
    const { Icon, color } = iconMap[toast.type];
    return (
      <div
        key={toast.id}
        // The overlay recipe (menu-surface: card fill, default border, overlay radius and
        // shadow), the same surface every menu and flyout floats on — a toast is one more
        // thing floating over the app, not its own kind of box.
        className="toast-enter menu-surface flex items-center gap-2.5 px-3.5 py-2.5 max-w-[380px] pointer-events-auto"
        // Freeze the countdown while the pointer is over the toast — an 8s error shouldn't be a
        // reading race — and while the keyboard is on one of its buttons, for the same reason.
        // Each side resumes only if the other is not still holding it.
        onMouseEnter={() => pauseToast(toast.id)}
        onMouseLeave={(e) => { if (!e.currentTarget.contains(document.activeElement)) resumeToast(toast.id); }}
        onFocus={() => pauseToast(toast.id)}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null) || e.currentTarget.matches(':hover')) return;
          resumeToast(toast.id);
        }}
      >
        <Icon size={14} className="shrink-0" style={{ color }} />
        <span className="text-ui text-text-primary flex-1">{toast.message}</span>
        {toast.action && (
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0"
            onClick={() => {
              toast.action!.onClick();
              dismissToast(toast.id);
            }}
          >
            {toast.action.label}
          </Button>
        )}
        <button
          onClick={() => dismissToast(toast.id)}
          className={iconButtonClass('sm')}
          aria-label="Dismiss notification"
        >
          <X size={12} />
        </button>
      </div>
    );
  };

  return (
    // Centred over the action grid rather than pinned right, because the bottom-right corner is
    // already taken: LiveVariablesPanel is `fixed bottom-10 right-3` and up to 45vh tall, so the
    // two used to overlap whenever that pane was open. Empty, it is an invisible box that takes
    // no pointer events.
    <div
      className="fixed left-1/2 -translate-x-1/2 z-(--z-topmost) flex flex-col-reverse items-center gap-2 pointer-events-none"
      style={{ bottom: BOTTOM_CLEARANCE_PX }}
    >
      <div role="status" className="sr-only">{said.text}</div>
      {toasts.map(renderToast)}
    </div>
  );
}
