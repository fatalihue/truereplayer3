// The Teclado's Mouse view (plan .claude/planos/teclado-mouse-desenho-2026-11-12.md): an original,
// generic gaming mouse seen from above, in theme tokens only. Each button that takes a function is a
// part of the drawing that paints what its label says (the page's own key face, beside the drawing),
// and a line joins the two, as the device apps do. The labels sit at fixed heights of the drawing, in
// viewBox units, so the lines, fixed in the viewBox, always reach the middle of their label at any
// size. No text in here: every word is the faces' HTML, so nothing shrinks under the 11 px floor when
// the drawing does. It lives with the page, so the opening never carries it.
import { MOUSE_CODES } from '../../mk/mkModel';
import { pickKey } from '../../mk/mkEdit';
import { useMk } from '../../mk/mkStore';

export type MouseCode = typeof MOUSE_CODES[number];
/** The two buttons that stay out (always normal): drawn, labelled, never chosen. */
export type MouseOut = 'MouseLeft' | 'MouseRight';

/** The drawing's box: the page keeps this aspect, so a % of the drawing's height is a y here. */
export const VIEW_W = 240;
export const VIEW_H = 300;

/**
 * The labels, column by column, top to bottom (the drawing's order, so no two lines cross), and the
 * middle of each in viewBox units. At the smallest drawing (10rem wide, 12.5rem tall) the closest two
 * are 26.5 % apart, about 53 px for a 40 px label.
 */
export const COLUMNS: { left: (MouseCode | MouseOut)[]; right: (MouseCode | MouseOut)[] } = {
  left: ['MouseLeft', 'MouseX2', 'MouseX1'],
  right: ['MouseRight', 'WheelUp', 'MouseMiddle', 'WheelDown'],
};
const LABEL_Y: Record<MouseCode | MouseOut, number> = {
  MouseLeft: 30, MouseX2: 139, MouseX1: 228,
  MouseRight: 30, WheelUp: 111, MouseMiddle: 190.5, WheelDown: 270,
};
/** Where a label's middle goes, in % of the drawing's height. */
export const labelTop = (id: MouseCode | MouseOut) => `${(LABEL_Y[id] / VIEW_H) * 100}%`;
/** A label's height, for the arrows that jump to the nearest one in the other column. */
export const labelY = (id: MouseCode | MouseOut) => LABEL_Y[id];

// ── The shapes (viewBox units). The body is symmetric, 132 wide at the palm and 266 long. ──

const BODY = 'M122 18C150 18 172 32 178 58C183 80 183 100 181 120C179 136 176 148 177 160C178 180 187 200 186 228C185 262 156 284 120 284'
  + 'C84 284 55 262 54 228C53 200 62 180 63 160C64 148 61 136 59 120C57 100 57 80 62 58C68 32 90 18 118 18Z';
// The two main buttons, from the tip to the seam over the palm, around the wheel's well.
const LEFT = 'M118 18V36.13A16 16 0 0 0 104 52V88A16 16 0 0 0 118 103.87V131C100 131 80 128 59 120C57 100 57 80 62 58C68 32 90 18 118 18Z';
const RIGHT = 'M122 18C150 18 172 32 178 58C183 80 183 100 181 120C160 128 140 131 122 131V103.87A16 16 0 0 0 136 88V52A16 16 0 0 0 122 36.13Z';
const WELL = 'M104 52a16 16 0 0 1 32 0v36a16 16 0 0 1-32 0Z';
// Where the top shell meets the side grips, from the buttons' seam toward the palm.
const GRIPS = 'M70 134C73 152 72 168 70 184C67 204 66 224 71 244M170 134C167 152 168 168 170 184C173 204 174 224 169 244';

/** The line to a label: from the dot on the button's edge, along, down, and along. */
interface Lead {
  line: string;
  dot: [number, number];
}
interface Part extends Lead {
  /** The part's outline. */
  d: string;
  /** What is drawn on it, in its function's ink: the wheel's arrows and ridges. */
  ink?: string;
}

/** A line from (x0, y0) to the knee at kx, along it to y1, and on to x1, the two corners rounded. */
function elbow(x0: number, y0: number, kx: number, y1: number, x1: number, r = 4): string {
  if (y0 === y1) return `M${x0} ${y0}H${x1}`;
  const sx = Math.sign(kx - x0), sy = Math.sign(y1 - y0), sx1 = Math.sign(x1 - kx);
  return `M${x0} ${y0}H${kx - sx * r}Q${kx} ${y0} ${kx} ${y0 + sy * r}V${y1 - sy * r}Q${kx} ${y1} ${kx + sx1 * r} ${y1}H${x1}`;
}

