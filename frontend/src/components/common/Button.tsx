import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * THE button. Seeded from the app's own strongest convention — the dialog-footer
 * Cancel/primary pair that eight dialogs shipped verbatim — plus the Wave-1 ink
 * tokens so no variant can pair illegible text with a themed fill.
 *
 *   primary      solid accent fill, ink contrast-picked per theme (--color-accent-ink)
 *   secondary    the Cancel convention: quiet card fill + subtle border
 *   ghost        borderless, text-only until hover (toolbar-adjacent uses)
 *   destructive  recording-red fill + its ink token (Clear all / Delete confirms)
 *   destructiveText  red TEXT, no fill — the secondary "Remove" of a dialog whose
 *                primary is something else (Assign Hotkey, Window Target). The
 *                2026-09-04 sweep found the same action shipped as red text in one
 *                dialog and as a solid red fill in the next; the rule is now: solid
 *                when destroying IS the primary action, text when it is secondary.
 *   test         soft accent tint — the Sheet's "check it against the live screen / tab"
 *                button (Test match, Test read, Test action, Check now). One rank under
 *                primary: it carries the accent because it is the one control in its
 *                block that reaches into the world, while the solid fill stays Save's.
 *
 * Sizes: xs = the 28px action-bar rail tier; sm = the existing dialog-footer
 * metrics; md = the 32px control standard (Fluent medium — same height the
 * SheetPanel locked in 2.6.10, and what DialogFooter uses); field = md's height
 * with the in-form metrics (text-minor, px-2.5) for a button that sits among
 * input-field rows — two of them share a 340px Sheet row without clipping.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'destructiveText' | 'test';
type ButtonSize = 'xs' | 'sm' | 'md' | 'field';

// Pressed = one step dimmer (Fluent physics: fills darken on press, never
// scale-transform — that reads web/mobile, not Windows).
//
// Every hover/active is gated on `enabled:`. A disabled button normally can't be
// hovered at all, but index.css deliberately restores `pointer-events: auto` on
// [data-tip][disabled] so a disabled control can still explain WHY it is off —
// which also lets :hover match. Ungated, a disabled button would light up under
// the cursor exactly like a live one and invite a click that does nothing.
export const BUTTON_VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // hover uses the derived --color-accent-solid-hover (shifts away from the ink)
  // instead of /80 alpha, which could erode the contrast pickInk guaranteed.
  primary: 'bg-accent-solid enabled:hover:bg-[var(--color-accent-solid-hover)] enabled:active:brightness-90 text-[color:var(--color-accent-ink)]',
  secondary: 'text-text-secondary bg-bg-card enabled:hover:bg-bg-surface enabled:active:bg-bg-elevated border border-border-subtle',
  ghost: 'text-text-secondary enabled:hover:text-text-primary enabled:hover:bg-bg-elevated enabled:active:bg-bg-card',
  destructive: 'bg-recording text-[color:var(--color-recording-ink)] enabled:hover:opacity-85 enabled:active:opacity-75',
  // -fg ink (hue mixed toward text-primary) so the text survives light presets; the hover
  // wash is the same recording-bg tint the danger IconButton uses.
  destructiveText: 'text-[color:var(--color-recording-fg)] enabled:hover:bg-recording-bg enabled:active:opacity-80',
  // Seven hand-rolled copies in the Sheet had drifted (disabled at 60 % or 50 %, with and without
  // the not-allowed cursor, one with no disabled look at all, hover ungated); this is their common
  // look, with the disabled treatment every other variant shares and a pressed step added.
  test: 'border border-accent-solid/40 bg-accent-solid/10 enabled:hover:bg-accent-solid/20 enabled:active:bg-accent-solid/25 text-accent-hover',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  // xs is the ActionBar rail's tier: 28px, one step under the h-8 standard, so
  // the bar sits at the visual weight of the toolbar strip at the top of the
  // same column. Deliberate exception, declared here rather than hand-rolled at
  // the call site — that is how the previous four heights got there.
  xs: 'h-7 px-2.5 text-minor',
  sm: 'px-4 py-1.5 text-minor',
  md: 'h-8 px-4 text-ui',
  field: 'h-8 px-2.5 text-minor',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'sm',
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${BUTTON_VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
