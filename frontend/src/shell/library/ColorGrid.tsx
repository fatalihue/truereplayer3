import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { t } from '../../i18n';
import { FOLDER_COLORS, SWATCH_CHECK_INK } from '../../themes';
import { lightSwatch } from './model';

/**
 * The 24 folder colours. In the New folder dialog the chosen one is pressed; in the folder menu's
 * Color ▸ the folder's own is marked, and the swatches are menu items, so the menu's keys walk them.
 */
export function ColorGrid({ value, onPick, menu = false }: { value: string; onPick: (color: string) => void; menu?: boolean }) {
  return (
    <div className="lib-colors" data-menu={menu || undefined}>
      {FOLDER_COLORS.map(color => {
        const on = color === value.toLowerCase();
        return (
          <button
            key={color}
            type="button"
            className="lib-color"
            role={menu ? 'menuitem' : undefined}
            aria-label={t('library.swatch', { color })}
            aria-pressed={menu ? undefined : on}
            aria-current={menu && on ? 'true' : undefined}
            style={{ '--swatch': color, '--swatch-ink': lightSwatch(color) ? SWATCH_CHECK_INK.onLight : SWATCH_CHECK_INK.onDark } as CSSProperties}
            onClick={() => onPick(color)}
          >
            {on && <Check strokeWidth={3} aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
