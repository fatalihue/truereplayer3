import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBridge } from '../../bridge/BridgeContext';
import type { ActionItem, BrowserTestResult, SelectorAlternative } from '../../bridge/messageTypes';
import { newRequestId, useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
import { typeBudgetMs } from '../../utils/typeBudget';
import { useShell } from '../store';
import { DraftField, Section, Segmented, Switch } from './fields';
import { applyEdits, lastEdit, takeFieldAsk, type StepEdit } from './inspectorState';
import { ExtensionMissing } from './missing';
import { ResultCard } from './probeKit';
import { SelectorField, Tier } from './selectorField';
import './browserEditors.css';

// The editors of the browser steps — Open URL, and the six that act on an element of the page — in a
// chunk of their own (rule 6). Type Text's text editor (Lexical) is one more, loaded with a Type Text.
const TypeTextField = lazy(() => import('./browserText'));

// What the engine waits with no timeout of its own, and the floor of the field (editor-passo-158).
const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 86_400_000;

// The steps that find their element by its text as well (Text Match): not Type Text nor Select Option.
const WITH_TEXT = new Set(['BrowserClick', 'BrowserRightClick', 'BrowserWaitElement', 'BrowserAssert']);

const useEdit = (step: ActionItem) => {
  const cmds = useSteps();
  return (edits: StepEdit[]) => applyEdits(cmds, step.id ?? '', edits);
};

type TextMode = 'exact' | 'contains' | 'icontains' | 'regex';
const TEXT_PREFIX: Record<Exclude<TextMode, 'regex'>, string> = { exact: 'text=', contains: 'text*=', icontains: 'text~=' };
const TEXT_MODES: { value: TextMode; label: string }[] = [
  { value: 'exact', label: 'Exact' },
  { value: 'contains', label: 'Contains' },
  { value: 'icontains', label: 'Contains (i)' },
  { value: 'regex', label: 'Regex' },
];

/**
 * A step's element found by its text, as its key keeps it (text=, text*=, text~= or text/…/flags),
 * or null for a CSS selector. A regex keeps its flags through the round trip.
 */
export function textOf(key: string): { mode: TextMode; raw: string; flags: string } | null {
  if (key.startsWith('text/')) {
    const last = key.lastIndexOf('/');
    if (last > 4) return { mode: 'regex', raw: key.slice(5, last), flags: key.slice(last + 1) };
  }
  if (key.startsWith('text*=')) return { mode: 'contains', raw: key.slice(6), flags: '' };
  if (key.startsWith('text~=')) return { mode: 'icontains', raw: key.slice(6), flags: '' };
  if (key.startsWith('text=')) return { mode: 'exact', raw: key.slice(5), flags: '' };
  return null;
}
const textKey = (mode: TextMode, raw: string, flags: string) => (mode === 'regex' ? `text/${raw}/${flags}` : TEXT_PREFIX[mode] + raw);
const regexError = (pattern: string): string | null => {
  try { new RegExp(pattern); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
};

/**
 * ⑧ The browser steps (editor-passo-126 to 159): Open URL, with the address, the tab and what to
 * wait for after it; or the element — its CSS selector, with the shield, Pick element and the
 * alternatives, or its text (Text Match) — and what each step does with it: the text to type, the
 * option to choose, or the condition to wait for or to require, with what a failed requirement
 * does. Then Test action, which does the step for real on the tab, and the Timeout. The Delay is
 * in the strip under the header, as every step's (D29).
 */
export function BrowserEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const t = step.actionType;
  return (
    <>
      <ExtensionMissing />
      {t === 'BrowserNavigate' ? <OpenUrlFields step={step} locked={locked} /> : <ElementFields step={step} locked={locked} withText={WITH_TEXT.has(t)} />}
      {t === 'BrowserType' && <TypeFields step={step} locked={locked} />}
      {t === 'BrowserSelectOption' && <SelectFields step={step} locked={locked} />}
      {(t === 'BrowserWaitElement' || t === 'BrowserAssert') && <ConditionFields step={step} locked={locked} />}
      <TestAction step={step} locked={locked} />
      <Timing step={step} locked={locked} />
    </>
  );
}

/** Open URL (editor-passo-127, 137 to 139; dialogos-075 and 076). */
function OpenUrlFields({ step, locked }: { step: ActionItem; locked: boolean }) {
  const edit = useEdit(step);
  const id = step.id ?? '';
  const url = step.key ?? '';
  // Just added, it asks for its address first, as today's dialog did (dialogos-075).
  useLayoutEffect(() => {
    if (takeFieldAsk(id, 'key')) document.querySelector<HTMLInputElement>('.insp-body input[aria-label="URL"]')?.focus();
  }, [id]);
  return (
    <>
      <Section label="URL" hint={url.trim() ? 'https:// is added if omitted.' : <span data-error="">Enter the address to open.</span>}>
        <DraftField stepId={id} field="key" label="URL" kind="mono" placeholder="https://example.com" stored={url} disabled={locked} parse={(t) => t.trim()} />
      </Section>
      <div className="insp-row">
        <span className="insp-row-label">Open in new tab</span>
        <Switch label="Open in new tab" checked={!!step.newTab} disabled={locked} onChange={(on) => edit([{ field: 'newTab', value: String(on) }])} />
      </div>
      <span className="insp-sublabel">After navigation</span>
      <Section label="URL pattern" hint="Glob (*) or /regex/.">
        <DraftField stepId={id} field="urlWaitPattern" label="URL pattern" kind="mono" placeholder="*/dashboard*" stored={step.urlWaitPattern ?? ''} disabled={locked} parse={(t) => t.trim()} />
      </Section>
      <Section label="Ready element">
        <DraftField stepId={id} field="postNavigateSelector" label="Ready element" kind="mono" placeholder="#app-ready" stored={step.postNavigateSelector ?? ''} disabled={locked} parse={(t) => t.trim()} />
      </Section>
    </>
  );
}

/**
 * The element: by its CSS selector, or by its text where the step takes one (the key keeps one or
 * the other — the last one set wins, and the other field shows empty).
 */
function ElementFields({ step, locked, withText }: { step: ActionItem; locked: boolean; withText: boolean }) {
  const key = step.key ?? '';
  const found = withText ? textOf(key) : null;
  return (
    <div className="insp-group">
      <SelectorField step={step} locked={locked} stored={found ? '' : key} hint={found ? 'The Text Match below finds it.' : undefined} />
      {withText && <TextMatch step={step} locked={locked} found={found} />}
    </div>
  );
}

/**
 * Text Match (editor-passo-132 to 136): the element by its text — exact, contained, contained in
 * any case, or a regex, which keeps the flags it was saved with (a new one gets i). Filled, it is
 * the selector; a pattern that does not compile is not sent.
 */
function TextMatch({ step, locked, found }: { step: ActionItem; locked: boolean; found: ReturnType<typeof textOf> }) {
  const edit = useEdit(step);
  const tt = useTt();
  const id = step.id ?? '';
  const key = step.key ?? '';
  const [mode, setMode] = useState<TextMode>(found?.mode ?? 'exact');
  // The step's own mode wins when its key moves some other way (a pick, Ctrl+Z).
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    if (found && found.mode !== mode) setMode(found.mode);
  }
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? found?.raw ?? '';
  const bad = mode === 'regex' && shown !== '' ? regexError(shown) : null;
  const send = (m: TextMode, raw: string) => {
    const flags = m !== 'regex' ? '' : found?.mode === 'regex' ? found.flags : 'i';
    edit([{ field: 'key', value: raw ? textKey(m, raw, flags) : '' }, { field: 'selectorAlternatives', value: '' }]);
  };
  return (
    <Section
      label="Text Match"
      aside={found ? <Tier selector={key} /> : undefined}
      hint={bad ? <span data-error="">Invalid regex: {bad}</span> : 'Filled, it finds the element by its text instead of the CSS selector.'}
    >
      <Segmented<TextMode>
        label="Text match mode"
        value={mode}
        disabled={locked}
        options={TEXT_MODES.map(m => (m.value === 'icontains' ? { ...m, tip: tt('Contains, in any case', 'Contém, sem ligar para maiúsculas') } : m))}
        onChange={(m) => {
          setMode(m);
          const raw = found?.raw ?? '';
          if (raw && !(m === 'regex' && regexError(raw))) send(m, raw);
        }}
      />
      <DraftField
        stepId={id}
        field="textMatch"
        label="Text match"
        kind="mono"
        placeholder={mode === 'regex' ? 'e.g. ^Sign in$' : 'e.g. Sign in'}
        stored={found?.raw ?? ''}
        disabled={locked}
        parse={(t) => (mode === 'regex' && t.trim() && regexError(t.trim()) ? null : t.trim())}
        onText={setTyped}
        onApply={(raw) => send(mode, raw)}
      />
    </Section>
  );
}

