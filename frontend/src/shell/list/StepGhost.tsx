import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ActionItem } from '../../bridge/messageTypes';
import { getActionTypeColors } from '../../utils/displayUtils';
import { stepIcon, stepName } from './stepTypes';

const at = (x: number, y: number) => `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(1.5deg)`;

/**
 * The card that follows the pointer while steps are dragged: the step the pointer took, and "+N"
 * for the others. It moves itself, by transform once a frame, so the drag never redraws the list.
 */
export function StepGhost({ step, more, x, y }: { step: ActionItem; more: number; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    let px = x;
    let py = y;
    const move = (e: MouseEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (ref.current) ref.current.style.transform = at(px, py);
      });
    };
    window.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('mousemove', move);
      cancelAnimationFrame(frame);
    };
  }, [x, y]);
  const colors = getActionTypeColors(step.actionType);
  const icon = stepIcon(step.actionType);
  return createPortal(
    <div ref={ref} className="step-ghost-card" style={{ transform: at(x, y) }}>
      <span className="step-pill" style={{ background: colors.bg, color: colors.fg }}>
        {icon && <span className="step-icon" data-icon={icon} />}
        {stepName(step.actionType)}
      </span>
      {step.comment && <span className="step-ghost-note">{step.comment}</span>}
      {more > 0 && <span className="step-ghost-more">+{more}</span>}
    </div>,
    document.body,
  );
}
