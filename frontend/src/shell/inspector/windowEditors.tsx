import { useEffect, useState } from 'react';
import type { ActionItem, ProfileEntry } from '../../bridge/messageTypes';
import { useEditorTools } from '../../logic/useEditorTools';
import { useMacro } from '../../logic/useMacro';
import { useSteps } from '../../logic/useSteps';
import { useLanguage, useTt } from '../../state/LanguageContext';
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
  const tt = useTt();
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
    if (!r.found) { setReadError(r.error || 'Could not read the window.'); return; }
    const arm = !position && !size ? [{ field: 'restorePosition', value: 'true' }, { field: 'restoreSize', value: 'true' }] : [];
    edit([
      { field: 'windowX', value: String(r.x) }, { field: 'windowY', value: String(r.y) },
      { field: 'windowWidth', value: String(r.width) }, { field: 'windowHeight', value: String(r.height) },
      ...arm,
    ]);
  }, 5000, () => setReadError('No answer from the app.'));
  // Browse…: the system's file picker; a file chosen becomes the path.
  const browse = useAsk('dialog:pickFileResult', (r) => {
    if (r.path) edit([{ field: 'launchPath', value: r.path }]);
  });

  const upTo = `${formatMs(timeout, language)} ms`;
  const then = `the run ${goesOn(step) ? 'goes on' : 'stops'}`;
  const placed = verb === 'maximize' ? ' and maximizes it'
    : verb !== 'activate' ? ''
    : position && size ? ' and places it' : position ? ' and moves it' : size ? ' and resizes it' : '';
  const summary = !matcher
    ? (waits && path ? `Opens ${path}, with no window to wait for.` : 'No window yet: fill in a process or a title.')
    : verb === 'minimize' ? 'Minimizes the window, when one matches. With none, nothing happens.'
    : verb === 'close' ? 'Closes the window, when one matches. With none, nothing happens.'
    : `Brings the window to the front${placed}${path ? `, opening ${path} when none matches` : ''}. Waits up to ${upTo}; if the window never shows, ${then}.`;

  return (
    <>
      <Section label="Action">
        <Segmented<Verb>
          label="Window action"
          value={verb}
          disabled={locked}
          options={[
            { value: 'activate', label: 'Activate', tip: tt('Brings it to the front, or opens it', 'Traz para a frente, ou abre') },
            { value: 'maximize', label: 'Maximize' },
            { value: 'minimize', label: 'Minimize', tip: tt('Only a window already open', 'Só uma janela já aberta') },
            { value: 'close', label: 'Close', tip: tt('Only a window already open', 'Só uma janela já aberta') },
          ]}
          onChange={(v) => edit([{ field: 'windowVerb', value: v === 'activate' ? '' : v }])}
        />
      </Section>
      <WindowCheck step={step} locked={locked} activate />
      {waits && (
        <>
          <Section label="Launch" hint="Opened only when no window matches.">
            <div className="insp-line">
              <DraftField stepId={id} field="launchPath" label="Path" kind="mono" placeholder="notepad.exe · https://… · C:\path\app.exe" stored={step.launchPath ?? ''} disabled={locked} parse={asTyped} />
              <button
                type="button"
                className="insp-button"
                disabled={locked || browse.waiting}
                data-tip={tt('Choose a program on the disk', 'Escolher um programa no disco')}
                onClick={() => browse.ask(requestId => tools.pickFile({ requestId, kind: 'executable' }))}
              >
                <span className="step-icon" data-icon="folder-open" />
                Browse…
              </button>
            </div>
          </Section>
          <Section label="Args">
            <DraftField stepId={id} field="launchArgs" label="Args" kind="mono" placeholder={path ? '' : 'Set a path first'} stored={step.launchArgs ?? ''} disabled={locked || !path} parse={asTyped} />
          </Section>
        </>
      )}
      {/* Maximize places the window itself; Minimize and Close do not place it. */}
      {verb === 'activate' && (
        <Section label="Placement">
          <button
            type="button"
            className="insp-button"
            disabled={locked || read.waiting || !matcher}
            data-tip={tt('Reads where the matching window is now, and its size', 'Lê onde a janela está agora, e o tamanho dela')}
            onClick={() => {
              setReadError(null);
              read.ask(requestId => tools.captureWindowGeometry({
                requestId, processName: step.windowProcessName ?? '', windowTitle: step.windowTitle ?? '', titleMatchMode: step.windowTitleMatchMode === 'regex' ? 'regex' : 'contains',
              }));
            }}
          >
            <span className="step-icon" data-icon="frame" />
            {read.waiting ? 'Reading…' : 'Read from window'}
          </button>
          {readError && !read.waiting && <ResultCard ok={false} title={readError} />}
          {/* Off, a pair keeps its numbers, dimmed: they come back with it. */}
          <div className="insp-row">
            <span className="insp-row-label">Position</span>
            <Switch label="Position" checked={position} disabled={locked} onChange={(on) => edit([{ field: 'restorePosition', value: String(on) }])} />
          </div>
          <div className="insp-pair">
            <DraftField stepId={id} field="windowX" label="Window X" kind="int" signed min={-COORD} max={COORD} prefix="X" stored={String(step.windowX ?? 0)} disabled={locked || !position} />
            <DraftField stepId={id} field="windowY" label="Window Y" kind="int" signed min={-COORD} max={COORD} prefix="Y" stored={String(step.windowY ?? 0)} disabled={locked || !position} />
          </div>
          <div className="insp-row">
            <span className="insp-row-label">Size</span>
            <Switch label="Size" checked={size} disabled={locked} onChange={(on) => edit([{ field: 'restoreSize', value: String(on) }])} />
          </div>
          <div className="insp-pair">
            <DraftField stepId={id} field="windowWidth" label="Window W" kind="int" min={0} max={COORD} prefix="W" stored={String(step.windowWidth ?? 0)} disabled={locked || !size} />
            <DraftField stepId={id} field="windowHeight" label="Window H" kind="int" min={0} max={COORD} prefix="H" stored={String(step.windowHeight ?? 0)} disabled={locked || !size} />
          </div>
        </Section>
      )}
      {waits && <WaitTiming step={step} locked={locked} timeout={timeout} label="Wait-for-window timeout in milliseconds" />}
      {targeted && <p className="insp-callout">Clicks still follow the macro’s Window target, not this window.</p>}
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
  const tt = useTt();
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
        label="Macro to run"
        hint={!entry ? <span data-error="">{called ? `“${called}” is not in the library: choose another.` : 'Choose the macro to run.'}</span>
          : entry.isDisabled ? `“${called}” is disabled: the run skips it.`
          : undefined}
      >
        <MacroPicker names={callable(profiles, open, called)} value={called || null} onPick={(name) => edit({ profileName: name })} disabled={locked} label="Macro to run" />
      </Section>
      <Section label="Repeat" aside="per call">
        <DraftField stepId={id} field="repeat" label="Repeat count" kind="int" min={1} max={999} unit="×" stored={String(repeat)} disabled={locked || overData} />
      </Section>
      <div className="insp-row">
        <span className="insp-row-label">Run once per data row</span>
        <Switch
          label="Run once per data row"
          tip={tt('Once per row of the called macro’s table. Overrides Repeat.', 'Uma vez por linha da tabela do macro chamado. Substitui o Repeat.')}
          checked={overData}
          disabled={locked}
          onChange={(on) => edit({ runOverData: on })}
        />
      </div>
      <button type="button" className="insp-button" disabled={locked || !entry} onClick={() => macro.open(called)}>
        <span className="step-icon" data-icon="square-arrow-out-up-right" />
        Open macro
      </button>
      <p className="insp-callout">Runs the called macro’s steps inline; its own loop and interval are ignored (use Repeat). Disabled macros are skipped; up to 5 levels deep.</p>
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
    const t = setTimeout(() => drafts.end(), ARRIVAL_MS);
    return () => clearTimeout(t);
  }, [picked]);
  const names = callable(profiles, draft.macro, '');
  if (names.length === 0) return <p className="insp-summary">No other macro to call. Create one first.</p>;
  return (
    <Section label="Macro to run" hint={picked ? 'Adding…' : '↑ ↓ choose, Enter takes it.'}>
      <MacroPicker
        names={names}
        value={picked}
        autoFocus
        disabled={locked || picked !== null}
        label="Macro to run"
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
