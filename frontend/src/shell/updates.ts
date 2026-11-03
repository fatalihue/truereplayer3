import { create } from 'zustand';
import type { IncomingMessage } from '../bridge/messageTypes';

/**
 * What the engine said about an update, for Settings' "ready to install": shown only while an
 * install the engine put off waits (D24: a run was on; the engine applies it by itself once it ends).
 * Heard by the shell's watch (watch.tsx), from the start.
 */
interface Updates {
  /** An update the engine put off ("Update postponed: …"), with its version when known. */
  postponed: { version: string | null } | null;
  /** The last update:available's version, for a postponement that does not name it. */
  offered: string | null;
}

export const useUpdates = create<Updates>(() => ({ postponed: null, offered: null }));

export function hearUpdate(msg: IncomingMessage) {
  switch (msg.type) {
    case 'update:available':
      useUpdates.setState({ offered: msg.payload.version, postponed: null });
      return;
    case 'update:error':
      useUpdates.setState(s => ({
        // The engine says so with a flag: its message is in the interface's language now (I5).
        postponed: msg.payload.postponed === true ? { version: msg.payload.version ?? s.offered } : null,
      }));
      return;
    case 'update:none':
    case 'update:ready':
      useUpdates.setState({ postponed: null });
      return;
  }
}
