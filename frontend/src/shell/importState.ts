import { create } from 'zustand';

/**
 * The "Import from TrueReplayer 2" dialog (Tr2Import in the engine): from the first-run screen's
 * card, or the row in Settings › General. Small on purpose — the dialog itself loads only when it opens.
 */
export const useImport = create<{ open: boolean }>(() => ({ open: false }));

export const openImport = () => useImport.setState({ open: true });
export const closeImport = () => useImport.setState({ open: false });
