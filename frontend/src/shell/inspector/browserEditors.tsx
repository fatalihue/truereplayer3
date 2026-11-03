import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBridge } from '../../bridge/BridgeContext';
import type { ActionItem, BrowserTestResult, SelectorAlternative } from '../../bridge/messageTypes';
import { fmtNum, LANG, t, tn } from '../../i18n';
import { newRequestId, useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
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
/** The extension's error codes, said in the interface's language (the same table as the Dock's). */
const CODES: Readonly<Record<string, string | undefined>> = tn('dock.codes');

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
const TEXT_MODES: { value: TextMode; label: string; tip?: string }[] = [
  { value: 'exact', label: t('browser.textMatch.exact') },
  { value: 'contains', label: t('browser.textMatch.contains') },
  { value: 'icontains', label: t('browser.textMatch.icontains'), tip: t('browser.textMatch.icontainsTip') },
  { value: 'regex', label: t('browser.textMatch.regex') },
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
const trim = (text: string) => text.trim();

/**
 * ⑧ The browser steps (editor-passo-126 to 159): Open URL, with the address, the tab and what to
 * wait for after it; or the element — its CSS selector, with the shield, Pick element and the
 * alternatives, or its text (Text Match) — and what each step does with it: the text to type, the
 * option to choose, or the condition to wait for or to require, with what a failed requirement
 * does. Then Test action, which does the step for real on the tab, and the Timeout. The Delay is
 * in the strip under the header, as every step's (D29).
 */
export function BrowserEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const type = step.actionType;
  return (
    <>
      <ExtensionMissing />
      {type === 'BrowserNavigate' ? <OpenUrlFields step={step} locked={locked} /> : <ElementFields step={step} locked={locked} withText={WITH_TEXT.has(type)} />}
      {type === 'BrowserType' && <TypeFields step={step} locked={locked} />}
      {type === 'BrowserSelectOption' && <SelectFields step={step} locked={locked} />}
      {(type === 'BrowserWaitElement' || type === 'BrowserAssert') && <ConditionFields step={step} locked={locked} />}
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
    if (takeFieldAsk(id, 'key')) document.querySelector<HTMLInputElement>(`.insp-body input[aria-label="${t('browser.openUrl.url')}"]`)?.focus();
  }, [id]);
  return (
    <>
      <Section label={t('browser.openUrl.url')} hint={url.trim() ? t('browser.openUrl.hint') : <span data-error="">{t('browser.openUrl.missing')}</span>}>
        <DraftField stepId={id} field="key" label={t('browser.openUrl.url')} kind="mono" placeholder={t('browser.openUrl.placeholder')} stored={url} disabled={locked} parse={trim} />
      </Section>
      <div className="insp-row">
        <span className="insp-row-label">{t('browser.openUrl.newTab')}</span>
        <Switch label={t('browser.openUrl.newTab')} checked={!!step.newTab} disabled={locked} onChange={(on) => edit([{ field: 'newTab', value: String(on) }])} />
      </div>
      <span className="insp-sublabel">{t('browser.openUrl.after')}</span>
      <Section label={t('browser.openUrl.pattern')} hint={t('browser.openUrl.patternHint')}>
        <DraftField stepId={id} field="urlWaitPattern" label={t('browser.openUrl.pattern')} kind="mono" placeholder={t('browser.openUrl.patternPlaceholder')} stored={step.urlWaitPattern ?? ''} disabled={locked} parse={trim} />
      </Section>
      <Section label={t('browser.openUrl.ready')}>
        <DraftField stepId={id} field="postNavigateSelector" label={t('browser.openUrl.ready')} kind="mono" placeholder={t('browser.openUrl.readyPlaceholder')} stored={step.postNavigateSelector ?? ''} disabled={locked} parse={trim} />
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
      <SelectorField step={step} locked={locked} stored={found ? '' : key} hint={found ? t('browser.textMatch.foundBelow') : undefined} />
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
      label={t('browser.textMatch.label')}
      aside={found ? <Tier selector={key} /> : undefined}
      hint={bad ? <span data-error="">{t('browser.textMatch.invalid', { error: bad })}</span> : t('browser.textMatch.hint')}
    >
      <Segmented<TextMode>
        label={t('browser.textMatch.mode')}
        value={mode}
        disabled={locked}
        options={TEXT_MODES}
        onChange={(m) => {
          setMode(m);
          const raw = found?.raw ?? '';
          if (raw && !(m === 'regex' && regexError(raw))) send(m, raw);
        }}
      />
      <DraftField
        stepId={id}
        field="textMatch"
        label={t('browser.textMatch.field')}
        kind="mono"
        placeholder={mode === 'regex' ? t('browser.textMatch.regexPlaceholder') : t('browser.textMatch.placeholder')}
        stored={found?.raw ?? ''}
        disabled={locked}
        parse={(text) => (mode === 'regex' && text.trim() && regexError(text.trim()) ? null : text.trim())}
        onText={setTyped}
        onApply={(raw) => send(mode, raw)}
      />
    </Section>
  );
}

