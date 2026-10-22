import { useMemo } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { OutgoingMessage } from '../bridge/messageTypes';

type PayloadOf<T extends OutgoingMessage['type']> = Extract<OutgoingMessage, { type: T }>['payload'];

/**
 * The macro library and the open macro's own settings (triggers, window target, info), as
 * commands. The engine answers with profiles:updated for the library and the usual pushes for the
 * open macro. The protocol still says "profile": only the interface says "macro" (decision 3).
 * The window-target and geometry writes take the message's own payload, which the editors build.
 */
export function useMacro() {
  const { send } = useBridge();
  return useMemo(() => ({
    // ── opening and saving ──
    /**
     * Opens a macro — or CLOSES it when it is the one already open: profile:click toggles. That is
     * the "no macro open" state decision D1 retires; the new shell opens through `open`.
     */
    click: (name: string) => send({ type: 'profile:click', payload: { name } }),
    /** Opens a macro and never closes the open one (D1). Opening the macro already open does nothing. */
    open: (name: string) => send({ type: 'profile:open', payload: { name } }),
    /**
     * "Revert to when I opened it": the open macro goes back to its file as it was when opened,
     * and the edits since (with their undo history) are dropped. Answers profile:reverted.
     */
    revert: () => send({ type: 'profile:revert', payload: {} }),
    save: () => send({ type: 'profile:save', payload: {} }),
    load: () => send({ type: 'profile:load', payload: {} }),
    /** Resets the app's settings to the defaults, after a native confirmation — and clears the steps. useSettings().resetAll is the reset that keeps them (D23). */
    reset: () => send({ type: 'profile:reset', payload: {} }),

    // ── the library ──
    create: (name: string, folder?: string | null) => send({ type: 'profile:create', payload: { name, folder: folder || undefined } }),
    rename: (oldName: string, newName: string) => send({ type: 'profile:rename', payload: { oldName, newName } }),
    duplicate: (name: string) => send({ type: 'profile:duplicate', payload: { name } }),
    remove: (name: string) => send({ type: 'profile:delete', payload: { name } }),
    toggleDisabled: (name: string) => send({ type: 'profile:toggleDisable', payload: { name } }),
    pin: (name: string) => send({ type: 'profile:pin', payload: { name } }),
    unpin: (name: string) => send({ type: 'profile:unpin', payload: { name } }),
    /** null takes the macro out of its folder. */
    moveToFolder: (profileName: string, folderName: string | null) => send({ type: 'profile:moveToFolder', payload: { profileName, folderName } }),
    reorder: (folders: NonNullable<PayloadOf<'profile:reorder'>['folders']>) => send({ type: 'profile:reorder', payload: { folders } }),
    /** Shows a macro's file in Explorer, or the Profiles folder with no name. */
    openFolder: (name?: string) => send({ type: 'profile:openFolder', payload: name === undefined ? {} : { name } }),

    // ── folders ──
    createFolder: (name: string, color?: string) => send({ type: 'profile:createFolder', payload: { name, color } }),
    renameFolder: (oldName: string, newName: string) => send({ type: 'profile:renameFolder', payload: { oldName, newName } }),
    deleteFolder: (name: string) => send({ type: 'profile:deleteFolder', payload: { name } }),
    setFolderColor: (name: string, color: string) => send({ type: 'profile:setFolderColor', payload: { name, color } }),
    toggleFolderCollapsed: (name: string) => send({ type: 'profile:toggleFolderCollapse', payload: { name } }),
    setAllFoldersCollapsed: (collapsed: boolean) => send({ type: 'profile:setAllFoldersCollapsed', payload: { collapsed } }),
    toggleFolderDisabled: (name: string) => send({ type: 'profile:toggleFolderDisable', payload: { name } }),

    // ── triggers ──
    assignHotkey: (name: string, hotkey: string, mode?: PayloadOf<'profile:assignHotkey'>['mode']) =>
      send({ type: 'profile:assignHotkey', payload: { name, hotkey, mode } }),
    removeHotkey: (name: string) => send({ type: 'profile:removeHotkey', payload: { name } }),
    assignHotstring: (name: string, sequence: string, instant: boolean) =>
      send({ type: 'profile:assignHotstring', payload: { name, sequence, instant } }),
    removeHotstring: (name: string) => send({ type: 'profile:removeHotstring', payload: { name } }),

    // ── window target ──
    setWindowTarget: (payload: PayloadOf<'profile:setWindowTarget'>) => send({ type: 'profile:setWindowTarget', payload }),
    removeWindowTarget: (name: string) => send({ type: 'profile:removeWindowTarget', payload: { name } }),
    setFolderWindowTarget: (payload: PayloadOf<'profile:setFolderWindowTarget'>) => send({ type: 'profile:setFolderWindowTarget', payload }),
    removeFolderWindowTarget: (folderName: string) => send({ type: 'profile:removeFolderWindowTarget', payload: { folderName } }),
    /** Captures the target window's current position and size (for Restore position / size). */
    updateWindowSize: (payload: PayloadOf<'profile:updateWindowSize'>) => send({ type: 'profile:updateWindowSize', payload }),
    /** Converts the steps' coordinates; with a name, only while that macro is still the open one. */
    convertCoordinates: (direction: 'toRelative' | 'toAbsolute', name?: string) =>
      send({ type: 'profile:convertCoordinates', payload: name === undefined ? { direction } : { direction, name } }),
    /** Tests a window match now. The answer arrives as windowTarget:testResult. */
    testWindowMatch: (payload: PayloadOf<'profile:testWindowMatch'>) => send({ type: 'profile:testWindowMatch', payload }),

    // ── info ──
    /** Asks for a macro's description, tags and icon, and for every tag in use (for suggestions). */
    requestInfo: (name: string) => {
      send({ type: 'profile:getMetadata', payload: { name } });
      send({ type: 'profile:listTags', payload: {} });
    },
    setInfo: (payload: PayloadOf<'profile:setMetadata'>) => send({ type: 'profile:setMetadata', payload }),

    // ── import and export ──
    /** Opens the file picker; the parsed file comes back for the preview. */
    startImport: () => send({ type: 'profile:import', payload: {} }),
    /** "Don't show again" on the import security warning. */
    acknowledgeImportWarning: () => send({ type: 'settings:acknowledgeImportWarning', payload: {} }),
    confirmImport: (selectedNames: string[], conflictResolutions: PayloadOf<'profile:confirmImport'>['conflictResolutions']) =>
      send({ type: 'profile:confirmImport', payload: { selectedNames, conflictResolutions } }),
    /** Drops the parsed import the engine is holding. */
    cancelImport: () => send({ type: 'profile:cancelImport', payload: {} }),
    /** Exports the named macros; the sub-macros they run go along. */
    exportMacros: (names: string[], includeOrganization: boolean) =>
      send({ type: 'profile:export', payload: { names, includeOrganization, includeDependencies: true } }),
    /** Shows an exported file in Explorer. Only the id travels — the engine keeps the paths. */
    revealExport: (exportId: number) => send({ type: 'file:revealExport', payload: { exportId } }),
  }), [send]);
}
