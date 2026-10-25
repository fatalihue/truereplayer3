import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useBridge } from '../../bridge/BridgeContext';
import type { ActionItem } from '../../bridge/messageTypes';
import { newRequestId, useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
import { DraftField, Section, Segmented, Switch } from './fields';
import { applyEdits, pendingEdits, type StepEdit } from './inspectorState';
import { ProcessPicker, ResultCard } from './probeKit';
import { useAsk } from './probes';

// The checks that read a state, not the screen: a window, a process, a file, the clipboard, a
// variable, a chance and the time. Each field applies as it is typed (DraftField) and each choice
// on the press; one message per change, one Ctrl+Z.

type Props = { step: ActionItem; locked: boolean };
const useEdit = (step: ActionItem) => {
  const cmds = useSteps();
  return (edits: StepEdit[]) => applyEdits(cmds, step.id ?? '', edits);
};
// A text field whose empty is a real value (it clears the field): every typed text goes as it is.
const asTyped = (text: string) => text.trim();

/** The × at the end of a field that clears it, and gives the focus back to the field. */
function Clear({ label, onClear, disabled }: { label: string; onClear: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="insp-icon-button"
      aria-label={label}
      data-tip={label}
      disabled={disabled}
      onClick={(e) => {
        onClear();
        e.currentTarget.parentElement?.querySelector('input')?.focus();
      }}
    >
      <span className="step-icon" data-icon="x" />
    </button>
  );
}

const validRegex = (s: string) => {
  try { new RegExp(s); return true; } catch { return false; }
};

/**
 * Window open: the window by its process and/or its title (Contains or a .NET regex), in front or
 * just open. Detect window fills both from the next window clicked; Test asks the engine now.
 */
export function WindowCheck({ step, locked }: Props) {
  const edit = useEdit(step);
  const tools = useEditorTools();
  const id = step.id ?? '';
  const regex = step.windowTitleMatchMode === 'regex';
  const process = step.windowProcessName ?? '';
  const title = step.windowTitle ?? '';
  const [result, setResult] = useState<{ found: boolean; matchProcess: string; matchTitle: string; error?: string } | null>(null);
  const test = useAsk('window:testProbeResult', setResult);
  const { subscribe } = useBridge();
  // Detect window: the id of the detection waiting for its click. The answer fills both fields in
  // one edit; the engine also says when it ends some other way.
  const [detecting, setDetecting] = useState<string | null>(null);
  const live = useRef({ detecting, edit });
  useEffect(() => { live.current = { detecting, edit }; });
  useEffect(() => subscribe((message) => {
    if (message.type === 'windowTarget:detected' && message.payload.requestId === live.current.detecting) {
      setDetecting(null);
      live.current.edit([{ field: 'windowProcessName', value: message.payload.processName }, { field: 'windowTitle', value: message.payload.windowTitle }]);
    } else if (message.type === 'windowTarget:detectState' && message.payload.requestId === live.current.detecting && !message.payload.detecting) {
      setDetecting(null);
    }
  }), [subscribe]);
  const stopDetecting = () => {
    if (!detecting) return;
    tools.detectWindow({ requestId: detecting, enabled: false });
    setDetecting(null);
  };
  // Leaving the step (or the Inspector) stops a detection still waiting for its click.
  useEffect(() => () => stopDetection(tools, live), [tools]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !detecting || e.defaultPrevented) return;
    e.preventDefault();
    stopDetecting();
  };

  return (
    <div className="insp-group" onKeyDown={onKeyDown}>
      <Section label="Process" hint="Empty = match by the title only.">
        <div className="insp-line">
          <DraftField stepId={id} field="windowProcessName" label="Process" kind="mono" placeholder="notepad.exe" stored={process} disabled={locked} parse={asTyped} />
          {process && <Clear label="Clear the process" disabled={locked} onClear={() => edit([{ field: 'windowProcessName', value: '' }])} />}
          <ProcessPicker disabled={locked} onPick={(name) => edit([{ field: 'windowProcessName', value: name }])} />
        </div>
      </Section>
      <Section
        label="Title"
        hint={regex && title && !validRegex(title)
          ? <span data-error="">This does not look like a valid regular expression.</span>
          : process ? 'Case-insensitive.' : 'Case-insensitive. Fill at least one.'}
      >
        <Segmented<'contains' | 'regex'>
          label="Title match mode"
          value={regex ? 'regex' : 'contains'}
          disabled={locked}
          options={[{ value: 'contains', label: 'Contains' }, { value: 'regex', label: 'Regex', tip: '.NET regular expression' }]}
          onChange={(v) => edit([{ field: 'windowTitleMatchMode', value: v }])}
        />
        <div className="insp-line">
          <DraftField stepId={id} field="windowTitle" label="Title" kind="text" placeholder={regex ? 'e.g. (Chrome|Firefox)' : 'Part of the window title'} stored={title} disabled={locked} />
          {title && <Clear label="Clear the title" disabled={locked} onClear={() => edit([{ field: 'windowTitle', value: '' }])} />}
        </div>
      </Section>
      <div className="insp-row">
        <span className="insp-row-label">Foreground window only</span>
        <Switch label="Foreground window only" tip="It must be in front, not just open" checked={!!step.windowMatchForegroundOnly} disabled={locked} onChange={(on) => edit([{ field: 'windowMatchForegroundOnly', value: String(on) }])} />
      </div>
      <div className="insp-pair">
        <button
          type="button"
          className="insp-button"
          data-armed={detecting ? '' : undefined}
          data-tip={detecting ? 'Click the window to check for. Click here or press Esc to cancel.' : 'The next window you click fills the process and the title'}
          disabled={locked}
          onClick={() => {
            if (detecting) { stopDetecting(); return; }
            const requestId = newRequestId();
            setDetecting(requestId);
            live.current.detecting = requestId;
            tools.detectWindow({ requestId, enabled: true });
          }}
        >
          <span className="step-icon" data-icon="crosshair" />
          {detecting ? 'Click the target window…' : 'Detect window'}
        </button>
        <button
          type="button"
          className="insp-button"
          disabled={locked || test.waiting || (!process.trim() && !title.trim())}
          onClick={() => {
            setResult(null);
            test.ask(requestId => tools.testWindow({
              requestId, processName: process, windowTitle: title, titleMatchMode: regex ? 'regex' : 'contains',
              foregroundOnly: !!step.windowMatchForegroundOnly, matchIndex: 1,
            }));
          }}
        >
          <span className="step-icon" data-icon="play" />
          {test.waiting ? 'Testing…' : 'Test'}
        </button>
      </div>
      {result && !test.waiting && (
        <ResultCard
          ok={result.found}
          title={result.found ? `Found — ${[result.matchProcess, result.matchTitle].filter(Boolean).join(' · ')}` : (result.error || 'Not found')}
        />
      )}
    </div>
  );
}

