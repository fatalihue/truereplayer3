/**
 * The tips shown once (phase 5): while a first recording runs, and after it ("Your first macro is
 * saved"). They are for someone new: the first-run screen arms them, an import from TrueReplayer 2
 * ends them, and each one ends once it has been on screen. Kept in this WebView2's storage, like the
 * shell's other small choices; storage that fails only means no tips.
 */
export type Tip = 'recording' | 'firstMacro';

const KEY = 'tr-tips';

/** The tips still to show, in order. Empty unless the first-run screen armed them. */
export function pendingTips(): Tip[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((t): t is Tip => t === 'recording' || t === 'firstMacro') : [];
  } catch {
    return [];
  }
}

/** The first-run screen is on: the tips wait for the first recording. Once only — ended tips stay ended. */
export function armTips() {
  try {
    if (localStorage.getItem(KEY) === null) localStorage.setItem(KEY, JSON.stringify(['recording', 'firstMacro']));
  } catch { /* storage off: no tips */ }
}

/** One tip has had its turn, or all of them ('all': an import brought someone who knows the app). */
export function endTip(tip: Tip | 'all') {
  try {
    localStorage.setItem(KEY, JSON.stringify(tip === 'all' ? [] : pendingTips().filter(t => t !== tip)));
  } catch { /* storage off */ }
}
