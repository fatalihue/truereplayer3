import type { ActionItem } from '../../bridge/messageTypes';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
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
    <Section label="Direction" hint="One notch of the mouse wheel, where the cursor is.">
      <Segmented<'ScrollUp' | 'ScrollDown'>
        label="Scroll direction"
        value={step.actionType === 'ScrollUp' ? 'ScrollUp' : 'ScrollDown'}
        disabled={locked}
        options={[{ value: 'ScrollUp', label: 'Scroll Up ↑' }, { value: 'ScrollDown', label: 'Scroll Down ↓' }]}
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
  const tt = useTt();
  const id = step.id ?? '';
  const name = step.key ?? '';
  const mode: VariableMode = step.variableMode === 'cycle' || step.variableMode === 'add' || step.variableMode === 'screen' ? step.variableMode : 'set';
  const value = step.variableValue ?? '';
  return (
    <>
      <Section
        label="Variable name"
        hint={unusableName(name) ? <span data-error="">Letters, digits and _ only — skipped at replay as written.</span> : 'Read it back with {var:name}.'}
      >
        <DraftField stepId={id} field="key" label="Variable name" kind="mono" placeholder="name" stored={name} disabled={locked} filter={keepName} parse={asTyped} />
      </Section>
      <Section label="Mode">
        <Segmented<VariableMode>
          label="Variable mode"
          value={mode}
          disabled={locked}
          options={[
            { value: 'set', label: 'Set' },
            { value: 'cycle', label: 'Cycle', tip: tt('The next line of a list on each run, then back to the first', 'A próxima linha de uma lista a cada execução, depois volta à primeira') },
            { value: 'add', label: 'Add', tip: tt('Adds a number to the current value (a counter)', 'Soma um número ao valor atual (um contador)') },
            { value: 'screen', label: 'Screen', tip: tt('Reads text from a region of the screen (OCR)', 'Lê o texto de uma região da tela (OCR)') },
          ]}
          onChange={(v) => edit([{ field: 'variableMode', value: v === 'set' ? '' : v }])}
        />
      </Section>
      {mode === 'screen' ? (
        <>
          <ScreenTextCheck step={step} locked={locked} variant="read" />
          <Section label="Wait up to" hint="0 = read once. Nothing read deletes the variable.">
            <DraftField
              stepId={id}
              field="conditionTimeout"
              label="Wait up to, in milliseconds"
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
          label={mode === 'cycle' ? 'List (one item per line)' : mode === 'add' ? 'Amount' : 'Value'}
          hint={mode === 'cycle' ? 'One line per run, then back to the first.'
            : mode === 'add' ? 'Added to the current value (unset counts as 0). Negative subtracts.'
            : 'Tokens resolve here. Empty deletes the variable.'}
        >
          <DraftField
            // One field per mode: a value typed as a list does not carry over as an amount.
            key={mode}
            stepId={id}
            field="variableValue"
            label={mode === 'cycle' ? 'List' : mode === 'add' ? 'Amount' : 'Value'}
            kind="mono"
            multiline={mode !== 'add'}
            placeholder={mode === 'cycle' ? 'item 1\nitem 2\nitem 3' : mode === 'add' ? '1' : undefined}
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
          data-tip={tt('The next run starts at the first item of the list', 'A próxima execução começa no primeiro item da lista')}
          onClick={() => cmds.resetCycle({ index })}
        >
          Reset cycle position
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
  const tt = useTt();
  const id = step.id ?? '';
  const slot = step.key ?? '';
  const clear = step.slotMode === 'clear';
  return (
    <>
      <Section label="Mode">
        <Segmented<'capture' | 'clear'>
          label="Slot mode"
          value={clear ? 'clear' : 'capture'}
          disabled={locked}
          options={[
            { value: 'capture', label: 'Capture', tip: tt('Copies the selection of the app in front into the slot', 'Copia a seleção do app da frente para o slot') },
            { value: 'clear', label: 'Clear', tip: tt('Empties the slot; with no name, every slot', 'Esvazia o slot; sem nome, todos os slots') },
          ]}
          onChange={(v) => edit([{ field: 'slotMode', value: v === 'clear' ? 'clear' : '' }])}
        />
      </Section>
      <Section
        label="Slot"
        hint={unusableName(slot) ? <span data-error="">Letters, digits and _ only — skipped at replay as written.</span>
          : clear ? 'Blank clears all slots.' : 'Read it back with {clip:slot}.'}
      >
        <DraftField stepId={id} field="key" label="Slot" kind="mono" placeholder={clear ? 'all slots' : '1'} stored={slot} disabled={locked} filter={keepName} parse={asTyped} />
      </Section>
    </>
  );
}