function stopDetection(tools: ReturnType<typeof useEditorTools>, live: { current: { detecting: string | null } }) {
  const requestId = live.current.detecting;
  if (requestId) tools.detectWindow({ requestId, enabled: false });
}

/** Process running: the program by its name, with a window or not. */
export function ProcessCheck({ step, locked }: Props) {
  const edit = useEdit(step);
  const process = step.windowProcessName ?? '';
  return (
    <Section label="Process name" hint="Matches even without a window.">
      <div className="insp-line">
        <DraftField stepId={step.id ?? ''} field="windowProcessName" label="Process name" kind="mono" placeholder="chrome.exe" stored={process} disabled={locked} parse={asTyped} />
        {process && <Clear label="Clear the process" disabled={locked} onClear={() => edit([{ field: 'windowProcessName', value: '' }])} />}
        <ProcessPicker disabled={locked} onPick={(name) => edit([{ field: 'windowProcessName', value: name }])} />
      </div>
    </Section>
  );
}

/** File exists: a path, file or folder; tokens resolve when it runs. */
export function FileCheck({ step, locked }: Props) {
  return (
    <Section label="Path" hint="A file or a folder. Tokens resolve at run time.">
      <DraftField stepId={step.id ?? ''} field="filePath" label="Path" kind="mono" placeholder="C:\flags\go.txt" stored={step.filePath ?? ''} disabled={locked} parse={asTyped} />
    </Section>
  );
}

/** Clipboard: the copied text against a pattern. */
export function ClipboardCheck({ step, locked }: Props) {
  const edit = useEdit(step);
  const type = step.clipboardPatternType === 'equals' || step.clipboardPatternType === 'regex' ? step.clipboardPatternType : 'contains';
  return (
    <>
      <Section label="Match type">
        <Segmented<'contains' | 'equals' | 'regex'>
          label="Clipboard match type"
          value={type}
          disabled={locked}
          options={[{ value: 'contains', label: 'Contains' }, { value: 'equals', label: 'Equals' }, { value: 'regex', label: 'Regex' }]}
          onChange={(v) => edit([{ field: 'clipboardPatternType', value: v }])}
        />
      </Section>
      <Section label="Pattern" hint="Text only, ignoring case.">
        <DraftField stepId={step.id ?? ''} field="clipboardPattern" label="Pattern" kind="mono" stored={step.clipboardPattern ?? ''} disabled={locked} parse={(t) => t} />
      </Section>
    </>
  );
}

const OPERATORS: { value: 'eq' | 'neq' | 'contains' | 'gt' | 'lt'; label: string; tip?: string }[] = [
  { value: 'eq', label: '=', tip: 'The same text, ignoring case' },
  { value: 'neq', label: '≠', tip: 'Not the same text' },
  { value: 'contains', label: 'has', tip: 'Contains it' },
  { value: 'gt', label: '>', tip: 'As numbers when both are numbers' },
  { value: 'lt', label: '<', tip: 'As numbers when both are numbers' },
];

