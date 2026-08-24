import type { CSSProperties, ReactNode } from 'react';

/**
 * Inline validation line that RESERVES its own space.
 *
 * The name-collision hints in ProfilePanel were `{taken && <p …>}`. Mounting that <p> grew the
 * card, and because those dialogs sit in a `fixed inset-0 flex items-center justify-center`
 * scrim, growing the card ALSO re-centres it: the heading and the input the caret is in rise
 * while Cancel/Confirm fall, mid-keystroke. Same shape in the Sheet and the window-target
 * fields, where a regex error appears and disappears on every character typed.
 *
 * TWO rules make the height constant BY CONSTRUCTION rather than by estimate:
 *
 *   • The <p> is ALWAYS mounted. An unmounted element reserves nothing, and neither does an
 *     empty one — an empty block generates no line box — so the resting state renders an
 *     `&nbsp;`, which does. It is written as the entity rather than a literal U+00A0 on
 *     purpose: a bare non-breaking space is invisible in review and one "tidy whitespace"
 *     pass away from collapsing the reserve it exists to hold.
 *   • It is ALWAYS exactly one line (`truncate`). This is what lets the same component serve a
 *     DYNAMIC message: a parser error of unknown length can no longer reserve one line and then
 *     render two. The alternative considered was a per-site "ghost" string of representative
 *     length, which fails silently the day a real message outgrows the ghost.
 *
 * Deliberately NOT a `min-h-[Npx]`: `--ui-font-size`, `--ui-border-radius` and `--ui-row-height`
 * are user-adjustable, so a hardcoded pixel height is right at one setting and wrong at the
 * rest — the reasoning already written out in KeystrokeCaptureDialog's warning band, which is
 * the same always-rendered-and-toggled pattern one level up.
 *
 * Do NOT interpolate the value being validated into `children`. In an always-mounted slot the
 * reserved text occupies its box in BOTH states, so a message carrying the typed name would
 * make the slot's width track what the user types — and with a long enough name the ellipsis
 * would eat the sentence rather than the name. Keep the message constant and let the field
 * itself show the value; pass `tip` when a dynamic message needs its full text reachable.
 */
export function FieldError({
  show,
  children,
  className = 'text-[11px] text-recording mt-2',
  style,
  tip,
}: {
  show: boolean;
  children: ReactNode;
  /** Full class list INCLUDING the colour — call sites differ (`text-recording` vs the
   *  `--color-recording-fg` ink), and this component does not have an opinion about which. */
  className?: string;
  style?: CSSProperties;
  /** Portal tooltip carrying the untruncated text. For dynamic messages only; never `title=`. */
  tip?: string;
}) {
  return (
    <p
      aria-live="polite"
      className={`${className} truncate`}
      style={style}
      data-tip={show ? tip : undefined}
    >
      <span className={show ? undefined : 'invisible'} aria-hidden={!show}>
        {show ? children : <>&nbsp;</>}
      </span>
    </p>
  );
}
