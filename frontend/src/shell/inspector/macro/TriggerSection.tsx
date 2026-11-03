import { useEffect, useRef, useState } from 'react';
import type { TriggerMode } from '../../../bridge/messageTypes';
import { t } from '../../../i18n';
import { useKeyCapture } from '../../../logic/useKeyCapture';
import { useMacro } from '../../../logic/useMacro';
import { useToast } from '../../../state/ToastContext';
import { settingsFocused, type SettingsSection } from '../../ui';
import { DraftField, KeyCapture, Section, Segmented, Switch } from '../fields';
import type { MacroFacts } from './facts';

/** What the four modes that are not a plain press do, under the choice (today's Assign hotkey). */
const MODE_HELP: Partial<Record<TriggerMode, string>> = {
  whilePressed: t('macroSettings.trigger.modeHelp.whilePressed'),
  toggle: t('macroSettings.trigger.modeHelp.toggle'),
  doubleTap: t('macroSettings.trigger.modeHelp.doubleTap'),
  hold: t('macroSettings.trigger.modeHelp.hold'),
};
/** The modes, as the segmented offers them (two to a line). */
const MODES: { value: TriggerMode; label: string; tip?: string }[] = [
  { value: 'onPress', label: t('macroSettings.trigger.modes.onPress') },
  { value: 'onRelease', label: t('macroSettings.trigger.modes.onRelease') },
  { value: 'whilePressed', label: t('macroSettings.trigger.modes.whilePressed'), tip: t('macroSettings.trigger.modeTips.whilePressed') },
  { value: 'toggle', label: t('macroSettings.trigger.modes.toggle'), tip: t('macroSettings.trigger.modeTips.toggle') },
  { value: 'doubleTap', label: t('macroSettings.trigger.modes.doubleTap'), tip: t('macroSettings.trigger.modeTips.doubleTap') },
  { value: 'hold', label: t('macroSettings.trigger.modes.hold'), tip: t('macroSettings.trigger.modeTips.hold') },
];
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
      : boxRef.current?.querySelector<HTMLElement>(`input[aria-label="${t('macroSettings.trigger.hotstring')}"]`);
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
    showToast(t('macroSettings.trigger.removedHotkey', { hotkey: prev, name }), {
      type: 'success',
      duration: 10000,
      action: { label: t('common.actions.undo'), onClick: () => macro.assignHotkey(name, prev, mode) },
    });
  };
  const removeHotstring = () => {
    const prev = facts.hotstring;
    if (!prev) return;
    const prevInstant = facts.hotstringInstant;
    macro.removeHotstring(name);
    showToast(t('macroSettings.trigger.removedHotstring', { hotstring: prev, name }), {
      type: 'success',
      duration: 10000,
      action: { label: t('common.actions.undo'), onClick: () => macro.assignHotstring(name, prev, prevInstant) },
    });
  };

  return (
    <div ref={boxRef} className="mset-group">
      <span className="mset-title">{t('macroSettings.trigger.title')}</span>
      <Section label={t('macroSettings.trigger.hotkey')} hint={facts.hotkey ? MODE_HELP[mode] : undefined}>
        <div className="insp-line">
          <KeyCapture
            key={listenSeq}
            value={facts.hotkey ?? ''}
            label={t('macroSettings.trigger.hotkey')}
            // Today's Assign hotkey took the side buttons and the wheel (Ctrl+ScrollDown, XButton1):
            // the engine fires a macro on them (biblioteca-077 and 078).
            mouse
            autoListen={listenSeq > 0}
            onCapture={(combo) => macro.assignHotkey(name, combo, mode)}
            disabled={locked}
          />
          {facts.hotkey && (
            <button type="button" className="insp-icon-button" aria-label={t('macroSettings.trigger.removeHotkey')} data-tip={t('macroSettings.trigger.removeHotkeyTip')} disabled={locked} onClick={removeHotkey}>
              <span className="step-icon" data-icon="x" />
            </button>
          )}
        </div>
        <Segmented<TriggerMode>
          label={t('macroSettings.trigger.modeGroup')}
          value={mode}
          options={MODES}
          wrap
          disabled={locked || !facts.hotkey}
          onChange={(m) => { if (facts.hotkey) macro.assignHotkey(name, facts.hotkey, m); }}
        />
      </Section>
      <Section
        label={t('macroSettings.trigger.hotstring')}
        hint={tooShort ? <span data-error="">{t('macroSettings.trigger.minLength')}</span>
          : facts.hotstring ? (instant ? t('macroSettings.trigger.runsInstant') : t('macroSettings.trigger.runsOnEnd'))
          : t('macroSettings.trigger.hotstringHelp')}
      >
        <div
          className="insp-line"
          onFocus={(e) => { if (e.target instanceof HTMLInputElement) setQuiet(true); }}
          onBlur={(e) => { if (e.target instanceof HTMLInputElement) setQuiet(false); }}
        >
          <DraftField
            stepId={`macro:${name}`}
            field="hotstring"
            label={t('macroSettings.trigger.hotstring')}
            kind="mono"
            placeholder={t('macroSettings.trigger.hotstringPlaceholder')}
            maxLength={32}
            filter={(text) => text.replace(NOT_HOTSTRING, '')}
            parse={(text) => { const seq = text.trim().toLowerCase(); return seq.length >= 2 ? seq : null; }}
            stored={facts.hotstring ?? ''}
            disabled={locked}
            onText={setTyped}
            onApply={(seq) => macro.assignHotstring(name, seq, instant)}
          />
          {facts.hotstring && (
            <button type="button" className="insp-icon-button" aria-label={t('macroSettings.trigger.removeHotstring')} data-tip={t('macroSettings.trigger.removeHotstringTip')} disabled={locked} onClick={removeHotstring}>
              <span className="step-icon" data-icon="x" />
            </button>
          )}
        </div>
        <div className="insp-row">
          <Switch
            label={t('macroSettings.trigger.instant')}
            checked={instant}
            disabled={locked}
            tip={t('macroSettings.trigger.instantTip')}
            onChange={(on) => { if (facts.hotstring) macro.assignHotstring(name, facts.hotstring, on); else setInstantNew(on); }}
          />
          <span className="insp-row-label">{t('macroSettings.trigger.instant')}</span>
        </div>
      </Section>
    </div>
  );
}
