/**
 * A modal is up — a DialogShell card, or the update splash while it shows: the only two
 * role="dialog" aria-modal="true" elements (the Sheet and the command palette are not modal
 * dialogs).
 *
 * While one is, it owns the keyboard: the app-level shortcuts that change the action list (the
 * Toolbar's Ctrl+V, Alt+↑/↓ and the Ctrl+Z/Y funnel) and Ctrl+K stand down. Those listeners sit
 * on `window`, and a modal only stops Esc, Tab and a bare Enter from reaching them — so a key
 * pressed with the focus on one of the dialog's buttons changed the list behind the scrim.
 */
export function isModalDialogOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}
