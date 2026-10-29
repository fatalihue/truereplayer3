import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ClipboardPaste, Copy, FileUp, Trash2 } from 'lucide-react';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
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
  const tt = useTt();
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
      { label: 'Paste a table…', icon: ClipboardPaste, tip: tt('The table as text: paste a spreadsheet’s rows over it, or edit it in bulk', 'A tabela como texto: cole as linhas de uma planilha por cima ou edite tudo de uma vez'), onSelect: () => openPaste() },
      { label: 'Import CSV…', icon: FileUp, tip: tt('A .csv, .tsv or .txt file; ; , and tab separate the columns', 'Um arquivo .csv, .tsv ou .txt; ; , e tab separam as colunas'), onSelect: () => fileRef.current?.click() },
    ]
    : [
      {
        label: 'Copy table',
        icon: Copy,
        disabled: !hasTable,
        tip: tt('As tab-separated text, ready to paste in a spreadsheet', 'Como texto separado por tab, pronto para colar numa planilha'),
        onSelect: () => {
          navigator.clipboard?.writeText(tableText()).then(
            () => showToast(tt('Table copied', 'Tabela copiada'), 'success'),
            () => showToast(tt('Could not copy — click inside the window and try again.', 'Não foi possível copiar — clique dentro da janela e tente de novo.'), 'error'),
          );
        },
      },
      'separator',
      {
        label: 'Clear table',
        icon: Trash2,
        confirm: 'Confirm clear',
        disabled: !hasTable,
        onSelect: () => {
          if (ops.clear()) showToast(tt('Table cleared', 'Tabela apagada'), { type: 'success', action: { label: 'Undo', onClick: () => cmds.undo({}) } });
        },
      },
    ];

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    readTableFile(file).then(
      (text) => { if (text !== '') openPaste(text); },
      () => showToast(tt('Could not read that file.', 'Não foi possível ler esse arquivo.'), 'error'),
    );
  };

  // A group, not a toolbar of one Tab stop (D2): the search box keeps the arrows for its text.
  return (
    <div role="group" aria-label="Table tools" className="ins-tools dl-tools">
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
        Paste or import
        <span className="step-icon dl-caret" data-icon="chevron-down" />
      </button>
      <button
        type="button"
        className="ins-icon"
        aria-label="More table actions"
        aria-haspopup="menu"
        aria-expanded={menu?.which === 'more'}
        data-tip={tt('More table actions', 'Mais ações da tabela')}
        disabled={!!paste}
        onClick={(e) => toggle('more', e.currentTarget)}
      >
        <span className="step-icon" data-icon="ellipsis" />
      </button>
      {narrow && (
        <button
          type="button"
          className="ins-icon"
          aria-label="Data Loop settings"
          aria-pressed={asked}
          data-tip={tt('How replay uses the rows, and the columns’ tokens', 'Como o replay usa as linhas, e os tokens das colunas')}
          onClick={() => useUi.setState({ dataSettings: !asked })}
        >
          <span className="step-icon" data-icon="sliders-horizontal" />
        </button>
      )}
      <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" hidden onChange={onFile} />
      {menu && (
        <Menu
          anchor={menu.anchor}
          label={menu.which === 'paste' ? 'Paste or import' : 'More table actions'}
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
  const tt = useTt();
  // The term applies a moment after the typing (each one lights cells all over the table).
  useEffect(() => {
    if (find === term) return;
    const t = window.setTimeout(() => useDataTab.setState({ term: find, hit: -1 }), 120);
    return () => window.clearTimeout(t);
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
        aria-label="Find in table"
        placeholder="Find in table"
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
          {matches.length === 0 ? 'No matches' : hit >= 0 ? `${hit + 1} of ${matches.length}` : matches.length === 1 ? '1 row' : `${matches.length} rows`}
        </span>
      )}
      {term.trim() !== '' && matches.length > 0 && (
        <>
          <button type="button" className="dl-find-step" data-nav="" aria-label="Previous match" data-tip={tt('Previous (Shift+Enter)', 'Anterior (Shift+Enter)')} onClick={() => jump(-1)}>
            <span className="step-icon" data-icon="chevron-up" />
          </button>
          <button type="button" className="dl-find-step" data-nav="" aria-label="Next match" data-tip={tt('Next (Enter)', 'Próximo (Enter)')} onClick={() => jump(1)}>
            <span className="step-icon" data-icon="chevron-down" />
          </button>
        </>
      )}
      {find !== '' && (
        <button type="button" className="dl-find-step" aria-label="Clear search" onClick={() => useDataTab.setState({ find: '', term: '', hit: -1 })}>
          <span className="step-icon" data-icon="x" />
        </button>
      )}
    </div>
  );
}
