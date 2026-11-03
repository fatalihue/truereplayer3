import type { ActionItem } from '../../bridge/messageTypes';
import { fmtNum, t } from '../../i18n';
import { useSteps } from '../../logic/useSteps';
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
  const edit = (edits: StepEdit[]) => applyEdits(cmds, step.id ?? '', edits);
  const gone = !!step.pixelInvert;
  const timeout = waitTimeout(step, DEFAULT_TIMEOUT_MS);
  const goOn = goesOn(step);
  const click = !gone && !!step.pixelClickOnMatch;
  const ms = fmtNum(timeout);
  const summary = gone
    ? (goOn ? t('probe.wait.pixel.goneGoesOn', { ms }) : t('probe.wait.pixel.goneStops', { ms }))
    : click
      ? (goOn ? t('probe.wait.pixel.clickGoesOn', { ms }) : t('probe.wait.pixel.clickStops', { ms }))
      : (goOn ? t('probe.wait.pixel.goesOn', { ms }) : t('probe.wait.pixel.stops', { ms }));

  return (
    <>
      <PixelCheck step={step} locked={locked} reads={gone ? 'gone' : 'found'} />
      <Section label={t('probe.wait.until')}>
        <Segmented<'matches' | 'stops'>
          label={t('probe.wait.until')}
          value={gone ? 'stops' : 'matches'}
          disabled={locked}
          options={[{ value: 'matches', label: t('probe.wait.matches') }, { value: 'stops', label: t('probe.wait.stopsMatching') }]}
          onChange={(v) => edit([{ field: 'pixelInvert', value: String(v === 'stops') }])}
        />
      </Section>
      <WaitTiming step={step} locked={locked} timeout={timeout} />
      {!gone && (
        <div className="insp-row">
          <span className="insp-row-label">{t('probe.wait.clickOnFound')}</span>
          <Switch label={t('probe.wait.clickOnFound')} checked={click} disabled={locked} onChange={(on) => edit([{ field: 'pixelClickOnMatch', value: String(on) }])} />
        </div>
      )}
      <p className="insp-summary" aria-live="polite">{summary}</p>
    </>
  );
}
