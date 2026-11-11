import { useTecladoSync } from './mkStore';

/** Teclado (branch teclado): takes teclado:state into the page's store from the start, whatever page is on screen. */
export function TecladoSync() {
  useTecladoSync();
  return null;
}
