import { Children, cloneElement, isValidElement, useId } from 'react';

// Standard labelled field block for the Sheet panel. One source of truth for
// the label typography (the app-wide label-micro recipe) and the optional
// hint line below the control, so individual sections stop hand-rolling
// slightly-different label/hint markup.
export function Field({ label, labelAdornment, hint, hintTone, children, className = '' }: {
  label: string;
  // Small inline element rendered right after the label text (e.g. the browser
  // selector tier shield, or a mode toggle for the field). Rendered as a SIBLING
  // of the <label>, never inside it: a <label> with no htmlFor adopts its first
  // labelable descendant as its control, so an interactive adornment placed inside
  // the label would be silently fired by clicks on the caption text or the empty
  // gap. Keeping it outside makes labelAdornment safe for interactive controls too.
  labelAdornment?: React.ReactNode;
  // Muted explainer rendered under the control — replaces the ad-hoc
  // `text-[10px] text-text-tertiary mt-1` divs scattered through the panel.
  hint?: string;
  // 'warn' when the hint is saying something is wrong with the value — the SAME line in warning
  // ink, so a field never grows or shifts to raise a warning.
  hintTone?: 'warn';
  children: React.ReactNode;
  className?: string;
}) {
  // The caption has to NAME the control, which a <label> without htmlFor never did — every
  // Field-wrapped control was nameless, or named only by its placeholder. A native
  // input/textarea/select as the first child gets aria-labelledby directly; anything else (NumberInput,
  // SegmentedControl, a row of controls) sits in a group named by the caption. The group is
  // display:contents so the Field's layout is exactly what it was.
  //
  // Decided on the FIRST child alone, never on how many there are. Counting flipped the Wait
  // Condition field from the cloned <select> to the group the moment its trailing "Text Pattern
  // is empty" warning mounted (picking "Text matches"), so React remounted the <select> under
  // the user's hand and focus fell to <body>. Now the control keeps its slot and its key
  // (Children.toArray keys by source position), and trailing siblings render beside it, unwrapped.
  const labelId = useId();
  const kids = Children.toArray(children);
  const first = kids[0];
  const native = isValidElement<Record<string, unknown>>(first)
    && typeof first.type === 'string' && ['input', 'textarea', 'select'].includes(first.type)
    && !first.props['aria-label'] && !first.props['aria-labelledby'];
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <label id={labelId} className="label-micro text-text-tertiary">{label}</label>
        {labelAdornment}
      </div>
      {native
        ? [cloneElement(first as React.ReactElement<Record<string, unknown>>, { 'aria-labelledby': labelId }), ...kids.slice(1)]
        : <div role="group" aria-labelledby={labelId} className="contents">{children}</div>}
      {hint && <div className={`text-caption ${hintTone === 'warn' ? 'text-warning-ink' : 'text-text-tertiary'} leading-snug mt-1`}>{hint}</div>}
    </div>
  );
}

// Group header for a run of fields — "Repeat", "Launch", "Placement", "After navigation".
// Before this existed every group header was a bare `div.label-micro` with the same 12 px
// of air above it as a field label, so a section title weighed exactly as much as the label
// of the field inside it and the eye could not tell the two apart (2026-09-04 sweep, sector 1).
// Secondary ink instead of tertiary, a hairline running to the right edge, and 6 px of extra
// air above: the three cues together read as "a new group starts here" without a box.
//
// `children` is optional so a header can also sit on its own above hand-laid content; when
// given, the fields stack with the panel's standard 12 px rhythm.
export function Section({ title, adornment, children, className = '' }: {
  title: string;
  // Right-aligned slot on the header row (a small toggle, a count, a tier shield).
  adornment?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`pt-1.5 ${className}`}>
      <div className="flex items-center gap-2">
        <div className="label-micro text-text-secondary shrink-0">{title}</div>
        <div className="flex-1 h-px bg-border-default" aria-hidden="true" />
        {adornment}
      </div>
      {children && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}