/** Variable: a variable of the run compared with a value. */
export function VariableCheck({ step, locked }: Props) {
  const edit = useEdit(step);
  const id = step.id ?? '';
  const op = OPERATORS.some(o => o.value === step.conditionOperator) ? step.conditionOperator as typeof OPERATORS[number]['value'] : 'eq';
  return (
    <>
      <Section label="Variable name">
        <DraftField stepId={id} field="key" label="Variable name" kind="mono" placeholder="name" stored={step.key} disabled={locked} parse={asTyped} />
      </Section>
      <Section label="Operator">
        <Segmented label="Comparison operator" value={op} disabled={locked} options={OPERATORS} onChange={(v) => edit([{ field: 'conditionOperator', value: v }])} />
      </Section>
      <Section label="Value" hint="Tokens resolve at run time.">
        <DraftField stepId={id} field="conditionOperand" label="Value" kind="mono" stored={step.conditionOperand ?? ''} disabled={locked} parse={(t) => t} />
      </Section>
    </>
  );
}

/** Random: passes this often. */
export function RandomCheck({ step, locked }: Props) {
  const pct = step.randomPercent ?? 0;
  return (
    <>
      <Section label="Chance">
        <DraftField stepId={step.id ?? ''} field="randomPercent" label="Random chance percent" kind="int" min={0} max={100} empty="min" unit="%" stored={String(pct)} disabled={locked} />
      </Section>
      <p className="insp-summary" aria-live="polite" data-error={pct === 0 ? '' : undefined}>
        {pct === 0 ? 'At 0 % it never passes.' : pct === 100 ? 'At 100 % it always passes.' : `Passes ${pct} % of the time.`}
      </p>
    </>
  );
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Time: a time window (overnight works) on some days of the week, or every day. */
export function TimeCheck({ step, locked }: Props) {
  const edit = useEdit(step);
  const id = step.id ?? '';
  const days = step.daysOfWeek ?? 0;
  return (
    <>
      <div className="insp-pair">
        <Section label="From">
          <TimeField stepId={id} field="timeStart" label="From" stored={step.timeStart ?? ''} disabled={locked} />
        </Section>
        <Section label="To">
          <TimeField stepId={id} field="timeEnd" label="To" stored={step.timeEnd ?? ''} disabled={locked} />
        </Section>
      </div>
      <span className="insp-hint">Overnight works, like 22:00 to 02:00.</span>
      <Section label="Days" hint="None = every day.">
        <div className="insp-days" role="group" aria-label="Days">
          {DAYS.map((day, bit) => (
            <button
              key={day}
              type="button"
              aria-pressed={(days & (1 << bit)) !== 0}
              aria-label={day}
              data-tip={day}
              disabled={locked}
              onClick={() => edit([{ field: 'daysOfWeek', value: String(days ^ (1 << bit)) }])}
            >
              {day[0]}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

const TIME_IDLE_MS = 600;

/**
 * A time of day ("HH:mm"), applied like any field of the Inspector: when the typing stops, when it
 * is left, on Enter — so stepping through the hours with the arrows is one edit, not one per step.
 */
function TimeField({ stepId, field, label, stored, disabled }: { stepId: string; field: string; label: string; stored: string; disabled?: boolean }) {
  const cmds = useSteps();
  const [typed, setTyped] = useState<{ value: string; over: string } | null>(null);
  if (typed && typed.over !== stored) setTyped(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef({ typed, stored, cmds });
  useEffect(() => { live.current = { typed, stored, cmds }; });
  const send = () => sendTime(timer, live, stepId, field);
  useEffect(() => () => sendTime(timer, live, stepId, field), [stepId, field]);
  return (
    <label className="insp-box" data-disabled={disabled || undefined}>
      <input
        type="time"
        aria-label={label}
        className="insp-mono"
        value={typed ? typed.value : stored}
        disabled={disabled}
        onChange={(e) => {
          setTyped({ value: e.target.value, over: stored });
          live.current = { ...live.current, typed: { value: e.target.value, over: stored } };
          pendingEdits.add(`${stepId}:${field}`);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(send, TIME_IDLE_MS);
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
        onBlur={send}
      />
    </label>
  );
}

type TimeLive = { typed: { value: string; over: string } | null; stored: string; cmds: ReturnType<typeof useSteps> };
function sendTime(timer: { current: ReturnType<typeof setTimeout> | null }, live: { current: TimeLive }, stepId: string, field: string) {
  if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  pendingEdits.remove(`${stepId}:${field}`);
  const { typed, stored, cmds } = live.current;
  if (!typed || typed.over !== stored || typed.value === stored) return;
  applyEdits(cmds, stepId, [{ field, value: typed.value }]);
}
