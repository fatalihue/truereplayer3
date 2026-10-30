// Who this app is, in the page: the twin of Source/AppIdentity.cs (plan
// truereplayer3-paralelo-2026-10-30.md, decision 3). tools/identidade-gate.mjs fails the build when
// "TrueReplayer" names the app anywhere else in what ships. What both apps share keeps the family
// name: the browser extension, the macro file format and the "Requires TrueReplayer x.y.z" of a
// macro.

/** The name on screen. */
export const APP_NAME = 'TrueReplayer 3';

/** The folder name in Documents and in AppData\Local (AppIdentity.Id in the engine). */
export const APP_FOLDER = 'TrueReplayer3';

/** TrueReplayer 2, the app this one runs beside: named by the import and the one-at-a-time notice. */
export const TR2_NAME = 'TrueReplayer 2';
