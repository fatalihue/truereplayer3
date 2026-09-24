import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import type { ClickerPreset, ClickerPresetFields, SettingsState } from '../bridge/messageTypes';
import { useBridge } from '../bridge/BridgeContext';
import { chipOn, chipOff } from './common/chipStyles';

/**
 * Clicker presets — named snapshots of the cursorClick* settings, picked from a chip in the
 * Clicker section. Everything Clicker is global and Save/Load are disabled in that mode, so
 * without this a user who alternates two setups (10/s left at the cursor for one game, an
 * Area with the right button for another) retypes every field each time.
 *
 * The chip names the preset that MATCHES the current settings field by field ("Custom" when
 * none does, "None" when there are none), so editing any knob visibly leaves the preset — no
 * "active" flag to keep in sync on either side. Picking a preset applies it; "Save current
 * as…" turns the chip into a name field; ✕ beside a preset deletes it. All three round-trip
 * through the bridge (clicker:savePreset / applyPreset / deletePreset) and come back as
 * settings:loaded, which is what repaints this.
 */
const PRESET_KEYS: (keyof ClickerPresetFields)[] = [
  'cursorClickButton', 'cursorClickDelay', 'cursorClickDelayJitter', 'cursorClickUseJitter', 'cursorClickHold',
  'cursorClickPositionJitter', 'cursorClickUsePositionJitter', 'cursorClickUseArea', 'cursorClickArea',
  'cursorClickUseFixed', 'cursorClickFixedPoint', 'cursorClickLoops', 'cursorClickUseLoops',
  'cursorClickInterval', 'cursorClickUseInterval', 'cursorClickMaxDuration', 'cursorClickUseMaxDuration',
  'cursorClickGameMove',
];

// The bridge omits null-valued keys, so a cleared area/point arrives as `undefined` on one side
// and `null` on the other — normalise before comparing.
function sameSetup(p: ClickerPreset, s: SettingsState): boolean {
  return PRESET_KEYS.every((k) => JSON.stringify(p[k] ?? null) === JSON.stringify(s[k] ?? null));
}

/** A name being typed into "Save current as…", kept across this row's remounts (see pendingName). */
export interface PendingPresetName { name: string; openedWith: string }

