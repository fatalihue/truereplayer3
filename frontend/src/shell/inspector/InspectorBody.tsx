import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { useTt } from '../../state/LanguageContext';
import { getActionTypeColors, isCoordinateClick } from '../../utils/displayUtils';
import { preload, useLoaded } from '../lazyModule';
import { arrival, selection } from '../list/selection';
import { stepIcon, stepKey, stepName } from '../list/stepTypes';
import { NotBuilt } from '../NotBuilt';
import { useApp } from '../store';
import { collapseInspector, expandInspector, useUi } from '../ui';
import { BatchEditor } from './BatchEditor';
import { CaptureForContext, captureForStep } from './captureFor';
import { CheckDraft } from './CheckDraft';
import { openerType } from './checks';
import { ClickEditor } from './ClickEditor';
import { DraftField, Section } from './fields';
import {
  drafts, focusList, loadBrowserEditors, loadProbeEditors, loadReferenceCrop, loadSendTextEditor, loadSimpleEditors, loadTextExpanded,
  loadWindowEditors, takeFocusAsk, type Draft, type TextDraft,
} from './inspectorState';
import { InspectorSlotsContext } from './inspectorSlots';
import { DraftKeyEditor, KeyEditor, KeyHalfEditor } from './KeyEditor';
import { PauseEditor } from './PauseEditor';
import './editors.css';
import './editorIcons.css';

// Where a step has no delay of its own to edit here: the If family and the jump markers (the While
// keeps its settle), and the browser steps, whose delay is part of their own editor, by the Timeout.
const NO_DELAY_FIELD = new Set(['If', 'ElseIf', 'Else', 'EndIf', 'EndLoop', 'BreakLoop', 'ContinueLoop', 'ForEachRow']);
const MAX_DELAY_MS = 999_999_999;
const CONDITION_STEPS = new Set(['If', 'ElseIf', 'While', 'Assert']);
const WAIT_STEPS = new Set(['WaitImage', 'WaitPixelColor', 'WaitText']);
const SIMPLE_STEPS = new Set(['ScrollUp', 'ScrollDown', 'SetVariable', 'CopyToSlot']);
const WINDOW_STEPS = new Set(['ActivateWindow', 'RunProfile']);
// The markers of a block say where their settings live (editor-passo-059), and the loop's jumps,
// its rows and the two endings what they do (editor-passo-060): there is nothing else to set.
const MARKER_NOTES: Record<string, string> = {
  Else: 'The FALSE branch. Set the condition on the If step.',
  EndIf: 'Closes the block. Set the condition on the If step.',
  EndLoop: 'Closes the block. Set the loop on its opening step.',
  BreakLoop: 'Exits the innermost loop.',
  ContinueLoop: 'Jumps back to the innermost loop’s opening step.',
  ForEachRow: 'Runs its block once per row of the Data Loop table. {row:column} reads the current row.',
  Stop: 'Ends the whole run here, with no error.',
  Return: 'Ends this pass only — the remaining passes and data rows still run.',
};

/**
 * The Inspector with a selection, loaded with the first step (rule 6): the header, one step's
 * editor or the batch editor for several, and the footer — or, while a run, a recording or the
 * Clicker is on, the note that it is read-only. Each step's editor is keyed by the step, so its
 * fields start from that step and send what was typed when another one is selected. A step being
 * made (a draft) has its own view, with what it needs before it can exist.
 *
 * Expanded, a Send Text has a second column beside its fields (Split), and a reference image being
 * cropped takes the whole Inspector (the cropper's own chunk).
 */
