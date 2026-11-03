import type { ActionItem } from '../../bridge/messageTypes';
import { t } from '../../i18n';
import { useSteps } from '../../logic/useSteps';
import { DraftField, Section, Segmented } from './fields';
import { applyEdits, type StepEdit } from './inspectorState';
import { ScreenTextCheck } from './screenChecks';

// The simple steps' editors, a chunk of their own (rule 6): Scroll, Set Variable and Copy to Slot.
// Each field applies as it is typed (DraftField) and each choice on the press; one message per
// change, one Ctrl+Z. The loop's jumps and the two endings have only a line (InspectorBody).

type Props = { step: ActionItem; locked: boolean };
const useEdit = (step: ActionItem) => {
  const cmds = useSteps();
  return (edits: StepEdit[]) => applyEdits(cmds, step.id ?? '', edits);
};

// The name a Set Variable or a Copy to Slot writes, in the only alphabet the engine reads
// (ActionExecution.VariableNameRegex): typing keeps to it, and a stored name outside it (hand-edited,
// imported) says so, since the run skips it.
const NAME_OUTSIDE = /[^A-Za-z0-9_]/g;
const unusableName = (name: string) => name.trim() !== '' && !/^[A-Za-z0-9_]+$/.test(name.trim());
const keepName = (text: string) => text.replace(NAME_OUTSIDE, '');
const asTyped = (text: string) => text.trim();
const MAX_WAIT_MS = 999_999_999;

/** Scroll: one notch of the wheel where the cursor is, up or down (editor-passo-045 and 046). */
export function ScrollEditor({ step, locked }: Props) {
  const edit = useEdit(step);
  return (
    <Section label={t('editors.scroll.direction')} hint={t('editors.scroll.hint')}>
      <Segmented<'ScrollUp' | 'ScrollDown'>
        label={t('editors.scroll.field')}
        value={step.actionType === 'ScrollUp' ? 'ScrollUp' : 'ScrollDown'}
        disabled={locked}
        options={[{ value: 'ScrollUp', label: t('editors.scroll.up') }, { value: 'ScrollDown', label: t('editors.scroll.down') }]}
        onChange={(v) => edit([{ field: 'actionType', value: v }])}
      />
    </Section>
  );
}

type VariableMode = 'set' | 'cycle' | 'add' | 'screen';

/**
 * Set Variable (editor-passo-160 to 166): the name, read back with {var:name}, and what it stores —
 * a value (Set), the next line of a list on each run (Cycle), a number added to it (Add), or what a
 * region of the screen reads (Screen, the OCR with no match, waiting up to a time for a read). In
 * Cycle, Reset cycle position starts the list over (lista-070, also in the step's menu).
 */
export function SetVariableEditor({ step, index, locked }: Props & { index: number }) {
  const edit = useEdit(step);
  const cmds = useSteps();
  const id = step.id ?? '';
  const name = step.key ?? '';
  const mode: VariableMode = step.variableMode === 'cycle' || step.variableMode === 'add' || step.variableMode === 'screen' ? step.variableMode : 'set';
  const value = step.variableValue ?? '';
  return (
    <>
      <Section
        label={t('editors.variable.name')}
        hint={unusableName(name) ? <span data-error="">{t('editors.unusableName')}</span> : t('editors.variable.nameHint')}
      >
        <DraftField stepId={id} field="key" label={t('editors.variable.name')} kind="mono" placeholder={t('editors.variable.namePlaceholder')} stored={name} disabled={locked} filter={keepName} parse={asTyped} />
      </Section>
      <Section label={t('editors.mode')}>
        <Segmented<VariableMode>
          label={t('editors.variable.modeField')}
          value={mode}
          disabled={locked}
          options={[
            { value: 'set', label: t('editors.variable.set') },
            { value: 'cycle', label: t('editors.variable.cycle'), tip: t('editors.variable.cycleTip') },
            { value: 'add', label: t('editors.variable.add'), tip: t('editors.variable.addTip') },
            { value: 'screen', label: t('editors.variable.screen'), tip: t('editors.variable.screenTip') },
          ]}
          onChange={(v) => edit([{ field: 'variableMode', value: v === 'set' ? '' : v }])}
        />
      </Section>
      {mode === 'screen' ? (
        <>
          <ScreenTextCheck step={step} locked={locked} variant="read" />
          <Section label={t('editors.variable.waitUpTo')} hint={t('editors.variable.waitHint')}>
            <DraftField
              stepId={id}
              field="conditionTimeout"
              label={t('editors.variable.waitField')}
              kind="int"
              min={0}
              max={MAX_WAIT_MS}
              step={500}
              unit="ms"
              stored={String(step.conditionTimeout ?? 0)}
              disabled={locked}
            />
          </Section>
        </>
      ) : (
        <Section
          label={mode === 'cycle' ? t('editors.variable.listLabel') : mode === 'add' ? t('editors.variable.amount') : t('editors.variable.value')}
          hint={mode === 'cycle' ? t('editors.variable.listHint')
            : mode === 'add' ? t('editors.variable.amountHint')
            : t('editors.variable.valueHint')}
        >
          <DraftField
            // One field per mode: a value typed as a list does not carry over as an amount.
            key={mode}
            stepId={id}
            field="variableValue"
            label={mode === 'cycle' ? t('editors.variable.list') : mode === 'add' ? t('editors.variable.amount') : t('editors.variable.value')}
            kind="mono"
            multiline={mode !== 'add'}
            placeholder={mode === 'cycle' ? t('editors.variable.listPlaceholder') : mode === 'add' ? '1' : undefined}
            stored={value}
            disabled={locked}
            // Empty is a real value here (it deletes the variable), sent as it is.
            parse={(text) => text}
          />
        </Section>
      )}
      {mode === 'cycle' && (
        <button
          type="button"
          className="insp-link"
          disabled={locked}
          data-tip={t('list.menu.resetCycleTip')}
          onClick={() => cmds.resetCycle({ index })}
        >
          {t('list.menu.resetCycle')}
        </button>
      )}
    </>
  );
}

/**
 * Copy to Slot (editor-passo-167 to 169): Capture copies the selection of the app in front into the
 * slot, read back with {clip:slot}; Clear empties it, or every slot with no name.
 */
export function CopyToSlotEditor({ step, locked }: Props) {
  const edit = useEdit(step);
  const id = step.id ?? '';
  const slot = step.key ?? '';
  const clear = step.slotMode === 'clear';
  return (
    <>
      <Section label={t('editors.mode')}>
        <Segmented<'capture' | 'clear'>
          label={t('editors.slot.modeField')}
          value={clear ? 'clear' : 'capture'}
          disabled={locked}
          options={[
            { value: 'capture', label: t('editors.slot.capture'), tip: t('editors.slot.captureTip') },
            { value: 'clear', label: t('editors.slot.clear'), tip: t('editors.slot.clearTip') },
          ]}
          onChange={(v) => edit([{ field: 'slotMode', value: v === 'clear' ? 'clear' : '' }])}
        />
      </Section>
      <Section
        label={t('editors.slot.slot')}
        hint={unusableName(slot) ? <span data-error="">{t('editors.unusableName')}</span>
          : clear ? t('editors.slot.blankHint') : t('editors.slot.hint')}
      >
        <DraftField stepId={id} field="key" label={t('editors.slot.slot')} kind="mono" placeholder={clear ? t('editors.slot.placeholderAll') : '1'} stored={slot} disabled={locked} filter={keepName} parse={asTyped} />
      </Section>
    </>
  );
}
