import { useEffect, useRef, useState } from 'react';
import { Check, Pipette, PlayCircle, X } from 'lucide-react';
import { useBridge } from '../../bridge/BridgeContext';
import { useTt } from '../../state/LanguageContext';
import { SegmentedControl } from '../common/SegmentedControl';
import { NumberInput } from '../common/NumberInput';
import { FieldError } from '../common/FieldError';
import { calloutStyle } from '../common/Callout';
import { Button } from '../common/Button';
import { Field } from './Field';
import { RESULT_CARD, SearchRegionRow, TOOL_BTN } from './probeAtoms';
import { parsesAsNumber, regexProblem } from '../../utils/screenText';

// The screen-text (OCR) editor block shared by the three Sheet editors that read the screen:
// Wait for Text, the Screen Text condition (If / Else If / While) and Set Variable's Screen mode.
// One component so the three cannot drift — the same region row, read mode, matcher, text colour
// and Test read card in every one of them. State is CONTROLLED by SheetPanel (it owns persistence
// and the dirty-Esc parity); this block owns only its transient Test read / colour pick requests.

export type OcrRegion = { x: number; y: number; w: number; h: number } | null;

export interface ScreenTextFieldsProps {
  /** 'match' shows the Match/Text (or Compare/Value) rows; 'read' (Set Variable) hides them. */
  variant: 'match' | 'read';
  region: OcrRegion;
  onConfigureRegion: () => void;
  onRegionChange: (r: OcrRegion) => void;
  readAs: 'text' | 'number';
  onReadAsChange: (v: 'text' | 'number') => void;
  textOp: 'contains' | 'eq' | 'regex';
  onTextOpChange: (v: 'contains' | 'eq' | 'regex') => void;
  numberOp: 'eq' | 'neq' | 'gt' | 'lt';
  onNumberOpChange: (v: 'eq' | 'neq' | 'gt' | 'lt') => void;
  operand: string;
  onOperandChange: (v: string) => void;
  textColor: string;
  onTextColorChange: (v: string) => void;
  tolerance: string;
  onToleranceChange: (v: string) => void;
  /** Hide the matcher rows (Wait for Text in "Changes" mode compares against itself). */
  hideMatcher?: boolean;
}

interface TestReadResult {
  text?: string;
  matched?: boolean | null;
  number?: string | null;
  x?: number; y?: number; w?: number; h?: number;
  elapsedMs?: number;
  variant?: string;
  previewBase64?: string | null;
  error?: string;
}

const validHex = (s: string) => /^#?[0-9A-Fa-f]{6}$/.test(s.trim());
const withHash = (s: string) => (s.trim().startsWith('#') ? s.trim() : '#' + s.trim());

