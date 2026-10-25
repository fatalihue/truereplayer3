import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSteps } from '../../logic/useSteps';
import { getActionTypeColors } from '../../utils/displayUtils';
import { arrival } from '../list/selection';
import { checksFor, type Check, type ConditionType } from './checks';
import { drafts, focusList, type Draft } from './inspectorState';

type CheckDraftT = Extract<Draft, { kind: 'check' }>;
/** A direct insert that has not arrived in this long was refused: the draft goes. */
const ARRIVAL_MS = 2000;

/**
 * An If, a While or an Else If being made: the Check list, as the concept's If editor draws it.
 * A check of the screen (an image, a pixel, a region to read) is captured first — the engine's
 * overlay, where Esc makes nothing —; the others make the step at once, and its editor opens on it.
 */
export function CheckDraft({ draft, locked }: { draft: CheckDraftT; locked: boolean }) {
  const cmds = useSteps();
  const [picked, setPicked] = useState<ConditionType | null>(null);
  // The list takes the focus when it opens, wherever it was asked from (the catalog, the insert
  // row, + Add Else If): the check is chosen from the keyboard, and Esc there cancels.
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLButtonElement>('.insp-check:not(:disabled)')?.focus({ preventScroll: true });
  }, []);
  // The step lands and is selected (which ends the draft); if it never does, the draft goes anyway.
  useEffect(() => {
    if (!picked) return;
    const id = setTimeout(() => drafts.end(), ARRIVAL_MS);
    return () => clearTimeout(id);
  }, [picked]);

  const pick = (c: Check) => {
    arrival.expect(draft.at, draft.macro);
    if (draft.opener === 'ElseIf') cmds.addElseIfBranch({ ifRowIndex: draft.ifRowIndex ?? -1, conditionType: c.type });
    else if (draft.opener === 'While' && c.type !== 'Random') cmds.insertLoop({ conditionType: c.type, insertIndex: draft.at });
    else cmds.insertConditional({ conditionType: c.type, insertIndex: draft.at });
    focusList();
    if (c.capture) drafts.end();
    else setPicked(c.type);
  };

  // ↑ ↓ Home End move between the checks; Tab leaves the list.
  const onArrows = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.insp-check:not(:disabled)')];
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
    if (next === null || all.length === 0) return;
    e.preventDefault();
    all[(next + all.length) % all.length].focus();
  };

  const colors = getActionTypeColors(draft.opener);
  return (
    <div ref={listRef} className="insp-checks" role="group" aria-label="Checks" onKeyDown={onArrows}>
      {checksFor(draft.opener).map(c => (
        <button
          key={c.type}
          type="button"
          className="insp-check"
          aria-pressed={picked === c.type}
          disabled={locked || (picked !== null && picked !== c.type)}
          onClick={() => { if (!picked) pick(c); }}
        >
          <span className="insp-check-tile" style={{ background: colors.bg, color: colors.fg }}>
            <span className="step-icon" data-icon={c.icon} />
          </span>
          <span className="insp-check-text">
            <span className="insp-check-name">{c.name}</span>
            <span className="insp-check-desc">{picked === c.type ? 'Adding…' : c.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