/** Type Text (editor-passo-140 to 144): the text, with tokens, and how it is typed. */
function TypeFields({ step, locked }: { step: ActionItem; locked: boolean }) {
  const edit = useEdit(step);
  const tt = useTt();
  const id = step.id ?? '';
  const paste = !!step.typePaste;
  return (
    <>
      <Section label="Text to type" hint="The extension presses the key tokens like Send Text does: {enter}, {tab:2}, {space}, {home}, {delay:500}…">
        {/* Keyed by the step: another step's text starts its own editor. */}
        <Suspense fallback={<div className="insp-text-wait" />}>
          <TypeTextField key={id} step={step} locked={locked} />
        </Suspense>
      </Section>
      <span className="insp-sublabel">Typing</span>
      <div className="insp-row">
        <span className="insp-row-label">Keep existing text</span>
        <Switch label="Keep existing text" checked={!!step.typeAppend} disabled={locked} onChange={(on) => edit([{ field: 'typeAppend', value: String(on) }])} />
      </div>
      <div className="insp-row">
        <span className="insp-row-label">Paste</span>
        <Switch label="Paste" tip={tt('Instant, not key by key', 'Instantâneo, não tecla a tecla')} checked={paste} disabled={locked} onChange={(on) => edit([{ field: 'typePaste', value: String(on) }])} />
      </div>
      <Section label="Char delay" hint={paste ? 'Paste types nothing key by key.' : 'Empty = no pause between characters.'}>
        <DraftField
          stepId={id}
          field="typeDelay"
          label="Char delay (ms)"
          kind="int"
          min={0}
          max={60000}
          unit="ms"
          empty="clear"
          placeholder="none"
          stored={step.typeDelay == null ? '' : String(step.typeDelay)}
          disabled={locked || paste}
        />
      </Section>
    </>
  );
}

