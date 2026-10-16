import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { uiZoom, rectToLayout } from '../../utils/zoomSpace';

type Pending = { text: string; rect: DOMRect; pos: string; mx: number; my: number };

// A popup trigger whose popup is open — aria-expanded="true" on a trigger that opens a FLOATING
// popup: a real ARIA menu (aria-haspopup="menu": a column ⋯, the Theme Editor's Reset) or a
// disclosure popover marked data-popup-trigger (the Toolbar's Wait / Conditional / Browser / More
// / Clear All — panels of buttons, not role=menu, so they must not claim aria-haspopup). Its tip
// names what the open popup is already showing, and it lands ON that popup: the Clear All tip
// used to sit over the confirm it had just opened. A plain inline disclosure (aria-expanded alone,
// e.g. the Theme Editor's HSL toggle) keeps its tip — what it opens is nowhere near the tip.
const isOpenPopupTrigger = (el: Element) => {
  if (el.getAttribute('aria-expanded') !== 'true') return false;
  const popup = el.getAttribute('aria-haspopup');
  return (popup !== null && popup !== 'false') || el.hasAttribute('data-popup-trigger');
};

// Single global tooltip renderer for the whole app. Any element with a `data-tip="..."` attribute
// shows a tooltip on hover, rendered as a body portal — so it's instant (no native-title ~1s lag),
// never clipped by panel/modal overflow, wraps at a max width, and auto-positions with flip + clamp
// to stay on-screen. `data-tip-pos` (left | right | end | below-start) is an optional placement hint.
// Replaces the native title= tooltips, the old [data-tip]::after CSS, and the per-row settings portal.
// Mount ONCE near the app root.
export function TooltipLayer() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const currentTarget = useRef<Element | null>(null);

  useEffect(() => {
    // An anchor removed from the DOM while hovered (e.g. a toolbar / bulk bar that unmounts
    // right after a click/confirm) never fires mouseout, which would strand its tooltip on
    // screen until the next hover. Watch for it disconnecting and hide.
    //
    // Observed only BETWEEN show and hide. The callback was always cheap, but the observation is
    // not free: the engine allocates and queues a MutationRecord for every childList change
    // anywhere in the document — every action-list update during a replay, every Lexical keystroke
    // (chip nodes are inserted and split) — and this can only ever matter while a tooltip is up,
    // which is a tiny fraction of the time.
    //
    // The same callback hides the tip of a trigger whose popup just opened by a path that was not
    // a press (see isOpenPopupTrigger): opening a popup mounts its DOM, so the childList record
    // arrives in the same commit that flipped aria-expanded.
    const observer = new MutationObserver(() => {
      const t = currentTarget.current;
      if (t && (!t.isConnected || isOpenPopupTrigger(t))) hide();
    });
    // The anchor the pointer last pressed. A press hides the tip — whatever the click opens (a
    // menu, a confirm, a dialog) must not wear it — and that anchor stays quiet until the pointer
    // leaves it, as a native Windows tooltip does: mouseover fires again for every child the
    // pointer crosses inside the anchor (icon → label), so without the latch the tip came
    // straight back over the popup.
    let pressed: Element | null = null;
    const hide = () => {
      observer.disconnect();
      currentTarget.current = null; setPending(null); setCoords(null);
    };
    const show = (el: HTMLElement, mx: number, my: number) => {
      const text = el.getAttribute('data-tip');
      if (!text) return;
      // A REVEAL tip carries the anchor's own content and nothing else — it exists so a value
      // clipped by its column can still be read. When the anchor is not clipped, that tip is the
      // text the user is already looking at, so it says nothing and is skipped. Opt-in per anchor
      // (`data-tip-reveal`) rather than inferred from text equality: the anchor may render the same
      // value differently from the raw string the tip carries — a SendText payload draws its
      // `{Enter}` tokens as chips, so the two never compare equal even when nothing is hidden.
      if (el.hasAttribute('data-tip-reveal') && el.scrollWidth <= el.clientWidth) return;
      if (isOpenPopupTrigger(el)) return;
      // Watch the DOM only while a tooltip is actually up (see the observer below for why it
      // exists). Re-observing an already-observing MutationObserver on the same target+options
      // is a no-op, so a hover moving straight from one anchor to the next is fine.
      observer.observe(document.body, { childList: true, subtree: true });
      currentTarget.current = el;
      setCoords(null); // re-measure before showing
      setPending({ text, rect: el.getBoundingClientRect(), pos: el.getAttribute('data-tip-pos') || 'auto', mx, my });
    };
    const onOver = (e: Event) => {
      const el = (e.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el && el !== currentTarget.current && el !== pressed) show(el, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
    };
    const onOut = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest?.('[data-tip]');
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return; // still inside the same target
      if (el === pressed) pressed = null;
      if (el === currentTarget.current) hide();
    };
    const onDown = (e: PointerEvent) => {
      pressed = (e.target as HTMLElement)?.closest?.('[data-tip]') ?? null;
      hide();
    };
    // capture phase + delegation so it works for every element, present or future.
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('pointerdown', onDown, true);
    // The anchor rect is captured at hover time, so a scroll would strand the tooltip — hide it.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      observer.disconnect();
    };
  }, []);

  // Measure the rendered tooltip, then place it relative to the anchor (honouring data-tip-pos),
  // flipping up if there's no room below and clamping to the viewport so it never goes off-screen.
  useLayoutEffect(() => {
    if (!pending || !tipRef.current) return;
    // Everything measured below arrives in visual space; the coordinates we emit are consumed
    // in layout space. Convert the inputs ONCE here (see utils/zoomSpace) so the placement maths
    // and its px constants all mean the same thing, and the result can be written out as-is.
    const zoom = uiZoom();
    const a = rectToLayout(pending.rect, zoom);
    const t = rectToLayout(tipRef.current.getBoundingClientRect(), zoom);
    const gap = 10, m = 8, CURSOR = 24; // CURSOR: keep below/above tooltips clear of the pointer
    const vw = window.innerWidth / zoom, vh = window.innerHeight / zoom;
    const my = pending.my / zoom; // clientY is visual too
    let left: number, top: number;
    let flippedAbove = false; // default placement had to flip above the anchor
    switch (pending.pos) {
      case 'left':
        left = a.left - gap - t.width; top = a.top + a.height / 2 - t.height / 2; break;
      case 'right':
        left = a.right + gap; top = a.top + a.height / 2 - t.height / 2; break;
      case 'below-start':
        left = a.left; top = a.bottom + gap; break;
      case 'end':
        left = a.right - t.width; top = a.bottom + gap; break;
      default: // below, centred; flip above if no room below
        left = a.left + a.width / 2 - t.width / 2;
        top = a.bottom + gap;
        if (top + t.height > vh - m) { top = a.top - gap - t.height; flippedAbove = true; }
    }
    // Cursor clearance for the below/above placements: push the tooltip past the pointer so it
    // never covers the cursor (the anchor is under the cursor, and a tight below-gap would land the
    // tooltip right on the pointer tip). Side placements (left/right) already sit clear of it.
    if (Number.isFinite(my) && (pending.pos === 'auto' || pending.pos === 'below-start' || pending.pos === 'end')) {
      if (flippedAbove) top = Math.min(top, my - CURSOR - t.height);
      else top = Math.max(top, my + CURSOR);
    }
    // Clamp so the top-left corner is never < m, even when space is tight (max wins outermost).
    left = Math.max(m, Math.min(left, vw - t.width - m));
    top = Math.max(m, Math.min(top, vh - t.height - m));
    setCoords({ left, top });
  }, [pending]);

  if (!pending) return null;
  return createPortal(
    <div
      ref={tipRef}
      className="app-tip"
      // Render off-screen for the measure pass (useLayoutEffect runs before paint, so this is
      // never visible), then snap to the computed position.
      style={coords ? { left: coords.left, top: coords.top } : { left: -9999, top: -9999 }}
    >
      {pending.text}
    </div>,
    document.body,
  );
}
