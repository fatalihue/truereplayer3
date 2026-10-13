import type { ActionItem } from '../bridge/messageTypes';
import { carriesConditionProbe } from './conditionalBlocks';
import { compactKey } from './keyNames';

// Raw key names as older profiles and the hook report them (numeric VK codes, WinForms enum
// names, Oem*) -> the canonical KeyUtils.cs name. getDisplayKey then applies the keycap
// spelling from utils/keyNames (PageDown -> PgDn), the same table KbdTag and KeyCaps use.
const DISPLAY_KEY_MAP: Record<string, string> = {
  '162': 'Ctrl', '163': 'Ctrl',
  '160': 'Shift', '161': 'Shift',
  '20': 'CapsLock', '144': 'NumLock', '145': 'ScrollLock',
  '91': 'Win', '92': 'Win',
  '164': 'Alt', '165': 'Alt', 'Menu': 'Alt',
  'Oem1': ';', 'Oem2': '/', 'Oem3': '`',
  'Oem4': '[', 'Oem5': '\\', 'Oem6': ']', 'Oem7': "'",
  'OemComma': ',', 'OemPeriod': '.',
  'OemMinus': '-', 'OemPlus': '=',
  'NumMultiply': 'Num*', 'NumDivide': 'Num/',
  'NumAdd': 'Num+', 'NumSubtract': 'Num-',
  'Return': 'Enter', 'Back': 'Backspace',
  'Capital': 'CapsLock',
  'Next': 'PageDown', 'Prior': 'PageUp',
};

/**
 * Types that carry no coordinate of their OWN — a row of one of these shows a blank X/Y instead
 * of the 0,0 its record happens to hold. EXPORTED because the Sheet needs the same answer to
 * decide whether to draw the Position controls, and it used to keep a byte-identical copy of this
 * list: two sets, 33 members each, that agreed only by hand. `ActionItem.NoCoordinateActionTypes`
 * on the C# side is the remaining mirror and cannot be shared across the language boundary — a
 * type added here belongs there in the same commit, and WaitPixelColor is the one that proved it.
 */
export const NO_COORD_TYPES = new Set(['Assert', 'KeyDown', 'KeyUp', 'Keystroke', 'HoldKey', 'ScrollUp', 'ScrollDown', 'SendText', 'SetVariable', 'CopyToSlot', 'ActivateWindow', 'WaitImage', 'WaitPixelColor', 'WaitText', 'BrowserClick', 'BrowserRightClick', 'BrowserType', 'BrowserWaitElement', 'BrowserNavigate', 'BrowserSelectOption', 'BrowserAssert', 'RunProfile', 'Pause', 'If', 'ElseIf', 'Else', 'EndIf', 'Stop', 'Return', 'While', 'EndLoop', 'BreakLoop', 'ContinueLoop', 'ForEachRow']);

export function getDisplayKey(key: string): string {
  if (!key) return '';
  if (key.startsWith('D') && key.length === 2 && /\d/.test(key[1])) return key[1];
  return compactKey(DISPLAY_KEY_MAP[key] ?? key);
}

// Space the '+' separators in a keystroke combo for readability in the grid:
// "Ctrl+Alt+F" → "Ctrl + Alt + F" (matches the ProfilePanel hotkey chips). Each
// part is run through getDisplayKey so raw enum names get the DISPLAY_KEY_MAP
// cleanup — a single "NumAdd" renders "Num+", "D1" renders "1" — matching how the
// HoldKey row (which uses getDisplayKey directly) shows the same key. A lone '+'
// key and a trailing literal '+' (e.g. "Ctrl++") are kept intact, same split rule
// as KbdTag.
export function formatKeyCombo(combo: string): string {
  if (!combo) return '';
  if (combo === '+') return '+';
  const parts = combo
    .split('+')
    .map((p, i, arr) => (p === '' && i === arr.length - 1 ? '+' : p))
    .filter(p => p !== '')
    .map(getDisplayKey);
  return parts.join(' + ');
}

