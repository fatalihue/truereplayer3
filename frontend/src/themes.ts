export interface ThemeColors {
  'bg-base': string;
  'bg-surface': string;
  'bg-card': string;
  'bg-elevated': string;
  'bg-input': string;
  'border-subtle': string;
  'border-default': string;
  'border-strong': string;
  'text-primary': string;
  'text-secondary': string;
  'text-tertiary': string;
  'text-disabled': string;
  accent: string;
  'accent-solid': string;
  'accent-hover': string;
}

export const THEME_COLOR_KEYS: (keyof ThemeColors)[] = [
  'bg-base', 'bg-surface', 'bg-card', 'bg-elevated', 'bg-input',
  'border-subtle', 'border-default', 'border-strong',
  'text-primary', 'text-secondary', 'text-tertiary', 'text-disabled',
  'accent', 'accent-solid', 'accent-hover',
];

export interface ThemePreset {
  id: string;
  name: string;
  colors: ThemeColors;
  /** 4 preview swatches shown in the theme card */
  preview: [string, string, string, string];
}

export interface ThemeUISettings {
  fontSize: number;
  borderRadius: number;
  rowHeight: number;
  zoom: number;
  recordingColor: string;
  replayColor: string;
  // Clicker mode has its own identity (used by the Clicker tab UI + repeating clicks);
  // exposed as a customizable semantic color so it stays cohesive when the accent changes.
  clickerColor: string;
  actionMouseColor: string;
  actionKeyColor: string;
  actionScrollColor: string;
  actionSendTextColor: string;
  // SetVariable was sharing SendText's gold — the two "text/data" actions looked
  // identical. Its own hue (default a vivid magenta) sits in the one perceptually-
  // open pill slot left on the wheel, clear of every other action.
  actionSetVariableColor: string;
  actionWaitImageColor: string;
  actionPixelColorColor: string;
  actionBrowserColor: string;
  actionRunProfileColor: string;
  actionPauseColor: string;
  // Conditional / control-flow rows (If / Else / EndIf). Distinct hue from the two
  // other purples in the palette (Mouse #a78bfa, Clicker mode #c084fc) — amber sits
  // in the gold band but at a saturation/brightness that reads as "decision/branch"
  // rather than "sendtext gold" (#d4a020). The token is consumed by the conditional
  // row pill + rail + ghost "+ Add Else" button.
  actionIfColor: string;
  // Loop (While / EndLoop / Break / Next / ForEachRow), flow leaves (Stop / Return) and
  // ActivateWindow. displayUtils already reads these with a fallback to If / Pause / RunProfile,
  // so a config written before they existed keeps exactly the colours it had.
  actionLoopColor: string;
  actionFlowColor: string;
  actionActivateWindowColor: string;
  fontMono: string;
  // When true, auto-switch between darkPresetId / lightPresetId based on the OS
  // prefers-color-scheme media query. ThemeContext listens to changes and updates
  // the active preset live. Defaults: false so behaviour is unchanged for users
  // who didn't opt in.
  matchSystemTheme: boolean;
  darkPresetId: string;
  lightPresetId: string;
  // UI transitions / micro-interactions. 'system' (the default) follows the Windows "Animation
  // effects" setting LIVE, through prefers-reduced-motion; 'on' and 'off' pin the choice. Owner
  // decision 2026-10-16 (D4): the OS used to count only on the first run, seeding a boolean that
  // nothing re-read — someone who turns effects off in Windows does it there, not in every app.
  // See effectiveAnimations() and animationModeFrom() (the migration from the old boolean).
  animationMode: AnimationMode;
  /** Legacy (≤ 2.47.0) boolean, read ONLY by animationModeFrom() and then dropped. */
  enableAnimations?: boolean;
}

export type AnimationMode = 'system' | 'on' | 'off';

export const isAnimationMode = (v: unknown): v is AnimationMode => v === 'system' || v === 'on' || v === 'off';

/**
 * The mode a stored or imported uiSettings object means. A valid `animationMode` wins; without
 * one it is a config from before the mode existed, where the old `enableAnimations` boolean
 * stands in: `false` was a deliberate (or OS-seeded) "no animations" and stays Off; `true` or
 * missing becomes System — identical behaviour for as long as Windows keeps its effects on.
 */
export function animationModeFrom(ui: unknown): AnimationMode {
  const u = (ui && typeof ui === 'object' ? ui : {}) as Record<string, unknown>;
  if (isAnimationMode(u.animationMode)) return u.animationMode;
  return u.enableAnimations === false ? 'off' : 'system';
}

/** Whether animations run: the mode, with 'system' answered by the OS reduced-motion flag. */
export function effectiveAnimations(mode: AnimationMode, osReducesMotion: boolean): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return !osReducesMotion;
}

/** The OS reduced-motion flag right now (false where matchMedia is unavailable). */
export function osReducesMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const DEFAULT_UI_SETTINGS: ThemeUISettings = {
  fontSize: 13,
  borderRadius: 3,
  rowHeight: 34,
  // 90, lowered from 95 in 2026-08. Existing installs are moved by the v4 → v5 migration
  // in loadThemeConfig, but ONLY when their stored value is still exactly 95 — a saved
  // config always carries a zoom, so without that migration this constant would only ever
  // reach fresh installs.
  zoom: 90,
  recordingColor: '#ff6b6b',
  replayColor: '#6bcb77',
  clickerColor: '#c084fc',
  actionMouseColor: '#a78bfa',
  actionKeyColor: '#60cdff',
  // Mint green — lighter / softer than the previous #6bcb77 so it reads as
  // distinct from PixelColor's lime (#84cc16) at a glance. Same green "movement"
  // semantic carried by Scroll actions.
  actionScrollColor: '#8be597',
  actionSendTextColor: '#d4a020',
  // Magenta (~315°) — the last open pill slot: ~23° from WaitImage's fuchsia and
  // far from the SendText gold it used to share. Only near the block-1 rose RAIL
  // (a different visual role), never another pill. Its own icon (Braces) reinforces
  // the split.
  actionSetVariableColor: '#e05cbf',
  actionWaitImageColor: '#e879f9',
  // Lime — replaced the old cyan (#22d3ee) which collided with Key (#60cdff) at
  // only 13° of hue separation. Lime occupies the open slot between SendText
  // gold (43°) and Scroll green (127°), giving 43°+ to every neighbour. No
  // hardcoded semantic — PixelColor is "watch any colour", so the action is the
  // free agent of the palette.
  //
  // Darkened #84cc16 → #65a30d (v3→v4): under deuteranopia every 60–180° hue
  // compresses toward yellow and discrimination falls back to LIGHTNESS — and
  // the old lime sat within ~2 L* of Replay green (#6bcb77), making the two a
  // colorblind twin pair in the grid. The darker lime opens a ~13 L* gap while
  // keeping the hue slot. (Scroll mint vs Replay green share a hue by DESIGN —
  // same "movement" family, separated by lightness — and If moved to teal in
  // v2→v3, so this was the last confusable pair.)
  actionPixelColorColor: '#65a30d',
  actionBrowserColor: '#fb923c',
  // True blue, picked to be distinct from Key cyan (#60cdff) and Mouse purple
  // (#a78bfa). Carries the "control flow / chain call" semantic.
  actionRunProfileColor: '#3b82f6',
  // Slate — neutral grey-blue, semantically "inactive / waiting". Replaces the
  // previous amber (#fbbf24), which shared its exact hue (43°) with SendText
  // gold and only differed in brightness — visually too close. Slate sits in a
  // hue range no other action uses (~215°) and stays distinguishable from
  // RunProfile's vivid blue by saturation (slate is desaturated grey-blue,
  // RunProfile is fully saturated).
  actionPauseColor: '#94a3b8',
  // Teal — replaces the original amber (#fbbf24), which shared its hue (43°) with
  // SendText gold (#d4a020) and was only distinguishable by brightness/saturation.
  // At the action-pill size in the grid (~30 px wide) the two amber tones looked
  // confusingly alike. Teal sits at 170° — 38° from Scroll mint, 28° from Key
  // cyan, comfortably distinct from every other action. Preserves the
  // "structural / decision" semantic without the warm-amber collision. The
  // v2→v3 migration swaps the old #fbbf24 default for anyone who never
  // customised the colour.
  actionIfColor: '#2dd4bf',
  // The three tokens below fill molds that displayUtils has consumed with a fallback since
  // they were introduced (`var(--color-action-loop-fg, var(--color-action-if-fg))` and friends).
  // They were left unfilled because "a dedicated token would have to be added to all 48 theme
  // presets" — that premise is no longer true: action hues live in uiSettings, which is GLOBAL,
  // so filling one costs a default here and a row in the editor, not 37 palette edits.
  //
  // Each stays in its family on purpose, because the sharing was a deliberate reading and not an
  // oversight: a While IS a condition row, Stop/Return IS a quiet leaf, ActivateWindow IS a
  // window op. So they are separated the way Scroll mint is separated from Replay green — one
  // step along the same branch, not a new hue slot.
  //
  // Picked by measurement, not by eye: each candidate was scored by its smallest CIEDE2000
  // distance against every other pill AFTER the per-theme ink solve, across two dark and three
  // light presets. The worst EXISTING pair on that sample is setvariable/waitimage at ΔE 4.6, so
  // that is the bar a new hue must clear to avoid making the worst case worse.
  //
  // Emerald — one step deeper along the If teal. ΔE 7.8 minimum (nearest: Scroll).
  actionLoopColor: '#059669',
  // Stone — the Pause neutral shifted warm and darker, so "ending" reads as kin to "waiting"
  // without being a second cool grey. ΔE 9.0 minimum, the best-separated of the three.
  actionFlowColor: '#78716c',
  // Indigo — adjacent to RunProfile's blue, the open slot between it and Mouse's violet.
  // ΔE 7.5 minimum (nearest: Mouse).
  actionActivateWindowColor: '#4f46e5',
  // Cascadia Mono ships with Windows 11 (and with Windows Terminal on 10); Consolas stays in the
  // fallback stack applyThemeConfig emits, so a machine without it sees exactly what it saw
  // before. The v6 → v7 migration moves a stored 'Consolas' here ONLY when it is still the old
  // default, the same only-if-still-default rule the colour migrations use.
  fontMono: 'Cascadia Mono',
  matchSystemTheme: false,
  darkPresetId: 'lavender-coal',
  lightPresetId: 'github-light',
  animationMode: 'system',
};

