import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Dices, X } from 'lucide-react';
import { fmtNum, t, tn } from '../../../i18n';
import { useTheme } from '../../../state/ThemeContext';
import { useToast } from '../../../state/ToastContext';
import { ACCENT_SWATCHES, FEATURED_THEMES, getThemeTags, themes, type ThemeTag } from '../../../themePresets';
import {
  contrastRatio, DEFAULT_UI_SETTINGS, hexToHSL, hslToHex, isLightColor, makeCustomPresetId, toHex, UI_COLOR_FIELDS,
  type CustomThemePreset, type ThemeColors, type ThemePreset, type ThemeUISettings,
} from '../../../themes';
import { isModalDialogOpen } from '../../../utils/modalDialog';
import { Segmented, Switch } from '../../inspector/fields';
import { preload, useLoaded } from '../../lazyModule';
import { Menu } from '../../Menu';
import { anchorBelow } from '../../menuAnchor';
import { Preview } from './appearancePreview';
import { baseOf, forgetLast, quietNextChange, record, resetView, showView, step, useAp } from './appearanceStore';
import './appearance.css';

/**
 * Settings › Appearance (phase 3, slices 3 and 4; the concept's SettingsAppearance board): the themes,
 * the accent and the interface, each applied at once and kept by the theme of today (ThemeContext,
 * themes.ts), with the live preview beside them. Edit colors… and Share or import… are views of the
 * page, in the theme editor's chunk. Ctrl+Z and Ctrl+Y undo and redo here (D22). It comes in its
 * own chunk, with the 37 presets.
 */
const loadThemeEditor = () => import('./themeEditor');
const warmEditor = () => { void preload(loadThemeEditor); };

export function AppearancePanel() {
  const view = useAp(s => s.view);
  const editor = useLoaded(loadThemeEditor);
  useUndo();
  // The editor's chunk comes once the page has nothing to do; a view asked for before it is in waits
  // for it. The page left, the view and what the pointer was on go with it.
  useEffect(() => {
    const id = requestIdleCallback(warmEditor, { timeout: 2000 });
    return () => {
      cancelIdleCallback(id);
      resetView();
    };
  }, []);
  useEffect(() => { if (view !== 'main' && !editor) warmEditor(); }, [view, editor]);
  return (
    <div className="ap-wrap">
      <div className="ap">
        {view === 'main' && (
          <>
            <ThemeSection />
            <AccentSection />
            <InterfaceSection />
            <Actions />
          </>
        )}
        {view === 'colors' && editor && <editor.ColorsView />}
        {view === 'share' && editor && <editor.ShareView />}
      </div>
      <Preview />
    </div>
  );
}

/**
 * The page's history (D22: Appearance applies at once, with Ctrl+Z; the Revert of today's editor
 * goes): every theme the page sees, a change after a pause a step. Ctrl+Z, and Ctrl+Y
 * or Ctrl+Shift+Z, while the page is on screen; a text field keeps its own.
 */
function useUndo() {
  const { config, restoreConfig } = useTheme();
  useEffect(() => { record({ config }); }, [config]);
  useEffect(() => forgetLast, []);
  const latest = useRef({ config, restoreConfig });
  useEffect(() => { latest.current = { config, restoreConfig }; });
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || el.tagName === 'TEXTAREA'
        || (el.tagName === 'INPUT' && !['range', 'color', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)));
      if (typing || isModalDialogOpen()) return;
      e.preventDefault();
      const now = latest.current;
      const to = step(key === 'z' && !e.shiftKey, { config: now.config });
      if (!to) return;
      now.restoreConfig(to.config);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// ── Theme ──

type Filter = 'all' | ThemeTag;
const FILTERS: Filter[] = ['all', 'dark', 'light', 'vivid', 'pastel', 'monochrome'];
// The chips but the first, which says how many themes there are.
const FILTER_NAMES = tn('appearance.theme.filters');
// The featured eight first, then the rest in the presets' order (by accent hue).
const ORDER: ThemePreset[] = [
  ...FEATURED_THEMES.flatMap(id => themes.filter(theme => theme.id === id)),
  ...themes.filter(theme => !FEATURED_THEMES.includes(theme.id)),
];

