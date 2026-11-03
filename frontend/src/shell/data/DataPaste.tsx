import { useDeferredValue, useEffect, useLayoutEffect, useRef } from 'react';
import { fmtNum, t } from '../../i18n';
import { parseTsv } from '../../lib/tsv';
import { COMMIT_EDITORS } from '../ui';
import { refocusTable, SAMPLE_TEXT, useDataOps, useDataTab, useShown, validName, type PasteDraft } from './model';

/**
 * Paste or import (paineis-127 to 139): the table as text, in place of the grid — a spreadsheet's
 * rows pasted over it, a CSV read into it, or the table edited in bulk. Replace takes the whole
 * table; Append adds the rows under it, by the columns' names (or by position, with no header
 * line). The preview says what Apply will do. Ctrl+Enter applies, Esc and Cancel put it away.
 */
export function DataPaste({ draft, locked }: { draft: PasteDraft; locked: boolean }) {
  const shown = useShown();
  const ops = useDataOps();
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
  // The app closing (editor:commit): a paste not applied goes away, as Esc would put it, and the
  // claim it held on the automations and on the close goes with it.
  useEffect(() => {
    const drop = () => useDataTab.setState({ paste: null });
    window.addEventListener(COMMIT_EDITORS, drop);
    return () => window.removeEventListener(COMMIT_EDITORS, drop);
  }, []);

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
  const pasted = parsed.rows.length;
  const applyLabel = draft.mode === 'replace' ? t('dataLoop.paste.replace') : t('dataLoop.paste.appendRows', { count: pasted, n: fmtNum(pasted) });

  return (
    <div
      className="dl-paste"
      role="region"
      aria-label={t('dataLoop.pasteOrImport')}
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
        <button type="button" className="dl-back" data-tip={t('dataLoop.paste.backTip')} onClick={close}>
          <span className="step-icon" data-icon="chevron-right" />
          {t('dataLoop.paste.back')}
        </button>
        <span className="dl-paste-title">{t('dataLoop.pasteOrImport')}</span>
        <div className="insp-seg dl-paste-mode" role="group" aria-label={t('dataLoop.paste.mode')}>
          <button type="button" aria-pressed={draft.mode === 'replace'} onClick={() => set({ mode: 'replace' })}>{t('dataLoop.paste.replace')}</button>
          <button
            type="button"
            aria-pressed={draft.mode === 'append'}
            data-tip={t('dataLoop.paste.appendTip')}
            // The box still holding the table itself would append it to itself: it starts empty.
            onClick={() => set(draft.text === draft.prefill ? { mode: 'append', text: '' } : { mode: 'append' })}
          >
            {t('dataLoop.paste.append')}
          </button>
        </div>
      </div>
      <div className="dl-paste-body">
        <textarea
          ref={boxRef}
          className="dl-paste-box"
          value={draft.text}
          aria-label={t('dataLoop.paste.box')}
          spellCheck={false}
          placeholder={SAMPLE_TEXT}
          onChange={(e) => set({ text: e.target.value })}
        />
        <div className="dl-paste-side">
          <label className="dl-check">
            <input type="checkbox" checked={draft.header} onChange={(e) => set({ header: e.target.checked })} />
            <span data-tip={draft.mode === 'append' ? t('dataLoop.paste.headerOffAppend') : t('dataLoop.paste.headerOff')}>
              {t('dataLoop.paste.header')}
            </span>
          </label>
          <span className="dl-paste-count">
            {t('dataLoop.columns', { count: names.length, n: fmtNum(names.length) })} · {t('dataLoop.rows', { count: pasted, n: fmtNum(pasted) })}
          </span>
          {names.length > 0 && (
            <div className="dl-paste-cols">
              <span className="insp-label">{byPosition ? t('dataLoop.paste.byPosition') : t('dataLoop.columnsLabel')}</span>
              {names.map((h, i) => {
                const ok = validName(h ?? '');
                return (
                  <span key={`${h}-${i}`} className="dl-paste-col" data-invalid={!ok || undefined}>
                    <span className="step-icon" data-icon={ok ? 'check' : 'triangle-alert'} />
                    {h?.trim() || <span className="dl-empty-name">{t('dataLoop.emptyName')}</span>}
                  </span>
                );
              })}
            </div>
          )}
          {invalid && <span className="insp-hint">{t('dataLoop.paste.invalid')}</span>}
          {short && <span className="insp-hint">{t('dataLoop.paste.short')}</span>}
          {long && <span className="insp-hint">{t('dataLoop.paste.long')}</span>}
          {draft.mode === 'replace' && hasTable && <span className="insp-hint dl-paste-tail">{t('dataLoop.paste.tail')}</span>}
        </div>
      </div>
      <div className="dl-paste-foot">
        <span className="dl-paste-hint">{t('dataLoop.paste.foot')}</span>
        <button type="button" className="insp-button" onClick={close}>{t('common.actions.cancel')}</button>
        <button type="button" className="insp-button dl-primary" disabled={locked || parsed.headers.length === 0} onClick={apply}>{applyLabel}</button>
      </div>
    </div>
  );
}