// v7 = default monospace font Consolas → Cascadia Mono (2026-09-04 main-window polish).
export const CURRENT_THEME_CONFIG_VERSION = 7;

export interface ThemeConfig {
  // Schema version. v1 = original; v2 = palette pass (PixelColor / Scroll / Pause
  // defaults swapped); v3 = If color moved from amber to teal to resolve hue
  // collision with SendText gold; v4 = PixelColor lime darkened (#84cc16 →
  // #65a30d) for deuteranopia lightness separation from Replay green; v5 = default
  // zoom 95 → 90; v6 = preset ids retired by the 2026-08 curation remapped to
  // their surviving relatives (REMOVED_THEME_FALLBACKS).
  // loadThemeConfig migrates v1 → … → v6 in place. Writers must use
  // CURRENT_THEME_CONFIG_VERSION (below) — a stale literal at any write site
  // silently re-runs migrations on the next load. Listed as `number` rather
  // than a literal union so future bumps don't require a type edit everywhere.
  version: number;
  baseThemeId: string;
  colorOverrides: Partial<ThemeColors>;
  uiSettings: ThemeUISettings;
}

export interface ExportedTheme {
  name: string;
  version: 1;
  colors: ThemeColors;
  uiSettings: ThemeUISettings;
}

export const DEFAULT_THEME_ID = 'lavender-coal';

// The 24 tones a folder can wear, as a colour wheel in three rows of eight (the library's folder
// colour picker). Picker options only: a folder keeps whatever colour its file has. They are the
// folders' own data, like a tag colour, not theme tokens — and this file is where literal colours
// live, so the lint gate's colour rule leaves them alone here.
export const FOLDER_COLORS = [
  '#f43f5e', '#ff6b6b', '#fb923c', '#f59e0b', '#d4a020', '#ffd93d', '#84cc16', '#9a9a3e',
  '#22c55e', '#6bcb77', '#4dd0a0', '#14b8a6', '#06b6d4', '#60cdff', '#42a5f5', '#3b82f6',
  '#5d5fd1', '#a78bfa', '#c084fc', '#e879f9', '#ef5da8', '#f472b6', '#b3814e', '#7a8599',
];
export const DEFAULT_FOLDER_COLOR = '#60cdff';
// The check on the chosen swatch: dark on a light tone, white on a dark one. Fixed, because the
// swatches are fixed — they do not follow the theme either.
export const SWATCH_CHECK_INK = { onLight: 'rgba(0, 0, 0, 0.72)', onDark: '#fff' };

// Where each preset retired by the 2026-08 curation lands: its closest surviving
// relative (same hue family / same vibe). Consumed by the v6 migration in
// loadThemeConfig so a stored id keeps resolving to something familiar instead of
// snapping to the default. Custom presets can't collide — their ids are
// 'custom-'-prefixed by makeCustomPresetId.
export const REMOVED_THEME_FALLBACKS: Record<string, string> = {
  'carbon': 'lavender-coal',
  'sakura': 'rose-pine',
  'copper': 'gruvbox-dark',
  'amber': 'gruvbox-dark',
  'green-beautiful-2': 'hatsune-miku',
  'green-dark': 'minimal-kiwi',
  'ocean': 'hatsune-miku',
  'ocean-deep': 'tokyo-night',
  'midnight': 'tokyo-night',
  'cursor-dark': 'lavender-coal',
  'github-dark': 'github-dark-default',
  'kanagawa': 'tokyo-night',
  'kanagawa-dragon': 'lavender-coal',
  'catppuccin-frappe': 'catppuccin-mocha',
  'catppuccin-macchiato': 'catppuccin-mocha',
  'violet-dusk': 'dracula',
  'genshin-vibes': 'wuthering-waves',
  'cyberpunk-neon': 'synthwave-84',
  'hotline-miami': 'synthwave-84',
};

// ── Palettes ──

// The 37 built-in palettes, by id. The boot mirror in index.html carries a copy of them to paint the
// saved theme before any bundle exists (tools/gen-boot-mirror.mjs) and leaves it on
// window.__trPalettes: the app resolves the theme from that copy instead of shipping a second one in
// its first chunk. The presets themselves (names and previews, for the pickers) are in
// themePresets.ts, which comes with the screen that lists them. The default palette is also kept
// here, for a page without the mirror; the generator fails the build if it drifts from the preset.
export const DEFAULT_PALETTE: ThemeColors = {
  'bg-base': '#1a1a1a',
  'bg-surface': '#1c1c1c',
  'bg-card': '#1f1f1f',
  'bg-elevated': '#232323',
  'bg-input': '#161616',
  'border-subtle': 'rgba(200,200,212,0.06)',
  'border-default': 'rgba(200,200,212,0.1)',
  'border-strong': 'rgba(200,200,212,0.15)',
  'text-primary': '#c8c8d4',
  'text-secondary': '#a0a8b4',
  'text-tertiary': '#6b7280',
  'text-disabled': '#4b5263',
  accent: '#61afef',
  'accent-solid': '#4392d3',
  'accent-hover': '#80c0f5',
};

const palettes: Readonly<Record<string, ThemeColors>> =
  (typeof window !== 'undefined' && (window as { __trPalettes?: Record<string, ThemeColors> }).__trPalettes)
  || { [DEFAULT_THEME_ID]: DEFAULT_PALETTE };

/** A built-in palette by id; undefined for any other id (a custom preset's, a retired one's). */
export function getPalette(id: string): ThemeColors | undefined {
  return Object.prototype.hasOwnProperty.call(palettes, id) ? palettes[id] : undefined;
}

export const isBuiltinTheme = (id: string): boolean => getPalette(id) !== undefined;

// ── Color Math Helpers ──

