import { NotBuilt } from './NotBuilt';
import { useApp } from './store';

/** ④ The open macro's header. Record ▾ and Replay ▾ (⑤) are slice 3 of phase 1. */
export function MacroHeader() {
  const open = useApp(a => a.activeProfile);
  const count = useApp(a => a.actions.length);
  if (!open) return null;
  return (
    <div className="shell-macro-header">
      <h1 className="shell-macro-title">{open}</h1>
      <span className="shell-macro-count">{count === 1 ? '1 step' : `${count} steps`}</span>
      <div className="shell-macro-transport">
        <NotBuilt what="Record ▾ / Replay ▾" />
      </div>
    </div>
  );
}
