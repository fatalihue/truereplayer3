import { splitCombo } from './KbdTag';
import { compactKey } from '../../utils/keyNames';

/**
 * Hero key-caps for the capture dialogs' pads — one big cap per key, joined by
 * '+'. Deliberately NOT KbdTag (that's the 20px inline tag; these are the
 * headline caps). Was duplicated verbatim in KeystrokeCaptureDialog and
 * PauseDialog; sharing it also fixes two display bugs for free: the literal
 * '+' key now renders (splitCombo) and Pause shows "Menu" instead of raw
 * "VK_93". Display-only — the raw combo stays in state and payloads.
 */
interface KeyCapsProps {
  combo: string;
  /** Cap glyph color, e.g. 'var(--color-action-key-fg)'. */
  fg: string;
}

export function KeyCaps({ combo, fg }: KeyCapsProps) {
  // compactKey is display-only: the cap says PgDn like every other keycap; state keeps PageDown.
  const parts = splitCombo(combo.replace(/\bVK_93\b/, 'Menu')).map(compactKey);
  return (
    <div className="inline-flex items-center justify-center self-center gap-1 flex-wrap">
      {parts.map((part, i) => (
        <span key={`${part}-${i}`} className="inline-flex items-center gap-1">
          {/* The keycap's lower edge is a 3 px bottom BORDER, not a hard offset shadow (the
              guideline allows only shadow-overlay / shadow-dialog). Same 3 px of edge as the old
              1 px border + 2 px shadow, and the same 28 px box: 1 + 3 + 18 + 3 + 3 = 1 + 4 + 18
              + 4 + 1. The padding is 3 px on BOTH sides (a measured value, hence arbitrary): 4 / 2
              kept the box but sat the glyph 1 px low on the cap face. */}
          <kbd
            className="inline-block px-2.5 py-[3px] bg-bg-elevated border border-b-3 border-border-default rounded font-mono text-body font-semibold"
            style={{ color: fg }}
          >
            {part}
          </kbd>
          {i < parts.length - 1 && <span className="text-text-tertiary text-minor">+</span>}
        </span>
      ))}
    </div>
  );
}
