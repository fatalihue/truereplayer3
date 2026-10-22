import { useEffect, useMemo, useRef } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { splitCombo } from '../components/common/KbdTag';

/** Modifiers only ("Ctrl", "Win+Shift"): the user is still reaching for the real key. */
export const isPureModifier = (combo: string) => /^(Win|Ctrl|Alt|Shift)(\+(Win|Ctrl|Alt|Shift))*$/.test(combo);

/** What a capture field holds after `combo` arrives: a bare modifier press never replaces a combo already captured. */
export const keepRealCombo = (prev: string | null, combo: string) => (prev !== null && isPureModifier(combo) ? prev : combo);

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

// Capture mode also emits the wheel and the side buttons (InputHookManager composes them like
// keys, for hotkeys). None of them is a key a KeyDown/KeyUp row can press, so they are ignored
// rather than saved. Left/right clicks are never captured — they pass through, which is what
// lets "click elsewhere cancels" work at all.
const NOT_A_KEY = new Set(['ScrollUp', 'ScrollDown', 'XButton1', 'XButton2']);

/**
 * Captures ONE key for a KeyDown/KeyUp row through the low-level hook (`hotkey:capture`), not
 * through the browser's keydown. Three things only the hook gets right:
 *  - the NAME is the one recording produces (the hook's own GetKeyName), so an edited row and a
 *    recorded row spell a key the same way — the browser-side mapping stored "!" for Shift+1 and
 *    "Dead" for an accent key, and ignored Win;
 *  - while armed, global hotkeys, Profile Keys, hotstrings and remaps do not fire — the hook
 *    swallows every key with the app in front, so pressing F9 records F9 instead of running it;
 *  - keys the browser never sees (Win) arrive at all.
 *
 * The key is the LAST segment of the first combo that arrives — the key that went down. A lone
 * modifier is a real answer (a KeyDown Ctrl is legitimate); modifiers held from before the
 * capture armed are dropped. `onKey` fires once per press; the caller ends the capture (by
 * turning `active` off), which is also what releases the hook.
 *
 * The hook is released on EVERY way out, because the release lives in this effect's cleanup:
 * `active` going false (commit, cancel, blur, idle) and unmount (profile switch closing the
 * editor, the Clicker flip taking the grid away). A capture left armed is an app with no
 * keyboard, the Stop hotkey included.
 */
export function useSingleKeyCapture(active: boolean, onKey: (key: string) => void, onIdle: () => void) {
  const capture = useKeyCapture();
  // The latest callbacks, without re-arming the capture every time the caller re-renders.
  const onKeyRef = useRef(onKey);
  const onIdleRef = useRef(onIdle);
  useEffect(() => {
    onKeyRef.current = onKey;
    onIdleRef.current = onIdle;
  });
  // One owner per mounted caller: the refcount slot this caller registers and releases, and the
  // address hotkey:captured carries — a capture meant for a LATER-armed consumer is not ours.
  const ownerIdRef = useRef(`single-key-${crypto.randomUUID()}`);

  useEffect(() => {
    if (!active) return;
    const ownerId = ownerIdRef.current;
    capture.arm(ownerId);
    const idle = setTimeout(() => onIdleRef.current(), SINGLE_KEY_CAPTURE_IDLE_MS);
    let done = false;
    const unsub = capture.listen(ownerId, (combo) => {
      if (done) return;
      if (typeof combo !== 'string' || combo === '') return;
      const parts = splitCombo(combo);
      const key = parts[parts.length - 1];
      if (!key || NOT_A_KEY.has(key)) return;
      done = true;
      clearTimeout(idle);
      onKeyRef.current(key);
    });
    return () => {
      clearTimeout(idle);
      unsub();
      capture.release(ownerId);
    };
  }, [active, capture]);
}
