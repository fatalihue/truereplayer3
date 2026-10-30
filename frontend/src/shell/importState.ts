import { create } from 'zustand';
import type { Tr2ImportSummary } from '../bridge/messageTypes';

/**
 * The "Import from TrueReplayer 2" dialog (Tr2Import in the engine): the first-run offer, or the
 * row in Settings › General. Small on purpose — the dialog itself loads only when it opens.
 */
export type ImportMode = 'offer' | 'settings';

export const useImport = create<{ mode: ImportMode | null; offer: Tr2ImportSummary | null }>(() => ({ mode: null, offer: null }));

export const openImport = (mode: ImportMode, offer: Tr2ImportSummary | null = null) => useImport.setState({ mode, offer });
export const closeImport = () => useImport.setState({ mode: null, offer: null });
