import type { ActionItem } from '../../bridge/messageTypes';
import { useSteps } from '../../logic/useSteps';
import { useLanguage } from '../../state/LanguageContext';
import { formatMs } from '../../utils/displayUtils';
import { Chips, DraftField, Section, Segmented, Switch } from './fields';
import { ImageProbe } from './ImageProbe';
import { applyEdits, type StepEdit } from './inspectorState';

const TIMEOUT_CHIPS = [5000, 10000, 30000, 60000];
// The engine's floor for a wait (WebViewBridge, the "timeout" edit), and what it waits with none.
const MIN_TIMEOUT_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 86_400_000;

/**
 * ⑧ Wait Image: the reference image with its test, region and tolerance (ImageProbe), then what the
 * wait is for — the image to appear or to go —, how long, what a timeout does, and the click where
 * the image was found. The summary says it in one sentence (D13).
 */
export function WaitImageEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const { language } = useLanguage();
  const id = step.id ?? '';
  const edit = (edits: StepEdit[]) => applyEdits(cmds, id, edits);
  const gone = !!step.waitImageInvert;
  const timeout = step.timeout > 0 ? step.timeout : DEFAULT_TIMEOUT_MS;
  const goOn = step.waitImageOnTimeout === 'Continue';
  const click = !gone && !!step.waitImageClickOnMatch;
  const upTo = `${formatMs(timeout, language)} ms`;
  const summary = gone
    ? `Waits up to ${upTo} for the image to go. If it stays, the run ${goOn ? 'goes on' : 'stops'}.`
    : `Waits up to ${upTo} for the image${click ? ', then clicks where it is' : ''}. If it never shows, the run ${goOn ? 'goes on' : 'stops'}.`;

  return (
    <>
      <ImageProbe step={step} locked={locked} reads={gone ? 'gone' : 'found'} />
      <Section label="Wait until">
        <Segmented<'appears' | 'gone'>
          label="Wait until"
          value={gone ? 'gone' : 'appears'}
          disabled={locked}
          options={[{ value: 'appears', label: 'Appears' }, { value: 'gone', label: 'Disappears' }]}
          onChange={(v) => edit([{ field: 'waitImageInvert', value: String(v === 'gone') }])}
        />
      </Section>
      <Section label="Timeout">
        <DraftField stepId={id} field="timeout" label="Timeout in milliseconds" kind="int" min={MIN_TIMEOUT_MS} max={MAX_TIMEOUT_MS} empty="min" unit="ms" stored={String(timeout)} disabled={locked} />
        <Chips values={TIMEOUT_CHIPS} current={timeout} disabled={locked} onPick={(v) => edit([{ field: 'timeout', value: String(v) }])} />
      </Section>
      <Section label="On timeout">
        <Segmented<'halt' | 'continue'>
          label="On timeout"
          value={goOn ? 'continue' : 'halt'}
          disabled={locked}
          options={[{ value: 'halt', label: 'Halt', tip: 'The run stops' }, { value: 'continue', label: 'Continue', tip: 'The run goes on to the next step' }]}
          onChange={(v) => edit([{ field: 'waitImageOnTimeout', value: v === 'continue' ? 'Continue' : '' }])}
        />
      </Section>
      {!gone && (
        <div className="insp-row">
          <span className="insp-row-label">Click on found location</span>
          <Switch label="Click on found location" checked={click} disabled={locked} onChange={(on) => edit([{ field: 'waitImageClickOnMatch', value: String(on) }])} />
        </div>
      )}
      <p className="insp-summary" aria-live="polite">{summary}</p>
    </>
  );
}
