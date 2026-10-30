// The colour editor's arithmetic (Settings › Appearance › Edit colors…): a picked colour keeping the
// alpha of the one it replaces, and the contrast a colour reaches once painted. Apart from themes.ts,
// which the start loads, because only the editor needs them; they solve with themes.ts's own
// constants and helpers (deriveHueInk, HUE_SOLVE_TINT, HUE_WASH_ALPHA), so the checker still measures
// what applyThemeConfig paints.
import {
  colorAlpha, contrastRatio, DEFAULT_UI_SETTINGS, deriveHueInk, flattenOver, hexToRGB, HUE_SOLVE_TINT, HUE_WASH_ALPHA,
  isParsableColor, pickInk, rgbToHex, toHex,
  type ThemeColors, type ThemeUISettings,
} from './themes';

/** `newHex` carrying the alpha of `originalColor`, in the original's spelling: #RRGGBBAA for a hex
 *  original, rgba() for any other. An opaque original gives newHex back. It used to know only an
 *  `rgba(` prefix, so the first picker touch on an imported translucent #3c3c3c40 border (or an
 *  hsla()) saved it fully opaque. */
export function withOriginalAlpha(newHex: string, originalColor: string): string {
  const a = colorAlpha(originalColor);
  if (a >= 1) return newHex;
  const { r, g, b } = hexToRGB(toHex(newHex));
  if (originalColor.trim().startsWith('#')) {
    return rgbToHex(r, g, b) + Math.round(a * 255).toString(16).padStart(2, '0');
  }
  return `rgba(${r},${g},${b},${+a.toFixed(3)})`;
}

/**
 * What a colour field will ACTUALLY measure once painted — the number the Theme Editor shows.
 *
 * It solves with applyThemeConfig's own recipe (themes.ts), on purpose. The old checker compared four raw text
 * colours against bg-surface and nothing else, which made it wrong in three separate ways: it
 * never looked at accent-solid (whose ink is contrast-PICKED, so the raw accent tells you
 * nothing), it never looked at the fourteen hue fields (whose ink is DERIVED, so the stored value
 * is an identity and not the paint), and it used one surface where the token lands on four. A
 * checker that measures a different thing from what the renderer paints is worse than none: it
 * reports green while the pill is at 1.5:1. Keeping the two recipes in one file is what stops
 * them drifting apart again.
 *
 * Returns null for fields that have no ink of their own (a surface, a disabled text colour that
 * WCAG exempts by design) rather than inventing a number for them.
 */
