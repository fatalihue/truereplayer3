// PROTÓTIPO MK (ver mkModel.ts): o que só o caminho unificado dá. A macro aberta no editor do TR3 diz
// em que teclas de jogo ela está, ao lado do Gatilho e da Automação, e leva até a tecla no Teclado.
import { Keyboard } from 'lucide-react';
import { openPage } from '../ui';
import { legendOf, MODES } from './mkModel';
import { listedGames, useMk } from './mkStore';

export function TecladoSection({ name }: { name: string }) {
  const games = useMk(s => s.games);
  const variant = useMk(s => s.variant);
  const uses: { game: string; id: string; code: string; layer: boolean; mode?: string }[] = [];
  for (const g of listedGames({ games, variant })) {
    for (const [side, keys] of [['base', g.base], ['layer', g.layer]] as const) {
      for (const [code, fn] of Object.entries(keys)) {
        if (fn.kind === 'macro' && fn.macro === name) uses.push({ game: g.name, id: g.id, code, layer: side === 'layer', mode: fn.mode });
      }
    }
  }
  const go = (u?: (typeof uses)[number]) => {
    if (u) useMk.setState({ open: u.id, view: u.layer ? 'layer' : 'base', key: u.code, device: 'keyboard' });
    openPage('teclado');
  };
  return (
    <div className="mset-group">
      <span className="mset-title">Teclado</span>
      {uses.length === 0 ? (
        <div className="mset-target" data-none="">
          <span className="mset-target-text">
            <span className="mset-target-name">Em nenhuma tecla de jogo</span>
            <span className="mset-target-sub">Dê esta macro a uma tecla no Teclado</span>
          </span>
          <button type="button" className="insp-link" onClick={() => go()}>Abrir</button>
        </div>
      ) : uses.map(u => (
        <div key={`${u.id}-${u.layer}-${u.code}`} className="mset-target mset-auto">
          <span className="mset-auto-icon" data-tone="ok" aria-hidden="true"><Keyboard /></span>
          <span className="mset-target-text">
            <span className="mset-auto-name">{u.game} · {legendOf(u.code)}{u.layer ? ' na Camada' : ''}</span>
            <span className="mset-target-sub">{MODES.find(m => m.value === u.mode)?.label ?? 'Uma vez'} · começa no apertar</span>
          </span>
          <button type="button" className="insp-link" onClick={() => go(u)}>Abrir</button>
        </div>
      ))}
    </div>
  );
}
