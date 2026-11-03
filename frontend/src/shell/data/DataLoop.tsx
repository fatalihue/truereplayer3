import { useEffect, useRef } from 'react';
import { t } from '../../i18n';
import { useEditorClaim } from '../../logic/useEditorClaim';
import { useToast } from '../../state/ToastContext';
import { clickerOnNote } from '../library/model';
import { useApp } from '../store';
import { useUi } from '../ui';
import { DataGrid } from './DataGrid';
import { DataPaste } from './DataPaste';
import { CUT, openPaste, readTableFile, useDataOps, useDataTab, useShown } from './model';
import '../inspector/editors.css';
import './dataLoop.css';
import './dataIcons.css';

export { DataTools } from './DataTools';
export { DataSettings } from './DataSettings';

/**
 * ⑥ The Data Loop tab (casca-009, casca-059, paineis-080): the open macro's table, where the steps
 * were. It follows the macro that is open — another one shows its own table, and nothing is lost,
 * since every change is saved as it is made (decision 2). While a run, a recording or the Clicker is
 * on it is read-only.
 *
 * No table yet, it says what a table is for and how to start one (paineis-097 to 099, brought
 * forward from phase 5: the tab needs them from its first day).
 */
export function DataMain() {
  const shown = useShown();
  const paste = useDataTab(s => s.paste);
  const editing = useDataTab(s => s.editing);
  const status = useApp(a => a.status);
  const clicker = useApp(a => a.settings.useCursorClick);
  const locked = status !== 'ready' || clicker;
  // No columns, no table (a list of rows with no cells has nothing to show either).
  const empty = shown.headers.length === 0;
  const cursorMode = !shown.loopOverData;
  // Typing that has not reached the engine yet (an open cell, a paste not applied) holds the
  // automations back, as the Inspector's fields do (D12).
  const pending = editing !== null || (!!paste && paste.text.trim() !== '' && paste.text !== paste.prefill);
  useEditorClaim('data-panel', pending);

  // The dock's line on this tab: the open cell's keys, else what a click on a row number does.
  const hint = editing?.kind === 'cell' ? t('dataLoop.hint.cell')
    : editing?.kind === 'header' ? t('dataLoop.hint.header')
    : !paste && !empty && cursorMode && shown.saved > 0 && !locked ? t('dataLoop.hint.cursor')
    : null;
  useEffect(() => { useUi.setState({ dataHint: hint }); }, [hint]);
  useEffect(() => () => { useUi.setState({ dataHint: null }); }, []);

  return (
    <div id="macro-panel-data" role="tabpanel" aria-labelledby="macro-tab-data" className="dl-panel" tabIndex={-1}>
      {paste ? <DataPaste draft={paste} locked={locked} /> : empty ? <DataEmpty locked={locked} /> : <DataGrid locked={locked} />}
    </div>
  );
}

/**
 * No table yet (the concept's EmptyStates): what a table does, then the ways to start one — paste
 * a spreadsheet's rows (Ctrl+V here pastes them), import a CSV, start an empty table, or the sample.
 */
function DataEmpty({ locked }: { locked: boolean }) {
  const ops = useDataOps();
  const macro = useApp(a => a.activeProfile) ?? '';
  const clicker = useApp(a => a.settings.useCursorClick);
  const modeKey = useApp(a => a.settings.modeToggleHotkey);
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // Ctrl+V on the tab, outside a field: the rows pasted, in the paste surface to look over first.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (locked) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.trim() === '') return;
      e.preventDefault();
      openPaste(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [locked]);

  const note = clicker ? clickerOnNote(modeKey) : t('dataLoop.empty.readOnly');
  // The example token, in <code>, where the catalog's sentence puts it.
  const [before, after = ''] = t('dataLoop.empty.text', { token: CUT }).split(CUT);
  return (
    <div className="dl-empty">
      <span className="step-icon dl-empty-icon" data-icon="table-2" />
      <p className="dl-empty-title">{t('dataLoop.noTable')}</p>
      <p className="dl-empty-text">
        {before}<code>{'{row:name}'}</code>{after}
      </p>
      {locked ? (
        <p className="dl-empty-text">{note}</p>
      ) : (
        <>
          <div className="dl-empty-actions">
            <button type="button" className="insp-button dl-primary" onClick={() => openPaste('')}>
              {t('dataLoop.empty.paste')} <kbd className="kbd">Ctrl+V</kbd>
            </button>
            <button type="button" className="insp-button" onClick={() => fileRef.current?.click()}>{t('dataLoop.importCsv')}</button>
          </div>
          <div className="dl-empty-actions">
            <button
              type="button"
              className="insp-link"
              onClick={() => {
                ops.startEmpty();
                useDataTab.setState({ editing: { kind: 'header', c: 0, macro }, active: { r: -1, c: 0 } });
              }}
            >
              {t('dataLoop.empty.startEmpty')}
            </button>
            <span className="dl-empty-sep" aria-hidden="true">·</span>
            <button
              type="button"
              className="insp-link"
              data-tip={t('dataLoop.empty.sampleTip')}
              onClick={() => ops.useSample()}
            >
              {t('dataLoop.empty.sample')}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              readTableFile(file).then(
                (text) => { if (text !== '') openPaste(text); },
                () => showToast(t('dataLoop.readFailed'), 'error'),
              );
            }}
          />
        </>
      )}
    </div>
  );
}
