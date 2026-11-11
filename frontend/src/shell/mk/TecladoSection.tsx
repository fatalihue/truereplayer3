// Teclado (branch teclado): what only the unified path gives. The macro open in TR3's editor says
// which game keys use it, beside its Trigger and its Automation, and leads to the key on the Keyboard.
import { Keyboard } from 'lucide-react';
import { t } from '../../i18n';
import { openPage } from '../ui';
import { currentKeys, legendOf, modeLabel } from './mkModel';
import { layerKeyOf } from './mkEdit';
import { useMk } from './mkStore';

export function TecladoSection({ name }: { name: string }) {
  const games = useMk(s => s.games);
  const uses: { game: string; id: string; code: string; layer: boolean; mode: string }[] = [];
  for (const g of games) {
    // A game's layer without its layer key (the Layer function taken off the base) is kept for when
    // one comes back, but nothing reaches it: its keys are no use of the macro now.
    const sides = layerKeyOf(g) ? [['base', g.base], ['layer', g.layer]] as const : [['base', g.base]] as const;
    for (const [side, keys] of sides) {
      for (const [code, fn] of Object.entries(keys)) {
        if (fn.kind === 'macro' && fn.macro === name) uses.push({ game: g.name, id: g.id, code, layer: side === 'layer', mode: modeLabel(fn.mode, fn.times) });
      }
    }
  }
  const go = (u?: (typeof uses)[number]) => {
    if (u) {
      const mouse = u.code.startsWith('Mouse') || u.code.startsWith('Wheel');
      // A key of the numpad shows only with the numpad on.
      const numpad = !mouse && currentKeys().some(k => k.code === u.code && k.block === 'num');
      useMk.setState({ open: u.id, view: u.layer ? 'layer' : 'base', key: u.code, device: mouse ? 'mouse' : 'keyboard', ...(numpad ? { numpad: true } : {}) });
    }
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
            <span className="mset-target-sub">{t('teclado.section.sub', { mode: u.mode })}</span>
          </span>
          <button type="button" className="insp-link" onClick={() => go(u)}>{t('common.actions.open')}</button>
        </div>
      ))}
    </div>
  );
}
