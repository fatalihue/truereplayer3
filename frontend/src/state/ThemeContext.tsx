import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ThemeColors, ThemeConfig, ThemeUISettings, ExportedTheme, CustomThemePreset } from '../themes';
import {
  themes,
  THEME_COLOR_KEYS,
  DEFAULT_UI_SETTINGS,
  DEFAULT_THEME_ID,
  getThemeById,
  loadThemeConfig,
  saveThemeConfig,
  resolveThemeColors,
  applyThemeConfig,
  deriveAccentVariants,
  validateExportedTheme,
  findClosestPreset,
  loadCustomPresets,
  saveCustomPresets,
  makeCustomPresetId,
  CURRENT_THEME_CONFIG_VERSION,
} from '../themes';

interface ThemeContextValue {
  /** Current persisted config */
  config: ThemeConfig;
  /** Base colors merged with overrides */
  resolvedColors: ThemeColors;

  /** User-saved presets (separate from built-in themes) */
  customPresets: CustomThemePreset[];

  /** Pick a preset — clears color overrides, keeps UI settings */
  selectPreset: (id: string) => void;

  /** Put back a whole config captured earlier. Exists for the Theme Editor's Cancel: the editor
   *  is a LIVE preview (every change is applied to the document and persisted within 200 ms), so
   *  there is no draft to throw away — undoing means restoring a snapshot taken on open. */
  replaceConfig: (config: ThemeConfig) => void;

  /** Override a single color key */
  setColorOverride: (key: keyof ThemeColors, value: string) => void;
  /** Remove a single color override (reverts to base) */
  clearColorOverride: (key: keyof ThemeColors) => void;
  /** Remove all color overrides */
  clearAllOverrides: () => void;

  /** Set accent + auto-derive solid/hover */
  setAccentColor: (hex: string) => void;

  /** Update a UI setting (fontSize, borderRadius, rowHeight) */
  setUISetting: <K extends keyof ThemeUISettings>(key: K, value: ThemeUISettings[K]) => void;
  /** Reset all UI settings to defaults */
  resetUISettings: () => void;

  /** Export current resolved theme as JSON object */
  exportTheme: (name: string) => ExportedTheme;
  /** Import a theme — sets closest preset + overrides. Returns false if the theme is invalid (caller should surface an error). */
  importTheme: (theme: ExportedTheme) => boolean;

  /** Save current resolved colors as a named custom preset and switch to it */
  saveAsPreset: (name: string) => void;
  /** Remove a custom preset by id */
  deleteCustomPreset: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ThemeConfig>(loadThemeConfig);
  const [customPresets, setCustomPresets] = useState<CustomThemePreset[]>(loadCustomPresets);

  const resolvedColors = useMemo(() => resolveThemeColors(config, customPresets), [config, customPresets]);

