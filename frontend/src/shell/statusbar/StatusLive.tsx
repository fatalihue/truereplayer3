import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useAutomations } from '../../logic/useAutomations';
import { useRemaps } from '../../logic/useRemaps';
import { useSettings } from '../../logic/useSettings';
import { t } from '../../i18n';
import { preload } from '../lazyModule';
import { MkSwitch } from '../mk/MkStatus';
import { useApp } from '../store';
import { loadSettingsPage, openSettings } from '../ui';
import { useExtension } from './extensionState';

/**
 * The master switches, each one click from on to off ("Shortcuts On · Automations On · 2 armed ·
 * Key Remaps Off" — FunctionMap: "Profile Keys vira Shortcuts, na barra de status"). They come with
 * this chunk, a moment after the app opens (rule 6), from the state the app already holds.
 */
export function Switches() {
  const shortcuts = useApp(a => a.settings.profileKeyEnabled);
  // On the Clicker page (its mode) the macros' hotkeys and hotstrings wait: on, but not in effect.
  const byClicker = useApp(a => a.settings.useCursorClick) && shortcuts;
  const automationsOn = useApp(a => a.automation.enabled);
  const armed = useApp(a => a.automation.entries.filter(e => e.trigger.armed && !e.isDisabled).length);
  const remapsOn = useApp(a => a.settings.remaps.enabled);
  const remapsActive = useApp(a => a.settings.remaps.entries.filter(e => e.enabled).length);
  const settings = useSettings();
  const automations = useAutomations();
  const remaps = useRemaps();
  // The remaps pause with the Shortcuts off (and while recording): on, but not in effect.
  const remapsPaused = remapsOn && !shortcuts;
  const group = useRef<HTMLDivElement>(null);
  useDetailsFit(group);
  return (
    <div ref={group} className="sb-switches" role="group" aria-label={t('statusbar.switches')}>
      <button
        type="button"
        className="sb-switch"
        aria-pressed={shortcuts}
        data-off={shortcuts ? undefined : ''}
        data-paused={byClicker ? '' : undefined}
        data-tip={byClicker ? t('statusbar.shortcutsPausedTip') : shortcuts ? t('statusbar.shortcutsOnTip') : t('statusbar.shortcutsOffTip')}
        onClick={() => settings.change('profileKeyEnabled', !shortcuts)}
      >
        <span className="sb-dot" />
        <span className="sb-text">{byClicker ? t('statusbar.shortcutsPaused') : shortcuts ? t('statusbar.shortcutsOn') : t('statusbar.shortcutsOff')}</span>
      </button>
      <button
        type="button"
        className="sb-switch"
        aria-pressed={automationsOn}
        data-tip={automationsOn ? t('statusbar.automationsOnTip') : t('statusbar.automationsOffTip')}
        onClick={() => automations.setEnabled(!automationsOn)}
      >
        <span className="sb-dot" />
        <span className="sb-text">
          {automationsOn ? t('statusbar.automationsOn') : t('statusbar.automationsOff')}
          {automationsOn && <span className="sb-count">{t('statusbar.automationsArmed', { count: armed })}</span>}
        </span>
      </button>
      <button
        type="button"
        className="sb-switch"
        aria-pressed={remapsOn}
        data-paused={remapsPaused ? '' : undefined}
        data-tip={remapsPaused ? t('statusbar.remapsPausedTip') : remapsOn ? t('statusbar.remapsOnTip') : t('statusbar.remapsOffTip')}
        onClick={() => remaps.setEnabled(!remapsOn)}
      >
        <span className="sb-dot" />
        <span className="sb-text">
          {remapsPaused ? t('statusbar.remapsPaused') : remapsOn ? t('statusbar.remapsOn') : t('statusbar.remapsOff')}
          {remapsOn && !remapsPaused && <span className="sb-count">{t('statusbar.remapsActive', { count: remapsActive })}</span>}
        </span>
      </button>
      {/* Teclado (branch teclado): the game in front and the layer, beside the Key Remaps. */}
      <MkSwitch />
    </div>
  );
}

/**
 * The details of the bar go whole, before any word of a name or of the extension's state is cut: first
 * the version and the save, then the counts after the switches' names ("· 2 armed"), from the right (the
 * Key Remaps', then the Automations'); each comes back once it fits. What still does not fit then gives
 * way in shell.css, from the right, with an ellipsis. Read again when the bar changes size, when its words
 * change, and when the zoom or the font does; a count gone is still read out (shell.css).
 */
function useDetailsFit(group: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const bar = group.current?.closest<HTMLElement>('.shell-statusbar');
    if (!bar) return;
    const fit = () => {
      // In the bar's order, so the last goes first: the counts, the save, the version.
      const details = [...bar.querySelectorAll<HTMLElement>('.sb-count, .shell-saved, .shell-version')];
      for (const detail of details) delete detail.dataset.gone;
      for (let i = details.length - 1; i >= 0 && someCut(bar); i--) details[i].dataset.gone = '';
    };
    const size = new ResizeObserver(fit);
    size.observe(bar);
    const words = new MutationObserver(fit);
    words.observe(bar, { subtree: true, childList: true, characterData: true });
    // The zoom and the font are the root's (themes.ts): the bar keeps its size, its words do not.
    const scale = new MutationObserver(fit);
    scale.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => {
      size.disconnect();
      words.disconnect();
      scale.disconnect();
    };
  }, [group]);
}

/** A name, a count, the extension's state, the save or the version that its ellipsis cuts (to a 64th of a pixel). */
function someCut(bar: HTMLElement) {
  for (const box of bar.querySelectorAll<HTMLElement>('.sb-switch .sb-text, .sb-extension .sb-text, .shell-saved:not([data-gone]), .shell-version:not([data-gone])')) {
    const edge = box.getBoundingClientRect().right + 0.01;
    for (const part of box.childNodes) {
      if (part instanceof HTMLElement) {
        if (part.dataset.gone === undefined && part.getBoundingClientRect().right > edge) return true;
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(part);
      if (range.getBoundingClientRect().right > edge) return true;
    }
  }
  return false;
}

/**
 * The browser extension: connected, not connected, or loaded in an older version than this app
 * expects (D25 — a state that goes by itself once it is reloaded; nothing to dismiss). A click goes
 * to Settings › Browser extension, where its folder and how to load it are.
 */
export function Extension() {
  const connection = useExtension(s => s.connection);
  const outdated = useExtension(s => s.outdated);
  if (connection === 'unknown' && !outdated) return null;
  const state = outdated ? 'reload' : connection;
  const text = state === 'reload' ? t('statusbar.extensionReload') : state === 'connected' ? t('statusbar.extensionConnected') : t('statusbar.extensionNotConnected');
  const tip = state === 'reload'
    ? t('statusbar.extensionReloadTip', { current: String(outdated?.current), expected: String(outdated?.expected) })
    : state === 'connected' ? t('statusbar.extensionConnectedTip') : t('statusbar.extensionNotConnectedTip');
  return (
    <button
      type="button"
      className="sb-extension"
      data-state={state}
      data-tip={tip}
      onPointerEnter={() => { void preload(loadSettingsPage); }}
      onClick={() => openSettings('browser')}
    >
      <span className="sb-dot" />
      <span className="sb-text">{text}</span>
    </button>
  );
}
