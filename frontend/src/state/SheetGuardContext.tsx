import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * The open Sheet's say over a change to the action LIST made from outside it — a paste, a
 * reorder, an undo/redo, a convert, a reset.
 *
 * Any of those re-seeds the sheet's fields from the store, so typed edits are gone the moment
 * the list changes. The sheet follows its row by Id (or closes when the row is gone), but that
 * cannot bring the typing back — so a door that changes the list asks FIRST, and gets the same
 * two steps as every other way out of a dirty editor: the first attempt arms the sheet's footer
 * warning and is refused, the same gesture repeated inside the window discards and goes ahead.
 *
 * `allowListChange()` answers true when the change may go ahead: no sheet open, a clean sheet,
 * or the repeat that discards. App is the only caller of `install` — it owns the sheet's handle.
 * Hand-written list of the doors that ask: the Toolbar's Ctrl+V, Alt+↑/↓ and the cmd:undo /
 * cmd:redo funnel, and the Command Palette's list rewrites. A new list-changing door that can
 * be reached while the sheet is open belongs on it.
 */
export interface SheetGuard {
  install: (fn: (() => boolean) | null) => void;
  allowListChange: () => boolean;
}

const noSheet: SheetGuard = { install: () => {}, allowListChange: () => true };
const SheetGuardContext = createContext<SheetGuard>(noSheet);

export function SheetGuardProvider({ children }: { children: ReactNode }) {
  // One object for the provider's lifetime: the doors read it from long-lived listeners.
  const [guard] = useState<SheetGuard>(() => {
    let installed: (() => boolean) | null = null;
    return {
      install: (fn) => { installed = fn; },
      allowListChange: () => (installed ? installed() : true),
    };
  });
  return (
    <SheetGuardContext.Provider value={guard}>
      {children}
    </SheetGuardContext.Provider>
  );
}

export function useSheetGuard() {
  return useContext(SheetGuardContext);
}
