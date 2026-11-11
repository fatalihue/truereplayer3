// PROTÓTIPO MK (ver mkModel.ts): o cartão tracejado que NÃO faz parte do desenho. Deixa o dono
// trocar a variante dos Key Remaps e simular o que só o motor saberia: o jogo na frente e a camada.
import { FlaskConical, Minus } from 'lucide-react';
import { Segmented } from '../inspector/fields';
import { openPage, useUi } from '../ui';
import { EVERYWHERE } from './mkModel';
import { openGame, useMk, type Variant } from './mkStore';
import '../inspector/editors.css';
import './prototype.css';

if (import.meta.env.DEV) (window as unknown as { __mk: typeof useMk }).__mk = useMk;

export function Prototype() {
  const folded = useMk(s => s.protoFolded);
  const variant = useMk(s => s.variant);
  const front = useMk(s => s.front);
  const holding = useMk(s => s.holding);
  const hasLayer = useMk(s => s.games.some(g => g.id === s.front && Object.values(g.base).some(f => f.kind === 'layer')));
  if (folded) {
    return (
      <button type="button" className="mk-proto-pill" onClick={() => useMk.setState({ protoFolded: false })}>
        <FlaskConical aria-hidden="true" />Protótipo
      </button>
    );
  }
  const setVariant = (v: Variant) => {
    const s = useMk.getState();
    useMk.setState({ variant: v, key: null });
    if (v === 'merged' && useUi.getState().page === 'remaps') {
      openPage('teclado');
      openGame(EVERYWHERE);
    }
    if (v === 'beside' && (s.open === EVERYWHERE || s.games.find(g => g.id === s.open)?.app)) openGame('roblox');
    if (v === 'beside' && s.games.find(g => g.id === s.front)?.app) useMk.setState({ front: null, holding: false });
  };
  return (
    <aside className="mk-proto" aria-label="Controles do protótipo">
      <div className="mk-proto-head">
        <FlaskConical aria-hidden="true" />
        <span className="mk-proto-title">Protótipo · não faz parte do desenho</span>
        <button type="button" className="mk-proto-fold" aria-label="Recolher o protótipo" onClick={() => useMk.setState({ protoFolded: true })}>
          <Minus aria-hidden="true" />
        </button>
      </div>
      <div className="mk-proto-row">
        <span className="mk-proto-label">Key Remaps</span>
        <Segmented<Variant> label="Key Remaps" value={variant} onChange={setVariant}
          options={[{ value: 'beside', label: 'A · ao lado' }, { value: 'merged', label: 'B · viram o teclado' }]} />
      </div>
      <div className="mk-proto-row">
        <span className="mk-proto-label">Jogo na frente (simulado)</span>
        <Segmented<string> label="Jogo na frente" value={front ?? 'none'} wrap
          onChange={(v) => useMk.setState({ front: v === 'none' ? null : v, holding: false })}
          options={[
            { value: 'none', label: 'Nenhum' },
            { value: 'roblox', label: 'Roblox' },
            { value: 'minecraft', label: 'Minecraft' },
            { value: 'terraria', label: 'Terraria (desl.)' },
          ]} />
      </div>
      <div className="mk-proto-row">
        <span className="mk-proto-label">Tecla de camada (simulado)</span>
        <Segmented<string> label="Tecla de camada" value={holding ? 'held' : 'free'} disabled={!hasLayer}
          onChange={(v) => useMk.setState({ holding: v === 'held' })}
          options={[{ value: 'free', label: 'Solta' }, { value: 'held', label: 'Segurando Caps' }]} />
      </div>
      <p className="mk-proto-foot">Dados de exemplo, sem motor: nada é gravado.</p>
    </aside>
  );
}