// Format a millisecond value for display with locale thousands separators, so a
// large delay reads at a glance: 30000 → "30.000" (pt-BR) / "30,000" (en). Values
// under 1000 render as bare integers. The separator follows the UI language toggle
// on purpose — a hardcoded "." would read as a decimal to an English user, and a
// "," would to a Brazilian one. The unit ("ms") is added by the caller so it can be
// styled as a separate quiet suffix. Floats are truncated; NaN/±∞ fall back to 0.
export function formatMs(ms: number, language: 'en' | 'pt-BR'): string {
  const n = Number.isFinite(ms) ? Math.trunc(ms) : 0;
  return n.toLocaleString(language === 'pt-BR' ? 'pt-BR' : 'en-US');
}

// Pixel-coordinate display applies to the standalone WaitPixelColor action AND
// to IF rows whose condition is PixelColorMatch — both store the watched point
// in pixelX/pixelY and show it in the Details column.
function showsPixelCoords(item: ActionItem): boolean {
  return item.actionType === 'WaitPixelColor'
    || (carriesConditionProbe(item.actionType) && item.conditionType === 'PixelColorMatch');
}

// The combined click types — mirrors ActionItem.IsCombinedClickType on the C# side.
// Only these read the at-cursor flag, so only these may blank their coordinates because of it.
// The *ClickHold family is here for the same reason it is there: the row owns a whole
// press→release, and its replay case resolves the at-cursor point once per cycle.
const COMBINED_CLICK_TYPES = new Set([
  'LeftClick', 'RightClick', 'MiddleClick', 'DoubleClick', 'TripleClick',
  'LeftClickHold', 'RightClickHold', 'MiddleClickHold',
]);

/** Mirrors C# ActionItem.IsCombinedClickType — "this row owns a whole press→release".
 *  Exported so the grid's at-cursor icon and × N badge ask the SAME question this file
 *  asks when blanking coordinates, instead of each carrying its own regex of click names
 *  (which is how one of them learned a new type and the others didn't). */
export const isCombinedClick = (actionType: string): boolean =>
  COMBINED_CLICK_TYPES.has(actionType);

/** The press-hold-release family — a combined click whose two halves are separated by
 *  HoldDurationMs. Kept apart from isCombinedClick because a few surfaces need exactly
 *  these three: the "<n> ms" Details payload, and the button-family pickers. */
export const isClickHold = (actionType: string): boolean =>
  actionType === 'LeftClickHold' || actionType === 'RightClickHold' || actionType === 'MiddleClickHold';

// The combined set PLUS the six paired halves — every click row that OWNS a coordinate.
// Mirrors C# ActionItem.IsCoordinateClickType, and asks that predicate's question: "does
// moving this row's X/Y move where it clicks?"
const COORDINATE_CLICK_TYPES = new Set([
  ...COMBINED_CLICK_TYPES,
  'LeftClickDown', 'LeftClickUp',
  'RightClickDown', 'RightClickUp',
  'MiddleClickDown', 'MiddleClickUp',
]);

/** Mirrors C# ActionItem.IsCoordinateClickType. Exists because the two row-menu entries that
 *  act on a click's POINT — Pick from screen and Copy Coordinates — each carried their own
 *  regex, and the regexes disagreed: Copy's `^(Left|Right|Middle)Click(Down|Up|Hold)?$` left
 *  Double/Triple out, so a DoubleClick row offered Pick and refused Copy. Exactly the drift
 *  the note on isCombinedClick warns about, one predicate later. A Set rather than a regex
 *  for the same reason the sets above are: it cannot match a type that does not exist
 *  (the old pattern happily accepted "DoubleClickDown"). */
export const isCoordinateClick = (actionType: string): boolean =>
  COORDINATE_CLICK_TYPES.has(actionType);

/** The three plain combined clicks, and the ONLY rows the engine honours IsFocusClick on
 *  (ActionExecution's Double/Triple and *ClickHold cases ignore the flag on purpose — a focus
 *  tap after a multi-click or a hold would corrupt the gesture). Named here because the grid
 *  carried this same regex in THREE places: the pill indicator, the menu entry's gate, and the
 *  selection filter behind it. Deliberately NOT folded into isCoordinateClick — it answers a
 *  different question and has to stay free to diverge. */
export const isFocusClickEligible = (actionType: string): boolean =>
  actionType === 'LeftClick' || actionType === 'RightClick' || actionType === 'MiddleClick';

