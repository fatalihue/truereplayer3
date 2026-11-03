import { t } from '../../i18n';
import { inserts, type Insert } from './inserts';

/**
 * What the Add step catalog offers: the concept's 28 step types in seven groups, each with a line
 * that says what it does. The icon and the colours are the list's, from the step type it makes.
 * A type with no `insert` yet waits for its editor, and shows only in the development build.
 *
 * The names are the glossary's, the same in both languages (i18n/glossario.ts); the groups, the
 * lines and the words the search knows come from the catalog (i18n/<language>/insert.ts).
 */
export type GroupId = 'input' | 'wait' | 'flow' | 'checks' | 'variables' | 'windows' | 'browser';

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'input', label: t('insert.groups.input') },
  { id: 'wait', label: t('insert.groups.wait') },
  { id: 'flow', label: t('insert.groups.flow') },
  { id: 'checks', label: t('insert.groups.checks') },
  { id: 'variables', label: t('insert.groups.variables') },
  { id: 'windows', label: t('insert.groups.windows') },
  { id: 'browser', label: t('insert.groups.browser') },
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

export const ITEMS: CatalogItem[] = [
  { id: 'click', group: 'input', type: 'LeftClick', name: 'Click', desc: t('insert.desc.click'), words: t('insert.words.click'), insert: inserts.click },
  // The Inspector captures the key, or holds the text, and the step is born with it.
  { id: 'key', group: 'input', type: 'Keystroke', name: 'Key', desc: t('insert.desc.key'), words: t('insert.words.key'), insert: inserts.key },
  { id: 'text', group: 'input', type: 'SendText', name: 'Text', desc: t('insert.desc.text'), words: t('insert.words.text'), insert: inserts.text },
  { id: 'scroll', group: 'input', type: 'ScrollDown', name: 'Scroll', desc: t('insert.desc.scroll'), words: t('insert.words.scroll'), insert: inserts.scroll },

  { id: 'pause', group: 'wait', type: 'Pause', name: 'Pause', desc: t('insert.desc.pause'), words: t('insert.words.pause'), insert: inserts.pause },
  { id: 'waitImage', group: 'wait', type: 'WaitImage', name: 'Wait Image', desc: t('insert.desc.waitImage'), words: t('insert.words.waitImage'), insert: inserts.waitImage },
  { id: 'waitPixel', group: 'wait', type: 'WaitPixelColor', name: 'Wait Pixel Color', desc: t('insert.desc.waitPixel'), words: t('insert.words.waitPixel'), insert: inserts.waitPixel },
  { id: 'waitText', group: 'wait', type: 'WaitText', name: 'Wait Text', desc: t('insert.desc.waitText'), words: t('insert.words.waitText'), insert: inserts.waitText },
  // The condition is chosen in the Inspector's Check list, as an If's (casca-031 to 036).
  { id: 'waitUntil', group: 'wait', type: 'Assert', icon: 'clock', name: 'Wait until…', desc: t('insert.desc.waitUntil'), words: t('insert.words.waitUntil'), insert: inserts.waitUntil },

  // The check is chosen in the Inspector, and the block is born with it.
  { id: 'if', group: 'flow', type: 'If', name: 'If', desc: t('insert.desc.if'), words: t('insert.words.if'), insert: inserts.if },
  { id: 'while', group: 'flow', type: 'While', name: 'While', desc: t('insert.desc.while'), words: t('insert.words.while'), insert: inserts.while },
  { id: 'forEachRow', group: 'flow', type: 'ForEachRow', name: 'For Each Data Row', desc: t('insert.desc.forEachRow'), words: t('insert.words.forEachRow'), insert: inserts.forEachRow },
  { id: 'break', group: 'flow', type: 'BreakLoop', name: 'Break loop', desc: t('insert.desc.break'), words: t('insert.words.break'), inLoop: true, insert: inserts.breakLoop },
  { id: 'next', group: 'flow', type: 'ContinueLoop', name: 'Next iteration', desc: t('insert.desc.next'), words: t('insert.words.next'), inLoop: true, insert: inserts.nextIteration },

  { id: 'assert', group: 'checks', type: 'Assert', name: 'Assert', desc: t('insert.desc.assert'), words: t('insert.words.assert'), insert: inserts.assert },
  { id: 'stop', group: 'checks', type: 'Stop', name: 'Stop', desc: t('insert.desc.stop'), words: t('insert.words.stop'), insert: inserts.stop },
  { id: 'return', group: 'checks', type: 'Return', name: 'Return', desc: t('insert.desc.return'), words: t('insert.words.return'), insert: inserts.return },

  { id: 'setVariable', group: 'variables', type: 'SetVariable', name: 'Set Variable', desc: t('insert.desc.setVariable'), words: t('insert.words.setVariable'), insert: inserts.setVariable },
  { id: 'copyToSlot', group: 'variables', type: 'CopyToSlot', name: 'Copy to Slot', desc: t('insert.desc.copyToSlot'), words: t('insert.words.copyToSlot'), insert: inserts.copyToSlot },

  { id: 'activateWindow', group: 'windows', type: 'ActivateWindow', name: 'Activate Window', desc: t('insert.desc.activateWindow'), words: t('insert.words.activateWindow'), insert: inserts.activateWindow },
  // The macro is chosen in the Inspector, and the step is born with it; a macro dragged from the
  // library onto the steps makes one too.
  { id: 'runMacro', group: 'windows', type: 'RunProfile', name: 'Run Macro', desc: t('insert.desc.runMacro'), words: t('insert.words.runMacro'), insert: inserts.runMacro },

  // Born empty, and filled in the Inspector: the address, or the element (Pick element) and the rest.
  // Their words start with the ones every browser step is known by (insert.words.browser).
  { id: 'openUrl', group: 'browser', type: 'BrowserNavigate', name: 'Open URL', desc: t('insert.desc.openUrl'), words: t('insert.words.openUrl'), insert: inserts.openUrl },
  { id: 'clickElement', group: 'browser', type: 'BrowserClick', name: 'Click Element', desc: t('insert.desc.clickElement'), words: t('insert.words.clickElement'), insert: inserts.clickElement },
  { id: 'rightClickElement', group: 'browser', type: 'BrowserRightClick', name: 'Right Click Element', desc: t('insert.desc.rightClickElement'), words: t('insert.words.rightClickElement'), insert: inserts.rightClickElement },
  { id: 'typeText', group: 'browser', type: 'BrowserType', name: 'Type Text', desc: t('insert.desc.typeText'), words: t('insert.words.typeText'), insert: inserts.typeText },
  { id: 'selectOption', group: 'browser', type: 'BrowserSelectOption', name: 'Select Option', desc: t('insert.desc.selectOption'), words: t('insert.words.selectOption'), insert: inserts.selectOption },
  { id: 'waitElement', group: 'browser', type: 'BrowserWaitElement', name: 'Wait Element', desc: t('insert.desc.waitElement'), words: t('insert.words.waitElement'), insert: inserts.waitElement },
  { id: 'assertElement', group: 'browser', type: 'BrowserAssert', name: 'Assert Element', desc: t('insert.desc.assertElement'), words: t('insert.words.assertElement'), insert: inserts.assertElement },
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
    .filter(item => { const known = tokens(item); return words.every(w => known.some(k => k.startsWith(w))); })
    .map((item, order) => ({ item, order, rank: rank(item) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(x => x.item);
}
