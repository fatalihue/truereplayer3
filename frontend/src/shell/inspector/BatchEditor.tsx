import { useState, type KeyboardEvent } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { useSteps } from '../../logic/useSteps';
import { useLanguage, useTt } from '../../state/LanguageContext';
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
  const t = text.trim();
  if (t === '') return {};
  if (mode === 'set' && t.startsWith('+')) return { error: '+ adds — pick Add, or drop the + to set' };
  if (kind === 'delay' && mode === 'set' && t.startsWith('-')) return { error: "A delay can't be negative — pick Add to subtract" };
  if (!/^[+-]?\d{1,9}$/.test(t)) {
    return {
      error: kind === 'delay'
        ? (mode === 'set' ? 'Use a whole number of ms — 0 or more' : 'Use a whole number — e.g. +50 or -20')
        : (mode === 'set' ? 'Use a whole number — e.g. 500 or -10' : 'Use a whole number — e.g. +10 or -5'),
    };
  }
  return { value: Number.parseInt(t, 10) };
}

/**
 * ⑧ Several steps selected ("Vários passos — edição em lote"): the delay, the position of the clicks
 * and the notes, each with its field always open and its own Apply (Enter applies too), then the
 * actions on the selection — move, duplicate, copy, skip and delete. Each change is one undo step.
 */
