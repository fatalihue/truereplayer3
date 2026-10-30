import type { ComponentType } from 'react';
import { create } from 'zustand';
import type { LibraryDialogState } from './library/LibraryDialogs';

/**
 * What the zones of the shell ask of each other, apart from the engine's state: the destination on
 * screen, the library and the macro header share the macro's menu and its dialogs, and "New macro"
 * hands the name to the header to type. Ctrl+K reaches the same doors: the library's import,
 * Settings and its categories.
 */
interface ShellUi {
  /**
   * ② The destination on screen. The macros' screen stays mounted under the others, so coming back
   * finds it as it was; the other pages come in their own chunks and go when left (phase 3).
   */
  page: Page;
  /** The Settings category shown, kept while the page is away. */
  settingsCategory: SettingsCategory;
  /** The Settings search. A door to a category (Ctrl+K, the status bar, the tray) clears it, so the category shows. */
  settingsQuery: string;
  /** "Reset all settings…" asked from outside Settings (Ctrl+K): the page opens its confirmation. */
  settingsReset: boolean;
  /** "New remap" asked from outside Key Remaps (Ctrl+K): the page opens a new rule in its panel. */
  remapNew: boolean;
  /**
   * Automations asked from outside its page: New automation (Ctrl+K) asks for the macro; one macro's
   * (the Inspector) opens in the panel, made first by Add.
   */
  automationAsk: { kind: 'new' } | { kind: 'open' | 'create'; name: string } | null;
  /** The dialog open over the shell. The library renders it, whichever zone opened it. */
  dialog: LibraryDialogState | null;
  /** The macro whose name the header takes the focus for once it is the open one. */
  nameFocus: string | null;
  /** The library laid over the steps while the window keeps it folded or hidden (a peek). */
  libraryPeek: boolean;
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
  /** The open macro's view (⑥): its steps, or its Data Loop table. It stays as macros change. */
  macroTab: MacroTab;
  /** Below 1024 px, the Data Loop settings asked for: they lie over the table until closed. */
  dataSettings: boolean;
  /** What the dock says on the Data Loop tab (the cell editor's keys), or null for its usual line. */
  dataHint: string | null;
}

export type SettingsSection = 'hotkey' | 'hotstring' | 'target' | 'info';
export type MacroTab = 'steps' | 'data';
/** The rail's destinations. */
export type Page = 'macros' | 'clicker' | 'automations' | 'remaps' | 'settings';
export type SettingsCategory = 'general' | 'hotkeys' | 'appearance' | 'recording' | 'screen' | 'browser' | 'diagnostics';

export const useUi = create<ShellUi>(() => ({
  page: 'macros', settingsCategory: 'general', settingsQuery: '', settingsReset: false, remapNew: false, automationAsk: null,
  dialog: null, nameFocus: null, libraryPeek: false, startImport: null, settingsOpen: false, settingsFocus: null,
  expanded: false, crop: null, macroTab: 'steps', dataSettings: false, dataHint: null,
}));

/** Another destination on screen. The macros' library peek goes with them. */
export const openPage = (page: Page) => {
  if (useUi.getState().page !== page) useUi.setState({ page, libraryPeek: false });
};
/** Settings, at a category: the rail, Ctrl+K, the status bar's extension, the tray's Browser extension…. */
export const openSettings = (category?: SettingsCategory) =>
  useUi.setState(category ? { page: 'settings', settingsCategory: category, settingsQuery: '', libraryPeek: false } : { page: 'settings', libraryPeek: false });
/**
 * The pages besides the macros', each in a chunk of its own that the rail's pointer or focus brings
 * (rule 6): the Clicker with its presets and settings, Automations with its table and "Automation
 * settings", Settings with its categories, Key Remaps with its list and "Remap settings". A page's
 * module has the page as its default export.
 */
export const PAGE_CHUNKS: Record<Exclude<Page, 'macros'>, () => Promise<{ default: ComponentType }>> = {
  clicker: () => import('./pages/clicker/ClickerPage'),
  automations: () => import('./pages/automations/AutomationsPage'),
  settings: () => import('./pages/settings/SettingsPage'),
  remaps: () => import('./pages/remaps/RemapsPage'),
};
export const loadSettingsPage = PAGE_CHUNKS.settings;

export const openDialog = (dialog: LibraryDialogState) => useUi.setState({ dialog });
export const closeDialog = () => useUi.setState({ dialog: null });
export const focusName = (name: string) => useUi.setState({ nameFocus: name });
export const nameFocused = () => useUi.setState({ nameFocus: null });
export const setLibraryPeek = (libraryPeek: boolean) => useUi.setState({ libraryPeek });
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
/** Steps or Data Loop. The expanded editor is the Steps tab's, and goes with it. */
export const showMacroTab = (macroTab: MacroTab) => {
  if (useUi.getState().macroTab === macroTab) return;
  useUi.setState({ macroTab, dataSettings: false, dataHint: null, expanded: false, crop: null });
};
// The Data Loop tab: its table, its tools in the insert row and its settings in the Inspector, in
// one chunk that comes when the tab is pointed at or opened (rule 6).
export const loadDataLoop = () => import('./data/DataLoop');