type MatchBy = 'text' | 'value' | 'index';

/** Select Option (editor-passo-145 to 148): how the option is matched, then what to match. */
function SelectFields({ step, locked }: { step: ActionItem; locked: boolean }) {
  const edit = useEdit(step);
  const tt = useTt();
  const id = step.id ?? '';
  const by: MatchBy = step.selectMatchMode === 'value' || step.selectMatchMode === 'index' ? step.selectMatchMode : 'text';
  return (
    <>
      <Section label="Match by" hint="Native <select> only.">
        <Segmented<MatchBy>
          label="Option match mode"
          value={by}
          disabled={locked}
          options={[
            { value: 'text', label: 'Text', tip: tt('The visible label', 'O rótulo visível') },
            { value: 'value', label: 'Value', tip: tt('The value attribute', 'O atributo value') },
            { value: 'index', label: 'Index', tip: tt('0-based position', 'Posição (base 0)') },
          ]}
          onChange={(v) => edit([{ field: 'selectMatchMode', value: v === 'text' ? '' : v }])}
        />
      </Section>
      <Section label="Option">
        <DraftField
          stepId={id}
          field="browserText"
          label="Option"
          kind={by === 'text' ? 'text' : 'mono'}
          placeholder={by === 'index' ? '0' : by === 'value' ? 'option-value' : 'Option label'}
          stored={step.browserText ?? ''}
          disabled={locked}
          filter={by === 'index' ? (t) => t.replace(/\D/g, '') : undefined}
          parse={(t) => t.trim()}
        />
      </Section>
    </>
  );
}

type Condition = 'appears' | 'disappears' | 'enabled' | 'text-match';

/**
 * Wait Element and Assert Element (editor-passo-149 to 155): the condition — the same four, worded
 * as a wait or as a requirement — and, for an Assert, what a failure does. "Text matches" needs the
 * Text Match: without it the step waits for nothing that can come.
 */
