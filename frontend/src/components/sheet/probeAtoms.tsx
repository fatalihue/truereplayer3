import { Frame, Maximize, X } from 'lucide-react';

// Pieces the Sheet's screen-probe editors share: the image / pixel / window / browser editors in
// SheetPanel and the OCR block in ScreenTextFields. The OCR block was born as a copy of the image
// editor's region row, verdict card and tool button; living here, the copies cannot drift apart.

/** A probe's verdict card (found / not found). Pair with `calloutStyle(ok ? 'ok' : 'error')`. */
export const RESULT_CARD = 'border rounded px-2.5 py-2 text-caption leading-relaxed callout-enter';

/** The Sheet's neutral tool button — Configure, Pick, Recapture, Pick from screen. h-8 like
 *  every Sheet control; add `flex-1 justify-center` where it shares a row. The accent-tinted
 *  sibling that checks against the live screen is `<Button variant="test" size="field">`.
 *  Hover is gated on `enabled:` for the same reason Button gates it: a disabled control that
 *  carries a data-tip gets pointer events back, and must not light up under the cursor. */
export const TOOL_BTN = 'h-8 px-2.5 flex items-center gap-1.5 rounded text-minor font-medium border border-border-default bg-bg-elevated text-text-secondary enabled:hover:bg-bg-card enabled:hover:text-text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export type ProbeRegion = { x: number; y: number; w: number; h: number } | null;

/** Search-region readout + Configure + clear. The empty state states the cost of a whole-screen
 *  search (warning ink AND an icon) rather than looking like an absence; the Field around it
 *  carries each editor's own hint. */
export function SearchRegionRow({ region, onConfigure, onClear, configureTip, clearLabel, clearTip }: {
  region: ProbeRegion;
  onConfigure: () => void;
  onClear: () => void;
  /** Why to set a region, in the editor's own terms (fewer false positives for an image, a
   *  faster read for OCR). */
  configureTip: string;
  clearLabel: string;
  clearTip?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex-1 h-8 px-2 flex items-center text-caption font-mono bg-bg-input border border-border-default rounded text-text-secondary">
        {region
          ? `${region.x}, ${region.y}  ·  ${region.w} × ${region.h}`
          : (
            <span className="flex items-center gap-1.5" style={{ color: 'var(--color-warning-ink)' }}>
              <Maximize size={11} className="shrink-0" />
              Full screen
            </span>
          )}
      </div>
      <button onClick={onConfigure} className={TOOL_BTN} data-tip={configureTip}>
        <Frame size={12} />
        Configure
      </button>
      {region && (
        <button
          aria-label={clearLabel}
          onClick={onClear}
          className="h-8 px-2 flex items-center rounded text-minor text-text-tertiary hover:text-[var(--color-recording-fg)] hover:bg-bg-card transition-colors"
          data-tip={clearTip}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
