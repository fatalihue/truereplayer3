import { ListChecks, SearchX } from 'lucide-react';
import { t } from '../../i18n';
import { useRecording } from '../../logic/useRecording';
import { keycaps } from '../library/model';
import { useApp } from '../store';
import { openExamples } from '../ui';

/**
 * The empty states with a way out (phase 5, EmptyStates board), in a chunk of their own: the list
 * and the library draw them once it is in (ui.ts, loadEmpties).
 */

/**
 * ⑦ with no steps (lista-104 and 106): Record, from the top of the list. The row above adds steps
 * one by one, and Ctrl+V pastes steps copied from another macro.
 */
export function EmptySteps() {
  const enabled = useApp(a => a.buttonStates.recordEnabled);
  const key = useApp(a => a.settings.recordingHotkey);
  const recording = useRecording();
  return (
    <>
      <span className="steps-empty-icon"><ListChecks aria-hidden="true" /></span>
      <p className="steps-empty-title">{t('empty.steps.title')}</p>
      <p>{t('empty.steps.text')}</p>
      <div className="hdr-split" data-tone="record" data-disabled={!enabled || undefined}>
        <button type="button" className="hdr-run" disabled={!enabled} onClick={() => recording.toggleAt(0)}>
          <span className="hdr-rec-dot" aria-hidden="true" />
          {t('common.actions.record')}
          {key && <kbd className="kbd">{keycaps(key)}</kbd>}
        </button>
      </div>
    </>
  );
}

/** ③ with no macro at all (biblioteca-011): the first-run screen beside it says how to make one. */
export function LibraryNone() {
  return (
    <div className="lib-empty">
      <ListChecks aria-hidden="true" />
      <span className="lib-empty-title">{t('empty.library.title')}</span>
      <span>{t('empty.library.text')}</span>
    </div>
  );
}

/**
 * ③'s search found nothing (biblioteca-010): the ways out — a macro by that name, the same words in
 * the examples, or the whole library again. A tag search only clears.
 */
export function LibraryNoMatch({ query, tags, onCreate, onClear }: { query: string; tags: boolean; onCreate: (name: string) => void; onClear: () => void }) {
  const text = query.trim();
  return (
    <div className="lib-empty">
      <SearchX aria-hidden="true" />
      <span>{t('empty.noMatch.title', { query: text })}</span>
      {!tags && (
        <>
          <button type="button" className="lib-link" onClick={() => { onCreate(text); onClear(); }}>{t('empty.noMatch.create', { name: text })}</button>
          <button type="button" className="lib-link" onClick={() => openExamples(text)}>{t('empty.noMatch.examples')}</button>
        </>
      )}
      <button type="button" className="lib-link" onClick={onClear}>{t('common.actions.clearSearch')}</button>
    </div>
  );
}
