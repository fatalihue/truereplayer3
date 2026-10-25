import { useSyncExternalStore } from 'react';

/**
 * The shell's on-demand chunks (rule 6) without React.lazy: a lazy component always suspends the
 * first time it renders, even when its chunk is already in, and React holds a Suspense boundary's
 * content back ~300 ms after showing its fallback. Measured on the first step clicked (slice 6):
 * 318 ms from the click to the Inspector's editor, against 6–8 ms after it. Here a chunk started
 * early (the pointer or the focus reaching where it is used) is drawn on the press itself.
 *
 * A loader is a module-level `() => import(...)`: its identity is the module's key.
 */
type Loader = () => Promise<unknown>;

const loaded = new Map<Loader, unknown>();
const loading = new Map<Loader, Promise<unknown>>();
const listeners = new Set<() => void>();

/** Starts loading a chunk (once); resolves with its module. */
export function preload<T>(loader: () => Promise<T>): Promise<T> {
  if (loaded.has(loader)) return Promise.resolve(loaded.get(loader) as T);
  let p = loading.get(loader);
  if (!p) {
    p = loader().then((mod) => {
      loaded.set(loader, mod);
      loading.delete(loader);
      for (const l of listeners) l();
      return mod;
    });
    loading.set(loader, p);
  }
  return p as Promise<T>;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** The chunk's module once it is in, else null (and a redraw when it arrives). Loads nothing itself. */
export function useLoaded<T>(loader: () => Promise<T>): T | null {
  return useSyncExternalStore(subscribe, () => (loaded.get(loader) as T | undefined) ?? null);
}
