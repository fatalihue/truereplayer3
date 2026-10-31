import type { OutgoingMessage } from '../bridge/messageTypes';
import { freeName } from './library/model';
import { useShell } from './store';

/**
 * Runs `then` once the macro is the open one (and, to record, a recording may start): the engine
 * creates and opens a new macro a moment after it is asked. A create it refused never opens, and
 * nothing waits for it.
 */
export function whenOpen(name: string, record: boolean, then: () => void) {
  let timer = 0;
  const stop = useShell.subscribe((s) => {
    if (s.app.activeProfile !== name || (record && !s.app.buttonStates.recordEnabled)) return;
    stop();
    clearTimeout(timer);
    then();
  });
  timer = window.setTimeout(stop, 10000);
}

/**
 * "Record a new macro" from the tray (Tray board): an Untitled macro, recording from its first step
 * once the engine opens it — what the first use's Record it does. Nothing while something runs or in
 * Clicker mode, where the engine would refuse the recording; false then.
 */
export function recordNewMacro(send: (message: OutgoingMessage) => void, create: (name: string) => void): boolean {
  const app = useShell.getState().app;
  if (app.status !== 'ready' || app.settings.useCursorClick) return false;
  const name = freeName('Untitled macro', app.profiles.map(p => p.name));
  whenOpen(name, true, () => send({ type: 'recording:toggle', payload: { insertIndex: 0 } }));
  create(name);
  return true;
}
