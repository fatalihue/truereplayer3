import type { ActionItem } from '../../bridge/messageTypes';
import { t } from '../../i18n';
import { useSteps } from '../../logic/useSteps';
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
  const id = step.id ?? '';
  const setKey = (key: string) => applyEdits(cmds, id, [{ field: 'key', value: key }]);
  const timeout = step.timeout ?? 0;
  const ms = formatMs(timeout);
  const key = step.key ? keycaps(step.key) : '';
  const summary = key && timeout > 0 ? t('editors.pause.summary.either', { key, ms })
    : key ? t('editors.pause.summary.key', { key })
    : timeout > 0 ? t('editors.pause.summary.time', { ms })
    : t('editors.pause.summary.none');

  return (
    <>
      <Section label={t('editors.pause.resumeKey')}>
        <KeyCapture value={step.key} label={t('editors.pause.captureField')} onCapture={setKey} disabled={locked} />
        <div className="insp-pair">
          <DraftField stepId={id} field="key" label={t('editors.pause.typeField')} kind="mono" placeholder={t('editors.pause.placeholder')} stored={step.key} disabled={locked} />
          <button type="button" className="insp-button" disabled={locked || !step.key} onClick={() => setKey('')}>{t('common.actions.clear')}</button>
        </div>
      </Section>
      <Section label={t('inspector.wait.timeout')}>
        <DraftField stepId={id} field="timeout" label={t('editors.pause.timeoutField')} kind="int" step={1000} min={0} max={MAX_TIMEOUT_MS} unit="ms" stored={String(timeout)} disabled={locked} />
        <Chips values={TIMEOUT_CHIPS} current={timeout} forever onPick={(v) => applyEdits(cmds, id, [{ field: 'timeout', value: String(v) }])} disabled={locked} />
      </Section>
      <p className="insp-summary" aria-live="polite" data-error={!key && timeout <= 0 ? '' : undefined}>{summary}</p>
    </>
  );
}
