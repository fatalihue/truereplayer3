import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Check, RotateCcw, Download, Upload, Clipboard, ClipboardPaste, Pipette,
  ChevronDown, ChevronRight, ChevronLeft, Dices, SlidersHorizontal, FileJson2,
  Palette, Wand2, TriangleAlert, Undo2, X, ArrowRight,
} from 'lucide-react';
import { NumberInput } from './common/NumberInput';
import { Toggle } from './common/Toggle';
import { DialogShell  } from './common/DialogShell';
import { Button } from './common/Button';
import { SegmentedControl } from './common/SegmentedControl';
import { FieldError } from './common/FieldError';
import {
  themes,
  DEFAULT_UI_SETTINGS,
  toHex,
  withOriginalAlpha,
  validateExportedTheme,
  getThemeTags,
  hexToHSL,
  hslToHex,
  measurePaintedContrast,
  pickInk,
  isLightColor,
  DEFAULT_THEME_ID,
  makeCustomPresetId,
} from '../themes';
import type { ThemeColors, ExportedTheme, ThemeTag, CustomThemePreset, ThemeUISettings, ThemeConfig } from '../themes';
import { useTheme } from '../state/ThemeContext';
import { useTt, useLanguage, DEFAULT_LANGUAGE } from '../state/LanguageContext';
import { useToast } from '../state/ToastContext';

interface ThemeEditorProps {
  onClose: () => void;
}

// Which left-column surface is showing. Gallery is the 90% path (pick a preset);
// customize (colors + interface) and share (import/export) live behind footer doors.
type Surface = 'gallery' | 'customize' | 'share';

// ── Color field model ──
// One flat list of every editable colour, grouped into accordion sections. Theme
// keys route through the preset override system (alpha-preserving); ui keys are the
// semantic + action-type colours stored plainly in uiSettings.
type ColorKind = 'theme' | 'ui';
interface ColorField { key: string; label: string; kind: ColorKind }
interface ColorSection {
  title: string;
  fields: ColorField[];
  grid2?: boolean;     // render the rows in a 2-col grid (Action types)
  accent?: boolean;    // append the "Derive solid & hover" button (Accent)
  defaultOpen?: boolean;
}

const COLOR_SECTIONS: ColorSection[] = [
  { title: 'Accent', accent: true, defaultOpen: true, fields: [
    { key: 'accent', label: 'Accent', kind: 'theme' },
    { key: 'accent-solid', label: 'Solid', kind: 'theme' },
    { key: 'accent-hover', label: 'Hover', kind: 'theme' },
  ] },
  { title: 'Backgrounds', fields: [
    { key: 'bg-base', label: 'Base', kind: 'theme' },
    { key: 'bg-surface', label: 'Surface', kind: 'theme' },
    { key: 'bg-card', label: 'Card', kind: 'theme' },
    { key: 'bg-elevated', label: 'Elevated', kind: 'theme' },
    { key: 'bg-input', label: 'Input', kind: 'theme' },
  ] },
  { title: 'Text', fields: [
    { key: 'text-primary', label: 'Primary', kind: 'theme' },
    { key: 'text-secondary', label: 'Secondary', kind: 'theme' },
    { key: 'text-tertiary', label: 'Tertiary', kind: 'theme' },
    { key: 'text-disabled', label: 'Disabled', kind: 'theme' },
  ] },
  { title: 'Borders', fields: [
    { key: 'border-subtle', label: 'Subtle', kind: 'theme' },
    { key: 'border-default', label: 'Default', kind: 'theme' },
    { key: 'border-strong', label: 'Strong', kind: 'theme' },
  ] },
  { title: 'Semantic', fields: [
    { key: 'recordingColor', label: 'Recording', kind: 'ui' },
    { key: 'replayColor', label: 'Replay', kind: 'ui' },
    { key: 'clickerColor', label: 'Clicker', kind: 'ui' },
  ] },
  { title: 'Action types', grid2: true, fields: [
    { key: 'actionMouseColor', label: 'Mouse', kind: 'ui' },
    { key: 'actionKeyColor', label: 'Key', kind: 'ui' },
    { key: 'actionScrollColor', label: 'Scroll', kind: 'ui' },
    { key: 'actionSendTextColor', label: 'Send Text', kind: 'ui' },
    { key: 'actionSetVariableColor', label: 'Set Variable', kind: 'ui' },
    // One picker for the whole Wait family (Image, Pixel Color, Text) — see getActionTypeColors.
    { key: 'actionWaitImageColor', label: 'Wait', kind: 'ui' },
    { key: 'actionBrowserColor', label: 'Browser', kind: 'ui' },
    { key: 'actionRunProfileColor', label: 'Run Profile', kind: 'ui' },
    { key: 'actionPauseColor', label: 'Pause', kind: 'ui' },
    { key: 'actionIfColor', label: 'Conditional', kind: 'ui' },
    { key: 'actionLoopColor', label: 'Loop', kind: 'ui' },
    { key: 'actionFlowColor', label: 'Stop / Return', kind: 'ui' },
    { key: 'actionActivateWindowColor', label: 'Activate Window', kind: 'ui' },
  ] },
];

const ALL_FIELDS: ColorField[] = COLOR_SECTIONS.flatMap(s => s.fields);
// All sections start EXPANDED — scrolling one column beats expanding six accordions
// one at a time. The header chevrons still collapse a section on demand.
const INITIAL_COLLAPSED = new Set<string>();

const MONO_FONTS = ['Cascadia Mono', 'Cascadia Code', 'Consolas', 'Courier New', 'Lucida Console'];

// Picks a color anywhere on screen using the EyeDropper API (Chromium 95+).
// Returns the sRGBHex string or null if unsupported or cancelled.
async function pickFromScreen(): Promise<string | null> {
  const Ctor = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
  if (!Ctor) return null;
  try {
    const result = await new Ctor().open();
    return result.sRGBHex;
  } catch {
    return null;
  }
}
const HAS_EYEDROPPER = typeof (window as unknown as { EyeDropper?: unknown }).EyeDropper !== 'undefined';

