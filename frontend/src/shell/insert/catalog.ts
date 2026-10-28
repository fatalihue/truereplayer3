import { inserts, type Insert } from './inserts';

/**
 * What the Add step catalog offers: the concept's 28 step types in seven groups, each with a line
 * that says what it does. The icon and the colours are the list's, from the step type it makes.
 * A type with no `insert` yet waits for its editor, and shows only in the development build.
 */
export type GroupId = 'input' | 'wait' | 'flow' | 'checks' | 'variables' | 'windows' | 'browser';

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'input', label: 'Input' },
  { id: 'wait', label: 'Wait' },
  { id: 'flow', label: 'Conditions and loops' },
  { id: 'checks', label: 'Checks and endings' },
  { id: 'variables', label: 'Variables' },
  { id: 'windows', label: 'Windows and macros' },
  { id: 'browser', label: 'Browser' },
];

export interface CatalogItem {
  id: string;
  name: string;
  desc: string;
  group: GroupId;
  /** The step type it makes. */
  type: string;
  /** The icon when it is not the step type's own. */
  icon?: string;
  /** More words the search knows it by. */
  words?: string;
  /** Means something only inside a While or a For Each Data Row (Break loop, Next iteration). */
  inLoop?: boolean;
  insert?: Insert;
}

const BROWSER = 'browser web page site extension element selector';

