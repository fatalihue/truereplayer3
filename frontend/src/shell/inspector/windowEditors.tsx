import { useEffect, useState } from 'react';
import type { ActionItem, ProfileEntry } from '../../bridge/messageTypes';
import { t, tn } from '../../i18n';
import { useEditorTools } from '../../logic/useEditorTools';
import { useMacro } from '../../logic/useMacro';
import { useSteps } from '../../logic/useSteps';
import { useLanguage } from '../../state/LanguageContext';
import { formatMs } from '../../utils/displayUtils';
import { arrival } from '../list/selection';
import { useApp, useShell } from '../store';
import { DraftField, Section, Segmented, Switch } from './fields';
import { applyEdits, drafts, focusList, type Draft, type StepEdit } from './inspectorState';
import { MacroPicker } from './MacroPicker';
import { ResultCard } from './probeKit';
import { useAsk } from './probes';
import { WindowCheck } from './stateChecks';
import { goesOn, waitTimeout, WaitTiming } from './WaitTiming';
import './windowEditors.css';

// The editors of the steps that act on windows and on other macros — Activate Window and Run Macro,
// with the Run Macro being made — in a chunk of their own (rule 6).

type Verb = 'activate' | 'maximize' | 'minimize' | 'close';
// What the engine waits for the window with no timeout of its own (ActionExecution, ExecuteActivateWindow).
const DEFAULT_TIMEOUT_MS = 10000;
const COORD = 2_000_000;
// A text whose empty is a real value (it clears the field): every typed text goes as it is.
const asTyped = (text: string) => text.trim();

/** What Activate or Maximize does to the window, besides bringing it to the front. */
type Placed = 'plain' | 'maximize' | 'place' | 'move' | 'resize';
const FRONT = tn('editors.window.summary.front');
/** The first sentence of the summary with a program to open when no window matches: one per case. */
function frontOpening(placed: Placed, path: string): string {
  switch (placed) {
    case 'maximize': return t('editors.window.summary.frontOpening.maximize', { path });
    case 'place': return t('editors.window.summary.frontOpening.place', { path });
    case 'move': return t('editors.window.summary.frontOpening.move', { path });
    case 'resize': return t('editors.window.summary.frontOpening.resize', { path });
    default: return t('editors.window.summary.frontOpening.plain', { path });
  }
}

/**
 * ⑧ Activate Window (editor-passo-170 to 189): what to do with the window — bring it to the front,
 * maximize, minimize or close it —, which window (the If's window fields, with which match it is,
 * front to back), what to open when none matches and where to put it (Activate only), how long to
 * wait for it and what a timeout does (Activate and Maximize: Minimize and Close act on a window
 * already open, or do nothing). The summary says it in one sentence (D13).
 */
