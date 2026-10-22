import { create } from 'zustand';
import type { LibraryDialogState } from './library/LibraryDialogs';

/**
 * What the zones of the shell ask of each other, apart from the engine's state: the library and
 * the macro header share the macro's menu and its dialogs, and "New macro" hands the name to the
 * header to type.
 */
interface ShellUi {
  /** The dialog open over the shell. The library renders it, whichever zone opened it. */
  dialog: LibraryDialogState | null;
  /** The macro whose name the header takes the focus for once it is the open one. */
  nameFocus: string | null;
}

export const useUi = create<ShellUi>(() => ({ dialog: null, nameFocus: null }));

export const openDialog = (dialog: LibraryDialogState) => useUi.setState({ dialog });
export const closeDialog = () => useUi.setState({ dialog: null });
export const focusName = (name: string) => useUi.setState({ nameFocus: name });
export const nameFocused = () => useUi.setState({ nameFocus: null });
