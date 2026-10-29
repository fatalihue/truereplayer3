import { useEffect, useRef, useState } from 'react';
import { useBridge } from '../../../bridge/BridgeContext';
import { newRequestId, useEditorTools } from '../../../logic/useEditorTools';
import { useMacro } from '../../../logic/useMacro';
import { useTt } from '../../../state/LanguageContext';
import { Clear, DraftField, Section, Segmented } from '../fields';
import { ProcessPicker, ResultCard } from '../probeKit';
import { compiles, targetProblem, type TargetValue } from './target';
import '../editors.css';
import './macro.css';

// An emptied process or title clears it (the other one can still be the target).
const asTyped = (text: string) => text.trim();

type TestResult = { matches: boolean; foregroundProcess: string; foregroundTitle: string; error?: string };

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
  const tt = useTt();
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
      <Section label="Process" hint={problem === 'empty' ? 'Fill in a process, a title or both.' : undefined}>
        <div className="insp-line">
          <DraftField
            stepId={id}
            field="targetProcess"
            label="Process"
            kind="mono"
            placeholder="notepad.exe"
            stored={value.processName}
            disabled={disabled}
            parse={asTyped}
            onApply={(processName) => change({ processName })}
          />
          {value.processName && <Clear label="Clear the process" labelPt="Limpar o processo" disabled={disabled} onClear={() => change({ processName: '' })} />}
          <ProcessPicker disabled={disabled} onPick={(processName) => change({ processName })} />
        </div>
      </Section>
      <Section
        label="Title"
        hint={badPattern
          ? <span data-error="">This does not look like a valid regular expression.</span>
          : 'Case-insensitive.'}
      >
        <Segmented<'contains' | 'regex'>
          label="Title match mode"
          value={value.titleMatchMode}
          disabled={disabled}
          options={[{ value: 'contains', label: 'Contains' }, { value: 'regex', label: 'Regex', tip: tt('.NET regular expression', 'Expressão regular .NET') }]}
          onChange={(titleMatchMode) => change({ titleMatchMode })}
        />
        <div className="insp-line">
          <DraftField
            stepId={id}
            field="targetTitle"
            label="Title"
            kind="text"
            placeholder={regex ? 'e.g. (Chrome|Firefox)' : 'Part of the window title'}
            stored={value.windowTitle}
            disabled={disabled}
            parse={parseTitle}
            onText={setTypedTitle}
            onApply={(windowTitle) => change({ windowTitle })}
          />
          {value.windowTitle && <Clear label="Clear the title" labelPt="Limpar o título" disabled={disabled} onClear={() => change({ windowTitle: '' })} />}
        </div>
      </Section>
      <div className="insp-pair">
        <button
          type="button"
          className="insp-button"
          data-armed={detecting ? '' : undefined}
          data-tip={detecting
            ? tt('Click the window to target. Click here or press Esc to cancel.', 'Clique na janela-alvo. Clique aqui ou aperte Esc para cancelar.')
            : tt('The next window you click fills the process and the title', 'A próxima janela que você clicar preenche o processo e o título')}
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
          {detecting ? 'Click the target window…' : 'Detect window'}
        </button>
        <button
          type="button"
          className="insp-button"
          data-tip={tt('Checks the window in FRONT right now against these fields.', 'Confere a janela que está em PRIMEIRO PLANO agora contra estes campos.')}
          disabled={disabled || problem !== null || test.waiting}
          onClick={() => {
            live.current.asked = live.current.seq;
            setTest({ waiting: true, result: null });
            macro.testWindowMatch({ processName: value.processName.trim(), windowTitle: value.windowTitle.trim(), titleMatchMode: value.titleMatchMode });
          }}
        >
          <span className="step-icon" data-icon="play" />
          {test.waiting ? 'Testing…' : 'Test'}
        </button>
      </div>
      {result && (
        <ResultCard
          ok={!result.error && result.matches}
          title={result.error || `${result.matches ? 'Matches' : 'No match'} — ${[result.foregroundProcess, result.foregroundTitle].filter(Boolean).join(' / ') || 'nothing in front'}`}
        />
      )}
    </>
  );
}
