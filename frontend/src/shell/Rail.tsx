import { Keyboard, ListChecks, MousePointerClick, Settings, Zap } from 'lucide-react';
import { useTt } from '../state/LanguageContext';
import { setLibraryPeek, useUi } from './ui';
import { useShellBand } from './useShellBand';

// ② The rail: the five destinations. Only Macros exists in phase 1. The other four come in phase 3,
// and until then they show (disabled) only in the development build.
const DESTINATIONS = [
  { id: 'macros', label: 'Macros', Icon: ListChecks },
  { id: 'clicker', label: 'Clicker', Icon: MousePointerClick },
  { id: 'automations', label: 'Automations', Icon: Zap },
  { id: 'remaps', label: 'Key Remaps', Icon: Keyboard },
  { id: 'settings', label: 'Settings', Icon: Settings },
] as const;

/**
 * Where the window folds or hides the library, Macros lays it over the steps and takes it away again
 * (the 520–759 px band: "um painel por vez").
 */
export function Rail() {
  const tt = useTt();
  const band = useShellBand();
  const peek = useUi(s => s.libraryPeek);
  const peeks = band !== 'wide';
  return (
    <nav className="shell-rail" aria-label="Destinations">
      {DESTINATIONS.filter(d => d.id === 'macros' || import.meta.env.DEV).map(({ id, label, Icon }) => {
        const built = id === 'macros';
        return (
          <button
            key={id}
            type="button"
            className="shell-rail-item"
            aria-current={built ? 'page' : undefined}
            aria-expanded={built && peeks ? peek : undefined}
            disabled={!built}
            data-library-toggle={built && peeks ? '' : undefined}
            data-tip={built ? label : tt(`${label} — not built yet`, `${label} — ainda não feito`)}
            data-tip-pos="right"
            onClick={built && peeks ? () => setLibraryPeek(!peek) : undefined}
          >
            <Icon aria-hidden="true" />
            <span className="shell-rail-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