/**
 * The eight combined click types, IN THE ORDER THAT IS THE GROUPING: the three real BUTTONS,
 * then the same three HELD one line down, then the left-button MULTI-CLICK variants. Two axes
 * (which button vs how many clicks) are folded into one list and only the ordering keeps them
 * legible — Double/Triple are left-button actions, so listing them between Left and Right made
 * them read as siblings of Right Click, which they are not. Do not interleave them again.
 *
 * Shared by the Sheet's ACTION TYPE picker and the row menu's "Change click type" submenu. It
 * lived only in SheetPanel until 2026-09-16; a second copy in the menu would be two lists that
 * must agree about every future click type, and the first label edit would end that.
 */
export const CLICK_FAMILY_TYPES: { value: string; label: string }[] = [
  { value: 'LeftClick', label: 'Left Click' },
  { value: 'RightClick', label: 'Right Click' },
  { value: 'MiddleClick', label: 'Middle Click' },
  { value: 'LeftClickHold', label: 'Hold Left' },
  { value: 'RightClickHold', label: 'Hold Right' },
  { value: 'MiddleClickHold', label: 'Hold Middle' },
  { value: 'DoubleClick', label: 'Double Click' },
  { value: 'TripleClick', label: 'Triple Click' },
];

/**
 * Which SHAPE a click row is written in: a paired half, or one row that owns the whole press.
 * '' means combined (a hold is combined — it owns press→release, the wait is in the middle).
 * The type pickers use it to keep a half a half when the user switches which button it is.
 */
export const clickFormOf = (actionType: string): '' | 'Down' | 'Up' =>
  actionType.endsWith('ClickDown') ? 'Down'
  : actionType.endsWith('ClickUp') ? 'Up'
  : '';

// An at-cursor click HAS an x/y on disk, but the replay resolves its point from the live mouse
// and never reads them — showing the stored numbers would be a phantom coordinate, the exact
// thing NO_COORD_TYPES exists to prevent. This half is per-ROW, which is why it can't live in
// that set. Mirrors the `AtCursor && IsCombinedClickType` half of C# ActionItem.HideCoordinates.
const hidesCoordsForCursor = (item: ActionItem): boolean =>
  !!item.atCursor && COMBINED_CLICK_TYPES.has(item.actionType);

export function getDisplayX(item: ActionItem): string {
  // Pixel probes (WaitPixelColor / IF PixelColorMatch) borrow the pixel coords
  // for display — mirrors the C# ActionItem.DisplayX override. Image conditions
  // stay blank (the matched-rect is dynamic per probe, no single XY).
  if (showsPixelCoords(item)) {
    return item.pixelX != null ? String(item.pixelX) : '';
  }
  if (hidesCoordsForCursor(item)) return '';
  return NO_COORD_TYPES.has(item.actionType) ? '' : String(item.x);
}

export function getDisplayY(item: ActionItem): string {
  if (showsPixelCoords(item)) {
    return item.pixelY != null ? String(item.pixelY) : '';
  }
  if (hidesCoordsForCursor(item)) return '';
  return NO_COORD_TYPES.has(item.actionType) ? '' : String(item.y);
}

// Resolved-color tuple cached per action type. The values themselves are CSS
// var() references — they're token strings, not actual colors — so caching is
// safe across theme changes (the variable resolves at paint time, not at
// JS-string-construction time). Keyed by raw `actionType` string so all of
// "BrowserClick", "BrowserType", etc. share the Browser entry via the
// startsWith check below. Allocates ~12 objects total instead of one per row
// per render — meaningful when rendering a 500+ row grid where the function
// was being called for every iteration of actions.map.
const ACTION_COLOR_CACHE: Map<string, { bg: string; fg: string }> = new Map();