export default function InspectorBody({ indices, locked, note, draft }: { indices: number[]; locked: boolean; note: string | null; draft: Draft | null }) {
  const steps = useApp(a => a.actions);
  const expandedOn = useUi(s => s.expanded);
  const crop = useUi(s => s.crop);
  // Enter on a step (or Edit in its menu) asked for the first field before this was drawn.
  useLayoutEffect(() => { takeFocusAsk(); });
  // The chunks of the Send Text editor and of the probes, once the Inspector is up and the page is
  // idle, when the macro has such a step to open: its first opening does not wait for them.
  const hasText = steps.some(s => s.actionType === 'SendText');
  const hasProbe = steps.some(s => WAIT_STEPS.has(s.actionType) || CONDITION_STEPS.has(s.actionType));
  const hasSimple = steps.some(s => SIMPLE_STEPS.has(s.actionType));
  const hasWindow = steps.some(s => WINDOW_STEPS.has(s.actionType));
  const hasBrowser = steps.some(s => s.actionType.startsWith('Browser'));
  useEffect(() => {
    if (!hasText && !hasProbe && !hasSimple && !hasWindow && !hasBrowser) return;
    const id = requestIdleCallback(() => {
      if (hasProbe) void preload(loadProbeEditors);
      if (hasText) void preload(loadSendTextEditor);
      if (hasSimple) void preload(loadSimpleEditors);
      if (hasWindow) void preload(loadWindowEditors);
      if (hasBrowser) void preload(loadBrowserEditors);
    });
    return () => cancelIdleCallback(id);
  }, [hasText, hasProbe, hasSimple, hasWindow, hasBrowser]);

  if (draft) return <DraftView draft={draft} steps={steps} locked={locked} note={note} expanded={expandedOn && draft.kind === 'text'} />;
  const one = indices.length === 1 ? steps[indices[0]] : null;
  if (one && !locked && crop !== null && one.id === crop) return <CropSlot step={one} index={indices[0]} count={steps.length} />;
  const text = one?.actionType === 'SendText';
  const expanded = expandedOn && text;
  return (
    <>
      {one ? <StepHeader step={one} index={indices[0]} count={steps.length} expandable={text} expanded={expanded} /> : <BatchHeader sel={indices} />}
      <Split expanded={expanded}>
        {one
          ? <StepEditor key={stepKey(one, indices[0])} step={one} index={indices[0]} steps={steps} locked={locked} />
          : <BatchEditor indices={indices} steps={steps} locked={locked} />}
      </Split>
      <Foot
        note={note}
        text={expanded ? WIDE_FOOT : one ? 'Applies as you type and saves on its own · Ctrl+Z undoes' : 'Each change is one undo step · Ctrl+Z undoes'}
      />
    </>
  );
}

const WIDE_FOOT = 'Applies as you type · Ctrl+Z undoes · drag the left edge to resize';

function Foot({ note, text }: { note: string | null; text: string }) {
  return <div className="insp-foot" data-locked={note ? '' : undefined}>{note ?? text}</div>;
}

/**
 * The editor's fields, and — expanded — the column beside them and the area over both, handed to
 * the editor (InspectorSlotsContext) to draw into. The fields keep their place either way, so
 * expanding never starts the editor again (the message keeps its caret and its Ctrl+Z).
 */
function Split({ expanded, children }: { expanded: boolean; children: ReactNode }) {
  const [split, setSplit] = useState<HTMLElement | null>(null);
  const [side, setSide] = useState<HTMLElement | null>(null);
  const slots = { side: expanded ? side : null, over: expanded ? split : null };
  return (
    <div className="insp-split" ref={setSplit} data-expanded={expanded || undefined}>
      <InspectorSlotsContext.Provider value={slots}>
        <div className="insp-body">{children}</div>
      </InspectorSlotsContext.Provider>
      {expanded && <div className="insp-side" ref={setSide} />}
    </div>
  );
}

/** Expand editor / Collapse editor: the expanded parts come in first, so the editor widens once. */
function ExpandButton({ expanded }: { expanded: boolean }) {
  const tt = useTt();
  const warm = () => { void preload(loadTextExpanded); };
  return (
    <button
      type="button"
      className="insp-close"
      data-on={expanded || undefined}
      aria-label={expanded ? 'Collapse editor' : 'Expand editor'}
      data-tip={expanded
        ? tt('Back to the narrow editor (Esc)', 'Voltar ao editor estreito (Esc)')
        : tt('Room for the tokens, the snippets, the emoji and a preview', 'Espaço para os tokens, os snippets, os emoji e uma prévia')}
      onPointerEnter={warm}
      onFocus={warm}
      onClick={() => {
        if (expanded) collapseInspector();
        else void preload(loadTextExpanded).then(expandInspector);
      }}
    >
      <span className="step-icon" data-icon={expanded ? 'minimize-2' : 'maximize-2'} />
    </button>
  );
}

