import type { ActionItem } from '../../bridge/messageTypes';
import { fmtNum, t } from '../../i18n';
import { useSteps } from '../../logic/useSteps';
import { Section, Segmented, Switch } from './fields';
import { ImageProbe } from './ImageProbe';
import { applyEdits, type StepEdit } from './inspectorState';
import { goesOn, waitTimeout, WaitTiming } from './WaitTiming';

// What the engine waits with no timeout of its own (ActionExecution, ExecuteWaitImage).
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * ⑧ Wait Image: the reference image with its test, region and tolerance (ImageProbe), then what the
 * wait is for — the image to appear or to go —, how long, what a timeout does, and the click where
 * the image was found. The summary says it in one sentence (D13).
 */
export function WaitImageEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const id = step.id ?? '';
  const edit = (edits: StepEdit[]) => applyEdits(cmds, id, edits);
  const gone = !!step.waitImageInvert;
  const timeout = waitTimeout(step, DEFAULT_TIMEOUT_MS);
  const goOn = goesOn(step);
  const click = !gone && !!step.waitImageClickOnMatch;
  const ms = fmtNum(timeout);
  const summary = gone
    ? (goOn ? t('probe.wait.image.goneGoesOn', { ms }) : t('probe.wait.image.goneStops', { ms }))
    : click
      ? (goOn ? t('probe.wait.image.clickGoesOn', { ms }) : t('probe.wait.image.clickStops', { ms }))
      : (goOn ? t('probe.wait.image.goesOn', { ms }) : t('probe.wait.image.stops', { ms }));

  return (
    <>
      <ImageProbe step={step} locked={locked} reads={gone ? 'gone' : 'found'} />
      <Section label={t('probe.wait.until')}>
        <Segmented<'appears' | 'gone'>
          label={t('probe.wait.until')}
          value={gone ? 'gone' : 'appears'}
          disabled={locked}
          options={[{ value: 'appears', label: t('probe.wait.appears') }, { value: 'gone', label: t('probe.wait.disappears') }]}
          onChange={(v) => edit([{ field: 'waitImageInvert', value: String(v === 'gone') }])}
        />
      </Section>
      <WaitTiming step={step} locked={locked} timeout={timeout} />
      {!gone && (
        <div className="insp-row">
          <span className="insp-row-label">{t('probe.wait.clickOnFound')}</span>
          <Switch label={t('probe.wait.clickOnFound')} checked={click} disabled={locked} onChange={(on) => edit([{ field: 'waitImageClickOnMatch', value: String(on) }])} />
        </div>
      )}
      <p className="insp-summary" aria-live="polite">{summary}</p>
    </>
  );
}