function ConditionFields({ step, locked }: { step: ActionItem; locked: boolean }) {
  const edit = useEdit(step);
  const tt = useTt();
  const assert = step.actionType === 'BrowserAssert';
  const cond: Condition = step.waitMode === 'disappears' || step.waitMode === 'enabled' || step.waitMode === 'text-match' ? step.waitMode : 'appears';
  const noText = cond === 'text-match' && !textOf(step.key ?? '');
  const fail = step.assertOnFail === 'Continue' ? 'continue' : step.assertOnFail === 'StopReplay' ? 'quiet' : 'halt';
  return (
    <>
      <Section
        label="Condition"
        hint={noText ? <span data-error="">{assert ? 'Text pattern is empty — this Assert will fail.' : 'Text pattern is empty — this Wait will time out.'}</span> : undefined}
      >
        <Segmented<Condition>
          label={assert ? 'Assert condition' : 'Wait condition'}
          value={cond}
          disabled={locked}
          wrap
          options={assert ? [
            { value: 'appears', label: 'Is present' },
            { value: 'disappears', label: 'Is NOT present' },
            { value: 'enabled', label: 'Is enabled' },
            { value: 'text-match', label: 'Text matches' },
          ] : [
            { value: 'appears', label: 'Appears' },
            { value: 'disappears', label: 'Disappears' },
            { value: 'enabled', label: 'Enabled' },
            { value: 'text-match', label: 'Text matches' },
          ]}
          onChange={(v) => edit([{ field: 'waitMode', value: v === 'appears' ? '' : v }])}
        />
      </Section>
      {assert && (
        <Section label="On fail">
          <Segmented<'halt' | 'continue' | 'quiet'>
            label="On assertion fail"
            value={fail}
            disabled={locked}
            options={[
              { value: 'halt', label: 'Halt', tip: tt('The run stops with an error', 'A execução para com erro') },
              { value: 'continue', label: 'Continue', tip: tt('Logged, and the run goes on', 'Registrado, e a execução segue') },
              { value: 'quiet', label: 'Stop quietly', tip: tt('The run ends here, with no error', 'A execução termina aqui, sem erro') },
            ]}
            onChange={(v) => edit([{ field: 'assertOnFail', value: v === 'continue' ? 'Continue' : v === 'quiet' ? 'StopReplay' : '' }])}
          />
        </Section>
      )}
    </>
  );
}

const NO_RESPONSE = (requestId: string): BrowserTestResult => ({
  requestId,
  success: false,
  error: { code: 'NO_RESPONSE', message: 'No response from the browser extension.', tip: 'Check that Chrome and the TrueReplayer extension are still running.' },
});
const tierOf = (t: string): SelectorAlternative['tier'] => (t === 'S' || t === 'A' || t === 'B' ? t : 'C');

/**
 * Test action (editor-passo-156 and 157): the step done for real on the browser's tab — the click,
 * the typing, the page opened —, with its fallbacks, as the run would; "Success in N ms", or the
 * extension's code, message and tip. A pass that only a fallback saved says so, and that selector
 * becomes the primary in one click. Not while a run is on: it would be a second hand on the tab.
 *
 * It reads the step as the engine has it: a field left by the press on this button has just sent
 * its edit, so the test waits for the echo first. The answer may take the whole timeout, plus the
 * typing the engine budgets for (browser:testAccepted).
 */