function hexToRGB(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRGB(hex);
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
  else if (max === gf) h = ((bf - rf) / d + 2) / 6;
  else h = ((rf - gf) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  const sf = s / 100, lf = l / 100;
  const c = (1 - Math.abs(2 * lf - 1)) * sf;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lf - c / 2;
  let rf = 0, gf = 0, bf = 0;
  if (h < 60) { rf = c; gf = x; }
  else if (h < 120) { rf = x; gf = c; }
  else if (h < 180) { gf = c; bf = x; }
  else if (h < 240) { gf = x; bf = c; }
  else if (h < 300) { rf = x; bf = c; }
  else { rf = c; bf = x; }
  return rgbToHex((rf + m) * 255, (gf + m) * 255, (bf + m) * 255);
}

type Rgba = { r: number; g: number; b: number; a: number };

const PARSED_COLORS = new Map<string, Rgba | null>();
let colorProbe: CanvasRenderingContext2D | null | undefined;

/**
 * Every colour string the app admits, read as sRGB channels (0–255) plus alpha (0–1). `null` when
 * it cannot be read.
 *
 * isSafeCssColor admits whatever the engine calls a colour — hex in four lengths, rgb()/hsl() in
 * both syntaxes, named colours, color-mix(), oklch() — while the readers below knew three hex
 * lengths and comma-separated rgb(). Everything in between was read as BLACK: the contrast chip
 * measured a colour nothing paints, a hue ink was solved from black, an imported #RRGGBBAA lost its
 * alpha the first time the picker touched it. They all read through this now.
 *
 * Hex and the functional notations are read by hand — they are what presets, the editor and export
 * write, and Node (tools/gen-boot-mirror.mjs imports this module) has no canvas. Anything else is
 * painted into a 1×1 canvas and read back, which is the engine's own answer; without a document it
 * is unreadable. Cached, because applyThemeConfig reads the same few dozen strings on every change.
 */
function parseCssColor(c: unknown): Rgba | null {
  if (typeof c !== 'string') return null;
  const s = c.trim();
  if (!s) return null;
  const hit = PARSED_COLORS.get(s);
  if (hit !== undefined) return hit;
  const parsed = readColor(s);
  if (PARSED_COLORS.size >= 512) PARSED_COLORS.clear();
  PARSED_COLORS.set(s, parsed);
  return parsed;
}

function readColor(s: string): Rgba | null {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (hex) {
    const h = hex[1].length <= 4 ? hex[1].split('').map(ch => ch + ch).join('') : hex[1];
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      // CSS puts the alpha LAST (#RRGGBBAA) — not first, as XAML's #AARRGGBB does.
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/i.exec(s);
  // A notation the hand reader does not follow (`none`, a unit it does not know) still goes to
  // the engine rather than being called unreadable.
  return (fn && readFunctional(fn[1].toLowerCase(), fn[2].trim())) ?? probeColor(s);
}

/** rgb()/rgba()/hsl()/hsla() bodies, in the legacy comma syntax ("1, 2, 3, .5") and the modern
 *  space one ("1 2 3 / 50%"); rgb/rgba and hsl/hsla are aliases in both. */
function readFunctional(name: string, body: string): Rgba | null {
  let parts: string[];
  let alphaTok: string | undefined;
  if (body.includes(',')) {
    parts = body.split(',').map(t => t.trim());
    if (parts.length === 4) alphaTok = parts.pop();
  } else {
    const halves = body.split('/').map(t => t.trim());
    if (halves.length > 2) return null;
    parts = halves[0].split(/\s+/);
    alphaTok = halves[1];
  }
  if (parts.length !== 3) return null;
  const num = (t: string | undefined, pctScale: number): number => {
    if (t === undefined) return NaN;
    const pct = t.endsWith('%');
    const v = Number(pct ? t.slice(0, -1) : t);
    return pct ? v * pctScale : v;
  };
  const a = alphaTok === undefined ? 1 : num(alphaTok, 0.01);
  if (!Number.isFinite(a)) return null;
  const alpha = Math.max(0, Math.min(1, a));
  if (name.startsWith('rgb')) {
    const [r, g, b] = parts.map(t => num(t, 2.55));
    if (![r, g, b].every(Number.isFinite)) return null;
    const cl = (v: number) => Math.max(0, Math.min(255, v));
    return { r: cl(r), g: cl(g), b: cl(b), a: alpha };
  }
  const hue = /^(-?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/i.exec(parts[0]);
  const sat = num(parts[1], 1), light = num(parts[2], 1);
  if (!hue || !Number.isFinite(sat) || !Number.isFinite(light)) return null;
  const unit = (hue[2] ?? 'deg').toLowerCase();
  const deg = Number(hue[1]) * (unit === 'turn' ? 360 : unit === 'rad' ? 180 / Math.PI : unit === 'grad' ? 0.9 : 1);
  const clp = (v: number) => Math.max(0, Math.min(100, v));
  const { r, g, b } = hexToRGB(hslToHex(((deg % 360) + 360) % 360, clp(sat), clp(light)));
  return { r, g, b, a: alpha };
}

/** The engine's reading of a colour it accepts, via a 1×1 canvas. An invalid value leaves
 *  fillStyle untouched, so it is assigned over two different sentinels: a value the engine took
 *  serialises the same both times, a refused one reads back as each sentinel in turn. */
function probeColor(s: string): Rgba | null {
  if (typeof document === 'undefined') return null;
  if (colorProbe === undefined) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      colorProbe = canvas.getContext('2d', { willReadFrequently: true });
    } catch {
      colorProbe = null;
    }
  }
  const ctx = colorProbe;
  if (!ctx) return null;
  ctx.fillStyle = '#000000';
  ctx.fillStyle = s;
  const first = ctx.fillStyle;
  ctx.fillStyle = '#ffffff';
  ctx.fillStyle = s;
  if (ctx.fillStyle !== first) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
}

/** #rrggbb of any colour parseCssColor reads, alpha dropped (an <input type="color"> has none).
 *  '#000000' when it cannot be read — a caller that must tell black from unreadable asks
 *  isParsableColor first. */
export function toHex(color: string): string {
  const c = parseCssColor(color);
  return c ? rgbToHex(c.r, c.g, c.b) : '#000000';
}

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

// ── WCAG contrast ──

// Relative luminance per WCAG 2.1 — gamma-correct then weighted sum.
function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRGB(hex);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG 2.1 contrast ratio between two colors (hex). Returns 1.0–21.0.
 * AA body-text wants ≥ 4.5; AA large/graphics wants ≥ 3; AAA wants ≥ 7.
 */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(toHex(fgHex));
  const l2 = relativeLuminance(toHex(bgHex));
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Text/icon ink for a solid button fill: white or near-black, whichever contrasts
 * more against the fill. Semantic fills (recording red, replay green, clicker
 * purple, accent blue) are user-configurable, so the ink can't be hardcoded —
 * white 13px text on the default replay green computes ≈ 2:1 and is exactly the
 * kind of pairing this exists to prevent.
 */
export function pickInk(fillHex: string): string {
  return contrastRatio('#ffffff', fillHex) >= contrastRatio('#1c1c1c', fillHex)
    ? '#ffffff'
    : '#1c1c1c';
}

/** True for the colour strings parseCssColor can read. Anything else toHex maps to #000000, which
 *  would make a contrast derivation solve against black on a white surface. */
function isParsableColor(c: unknown): c is string {
  return parseCssColor(c) !== null;
}

/** Alpha of a colour string, 1 when it carries none or cannot be read. */
function colorAlpha(c: unknown): number {
  return parseCssColor(c)?.a ?? 1;
}

/**
 * The opaque colour that results from painting `color` on top of opaque `bg`.
 *
 * contrastRatio goes through toHex, which DROPS alpha — so a translucent token measured raw
 * reports the contrast of a colour nothing ever paints. Every preset stores its three borders as
 * rgba at 6–25 % alpha, which is how a hairline that paints at 1.17:1 could read as 8.45:1.
 */
/**
 * Is this background light? `null` when the colour cannot be read.
 *
 * The single answer to a question three places used to answer three ways. applyThemeConfig picks
 * `color-scheme` from it, and the Theme Editor's Light/Dark filter used its own hand-rolled
 * perceived-brightness formula fed by a raw string slice — which returned NaN for `rgba()` and
 * therefore classified every alpha background as dark. parseCssColor reads `hsl()`, named colours
 * and `color-mix()` too; what it cannot read (Node, garbage) is unknown, not "dark".
 */
export function isLightColor(color: unknown): boolean | null {
  if (!isParsableColor(color)) return null;
  return relativeLuminance(toHex(color)) >= 0.5;
}

export function flattenOver(color: string, bg: string): string {
  const a = colorAlpha(color);
  if (a >= 1) return toHex(color);
  const f = hexToRGB(toHex(color)), b = hexToRGB(toHex(bg));
  return rgbToHex(f.r * a + b.r * (1 - a), f.g * a + b.g * (1 - a), f.b * a + b.b * (1 - a));
}

/**
 * The colours the native (WinUI) side is themed from — its dialogs and the window's own canvas — each
 * as OPAQUE #rrggbb — what the card
 * actually looks like on screen: bg-card over bg-surface over bg-base, and the inks over that card.
 *
 * The C# side reads nothing but hex, and it used to receive the tokens raw: an imported theme's
 * rgb()/hsl()/named background failed to parse while its hex text did not, so the dialog kept the
 * WinUI default background under the theme's text — dark on dark; and an #RRGGBBAA was read in
 * XAML's alpha-first order, a near-transparent wrong colour. '' for a token that cannot be read;
 * the C# side then themes nothing rather than half a dialog.
 */
export function nativeDialogColors(c: ThemeColors): Record<'bgBase' | 'bgSurface' | 'bgCard' | 'textPrimary' | 'textSecondary' | 'accentSolid' | 'borderSubtle', string> {
  const opaque = (color: string | undefined, under: string) => (isParsableColor(color) ? flattenOver(color, under) : '');
  const baseRead = opaque(c['bg-base'], '#000000');
  const base = baseRead || '#000000';
  const surface = opaque(c['bg-surface'], base);
  const card = opaque(c['bg-card'], surface || base);
  const under = card || surface || base;
  return {
    // The window's own canvas: the native layer under the WebView2 paints it before any page
    // exists (MainWindow.ApplyWindowBackground), and the C# side saves it for the next launch.
    bgBase: baseRead,
    bgSurface: surface,
    bgCard: card,
    textPrimary: opaque(c['text-primary'], under),
    textSecondary: opaque(c['text-secondary'], under),
    accentSolid: opaque(c['accent-solid'], under),
    borderSubtle: opaque(c['border-subtle'], under),
  };
}

/**
 * The single maxTint every hue ink is SOLVED against, and the alpha each `-bg` wash is EMITTED at.
 *
 * These are two different numbers and conflating them was a real bug: the solve brackets its
 * candidates against the heaviest wash any rule paints (0.12), while recording and replay emit
 * their own wash at 0.10. applyThemeConfig and measurePaintedContrast now read the same two
 * constants, so the renderer and the checker cannot drift the way they just did.
 */
const HUE_SOLVE_TINT = 0.12;
const HUE_WASH_ALPHA: Record<string, number> = {
  recordingColor: 0.10, replayColor: 0.10, clickerColor: 0.12,
  actionMouseColor: 0.12, actionKeyColor: 0.12, actionScrollColor: 0.12,
  actionSendTextColor: 0.12, actionSetVariableColor: 0.12, actionWaitImageColor: 0.12,
  actionPixelColorColor: 0.12, actionBrowserColor: 0.12, actionRunProfileColor: 0.12,
  actionPauseColor: 0.12, actionIfColor: 0.12, actionLoopColor: 0.12,
  actionFlowColor: 0.12, actionActivateWindowColor: 0.12,
};

/**
 * Ink for warning TEXT, icons and hairlines, derived per theme.
 *
 * Three things make this different from adaptHueForInk, and each one was a measured bug first:
 *
 * 1. It solves against EVERY surface the token is painted on, not one. Contrast against the raw
 *    hue is V-shaped in luminance (minimum near L≈0.59), not monotone, so "the darkest surface"
 *    and "the surface with least contrast against the text" both pick the wrong one on some
 *    presets — solarized-light's hardest surface is bg-card, not bg-elevated.
 * 2. It includes the TINTED composites. Every consumer sits on a surface plus a translucent amber
 *    wash (8% for .warning-band, 6% for the incompatible card), and that wash drags the backdrop
 *    toward the hue's own luminance, which always costs contrast. Solving against the bare surface
 *    landed three light presets and nord below the target they were solved for. 0% and 8% bracket
 *    the 6% case, so checking those two per surface covers all of them.
 * 3. When nothing clears it returns the BEST candidate rather than text-primary. adaptHueForInk's
 *    last-resort assumption ("clears by construction") is false for solarized-light, whose own
 *    text is 3.65:1 on its own bg-elevated — a pre-existing palette defect this cannot repair.
 *    On the shipped presets this is a no-op worth having rather than an improvement: measured,
 *    solarized-light is the only preset that reaches the branch, and there the argmax candidate
 *    IS text-primary, so the returned value is identical either way. It earns its keep only for
 *    an authored theme whose text happens not to be the best available ink.
 *
 * Target is 4.5 because every consumer is 10–12px body text. That is deliberately NOT
 * adaptHueForInk's default of 3, and must not be pushed back into it: 4.5 guts the hue, which is
 * the documented reason 3 was chosen for recording/replay/clicker.
 */
export function deriveHueInk(
  hueHex: string,
  textPrimary: string,
  surfaces: unknown[],
  target = 4.5,
  maxTint = 0.08,
  staticFallbackMix = 40,
): string {
  const usable = surfaces.filter(isParsableColor).map(toHex);
  // No surface we can reason about: keep the static index.css recipe rather than inventing one.
  // The hue is checked as well: an unreadable one went on to toHex, which reads it as black, and
  // the ink was solved from black instead of the user's colour.
  if (usable.length === 0 || !isParsableColor(textPrimary) || !isParsableColor(hueHex)) {
    // The hue passes through as authored rather than being swapped for amber when it is not a
    // hex we can parse: color-mix() accepts named colours and hsl() perfectly well, and painting
    // a recording indicator amber because its colour was spelled "red" would be a worse answer
    // than either the real hue or a dropped declaration. A genuinely malformed value makes the
    // whole declaration invalid, which is the loud failure and the one we want here.
    const fallbackHue = typeof hueHex === 'string' && hueHex.trim() ? hueHex : '#FFC107';
    return `color-mix(in srgb, ${fallbackHue} ${staticFallbackMix}%, ${isParsableColor(textPrimary) ? textPrimary : 'currentColor'})`;
  }
  const hue = hexToRGB(toHex(hueHex));
  const text = hexToRGB(toHex(textPrimary));
  const backdrops: string[] = [];
  for (const s of usable) {
    backdrops.push(s);
    const b = hexToRGB(s);
    backdrops.push(rgbToHex(       // the heaviest shipped wash of this hue, composited
      hue.r * maxTint + b.r * (1 - maxTint),
      hue.g * maxTint + b.g * (1 - maxTint),
      hue.b * maxTint + b.b * (1 - maxTint),
    ));
  }
  let best = toHex(textPrimary);
  let bestWorst = -1;
  for (let keep = 100; keep >= 0; keep -= 5) {
    const p = keep / 100;
    const candidate = rgbToHex(
      hue.r * p + text.r * (1 - p),
      hue.g * p + text.g * (1 - p),
      hue.b * p + text.b * (1 - p),
    );
    let worst = Infinity;
    for (const bg of backdrops) worst = Math.min(worst, contrastRatio(candidate, bg));
    if (worst >= target) return candidate;          // first step that clears everywhere
    if (worst > bestWorst) { bestWorst = worst; best = candidate; }
  }
  return best;
}

/** Warning amber at the constants it was solved and measured against: 8% is the heaviest wash
 *  `.warning-band` paints, and 40% is the static recipe index.css falls back to before hydration. */
export function deriveWarningInk(textPrimary: string, surfaces: unknown[], target = 4.5): string {
  return deriveHueInk('#FFC107', textPrimary, surfaces, target, 0.08, 40);
}

// ── Accent Derivation ──

export function deriveAccentVariants(accentHex: string): Pick<ThemeColors, 'accent' | 'accent-solid' | 'accent-hover'> {
  const { h, s, l } = hexToHSL(accentHex);
  return {
    accent: accentHex,
    'accent-solid': hslToHex(h, Math.min(s + 10, 100), Math.max(l - 20, 10)),
    'accent-hover': hslToHex(h, Math.max(s - 5, 0), Math.min(l + 15, 90)),
  };
}

// ── Theme Config Persistence ──

const STORAGE_KEY = 'truereplay-theme';
const CUSTOM_PRESETS_KEY = 'truereplay-custom-presets';

/**
 * User-saved presets — separate from the built-in presets array so they can be
 * added/removed without affecting the curated list. Stored as JSON in localStorage
 * under CUSTOM_PRESETS_KEY. Each entry uses the same shape as ThemePreset but with
 * a `__custom: true` marker for UI distinction.
 */
export interface CustomThemePreset extends ThemePreset {
  __custom: true;
}

export function loadCustomPresets(): CustomThemePreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // A stored preset is UNTRUSTED in exactly the way an imported file is, and it feeds the same
    // two sinks: root.style.cssText, and the editor's swatch grid. The old shape check (`id` is a
    // string and `colors` is truthy) let both of those crash on a partial record — a missing key
    // makes toHex(undefined) throw on .startsWith, and a missing `preview` throws on .map, which
    // in the editor takes the whole app down to the error boundary rather than one dialog.
    // So: every colour key must be present AND safe, and the preview is rebuilt when unusable.
    // REPAIR, never reject. The first version of this guard returned false for the whole record
    // when any one of the fifteen keys was bad — and ThemeProvider persists this filtered list on
    // mount, so a preset with a single broken colour was silently erased from disk on the next
    // launch, with no warning and no undo. That is the opposite of the policy sanitizeStoredConfig
    // documents ("a single bad override should cost that one colour, not the user's whole theme"),
    // and it destroys authored work rather than protecting it. A record is dropped only when there
    // is nothing left to repair: no id, or no colors object at all.
    const fallback = getPalette(DEFAULT_THEME_ID) ?? DEFAULT_PALETTE;
    return arr.filter((p: unknown): p is CustomThemePreset => {
      if (!p || typeof p !== 'object') return false;
      const c = p as Record<string, unknown>;
      if (typeof c.id !== 'string' || !c.id || !c.colors || typeof c.colors !== 'object') return false;
      const colors = c.colors as Record<string, unknown>;
      for (const key of THEME_COLOR_KEYS) if (!isSafeCssColor(colors[key])) colors[key] = fallback[key];
      if (typeof c.name !== 'string' || !c.name) c.name = c.id;
      // Without the marker the gallery's `'__custom' in theme` test fails and the card loses its
      // delete button, so the user cannot remove the preset through the UI at all.
      c.__custom = true;
      if (!Array.isArray(c.preview) || c.preview.length !== 4 || !c.preview.every(isSafeCssColor)) {
        // Same four slots saveAsPreset writes, so a repaired card matches a re-saved one.
        c.preview = [colors['bg-base'], colors['bg-surface'], colors['bg-card'], colors.accent];
      }
      return true;
    });
  } catch {
    return [];
  }
}

