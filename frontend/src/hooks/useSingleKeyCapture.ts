import { useEffect, useRef } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { splitCombo } from '../components/common/KbdTag';

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
  const { send, subscribe } = useBridge();
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
    send({ type: 'hotkey:capture', payload: { enabled: true, ownerId } });
    const idle = setTimeout(() => onIdleRef.current(), SINGLE_KEY_CAPTURE_IDLE_MS);
    let done = false;
    const unsub = subscribe((msg) => {
      if (msg.type !== 'hotkey:captured' || done) return;
      if (msg.payload.owner && msg.payload.owner !== ownerId) return;
      const combo = msg.payload.combo;
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
      send({ type: 'hotkey:capture', payload: { enabled: false, ownerId } });
    };
  }, [active, send, subscribe]);
}
