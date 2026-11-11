import { useEffect } from 'react';
import { ArrowRightLeft, Keyboard, ListChecks, MousePointerClick, Settings, Zap } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { t } from '../i18n';
import { preload } from './lazyModule';
import { useMk } from './mk/mkStore';
import { useApp } from './store';
import { openPage, PAGE_CHUNKS, setLibraryPeek, useUi } from './ui';
import { useShellBand } from './useShellBand';

// ② The rail: the five destinations, and the Keyboard (branch teclado) beside the Key Remaps.
const DESTINATIONS = [
  { id: 'macros', label: t('common.pages.macros'), Icon: ListChecks },
  { id: 'clicker', label: t('common.pages.clicker'), Icon: MousePointerClick },
  { id: 'automations', label: t('common.pages.automations'), Icon: Zap },
  { id: 'teclado', label: t('teclado.page'), Icon: Keyboard },
  { id: 'remaps', label: t('common.pages.remaps'), Icon: ArrowRightLeft },
  { id: 'settings', label: t('common.pages.settings'), Icon: Settings },
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
  const band = useShellBand();
  const peek = useUi(s => s.libraryPeek);
  const page = useUi(s => s.page);
  const clicker = useApp(a => a.settings.useCursorClick);
  const armed = useApp(a => (a.automation.enabled ? a.automation.entries.filter(e => e.trigger.armed && !e.isDisabled).length : 0));
  const { send } = useBridge();
  const front = useMk(s => (s.enabled ? s.games.find(g => g.id === s.front && g.on)?.name ?? null : null));
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
    <nav className="shell-rail" aria-label={t('rail.nav')}>
      {DESTINATIONS.map(({ id, label, Icon }) => {
        const badge = id === 'automations' && armed > 0;
        const playing = id === 'teclado' && front;
        return (
          <button
            key={id}
            type="button"
            className="shell-rail-item"
            aria-current={page === id ? 'page' : undefined}
            aria-expanded={id === 'macros' && peeks && !clicker ? peek : undefined}
            data-library-toggle={id === 'macros' && peeks ? '' : undefined}
            data-tip={id === 'macros' && clicker ? t('rail.backToMacros')
              : badge ? t('rail.automationsArmed', { count: armed })
              : playing ? t('teclado.railPlaying', { game: front })
              : label}
            data-tip-pos="right"
            onPointerEnter={() => warm(id)}
            onFocus={() => warm(id)}
            onClick={id === 'macros' ? openMacros : id === 'clicker' ? openClicker : () => openPage(id)}
          >
            <Icon aria-hidden="true" />
            <span className="shell-rail-label">{label}</span>
            {badge && <span className="shell-rail-badge" aria-hidden="true">{armed}</span>}
            {playing && <span className="shell-rail-dot" aria-hidden="true" />}
          </button>
        );
      })}
    </nav>
  );
}
