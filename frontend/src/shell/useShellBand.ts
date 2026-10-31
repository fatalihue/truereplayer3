import { useSyncExternalStore } from 'react';

/**
 * The five bands of shell.css (rule 9), for the parts that have to know in script which layout is
 * on — the library renders a different component when it folds, rather than hiding one it built.
 *
 * Read in rem of the root font size, the unit the container queries use, and with the same edges
 * (79.99, 63.99, 47.49, 32.49), so the script and the stylesheet agree at every zoom. The shell is
 * the whole window, so its width is the window's.
 */
export type ShellBand = 'wide' | 'fold' | 'over' | 'single' | 'compact';

let band: ShellBand | null = null;
// The root's font size, in px: the zoom setting, which the bands are measured in.
let rootPx = 0;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

const rootSize = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

function measure(rem: number): ShellBand {
  const width = document.documentElement.clientWidth / rem;
  if (width > 79.99) return 'wide';
  if (width > 63.99) return 'fold';
  if (width > 47.49) return 'over';
  if (width > 32.49) return 'single';
  return 'compact';
}

// Measured on the events that move it — a resize, or the zoom setting, which the theme writes as
// the root's font size — and cached, so a render never forces a style recalculation to read it.
function update() {
  const rem = rootSize();
  const next = measure(rem);
  if (next === band && rem === rootPx) return;
  band = next;
  rootPx = rem;
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!stop) {
    // Nothing listened while the window may have moved: read it again — in the next frame, not
    // here. Subscribing happens right after the first commit, and reading the width there forced a
    // style and layout pass over the whole new library in the middle of the launch.
    const frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    const watcher = new MutationObserver(update);
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    stop = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      watcher.disconnect();
    };
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && stop) {
      stop();
      stop = null;
    }
  };
}

function snapshot(): ShellBand {
  if (band === null) {
    rootPx = rootSize();
    band = measure(rootPx);
  }
  return band;
}

export function useShellBand(): ShellBand {
  return useSyncExternalStore(subscribe, snapshot);
}

const edgesSnapshot = () => {
  snapshot();
  return rootPx;
};

/**
 * Where the two wide bands begin, in px (DIP): the three columns from 80 rem, the folded library
 * from 64 rem. The window's edge sticks there when it is dragged (D27). The engine reads the rem off
 * the first one to size the compact view at the same zoom (WindowEventManager.SetCompactRem).
 */
export function useBandEdges(): number[] {
  const rem = useSyncExternalStore(subscribe, edgesSnapshot);
  return [Math.round(80 * rem), Math.round(64 * rem)];
}
