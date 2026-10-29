import { Keyboard, ListChecks, MousePointerClick, Settings, Zap } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { useTt } from '../state/LanguageContext';
import { preload } from './lazyModule';
import { useApp } from './store';
import { loadSettingsPage, openPage, openSettings, setLibraryPeek, useUi, type Page } from './ui';
import { useShellBand } from './useShellBand';

// ② The rail: the five destinations. Macros and Settings exist; the Clicker, Automations and Key
// Remaps come later in phase 3, and until then they show (disabled) only in the development build.
const DESTINATIONS = [
  { id: 'macros', label: 'Macros', Icon: ListChecks },
  { id: 'clicker', label: 'Clicker', Icon: MousePointerClick },
  { id: 'automations', label: 'Automations', Icon: Zap },
  { id: 'remaps', label: 'Key Remaps', Icon: Keyboard },
  { id: 'settings', label: 'Settings', Icon: Settings },
] as const;
const BUILT = new Set<string>(['macros', 'settings'] satisfies Page[]);

/**
 * Where the window folds or hides the library, Macros lays it over the steps and takes it away again
 * (the 520–759 px band: "um painel por vez"). From another page it is the way back to the macros, as
 * it was left. With the Clicker on (its hotkey, the tray), Macros is the way back to the macros
 * (casca-101), as "Macro" in today's mode switch: the Clicker stops. A page's chunk comes when the
 * pointer or the focus reaches its button (rule 6).
 */
export function Rail() {
  const tt = useTt();
  const band = useShellBand();
  const peek = useUi(s => s.libraryPeek);
  const page = useUi(s => s.page);
  const clicker = useApp(a => a.settings.useCursorClick);
  const { send } = useBridge();
  const peeks = band !== 'wide' && page === 'macros';
  const openMacros = () => {
    // The write useSettings().change makes, sent here so the settings hook stays out of the opening
    // bundle (rule 6).
    if (clicker) send({ type: 'settings:change', payload: { key: 'useCursorClick', value: false } });
    if (page !== 'macros') openPage('macros');
    else if (!clicker && peeks) setLibraryPeek(!peek);
  };
  const warm = (id: string) => { if (id === 'settings') void preload(loadSettingsPage); };
  return (
    <nav className="shell-rail" aria-label="Destinations">
      {DESTINATIONS.filter(d => BUILT.has(d.id) || import.meta.env.DEV).map(({ id, label, Icon }) => {
        const built = BUILT.has(id);
        const here = page === id;
        return (
          <button
            key={id}
            type="button"
            className="shell-rail-item"
            aria-current={here ? 'page' : undefined}
            aria-expanded={id === 'macros' && peeks && !clicker ? peek : undefined}
            disabled={!built}
            data-library-toggle={id === 'macros' && peeks ? '' : undefined}
            data-tip={!built ? tt(`${label} — not built yet`, `${label} — ainda não feito`)
              : id === 'macros' && clicker ? tt('Back to the macros — the Clicker stops', 'Volta aos macros — o Clicker para')
              : label}
            data-tip-pos="right"
            onPointerEnter={() => warm(id)}
            onFocus={() => warm(id)}
            onClick={!built ? undefined : id === 'macros' ? openMacros : () => openSettings()}
          >
            <Icon aria-hidden="true" />
            <span className="shell-rail-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
