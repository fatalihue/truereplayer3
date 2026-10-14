import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * THE icon button. The 2026-09-03 audit counted nine hand-rolled recipes for this one role
 * (p-1, p-1.5, w-6, w-7, w-8, w-8 round, p-0.5, h-6, the grid's hover pencil); this is the
 * one they collapse into. Three sizes on the control scale — sm 24 (panel headers), md 28
 * (toolbar, collapse buttons), lg 32 (rails) — with min-width rather than width so a button
 * that also carries a chevron grows instead of clipping.
 *
 * Rest is text-icon — the index.css token midway between secondary and tertiary. The tertiary
 * rest of the old toolbar measured ~3.9:1 and was the reason the strip was hard to scan; the
 * secondary rest that replaced it made the toolbar's row of icons read as loud as the labels
 * beside it (owner, 2026-09-05), so the rest settled between the two. One token, so the
 * toolbar and the profile panel's header buttons stay at the same intensity by construction.
 * Hover lifts to elevated + primary; `active` is the open-menu state and paints the hover look
 * while the flyout is up. Every hover is gated on
 * `enabled:` for the same reason Button gates it: index.css restores pointer-events on
 * [data-tip][disabled] so a disabled control can still explain itself, which lets :hover match.
 *
 * `iconButtonClass` is exported for the sites that keep a raw <button> (the toolbar's
 * eighteen, which carry tabIndex/handlers of their own) — same recipe, one source.
 */
export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonTone = 'ghost' | 'danger';

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'h-6 min-w-6 px-1',
  md: 'h-7 min-w-7 px-1.5',
  lg: 'h-8 min-w-8 px-2',
};

const TONE_CLASSES: Record<IconButtonTone, string> = {
  ghost: 'text-text-icon enabled:hover:bg-bg-elevated enabled:hover:text-text-primary',
  danger: 'text-text-icon enabled:hover:bg-recording-bg enabled:hover:text-recording-fg',
};

const ACTIVE_CLASSES = 'bg-bg-elevated text-text-primary';

export function iconButtonClass(size: IconButtonSize = 'md', opts: { active?: boolean; tone?: IconButtonTone; className?: string } = {}): string {
  const tone = opts.active ? ACTIVE_CLASSES : TONE_CLASSES[opts.tone ?? 'ghost'];
  return `inline-flex items-center justify-center gap-0.5 shrink-0 rounded transition-colors disabled:text-text-disabled disabled:cursor-default ${SIZE_CLASSES[size]} ${tone} ${opts.className ?? ''}`.trim();
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  tone?: IconButtonTone;
  /** The open-menu state: paints the hover look while a flyout is up. */
  active?: boolean;
  children: ReactNode;
}

export function IconButton({ size = 'md', tone = 'ghost', active = false, className = '', type = 'button', children, ...rest }: IconButtonProps) {
  return (
    <button type={type} className={iconButtonClass(size, { active, tone, className })} {...rest}>
      {children}
    </button>
  );
}
