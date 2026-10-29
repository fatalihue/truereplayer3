import { useCallback, useEffect, useState } from 'react';
import { useBridge } from '../bridge/BridgeContext';

// Reads the current clipboard text via the bridge once on mount. Used by both
// clipboard-related popovers (insert and chip-edit) so the live preview reflects
// what the user would actually paste at runtime. `refresh` re-reads on demand
// (the Clipboard Surface's ⟳ button) — the old content stays visible until the
// fresh read lands, so no flicker.
//
// `enabled` false reads nothing, until it turns true: a surface that only sometimes shows the
// clipboard (the chain builder on another source, the expanded Send Text's preview of a text with
// no clipboard token) does not read it for nothing.
export function useClipboardContent(enabled = true) {
  const { send, subscribe } = useBridge();
  const [clipRaw, setClipRaw] = useState<string>('');
  const [clipReady, setClipReady] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const off = subscribe((msg) => {
      if (msg.type === 'clipboard:content') {
        setClipRaw(msg.payload.text || '');
        setClipReady(true);
      }
    });
    send({ type: 'clipboard:read', payload: {} });
    return off;
  }, [enabled, send, subscribe]);

  const refresh = useCallback(() => {
    send({ type: 'clipboard:read', payload: {} });
  }, [send]);

  return { clipRaw, clipReady, refresh };
}
