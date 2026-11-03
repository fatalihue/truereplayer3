import { useState } from 'react';
import { splitCombo } from '../../components/common/KbdTag';
import type { ActionItem } from '../../bridge/messageTypes';
import { t } from '../../i18n';
import { useSteps } from '../../logic/useSteps';
import { formatMs } from '../../utils/displayUtils';
import { keycaps } from '../library/model';
import { arrival } from '../list/selection';
import { Chips, DraftField, KeyCapture, Section, Segmented, Vary } from './fields';
import { applyEdits, drafts, durationStep, focusList, type Draft, type StepEdit } from './inspectorState';

const HOLD_CHIPS = [100, 500, 1000, 5000];
const DEFAULT_HOLD_MS = 1000;
// ActionItem.DefaultRepeatDelayMs: the gap between presses when the step leaves it empty.
const DEFAULT_KEY_GAP_MS = 30;

const lastKey = (combo: string) => {
  const parts = splitCombo(combo);
  return parts[parts.length - 1] ?? combo;
};

/** The key, captured in the panel or typed beside it (tokens like {var:name} are typed). */
function KeyInput({ step, single, locked, onKey }: { step: ActionItem; single?: boolean; locked: boolean; onKey: (key: string) => void }) {
  return (
    <Section label={t('editors.key.key')}>
      <KeyCapture value={step.key} single={single} label={t('editors.key.capture')} onCapture={onKey} disabled={locked} />
      <span className="insp-sublabel">{t('editors.key.orType')}</span>
      <DraftField
        stepId={step.id ?? ''}
        field="key"
        label={t('editors.key.typeField')}
        kind="mono"
        placeholder={single ? t('editors.key.placeholderSingle') : t('editors.key.placeholder')}
        stored={step.key}
        disabled={locked}
        onApply={onKey}
      />
      {!single && <span className="insp-hint">{t('editors.key.tokensHint')}</span>}
    </Section>
  );
}

/**
 * ⑧ Keystroke and Hold Key ("Keystroke — captura no próprio painel"): the key, Press or Hold, and
 * for Press the times, the gap and its variation; for Hold, how long. Hold takes a single key, so
 * switching a combo to Hold keeps its last key and says so first.
 */
export function KeyEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const id = step.id ?? '';
  const hold = step.actionType === 'HoldKey';
  const repeat = step.repeatCount ?? 1;
  const edit = (edits: StepEdit[]) => applyEdits(cmds, id, edits);
  const parts = splitCombo(step.key);
  const combo = !hold && parts.length > 1;
  const modifiers = parts.slice(0, -1).join('+');

  // A combo given to a Hold keeps its last key; what it dropped is said under the duration until
  // another key comes (dialogos-031: never in silence).
  const [dropped, setDropped] = useState<{ stepId: string; kept: string; modifiers: string } | null>(null);
  const setKey = (key: string) => {
    const given = splitCombo(key);
    setDropped(hold && given.length > 1 ? { stepId: id, kept: given[given.length - 1], modifiers: given.slice(0, -1).join('+') } : null);
    edit([{ field: 'key', value: hold ? lastKey(key) : key }]);
  };
  const droppedHere = hold && dropped?.stepId === id ? dropped : null;
  const setAction = (action: 'press' | 'hold') => {
    if (action === 'hold') edit([{ field: 'actionType', value: 'HoldKey' }, ...(combo ? [{ field: 'key', value: lastKey(step.key) }] : [])]);
    else edit([{ field: 'actionType', value: 'Keystroke' }]);
  };

  const gap = step.repeatDelayMs ?? DEFAULT_KEY_GAP_MS;
  const summary = !step.key ? t('editors.key.summary.none')
    : hold ? t('editors.key.summary.hold', { key: keycaps(step.key), ms: formatMs(step.holdDurationMs || DEFAULT_HOLD_MS) })
    : repeat > 1 ? t('editors.key.summary.repeat', { key: keycaps(step.key), n: repeat, ms: formatMs(gap) })
    : t('editors.key.summary.press', { key: keycaps(step.key) });

  return (
    <>
      <KeyInput step={step} locked={locked} onKey={setKey} />
      <Section
        label={t('editors.action')}
        hint={combo ? t('editors.key.comboHint', { key: lastKey(step.key), modifiers }) : undefined}
      >
        <Segmented<'press' | 'hold'>
          label={t('editors.key.modeField')}
          value={hold ? 'hold' : 'press'}
          options={[{ value: 'press', label: t('editors.key.press') }, { value: 'hold', label: t('editors.key.hold') }]}
          onChange={setAction}
          disabled={locked}
        />
      </Section>
      {hold ? (
        <Section
          label={t('editors.holdLabel')}
          hint={droppedHere ? t('editors.key.droppedHint', { key: droppedHere.kept, modifiers: droppedHere.modifiers }) : undefined}
        >
          <DraftField stepId={id} field="holdDurationMs" label={t('editors.holdField')} kind="int" min={10} max={60000} step={durationStep} unit="ms" stored={String(step.holdDurationMs || DEFAULT_HOLD_MS)} disabled={locked} />
          <Chips values={HOLD_CHIPS} current={step.holdDurationMs || DEFAULT_HOLD_MS} onPick={(ms) => edit([{ field: 'holdDurationMs', value: String(ms) }])} disabled={locked} />
        </Section>
      ) : (
        <>
          <div className="insp-pair">
            <Section label={t('editors.key.times')}>
              <DraftField stepId={id} field="repeat" label={t('editors.timesField')} kind="int" min={1} max={999} unit="×" stored={String(repeat)} disabled={locked} />
            </Section>
            <Section label={t('editors.key.gap')}>
              <DraftField stepId={id} field="repeatDelayMs" label={t('editors.key.gapField')} kind="int" min={0} max={5000} empty="clear" unit="ms" placeholder={String(DEFAULT_KEY_GAP_MS)} stored={step.repeatDelayMs == null ? '' : String(step.repeatDelayMs)} disabled={locked || repeat <= 1} />
            </Section>
          </div>
          <Vary
            label={t('editors.varyGap')}
            fieldLabel={t('editors.key.gapJitter')}
            tip={t('editors.varyGapTip')}
            stepId={id}
            field="repeatDelayJitterPct"
            value={step.repeatDelayJitterPct ?? 0}
            first={20}
            unit="%"
            max={100}
            disabled={locked || repeat <= 1}
            onSwitch={(v) => edit([{ field: 'repeatDelayJitterPct', value: v }])}
          />
        </>
      )}
      <p className="insp-summary" aria-live="polite">{summary}</p>
    </>
  );
}

