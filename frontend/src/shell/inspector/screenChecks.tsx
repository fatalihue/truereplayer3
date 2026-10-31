import { useRef, useState } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
import { effectiveOperator, isNumberMode, parsesAsNumber, regexProblem } from '../../utils/screenText';
import { useCheckTarget } from './checkTarget';
import { DraftField, Section, Segmented } from './fields';
import { applyEdits, type StepEdit } from './inspectorState';
import { ExtensionMissing, OcrMissing } from './missing';
import { HexField, RailField, RegionField, ResultCard } from './probeKit';
import { around, normalHex, regionOf, regionValue, useAsk } from './probes';
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
  const tt = useTt();
  const id = step.id ?? '';
  const tolerance = step.pixelTolerance ?? 0;
  const pick = useAsk('pixel:colorPicked', (p) => {
    if (!p.cancelled && !p.refused && p.x != null && p.y != null && p.hex) {
      edit([{ field: 'pixelX', value: String(p.x) }, { field: 'pixelY', value: String(p.y) }, { field: 'pixelColor', value: p.hex }]);
    }
  });
  const [result, setResult] = useState<{ matches: boolean; sampledHex?: string | null; error?: string } | null>(null);
  const test = useAsk('pixel:testMatchResult', setResult, 5000, () => setResult({ matches: false, error: 'No answer from the app.' }));
  const target = normalHex(step.pixelColor ?? '');
  const flipped = reads !== 'found';

  return (
    <>
      <Section label="Point">
        <div className="insp-line">
          <DraftField stepId={id} field="pixelX" label="Pixel X" kind="int" signed min={-2_000_000} max={2_000_000} empty="clear" prefix="X" placeholder="—" stored={step.pixelX == null ? '' : String(step.pixelX)} disabled={locked} />
          <DraftField stepId={id} field="pixelY" label="Pixel Y" kind="int" signed min={-2_000_000} max={2_000_000} empty="clear" prefix="Y" placeholder="—" stored={step.pixelY == null ? '' : String(step.pixelY)} disabled={locked} />
          <button type="button" className="insp-button" disabled={locked || pick.waiting} data-tip={tt('Click a point of the screen: its place and its color', 'Clique num ponto da tela: o lugar e a cor dele')} onClick={() => pick.ask(requestId => tools.pickColor({ requestId, ...where }))}>
            <span className="step-icon" data-icon="pipette" />
            {pick.waiting ? 'Picking…' : 'Pick'}
          </button>
        </div>
      </Section>
      <Section label="Target color">
        <HexField stepId={id} field="pixelColor" label="Target color" stored={step.pixelColor ?? ''} disabled={locked} clearable />
      </Section>
      <Section label="Tolerance" aside="per channel" hint="5–15 for compressed colors.">
        <RailField stepId={id} field="pixelTolerance" label="Tolerance per channel" value={tolerance} min={0} max={255} railMax={50} disabled={locked} onApply={(v) => edit([{ field: 'pixelTolerance', value: v }])} />
      </Section>
      <button
        type="button"
        className="insp-button"
        disabled={locked || test.waiting}
        onClick={() => {
          if (step.pixelX == null || step.pixelY == null || !target) { setResult({ matches: false, error: 'Set X, Y and the target color first.' }); return; }
          setResult(null);
          test.ask(requestId => tools.testPixel({ requestId, x: step.pixelX ?? 0, y: step.pixelY ?? 0, hex: target, tolerance, ...where }));
        }}
      >
        <span className="step-icon" data-icon="play" />
        {test.waiting ? 'Testing…' : 'Test match'}
      </button>
      {result && !test.waiting && (
        result.error ? <ResultCard ok={false} title={result.error} /> : (
          <ResultCard
            ok={result.matches !== flipped}
            title={<>Sampled <span className="insp-mono">{result.sampledHex ?? '—'}</span> · Target <span className="insp-mono">{target} ± {tolerance}</span>{result.matches ? '' : ' — out of tolerance'}</>}
          >
            {reads === 'not found' && (result.matches ? 'Set to pass when not found: right now it does not pass.' : 'Set to pass when not found: right now it passes.')}
            {reads === 'gone' && (result.matches ? 'Still that color: the wait goes on.' : 'Not that color: the wait ends now.')}
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
  const tt = useTt();
  const id = step.id ?? '';
  const region = regionOf(step);
  const number = isNumberMode(step.ocrReadAs);
  const op = effectiveOperator(step.conditionOperator, number);
  const mode: ReadMode = number ? 'number' : (op as ReadMode);
  const operand = step.conditionOperand ?? '';
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
  }, 8000, () => setResult({ error: 'No answer from the app.' }));
  const pick = useAsk('pixel:colorPicked', (p) => {
    if (!p.cancelled && !p.refused && p.hex) edit([{ field: 'ocrTextColor', value: p.hex }]);
  });

  // What is judged is what shows: the text being typed, else the step's. A pattern that does not
  // compile, or a value that is not a number, is never sent — the check would fail on every run
  // (today Save refused it); leaving the field brings the last good one back.
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? operand;
  const wrong = (t: string) => number ? (t.trim() !== '' && !t.includes('{') && !parsesAsNumber(t)) : mode === 'regex' && t !== '' && !!regexProblem(t);
  const problem = number
    ? (text.trim() === '' ? 'Enter a number to compare with' : wrong(text) ? 'Not a number' : null)
    : mode === 'regex'
      ? (text === '' ? 'Enter the pattern to look for' : regexProblem(text))
      : (text.trim() === '' ? 'Enter the text to look for' : null);

  const setMode = (v: ReadMode) => {
    if (v === 'number') edit([{ field: 'ocrReadAs', value: 'number' }, { field: 'conditionOperator', value: 'eq' }]);
    else edit([{ field: 'ocrReadAs', value: '' }, { field: 'conditionOperator', value: v }]);
  };
  const firstLine = (result?.text ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? '';

  return (
    <>
      <OcrMissing />
      <RegionField
        label="Region to read"
        region={region}
        locked={locked}
        required={!!auto}
        wholeHint={auto ? 'Required — reading the whole screen every check is too slow.' : 'The whole screen takes ~0.5 s per read. Draw a region.'}
        drawTip={tt('Faster, and reads only what you mean', 'Mais rápido, e lê só o que você quer')}
        onRegion={(r) => edit([{ field: 'waitImageSearchRegion', value: regionValue(r) }])}
      />
      {read ? (
        <Section
          label="Read as"
          hint={variant === 'watch'
            ? (number ? 'Watches the first number in the region.' : 'Watches what the region reads.')
            : (number ? 'Stores the first number in the region.' : 'Stores what the region reads.')}
        >
          <Segmented<'text' | 'number'>
            label="Read as"
            value={number ? 'number' : 'text'}
            disabled={locked}
            options={[
              { value: 'text', label: 'Text' },
              { value: 'number', label: 'Number', tip: tt('The first number in the region', 'O primeiro número da região') },
            ]}
            onChange={(v) => edit([{ field: 'ocrReadAs', value: v === 'number' ? 'number' : '' }])}
          />
        </Section>
      ) : (
      <Section label="Text">
        <Segmented<ReadMode>
          label="Read as"
          value={mode}
          disabled={locked}
          options={[
            { value: 'contains', label: 'Contains' },
            { value: 'eq', label: 'Equals', tip: tt('The whole region reads exactly this', 'A região inteira diz exatamente isto') },
            { value: 'regex', label: 'Regex' },
            { value: 'number', label: 'Number', tip: tt('The first number in the region', 'O primeiro número da região') },
          ]}
          onChange={setMode}
        />
        {number && (
          <Segmented<'eq' | 'neq' | 'gt' | 'lt'>
            label="Compare"
            value={op as 'eq' | 'neq' | 'gt' | 'lt'}
            disabled={locked}
            options={[{ value: 'eq', label: '=' }, { value: 'neq', label: '≠' }, { value: 'gt', label: '>' }, { value: 'lt', label: '<' }]}
            onChange={(v) => edit([{ field: 'conditionOperator', value: v }])}
          />
        )}
        <DraftField
          stepId={id}
          field="conditionOperand"
          label={number ? 'Value' : 'Text to find'}
          kind="mono"
          placeholder={number ? '30' : mode === 'regex' ? '^Level \\d+' : 'Victory'}
          stored={operand}
          disabled={locked}
          parse={(t) => (wrong(t) ? null : t)}
          onText={setTyped}
        />
        <span className="insp-hint">
          {problem ? <span data-error="">{problem}</span>
            : number ? (auto ? 'The first number in the region.' : 'The first number in the region. Tokens resolve at run time.')
            : auto ? 'Ignores case, spaces and accents.' : 'Ignores case, spaces and accents. Tokens resolve at run time.'}
        </span>
      </Section>
      )}
      <Section label="Text color" hint={color ? undefined : 'Any. Pick the text color to read game HUDs over a busy scene.'}>
        <div className="insp-line">
          <HexField stepId={id} field="ocrTextColor" label="Text color" placeholder="Any" stored={step.ocrTextColor ?? ''} disabled={locked} clearable />
          <button type="button" className="insp-button" disabled={locked || pick.waiting} data-tip={tt('Pick the color of the text on the screen', 'Escolher a cor do texto na tela')} onClick={() => pick.ask(requestId => tools.pickColor({ requestId }))}>
            <span className="step-icon" data-icon="pipette" />
            {pick.waiting ? 'Picking…' : 'Pick'}
          </button>
          {color && (
            <button type="button" className="insp-icon-button" aria-label="Read every color" data-tip={tt('Read every color', 'Ler todas as cores')} disabled={locked} onClick={() => edit([{ field: 'ocrTextColor', value: '' }])}>
              <span className="step-icon" data-icon="x" />
            </button>
          )}
        </div>
      </Section>
      {color && (
        <Section label="Color tolerance" hint="Per channel, 0–255. Higher keeps more pixels.">
          <RailField stepId={id} field="ocrColorTolerance" label="Color tolerance" value={colorTolerance} min={0} max={255} step={10} disabled={locked} onApply={(v) => edit([{ field: 'ocrColorTolerance', value: v }])} />
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
            readAs: number ? 'number' : null,
            operator: op,
            operand: read ? '' : operand,
            match: !read && operand !== '',
            textColor: color,
            tolerance: colorTolerance,
          }));
        }}
      >
        <span className="step-icon" data-icon="play" />
        {test.waiting ? 'Reading…' : 'Test now'}
      </button>
      {result && !test.waiting && (
        result.error ? <ResultCard ok={false} title={result.error} /> : (
          <ResultCard
            // A read with nothing to match (no text yet, or a read for the value) is good when it read something.
            ok={result.matched == null ? !!result.text : result.matched !== (reads !== 'found')}
            title={!result.text ? 'Nothing readable'
              : <>Reads “{result.text.length > 80 ? `${result.text.slice(0, 77)}…` : result.text}”{result.number ? <> · number <span className="insp-mono">{result.number}</span></> : null}{result.matched === false ? ' — no match yet' : result.matched ? ' — a match' : ''}</>}
          >
            {reads === 'not found' && result.matched != null && (result.matched ? 'Set to pass when not found: right now it does not pass.' : 'Set to pass when not found: right now it passes.')}
            {reads === 'gone' && result.matched != null && (result.matched ? 'Still on the screen: the wait goes on.' : 'Not on the screen: the wait ends now.')}
            {(result.elapsedMs != null || result.variant) && <span>{[result.elapsedMs != null ? `${result.elapsedMs} ms` : null, result.variant].filter(Boolean).join(' · ')}</span>}
            {result.previewBase64 && <img className="insp-result-image" src={`data:image/png;base64,${result.previewBase64}`} alt="What was read" />}
            {snapped && <span>Search region set around this match.</span>}
            {!read && firstLine && !number && firstLine !== operand && (
              <button
                type="button"
                className="insp-link"
                disabled={locked}
                onClick={() => edit(mode === 'regex'
                  ? [{ field: 'conditionOperator', value: 'contains' }, { field: 'conditionOperand', value: firstLine }]
                  : [{ field: 'conditionOperand', value: firstLine }])}
              >
                Use this text
              </button>
            )}
          </ResultCard>
        )
      )}
    </>
  );
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
      <SelectorField step={step} locked={locked} hint="With the extension offline, it reads as not found." />
      <Section label="State">
        <Segmented<BrowserState>
          label="State"
          value={state}
          disabled={locked}
          wrap
          options={[
            { value: 'appears', label: 'Visible' },
            { value: 'disappears', label: 'Not present / hidden' },
            { value: 'enabled', label: 'Enabled' },
            { value: 'text-match', label: 'Text matches' },
          ]}
          onChange={(v) => edit([{ field: 'waitMode', value: v }])}
        />
      </Section>
      {state === 'text-match' && (
        <Section label="Text pattern" hint="Plain text is exact. Or text*=  text~=  text/regex/">
          <DraftField stepId={id} field="browserText" label="Text pattern" kind="mono" stored={step.browserText ?? ''} disabled={locked} parse={(t) => t} />
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
        {check.waiting ? 'Checking…' : 'Check now'}
      </button>
      {result && !check.waiting && (
        <ResultCard
          ok={result.connected && result.satisfied}
          title={result.lost ? 'No answer from the browser extension'
            : !result.connected ? 'Extension not connected'
            : result.satisfied ? 'Condition is TRUE now' : 'Condition is FALSE now'}
        >
          {result.lost ? 'Is Chrome running, with the extension?'
            : !result.connected ? 'The page could not be reached — that reads as not found.'
            : result.negate ? `Element state: ${result.raw ? 'matched' : 'not matched'} · turned around by "Not found"`
            : 'The run would take this branch right now.'}
        </ResultCard>
      )}
    </div>
  );
}
