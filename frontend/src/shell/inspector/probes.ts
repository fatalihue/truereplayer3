import { createElement, Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useBridge } from '../../bridge/BridgeContext';
import type { IncomingMessage } from '../../bridge/messageTypes';
import { newRequestId } from '../../logic/useEditorTools';

// What the probes' editors share: the request that waits for its answer, the forms a region and a
// colour take on their way to the engine, and the sentence of a test's answer with values in it.

// A test's answer is a sentence of the catalog with some values in the monospaced face ("Best match
// 92% at 640, 512"). t() is handed a private-use mark in each such value's place, and the sentence is
// cut at the marks, so each value sits wherever the language puts it (as the tips cut theirs at the
// key cap). No text has these characters.
export const VALUE_A = '';
export const VALUE_B = '';
/** The sentence, with `a` drawn in place of VALUE_A and `b` in place of VALUE_B. */
export function withValues(sentence: string, a: ReactNode, b?: ReactNode): ReactNode {
  return createElement(Fragment, null, ...sentence.split(/([])/).map(p => (p === VALUE_A ? a : p === VALUE_B ? b : p)));
}

type Reply = IncomingMessage['type'];
type PayloadOf<T extends Reply> = Extract<IncomingMessage, { type: T }>['payload'];

/**
 * One request to an engine tool that waits for its answer: `ask` sends with a fresh id; only the
 * reply that carries that id runs `onReply` (a stale one, from before another step was opened, is
 * dropped); no reply within `ms` runs `onLost`. A new ask replaces the one waiting.
 */
export function useAsk<T extends Reply>(type: T, onReply: (payload: PayloadOf<T>) => void, ms = 0, onLost?: () => void) {
  const { subscribe } = useBridge();
  const [waiting, setWaiting] = useState(false);
  const pending = useRef<string | null>(null);
  const live = useRef({ onReply, onLost });
  useEffect(() => { live.current = { onReply, onLost }; });
  useEffect(() => subscribe((message) => {
    if (message.type !== type) return;
    const payload = message.payload as PayloadOf<T>;
    if (!pending.current || (payload as { requestId?: string }).requestId !== pending.current) return;
    pending.current = null;
    setWaiting(false);
    live.current.onReply(payload);
  }), [subscribe, type]);
  useEffect(() => {
    if (!waiting || !ms) return;
    const id = setTimeout(() => {
      pending.current = null;
      setWaiting(false);
      live.current.onLost?.();
    }, ms);
    return () => clearTimeout(id);
  }, [waiting, ms]);
  return {
    waiting,
    ask: (send: (requestId: string) => void) => {
      const id = newRequestId();
      pending.current = id;
      setWaiting(true);
      send(id);
    },
    drop: () => { pending.current = null; setWaiting(false); },
  };
}

export type Region = { x: number; y: number; w: number; h: number };

/** The region a step looks in (waitImageSearch*), or null for the whole screen. */
export const regionOf = (s: { waitImageSearchX?: number | null; waitImageSearchY?: number | null; waitImageSearchW?: number | null; waitImageSearchH?: number | null }): Region | null =>
  s.waitImageSearchX != null && s.waitImageSearchY != null && s.waitImageSearchW && s.waitImageSearchH
    ? { x: s.waitImageSearchX, y: s.waitImageSearchY, w: s.waitImageSearchW, h: s.waitImageSearchH }
    : null;
/** The engine's form of a region edit ("x,y,w,h"; '' for the whole screen). */
export const regionValue = (r: Region | null) => (r ? `${r.x},${r.y},${r.w},${r.h}` : '');
/** A match found by a test, with 80 px around it: what the next search needs. No clamping — the
 *  coordinates are virtual-screen ones, negative left of or above the primary monitor. */
export const around = (r: Region): Region => ({ x: r.x - 80, y: r.y - 80, w: r.w + 160, h: r.h + 160 });

const HEX = /^#?([0-9a-f]{6})$/i;
/** "#2ECC71" for anything that is six hex digits, with or without the #; null otherwise. */
export const normalHex = (text: string): string | null => {
  const m = HEX.exec(text.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
};
