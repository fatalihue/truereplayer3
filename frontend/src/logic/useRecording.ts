import { useMemo } from 'react';
import { useBridge } from '../bridge/BridgeContext';

/**
 * Recording, as a command. The engine owns whether a recording may start (buttonStates.recordEnabled)
 * and what the button says; this only asks. The caller says where the new steps go: the shell's
 * insertion point (after the selection, or at the end), or 0 for the empty list's "Start recording".
 */
export function useRecording() {
  const { send } = useBridge();
  return useMemo(() => ({
    /** Starts recording with the new steps going in at `insertIndex`, or stops the recording. */
    toggleAt: (insertIndex: number) => send({ type: 'recording:toggle', payload: { insertIndex } }),
  }), [send]);
}
