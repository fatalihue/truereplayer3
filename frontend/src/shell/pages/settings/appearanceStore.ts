import { create } from 'zustand';
import { themes } from '../../../themePresets';
import { DEFAULT_THEME_ID, DEFAULT_UI_SETTINGS, type CustomThemePreset, type ThemeConfig, type ThemePreset, type ThemeUISettings } from '../../../themes';

/**
 * What Settings › Appearance's parts share (the page, the color editor and the live preview): the
 * view on screen, what the pointer is on, and the page's undo (D22: Appearance applies at once, with
 * Ctrl+Z, and the Revert of today's editor goes).
 */
export type ApView = 'main' | 'colors' | 'share';
interface Ap {
  view: ApView;
  /** A colour to open in the editor, its HSL open (a hotspot of the preview). */
  focus: { key: string; seq: number } | null;
  /** The colour row under the pointer: the preview outlines what it paints. */
  hoverColor: string | null;
  /** The theme under the pointer (or the focus) in the gallery: the preview paints it. */
  hoverTheme: string | null;
  /** The view just left for the page's own: the focus goes back to the button that opened it. */
  cameFrom: ApView | null;
  past: Snap[];
  future: Snap[];
}
// The theme only: the interface's language left the page's history (D30), because changing it loads
// the page's build of the other language.
export interface Snap { config: ThemeConfig }

export const useAp = create<Ap>(() => ({ view: 'main', focus: null, hoverColor: null, hoverTheme: null, cameFrom: null, past: [], future: [] }));

let focusSeq = 0;
/** The color editor, open at a colour with its HSL showing. */
export const openColor = (key: string) => useAp.setState({ view: 'colors', focus: { key, seq: ++focusSeq } });
/** Another view; the page's own drops a colour still asked for, so Edit colors… opens with none. */
export const showView = (view: ApView) => useAp.setState(s => (view === 'main'
  ? { view, hoverColor: null, hoverTheme: null, focus: null, cameFrom: s.view === 'main' ? null : s.view }
  : { view, hoverColor: null, hoverTheme: null }));
/** The page went away: it comes back on its own view, with nothing under the pointer. */
export const resetView = () => useAp.setState({ view: 'main', hoverColor: null, hoverTheme: null, focus: null, cameFrom: null });

/** The base theme: an own one, a built-in one, or the default when the id resolves to neither. */
export function baseOf(id: string, own: CustomThemePreset[]): ThemePreset {
  return own.find(p => p.id === id) ?? themes.find(t => t.id === id) ?? themes.find(t => t.id === DEFAULT_THEME_ID) ?? themes[0];
}

// ── The undo ──

/** Changes closer than this are one step: a slider dragged, an arrow held, a colour picked live. */
const MERGE_MS = 600;
const MAX_STEPS = 50;
// Outside React: what the history last saw, when, and whether the next change is the undo's own (or
// one with an undo of its own, like a deleted theme's toast). The windows are short: a change that
// never comes must not swallow a later one.
let last: Snap | null = null;
// When the last change came; none yet is -Infinity, not 0: a page younger than MERGE_MS would join its
// first change to a change that never was, and lose the step.
let lastAt = -Infinity;
let quietUntil = 0;

const sameConfig = (a: ThemeConfig, b: ThemeConfig) => {
  if (a.baseThemeId !== b.baseThemeId) return false;
  const ka = Object.keys(a.colorOverrides) as (keyof ThemeConfig['colorOverrides'])[];
  if (ka.length !== Object.keys(b.colorOverrides).length || ka.some(k => a.colorOverrides[k] !== b.colorOverrides[k])) return false;
  return (Object.keys(DEFAULT_UI_SETTINGS) as (keyof ThemeUISettings)[]).every(k => a.uiSettings[k] === b.uiSettings[k]);
};

/** The next change (within a moment) is not a step: it has an undo of its own, or it is one. */
export const quietNextChange = () => { quietUntil = performance.now() + 150; };

/** Called with every theme the page sees: the change before a pause becomes a step. */
export function record(now: Snap) {
  const t = performance.now();
  const prev = last;
  last = now;
  if (!prev || t < quietUntil) { lastAt = -Infinity; return; }
  if (sameConfig(prev.config, now.config)) return;
  if (t - lastAt > MERGE_MS) useAp.setState(s => ({ past: [...s.past.slice(1 - MAX_STEPS), prev], future: [] }));
  else if (useAp.getState().future.length) useAp.setState({ future: [] });
  lastAt = t;
}
/** The page went away: what it sees next is a new start, not a step. */
export const forgetLast = () => { last = null; };

/** Ctrl+Z (or Ctrl+Y): the state one step back (or forward), and that step moved to the other side. */
export function step(back: boolean, current: Snap): Snap | null {
  const { past, future } = useAp.getState();
  const from = back ? past : future;
  const to = from.at(-1);
  if (!to) return null;
  useAp.setState(back
    ? { past: past.slice(0, -1), future: [...future, current] }
    : { future: future.slice(0, -1), past: [...past, current] });
  quietNextChange();
  return to;
}
