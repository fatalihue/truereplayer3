import { create } from 'zustand';
import type { LibraryDialogState } from './library/LibraryDialogs';

/**
 * What the zones of the shell ask of each other, apart from the engine's state: the library and
 * the macro header share the macro's menu and its dialogs, and "New macro" hands the name to the
 * header to type. Ctrl+K reaches the same doors: the library's import, the extension's dialog.
 */
interface ShellUi {
  /** The dialog open over the shell. The library renders it, whichever zone opened it. */
  dialog: LibraryDialogState | null;
  /** The macro whose name the header takes the focus for once it is the open one. */
  nameFocus: string | null;
  /** The library laid over the steps while the window keeps it folded or hidden (a peek). */
  libraryPeek: boolean;
  /** The extension's dialog, open from the status bar or Ctrl+K. */
  extensionHelp: boolean;
  /** Starts an import, from wherever it was asked: the library holds the import's own dialogs. */
  startImport: (() => void) | null;
}

export const useUi = create<ShellUi>(() => ({ dialog: null, nameFocus: null, libraryPeek: false, extensionHelp: false, startImport: null }));

export const openDialog = (dialog: LibraryDialogState) => useUi.setState({ dialog });
export const closeDialog = () => useUi.setState({ dialog: null });
export const focusName = (name: string) => useUi.setState({ nameFocus: name });
export const nameFocused = () => useUi.setState({ nameFocus: null });
export const setLibraryPeek = (libraryPeek: boolean) => useUi.setState({ libraryPeek });
export const setExtensionHelp = (extensionHelp: boolean) => useUi.setState({ extensionHelp });

// The extension's dialog of today (copy the folder, load it unpacked), until Settings › Browser
// extension exists (phase 3). Its code comes when it is first opened.
export const loadExtensionHelp = () => import('../components/ExtensionHelpDialog');