export function ScreenTextFields(p: ScreenTextFieldsProps) {
  const { send, subscribe } = useBridge();
  const tt = useTt();
  const [testId, setTestId] = useState<string | null>(null);
  const [result, setResult] = useState<TestReadResult | null>(null);
  const [pickId, setPickId] = useState<string | null>(null);
  const [snapped, setSnapped] = useState(false);
  const testRef = useRef<string | null>(null);
  const pickRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  testRef.current = testId;
  pickRef.current = pickId;
  // The latest props for the reply handler, which is subscribed once.
  const latest = useRef(p);
  latest.current = p;

  useEffect(() => subscribe((msg) => {
    if (msg.type === 'ocr:testReadResult') {
      const r = msg.payload as TestReadResult & { requestId: string };
      if (!testRef.current || r.requestId !== testRef.current) return;
      if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
      setTestId(null);
      setResult(r);
      setSnapped(false);
      // Same convenience as the image Test match: a hit with no region yet snaps the region
      // around it (80 px of margin), which is what makes the next read fast and unambiguous.
      if (r.matched && r.w && r.h && !latest.current.region) {
        const margin = 80;
        setSnapped(true);
        latest.current.onRegionChange({
          x: (r.x ?? 0) - margin, y: (r.y ?? 0) - margin, w: r.w + margin * 2, h: r.h + margin * 2,
        });
      }
    } else if (msg.type === 'pixel:colorPicked') {
      const r = msg.payload as { requestId: string; cancelled: boolean; hex?: string };
      if (!pickRef.current || r.requestId !== pickRef.current) return;
      setPickId(null);
      if (!r.cancelled && r.hex) latest.current.onTextColorChange(r.hex);
    }
  }), [subscribe]);

  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const number = p.readAs === 'number';
  const showMatcher = p.variant === 'match' && !p.hideMatcher;
  const hasToken = p.operand.includes('{');
  const operandError = showMatcher
    ? (number
      ? (p.operand.trim() === '' ? 'Enter a number to compare with' : (!hasToken && !parsesAsNumber(p.operand) ? 'Not a number' : null))
      // Contains/Equals compare normalised text, where spaces alone are nothing; a regex is raw.
      : p.textOp === 'regex'
        ? (p.operand === '' ? 'Enter the pattern to look for' : regexProblem(p.operand))
        : (p.operand.trim() === '' ? 'Enter the text to look for' : null))
    : null;

  const runTest = () => {
    const requestId = Math.random().toString(36).slice(2, 10);
    setTestId(requestId);
    setResult(null);
    send({
      type: 'ocr:testRead',
      payload: {
        requestId,
        searchRegion: p.region ?? undefined,
        readAs: number ? 'number' : null,
        operator: number ? p.numberOp : p.textOp,
        operand: p.operand,
        match: showMatcher && p.operand !== '',
        textColor: validHex(p.textColor) ? withHash(p.textColor) : null,
        // 0 is a real tolerance (exact colour only) and the save keeps it; || 70 tested it as 70.
        tolerance: (() => { const t = Number.parseInt(p.tolerance, 10); return Number.isFinite(t) ? Math.min(255, Math.max(0, t)) : 70; })(),
      },
    });
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      if (testRef.current !== requestId) return;
      setTestId(null);
      setResult({ error: 'No response from backend.' });
    }, 8000);
  };

  const pickColor = () => {
    const requestId = Math.random().toString(36).slice(2, 10);
    setPickId(requestId);
    send({ type: 'pixel:pickColor', payload: { requestId } });
  };

  const firstLine = (result?.text ?? '').split('\n')[0]?.trim() ?? '';
  const ok = !result?.error && (result?.matched == null ? !!result?.text : !!result.matched);

  return (
    <>
      <Field
        label="Search Region"
        hint={p.region ? undefined : 'Whole screen: ~0.5 s per read. Set a region.'}
      >
        <SearchRegionRow
          region={p.region}
          onConfigure={p.onConfigureRegion}
          onClear={() => p.onRegionChange(null)}
          configureTip={tt('Faster, and reads only what you mean.', 'Mais rápido, e lê só o que você quer.')}
          clearLabel="Read the whole screen"
          clearTip={tt('Read the whole screen', 'Ler a tela inteira')}
        />
      </Field>

      <Field label="Read As">
        <SegmentedControl<'text' | 'number'>
          ariaLabel="Read as"
          grow
          value={p.readAs}
          onChange={p.onReadAsChange}
          options={[
            { value: 'text', label: 'Text' },
            { value: 'number', label: 'Number', tip: tt('The first number in the region', 'O primeiro número da região') },
          ]}
        />
      </Field>

      {showMatcher && (number ? (
        <>
          <Field label="Compare">
            <SegmentedControl<'eq' | 'neq' | 'gt' | 'lt'>
              ariaLabel="Compare"
              grow
              value={p.numberOp}
              onChange={p.onNumberOpChange}
              options={[
                { value: 'eq', label: '=' },
                { value: 'neq', label: '≠' },
                { value: 'gt', label: '>' },
                { value: 'lt', label: '<' },
              ]}
            />
          </Field>
          <Field label="Value" hint="First number in the region. Tokens resolve at run time.">
            <input
              type="text"
              value={p.operand}
              onChange={(e) => p.onOperandChange(e.target.value)}
              placeholder="30"
              className="input-field w-full"
            />
            <FieldError show={!!operandError} className="text-caption text-recording-fg mt-1">{operandError}</FieldError>
          </Field>
        </>
      ) : (
        <>
          <Field label="Match">
            <SegmentedControl<'contains' | 'eq' | 'regex'>
              ariaLabel="Match"
              grow
              value={p.textOp}
              onChange={p.onTextOpChange}
              options={[
                { value: 'contains', label: 'Contains' },
                { value: 'eq', label: 'Equals', tip: tt('The whole region reads exactly this', 'A região inteira diz exatamente isto') },
                { value: 'regex', label: 'Regex' },
              ]}
            />
          </Field>
          <Field label="Text" hint="Ignores case, spaces and accents. Tokens resolve at run time.">
            <input
              type="text"
              value={p.operand}
              onChange={(e) => p.onOperandChange(e.target.value)}
              placeholder={p.textOp === 'regex' ? '^Level \\d+' : 'Victory'}
              className="input-field w-full"
            />
            <FieldError show={!!operandError} className="text-caption text-recording-fg mt-1">{operandError}</FieldError>
          </Field>
        </>
      ))}

      <Field label="Text Color" hint={p.textColor ? undefined : 'Any. Pick the text color to read game HUDs over a busy scene.'}>
        <div className="flex items-center gap-2.5">
          <span
            className={`w-8 h-8 rounded border shrink-0 ${validHex(p.textColor) ? 'border-border-default' : 'border-dashed border-border-default'}`}
            style={{ background: validHex(p.textColor) ? withHash(p.textColor) : 'transparent' }}
          />
          <input
            type="text"
            value={p.textColor}
            onChange={(e) => p.onTextColorChange(e.target.value)}
            placeholder="Any"
            className="input-field flex-1 min-w-0"
          />
          <button onClick={pickColor} disabled={pickId != null} className={TOOL_BTN}>
            <Pipette size={12} />
            Pick
          </button>
          {p.textColor && (
            <button
              aria-label="Read every color"
              onClick={() => p.onTextColorChange('')}
              className="h-8 px-2 flex items-center rounded text-minor text-text-tertiary hover:text-[var(--color-recording-fg)] hover:bg-bg-card transition-colors"
              data-tip={tt('Read every color', 'Ler todas as cores')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </Field>

      {validHex(p.textColor) && (
        <Field label="Color Tolerance" hint="Per channel, 0–255. Higher = more pixels kept.">
          <NumberInput
            value={Number.parseInt(p.tolerance, 10) || 0}
            onChange={(n) => p.onToleranceChange(String(n))}
            min={0}
            max={255}
            step={10}
            integer
            inputWidth="w-full"
            inputHeight="h-8"
            className="w-[124px]"
            ariaLabel="Color tolerance"
          />
        </Field>
      )}

      <div>
        <Button
          variant="test"
          size="field"
          onClick={runTest}
          data-probe
          disabled={testId != null}
          className="w-full"
        >
          <PlayCircle size={13} />
          {testId != null ? 'Reading…' : 'Test read'}
        </Button>
        {result && !testId && (
          <div className={`mt-2 ${RESULT_CARD}`} style={calloutStyle(ok ? 'ok' : 'error')}>
            {result.error ? (
              <div className="flex items-center gap-1.5 font-medium">
                <X size={11} className="shrink-0" />
                <span>{result.error}</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5 font-medium">
                  {ok ? <Check size={11} className="shrink-0" /> : <X size={11} className="shrink-0" />}
                  <span>
                    {result.matched == null
                      ? (result.text ? 'Read' : 'Nothing readable')
                      : (result.matched ? 'Match' : 'No match')}
                    <span className="opacity-80"> · {result.elapsedMs ?? 0} ms · {result.variant}</span>
                  </span>
                </div>
                <div className="mt-1 font-mono break-words whitespace-pre-wrap">
                  {result.text ? `Read: “${result.text}”` : 'Read: nothing'}
                  {number && <>{'\n'}Number: {result.number ? result.number : 'none'}</>}
                </div>
                {result.previewBase64 && (
                  <img
                    src={`data:image/png;base64,${result.previewBase64}`}
                    alt="What the OCR read"
                    className="mt-1.5 max-h-[140px] max-w-full object-contain rounded-sm border border-border-subtle"
                  />
                )}
                {showMatcher && !number && firstLine && firstLine !== p.operand && (
                  <button
                    onClick={() => { p.onTextOpChange(p.textOp === 'regex' ? 'contains' : p.textOp); p.onOperandChange(firstLine); }}
                    className="mt-1.5 text-caption underline underline-offset-2 opacity-90 hover:opacity-100"
                  >
                    Use this text
                  </button>
                )}
                {result.matched && snapped && (
                  <div className="mt-1 text-caption opacity-80">Search region set around this match.</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
