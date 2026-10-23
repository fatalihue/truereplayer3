import { useEffect, useRef } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { useMacro } from '../logic/useMacro';
import { useSteps } from '../logic/useSteps';
import { useTt } from '../state/LanguageContext';
import { useToast } from '../state/ToastContext';
import { snapIndicesToBlocks } from '../utils/conditionalBlocks';
import { isModalDialogOpen } from '../utils/modalDialog';
import { insertPoint, selectedIndices } from './list/selection';
import { useShell } from './store';

// Inputs whose keys are not typing: a checkbox or a range is a control, and Ctrl+C there is ours.
const NOT_TYPING = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image']);
const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT') return !NOT_TYPING.has((el as HTMLInputElement).type);
  return el.tagName === 'TEXTAREA' || el.isContentEditable;
};

/**
 * The shell's own keys, and what they answer.
 *
 * Ctrl+S (casca-002): the macro saves itself as it goes, so Ctrl+S writes it at once and only says
 * "Saved" — a field being typed in sends what it holds first. A revert that went through says so
 * too; one the engine refused already did, in a toast of its own (alert:show).
 *
 * The step keys, outside a field: Ctrl+C copies the selected steps (casca-096, during a run too);
 * Ctrl+V pastes at the insertion point (casca-097); Alt+↑/↓ move the selection, whole blocks for
 * any marker it touches; Ctrl+Z and Ctrl+Y (or Ctrl+Shift+Z) undo and redo the macro's history.
 * Those that change the macro stand down during a run, in the Clicker, and behind a modal dialog.
 */
export function ShellKeys() {
  const macro = useMacro();
  const cmds = useSteps();
  const { subscribe } = useBridge();
  const { showToast } = useToast();
  const tt = useTt();
  // The macro Ctrl+S asked to save, until its profile:saved arrives.
  const asked = useRef<{ name: string; at: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((!e.ctrlKey && !e.altKey) || e.metaKey) return;
      const key = e.key.toLowerCase();
      const { app } = useShell.getState();
      if (e.ctrlKey && !e.altKey && key === 's') {
        e.preventDefault();
        if (e.repeat || !app.activeProfile) return;
        if (app.settings.useCursorClick) {
          showToast(tt('The Clicker is on — switch back to macros to save.', 'O Clicker está ligado — volte aos macros para salvar.'), 'error');
          return;
        }
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
        asked.current = { name: app.activeProfile, at: Date.now() };
        macro.save();
        return;
      }
      if (typing(e.target)) return;
      const steps = app.actions;
      if (e.ctrlKey && !e.altKey && !e.shiftKey && key === 'c') {
        const sel = selectedIndices(steps);
        if (sel.length === 0) return;
        e.preventDefault();
        cmds.copyInternal({ indices: sel });
        return;
      }
      if (app.status !== 'ready' || app.settings.useCursorClick || isModalDialogOpen()) return;
      if (e.ctrlKey && !e.altKey) {
        if (key === 'v' && !e.shiftKey) {
          e.preventDefault();
          cmds.paste({ insertIndex: insertPoint(steps) });
        } else if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          cmds.undo({});
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          cmds.redo({});
        }
        return;
      }
      if (e.altKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const sel = selectedIndices(steps);
        if (sel.length === 0) return;
        e.preventDefault();
        // The engine puts the rows back together at the target, counted on the list as it is.
        const rows = snapIndicesToBlocks(sel, steps);
        const first = rows[0];
        const last = rows[rows.length - 1];
        if (e.key === 'ArrowUp' && first > 0) cmds.reorder({ indices: rows, targetIndex: first - 1 });
        else if (e.key === 'ArrowDown' && last < steps.length - 1) cmds.reorder({ indices: rows, targetIndex: last + 2 });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [macro, cmds, showToast, tt]);

  useEffect(() => subscribe((message) => {
    if (message.type === 'profile:saved') {
      const wanted = asked.current;
      if (!wanted || wanted.name !== message.payload.name) return;
      asked.current = null;
      // An answer long after the key belongs to a later save, not to this one.
      if (Date.now() - wanted.at > 5000) return;
      if (message.payload.ok) showToast('Saved', 'success');
      // The engine speaks (alert:show) on the first failure of a run of them; after that, the
      // status bar says "Not saved" and this key is the one to answer.
      else if (useShell.getState().saved?.ok === false) showToast(`Not saved — ${message.payload.error ?? 'the file could not be written'}`, 'error');
    } else if (message.type === 'profile:reverted' && message.payload.ok) {
      showToast('Back to when you opened it', 'success');
    }
  }), [subscribe, showToast]);

  return null;
}
