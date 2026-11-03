import { useState } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { fmtNum, t } from '../../i18n';
import { useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
import { preload } from '../lazyModule';
import { useShell } from '../store';
import { openCrop } from '../ui';
import { useCheckTarget } from './checkTarget';
import { Section } from './fields';
import { applyEdits, loadReferenceCrop, type StepEdit } from './inspectorState';
import { RailField, RegionField, ResultCard } from './probeKit';
import { around, regionOf, regionValue, useAsk, VALUE_A, VALUE_B, withValues } from './probes';

interface Match { found: boolean; score: number; x: number; y: number; w: number; h: number; error?: string }

/**
 * The reference image of a Wait Image or of an If that checks for one: the image — a press on it
 * crops it, in the expanded Inspector —, Recapture (the engine's capture writes it straight into
 * the step), Test match against the screen now — which also sets the search region around what it
 * found —, Choose file… (a picture on disk instead of a capture, written in the same way) and Save
 * image… (the PNG, wherever the user wants it), the search region, and the tolerance. `reads` says
 * how the verdict turns: a check that passes when the image is not found, or a wait for the image to
 * go. An automation's image (checkTarget) is captured, chosen and cropped through the automation's
 * own messages, and looked for on the screen or on its window, among its macro's files.
 */
export function ImageProbe({ step, locked, reads }: { step: ActionItem; locked: boolean; reads: 'found' | 'not found' | 'gone' }) {
  const cmds = useSteps();
  const tools = useEditorTools();
  const target = useCheckTarget();
  const id = step.id ?? '';
  const edit = (edits: StepEdit[]) => (target ? target.edit(edits) : applyEdits(cmds, id, edits));
  const region = regionOf(step);
  const tolerance = Math.round((step.confidence || 0.8) * 100);
  const [result, setResult] = useState<Match | null>(null);
  const [snapped, setSnapped] = useState(false);
  // The image's own size, once it is drawn: what a crop makes smaller.
  const [size, setSize] = useState<{ w: number; h: number; of: string } | null>(null);
  const known = size && size.of === step.imagePath ? size : null;
  const warm = () => { void preload(loadReferenceCrop); };
  const test = useAsk('image:testMatchResult', (r) => {
    setResult(r);
    setSnapped(false);
    if (r.found && !r.error && edit([{ field: 'waitImageSearchRegion', value: regionValue(around(r)) }])) setSnapped(true);
  }, 8000, () => setResult({ found: false, score: 0, x: 0, y: 0, w: 0, h: 0, error: t('probe.noAnswer') }));
  const indexNow = () => useShell.getState().app.actions.findIndex(s => s.id === id);
  const flipped = reads !== 'found';

  return (
    <>
      <Section label={t('probe.image.reference')} hint={step.imageBase64 && known ? t('probe.image.sizeHint', { w: known.w, h: known.h }) : undefined}>
        {step.imageBase64 ? (
          <button
            type="button"
            className="insp-image"
            data-crop-open=""
            aria-label={t('probe.image.crop')}
            data-tip={t('probe.image.cropTip')}
            disabled={locked}
            onPointerEnter={warm}
            onFocus={warm}
            onClick={() => {
              if (target) void preload(loadReferenceCrop).then(target.cropImage);
              else if (id) void preload(loadReferenceCrop).then(() => openCrop(id));
            }}
          >
            <img
              src={`data:image/png;base64,${step.imageBase64}`}
              alt={t('probe.image.alt')}
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight, of: step.imagePath })}
            />
          </button>
        ) : (
          <div className="insp-image" data-none="">
            <span>{t('probe.image.none')}</span>
          </div>
        )}
        <div className="insp-pair">
          <button
            type="button"
            className="insp-button"
            disabled={locked}
            data-tip={t('probe.image.recaptureTip')}
            onClick={() => {
              if (target) { target.captureImage(); return; }
              const index = indexNow();
              if (index >= 0) tools.recaptureImage({ index });
            }}
          >
            <span className="step-icon" data-icon="refresh-cw" />
            {step.imagePath ? t('probe.image.recapture') : t('probe.image.capture')}
          </button>
          <button
            type="button"
            className="insp-button"
            disabled={locked || !step.imagePath || test.waiting}
            onClick={() => {
              setResult(null);
              test.ask(requestId => tools.testImage({
                requestId, imagePath: step.imagePath, confidence: tolerance / 100, searchRegion: region ?? undefined,
                ...(target ? { ...target.tools, profile: target.profile } : {}),
              }));
            }}
          >
            <span className="step-icon" data-icon="play" />
            {test.waiting ? t('probe.testing') : t('probe.testMatch')}
          </button>
        </div>
        <div className="insp-pair">
          <button
            type="button"
            className="insp-button"
            disabled={locked}
            data-tip={t('probe.image.chooseFileTip')}
            onClick={() => {
              if (target) { target.chooseImage(); return; }
              const index = indexNow();
              if (index >= 0) tools.chooseImageFile({ index });
            }}
          >
            <span className="step-icon" data-icon="folder-open" />
            {t('probe.image.chooseFile')}
          </button>
          <button
            type="button"
            className="insp-button"
            disabled={!step.imagePath}
            data-tip={t('probe.image.saveTip')}
            onClick={() => tools.saveImage({ imagePath: step.imagePath, ...(target ? { profile: target.profile } : {}) })}
          >
            <span className="step-icon" data-icon="download" />
            {t('probe.image.save')}
          </button>
        </div>
        {result && !test.waiting && (
          result.error ? <ResultCard ok={false} title={result.error} /> : (
            <ResultCard
              ok={result.found !== flipped}
              title={withValues(
                result.found ? t('probe.image.best', { score: VALUE_A, point: VALUE_B }) : t('probe.image.bestBelow', { score: VALUE_A, point: VALUE_B }),
                <span className="insp-mono">{fmtNum(Math.round(result.score * 100))}%</span>,
                <span className="insp-mono">{result.x}, {result.y}</span>,
              )}
            >
              {reads === 'not found' && (result.found ? t('probe.image.notFoundFails') : t('probe.image.notFoundPasses'))}
              {reads === 'gone' && (result.found ? t('probe.stillOnScreen') : t('probe.offScreen'))}
              {snapped && <span>{t('probe.regionSet')}</span>}
            </ResultCard>
          )
        )}
      </Section>
      <RegionField
        region={region}
        locked={locked}
        wholeHint={t('probe.image.wholeHint')}
        drawTip={t('probe.image.drawTip')}
        onRegion={(r) => edit([{ field: 'waitImageSearchRegion', value: regionValue(r) }])}
      />
      <Section label={t('probe.tolerance')} hint={t('probe.image.toleranceHint')}>
        <RailField
          stepId={id}
          field="confidence"
          label={t('probe.tolerance')}
          value={tolerance}
          min={10}
          max={target ? 99 : 100}
          step={5}
          unit="%"
          toValue={(n) => (Math.min(target ? 99 : 100, Math.max(10, n)) / 100).toFixed(2)}
          disabled={locked}
          onApply={(v) => edit([{ field: 'confidence', value: v }])}
        />
      </Section>
    </>
  );
}
