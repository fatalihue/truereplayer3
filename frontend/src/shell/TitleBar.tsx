import { useApp } from './store';
import { BrandMark } from './BrandMark';
import { NotBuilt } from './NotBuilt';

// The native caption buttons (minimize, maximize, close) sit over the right edge of the title bar.
// They keep their device size whatever the UI scale is, so this gap stays in px.
const CAPTION_BUTTONS_PX = 140;

const STATE = {
  ready: 'Ready',
  recording: 'Recording',
  replaying: 'Replaying',
} as const;

/** ① The title bar: the mark, Ctrl+K in the middle, and the state of the engine on the right. */
export function TitleBar() {
  const status = useApp(a => a.status);
  const clicker = useApp(a => a.settings.useCursorClick);
  const ring = status === 'recording' ? 'var(--color-recording)' : clicker ? 'var(--color-clicker)' : 'var(--color-accent)';
  return (
    <header className="shell-titlebar drag-region">
      <div className="shell-brand">
        <BrandMark ring={ring} />
        <span>TrueReplayer</span>
      </div>
      <div className="shell-titlebar-middle">
        <NotBuilt what="Ctrl+K" />
      </div>
      <div role="status" className="shell-state" data-state={status} style={{ marginRight: CAPTION_BUTTONS_PX }}>
        <span className="shell-state-dot" />
        {STATE[status]}
      </div>
    </header>
  );
}
