import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ActionItem, SelectorAlternative } from '../../bridge/messageTypes';
import { useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
import { effectiveOperator, isNumberMode, parsesAsNumber, regexProblem } from '../../utils/screenText';
import { DraftField, Section, Segmented } from './fields';
import { applyEdits, type StepEdit } from './inspectorState';
import { HexField, RailField, RegionField, ResultCard } from './probeKit';
import { around, normalHex, regionOf, regionValue, useAsk } from './probes';

type Props = { step: ActionItem; locked: boolean };
const useEdit = (step: ActionItem) => {
  const cmds = useSteps();
  return (edits: StepEdit[]) => applyEdits(cmds, step.id ?? '', edits);
};

/**
 * Pixel color: one point of the screen and the colour it must have, within a tolerance per channel.
 * Pick fills the point and its colour from one click; Test match reads the pixel now.
 */
export function PixelCheck({ step, locked }: Props) {
  const edit = useEdit(step);
  const tools = useEditorTools();
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
  const negate = !!step.conditionNegate;

  return (
    <>
      <Section label="Point">
        <div className="insp-line">
          <DraftField stepId={id} field="pixelX" label="Pixel X" kind="int" signed min={-2_000_000} max={2_000_000} empty="clear" prefix="X" placeholder="—" stored={step.pixelX == null ? '' : String(step.pixelX)} disabled={locked} />
          <DraftField stepId={id} field="pixelY" label="Pixel Y" kind="int" signed min={-2_000_000} max={2_000_000} empty="clear" prefix="Y" placeholder="—" stored={step.pixelY == null ? '' : String(step.pixelY)} disabled={locked} />
          <button type="button" className="insp-button" disabled={locked || pick.waiting} data-tip="Click a point of the screen: its place and its color" onClick={() => pick.ask(requestId => tools.pickColor({ requestId }))}>
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
          test.ask(requestId => tools.testPixel({ requestId, x: step.pixelX ?? 0, y: step.pixelY ?? 0, hex: target, tolerance }));
        }}
      >
        <span className="step-icon" data-icon="play" />
        {test.waiting ? 'Testing…' : 'Test match'}
      </button>
      {result && !test.waiting && (
        result.error ? <ResultCard ok={false} title={result.error} /> : (
          <ResultCard
            ok={result.matches !== negate}
            title={<>Sampled <span className="insp-mono">{result.sampledHex ?? '—'}</span> · Target <span className="insp-mono">{target} ± {tolerance}</span>{result.matches ? '' : ' — out of tolerance'}</>}
          >
            {negate && (result.matches ? 'Set to pass when not found: right now it does not pass.' : 'Set to pass when not found: right now it passes.')}
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
 * text colour to read alone (game HUDs), and Test now, whose answer can become the text.
 */
export function ScreenTextCheck({ step, locked }: Props) {
  const edit = useEdit(step);
  const tools = useEditorTools();
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

  const problem = number
    ? (operand.trim() === '' ? 'Enter a number to compare with' : !operand.includes('{') && !parsesAsNumber(operand) ? 'Not a number' : null)
    : mode === 'regex'
      ? (operand === '' ? 'Enter the pattern to look for' : regexProblem(operand))
      : (operand.trim() === '' ? 'Enter the text to look for' : null);

  const setMode = (v: ReadMode) => {
    if (v === 'number') edit([{ field: 'ocrReadAs', value: 'number' }, { field: 'conditionOperator', value: 'eq' }]);
    else edit([{ field: 'ocrReadAs', value: '' }, { field: 'conditionOperator', value: v }]);
  };
  const firstLine = (result?.text ?? '').split('\n').map(l => l.trim()).find(Boolean) ?? '';

  return (
    <>
      <RegionField
        label="Region to read"
        region={region}
        locked={locked}
        wholeHint="The whole screen takes ~0.5 s per read. Draw a region."
        drawTip="Faster, and reads only what you mean"
        onRegion={(r) => edit([{ field: 'waitImageSearchRegion', value: regionValue(r) }])}
      />
      <Section label="Text">
        <Segmented<ReadMode>
          label="Read as"
          value={mode}
          disabled={locked}
          options={[
            { value: 'contains', label: 'Contains' },
            { value: 'eq', label: 'Equals', tip: 'The whole region reads exactly this' },
            { value: 'regex', label: 'Regex' },
            { value: 'number', label: 'Number', tip: 'The first number in the region' },
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
          parse={(t) => t}
        />
        <span className="insp-hint">
          {problem ? <span data-error="">{problem}</span>
            : number ? 'The first number in the region. Tokens resolve at run time.'
            : 'Ignores case, spaces and accents. Tokens resolve at run time.'}
        </span>
      </Section>
      <Section label="Text color" hint={color ? undefined : 'Any. Pick the text color to read game HUDs over a busy scene.'}>
        <div className="insp-line">
          <HexField stepId={id} field="ocrTextColor" label="Text color" placeholder="Any" stored={step.ocrTextColor ?? ''} disabled={locked} clearable />
          <button type="button" className="insp-button" disabled={locked || pick.waiting} data-tip="Pick the color of the text on the screen" onClick={() => pick.ask(requestId => tools.pickColor({ requestId }))}>
            <span className="step-icon" data-icon="pipette" />
            {pick.waiting ? 'Picking…' : 'Pick'}
          </button>
          {color && (
            <button type="button" className="insp-icon-button" aria-label="Read every color" data-tip="Read every color" disabled={locked} onClick={() => edit([{ field: 'ocrTextColor', value: '' }])}>
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
            searchRegion: region ?? undefined,
            readAs: number ? 'number' : null,
            operator: op,
            operand,
            match: operand !== '',
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
            ok={result.matched === true}
            title={!result.text ? 'Nothing readable'
              : <>Reads “{result.text.length > 80 ? `${result.text.slice(0, 77)}…` : result.text}”{result.number ? <> · number <span className="insp-mono">{result.number}</span></> : null}{result.matched === false ? ' — no match yet' : result.matched ? ' — a match' : ''}</>}
          >
            {(result.elapsedMs != null || result.variant) && <span>{[result.elapsedMs != null ? `${result.elapsedMs} ms` : null, result.variant].filter(Boolean).join(' · ')}</span>}
            {result.previewBase64 && <img className="insp-result-image" src={`data:image/png;base64,${result.previewBase64}`} alt="What was read" />}
            {snapped && <span>Search region set around this match.</span>}
            {firstLine && !number && firstLine !== operand && (
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

// The selector's stability, from its text alone (no page): an id or a test hook is stable, a name or
// a label strong, a text match or a tag with a class decent, a path through the tree fragile.
function estimateTier(selector: string): SelectorAlternative['tier'] {
  const s = selector.trim();
  if (!s) return 'C';
  if (s.startsWith('text=') || s.startsWith('text*=') || s.startsWith('text~=') || s.startsWith('text/')) return 'B';
  if (/^#[A-Za-z_][\w-]*$/.test(s)) return 'S';
  if (/\[data-(testid|test|cy|qa)=/.test(s)) return 'S';
  if (/\[(name|aria-label|placeholder)=/.test(s)) return 'A';
  if (s.includes(':nth-') || s.includes(' > ')) return 'C';
  if (/^[a-z]+\./i.test(s)) return 'B';
  return 'C';
}
const TIER_NAMES: Record<SelectorAlternative['tier'], string> = { S: 'Stable', A: 'Strong', B: 'Decent', C: 'Fragile' };

type BrowserState = 'appears' | 'disappears' | 'enabled' | 'text-match';

/**
 * Browser element: an element of the active tab, by its CSS selector, in a state — visible, gone,
 * enabled, or with a text. Pick element takes it from the page through the extension (Esc cancels);
 * with two or more candidates the alternatives show, and stay saved as the run's fallbacks. Typing
 * the selector drops them. Check now asks the page the same instant question the run asks.
 */
export function BrowserCheck({ step, locked }: Props) {
  const edit = useEdit(step);
  const tools = useEditorTools();
  const id = step.id ?? '';
  const selector = step.key ?? '';
  const tier = estimateTier(selector);
  const alternatives = step.selectorAlternatives ?? [];
  const state: BrowserState = step.waitMode === 'disappears' || step.waitMode === 'enabled' || step.waitMode === 'text-match' ? step.waitMode : 'appears';
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const pick = useAsk('browser:pickResult', (r) => {
    if (!r.selector) { setPickError(r.error || null); return; }
    setPickError(null);
    const alts = r.alternatives ?? [];
    edit([{ field: 'key', value: r.selector }, { field: 'selectorAlternatives', value: alts.length > 1 ? JSON.stringify(alts) : '' }]);
    setShowAlternatives(alts.length > 1);
  });
  const [result, setResult] = useState<{ satisfied: boolean; raw: boolean; connected: boolean; negate: boolean; lost?: boolean } | null>(null);
  const asked = useRef(false);
  const check = useAsk('browser:testConditionResult',
    (r) => setResult({ satisfied: r.satisfied, raw: r.raw, connected: r.connected, negate: asked.current }),
    6000,
    () => setResult({ satisfied: false, raw: false, connected: false, negate: asked.current, lost: true }));
  // Leaving the step cancels a pick still waiting on the page (editor-passo-005).
  const live = useRef(pick.waiting);
  useEffect(() => { live.current = pick.waiting; });
  useEffect(() => () => cancelPick(tools, live), [tools]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !pick.waiting || e.defaultPrevented) return;
    e.preventDefault();
    tools.cancelPick({});
    pick.drop();
  };

  return (
    <div className="insp-group" onKeyDown={onKeyDown}>
      <Section
        label="CSS selector"
        aside={selector ? <span className="insp-tier" data-tier={tier} data-tip={`${tier} · ${TIER_NAMES[tier]}`}>{tier} · {TIER_NAMES[tier]}</span> : undefined}
        hint={pickError ? <span data-error="">{pickError}</span> : 'With the extension offline, it reads as not found.'}
      >
        <div className="insp-line">
          <DraftField
            stepId={id}
            field="key"
            label="CSS selector"
            kind="mono"
            placeholder=".btn-save"
            stored={selector}
            disabled={locked}
            parse={(t) => t.trim()}
            onApply={(v) => { setShowAlternatives(false); edit([{ field: 'key', value: v }, { field: 'selectorAlternatives', value: '' }]); }}
          />
          <button
            type="button"
            className="insp-icon-button"
            aria-label="Pick element"
            aria-pressed={pick.waiting}
            data-tip={pick.waiting ? 'Picking on the page · Esc cancels' : 'Pick an element on the page'}
            disabled={locked}
            onClick={() => {
              if (pick.waiting) { tools.cancelPick({}); pick.drop(); return; }
              setShowAlternatives(false);
              setPickError(null);
              pick.ask(requestId => tools.pickElement({ requestId }));
            }}
          >
            <span className="step-icon" data-icon="crosshair" />
          </button>
        </div>
        {showAlternatives && alternatives.length > 1 && (
          <div className="insp-alts" role="group" aria-label="Alternatives">
            <span className="insp-alts-head">
              Alternatives
              <button type="button" className="insp-icon-button" aria-label="Close alternatives" onClick={() => setShowAlternatives(false)}>
                <span className="step-icon" data-icon="x" />
              </button>
            </span>
            {alternatives.map((alt, i) => (
              <button
                key={i}
                type="button"
                data-tip={alt.description}
                disabled={locked}
                onClick={() => { edit([{ field: 'key', value: alt.selector }]); setShowAlternatives(false); }}
              >
                <span className="insp-tier" data-tier={alt.tier}>{alt.tier}</span>
                <span className="insp-mono">{alt.selector}</span>
              </button>
            ))}
          </div>
        )}
      </Section>
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

function cancelPick(tools: ReturnType<typeof useEditorTools>, live: { current: boolean }) {
  if (live.current) tools.cancelPick({});
}
