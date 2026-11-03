import { useState, type KeyboardEvent } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { fmtNum, t } from '../../i18n';
import { useSteps } from '../../logic/useSteps';
import { useLanguage } from '../../state/LanguageContext';
import { useToast } from '../../state/ToastContext';
import { formatMs, isCombinedClick, isCoordinateClick } from '../../utils/displayUtils';
import { blockMap, scopeOf } from '../list/blocks';
import { deleteSteps, moveSteps, moveTarget } from '../list/moves';
import { Section, Segmented } from './fields';

type Mode = 'set' | 'add';

// The steps a delay means nothing to: the jump markers and Else (the engine skips them in a bulk
// delay too). If and While keep theirs — the settle before the check.
const NO_DELAY = new Set(['Else', 'EndIf', 'EndLoop', 'BreakLoop', 'ContinueLoop', 'ForEachRow']);

/** A number typed for Set or Add, or why it cannot be used (lista-097, lista-099). */
function parseBulk(text: string, mode: Mode, kind: 'delay' | 'coord'): { value?: number; error?: string } {
  const typed = text.trim();
  if (typed === '') return {};
  if (mode === 'set' && typed.startsWith('+')) return { error: t('inspector.batch.plusSets') };
  if (kind === 'delay' && mode === 'set' && typed.startsWith('-')) return { error: t('inspector.batch.negativeDelay') };
  if (!/^[+-]?\d{1,9}$/.test(typed)) {
    return {
      error: kind === 'delay'
        ? (mode === 'set' ? t('inspector.batch.wholeMs') : t('inspector.batch.wholeDelta'))
        : (mode === 'set' ? t('inspector.batch.wholeCoord') : t('inspector.batch.wholeCoordDelta')),
    };
  }
  return { value: Number.parseInt(typed, 10) };
}

/**
 * ⑧ Several steps selected ("Vários passos — edição em lote"): the delay, the position of the clicks
 * and the notes, each with its field always open and its own Apply (Enter applies too), then the
 * actions on the selection — move, duplicate, copy, skip and delete. Each change is one undo step.
 */
