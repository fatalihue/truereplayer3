import { useEffect } from 'react';
import { APP_VERSION } from '../appVersion';
import { fmtHora, t } from '../i18n';
import { preload, useLoaded } from './lazyModule';
import { useExtensionWatch } from './statusbar/extensionState';
import { useShell } from './store';

// The switches and the extension's state (rule 6): not part of opening the app — they come when the
// page is first idle once the app's state is drawn. Idle before it (the page waits on the engine
// after ui:ready) their code came in the middle of the launch, ahead of the library; idle as soon as
// the state was in, it could still come between the library's commit and the frame that shows it.
const loadStatusLive = () => import('./statusbar/StatusLive');

/**
 * ⑩ The status bar: the three master switches, then the browser extension's state, whether the
 * macro is on disk, and the version. The extension is heard from the start (useExtensionWatch): the
 * engine says its state once, right after the app's state.
 */
export function StatusBar() {
  const saved = useShell(s => s.saved);
  const live = useLoaded(loadStatusLive);
  const booted = useShell(s => s.booted);
  useExtensionWatch();
  useEffect(() => {
    if (live || !booted) return;
    let idle = 0;
    const frame = requestAnimationFrame(() => { idle = requestIdleCallback(() => { void preload(loadStatusLive); }); });
    return () => {
      cancelAnimationFrame(frame);
      cancelIdleCallback(idle);
    };
  }, [live, booted]);
  return (
    <footer className="shell-statusbar">
      {live && <live.Switches />}
      <span className="shell-statusbar-spacer" />
      {live && <live.Extension />}
      {saved && (saved.ok
        ? <span className="shell-saved" data-tip={t('statusbar.savedTip')}>{t('statusbar.saved', { time: clock(saved.at) })}</span>
        : <span className="shell-saved" data-error="true" data-tip={saved.error}>{t('statusbar.notSaved')}</span>)}
      <span className="shell-version">{APP_VERSION}</span>
    </footer>
  );
}

function clock(at: string | undefined): string {
  if (!at) return '';
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? '' : fmtHora(when);
}
