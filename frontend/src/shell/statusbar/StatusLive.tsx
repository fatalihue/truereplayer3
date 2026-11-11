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
  return (
    <div className="sb-switches" role="group" aria-label={t('statusbar.switches')}>
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
        {byClicker ? t('statusbar.shortcutsPaused') : shortcuts ? t('statusbar.shortcutsOn') : t('statusbar.shortcutsOff')}
      </button>
      <button
        type="button"
        className="sb-switch"
        aria-pressed={automationsOn}
        data-tip={automationsOn ? t('statusbar.automationsOnTip') : t('statusbar.automationsOffTip')}
        onClick={() => automations.setEnabled(!automationsOn)}
      >
        <span className="sb-dot" />
        {automationsOn ? t('statusbar.automationsOn', { count: armed }) : t('statusbar.automationsOff')}
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
        {remapsPaused ? t('statusbar.remapsPaused') : remapsOn ? t('statusbar.remapsOn', { count: remapsActive }) : t('statusbar.remapsOff')}
      </button>
      {/* Teclado (branch teclado): the game in front and the layer, beside the Key Remaps. */}
      <MkSwitch />
    </div>
  );
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
      {text}
    </button>
  );
}
