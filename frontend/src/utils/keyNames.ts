/**
 * How a key NAME is shown, everywhere. The hook, KeyUtils.cs, the profiles and the settings
 * store the canonical names ("PageDown", "Ctrl+PageUp"); that is DATA and never changes.
 * Display goes through this one table so the grid's Details column, the sheet's Key field,
 * the keycaps (KbdTag, KeyCaps), the capture dialogs, the profile list and the menus all
 * spell a key the way the physical keycap does: PgDn, not "PageDown" nor "Page Down".
 * Decided with the owner on 2026-09-05, family-wide (Esc, Del, Ins, PrtSc, ScrLk, NumLk, Caps).
 *
 * Only the long names are shortened; everything else (F5, Enter, Home, Num+, letters) passes
 * through unchanged. The spaced forms and the old enum names (Prior/Next) are accepted too, so
 * an older spelling that reaches a chip lands on the same keycap.
 */
const COMPACT_KEY: Record<string, string> = {
  PageUp: 'PgUp', 'Page Up': 'PgUp', Prior: 'PgUp',
  PageDown: 'PgDn', 'Page Down': 'PgDn', Next: 'PgDn',
  ScrollLock: 'ScrLk', 'Scroll Lock': 'ScrLk',
  CapsLock: 'Caps', 'Caps Lock': 'Caps',
  NumLock: 'NumLk', 'Num Lock': 'NumLk',
  PrintScreen: 'PrtSc', 'Print Screen': 'PrtSc',
  Insert: 'Ins',
  Delete: 'Del',
  Escape: 'Esc',
};

export const compactKey = (key: string): string => COMPACT_KEY[key] ?? key;