// The wheel, in three parts on one wheel: the top for Wheel ↑, the ridged middle for its click,
// the bottom for Wheel ↓. The side buttons stand a little out of the left flank, the front one first.
// The right column's three lines turn in nested knees (the lowest first), so none crosses another.
const PARTS: Record<MouseCode, Part> = {
  WheelUp: { d: 'M109 59V53a11 11 0 0 1 22 0v6Z', ink: 'M115.5 55.5 120 51l4.5 4.5', line: elbow(131, 56, 224, LABEL_Y.WheelUp, VIEW_W), dot: [131, 56] },
  MouseMiddle: { d: 'M109 60h22v20h-22Z', ink: 'M113.5 64h13M113.5 68h13M113.5 72h13M113.5 76h13', line: elbow(131, 70, 212, LABEL_Y.MouseMiddle, VIEW_W), dot: [131, 70] },
  WheelDown: { d: 'M109 81h22v6a11 11 0 0 1-22 0Z', ink: 'M115.5 84.5 120 89l4.5-4.5', line: elbow(131, 84, 200, LABEL_Y.WheelDown, VIEW_W), dot: [131, 84] },
  MouseX2: { d: 'M51 132a6 6 0 0 1 12 0v14a6 6 0 0 1-12 0Z', line: elbow(51, LABEL_Y.MouseX2, 0, LABEL_Y.MouseX2, 0), dot: [51, LABEL_Y.MouseX2] },
  MouseX1: { d: 'M51 162a6 6 0 0 1 12 0v14a6 6 0 0 1-12 0Z', line: elbow(51, 169, 30, LABEL_Y.MouseX1, 0), dot: [51, 169] },
};
// The out buttons' lines leave from where the outline crosses their label's height.
const OUT_LINES: Record<MouseOut, Lead> = {
  MouseLeft: { line: elbow(79.4, LABEL_Y.MouseLeft, 0, LABEL_Y.MouseLeft, 0), dot: [79.4, LABEL_Y.MouseLeft] },
  MouseRight: { line: elbow(160.6, LABEL_Y.MouseRight, VIEW_W, LABEL_Y.MouseRight, VIEW_W), dot: [160.6, LABEL_Y.MouseRight] },
};

/** What a button of the drawing shows: the same as its face (data-fn, data-source, data-held), and its tip. */
export interface MousePartState {
  fn?: string;
  source?: 'base' | 'global';
  held?: boolean;
  tip: string;
}

/** Choosing a button on the drawing does what its label does, and takes the focus there. */
function choose(code: MouseCode, chosen: boolean) {
  pickKey(chosen ? null : code);
  document.querySelector<HTMLElement>(`.tk-mouse [data-code="${code}"]`)?.focus({ preventScroll: true });
}

/**
 * The drawing. It reads only which button is chosen; the page passes each button's state, read once
 * (rule 1). The highlight between a button and its label is CSS (teclado.css, :has()), never script.
 */
export function MouseDrawing({ parts, outTip }: { parts: Record<MouseCode, MousePartState>; outTip: string }) {
  const chosen = useMk(s => s.key);
  return (
    <svg className="tk-mdraw" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden="true" focusable="false">
      <path className="tk-m-lip" d={BODY} transform="translate(0 3)" />
      <path className="tk-m-body" d={BODY} />
      <path className="tk-m-out" d={LEFT} data-part="MouseLeft" data-tip={outTip} />
      <path className="tk-m-out" d={RIGHT} data-part="MouseRight" data-tip={outTip} />
      <path className="tk-m-well" d={WELL} />
      <path className="tk-m-grip" d={GRIPS} />
      <path className="tk-m-shell" d={BODY} />
      {(['MouseX2', 'MouseX1'] as const).map(code => <path key={code} className="tk-m-lip" d={PARTS[code].d} transform="translate(0 1.5)" />)}
      {MOUSE_CODES.map((code) => {
        const p = PARTS[code];
        const s = parts[code];
        const on = chosen === code;
        return (
          <g key={code} className="tk-mp" data-part={code} data-fn={s.fn} data-source={s.source} data-held={s.held || undefined}
            data-on={on || undefined} data-tip={s.tip} onClick={() => choose(code, on)}>
            <path className="tk-mp-face" d={p.d} />
            <path className="tk-mp-edge" d={p.d} />
            {p.ink && <path className="tk-mp-ink" d={p.ink} />}
          </g>
        );
      })}
      {(Object.keys(OUT_LINES) as MouseOut[]).map(id => (
        <g key={id} className="tk-ml" data-part={id} data-out="">
          <path className="tk-ml-line" d={OUT_LINES[id].line} />
          <circle className="tk-ml-dot" cx={OUT_LINES[id].dot[0]} cy={OUT_LINES[id].dot[1]} r="2.5" />
        </g>
      ))}
      {MOUSE_CODES.map(code => (
        <g key={code} className="tk-ml" data-part={code} data-on={chosen === code || undefined}>
          <path className="tk-ml-line" d={PARTS[code].line} />
          <circle className="tk-ml-dot" cx={PARTS[code].dot[0]} cy={PARTS[code].dot[1]} r="2.5" />
        </g>
      ))}
    </svg>
  );
}
