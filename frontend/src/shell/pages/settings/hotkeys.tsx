import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { create } from 'zustand';
import type { HotkeySettingKey, SettingsState } from '../../../bridge/messageTypes';
import { isPureModifier, SINGLE_KEY_CAPTURE_IDLE_MS, useKeyCapture } from '../../../logic/useKeyCapture';
import { useSettings } from '../../../logic/useSettings';
import { useTt } from '../../../state/LanguageContext';
import { useToast } from '../../../state/ToastContext';
import { keycaps } from '../../library/model';
import { useApp } from '../../store';

/**
 * Settings › Hotkeys (the concept's SettingsHotkeys board): the keys that work anywhere in Windows,
 * each with what it does and, when another app uses its key, which one. Hotkeys that take such a
 * key while a new install gets another are counted in a notice that offers the suggested keys
 * (hotkeys:useSuggested, the engine's HotkeyDefaults) or keeping them ("Keep mine", remembered).
 */

// What other apps do with a key, by the key ('major': a key people use every day, that a suggestion
// takes the hotkey off). No key is free of them: Ctrl+F9 and Ctrl+F10, the suggestions, are minor.
const KNOWN: Record<string, { note: string; major?: true }> = {
  'ctrl+pageup': { note: 'Also switches tabs in Chrome, Edge and VS Code', major: true },
  'ctrl+pagedown': { note: 'Also switches tabs in Chrome, Edge and VS Code', major: true },
  insert: { note: 'Ins also switches typing to overwrite', major: true },
  scrolllock: { note: 'Excel uses ScrLk', major: true },
  'ctrl+f9': { note: 'Excel also minimizes a workbook with it' },
  'ctrl+f10': { note: 'Excel also maximizes or restores a workbook with it' },
};
const known = (combo: string) => (combo ? KNOWN[combo.toLowerCase()] : undefined);

const KEYS: HotkeySettingKey[] = [
  'recordingHotkey', 'replayHotkey', 'profileKeyToggleHotkey', 'foregroundHotkey', 'modeToggleHotkey',
  'cursorClickStartHotkey', 'cursorClickPauseHotkey', 'captureSlotHotkey', 'copyScreenTextHotkey',
];

/** The hotkeys on a key other apps use while a new install gets another, as "setting=key". */
function conflicts(s: SettingsState): string[] {
  const defaults = s.hotkeyDefaults;
  if (!defaults) return [];
  return KEYS.flatMap((k) => {
    const value = s[k] ?? '';
    return known(value)?.major && value.toLowerCase() !== (defaults[k] ?? '').toLowerCase() ? [`${k}=${value}`] : [];
  });
}

