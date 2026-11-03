import { useMemo } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { t } from '../i18n';
import { useGetAppState } from '../state/AppStateContext';
import type { RemapEntryDto } from '../bridge/messageTypes';

/**
 * Why a captured key cannot go on this side of a rule, or null when it can. Combos are not
 * remappable. A wheel tick is a fine TARGET (one notch per press) but has no press/release to be a
 * SOURCE of. Side buttons are valid on both sides since 2026-09-05: as a target they go out
 * through SendInput's mouse path.
 */
export function remapKeyProblem(combo: string, side: 'from' | 'to'): string | null {
  if (combo.includes('+')) return t('remaps.refuse.combo');
  if (side === 'from' && (combo === 'ScrollUp' || combo === 'ScrollDown')) return t('remaps.refuse.wheel');
  return null;
}

/** Key Remaps, as commands. The whole list travels on every save, and the engine echoes it back. */
export function useRemaps() {
  const { send } = useBridge();
  const getState = useGetAppState();
  return useMemo(() => ({
    /** Saves the list; the master switch keeps its current value unless one is given. */
    save: (entries: RemapEntryDto[], enabled?: boolean) =>
      send({ type: 'remap:save', payload: { enabled: enabled ?? getState().settings.remaps.enabled, remaps: entries } }),
    /** The master switch. The rules stay as they are. */
    setEnabled: (enabled: boolean) =>
      send({ type: 'remap:save', payload: { enabled, remaps: getState().settings.remaps.entries } }),
    /**
     * Writes the list in memory over a remaps.json the app could not read at load (quarantined by
     * RemapService). The explicit "yes, replace it" that quarantine waits for.
     */
    overwriteUnreadable: () => send({ type: 'remap:overwriteUnreadable', payload: {} }),
  }), [send, getState]);
}
