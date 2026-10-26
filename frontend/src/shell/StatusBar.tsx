import { useEffect } from 'react';
import { APP_VERSION } from '../appVersion';
import { useTt } from '../state/LanguageContext';
import { preload, useLoaded } from './lazyModule';
import { useExtensionWatch } from './statusbar/extensionState';
import { useShell } from './store';

// The switches and the extension's state (rule 6): not part of opening the app — they come when the
// page is first idle, a moment after the library is drawn.
const loadStatusLive = () => import('./statusbar/StatusLive');

/**
 * ⑩ The status bar: the three master switches, then the browser extension's state, whether the
 * macro is on disk, and the version. The extension is heard from the start (useExtensionWatch): the
 * engine says its state once, right after the app's state.
 */
export function StatusBar() {
  const saved = useShell(s => s.saved);
  const tt = useTt();
  const live = useLoaded(loadStatusLive);
  useExtensionWatch();
  useEffect(() => {
    if (live) return;
    const id = requestIdleCallback(() => { void preload(loadStatusLive); });
    return () => cancelIdleCallback(id);
  }, [live]);
  return (
    <footer className="shell-statusbar">
      {live && <live.Switches />}
      <span className="shell-statusbar-spacer" />
      {live && <live.Extension />}
      {saved && (saved.ok
        ? <span className="shell-saved" data-tip={tt('Changes save as you go', 'As alterações são salvas sozinhas')}>Saved {clock(saved.at)}</span>
        : <span className="shell-saved" data-error="true" data-tip={saved.error}>Not saved</span>)}
      <span className="shell-version">{APP_VERSION}</span>
    </footer>
  );
}

function clock(at: string | undefined): string {
  if (!at) return '';
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? '' : when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
