import { useEffect, useRef, useState } from 'react';
import type { TriggerMode } from '../../../bridge/messageTypes';
import { useKeyCapture } from '../../../logic/useKeyCapture';
import { useMacro } from '../../../logic/useMacro';
import { useTt } from '../../../state/LanguageContext';
import { useToast } from '../../../state/ToastContext';
import { settingsFocused, type SettingsSection } from '../../ui';
import { DraftField, KeyCapture, Section, Segmented, Switch } from '../fields';
import type { MacroFacts } from './facts';

/** What the four modes that are not a plain press do, under the choice (today's Assign hotkey). */
const MODE_HELP: Partial<Record<TriggerMode, string>> = {
  whilePressed: 'Loops while held.',
  toggle: 'Loops until pressed again.',
  doubleTap: 'Single taps are ignored.',
  hold: 'Fires after ~0.6 s held; a tap does nothing.',
};
// What the engine's hotstring buffer can match: letters, digits and - . / , ; =
const NOT_HOTSTRING = /[^a-zA-Z0-9\-./,;=]/g;

/**
 * Macro settings › Trigger (Macro settings board: "Hotkey F5 · On press", "Hotstring None · Add").
 * The hotkey is captured through the engine's hook, so Win+letter arrives too, and applies on the
 * spot with its mode; the hotstring applies when the typing stops or the field is left, with at
 * least 2 characters, and the global hotkeys stay quiet while it has the focus. Each one is removed
 * here (D4: the library's chips only show) with a toast that puts it back; Ctrl+Z also does.
 */