export function BatchEditor({ indices, steps, locked }: { indices: number[]; steps: ActionItem[]; locked: boolean }) {
  const cmds = useSteps();
  const tt = useTt();
  const { language } = useLanguage();
  const { showToast } = useToast();
  const sel = indices;
  const n = sel.length;
  const ms = (v: number) => `${formatMs(v, language)} ms`;

  const delayRows = sel.filter(i => !NO_DELAY.has(steps[i].actionType));
  const delays = delayRows.map(i => steps[i].delay);
  const low = Math.min(...delays);
  const high = Math.max(...delays);
  const delayNow = delayRows.length === 0 ? 'None of these steps has a delay.'
    : low === high ? `Now ${ms(low)} on all.`
    : `Now mixed: ${formatMs(low, language)} to ${ms(high)}.`;
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
    showToast(tt(`Set notes for ${n} step(s)`, `Notas definidas para ${n} passo(s)`), 'success');
  };
  const clearNotes = () => {
    cmds.bulkUpdateComment({ indices: sel, comment: '' });
    showToast(tt(`Cleared notes on ${withNotes} step(s)`, `Notas removidas de ${withNotes} passo(s)`), 'success');
  };
  const toggleSkip = () => {
    cmds.toggleSkip({ indices: sel });
    showToast(allSkipped
      ? tt(`Enabled ${n} step(s)`, `${n} passo(s) ativado(s)`)
      : tt(`Skipped ${n} step(s)`, `${n} passo(s) pulado(s)`), 'success');
  };
  const remove = () => {
    const gone = deleteSteps(steps, sel, blocks, cmds, (text) => showToast(text, 'info'), tt);
    if (gone > 0) showToast(tt(`Deleted ${gone} step(s)`, `${gone} passo(s) apagado(s)`), { type: 'success', action: { label: 'Undo', onClick: () => cmds.undo({}) } });
  };
  const enter = (apply: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    apply();
  };

  const delayModes = [
    { value: 'set' as const, label: 'Set', tip: tt('Every selected step gets this delay', 'Todo passo selecionado recebe este atraso') },
    { value: 'add' as const, label: 'Add', tip: tt("Added to each step's delay. Negative subtracts, stopping at 0.", 'Somado ao atraso de cada passo. Negativo subtrai, parando em 0.') },
  ];
  const pointModes = [
    { value: 'set' as const, label: 'Set', tip: tt('Every selected click gets this value', 'Todo clique selecionado recebe este valor') },
    { value: 'add' as const, label: 'Add', tip: tt("Added to each click's current value. Negative subtracts.", 'Somado ao valor atual de cada clique. Negativo subtrai.') },
  ];

  return (
    <>
      <Section label="Delay" hint={delay.error ? <span data-error="">{delay.error}</span> : delayNow}>
        <div className="insp-bulk">
          <Segmented<Mode> label="Set or add the delay" value={delay.mode} options={delayModes} onChange={(mode) => setDelay({ mode, text: delay.text })} disabled={locked || delayRows.length === 0} />
          <label className="insp-box" data-invalid={delay.error ? '' : undefined}>
            <input
              type="text"
              className="insp-mono"
              aria-label="Delay for all"
              placeholder={delay.mode === 'set' ? 'ms' : '+50 or -20'}
              value={delay.text}
              disabled={locked || delayRows.length === 0}
              onChange={(e) => setDelay({ mode: delay.mode, text: e.target.value })}
              onKeyDown={enter(applyDelay)}
            />
            <span className="insp-box-unit">ms</span>
          </label>
          <button type="button" className="insp-button" disabled={locked || delay.text.trim() === ''} onClick={applyDelay}>Apply</button>
        </div>
      </Section>

      {clicks.length > 0 && (
        <Section label="Position" aside={`· ${clicks.length} of the ${n} ${clicks.length === 1 ? 'is a click' : 'are clicks'}`} hint={posError ? <span data-error="">{posError}</span> : undefined}>
          {([['X', x, setX], ['Y', y, setY]] as const).map(([axis, value, set]) => (
            <div key={axis} className="insp-bulk">
              <span className="insp-axis">{axis}</span>
              <Segmented<Mode> label={`Set or add ${axis}`} value={value.mode} options={pointModes} onChange={(mode) => set({ mode, text: value.text })} disabled={locked} />
              <label className="insp-box" data-invalid={posError ? '' : undefined}>
                <input
                  type="text"
                  className="insp-mono"
                  aria-label={`${axis} offset`}
                  placeholder={value.mode === 'set' ? '500 or -10' : '+10 or -5'}
                  value={value.text}
                  disabled={locked}
                  onChange={(e) => { set({ mode: value.mode, text: e.target.value }); setPosError(undefined); }}
                  onKeyDown={enter(applyPosition)}
                />
              </label>
            </div>
          ))}
          <button type="button" className="insp-button insp-end" disabled={locked || (x.text.trim() === '' && y.text.trim() === '')} onClick={applyPosition}>
            Apply to {clicks.length} {clicks.length === 1 ? 'click' : 'clicks'}
          </button>
        </Section>
      )}

      <Section label="Notes">
        <div className="insp-bulk">
          <label className="insp-box">
            <input
              type="text"
              aria-label="Notes for all"
              placeholder={commonNote === null ? 'Mixed' : 'Add a note…'}
              value={note ?? commonNote ?? ''}
              disabled={locked}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={enter(applyNote)}
            />
          </label>
          <button type="button" className="insp-button" disabled={locked || note === null || note === commonNote || note.trim() === ''} onClick={applyNote}>Apply</button>
        </div>
        <button type="button" className="insp-link" disabled={locked || withNotes === 0} data-tip={tt('Remove the notes from the selected steps', 'Remove as notas dos passos selecionados')} onClick={clearNotes}>
          Clear notes on all {n}
        </button>
      </Section>

      <Section label="Actions">
        <div className="insp-actions">
          <button type="button" disabled={locked || !moveTarget(steps, sel, 'up')} onClick={() => moveSteps(steps, sel, 'up', cmds)}>
            <span>Move up</span><kbd className="kbd" aria-hidden="true">Alt+↑</kbd>
          </button>
          <button type="button" disabled={locked || !moveTarget(steps, sel, 'down')} onClick={() => moveSteps(steps, sel, 'down', cmds)}>
            <span>Move down</span><kbd className="kbd" aria-hidden="true">Alt+↓</kbd>
          </button>
          <button type="button" disabled={locked} onClick={() => cmds.duplicate({ indices: scopeOf(sel, steps, blocks) })}>
            <span>Duplicate</span>
          </button>
          <button type="button" onClick={() => cmds.copyInternal({ indices: sel })}>
            <span>Copy</span><kbd className="kbd" aria-hidden="true">Ctrl+C</kbd>
          </button>
          <button type="button" disabled={locked} onClick={toggleSkip}>
            <span>{allSkipped ? `Enable all ${n}` : `Skip all ${n}`}</span>
          </button>
          <button type="button" data-danger="" disabled={locked} onClick={remove}>
            <span>Delete {n} steps</span><kbd className="kbd" aria-hidden="true">Del</kbd>
          </button>
        </div>
      </Section>
    </>
  );
}