  // Match the OS prefers-color-scheme media query when matchSystemTheme is on.
  // Switches between darkPresetId / lightPresetId, preserving UI settings. Idempotent:
  // a second listener firing with the same preference is a no-op thanks to the
  // baseThemeId equality check inside the setter.
  useEffect(() => {
    if (!config.uiSettings.matchSystemTheme) return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const sync = () => {
      const wantId = mql.matches ? config.uiSettings.lightPresetId : config.uiSettings.darkPresetId;
      setConfig(prev => prev.baseThemeId === wantId
        ? prev
        : { ...prev, baseThemeId: wantId, colorOverrides: {} });
    };
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, [config.uiSettings.matchSystemTheme, config.uiSettings.darkPresetId, config.uiSettings.lightPresetId]);

  // Apply theme to the DOM. Stays SYNCHRONOUS and undebounced — this is the live preview, and it
  // is one cssText write (see applyThemeConfig), so it is not what the split below is about.
  useEffect(() => {
    applyThemeConfig(resolvedColors, config.uiSettings);
  }, [config.uiSettings, resolvedColors]);

  // Persist, and notify C# for native dialog styling — both DEBOUNCED.
  //
  // saveThemeConfig is a JSON.stringify + a synchronous localStorage write, and every Theme Editor
  // slider (the three HSL channels, font size, radius, row height, zoom, and the wheel-over-slider
  // handler) calls setUISetting/setColorOverride on each input tick. Dragging one slider therefore
  // meant ~60-120 blocking writes per second, plus a postMessage across the WebView boundary each
  // time, for a value the user is still in the middle of choosing.
  useEffect(() => {
    const flush = () => {
      saveThemeConfig(config);

      try {
        const webview = (window as any).chrome?.webview;
        if (webview) {
          webview.postMessage({
            type: 'theme:colors',
            payload: {
              bgSurface: resolvedColors['bg-surface'],
              bgCard: resolvedColors['bg-card'],
              textPrimary: resolvedColors['text-primary'],
              textSecondary: resolvedColors['text-secondary'],
              accentSolid: resolvedColors['accent-solid'],
              borderSubtle: resolvedColors['border-subtle'],
            },
          });
        }
      } catch (err) {
        // Usually just "WebView not available" in dev mode, but log so a real push failure to C#
        // isn't completely invisible.
        console.debug('[Theme] push colors to C# failed:', err);
      }
    };

    const timer = setTimeout(flush, 200);
    // A change made less than the debounce before the window goes away must NOT be lost. pagehide
    // is the reliable one in Chromium (beforeunload can be skipped); both are harmless if the
    // timeout already ran, since flush is idempotent.
    const onLeave = () => { clearTimeout(timer); flush(); };
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [config, resolvedColors]);

  const selectPreset = useCallback((id: string) => {
    // Built-in OR custom preset — both are valid targets.
    const isBuiltin = !!getThemeById(id);
    const isCustom = customPresets.some(p => p.id === id);
    if (!isBuiltin && !isCustom) return;
    setConfig(prev => ({
      ...prev,
      baseThemeId: id,
      colorOverrides: {},
      // A manual preset pick is an explicit override — turn off matchSystemTheme so the
      // OS listener doesn't immediately revert the user's choice on the next re-render.
      uiSettings: { ...prev.uiSettings, matchSystemTheme: false },
    }));
  }, [customPresets]);

  const setColorOverride = useCallback((key: keyof ThemeColors, value: string) => {
    setConfig(prev => ({
      ...prev,
      colorOverrides: { ...prev.colorOverrides, [key]: value },
    }));
  }, []);

  const clearColorOverride = useCallback((key: keyof ThemeColors) => {
    setConfig(prev => {
      const next = { ...prev.colorOverrides };
      delete next[key];
      return { ...prev, colorOverrides: next };
    });
  }, []);

  const clearAllOverrides = useCallback(() => {
    setConfig(prev => ({ ...prev, colorOverrides: {} }));
  }, []);

  const setAccentColor = useCallback((hex: string) => {
    const variants = deriveAccentVariants(hex);
    setConfig(prev => ({
      ...prev,
      colorOverrides: {
        ...prev.colorOverrides,
        accent: variants.accent,
        'accent-solid': variants['accent-solid'],
        'accent-hover': variants['accent-hover'],
      },
    }));
  }, []);

  const setUISetting = useCallback(<K extends keyof ThemeUISettings>(key: K, value: ThemeUISettings[K]) => {
    setConfig(prev => ({
      ...prev,
      uiSettings: { ...prev.uiSettings, [key]: value },
    }));
  }, []);

  const resetUISettings = useCallback(() => {
    setConfig(prev => ({
      ...prev,
      uiSettings: { ...DEFAULT_UI_SETTINGS },
    }));
  }, []);

  const exportTheme = useCallback((name: string): ExportedTheme => {
    return {
      name,
      version: 1, // ExportedTheme FILE-FORMAT version (validateExportedTheme checks === 1) — not the ThemeConfig schema version
      colors: resolvedColors,
      uiSettings: { ...config.uiSettings },
    };
  }, [resolvedColors, config.uiSettings]);

  // Persist custom presets whenever the list changes
  useEffect(() => {
    saveCustomPresets(customPresets);
  }, [customPresets]);

  const saveAsPreset = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = makeCustomPresetId(trimmed);
    // Use a 4-color preview that follows the same convention as built-in presets:
    // [base, surface, card, accent] — gives a glanceable feel of the theme.
    const preview: [string, string, string, string] = [
      resolvedColors['bg-base'],
      resolvedColors['bg-surface'],
      resolvedColors['bg-card'],
      resolvedColors.accent,
    ];
    const preset: CustomThemePreset = {
      __custom: true,
      id,
      name: trimmed,
      preview,
      colors: { ...resolvedColors },
    };
    setCustomPresets(prev => {
      // Replace if same id (saving twice with the same name updates instead of duplicating).
      const filtered = prev.filter(p => p.id !== id);
      return [...filtered, preset];
    });
    // Switch to the newly-saved preset — overrides are cleared because the saved
    // colors already capture the user's customizations.
    setConfig(prev => ({
      ...prev,
      baseThemeId: id,
      colorOverrides: {},
      // Saving a preset is a manual pick, same as selectPreset, and has to turn the follower off
      // for the same reason. Leaving it on stores the one inconsistent shape the sync() effect
      // punishes — follower ON while baseThemeId is neither the dark nor the light slot — which
      // then wipes overrides the next time anything re-runs that effect.
      uiSettings: { ...prev.uiSettings, matchSystemTheme: false },
    }));
  }, [resolvedColors]);

