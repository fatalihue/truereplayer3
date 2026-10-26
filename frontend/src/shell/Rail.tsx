import { Keyboard, ListChecks, MousePointerClick, Settings, Zap } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { useTt } from '../state/LanguageContext';
import { useApp } from './store';
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
 * (the 520–759 px band: "um painel por vez"). With the Clicker on (its hotkey, the tray), Macros is
 * the way back to the macros (casca-101), as "Macro" in today's mode switch: the Clicker stops.
 */
export function Rail() {
  const tt = useTt();
  const band = useShellBand();
  const peek = useUi(s => s.libraryPeek);
  const clicker = useApp(a => a.settings.useCursorClick);
  const { send } = useBridge();
  const peeks = band !== 'wide';
  const openMacros = () => {
    // The write useSettings().change makes, sent here so the settings hook stays out of the opening
    // bundle (rule 6).
    if (clicker) send({ type: 'settings:change', payload: { key: 'useCursorClick', value: false } });
    else if (peeks) setLibraryPeek(!peek);
  };
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
            aria-expanded={built && peeks && !clicker ? peek : undefined}
            disabled={!built}
            data-library-toggle={built && peeks ? '' : undefined}
            data-tip={!built ? tt(`${label} — not built yet`, `${label} — ainda não feito`)
              : clicker ? tt('Back to the macros — the Clicker stops', 'Volta aos macros — o Clicker para')
              : label}
            data-tip-pos="right"
            onClick={built ? openMacros : undefined}
          >
            <Icon aria-hidden="true" />
            <span className="shell-rail-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
