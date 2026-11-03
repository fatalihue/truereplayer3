import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { fmtNum, t, tn } from '../../i18n';
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

// Where a step has no delay of its own to edit: the If family and the jump markers (the While keeps
// its settle).
const NO_DELAY_FIELD = new Set(['If', 'ElseIf', 'Else', 'EndIf', 'EndLoop', 'BreakLoop', 'ContinueLoop', 'ForEachRow']);
const MAX_DELAY_MS = 999_999_999;
const CONDITION_STEPS = new Set(['If', 'ElseIf', 'While', 'Assert']);
const WAIT_STEPS = new Set(['WaitImage', 'WaitPixelColor', 'WaitText']);
const SIMPLE_STEPS = new Set(['ScrollUp', 'ScrollDown', 'SetVariable', 'CopyToSlot']);
const WINDOW_STEPS = new Set(['ActivateWindow', 'RunProfile']);
// The markers of a block say where their settings live (editor-passo-059), and the loop's jumps,
// its rows and the two endings what they do (editor-passo-060): there is nothing else to set.
const MARKER_NOTES: Readonly<Record<string, string | undefined>> = tn('inspector.markers');

/**
 * The Inspector with a selection, loaded with the first step (rule 6): the header, the step's Delay
 * under it, one step's editor or the batch editor for several, and the footer — or, while a run, a recording or the
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
      {one && <DelayStrip key={stepKey(one, indices[0])} step={one} locked={locked} />}
      <Split expanded={expanded}>
        {one
          ? <StepEditor key={stepKey(one, indices[0])} step={one} index={indices[0]} steps={steps} locked={locked} />
          : <BatchEditor indices={indices} steps={steps} locked={locked} />}
      </Split>
      <Foot
        note={note}
        text={expanded ? t('inspector.foot.wide') : one ? t('inspector.foot.applies') : t('inspector.foot.batch')}
      />
    </>
  );
}

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
  const warm = () => { void preload(loadTextExpanded); };
  return (
    <button
      type="button"
      className="insp-close"
      data-on={expanded || undefined}
      aria-label={expanded ? t('inspector.head.collapse') : t('inspector.head.expand')}
      data-tip={expanded ? t('inspector.head.collapseTip') : t('inspector.head.expandTip')}
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
  return count === 0 ? t('inspector.head.newFirst')
    : at < count ? t('inspector.head.newAfter', { number: at })
    : t('inspector.head.newAtEnd', { number: count });
}

/** A header's second line: its parts joined by " · " (where it is, which half, expanded). */
const subLine = (...parts: (string | false)[]) => parts.filter(Boolean).join(' · ');

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
  const foot = draft.kind === 'key' ? t('inspector.foot.draftKey')
    : draft.kind === 'text' ? (born ? (expanded ? t('inspector.foot.wide') : t('inspector.foot.applies')) : t('inspector.foot.draftText'))
    : draft.kind === 'macro' ? t('inspector.foot.draftMacro')
    : waitUntil ? t('inspector.foot.draftWait')
    : t('inspector.foot.draftCheck');
  return (
    <>
      {born ? <StepHeader step={born} index={index} count={steps.length} expandable expanded={expanded} />
        : <DraftHeader type={type} where={whereOf(draft.at, steps.length)} name={waitUntil ? 'Wait until…' : undefined} icon={waitUntil ? 'clock' : undefined} expandable={draft.kind === 'text'} expanded={expanded} />}
      {born && <DelayStrip key={stepKey(born, index)} step={born} locked={locked} />}
      <Split expanded={expanded}>
        {draft.kind === 'key' && <DraftKeyEditor draft={draft} locked={locked} />}
        {draft.kind === 'text' && <TextEditorSlot key={draft.serial} step={born} draft={draft} locked={locked} />}
        {draft.kind === 'text' && born && <NotesField step={born} locked={locked} />}
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
        <span className="insp-name" data-display="" data-glossary="">{name ?? stepName(type)}</span>
        <span className="insp-sub">{subLine(where, expanded && t('inspector.head.expanded'))}</span>
      </div>
      {expandable && <ExpandButton expanded={expanded} />}
      <button type="button" className="insp-close" aria-label={t('inspector.head.cancelNew')} onClick={() => { drafts.end(); arrival.clear(); focusList(); }}>
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
  const type = step.actionType;
  const colors = getActionTypeColors(type);
  const icon = stepIcon(type);
  // A half of a click or a key says which half it is (editor-passo-001).
  const half = type.endsWith('ClickDown') || type === 'KeyDown' ? t('inspector.head.press')
    : type.endsWith('ClickUp') || type === 'KeyUp' ? t('inspector.head.release')
    : false;
  return (
    <div className="insp-head">
      <span className="insp-tile" style={{ background: colors.bg, color: colors.fg }}>
        {icon && <span className="step-icon" data-icon={icon} />}
      </span>
      <div className="insp-title">
        <span className="insp-name" data-display="" data-glossary="">{stepName(type)}</span>
        <span className="insp-sub">{subLine(t('inspector.head.stepOf', { number: index + 1, total: count }), half, expanded && t('inspector.head.expanded'))}</span>
      </div>
      {expandable && <ExpandButton expanded={expanded} />}
      <button type="button" className="insp-close" aria-label={t('inspector.head.close')} onClick={() => { selection.clear(); focusList(); }}>
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
  if (n.length <= 5) return t('inspector.batch.numbers', { list: n.slice(0, -1).join(', '), last: n[n.length - 1] });
  return t('inspector.batch.numbersMore', { list: n.slice(0, 4).join(', '), n: fmtNum(n.length - 4) });
}

function BatchHeader({ sel }: { sel: number[] }) {
  return (
    <div className="insp-head">
      <span className="insp-tile" data-batch="">
        <span className="step-icon" data-icon="layers" />
      </span>
      <div className="insp-title">
        <span className="insp-name" data-display="">{t('inspector.batch.selected', { count: sel.length, n: fmtNum(sel.length) })}</span>
        <span className="insp-sub">{stepNumbers(sel)}</span>
      </div>
      <button type="button" className="insp-close" aria-label={t('inspector.head.clearSelection')} onClick={() => { selection.clear(); focusList(); }}>
        <span className="step-icon" data-icon="x" />
      </button>
    </div>
  );
}

/** One step: its type's editor, then the Notes every step has (editor-passo-191). Its Delay is in the strip over it (DelayStrip). */
function StepEditor({ step, index, steps, locked }: { step: ActionItem; index: number; steps: ActionItem[]; locked: boolean }) {
  const type = step.actionType;
  const marker = MARKER_NOTES[type];
  const editor = isCoordinateClick(type) ? <ClickEditor step={step} index={index} steps={steps} locked={locked} />
    : type === 'Keystroke' || type === 'HoldKey' ? <KeyEditor step={step} locked={locked} />
    : type === 'KeyDown' || type === 'KeyUp' ? <KeyHalfEditor step={step} locked={locked} />
    : type === 'Pause' ? <PauseEditor step={step} locked={locked} />
    : type === 'SendText' ? <TextEditorSlot step={step} draft={null} locked={locked} />
    : WAIT_STEPS.has(type) || CONDITION_STEPS.has(type) ? <ProbeSlot step={step} locked={locked} />
    : SIMPLE_STEPS.has(type) ? <SimpleSlot step={step} index={index} locked={locked} />
    : WINDOW_STEPS.has(type) ? <WindowSlot step={step} locked={locked} />
    : type.startsWith('Browser') ? <BrowserSlot step={step} locked={locked} />
    : marker ? <p className="insp-summary">{marker}</p>
    // The other types' editors come with phase 2.
    : <NotBuilt what={t('inspector.notBuilt', { name: stepName(type) })} />;
  return (
    <CaptureForContext.Provider value={captureForStep(index, step)}>
      {editor}
      <NotesField step={step} locked={locked} />
    </CaptureForContext.Provider>
  );
}

/**
 * The step's Delay (editor-passo-190, the wait after the step), in a strip under its header that
 * does not scroll (D29): the same place for every step that has one, whatever the length of its
 * editor and the height of the window. Keyed by the step, like the editor: what was typed goes to
 * the engine when another step is selected.
 */
function DelayStrip({ step, locked }: { step: ActionItem; locked: boolean }) {
  if (NO_DELAY_FIELD.has(step.actionType)) return null;
  return (
    <div className="insp-delay">
      <span className="insp-label">{t('inspector.delay')}</span>
      <DraftField stepId={step.id ?? ''} field="delay" label={t('inspector.delayField')} kind="int" min={0} max={MAX_DELAY_MS} unit="ms" stored={String(step.delay)} disabled={locked} />
    </div>
  );
}

function NotesField({ step, locked }: { step: ActionItem; locked: boolean }) {
  return (
    <Section label={t('inspector.notes')}>
      <DraftField stepId={step.id ?? ''} field="comment" label={t('inspector.notes')} kind="text" multiline placeholder={t('inspector.addNote')} stored={step.comment ?? ''} disabled={locked} />
    </Section>
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
  const type = step.actionType;
  return type === 'WaitImage' ? <mod.WaitImageEditor step={step} locked={locked} />
    : type === 'WaitPixelColor' ? <mod.WaitPixelEditor step={step} locked={locked} />
    : type === 'WaitText' ? <mod.WaitTextEditor step={step} locked={locked} />
    : <mod.ConditionEditor step={step} locked={locked} />;
}

/** Scroll, Set Variable and Copy to Slot, from their chunk, the same way. */
function SimpleSlot({ step, index, locked }: { step: ActionItem; index: number; locked: boolean }) {
  const mod = useLoaded(loadSimpleEditors);
  useEffect(() => {
    if (!mod) void preload(loadSimpleEditors);
  }, [mod]);
  if (!mod) return null;
  const type = step.actionType;
  return type === 'SetVariable' ? <mod.SetVariableEditor step={step} index={index} locked={locked} />
    : type === 'CopyToSlot' ? <mod.CopyToSlotEditor step={step} locked={locked} />
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
