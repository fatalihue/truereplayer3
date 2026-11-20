// Deck (branch deck, Fase 5): what only the unified path gives. The macro open in TR3's editor says which
// deck buttons run it, beside its Trigger, its Automation and its Teclado keys, and leads to the button on
// the Deck page (the Teclado's section does the same for game keys).
import { LayoutGrid } from 'lucide-react';
import { t } from '../../i18n';
import { openPage } from '../ui';
import type { DeckView } from './deckModel';
import { useDeck, useDeckSync } from './deckStore';
import { goToTile } from './deckUi';

interface Use { deckId: string; deck: string; view: DeckView; where: string; slot: number; label?: string }

export function DeckSection({ name }: { name: string }) {
  // The decks come only where they are shown (rule 6): this section asks for them as it mounts.
  useDeckSync();
  const decks = useDeck(s => s.config.decks);
  const uses: Use[] = [];
  for (const d of decks) {
    d.pages.forEach((p, i) => {
      for (const tile of p.tiles) {
        if (tile.action.kind === 'macro' && tile.action.macro === name)
          uses.push({ deckId: d.id, deck: d.name, view: { kind: 'page', index: i }, where: t('deck.section.page', { n: i + 1 }), slot: tile.slot, label: tile.label });
      }
    });
    for (const f of d.folders) {
      for (const tile of f.tiles) {
        if (tile.action.kind === 'macro' && tile.action.macro === name)
          uses.push({ deckId: d.id, deck: d.name, view: { kind: 'folder', id: f.id }, where: t('deck.section.folder', { folder: f.name || t('deck.folder.unnamed') }), slot: tile.slot, label: tile.label });
      }
    }
  }
  const go = (u?: Use) => {
    if (u) goToTile(u.deckId, u.view, u.slot);
    openPage('deck');
  };
  return (
    <div className="mset-group">
      <span className="mset-title">{t('deck.section.title')}</span>
      {uses.length === 0 ? (
        <div className="mset-target" data-none="">
          <span className="mset-target-text">
            <span className="mset-target-name">{t('deck.section.none')}</span>
            <span className="mset-target-sub">{t('deck.section.noneSub')}</span>
          </span>
          <button type="button" className="insp-link" onClick={() => go()}>{t('common.actions.open')}</button>
        </div>
      ) : uses.map(u => (
        <div key={`${u.deckId}-${u.view.kind === 'page' ? u.view.index : u.view.id}-${u.slot}`} className="mset-target mset-auto">
          <span className="mset-auto-icon" data-tone="ok" aria-hidden="true"><LayoutGrid /></span>
          <span className="mset-target-text">
            <span className="mset-auto-name">{t('deck.section.use', { deck: u.deck, where: u.where })}</span>
            <span className="mset-target-sub">{u.label ? t('deck.section.subLabel', { label: u.label, n: u.slot + 1 }) : t('deck.section.sub', { n: u.slot + 1 })}</span>
          </span>
          <button type="button" className="insp-link" onClick={() => go(u)}>{t('common.actions.open')}</button>
        </div>
      ))}
    </div>
  );
}
