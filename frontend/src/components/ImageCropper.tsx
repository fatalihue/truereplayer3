import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crop } from 'lucide-react';
import { useTt } from '../state/LanguageContext';
import { uiZoom } from '../utils/zoomSpace';
import { DialogShell, DialogFooter } from './common/DialogShell';

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragMode =
  | 'move'
  | 'nw' | 'n' | 'ne'
  | 'w' | 'e'
  | 'sw' | 's' | 'se';

interface ImageCropperProps {
  imageBase64: string;
  onSave: (rect: CropRect) => void;
  onCancel: () => void;
}

const MIN_SIZE = 10;
const MAX_DISPLAY_W = 900;
const MAX_DISPLAY_H = 600;
/** Never squeeze the working area below this, however short the window gets. */
const MIN_DISPLAY_H = 220;
/** Share of the window height the card may occupy — mirrors the card's own max-h. */
const CARD_VH = 0.9;
/** Fallback chrome (header + footer + the body's padding, readout and gap) until it is measured
 *  for real. Measured at 169 layout px on 2026-09-11; the runtime read replaces it on mount. */
const CHROME_H_FALLBACK = 169;
const HANDLE_PX = 12;
// Crop rect stroke — slightly transparent so the underlying image stays readable while the
// rectangle keeps enough contrast against any background. The handles are solid accent with
// a 2 px ring in the card colour, so they read on a light image as well as on a dark one.
const ACCENT_RGBA = 'color-mix(in srgb, var(--color-accent) 65%, transparent)';
// The four dimming panes outside the crop: the app's strong scrim token (dark on every theme,
// like the dialogs' smoke), so the kept region reads as the lit one.
const DIM = 'var(--color-scrim-strong)';

