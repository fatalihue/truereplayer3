import { useEffect, useState } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { IncomingMessage } from '../bridge/messageTypes';
import { UpdateOverlay } from '../components/UpdateOverlay';
import { openPage, openSettings } from './ui';
import { hearUpdate } from './updates';

/** What the engine asks from outside the page: the tray's Browser extension… (D25) and Automations… (casca-011). */
function hear(message: IncomingMessage) {
  hearUpdate(message);
  if (message.type === 'extension:openHelp') openSettings('browser');
  else if (message.type === 'automation:open') openPage('automations');
}

/**
 * What listens out of sight, in a chunk of its own that comes at the first idle moment (rule 6): the
 * update's splash of today (D24: it stays), the update's state for Settings, and the tray's doors.
 * What the engine said before it came (`early`, kept by Overlays) is heard first, in order.
 */
export function Watch({ early }: { early: readonly IncomingMessage[] }) {
  const { subscribe } = useBridge();
  const [pending] = useState(() => {
    early.forEach(hear);
    return early;
  });
  useEffect(() => subscribe(hear), [subscribe]);
  return <UpdateOverlay pending={pending} />;
}