export function ClickerPresetRow({ settings, width, lastMatched, pendingName }: {
  settings: SettingsState;
  width: string;
  /** Owned by SettingsPanel, like seedUndo, and for the same reason: this row is remounted by a tab
   *  switch, by narrowing the window below the two-column breakpoint, and by a run pulling focus
   *  back to the profile tab. A ref declared HERE started empty again after each of those, and the
   *  prefill this exists for was silently back to blank. */
  lastMatched: React.MutableRefObject<string | null>;
  /** Same owner, same reason: a typed name survives a stray click (onBlur below keeps it), but not
   *  a remount — the tab switch, the collapse, and ScrLk to Macro and back threw it away without a
   *  word. The row comes back naming, with the text, and without stealing the focus. */
  pendingName: React.MutableRefObject<PendingPresetName | null>;
}) {
  const { send } = useBridge();
  const presets = settings.cursorClickPresets ?? [];
  const active = presets.find((p) => sameSetup(p, settings)) ?? null;
  const [open, setOpen] = useState(false);
  // Read once, by the initializers; the mount effect below marks the slot consumed.
  const restored = pendingName.current;
  const [naming, setNaming] = useState(() => restored !== null);
  const [name, setName] = useState(() => restored?.name ?? '');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Outside-press + Escape dismissal — the pair ComboInput carries: mousedown, so the menu is
  // gone before the click underneath lands.
  //
  // Escape is armed while NAMING too, not just while the menu is open, and that matters: the
  // naming branch replaces the chip button entirely, so with the field blurred there was no
  // control left to click and the input's own onKeyDown could not hear Escape either. The mode
  // was a dead end reachable by one stray click. Outside-mousedown still only closes the MENU —
  // a name the user typed must survive a stray click, which is what onBlur below decides.
  useEffect(() => {
    if (!open && !naming) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      setNaming(false);
      setName('');
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, naming]);

  // The chip's name is DERIVED (sameSetup, field by field), so it vanishes on the first knob the
  // user turns — which is exactly the moment they head for "Save current as…" to overwrite that
  // preset. Remember the last name that matched, so the field can open with it instead of empty.
  // Without this, overwriting means retyping the name from memory with the list hidden behind the
  // input, and one wrong letter does not warn: the backend Adds when no name matches, so the user
  // silently ends up with a duplicate preset instead of an edited one.
  const activeName = active?.name ?? null;
  useEffect(() => { if (activeName) lastMatched.current = activeName; }, [activeName, lastMatched]);

  // Only offer a remembered name that is still in the list — it may have been deleted (the ✕ right
  // here) or dropped by a settings push since it last matched. That filter matters more now that
  // the memory outlives this component: it can hold a name from before a remount, and the list it
  // is checked against is always the current one.
  const remembered = lastMatched.current;
  const prefill = remembered && presets.some((p) => p.name === remembered) ? remembered : '';
  // What the field opened with, so onBlur can tell "untouched prefill" from "the user typed this".
  const openedWithRef = useRef(restored?.openedWith ?? '');

  // Select, not just focus: the prefilled name is a suggestion to overwrite, so typing replaces it
  // and the user never has to clear the field to save under a different name. Only on the OPENING
  // (naming false → true): a RESTORED field comes back after a remount the user did not aim at this
  // row, so it waits for a click. A transition, not a one-shot skip flag — the dev StrictMode runs
  // the effect twice on mount, and a flag spent on the first run let the second steal the focus.
  const namingWasRef = useRef(naming);
  useEffect(() => {
    const was = namingWasRef.current;
    namingWasRef.current = naming;
    if (naming && !was) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [naming]);

  // Hand a typed name to SettingsPanel on the way out; take the slot back on the way in. Only a
  // name the user WROTE is kept — empty or still the prefill is the "did not write" case onBlur
  // already cancels.
  const pendingRef = useRef<PendingPresetName | null>(null);
  pendingRef.current = naming && name.trim() !== '' && name.trim() !== openedWithRef.current
    ? { name, openedWith: openedWithRef.current }
    : null;
  useEffect(() => {
    const pending = pendingRef;
    pendingName.current = null;
    return () => { pendingName.current = pending.current; };
  }, [pendingName]);

  const commitName = () => {
    const trimmed = name.trim();
    if (trimmed) send({ type: 'clicker:savePreset', payload: { name: trimmed } });
    setNaming(false);
    setName('');
  };

  const label = active ? active.name : presets.length > 0 ? 'Custom' : 'None';

  return (
    <div ref={wrapRef} className={`relative ${width}`}>
      {/* Chip-shaped like the Area and Fixed rows: lit while a saved preset is what is loaded. */}
      <div className="h-7 flex items-center rounded border overflow-hidden" style={active ? chipOn : chipOff}>
        {naming ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') { setNaming(false); setName(''); }
            }}
            // Leaving a field the user did not WRITE cancels; leaving a typed one keeps it, so a
            // stray click does not throw the name away. "Did not write" has to mean empty OR still
            // exactly the prefill — testing only for empty was right while the field always opened
            // blank, but a prefilled field is never empty, so every stray click used to stick.
            // Compared against the value captured when the field OPENED, never against `prefill`:
            // that one is recomputed every render and a settings push can turn it into '' under an
            // open field, which would let a name the user really typed cancel itself.
            onBlur={() => {
              const typed = name.trim();
              if (!typed || typed === openedWithRef.current) { setNaming(false); setName(''); }
            }}
            placeholder="Name, then Enter"
            maxLength={40}
            aria-label="Preset name"
            className="w-full h-full px-2 text-[11px] font-mono bg-transparent text-text-primary outline-none placeholder:text-text-tertiary"
          />
        ) : (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="flex-1 min-w-0 h-full flex items-center justify-between gap-1 pl-2 pr-1 cursor-pointer"
          >
            <span className={`text-[10px] font-mono truncate ${active ? 'text-text-primary' : 'text-text-tertiary'}`}>{label}</span>
            <ChevronDown size={11} className="shrink-0 text-text-tertiary" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full menu-surface py-1">
          {presets.map((p) => (
            <div key={p.name} className="flex items-center">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { send({ type: 'clicker:applyPreset', payload: { name: p.name } }); setOpen(false); }}
                className="flex-1 min-w-0 flex items-center gap-1 px-2 py-1 text-left text-[11px] font-mono text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-colors"
              >
                <span className="truncate">{p.name}</span>
                {active?.name === p.name && <Check size={10} className="shrink-0 text-accent-solid" />}
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => send({ type: 'clicker:deletePreset', payload: { name: p.name } })}
                aria-label={`Delete preset ${p.name}`}
                className="shrink-0 px-1.5 py-1 text-[11px] leading-none text-text-tertiary hover:text-text-primary transition-colors"
              >
                ✕
              </button>
            </div>
          ))}
          {presets.length > 0 && <div className="my-1 h-px bg-border-subtle" />}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setOpen(false); openedWithRef.current = prefill; setName(prefill); setNaming(true); }}
            className="w-full px-2 py-1 text-left text-[11px] text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-colors"
          >
            Save current as…
          </button>
        </div>
      )}
    </div>
  );
}