function TestAction({ step, locked }: { step: ActionItem; locked: boolean }) {
  const tools = useEditorTools();
  const edit = useEdit(step);
  const { subscribe } = useBridge();
  const id = step.id ?? '';
  const [waiting, setWaiting] = useState(false);
  const [result, setResult] = useState<BrowserTestResult | null>(null);
  const live = useRef<string | null>(null);
  const net = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kit = useRef({
    // The safety net: no answer within the time the test may take is no answer.
    arm(requestId: string, ms: number) {
      if (net.current) clearTimeout(net.current);
      net.current = setTimeout(() => {
        net.current = null;
        if (live.current !== requestId) return;
        live.current = null;
        setWaiting(false);
        setResult(NO_RESPONSE(requestId));
      }, ms);
    },
  });
  useEffect(() => subscribe((message) => {
    if (message.type === 'browser:testAccepted' && message.payload.requestId === live.current) {
      kit.current.arm(message.payload.requestId, message.payload.timeoutMs + 5000 + message.payload.budgetMs);
    } else if (message.type === 'browser:testResult' && message.payload.requestId === live.current) {
      live.current = null;
      if (net.current) { clearTimeout(net.current); net.current = null; }
      setWaiting(false);
      setResult(message.payload);
    }
  }), [subscribe]);
  useEffect(() => () => dropNet(net), []);

  const send = () => {
    const s = useShell.getState().app.actions.find(a => a.id === id);
    if (!s) { setWaiting(false); return; }
    const requestId = newRequestId();
    live.current = requestId;
    const timeoutMs = Math.max(MIN_TIMEOUT_MS, s.timeout > 0 ? s.timeout : DEFAULT_TIMEOUT_MS);
    const charDelay = !s.typePaste && (s.typeDelay ?? 0) > 0 ? s.typeDelay ?? 0 : 0;
    kit.current.arm(requestId, timeoutMs + 5000 + (s.actionType === 'BrowserType' ? typeBudgetMs(s.browserText, charDelay) : 0));
    const alternatives = s.selectorAlternatives ?? [];
    tools.testBrowserAction({
      requestId,
      actionType: s.actionType,
      key: s.key ?? '',
      browserText: s.browserText ?? '',
      newTab: !!s.newTab,
      timeout: Math.round(timeoutMs),
      waitMode: s.waitMode && s.waitMode !== 'appears' ? s.waitMode : null,
      urlWaitPattern: s.urlWaitPattern || null,
      postNavigateSelector: s.postNavigateSelector || null,
      typeAppend: !!s.typeAppend,
      typePaste: !!s.typePaste,
      typeDelay: s.typeDelay ?? null,
      selectMatchMode: s.actionType === 'BrowserSelectOption' ? s.selectMatchMode ?? 'text' : null,
      alternatives: alternatives.length > 0 ? alternatives : null,
    });
  };
  const run = () => {
    setWaiting(true);
    setResult(null);
    if (performance.now() - lastEdit.at > 300) { send(); return; }
    // An edit just went: its echo first (or, if the engine kept the value, a moment).
    const before = useShell.getState().app.actions;
    const t0 = performance.now();
    const wait = () => {
      if (useShell.getState().app.actions !== before || performance.now() - t0 > 500) send();
      else requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
  };

  const via = result?.success ? result.matchedVia : null;
  return (
    <>
      <button type="button" className="insp-button" disabled={locked || waiting} onClick={run}>
        <span className="step-icon" data-icon="play" />
        {waiting ? 'Running…' : 'Test action'}
      </button>
      {result && !waiting && (
        <ResultCard ok={result.success} title={result.success ? `Success in ${result.durationMs ?? 0} ms` : result.error?.code || 'Failed'}>
          {!result.success && result.error?.message && <span>{result.error.message}</span>}
          {!result.success && result.error?.tip && <span className="insp-test-tip">{result.error.tip}</span>}
          {via && <span><Tier selector={via.selector} tier={tierOf(via.tier)} /> Primary selector failed — matched via fallback</span>}
          {via && (
            <span className="insp-test-via">
              <span className="insp-mono">{via.selector}</span>
              <button type="button" className="insp-link" disabled={locked} onClick={() => { edit([{ field: 'key', value: via.selector }]); setResult(null); }}>Use as primary</button>
            </span>
          )}
        </ResultCard>
      )}
    </>
  );
}

function dropNet(net: { current: ReturnType<typeof setTimeout> | null }) {
  if (net.current) clearTimeout(net.current);
}

/** The Timeout of the browser steps (editor-passo-158). Their Delay (159) is in the strip under the header (D29). */
function Timing({ step, locked }: { step: ActionItem; locked: boolean }) {
  const timeout = step.timeout > 0 ? step.timeout : DEFAULT_TIMEOUT_MS;
  return (
    <Section label="Timeout">
      <DraftField stepId={step.id ?? ''} field="timeout" label="Timeout in milliseconds" kind="int" step={1000} min={MIN_TIMEOUT_MS} max={MAX_TIMEOUT_MS} unit="ms" stored={String(timeout)} disabled={locked} />
    </Section>
  );
}