export function saveCustomPresets(presets: CustomThemePreset[]): void {
  // localStorage.setItem can throw QuotaExceededError when the storage quota is full
  // (rare in WebView2 with no other origins competing, but technically possible if
  // the user accumulates hundreds of custom presets with embedded preview data).
  // Swallow + log instead of crashing the theme provider — the user just won't see
  // the preset persist; current session still works in memory.
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  } catch (err) {
    console.warn('[themes] Failed to save custom presets:', err);
  }
}

/** Generate a stable id from a user-supplied preset name. */
export function makeCustomPresetId(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `custom-${slug || Date.now()}`;
}

export function loadThemeConfig(): ThemeConfig {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return makeDefaultConfig();

  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version >= 1 && parsed.baseThemeId) {
      // Merge UI settings with defaults for backwards compatibility (new fields)
      const merged: ThemeConfig = {
        ...parsed,
        version: CURRENT_THEME_CONFIG_VERSION,
        uiSettings: { ...DEFAULT_UI_SETTINGS, ...parsed.uiSettings },
      };

      // v1 → v2 migration: the palette pass swapped three action colours
      // (PixelColor cyan → lime, Scroll deep mint → light mint, Pause amber →
      // slate) to resolve hue clashes with Key and SendText. Only swap the
      // user's stored value when it still matches the OLD default — that way
      // anyone who deliberately picked one of those hex values keeps their
      // choice intact. Fresh installs already get the new defaults via
      // DEFAULT_UI_SETTINGS; this branch covers existing localStorage data.
      if (parsed.version < 2) {
        const ui = merged.uiSettings;
        if (ui.actionPixelColorColor === '#22d3ee') ui.actionPixelColorColor = DEFAULT_UI_SETTINGS.actionPixelColorColor;
        if (ui.actionScrollColor === '#6bcb77') ui.actionScrollColor = DEFAULT_UI_SETTINGS.actionScrollColor;
        if (ui.actionPauseColor === '#fbbf24') ui.actionPauseColor = DEFAULT_UI_SETTINGS.actionPauseColor;
      }

      // v2 → v3 migration: If/Else/EndIf moved from amber (#fbbf24) to teal
      // (#2dd4bf) so it no longer shares the 43° hue with SendText gold. Same
      // "only swap if it still matches the old default" pattern as above.
      if (parsed.version < 3) {
        const ui = merged.uiSettings;
        if (ui.actionIfColor === '#fbbf24') ui.actionIfColor = DEFAULT_UI_SETTINGS.actionIfColor;
      }

      // v3 → v4 migration: PixelColor lime darkened (#84cc16 → #65a30d) for
      // deuteranopia lightness separation from Replay green — see the
      // DEFAULT_UI_SETTINGS comment. Same only-if-still-default pattern.
      if (parsed.version < 4) {
        const ui = merged.uiSettings;
        if (ui.actionPixelColorColor === '#84cc16') ui.actionPixelColorColor = DEFAULT_UI_SETTINGS.actionPixelColorColor;
      }

      // v4 → v5 migration: default zoom 95 % → 90 %. Unlike the colour migrations above this
      // one is NOT optional cosmetics — a saved config always carries a zoom, so the spread
      // over DEFAULT_UI_SETTINGS keeps the old 95 forever and the new default would only ever
      // reach fresh installs. Same only-if-still-the-old-default rule, for the same reason:
      // anyone who deliberately picked 120 % or 80 % keeps it.
      if (parsed.version < 5) {
        const ui = merged.uiSettings;
        if (ui.zoom === 95) ui.zoom = DEFAULT_UI_SETTINGS.zoom;
      }

      // v5 → v6 migration: the 2026-08 curation retired 19 dark presets. A stored
      // id pointing at one of them is remapped to its closest surviving relative
      // (REMOVED_THEME_FALLBACKS) so the user's aesthetic carries over instead of
      // falling through to the default. Unlike the colour migrations above this one
      // is unconditional — a removed id has nothing to stay faithful to. Covers
      // the active theme and both matchSystemTheme slots.
      if (parsed.version < 6) {
        const ui = merged.uiSettings;
        merged.baseThemeId = REMOVED_THEME_FALLBACKS[merged.baseThemeId] ?? merged.baseThemeId;
        ui.darkPresetId = REMOVED_THEME_FALLBACKS[ui.darkPresetId] ?? ui.darkPresetId;
        ui.lightPresetId = REMOVED_THEME_FALLBACKS[ui.lightPresetId] ?? ui.lightPresetId;
      }

      // v6 → v7 migration: the default monospace face moved from Consolas to Cascadia Mono
      // (Windows 11). Only-if-still-the-old-default, like the colour migrations: someone who
      // picked Consolas on purpose in the Theme Editor cannot be told apart from someone who
      // never touched it, so the migration errs on the side of the new default — the value
      // stays one click away in the same picker.
      if (parsed.version < 7) {
        const ui = merged.uiSettings;
        if (ui.fontMono === 'Consolas') ui.fontMono = DEFAULT_UI_SETTINGS.fontMono;
      }

      // The OS follower is resolved HERE, before the first paint, not by the effect that runs
      // after it. With "Match Windows theme" on and the OS theme changed while the app was
      // closed, the window came up on the preset from the previous session and the effect
      // repainted it one frame later — the flash the boot mirror exists to prevent, arriving
      // through the one path the mirror could not see. Mirrored in tools/gen-boot-mirror.mjs, so
      // the pre-React paint agrees.
      // colorOverrides is cleared for the same reason the effect clears it (ThemeContext, sync):
      // they belong to the preset being left. Resolving without clearing would make the effect a
      // no-op by the baseThemeId equality check, and the overrides would start SURVIVING the
      // boot — a behaviour change nobody asked for.
      if (merged.uiSettings.matchSystemTheme && typeof window !== 'undefined'
          && typeof window.matchMedia === 'function') {
        const wantId = window.matchMedia('(prefers-color-scheme: light)').matches
          ? merged.uiSettings.lightPresetId
          : merged.uiSettings.darkPresetId;
        if (wantId && isBuiltinTheme(wantId) && merged.baseThemeId !== wantId) {
          merged.baseThemeId = wantId;
          merged.colorOverrides = {};
        }
      }

      // Animations: the stored object, NOT the merge — DEFAULT_UI_SETTINGS already filled in
      // 'system', which would hide an old `enableAnimations: false` from the migration.
      merged.uiSettings.animationMode = animationModeFrom(parsed.uiSettings);
      delete merged.uiSettings.enableAnimations;

      // Runs AFTER the migrations so a value a migration just wrote is checked too.
      const dropped = sanitizeStoredConfig(merged);
      if (dropped) console.warn(`[themes] Dropped ${dropped} unsafe colour value(s) from stored config`);
      return merged;
    }
  } catch {
    // Not JSON — old format (plain theme ID string). Run it through the removed-id
    // map too so an ancient install lands on a surviving relative.
    const legacyId = REMOVED_THEME_FALLBACKS[raw] ?? raw;
    if (isBuiltinTheme(legacyId)) {
      return { version: CURRENT_THEME_CONFIG_VERSION, baseThemeId: legacyId, colorOverrides: {}, uiSettings: { ...DEFAULT_UI_SETTINGS } };
    }
  }

  return makeDefaultConfig();
}