/** Where a step being made goes, said in its header. */
function whereOf(at: number, count: number): string {
  return count === 0 ? 'the first step' : at < count ? `after step ${at}` : `at the end, after step ${count}`;
}

const DRAFT_TYPE: Record<string, string> = { key: 'Keystroke', text: 'SendText', macro: 'RunProfile' };

/**
 * A step being made: a Key waiting for its key, a Text for its first text — which then goes on as
 * the step it became, in the same editor —, an If, a While, an Else If, an Assert or a Wait until
 * for its check, and a Run Macro for the macro it runs. A Wait until becomes an Assert, and says it
 * is a wait until then. A Text can be made expanded, as a Send Text is edited.
 */
function DraftView({ draft, steps, locked, note, expanded }: { draft: Draft; steps: ActionItem[]; locked: boolean; note: string | null; expanded: boolean }) {
  const born = draft.kind === 'text' && draft.stepId ? steps.find(s => s.id === draft.stepId) ?? null : null;
  const index = born ? steps.indexOf(born) : -1;
  const type = draft.kind === 'check' ? openerType(draft.opener) : DRAFT_TYPE[draft.kind];
  const waitUntil = draft.kind === 'check' && draft.opener === 'WaitUntil';
  const foot = draft.kind === 'key' ? 'The step is added with its key · Esc cancels'
    : draft.kind === 'text' ? (born ? (expanded ? WIDE_FOOT : 'Applies as you type and saves on its own · Ctrl+Z undoes') : 'The step is added with its first text · Esc cancels while it is empty')
    : draft.kind === 'macro' ? 'Choose the macro it runs · Esc cancels'
    : waitUntil ? 'Choose what it waits for · Esc cancels'
    : 'Choose what it checks · Esc cancels';
  return (
    <>
      {born ? <StepHeader step={born} index={index} count={steps.length} expandable expanded={expanded} />
        : <DraftHeader type={type} where={whereOf(draft.at, steps.length)} name={waitUntil ? 'Wait until…' : undefined} icon={waitUntil ? 'clock' : undefined} expandable={draft.kind === 'text'} expanded={expanded} />}
      <Split expanded={expanded}>
        {draft.kind === 'key' && <DraftKeyEditor draft={draft} locked={locked} />}
        {draft.kind === 'text' && <TextEditorSlot key={draft.serial} step={born} draft={draft} locked={locked} />}
        {draft.kind === 'text' && born && <CommonFields step={born} locked={locked} />}
        {draft.kind === 'check' && <CheckDraft draft={draft} locked={locked} />}
        {draft.kind === 'macro' && <MacroDraftSlot key={draft.serial} draft={draft} locked={locked} />}
      </Split>
      <Foot note={note} text={foot} />
    </>
  );
}

/** The header of a step being made; a Wait until names itself and draws the catalog's clock. */
function DraftHeader({ type, where, name, icon = stepIcon(type), expandable = false, expanded = false }: {
  type: string;
  where: string;
  name?: string;
  icon?: string | null;
  expandable?: boolean;
  expanded?: boolean;
}) {
  const colors = getActionTypeColors(type);
  return (
    <div className="insp-head">
      <span className="insp-tile" style={{ background: colors.bg, color: colors.fg }}>
        {icon && <span className="step-icon" data-icon={icon} />}
      </span>
      <div className="insp-title">
        <span className="insp-name" data-display="">{name ?? stepName(type)}</span>
        <span className="insp-sub">New step · {where}{expanded ? ' · expanded' : ''}</span>
      </div>
      {expandable && <ExpandButton expanded={expanded} />}
      <button type="button" className="insp-close" aria-label="Cancel the new step" onClick={() => { drafts.end(); arrival.clear(); focusList(); }}>
        <span className="step-icon" data-icon="x" />
      </button>
    </div>
  );
}

