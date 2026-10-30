import { useMemo } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { useGetAppState } from '../state/AppStateContext';
import type { ClickerPreset, ClickerPresetFields, SettingsState } from '../bridge/messageTypes';

/** Every Clicker setting: the cursorClick* fields, the same set a preset snapshots. */
export type ClickerSettingKey = keyof ClickerPresetFields;

/**
 * The three "where the click lands" modes. They all write the same axis, so only one may be on —
 * the engine enforces it in three places, and turning one on here turns the other two off, so the
 * screen never shows two lit.
 */
export const CLICKER_TARGET_KEYS = ['cursorClickUsePositionJitter', 'cursorClickUseArea', 'cursorClickUseFixed'] as const;
export type ClickerTargetKey = typeof CLICKER_TARGET_KEYS[number];

export const PRESET_KEYS: ClickerSettingKey[] = [
  'cursorClickButton', 'cursorClickDelay', 'cursorClickDelayJitter', 'cursorClickUseJitter', 'cursorClickHold',
  'cursorClickPositionJitter', 'cursorClickUsePositionJitter', 'cursorClickUseArea', 'cursorClickArea',
  'cursorClickUseFixed', 'cursorClickFixedPoint', 'cursorClickLoops', 'cursorClickUseLoops',
  'cursorClickInterval', 'cursorClickUseInterval', 'cursorClickMaxDuration', 'cursorClickUseMaxDuration',
  'cursorClickGameMove',
];

/**
 * The preset that MATCHES the current settings field by field, or null ("Custom"). There is no
 * "active" flag to keep in sync on either side: editing any knob visibly leaves the preset.
 * The bridge omits null-valued keys, so a cleared area/point arrives as `undefined` on one side
 * and `null` on the other — normalised before comparing.
 */
export function matchingPreset(settings: SettingsState): ClickerPreset | null {
  const presets = settings.cursorClickPresets ?? [];
  return presets.find((p) => PRESET_KEYS.every((k) => JSON.stringify(p[k] ?? null) === JSON.stringify(settings[k] ?? null))) ?? null;
}

/**
 * The Clicker, as commands: its settings, the target modes, the pickers, the presets and the
 * pause. Everything Clicker is global (not per macro). Starting and resuming go through useReplay —
 * the same Replay button and the same Resume.
 */
export function useClicker() {
  const { send } = useBridge();
  const getState = useGetAppState();
  return useMemo(() => {
    const set = (key: ClickerSettingKey, value: string | boolean | number | object | null) =>
      send({ type: 'settings:change', payload: { key, value } });
    const setTargetMode = (key: ClickerTargetKey, enable: boolean) => {
      set(key, enable);
      if (enable) CLICKER_TARGET_KEYS.forEach((k) => { if (k !== key) set(k, false); });
    };
    const pickArea = () => send({ type: 'clicker:configureArea', payload: {} });
    return {
      /**
       * Macro or Clicker. A no-op when already there; the engine stops a live run before it flips
       * (SetCursorClickMode).
       */
      setMode: (clicker: boolean) => {
        if (clicker === getState().settings.useCursorClick) return;
        send({ type: 'settings:change', payload: { key: 'useCursorClick', value: clicker } });
      },
      set,
      setTargetMode,
      /** Opens the box picker on screen. A successful draw arms Area and disarms the other two. */
      pickArea,
      /** Opens the single-click point picker. A successful pick arms Fixed and disarms the other two. */
      pickPoint: () => send({ type: 'clicker:configurePoint', payload: {} }),
      /**
       * Arms or disarms Area. Arming it with no box drawn is a state the engine ignores and the
       * backend normalises away the moment a preset is applied — so a preset saved from it came
       * back as "Custom" against itself. With no box, arming opens the picker instead, and the
       * backend arms the mode on a successful draw (Esc leaves everything as it was).
       */
      toggleArea: () => {
        const { cursorClickUseArea: useArea, cursorClickArea: area } = getState().settings;
        if (!useArea && !area) pickArea();
        else setTargetMode('cursorClickUseArea', !useArea);
      },
      /** Forgets the box and disarms Area. */
      clearArea: () => { set('cursorClickUseArea', false); set('cursorClickArea', null); },
      /** Forgets the point only: Fixed stays on and goes back to locking where the cursor is at start. */
      clearPoint: () => set('cursorClickFixedPoint', null),
      /** Freezes a live run; useReplay().resume picks it back up. */
      pause: () => send({ type: 'clicker:pause', payload: {} }),
      /** Saves the current settings under a name; an existing name is overwritten, a new one added. */
      savePreset: (name: string) => send({ type: 'clicker:savePreset', payload: { name } }),
      applyPreset: (name: string) => send({ type: 'clicker:applyPreset', payload: { name } }),
      /** Deletes at once; the backend keeps the deleted preset for undoDeletePreset. */
      deletePreset: (name: string) => send({ type: 'clicker:deletePreset', payload: { name } }),
      undoDeletePreset: (name: string) => send({ type: 'clicker:undoDeletePreset', payload: { name } }),
      /** Gives a preset another name, in its slot. */
      renamePreset: (name: string, newName: string) => send({ type: 'clicker:renamePreset', payload: { name, newName } }),
    };
  }, [send, getState]);
}