export function saveThemeConfig(config: ThemeConfig): void {
  // Same QuotaExceededError guard as saveCustomPresets. Theme config is tiny (~1KB)
  // so realistically the quota only fills up when something ELSE is misbehaving;
  // logging + swallowing keeps the rest of the app responsive.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('[themes] Failed to save theme config:', err);
  }
}

export function makeDefaultConfig(): ThemeConfig {
  return {
    version: CURRENT_THEME_CONFIG_VERSION,
    baseThemeId: DEFAULT_THEME_ID,
    colorOverrides: {},
    // animationMode 'system' (the default) already follows the OS reduced-motion flag live, so a
    // first run no longer needs to seed anything from it.
    uiSettings: { ...DEFAULT_UI_SETTINGS },
  };
}

// ── Theme Resolution ──

export function resolveThemeColors(config: ThemeConfig, customPresets: ThemePreset[] = []): ThemeColors {
  // Custom presets take precedence over built-in ids — the user might intentionally
  // override a built-in name. In practice ids should never collide thanks to the
  // 'custom-' prefix from makeCustomPresetId, but the lookup order keeps user wins.
  // An id that resolves to nothing (corrupt storage, deleted custom preset) lands on
  // the DEFAULT theme, not the first preset — the list is hue-sorted, so its first
  // slot is an arbitrary palette, not a neutral one.
  const base = customPresets.find(t => t.id === config.baseThemeId)?.colors
    ?? getPalette(config.baseThemeId)
    ?? getPalette(DEFAULT_THEME_ID)
    ?? DEFAULT_PALETTE;
  return { ...base, ...config.colorOverrides };
}