/** Type Text (editor-passo-140 to 144): the text, with tokens, and how it is typed. */
function TypeFields({ step, locked }: { step: ActionItem; locked: boolean }) {
  const edit = useEdit(step);
  const id = step.id ?? '';
  const paste = !!step.typePaste;
  return (
    <>
      <Section label={t('browser.typeText.text')} hint={t('browser.typeText.hint')}>
        {/* Keyed by the step: another step's text starts its own editor. */}
        <Suspense fallback={<div className="insp-text-wait" />}>
          <TypeTextField key={id} step={step} locked={locked} />
        </Suspense>
      </Section>
      <span className="insp-sublabel">{t('browser.typeText.typing')}</span>
      <div className="insp-row">
        <span className="insp-row-label">{t('browser.typeText.keep')}</span>
        <Switch label={t('browser.typeText.keep')} checked={!!step.typeAppend} disabled={locked} onChange={(on) => edit([{ field: 'typeAppend', value: String(on) }])} />
      </div>
      <div className="insp-row">
        <span className="insp-row-label">{t('browser.typeText.paste')}</span>
        <Switch label={t('browser.typeText.paste')} tip={t('browser.typeText.pasteTip')} checked={paste} disabled={locked} onChange={(on) => edit([{ field: 'typePaste', value: String(on) }])} />
      </div>
      <Section label={t('browser.typeText.charDelay')} hint={paste ? t('browser.typeText.pasteNoDelay') : t('browser.typeText.emptyNoPause')}>
        <DraftField
          stepId={id}
          field="typeDelay"
          label={t('browser.typeText.charDelayField')}
          kind="int"
          min={0}
          max={60000}
          unit="ms"
          empty="clear"
          placeholder={t('browser.typeText.none')}
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
  const id = step.id ?? '';
  const by: MatchBy = step.selectMatchMode === 'value' || step.selectMatchMode === 'index' ? step.selectMatchMode : 'text';
  return (
    <>
      <Section label={t('browser.selectOption.matchBy')} hint={t('browser.selectOption.nativeOnly')}>
        <Segmented<MatchBy>
          label={t('browser.selectOption.mode')}
          value={by}
          disabled={locked}
          options={[
            { value: 'text', label: t('browser.selectOption.text'), tip: t('browser.selectOption.textTip') },
            { value: 'value', label: t('browser.selectOption.value'), tip: t('browser.selectOption.valueTip') },
            { value: 'index', label: t('browser.selectOption.index'), tip: t('browser.selectOption.indexTip') },
          ]}
          onChange={(v) => edit([{ field: 'selectMatchMode', value: v === 'text' ? '' : v }])}
        />
      </Section>
      <Section label={t('browser.selectOption.option')}>
        <DraftField
          stepId={id}
          field="browserText"
          label={t('browser.selectOption.option')}
          kind={by === 'text' ? 'text' : 'mono'}
          placeholder={by === 'index' ? '0' : by === 'value' ? t('browser.selectOption.valuePlaceholder') : t('browser.selectOption.labelPlaceholder')}
          stored={step.browserText ?? ''}
          disabled={locked}
          filter={by === 'index' ? (text) => text.replace(/\D/g, '') : undefined}
          parse={trim}
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
  const assert = step.actionType === 'BrowserAssert';
  const cond: Condition = step.waitMode === 'disappears' || step.waitMode === 'enabled' || step.waitMode === 'text-match' ? step.waitMode : 'appears';
  const noText = cond === 'text-match' && !textOf(step.key ?? '');
  const fail = step.assertOnFail === 'Continue' ? 'continue' : step.assertOnFail === 'StopReplay' ? 'quiet' : 'halt';
  return (
    <>
      <Section
        label={t('browser.condition.label')}
        hint={noText ? <span data-error="">{assert ? t('browser.condition.assertEmpty') : t('browser.condition.waitEmpty')}</span> : undefined}
      >
        <Segmented<Condition>
          label={assert ? t('browser.condition.assertMode') : t('browser.condition.waitMode')}
          value={cond}
          disabled={locked}
          wrap
          options={assert ? [
            { value: 'appears', label: t('browser.condition.present') },
            { value: 'disappears', label: t('browser.condition.notPresent') },
            { value: 'enabled', label: t('browser.condition.isEnabled') },
            { value: 'text-match', label: t('browser.condition.textMatches') },
          ] : [
            { value: 'appears', label: t('browser.condition.appears') },
            { value: 'disappears', label: t('browser.condition.disappears') },
            { value: 'enabled', label: t('browser.condition.enabled') },
            { value: 'text-match', label: t('browser.condition.textMatches') },
          ]}
          onChange={(v) => edit([{ field: 'waitMode', value: v === 'appears' ? '' : v }])}
        />
      </Section>
      {assert && (
        <Section label={t('browser.condition.onFail')}>
          <Segmented<'halt' | 'continue' | 'quiet'>
            label={t('browser.condition.onFailMode')}
            value={fail}
            disabled={locked}
            options={[
              { value: 'halt', label: t('browser.condition.halt'), tip: t('browser.condition.haltTip') },
              { value: 'continue', label: t('browser.condition.continue'), tip: t('browser.condition.continueTip') },
              { value: 'quiet', label: t('browser.condition.quiet'), tip: t('browser.condition.quietTip') },
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
  error: { code: 'NO_RESPONSE', message: t('browser.test.noResponse'), tip: t('browser.test.noResponseTip') },
});
const tierOf = (tier: string): SelectorAlternative['tier'] => (tier === 'S' || tier === 'A' || tier === 'B' ? tier : 'C');

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
  // The extension writes its message in English, naming the selector: the English build shows it as it
  // came; another language says a code it knows in its own words (as the Dock does). Its tip goes
  // under it unless the message already ends with it.
  const known = LANG !== 'en-US' && result?.error?.code ? CODES[result.error.code] : undefined;
  const said = known || result?.error?.message;
  const tip = result?.error?.tip && !(said ?? '').includes(result.error.tip) ? result.error.tip : null;
  return (
    <>
      <button type="button" className="insp-button" disabled={locked || waiting} onClick={run}>
        <span className="step-icon" data-icon="play" />
        {waiting ? t('browser.test.running') : t('browser.test.run')}
      </button>
      {result && !waiting && (
        <ResultCard ok={result.success} title={result.success ? t('browser.test.success', { ms: fmtNum(result.durationMs ?? 0) }) : result.error?.code || t('browser.test.failed')}>
          {!result.success && said && <span>{said}</span>}
          {!result.success && tip && <span className="insp-test-tip">{tip}</span>}
          {via && <span><Tier selector={via.selector} tier={tierOf(via.tier)} /> {t('browser.test.viaFallback')}</span>}
          {via && (
            <span className="insp-test-via">
              <span className="insp-mono">{via.selector}</span>
              <button type="button" className="insp-link" disabled={locked} onClick={() => { edit([{ field: 'key', value: via.selector }]); setResult(null); }}>{t('browser.test.usePrimary')}</button>
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
    <Section label={t('browser.timeout')}>
      <DraftField stepId={step.id ?? ''} field="timeout" label={t('browser.timeoutField')} kind="int" step={1000} min={MIN_TIMEOUT_MS} max={MAX_TIMEOUT_MS} unit="ms" stored={String(timeout)} disabled={locked} />
    </Section>
  );
}
