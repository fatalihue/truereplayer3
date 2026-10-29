import { useEffect, useMemo, useState } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { useGetAppState } from '../state/AppStateContext';
import type { IncomingMessage, OcrLanguagesPayload } from '../bridge/messageTypes';

/**
 * The app's settings, as commands. Every write is echoed back as settings:loaded, which is what
 * repaints the controls; nothing here keeps a local copy.
 */
export function useSettings() {
  const { send } = useBridge();
  const getState = useGetAppState();
  return useMemo(() => ({
    /**
     * Writes one setting by its key. The same key can mean the open macro's own value
     * (profileLoopCount, profileGameMode, …): the engine routes those to the profile, while
     * smoothMovement and restoreCursor are always the app defaults of Game Mode and Return cursor,
     * macro open or not. A global hotkey that clashes with another is refused there, with a toast,
     * and the echo puts the field back.
     */
    change: (key: string, value: string | boolean | number | object | null) =>
      send({ type: 'settings:change', payload: { key, value } }),
    /**
     * Puts every app setting back to its default, keeping the open macro (its steps and its own run
     * settings) and the Automations master switch (D23). The page asks first: no native dialog.
     */
    resetAll: () => send({ type: 'settings:resetAll', payload: {} }),
    setAlwaysOnTop: (enabled: boolean) => send({ type: 'window:alwaysOnTop', payload: { enabled } }),
    setMinimizeToTray: (enabled: boolean) => send({ type: 'window:minimizeToTray', payload: { enabled } }),
    /** Run on startup. Turning it off also turns off "start minimized", which means nothing without it. */
    setRunOnStartup: (enabled: boolean) => {
      send({ type: 'window:runOnStartup', payload: { enabled } });
      if (!enabled && getState().settings.startMinimized) {
        send({ type: 'window:startMinimized', payload: { enabled: false } });
      }
    },
    setStartMinimized: (enabled: boolean) => send({ type: 'window:startMinimized', payload: { enabled } }),
    setRunEndFlash: (enabled: boolean) => send({ type: 'window:runEndFlash', payload: { enabled } }),
    setRunEndSound: (enabled: boolean) => send({ type: 'window:runEndSound', payload: { enabled } }),
    /** Draws the fixed region the Copy Screen Text hotkey reads, on screen. */
    pickCopyScreenTextRegion: () => send({ type: 'ocr:configureHotkeyRegion', payload: {} }),
    /** Installs a Windows OCR language pack. The outcome arrives as ocr:installResult. */
    installOcrLanguage: (tag: string) => send({ type: 'ocr:installLanguage', payload: { tag } }),
    /** Checks for an update now (the app also checks on its own at launch). */
    checkForUpdate: () => send({ type: 'update:check', payload: {} }),
  }), [send, getState]);
}

/** One-shot app commands, the doors support and recovery need. */
export function useAppActions() {
  const { send } = useBridge();
  return useMemo(() => ({
    /** Reloads the page: the recovery hatch for a wedged UI. Typed fields in open editors are lost. */
    reloadUI: () => send({ type: 'window:reloadUI', payload: {} }),
    /** Opens %LocalAppData%\TrueReplayer\Logs in Explorer. */
    openLogsFolder: () => send({ type: 'logs:openFolder', payload: {} }),
    /** Puts version, OS, WebView2 and state on the clipboard, then confirms with a toast. */
    copyDiagnostics: () => send({ type: 'diagnostics:copy', payload: {} }),
    /** Opens an https URL in the default browser. The backend allow-lists the project's own pages. */
    openUrl: (url: string) => send({ type: 'shell:openUrl', payload: { url } }),
    /** Downloads and installs the update that was found. */
    applyUpdate: () => send({ type: 'update:apply', payload: {} }),
    /** Shows the browser extension's folder in Explorer. */
    openExtensionFolder: () => send({ type: 'extension:openFolder', payload: {} }),
  }), [send]);
}

/**
 * The OCR recognizer languages installed on THIS PC. Asked for whenever `active` turns on, since a
 * language pack can be added while the app runs; the engine also pushes the list after a pick and
 * around an install.
 */
export function useOcrLanguages(active: boolean): OcrLanguagesPayload | null {
  const { send, subscribe } = useBridge();
  const [langs, setLangs] = useState<OcrLanguagesPayload | null>(null);
  useEffect(() => subscribe((msg) => {
    if (msg.type === 'ocr:languagesResult') setLangs(msg.payload);
  }), [subscribe]);
  useEffect(() => {
    if (active) send({ type: 'ocr:languages', payload: {} });
  }, [active, send]);
  return langs;
}

export type ExtensionHelp = Extract<IncomingMessage, { type: 'extension:help' }>['payload'];

/**
 * Where the browser extension lives, for the "load unpacked" steps. Asking IS the copy: the engine
 * puts the folder's path on the clipboard (extension:help) and answers with it. null until then.
 * `copy` false only asks (Settings › Browser extension, which copies on its own Copy path); an
 * extension:help asked with the copy later updates the answer.
 */
export function useExtensionHelp(copy = true): ExtensionHelp | null {
  const { send, subscribe } = useBridge();
  const [reply, setReply] = useState<ExtensionHelp | null>(null);
  useEffect(() => {
    const unsubscribe = subscribe((msg) => {
      if (msg.type !== 'extension:help') return;
      const p = msg.payload;
      if (typeof p?.path !== 'string') return;
      setReply({ path: p.path, exists: p.exists === true, copied: p.copied === true, connected: p.connected === true });
    });
    send({ type: 'extension:help', payload: copy ? {} : { copy: false } });
    return unsubscribe;
  }, [send, subscribe, copy]);
  return reply;
}
