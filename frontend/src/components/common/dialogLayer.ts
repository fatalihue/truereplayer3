import { createContext, useContext } from 'react';

/**
 * Which DialogShell a floating layer belongs to.
 *
 * A chip popover or a name prompt is a portal at the end of <body>: outside its dialog's card in
 * the DOM, inside it in the React tree. DialogShell's Tab trap pulls such layers into its ring by
 * their data-dialog-layer attribute, and it used to take EVERY layer in the document — so with a
 * second dialog on top (the Insert Text "Unsaved text" prompt), Tab in the top one cycled into
 * the name prompt of the dialog underneath. Each shell now provides its own id, a layer carries
 * the id of the shell it was rendered in, and a shell only rings its own. '' outside any shell.
 */
export const DialogLayerContext = createContext('');

/** The value for a layer's data-dialog-layer attribute. */
export function useDialogLayer(): string {
  return useContext(DialogLayerContext);
}