function StepHeader({ step, index, count, expandable = false, expanded = false }: {
  step: ActionItem;
  index: number;
  count: number;
  /** A Send Text: Expand editor, beside Close editor. */
  expandable?: boolean;
  expanded?: boolean;
}) {
  const t = step.actionType;
  const colors = getActionTypeColors(t);
  const icon = stepIcon(t);
  // A half of a click or a key says which half it is (editor-passo-001).
  const half = t.endsWith('ClickDown') || t === 'KeyDown' ? ' · ↓ press'
    : t.endsWith('ClickUp') || t === 'KeyUp' ? ' · ↑ release'
    : '';
  return (
    <div className="insp-head">
      <span className="insp-tile" style={{ background: colors.bg, color: colors.fg }}>
        {icon && <span className="step-icon" data-icon={icon} />}
      </span>
      <div className="insp-title">
        <span className="insp-name" data-display="">{stepName(t)}</span>
        <span className="insp-sub">Step {index + 1} of {count}{half}{expanded ? ' · expanded' : ''}</span>
      </div>
      {expandable && <ExpandButton expanded={expanded} />}
      <button type="button" className="insp-close" aria-label="Close editor" onClick={() => { selection.clear(); focusList(); }}>
        <span className="step-icon" data-icon="x" />
      </button>
    </div>
  );
}

/** A reference image being cropped, from the cropper's chunk (it is usually in: the press on the
 *  image started it). The header holds until then. */
function CropSlot({ step, index, count }: { step: ActionItem; index: number; count: number }) {
  const mod = useLoaded(loadReferenceCrop);
  useEffect(() => {
    if (!mod) void preload(loadReferenceCrop);
  }, [mod]);
  return mod ? <mod.default step={step} index={index} count={count} /> : <div className="insp-head" />;
}

