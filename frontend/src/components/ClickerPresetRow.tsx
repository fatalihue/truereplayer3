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

export function ClickerPresetRow({ settings, width }: { settings: SettingsState; width: string }) {
  const { send } = useBridge();
  const presets = settings.cursorClickPresets ?? [];
  const active = presets.find((p) => sameSetup(p, settings)) ?? null;
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Outside-press + Escape dismissal — the pair ComboInput carries: mousedown, so the menu is
  // gone before the click underneath lands; Escape closes only the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => { if (naming) inputRef.current?.focus(); }, [naming]);

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
            // Leaving an empty field cancels; leaving a typed one keeps it, so a stray click
            // does not throw the name away.
            onBlur={() => { if (!name.trim()) setNaming(false); }}
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
            onClick={() => { setOpen(false); setName(''); setNaming(true); }}
            className="w-full px-2 py-1 text-left text-[11px] text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-colors"
          >
            Save current as…
          </button>
        </div>
      )}
    </div>
  );
}