export function ActivateWindowEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const tools = useEditorTools();
  const { language } = useLanguage();
  const id = step.id ?? '';
  const edit = (edits: StepEdit[]) => applyEdits(cmds, id, edits);
  const verb: Verb = step.windowVerb === 'maximize' || step.windowVerb === 'minimize' || step.windowVerb === 'close' ? step.windowVerb : 'activate';
  const waits = verb === 'activate' || verb === 'maximize';
  const matcher = !!(step.windowProcessName ?? '').trim() || !!(step.windowTitle ?? '').trim();
  const path = (step.launchPath ?? '').trim();
  const timeout = waitTimeout(step, DEFAULT_TIMEOUT_MS);
  const position = !!step.restorePosition;
  const size = !!step.restoreSize;
  // Clicks keep following the macro's own target, not the window this step brings up.
  const targeted = useApp(a => a.profiles.find(p => p.name === a.activeProfile)?.hasEffectiveTarget ?? false);

  // Read from window: the four numbers in one edit, one Ctrl+Z. With neither Position nor Size on,
  // both turn on: a read that nothing applies would look like nothing happened.
  const [readError, setReadError] = useState<string | null>(null);
  const read = useAsk('window:captureGeometryResult', (r) => {
    if (!r.found) { setReadError(r.error || t('editors.window.readFailed')); return; }
    const arm = !position && !size ? [{ field: 'restorePosition', value: 'true' }, { field: 'restoreSize', value: 'true' }] : [];
    edit([
      { field: 'windowX', value: String(r.x) }, { field: 'windowY', value: String(r.y) },
      { field: 'windowWidth', value: String(r.width) }, { field: 'windowHeight', value: String(r.height) },
      ...arm,
    ]);
  }, 5000, () => setReadError(t('editors.window.noAnswer')));
  // Browse…: the system's file picker; a file chosen becomes the path.
  const browse = useAsk('dialog:pickFileResult', (r) => {
    if (r.path) edit([{ field: 'launchPath', value: r.path }]);
  });

  const upTo = formatMs(timeout, language);
  const placed: Placed = verb === 'maximize' ? 'maximize'
    : verb !== 'activate' ? 'plain'
    : position && size ? 'place' : position ? 'move' : size ? 'resize' : 'plain';
  const summary = !matcher
    ? (waits && path ? t('editors.window.summary.opens', { path }) : t('editors.window.summary.noWindow'))
    : verb === 'minimize' ? t('editors.window.summary.minimize')
    : verb === 'close' ? t('editors.window.summary.close')
    // Two sentences: what happens to the window, then what a timeout does.
    : `${path ? frontOpening(placed, path) : FRONT[placed]} ${goesOn(step)
      ? t('editors.window.summary.waitsGoesOn', { ms: upTo })
      : t('editors.window.summary.waitsStops', { ms: upTo })}`;

  return (
    <>
      <Section label={t('editors.action')}>
        <Segmented<Verb>
          label={t('editors.window.actionField')}
          value={verb}
          disabled={locked}
          options={[
            { value: 'activate', label: t('editors.window.activate'), tip: t('editors.window.activateTip') },
            { value: 'maximize', label: t('editors.window.maximize') },
            { value: 'minimize', label: t('editors.window.minimize'), tip: t('editors.window.openOnlyTip') },
            { value: 'close', label: t('editors.window.close'), tip: t('editors.window.openOnlyTip') },
          ]}
          onChange={(v) => edit([{ field: 'windowVerb', value: v === 'activate' ? '' : v }])}
        />
      </Section>
      <WindowCheck step={step} locked={locked} activate />
      {waits && (
        <>
          <Section label={t('editors.window.launch')} hint={t('editors.window.launchHint')}>
            <div className="insp-line">
              <DraftField stepId={id} field="launchPath" label={t('editors.window.path')} kind="mono" placeholder={t('editors.window.pathPlaceholder')} stored={step.launchPath ?? ''} disabled={locked} parse={asTyped} />
              <button
                type="button"
                className="insp-button"
                disabled={locked || browse.waiting}
                data-tip={t('editors.window.browseTip')}
                onClick={() => browse.ask(requestId => tools.pickFile({ requestId, kind: 'executable' }))}
              >
                <span className="step-icon" data-icon="folder-open" />
                {t('editors.window.browse')}
              </button>
            </div>
          </Section>
          <Section label={t('editors.window.args')}>
            <DraftField stepId={id} field="launchArgs" label={t('editors.window.args')} kind="mono" placeholder={path ? '' : t('editors.window.argsPlaceholder')} stored={step.launchArgs ?? ''} disabled={locked || !path} parse={asTyped} />
          </Section>
        </>
      )}
      {/* Maximize places the window itself; Minimize and Close do not place it. */}
      {verb === 'activate' && (
        <Section label={t('editors.window.placement')}>
          <button
            type="button"
            className="insp-button"
            disabled={locked || read.waiting || !matcher}
            data-tip={t('editors.window.readTip')}
            onClick={() => {
              setReadError(null);
              read.ask(requestId => tools.captureWindowGeometry({
                requestId, processName: step.windowProcessName ?? '', windowTitle: step.windowTitle ?? '', titleMatchMode: step.windowTitleMatchMode === 'regex' ? 'regex' : 'contains',
              }));
            }}
          >
            <span className="step-icon" data-icon="frame" />
            {read.waiting ? t('editors.window.reading') : t('editors.window.read')}
          </button>
          {readError && !read.waiting && <ResultCard ok={false} title={readError} />}
          {/* Off, a pair keeps its numbers, dimmed: they come back with it. */}
          <div className="insp-row">
            <span className="insp-row-label">{t('editors.window.position')}</span>
            <Switch label={t('editors.window.position')} checked={position} disabled={locked} onChange={(on) => edit([{ field: 'restorePosition', value: String(on) }])} />
          </div>
          <div className="insp-pair">
            <DraftField stepId={id} field="windowX" label={t('editors.window.x')} kind="int" signed min={-COORD} max={COORD} prefix="X" stored={String(step.windowX ?? 0)} disabled={locked || !position} />
            <DraftField stepId={id} field="windowY" label={t('editors.window.y')} kind="int" signed min={-COORD} max={COORD} prefix="Y" stored={String(step.windowY ?? 0)} disabled={locked || !position} />
          </div>
          <div className="insp-row">
            <span className="insp-row-label">{t('editors.window.size')}</span>
            <Switch label={t('editors.window.size')} checked={size} disabled={locked} onChange={(on) => edit([{ field: 'restoreSize', value: String(on) }])} />
          </div>
          <div className="insp-pair">
            <DraftField stepId={id} field="windowWidth" label={t('editors.window.w')} kind="int" min={0} max={COORD} prefix={t('editors.window.prefixW')} stored={String(step.windowWidth ?? 0)} disabled={locked || !size} />
            <DraftField stepId={id} field="windowHeight" label={t('editors.window.h')} kind="int" min={0} max={COORD} prefix={t('editors.window.prefixH')} stored={String(step.windowHeight ?? 0)} disabled={locked || !size} />
          </div>
        </Section>
      )}
      {waits && <WaitTiming step={step} locked={locked} timeout={timeout} label={t('editors.window.timeoutField')} />}
      {targeted && <p className="insp-callout">{t('editors.window.targetNote')}</p>}
      <p className="insp-summary" aria-live="polite">{summary}</p>
    </>
  );
}

