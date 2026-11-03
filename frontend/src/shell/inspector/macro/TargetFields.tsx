import { useEffect, useRef, useState } from 'react';
import { useBridge } from '../../../bridge/BridgeContext';
import { t } from '../../../i18n';
import { newRequestId, useEditorTools } from '../../../logic/useEditorTools';
import { useMacro } from '../../../logic/useMacro';
import { Clear, DraftField, Section, Segmented } from '../fields';
import { ProcessPicker, ResultCard } from '../probeKit';
import { compiles, targetProblem, type TargetValue } from './target';
import '../editors.css';
import './macro.css';

// An emptied process or title clears it (the other one can still be the target).
const asTyped = (text: string) => text.trim();

type TestResult = { matches: boolean; foregroundProcess: string; foregroundTitle: string; error?: string };

/** The Test's answer: "Matches — chrome.exe / Inbox", "No match — nothing in front". */
function verdict(r: TestResult): string {
  const front = [r.foregroundProcess, r.foregroundTitle].filter(Boolean).join(' / ');
  if (!front) return r.matches ? t('macroSettings.fields.matchesNothing') : t('macroSettings.fields.noMatchNothing');
  return r.matches ? t('macroSettings.fields.matches', { window: front }) : t('macroSettings.fields.noMatch', { window: front });
}

/**
 * Which window, for the macro's target (Macro settings › Window target) and a folder's (its dialog):
 * the process, typed or picked from the running ones; the title, by Contains or a .NET regex; Detect
 * window, where the next window clicked fills both (Esc or a second press cancels); and Test, the
 * window in front now against these fields. A change goes to onChange once it is made — a field when
 * the typing stops, on Enter or when it is left; a pick, the mode, a clear or a detected window at
 * once — and the host says what it does: the macro's settings apply it, the folder's dialog keeps it
 * for Set target.
 */
