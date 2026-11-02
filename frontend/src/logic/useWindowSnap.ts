import { useEffect } from 'react';
import { useBridge } from '../bridge/BridgeContext';

/**
 * Tells the engine the layout's band edges (DIP), which move with the zoom: the engine sizes the
 * compact view in the rem the first one gives. They made a dragged window edge stick too (D27);
 * since D29 the edge sticks only to the size the window opens at, as in TrueReplayer 2. Said again
 * whenever they change; the engine keeps them only in memory, so a reload says them again too.
 * Deferred a task, so the first one goes after ui:ready (the provider's effect, which runs after
 * this one).
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
