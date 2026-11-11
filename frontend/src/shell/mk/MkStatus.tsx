// Teclado (branch teclado): the mode's master switch in the status bar, beside TR3's own. Says the
// state in one sentence: the game in front and the layer held (simulated until phase 2).
import { t } from '../../i18n';
import { useApp } from '../store';
import { setEnabled, useMk } from './mkStore';

export function MkSwitch() {
  const enabled = useMk(s => s.enabled);
  const variant = useMk(s => s.variant);
  const front = useMk(s => s.games.find(g => g.id === s.front && (!g.app || s.variant === 'merged')) ?? null);
  const holding = useMk(s => s.holding);
  // As the Key Remaps: on, but paused while the Shortcuts are off.
  const shortcuts = useApp(a => a.settings.profileKeyEnabled);
  const paused = enabled && !shortcuts;
  const playing = enabled && !paused && !!front?.on;
  const layer = playing && holding;
  const text = !enabled ? t('teclado.status.off')
    : paused ? t('teclado.status.paused')
    : front && !front.on ? t('teclado.status.gameOff', { game: front.name })
    : front ? (layer ? t('teclado.status.frontLayer', { game: front.name }) : t('teclado.status.front', { game: front.name }))
    : variant === 'merged' ? t('teclado.status.idleMerged')
    : t('teclado.status.idle');
  const tip = !enabled ? t('teclado.status.offTip') : paused ? t('teclado.status.pausedTip') : t('teclado.status.onTip');
  return (
    <button
      type="button"
      className="sb-switch"
      aria-pressed={enabled}
      data-paused={paused || (front && !front.on) ? '' : undefined}
      data-layer={layer ? '' : undefined}
      data-tip={tip}
      onClick={() => setEnabled(!enabled)}
    >
      <span className="sb-dot" />
      {text}
    </button>
  );
}
