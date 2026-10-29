import { createContext, useContext } from 'react';

/**
 * Where an expanded editor puts what goes beside its fields and over them (InspectorBody draws the
 * two): the side column — the Send Text's Insert panel — and the area over both columns, for
 * Transform…. Both null while the Inspector is not expanded.
 */
export interface InspectorSlots {
  side: HTMLElement | null;
  over: HTMLElement | null;
}

export const InspectorSlotsContext = createContext<InspectorSlots>({ side: null, over: null });
export const useInspectorSlots = () => useContext(InspectorSlotsContext);