/** The declaration the last applyThemeConfig wrote to <html> — see the write guard there. */
let lastAppliedCss = '';

/** `animations` is the EFFECTIVE flag (effectiveAnimations: the mode plus the OS), not the mode. */
export function applyThemeConfig(colors: ThemeColors, uiSettings: ThemeUISettings, animations: boolean) {
  const root = document.documentElement;

  // Build the entire variable set as one cssText string, then assign once.
  // Each `setProperty` call invalidates the style cache and can schedule a
  // separate style recalc — with ~40 vars per theme apply, the cumulative
  // cost is visible on theme-editor sliders (one keystroke = full recompute
  // through 40 sets). One cssText assign is a single mutation that the
  // browser batches into a single recalc. Trade-off: we lose the inline-vs-
  // stylesheet distinction, but every var here was already an inline anyway,
  // so net behaviour is identical — just faster.
  const parts: string[] = [];
  for (const [key, value] of Object.entries(colors)) {
    parts.push(`--color-${key}: ${value};`);
  }
  // Conditional-block rail palette: the :root defaults are solved for dark surfaces; a light
  // surface points the four levels at the -light set (index.css). Grouped by bg-surface HSL
  // lightness >= 55 — the same rule the 37-theme contrast measurement used (B6, 2026-09-05) —
  // so a custom theme lands in the right set too. Dark: nothing to write, the defaults hold.
  //
  // Through toHex, because hexToRGB parses the string as hex digits and returns NaN for anything
  // else: a custom theme whose bg-surface is `rgb(250,250,250)` or `#fff` made `NaN >= 55` false
  // and took the DARK rails onto a white surface — the ~2:1 contrast B6 measured and fixed. What
  // toHex cannot read (hsl(), a named colour, color-mix()) still lands in the dark set, which is
  // the honest default without a real colour parser, but now by decision rather than by NaN.
  //
  // Deliberately NOT isLightColor: HSL lightness and relative luminance are different
  // classifiers (#00ff00 is 50 by the first, 0.715 by the second), and the 37-theme measurement
  // grouped by the first — swapping would re-open it.
  const surface = colors['bg-surface'];
  if (isParsableColor(surface) && hexToHSL(toHex(surface)).l >= 55) {
    for (let n = 1; n <= 4; n++) parts.push(`--color-block-${n}: var(--color-block-${n}-light);`);
  }
  // Layout
  // In rem (the settings are px at 100 %), so they follow the scale like everything else.
  parts.push(`--ui-font-size: ${uiSettings.fontSize / 16}rem;`);
  parts.push(`--ui-border-radius: ${uiSettings.borderRadius / 16}rem;`);
  parts.push(`--ui-row-height: ${uiSettings.rowHeight / 16}rem;`);
  // Semantic colors + auto-derived backgrounds
  parts.push(`--color-recording: ${uiSettings.recordingColor};`);
  parts.push(`--color-recording-bg: color-mix(in srgb, ${uiSettings.recordingColor} 10%, transparent);`);
  parts.push(`--color-replay: ${uiSettings.replayColor};`);
  parts.push(`--color-replay-bg: color-mix(in srgb, ${uiSettings.replayColor} 10%, transparent);`);
  parts.push(`--color-clicker: ${uiSettings.clickerColor};`);
  parts.push(`--color-clicker-bg: color-mix(in srgb, ${uiSettings.clickerColor} 12%, transparent);`);
  // INK variants of the three semantic hues, adapted per theme. The raw tokens above stay the
  // user's literal choice and go on FILLS; anything painting the hue as text, an icon or a
  // hairline uses these instead, or it disappears on the 14 light presets.
  //
  // Target stays 3 — these are glyphs and boundaries, and 4.5 was measured to gut the hue
  // (light retention 42% average, 10% minimum) for no gain on shapes.
  //
  // But the SURFACE set is no longer just bg-surface, and that was a real bug: these tokens are
  // painted on bg-base (StatusBar), bg-surface (ActionBar), bg-card (grid rows) and bg-elevated
  // (dialogs, toasts), plus the 10–12% hue washes under them. Solved against bg-surface alone,
  // the token was BELOW ITS OWN 3:1 floor on 16/37 presets for recording (worst 1.90,
  // solarized-light), 14/37 for replay and 16/37 for clicker — including two dark presets
  // (nord 2.41, catppuccin-mocha 2.90). A user-picked hue close to their background made it
  // worse: 16 of 30 hostile cases failed. Solving across all four surfaces and their 12%
  // composites clears 37/37 and 30/30. maxTint 0.12 is the heaviest wash shipped
  // (--color-clicker-bg above) — if a rule ever paints these over a heavier one, raise it here
  // or the solve goes silently stale.
  //
  // Cost, and it is visible: light-preset hue retention drops ~26pp (recording 76.8→51.1,
  // replay 58.9→40.4, clicker 72.1→48.6). Dark is essentially untouched (100→98.3/100/98.7).
  const SURFACES = [colors['bg-surface'], colors['bg-card'], colors['bg-elevated'], colors['bg-base']];
  const ink = colors['text-primary'];
  parts.push(`--color-recording-fg: ${deriveHueInk(uiSettings.recordingColor, ink, SURFACES, 3, HUE_SOLVE_TINT, 72)};`);
  parts.push(`--color-replay-fg: ${deriveHueInk(uiSettings.replayColor, ink, SURFACES, 3, HUE_SOLVE_TINT, 72)};`);
  const clickerFg = deriveHueInk(uiSettings.clickerColor, ink, SURFACES, 3, HUE_SOLVE_TINT, 72);
  parts.push(`--color-clicker-fg: ${clickerFg};`);
  // The Clicker pill's border is a hairline on the bar, so it rides the adapted
  // hue too — at 30% of the raw purple it was 1.2:1 against a light bar.
  parts.push(`--color-clicker-border: color-mix(in srgb, ${clickerFg} 30%, transparent);`);
  // Warning ink — same idea as the three hues above, but solved across ALL the surfaces it can
  // land on and against their tinted composites; see deriveWarningInk for why one surface is not
  // enough. Missing or unparsable palette keys are filtered there, so a custom preset without a
  // bg-card can no longer take the whole theme apply down with it.
  //
  // The static color-mix in index.css is now only the pre-hydration fallback. Measured on the
  // real elements: that fixed 40% recipe gave 13 of the 14 light presets under 4.5:1
  // (solarized-light 1.98) and solarized-dark 4.43.
  //
  // Dark presets are NOT untouched, and it would be wrong to say so: the old 40% mix was a pale
  // amber with lots of headroom, and returning the raw hue trades some of that away (worst
  // measured after this change: nord). All stay above the floor, but the direction is a real
  // cost, not a null result.
  parts.push(`--color-warning-ink: ${deriveWarningInk(ink, [
    colors['bg-surface'], colors['bg-card'], colors['bg-elevated'],
  ])};`);
  // Ink for solid semantic fills (Recording/Replay/Clicker buttons + accent "Stop"
  // state) — contrast-picked per fill so no user color choice can produce the old
  // white-on-mid-green ≈ 2:1 pairing.
  parts.push(`--color-recording-ink: ${pickInk(uiSettings.recordingColor)};`);
  parts.push(`--color-replay-ink: ${pickInk(uiSettings.replayColor)};`);
  parts.push(`--color-clicker-ink: ${pickInk(uiSettings.clickerColor)};`);
  const accentInk = pickInk(colors['accent-solid']);
  parts.push(`--color-accent-ink: ${accentInk};`);
  // Hover fill for solid accent buttons — shifts AWAY from the ink (dark ink →
  // lighter fill, white ink → darker fill) so hovering never erodes the
  // contrast pickInk just guaranteed. Replaces alpha-hover (/80), whose blend
  // with the backdrop could swing either way.
  parts.push(`--color-accent-solid-hover: color-mix(in srgb, ${colors['accent-solid']} 85%, ${accentInk === '#ffffff' ? '#000000' : '#ffffff'});`);
  // Action type pill colors — the stored hue is treated as the action's identity,
  // not its literal ink: fg mixes the hue toward text-primary (dark themes ≈ the
  // original pastel; light themes automatically darken toward the near-black
  // text-primary instead of washing out), bg tints the hue over bg-surface so the
  // chip stays visible on any preset. Same recipe as the index.css fallbacks.
  const actionHues: [string, string][] = [
    ['mouse', uiSettings.actionMouseColor],
    ['key', uiSettings.actionKeyColor],
    ['scroll', uiSettings.actionScrollColor],
    ['sendtext', uiSettings.actionSendTextColor],
    ['setvariable', uiSettings.actionSetVariableColor ?? DEFAULT_UI_SETTINGS.actionSetVariableColor],
    ['waitimage', uiSettings.actionWaitImageColor],
    ['pixelcolor', uiSettings.actionPixelColorColor],
    ['browser', uiSettings.actionBrowserColor],
    ['runprofile', uiSettings.actionRunProfileColor],
    ['pause', uiSettings.actionPauseColor],
    ['if', uiSettings.actionIfColor],
    // Same `??` guard as setvariable above: applyThemeConfig is also called with uiSettings that
    // did not come through loadThemeConfig's spread (the editor's live preview), so a config
    // written before these three existed must not emit `undefined` into the declaration.
    ['loop', uiSettings.actionLoopColor ?? DEFAULT_UI_SETTINGS.actionLoopColor],
    ['flow', uiSettings.actionFlowColor ?? DEFAULT_UI_SETTINGS.actionFlowColor],
    ['activatewindow', uiSettings.actionActivateWindowColor ?? DEFAULT_UI_SETTINGS.actionActivateWindowColor],
  ];
  for (const [key, hue] of actionHues) {
    // The ink goes through the SAME per-theme solve as recording/replay/clicker above, and for
    // the same measured reason. The old recipe was a FIXED `color-mix(hue 72%, text-primary)`,
    // which is tuned for dark themes: 72 % of a bright pastel stays bright, so on a light
    // preset the pill's own label washes out against the row. Measured across all 37 presets,
    // 122 of the 407 pill/theme combinations sat below the 3:1 floor — and every one of the 14
    // affected themes was one of the 14 LIGHT presets, four of them with all 11 pills failing
    // (worst 1.50:1). Routing them through deriveHueInk takes that to 0 for 0.47 ms per apply.
    //
    // Target is 3, NOT 4.5, and that is the whole judgement call. The pill is a label with an
    // icon beside it, so it lives under the graphic floor like the three semantic hues, not the
    // body-text floor. 4.5 was measured too: it clears more contrast but drops light-theme chroma
    // to 51 % and collapses two hues onto the SAME colour in three light presets — the exact
    // failure that got the `-text` rung rejected in 2026-08-19. At 3 the chroma retained is 74 %.
    //
    // maxTint 0.12 matches the -bg wash emitted right below; if that percentage ever moves, this
    // has to move with it or the solve goes silently stale.
    parts.push(`--color-action-${key}-fg: ${deriveHueInk(hue, colors['text-primary'], SURFACES, 3, HUE_SOLVE_TINT, 72)};`);
    // bg stays TRANSLUCENT (mixed over transparent, not bg-surface): pills must
    // composite over row hover/selection/highlight/block washes and the drag
    // ghost — an opaque fill punches a hole through all of them. The light-theme
    // legibility win lives in the fg recipe above.
    parts.push(`--color-action-${key}-bg: color-mix(in srgb, ${hue} 12%, transparent);`);
  }
  // Tinted border for the conditional block scope rail — keeps the RAW hue (35%
  // alpha): rails are structural, not text, and want the pure identity color.
  parts.push(`--color-action-if-border: color-mix(in srgb, ${uiSettings.actionIfColor} 35%, transparent);`);
  // Font — the user's pick first, then the two faces every Windows has, so a name that is not
  // installed (a config carried over from another machine) degrades to Consolas, not to the
  // browser's serif default.
  parts.push(`--font-mono: '${uiSettings.fontMono}', Consolas, 'Courier New', monospace;`);
  // Elevation — one pair of shadows for the app, per theme. On the light presets a black
  // 45-60% shadow under a white card reads as a stain; a lighter blue-grey one reads as depth.
  // Same classification the ink solver uses (isLightColor is alpha-safe since a4c5b5c).
  const lightSurface = isLightColor(colors['bg-base']) === true;
  parts.push(lightSurface
    ? `--shadow-overlay: 0 6px 20px rgba(20, 30, 50, 0.14); --shadow-dialog: 0 16px 40px rgba(20, 30, 50, 0.2);`
    : `--shadow-overlay: 0 8px 24px rgba(0, 0, 0, 0.45); --shadow-dialog: 0 16px 48px rgba(0, 0, 0, 0.55);`);
  // The scale. The new shell scales by rem (rule 9 of the interface plan): the zoom setting becomes
  // the root font size, every size in the shell is in rem, and nothing is zoomed — so viewport units
  // mean the real window again, and --ui-zoom, which code written for the zoomed shell divides them
  // by, is 1. The boot mirror in index.html (tools/gen-boot-mirror.mjs) paints the same.
  parts.push(`--ui-zoom: 1;`);
  parts.push(`font-size: ${(16 * uiSettings.zoom) / 100}px;`);

  // Write only what changed. main.tsx puts the stored theme's declaration on <html> before the
  // first render, and ThemeProvider's mount effect arrives a moment later with the identical
  // config; rewriting the identical cssText would restyle the whole tree for nothing. `css`
  // carries the font size and --color-bg-base, so it also decides the scale and the color-scheme
  // that are written with it. Nothing else in the app writes documentElement.style (grep before
  // adding one), so an unchanged string means an unchanged inline style.
  const css = parts.join(' ');
  if (css !== lastAppliedCss) {
    lastAppliedCss = css;
    root.style.cssText = css;

    // Native controls (the <input type="time"> picker glyph, date pickers, scrollbars)
    // render their built-in icons per `color-scheme`. Without this the time-picker clock
    // icon stays a dark UA glyph — invisible on a dark theme (Automation → Schedule, the
    // If-Time condition). Derive it from the background luminance so the glyphs track
    // whatever preset is active: dark bg → light glyphs, light bg → dark glyphs. Set after
    // the cssText batch, which replaces the whole inline style.
    // isLightColor, not relativeLuminance on the raw string: that one also reads the value as hex
    // digits, so an `rgba(18,18,18,1)` background produced NaN, `NaN < 0.5` is false, and a DARK
    // theme was told to render light native glyphs — dark-on-dark. The `=== true` keeps the app's
    // own default on the unreadable cases (dark), instead of today's accidental light.
    root.style.colorScheme = isLightColor(colors['bg-base']) === true ? 'light' : 'dark';
  }

  // Animations — exposes a single data-attribute the CSS can hook into
  // (e.g. `html[data-animations="true"] .some-thing { transition: ... }`). Written only on a
  // change: the attribute is matched by a rule over every element, so each write restyles the
  // whole tree.
  const flag = animations ? 'true' : 'false';
  if (root.getAttribute('data-animations') !== flag) root.setAttribute('data-animations', flag);
}

