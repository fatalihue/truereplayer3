import { useLayoutEffect } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { getActionTypeColors, isCoordinateClick } from '../../utils/displayUtils';
import { arrival, selection } from '../list/selection';
import { stepIcon, stepKey, stepName } from '../list/stepTypes';
import { NotBuilt } from '../NotBuilt';
import { useApp } from '../store';
import { BatchEditor } from './BatchEditor';
import { ClickEditor } from './ClickEditor';
import { DraftField, Section } from './fields';
import { drafts, focusList, takeFocusAsk, type Draft } from './inspectorState';
import { DraftKeyEditor, KeyEditor, KeyHalfEditor } from './KeyEditor';
import { PauseEditor } from './PauseEditor';
import './editors.css';

// Where a step has no delay of its own to edit here: the If family and the jump markers (the While
// keeps its settle), and the browser steps, whose delay is part of their own editor (phase 2).
const NO_DELAY_FIELD = new Set(['If', 'ElseIf', 'Else', 'EndIf', 'EndLoop', 'BreakLoop', 'ContinueLoop', 'ForEachRow']);
const MAX_DELAY_MS = 999_999_999;

/**
 * The Inspector with a selection, loaded with the first step (rule 6): the header, one step's
 * editor or the batch editor for several, and the footer — or, while a run, a recording or the
 * Clicker is on, the note that it is read-only. Each step's editor is keyed by the step, so its
 * fields start from that step and send what was typed when another one is selected.
 */
export default function InspectorBody({ indices, locked, note, draft }: { indices: number[]; locked: boolean; note: string | null; draft: Draft | null }) {
  const steps = useApp(a => a.actions);
  // Enter on a step (or Edit in its menu) asked for the first field before this was drawn.
  useLayoutEffect(() => { takeFocusAsk(); });
  if (draft) {
    const where = steps.length === 0 ? 'the first step' : draft.at < steps.length ? `after step ${draft.at}` : `at the end, after step ${steps.length}`;
    const colors = getActionTypeColors('Keystroke');
    return (
      <>
        <div className="insp-head">
          <span className="insp-tile" style={{ background: colors.bg, color: colors.fg }}>
            <span className="step-icon" data-icon="keyboard" />
          </span>
          <div className="insp-title">
            <span className="insp-name" data-display="">Keystroke</span>
            <span className="insp-sub">New step · {where}</span>
          </div>
          <button type="button" className="insp-close" aria-label="Cancel the new step" onClick={() => { drafts.end(); arrival.clear(); focusList(); }}>
            <span className="step-icon" data-icon="x" />
          </button>
        </div>
        <div className="insp-body">
          <DraftKeyEditor draft={draft} locked={locked} />
        </div>
        <div className="insp-foot" data-locked={note ? '' : undefined}>{note ?? 'The step is added with its key · Esc cancels'}</div>
      </>
    );
  }
  const one = indices.length === 1 ? steps[indices[0]] : null;
  return (
    <>
      {one ? <StepHeader step={one} index={indices[0]} count={steps.length} /> : <BatchHeader sel={indices} />}
      <div className="insp-body">
        {one
          ? <StepEditor key={stepKey(one, indices[0])} step={one} index={indices[0]} steps={steps} locked={locked} />
          : <BatchEditor indices={indices} steps={steps} locked={locked} />}
      </div>
      <div className="insp-foot" data-locked={note ? '' : undefined}>
        {note ?? (one ? 'Applies as you type and saves on its own · Ctrl+Z undoes' : 'Each change is one undo step · Ctrl+Z undoes')}
      </div>
    </>
  );
}

function StepHeader({ step, index, count }: { step: ActionItem; index: number; count: number }) {
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
        <span className="insp-sub">Step {index + 1} of {count}{half}</span>
      </div>
      <button type="button" className="insp-close" aria-label="Close editor" onClick={() => { selection.clear(); focusList(); }}>
        <span className="step-icon" data-icon="x" />
      </button>
    </div>
  );
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
  const id = step.id ?? '';
  const editor = isCoordinateClick(t) ? <ClickEditor step={step} index={index} steps={steps} locked={locked} />
    : t === 'Keystroke' || t === 'HoldKey' ? <KeyEditor step={step} locked={locked} />
    : t === 'KeyDown' || t === 'KeyUp' ? <KeyHalfEditor step={step} locked={locked} />
    : t === 'Pause' ? <PauseEditor step={step} locked={locked} />
    // The other types' editors come with slice 7 (Text, Wait Image, If, Else If, While) and phase 2.
    : <NotBuilt what={`${stepName(t)} editor`} />;
  const delay = !NO_DELAY_FIELD.has(t) && !t.startsWith('Browser');
  return (
    <>
      {editor}
      <div className="insp-pair insp-common">
        {delay && (
          <Section label="Delay">
            <DraftField stepId={id} field="delay" label="Delay in milliseconds" kind="int" min={0} max={MAX_DELAY_MS} empty="min" unit="ms" stored={String(step.delay)} disabled={locked} />
          </Section>
        )}
        <Section label="Notes">
          <DraftField stepId={id} field="comment" label="Notes" kind="text" placeholder="Add a note…" stored={step.comment ?? ''} disabled={locked} />
        </Section>
      </div>
    </>
  );
}
