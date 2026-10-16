import { NumberInput } from '../common/NumberInput';

// Range + numeric input combo for bounded values (tolerance, confidence).
// The track/thumb styling lives in index.css (.sheet-slider) using theme vars;
// the paired NumberInput gives precise entry plus +/− nudging. Replaces the
// raw <input type="range"> + bare <input> pairs that each section hand-rolled
// with slightly different layouts.
export function Slider({ value, min, max, step = 1, onChange, suffix, disabled = false, inputMax, ariaLabel }: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  suffix?: string;
  disabled?: boolean;
  // Optional upper bound for the TEXT input only — lets the slider cap at a
  // sensible value (max) while expert users can still type higher (up to
  // inputMax). E.g. pixel tolerance: slider 0–50, typeable 0–255.
  inputMax?: number;
  /** Names both halves — the track and the number box — for assistive tech. */
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        // Clamp the slider thumb to its own range even when value (from a typed
        // entry) exceeds max, so it doesn't overflow past the track end.
        value={Math.min(value, max)}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        className="sheet-slider flex-1 min-w-0"
      />
      <NumberInput
        value={value}
        onChange={onChange}
        min={min}
        max={inputMax ?? max}
        step={step}
        suffix={suffix}
        // The unit rides INSIDE the field ("85 %"), like every delay in the Sheet — a "%"
        // hanging outside the box was the one unit in the panel that broke the convention.
        suffixInside={!!suffix}
        // ...which needs a wider box than NumberInput's default w-14: of its 56 px the border,
        // the 18 px spinner slot and the unit leave ~24 px, and "100" needs ~31 with the input's
        // padding, so it read "10 %". w-18 fits three digits plus a one- or two-letter unit;
        // the track (flex-1) gives up the difference, the row's 340 px does not change.
        inputWidth={suffix ? 'w-18' : undefined}
        disabled={disabled}
        ariaLabel={ariaLabel}
      />
    </div>
  );
}
