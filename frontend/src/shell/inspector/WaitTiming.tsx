import type { ActionItem } from '../../bridge/messageTypes';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
import { Chips, DraftField, Section, Segmented } from './fields';
import { applyEdits } from './inspectorState';

const TIMEOUT_CHIPS = [5000, 10000, 30000, 60000];
// The engine's floor for a wait (WebViewBridge, the "timeout" edit).
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 86_400_000;

/** How long a wait gives itself: its own timeout, else what the engine waits with none. */
export const waitTimeout = (step: ActionItem, engineDefault: number) => (step.timeout > 0 ? step.timeout : engineDefault);

/** Whether a timeout goes on to the next step. Wait Pixel Color keeps it in a field of its own. */
export const goesOn = (step: ActionItem) =>
  (step.actionType === 'WaitPixelColor' ? step.pixelOnTimeout : step.waitImageOnTimeout) === 'Continue';

/**
 * A wait's Timeout, with its shortcuts, and what a timeout does: Halt stops the run, Continue goes
 * on to the next step (Wait Image, Wait Text and Wait Pixel Color).
 */
export function WaitTiming({ step, locked, timeout }: { step: ActionItem; locked: boolean; timeout: number }) {
  const cmds = useSteps();
  const tt = useTt();
  const id = step.id ?? '';
  const field = step.actionType === 'WaitPixelColor' ? 'pixelOnTimeout' : 'waitImageOnTimeout';
  return (
    <>
      <Section label="Timeout">
        <DraftField stepId={id} field="timeout" label="Timeout in milliseconds" kind="int" step={1000} min={MIN_TIMEOUT_MS} max={MAX_TIMEOUT_MS} unit="ms" stored={String(timeout)} disabled={locked} />
        <Chips values={TIMEOUT_CHIPS} current={timeout} disabled={locked} onPick={(v) => applyEdits(cmds, id, [{ field: 'timeout', value: String(v) }])} />
      </Section>
      <Section label="On timeout">
        <Segmented<'halt' | 'continue'>
          label="On timeout"
          value={goesOn(step) ? 'continue' : 'halt'}
          disabled={locked}
          options={[{ value: 'halt', label: 'Halt', tip: tt('The run stops', 'A execução para') }, { value: 'continue', label: 'Continue', tip: tt('The run goes on to the next step', 'A execução segue para o próximo passo') }]}
          onChange={(v) => applyEdits(cmds, id, [{ field, value: v === 'continue' ? 'Continue' : '' }])}
        />
      </Section>
    </>
  );
}
