import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useBridge } from '../../bridge/BridgeContext';
import type { ActionItem } from '../../bridge/messageTypes';
import { fmtNum, LANG, t } from '../../i18n';
import { newRequestId, useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
import { useCheckTarget } from './checkTarget';
import { Clear, DraftField, Section, Segmented, Switch } from './fields';
import { applyEdits, pendingEdits, type StepEdit } from './inspectorState';
import { ProcessPicker, ResultCard } from './probeKit';
import { useAsk } from './probes';

// The checks that read a state, not the screen: a window, a process, a file, the clipboard, a
// variable, a chance and the time. Each field applies as it is typed (DraftField) and each choice
// on the press; one message per change, one Ctrl+Z.

type Props = { step: ActionItem; locked: boolean };
/** The step's edits, or what the check edits instead (an automation's trigger: checkTarget). */
const useEdit = (step: ActionItem) => {
  const cmds = useSteps();
  const target = useCheckTarget();
  return (edits: StepEdit[]) => (target ? target.edit(edits) : applyEdits(cmds, step.id ?? '', edits));
};
// A text field whose empty is a real value (it clears the field): every typed text goes as it is.
const asTyped = (text: string) => text.trim();

const validRegex = (s: string) => {
  try { new RegExp(s); return true; } catch { return false; }
};

/**
 * Window open: the window by its process and/or its title (Contains or a .NET regex), in front or
 * just open. Detect window fills both from the next window clicked; Test asks the engine now.
 * Activate Window ('activate') takes the same window by which match it is, front to back, instead
 * of whether it is in front, and Test looks for that match. An automation's anchor ('anchor', D17)
 * is the window its coordinates follow: the process and the title, and Detect window.
 */
export function WindowCheck({ step, locked, activate = false, anchor = false }: Props & { activate?: boolean; anchor?: boolean }) {
  const edit = useEdit(step);
  const tools = useEditorTools();
  const id = step.id ?? '';
  const regex = step.windowTitleMatchMode === 'regex';
  const process = step.windowProcessName ?? '';
  const title = step.windowTitle ?? '';
  const nth = Math.max(1, step.windowMatchIndex ?? 1);
  const [result, setResult] = useState<{ found: boolean; matchProcess: string; matchTitle: string; error?: string } | null>(null);
  const test = useAsk('window:testProbeResult', setResult);
  const { subscribe } = useBridge();
  // Detect window: the id of the detection waiting for its click. The answer fills both fields in
  // one edit; the engine also says when it ends some other way. The answer's id outlives the wait:
  // on a click the engine says the detection ended (detectState false) just BEFORE it sends the
  // window it took, so the window must still find its request.
  const [detecting, setDetecting] = useState<string | null>(null);
  const answerId = useRef<string | null>(null);
  const live = useRef({ detecting, edit });
  useEffect(() => { live.current = { detecting, edit }; });
  useEffect(() => subscribe((message) => {
    if (message.type === 'windowTarget:detected' && message.payload.requestId === answerId.current) {
      answerId.current = null;
      setDetecting(null);
      live.current.edit([{ field: 'windowProcessName', value: message.payload.processName }, { field: 'windowTitle', value: message.payload.windowTitle }]);
    } else if (message.type === 'windowTarget:detectState' && message.payload.requestId === live.current.detecting && !message.payload.detecting) {
      setDetecting(null);
    }
  }), [subscribe]);
  const stopDetecting = () => {
    if (!detecting) return;
    // Cancelled: a window a click took just before the stop is not wanted any more.
    answerId.current = null;
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
      <Section label={t('conditions.window.process')} hint={t('conditions.window.processHint')}>
        <div className="insp-line">
          <DraftField stepId={id} field="windowProcessName" label={t('conditions.window.process')} kind="mono" placeholder={t('conditions.window.processPlaceholder')} stored={process} disabled={locked} parse={asTyped} />
          {process && <Clear label={t('conditions.window.clearProcess')} disabled={locked} onClear={() => edit([{ field: 'windowProcessName', value: '' }])} />}
          <ProcessPicker disabled={locked} onPick={(name) => edit([{ field: 'windowProcessName', value: name }])} />
        </div>
      </Section>
      <Section
        label={t('conditions.window.title')}
        hint={regex && title && !validRegex(title)
          ? <span data-error="">{t('conditions.window.badRegex')}</span>
          : process || activate ? t('conditions.window.titleHint') : t('conditions.window.titleHintFill')}
      >
        <Segmented<'contains' | 'regex'>
          label={t('conditions.window.titleMode')}
          value={regex ? 'regex' : 'contains'}
          disabled={locked}
          options={[{ value: 'contains', label: t('conditions.match.contains') }, { value: 'regex', label: 'Regex', tip: t('conditions.match.regexTip') }]}
          onChange={(v) => edit([{ field: 'windowTitleMatchMode', value: v }])}
        />
        <div className="insp-line">
          <DraftField stepId={id} field="windowTitle" label={t('conditions.window.title')} kind="text" placeholder={regex ? t('conditions.window.regexPlaceholder') : t('conditions.window.titlePlaceholder')} stored={title} disabled={locked} />
          {title && <Clear label={t('conditions.window.clearTitle')} disabled={locked} onClear={() => edit([{ field: 'windowTitle', value: '' }])} />}
        </div>
      </Section>
      {anchor ? null : activate ? (
        // Above 1, "no window" means fewer than this many: the Launch path runs then (editor-passo-174).
        <Section label={t('conditions.window.matchIndex')} hint={nth > 1 ? t('conditions.window.matchIndexHintMore') : t('conditions.window.matchIndexHint')}>
          <DraftField stepId={id} field="windowMatchIndex" label={t('conditions.window.matchIndex')} kind="int" min={1} max={99} stored={String(nth)} disabled={locked} />
        </Section>
      ) : (
        <div className="insp-row">
          <span className="insp-row-label">{t('conditions.window.foreground')}</span>
          <Switch label={t('conditions.window.foreground')} tip={t('conditions.window.foregroundTip')} checked={!!step.windowMatchForegroundOnly} disabled={locked} onChange={(on) => edit([{ field: 'windowMatchForegroundOnly', value: String(on) }])} />
        </div>
      )}
      <div className="insp-pair">
        <button
          type="button"
          className="insp-button"
          data-armed={detecting ? '' : undefined}
          data-tip={detecting
            ? (activate ? t('conditions.window.detectingActTip') : t('conditions.window.detectingTip'))
            : t('conditions.window.detectTip')}
          disabled={locked}
          onClick={() => {
            if (detecting) { stopDetecting(); return; }
            const requestId = newRequestId();
            setDetecting(requestId);
            live.current.detecting = requestId;
            answerId.current = requestId;
            tools.detectWindow({ requestId, enabled: true });
          }}
        >
          <span className="step-icon" data-icon="crosshair" />
          {detecting ? t('conditions.window.detecting') : t('conditions.window.detect')}
        </button>
        {!anchor && (
          <button
            type="button"
            className="insp-button"
            disabled={locked || test.waiting || (!process.trim() && !title.trim())}
            onClick={() => {
              setResult(null);
              test.ask(requestId => tools.testWindow({
                requestId, processName: process, windowTitle: title, titleMatchMode: regex ? 'regex' : 'contains',
                foregroundOnly: !activate && !!step.windowMatchForegroundOnly, matchIndex: activate ? nth : 1,
              }));
            }}
          >
            <span className="step-icon" data-icon="play" />
            {test.waiting ? t('probe.testing') : t('common.actions.test')}
          </button>
        )}
      </div>
      {result && !test.waiting && (
        <ResultCard
          ok={result.found}
          title={result.found
            ? t('conditions.window.found', { window: [result.matchProcess, result.matchTitle].filter(Boolean).join(' · ') })
            : (result.error || t('conditions.window.notFound'))}
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
    <Section label={t('conditions.process.name')} hint={t('conditions.process.hint')}>
      <div className="insp-line">
        <DraftField stepId={step.id ?? ''} field="windowProcessName" label={t('conditions.process.name')} kind="mono" placeholder={t('conditions.process.placeholder')} stored={process} disabled={locked} parse={asTyped} />
        {process && <Clear label={t('conditions.window.clearProcess')} disabled={locked} onClear={() => edit([{ field: 'windowProcessName', value: '' }])} />}
        <ProcessPicker disabled={locked} onPick={(name) => edit([{ field: 'windowProcessName', value: name }])} />
      </div>
    </Section>
  );
}

/** File exists: a path, file or folder; tokens resolve when it runs (an automation's watcher resolves none). */
export function FileCheck({ step, locked }: Props) {
  const auto = useCheckTarget();
  return (
    <Section label={t('conditions.file.path')} hint={auto ? t('conditions.file.hint') : t('conditions.file.hintTokens')}>
      <DraftField stepId={step.id ?? ''} field="filePath" label={t('conditions.file.path')} kind="mono" placeholder={t('conditions.file.placeholder')} stored={step.filePath ?? ''} disabled={locked} parse={asTyped} />
    </Section>
  );
}

/**
 * Clipboard: the copied text against a pattern. An automation's ('changes', D17) fires when the
 * copied text changes, with what it must contain, or on any change.
 */
export function ClipboardCheck({ step, locked, changes = false }: Props & { changes?: boolean }) {
  const edit = useEdit(step);
  const type = step.clipboardPatternType === 'equals' || step.clipboardPatternType === 'regex' ? step.clipboardPatternType : 'contains';
  if (changes) {
    return (
      <Section label={t('conditions.clipboard.contains')} hint={t('conditions.clipboard.changesHint')}>
        <DraftField stepId={step.id ?? ''} field="clipboardPattern" label={t('conditions.clipboard.contains')} kind="mono" placeholder={t('conditions.clipboard.changesPlaceholder')} stored={step.clipboardPattern ?? ''} disabled={locked} parse={(s) => s} />
      </Section>
    );
  }
  return (
    <>
      <Section label={t('conditions.clipboard.matchType')}>
        <Segmented<'contains' | 'equals' | 'regex'>
          label={t('conditions.clipboard.matchTypeGroup')}
          value={type}
          disabled={locked}
          options={[{ value: 'contains', label: t('conditions.match.contains') }, { value: 'equals', label: t('conditions.match.equals') }, { value: 'regex', label: 'Regex' }]}
          onChange={(v) => edit([{ field: 'clipboardPatternType', value: v }])}
        />
      </Section>
      <Section label={t('conditions.clipboard.pattern')} hint={t('conditions.clipboard.patternHint')}>
        <DraftField stepId={step.id ?? ''} field="clipboardPattern" label={t('conditions.clipboard.pattern')} kind="mono" stored={step.clipboardPattern ?? ''} disabled={locked} parse={(s) => s} />
      </Section>
    </>
  );
}

type Operator = 'eq' | 'neq' | 'contains' | 'gt' | 'lt';
const OPERATOR_VALUES: Operator[] = ['eq', 'neq', 'contains', 'gt', 'lt'];
const OPERATORS: { value: Operator; label: string; tip: string }[] = [
  { value: 'eq', label: '=', tip: t('conditions.variable.eqTip') },
  { value: 'neq', label: '≠', tip: t('conditions.variable.neqTip') },
  { value: 'contains', label: t('conditions.variable.has'), tip: t('conditions.variable.hasTip') },
  { value: 'gt', label: '>', tip: t('conditions.variable.numbersTip') },
  { value: 'lt', label: '<', tip: t('conditions.variable.numbersTip') },
];

/** Variable: a variable of the run compared with a value. */
export function VariableCheck({ step, locked }: Props) {
  const edit = useEdit(step);
  const id = step.id ?? '';
  const op = OPERATOR_VALUES.find(v => v === step.conditionOperator) ?? 'eq';
  return (
    <>
      <Section label={t('conditions.variable.name')}>
        <DraftField stepId={id} field="key" label={t('conditions.variable.name')} kind="mono" placeholder={t('conditions.variable.namePlaceholder')} stored={step.key} disabled={locked} parse={asTyped} />
      </Section>
      <Section label={t('conditions.variable.operator')}>
        <Segmented label={t('conditions.variable.operatorGroup')} value={op} disabled={locked} options={OPERATORS} onChange={(v) => edit([{ field: 'conditionOperator', value: v }])} />
      </Section>
      <Section label={t('conditions.value')} hint={t('conditions.variable.valueHint')}>
        <DraftField stepId={id} field="conditionOperand" label={t('conditions.value')} kind="mono" stored={step.conditionOperand ?? ''} disabled={locked} parse={(s) => s} />
      </Section>
    </>
  );
}

/** Random: passes this often. */
export function RandomCheck({ step, locked }: Props) {
  const pct = step.randomPercent ?? 0;
  return (
    <>
      <Section label={t('conditions.random.chance')}>
        <DraftField stepId={step.id ?? ''} field="randomPercent" label={t('conditions.random.field')} kind="int" min={0} max={100} unit="%" stored={String(pct)} disabled={locked} />
      </Section>
      <p className="insp-summary" aria-live="polite" data-error={pct === 0 ? '' : undefined}>
        {pct === 0 ? t('conditions.random.never') : pct === 100 ? t('conditions.random.always') : t('conditions.random.passes', { pct: fmtNum(pct) })}
      </p>
    </>
  );
}

// The days of the week in the build's language (Intl, plan §3.4): the whole name for the button's
// name and its tip, the narrow form on it ("S M T W…", "D S T Q…"). Made when a Time condition is
// first drawn, not when this module loads: an Intl object is not free. Sunday first, as the mask
// counts them.
let weekdays: { name: string; letter: string }[] | undefined;
function weekDays() {
  if (!weekdays) {
    const long = new Intl.DateTimeFormat(LANG, { weekday: 'long', timeZone: 'UTC' });
    const narrow = new Intl.DateTimeFormat(LANG, { weekday: 'narrow', timeZone: 'UTC' });
    // 2023-01-01 was a Sunday. pt-BR writes the names in lower case ("segunda-feira"): a name alone
    // starts with a capital.
    weekdays = Array.from({ length: 7 }, (_, i) => {
      const at = Date.UTC(2023, 0, 1 + i);
      const name = long.format(at);
      return { name: name.charAt(0).toUpperCase() + name.slice(1), letter: narrow.format(at) };
    });
  }
  return weekdays;
}

/** Time: a time window (overnight works) on some days of the week, or every day. */
export function TimeCheck({ step, locked }: Props) {
  const edit = useEdit(step);
  const id = step.id ?? '';
  const days = step.daysOfWeek ?? 0;
  return (
    <>
      <div className="insp-pair">
        <Section label={t('conditions.time.from')}>
          <TimeField stepId={id} field="timeStart" label={t('conditions.time.from')} stored={step.timeStart ?? ''} disabled={locked} />
        </Section>
        <Section label={t('conditions.time.to')}>
          <TimeField stepId={id} field="timeEnd" label={t('conditions.time.to')} stored={step.timeEnd ?? ''} disabled={locked} />
        </Section>
      </div>
      <span className="insp-hint">{t('conditions.time.overnight')}</span>
      <Section label={t('conditions.time.days')} hint={t('conditions.time.daysHint')}>
        <div className="insp-days" role="group" aria-label={t('conditions.time.days')}>
          {weekDays().map((day, bit) => (
            <button
              key={bit}
              type="button"
              aria-pressed={(days & (1 << bit)) !== 0}
              aria-label={day.name}
              data-tip={day.name}
              disabled={locked}
              onClick={() => edit([{ field: 'daysOfWeek', value: String(days ^ (1 << bit)) }])}
            >
              {day.letter}
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
