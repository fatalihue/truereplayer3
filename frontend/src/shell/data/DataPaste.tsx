import { useDeferredValue, useLayoutEffect, useRef } from 'react';
import { parseTsv } from '../../lib/tsv';
import { useTt } from '../../state/LanguageContext';
import { refocusTable, useDataOps, useDataTab, useShown, validName, type PasteDraft } from './model';

/**
 * Paste or import (paineis-127 to 139): the table as text, in place of the grid — a spreadsheet's
 * rows pasted over it, a CSV read into it, or the table edited in bulk. Replace takes the whole
 * table; Append adds the rows under it, by the columns' names (or by position, with no header
 * line). The preview says what Apply will do. Ctrl+Enter applies, Esc and Cancel put it away.
 */
export function DataPaste({ draft, locked }: { draft: PasteDraft; locked: boolean }) {
  const shown = useShown();
  const ops = useDataOps();
  const tt = useTt();
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<PasteDraft>) => {
    const now = useDataTab.getState().paste;
    if (now) useDataTab.setState({ paste: { ...now, ...patch } });
  };
  const close = () => {
    useDataTab.setState({ paste: null });
    refocusTable();
  };
  const apply = () => {
    if (locked) return;
    if (ops.applyPaste(useDataTab.getState().paste ?? draft)) close();
  };
  useLayoutEffect(() => { boxRef.current?.focus({ preventScroll: true }); }, []);

  // The preview follows the typing a moment behind it; Apply reads the box as it is.
  const text = useDeferredValue(draft.text);
  const parsed = parseTsv(text, draft.header);
  const hasTable = shown.headers.length > 0 || shown.saved > 0;
  // Append with no header line fills the table's own columns by position, so those are the ones
  // the preview names.
  const byPosition = draft.mode === 'append' && !draft.header && shown.headers.length > 0;
  const names = byPosition
    ? Array.from({ length: Math.max(shown.headers.length, parsed.headers.length) }, (_, i) => shown.headers[i] ?? parsed.headers[i])
    : parsed.headers;
  const invalid = names.some(h => h && !validName(h));
  const short = parsed.rows.some(r => r.length < names.length);
  const long = parsed.rows.some(r => r.length > names.length);
  const applyLabel = draft.mode === 'replace' ? 'Replace table' : `Append ${parsed.rows.length === 1 ? '1 row' : `${parsed.rows.length} rows`}`;

  return (
    <div
      className="dl-paste"
      role="region"
      aria-label="Paste or import"
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        } else if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          e.stopPropagation();
          apply();
        }
      }}
    >
      <div className="dl-paste-bar">
        <button type="button" className="dl-back" data-tip={tt('Discards this paste', 'Descarta esta colagem')} onClick={close}>
          <span className="step-icon" data-icon="chevron-right" />
          Table
        </button>
        <span className="dl-paste-title">Paste or import</span>
        <div className="insp-seg dl-paste-mode" role="group" aria-label="Paste mode">
          <button type="button" aria-pressed={draft.mode === 'replace'} onClick={() => set({ mode: 'replace' })}>Replace table</button>
          <button
            type="button"
            aria-pressed={draft.mode === 'append'}
            data-tip={tt('Matches columns by name — by position when the first row isn’t the header', 'Casa as colunas pelo nome — pela posição quando a primeira linha não é o cabeçalho')}
            // The box still holding the table itself would append it to itself: it starts empty.
            onClick={() => set(draft.text === draft.prefill ? { mode: 'append', text: '' } : { mode: 'append' })}
          >
            Append rows
          </button>
        </div>
      </div>
      <div className="dl-paste-body">
        <textarea
          ref={boxRef}
          className="dl-paste-box"
          value={draft.text}
          aria-label="Table data, tab-separated"
          spellCheck={false}
          placeholder={'name\temail\tamount\nMaria\tmaria@example.com\t89.90\nJoão\tjoao@example.com\t149.00'}
          onChange={(e) => set({ text: e.target.value })}
        />
        <div className="dl-paste-side">
          <label className="dl-check">
            <input type="checkbox" checked={draft.header} onChange={(e) => set({ header: e.target.checked })} />
            <span
              data-tip={draft.mode === 'append'
                ? tt('Off: every line is data, filled into the columns by position', 'Desligado: toda linha é dado, preenchida nas colunas pela posição')
                : tt('Off: the columns become col1…colN and every line is data', 'Desligado: as colunas viram col1…colN e toda linha é dado')}
            >
              First row is the header
            </span>
          </label>
          <span className="dl-paste-count">
            {names.length === 1 ? '1 column' : `${names.length} columns`} · {parsed.rows.length === 1 ? '1 row' : `${parsed.rows.length} rows`}
          </span>
          {names.length > 0 && (
            <div className="dl-paste-cols">
              <span className="insp-label">{byPosition ? 'Fills by position' : 'Columns'}</span>
              {names.map((h, i) => {
                const ok = validName(h ?? '');
                return (
                  <span key={`${h}-${i}`} className="dl-paste-col" data-invalid={!ok || undefined}>
                    <span className="step-icon" data-icon={ok ? 'check' : 'triangle-alert'} />
                    {h?.trim() || <span className="dl-empty-name">(empty)</span>}
                  </span>
                );
              })}
            </div>
          )}
          {invalid && <span className="insp-hint">Headers holding {'{ }'} or : can’t be {'{row:…}'} tokens, but they still save.</span>}
          {short && <span className="insp-hint">Rows shorter than the header: the missing cells read as empty.</span>}
          {long && <span className="insp-hint">Rows longer than the header: the extra cells become new columns.</span>}
          {draft.mode === 'replace' && hasTable && <span className="insp-hint dl-paste-tail">Edit in place or paste over it.</span>}
        </div>
      </div>
      <div className="dl-paste-foot">
        <span className="dl-paste-hint">Tabs, quotes and line breaks survive the paste · Ctrl+Enter applies</span>
        <button type="button" className="insp-button" onClick={close}>Cancel</button>
        <button type="button" className="insp-button dl-primary" disabled={locked || parsed.headers.length === 0} onClick={apply}>{applyLabel}</button>
      </div>
    </div>
  );
}
