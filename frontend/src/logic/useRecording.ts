import { useMemo } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { useGetAppState } from '../state/AppStateContext';
import { useSelectionRef } from '../state/SelectionContext';
import { insertIndexAtSelection } from './insertIndex';

/**
 * Recording, as commands. The engine owns whether a recording may start (buttonStates.recordEnabled)
 * and what the button says; these only ask. The selection and the step count are read when the
 * command fires, so a component that only records does not re-render with the list.
 */
export function useRecording() {
  const { send } = useBridge();
  const getState = useGetAppState();
  const selectionRef = useSelectionRef();
  return useMemo(() => ({
    /** Starts recording where a new step would go (insertIndexAtSelection), or stops it. */
    toggle: () => send({
      type: 'recording:toggle',
      payload: { insertIndex: insertIndexAtSelection(selectionRef.current, getState().actions.length) },
    }),
    /** Starts recording at a fixed row: the empty list's "Start recording" always begins at 0. */
    toggleAt: (insertIndex: number) => send({ type: 'recording:toggle', payload: { insertIndex } }),
  }), [send, getState, selectionRef]);
}
