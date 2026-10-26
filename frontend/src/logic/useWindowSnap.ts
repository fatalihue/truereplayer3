import { useEffect } from 'react';
import { useBridge } from '../bridge/BridgeContext';

/**
 * Tells the engine the widths (DIP) a dragged window edge should stick to: the layout's band edges,
 * which move with the zoom (D27). Said again whenever they change; the engine keeps them only in
 * memory, so a reload says them again too. Deferred a task, so the first one goes after ui:ready
 * (the provider's effect, which runs after this one).
 */
export function useWindowSnap(widths: number[]) {
  const { send } = useBridge();
  const key = widths.join(',');
  useEffect(() => {
    if (!key) return;
    const id = setTimeout(() => send({ type: 'window:snapWidths', payload: { widths: key.split(',').map(Number) } }), 0);
    return () => clearTimeout(id);
  }, [key, send]);
}