// ── Unified color row ──
// One row for all 29 colours. The parent supplies the resolved value, whether it's
// overridden, and change/reset callbacks — the row stays agnostic about theme vs ui.
function ColorRow({ label, value, overridden, check, hslOpen, onChange, onReset, onToggleHsl, onHover }: {
  label: string;
  value: string;
  overridden: boolean;
  /** Measured by measurePaintedContrast — the ratio this colour reaches once PAINTED, which for
   *  a hue field is its derived ink over its own wash, not the stored value on a flat surface. */
  check?: { ratio: number; target: number; what: string } | null;
  hslOpen: boolean;
  onChange: (hex: string) => void;   // raw #rrggbb; parent applies alpha/plain + tracks recent
  onReset: () => void;
  onToggleHsl: () => void;
  onHover: (hovering: boolean) => void;
}) {
  const tt = useTt();
  const hexValue = toHex(value);
  const ratio = check ? check.ratio : null;
  // The text field's own copy while it has focus. Controlled straight by hexValue, a keystroke only
  // stuck when it COMPLETED a valid #rrggbb, so every partial state lived in the DOM alone — and any
  // re-render of the editor (a hover over another row, an HSL panel opening) wrote the stored hex
  // back over it mid-typing. Same shape as NumberInput's buffer: a complete value still applies live;
  // leaving the field shows the stored one again.
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  // The H/S/L the sliders stand on. Re-derived from the hex on every render, a slider pushed to an
  // end lost the other two: at S=0 or L=0/100 every hue is the same grey, hexToHSL answers h=0,
  // and dragging back out landed on red. Held while the hex is the one the sliders produced; a
  // change from anywhere else (typing, the picker, Reset, a recent swatch) re-derives it.
  const [hslHold, setHslHold] = useState<{ hex: string; h: number; s: number; l: number } | null>(null);

  return (
    <div
      className="py-0.5 group"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="flex items-center gap-1.5">
        <span className="w-[96px] text-minor text-text-secondary shrink-0">{label}</span>

        {/* The native picker is an invisible overlay, so the swatch draws its focus instead. */}
        <label className="relative w-6 h-6 rounded border border-border-default cursor-pointer shrink-0 overflow-hidden has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-solid">
          <div className="absolute inset-0" style={{ backgroundColor: value }} />
          <input
            type="color"
            value={hexValue}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label} color`}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>

        <input
          type="text"
          aria-label={`${label} hex`}
          value={hexDraft ?? hexValue}
          onFocus={() => setHexDraft(hexValue)}
          onBlur={() => setHexDraft(null)}
          onChange={(e) => {
            const v = e.target.value;
            setHexDraft(v);
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
          }}
          className="w-[76px] h-6 px-1 text-minor font-mono text-text-primary bg-bg-input border border-border-default rounded text-center outline-none focus:border-accent-solid"
        />

        {/* Icon cluster (fixed width so 2-col rows line up). Pipette + tune reveal on
            hover — and on keyboard focus, or Tab landed on an invisible button; reset holds a
            reserved slot, visible only when overridden. 24 px targets (the floor), 3 × 24 + gaps. */}
        <span className="flex items-center gap-0.5 w-[76px] shrink-0">
          {HAS_EYEDROPPER && (
            <button
              type="button"
              onClick={async () => { const p = await pickFromScreen(); if (p) onChange(p); }}
              aria-label={`Pick ${label} color from screen`}
              className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-accent hover:bg-bg-card opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              data-tip={tt('Pick color from screen', 'Capturar cor da tela')}
            >
              <Pipette size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={onToggleHsl}
            aria-label={`${label} HSL sliders`}
            aria-expanded={hslOpen}
            className={`w-6 h-6 flex items-center justify-center rounded hover:bg-bg-card transition-opacity ${hslOpen ? 'text-accent opacity-100' : 'text-text-tertiary hover:text-text-primary opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
            data-tip={tt('HSL sliders', 'Controles HSL')}
          >
            <SlidersHorizontal size={11} />
          </button>
          {overridden && (
            <button
              type="button"
              onClick={onReset}
              aria-label={`Reset ${label} to preset`}
              className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-card"
              data-tip={tt('Reset to preset', 'Voltar ao preset')}
            >
              <RotateCcw size={12} />
            </button>
          )}
        </span>

        {ratio !== null && check && (() => {
          // Quiet-when-passing: at or above the field's own floor this renders a bare number;
          // below it, a tinted chip, so failures are the only thing that draws the eye.
          // The floor is per-field now — 4.5 for text and for a solid button's label, 3 for a UI
          // boundary and for the hue inks, which are glyphs beside an icon rather than body text.
          const passing = ratio >= check.target;
          const bad = ratio < check.target * 0.67;
          // The tooltip IS localised, so `what` has to be too — interpolating the English phrase
          // into both branches produced a half-Portuguese tooltip.
          const WHAT_PT: Record<string, string> = {
            'worst surface': 'pior superfície',
            'UI boundary': 'limite de componente',
            'label on solid fill': 'rótulo sobre o preenchimento',
            'accent as text': 'destaque como texto',
            'derived ink on its own wash': 'tinta derivada sobre o próprio fundo',
          };
          const tip = tt(
            `${check.what}: ${ratio.toFixed(1)}:1 — wants ${check.target}+`,
            `${WHAT_PT[check.what] ?? check.what}: ${ratio.toFixed(1)}:1 — precisa de ${check.target}+`,
          );
          if (passing) {
            return <span className="ml-auto font-mono text-caption text-text-tertiary" data-tip={tip}>{ratio.toFixed(1)}</span>;
          }
          return (
            <span
              className="ml-auto inline-flex items-center gap-1 px-1.5 rounded font-mono text-caption"
              style={{
                // -fg, not the raw hue: this chip is TEXT, and the raw recording red is solved
                // for fills. On a light preset the raw hue put the contrast warning itself below
                // the contrast it was warning about.
                color: bad ? 'var(--color-recording-fg)' : 'var(--color-warning-ink)',
                background: `color-mix(in srgb, ${bad ? 'var(--color-recording)' : 'var(--color-warning)'} 8%, transparent)`,
              }}
              data-tip={tip}
            >
              <TriangleAlert size={10} />{ratio.toFixed(1)}
            </span>
          );
        })()}
      </div>

      {hslOpen && (() => {
        const hsl = hslHold && hslHold.hex === hexValue.toLowerCase() ? hslHold : hexToHSL(hexValue);
        const set = (h: number, s: number, l: number) => {
          const hex = hslToHex(h, s, l);
          setHslHold({ hex: toHex(hex).toLowerCase(), h, s, l });
          onChange(hex);
        };
        return (
          <div className="ml-[102px] mt-1 mb-1 pl-2 border-l border-border-subtle space-y-1">
            <HSLSlider label="H" name={`${label} hue`} max={360} value={Math.round(hsl.h)} unit="°" gradient="linear-gradient(to right, hsl(0,80%,50%), hsl(60,80%,50%), hsl(120,80%,50%), hsl(180,80%,50%), hsl(240,80%,50%), hsl(300,80%,50%), hsl(360,80%,50%))" onChange={(v) => set(v, hsl.s, hsl.l)} />
            <HSLSlider label="S" name={`${label} saturation`} max={100} value={Math.round(hsl.s)} unit="%" gradient={`linear-gradient(to right, hsl(${hsl.h},0%,${hsl.l}%), hsl(${hsl.h},100%,${hsl.l}%))`} onChange={(v) => set(hsl.h, v, hsl.l)} />
            <HSLSlider label="L" name={`${label} lightness`} max={100} value={Math.round(hsl.l)} unit="%" gradient={`linear-gradient(to right, hsl(${hsl.h},${hsl.s}%,0%), hsl(${hsl.h},${hsl.s}%,50%), hsl(${hsl.h},${hsl.s}%,100%))`} onChange={(v) => set(hsl.h, hsl.s, v)} />
          </div>
        );
      })()}
    </div>
  );
}

function HSLSlider({ label, name, value, max, unit, gradient, onChange }: {
  label: string; name: string; value: number; max: number; unit: string; gradient: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-caption text-text-tertiary w-3">{label}</span>
      {/* The range input is an invisible overlay: the track draws its focus. */}
      <div className="flex-1 relative h-3 rounded has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-solid" style={{ background: gradient }}>
        <input type="range" min={0} max={max} value={value} aria-label={name} onChange={(e) => onChange(Number(e.target.value))} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        <div className="absolute top-1/2 w-2.5 h-2.5 rounded-full bg-white border border-black/40 pointer-events-none" style={{ left: `${(value / max) * 100}%`, transform: 'translate(-50%, -50%)' }} />
      </div>
      <span className="font-mono text-caption text-text-tertiary w-7 text-right tabular-nums">{value}{unit}</span>
    </div>
  );
}

function SliderSetting({ label, value, min, max, unit, defaultValue, onChange }: {
  label: string; value: number; min: number; max: number; unit: string; defaultValue?: number; onChange: (v: number) => void;
}) {
  const tt = useTt();
  const containerRef = useRef<HTMLDivElement>(null);
  const hovering = useRef(false);
  const latestValue = useRef(value);
  latestValue.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!hovering.current) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? 1 : -1;
      const next = Math.min(max, Math.max(min, latestValue.current + delta));
      if (next !== latestValue.current) onChangeRef.current(next);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [min, max]);

  const defaultPct = defaultValue !== undefined && defaultValue > min && defaultValue < max
    ? ((defaultValue - min) / (max - min)) * 100
    : null;

  return (
    <div ref={containerRef} className="flex items-center gap-3 py-1" onMouseEnter={() => { hovering.current = true; }} onMouseLeave={() => { hovering.current = false; }}>
      <span className="text-minor text-text-secondary w-[100px]">{label}</span>
      {/* The "Default" tip lives on the track: the tick mark is pointer-events-none (it must not
          eat the drag), and TooltipLayer finds tips from the hovered element, so on the tick it
          could never show. */}
      <div className="flex-1 relative" data-tip={defaultPct !== null ? tt(`Default: ${defaultValue}${unit}`, `Padrão: ${defaultValue}${unit}`) : undefined}>
        <input type="range" min={min} max={max} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} className="w-full h-1.5 accent-accent-solid" />
        {defaultPct !== null && (
          <div className="absolute pointer-events-none" style={{ left: `${defaultPct}%`, top: '50%', transform: 'translate(-50%, -50%)' }}>
            <div className="w-0.5 h-2.5 bg-text-tertiary/60" />
          </div>
        )}
      </div>
      <NumberInput value={value} onChange={onChange} min={min} max={max} suffix={unit} inputHeight="h-7" ariaLabel={label} />
    </div>
  );
}

const DENSITY_PRESETS = [
  { id: 'compact', name: 'Compact', fontSize: 12, rowHeight: 28, borderRadius: 2, lines: 4, lineH: 2 },
  { id: 'normal', name: 'Normal', fontSize: 13, rowHeight: 34, borderRadius: 3, lines: 3, lineH: 3 },
  { id: 'spacious', name: 'Spacious', fontSize: 14, rowHeight: 42, borderRadius: 4, lines: 2, lineH: 5 },
];

// ── Main ThemeEditor ──

