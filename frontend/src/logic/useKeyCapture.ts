import { useMemo } from 'react';
import { useBridge } from '../bridge/BridgeContext';

/** Modifiers only ("Ctrl", "Win+Shift"): the user is still reaching for the real key. */
export const isPureModifier = (combo: string) => /^(Win|Ctrl|Alt|Shift)(\+(Win|Ctrl|Alt|Shift))*$/.test(combo);

/**
 * The low-level hook's capture mode, as commands. While any owner holds it, the hook swallows
 * every key with the app in front and sends it back composed (`hotkey:captured`), Win+letter and
 * AltGr included, and global hotkeys, Profile Keys, hotstrings and remaps stay quiet. The engine
 * keeps the owners as a set: arming twice is one claim, and a release for an owner that never
 * armed changes nothing. Each reply names the owner that armed last.
 */
export function useKeyCapture() {
  const { send, subscribe } = useBridge();
  return useMemo(() => ({
    arm: (ownerId: string) => send({ type: 'hotkey:capture', payload: { enabled: true, ownerId } }),
    release: (ownerId: string) => send({ type: 'hotkey:capture', payload: { enabled: false, ownerId } }),
    set: (ownerId: string, enabled: boolean) => send({ type: 'hotkey:capture', payload: { enabled, ownerId } }),
    /** Global hotkeys off without capturing: the hotstring dialog types into an ordinary field. */
    suppress: (enabled: boolean) => send({ type: 'hotkey:suppress', payload: { enabled } }),
    /**
     * Calls `onCombo` with each captured combo addressed to `ownerId`: a reply that names another
     * owner is for the dialog that armed after this one, and a reply that names none is for
     * everyone. `ownerId` null takes every reply. Returns the unsubscribe.
     */
    listen: (ownerId: string | null, onCombo: (combo: string) => void) => subscribe((msg) => {
      if (msg.type !== 'hotkey:captured') return;
      const owner = msg.payload?.owner;
      if (ownerId !== null && owner && owner !== ownerId) return;
      onCombo(msg.payload?.combo);
    }),
  }), [send, subscribe]);
}

// Idle budget before an armed capture gives up. There is no "Esc cancels" — Esc is a key a
// KeyDown row can hold — so the ways out are a click elsewhere and this.
export const SINGLE_KEY_CAPTURE_IDLE_MS = 4000;