export function measurePaintedContrast(
  kind: 'theme' | 'ui',
  key: string,
  colors: ThemeColors,
  ui: ThemeUISettings,
): { ratio: number; target: number; what: string } | null {
  const surfaces = [colors['bg-surface'], colors['bg-card'], colors['bg-elevated'], colors['bg-base']];
  const text = colors['text-primary'];
  // Flatten before comparing. A token stored as rgba() is a translucent LAYER, and contrastRatio
  // goes through toHex, which drops alpha — so measuring one raw reports the contrast of a colour
  // that is never painted. Every preset ships its three borders as rgba at 6–25 % alpha: measured
  // raw, gruvbox-dark's border-subtle reads 8.45:1 where the hairline actually paints 1.17:1, and
  // all 37 presets were wrong the same way, by up to 12.8x. That is the precise failure this
  // function exists to prevent, so the fix belongs here rather than at the call sites.
  const worstAgainst = (ink: string, backdrops: string[]) =>
    backdrops.filter(isParsableColor).reduce((w, b) => Math.min(w, contrastRatio(flattenOver(ink, b), b)), Infinity);

  if (kind === 'theme') {
    // A background has no ink of its own — the text fields already measure against it.
    if (key.startsWith('bg-')) return null;
    // A colour, or all of its backdrops, that cannot be read gets no chip: measured anyway, it
    // went through toHex as #000000 and the chip reported a colour nothing paints.
    const own = colors[key as keyof ThemeColors];
    if (!isParsableColor(own) || !surfaces.some(isParsableColor)) return null;
    if (key.startsWith('text-')) {
      // text-disabled is NOT exempt here, and the WCAG exemption was the wrong reading: that
      // exemption covers controls in the [disabled] state, while this token is the RESTING colour
      // of ~114 sites, many of them enabled icon buttons (the SendText delete, the extension
      // banner dismiss, icon buttons across DataPanel and ProfilePanel). Dropping it to 1.5:1 on
      // a light preset erases live controls. It gets the graphic floor rather than the body-text
      // one, because it is deliberately the quietest rung and 4.5 would stop it reading as quiet.
      const target = key === 'text-disabled' ? 3 : 4.5;
      return { ratio: worstAgainst(colors[key as keyof ThemeColors], [...surfaces, colors['bg-input']]), target, what: 'worst surface' };
    }
    if (key.startsWith('border-')) {
      // WCAG 1.4.11 — a boundary that carries meaning needs 3:1, not 4.5.
      return { ratio: worstAgainst(colors[key as keyof ThemeColors], [colors['bg-surface'], colors['bg-card'], colors['bg-input']]), target: 3, what: 'UI boundary' };
    }
    if (key === 'accent-solid') {
      // The solid button: the label is pickInk's choice, not white, so measure THAT pairing.
      return { ratio: contrastRatio(pickInk(colors['accent-solid']), colors['accent-solid']), target: 4.5, what: 'label on solid fill' };
    }
    if (key === 'accent' || key === 'accent-hover') {
      return { ratio: worstAgainst(colors[key as keyof ThemeColors], surfaces), target: 4.5, what: 'accent as text' };
    }
    return null;
  }

  // The seventeen hue fields. Each is painted as DERIVED ink over its own translucent wash, so
  // both sides of the comparison have to be reconstructed exactly as applyThemeConfig emits them.
  // Target 3 matches the floor those inks are solved for: they are glyphs and labels beside an
  // icon, not body text — see the deriveHueInk call sites.
  const wash = HUE_WASH_ALPHA[key];
  if (wash === undefined) return null;
  // Same `??` guard applyThemeConfig carries, and for the same reason: this is also called with a
  // uiSettings that never went through loadThemeConfig's spread (the live preview, a snapshot
  // restore). Without it the three fields this feature just added were the only ones with no chip.
  const hue = (ui as unknown as Record<string, string | undefined>)[key]
    ?? (DEFAULT_UI_SETTINGS as unknown as Record<string, string>)[key];
  if (!isParsableColor(hue) || !isParsableColor(text)) return null;
  // HUE_SOLVE_TINT, not `wash`: these are two different numbers that used to be conflated here.
  // maxTint is what the SOLVE brackets against (applyThemeConfig passes 0.12 for every hue), while
  // the wash is the alpha of the -bg actually emitted (10 % for recording/replay, 12 % elsewhere).
  // Passing the wash as maxTint made the solve land a step early, so the editor showed the ratio
  // of an ink the app never paints — 4 of 111 semantic cases, off by up to 0.31.
  const ink = deriveHueInk(hue, text, surfaces, 3, HUE_SOLVE_TINT, 72);
  // The solve fell back to a color-mix string (unparsable surfaces): nothing numeric to report.
  if (!ink.startsWith('#')) return null;
  const h = hexToRGB(toHex(hue));
  // Both the bare surface AND its washed composite, mirroring the backdrop set deriveHueInk
  // solves against. Measured no difference on the shipped presets — the composite dominates —
  // but an authored theme can invert that, and matching the solve costs nothing.
  const backdrops: string[] = [];
  for (const s of surfaces.filter(isParsableColor)) {
    backdrops.push(toHex(s));
    const b = hexToRGB(toHex(s));
    backdrops.push(rgbToHex(h.r * wash + b.r * (1 - wash), h.g * wash + b.g * (1 - wash), h.b * wash + b.b * (1 - wash)));
  }
  return { ratio: worstAgainst(ink, backdrops), target: 3, what: 'derived ink on its own wash' };
}