export function ThemeEditor({ onClose }: ThemeEditorProps) {
  const tt = useTt();
  const { showToast } = useToast();
  const {
    config, resolvedColors, customPresets, selectPreset, replaceConfig,
    setColorOverride, clearColorOverride, clearAllOverrides,
    setAccentColor, setUISetting, resetUISettings,
    exportTheme, importTheme,
    saveAsPreset, deleteCustomPreset, restoreCustomPreset, osReducedMotion,
  } = useTheme();
  // The ✕ on a custom card deletes at once; a 10 s Undo puts it back where it was, active again
  // if it was the active theme (the snapshot is the config at the moment of the delete).
  const handleDeletePreset = (id: string) => {
    const index = customPresets.findIndex(p => p.id === id);
    const preset = customPresets[index];
    if (!preset) return;
    const before = config;
    deleteCustomPreset(id);
    showToast(tt(`Deleted preset "${preset.name}"`, `Preset "${preset.name}" excluído`), {
      type: 'success',
      duration: 10000,
      action: { label: 'Undo', onClick: () => restoreCustomPreset(preset, index, before) },
    });
  };
  const { language, setLanguage } = useLanguage();

  const [surface, setSurface] = useState<Surface>('gallery');
  const [custSeg, setCustSeg] = useState<'colors' | 'interface'>('colors');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set(INITIAL_COLLAPSED));
  const [openHslKey, setOpenHslKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // Click-to-edit: a preview hotspot was clicked → scroll its color row into view once it renders.
  const [scrollKey, setScrollKey] = useState<string | null>(null);

  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyError, setCopyError] = useState(false);
  // The COLOUR that was copied, not its slot: any colour applied anywhere in the editor re-sorts the
  // recent strip (pushRecent puts it first), and an index then lit the ✓ and the "copied!" tip on a
  // different swatch for the rest of the 1.2 s.
  const [copiedRecent, setCopiedRecent] = useState<string | null>(null);
  const [presetSearch, setPresetSearch] = useState('');
  const [presetFilter, setPresetFilter] = useState<'all' | ThemeTag>('all');
  const [savePresetName, setSavePresetName] = useState('');
  const [saveMode, setSaveMode] = useState(false);        // Modified-bar inline save input open
  const [exportName, setExportName] = useState('My theme');
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [resetMenuOpen, setResetMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);
  const resetMenuRef = useRef<HTMLDivElement>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  // "Reset everything" resets the app language too, so the open state has to hold it: without it
  // Revert restored the theme and left the language reset, and the button went dark as if done.
  const openLanguage = useRef(language);

  // Snapshot of the theme as the editor found it. This dialog is a LIVE preview — every change is
  // written to the document and persisted within 200 ms — so there was no way back from an hour of
  // edits: Done, Esc, the X and the backdrop all did the same thing, and none of them was a
  // cancel. The snapshot is the cheapest honest undo: one deep-enough copy on open, restored on
  // demand. Deliberately NOT wired to Esc or the backdrop, which would make the usual ways of
  // closing destructive; Revert is an explicit button that only appears once something differs.
  const openSnapshot = useRef<ThemeConfig | null>(null);
  if (openSnapshot.current === null) {
    openSnapshot.current = {
      ...config,
      colorOverrides: { ...config.colorOverrides },
      uiSettings: { ...config.uiSettings },
    };
  }
  const snap = openSnapshot.current;
  // Field-wise, not JSON.stringify — the same reason the reset gate below already spells out, plus
  // a correctness one: JSON equality is sensitive to KEY ORDER, and clearColorOverride deletes
  // while setColorOverride re-inserts at the end. Resetting a colour and re-picking the same value
  // produced identical content in a different order, so the Revert button stuck on forever and
  // clicking it changed nothing visible. setAccentColor rewrites three keys at once, so this was
  // routine rather than exotic.
  const sameColors = (a: Partial<ThemeColors>, b: Partial<ThemeColors>) => {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => a[k as keyof ThemeColors] === b[k as keyof ThemeColors]);
  };
  const dirtySinceOpen = snap.baseThemeId !== config.baseThemeId
    || !sameColors(snap.colorOverrides, config.colorOverrides)
    || (Object.keys(DEFAULT_UI_SETTINGS) as (keyof ThemeUISettings)[])
         .some(k => k !== 'matchSystemTheme' && snap.uiSettings[k] !== config.uiSettings[k])
    // matchSystemTheme is the one field a restore cannot bring back: replaceConfig forces it OFF
    // on purpose. Comparing it like the others left Revert lit FOREVER for anyone who opened the
    // editor with the Windows follower on — the second click produced the same state, which is
    // exactly the stuck-button symptom the comment above says was eliminated. It still counts as
    // dirty in the one direction a restore CAN undo: turned on since the snapshot.
    || (config.uiSettings.matchSystemTheme && !snap.uiSettings.matchSystemTheme)
    || language !== openLanguage.current;
  const revertToOpenState = useCallback(() => {
    const wasFollowing = openSnapshot.current!.uiSettings.matchSystemTheme;
    replaceConfig(openSnapshot.current!);
    setLanguage(openLanguage.current);
    // Say what Revert could not restore, rather than leaving the user to find it in the Interface
    // tab. tt() in a toast is what the convention allows.
    if (wasFollowing) showToast(tt('Match Windows theme was turned off', 'Seguir o tema do Windows foi desligado'), 'info');
  }, [replaceConfig, setLanguage, showToast, tt]);

  const hasOverrides = Object.keys(config.colorOverrides).length > 0;
  // Same lookup order as resolveThemeColors, and for the same reason: a custom preset is not in
  // `themes`, so searching only there fell through to themes[0] — which is Gruvbox Dark, because
  // the array is hue-sorted and slot 0 is an arbitrary palette rather than a neutral one. Every
  // user with a saved preset was told their base was "Gruvbox Dark", and, worse, the per-field
  // "modified" dots and per-field reset compared against Gruvbox's colours instead of their own.
  const basePreset = customPresets.find(t => t.id === config.baseThemeId)
    ?? themes.find(t => t.id === config.baseThemeId)
    ?? themes.find(t => t.id === DEFAULT_THEME_ID)
    ?? themes[0];
  const currentAccentHex = toHex(resolvedColors.accent);

  // All 32 contrast readings in one pass, keyed by field, recomputed only when the palette or the
  // hue settings actually change. Called inline in the row map it ran on EVERY render — and every
  // row's mouseenter/mouseleave calls setHoverKey, so dragging the pointer down the list re-solved
  // the whole set twice per row crossed, as does each HSL slider tick at 60-120 Hz. Measured at
  // 0.72 ms per render on a light preset, nearly all of it the seventeen deriveHueInk solves,
  // which are exactly the ones whose answer cannot change without these two inputs changing.
  const contrastChecks = useMemo(() => {
    const m = new Map<string, ReturnType<typeof measurePaintedContrast>>();
    for (const f of ALL_FIELDS) m.set(f.key, measurePaintedContrast(f.kind, f.key, resolvedColors, config.uiSettings));
    return m;
  }, [resolvedColors, config.uiSettings]);

  // Field-wise compare (cheaper than JSON.stringify per render) for the reset-everything gate.
  const uiAtDefault = (Object.keys(DEFAULT_UI_SETTINGS) as (keyof ThemeUISettings)[])
    .every(k => config.uiSettings[k] === DEFAULT_UI_SETTINGS[k]);
  const everythingAtDefault = !hasOverrides && uiAtDefault && language === DEFAULT_LANGUAGE;

  // Push a chosen colour onto the transient recent strip (dedup ci, cap 8).
  const pushRecent = useCallback((val: string) => {
    const hex = toHex(val).toLowerCase();
    setRecentColors(prev => [hex, ...prev.filter(c => c.toLowerCase() !== hex)].slice(0, 8));
  }, []);

  // Field value / base / overridden — bridges the two storage backends.
  const fieldValue = useCallback((f: ColorField): string =>
    f.kind === 'theme' ? resolvedColors[f.key as keyof ThemeColors] : String(config.uiSettings[f.key as keyof ThemeUISettings]),
    [resolvedColors, config.uiSettings]);
  const fieldBase = useCallback((f: ColorField): string =>
    f.kind === 'theme' ? basePreset.colors[f.key as keyof ThemeColors] : String(DEFAULT_UI_SETTINGS[f.key as keyof ThemeUISettings]),
    [basePreset]);
  const fieldOverridden = useCallback((f: ColorField): boolean =>
    f.kind === 'theme' ? (f.key in config.colorOverrides) : fieldValue(f) !== fieldBase(f),
    [config.colorOverrides, fieldValue, fieldBase]);

  // Apply a raw #rrggbb to a field: theme keys preserve original alpha + go through the
  // override store; ui keys store plain hex. Both feed the recent strip — once the gesture
  // settles: an HSL drag or a native-picker drag calls this on every tick, and pushing each tick
  // filled the eight slots with the in-between shades of ONE drag, evicting the real picks.
  const recentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (recentTimer.current) clearTimeout(recentTimer.current); }, []);
  const applyColor = useCallback((f: ColorField, rawHex: string) => {
    if (f.kind === 'theme') {
      const k = f.key as keyof ThemeColors;
      setColorOverride(k, withOriginalAlpha(rawHex, resolvedColors[k]));
    } else {
      setUISetting(f.key as keyof ThemeUISettings, rawHex as ThemeUISettings[keyof ThemeUISettings]);
    }
    if (recentTimer.current) clearTimeout(recentTimer.current);
    recentTimer.current = setTimeout(() => pushRecent(rawHex), 400);
  }, [setColorOverride, setUISetting, resolvedColors, pushRecent]);

  const resetColor = useCallback((f: ColorField) => {
    if (f.kind === 'theme') clearColorOverride(f.key as keyof ThemeColors);
    else setUISetting(f.key as keyof ThemeUISettings, DEFAULT_UI_SETTINGS[f.key as keyof ThemeUISettings]);
  }, [clearColorOverride, setUISetting]);

  const toggleSection = useCallback((title: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });
  }, []);

  // Reset menu — close on outside mousedown / Esc. Focus the menu when it opens so its
  // own onKeyDown catches Esc (stopPropagation) instead of the keystroke bubbling to
  // DialogShell and closing the whole editor — mouse-open otherwise leaves focus on the
  // toggle button, outside the menu, so the Esc-swallow never fired.
  // The first ENABLED item, not the container: the container is tabIndex -1, which the dialog's
  // Tab ring skips, so Tab from it jumped past the items to the header Close.
  useEffect(() => {
    if (!resetMenuOpen) return;
    const first = resetMenuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    (first ?? resetMenuRef.current)?.focus();
    const onDown = () => setResetMenuOpen(false);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [resetMenuOpen]);
  // Keyboard closes hand the focus back to the trigger (the menu unmounts with it inside).
  const closeResetMenu = () => { setResetMenuOpen(false); resetTriggerRef.current?.focus(); };

  useEffect(() => { if (saveMode) saveInputRef.current?.focus(); }, [saveMode]);

  // A surface swap remounts the left column (key={surface}) and takes the focused door with it —
  // Customize, Edit, ‹ Themes. Land on the new surface's first control instead of the card.
  // Compared with the last surface, not a first-run flag: StrictMode runs the effect twice on
  // mount, and a flag let the second run grab the search field on open.
  const lastSurface = useRef(surface);
  useEffect(() => {
    if (lastSurface.current === surface) return;
    lastSurface.current = surface;
    const el = leftColumnRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]');
    el?.focus({ preventScroll: true });
  }, [surface]);

  // ── Export handlers ──
  const handleExportFile = useCallback(() => {
    const name = exportName.trim() || 'My theme';
    const theme = exportTheme(name);
    const blob = new Blob([JSON.stringify(theme, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportTheme, exportName]);

  const handleCopyClipboard = useCallback(async () => {
    const theme = exportTheme(exportName.trim() || 'My theme');
    try {
      await navigator.clipboard.writeText(JSON.stringify(theme, null, 2));
      setCopyError(false);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setCopySuccess(false);
      setCopyError(true);
      setTimeout(() => setCopyError(false), 2000);
    }
  }, [exportTheme, exportName]);

  // ── Import handlers ──
  const doImport = useCallback((json: string) => {
    setImportError('');
    try {
      const parsed = JSON.parse(json);
      if (!validateExportedTheme(parsed) || !importTheme(parsed as ExportedTheme)) {
        setImportError('Invalid theme: missing color keys or UI settings.');
        return;
      }
      setImportText('');
      setSurface('gallery');
    } catch {
      setImportError('Invalid JSON: paste the whole exported theme.');
    }
  }, [importTheme]);

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => doImport(reader.result as string);
    reader.onerror = () => setImportError('Could not read the selected file.');
    reader.readAsText(file);
    e.target.value = '';
  }, [doImport]);

  const handlePasteClipboard = useCallback(async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      setImportError('Could not read the clipboard — paste the JSON manually.');
      return;
    }
    setImportText(text);
    doImport(text);
  }, [doImport]);

  const doSaveAsPreset = useCallback(() => {
    const name = savePresetName.trim();
    if (!name) return;
    // The id is a slug of the name and a same-id save REPLACES (that is how saving twice under one
    // name updates). Two different names can slug alike — "Azul (v2)" / "Azul v2", "Café" / "Caf"
    // — and the second save silently overwrote the first preset. Same name still updates.
    const clash = customPresets.find(p => p.id === makeCustomPresetId(name) && p.name !== name);
    if (clash) {
      showToast(tt(`“${name}” would replace “${clash.name}” — pick another name.`,
                   `“${name}” substituiria “${clash.name}” — escolha outro nome.`), 'error');
      return;
    }
    saveAsPreset(name);
    setSavePresetName('');
    setSaveMode(false);
  }, [savePresetName, saveAsPreset, customPresets, showToast, tt]);

  // Recent-swatch click: apply to the currently open HSL row if any, else copy to clipboard.
  const openField = openHslKey ? ALL_FIELDS.find(f => f.key === openHslKey) : undefined;
  const handleRecentClick = useCallback(async (c: string) => {
    if (openField) { applyColor(openField, c); return; }
    try {
      await navigator.clipboard?.writeText(c);
      setCopiedRecent(c);
      setTimeout(() => setCopiedRecent(prev => (prev === c ? null : prev)), 1200);
    } catch {
      // A refused write (the window without OS focus, a clipboard another app holds) left the
      // click with no ✓ and no word; the export's copy button reports its own failure, so should this.
      showToast(tt('Could not copy the color — click inside the window and try again.',
                   'Não foi possível copiar a cor — clique dentro da janela e tente de novo.'), 'error');
    }
  }, [openField, applyColor, showToast, tt]);

  // Preview hotspots are click-to-edit: cursor + pointerEvents:auto make them interactive (the rail
  // disables pointer-events on mock buttons; the inline style re-enables just these), plus the
  // accent outline when the matching color row (or this hotspot) is hovered.
  const ckHover = (key: string): React.CSSProperties => ({
    cursor: 'pointer',
    pointerEvents: 'auto',
    ...(hoverKey === key ? { outline: '1px solid var(--color-accent-solid)', outlineOffset: '-1px' } : {}),
  });

  // Jump from a clicked preview hotspot to its color row: open Customize→Colors, expand the row's
  // section, open its HSL editor, and scroll it into view.
  const jumpToColor = useCallback((key: string) => {
    const section = COLOR_SECTIONS.find(s => s.fields.some(f => f.key === key));
    if (!section) return;
    setSurface('customize');
    setCustSeg('colors');
    setCollapsedSections(prev => { const n = new Set(prev); n.delete(section.title); return n; });
    setOpenHslKey(key);
    setScrollKey(key);
  }, []);

  const ckEvents = (key: string) => ({
    onMouseEnter: () => setHoverKey(key),
    onMouseLeave: () => setHoverKey(null),
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); jumpToColor(key); },
  });

  useEffect(() => {
    if (!scrollKey) return;
    const key = scrollKey;
    // Instant (not smooth): the surface-slide already carries the motion, and a smooth scroll
    // racing the mount/slide lands unreliably. Two rAFs so the expanded section has laid out.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector(`[data-fieldkey="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'auto' });
      setScrollKey(null);
    }));
    return () => cancelAnimationFrame(raf);
  }, [scrollKey]);

  // ═══ Footer ═══
  const footerHint = (
    <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button
        ref={resetTriggerRef}
        type="button"
        onClick={() => setResetMenuOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={resetMenuOpen}
        className="inline-flex items-center gap-1.5 h-7 px-2 rounded text-minor text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors"
      >
        <RotateCcw size={12} /> Reset <ChevronDown size={11} />
      </button>
      {resetMenuOpen && (
        <div
          ref={resetMenuRef}
          tabIndex={-1}
          role="menu"
          aria-label="Reset"
          className="absolute bottom-full left-0 mb-1 w-[220px] menu-surface p-1 z-10 outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeResetMenu(); return; }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const items = Array.from(resetMenuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
              if (!items.length) return;
              const at = items.indexOf(document.activeElement as HTMLButtonElement);
              items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { clearAllOverrides(); closeResetMenu(); }}
            disabled={!hasOverrides}
            className="menu-item rounded text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reset color overrides
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { clearAllOverrides(); resetUISettings(); setLanguage(DEFAULT_LANGUAGE); closeResetMenu(); }}
            disabled={everythingAtDefault}
            className="menu-item rounded text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Reset everything
          </button>
          <div className="px-2 pb-1 text-caption text-text-tertiary">Includes app language</div>
        </div>
      )}
    </div>
  );

  const footer = (
    <>
      <Button variant="ghost" size="md" onClick={() => setSurface('share')}>
        <FileJson2 size={13} /> Import / export
      </Button>
      {surface !== 'customize' && (
        <Button variant="secondary" size="md" onClick={() => setSurface('customize')}>
          <SlidersHorizontal size={13} /> Customize
        </Button>
      )}
      {dirtySinceOpen && (
        <Button variant="secondary" size="md" onClick={revertToOpenState} data-tip={tt('As it was when you opened the editor', 'Como estava ao abrir o editor')}>
          {/* Label stays English like every sibling in this footer (Done, Customize, Save, OK):
              the convention localises tooltip TEXT only, never names, labels or menus. */}
          <Undo2 size={13} /> Revert
        </Button>
      )}
      <Button variant="primary" size="md" onClick={onClose}>Done</Button>
    </>
  );

  return (
    <DialogShell
      icon={<Palette size={14} style={{ color: 'var(--color-accent)' }} />}
      title="Theme Editor"
      size="full"
      onClose={onClose}
      closeOnBackdrop
      showClose
      // Ignore backdrop clicks in the OS title-bar guard zone so hitting the
      // maximize/restore/close caption buttons doesn't dismiss the editor.
      scrimMouseDownGuard={(e) => e.clientY < 40}
      footerStart={footerHint}
      footer={footer}
    >
      {/* flex-1, not the old hardcoded h-[560px]: the card is `flex flex-col` and this is a
          direct flex item, so an intrinsic height here would ignore the shell's 90vh and leave
          the panel short. min-h-0 keeps both columns' overflow-y-auto working. */}
      {/* The rail was a FIXED 300px, so widening the panel handed every new pixel to the
          settings column: the split drifted from 67/33 at the old 920px card to 73/27 at the
          default window and 83/17 maximised — the preview got proportionally thinner the more
          room there was. minmax lets it grow with the panel while keeping 320px as the floor
          the mock needs to render at real font size. */}
      <div className="grid grid-cols-[1fr_minmax(320px,34%)] flex-1 min-h-0">
        {/* ── Left column ── */}
        <div ref={leftColumnRef} className="min-w-0 overflow-y-auto">
          {/* key={surface} remounts on surface change so the gated slide keyframe re-fires. */}
          <div key={surface} className="theme-surface-slide">
            {surface === 'gallery' && renderGallery()}
            {surface === 'customize' && renderCustomize()}
            {surface === 'share' && renderShare()}
          </div>
        </div>

        {/* ── Persistent preview rail ── */}
        {renderRail()}
      </div>
    </DialogShell>
  );

  // ══════════════ GALLERY ══════════════
  function renderGallery() {
    const filterChips: { id: 'all' | ThemeTag; label: string }[] = [
      { id: 'all', label: 'All' }, { id: 'dark', label: 'Dark' }, { id: 'light', label: 'Light' },
      { id: 'vivid', label: 'Vivid' }, { id: 'pastel', label: 'Pastel' }, { id: 'monochrome', label: 'Monochrome' },
    ];
    const q = presetSearch.trim().toLowerCase();
    const matchesFilter = (id: string) => presetFilter === 'all' || getThemeTags(id).includes(presetFilter);
    const matchesSearch = (name: string) => q.length === 0 || name.toLowerCase().includes(q);
    const builtinList = themes.filter(t => matchesFilter(t.id) && matchesSearch(t.name));
    const customList = customPresets.filter(t => matchesSearch(t.name));
    const filteredCustom = customList.filter(p => {
      if (presetFilter === 'all') return true;
      if (presetFilter === 'dark' || presetFilter === 'light') {
        // One shared answer (isLightColor) instead of a hand-rolled formula. A saved preset's
        // bg-base is not necessarily hex — overrides run through withOriginalAlpha, which emits
        // `rgba(...)` — and isSafeCssColor also admits `hsl()`, named colours and `color-mix()`,
        // every one of which toHex maps to #000000, i.e. "dark". Unreadable now means unknown,
        // and an unknown theme is shown rather than silently filed under Dark.
        const light = isLightColor(p.colors['bg-base']);
        return light === null || light === (presetFilter === 'light');
      }
      // Vivid / Pastel / Monochrome are CURATED tags, hand-assigned per built-in preset — measured
      // against the palettes, they do not fall out of accent saturation or lightness (the three
      // groups overlap almost completely), so there is nothing honest to compute for a user's own
      // theme. Returning false hid every custom preset under those three filters with no hint that
      // anything was missing. They are shown instead, and the heading says why — otherwise the same
      // theme is quietly "uncategorised so show" in three filters and "categorised so hide" in two.
      return true;
    });
    const pool = builtinList.filter(t => t.id !== config.baseThemeId);

    const renderCard = (theme: typeof themes[0] | CustomThemePreset) => {
      const isActive = theme.id === config.baseThemeId && !hasOverrides;
      const isCustom = '__custom' in theme;
      return (
        <div key={theme.id} className="group/card relative">
          <button
            type="button"
            onClick={() => selectPreset(theme.id)}
            aria-pressed={isActive}
            className={`w-full flex flex-col rounded-shell overflow-hidden border transition-colors cursor-pointer ${
              isActive ? 'border-accent ring-1 ring-accent/30' : 'border-border-subtle hover:border-border-default'
            }`}
          >
            <div className="flex h-10">
              {theme.preview.map((color, i) => <div key={i} className="flex-1" style={{ backgroundColor: color }} />)}
            </div>
            <div className="flex items-center justify-between px-2 py-1.5" style={{ backgroundColor: theme.colors['bg-card'] }}>
              <span className="text-caption font-medium truncate" style={{ color: theme.colors['text-secondary'] }}>{theme.name}</span>
              {isActive && <Check size={12} style={{ color: theme.colors.accent }} />}
            </div>
          </button>
          {/* Hover-revealed Customize shortcut on the active card. */}
          {isActive && (
            <button
              type="button"
              onClick={() => setSurface('customize')}
              aria-label="Customize this theme"
              className="absolute bottom-9 right-1 w-4 h-4 rounded bg-[color-mix(in_srgb,var(--color-bg-base)_70%,transparent)] text-[color:var(--color-text-primary)] opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 transition-opacity flex items-center justify-center"
              data-tip={tt('Customize this theme', 'Personalizar este tema')}
            >
              <SlidersHorizontal size={10} />
            </button>
          )}
          {isCustom && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDeletePreset(theme.id); }}
              aria-label={`Delete preset ${theme.name}`}
              data-tip={tt('Delete preset', 'Excluir preset')}
              className="absolute top-1 right-1 w-5 h-5 rounded bg-bg-base/80 text-text-tertiary hover:text-recording-fg opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 transition-opacity flex items-center justify-center"
            >
              <X size={12} />
            </button>
          )}
        </div>
      );
    };

    return (
      <div className="p-4">
        {/* Toolbar */}
        <div className="flex gap-2 h-8">
          <div className="flex-1 relative">
            <input
              type="text"
              value={presetSearch}
              onChange={(e) => setPresetSearch(e.target.value)}
              placeholder="Search themes…"
              aria-label="Search themes"
              className="input-field font-sans pl-2.5 pr-7"
            />
            {presetSearch && (
              <button type="button" onClick={() => setPresetSearch('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary"><X size={12} /></button>
            )}
          </div>
          <button
            type="button"
            onClick={() => { if (pool.length) selectPreset(pool[Math.floor(Math.random() * pool.length)].id); }}
            disabled={pool.length === 0}
            aria-label="Random preset"
            className="w-8 h-8 flex items-center justify-center rounded text-text-secondary hover:text-text-primary hover:bg-bg-card disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            data-tip={pool.length === 0 ? tt('No other presets in this filter', 'Nenhum outro preset neste filtro') : tt('Random preset from this filter', 'Preset aleatório deste filtro')}
          >
            <Dices size={14} />
          </button>
          <label className="relative w-8 h-8 rounded border border-border-default cursor-pointer overflow-hidden shrink-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-solid" data-tip={tt(`Accent · ${currentAccentHex} — click to change`, `Destaque · ${currentAccentHex} — clique para mudar`)}>
            <div className="absolute inset-0" style={{ backgroundColor: currentAccentHex }} />
            <input type="color" value={currentAccentHex} onChange={(e) => setAccentColor(e.target.value)} aria-label="Accent color" className="absolute inset-0 opacity-0 cursor-pointer" />
          </label>
        </div>

        {/* Filter chips */}
        <div className="flex gap-1 mt-2">
          {filterChips.map(chip => {
            const on = presetFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setPresetFilter(chip.id)}
                aria-pressed={on}
                className={`h-6 px-2.5 rounded text-caption font-medium border transition-colors ${
                  on
                    ? 'text-accent border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                    : 'text-text-secondary border-border-default bg-bg-elevated hover:bg-bg-card'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {/* Modified bar */}
        {hasOverrides && (
          <div className="flex items-center gap-2 mt-2 h-8 px-3 rounded text-minor" style={{ background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
            {saveMode ? (
              <input
                ref={saveInputRef}
                type="text"
                value={savePresetName}
                onChange={(e) => setSavePresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doSaveAsPreset();
                  // Contained: unhandled, this Esc bubbled to the shell and closed the whole editor.
                  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSaveMode(false); setSavePresetName(''); }
                }}
                onBlur={() => { if (!savePresetName.trim()) setSaveMode(false); }}
                aria-label="Preset name"
                placeholder="Preset name…"
                className="flex-1 h-6 px-2 text-minor text-text-primary bg-bg-input border border-border-default rounded outline-none focus:border-accent-solid"
              />
            ) : (
              <span className="text-text-secondary truncate">
                {Object.keys(config.colorOverrides).length} color{Object.keys(config.colorOverrides).length === 1 ? '' : 's'} customized on <span className="text-text-primary font-medium">{basePreset.name}</span>
              </span>
            )}
            <span className="flex-1" />
            {saveMode ? (
              <button onClick={doSaveAsPreset} disabled={!savePresetName.trim()} className="text-accent hover:text-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Save</button>
            ) : (
              <button onClick={() => setSaveMode(true)} className="text-text-secondary hover:text-text-primary transition-colors">Save as preset…</button>
            )}
            <button onClick={clearAllOverrides} className="text-text-secondary hover:text-text-primary transition-colors">Reset</button>
            <button type="button" onClick={() => setSurface('customize')} className="inline-flex items-center gap-1 text-accent hover:text-accent-hover transition-colors">Edit <ArrowRight size={12} /></button>
          </div>
        )}

        {/* Card grids */}
        {builtinList.length === 0 && filteredCustom.length === 0 ? (
          // Names the reason instead of always blaming the search box — the filter chips can empty
          // the grid on their own, and "no themes match your search" while the search is empty
          // reads as a bug. English, like every other label: the earlier pt-BR version also
          // interpolated presetFilter, whose values are English tags, so it read "Nenhum tema em
          // dark" — half-translated, which is worse than either language on its own.
          <div className="text-minor text-text-tertiary text-center py-8">
            {presetSearch && presetFilter !== 'all'
              ? `No ${presetFilter} themes match “${presetSearch}”.`
              : presetSearch
                ? `No themes match “${presetSearch}”.`
                : `No ${presetFilter} themes.`}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2.5 mt-3">{builtinList.map(renderCard)}</div>
        )}
        {filteredCustom.length > 0 && (
          <>
            {/* Says WHY your own themes are still here under a filter that cannot classify them,
                instead of leaving the list looking like the filter simply did not apply. */}
            <div className="label-micro text-text-tertiary mt-4 mb-1.5">
              My themes
              {presetFilter !== 'all' && presetFilter !== 'dark' && presetFilter !== 'light' && (
                <span className="ml-1.5 normal-case tracking-normal text-text-disabled">(not categorised)</span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-2.5">{filteredCustom.map(renderCard)}</div>
          </>
        )}
      </div>
    );
  }

  // ══════════════ CUSTOMIZE ══════════════
  function renderCustomize() {
    return (
      <div>
        {/* Local header */}
        <div className="h-9 px-4 flex items-center gap-2.5 border-b border-border-subtle sticky top-0 bg-bg-elevated z-10">
          <button onClick={() => setSurface('gallery')} className="inline-flex items-center gap-1 text-minor text-text-secondary hover:text-text-primary transition-colors">
            <ChevronLeft size={14} /> Themes
          </button>
          <span className="text-minor text-text-secondary truncate">
            {basePreset.name}{hasOverrides ? ` · ${Object.keys(config.colorOverrides).length} edits` : ''}
          </span>
          <div className="ml-auto">
            <SegmentedControl
              options={[{ value: 'colors', label: 'Colors' }, { value: 'interface', label: 'Interface' }]}
              value={custSeg}
              onChange={setCustSeg}
              ariaLabel="Customize section"
            />
          </div>
        </div>
        {custSeg === 'colors' ? renderColorsPanel() : renderInterfacePanel()}
      </div>
    );
  }

  function renderColorsPanel() {
    return (
      <div className="relative">
        {COLOR_SECTIONS.map((section, si) => {
          const collapsed = collapsedSections.has(section.title);
          const modified = section.fields.filter(fieldOverridden).length;
          return (
            <div key={section.title} className={si < COLOR_SECTIONS.length - 1 ? 'border-b border-border-subtle' : ''}>
              <button type="button" onClick={() => toggleSection(section.title)} aria-expanded={!collapsed} className="w-full h-8 px-4 flex items-center gap-2 hover:bg-bg-card/50 transition-colors">
                {collapsed ? <ChevronRight size={12} className="text-text-tertiary shrink-0" /> : <ChevronDown size={12} className="text-text-tertiary shrink-0" />}
                <span className="text-minor font-medium text-text-primary">{section.title}</span>
                {modified > 0 && <span className="text-caption text-accent">· {modified}</span>}
                {collapsed && (
                  <span className="ml-auto flex gap-0.5">
                    {section.fields.map(f => <span key={f.key} className="w-2.5 h-2.5 rounded-sm border border-border-default" style={{ backgroundColor: fieldValue(f) }} />)}
                  </span>
                )}
              </button>
              {!collapsed && (
                <div className={`px-4 pb-2.5 ${section.grid2 ? 'grid grid-cols-2 gap-x-4' : ''}`}>
                  {section.fields.map(f => (
                    <div key={f.key} data-fieldkey={f.key}>
                      <ColorRow
                        label={f.label}
                        value={fieldValue(f)}
                        overridden={fieldOverridden(f)}
                        check={contrastChecks.get(f.key)}
                        hslOpen={openHslKey === f.key}
                        onChange={(hex) => applyColor(f, hex)}
                        onReset={() => resetColor(f)}
                        onToggleHsl={() => setOpenHslKey(prev => (prev === f.key ? null : f.key))}
                        onHover={(h) => setHoverKey(h ? f.key : null)}
                      />
                    </div>
                  ))}
                  {section.accent && (
                    <button onClick={() => setAccentColor(currentAccentHex)} className="mt-1 inline-flex items-center gap-1.5 h-6 px-2 rounded text-caption text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors">
                      <Wand2 size={12} /> Derive solid &amp; hover
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Recent colours — sticky bottom, session-only */}
        {recentColors.length > 0 && (
          <div className="sticky bottom-0 bg-bg-elevated pt-2 mt-1 border-t border-border-subtle px-4 pb-3 flex items-center gap-2">
            <span className="label-micro text-text-tertiary">Recent</span>
            <div className="flex gap-1">
              {recentColors.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleRecentClick(c)}
                  aria-label={openField ? `Apply ${c} to ${openField.label}` : `Copy ${c}`}
                  className="w-4 h-4 rounded border border-border-default flex items-center justify-center"
                  style={{ backgroundColor: c }}
                  data-tip={openField ? tt(`Apply ${c} to ${openField.label}`, `Aplicar ${c} em ${openField.label}`) : copiedRecent === c ? tt(`${c} — copied!`, `${c} — copiado!`) : tt(`${c} — click to copy`, `${c} — clique para copiar`)}
                >
                  {/* The swatch colour is known here, so the tick can be CHOSEN rather than
                      painted white and rescued with a drop shadow — pickInk is the same call
                      that decides the ink on every solid fill in the app. */}
                  {copiedRecent === c && <Check size={9} style={{ color: pickInk(toHex(c)) }} />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderInterfacePanel() {
    const activeDensity = DENSITY_PRESETS.find(p =>
      p.fontSize === config.uiSettings.fontSize && p.rowHeight === config.uiSettings.rowHeight && p.borderRadius === config.uiSettings.borderRadius);
    return (
      <div className="p-4">
        <div className="label-micro text-text-tertiary mb-1.5">Density</div>
        <div className="grid grid-cols-3 gap-2">
          {DENSITY_PRESETS.map(p => {
            const isActive = activeDensity?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => { setUISetting('fontSize', p.fontSize); setUISetting('rowHeight', p.rowHeight); setUISetting('borderRadius', p.borderRadius); }}
                className="flex flex-col items-stretch gap-1.5 px-2 py-2 rounded transition-colors"
                style={isActive ? { background: 'color-mix(in srgb, var(--color-accent) 10%, transparent)' } : undefined}
              >
                <span className={`text-caption font-medium ${isActive ? 'text-accent' : 'text-text-primary'}`}>{p.name}</span>
                <div className="flex flex-col gap-px">
                  {Array.from({ length: p.lines }).map((_, i) => <div key={i} style={{ height: p.lineH }} className="bg-text-disabled/50 rounded-sm" />)}
                </div>
              </button>
            );
          })}
        </div>

        <div className="label-micro text-text-tertiary mt-4 mb-1">Fine-tune</div>
        <SliderSetting label="Font size" value={config.uiSettings.fontSize} min={10} max={18} unit="px" defaultValue={DEFAULT_UI_SETTINGS.fontSize} onChange={(v) => setUISetting('fontSize', v)} />
        <SliderSetting label="Border radius" value={config.uiSettings.borderRadius} min={0} max={16} unit="px" defaultValue={DEFAULT_UI_SETTINGS.borderRadius} onChange={(v) => setUISetting('borderRadius', v)} />
        <SliderSetting label="Row height" value={config.uiSettings.rowHeight} min={28} max={48} unit="px" defaultValue={DEFAULT_UI_SETTINGS.rowHeight} onChange={(v) => setUISetting('rowHeight', v)} />
        <SliderSetting label="Zoom" value={config.uiSettings.zoom} min={50} max={200} unit="%" defaultValue={DEFAULT_UI_SETTINGS.zoom} onChange={(v) => setUISetting('zoom', v)} />

        <div className="label-micro text-text-tertiary mt-4 mb-1">Font</div>
        <div className="flex items-center gap-2 py-0.5">
          <span className="text-minor text-text-secondary w-[100px]">Monospace</span>
          <select
            value={MONO_FONTS.includes(config.uiSettings.fontMono) ? config.uiSettings.fontMono : '__custom'}
            onChange={(e) => { if (e.target.value !== '__custom') setUISetting('fontMono', e.target.value); }}
            aria-label="Monospace font"
            className="flex-1 h-7 px-2 text-minor text-text-primary bg-bg-input border border-border-default rounded outline-none focus:border-accent-solid cursor-pointer"
          >
            {MONO_FONTS.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            {!MONO_FONTS.includes(config.uiSettings.fontMono) && <option value="__custom">{config.uiSettings.fontMono}</option>}
          </select>
          <span className="text-minor font-mono text-text-tertiary truncate w-[80px] text-center" style={{ fontFamily: `'${config.uiSettings.fontMono}', monospace` }}>Abc 123</span>
        </div>

        <div className="label-micro text-text-tertiary mt-4 mb-1">System</div>
        <div className="flex items-center justify-between py-1.5">
          <div className="flex flex-col">
            <span className="text-minor text-text-secondary">Match Windows theme</span>
          </div>
          <Toggle isOn={config.uiSettings.matchSystemTheme} onChange={(v) => setUISetting('matchSystemTheme', v)} ariaLabel="Match Windows theme" />
        </div>
        {config.uiSettings.matchSystemTheme && (
          <div className="ml-3 pl-3 border-l border-border-subtle space-y-1.5 py-1">
            <div className="flex items-center gap-2">
              <span className="text-caption text-text-tertiary w-[100px]">Dark preset</span>
              <select value={config.uiSettings.darkPresetId} onChange={(e) => setUISetting('darkPresetId', e.target.value)} aria-label="Dark preset" className="flex-1 h-6 px-2 text-caption text-text-primary bg-bg-input border border-border-default rounded outline-none focus:border-accent-solid cursor-pointer">
                {themes.filter(t => !getThemeTags(t.id).includes('light')).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-caption text-text-tertiary w-[100px]">Light preset</span>
              <select value={config.uiSettings.lightPresetId} onChange={(e) => setUISetting('lightPresetId', e.target.value)} aria-label="Light preset" className="flex-1 h-6 px-2 text-caption text-text-primary bg-bg-input border border-border-default rounded outline-none focus:border-accent-solid cursor-pointer">
                {themes.filter(t => getThemeTags(t.id).includes('light')).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
        )}
        {/* System follows Windows' "Animation effects" live (prefers-reduced-motion); On / Off pin
            it (D4, 2026-10-16). The line under the label says what System is doing right now. */}
        <div className="flex items-center justify-between gap-3 py-1.5">
          <div className="flex flex-col min-w-0">
            <span className="text-minor text-text-secondary">Animations</span>
            {config.uiSettings.animationMode === 'system' && (
              <span className="text-caption text-text-tertiary">
                {osReducedMotion ? 'Windows has animation effects off' : 'Windows has animation effects on'}
              </span>
            )}
          </div>
          <SegmentedControl
            options={[{ value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
            value={config.uiSettings.animationMode}
            onChange={(v) => setUISetting('animationMode', v)}
            ariaLabel="Animations"
            dense
          />
        </div>
      </div>
    );
  }

  // ══════════════ SHARE ══════════════
  function renderShare() {
    return (
      <div>
        <div className="h-9 px-4 flex items-center gap-2.5 border-b border-border-subtle">
          <button onClick={() => setSurface('gallery')} className="inline-flex items-center gap-1 text-minor text-text-secondary hover:text-text-primary transition-colors">
            <ChevronLeft size={14} /> Themes
          </button>
          <span className="text-minor text-text-secondary">Import / export</span>
        </div>
        <div className="p-4 space-y-5">
          <div>
            <div className="label-micro text-text-tertiary mb-2">Export current theme</div>
            <div className="flex gap-2 items-center">
              <input type="text" value={exportName} onChange={(e) => setExportName(e.target.value)} placeholder="My theme" aria-label="Theme name" className="input-field font-sans w-[240px] px-2.5" />
              <Button variant="secondary" onClick={handleExportFile}><Download size={13} /> Export to file</Button>
              <Button variant="secondary" onClick={handleCopyClipboard}><Clipboard size={13} /> {copyError ? 'Copy failed' : copySuccess ? 'Copied' : 'Copy to clipboard'}</Button>
            </div>
            <p className="mt-2 text-caption text-text-tertiary">One JSON with the base preset, your color overrides and appearance settings.</p>
          </div>
          <div>
            <div className="label-micro text-text-tertiary mb-2">Import a theme</div>
            <div className="flex gap-2 mb-2">
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()}><Upload size={13} /> Import from file</Button>
              <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportFile} className="hidden" />
              <Button variant="secondary" onClick={handlePasteClipboard}><ClipboardPaste size={13} /> Paste from clipboard</Button>
            </div>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste theme JSON here…" aria-label="Theme JSON" className="w-full h-28 px-3 py-2 text-minor font-mono text-text-primary bg-bg-input border border-border-default rounded resize-none outline-none focus:border-accent-solid" />
            {importText && <Button variant="primary" className="mt-2" onClick={() => doImport(importText)}>Apply theme</Button>}
            {/* Always mounted (aria-live): a <p> mounted with the error was never announced. */}
            <FieldError show={!!importError} className="mt-2 text-minor text-recording-fg">{importError}</FieldError>
          </div>
        </div>
      </div>
    );
  }

  // ══════════════ PREVIEW RAIL ══════════════
  function renderRail() {
    const evenBg = 'var(--color-bg-surface)';
    const oddBg = 'color-mix(in srgb, var(--color-text-primary) 1.5%, transparent)';
    const selectedBg = 'color-mix(in srgb, var(--color-accent) 8%, transparent)';
    const structuralBg = 'color-mix(in srgb, var(--color-action-if-fg) 6%, transparent)';
    const inBlockBg = 'color-mix(in srgb, var(--color-action-if-fg) 3%, transparent)';
    const rows: { n: number; pill: string; label: string; delay: string; tone: [string, string]; bg: string; rail?: 'strong' | 'thin'; selected?: boolean }[] = [
      { n: 1, pill: 'LeftClick', label: 'left · 1742,388', delay: '50', tone: ['--color-action-mouse-bg', '--color-action-mouse-fg'], bg: evenBg },
      { n: 2, pill: 'KeyDown', label: 'Ctrl+V', delay: '80', tone: ['--color-action-key-bg', '--color-action-key-fg'], bg: oddBg },
      { n: 3, pill: 'if image', label: 'btn-ok.png', delay: '—', tone: ['--color-action-if-bg', '--color-action-if-fg'], bg: structuralBg, rail: 'strong' },
      { n: 4, pill: 'WaitImage', label: 'btn-ok.png', delay: '120', tone: ['--color-action-waitimage-bg', '--color-action-waitimage-fg'], bg: inBlockBg, rail: 'thin' },
      { n: 5, pill: 'WaitText', label: 'has "Ready"', delay: '60', tone: ['--color-action-waitimage-bg', '--color-action-waitimage-fg'], bg: inBlockBg, rail: 'thin' },
      { n: 6, pill: 'endif', label: '', delay: '—', tone: ['--color-action-if-bg', '--color-action-if-fg'], bg: structuralBg, rail: 'strong' },
      { n: 7, pill: 'SendText', label: '"Hello {date}"', delay: '200', tone: ['--color-action-sendtext-bg', '--color-action-sendtext-fg'], bg: evenBg },
      { n: 8, pill: 'SetVar', label: 'count = {counter}', delay: '—', tone: ['--color-action-setvariable-bg', '--color-action-setvariable-fg'], bg: oddBg },
      { n: 9, pill: 'ScrollDn', label: '×3', delay: '80', tone: ['--color-action-scroll-bg', '--color-action-scroll-fg'], bg: evenBg },
      { n: 10, pill: 'Browser', label: 'button.submit', delay: '100', tone: ['--color-action-browser-bg', '--color-action-browser-fg'], bg: oddBg },
      { n: 11, pill: 'RunProfile', label: 'Sub-flow ×2', delay: '30', tone: ['--color-action-runprofile-bg', '--color-action-runprofile-fg'], bg: selectedBg, selected: true },
      { n: 12, pill: 'Pause', label: 'until F9', delay: '—', tone: ['--color-action-pause-bg', '--color-action-pause-fg'], bg: evenBg },
    ];

    // Type scale, derived from --ui-font-size instead of the old hardcoded 7-10px literals.
    // Those literals were why the Interface tab's Font Size slider changed NOTHING in the
    // preview: you were tuning density blind. Same reason the rows below now use the real
    // --ui-row-height rather than the old `* 0.6` — the preview showed 60 % of the height you
    // were actually setting. Offsets (not ratios) so the small labels keep a readable floor at
    // the 10px end of the slider instead of collapsing to 6px.
    const fsBody = 'var(--ui-font-size)';
    const fsMeta = 'calc(var(--ui-font-size) - 2px)';
    const fsMicro = 'calc(var(--ui-font-size) - 4px)';

    return (
      <div className="bg-bg-base border-l border-border-subtle p-3 select-none overflow-hidden flex flex-col min-h-0 [&_button]:pointer-events-none [&_input]:pointer-events-none">
        <div className="label-micro text-text-tertiary mb-2 shrink-0">Live preview</div>
        {/* flex-1: the mock window fills the rail, so the taller panel shows more real rows
            instead of leaving dead space under a fixed-size mock. */}
        <div className="flex flex-col flex-1 min-h-0 border border-border-default overflow-hidden shadow-overlay" style={{ borderRadius: 'calc(var(--ui-border-radius) + 4px)' }}>
          {/* Title bar */}
          <div className="flex items-center gap-1.5 px-2 h-8 bg-bg-surface border-b border-border-subtle shrink-0" style={ckHover('bg-surface')} {...ckEvents('bg-surface')}>
            <span className="w-4 h-4 rounded bg-accent-solid shrink-0" style={ckHover('accent-solid')} {...ckEvents('accent-solid')} />
            <span className="text-text-secondary" style={{ fontSize: fsMeta }}>TrueReplayer</span>
            <span className="flex-1" />
            <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-full" style={{ fontSize: fsMicro, background: 'var(--color-replay-bg)', color: 'var(--color-replay-fg)' }}>
              <span className="w-1 h-1 rounded-full" style={{ background: 'var(--color-replay)' }} /> Ready
            </span>
            <span className="px-1 py-px rounded font-mono border" style={{ fontSize: fsMicro, background: 'var(--color-hotkey-bg)', color: 'var(--color-hotkey-fg)', borderColor: 'var(--color-hotkey-border)' }}>F8</span>
          </div>
          {/* Toolbar */}
          <div className="flex items-center gap-1.5 px-2 h-8 bg-bg-surface border-b border-border-subtle shrink-0" style={ckHover('bg-surface')} {...ckEvents('bg-surface')}>
            <button className="px-2 py-0.5 text-[color:var(--color-accent-ink)] bg-accent-solid" style={{ fontSize: fsMeta, borderRadius: 'var(--ui-border-radius)', ...ckHover('accent-solid') }} {...ckEvents('accent-solid')}>Save</button>
            <button className="px-2 py-0.5 text-text-secondary bg-bg-elevated border border-border-default" style={{ fontSize: fsMeta, borderRadius: 'var(--ui-border-radius)' }}>Load</button>
          </div>
          {/* Grid header — columns widened to fit real-size type; the old 14/54/30px track set
              was sized for the 8px literals and clips a 13px (let alone 18px) pill. */}
          <div className="grid grid-cols-[20px_76px_1fr_46px] gap-1.5 items-center px-2 py-1 bg-bg-surface border-b border-border-subtle shrink-0" style={{ fontSize: fsMicro }}>
            <span className="font-semibold text-text-tertiary">#</span>
            <span className="font-semibold text-text-tertiary">Type</span>
            <span className="font-semibold text-text-tertiary">Details</span>
            <span className="font-semibold text-text-tertiary text-right">Delay</span>
          </div>
          {/* Rows. flex-1 + overflow-hidden: at a 48px row height the 12 samples no longer fit,
              and clipping them is the honest outcome — pushing the action/status bars out of
              the mock would misrepresent the very chrome the preview exists to show. */}
          <div className="flex flex-col bg-bg-surface flex-1 min-h-0 overflow-hidden">
            {rows.map(row => (
              <div
                key={row.n}
                className="grid grid-cols-[20px_76px_1fr_46px] gap-1.5 items-center px-2 border-b border-border-subtle shrink-0"
                style={{
                  // The REAL row height. Was `* 0.6`, which quietly showed a 34px setting as 20px.
                  height: 'var(--ui-row-height)',
                  background: row.bg,
                  boxShadow: row.selected ? 'inset 2px 0 0 var(--color-accent)'
                    : row.rail ? `inset 2px 0 0 ${row.rail === 'strong' ? 'var(--color-action-if-fg)' : 'color-mix(in srgb, var(--color-action-if-fg) 35%, transparent)'}`
                    : undefined,
                }}
              >
                <span className="font-mono text-text-disabled text-right" style={{ fontSize: fsMicro }}>{row.n}</span>
                <span className="px-1 py-px rounded font-mono text-center truncate border" style={{ fontSize: fsMicro, background: `var(${row.tone[0]})`, color: `var(${row.tone[1]})`, borderColor: `color-mix(in srgb, var(${row.tone[1]}) 30%, transparent)` }}>{row.pill}</span>
                <span className="text-text-secondary truncate" style={{ fontSize: fsBody }}>{row.label}</span>
                <span className={`font-mono tabular-nums text-right ${row.delay === '—' ? 'text-text-disabled' : 'text-text-secondary'}`} style={{ fontSize: fsMicro }}>
                  {row.delay}{row.delay !== '—' && <span className="text-text-tertiary ml-0.5" style={{ fontSize: `calc(var(--ui-font-size) - 5px)` }}>ms</span>}
                </span>
              </div>
            ))}
          </div>
          {/* Text-scale + control sample. Moved OUT of a 104px side column and under the rows:
              at real font size that column clipped every label, and full width is what lets the
              four text levels sit side by side where they can actually be compared. */}
          <div className="bg-bg-card border-t border-border-subtle px-2 py-1.5 flex items-center gap-2 shrink-0" style={ckHover('bg-card')} {...ckEvents('bg-card')}>
            <div className="flex items-baseline gap-2 min-w-0" style={{ fontSize: fsBody }}>
              <span className="text-text-primary">Primary</span>
              <span className="text-text-secondary">Secondary</span>
              <span className="text-text-tertiary">Tertiary</span>
              <span className="text-text-disabled">Disabled</span>
            </div>
            <span className="flex-1" />
            <div className="px-1.5 flex items-center font-mono text-text-primary bg-bg-input border border-accent-solid shrink-0" style={{ fontSize: fsMeta, height: 'calc(var(--ui-row-height) * 0.8)', borderRadius: 'var(--ui-border-radius)' }}>1742, 388</div>
            <button className="px-2 py-0.5 text-[color:var(--color-accent-ink)] bg-accent-solid shrink-0" style={{ fontSize: fsMeta, borderRadius: 'var(--ui-border-radius)' }}>OK</button>
          </div>
          {/* Action bar */}
          <div className="flex items-center gap-1.5 px-2 h-9 bg-bg-surface border-t border-border-subtle shrink-0">
            <button className="px-2 py-0.5 border" style={{ fontSize: fsMeta, borderRadius: 'var(--ui-border-radius)', background: 'var(--color-recording-bg)', color: 'var(--color-recording-fg)', borderColor: 'color-mix(in srgb, var(--color-recording) 30%, transparent)', ...ckHover('recordingColor') }} {...ckEvents('recordingColor')}>● Recording</button>
            <button className="px-2 py-0.5 border" style={{ fontSize: fsMeta, borderRadius: 'var(--ui-border-radius)', background: 'var(--color-replay-bg)', color: 'var(--color-replay-fg)', borderColor: 'color-mix(in srgb, var(--color-replay) 30%, transparent)', ...ckHover('replayColor') }} {...ckEvents('replayColor')}>▶ Replay</button>
            <span className="flex-1" />
            <button className="px-2 py-0.5 border" style={{ fontSize: fsMeta, borderRadius: 'var(--ui-border-radius)', background: 'var(--color-clicker-bg)', color: 'var(--color-clicker-fg)', borderColor: 'var(--color-clicker-border)', ...ckHover('clickerColor') }} {...ckEvents('clickerColor')}>Clicker</button>
          </div>
          {/* Status bar */}
          <div className="flex items-center gap-1 px-2 h-6 bg-bg-base border-t border-border-subtle text-text-tertiary shrink-0" style={{ fontSize: fsMicro }}>
            <span style={{ color: 'var(--color-replay-fg)' }}>Ready</span>
            <span className="flex-1" />
            <span>127 actions</span>
          </div>
        </div>
      </div>
    );
  }
}
