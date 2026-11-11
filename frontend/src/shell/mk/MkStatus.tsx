// Teclado (branch teclado): the mode's master switch in the status bar, beside TR3's own. Says the
// state in one sentence, from the engine's teclado:live: the game in front, and the layer held.
import { APP_NAME } from '../../appIdentity';
import { t } from '../../i18n';
import { useApp } from '../store';
import { setEnabled } from './mkEdit';
import { useMk } from './mkStore';

export function MkSwitch() {
  const enabled = useMk(s => s.enabled);
  const front = useMk(s => s.games.find(g => g.id === s.front) ?? null);
  // Phase 7: a game locked is the one the status names, even with the app's own window in front.
  const locked = useMk(s => s.games.find(g => g.id === s.locked) ?? null);
  const holding = useMk(s => s.holding);
  // As the Key Remaps: on, but paused while the Shortcuts are off.
  const shortcuts = useApp(a => a.settings.profileKeyEnabled);
  const paused = enabled && !shortcuts;
  const playing = enabled && !paused && !!front?.on;
  const layer = playing && holding;
  const text = !enabled ? t('teclado.status.off')
    : paused ? t('teclado.status.paused')
    : locked && !locked.on ? t('teclado.status.gameOff', { game: locked.name })
    : locked ? (layer ? t('teclado.status.frontLayer', { game: locked.name }) : t('teclado.status.locked', { game: locked.name }))
    : front && !front.on ? t('teclado.status.gameOff', { game: front.name })
    : front ? (layer ? t('teclado.status.frontLayer', { game: front.name }) : t('teclado.status.front', { game: front.name }))
    : t('teclado.status.idle');
  const tip = !enabled ? t('teclado.status.offTip') : paused ? t('teclado.status.pausedTip')
    : locked ? t('teclado.status.lockedTip', { game: locked.name, app: APP_NAME }) : t('teclado.status.onTip');
  // The last switch, and the longest ("Teclado ativado · nenhum jogo na frente"): in a narrow window its
  // words give way with an ellipsis (shell.css, data-mk) instead of running under the extension's state.
  return (
    <button
      type="button"
      className="sb-switch"
      data-mk=""
      aria-pressed={enabled}
      data-paused={paused || (front && !front.on) ? '' : undefined}
      data-layer={layer ? '' : undefined}
      data-tip={tip}
      onClick={() => setEnabled(!enabled)}
    >
      <span className="sb-dot" />
      <span className="sb-text">{text}</span>
    </button>
  );
}
