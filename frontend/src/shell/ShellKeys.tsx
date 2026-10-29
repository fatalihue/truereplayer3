import { useEffect, useRef } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { useMacro } from '../logic/useMacro';
import { useSteps } from '../logic/useSteps';
import { useWindowSnap } from '../logic/useWindowSnap';
import { useTt } from '../state/LanguageContext';
import { useToast } from '../state/ToastContext';
import { isModalDialogOpen } from '../utils/modalDialog';
import { preload } from './lazyModule';
import { moveSteps } from './list/moves';
import { insertPoint, selectedIndices } from './list/selection';
import { loadPalette, palette, usePalette } from './palette/paletteState';
import { useShell } from './store';
import { useUi } from './ui';
import { useBandEdges } from './useShellBand';

// Inputs whose keys are not typing: a checkbox or a range is a control, and Ctrl+C there is ours.
const NOT_TYPING = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image']);
const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT') return !NOT_TYPING.has((el as HTMLInputElement).type);
  return el.tagName === 'TEXTAREA' || el.isContentEditable;
};
// The keys the run's keyboard lock and the scroll guard look at.
const GUARDED = new Set(['Tab', ' ', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
/** A control that does something with these keys itself: a button, a field, a widget with a role or a Tab stop. */
const interactive = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) return false;
  return !!el.closest('button, a[href], input, select, textarea, [role], [tabindex]');
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
 * Those that change the macro stand down during a run, in the Clicker, and behind a modal dialog;
 * the steps' own keys, on the Data Loop tab.
 */
export function ShellKeys() {
  const macro = useMacro();
  const cmds = useSteps();
  const { subscribe } = useBridge();
  const { showToast } = useToast();
  const tt = useTt();
  // The macro Ctrl+S asked to save, until its profile:saved arrives.
  const asked = useRef<{ name: string; at: number } | null>(null);
  // The window's edge sticks to where the layout changes (D27).
  useWindowSnap(useBandEdges());

  useEffect(() => {
    // casca-006: while recording or running, a key aimed at the game must not work the interface —
    // Tab, Space, Enter and the arrows go nowhere outside a text field, even on a focused control.
    // casca-007: outside a field and a control, Space, Enter and the arrows scroll and press nothing.
    const guard = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || !GUARDED.has(e.key) || typing(e.target)) return;
      const running = useShell.getState().app.status !== 'ready';
      if (running && e.key !== 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      } else if (!running && e.key !== 'Tab' && !interactive(e.target)) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', guard, true);
    return () => window.removeEventListener('keydown', guard, true);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((!e.ctrlKey && !e.altKey) || e.metaKey) return;
      const key = e.key.toLowerCase();
      const { app } = useShell.getState();
      // Ctrl+K (casca-001): from anywhere, a text field included, but not over a modal dialog —
      // except its own, which it closes.
      if (e.ctrlKey && !e.altKey && !e.shiftKey && key === 'k') {
        e.preventDefault();
        if (usePalette.getState().open) palette.close();
        else if (!isModalDialogOpen()) {
          void preload(loadPalette);
          palette.open();
        }
        return;
      }
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
      // On another page (Settings…) the macro is out of sight: its keys stand down, Ctrl+Z
      // included (Settings has no undo, as today's).
      if (useUi.getState().page !== 'macros') return;
      const steps = app.actions;
      // On the Data Loop tab the steps are out of sight: their keys stand down, and Ctrl+Z and
      // Ctrl+Y go on undoing the macro's history, the table's edits included.
      const table = useUi.getState().macroTab === 'data';
      if (table && !(e.ctrlKey && !e.altKey && (key === 'z' || key === 'y'))) return;
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
        moveSteps(steps, sel, e.key === 'ArrowUp' ? 'up' : 'down', cmds);
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
      if (message.payload.ok) showToast(tt('Saved', 'Salvo'), 'success');
      // The engine speaks (alert:show) on the first failure of a run of them; after that, the
      // status bar says "Not saved" and this key is the one to answer.
      else if (useShell.getState().saved?.ok === false) showToast(tt(`Not saved — ${message.payload.error ?? 'the file could not be written'}`, `Não salvo — ${message.payload.error ?? 'o arquivo não pôde ser gravado'}`), 'error');
    } else if (message.type === 'profile:reverted' && message.payload.ok) {
      showToast(tt('Back to when you opened it', 'De volta a quando você o abriu'), 'success');
    }
  }), [subscribe, showToast, tt]);

  return null;
}
