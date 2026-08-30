import { useLanguage } from '../../state/LanguageContext';
import { formatMs } from '../../utils/displayUtils';

/**
 * One-click millisecond preset chips — unifies the two recipes that had
 * drifted apart between the Keystroke hold presets (heavy accent fill) and the
 * Pause timeout presets (quiet accent mix). The quiet recipe won.
 *
 * LAYOUT: the duration ladder is a GRID of equal cells that fills the row, not a
 * flex-wrap. Shrink-wrapped chips came out at 51/51/62/62/68 px with 50-80 px of dead
 * slack at the end of the row, so the group read as unfinished and its break point
 * depended on text width rather than on meaning.
 * The column count is auto-fit rather than fixed because the three consumers sit in
 * different widths: the Pause and Keystroke DIALOGS give ~398 px (→ 5 columns, one row),
 * the Sheet's Pause editor only ~307 px (→ 4 columns; a fixed 5 would need 66 px cells
 * and only 56.6 px are available, so the widest label would spill).
 * The 68 px floor is measured, not guessed: the widest label ("30.000 ms") needs 48 px of
 * text plus 16 px of padding and 2 px of border.
 *
 * A 0 value means "no timeout" and is NOT a rung on that ladder — it is a mode. It gets
 * its own labelled full-width row below the grid, because as a bare 24 px "∞" chip wedged
 * between ~60 px durations it read as a runt and relied entirely on its tooltip to explain
 * itself. Only Pause passes it; Keystroke has no ∞ (a key cannot be held indefinitely).
 */
interface DurationChipsProps {
  presets: readonly number[];
  value: number;
  /** Keystroke MUST pass its two-track setHoldMs so preset-click-then-instant-Add
   *  commits the fresh value (state+ref written together). */
  onSelect: (ms: number) => void;
  /** data-tip for the ∞ (0 ms) chip. */
  infinityTip?: string;
}

// Shared by the ladder cells and the ∞ row so the two can never drift in tint or border.
// 12% / 40% — the one intensity shared with Toggle, IconToggle and the enable chips
// (see chipStyles.ts). Was 10% / 30%, the last drift left.
const chipClass = (active: boolean) =>
  `px-2 py-0.5 rounded text-[10px] border transition-colors ${
    active
      ? 'text-accent border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
      : 'text-text-tertiary border-border-subtle bg-bg-card hover:text-text-secondary hover:bg-bg-input'
  }`;

export function DurationChips({ presets, value, onSelect, infinityTip }: DurationChipsProps) {
  const { language } = useLanguage();
  const durations = presets.filter((ms) => ms !== 0);
  const hasInfinity = presets.includes(0);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid gap-1.5 grid-cols-[repeat(auto-fit,minmax(68px,1fr))]">
        {durations.map((ms) => (
          <button
            key={ms}
            type="button"
            onClick={() => onSelect(ms)}
            className={`${chipClass(value === ms)} font-mono tabular-nums text-center whitespace-nowrap`}
          >
            {`${formatMs(ms, language)} ms`}
          </button>
        ))}
      </div>
      {hasInfinity && (
        <button
          type="button"
          onClick={() => onSelect(0)}
          data-tip={infinityTip}
          // Full width and labelled: the glyph alone never said what it did. Label stays
          // English like every other control label — the translated explanation is the tip.
          className={`${chipClass(value === 0)} w-full flex items-center justify-center gap-1.5`}
        >
          <span className="font-mono text-[11px] leading-none">∞</span>
          <span>No timeout</span>
        </button>
      )}
    </div>
  );
}
