// The crop of a reference image, in image pixels: one rule for every door that moves it — the
// handles, the drag inside, the arrow keys — in the cropper of today (ImageCropper) and in the
// expanded Inspector's (shell/inspector/ReferenceCrop), so neither can reach a rectangle the other
// could not. The engine refuses a crop under 10 px (waitimage:cropReference).

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DragMode =
  | 'move'
  | 'nw' | 'n' | 'ne'
  | 'w' | 'e'
  | 'sw' | 's' | 'se';

export const MIN_CROP = 10;

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/**
 * The crop after moving `mode`'s edge(s) by (dx, dy) image px from `start`, clamped to the image
 * and to MIN_CROP.
 */
export function applyCropMode(
  mode: DragMode,
  start: CropRect,
  dx: number,
  dy: number,
  natural: { w: number; h: number },
): CropRect {
  let { x, y, w, h } = start;
  const right = start.x + start.w;
  const bottom = start.y + start.h;
  switch (mode) {
    case 'move':
      x = clamp(x + dx, 0, natural.w - w);
      y = clamp(y + dy, 0, natural.h - h);
      break;
    case 'nw':
      x = clamp(start.x + dx, 0, right - MIN_CROP);
      y = clamp(start.y + dy, 0, bottom - MIN_CROP);
      w = right - x;
      h = bottom - y;
      break;
    case 'n':
      y = clamp(start.y + dy, 0, bottom - MIN_CROP);
      h = bottom - y;
      break;
    case 'ne':
      y = clamp(start.y + dy, 0, bottom - MIN_CROP);
      h = bottom - y;
      w = clamp(start.w + dx, MIN_CROP, natural.w - x);
      break;
    case 'w':
      x = clamp(start.x + dx, 0, right - MIN_CROP);
      w = right - x;
      break;
    case 'e':
      w = clamp(start.w + dx, MIN_CROP, natural.w - x);
      break;
    case 'sw':
      x = clamp(start.x + dx, 0, right - MIN_CROP);
      w = right - x;
      h = clamp(start.h + dy, MIN_CROP, natural.h - y);
      break;
    case 's':
      h = clamp(start.h + dy, MIN_CROP, natural.h - y);
      break;
    case 'se':
      w = clamp(start.w + dx, MIN_CROP, natural.w - x);
      h = clamp(start.h + dy, MIN_CROP, natural.h - y);
      break;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  };
}

/**
 * A crop drawn from one point to another, in image px: the two corners in either order, clamped
 * to the image and never under MIN_CROP (it grows away from the image's edge where it must).
 */
export function cropBetween(ax: number, ay: number, bx: number, by: number, natural: { w: number; h: number }): CropRect {
  const span = (a: number, b: number, size: number): [number, number] => {
    const lo = clamp(Math.min(a, b), 0, size);
    const hi = clamp(Math.max(a, b), 0, size);
    const len = Math.min(size, Math.max(MIN_CROP, hi - lo));
    return [Math.round(Math.min(lo, size - len)), Math.round(len)];
  };
  const [x, w] = span(ax, bx, natural.w);
  const [y, h] = span(ay, by, natural.h);
  return { x, y, w, h };
}

/** A crop that keeps something to cut: at least MIN_CROP each way, and not the whole image. */
export function cropIsUsable(crop: CropRect, natural: { w: number; h: number }): boolean {
  return crop.w >= MIN_CROP && crop.h >= MIN_CROP
    && !(crop.x === 0 && crop.y === 0 && crop.w === natural.w && crop.h === natural.h);
}
