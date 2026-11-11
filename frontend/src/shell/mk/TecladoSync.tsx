import { useMk, useTecladoSync } from './mkStore';

// In Vite, the store is reachable from the console and from the test scripts.
if (import.meta.env.DEV) (window as unknown as { __mk: typeof useMk }).__mk = useMk;

/** Teclado (branch teclado): takes teclado:state and teclado:live into the page's store from the start, whatever page is on screen. */
export function TecladoSync() {
  useTecladoSync();
  return null;
}
