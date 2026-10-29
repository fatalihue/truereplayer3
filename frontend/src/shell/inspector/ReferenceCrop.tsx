import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { useEditorTools } from '../../logic/useEditorTools';
import { useTt } from '../../state/LanguageContext';
import { applyCropMode, cropBetween, cropIsUsable, type CropRect, type DragMode } from '../../utils/cropRect';
import { getActionTypeColors } from '../../utils/displayUtils';
import { stepName } from '../list/stepTypes';
import { useShell } from '../store';
import { closeCrop } from '../ui';
import { Segmented } from './fields';
import './referenceCrop.css';

type Zoom = 'fit' | '100' | '200';
const ZOOMS: { value: Zoom; label: string }[] = [{ value: 'fit', label: 'Fit' }, { value: '100', label: '100%' }, { value: '200', label: '200%' }];
const HANDLES: DragMode[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
// The room kept around the image in Fit, so the handles on its edges stay easy to take.
const FIT_PAD = 24;
// How far a press on the image travels, in screen px, before it draws a new selection.
const DRAW_SLOP = 3;

/** Back to the step's editor, with the keyboard on the image that opens the crop again. */
function leave() {
  closeCrop();
  requestAnimationFrame(() => document.querySelector<HTMLElement>('.insp-body [data-crop-open]')?.focus({ preventScroll: true }));
}

type Drag = { mode: DragMode | 'draw'; startX: number; startY: number; start: CropRect; anchor: { x: number; y: number } };

/**
 * The reference image's crop, in the expanded Inspector (dialogos-086 to 094, editor-passo-109): the
 * image at Fit, 100 % or 200 %, the part kept lit and the rest dimmed. Dragging on the image draws a
 * new selection, dragging inside it moves it and the eight handles resize it; with the keyboard the
 * arrows nudge it a pixel, Shift+arrows resize it, Ctrl makes either ten, and Enter keeps the crop
 * (Done) — one Ctrl+Z brings the old image back. Esc and Collapse editor leave it as it was;
 * Recapture takes a new image from the screen, which the crop starts over on.
 *
 * Nothing is written while it is open: the engine cuts the PNG on Done (waitimage:cropReference),
 * refusing under 10 px or the whole image.
 */
export default function ReferenceCrop({ step, index, count }: { step: ActionItem; index: number; count: number }) {
  const tools = useEditorTools();
  const tt = useTt();
  const hintId = useId();
  const colors = getActionTypeColors(step.actionType);
  const [image, setImage] = useState(step.imagePath);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });
  // A new image (Recapture) starts the crop over.
  if (image !== step.imagePath) {
    setImage(step.imagePath);
    setNatural(null);
  }
  const [zoom, setZoom] = useState<Zoom>('fit');
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const read = () => setArea({ w: el.clientWidth, h: el.clientHeight });
    read();
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  // The keyboard starts on the image, where the arrows work.
  useEffect(() => { areaRef.current?.focus({ preventScroll: true }); }, []);

  const scale = !natural ? 1
    : zoom === '100' ? 1
    : zoom === '200' ? 2
    : Math.max(0.05, Math.min((area.w - FIT_PAD * 2) / natural.w, (area.h - FIT_PAD * 2) / natural.h));
  const usable = natural !== null && cropIsUsable(crop, natural);

  const done = () => {
    if (!usable) return;
    const at = useShell.getState().app.actions.findIndex(s => s.id === step.id);
    if (at >= 0) tools.cropImage({ index: at, ...crop });
    leave();
  };

  // ── The mouse: one drag at a time on the image, its moves applied once a frame. ──
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const toImage = (e: { clientX: number; clientY: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !natural) return;
    e.preventDefault();
    areaRef.current?.focus({ preventScroll: true });
    const target = e.target as HTMLElement;
    const handle = target.dataset.handle as DragMode | undefined;
    const inside = !!target.closest('.crop-rect');
    const at = toImage(e, e.currentTarget);
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode: handle ?? (inside ? 'move' : 'draw'), startX: e.clientX, startY: e.clientY, start: crop, anchor: at };
  };
  const flush = (el: HTMLElement) => {
    frame.current = 0;
    const d = drag.current;
    const p = pending.current;
    if (!d || !p || !natural) return;
    if (d.mode === 'draw') {
      // A press that does not travel draws nothing: the selection there stays.
      if (Math.abs(p.x - d.startX) < DRAW_SLOP && Math.abs(p.y - d.startY) < DRAW_SLOP) return;
      const at = toImage({ clientX: p.x, clientY: p.y }, el);
      setCrop(cropBetween(d.anchor.x, d.anchor.y, at.x, at.y, natural));
    } else {
      setCrop(applyCropMode(d.mode, d.start, (p.x - d.startX) / scale, (p.y - d.startY) / scale, natural));
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    pending.current = { x: e.clientX, y: e.clientY };
    const el = e.currentTarget;
    if (!frame.current) frame.current = requestAnimationFrame(() => flush(el));
  };
  // The last move still waiting goes in before the drag ends, so the crop stops where it was let go.
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (frame.current) { cancelAnimationFrame(frame.current); flush(e.currentTarget); }
    drag.current = null;
    pending.current = null;
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // ── The keyboard. ──
  const onAreaKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = ARROWS[e.key];
    if (dir && natural && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const by = e.ctrlKey ? 10 : 1;
      setCrop(prev => applyCropMode(e.shiftKey ? 'se' : 'move', prev, dir[0] * by, dir[1] * by, natural));
      return;
    }
    if (e.key === 'Enter' && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      done();
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      leave();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      done();
    }
  };

  const shown = natural ? { w: natural.w * scale, h: natural.h * scale } : null;
  const rect = { left: crop.x * scale, top: crop.y * scale, width: crop.w * scale, height: crop.h * scale };
  return (
    <div className="crop" onKeyDown={onKeyDown}>
      <div className="insp-head">
        <span className="insp-tile" style={{ background: colors.bg, color: colors.fg }}>
          <span className="step-icon" data-icon="crop" />
        </span>
        <div className="insp-title">
          <span className="insp-name" data-display="">Reference image</span>
          <span className="insp-sub">{stepName(step.actionType)} · step {index + 1} of {count} · expanded</span>
        </div>
        <button type="button" className="insp-button" data-tip={tt('Capture the image again on the screen', 'Capturar a imagem de novo na tela')} onClick={() => {
          const at = useShell.getState().app.actions.findIndex(s => s.id === step.id);
          if (at >= 0) tools.recaptureImage({ index: at });
        }}>
          <span className="step-icon" data-icon="refresh-cw" />
          Recapture
        </button>
        <button type="button" className="insp-primary" disabled={!usable} data-tip={usable ? tt('Keep the crop (Enter)', 'Manter o recorte (Enter)') : tt('Pick a smaller region first', 'Selecione uma região menor primeiro')} onClick={done}>
          Done
        </button>
        <button type="button" className="insp-close" data-on="" aria-label="Collapse editor" data-tip={tt('Leave without cropping (Esc)', 'Sair sem recortar (Esc)')} onClick={leave}>
          <span className="step-icon" data-icon="minimize-2" />
        </button>
      </div>
      <div className="crop-bar">
        <Segmented<Zoom> label="Zoom" value={zoom} options={ZOOMS} onChange={setZoom} />
        <span className="crop-readout">
          {natural ? `Selection ${crop.w} × ${crop.h} px · at ${crop.x}, ${crop.y} · image ${natural.w} × ${natural.h}` : 'Loading…'}
        </span>
      </div>
      <div
        ref={areaRef}
        className="crop-area"
        tabIndex={0}
        role="group"
        aria-label="Crop region"
        aria-describedby={hintId}
        onKeyDown={onAreaKey}
      >
        <div
          className="crop-image"
          style={shown ? { width: shown.w, height: shown.h } : undefined}
          data-pixels={scale >= 2 || undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={onPointerUp}
        >
          {step.imageBase64 && (
            <img
              src={`data:image/png;base64,${step.imageBase64}`}
              alt="The reference image"
              draggable={false}
              onLoad={(e) => {
                const w = e.currentTarget.naturalWidth;
                const h = e.currentTarget.naturalHeight;
                setNatural({ w, h });
                setCrop({ x: 0, y: 0, w, h });
              }}
            />
          )}
          {natural && (
            <>
              {/* The four panes outside the crop, dimmed. */}
              <span className="crop-dim" style={{ left: 0, top: 0, right: 0, height: rect.top }} />
              <span className="crop-dim" style={{ left: 0, top: rect.top + rect.height, right: 0, bottom: 0 }} />
              <span className="crop-dim" style={{ left: 0, top: rect.top, width: rect.left, height: rect.height }} />
              <span className="crop-dim" style={{ left: rect.left + rect.width, top: rect.top, right: 0, height: rect.height }} />
              <span className="crop-rect" style={rect}>
                {HANDLES.map(h => <span key={h} className="crop-handle" data-handle={h} />)}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="insp-foot crop-foot">
        <span id={hintId}>Drag to select · arrows nudge · Shift+arrows resize · Ctrl ×10 · Enter keeps the crop</span>
        <span className="crop-foot-undo">Ctrl+Z brings the old image back</span>
      </div>
    </div>
  );
}
