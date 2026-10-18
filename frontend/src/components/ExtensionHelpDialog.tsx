import { useEffect, useState } from 'react';
import { Chrome, Check, Unplug } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { useBrowserConnection } from '../hooks/useBrowserConnection';
import { useTt } from '../state/LanguageContext';
import { DialogShell, DialogFooter } from './common/DialogShell';

interface HelpReply {
  path: string;
  exists: boolean;
  copied: boolean;
  connected: boolean;
}

/**
 * Browser extension — where the extension lives and how to load it, one click from the status
 * bar's "Extension disconnected", the tray and the palette. Opening it is the copy: the backend
 * puts the folder's path on the clipboard (extension:help) and answers with it, so the user goes
 * straight to Chrome's "Load unpacked" and pastes.
 *
 * The folder is the one next to the exe. Velopack keeps that path across updates, so this is the
 * last time the user picks it: an update only swaps the files, and the extension reloads itself
 * when the app's handshake names a newer version.
 */
export function ExtensionHelpDialog({ onClose }: { onClose: () => void }) {
  const { send, subscribe } = useBridge();
  const tt = useTt();
  const [reply, setReply] = useState<HelpReply | null>(null);
  // Live: the headline turns to "connected" the moment the user finishes loading it in Chrome.
  // A freshly mounted hook sits at 'unknown' until the next edge, so the reply seeds it; with
  // neither yet (the first frames), null — no headline rather than a wrong "Connect…".
  const live = useBrowserConnection();
  const connected = live !== 'unknown' ? live === 'connected' : reply ? reply.connected : null;

  useEffect(() => {
    const unsubscribe = subscribe((msg) => {
      if (msg.type !== 'extension:help') return;
      const p = msg.payload;
      if (typeof p?.path !== 'string') return;
      setReply({ path: p.path, exists: p.exists === true, copied: p.copied === true, connected: p.connected === true });
    });
    send({ type: 'extension:help', payload: {} });
    return unsubscribe;
  }, [send, subscribe]);

  const steps = [
    tt('Open chrome://extensions (Edge: edge://extensions, Brave: brave://extensions).',
      'Abra chrome://extensions (Edge: edge://extensions, Brave: brave://extensions).'),
    tt('Turn on "Developer mode".', 'Ative o "Modo do desenvolvedor".'),
    tt('Click "Load unpacked" and pick this folder:', 'Clique em "Carregar sem compactação" e escolha esta pasta:'),
  ];

  return (
    <DialogShell
      icon={<Chrome size={14} style={{ color: 'var(--color-action-browser-fg)' }} />}
      title="Browser extension"
      // Opened from outside every stack (tray, palette, status bar) — it may land over the Sheet.
      zClass="z-(--z-dialog-raised)"
      onClose={onClose}
      closeOnBackdrop
      footer={(requestClose) => (
        <DialogFooter
          secondary={{ label: 'Close', onClick: requestClose }}
          primary={{
            label: 'Open folder',
            onClick: () => send({ type: 'extension:openFolder', payload: {} }),
            disabled: !reply?.exists,
            autoFocus: true,
          }}
        />
      )}
    >
      <div className="px-4 py-4 space-y-3 text-minor">
        {/* Two channels on the state, never colour alone — the status bar's own rule. */}
        <div
          className="flex items-center gap-1.5 font-medium text-text-primary"
          // Holds its line while the state is unknown, so the steps below do not jump.
          style={connected === null ? { visibility: 'hidden' } : undefined}
        >
          {connected
            ? <Check size={12} className="shrink-0" style={{ color: 'var(--color-replay-fg)' }} />
            : <Unplug size={12} className="shrink-0" style={{ color: 'var(--color-warning-ink)' }} />}
          {connected
            ? tt('The TrueReplayer extension is connected.', 'A extensão do TrueReplayer está conectada.')
            : tt('Connect the TrueReplayer extension to Chrome (or Edge).', 'Conecte a extensão do TrueReplayer ao Chrome (ou Edge).')}
        </div>

        <ol className="list-decimal pl-5 space-y-1 text-text-secondary leading-relaxed">
          {steps.map((s) => <li key={s}>{s}</li>)}
        </ol>

        <div
          className="font-mono text-caption px-2 py-1.5 rounded border border-border-default bg-bg-elevated text-text-primary break-all select-text"
          // The path is the payload of the whole dialog; it must be selectable even when the
          // clipboard copy failed.
        >
          {reply ? reply.path : '…'}
        </div>

        <p className="text-text-tertiary leading-relaxed">
          {!reply ? null
            : !reply.exists ? (
              <span style={{ color: 'var(--color-warning-ink)' }}>
                {tt('This folder is missing. Reinstall TrueReplayer to restore it.',
                  'Esta pasta não existe. Reinstale o TrueReplayer para restaurá-la.')}
              </span>
            ) : reply.copied
              ? tt('The path is already copied. The extension updates itself along with TrueReplayer.',
                'O caminho já foi copiado. A extensão se atualiza sozinha junto com o TrueReplayer.')
              : tt('Could not copy the path — select it above. The extension updates itself along with TrueReplayer.',
                'Não deu para copiar o caminho — selecione-o acima. A extensão se atualiza sozinha junto com o TrueReplayer.')}
        </p>
      </div>
    </DialogShell>
  );
}