/**
 * ⑧ A Key still being made (Key in the insert row or the catalog): listening from the start, or
 * typed. The step is born with its key at the insertion point it was asked for, and is then the
 * selection; Esc, × or another selection leave nothing behind.
 */
export function DraftKeyEditor({ draft, locked }: { draft: Draft; locked: boolean }) {
  const cmds = useSteps();
  const [typed, setTyped] = useState('');
  const add = (key: string) => {
    const k = key.trim();
    if (!k) return;
    arrival.expect(draft.at, draft.macro);
    cmds.insertKeystroke({ keystroke: k, insertIndex: draft.at });
    drafts.end();
  };
  const cancel = () => {
    drafts.end();
    arrival.clear();
    focusList();
  };
  return (
    <>
      <Section label={t('editors.key.key')}>
        <KeyCapture value="" label={t('editors.key.capture')} autoListen onCapture={add} onCancel={cancel} disabled={locked} />
        <span className="insp-sublabel">{t('editors.key.orType')}</span>
        <label className="insp-box">
          <input
            type="text"
            className="insp-mono"
            aria-label={t('editors.key.typeField')}
            placeholder={t('editors.key.placeholder')}
            spellCheck={false}
            autoComplete="off"
            value={typed}
            disabled={locked}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              add(typed);
            }}
          />
        </label>
        <span className="insp-hint">{t('editors.key.tokensHintDraft')}</span>
      </Section>
    </>
  );
}

/** ⑧ Key Down and Key Up — the halves a recording writes with "One step per click or key" off. */
export function KeyHalfEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const id = step.id ?? '';
  const edit = (edits: StepEdit[]) => applyEdits(cmds, id, edits);
  const down = step.actionType === 'KeyDown';
  return (
    <>
      <Section label={t('editors.key.actionType')}>
        <Segmented<'KeyDown' | 'KeyUp'>
          label={t('editors.key.actionType')}
          value={down ? 'KeyDown' : 'KeyUp'}
          options={[{ value: 'KeyDown', label: t('editors.key.keyDown') }, { value: 'KeyUp', label: t('editors.key.keyUp') }]}
          onChange={(v) => edit([{ field: 'actionType', value: v }])}
          disabled={locked}
        />
      </Section>
      <KeyInput step={step} single locked={locked} onKey={(key) => edit([{ field: 'key', value: lastKey(key) }])} />
      <p className="insp-summary" aria-live="polite">
        {!step.key ? t('editors.key.summary.noneHalf')
          : down ? t('editors.key.summary.down', { key: keycaps(step.key) })
          : t('editors.key.summary.up', { key: keycaps(step.key) })}
      </p>
    </>
  );
}