/**
 * What a colour field will ACTUALLY measure once painted — the number the Theme Editor shows.
 *
 * It lives here, next to applyThemeConfig, on purpose. The old checker compared four raw text
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

// ── Import/Export ──

// Accepts only strings safe to interpolate into a CSS value: hex / rgb()/rgba() / hsl()/hsla()
// / named colors / color-mix() / oklch(). Two gates, and both are needed.
//
// The character set rejects what could break OUT of the declaration (`;` `{` `}` `:`) — the
// CSS-injection vector when an imported theme's color reaches root.style.cssText, and also what
// protects the `color-mix(in srgb, ${hue} …)` interpolations elsewhere in this file.
//
// The grammar gate rejects what is a legal CSS VALUE but not a COLOR. `url(//tracker/x.png)`
// passed the character set, and a theme carrying it made the app fetch a remote image on every
// boot and paint it as the window background — an IP beacon for whoever shared the theme, from a
// page that has no CSP. Asking the engine (`CSS.supports('color', v)`) instead of hand-writing a
// grammar keeps rgb/hsl/named/color-mix/oklch working and needs no maintenance when CSS grows new
// syntax.
//
// The fallback matters: this module is imported by NODE, in tools/gen-boot-mirror.mjs, where
// there is no `CSS` object. Without the guard the build would throw.
function isSafeCssColor(v: unknown): boolean {
  if (typeof v !== 'string' || v.length === 0 || v.length > 64) return false;
  if (!/^[#0-9a-zA-Z.,%()/\s-]+$/.test(v)) return false;
  // `var()` is refused before anything else, on BOTH branches. CSS.supports('color',
  // 'var(--z,url(//host/x.png))') answers TRUE by contract — a var() reference is valid wherever a
  // value is expected, and the engine cannot know what it will resolve to — so the very payload
  // this function exists to stop walked straight through the browser branch while the Node branch
  // below already rejected it. The two halves of the same guard disagreed. No stock preset uses
  // var() in a colour, so nothing legitimate is lost.
  if (/var\s*\(/i.test(v)) return false;
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') return CSS.supports('color', v);
  // Node (the boot-mirror generator): accept the shapes the generator can actually emit and
  // reject every function call it cannot vet.
  return /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)
    || /^(?:rgb|hsl)a?\([^()]*\)$/.test(v)
    || /^[a-zA-Z]+$/.test(v);
}

// Font-family token interpolated as `'${fontMono}', ...` — letters/digits/space/_/- only, so a
// quote / `;` / `{}` can't escape the rule.
function isSafeFontFamily(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[a-zA-Z0-9 _-]+$/.test(v);
}

/** Every uiSettings field that is interpolated into a CSS declaration as a colour. Shared by the
 *  file-import validator and the storage sanitiser so a field added to one is never missed by the
 *  other — the split between them is exactly how the storage path ended up unguarded. */
