// Teclado (branch teclado): what only the unified path gives. The macro open in TR3's editor says
// which game keys use it, beside its Trigger and its Automation, and leads to the key on the Keyboard.
import { Keyboard } from 'lucide-react';
import { t } from '../../i18n';
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
    if (u) useMk.setState({ open: u.id, view: u.layer ? 'layer' : 'base', key: u.code, device: u.code.startsWith('Mouse') || u.code.startsWith('Wheel') ? 'mouse' : 'keyboard' });
    openPage('teclado');
  };
  return (
    <div className="mset-group">
      <span className="mset-title">{t('teclado.section.title')}</span>
      {uses.length === 0 ? (
        <div className="mset-target" data-none="">
          <span className="mset-target-text">
            <span className="mset-target-name">{t('teclado.section.none')}</span>
            <span className="mset-target-sub">{t('teclado.section.noneSub')}</span>
          </span>
          <button type="button" className="insp-link" onClick={() => go()}>{t('common.actions.open')}</button>
        </div>
      ) : uses.map(u => (
        <div key={`${u.id}-${u.layer}-${u.code}`} className="mset-target mset-auto">
          <span className="mset-auto-icon" data-tone="ok" aria-hidden="true"><Keyboard /></span>
          <span className="mset-target-text">
            <span className="mset-auto-name">
              {u.layer ? t('teclado.section.useLayer', { game: u.game, key: legendOf(u.code) }) : t('teclado.section.use', { game: u.game, key: legendOf(u.code) })}
            </span>
            <span className="mset-target-sub">{t('teclado.section.sub', { mode: MODES.find(m => m.value === u.mode)?.label ?? MODES[0].label })}</span>
          </span>
          <button type="button" className="insp-link" onClick={() => go(u)}>{t('common.actions.open')}</button>
        </div>
      ))}
    </div>
  );
}
