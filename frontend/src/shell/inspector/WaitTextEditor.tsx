import type { ActionItem } from '../../bridge/messageTypes';
import { useSteps } from '../../logic/useSteps';
import { useLanguage, useTt } from '../../state/LanguageContext';
import { formatMs } from '../../utils/displayUtils';
import { Section, Segmented, Switch } from './fields';
import { applyEdits, type StepEdit } from './inspectorState';
import { ScreenTextCheck } from './screenChecks';
import { goesOn, waitTimeout, WaitTiming } from './WaitTiming';

// What the engine waits with no timeout of its own (ActionExecution, ExecuteWaitText).
const DEFAULT_TIMEOUT_MS = 30000;
type Mode = 'appears' | 'disappears' | 'changes';

/**
 * ⑧ Wait Text: what the wait is for — the text to appear or to go, or the region to read something
 * else —, then the region and the text looked for (the If's OCR editor; Changes looks for no text),
 * how long, what a timeout does, and the click on the text found. The choice comes first because
 * it shapes the fields under it. The summary says it in one sentence (D13).
 */
export function WaitTextEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const { language } = useLanguage();
  const tt = useTt();
  const edit = (edits: StepEdit[]) => applyEdits(cmds, step.id ?? '', edits);
  const mode: Mode = step.waitMode === 'disappears' || step.waitMode === 'changes' ? step.waitMode : 'appears';
  const timeout = waitTimeout(step, DEFAULT_TIMEOUT_MS);
  const then = `the run ${goesOn(step) ? 'goes on' : 'stops'}`;
  const click = mode === 'appears' && !!step.waitImageClickOnMatch;
  const upTo = `${formatMs(timeout, language)} ms`;
  const summary = mode === 'changes' ? `Waits up to ${upTo} for the region to read something else. If it never does, ${then}.`
    : mode === 'disappears' ? `Waits up to ${upTo} for the text to go. If it stays, ${then}.`
    : `Waits up to ${upTo} for the text${click ? ', then clicks it' : ''}. If it never shows, ${then}.`;

  return (
    <>
      <Section label="Wait until">
        <Segmented<Mode>
          label="Wait until"
          value={mode}
          disabled={locked}
          options={[
            { value: 'appears', label: 'Appears' },
            { value: 'disappears', label: 'Disappears' },
            { value: 'changes', label: 'Changes', tip: tt('Waits for the region to read something else', 'Espera a região mostrar outra coisa') },
          ]}
          onChange={(v) => edit([{ field: 'waitMode', value: v === 'appears' ? '' : v }])}
        />
      </Section>
      {/* Keyed by the variant: a test read for a text says nothing about a change, and back. */}
      <ScreenTextCheck
        key={mode === 'changes' ? 'watch' : 'match'}
        step={step}
        locked={locked}
        variant={mode === 'changes' ? 'watch' : 'match'}
        reads={mode === 'disappears' ? 'gone' : 'found'}
      />
      <WaitTiming step={step} locked={locked} timeout={timeout} />
      {mode === 'appears' && (
        <div className="insp-row">
          <span className="insp-row-label">Click on found location</span>
          <Switch label="Click on found location" checked={click} disabled={locked} onChange={(on) => edit([{ field: 'waitImageClickOnMatch', value: String(on) }])} />
        </div>
      )}
      <p className="insp-summary" aria-live="polite">{summary}</p>
    </>
  );
}
