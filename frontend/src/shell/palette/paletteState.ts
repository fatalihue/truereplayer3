import { create } from 'zustand';

/**
 * ① Ctrl+K — "busca tudo: macros, passos e todos os comandos, com atalho". Open from the title bar's
 * search and from Ctrl+K anywhere, inside a text field too, but not over a modal dialog.
 */
export const usePalette = create<{ open: boolean }>(() => ({ open: false }));

export const palette = {
  open: () => usePalette.setState({ open: true }),
  close: () => usePalette.setState({ open: false }),
  toggle: () => usePalette.setState(s => ({ open: !s.open })),
};

/** The palette's code (rule 6): it loads when the pointer or the focus reaches the search, or on Ctrl+K. */
export const loadPalette = () => import('./CommandPalette');
