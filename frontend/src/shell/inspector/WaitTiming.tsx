import type { ActionItem } from '../../bridge/messageTypes';
import { t } from '../../i18n';
import { useSteps } from '../../logic/useSteps';
import { Chips, DraftField, Section, Segmented } from './fields';
import { applyEdits } from './inspectorState';

const TIMEOUT_CHIPS = [5000, 10000, 30000, 60000];
// The engine's floor for a wait (WebViewBridge, the "timeout" edit).
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 86_400_000;

/** How long a wait gives itself: its own timeout, else what the engine waits with none. */
export const waitTimeout = (step: ActionItem, engineDefault: number) => (step.timeout > 0 ? step.timeout : engineDefault);

// Where a step keeps what its timeout does: Wait Pixel Color and Activate Window in a field of their
// own, Wait Image and Wait Text in the image's.
const ON_TIMEOUT: Record<string, 'pixelOnTimeout' | 'activateOnTimeout'> = { WaitPixelColor: 'pixelOnTimeout', ActivateWindow: 'activateOnTimeout' };
const onTimeoutField = (step: ActionItem) => ON_TIMEOUT[step.actionType] ?? 'waitImageOnTimeout';

/** Whether a timeout goes on to the next step. */
export const goesOn = (step: ActionItem) => step[onTimeoutField(step)] === 'Continue';

/**
 * A wait's Timeout, with its shortcuts, and what a timeout does: Halt stops the run, Continue goes
 * on to the next step (Wait Image, Wait Text, Wait Pixel Color, and Activate Window waiting for its
 * window).
 */
export function WaitTiming({ step, locked, timeout, label = t('inspector.wait.timeoutField') }: { step: ActionItem; locked: boolean; timeout: number; label?: string }) {
  const cmds = useSteps();
  const id = step.id ?? '';
  const field = onTimeoutField(step);
  return (
    <>
      <Section label={t('inspector.wait.timeout')}>
        <DraftField stepId={id} field="timeout" label={label} kind="int" step={1000} min={MIN_TIMEOUT_MS} max={MAX_TIMEOUT_MS} unit="ms" stored={String(timeout)} disabled={locked} />
        <Chips values={TIMEOUT_CHIPS} current={timeout} disabled={locked} onPick={(v) => applyEdits(cmds, id, [{ field: 'timeout', value: String(v) }])} />
      </Section>
      <Section label={t('inspector.wait.onTimeout')}>
        <Segmented<'halt' | 'continue'>
          label={t('inspector.wait.onTimeout')}
          value={goesOn(step) ? 'continue' : 'halt'}
          disabled={locked}
          options={[
            { value: 'halt', label: t('inspector.wait.halt'), tip: t('inspector.wait.haltTip') },
            { value: 'continue', label: t('inspector.wait.continue'), tip: t('inspector.wait.continueTip') },
          ]}
          onChange={(v) => applyEdits(cmds, id, [{ field, value: v === 'continue' ? 'Continue' : '' }])}
        />
      </Section>
    </>
  );
}