/** "Steps 2, 3, 7, 12 and 16", or the first four and how many more. */
function stepNumbers(sel: number[]): string {
  const n = sel.map(i => i + 1);
  if (n.length <= 5) return `Steps ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  return `Steps ${n.slice(0, 4).join(', ')} and ${n.length - 4} more`;
}

function BatchHeader({ sel }: { sel: number[] }) {
  return (
    <div className="insp-head">
      <span className="insp-tile" data-batch="">
        <span className="step-icon" data-icon="layers" />
      </span>
      <div className="insp-title">
        <span className="insp-name" data-display="">{sel.length} steps selected</span>
        <span className="insp-sub">{stepNumbers(sel)}</span>
      </div>
      <button type="button" className="insp-close" aria-label="Clear selection" onClick={() => { selection.clear(); focusList(); }}>
        <span className="step-icon" data-icon="x" />
      </button>
    </div>
  );
}

/** One step: its type's editor, then the Delay and the Notes every step has (editor-passo-190 and 191). */
function StepEditor({ step, index, steps, locked }: { step: ActionItem; index: number; steps: ActionItem[]; locked: boolean }) {
  const t = step.actionType;
  const editor = isCoordinateClick(t) ? <ClickEditor step={step} index={index} steps={steps} locked={locked} />
    : t === 'Keystroke' || t === 'HoldKey' ? <KeyEditor step={step} locked={locked} />
    : t === 'KeyDown' || t === 'KeyUp' ? <KeyHalfEditor step={step} locked={locked} />
    : t === 'Pause' ? <PauseEditor step={step} locked={locked} />
    : t === 'SendText' ? <TextEditorSlot step={step} draft={null} locked={locked} />
    : WAIT_STEPS.has(t) || CONDITION_STEPS.has(t) ? <ProbeSlot step={step} locked={locked} />
    : SIMPLE_STEPS.has(t) ? <SimpleSlot step={step} index={index} locked={locked} />
    : WINDOW_STEPS.has(t) ? <WindowSlot step={step} locked={locked} />
    : t.startsWith('Browser') ? <BrowserSlot step={step} locked={locked} />
    : MARKER_NOTES[t] ? <p className="insp-summary">{MARKER_NOTES[t]}</p>
    // The other types' editors come with phase 2.
    : <NotBuilt what={`${stepName(t)} editor`} />;
  return (
    <CaptureForContext.Provider value={captureForStep(index, step)}>
      {editor}
      <CommonFields step={step} locked={locked} />
    </CaptureForContext.Provider>
  );
}

function CommonFields({ step, locked }: { step: ActionItem; locked: boolean }) {
  const t = step.actionType;
  const id = step.id ?? '';
  const delay = !NO_DELAY_FIELD.has(t) && !t.startsWith('Browser');
  return (
    <div className="insp-pair insp-common">
      {delay && (
        <Section label="Delay">
          <DraftField stepId={id} field="delay" label="Delay in milliseconds" kind="int" min={0} max={MAX_DELAY_MS} unit="ms" stored={String(step.delay)} disabled={locked} />
        </Section>
      )}
      <Section label="Notes">
        <DraftField stepId={id} field="comment" label="Notes" kind="text" multiline placeholder="Add a note…" stored={step.comment ?? ''} disabled={locked} />
      </Section>
    </div>
  );
}

/**
 * The Send Text editor, from its own chunk (it brings the rich editor along): drawn as soon as the
 * chunk is in — usually already, loaded when the page was idle —, an empty frame for the moment
 * before that.
 */
function TextEditorSlot({ step, draft, locked }: { step: ActionItem | null; draft: TextDraft | null; locked: boolean }) {
  const mod = useLoaded(loadSendTextEditor);
  useEffect(() => {
    if (!mod) void preload(loadSendTextEditor);
  }, [mod]);
  const Editor = mod?.default;
  return Editor ? <Editor step={step} draft={draft} locked={locked} /> : <div className="insp-text-wait" />;
}

/** The three waits and the condition editor, from their chunk, the same way. */
function ProbeSlot({ step, locked }: { step: ActionItem; locked: boolean }) {
  const mod = useLoaded(loadProbeEditors);
  useEffect(() => {
    if (!mod) void preload(loadProbeEditors);
  }, [mod]);
  if (!mod) return null;
  const t = step.actionType;
  return t === 'WaitImage' ? <mod.WaitImageEditor step={step} locked={locked} />
    : t === 'WaitPixelColor' ? <mod.WaitPixelEditor step={step} locked={locked} />
    : t === 'WaitText' ? <mod.WaitTextEditor step={step} locked={locked} />
    : <mod.ConditionEditor step={step} locked={locked} />;
}

/** Scroll, Set Variable and Copy to Slot, from their chunk, the same way. */
function SimpleSlot({ step, index, locked }: { step: ActionItem; index: number; locked: boolean }) {
  const mod = useLoaded(loadSimpleEditors);
  useEffect(() => {
    if (!mod) void preload(loadSimpleEditors);
  }, [mod]);
  if (!mod) return null;
  const t = step.actionType;
  return t === 'SetVariable' ? <mod.SetVariableEditor step={step} index={index} locked={locked} />
    : t === 'CopyToSlot' ? <mod.CopyToSlotEditor step={step} locked={locked} />
    : <mod.ScrollEditor step={step} locked={locked} />;
}

/** Activate Window and Run Macro, from their chunk, the same way. */
function WindowSlot({ step, locked }: { step: ActionItem; locked: boolean }) {
  const mod = useLoaded(loadWindowEditors);
  useEffect(() => {
    if (!mod) void preload(loadWindowEditors);
  }, [mod]);
  if (!mod) return null;
  return step.actionType === 'RunProfile'
    ? <mod.RunMacroEditor step={step} locked={locked} />
    : <mod.ActivateWindowEditor step={step} locked={locked} />;
}

/** The browser steps, from their chunk, the same way. */
function BrowserSlot({ step, locked }: { step: ActionItem; locked: boolean }) {
  const mod = useLoaded(loadBrowserEditors);
  useEffect(() => {
    if (!mod) void preload(loadBrowserEditors);
  }, [mod]);
  return mod ? <mod.BrowserEditor step={step} locked={locked} /> : null;
}

/** The Run Macro being made, from the same chunk. */
function MacroDraftSlot({ draft, locked }: { draft: Extract<Draft, { kind: 'macro' }>; locked: boolean }) {
  const mod = useLoaded(loadWindowEditors);
  useEffect(() => {
    if (!mod) void preload(loadWindowEditors);
  }, [mod]);
  return mod ? <mod.RunMacroDraft draft={draft} locked={locked} /> : null;
}
