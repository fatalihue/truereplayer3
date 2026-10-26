import { create } from 'zustand';

/**
 * ⑨ The dock under the steps: the Run Report and Live Variables (FunctionMap: "Run Report e Live
 * Variables → dock sob a lista"). Its bar is always there with a macro open; the panel opens on a
 * tab and keeps its height. Both are kept in this viewer's browser, like the Inspector's width.
 */
export type DockTab = 'report' | 'vars';
interface DockState { open: boolean; tab: DockTab; height: number }

const KEY = 'ui:dock';
export const DOCK_MIN_REM = 8;
export const DOCK_MAX_REM = 30;
export const DOCK_DEFAULT_REM = 14;
export const clampDock = (rem: number) => Math.round(Math.min(DOCK_MAX_REM, Math.max(DOCK_MIN_REM, rem)) * 4) / 4;

function read(): DockState {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<DockState> | null;
    return {
      open: v?.open === true,
      tab: v?.tab === 'vars' ? 'vars' : 'report',
      height: typeof v?.height === 'number' ? clampDock(v.height) : DOCK_DEFAULT_REM,
    };
  } catch { return { open: false, tab: 'report', height: DOCK_DEFAULT_REM }; }
}
function write(s: DockState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage off: it lasts the session */ }
}

export const useDock = create<DockState>(read);
const set = (patch: Partial<DockState>) => {
  useDock.setState(patch);
  write(useDock.getState());
};

/**
 * The dock's height as laid out, in px, for what stands above it (the toasts); 0 with no dock. Not
 * kept: the dock's ResizeObserver says it.
 */
export const useDockPx = create<{ px: number }>(() => ({ px: 0 }));

/** The panel's code (rule 6): it loads when the panel first opens, never with the app. */
export const loadDockPanel = () => import('./DockPanel');

export const dock = {
  /** Opens the panel on a tab. */
  show: (tab: DockTab) => set({ open: true, tab }),
  /** Ctrl+K's Run Report and Live Variables: open on that tab, or close it when it is the one shown. */
  toggle: (tab: DockTab) => {
    const s = useDock.getState();
    set(s.open && s.tab === tab ? { open: false } : { open: true, tab });
  },
  setOpen: (open: boolean) => set({ open }),
  setHeight: (height: number) => set({ height: clampDock(height) }),
};
