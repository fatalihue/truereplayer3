import type { CSSProperties } from 'react';

/**
 * The ON/OFF skin for every settings field shaped like a chip with an enable dot —
 * Execution's delay/variation/loops/interval, the Clicker's Area and Fixed, and the key
 * remap rows. Those four sites carried the same inline style pair copy-pasted, which is
 * how they drifted from everything else in the first place.
 *
 * Intensity is deliberately THE SAME as Toggle/IconToggle: accent at 12% for the fill,
 * 40% for the border. The chips used to pair a 13% fill with a FULL accent-solid border,
 * which is what made them shout next to a quiet switch in the same row.
 *
 * The dot keeps its two-channel on/off (filled disc ↔ hollow ring), so the state survives
 * on the low-contrast presets exactly like the switch knob does — see the repo's
 * toggle-two-channel note. Focus (`focus-within:!border-accent-solid`) deliberately stays
 * loud: it is transient and answers "where am I typing", not "is this on".
 */
export const chipOn: CSSProperties = {
  borderColor: 'color-mix(in srgb, var(--color-accent) 40%, transparent)',
  background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
};

export const chipOff: CSSProperties = {
  borderColor: 'var(--color-border-default)',
  background: 'var(--color-bg-input)',
};

/** Enable dot — filled in the accent when on, hollow ring when off. */
export const chipDotOn: CSSProperties = { background: 'var(--color-accent)' };

export const chipDotOff: CSSProperties = {
  background: 'transparent',
  border: '1.5px solid var(--color-text-tertiary)',
};

/**
 * The TOKEN chip — a mono `{token}` pill you click to insert or copy (the Insert Text rail, the
 * Data panel's column tokens). One recipe for both: they had drifted, and the Data panel copy
 * kept border-subtle (6 %), the value that made the chips vanish on light presets, plus a
 * warning-coloured hover on an action that only copies. border-default + the accent "lit" tint
 * on hover (12 % fill / 40 % border), the same pair every toggle and chip uses when on.
 */
export const tokenChipClass =
  'h-6 px-2 inline-flex items-center text-caption font-mono bg-bg-surface border border-border-default rounded text-text-secondary hover:text-accent hover:border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] transition-colors';
