import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ClipboardPaste, Copy, FileUp, Trash2 } from 'lucide-react';
import { fmtNum, t } from '../../i18n';
import { useSteps } from '../../logic/useSteps';
import { useToast } from '../../state/ToastContext';
import { Menu, type MenuEntry } from '../Menu';
import { anchorBelow, type MenuAnchor } from '../menuAnchor';
import { useUi } from '../ui';
import { useShellBand } from '../useShellBand';
import { matchingRows, openPaste, readTableFile, tableText, useDataOps, useDataTab, useShown } from './model';

/**
 * The Data Loop tab's tools, in the insert row (the concept's "Table tools"): Find in table, Paste
 * or import ▾ (paste a table, import a CSV) and the table's ⋯ (Copy table, Clear table). Below
 * 1024 px, where the settings do not fit beside the table, a button brings them over it.
 */
export function DataTools() {
  const shown = useShown();
  const paste = useDataTab(s => s.paste);
  const band = useShellBand();
  const asked = useUi(s => s.dataSettings);
  const [menu, setMenu] = useState<{ which: 'paste' | 'more'; anchor: MenuAnchor; button: HTMLElement } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ops = useDataOps();
  const cmds = useSteps();
  const { showToast } = useToast();
  const hasTable = shown.headers.length > 0 || shown.saved > 0;
  const narrow = band !== 'wide' && band !== 'fold';

  const toggle = (which: 'paste' | 'more', button: HTMLElement) => {
    if (menu?.which === which) setMenu(null);
    else setMenu({ which, anchor: anchorBelow(button, 'end'), button });
  };
  const entries: MenuEntry[] = menu?.which === 'paste'
    ? [
      { label: t('dataLoop.tools.pasteTable'), icon: ClipboardPaste, tip: t('dataLoop.tools.pasteTableTip'), onSelect: () => openPaste() },
      { label: t('dataLoop.importCsv'), icon: FileUp, tip: t('dataLoop.tools.importTip'), onSelect: () => fileRef.current?.click() },
    ]
    : [
      {
        label: t('dataLoop.tools.copyTable'),
        icon: Copy,
        disabled: !hasTable,
        tip: t('dataLoop.tools.copyTableTip'),
        onSelect: () => {
          navigator.clipboard?.writeText(tableText()).then(
            () => showToast(t('dataLoop.tools.copied'), 'success'),
            () => showToast(t('dataLoop.copyFailed'), 'error'),
          );
        },
      },
      'separator',
      {
        label: t('dataLoop.tools.clearTable'),
        icon: Trash2,
        confirm: t('dataLoop.tools.clearConfirm'),
        disabled: !hasTable,
        onSelect: () => {
          if (ops.clear()) showToast(t('dataLoop.tools.cleared'), { type: 'success', action: { label: t('common.actions.undo'), onClick: () => cmds.undo({}) } });
        },
      },
    ];

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    readTableFile(file).then(
      (text) => { if (text !== '') openPaste(text); },
      () => showToast(t('dataLoop.readFailed'), 'error'),
    );
  };

  // A group, not a toolbar of one Tab stop (D2): the search box keeps the arrows for its text.
  return (
    <div role="group" aria-label={t('dataLoop.tools.label')} className="ins-tools dl-tools">
      <FindBox rows={shown.rows} disabled={!!paste} />
      <button
        type="button"
        className="ins-quick dl-tool"
        aria-haspopup="menu"
        aria-expanded={menu?.which === 'paste'}
        disabled={!!paste}
        onClick={(e) => toggle('paste', e.currentTarget)}
      >
        <span className="step-icon" data-icon="clipboard-paste" />
        {t('dataLoop.pasteOrImport')}
        <span className="step-icon dl-caret" data-icon="chevron-down" />
      </button>
      <button
        type="button"
        className="ins-icon"
        aria-label={t('dataLoop.tools.more')}
        aria-haspopup="menu"
        aria-expanded={menu?.which === 'more'}
        data-tip={t('dataLoop.tools.more')}
        disabled={!!paste}
        onClick={(e) => toggle('more', e.currentTarget)}
      >
        <span className="step-icon" data-icon="ellipsis" />
      </button>
      {narrow && (
        <button
          type="button"
          className="ins-icon"
          aria-label={t('dataLoop.settings.open')}
          aria-pressed={asked}
          data-tip={t('dataLoop.settings.openTip')}
          onClick={() => useUi.setState({ dataSettings: !asked })}
        >
          <span className="step-icon" data-icon="sliders-horizontal" />
        </button>
      )}
      <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" hidden onChange={onFile} />
      {menu && (
        <Menu
          anchor={menu.anchor}
          label={menu.which === 'paste' ? t('dataLoop.pasteOrImport') : t('dataLoop.tools.more')}
          entries={entries}
          toggle={menu.button}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/**
 * Find in table (paineis-093 to 096): it lights the cells that hold the term, the row it points at
 * with a ring, and hides no row. Enter goes to the next match and Shift+Enter to the one before;
 * the count says how many rows match and which one is shown.
 */
function FindBox({ rows, disabled }: { rows: string[][]; disabled: boolean }) {
  const find = useDataTab(s => s.find);
  const term = useDataTab(s => s.term);
  const hit = useDataTab(s => s.hit);
  // The term applies a moment after the typing (each one lights cells all over the table).
  useEffect(() => {
    if (find === term) return;
    const timer = window.setTimeout(() => useDataTab.setState({ term: find, hit: -1 }), 120);
    return () => window.clearTimeout(timer);
  }, [find, term]);
  const matches = matchingRows(rows, term);
  const jump = (delta: 1 | -1) => {
    const now = useDataTab.getState();
    const applied = now.find;
    const list = matchingRows(rows, applied);
    if (list.length === 0) {
      useDataTab.setState({ term: applied, hit: -1 });
      return;
    }
    // A term not applied yet starts from its first match (Shift+Enter: its last).
    const from = applied === now.term ? now.hit : -1;
    const next = from < 0 ? (delta > 0 ? 0 : list.length - 1) : ((from + delta) % list.length + list.length) % list.length;
    useDataTab.setState({ term: applied, hit: next });
  };
  return (
    <div className="dl-find" data-disabled={disabled || undefined}>
      <span className="step-icon" data-icon="search" />
      <input
        type="text"
        value={find}
        disabled={disabled}
        aria-label={t('dataLoop.find.label')}
        placeholder={t('dataLoop.find.placeholder')}
        spellCheck={false}
        // Emptied, the search ends at once; a term applies a moment after the typing.
        onChange={(e) => useDataTab.setState(e.target.value === '' ? { find: '', term: '', hit: -1 } : { find: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            jump(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape' && find !== '') {
            e.preventDefault();
            e.stopPropagation();
            useDataTab.setState({ find: '', term: '', hit: -1 });
          }
        }}
      />
      {term.trim() !== '' && (
        <span className="dl-find-count" aria-live="polite">
          {hit >= 0 && matches.length > 0
            ? t('dataLoop.find.hitOf', { number: hit + 1, total: fmtNum(matches.length) })
            : t('dataLoop.find.found', { count: matches.length, n: fmtNum(matches.length) })}
        </span>
      )}
      {term.trim() !== '' && matches.length > 0 && (
        <>
          <button type="button" className="dl-find-step" data-nav="" aria-label={t('dataLoop.find.previous')} data-tip={t('dataLoop.find.previousTip')} onClick={() => jump(-1)}>
            <span className="step-icon" data-icon="chevron-up" />
          </button>
          <button type="button" className="dl-find-step" data-nav="" aria-label={t('dataLoop.find.next')} data-tip={t('dataLoop.find.nextTip')} onClick={() => jump(1)}>
            <span className="step-icon" data-icon="chevron-down" />
          </button>
        </>
      )}
      {find !== '' && (
        <button type="button" className="dl-find-step" aria-label={t('common.actions.clearSearch')} onClick={() => useDataTab.setState({ find: '', term: '', hit: -1 })}>
          <span className="step-icon" data-icon="x" />
        </button>
      )}
    </div>
  );
}
