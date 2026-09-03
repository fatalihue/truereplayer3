import { useState, useEffect } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';

export function ExtensionUpdateBanner() {
  const { subscribe } = useBridge();
  const [outdated, setOutdated] = useState<{ current: string; expected: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'browser:extensionOutdated') {
        const payload = msg.payload as { currentVersion?: string; expectedVersion?: string };
        // Validate before trusting the bridge payload — a malformed message would otherwise
        // render a banner with blank version numbers.
        if (typeof payload?.currentVersion === 'string' && typeof payload?.expectedVersion === 'string') {
          setOutdated({ current: payload.currentVersion, expected: payload.expectedVersion });
          setDismissed(false);
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
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-ui"
      style={{
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-action-browser-fg) 8%, transparent), color-mix(in srgb, var(--color-action-browser-fg) 3%, transparent))',
        border: '1px solid color-mix(in srgb, var(--color-action-browser-fg) 25%, transparent)',
      }}
    >
      <AlertCircle size={16} className="shrink-0" style={{ color: 'var(--color-action-browser-fg)' }} />
      <span className="flex-1 text-xs text-text-secondary">
        Chrome Extension update:
        <span className="font-mono text-[11px] mx-1 px-1.5 py-0.5 rounded" style={{ color: 'var(--color-action-browser-fg)', background: 'color-mix(in srgb, var(--color-action-browser-fg) 10%, transparent)' }}>
          v{outdated.current}
        </span>
        &rarr;
        <span className="font-mono text-[11px] mx-1 px-1.5 py-0.5 rounded" style={{ color: 'var(--color-action-browser-fg)', background: 'color-mix(in srgb, var(--color-action-browser-fg) 10%, transparent)' }}>
          v{outdated.expected}
        </span>
        &mdash; Reload in chrome://extensions
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 rounded hover:bg-bg-elevated text-text-disabled hover:text-text-secondary transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
}