function computeActionTypeColors(actionType: string): { bg: string; fg: string } {
  // Check conditional types first — they share a single token regardless of which
  // marker (If / ElseIf / Else / EndIf) so the whole block reads as one cohesive surface.
  if (actionType === 'If' || actionType === 'ElseIf' || actionType === 'Else' || actionType === 'EndIf')
    return { bg: 'var(--color-action-if-bg)', fg: 'var(--color-action-if-fg)' };
  // Loop family: dedicated tokens with the If fallback — zero work across the 37 themes
  // now, and any theme can opt into a distinct loop tint later (the ActivateWindow mold).
  // The family shares the If hue deliberately: a While IS a condition row.
  if (actionType === 'While' || actionType === 'EndLoop'
      || actionType === 'BreakLoop' || actionType === 'ContinueLoop' || actionType === 'ForEachRow')
    return {
      bg: 'var(--color-action-loop-bg, var(--color-action-if-bg))',
      fg: 'var(--color-action-loop-fg, var(--color-action-if-fg))',
    };
  // Desktop Assert shares the If hue: it runs the SAME condition probes, so the grid reads the
  // two as one family. A dedicated token would have to be added to all 48 theme presets for a
  // single action — the same trade-off the CopyToSlot and ActivateWindow entries below record.
  if (actionType === 'Assert')
    return { bg: 'var(--color-action-if-bg)', fg: 'var(--color-action-if-fg)' };
  // Flow leaves (Stop / Return): dedicated tokens with a pause fallback so every theme
  // works untouched — the ActivateWindow opt-in mold below. Placed ABOVE the greedy
  // substring matchers on principle (none catches these two today, but the order is
  // what keeps that true tomorrow).
  if (actionType === 'Stop' || actionType === 'Return')
    return {
      bg: 'var(--color-action-flow-bg, var(--color-action-pause-bg))',
      fg: 'var(--color-action-flow-fg, var(--color-action-pause-fg))',
    };
  if (actionType.startsWith('Browser'))
    return { bg: 'var(--color-action-browser-bg)', fg: 'var(--color-action-browser-fg)' };
  if (actionType.includes('Click'))
    return { bg: 'var(--color-action-mouse-bg)', fg: 'var(--color-action-mouse-fg)' };
  if (actionType.includes('Scroll'))
    return { bg: 'var(--color-action-scroll-bg)', fg: 'var(--color-action-scroll-fg)' };
  if (actionType.startsWith('Key') || actionType === 'HoldKey')
    return { bg: 'var(--color-action-key-bg)', fg: 'var(--color-action-key-fg)' };
  if (actionType === 'SendText')
    return { bg: 'var(--color-action-sendtext-bg)', fg: 'var(--color-action-sendtext-fg)' };
  // SetVariable has its own magenta token now (it used to share SendText's gold, which
  // made the two "text/data" actions look identical in the grid).
  // CopyToSlot shares it — both are run-state writers read back via {…} tokens,
  // and a dedicated theme token for a niche action would bloat all 40+ themes.
  if (actionType === 'SetVariable' || actionType === 'CopyToSlot')
    return { bg: 'var(--color-action-setvariable-bg)', fg: 'var(--color-action-setvariable-fg)' };
  // Wait family — Wait Image, Wait Pixel Color, Wait Text — is ONE hue, like the If, Loop and
  // Browser families: the grid reads the group, the glyph tells the three apart. The waitimage
  // token IS the family token (the Theme Editor labels it "Wait"); the old pixelcolor token is
  // still defined by the themes but no longer read.
  if (actionType === 'WaitImage' || actionType === 'WaitPixelColor' || actionType === 'WaitText')
    return { bg: 'var(--color-action-waitimage-bg)', fg: 'var(--color-action-waitimage-fg)' };
  if (actionType === 'RunProfile')
    return { bg: 'var(--color-action-runprofile-bg)', fg: 'var(--color-action-runprofile-fg)' };
  // ActivateWindow: dedicated tokens with a runprofile fallback so all 48 themes work
  // untouched — a theme can opt into a distinct tint later by defining the tokens.
  if (actionType === 'ActivateWindow')
    return {
      bg: 'var(--color-action-activatewindow-bg, var(--color-action-runprofile-bg))',
      fg: 'var(--color-action-activatewindow-fg, var(--color-action-runprofile-fg))',
    };
  if (actionType === 'Pause')
    return { bg: 'var(--color-action-pause-bg)', fg: 'var(--color-action-pause-fg)' };
  return { bg: 'transparent', fg: 'var(--color-text-tertiary)' };
}

export function getActionTypeColors(actionType: string): { bg: string; fg: string } {
  const cached = ACTION_COLOR_CACHE.get(actionType);
  if (cached) return cached;
  const result = computeActionTypeColors(actionType);
  ACTION_COLOR_CACHE.set(actionType, result);
  return result;
}

// NOTE: the icon mapping deliberately does NOT live here. The live renderer is
// ActionTable's ActionIcon component; a string-returning mirror used to sit in this
// file with ZERO call sites and silently drifted (it never learned Assert, and the
// Wave-2 flow icons briefly landed only there) — a dead mirror is a drift bomb, so
// it was removed rather than repaired.
