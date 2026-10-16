interface ToggleProps {
  isOn: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  // 'sm' = the compact 28×16 switch used in the redesigned Settings panel; default
  // keeps the original 40×20 size for every other surface (dialogs, etc.).
  size?: 'default' | 'sm';
  // The switch's name when no labelled group around it supplies one (a caption <span> beside
  // it is not tied to it — a screen reader heard just "switch, off").
  ariaLabel?: string;
}

export function Toggle({ isOn, onChange, disabled = false, size = 'default', ariaLabel }: ToggleProps) {
  const sm = size === 'sm';
  const track = sm ? 'w-7 h-4' : 'w-10 h-5';
  // Knob: 1px inset on every side inside the 1px border (track inner box is 26×14 for
  // sm / 38×18 for default). The earlier sm values sat the knob flush to the bottom/
  // right edge; these centre it, matching the default look at the smaller size.
  // It travels by `translate` (12 px sm / 20 px default — the old left 1→13 and 2→22), not by
  // `left`: a layout property animated on every flip, and outside the animations toggle (§4).
  const knob = sm
    ? `w-3 h-3 top-[1px] left-[1px] ${isOn ? 'translate-x-3' : ''}`
    : `w-3.5 h-3.5 top-[2px] left-[2px] ${isOn ? 'translate-x-5' : ''}`;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label={ariaLabel}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={() => !disabled && onChange(!isOn)}
      className={`relative ${track} rounded-full transition-colors border ${
        disabled
          ? 'bg-bg-card border-border-subtle opacity-40 cursor-not-allowed'
          : isOn
            // Quiet ON: the track takes the accent at 12% and the border at 40% rather than
            // filling solid. A settings list with six switches on used to read as six bars of
            // colour; the tint says "on" at a glance without competing with the row labels.
            // Same recipe as the kbd-accent chips. State is still encoded TWICE — the knob also
            // travels — which is what keeps it readable on the low-contrast presets where an
            // accent-only signal collapses (21 of the 48 themes fall under 3:1 accent↔disabled).
            ? 'bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] cursor-pointer'
            : 'bg-bg-card border-border-strong cursor-pointer'
      }`}
    >
      <div className={`absolute rounded-full transition-colors motion-ok:transition-[translate,background-color] ${knob} ${
        isOn ? 'bg-accent' : 'bg-text-tertiary'
      }`} />
    </button>
  );
}
