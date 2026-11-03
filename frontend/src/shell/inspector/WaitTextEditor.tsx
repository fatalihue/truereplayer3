import type { ActionItem } from '../../bridge/messageTypes';
import { fmtNum, t } from '../../i18n';
import { useSteps } from '../../logic/useSteps';
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
  const edit = (edits: StepEdit[]) => applyEdits(cmds, step.id ?? '', edits);
  const mode: Mode = step.waitMode === 'disappears' || step.waitMode === 'changes' ? step.waitMode : 'appears';
  const timeout = waitTimeout(step, DEFAULT_TIMEOUT_MS);
  const goOn = goesOn(step);
  const click = mode === 'appears' && !!step.waitImageClickOnMatch;
  const ms = fmtNum(timeout);
  const summary = mode === 'changes' ? (goOn ? t('probe.wait.text.changesGoesOn', { ms }) : t('probe.wait.text.changesStops', { ms }))
    : mode === 'disappears' ? (goOn ? t('probe.wait.text.goneGoesOn', { ms }) : t('probe.wait.text.goneStops', { ms }))
    : click ? (goOn ? t('probe.wait.text.clickGoesOn', { ms }) : t('probe.wait.text.clickStops', { ms }))
    : (goOn ? t('probe.wait.text.goesOn', { ms }) : t('probe.wait.text.stops', { ms }));

  return (
    <>
      <Section label={t('probe.wait.until')}>
        <Segmented<Mode>
          label={t('probe.wait.until')}
          value={mode}
          disabled={locked}
          options={[
            { value: 'appears', label: t('probe.wait.appears') },
            { value: 'disappears', label: t('probe.wait.disappears') },
            { value: 'changes', label: t('probe.wait.changes'), tip: t('probe.wait.changesTip') },
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
          <span className="insp-row-label">{t('probe.wait.clickOnFound')}</span>
          <Switch label={t('probe.wait.clickOnFound')} checked={click} disabled={locked} onChange={(on) => edit([{ field: 'waitImageClickOnMatch', value: String(on) }])} />
        </div>
      )}
      <p className="insp-summary" aria-live="polite">{summary}</p>
    </>
  );
}