// "Keep mine": the hotkey-and-key pairs the user chose to keep. The notice comes back only for a
// pair not in it (another hotkey on a key other apps use). Per window, in the WebView's storage.
const KEPT = 'ui:hotkeysKept';
function readKept(): string[] {
  try {
    const kept: unknown = JSON.parse(localStorage.getItem(KEPT) ?? '[]');
    return Array.isArray(kept) ? kept.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}
const useKept = create<{ kept: string[] }>(() => ({ kept: readKept() }));
function keep(pairs: string[]) {
  const kept = [...new Set([...useKept.getState().kept, ...pairs])];
  useKept.setState({ kept });
  try { localStorage.setItem(KEPT, JSON.stringify(kept)); } catch { /* the notice comes back next time */ }
}

/** The hotkeys in conflict, and whether the notice shows (one of them was not kept). */
function useConflicts() {
  const joined = useApp(a => conflicts(a.settings).join('\n'));
  const kept = useKept(s => s.kept);
  const list = joined ? joined.split('\n') : [];
  return { list, open: list.some(p => !kept.includes(p)) };
}

/** The category's lead: what a hotkey here is, and the notice of the keys other apps use. */
export function HotkeysIntro() {
  return (
    <>
      <p className="set-intro">Keys that work anywhere in Windows, even with TrueReplayer in the background. Each macro’s own hotkey lives on the macro.</p>
      <ConflictNotice />
    </>
  );
}

function ConflictNotice() {
  const { list, open } = useConflicts();
  const settings = useSettings();
  const [done, setDone] = useState<string | null>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const showDone = !open && done !== null;
  // The notice's buttons go with it: the focus moves to what happened, not to the page's top.
  useEffect(() => { if (showDone) doneRef.current?.focus(); }, [showDone]);
  if (!open) return done ? <p ref={doneRef} tabIndex={-1} className="set-intro" role="status">{done}</p> : null;
  const n = list.length;
  return (
    <div className="set-notice" role="region" aria-label="Hotkeys on keys other apps use">
      <p className="set-notice-text">
        {n === 1 ? '1 hotkey takes a key that other apps use.' : `${n} hotkeys take keys that other apps use.`} While TrueReplayer runs, those apps stop getting them.
      </p>
      <div className="set-actions">
        <button
          type="button"
          className="insp-button"
          data-variant="primary"
          onClick={() => {
            settings.useSuggestedHotkeys(list.map(p => p.slice(0, p.indexOf('=')) as HotkeySettingKey));
            setDone('The suggested keys are in use.');
          }}
        >
          Use the suggested keys
        </button>
        <button
          type="button"
          className="insp-button"
          onClick={() => {
            keep(list);
            setDone('Your keys stay. This notice comes back only if another hotkey takes a key other apps use.');
          }}
        >
          Keep mine
        </button>
      </div>
    </div>
  );
}

/** The count beside "Hotkeys" in the categories, while the notice shows. */
export function HotkeysBadge() {
  const { list, open } = useConflicts();
  return open ? <span className="set-cat-badge" aria-hidden="true">{list.length}</span> : null;
}

/**
 * A hotkey: its key, Change, and the ✕ that clears it (no key = off; every hotkey has another way
 * in). Change listens through the engine's hook (hotkey:capture), so Win+letter, AltGr, the side
 * buttons and a modifier with the wheel arrive, and the app's hotkeys stay quiet meanwhile. The
 * first combo with a key besides the modifiers is the answer; a lone modifier waits for it. There is
 * no Esc to cancel, Esc being a key a hotkey can take: 4 s with nothing, or a click elsewhere.
 */
export function HotkeyField({ settingKey, label }: { settingKey: HotkeySettingKey; label: string }) {
  const value = useApp(a => a.settings[settingKey]) ?? '';
  const settings = useSettings();
  const capture = useKeyCapture();
  const { showToast } = useToast();
  const tt = useTt();
  const [owner] = useState(() => `settings-hotkey-${settingKey}-${crypto.randomUUID()}`);
  const [listening, setListening] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  const latest = useRef({ value, change: settings.change, showToast, tt });
  useEffect(() => { latest.current = { value, change: settings.change, showToast, tt }; });

  // Armed while listening, released on every way out, unmount included: an armed hook is an app
  // with no keyboard, the Stop hotkey included.
  useEffect(() => {
    if (!listening) return;
    capture.arm(owner);
    const stop = () => { setListening(false); setHeld(null); };
    let idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
    const off = capture.listen(owner, (combo) => {
      if (typeof combo !== 'string' || combo === '') return;
      clearTimeout(idle);
      idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
      const { value: now, change, showToast: toast, tt: t } = latest.current;
      // A bare wheel can't be one: firing it would swallow that scroll everywhere (the engine drops it too).
      if (combo === 'ScrollUp' || combo === 'ScrollDown') {
        toast(t('Use a modifier with the scroll wheel (e.g. Ctrl+ScrollDown) — a bare wheel hotkey would block scrolling everywhere.',
                'Use um modificador com a roda (ex.: Ctrl+ScrollDown) — uma hotkey de roda pura bloquearia a rolagem em todo lugar.'), 'error');
        return;
      }
      if (isPureModifier(combo)) { setHeld(combo); return; }
      stop();
      // A key taken by another hotkey or a macro is refused by the engine, with a toast, and the
      // echo puts this one back.
      if (combo !== now) change(settingKey, combo);
    });
    return () => {
      clearTimeout(idle);
      off();
      capture.release(owner);
    };
  }, [listening, capture, owner, settingKey]);

  return (
    <span className="set-hotkey" data-listening={listening || undefined}>
      <span className="set-hotkey-keys">
        {listening
          ? (held ? <kbd className="kbd">{keycaps(held)}</kbd> : <span className="set-hotkey-wait">Press the new key…</span>)
          : value ? <kbd className="kbd">{keycaps(value)}</kbd> : <span className="set-hotkey-none">No key</span>}
      </span>
      <button
        type="button"
        className="insp-button"
        aria-label={listening ? `Listening for the ${label} hotkey` : `Change ${label} hotkey`}
        aria-pressed={listening}
        data-tip={listening
          ? tt('A key, a combo, a side button or a modifier with the wheel · 4 s or a click elsewhere cancels',
               'Uma tecla, uma combinação, um botão lateral ou um modificador com a roda · 4 s ou um clique fora cancelam')
          : undefined}
        onClick={() => { setHeld(null); setListening(on => !on); }}
        onBlur={() => { setListening(false); setHeld(null); }}
      >
        {listening ? 'Listening…' : 'Change'}
      </button>
      {value && !listening ? (
        <button
          type="button"
          className="set-hotkey-clear"
          aria-label={`Clear ${label} hotkey`}
          data-tip={tt('No key — the hotkey is off', 'Sem tecla — o atalho fica desligado')}
          onClick={() => settings.change(settingKey, '')}
        >
          <X aria-hidden="true" />
        </button>
      ) : (
        // Its place kept, so Change lines up down the column.
        <span className="set-hotkey-slot" aria-hidden="true" />
      )}
    </span>
  );
}

/** Under a hotkey's description: what another app does with its key, and the suggested one. */
export function ConflictNote({ settingKey, noKeyWhy }: { settingKey: HotkeySettingKey; noKeyWhy?: string }) {
  const value = useApp(a => a.settings[settingKey]) ?? '';
  const suggested = useApp(a => a.settings.hotkeyDefaults?.[settingKey]);
  const conflict = known(value);
  if (!conflict) return null;
  const suggest = conflict.major && suggested !== undefined && suggested.toLowerCase() !== value.toLowerCase()
    ? (suggested ? `suggested ${keycaps(suggested)}` : `suggested: no key${noKeyWhy ? `, ${noKeyWhy}` : ''}`)
    : null;
  return (
    <span className="set-row-hint" data-tone={conflict.major ? 'warn' : undefined}>
      {suggest ? `${conflict.note} · ${suggest}` : conflict.note}
    </span>
  );
}

/**
 * Copy text from the screen: besides its key, the region it reads (settings-082 and 083) — dragged
 * each time, or a fixed one drawn on screen (ocr:configureHotkeyRegion), which Clear lets go.
 */
export function ScreenTextNote() {
  const hotkey = useApp(a => a.settings.copyScreenTextHotkey) ?? '';
  const region = useApp(a => a.settings.copyScreenTextRegion) ?? '';
  const settings = useSettings();
  const tt = useTt();
  const parts = region.split(',').map(Number);
  const [x, y, w, h] = parts;
  const fixed = parts.length === 4 && w > 0 && h > 0;
  const shown = fixed ? `${w}×${h} at (${x}, ${y})` : 'drag one each time';
  return (
    <>
      <ConflictNote settingKey="copyScreenTextHotkey" />
      <span className="set-row-hint">
        Region:{' '}
        <button
          type="button"
          className="set-link"
          disabled={!hotkey}
          aria-label={`Region: ${shown} — ${fixed ? 'draw another' : 'fix one'}`}
          data-tip={!hotkey ? tt('Set the hotkey first', 'Defina o atalho primeiro')
            : fixed ? tt(`${w}×${h} at (${x}, ${y}) — click to redraw`, `${w}×${h} em (${x}, ${y}) — clique para redesenhar`)
            : tt('Drag a region each time — click to fix one', 'Arraste uma região a cada vez — clique para fixar uma')}
          onClick={settings.pickCopyScreenTextRegion}
        >
          {shown}
        </button>
        {fixed && hotkey && (
          <>
            {' · '}
            <button
              type="button"
              className="set-link"
              aria-label="Clear the region"
              data-tip={tt('Back to dragging a region each time', 'Voltar a arrastar uma região a cada vez')}
              onClick={() => settings.change('copyScreenTextRegion', '')}
            >
              Clear
            </button>
          </>
        )}
      </span>
    </>
  );
}
