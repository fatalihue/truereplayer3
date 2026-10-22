import { useTt } from '../state/LanguageContext';
import { NotBuilt } from './NotBuilt';
import { useShell } from './store';

/**
 * ⑩ The status bar. The master switches (Shortcuts, Automations, Key Remaps) are slice 8 of phase 1;
 * slice 1 shows whether the open macro is on disk, from profile:saved.
 */
export function StatusBar() {
  const saved = useShell(s => s.saved);
  const tt = useTt();
  return (
    <footer className="shell-statusbar">
      <NotBuilt what="Shortcuts · Automations · Key Remaps" />
      <span className="shell-statusbar-spacer" />
      {saved && (saved.ok
        ? <span className="shell-saved" data-tip={tt('Changes save as you go', 'As alterações são salvas sozinhas')}>Saved {clock(saved.at)}</span>
        : <span className="shell-saved" data-error="true" data-tip={saved.error}>Not saved</span>)}
    </footer>
  );
}

function clock(at: string | undefined): string {
  if (!at) return '';
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
