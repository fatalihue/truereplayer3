import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAutomations } from '../../logic/useAutomations';
import { useRemaps } from '../../logic/useRemaps';
import { useSettings } from '../../logic/useSettings';
import { useTt } from '../../state/LanguageContext';
import { preload, useLoaded } from '../lazyModule';
import { useApp } from '../store';
import { loadExtensionHelp, setExtensionHelp, useUi } from '../ui';
import { useExtension } from './extensionState';

/**
 * The master switches, each one click from on to off ("Shortcuts On · Automations On · 2 armed ·
 * Key Remaps Off" — FunctionMap: "Profile Keys vira Shortcuts, na barra de status"). They come with
 * this chunk, a moment after the app opens (rule 6), from the state the app already holds.
 */
export function Switches() {
  const shortcuts = useApp(a => a.settings.profileKeyEnabled);
  const automationsOn = useApp(a => a.automation.enabled);
  const armed = useApp(a => a.automation.entries.filter(e => e.trigger.armed && !e.isDisabled).length);
  const remapsOn = useApp(a => a.settings.remaps.enabled);
  const remapsActive = useApp(a => a.settings.remaps.entries.filter(e => e.enabled).length);
  const settings = useSettings();
  const automations = useAutomations();
  const remaps = useRemaps();
  const tt = useTt();
  // The remaps pause with the Shortcuts off (and while recording): on, but not in effect.
  const remapsPaused = remapsOn && !shortcuts;
  return (
    <div className="sb-switches" role="group" aria-label="Master switches">
      <button
        type="button"
        className="sb-switch"
        aria-pressed={shortcuts}
        data-off={shortcuts ? undefined : ''}
        data-tip={shortcuts
          ? tt("The macros' hotkeys and hotstrings fire. Off pauses them, and the Key Remaps too.", 'Os atalhos e hotstrings dos macros disparam. Desligado, eles param, e os Key Remaps também.')
          : tt("Off: the macros' hotkeys and hotstrings won't fire, and the Key Remaps are paused.", 'Desligado: os atalhos e hotstrings dos macros não disparam, e os Key Remaps ficam pausados.')}
        onClick={() => settings.change('profileKeyEnabled', !shortcuts)}
      >
        <span className="sb-dot" />
        Shortcuts {shortcuts ? 'On' : 'Off'}
      </button>
      <button
        type="button"
        className="sb-switch"
        aria-pressed={automationsOn}
        data-tip={automationsOn
          ? tt('The armed automations run their macros when their trigger comes. Off holds them all.', 'As automações armadas rodam seus macros quando o gatilho chega. Desligado, todas esperam.')
          : tt('Off: no automation runs, armed or not.', 'Desligado: nenhuma automação roda, armada ou não.')}
        onClick={() => automations.setEnabled(!automationsOn)}
      >
        <span className="sb-dot" />
        Automations {automationsOn ? `On · ${armed} armed` : 'Off'}
      </button>
      <button
        type="button"
        className="sb-switch"
        aria-pressed={remapsOn}
        data-paused={remapsPaused ? '' : undefined}
        data-tip={remapsPaused
          ? tt('On, but paused while the Shortcuts are off.', 'Ligados, mas pausados enquanto os Shortcuts estão desligados.')
          : remapsOn
            ? tt('The key remaps are in effect. They also pause while recording.', 'Os remaps de teclas valem. Também pausam durante a gravação.')
            : tt('Off: every key does what it always does.', 'Desligado: cada tecla faz o que sempre fez.')}
        onClick={() => remaps.setEnabled(!remapsOn)}
      >
        <span className="sb-dot" />
        Key Remaps {remapsPaused ? 'paused' : remapsOn ? `On · ${remapsActive} active` : 'Off'}
      </button>
    </div>
  );
}

/**
 * The browser extension: connected, not connected, or loaded in an older version than this app
 * expects (D25 — a state that goes by itself once it is reloaded; nothing to dismiss). A click opens
 * how to connect it, the dialog of today, until Settings › Browser extension (phase 3).
 */
export function Extension() {
  const connection = useExtension(s => s.connection);
  const outdated = useExtension(s => s.outdated);
  const open = useUi(s => s.extensionHelp);
  const dialog = useLoaded(loadExtensionHelp);
  const tt = useTt();
  useEffect(() => {
    if (open && !dialog) void preload(loadExtensionHelp);
  }, [open, dialog]);
  const Dialog = dialog?.ExtensionHelpDialog;
  // In a portal, like the library's dialogs: nothing in the bar may clip or contain it.
  const shown = open && Dialog ? createPortal(<Dialog onClose={() => setExtensionHelp(false)} />, document.body) : null;
  if (connection === 'unknown' && !outdated) return shown;
  const state = outdated ? 'reload' : connection;
  const text = state === 'reload' ? 'Extension needs reload' : state === 'connected' ? 'Extension connected' : 'Extension not connected';
  const tip = state === 'reload'
    ? tt(`Version ${outdated?.current} is loaded and this app expects ${outdated?.expected}. Reload it in chrome://extensions.`,
         `A versão ${outdated?.current} está carregada e este app espera a ${outdated?.expected}. Recarregue em chrome://extensions.`)
    : state === 'connected'
      ? tt('The browser extension is connected', 'A extensão do navegador está conectada')
      : tt('Browser actions fail and browser conditions read as not found. Click to connect the extension.',
           'Ações de navegador falham e condições de navegador leem como não encontradas. Clique para conectar a extensão.');
  return (
    <>
      <button type="button" className="sb-extension" data-state={state} data-tip={tip} onClick={() => setExtensionHelp(true)}>
        <span className="sb-dot" />
        {text}
      </button>
      {shown}
    </>
  );
}