  const deleteCustomPreset = useCallback((id: string) => {
    setCustomPresets(prev => prev.filter(p => p.id !== id));
    // If the deleted preset is currently selected, fall back to the default theme.
    setConfig(prev => prev.baseThemeId === id
      ? { ...prev, baseThemeId: DEFAULT_THEME_ID, colorOverrides: {} }
      : prev);
  }, []);

  const replaceConfig = useCallback((next: ThemeConfig) => {
    // The snapshot's baseThemeId can have died while the editor was open — deleting the active
    // custom preset from the gallery moves the app to the default and drops it from storage, so
    // restoring the id verbatim persists an orphan: resolveThemeColors falls through to the
    // default, the header reads the wrong name, and the boot mirror paints the default forever.
    // selectPreset has always validated this; a restore has to as well.
    const idLives = !!getThemeById(next.baseThemeId) || customPresets.some(p => p.id === next.baseThemeId);
    setConfig(prev => ({
      ...next,
      // Carries CURRENT_THEME_CONFIG_VERSION rather than whatever the snapshot held: a snapshot is
      // taken from live state that already ran the migrations, so re-stamping the version keeps a
      // stale literal from re-running them on the next load.
      version: CURRENT_THEME_CONFIG_VERSION,
      baseThemeId: idLives ? next.baseThemeId : prev.baseThemeId,
      uiSettings: {
        ...next.uiSettings,
        // Left OFF, deliberately, and this is the one thing a restore does not put back. Turning
        // the follower back on re-runs the prefers-color-scheme effect, whose sync() writes
        // `colorOverrides: {}` whenever the active preset differs from the dark/light slot — so a
        // Revert that honoured this flag would destroy the very colours it had just restored, and
        // land the user on a third theme they never chose. selectPreset and importTheme force it
        // off for exactly this reason. Losing one checkbox beats losing the whole palette.
        matchSystemTheme: false,
      },
    }));
  }, [customPresets]);

  const importTheme = useCallback((theme: ExportedTheme): boolean => {
    if (!validateExportedTheme(theme)) return false;

    const baseId = findClosestPreset(theme.colors);
    const base = getThemeById(baseId) ?? themes[0];

    // Only store overrides for colors that differ from the base preset
    const overrides: Partial<ThemeColors> = {};
    for (const key of THEME_COLOR_KEYS) {
      if (theme.colors[key] !== base.colors[key]) {
        overrides[key] = theme.colors[key];
      }
    }

    setConfig({
      version: CURRENT_THEME_CONFIG_VERSION, // writing a stale version re-runs migrations on next load
      baseThemeId: baseId,
      colorOverrides: overrides,
      uiSettings: {
        ...DEFAULT_UI_SETTINGS,
        ...theme.uiSettings,
        // An import is an explicit pick, exactly like selectPreset — and it has to turn the OS
        // follower OFF for the same reason, which selectPreset documents and this path used to
        // miss. The effect that follows prefers-color-scheme lists matchSystemTheme among its
        // deps and calls sync() as soon as it runs, and sync() writes `colorOverrides: {}`
        // whenever the active preset differs from the dark/light slot. So importing a file that
        // carries `matchSystemTheme: true` wiped the colours it had just installed, in the same
        // tick. exportTheme copies uiSettings wholesale, so EVERY theme exported by someone who
        // uses "Match Windows theme" was a self-erasing file.
        matchSystemTheme: false,
      },
    });
    return true;
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    config,
    resolvedColors,
    customPresets,
    selectPreset,
    replaceConfig,
    setColorOverride,
    clearColorOverride,
    clearAllOverrides,
    setAccentColor,
    setUISetting,
    resetUISettings,
    exportTheme,
    importTheme,
    saveAsPreset,
    deleteCustomPreset,
  }), [
    config, resolvedColors, customPresets, selectPreset, replaceConfig, setColorOverride,
    clearColorOverride, clearAllOverrides, setAccentColor,
    setUISetting, resetUISettings, exportTheme, importTheme,
    saveAsPreset, deleteCustomPreset,
  ]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
