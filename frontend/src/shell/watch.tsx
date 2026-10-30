import { useEffect, useRef, useState } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { IncomingMessage } from '../bridge/messageTypes';
import { UpdateOverlay } from '../components/UpdateOverlay';
import { useTt } from '../state/LanguageContext';
import { useToast } from '../state/ToastContext';
import { APP_NAME, TR2_NAME } from '../appIdentity';
import { Tr2Knocked } from './coexist';
import { openImport, useImport } from './importState';
import { preload, useLoaded } from './lazyModule';
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

/** TrueReplayer 2's knock (CoexistenceGuard): whether there is an installed one to switch to. */
const knockOf = (m: IncomingMessage) => (m.type === 'coexist:tr2Knocked' ? m.payload : null);

// The import dialog comes when it opens: the first-run offer, or Settings › General.
const loadImport = () => import('./importTr2');

function ImportDialog() {
  const mode = useImport(s => s.mode);
  const offer = useImport(s => s.offer);
  const mod = useLoaded(loadImport);
  useEffect(() => { if (mode && !mod) void preload(loadImport); }, [mode, mod]);
  const Dialog = mod?.ImportTr2;
  return mode && Dialog ? <Dialog mode={mode} offer={offer} /> : null;
}

/** The offer on a first start, and the notice on the start that finished an import. */
function hearImport(message: IncomingMessage, toast: (text: string) => void) {
  if (message.type === 'import:offer') openImport('offer', message.payload);
  else if (message.type === 'import:done') {
    const s = message.payload.summary;
    toast(s
      ? `Imported ${s.macros} macro${s.macros === 1 ? '' : 's'} from ${TR2_NAME}. Automations are off in ${APP_NAME} — turn them on in Automations.`
      : `Imported from ${TR2_NAME}. Automations are off in ${APP_NAME} — turn them on in Automations.`);
  }
}

/**
 * What listens out of sight, in a chunk of its own that comes at the first idle moment (rule 6): the
 * update's splash of today (D24: it stays), the update's state for Settings, the tray's doors and
 * TrueReplayer 2's knock. What the engine said before it came (`early`, kept by Overlays) is heard
 * first, in order.
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
  // 15 s: the notice carries an instruction (turn the automations back on), not just news.
  const toast = (text: string) => showToast(text, { type: 'success', duration: 15000 });
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; });
  const [pending] = useState(() => {
    early.forEach(m => hear(m, refuse));
    return early;
  });
  // After the first render, not during it: the notice is a toast, another component's state.
  useEffect(() => { early.forEach(m => hearImport(m, (text) => toastRef.current(text))); }, [early]);
  const [knock, setKnock] = useState(() => early.map(knockOf).filter(k => k !== null).at(-1) ?? null);
  useEffect(() => subscribe((m) => {
    hear(m, (door) => refuseRef.current(door));
    hearImport(m, (text) => toastRef.current(text));
    const k = knockOf(m);
    if (k) setKnock(k);
  }), [subscribe]);
  return (
    <>
      <UpdateOverlay pending={pending} />
      {knock && <Tr2Knocked tr2Installed={knock.tr2Installed} onClose={() => setKnock(null)} />}
      <ImportDialog />
    </>
  );
}
