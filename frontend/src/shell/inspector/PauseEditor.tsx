import type { ActionItem } from '../../bridge/messageTypes';
import { useSteps } from '../../logic/useSteps';
import { useLanguage } from '../../state/LanguageContext';
import { formatMs } from '../../utils/displayUtils';
import { keycaps } from '../library/model';
import { Chips, DraftField, KeyCapture, Section } from './fields';
import { applyEdits } from './inspectorState';

const TIMEOUT_CHIPS = [100, 500, 1000, 5000];
// The Pause's ceiling, 24 h — WebViewBridge.MaxPauseTimeoutMs.
const MAX_TIMEOUT_MS = 86_400_000;

/**
 * ⑧ Pause: the key that resumes the run, captured in the panel (Esc stops listening; typed beside
 * it, Esc is a key like any other, D12), and the timeout, with its quick values and ∞. The summary
 * says which comes first — and that a Pause with neither is skipped (D13).
 */
export function PauseEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const { language } = useLanguage();
  const id = step.id ?? '';
  const setKey = (key: string) => applyEdits(cmds, id, [{ field: 'key', value: key }]);
  const timeout = step.timeout ?? 0;
  const ms = `${formatMs(timeout, language)} ms`;
  const key = step.key ? keycaps(step.key) : '';
  const summary = key && timeout > 0 ? `Resumes on ${key} or after ${ms} — whichever comes first.`
    : key ? `Waits until ${key} is pressed.`
    : timeout > 0 ? `Waits ${ms}, then continues.`
    : 'No resume key and no timeout — this Pause is skipped.';

  return (
    <>
      <Section label="Resume key">
        <KeyCapture value={step.key} label="Capture the resume key" onCapture={setKey} disabled={locked} />
        <div className="insp-pair">
          <DraftField stepId={id} field="key" label="Type the resume key" kind="mono" placeholder="F8 · Esc · Ctrl+R" stored={step.key} disabled={locked} />
          <button type="button" className="insp-button" disabled={locked || !step.key} onClick={() => setKey('')}>Clear</button>
        </div>
      </Section>
      <Section label="Timeout">
        <DraftField stepId={id} field="timeout" label="Pause timeout in milliseconds" kind="int" min={0} max={MAX_TIMEOUT_MS} empty="min" unit="ms" stored={String(timeout)} disabled={locked} />
        <Chips values={TIMEOUT_CHIPS} current={timeout} forever onPick={(v) => applyEdits(cmds, id, [{ field: 'timeout', value: String(v) }])} disabled={locked} />
      </Section>
      <p className="insp-summary" aria-live="polite" data-error={!key && timeout <= 0 ? '' : undefined}>{summary}</p>
    </>
  );
}
