import { useState, useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { useTt } from '../state/LanguageContext';
import { IconButton } from './common/IconButton';

export function ExtensionUpdateBanner() {
  const { subscribe } = useBridge();
  const tt = useTt();
  const [outdated, setOutdated] = useState<{ current: string; expected: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'browser:extensionOutdated') {
        const payload = msg.payload as { currentVersion?: string; expectedVersion?: string };
        // Validate before trusting the bridge payload — a malformed message would otherwise
        // render a banner with blank version numbers.
        if (typeof payload?.currentVersion === 'string' && typeof payload?.expectedVersion === 'string') {
          // The message now carries the RESULT of every handshake, not only the bad ones, so the
          // banner mirrors the last check instead of latching on the first mismatch and staying
          // up after the user did exactly what it asked.
          if (payload.currentVersion === payload.expectedVersion) { setOutdated(null); return; }
          // Un-dismiss only when the pair actually changed: a reconnect that reports the SAME
          // mismatch must not bring back a banner the user has closed.
          setOutdated((prev) => {
            if (!prev || prev.current !== payload.currentVersion || prev.expected !== payload.expectedVersion) {
              setDismissed(false);
            }
            return { current: payload.currentVersion!, expected: payload.expectedVersion! };
          });
        }
      }
    });
  }, [subscribe]);

  if (!outdated || dismissed) return null;

  return (
    // The banner is about the browser extension, so it borrows the Browser action's identity —
    // but through its tokens, not a frozen copy of the hex. #fb923c IS actionBrowserColor, so
    // this used to drift the moment a user recoloured that action, and the raw orange was the
    // wrong rung for text besides: -fg is the per-theme ink, which darkens on a light preset
    // where the raw hue washes out.
    <div className="flex items-center gap-2.5 px-3 py-2 shrink-0"
      style={{
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-action-browser-fg) 8%, transparent), color-mix(in srgb, var(--color-action-browser-fg) 3%, transparent))',
        borderBottom: '1px solid color-mix(in srgb, var(--color-action-browser-fg) 25%, transparent)',
      }}
    >
      <AlertCircle size={16} className="shrink-0" style={{ color: 'var(--color-action-browser-fg)' }} />
      <span className="flex-1 text-minor text-text-secondary">
        Chrome Extension update:
        <span className="font-mono text-caption mx-1 px-1.5 py-0.5 rounded" style={{ color: 'var(--color-action-browser-fg)', background: 'color-mix(in srgb, var(--color-action-browser-fg) 10%, transparent)' }}>
          v{outdated.current}
        </span>
        &rarr;
        <span className="font-mono text-caption mx-1 px-1.5 py-0.5 rounded" style={{ color: 'var(--color-action-browser-fg)', background: 'color-mix(in srgb, var(--color-action-browser-fg) 10%, transparent)' }}>
          v{outdated.expected}
        </span>
        &mdash; Reload in chrome://extensions
      </span>
      {/* The house icon button (it had no name at all, and a softer ink than every other one).
          The tooltip says what the X alone cannot: it comes back if the versions change. */}
      <IconButton
        size="sm"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        data-tip={tt('Hide until the versions change', 'Ocultar até as versões mudarem')}
      >
        <X size={14} />
      </IconButton>
    </div>
  );
}