export function BatchEditor({ indices, steps, locked }: { indices: number[]; steps: ActionItem[]; locked: boolean }) {
  const cmds = useSteps();
  const { language } = useLanguage();
  const { showToast } = useToast();
  const sel = indices;
  const n = sel.length;
  const ms = (v: number) => formatMs(v, language);

  const delayRows = sel.filter(i => !NO_DELAY.has(steps[i].actionType));
  const delays = delayRows.map(i => steps[i].delay);
  const low = Math.min(...delays);
  const high = Math.max(...delays);
  const delayNow = delayRows.length === 0 ? t('inspector.batch.delayNone')
    : low === high ? t('inspector.batch.delaySame', { ms: ms(low) })
    : t('inspector.batch.delayMixed', { low: ms(low), high: ms(high) });
  // The clicks with a point of their own: an at-cursor click reads the mouse, not its X and Y.
  const clicks = sel.filter(i => isCoordinateClick(steps[i].actionType) && !(steps[i].atCursor && isCombinedClick(steps[i].actionType)));
  const notes = new Set(sel.map(i => steps[i].comment ?? ''));
  const commonNote = notes.size === 1 ? [...notes][0] : null;
  const withNotes = sel.filter(i => (steps[i].comment ?? '') !== '').length;
  const allSkipped = sel.every(i => steps[i].isSkipped);
  const blocks = blockMap(steps);

  const [delay, setDelay] = useState<{ mode: Mode; text: string; error?: string }>({ mode: 'set', text: '' });
  const [x, setX] = useState<{ mode: Mode; text: string }>({ mode: 'set', text: '' });
  const [y, setY] = useState<{ mode: Mode; text: string }>({ mode: 'set', text: '' });
  const [posError, setPosError] = useState<string | undefined>();
  const [note, setNote] = useState<string | null>(null);

  const applyDelay = () => {
    const r = parseBulk(delay.text, delay.mode, 'delay');
    if (r.error) { setDelay({ ...delay, error: r.error }); return; }
    if (r.value === undefined) return;
    cmds.bulkUpdateDelay({ indices: delayRows, mode: delay.mode, delay: r.value });
    setDelay({ mode: delay.mode, text: '' });
  };
  const applyPosition = () => {
    const rx = parseBulk(x.text, x.mode, 'coord');
    const ry = parseBulk(y.text, y.mode, 'coord');
    const error = rx.error ?? ry.error;
    if (error) { setPosError(error); return; }
    setPosError(undefined);
    if (rx.value !== undefined) cmds.bulkUpdateCoord({ indices: clicks, axis: 'x', mode: x.mode, value: rx.value });
    if (ry.value !== undefined) cmds.bulkUpdateCoord({ indices: clicks, axis: 'y', mode: y.mode, value: ry.value });
    setX({ ...x, text: '' });
    setY({ ...y, text: '' });
  };
  // An emptied note only closes, as today: the notes go only with "Clear notes".
  const applyNote = () => {
    if (note === null || note === commonNote) return;
    setNote(null);
    if (note.trim() === '') return;
    cmds.bulkUpdateComment({ indices: sel, comment: note });
    showToast(t('inspector.batch.notesSet', { count: n, n: fmtNum(n) }), 'success');
  };
  const clearNotes = () => {
    cmds.bulkUpdateComment({ indices: sel, comment: '' });
    showToast(t('inspector.batch.notesCleared', { count: withNotes, n: fmtNum(withNotes) }), 'success');
  };
  const toggleSkip = () => {
    cmds.toggleSkip({ indices: sel });
    showToast(allSkipped
      ? t('list.menu.enabled', { count: n, n: fmtNum(n) })
      : t('list.menu.skipped', { count: n, n: fmtNum(n) }), 'success');
  };
  const remove = () => {
    const gone = deleteSteps(steps, sel, blocks, cmds, (text) => showToast(text, 'info'));
    if (gone > 0) showToast(t('inspector.batch.deleted', { count: gone, n: fmtNum(gone) }), { type: 'success', action: { label: t('common.actions.undo'), onClick: () => cmds.undo({}) } });
  };
  const enter = (apply: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    apply();
  };

  const delayModes = [
    { value: 'set' as const, label: t('inspector.batch.set'), tip: t('inspector.batch.setDelayTip') },
    { value: 'add' as const, label: t('inspector.batch.add'), tip: t('inspector.batch.addDelayTip') },
  ];
  const pointModes = [
    { value: 'set' as const, label: t('inspector.batch.set'), tip: t('inspector.batch.setPointTip') },
    { value: 'add' as const, label: t('inspector.batch.add'), tip: t('inspector.batch.addPointTip') },
  ];

  return (
    <>
      <Section label={t('inspector.delay')} hint={delay.error ? <span data-error="">{delay.error}</span> : delayNow}>
        <div className="insp-bulk">
          <Segmented<Mode> label={t('inspector.batch.delayMode')} value={delay.mode} options={delayModes} onChange={(mode) => setDelay({ mode, text: delay.text })} disabled={locked || delayRows.length === 0} />
          <label className="insp-box" data-invalid={delay.error ? '' : undefined}>
            <input
              type="text"
              className="insp-mono"
              aria-label={t('inspector.batch.delayAll')}
              placeholder={delay.mode === 'set' ? 'ms' : t('inspector.batch.deltaHint')}
              value={delay.text}
              disabled={locked || delayRows.length === 0}
              onChange={(e) => setDelay({ mode: delay.mode, text: e.target.value })}
              onKeyDown={enter(applyDelay)}
            />
            <span className="insp-box-unit">ms</span>
          </label>
          <button type="button" className="insp-button" disabled={locked || delay.text.trim() === ''} onClick={applyDelay}>{t('common.actions.apply')}</button>
        </div>
      </Section>

      {clicks.length > 0 && (
        <Section
          label={t('inspector.batch.position')}
          aside={t('inspector.batch.clicksOf', { count: clicks.length, k: fmtNum(clicks.length), n: fmtNum(n) })}
          hint={posError ? <span data-error="">{posError}</span> : undefined}
        >
          {([['X', x, setX], ['Y', y, setY]] as const).map(([axis, value, set]) => (
            <div key={axis} className="insp-bulk">
              <span className="insp-axis">{axis}</span>
              <Segmented<Mode> label={t('inspector.batch.axisMode', { axis })} value={value.mode} options={pointModes} onChange={(mode) => set({ mode, text: value.text })} disabled={locked} />
              <label className="insp-box" data-invalid={posError ? '' : undefined}>
                <input
                  type="text"
                  className="insp-mono"
                  aria-label={t('inspector.batch.axisOffset', { axis })}
                  placeholder={value.mode === 'set' ? t('inspector.batch.pointHint') : t('inspector.batch.pointDeltaHint')}
                  value={value.text}
                  disabled={locked}
                  onChange={(e) => { set({ mode: value.mode, text: e.target.value }); setPosError(undefined); }}
                  onKeyDown={enter(applyPosition)}
                />
              </label>
            </div>
          ))}
          <button type="button" className="insp-button insp-end" disabled={locked || (x.text.trim() === '' && y.text.trim() === '')} onClick={applyPosition}>
            {t('inspector.batch.applyClicks', { count: clicks.length, n: fmtNum(clicks.length) })}
          </button>
        </Section>
      )}

      <Section label={t('inspector.notes')}>
        <div className="insp-bulk">
          <label className="insp-box">
            <input
              type="text"
              aria-label={t('inspector.batch.notesAll')}
              placeholder={commonNote === null ? t('inspector.batch.mixed') : t('inspector.addNote')}
              value={note ?? commonNote ?? ''}
              disabled={locked}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={enter(applyNote)}
            />
          </label>
          <button type="button" className="insp-button" disabled={locked || note === null || note === commonNote || note.trim() === ''} onClick={applyNote}>{t('common.actions.apply')}</button>
        </div>
        <button type="button" className="insp-link" disabled={locked || withNotes === 0} data-tip={t('inspector.batch.clearNotesTip')} onClick={clearNotes}>
          {t('inspector.batch.clearNotes', { n: fmtNum(n) })}
        </button>
      </Section>

      <Section label={t('inspector.batch.actions')}>
        <div className="insp-actions">
          <button type="button" disabled={locked || !moveTarget(steps, sel, 'up')} onClick={() => moveSteps(steps, sel, 'up', cmds)}>
            <span>{t('inspector.batch.moveUp')}</span><kbd className="kbd" aria-hidden="true">Alt+↑</kbd>
          </button>
          <button type="button" disabled={locked || !moveTarget(steps, sel, 'down')} onClick={() => moveSteps(steps, sel, 'down', cmds)}>
            <span>{t('inspector.batch.moveDown')}</span><kbd className="kbd" aria-hidden="true">Alt+↓</kbd>
          </button>
          <button type="button" disabled={locked} onClick={() => cmds.duplicate({ indices: scopeOf(sel, steps, blocks) })}>
            <span>{t('common.actions.duplicate')}</span>
          </button>
          <button type="button" onClick={() => cmds.copyInternal({ indices: sel })}>
            <span>{t('common.actions.copy')}</span><kbd className="kbd" aria-hidden="true">Ctrl+C</kbd>
          </button>
          <button type="button" disabled={locked} onClick={toggleSkip}>
            <span>{allSkipped ? t('inspector.batch.enableAll', { n: fmtNum(n) }) : t('inspector.batch.skipAll', { n: fmtNum(n) })}</span>
          </button>
          <button type="button" data-danger="" disabled={locked} onClick={remove}>
            <span>{t('inspector.batch.deleteSteps', { count: n, n: fmtNum(n) })}</span><kbd className="kbd" aria-hidden="true">Del</kbd>
          </button>
        </div>
      </Section>
    </>
  );
}