export const ITEMS: CatalogItem[] = [
  { id: 'click', group: 'input', type: 'LeftClick', name: 'Click', desc: 'A mouse click at a point or at the cursor', words: 'mouse left right middle double triple hold press tap', insert: inserts.click },
  // The Inspector captures the key, or holds the text, and the step is born with it.
  { id: 'key', group: 'input', type: 'Keystroke', name: 'Key', desc: 'A key or a combination, pressed or held', words: 'keystroke keyboard press hold shortcut hotkey combo', insert: inserts.key },
  { id: 'text', group: 'input', type: 'SendText', name: 'Text', desc: 'Types or pastes text, with tokens', words: 'send type paste write string message', insert: inserts.text },
  { id: 'scroll', group: 'input', type: 'ScrollDown', name: 'Scroll', desc: 'Turns the mouse wheel up or down', words: 'wheel mouse up down', insert: inserts.scroll },

  { id: 'pause', group: 'wait', type: 'Pause', name: 'Pause', desc: 'Wait for a key or a timeout', words: 'delay sleep time timeout resume hold', insert: inserts.pause },
  { id: 'waitImage', group: 'wait', type: 'WaitImage', name: 'Wait Image', desc: 'Until an image shows up on screen', words: 'picture screenshot find appear capture', insert: inserts.waitImage },
  { id: 'waitPixel', group: 'wait', type: 'WaitPixelColor', name: 'Wait Pixel Color', desc: 'Until a point on screen turns a color', words: 'pixel colour point', insert: inserts.waitPixel },
  { id: 'waitText', group: 'wait', type: 'WaitText', name: 'Wait Text', desc: 'Until text shows up on screen, read by OCR', words: 'ocr read screen disappear change', insert: inserts.waitText },
  // The condition is chosen in the Inspector's Check list, as an If's (casca-031 to 036).
  { id: 'waitUntil', group: 'wait', type: 'Assert', icon: 'clock', name: 'Wait until…', desc: 'Window open, process, clipboard, variable, file or time', words: 'condition state', insert: inserts.waitUntil },

  // The check is chosen in the Inspector, and the block is born with it.
  { id: 'if', group: 'flow', type: 'If', name: 'If', desc: 'Runs the steps inside only when a check passes', words: 'condition branch check else image pixel window', insert: inserts.if },
  { id: 'while', group: 'flow', type: 'While', name: 'While', desc: 'Repeats the steps inside while a check passes', words: 'loop repeat until condition', insert: inserts.while },
  { id: 'forEachRow', group: 'flow', type: 'ForEachRow', name: 'For Each Data Row', desc: 'Repeats the steps inside once per Data Loop row', words: 'loop table rows csv', insert: inserts.forEachRow },
  { id: 'break', group: 'flow', type: 'BreakLoop', name: 'Break loop', desc: 'Leaves the loop it is in', words: 'exit stop', inLoop: true, insert: inserts.breakLoop },
  { id: 'next', group: 'flow', type: 'ContinueLoop', name: 'Next iteration', desc: 'Skips to the next pass of the loop', words: 'continue skip', inLoop: true, insert: inserts.nextIteration },

  { id: 'assert', group: 'checks', type: 'Assert', name: 'Assert', desc: 'Stops the run when a check fails', words: 'require verify condition fail', insert: inserts.assert },
  { id: 'stop', group: 'checks', type: 'Stop', name: 'Stop', desc: 'Ends the run here', words: 'end halt finish', insert: inserts.stop },
  { id: 'return', group: 'checks', type: 'Return', name: 'Return', desc: 'Ends this pass, or goes back to the macro that ran it', words: 'exit back', insert: inserts.return },

  { id: 'setVariable', group: 'variables', type: 'SetVariable', name: 'Set Variable', desc: 'Stores a value under a name', words: 'var value counter cycle screen ocr', insert: inserts.setVariable },
  { id: 'copyToSlot', group: 'variables', type: 'CopyToSlot', name: 'Copy to Slot', desc: 'Copies the selection of the app in front into a named slot', words: 'clipboard copy clip', insert: inserts.copyToSlot },

  { id: 'activateWindow', group: 'windows', type: 'ActivateWindow', name: 'Activate Window', desc: 'Brings a window to the front, or opens it', words: 'focus app program launch maximize minimize close', insert: inserts.activateWindow },
  // The macro is chosen in the Inspector, and the step is born with it; a macro dragged from the
  // library onto the steps makes one too.
  { id: 'runMacro', group: 'windows', type: 'RunProfile', name: 'Run Macro', desc: 'Runs another macro, then comes back', words: 'profile call sub chain', insert: inserts.runMacro },

  // Born empty, and filled in the Inspector: the address, or the element (Pick element) and the rest.
  { id: 'openUrl', group: 'browser', type: 'BrowserNavigate', name: 'Open URL', desc: 'Opens a page in the browser', words: `${BROWSER} url link website navigate`, insert: inserts.openUrl },
  { id: 'clickElement', group: 'browser', type: 'BrowserClick', name: 'Click Element', desc: 'Clicks an element of the page', words: BROWSER, insert: inserts.clickElement },
  { id: 'rightClickElement', group: 'browser', type: 'BrowserRightClick', name: 'Right Click Element', desc: 'Right-clicks an element of the page', words: BROWSER, insert: inserts.rightClickElement },
  { id: 'typeText', group: 'browser', type: 'BrowserType', name: 'Type Text', desc: 'Types into a field of the page', words: BROWSER, insert: inserts.typeText },
  { id: 'selectOption', group: 'browser', type: 'BrowserSelectOption', name: 'Select Option', desc: 'Picks an option in a list of the page', words: `${BROWSER} dropdown`, insert: inserts.selectOption },
  { id: 'waitElement', group: 'browser', type: 'BrowserWaitElement', name: 'Wait Element', desc: 'Until an element shows up on the page', words: BROWSER, insert: inserts.waitElement },
  { id: 'assertElement', group: 'browser', type: 'BrowserAssert', name: 'Assert Element', desc: 'Stops the run when the page lacks an element', words: BROWSER, insert: inserts.assertElement },
];

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
const tokens = (item: CatalogItem) => fold(`${item.name} ${item.desc} ${item.words ?? ''}`).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The items that answer a search: every word typed starts one of the item's words (its name, its
 * line or the words it is known by). A name that starts with what was typed comes first, then a
 * name that has it, then the rest, each in the catalog's order.
 */
export function search(items: CatalogItem[], query: string): CatalogItem[] {
  const q = fold(query.trim());
  const words = q.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return items;
  const rank = (item: CatalogItem) => {
    const name = fold(item.name);
    return name.startsWith(q) ? 0 : name.split(/\s+/).some(w => w.startsWith(words[0])) ? 1 : 2;
  };
  return items
    .filter(item => { const t = tokens(item); return words.every(w => t.some(k => k.startsWith(w))); })
    .map((item, order) => ({ item, order, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(x => x.item);
}
