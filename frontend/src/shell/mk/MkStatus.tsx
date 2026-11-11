// PROTÓTIPO MK (ver mkModel.ts): a chave geral do Teclado na barra de status, ao lado das chaves do
// TR3. Diz o estado em uma frase: o jogo na frente e a camada segura.
import { useApp } from '../store';
import { useMk } from './mkStore';

export function MkSwitch() {
  const enabled = useMk(s => s.enabled);
  const variant = useMk(s => s.variant);
  const front = useMk(s => s.games.find(g => g.id === s.front && (!g.app || s.variant === 'merged')) ?? null);
  const holding = useMk(s => s.holding);
  const shortcuts = useApp(a => a.settings.profileKeyEnabled);
  const paused = enabled && !shortcuts;
  const playing = enabled && !paused && !!front?.on;
  const layer = playing && holding;
  const text = !enabled ? 'Teclado desativado'
    : paused ? 'Teclado pausado'
    : front && !front.on ? `Teclado · ${front.name} desligado`
    : front ? `Teclado · ${front.name}${layer ? ' · Camada' : ' na frente'}`
    : variant === 'merged' ? 'Teclado ativado · em qualquer lugar'
    : 'Teclado ativado · nenhum jogo na frente';
  const tip = !enabled ? 'Desativado: nenhuma tecla muda, em jogo nenhum.'
    : paused ? 'Ativado, mas pausado enquanto os atalhos estão desativados.'
    : 'Com um jogo na frente, as teclas dele mudam como no Teclado. Desativar volta todas ao normal na hora e solta o que estava segurado.';
  return (
    <button
      type="button"
      className="sb-switch"
      aria-pressed={enabled}
      data-paused={paused || (front && !front.on) ? '' : undefined}
      data-playing={playing && !layer ? '' : undefined}
      data-layer={layer ? '' : undefined}
      data-tip={tip}
      onClick={() => useMk.setState({ enabled: !enabled })}
    >
      <span className="sb-dot" />
      {text}
    </button>
  );
}