/** The gallery with nothing to show: a sentence for each filter, with the search or without it. */
function emptyText(filter: Filter, query: string): string {
  if (!query) return tn('appearance.theme.none')[filter];
  switch (filter) {
    case 'dark': return t('appearance.theme.noMatch.dark', { query });
    case 'light': return t('appearance.theme.noMatch.light', { query });
    case 'vivid': return t('appearance.theme.noMatch.vivid', { query });
    case 'pastel': return t('appearance.theme.noMatch.pastel', { query });
    case 'monochrome': return t('appearance.theme.noMatch.monochrome', { query });
    default: return t('appearance.theme.noMatch.all', { query });
  }
}

// Two rows of four until "Show all".
const FIRST = 8;
// Outside the component: the compiler leaves a component that calls Math.random uncompiled.
const anyOf = <T,>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

function ThemeSection() {
  const { showToast } = useToast();
  const { config, customPresets, selectPreset, deleteCustomPreset, restoreCustomPreset } = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const active = config.baseThemeId;
  const q = query.trim().toLowerCase();
  const named = (name: string) => !q || name.toLowerCase().includes(q);

  const builtin = ORDER.filter(theme => (filter === 'all' || getThemeTags(theme.id).includes(filter)) && named(theme.name));
  // Folded: the first two rows, with the open theme in them.
  const folded = filter === 'all' && !q && !all;
  let shown = builtin;
  if (folded) {
    shown = builtin.slice(0, FIRST);
    const open = builtin.find(theme => theme.id === active);
    if (open && !shown.includes(open)) shown = [...shown.slice(0, FIRST - 1), open];
  }
  // Your own themes: Dark and Light by their background; Vivid, Pastel and Monochrome cannot be
  // told from the colours, so they show under those as not categorised (as today).
  const own = customPresets.filter(p => {
    if (!named(p.name)) return false;
    if (filter !== 'dark' && filter !== 'light') return true;
    const light = isLightColor(p.colors['bg-base']);
    return light === null || light === (filter === 'light');
  });
  const uncategorised = filter === 'vivid' || filter === 'pastel' || filter === 'monochrome';
  const pool = builtin.filter(theme => theme.id !== active);

  // Picking the theme already open changes nothing: its accent and colours stay (Theme default and,
  // in slice 4, Reset to it are the ways back).
  const pick = (id: string) => { if (id !== active) selectPreset(id); };

  // The ✕ deletes at once; the toast's Undo puts it back where it was, open again if it was.
  const remove = (preset: CustomThemePreset) => {
    const index = customPresets.findIndex(p => p.id === preset.id);
    if (index < 0) return;
    const before = config;
    // Not a step of the page's history: the toast's Undo is this one's.
    quietNextChange();
    deleteCustomPreset(preset.id);
    showToast(t('appearance.theme.deleted', { name: preset.name }), {
      type: 'success',
      duration: 10000,
      action: { label: t('common.actions.undo'), onClick: () => { quietNextChange(); restoreCustomPreset(preset, index, before); } },
    });
    // Its ✕ went with it: the focus goes to the open theme, or to the search.
    requestAnimationFrame(() => {
      const root = sectionRef.current;
      (root?.querySelector<HTMLElement>('.ap-card[aria-pressed="true"]') ?? root?.querySelector<HTMLElement>('.ap-search'))?.focus();
    });
  };

  return (
    <section ref={sectionRef} className="ap-section" aria-labelledby="ap-theme">
      <h3 id="ap-theme" className="ap-title">{t('appearance.theme.title')}</h3>
      <FollowWindows />
      <div className="ap-filters">
        <div className="ap-chips" role="group" aria-label={t('appearance.theme.filterGroup')}>
          {FILTERS.map(f => (
            <button key={f} type="button" className="ap-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? t('appearance.theme.all', { n: fmtNum(themes.length) }) : FILTER_NAMES[f]}
            </button>
          ))}
        </div>
        <span className="ap-spacer" />
        <button
          type="button"
          className="insp-icon-button ap-random"
          aria-label={t('appearance.theme.random')}
          disabled={pool.length === 0}
          data-tip={pool.length === 0 ? t('appearance.theme.randomNone') : t('appearance.theme.randomTip')}
          onClick={() => selectPreset(anyOf(pool).id)}
        >
          <Dices aria-hidden="true" />
        </button>
        <input
          className="ap-search"
          type="search"
          aria-label={t('appearance.theme.search')}
          placeholder={t('appearance.theme.search')}
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
      </div>
      {shown.length === 0 && own.length === 0 ? (
        <p className="set-empty" role="status">
          {emptyText(filter, query.trim())}
        </p>
      ) : (
        <>
          {shown.length > 0 && (
            <div className="ap-grid">
              {shown.map(theme => <ThemeCard key={theme.id} theme={theme} active={theme.id === active} onPick={() => pick(theme.id)} />)}
            </div>
          )}
          {filter === 'all' && !q && (
            <button type="button" className="set-link ap-more" aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? t('appearance.theme.showFewer') : t('appearance.theme.showAll', { n: fmtNum(themes.length) })}
            </button>
          )}
          {own.length > 0 && (
            <>
              <h4 className="ap-subtitle">
                {t('appearance.theme.myThemes')}
                {uncategorised && <span className="ap-subtitle-note"> {t('appearance.theme.uncategorised')}</span>}
              </h4>
              <div className="ap-grid">
                {own.map(p => <ThemeCard key={p.id} theme={p} active={p.id === active} onPick={() => pick(p.id)} onDelete={() => remove(p)} />)}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * A theme: its colours in a small window, and its name; the open one is marked. Your own have a ✕.
 * Under the pointer or the focus, the live preview paints it. The name is a name, the same in every
 * language (data-glossary), the presets' and the ones you made alike.
 */
function ThemeCard({ theme, active, onPick, onDelete }: { theme: ThemePreset; active: boolean; onPick: () => void; onDelete?: () => void }) {
  const [base, surface, card, accent] = theme.preview;
  const colors = { '--p-base': base, '--p-surface': surface, '--p-card': card, '--p-accent': accent } as CSSProperties;
  const show = () => useAp.setState({ hoverTheme: theme.id });
  const hide = () => useAp.setState(s => (s.hoverTheme === theme.id ? { hoverTheme: null } : s));
  return (
    <div className="ap-card-slot" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}>
      <button type="button" className="ap-card" aria-pressed={active} onClick={onPick}>
        <span className="ap-card-preview" style={colors} aria-hidden="true">
          <span className="ap-p-side" />
          <span className="ap-p-bar" />
          <span className="ap-p-accent" />
          <span className="ap-p-line" />
        </span>
        <span className="ap-card-name">
          <span className="ap-card-text" data-glossary="">{theme.name}</span>
          {active && <Check aria-hidden="true" />}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          className="ap-card-delete"
          aria-label={t('appearance.theme.deleteTheme', { name: theme.name })}
          data-tip={t('appearance.theme.deleteTip')}
          onClick={onDelete}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Follow Windows light and dark (settings-193 to 195): a theme for each, shown while it is on. */
function FollowWindows() {
  const { config, setUISetting } = useTheme();
  const on = config.uiSettings.matchSystemTheme;
  return (
    <div className="ap-follow">
      {/* The text is the switch's label: a press on it presses the switch. */}
      <label className="ap-follow-switch">
        <Switch label={t('appearance.follow.label')} checked={on} onChange={(v) => setUISetting('matchSystemTheme', v)} />
        <span>{t('appearance.follow.label')}</span>
      </label>
      {on && <ThemeForWindows kind="dark" />}
      {on && <ThemeForWindows kind="light" />}
    </div>
  );
}

function ThemeForWindows({ kind }: { kind: 'dark' | 'light' }) {
  const { config, setUISetting } = useTheme();
  const [menu, setMenu] = useState<HTMLButtonElement | null>(null);
  const key = kind === 'dark' ? 'darkPresetId' : 'lightPresetId';
  const id = config.uiSettings[key];
  const name = themes.find(theme => theme.id === id)?.name ?? id;
  const list = themes.filter(theme => getThemeTags(theme.id).includes('light') === (kind === 'light'));
  const dark = kind === 'dark';
  return (
    <span className="ap-pick">
      <span className="ap-pick-label" aria-hidden="true">{dark ? t('appearance.follow.dark') : t('appearance.follow.light')}</span>
      <button
        type="button"
        className="insp-button set-choice"
        aria-label={dark ? t('appearance.follow.darkChoice', { name }) : t('appearance.follow.lightChoice', { name })}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <span className="set-choice-label" data-glossary="">{name}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {menu && (
        <Menu
          anchor={anchorBelow(menu, 'start')}
          label={dark ? t('appearance.follow.darkTheme') : t('appearance.follow.lightTheme')}
          toggle={menu}
          focusFirst
          entries={list.map(theme => ({ label: theme.name, named: true, checked: theme.id === id, onSelect: () => setUISetting(key, theme.id) }))}
          onClose={() => setMenu(null)}
        />
      )}
    </span>
  );
}

// ── Accent ──

type Hue = 'white' | 'black' | 'gray' | 'red' | 'orange' | 'yellow' | 'lime' | 'green' | 'teal' | 'cyan' | 'blue' | 'violet' | 'purple' | 'pink';

/** A colour's name, for the theme's own accent ("Theme default, blue"): its key in the catalog's hues. */
function hueName(color: string): Hue {
  const { h, s, l } = hexToHSL(toHex(color));
  if (s < 12) return l > 70 ? 'white' : l < 25 ? 'black' : 'gray';
  const names: [number, Hue][] = [
    [15, 'red'], [40, 'orange'], [65, 'yellow'], [90, 'lime'], [155, 'green'], [185, 'teal'],
    [200, 'cyan'], [245, 'blue'], [275, 'violet'], [320, 'purple'], [345, 'pink'], [361, 'red'],
  ];
  return names.find(([below]) => h < below)?.[1] ?? 'red';
}

// The six swatches' names (ACCENT_SWATCHES keeps them in English, as their ids), as the page says them.
const SWATCH_NAMES: Record<string, string> = {
  Periwinkle: t('appearance.accent.swatches.periwinkle'),
  Teal: t('appearance.accent.swatches.teal'),
  Violet: t('appearance.accent.swatches.violet'),
  Amber: t('appearance.accent.swatches.amber'),
  Lime: t('appearance.accent.swatches.lime'),
  Red: t('appearance.accent.swatches.red'),
};

/**
 * A swatch as it reads on this theme: lighter on a dark one, darker on a light one, hue and saturation
 * kept, until it reaches 4.5:1 on the four surfaces (the accent is text: a selected category, a
 * link); the best it gets when nothing does. Mixing it toward the theme's text instead, as the step
 * colours do, turned Amber grey on the light themes, where the raw swatches read at 1.0 to 2.9:1.
 */
function adaptAccent(hex: string, colors: ThemeColors): string {
  const surfaces = [colors['bg-surface'], colors['bg-card'], colors['bg-elevated'], colors['bg-base']];
  const worst = (c: string) => Math.min(...surfaces.map(s => contrastRatio(c, s)));
  let best = hex;
  let bestWorst = worst(hex);
  if (bestWorst >= 4.5) return hex;
  const { h, s, l } = hexToHSL(hex);
  const step = isLightColor(colors['bg-base']) ? -1 : 1;
  for (let n = 1; n <= 100; n++) {
    const lightness = l + step * n;
    if (lightness < 0 || lightness > 100) break;
    const c = hslToHex(h, s, lightness);
    const w = worst(c);
    if (w > bestWorst) { best = c; bestWorst = w; }
    if (w >= 4.5) return c;
  }
  return best;
}

// The swatches as they read on a theme, by its surfaces: the page draws again on every theme change,
// a slider's step included, and the colours they read on rarely change.
const adapted = new Map<string, string[]>();
function swatchesFor(colors: ThemeColors): string[] {
  const key = [colors['bg-surface'], colors['bg-card'], colors['bg-elevated'], colors['bg-base']].join('|');
  let hit = adapted.get(key);
  if (!hit) {
    hit = ACCENT_SWATCHES.map(s => adaptAccent(s.hex, colors));
    if (adapted.size >= 64) adapted.clear();
    adapted.set(key, hit);
  }
  return hit;
}

/**
 * Accent (settings-149): the theme's own, six more as they read on it, and Custom… (any colour, as
 * today's picker). Solid and Hover come from it. A radio group: ← → ↑ ↓ Home End pick as they move.
 */
function AccentSection() {
  const { config, resolvedColors, customPresets, setAccentColor, clearColorOverride } = useTheme();
  const base = baseOf(config.baseThemeId, customPresets);
  const values = swatchesFor(resolvedColors);
  const options = [
    { id: 'default', label: t('appearance.accent.themeDefault', { color: tn('appearance.accent.hues')[hueName(base.colors.accent)] }), color: base.colors.accent },
    ...ACCENT_SWATCHES.map((s, i) => ({ id: s.name, label: SWATCH_NAMES[s.name] ?? s.name, color: values[i] })),
  ];
  const override = config.colorOverrides.accent;
  const picked = override === undefined ? 'default' : options.find(o => o.id !== 'default' && o.color.toLowerCase() === override.toLowerCase())?.id ?? 'custom';

  const choose = (id: string) => {
    if (id === 'default') {
      clearColorOverride('accent');
      clearColorOverride('accent-solid');
      clearColorOverride('accent-hover');
      return;
    }
    const option = options.find(o => o.id === id);
    if (option) setAccentColor(option.color);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const at = Math.max(0, options.findIndex(o => o.id === picked));
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? options.length - 1
      : (at + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    choose(options[next].id);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <section className="ap-section" aria-labelledby="ap-accent">
      <h3 id="ap-accent" className="ap-title">{t('appearance.accent.title')}</h3>
      <div className="ap-accent">
        <div className="ap-swatches" role="radiogroup" aria-label={t('appearance.accent.group')} onKeyDown={onKeyDown}>
          {options.map((o, i) => {
            const checked = picked === o.id;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                className="ap-swatch"
                aria-checked={checked}
                aria-label={o.label}
                // One stop for the group: the picked one, or the first when the colour is your own.
                tabIndex={checked || (picked === 'custom' && i === 0) ? 0 : -1}
                style={{ '--swatch': o.color } as CSSProperties}
                data-tip={`${o.label} · ${toHex(o.color)}`}
                onClick={() => { if (!checked) choose(o.id); }}
              />
            );
          })}
        </div>
        <label
          className="ap-custom"
          data-active={picked === 'custom' || undefined}
          data-tip={t('appearance.accent.customTip', { hex: toHex(resolvedColors.accent) })}
        >
          {picked === 'custom' && <span className="ap-custom-dot" style={{ '--swatch': resolvedColors.accent } as CSSProperties} aria-hidden="true" />}
          {t('appearance.accent.custom')}
          <input
            type="color"
            className="ap-custom-input"
            aria-label={picked === 'custom' ? t('appearance.accent.customColorValue', { hex: toHex(resolvedColors.accent) }) : t('appearance.accent.customColor')}
            value={toHex(resolvedColors.accent)}
            onChange={(e) => setAccentColor(e.target.value)}
          />
        </label>
      </div>
    </section>
  );
}

// ── Interface ──

const DENSITY = [
  { id: 'compact', label: t('appearance.interface.densities.compact'), fontSize: 12, rowHeight: 28, borderRadius: 2 },
  { id: 'normal', label: t('appearance.interface.densities.normal'), fontSize: 13, rowHeight: 34, borderRadius: 3 },
  { id: 'spacious', label: t('appearance.interface.densities.spacious'), fontSize: 14, rowHeight: 42, borderRadius: 4 },
] as const;
type Density = typeof DENSITY[number]['id'] | '';
const ZOOMS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];
const MONO_FONTS = ['Cascadia Mono', 'Cascadia Code', 'Consolas', 'Courier New', 'Lucida Console'];

/** Interface (settings-184 to 198): density, motion, text size, corners, zoom and the font for data. */
function InterfaceSection() {
  const { config, setUISetting, osReducedMotion } = useTheme();
  const ui = config.uiSettings;
  const density: Density = DENSITY.find(d => d.fontSize === ui.fontSize && d.rowHeight === ui.rowHeight && d.borderRadius === ui.borderRadius)?.id ?? '';
  return (
    <section className="ap-section" aria-labelledby="ap-interface">
      <h3 id="ap-interface" className="ap-title">{t('appearance.interface.title')}</h3>
      <div className="ap-ui">
        <div className="ap-field">
          <span className="ap-field-label" aria-hidden="true">{t('appearance.interface.density')}</span>
          <Segmented<Density>
            label={t('appearance.interface.density')}
            value={density}
            options={DENSITY.map(d => ({ value: d.id, label: d.label }))}
            onChange={(id) => {
              const d = DENSITY.find(x => x.id === id);
              if (!d) return;
              setUISetting('fontSize', d.fontSize);
              setUISetting('rowHeight', d.rowHeight);
              setUISetting('borderRadius', d.borderRadius);
            }}
          />
        </div>
        <div className="ap-field">
          <span className="ap-field-label" aria-hidden="true">{t('appearance.interface.motion')}</span>
          <Segmented
            label={t('appearance.interface.motion')}
            value={ui.animationMode}
            options={[
              { value: 'system', label: t('appearance.interface.motions.system') },
              { value: 'on', label: t('appearance.interface.motions.on') },
              { value: 'off', label: t('appearance.interface.motions.off') },
            ]}
            onChange={(mode) => setUISetting('animationMode', mode)}
          />
          {ui.animationMode === 'system' && (
            <span className="ap-field-hint">{osReducedMotion ? t('appearance.interface.motionOff') : t('appearance.interface.motionOn')}</span>
          )}
        </div>
        <Slider label={t('appearance.interface.textSize')} value={ui.fontSize} min={10} max={18} onChange={(v) => setUISetting('fontSize', v)} />
        <Slider label={t('appearance.interface.corners')} value={ui.borderRadius} min={0} max={16} onChange={(v) => setUISetting('borderRadius', v)} />
        <ZoomField />
        <FontField />
      </div>
    </section>
  );
}

/** A number on a slider, in px; the wheel over it moves it by 1 without scrolling the page (settings-191). */
function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, onChange });
  useEffect(() => { latest.current = { value, onChange }; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { value: now, onChange: change } = latest.current;
      const next = Math.min(max, Math.max(min, now + (e.deltaY < 0 ? 1 : -1)));
      if (next !== now) change(next);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [min, max]);
  return (
    <div ref={ref} className="ap-field">
      <span className="ap-field-label">
        <label htmlFor={id}>{label}</label>
        <span className="ap-field-value" aria-hidden="true">{value} px</span>
      </span>
      <input
        id={id}
        type="range"
        className="ap-range"
        min={min}
        max={max}
        value={value}
        aria-valuetext={`${value} px`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function ZoomField() {
  const { config, setUISetting } = useTheme();
  const [menu, setMenu] = useState<HTMLButtonElement | null>(null);
  const zoom = config.uiSettings.zoom;
  // A zoom off the steps (an imported theme, today's slider) stays, at its place among them.
  const steps = ZOOMS.includes(zoom) ? ZOOMS : [...ZOOMS, zoom].sort((a, b) => a - b);
  return (
    <div className="ap-field ap-field-row">
      <span className="ap-field-label" aria-hidden="true">{t('appearance.interface.zoom')}</span>
      <button
        type="button"
        className="insp-button set-choice ap-choice"
        aria-label={t('appearance.interface.zoomChoice', { zoom })}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <span className="set-choice-label">{zoom}%</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {menu && (
        <Menu
          anchor={anchorBelow(menu, 'end')}
          label={t('appearance.interface.zoom')}
          toggle={menu}
          focusFirst
          entries={steps.map(z => ({
            label: z === DEFAULT_UI_SETTINGS.zoom ? t('appearance.interface.zoomDefault', { zoom: z }) : `${z}%`,
            checked: z === zoom,
            onSelect: () => setUISetting('zoom', z),
          }))}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function FontField() {
  const { config, setUISetting } = useTheme();
  const [menu, setMenu] = useState<HTMLButtonElement | null>(null);
  const font = config.uiSettings.fontMono;
  // A font of an imported theme stays, after the five.
  const fonts = MONO_FONTS.includes(font) ? MONO_FONTS : [...MONO_FONTS, font];
  return (
    <div className="ap-field ap-field-row">
      <span className="ap-field-label" aria-hidden="true">{t('appearance.interface.font')}</span>
      <button
        type="button"
        className="insp-button set-choice ap-choice"
        aria-label={t('appearance.interface.fontChoice', { font })}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        style={{ fontFamily: `'${font}', monospace` }}
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <span className="set-choice-label" data-glossary="">{font}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {menu && (
        <Menu
          anchor={anchorBelow(menu, 'end')}
          label={t('appearance.interface.font')}
          toggle={menu}
          focusFirst
          entries={fonts.map(f => ({ label: f, font: f, named: true, checked: f === font, onSelect: () => setUISetting('fontMono', f) }))}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

// ── The page's actions ──

// The interface colours at their defaults: the step colours and Recording, Replay and Clicker.
const COLOR_DEFAULTS = Object.fromEntries(UI_COLOR_FIELDS.map(f => [f, DEFAULT_UI_SETTINGS[f]])) as Partial<ThemeUISettings>;

/**
 * The page's actions, as in the concept: Edit colors… and Share or import… (views of the page, in the
 * theme editor's chunk, which the pointer or the focus on them brings sooner), Save as my theme…
 * (settings-160 to 162: the colours as they are now become a theme of your own, which opens; the
 * same name updates it, a name that would take another's place is refused) and Reset to the theme
 * (settings-142 to 144, D22: its colours, or with the interface too; the language left it, D30).
 */
function Actions() {
  const { showToast } = useToast();
  const { config, customPresets, saveAsPreset, restoreConfig } = useTheme();
  const base = baseOf(config.baseThemeId, customPresets);
  const changed = Object.keys(config.colorOverrides).length > 0;
  const colorsChanged = changed || UI_COLOR_FIELDS.some(f => config.uiSettings[f] !== DEFAULT_UI_SETTINGS[f]);
  const asItComes = !colorsChanged
    && (Object.keys(DEFAULT_UI_SETTINGS) as (keyof ThemeUISettings)[]).every(k => config.uiSettings[k] === DEFAULT_UI_SETTINGS[k]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [resetMenu, setResetMenu] = useState<HTMLButtonElement | null>(null);
  const savedRef = useRef<HTMLParagraphElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const wasNaming = useRef(false);
  // Closed without saving, the focus goes back to the button; saved, to what was saved.
  useEffect(() => {
    if (wasNaming.current && !naming) (saved ? savedRef.current : openRef.current)?.focus();
    wasNaming.current = naming;
  }, [naming, saved]);
  // Back from a view, the focus is on the button that opened it.
  useEffect(() => {
    const from = useAp.getState().cameFrom;
    if (!from) return;
    useAp.setState({ cameFrom: null });
    (from === 'colors' ? editRef.current : shareRef.current)?.focus();
  }, []);
  // The line says it for 6 s, then goes quiet but keeps its place: gone, the page would shrink under
  // the pointer (and shut a menu open on it), and the focus on the line would fall to the page.
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(''), 6000);
    return () => clearTimeout(id);
  }, [saved]);

  const close = () => { setNaming(false); setName(''); };
  const save = () => {
    const n = name.trim();
    if (!n) return;
    // The id is the name's slug, and a theme with the same id is replaced: two names can slug alike.
    const clash = customPresets.find(p => p.id === makeCustomPresetId(n) && p.name !== n);
    if (clash) {
      showToast(t('appearance.actions.clash', { name: n, other: clash.name }), 'error');
      return;
    }
    saveAsPreset(n);
    setSaved(n);
    close();
  };
  // Back to the theme as it comes, with the toast's Undo (Ctrl+Z too: it is a step like any other).
  const reset = (everything: boolean) => {
    const before = config;
    restoreConfig(everything
      ? { ...config, colorOverrides: {}, uiSettings: { ...DEFAULT_UI_SETTINGS } }
      : { ...config, colorOverrides: {}, uiSettings: { ...config.uiSettings, ...COLOR_DEFAULTS } });
    showToast(t('appearance.actions.resetDone', { name: base.name }), {
      type: 'success',
      duration: 10000,
      action: { label: t('common.actions.undo'), onClick: () => restoreConfig(before) },
    });
  };

  return (
    <div className="ap-actions">
      <button ref={editRef} type="button" className="insp-button" onPointerEnter={warmEditor} onFocus={warmEditor} onClick={() => showView('colors')}>
        {t('appearance.actions.editColors')}
      </button>
      {naming ? (
        <span className="ap-naming">
          <input
            className="ap-name"
            type="text"
            aria-label={t('appearance.actions.name')}
            placeholder={t('appearance.actions.namePlaceholder')}
            spellCheck={false}
            maxLength={60}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); save(); }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
            }}
            onBlur={(e) => {
              // Left empty, it closes; a press on Save or Cancel is theirs.
              if (!name.trim() && !e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) close();
            }}
          />
          <button type="button" className="insp-button" data-variant="primary" disabled={!name.trim()} onClick={save}>{t('common.actions.save')}</button>
          <button type="button" className="insp-button" onClick={close}>{t('common.actions.cancel')}</button>
        </span>
      ) : (
        <button
          ref={openRef}
          type="button"
          className="insp-button"
          disabled={!changed}
          data-tip={changed ? undefined : t('appearance.actions.saveAsTip', { name: base.name })}
          onClick={() => { setSaved(null); setNaming(true); }}
        >
          {t('appearance.actions.saveAs')}
        </button>
      )}
      <button ref={shareRef} type="button" className="insp-button" onPointerEnter={warmEditor} onFocus={warmEditor} onClick={() => showView('share')}>
        {t('appearance.actions.share')}
      </button>
      <button
        type="button"
        className="ap-reset"
        aria-haspopup="menu"
        aria-expanded={!!resetMenu}
        disabled={asItComes}
        data-tip={asItComes ? t('appearance.actions.asItComes', { name: base.name }) : undefined}
        onClick={(e) => setResetMenu(resetMenu ? null : e.currentTarget)}
      >
        {t('appearance.actions.reset', { name: base.name })}
        <ChevronDown aria-hidden="true" />
      </button>
      {resetMenu && (
        <Menu
          anchor={anchorBelow(resetMenu, 'start')}
          label={t('appearance.actions.reset', { name: base.name })}
          toggle={resetMenu}
          focusFirst
          entries={[
            { label: t('appearance.actions.resetColors'), disabled: !colorsChanged, onSelect: () => reset(false) },
            { label: t('appearance.actions.resetAll'), onSelect: () => reset(true) },
          ]}
          onClose={() => setResetMenu(null)}
        />
      )}
      {saved !== null && (
        <p ref={savedRef} className="ap-saved" role="status" tabIndex={-1}>
          {saved && t('appearance.actions.saved', { name: saved })}
        </p>
      )}
    </div>
  );
}
