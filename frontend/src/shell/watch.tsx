import { useEffect, useRef, useState } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { IncomingMessage } from '../bridge/messageTypes';
import { UpdateOverlay } from '../components/UpdateOverlay';
import { useTt } from '../state/LanguageContext';
import { useToast } from '../state/ToastContext';
import { palette, usePalette } from './palette/paletteState';
import { openPage, openSettings, useUi } from './ui';
import { hearUpdate } from './updates';

type Door = 'automations' | 'browser';

/** A dialog the shell is in the middle of (a confirmation, a name it asks for); Ctrl+K is not one. */
const dialogOpen = () => [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(d => !d.classList.contains('pal'));

/**
 * What the engine asks from outside the page: the tray's Browser extension… (D25) and Automations…
 * (casca-011). Already there, nothing happens. Over a dialog it refuses, as today: the page would open
 * under it. Ctrl+K goes, so it does not stay over the other page.
 */
function hear(message: IncomingMessage, refuse: (door: Door) => void) {
  hearUpdate(message);
  const door: Door | null = message.type === 'extension:openHelp' ? 'browser' : message.type === 'automation:open' ? 'automations' : null;
  if (!door) return;
  const ui = useUi.getState();
  if (door === 'automations' ? ui.page === 'automations' : ui.page === 'settings' && ui.settingsCategory === 'browser' && !ui.settingsQuery) return;
  if (dialogOpen()) {
    refuse(door);
    return;
  }
  if (usePalette.getState().open) palette.close();
  if (door === 'browser') openSettings('browser');
  else openPage('automations');
}

/**
 * What listens out of sight, in a chunk of its own that comes at the first idle moment (rule 6): the
 * update's splash of today (D24: it stays), the update's state for Settings, and the tray's doors.
 * What the engine said before it came (`early`, kept by Overlays) is heard first, in order.
 */
export function Watch({ early }: { early: readonly IncomingMessage[] }) {
  const { subscribe } = useBridge();
  const { showToast } = useToast();
  const tt = useTt();
  const refuse = (door: Door) => showToast(door === 'automations'
    ? tt('Close the open dialog first, then open Automations again.', 'Feche o diálogo aberto primeiro e abra as Automações de novo.')
    : tt('Close the open dialog first, then open Browser extension again.', 'Feche o diálogo aberto primeiro e abra Extensão do navegador de novo.'), 'info');
  const refuseRef = useRef(refuse);
  useEffect(() => { refuseRef.current = refuse; });
  const [pending] = useState(() => {
    early.forEach(m => hear(m, refuse));
    return early;
  });
  useEffect(() => subscribe((m) => hear(m, (door) => refuseRef.current(door))), [subscribe]);
  return <UpdateOverlay pending={pending} />;
}
