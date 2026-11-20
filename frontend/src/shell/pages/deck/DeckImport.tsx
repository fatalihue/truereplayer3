// Deck (branch deck, Fase 7; plan .claude/planos/deck-2026-11-19.md): the warning before a .trdeck comes in, when
// some of its buttons open a program, a file or an address, or type a text — the idea of the macros' security
// warning (SecurityWarningModal): a click on such a button does what it says, so it is read first. A file without
// them comes in at once (deckStore.hearPreview).
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, ExternalLink, FolderOpen, Type } from 'lucide-react';
import { DialogFooter, DialogShell } from '../../../components/common/DialogShell';
import { fmtNum, LANG, t } from '../../../i18n';
import { DECK_LIMITS } from '../../deck/deckModel';
import { answerImport, useDeck } from '../../deck/deckStore';

/** What a list shows before "and N more": enough to judge the file, short enough to read. */
const SHOWN = 6;

/** A text on one line, the line breaks shown, cut at a readable length. */
const oneLine = (text: string) => {
  const flat = text.replace(/\r?\n/g, ' ⏎ ').replace(/\t/g, ' ⇥ ');
  return flat.length > 120 ? flat.slice(0, 119) + '…' : flat;
};

function List({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: { label?: string; value: string }[] }) {
  const rest = items.length - SHOWN;
  return (
    <div className="dk-import-list">
      <span className="dk-import-title">{title}</span>
      <ul>
        {items.slice(0, SHOWN).map((item, i) => (
          <li key={i}>
            <Icon aria-hidden="true" />
            {item.label && <span className="dk-import-label">{item.label}</span>}
            <span className="dk-import-value">{item.value}</span>
          </li>
        ))}
      </ul>
      {rest > 0 && <span className="dk-import-more">{t('deck.file.more', { count: rest, n: fmtNum(rest) })}</span>}
    </div>
  );
}

export function DeckImportDialog() {
  const ask = useDeck(s => s.importAsk);
  if (!ask) return null;
  const opens = ask.decks.flatMap(d => d.opens).map(o => ({ label: o.label, value: o.args ? `${o.target} ${o.args}` : o.target }));
  const texts = ask.decks.flatMap(d => d.texts).map(x => ({ label: x.label, value: oneLine(x.text) }));
  const missing = [...new Set(ask.decks.flatMap(d => d.missingMacros))];
  const buttons = ask.decks.reduce((n, d) => n + d.buttons, 0);
  const full = ask.room <= 0;
  const no = () => answerImport(false);
  // On the body, as the shell's dialogs (Overlays): inside the page, the shell's container query would hold the
  // fixed scrim in the page's own layer, under the deck drawn there.
  return createPortal(
    <DialogShell
      icon={<AlertTriangle size={14} style={{ color: 'var(--color-warning-ink)' }} />}
      title={t('deck.file.title')}
      size="lg"
      onClose={no}
      // Read before going on: a stray click on the scrim does not dismiss it (Cancel or Esc do).
      closeOnBackdrop={false}
      footer={<DialogFooter secondary={{ label: t('common.actions.cancel'), onClick: no }} primary={{ label: t('deck.file.confirm'), onClick: () => answerImport(true), disabled: full }} />}
    >
      <div className="dk-import">
        <div className="dk-import-file">
          <FolderOpen aria-hidden="true" />
          <span className="dk-import-name">{ask.fileName}</span>
          <span className="dk-import-count">
            · {t('deck.file.decks', { count: ask.decks.length, n: fmtNum(ask.decks.length) })} · {t('deck.file.buttons', { count: buttons, n: fmtNum(buttons) })}
          </span>
        </div>
        <p className="dk-import-intro">{t('deck.file.intro')}</p>
        <div className="warning-band dk-import-band">
          {opens.length > 0 && <List title={t('deck.file.opens')} icon={ExternalLink} items={opens} />}
          {texts.length > 0 && <List title={t('deck.file.texts')} icon={Type} items={texts} />}
        </div>
        {missing.length > 0 && (
          <p className="dk-import-note">{t('deck.file.missing', { names: new Intl.ListFormat(LANG, { type: 'conjunction' }).format(missing) })}</p>
        )}
        {full && <p className="rm-msg" data-tone="warn">{t('deck.file.full', { max: DECK_LIMITS.decks })}</p>}
      </div>
    </DialogShell>,
    document.body,
  );
}
