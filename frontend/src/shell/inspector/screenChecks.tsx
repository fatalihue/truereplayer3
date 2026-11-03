import { useEffect, useRef, useState } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { fmtNum, t } from '../../i18n';
import { useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
import { effectiveOperator, isNumberMode, parsesAsNumber, regexProblem } from '../../utils/screenText';
import { useCheckTarget } from './checkTarget';
import { useCaptureFor } from './captureFor';
import { DraftField, Section, Segmented } from './fields';
import { applyEdits, type StepEdit } from './inspectorState';
import { ExtensionMissing, OcrMissing } from './missing';
import { HexField, RailField, RegionField, ResultCard } from './probeKit';
import { around, normalHex, regionOf, regionValue, useAsk, VALUE_A, VALUE_B, withValues } from './probes';
import { SelectorField } from './selectorField';

type Props = { step: ActionItem; locked: boolean };
/** How a test's verdict turns, as the image probe's: a check that passes when what it looks for is
 *  not found, or a wait for it to go. */
type Reads = 'found' | 'not found' | 'gone';
/** The step's edits, or what the check edits instead (an automation's trigger: checkTarget). */
const useEdit = (step: ActionItem) => {
  const cmds = useSteps();
  const target = useCheckTarget();
  return (edits: StepEdit[]) => (target ? target.edit(edits) : applyEdits(cmds, step.id ?? '', edits));
};

/**
 * Pixel color: one point of the screen and the colour it must have, within a tolerance per channel.
 * Pick fills the point and its colour from one click; Test match reads the pixel now.
 */
export function PixelCheck({ step, locked, reads }: Props & { reads: Reads }) {
  const edit = useEdit(step);
  const tools = useEditorTools();
  // An automation's point is on the screen, or on its own window: the tools say so.
  const where = useCheckTarget()?.tools;
  const captureFor = useCaptureFor();
  const id = step.id ?? '';
  const tolerance = step.pixelTolerance ?? 0;
  const pick = useAsk('pixel:colorPicked', (p) => {
    if (!p.cancelled && !p.refused && p.x != null && p.y != null && p.hex) {
      edit([{ field: 'pixelX', value: String(p.x) }, { field: 'pixelY', value: String(p.y) }, { field: 'pixelColor', value: p.hex }]);
    }
  });
  const [result, setResult] = useState<{ matches: boolean; sampledHex?: string | null; error?: string } | null>(null);
  const test = useAsk('pixel:testMatchResult', setResult, 5000, () => setResult({ matches: false, error: t('probe.noAnswer') }));
  const target = normalHex(step.pixelColor ?? '');
  const flipped = reads !== 'found';

  return (
    <>
      <Section label={t('probe.pixel.point')}>
        <div className="insp-line">
          <DraftField stepId={id} field="pixelX" label={t('probe.pixel.x')} kind="int" signed min={-2_000_000} max={2_000_000} empty="clear" prefix="X" placeholder="—" stored={step.pixelX == null ? '' : String(step.pixelX)} disabled={locked} />
          <DraftField stepId={id} field="pixelY" label={t('probe.pixel.y')} kind="int" signed min={-2_000_000} max={2_000_000} empty="clear" prefix="Y" placeholder="—" stored={step.pixelY == null ? '' : String(step.pixelY)} disabled={locked} />
          <button type="button" className="insp-button" disabled={locked || pick.waiting} data-tip={t('probe.pixel.pickTip')} onClick={() => pick.ask(requestId => tools.pickColor({ requestId, ...where, captureFor }))}>
            <span className="step-icon" data-icon="pipette" />
            {pick.waiting ? t('probe.picking') : t('probe.pick')}
          </button>
        </div>
      </Section>
      <Section label={t('probe.pixel.target')}>
        <HexField stepId={id} field="pixelColor" label={t('probe.pixel.target')} stored={step.pixelColor ?? ''} disabled={locked} clearable />
      </Section>
      <Section label={t('probe.tolerance')} aside={t('probe.pixel.perChannel')} hint={t('probe.pixel.toleranceHint')}>
        <RailField stepId={id} field="pixelTolerance" label={t('probe.pixel.toleranceField')} value={tolerance} min={0} max={255} railMax={50} disabled={locked} onApply={(v) => edit([{ field: 'pixelTolerance', value: v }])} />
      </Section>
      <button
        type="button"
        className="insp-button"
        disabled={locked || test.waiting}
        onClick={() => {
          if (step.pixelX == null || step.pixelY == null || !target) { setResult({ matches: false, error: t('probe.pixel.setFirst') }); return; }
          setResult(null);
          test.ask(requestId => tools.testPixel({ requestId, x: step.pixelX ?? 0, y: step.pixelY ?? 0, hex: target, tolerance, ...where }));
        }}
      >
        <span className="step-icon" data-icon="play" />
        {test.waiting ? t('probe.testing') : t('probe.testMatch')}
      </button>
      {result && !test.waiting && (
        result.error ? <ResultCard ok={false} title={result.error} /> : (
          <ResultCard
            ok={result.matches !== flipped}
            title={withValues(
              result.matches ? t('probe.pixel.sampled', { sampled: VALUE_A, target: VALUE_B }) : t('probe.pixel.sampledOut', { sampled: VALUE_A, target: VALUE_B }),
              <span className="insp-mono">{result.sampledHex ?? '—'}</span>,
              <span className="insp-mono">{target} ± {tolerance}</span>,
            )}
          >
            {reads === 'not found' && (result.matches ? t('probe.pixel.notFoundFails') : t('probe.pixel.notFoundPasses'))}
            {reads === 'gone' && (result.matches ? t('probe.pixel.stillColor') : t('probe.pixel.notColor'))}
          </ResultCard>
        )
      )}
    </>
  );
}

type ReadMode = 'contains' | 'eq' | 'regex' | 'number';
interface Read { text?: string; matched?: boolean | null; number?: string | null; x?: number; y?: number; w?: number; h?: number; elapsedMs?: number; variant?: string; previewBase64?: string | null; error?: string }

/**
 * Text on screen (OCR): the region read, how the text is matched — Contains, Equals, Regex, or the
 * first number compared with a value, one control ("O conceito junta 'Read as' e 'Match'") —, the
 * text colour to read alone (game HUDs), and Test now, whose answer can become the text. Set
 * Variable's Screen mode reads with no match ('read'): the text, or the first number, is the value;
 * a Wait Text that waits for the region to change ('watch') reads it the same way.
 */
export function ScreenTextCheck({ step, locked, variant = 'match', reads = 'found' }: Props & { variant?: 'match' | 'read' | 'watch'; reads?: Reads }) {
  const read = variant !== 'match';
  const edit = useEdit(step);
  const tools = useEditorTools();
  // An automation's read: its region is on the screen or its window, it is required (D16), and the
  // watcher resolves no tokens.
  const auto = useCheckTarget();
  const captureFor = useCaptureFor();
  const id = step.id ?? '';
  const region = regionOf(step);
  const storedNumber = isNumberMode(step.ocrReadAs);
  const op = effectiveOperator(step.conditionOperator, storedNumber);
  const storedMode: ReadMode = storedNumber ? 'number' : (op as ReadMode);
  const operand = step.conditionOperand ?? '';
  // The text the field holds: what is being typed, else what it just sent until the step has it
  // (a click on a mode right after typing judges the text just typed), else the step's.
  const [typed, setTyped] = useState<string | null>(null);
  const [sent, setSent] = useState<{ value: string; over: string } | null>(null);
  // A switch to Regex over a text that does not compile is not sent: the check would fail on every
  // run. Regex shows here, the field says why, and the mode goes with the first pattern that
  // compiles, in one edit (as Text Match keeps a regex in the browser steps). Leaving the step keeps
  // the mode the step has.
  const [pendingRegex, setPendingRegex] = useState(false);
  const [seen, setSeen] = useState({ mode: storedMode, operand });
  if (seen.mode !== storedMode || seen.operand !== operand) {
    // The step's mode or text moved some other way (Ctrl+Z, Use this text): the switch held here
    // gives way. The echo of the text this field sent keeps it.
    const echo = seen.mode === storedMode && sent !== null && operand === sent.value;
    setSeen({ mode: storedMode, operand });
    if (pendingRegex && !echo) setPendingRegex(false);
  }
  if (sent && sent.over !== operand) setSent(null);
  // No echo within a second (the engine kept the value): the step's text counts again.
  useEffect(() => {
    if (!sent) return;
    const timer = setTimeout(() => setSent(null), 1000);
    return () => clearTimeout(timer);
  }, [sent]);
  const mode: ReadMode = pendingRegex ? 'regex' : storedMode;
  const number = mode === 'number';
  const color = normalHex(step.ocrTextColor ?? '');
  const colorTolerance = step.ocrColorTolerance ?? 70;
  const [result, setResult] = useState<Read | null>(null);
  const [snapped, setSnapped] = useState(false);
  const test = useAsk('ocr:testReadResult', (r) => {
    setResult(r);
    setSnapped(false);
    // A hit with no region yet: the region goes around it, which makes the next read fast and sure.
    if (r.matched && r.w && r.h && !region) {
      if (edit([{ field: 'waitImageSearchRegion', value: regionValue(around({ x: r.x ?? 0, y: r.y ?? 0, w: r.w, h: r.h })) }])) setSnapped(true);
    }
  }, 8000, () => setResult({ error: t('probe.noAnswer') }));
  const pick = useAsk('pixel:colorPicked', (p) => {
    if (!p.cancelled && !p.refused && p.hex) edit([{ field: 'ocrTextColor', value: p.hex }]);
  });

  // What is judged is what shows. A pattern that does not compile, or a value that is not a number,
  // is never sent — the check would fail on every run (today Save refused it); leaving the field
  // brings the last good one back.
  const text = typed ?? sent?.value ?? operand;
  const wrong = (s: string) => number ? (s.trim() !== '' && !s.includes('{') && !parsesAsNumber(s)) : mode === 'regex' && s !== '' && !!regexProblem(s);
  const problem = number
    ? (text.trim() === '' ? t('probe.text.enterNumber') : wrong(text) ? t('probe.text.notNumber') : null)
    : mode === 'regex'
      ? (text === '' ? t('probe.text.enterPattern')
        : pendingRegex && regexProblem(text) ? t('probe.text.noCompileYet')
        : regexProblem(text) ? t('probe.text.noCompile') : null)
      : (text.trim() === '' ? t('probe.text.enterText') : null);

  const modeEdits = (v: ReadMode): StepEdit[] => (v === 'number'
    ? [{ field: 'ocrReadAs', value: 'number' }, { field: 'conditionOperator', value: 'eq' }]
    : [{ field: 'ocrReadAs', value: '' }, { field: 'conditionOperator', value: v }]);
  const setMode = (v: ReadMode) => {
    if (v === storedMode) { setPendingRegex(false); return; }
    if (v === 'regex' && text !== '' && regexProblem(text)) { setPendingRegex(true); return; }
    setPendingRegex(false);
    edit(modeEdits(v));
  };
  const firstLine = (result?.text ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? '';

  return (
    <>
      <OcrMissing />
      <RegionField
        label={t('probe.text.region')}
        region={region}
        locked={locked}
        required={!!auto}
        wholeHint={auto ? t('probe.text.regionRequired') : t('probe.text.regionWhole')}
        drawTip={t('probe.text.regionTip')}
        onRegion={(r) => edit([{ field: 'waitImageSearchRegion', value: regionValue(r) }])}
      />
      {read ? (
        <Section
          label={t('probe.text.readAs')}
          hint={variant === 'watch'
            ? (number ? t('probe.text.watchesNumber') : t('probe.text.watchesText'))
            : (number ? t('probe.text.storesNumber') : t('probe.text.storesText'))}
        >
          <Segmented<'text' | 'number'>
            label={t('probe.text.readAs')}
            value={number ? 'number' : 'text'}
            disabled={locked}
            options={[
              { value: 'text', label: t('probe.text.asText') },
              { value: 'number', label: t('probe.text.number'), tip: t('probe.text.numberTip') },
            ]}
            onChange={(v) => edit([{ field: 'ocrReadAs', value: v === 'number' ? 'number' : '' }])}
          />
        </Section>
      ) : (
      <Section label={t('probe.text.section')}>
        <Segmented<ReadMode>
          label={t('probe.text.readAs')}
          value={mode}
          disabled={locked}
          options={[
            { value: 'contains', label: t('conditions.match.contains') },
            { value: 'eq', label: t('conditions.match.equals'), tip: t('probe.text.equalsTip') },
            { value: 'regex', label: 'Regex' },
            { value: 'number', label: t('probe.text.number'), tip: t('probe.text.numberTip') },
          ]}
          onChange={setMode}
        />
        {number && (
          <Segmented<'eq' | 'neq' | 'gt' | 'lt'>
            label={t('probe.text.compare')}
            value={op as 'eq' | 'neq' | 'gt' | 'lt'}
            disabled={locked}
            options={[{ value: 'eq', label: '=' }, { value: 'neq', label: '≠' }, { value: 'gt', label: '>' }, { value: 'lt', label: '<' }]}
            onChange={(v) => edit([{ field: 'conditionOperator', value: v }])}
          />
        )}
        <DraftField
          stepId={id}
          field="conditionOperand"
          label={number ? t('conditions.value') : t('probe.text.toFind')}
          kind="mono"
          placeholder={number ? '30' : mode === 'regex' ? t('probe.text.regexPlaceholder') : t('probe.text.placeholder')}
          stored={operand}
          disabled={locked}
          parse={(s) => (wrong(s) ? null : s)}
          onText={setTyped}
          onApply={(v) => {
            setSent({ value: v, over: operand });
            edit([...(pendingRegex ? modeEdits('regex') : []), { field: 'conditionOperand', value: v }]);
          }}
        />
        <span className="insp-hint">
          {problem ? <span data-error="">{problem}</span>
            : number ? (auto ? t('probe.text.numberHint') : t('probe.text.numberHintTokens'))
            : auto ? t('probe.text.textHint') : t('probe.text.textHintTokens')}
        </span>
      </Section>
      )}
      <Section label={t('probe.text.color')} hint={color ? undefined : t('probe.text.colorHint')}>
        <div className="insp-line">
          <HexField stepId={id} field="ocrTextColor" label={t('probe.text.color')} placeholder={t('probe.text.colorAny')} stored={step.ocrTextColor ?? ''} disabled={locked} clearable />
          <button type="button" className="insp-button" disabled={locked || pick.waiting} data-tip={t('probe.text.colorTip')} onClick={() => pick.ask(requestId => tools.pickColor({ requestId, captureFor }))}>
            <span className="step-icon" data-icon="pipette" />
            {pick.waiting ? t('probe.picking') : t('probe.pick')}
          </button>
          {color && (
            <button type="button" className="insp-icon-button" aria-label={t('probe.text.everyColor')} data-tip={t('probe.text.everyColor')} disabled={locked} onClick={() => edit([{ field: 'ocrTextColor', value: '' }])}>
              <span className="step-icon" data-icon="x" />
            </button>
          )}
        </div>
      </Section>
      {color && (
        <Section label={t('probe.text.colorTolerance')} hint={t('probe.text.colorToleranceHint')}>
          <RailField stepId={id} field="ocrColorTolerance" label={t('probe.text.colorTolerance')} value={colorTolerance} min={0} max={255} step={10} disabled={locked} onApply={(v) => edit([{ field: 'ocrColorTolerance', value: v }])} />
        </Section>
      )}
      <button
        type="button"
        className="insp-button"
        disabled={locked || test.waiting}
        onClick={() => {
          setResult(null);
          test.ask(requestId => tools.testScreenText({
            requestId,
            ...auto?.tools,
            searchRegion: region ?? undefined,
            // The step as it stands: a mode held back above is not the step's yet.
            readAs: storedNumber ? 'number' : null,
            operator: op,
            operand: read ? '' : operand,
            match: !read && operand !== '',
            textColor: color,
            tolerance: colorTolerance,
          }));
        }}
      >
        <span className="step-icon" data-icon="play" />
        {test.waiting ? t('probe.text.reading') : t('probe.text.testNow')}
      </button>
      {result && !test.waiting && (
        result.error ? <ResultCard ok={false} title={result.error} /> : (
          <ResultCard
            // A read with nothing to match (no text yet, or a read for the value) is good when it read something.
            ok={result.matched == null ? !!result.text : result.matched !== (reads !== 'found')}
            title={!result.text ? t('probe.text.nothing') : readTitle(result.text, result.number, result.matched)}
          >
            {reads === 'not found' && result.matched != null && (result.matched ? t('probe.text.notFoundFails') : t('probe.text.notFoundPasses'))}
            {reads === 'gone' && result.matched != null && (result.matched ? t('probe.stillOnScreen') : t('probe.offScreen'))}
            {(result.elapsedMs != null || result.variant) && <span>{[result.elapsedMs != null ? `${fmtNum(result.elapsedMs)} ms` : null, result.variant].filter(Boolean).join(' · ')}</span>}
            {result.previewBase64 && <img className="insp-result-image" src={`data:image/png;base64,${result.previewBase64}`} alt={t('probe.text.whatWasRead')} />}
            {snapped && <span>{t('probe.regionSet')}</span>}
            {!read && firstLine && !number && firstLine !== operand && (
              <button
                type="button"
                className="insp-link"
                disabled={locked}
                onClick={() => edit(mode === 'regex'
                  ? [{ field: 'conditionOperator', value: 'contains' }, { field: 'conditionOperand', value: firstLine }]
                  : [{ field: 'conditionOperand', value: firstLine }])}
              >
                {t('probe.text.useText')}
              </button>
            )}
          </ResultCard>
        )
      )}
    </>
  );
}

/**
 * What a test read says, in one sentence: the text (cut at 80), the first number in it when there is
 * one (drawn in the monospaced face), and whether it matches — a read for the value says nothing of that.
 */
function readTitle(read: string, number: string | null | undefined, matched: boolean | null | undefined) {
  const text = read.length > 80 ? `${read.slice(0, 77)}…` : read;
  if (!number) {
    return matched === false ? t('probe.text.readsNoMatch', { text }) : matched ? t('probe.text.readsMatch', { text }) : t('probe.text.reads', { text });
  }
  const sentence = matched === false ? t('probe.text.readsNumberNoMatch', { text, number: VALUE_A })
    : matched ? t('probe.text.readsNumberMatch', { text, number: VALUE_A })
    : t('probe.text.readsNumber', { text, number: VALUE_A });
  return withValues(sentence, <span className="insp-mono">{number}</span>);
}

type BrowserState = 'appears' | 'disappears' | 'enabled' | 'text-match';

/**
 * Browser element: an element of the active tab, by its CSS selector (the shield, Pick element and
 * the alternatives, as in the browser steps), in a state — visible, gone, enabled, or with a text.
 * Check now asks the page the same instant question the run asks.
 */
export function BrowserCheck({ step, locked }: Props) {
  const edit = useEdit(step);
  const tools = useEditorTools();
  const id = step.id ?? '';
  const selector = step.key ?? '';
  const alternatives = step.selectorAlternatives ?? [];
  const state: BrowserState = step.waitMode === 'disappears' || step.waitMode === 'enabled' || step.waitMode === 'text-match' ? step.waitMode : 'appears';
  const [result, setResult] = useState<{ satisfied: boolean; raw: boolean; connected: boolean; negate: boolean; lost?: boolean } | null>(null);
  const asked = useRef(false);
  const check = useAsk('browser:testConditionResult',
    (r) => setResult({ satisfied: r.satisfied, raw: r.raw, connected: r.connected, negate: asked.current }),
    6000,
    () => setResult({ satisfied: false, raw: false, connected: false, negate: asked.current, lost: true }));

  return (
    <div className="insp-group">
      <ExtensionMissing />
      <SelectorField step={step} locked={locked} hint={t('conditions.browser.offlineHint')} />
      <Section label={t('conditions.browser.state')}>
        <Segmented<BrowserState>
          label={t('conditions.browser.state')}
          value={state}
          disabled={locked}
          wrap
          options={[
            { value: 'appears', label: t('conditions.browser.visible') },
            { value: 'disappears', label: t('conditions.browser.gone') },
            { value: 'enabled', label: t('conditions.browser.enabled') },
            { value: 'text-match', label: t('conditions.browser.textMatches') },
          ]}
          onChange={(v) => edit([{ field: 'waitMode', value: v }])}
        />
      </Section>
      {state === 'text-match' && (
        <Section label={t('conditions.browser.textPattern')} hint={t('conditions.browser.textPatternHint')}>
          <DraftField stepId={id} field="browserText" label={t('conditions.browser.textPattern')} kind="mono" stored={step.browserText ?? ''} disabled={locked} parse={(s) => s} />
        </Section>
      )}
      <button
        type="button"
        className="insp-button"
        disabled={locked || check.waiting}
        onClick={() => {
          setResult(null);
          asked.current = !!step.conditionNegate;
          check.ask(requestId => tools.testBrowserCondition({
            requestId, key: selector, waitMode: state, browserText: step.browserText || null,
            conditionNegate: !!step.conditionNegate, alternatives: alternatives.length > 0 ? alternatives : null,
          }));
        }}
      >
        <span className="step-icon" data-icon="play" />
        {check.waiting ? t('conditions.browser.checking') : t('conditions.browser.checkNow')}
      </button>
      {result && !check.waiting && (
        <ResultCard
          ok={result.connected && result.satisfied}
          title={result.lost ? t('conditions.browser.lost')
            : !result.connected ? t('conditions.browser.offline')
            : result.satisfied ? t('conditions.browser.isTrue') : t('conditions.browser.isFalse')}
        >
          {result.lost ? t('conditions.browser.lostHint')
            : !result.connected ? t('conditions.browser.offlineMore')
            : result.negate ? (result.raw ? t('conditions.browser.negatedMatched') : t('conditions.browser.negatedNotMatched'))
            : t('conditions.browser.branch')}
        </ResultCard>
      )}
    </div>
  );
}
