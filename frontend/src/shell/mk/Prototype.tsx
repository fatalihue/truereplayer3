// Teclado (branch teclado): the dashed card that is NOT part of the design, until phase 5. It switches
// the Key Remaps variant, which waits for the owner (A or B), and simulates what phase 2 brings from
// the engine: the game in front and the layer key held.
import { FlaskConical, Minus } from 'lucide-react';
import { t } from '../../i18n';
import { Segmented } from '../inspector/fields';
import { openPage, useUi } from '../ui';
import { EVERYWHERE, legendOf } from './mkModel';
import { layerKeyOf, listedGames, openGame, useMk, type Variant } from './mkStore';
import '../inspector/editors.css';
import './prototype.css';

if (import.meta.env.DEV) (window as unknown as { __mk: typeof useMk }).__mk = useMk;

export function Prototype() {
  const folded = useMk(s => s.protoFolded);
  const variant = useMk(s => s.variant);
  const games = useMk(s => s.games);
  const front = useMk(s => s.front);
  const holding = useMk(s => s.holding);
  if (folded) {
    return (
      <button type="button" className="mk-proto-pill" onClick={() => useMk.setState({ protoFolded: false })}>
        <FlaskConical aria-hidden="true" />
        {t('teclado.proto.pill')}
      </button>
    );
  }
  const listed = listedGames({ games, variant }).slice(0, 5);
  const frontGame = listed.find(g => g.id === front) ?? null;
  const layerKey = layerKeyOf(frontGame);
  const setVariant = (v: Variant) => {
    const s = useMk.getState();
    useMk.setState({ variant: v, key: null });
    if (v === 'merged' && useUi.getState().page === 'remaps') {
      openPage('teclado');
      openGame(EVERYWHERE);
    }
    if (v === 'beside') {
      const firstGame = s.games.find(g => !g.app)?.id ?? '';
      if (s.open === EVERYWHERE || s.games.find(g => g.id === s.open)?.app) openGame(firstGame);
      if (s.games.find(g => g.id === s.front)?.app) useMk.setState({ front: null, holding: false });
    }
  };
  return (
    <aside className="mk-proto" aria-label={t('teclado.proto.label')}>
      <div className="mk-proto-head">
        <FlaskConical aria-hidden="true" />
        <span className="mk-proto-title">{t('teclado.proto.title')}</span>
        <button type="button" className="mk-proto-fold" aria-label={t('teclado.proto.fold')} onClick={() => useMk.setState({ protoFolded: true })}>
          <Minus aria-hidden="true" />
        </button>
      </div>
      <div className="mk-proto-row">
        <span className="mk-proto-label">{t('teclado.proto.remaps')}</span>
        <Segmented<Variant> label={t('teclado.proto.remaps')} value={variant} onChange={setVariant}
          options={[{ value: 'beside', label: t('teclado.proto.beside') }, { value: 'merged', label: t('teclado.proto.merged') }]} />
      </div>
      <div className="mk-proto-row">
        <span className="mk-proto-label">{t('teclado.proto.front')}</span>
        <Segmented<string> label={t('teclado.proto.front')} value={front ?? 'none'} wrap
          onChange={(v) => useMk.setState({ front: v === 'none' ? null : v, holding: false })}
          options={[
            { value: 'none', label: t('teclado.proto.none') },
            ...listed.map(g => ({ value: g.id, label: g.on ? g.name : t('teclado.proto.gameOff', { game: g.name }) })),
          ]} />
      </div>
      <div className="mk-proto-row">
        <span className="mk-proto-label">{t('teclado.proto.holding')}</span>
        <Segmented<string> label={t('teclado.proto.holding')} value={holding ? 'held' : 'free'} disabled={!layerKey}
          onChange={(v) => useMk.setState({ holding: v === 'held' })}
          options={[
            { value: 'free', label: t('teclado.proto.free') },
            { value: 'held', label: t('teclado.proto.held', { key: legendOf(layerKey ?? 'CapsLock') }) },
          ]} />
      </div>
      <p className="mk-proto-foot">{t('teclado.proto.foot')}</p>
    </aside>
  );
}
