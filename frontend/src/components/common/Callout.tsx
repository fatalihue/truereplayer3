import type { CSSProperties, ReactNode } from 'react';

/**
 * THE inline note card: a 1 px hairline all round in the tone colour (40 %), an 8 % wash of the
 * same colour, 11 px text. It used to be a 2 px rail on the left only — the house guideline
 * bars coloured side borders above 1 px, and a one-sided border under a rounded corner bends
 * the end of the rail (owner decision, 2026-10-16). Every card that carries `calloutStyle()`
 * takes `CALLOUT_CLASS` (or the RESULT_CARD alias) for the same shape.
 *
 * Before this existed the sheet carried seven "test result" cards and five "warning"
 * bands, each with its own `color-mix()` written inline (`resultCardStyle()`), the Run report
 * printed a failed step as three loose lines, and the Automation panel had a fourth recipe —
 * the 2026-09-04 sweep counted them. One component, five tones, plus `color` for the action
 * families (the Else / EndIf / EndLoop / Stop notes are tinted by their family, not by a
 * semantic tone).
 *
 * Tones map to the theme's semantic hues and to their -fg / -ink rungs for the TEXT, so a
 * warning reads as amber on dark presets and as legible dark amber on light ones — never raw
 * yellow text. `ok` uses replay green (a probe that matched), `error` recording red (a probe
 * that failed, a step that failed), `info` the accent, `neutral` the tertiary hairline for
 * plain explanations ("Clicks still follow the profile's Window Target…").
 *
 * Entrance is the gated `callout-enter` fade (index.css) — these cards APPEAR after a test or
 * a state change, and popping in with no transition was one of the five "entrances without
 * motion" the sweep listed.
 */
export type CalloutTone = 'neutral' | 'info' | 'ok' | 'warn' | 'error';

const RAIL: Record<CalloutTone, string> = {
  neutral: 'var(--color-border-strong)',
  info: 'var(--color-accent)',
  ok: 'var(--color-replay)',
  warn: 'var(--color-warning)',
  error: 'var(--color-recording)',
};

const INK: Record<CalloutTone, string> = {
  neutral: 'var(--color-text-secondary)',
  info: 'var(--color-accent)',
  ok: 'var(--color-replay-fg)',
  warn: 'var(--color-warning-ink)',
  error: 'var(--color-recording-fg)',
};

export interface CalloutProps {
  tone?: CalloutTone;
  /** Family colour (a `var(--color-action-*-fg)`) — overrides the tone's rail AND ink. */
  color?: string;
  /** Text colour override when the rail colour is too loud for body text. */
  ink?: string;
  /** Optional leading glyph (Lucide, size 12) — sits on the first line. */
  icon?: ReactNode;
  /** Skip the entrance fade for cards that are part of the initial layout, not a reaction. */
  still?: boolean;
  role?: 'status' | 'alert';
  className?: string;
  children: ReactNode;
}

/** The card's shape — pair it with `calloutStyle()` wherever a note is not the <Callout> itself. */
export const CALLOUT_CLASS = 'border rounded px-2.5 py-2 text-caption leading-relaxed';

export function calloutStyle(tone: CalloutTone = 'neutral', color?: string, ink?: string): CSSProperties {
  const rail = color ?? RAIL[tone];
  return {
    // A plain neutral note keeps the solid hairline: border-strong at 40 % would vanish into
    // the card. Every hue (tone or family colour) is mixed down so the frame stays a hairline.
    borderColor: !color && tone === 'neutral' ? 'var(--color-border-default)' : `color-mix(in srgb, ${rail} 40%, transparent)`,
    color: ink ?? color ?? INK[tone],
    background: `color-mix(in srgb, ${rail} 8%, transparent)`,
  };
}

export function Callout({ tone = 'neutral', color, ink, icon, still = false, role, className = '', children }: CalloutProps) {
  return (
    <div
      role={role}
      className={`${CALLOUT_CLASS} ${icon ? 'flex items-start gap-2' : ''} ${still ? '' : 'callout-enter'} ${className}`}
      style={calloutStyle(tone, color, ink)}
    >
      {icon && <span className="shrink-0 mt-[1px]">{icon}</span>}
      {icon ? <div className="min-w-0 flex-1">{children}</div> : children}
    </div>
  );
}
