import { useState } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
import { preload } from '../lazyModule';
import { useShell } from '../store';
import { openCrop } from '../ui';
import { Section } from './fields';
import { applyEdits, loadReferenceCrop } from './inspectorState';
import { RailField, RegionField, ResultCard } from './probeKit';
import { around, regionOf, regionValue, useAsk } from './probes';

interface Match { found: boolean; score: number; x: number; y: number; w: number; h: number; error?: string }

/**
 * The reference image of a Wait Image or of an If that checks for one: the image — a press on it
 * crops it, in the expanded Inspector —, Recapture (the engine's capture writes it straight into
 * the step), Test match against the screen now — which also sets the search region around what it
 * found — the search region, and the tolerance. `reads` says how the verdict turns: a check that
 * passes when the image is not found, or a wait for the image to go.
 */
export function ImageProbe({ step, locked, reads }: { step: ActionItem; locked: boolean; reads: 'found' | 'not found' | 'gone' }) {
  const cmds = useSteps();
  const tools = useEditorTools();
  const tt = useTt();
  const id = step.id ?? '';
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
    if (r.found && !r.error && applyEdits(cmds, id, [{ field: 'waitImageSearchRegion', value: regionValue(around(r)) }])) setSnapped(true);
  }, 8000, () => setResult({ found: false, score: 0, x: 0, y: 0, w: 0, h: 0, error: 'No answer from the app.' }));
  const indexNow = () => useShell.getState().app.actions.findIndex(s => s.id === id);
  const flipped = reads !== 'found';

  return (
    <>
      <Section label="Reference image" hint={step.imageBase64 && known ? `${known.w} × ${known.h} px · press the image to crop it` : undefined}>
        {step.imageBase64 ? (
          <button
            type="button"
            className="insp-image"
            data-crop-open=""
            aria-label="Crop reference image"
            data-tip={tt('Crop it to the part that matters', 'Recortar só a parte que importa')}
            disabled={locked}
            onPointerEnter={warm}
            onFocus={warm}
            onClick={() => { if (id) void preload(loadReferenceCrop).then(() => openCrop(id)); }}
          >
            <img
              src={`data:image/png;base64,${step.imageBase64}`}
              alt="The reference image"
              onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight, of: step.imagePath })}
            />
          </button>
        ) : (
          <div className="insp-image" data-none="">
            <span>No image yet</span>
          </div>
        )}
        <div className="insp-pair">
          <button
            type="button"
            className="insp-button"
            disabled={locked}
            data-tip={tt('Capture the image again on the screen', 'Capturar a imagem de novo na tela')}
            onClick={() => { const index = indexNow(); if (index >= 0) tools.recaptureImage({ index }); }}
          >
            <span className="step-icon" data-icon="refresh-cw" />
            {step.imagePath ? 'Recapture' : 'Capture'}
          </button>
          <button
            type="button"
            className="insp-button"
            disabled={locked || !step.imagePath || test.waiting}
            onClick={() => {
              setResult(null);
              test.ask(requestId => tools.testImage({
                requestId, imagePath: step.imagePath, confidence: tolerance / 100, searchRegion: region ?? undefined,
              }));
            }}
          >
            <span className="step-icon" data-icon="play" />
            {test.waiting ? 'Testing…' : 'Test match'}
          </button>
        </div>
        {result && !test.waiting && (
          result.error ? <ResultCard ok={false} title={result.error} /> : (
            <ResultCard
              ok={result.found !== flipped}
              title={<>Best match <span className="insp-mono">{Math.round(result.score * 100)}%</span> at <span className="insp-mono">{result.x}, {result.y}</span>{result.found ? '' : ' — below the tolerance'}</>}
            >
              {reads === 'not found' && (result.found ? 'Set to pass when not found: right now it does not pass.' : 'Set to pass when not found: right now it passes.')}
              {reads === 'gone' && (result.found ? 'Still on the screen: the wait goes on.' : 'Not on the screen: the wait ends now.')}
              {snapped && <span>Search region set around this match.</span>}
            </ResultCard>
          )
        )}
      </Section>
      <RegionField
        region={region}
        locked={locked}
        wholeHint="The whole screen can match the wrong thing, and takes ~440 ms per check instead of ~4 ms."
        drawTip={tt('Faster, and fewer false matches', 'Mais rápido, e com menos acertos falsos')}
        onRegion={(r) => applyEdits(cmds, id, [{ field: 'waitImageSearchRegion', value: regionValue(r) }])}
      />
      <Section label="Tolerance" hint="Higher is stricter.">
        <RailField
          stepId={id}
          field="confidence"
          label="Tolerance"
          value={tolerance}
          min={10}
          max={100}
          step={5}
          unit="%"
          toValue={(n) => (Math.min(100, Math.max(10, n)) / 100).toFixed(2)}
          disabled={locked}
          onApply={(v) => applyEdits(cmds, id, [{ field: 'confidence', value: v }])}
        />
      </Section>
    </>
  );
}
