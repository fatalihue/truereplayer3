import { useCallback, useEffect, useRef, useState } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { ExampleInfo, ExampleUseResult } from '../bridge/messageTypes';

/**
 * The example macros that ship inside the app (decision 4), for the first-use screen and the
 * library. The list is asked for while `active`, and asked again after a copy, so `inLibrary`
 * stays true to the library. `use` copies an example into the library's Examples folder;
 * `lastUse` is the engine's answer to the latest copy, with the name to open it by. null until
 * each one arrives.
 */
export function useExamples(active: boolean) {
  const { send, subscribe } = useBridge();
  const [examples, setExamples] = useState<ExampleInfo[] | null>(null);
  const [lastUse, setLastUse] = useState<ExampleUseResult | null>(null);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => subscribe((msg) => {
    if (msg.type === 'examples:listResult') setExamples(msg.payload.examples);
    else if (msg.type === 'examples:useResult') {
      setLastUse(msg.payload);
      if (msg.payload.ok && activeRef.current) send({ type: 'examples:list', payload: {} });
    }
  }), [send, subscribe]);
  useEffect(() => {
    if (active) send({ type: 'examples:list', payload: {} });
  }, [active, send]);
  const use = useCallback((name: string) => send({ type: 'examples:use', payload: { name } }), [send]);
  return { examples, lastUse, use };
}