/** The macros a Run Macro can call: not the one it is in, and not a disabled one — unless it is the one it calls now. */
const callable = (profiles: ProfileEntry[], open: string | null, called: string) =>
  profiles.filter(p => p.name !== open && (!p.isDisabled || p.name === called)).map(p => p.name);

/**
 * ⑧ Run Macro (dialogos-067 to 073, lista-053): the macro it runs, chosen from a search; how many
 * times per call, or once per row of the called macro's Data Loop table; and Open macro, which opens
 * the called one (lista-074). Each change applies at once, one Ctrl+Z.
 */
export function RunMacroEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const macro = useMacro();
  const id = step.id ?? '';
  const open = useApp(a => a.activeProfile);
  const profiles = useApp(a => a.profiles);
  const called = step.key ?? '';
  const entry = profiles.find(p => p.name === called);
  const overData = !!step.runOverData;
  const repeat = Math.max(1, step.repeatCount ?? 1);
  // The engine's door for the call itself (actions:editRunProfile), with only what changed: a second
  // change sent before the first one's echo must not carry the old value back.
  const edit = (patch: { profileName?: string; runOverData?: boolean }) => {
    const index = useShell.getState().app.actions.findIndex(s => s.id === id);
    if (index >= 0) cmds.editRunProfile({ index, id, ...patch });
  };

  return (
    <>
      <Section
        label={t('editors.runMacro.macro')}
        hint={!entry ? <span data-error="">{called ? t('editors.runMacro.notInLibrary', { name: called }) : t('editors.runMacro.choose')}</span>
          : entry.isDisabled ? t('editors.runMacro.disabled', { name: called })
          : undefined}
      >
        <MacroPicker names={callable(profiles, open, called)} value={called || null} onPick={(name) => edit({ profileName: name })} disabled={locked} label={t('editors.runMacro.macro')} />
      </Section>
      <Section label={t('editors.repeat')} aside={t('editors.runMacro.perCall')}>
        <DraftField stepId={id} field="repeat" label={t('editors.runMacro.repeatField')} kind="int" min={1} max={999} unit="×" stored={String(repeat)} disabled={locked || overData} />
      </Section>
      <div className="insp-row">
        <span className="insp-row-label">{t('editors.runMacro.perRow')}</span>
        <Switch
          label={t('editors.runMacro.perRow')}
          tip={t('editors.runMacro.perRowTip')}
          checked={overData}
          disabled={locked}
          onChange={(on) => edit({ runOverData: on })}
        />
      </div>
      <button type="button" className="insp-button" disabled={locked || !entry} onClick={() => macro.open(called)}>
        <span className="step-icon" data-icon="square-arrow-out-up-right" />
        {t('list.menu.openMacro')}
      </button>
      <p className="insp-callout">{t('editors.runMacro.note')}</p>
    </>
  );
}

type MacroDraft = Extract<Draft, { kind: 'macro' }>;
/** A call that has not arrived in this long was refused: the draft goes. */
const ARRIVAL_MS = 2000;

/**
 * A Run Macro being made: the engine keeps none without its macro, so the search comes first, with
 * the focus; the macro picked makes the step at once, where it was asked for, and its editor opens
 * on it. Esc cancels (the Inspector's).
 */
export function RunMacroDraft({ draft, locked }: { draft: MacroDraft; locked: boolean }) {
  const cmds = useSteps();
  const profiles = useApp(a => a.profiles);
  const [picked, setPicked] = useState<string | null>(null);
  // The step lands and is selected (which ends the draft); if it never does, the draft goes anyway.
  useEffect(() => {
    if (!picked) return;
    const timer = setTimeout(() => drafts.end(), ARRIVAL_MS);
    return () => clearTimeout(timer);
  }, [picked]);
  const names = callable(profiles, draft.macro, '');
  if (names.length === 0) return <p className="insp-summary">{t('editors.runMacro.noOther')}</p>;
  return (
    <Section label={t('editors.runMacro.macro')} hint={picked ? t('editors.runMacro.adding') : t('editors.runMacro.keysHint')}>
      <MacroPicker
        names={names}
        value={picked}
        autoFocus
        disabled={locked || picked !== null}
        label={t('editors.runMacro.macro')}
        onPick={(name) => {
          arrival.expect(draft.at, draft.macro);
          cmds.addRunProfile({ profileName: name, repeatCount: 1, insertIndex: draft.at });
          setPicked(name);
          focusList();
        }}
      />
    </Section>
  );
}