export function TriggerSection({ facts, locked, focus }: { facts: MacroFacts; locked: boolean; focus: { section: SettingsSection; seq: number } | null }) {
  const macro = useMacro();
  const capture = useKeyCapture();
  const tt = useTt();
  const { showToast } = useToast();
  const name = facts.name;
  const mode: TriggerMode = facts.triggerMode;
  // A new hotstring starts with Instant on, as today; one already set keeps its own.
  const [instantNew, setInstantNew] = useState(true);
  const instant = facts.hotstring ? facts.hotstringInstant : instantNew;
  const [typed, setTyped] = useState<string | null>(null);
  const tooShort = typed !== null && typed.trim().length === 1;

  // Hotkey… from the macro's menu listens at once (a capture armed again, under a new key).
  const [listenSeq, setListenSeq] = useState(0);
  if (focus?.section === 'hotkey' && focus.seq !== listenSeq) setListenSeq(focus.seq);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    const target = focus.section === 'hotkey'
      ? boxRef.current?.querySelector<HTMLElement>('.insp-capture')
      : boxRef.current?.querySelector<HTMLElement>('input[aria-label="Hotstring"]');
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
    settingsFocused();
  }, [focus]);

  // The global hotkeys stay quiet while the hotstring is being typed (and never stay quiet after).
  const quiet = useRef(false);
  const setQuiet = (on: boolean) => {
    if (quiet.current === on) return;
    quiet.current = on;
    capture.suppress(on);
  };
  useEffect(() => () => {
    if (quiet.current) capture.suppress(false);
  }, [capture]);

  const removeHotkey = () => {
    const prev = facts.hotkey;
    if (!prev) return;
    macro.removeHotkey(name);
    showToast(tt(`Removed hotkey ${prev} from "${name}"`, `Hotkey ${prev} removido de "${name}"`), {
      type: 'success',
      duration: 10000,
      action: { label: 'Undo', onClick: () => macro.assignHotkey(name, prev, mode) },
    });
  };
  const removeHotstring = () => {
    const prev = facts.hotstring;
    if (!prev) return;
    const prevInstant = facts.hotstringInstant;
    macro.removeHotstring(name);
    showToast(tt(`Removed hotstring "${prev}" from "${name}"`, `Hotstring "${prev}" removido de "${name}"`), {
      type: 'success',
      duration: 10000,
      action: { label: 'Undo', onClick: () => macro.assignHotstring(name, prev, prevInstant) },
    });
  };

  const modes: { value: TriggerMode; label: string; tip?: string }[] = [
    { value: 'onPress', label: 'On press' },
    { value: 'onRelease', label: 'On release' },
    { value: 'whilePressed', label: 'While pressed', tip: tt('Loops while held; stops on release', 'Repete enquanto segura; para ao soltar') },
    { value: 'toggle', label: 'Toggle', tip: tt('Press to start looping, press again to stop', 'Aperte para começar o loop, de novo para parar') },
    { value: 'doubleTap', label: 'Double-tap', tip: tt('Two quick taps; a single tap is ignored', 'Dois toques rápidos; toque único é ignorado') },
    { value: 'hold', label: 'Hold (long-press)', tip: tt('Fires once after ~0.6 s held; does not stop on release', 'Dispara uma vez após ~0,6 s segurando; não para ao soltar') },
  ];

  return (
    <div ref={boxRef} className="mset-group">
      <span className="mset-title">Trigger</span>
      <Section label="Hotkey" hint={facts.hotkey ? MODE_HELP[mode] : undefined}>
        <div className="insp-line">
          <KeyCapture
            key={listenSeq}
            value={facts.hotkey ?? ''}
            label="Hotkey"
            autoListen={listenSeq > 0}
            onCapture={(combo) => macro.assignHotkey(name, combo, mode)}
            disabled={locked}
          />
          {facts.hotkey && (
            <button type="button" className="insp-icon-button" aria-label="Remove hotkey" data-tip={tt('Remove the hotkey', 'Remover o atalho')} disabled={locked} onClick={removeHotkey}>
              <span className="step-icon" data-icon="x" />
            </button>
          )}
        </div>
        <Segmented<TriggerMode>
          label="Trigger mode"
          value={mode}
          options={modes}
          wrap
          disabled={locked || !facts.hotkey}
          onChange={(m) => { if (facts.hotkey) macro.assignHotkey(name, facts.hotkey, m); }}
        />
      </Section>
      <Section
        label="Hotstring"
        hint={tooShort ? <span data-error="">Min 2 characters.</span>
          : facts.hotstring ? (instant ? 'Runs as soon as it is typed.' : 'Runs after Enter, Space or Tab.')
          : 'Type it anywhere to run the macro: letters, digits and - . / , ; ='}
      >
        <div
          className="insp-line"
          onFocus={(e) => { if (e.target instanceof HTMLInputElement) setQuiet(true); }}
          onBlur={(e) => { if (e.target instanceof HTMLInputElement) setQuiet(false); }}
        >
          <DraftField
            stepId={`macro:${name}`}
            field="hotstring"
            label="Hotstring"
            kind="mono"
            placeholder="e.g. /id"
            maxLength={32}
            filter={(t) => t.replace(NOT_HOTSTRING, '')}
            parse={(t) => { const seq = t.trim().toLowerCase(); return seq.length >= 2 ? seq : null; }}
            stored={facts.hotstring ?? ''}
            disabled={locked}
            onText={setTyped}
            onApply={(seq) => macro.assignHotstring(name, seq, instant)}
          />
          {facts.hotstring && (
            <button type="button" className="insp-icon-button" aria-label="Remove hotstring" data-tip={tt('Remove the hotstring', 'Remover a hotstring')} disabled={locked} onClick={removeHotstring}>
              <span className="step-icon" data-icon="x" />
            </button>
          )}
        </div>
        <div className="insp-row">
          <Switch
            label="Instant trigger"
            checked={instant}
            disabled={locked}
            tip={tt('Fires on the last character, with no Enter, Space or Tab', 'Dispara no último caractere, sem Enter, Espaço ou Tab')}
            onChange={(on) => { if (facts.hotstring) macro.assignHotstring(name, facts.hotstring, on); else setInstantNew(on); }}
          />
          <span className="insp-row-label">Instant trigger</span>
        </div>
      </Section>
    </div>
  );
}
