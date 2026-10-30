import { useEffect } from 'react';
import { ArrowRightLeft, ListChecks, MousePointerClick, Settings, Zap } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { useTt } from '../state/LanguageContext';
import { preload } from './lazyModule';
import { useApp } from './store';
import { openPage, PAGE_CHUNKS, setLibraryPeek, useUi } from './ui';
import { useShellBand } from './useShellBand';

// ② The rail: the five destinations.
const DESTINATIONS = [
  { id: 'macros', label: 'Macros', Icon: ListChecks },
  { id: 'clicker', label: 'Clicker', Icon: MousePointerClick },
  { id: 'automations', label: 'Automations', Icon: Zap },
  { id: 'remaps', label: 'Key Remaps', Icon: ArrowRightLeft },
  { id: 'settings', label: 'Settings', Icon: Settings },
] as const;

/**
 * Where the window folds or hides the library, Macros lays it over the steps and takes it away again
 * (the 520–759 px band: "um painel por vez"). From another page it is the way back to the macros, as
 * it was left. With the Clicker on (its hotkey, the tray), Macros is the way back to the macros
 * (casca-101), as "Macro" in today's mode switch: the Clicker stops. The Clicker page is the engine's
 * Clicker mode on screen: the mode on (this rail, its hotkey, the tray) brings it, and the mode off
 * takes it away. A page's chunk comes when the pointer or the focus reaches its button (rule 6).
 * Automations carries how many are armed while they run (settings-019), as the status bar says it.
 */
export function Rail() {
  const tt = useTt();
  const band = useShellBand();
  const peek = useUi(s => s.libraryPeek);
  const page = useUi(s => s.page);
  const clicker = useApp(a => a.settings.useCursorClick);
  const armed = useApp(a => (a.automation.enabled ? a.automation.entries.filter(e => e.trigger.armed && !e.isDisabled).length : 0));
  const { send } = useBridge();
  const peeks = band !== 'wide' && page === 'macros';
  const openMacros = () => {
    // The write useSettings().change makes, sent here so the settings hook stays out of the opening
    // bundle (rule 6).
    if (clicker) send({ type: 'settings:change', payload: { key: 'useCursorClick', value: false } });
    if (page !== 'macros') openPage('macros');
    else if (!clicker && peeks) setLibraryPeek(!peek);
  };
  const openClicker = () => {
    if (!clicker) send({ type: 'settings:change', payload: { key: 'useCursorClick', value: true } });
    openPage('clicker');
  };
  useEffect(() => {
    if (clicker) openPage('clicker');
    else if (useUi.getState().page === 'clicker') openPage('macros');
  }, [clicker]);
  const warm = (id: string) => {
    const load = PAGE_CHUNKS[id as keyof typeof PAGE_CHUNKS];
    if (load) void preload(load);
  };
  return (
    <nav className="shell-rail" aria-label="Destinations">
      {DESTINATIONS.map(({ id, label, Icon }) => {
        const badge = id === 'automations' && armed > 0;
        return (
          <button
            key={id}
            type="button"
            className="shell-rail-item"
            aria-current={page === id ? 'page' : undefined}
            aria-expanded={id === 'macros' && peeks && !clicker ? peek : undefined}
            data-library-toggle={id === 'macros' && peeks ? '' : undefined}
            data-tip={id === 'macros' && clicker ? tt('Back to the macros — the Clicker stops', 'Volta aos macros — o Clicker para')
              : badge ? tt(`${label} · ${armed} armed`, `${label} · ${armed} armadas`)
              : label}
            data-tip-pos="right"
            onPointerEnter={() => warm(id)}
            onFocus={() => warm(id)}
            onClick={id === 'macros' ? openMacros : id === 'clicker' ? openClicker : () => openPage(id)}
          >
            <Icon aria-hidden="true" />
            <span className="shell-rail-label">{label}</span>
            {badge && <span className="shell-rail-badge" aria-hidden="true">{armed}</span>}
          </button>
        );
      })}
    </nav>
  );
}