const UI_COLOR_FIELDS = [
  'recordingColor', 'replayColor', 'clickerColor', 'actionMouseColor', 'actionKeyColor',
  'actionScrollColor', 'actionSendTextColor', 'actionWaitImageColor', 'actionPixelColorColor',
  'actionBrowserColor', 'actionRunProfileColor', 'actionPauseColor', 'actionIfColor',
  'actionSetVariableColor', 'actionLoopColor', 'actionFlowColor', 'actionActivateWindowColor',
] as const;

/**
 * Strip anything from a STORED config that is not safe to interpolate into a CSS declaration.
 *
 * The file-import path has been validated since isSafeCssColor was written, but localStorage was
 * not — and it is the same sink: colorOverrides and the uiSettings hues flow verbatim into
 * `root.style.cssText`. Anything that reaches storage without passing through today's import
 * (hand-edited storage, a preset saved before the validator existed, a future writer that forgets)
 * lands in that sink unchecked, which is the CSS-injection vector isSafeCssColor exists to close.
 *
 * Dropping the offending key rather than the whole config is deliberate: a single bad override
 * should cost that one colour, which then falls through to the base preset, not the user's whole
 * theme. Returns the count so the caller can say something rather than fail silently.
 */
function sanitizeStoredConfig(config: ThemeConfig): number {
  let dropped = 0;
  if (config.colorOverrides && typeof config.colorOverrides === 'object') {
    for (const key of Object.keys(config.colorOverrides) as (keyof ThemeColors)[]) {
      // The KEY is interpolated into the declaration too (`--color-${key}: ${value};`), so
      // validating only the value left the injection vector wide open: an override keyed
      // `x: red; background-image: url(//host/beacon.png); --y` with a perfectly valid `#fff`
      // sailed through and emitted a live network request into the root style at boot.
      // importTheme has always filtered against THEME_COLOR_KEYS; the storage path had not.
      if (!THEME_COLOR_KEYS.includes(key) || !isSafeCssColor(config.colorOverrides[key])) {
        delete config.colorOverrides[key]; dropped++;
      }
    }
  }
  const ui = config.uiSettings as unknown as Record<string, unknown>;
  for (const f of UI_COLOR_FIELDS) {
    if (ui[f] !== undefined && !isSafeCssColor(ui[f])) { ui[f] = DEFAULT_UI_SETTINGS[f]; dropped++; }
  }
  if (ui.fontMono !== undefined && !isSafeFontFamily(ui.fontMono)) { ui.fontMono = DEFAULT_UI_SETTINGS.fontMono; dropped++; }
  // The four numeric fields land in the same cssText sink (`--ui-font-size: ${n}px`) and now in
  // `s.zoom` at boot, and after the spread over DEFAULT_UI_SETTINGS nothing had checked even their
  // TYPE. A stored fontSize of `0; background-image:url(...)` is a string that produces a valid
  // extra declaration. Bounds shared with validateExportedTheme and the boot mirror (UI_NUMBER_BOUNDS).
  for (const f of UI_NUMBER_FIELDS) {
    const [lo, hi] = UI_NUMBER_BOUNDS[f];
    const v = ui[f];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
      ui[f] = DEFAULT_UI_SETTINGS[f]; dropped++;
    }
  }
  return dropped;
}

/**
 * The four numeric uiSettings and the range each is accepted in. ONE table for the three readers
 * that need it — the storage sanitiser above, the import validator below, and the boot mirror that
 * tools/gen-boot-mirror.mjs writes into index.html — because they used to be three hand-written
 * copies and the mirror's copy was missing: a stored zoom of 0 blanked the page until React loaded
 * and put the default back. Ranges are wide on purpose, so any reasonable hand-made theme imports.
 */
export const UI_NUMBER_BOUNDS = {
  fontSize: [6, 48], borderRadius: [0, 64], rowHeight: [12, 120], zoom: [25, 500],
} as const;
const UI_NUMBER_FIELDS = Object.keys(UI_NUMBER_BOUNDS) as (keyof typeof UI_NUMBER_BOUNDS)[];

export function validateExportedTheme(data: unknown): data is ExportedTheme {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (d.version !== 1 || typeof d.name !== 'string') return false;
  if (!d.colors || typeof d.colors !== 'object') return false;
  const colors = d.colors as Record<string, unknown>;
  for (const key of THEME_COLOR_KEYS) {
    // Must be a safe CSS color, not merely a string — these flow verbatim into
    // root.style.cssText in applyThemeConfig, so an unvalidated value is a CSS-injection vector.
    if (!isSafeCssColor(colors[key])) return false;
  }
  if (!d.uiSettings || typeof d.uiSettings !== 'object') return false;
  const ui = d.uiSettings as Record<string, unknown>;
  // Bounds-check (not just type-check) — these feed CSS sizing, so reject NaN/Infinity/negative/
  // absurd values (UI_NUMBER_BOUNDS). zoom may be absent: it is newer than the other three, an
  // older export carries none, and the import merges over the defaults.
  for (const f of UI_NUMBER_FIELDS) {
    const [lo, hi] = UI_NUMBER_BOUNDS[f];
    const v = ui[f];
    if (f === 'zoom' && v === undefined) continue;
    if (typeof v !== 'number' || !(v >= lo && v <= hi)) return false;
  }
  // uiSettings color fields are interpolated into cssText (incl. color-mix) — when present they
  // must be safe colors. Missing fields are tolerated (merged over DEFAULT_UI_SETTINGS on import).
  for (const f of UI_COLOR_FIELDS) {
    if (ui[f] !== undefined && !isSafeCssColor(ui[f])) return false;
  }
  if (ui.fontMono !== undefined && !isSafeFontFamily(ui.fontMono)) return false;
  return true;
}

export function findClosestPreset(colors: ThemeColors): string {
  let bestId = DEFAULT_THEME_ID;
  let bestMatches = 0;
  // The palettes keep the presets' order (the mirror writes them from the list), so a tie still
  // goes to the preset listed first.
  for (const [id, palette] of Object.entries(palettes)) {
    let matches = 0;
    for (const key of THEME_COLOR_KEYS) {
      if (palette[key] === colors[key]) matches++;
    }
    if (matches > bestMatches) {
      bestMatches = matches;
      bestId = id;
    }
  }
  return bestId;
}