// Modal cropper for tightening an existing reference image. Operates purely in image-pixel
// coordinates (the parent persists those via the bridge); display scaling is calculated
// on the fly so the UI works for any reference size from a tiny 30px icon up to a 600px panel.
//
// Lives in the DialogShell like every other dialog (scrim, focus, Escape, motion), at z-80
// because it opens from INSIDE the sheet, which sits at z-70.
export function ImageCropper({ imageBase64, onSave, onCancel }: ImageCropperProps) {
  const tt = useTt();
  const imgRef = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });
  // `zoom` is captured at drag start rather than read per mousemove: it cannot change
  // mid-drag, and this path runs on every pointer move.
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; startCrop: CropRect; zoom: number } | null>(null);

  const onImageLoad = useCallback(() => {
    if (!imgRef.current) return;
    const nw = imgRef.current.naturalWidth;
    const nh = imgRef.current.naturalHeight;
    setNatural({ w: nw, h: nh });
    setCrop({ x: 0, y: 0, w: nw, h: nh });
  }, []);

  // How tall the image may be drawn, in LAYOUT px. A fixed 600 was the whole bug: at the app's
  // minimum window (780 dip) a tall reference rendered 600 px of image into a card the 90vh cap
  // had already clipped, so its bottom sat BELOW the footer with nothing to scroll — and the
  // crop handles down there were unreachable. The height has to come from the window.
  //
  // `vh` ignores the ancestor `zoom`, so the card's own max-h resolves to layout px that the
  // zoom then shrinks: dividing here is what makes 90vh mean 90 % of the window rather than
  // 90 % × zoom ([[gotcha-zoom-coordinate-spaces]] — measure VISUAL, write LAYOUT).
  const [chromeH, setChromeH] = useState(CHROME_H_FALLBACK);
  const [maxDisplayH, setMaxDisplayH] = useState(MAX_DISPLAY_H);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const read = () => {
      const cardH = (window.innerHeight * CARD_VH) / uiZoom();
      setMaxDisplayH(Math.max(MIN_DISPLAY_H, Math.round(Math.min(MAX_DISPLAY_H, cardH - chromeH))));
    };
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [chromeH]);

  // The chrome is everything in the card that is not the image: header, footer, the body's
  // padding, the size readout and the gap. Measured rather than assumed, because the footer hint
  // wraps on a narrow card and a stale constant would put the difference back under the footer.
  // offsetHeight, not a rect: it is already layout space, so no zoom conversion is needed.
  useEffect(() => {
    const body = bodyRef.current;
    const img = imgRef.current;
    if (!body || !img || !natural) return;
    const card = body.parentElement;
    if (!card) return;
    const measured = card.offsetHeight - img.offsetHeight;
    // Only when it actually moved — this runs after a render that the height it feeds decides.
    if (measured > 0 && Math.abs(measured - chromeH) > 1) setChromeH(measured);
  }, [natural, maxDisplayH, chromeH]);

  // Always fit the image into the MAX_W × available-H box while preserving aspect ratio. Small
  // reference images get scaled UP so the handles are easy to grab; big ones get scaled
  // DOWN to fit. The crop rect stays in image-pixel coords; only its display position
  // scales by `display.scale`.
  const display = useMemo(() => {
    if (!natural) return null;
    const scale = Math.min(MAX_DISPLAY_W / natural.w, maxDisplayH / natural.h);
    return {
      width: natural.w * scale,
      height: natural.h * scale,
      scale,
    };
  }, [natural, maxDisplayH]);
  const displayScale = display?.scale ?? 1;

  // Global mousemove/mouseup so the drag survives even if the cursor briefly leaves the
  // handle while dragging fast.
  useEffect(() => {
    function clamp(v: number, min: number, max: number) {
      return Math.max(min, Math.min(max, v));
    }
    // Crop updates are coalesced to ONE run per frame, same doctrine as the ProfilePanel
    // drags: raw mousemove arrives at the mouse's polling rate (125-1000 Hz for the mice this
    // app targets) and each run does the coordinate conversion plus a setCrop that re-renders
    // the whole cropper portal — image, rect, all eight handles — to move a single rectangle.
    // The handler itself only stashes the latest position.
    let moveRaf: number | null = null;
    let pendingPos: { x: number; y: number } | null = null;
    const flushMove = () => {
      moveRaf = null;
      const p = pendingPos;
      if (!p) return;
      const d = dragRef.current;
      if (!d || !natural) return;
      // clientX/Y are VISUAL, so their delta is a distance on SCREEN. displayScale converts
      // LAYOUT px to image px, so the visual delta has to be divided by the zoom first or the
      // crop outruns the cursor — 11 % too far at the default 0.90, double at zoom 0.5. The
      // rest of this file is already consistent: displayScale is built from layout constants
      // and dispCrop's outputs are written straight back as layout lengths.
      const dx = (p.x - d.startX) / (displayScale * d.zoom);
      const dy = (p.y - d.startY) / (displayScale * d.zoom);
      let { x, y, w, h } = d.startCrop;
      const right = d.startCrop.x + d.startCrop.w;
      const bottom = d.startCrop.y + d.startCrop.h;
      switch (d.mode) {
        case 'move':
          x = clamp(x + dx, 0, natural.w - w);
          y = clamp(y + dy, 0, natural.h - h);
          break;
        case 'nw':
          x = clamp(d.startCrop.x + dx, 0, right - MIN_SIZE);
          y = clamp(d.startCrop.y + dy, 0, bottom - MIN_SIZE);
          w = right - x;
          h = bottom - y;
          break;
        case 'n':
          y = clamp(d.startCrop.y + dy, 0, bottom - MIN_SIZE);
          h = bottom - y;
          break;
        case 'ne':
          y = clamp(d.startCrop.y + dy, 0, bottom - MIN_SIZE);
          h = bottom - y;
          w = clamp(d.startCrop.w + dx, MIN_SIZE, natural.w - x);
          break;
        case 'w':
          x = clamp(d.startCrop.x + dx, 0, right - MIN_SIZE);
          w = right - x;
          break;
        case 'e':
          w = clamp(d.startCrop.w + dx, MIN_SIZE, natural.w - x);
          break;
        case 'sw':
          x = clamp(d.startCrop.x + dx, 0, right - MIN_SIZE);
          w = right - x;
          h = clamp(d.startCrop.h + dy, MIN_SIZE, natural.h - y);
          break;
        case 's':
          h = clamp(d.startCrop.h + dy, MIN_SIZE, natural.h - y);
          break;
        case 'se':
          w = clamp(d.startCrop.w + dx, MIN_SIZE, natural.w - x);
          h = clamp(d.startCrop.h + dy, MIN_SIZE, natural.h - y);
          break;
      }
      setCrop({
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      });
    };
    const onMove = (e: MouseEvent) => {
      pendingPos = { x: e.clientX, y: e.clientY };
      if (moveRaf === null) moveRaf = requestAnimationFrame(flushMove);
    };
    const onUp = () => {
      dragRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (moveRaf !== null) cancelAnimationFrame(moveRaf);
    };
  }, [natural, displayScale]);

  const startDrag = (mode: DragMode) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...crop },
      zoom: uiZoom(),
    };
  };

  const dispCrop = {
    left: crop.x * displayScale,
    top: crop.y * displayScale,
    width: crop.w * displayScale,
    height: crop.h * displayScale,
  };

  const canSave =
    natural !== null &&
    crop.w >= MIN_SIZE &&
    crop.h >= MIN_SIZE &&
    !(crop.x === 0 && crop.y === 0 && crop.w === natural.w && crop.h === natural.h);

  // Each handle is a 12 px square positioned so its CENTRE sits on the edge/corner of the crop
  // rect (the negative half-size offset). Solid accent with a 2 px ring in the card colour so it
  // separates from the image on either side of the luminance range.
  const handleStyle: React.CSSProperties = {
    position: 'absolute',
    width: HANDLE_PX,
    height: HANDLE_PX,
    background: 'var(--color-accent-solid)',
    boxShadow: '0 0 0 2px var(--color-bg-elevated)',
    borderRadius: 2,
  };
  const half = HANDLE_PX / 2;

  return (
    <DialogShell
      icon={<Crop size={14} style={{ color: 'var(--color-action-waitimage-fg)' }} />}
      title="Crop reference image"
      size="auto"
      zClass="z-[80]"
      // Divided by the zoom for the reason in the maxDisplayH note: a bare 90vh is 90 % of the
      // window in LAYOUT px, which the zoom then shrinks — at the 0.9 default the card could only
      // ever use 81 % of the height it was allowed.
      cardClassName="max-h-[calc(90vh/var(--ui-zoom))]"
      onClose={onCancel}
      // A crop in progress must not be thrown away by a stray click outside the card.
      closeOnBackdrop={false}
      footerHint="Drag the handles to resize · drag inside to move"
      footer={
        <DialogFooter
          secondary={{ label: 'Cancel', onClick: onCancel }}
          primary={{
            label: 'Save crop',
            onClick: () => onSave(crop),
            disabled: !canSave,
            tip: canSave ? undefined : tt('Pick a smaller region first', 'Selecione uma região menor primeiro'),
          }}
        />
      }
    >
      <div ref={bodyRef} className="p-4 flex flex-col gap-3 min-h-0">
        {/* Size readout — crop size, then the source size, as one mono line. */}
        <div className="flex justify-end items-baseline gap-1.5 text-[11px] font-mono tabular-nums text-text-tertiary">
          {natural ? (
            <>
              <span className="px-1.5 py-0.5 rounded bg-bg-input border border-border-subtle text-text-secondary">{crop.w} × {crop.h}</span>
              <span className="text-text-disabled">/ {natural.w} × {natural.h}</span>
            </>
          ) : 'Loading...'}
        </div>

        {/* Centred container — the image+crop overlay sit inside a flex centerer so they
            don't hug the left edge of the card when the image is smaller than the card. */}
        <div className="flex justify-center">
          <div className="relative inline-block" style={{ background: DIM }}>
          <img
            ref={imgRef}
            src={`data:image/png;base64,${imageBase64}`}
            onLoad={onImageLoad}
            alt="Reference"
            className="block select-none"
            style={display ? { width: display.width, height: display.height } : undefined}
            draggable={false}
          />

          {natural && crop.w > 0 && (
            <>
              {/* Four divs dim the area OUTSIDE the crop rect. Pointer-events:none so the user
                  can still grab the move/resize handles inside without the overlay swallowing it. */}
              <div
                className="absolute pointer-events-none"
                style={{ left: 0, top: 0, right: 0, height: dispCrop.top, background: DIM }}
              />
              <div
                className="absolute pointer-events-none"
                style={{ left: 0, top: dispCrop.top + dispCrop.height, right: 0, bottom: 0, background: DIM }}
              />
              <div
                className="absolute pointer-events-none"
                style={{ left: 0, top: dispCrop.top, width: dispCrop.left, height: dispCrop.height, background: DIM }}
              />
              <div
                className="absolute pointer-events-none"
                style={{
                  left: dispCrop.left + dispCrop.width,
                  top: dispCrop.top,
                  right: 0,
                  height: dispCrop.height,
                  background: DIM,
                }}
              />

              {/* Crop rect — draggable to move, with 8 resize handles. */}
              <div
                className="absolute"
                style={{
                  left: dispCrop.left,
                  top: dispCrop.top,
                  width: dispCrop.width,
                  height: dispCrop.height,
                  border: `2px solid ${ACCENT_RGBA}`,
                  cursor: 'move',
                }}
                onMouseDown={startDrag('move')}
              >
                <div style={{ ...handleStyle, left: -half, top: -half, cursor: 'nw-resize' }} onMouseDown={startDrag('nw')} />
                <div style={{ ...handleStyle, left: '50%', top: -half, marginLeft: -half, cursor: 'n-resize' }} onMouseDown={startDrag('n')} />
                <div style={{ ...handleStyle, right: -half, top: -half, cursor: 'ne-resize' }} onMouseDown={startDrag('ne')} />
                <div style={{ ...handleStyle, left: -half, top: '50%', marginTop: -half, cursor: 'w-resize' }} onMouseDown={startDrag('w')} />
                <div style={{ ...handleStyle, right: -half, top: '50%', marginTop: -half, cursor: 'e-resize' }} onMouseDown={startDrag('e')} />
                <div style={{ ...handleStyle, left: -half, bottom: -half, cursor: 'sw-resize' }} onMouseDown={startDrag('sw')} />
                <div style={{ ...handleStyle, left: '50%', bottom: -half, marginLeft: -half, cursor: 's-resize' }} onMouseDown={startDrag('s')} />
                <div style={{ ...handleStyle, right: -half, bottom: -half, cursor: 'se-resize' }} onMouseDown={startDrag('se')} />
              </div>
            </>
          )}
          </div>
        </div>
      </div>
    </DialogShell>
  );
}
