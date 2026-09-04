import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { useToast, useToasts, type ToastType } from '../state/ToastContext';
import { iconButtonClass } from './common/IconButton';

const iconMap: Record<ToastType, { Icon: React.ElementType; color: string }> = {
  success: { Icon: CheckCircle2, color: 'var(--color-replay-fg)' },
  error:   { Icon: XCircle,      color: 'var(--color-recording-fg)' },
  info:    { Icon: Info,          color: 'var(--color-accent)' },
};

// Clear of the bottom chrome BY CONSTRUCTION, not by luck. Measured against the running app:
// the StatusBar is 26px, the ActionBar's top sits 72 layout px above the viewport bottom, and
// the BulkActionBar (h-8 = 32) stacks on top of it whenever rows are selected — so 104 is the
// worst case and this leaves 8px of air above it.
//
// It used to sit at bottom:40, which is inside the ActionBar: the toast landed squarely on
// Save/Load, and a notification that eats the click the user was about to make is worse than
// no notification. Bulk edits are exactly when toasts fire AND exactly when both of those bars
// are on screen.
const BOTTOM_CLEARANCE_PX = 112;

export function Toast() {
  // The list comes from its own context so every other consumer of useToast (which only ever calls
  // showToast) stops re-rendering on each show and auto-dismiss.
  const toasts = useToasts();
  const { dismissToast, pauseToast, resumeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    // Centred over the action grid rather than pinned right, because the bottom-right corner is
    // already taken: LiveVariablesPanel is `fixed bottom-10 right-3` and up to 45vh tall, so the
    // two used to overlap whenever that pane was open.
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[9999] flex flex-col-reverse items-center gap-2 pointer-events-none"
      style={{ bottom: BOTTOM_CLEARANCE_PX }}
    >
      {toasts.map((toast) => {
        const { Icon, color } = iconMap[toast.type];
        return (
          <div
            key={toast.id}
            // The overlay recipe (menu-surface: card fill, default border, overlay radius and
            // shadow), the same surface every menu and flyout floats on — a toast is one more
            // thing floating over the app, not its own kind of box.
            className="toast-enter menu-surface flex items-center gap-2.5 px-3.5 py-2.5 max-w-[380px] pointer-events-auto"
            // Freeze the countdown while the pointer is over the toast — an 8s
            // error shouldn't be a reading race.
            onMouseEnter={() => pauseToast(toast.id)}
            onMouseLeave={() => resumeToast(toast.id)}
          >
            <Icon size={14} className="shrink-0" style={{ color }} />
            <span className="text-ui text-text-primary flex-1">{toast.message}</span>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action!.onClick();
                  dismissToast(toast.id);
                }}
                className="text-ui font-semibold uppercase tracking-wider px-2 py-1 rounded hover:bg-bg-elevated transition-colors shrink-0"
                style={{ color: 'var(--color-accent)' }}
              >
                {toast.action.label}
              </button>
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
      })}
    </div>
  );
}