export function TargetFields({ id, value, disabled, onChange }: {
  /** Whose fields these are (macro:… or folder:…), so typing in one is never the other's. */
  id: string;
  value: TargetValue;
  disabled?: boolean;
  onChange: (patch: Partial<TargetValue>) => void;
}) {
  const tools = useEditorTools();
  const macro = useMacro();
  const { subscribe } = useBridge();
  const regex = value.titleMatchMode === 'regex';
  const problem = targetProblem(value);
  // A pattern that does not compile is not sent: it stays being typed, judged as it goes, and goes
  // back to the saved title when the field is left (a pattern half written, like a colour).
  const [typedTitle, setTypedTitle] = useState<string | null>(null);
  const shownTitle = (typedTitle ?? value.windowTitle).trim();
  const badPattern = regex && shownTitle !== '' && !compiles(shownTitle);
  const parseTitle = (text: string) => {
    const title = text.trim();
    return regex && title && !compiles(title) ? null : title;
  };

  // Detect window: the id of the detection waiting for its click (nativo-126). The answer's id
  // (answerId) outlives it: on a click the engine says the detection ended (detectState false)
  // just BEFORE it sends the window it took, so the window must still find its request.
  const [detecting, setDetecting] = useState<string | null>(null);
  // Test: windowTarget:testResult carries no id, so a change since the press makes its answer stale.
  const [test, setTest] = useState<{ waiting: boolean; result: TestResult | null }>({ waiting: false, result: null });
  const live = useRef({ detecting, answerId: null as string | null, onChange, seq: 0, asked: -1 });
  useEffect(() => { live.current.detecting = detecting; live.current.onChange = onChange; });
  const change = (patch: Partial<TargetValue>) => {
    live.current.seq++;
    setTest({ waiting: false, result: null });
    onChange(patch);
  };

  useEffect(() => subscribe((message) => {
    const l = live.current;
    if (message.type === 'windowTarget:detected' && message.payload.requestId === l.answerId) {
      l.answerId = null;
      l.detecting = null;
      setDetecting(null);
      l.seq++;
      setTest({ waiting: false, result: null });
      l.onChange({ processName: message.payload.processName, windowTitle: message.payload.windowTitle });
    } else if (message.type === 'windowTarget:detectState' && message.payload.requestId === l.detecting && !message.payload.detecting) {
      l.detecting = null;
      setDetecting(null);
    } else if (message.type === 'windowTarget:testResult' && l.asked === l.seq) {
      l.asked = -1;
      setTest({ waiting: false, result: message.payload });
    }
  }), [subscribe]);
  // A verdict on what is in front now goes stale: it gives way to the Test button after 3.5 s.
  useEffect(() => {
    if (!test.result) return;
    const id = setTimeout(() => setTest({ waiting: false, result: null }), 3500);
    return () => clearTimeout(id);
  }, [test.result]);

  const stopDetecting = () => {
    const requestId = live.current.detecting;
    if (!requestId) return;
    // Cancelled: a window a click took just before the stop is not wanted any more.
    live.current.answerId = null;
    live.current.detecting = null;
    setDetecting(null);
    tools.detectWindow({ requestId, enabled: false });
  };
  // Esc cancels a detection before the Inspector or a dialog takes it (capture phase), and leaving
  // stops one still waiting for its click.
  useEffect(() => {
    if (!detecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      stopDetecting();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => () => {
    const requestId = live.current.detecting;
    if (requestId) tools.detectWindow({ requestId, enabled: false });
  }, [tools]);

  const result = test.result;
  return (
    <>
      <Section label={t('macroSettings.fields.process')} hint={problem === 'empty' ? t('macroSettings.fields.fillIn') : undefined}>
        <div className="insp-line">
          <DraftField
            stepId={id}
            field="targetProcess"
            label={t('macroSettings.fields.process')}
            kind="mono"
            placeholder={t('macroSettings.fields.processPlaceholder')}
            stored={value.processName}
            disabled={disabled}
            parse={asTyped}
            onApply={(processName) => change({ processName })}
          />
          {value.processName && <Clear label={t('macroSettings.fields.clearProcess')} disabled={disabled} onClear={() => change({ processName: '' })} />}
          <ProcessPicker disabled={disabled} onPick={(processName) => change({ processName })} />
        </div>
      </Section>
      <Section
        label={t('macroSettings.fields.title')}
        hint={badPattern
          ? <span data-error="">{t('macroSettings.fields.badRegex')}</span>
          : t('macroSettings.fields.caseInsensitive')}
      >
        <Segmented<'contains' | 'regex'>
          label={t('macroSettings.fields.titleMode')}
          value={value.titleMatchMode}
          disabled={disabled}
          options={[
            { value: 'contains', label: t('macroSettings.fields.contains') },
            { value: 'regex', label: t('macroSettings.fields.regex'), tip: t('macroSettings.fields.regexTip') },
          ]}
          onChange={(titleMatchMode) => change({ titleMatchMode })}
        />
        <div className="insp-line">
          <DraftField
            stepId={id}
            field="targetTitle"
            label={t('macroSettings.fields.title')}
            kind="text"
            placeholder={regex ? t('macroSettings.fields.titleRegexPlaceholder') : t('macroSettings.fields.titlePlaceholder')}
            stored={value.windowTitle}
            disabled={disabled}
            parse={parseTitle}
            onText={setTypedTitle}
            onApply={(windowTitle) => change({ windowTitle })}
          />
          {value.windowTitle && <Clear label={t('macroSettings.fields.clearTitle')} disabled={disabled} onClear={() => change({ windowTitle: '' })} />}
        </div>
      </Section>
      <div className="insp-pair">
        <button
          type="button"
          className="insp-button"
          data-armed={detecting ? '' : undefined}
          data-tip={detecting ? t('macroSettings.fields.detectingTip') : t('macroSettings.fields.detectTip')}
          disabled={disabled}
          onClick={() => {
            if (detecting) { stopDetecting(); return; }
            const requestId = newRequestId();
            live.current.detecting = requestId;
            live.current.answerId = requestId;
            setDetecting(requestId);
            tools.detectWindow({ requestId, enabled: true });
          }}
        >
          <span className="step-icon" data-icon="crosshair" />
          {detecting ? t('macroSettings.fields.detecting') : t('macroSettings.fields.detect')}
        </button>
        <button
          type="button"
          className="insp-button"
          data-tip={t('macroSettings.fields.testTip')}
          disabled={disabled || problem !== null || test.waiting}
          onClick={() => {
            live.current.asked = live.current.seq;
            setTest({ waiting: true, result: null });
            macro.testWindowMatch({ processName: value.processName.trim(), windowTitle: value.windowTitle.trim(), titleMatchMode: value.titleMatchMode });
          }}
        >
          <span className="step-icon" data-icon="play" />
          {test.waiting ? t('macroSettings.fields.testing') : t('common.actions.test')}
        </button>
      </div>
      {result && (
        <ResultCard
          ok={!result.error && result.matches}
          title={result.error || verdict(result)}
        />
      )}
    </>
  );
}
