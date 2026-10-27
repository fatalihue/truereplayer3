import { useState, type MouseEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import type { SettingsState } from '../../bridge/messageTypes';
import { useSettings } from '../../logic/useSettings';
import { useTt } from '../../state/LanguageContext';
import { keycaps } from '../library/model';
import { Menu } from '../Menu';
import { anchorBelow, type MenuAnchor } from '../menuAnchor';
import { NumberField } from '../NumberField';
import { Popover } from '../Popover';
import { useApp } from '../store';
import { useAnswered } from '../useAnswered';
import { insertPoint, useSelection } from '../list/selection';
import { loopsShown, runsPerRow } from './model';

/**
 * Record ▾ and Replay ▾: what a recording captures, and how the open macro runs. Loaded when one
 * first opens (rule 6). Every control writes one setting through settings:change, and the engine
 * routes the macro's own keys (profile…) to the open macro, which saves itself.
 */
export default function RunOptions({ kind, anchor, toggle, focusFirst, onClose }: {
  kind: 'record' | 'replay';
  anchor: MenuAnchor;
  toggle: Element | null;
  focusFirst: boolean;
  onClose: () => void;
}) {
  return (
    <Popover
      anchor={anchor}
      label={kind === 'record' ? 'Recording options' : 'Run options'}
      toggle={toggle}
      focusFirst={focusFirst}
      onClose={onClose}
    >
      {kind === 'record' ? <RecordOptions /> : <ReplayOptions />}
    </Popover>
  );
}

const CAPTURE: { key: keyof SettingsState & string; label: string; detail?: string }[] = [
  { key: 'recordMouse', label: 'Mouse clicks' },
  { key: 'recordScroll', label: 'Mouse scroll' },
  { key: 'recordKeyboard', label: 'Keyboard' },
  { key: 'recordCombinedInput', label: 'One step per click or key', detail: 'Off records press and release apart' },
  { key: 'browserSelectorEnabled', label: 'Browser actions', detail: 'Through the browser extension' },
];

/** Record ▾. The capture switches are the app's, for every macro, as they have always been. */
function RecordOptions() {
  const settings = useApp(a => a.settings);
  const steps = useApp(a => a.actions);
  const at = useSelection(s => insertPoint(steps, s.keys));
  const { change } = useSettings();
  return (
    <div className="ro-panel" data-kind="record">
      <span className="ro-heading">Capture</span>
      {CAPTURE.map(({ key, label, detail }) => (
        <CaptureOption
          key={key}
          label={label}
          detail={detail}
          on={settings[key] !== false}
          onChange={(on) => change(key, on)}
        />
      ))}
      <span className="ro-separator" role="separator" />
      {/* Where the recording goes: the insertion point, after the last selected step (lista-032). */}
      <span className="ro-note">
        {steps.length === 0 ? 'Records into the empty macro'
          : at < steps.length ? `Records at the insert point, after step ${at}`
          : `Records at the end, after step ${steps.length}`}
      </span>
      <HotkeyLine label="Start or stop" combo={settings.recordingHotkey} />
    </div>
  );
}

function CaptureOption({ label, detail, on, onChange }: { label: string; detail?: string; on: boolean; onChange: (on: boolean) => void }) {
  const [shown, answer] = useAnswered(on);
  return (
    <label className="ro-check">
      <input
        type="checkbox"
        checked={shown}
        onChange={(e) => {
          answer(e.target.checked);
          onChange(e.target.checked);
        }}
      />
      <span className="ro-check-text">
        {label}
        {detail && <span className="ro-detail">{detail}</span>}
      </span>
    </label>
  );
}

/**
 * Replay ▾. Loops and Interval have no switch of their own: 1 loop is one pass and an interval of
 * 0 is none, and the engine's switches follow the number. Return cursor, Game Mode, Fast approach
 * and Jitter are the macro's own, or the app's (settings-030 and 037): Default says which, and a
 * number typed in Jitter is the macro's own until Use default.
 */
function ReplayOptions() {
  const loop = useApp(a => a.profileLoop);
  const settings = useApp(a => a.settings);
  const open = useApp(a => a.activeProfile);
  const perRow = useApp(a => runsPerRow(a.dataTable));
  const { change } = useSettings();
  const tt = useTt();
  const gameModeOn = loop.gameMode ?? settings.smoothMovement;
  const appJitter = settings.useDelayVariation ? Number(settings.delayVariation) || 0 : 0;
  return (
    <div className="ro-panel" data-kind="replay">
      <span className="ro-heading">Run options · saved with the macro</span>
      <div className="ro-grid">
        <NumberField
          label="Loops"
          unit="×"
          value={loopsShown(loop)}
          min={1}
          max={999}
          owner={open}
          tip={perRow ? tt('The Data Loop table runs the macro once per row instead.', 'A tabela do Data Loop roda o macro uma vez por linha no lugar disto.') : undefined}
          onCommit={(n) => {
            if (n > 1) {
              change('profileLoopCount', String(n));
              if (!loop.enabled) change('profileEnableLoop', true);
            } else if (loop.enabled) {
              change('profileEnableLoop', false);
            }
          }}
        />
        <NumberField
          label="Interval"
          unit="ms"
          value={loop.intervalEnabled ? loop.interval : '0'}
          min={0}
          max={60000}
          owner={open}
          tip={tt('Between loops', 'Entre os loops')}
          onCommit={(n) => {
            if (n > 0) {
              change('profileLoopInterval', String(n));
              if (!loop.intervalEnabled) change('profileLoopIntervalEnabled', true);
            } else if (loop.intervalEnabled) {
              change('profileLoopIntervalEnabled', false);
            }
          }}
        />
        <NumberField
          label="Jitter"
          unit="%"
          value={String(loop.delayVariation ?? appJitter)}
          min={0}
          max={100}
          owner={open}
          tip={tt('Random ±% on each delay — less robotic.', 'Variação ±% aleatória em cada atraso — menos robótico.')}
          onCommit={(n) => change('profileDelayVariation', n)}
        />
        {loop.scoped && (loop.delayVariation === null ? (
          <span className="ro-default" data-tip={tt("The app's jitter. Type a number to give this macro its own.", 'O jitter do app. Digite um número para este macro ter o seu.')}>
            Default
          </span>
        ) : (
          <button
            type="button"
            className="ro-default"
            data-reset=""
            data-tip={tt(`Back to the app's jitter (${appJitter} %)`, `Volta ao jitter do app (${appJitter} %)`)}
            onClick={() => change('profileDelayVariation', null)}
          >
            Use default
          </button>
        ))}
      </div>
      <Choice
        label="Return cursor"
        own={loop.restoreCursor}
        appDefault={settings.restoreCursor}
        tip={tt('The cursor goes back to where it was when the run started.', 'O cursor volta para onde estava quando o run começou.')}
        onChange={(v) => change('profileRestoreCursor', v)}
      />
      <Choice
        label="Game Mode"
        own={loop.gameMode}
        appDefault={settings.smoothMovement}
        tip={tt('The cursor walks a path so games accept the move. Off jumps at once.', 'O cursor percorre um caminho para jogos aceitarem o movimento. Desligado, salta direto.')}
        onChange={(v) => change('profileGameMode', v)}
      />
      <Choice
        label="Fast approach"
        own={loop.fastApproach}
        appDefault={settings.fastApproach}
        disabled={!gameModeOn}
        tip={gameModeOn
          ? tt('Teleports long moves, walks only the last stretch. Turn off if a game misclicks.', 'Teletransporta movimentos longos, anda só o trecho final. Desligue se um jogo errar o clique.')
          : tt('Only with Game Mode on.', 'Só com o Game Mode ligado.')}
        onChange={(v) => change('profileFastApproach', v)}
      />
      <HotkeyLine label="Replay or stop" combo={settings.replayHotkey} />
    </div>
  );
}

/**
 * A setting the macro can have of its own or take from the app: Default, On or Off. The choice is a
 * small menu, in the same layer as the panel, so picking in it does not close the panel.
 */
function Choice({ label, own, appDefault, tip, disabled, onChange }: {
  label: string;
  own: boolean | null;
  appDefault: boolean;
  tip: string;
  /** Off while it does nothing (Fast approach without Game Mode); the tip says why. */
  disabled?: boolean;
  onChange: (value: boolean | null) => void;
}) {
  const [shown, answer] = useAnswered(own);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLElement; keyboard: boolean } | null>(null);
  const name = (v: boolean | null) => (v === null ? `Default (${appDefault ? 'on' : 'off'})` : v ? 'On' : 'Off');
  const pick = (v: boolean | null) => {
    answer(v);
    if (v !== own) onChange(v);
  };
  const toggleMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (menu) { setMenu(null); return; }
    const button = e.currentTarget;
    setMenu({ anchor: anchorBelow(button, 'end'), button, keyboard: e.detail === 0 });
  };
  return (
    <div className="ro-row" data-disabled={disabled || undefined}>
      <span className="ro-row-label" data-tip={tip}>{label}</span>
      <button
        type="button"
        className="ro-choice"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        aria-label={`${label}: ${name(shown)}`}
        disabled={disabled}
        data-tip={disabled ? tip : undefined}
        onClick={toggleMenu}
      >
        {name(shown)}
        <ChevronDown aria-hidden="true" />
      </button>
      {menu && (
        <Menu
          anchor={menu.anchor}
          label={label}
          focusFirst={menu.keyboard}
          toggle={menu.button}
          onClose={() => setMenu(null)}
          entries={[null, true, false].map(v => ({ label: name(v), checked: shown === v, onSelect: () => pick(v) }))}
        />
      )}
    </div>
  );
}

function HotkeyLine({ label, combo }: { label: string; combo: string }) {
  if (!combo) return null;
  return (
    <span className="ro-hotkey">
      <span>{label}</span>
      <kbd className="kbd">{keycaps(combo)}</kbd>
    </span>
  );
}
