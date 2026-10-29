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
  /**
   * The macro's settings asked for (Hotkey…, Hotstring…, Window target…, Edit info…): the Inspector shows them even
   * where it lies over the list, until a step is chosen or it is closed.
   */
  settingsOpen: boolean;
  /** The section to take the focus once the settings of that macro are on screen. */
  settingsFocus: { name: string; section: SettingsSection; seq: number } | null;
  /**
   * The Inspector expanded (Expand editor, on a Send Text): wide, with the Insert panel and the
   * preview beside the message, and the library folded into avatars. It lasts while the selection
   * stays on a Send Text.
   */
  expanded: boolean;
  /** The step whose reference image is being cropped, in the expanded Inspector. */
  crop: string | null;
}

export type SettingsSection = 'hotkey' | 'hotstring' | 'target' | 'info';

export const useUi = create<ShellUi>(() => ({
  dialog: null, nameFocus: null, libraryPeek: false, extensionHelp: false, startImport: null, settingsOpen: false, settingsFocus: null,
  expanded: false, crop: null,
}));

export const openDialog = (dialog: LibraryDialogState) => useUi.setState({ dialog });
export const closeDialog = () => useUi.setState({ dialog: null });
export const focusName = (name: string) => useUi.setState({ nameFocus: name });
export const nameFocused = () => useUi.setState({ nameFocus: null });
export const setLibraryPeek = (libraryPeek: boolean) => useUi.setState({ libraryPeek });
export const setExtensionHelp = (extensionHelp: boolean) => useUi.setState({ extensionHelp });
let settingsSeq = 0;
export const openMacroSettings = (name: string, section: SettingsSection) =>
  useUi.setState({ settingsOpen: true, settingsFocus: { name, section, seq: ++settingsSeq } });
export const closeMacroSettings = () => useUi.setState({ settingsOpen: false, settingsFocus: null });
export const settingsFocused = () => useUi.setState({ settingsFocus: null });
/** The Inspector as wide as an expanded editor: a Send Text expanded, or an image being cropped. */
export const inspectorWide = (s: ShellUi) => s.expanded || s.crop !== null;
export const expandInspector = () => useUi.setState({ expanded: true });
export const collapseInspector = () => {
  const s = useUi.getState();
  if (s.expanded || s.crop !== null) useUi.setState({ expanded: false, crop: null });
};
export const openCrop = (stepId: string) => useUi.setState({ crop: stepId });
export const closeCrop = () => { if (useUi.getState().crop !== null) useUi.setState({ crop: null }); };

// The extension's dialog of today (copy the folder, load it unpacked), until Settings › Browser
// extension exists (phase 3). Its code comes when it is first opened.
export const loadExtensionHelp = () => import('../components/ExtensionHelpDialog');
