import type { ActionItem } from '../../bridge/messageTypes';
import { useSteps } from '../../logic/useSteps';
import { useLanguage } from '../../state/LanguageContext';
import { formatMs } from '../../utils/displayUtils';
import { Section, Segmented, Switch } from './fields';
import { applyEdits, type StepEdit } from './inspectorState';
import { PixelCheck } from './screenChecks';
import { goesOn, waitTimeout, WaitTiming } from './WaitTiming';

// What the engine waits with no timeout of its own (ActionExecution, ExecuteWaitPixelColor).
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * ⑧ Wait Pixel Color: the point and its colour, with their test (the If's pixel check), then what
 * the wait is for — the colour to match or to stop matching —, how long, what a timeout does, and
 * the click on the point. The summary says it in one sentence (D13).
 */
export function WaitPixelEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const { language } = useLanguage();
  const edit = (edits: StepEdit[]) => applyEdits(cmds, step.id ?? '', edits);
  const gone = !!step.pixelInvert;
  const timeout = waitTimeout(step, DEFAULT_TIMEOUT_MS);
  const goOn = goesOn(step);
  const click = !gone && !!step.pixelClickOnMatch;
  const upTo = `${formatMs(timeout, language)} ms`;
  const summary = gone
    ? `Waits up to ${upTo} for the point to lose the color. If it keeps it, the run ${goOn ? 'goes on' : 'stops'}.`
    : `Waits up to ${upTo} for the point to show the color${click ? ', then clicks it' : ''}. If it never does, the run ${goOn ? 'goes on' : 'stops'}.`;

  return (
    <>
      <PixelCheck step={step} locked={locked} reads={gone ? 'gone' : 'found'} />
      <Section label="Wait until">
        <Segmented<'matches' | 'stops'>
          label="Wait until"
          value={gone ? 'stops' : 'matches'}
          disabled={locked}
          options={[{ value: 'matches', label: 'Matches' }, { value: 'stops', label: 'Stops matching' }]}
          onChange={(v) => edit([{ field: 'pixelInvert', value: String(v === 'stops') }])}
        />
      </Section>
      <WaitTiming step={step} locked={locked} timeout={timeout} />
      {!gone && (
        <div className="insp-row">
          <span className="insp-row-label">Click on found location</span>
          <Switch label="Click on found location" checked={click} disabled={locked} onChange={(on) => edit([{ field: 'pixelClickOnMatch', value: String(on) }])} />
        </div>
      )}
      <p className="insp-summary" aria-live="polite">{summary}</p>
    </>
  );
}
