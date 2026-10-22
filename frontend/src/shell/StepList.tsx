import type { ActionItem } from '../bridge/messageTypes';
import { getActionTypeColors } from '../utils/displayUtils';
import { stepName, stepSummary } from './steps';
import { useApp, useShell } from './store';

/**
 * ⑦ The steps of the open macro, read-only in slice 1: selection, keyboard, drag, the insertion
 * point and the context menu are slice 4. Each row is its own component and gets its step as a
 * prop, so with the store reconciling by id only the rows whose step changed re-render.
 */
export function StepList() {
  const steps = useApp(a => a.actions);
  const open = useApp(a => a.activeProfile);
  if (!open) return <p className="shell-steps-empty">Open a macro from the library.</p>;
  if (steps.length === 0) return <p className="shell-steps-empty">No steps yet.</p>;
  return (
    <ol className="shell-steps" aria-label="Steps">
      {steps.map((step, i) => <StepRow key={step.id ?? i} step={step} index={i} />)}
    </ol>
  );
}

function StepRow({ step, index }: { step: ActionItem; index: number }) {
  // The run's current step, read per row as a yes/no: a new highlight re-renders the two rows
  // whose answer changed, not the list.
  const running = useShell(s => s.highlight === index);
  const colors = getActionTypeColors(step.actionType);
  return (
    <li className="shell-step" data-running={running || undefined} data-skipped={step.isSkipped || undefined}>
      <span className="shell-step-num">{running ? '▶' : index + 1}</span>
      <span className="shell-step-type" style={{ background: colors.bg, color: colors.fg }}>{stepName(step.actionType)}</span>
      <span className="shell-step-what">{stepSummary(step)}</span>
      {/* Delay 0 stays blank (the concept). */}
      <span className="shell-step-delay">{step.delay ? `${step.delay} ms` : ''}</span>
      <span className="shell-step-note">{step.comment}</span>
    </li>
  );
}
