import { useEffect, useRef } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { useMacro } from '../logic/useMacro';
import { useTt } from '../state/LanguageContext';
import { useToast } from '../state/ToastContext';
import { useShell } from './store';

/**
 * The shell's own keys, and what they answer. Ctrl+S (casca-002): the macro saves itself as it
 * goes, so Ctrl+S writes it at once and only says "Saved" — a field being typed in sends what it
 * holds first. A revert that went through says so too; one the engine refused already did, in a
 * toast of its own (alert:show).
 */
export function ShellKeys() {
  const macro = useMacro();
  const { subscribe } = useBridge();
  const { showToast } = useToast();
  const tt = useTt();
  // The macro Ctrl+S asked to save, until its profile:saved arrives.
  const asked = useRef<{ name: string; at: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      if (e.repeat) return;
      const { app } = useShell.getState();
      if (!app.activeProfile) return;
      if (app.settings.useCursorClick) {
        showToast(tt('The Clicker is on — switch back to macros to save.', 'O Clicker está ligado — volte aos macros para salvar.'), 'error');
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) active.blur();
      asked.current = { name: app.activeProfile, at: Date.now() };
      macro.save();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [macro, showToast, tt]);

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
