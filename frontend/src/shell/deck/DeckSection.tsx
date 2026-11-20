// Deck (branch deck, Fase 5): what only the unified path gives. The macro open in TR3's editor says which
// deck buttons run it, beside its Trigger, its Automation and its Teclado keys, and leads to the button on
// the Deck page (the Teclado's section does the same for game keys). Fase 6: "Add to a deck" puts a button
// for it on a deck, at the first free place.
import { useState } from 'react';
import { LayoutGrid, Plus } from 'lucide-react';
import { t } from '../../i18n';
import { useToast } from '../../state/ToastContext';
import { freeName } from '../library/model';
import { Menu, type MenuEntry } from '../Menu';
import { anchorBelow, type MenuAnchor } from '../menuAnchor';
import { openPage } from '../ui';
import { addMacroTile, createDeck, hasRoom } from './deckEdit';
import { DECK_LIMITS, type DeckView } from './deckModel';
import { useDeck, useDeckSync } from './deckStore';
import { goToTile } from './deckUi';

interface Use { deckId: string; deck: string; view: DeckView; where: string; slot: number; label?: string }

export function DeckSection({ name }: { name: string }) {
  // The decks come only where they are shown (rule 6): this section asks for them as it mounts.
  useDeckSync();
  const decks = useDeck(s => s.config.decks);
  const loaded = useDeck(s => s.loaded);
  const { showToast } = useToast();
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
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
  // A button for this macro at the deck's first free place; the toast leads to it.
  const add = (deckId: string) => {
    const deck = useDeck.getState().config.decks.find(d => d.id === deckId);
    const at = addMacroTile(deckId, name);
    if (!deck || !at) return;
    showToast(t('deck.section.added', { deck: deck.name, n: at.page + 1 }), {
      type: 'success', duration: 8000,
      action: { label: t('common.actions.open'), onClick: () => go({ deckId, deck: deck.name, view: { kind: 'page', index: at.page }, where: '', slot: at.slot }) },
    });
  };
  const addToNew = () => {
    const deck = createDeck(freeName(t('deck.list.newName'), useDeck.getState().config.decks.map(d => d.name)));
    if (deck) add(deck.id);
  };
  const entries: MenuEntry[] = [
    ...decks.map((d): MenuEntry => {
      const full = !hasRoom(d);
      return { label: d.name, disabled: full, tip: full ? t('deck.section.full') : undefined, onSelect: () => add(d.id) };
    }),
    ...(decks.length > 0 ? ['separator' as const] : []),
    {
      label: t('deck.section.newDeck'), icon: Plus, disabled: decks.length >= DECK_LIMITS.decks,
      tip: decks.length >= DECK_LIMITS.decks ? t('deck.list.full', { max: DECK_LIMITS.decks }) : undefined, onSelect: addToNew,
    },
  ];
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
      <div className="insp-line">
        <button type="button" className="insp-button mset-add" disabled={!loaded} aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'start'), button: e.currentTarget })}>
          <Plus aria-hidden="true" />
          {t('deck.section.add')}
        </button>
      </div>
      {menu && <Menu anchor={menu.anchor} label={t('deck.section.add')} toggle={menu.button} onClose={() => setMenu(null)} entries={entries} />}
    </div>
  );
}
