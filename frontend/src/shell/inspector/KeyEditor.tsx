import { useState } from 'react';
import { splitCombo } from '../../components/common/KbdTag';
import type { ActionItem } from '../../bridge/messageTypes';
import { useSteps } from '../../logic/useSteps';
import { useLanguage, useTt } from '../../state/LanguageContext';
import { formatMs } from '../../utils/displayUtils';
import { keycaps } from '../library/model';
import { arrival } from '../list/selection';
import { Chips, DraftField, KeyCapture, Section, Segmented, Switch } from './fields';
import { applyEdits, drafts, focusList, type Draft, type StepEdit } from './inspectorState';

const HOLD_CHIPS = [100, 500, 1000, 5000];
const DEFAULT_HOLD_MS = 1000;
// ActionItem.DefaultRepeatDelayMs: the gap between presses when the step leaves it empty.
const DEFAULT_KEY_GAP_MS = 30;

const lastKey = (combo: string) => {
  const parts = splitCombo(combo);
  return parts[parts.length - 1] ?? combo;
};

/** The key, captured in the panel or typed beside it (tokens like {var:name} are typed). */
function KeyInput({ step, single, locked, onKey }: { step: ActionItem; single?: boolean; locked: boolean; onKey: (key: string) => void }) {
  const tt = useTt();
  return (
    <Section label="Key">
      <KeyCapture value={step.key} single={single} label="Capture a key" onCapture={onKey} disabled={locked} />
      <span className="insp-sublabel">Or type it</span>
      <DraftField
        stepId={step.id ?? ''}
        field="key"
        label="Type the key"
        kind="mono"
        placeholder={single ? 'F5 · Ctrl · Space' : 'F5 · Ctrl+S · {var:name}'}
        stored={step.key}
        disabled={locked}
        onApply={onKey}
      />
      {!single && <span className="insp-hint">{tt('Typed keys accept tokens, like {var:name}.', 'Teclas digitadas aceitam tokens, como {var:name}.')}</span>}
    </Section>
  );
}

/**
 * ⑧ Keystroke and Hold Key ("Keystroke — captura no próprio painel"): the key, Press or Hold, and
 * for Press the times, the gap and its variation; for Hold, how long. Hold takes a single key, so
 * switching a combo to Hold keeps its last key and says so first.
 */
export function KeyEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const tt = useTt();
  const { language } = useLanguage();
  const id = step.id ?? '';
  const hold = step.actionType === 'HoldKey';
  const repeat = step.repeatCount ?? 1;
  const edit = (edits: StepEdit[]) => applyEdits(cmds, id, edits);
  const parts = splitCombo(step.key);
  const combo = !hold && parts.length > 1;
  const modifiers = parts.slice(0, -1).join('+');

  const setKey = (key: string) => edit([{ field: 'key', value: hold ? lastKey(key) : key }]);
  const setAction = (action: 'press' | 'hold') => {
    if (action === 'hold') edit([{ field: 'actionType', value: 'HoldKey' }, ...(combo ? [{ field: 'key', value: lastKey(step.key) }] : [])]);
    else edit([{ field: 'actionType', value: 'Keystroke' }]);
  };

  const gap = step.repeatDelayMs ?? DEFAULT_KEY_GAP_MS;
  const summary = !step.key ? 'Press a key or combo, or type one.'
    : hold ? `Holds ${keycaps(step.key)} for ${formatMs(step.holdDurationMs || DEFAULT_HOLD_MS, language)} ms.`
    : repeat > 1 ? `Presses ${keycaps(step.key)} ${repeat} times, ${formatMs(gap, language)} ms apart.`
    : `Presses ${keycaps(step.key)}.`;

  return (
    <>
      <KeyInput step={step} locked={locked} onKey={setKey} />
      <Section
        label="Action"
        hint={combo ? tt(`Hold takes one key: switching keeps ${lastKey(step.key)} and drops ${modifiers}.`,
                         `Hold pega uma tecla: trocar mantém ${lastKey(step.key)} e larga ${modifiers}.`) : undefined}
      >
        <Segmented<'press' | 'hold'>
          label="Keystroke mode"
          value={hold ? 'hold' : 'press'}
          options={[{ value: 'press', label: 'Press' }, { value: 'hold', label: 'Hold' }]}
          onChange={setAction}
          disabled={locked}
        />
      </Section>
      {hold ? (
        <Section label="Hold">
          <DraftField stepId={id} field="holdDurationMs" label="Hold duration in milliseconds" kind="int" min={10} max={60000} unit="ms" stored={String(step.holdDurationMs || DEFAULT_HOLD_MS)} disabled={locked} />
          <Chips values={HOLD_CHIPS} current={step.holdDurationMs || DEFAULT_HOLD_MS} onPick={(ms) => edit([{ field: 'holdDurationMs', value: String(ms) }])} disabled={locked} />
        </Section>
      ) : (
        <>
          <div className="insp-pair">
            <Section label="Times">
              <DraftField stepId={id} field="repeat" label="Times to repeat" kind="int" min={1} max={999} empty="min" unit="×" stored={String(repeat)} disabled={locked} />
            </Section>
            <Section label="Gap">
              <DraftField stepId={id} field="repeatDelayMs" label="Gap between presses" kind="int" min={0} max={5000} empty="clear" unit="ms" placeholder={String(DEFAULT_KEY_GAP_MS)} stored={step.repeatDelayMs == null ? '' : String(step.repeatDelayMs)} disabled={locked || repeat <= 1} />
            </Section>
          </div>
          <div className="insp-row">
            <Switch
              label="Vary the gap"
              tip={tt('Random ±% on each gap — less robotic.', 'Variação ±% aleatória em cada intervalo — menos robótico.')}
              checked={(step.repeatDelayJitterPct ?? 0) > 0}
              disabled={locked || repeat <= 1}
              onChange={(on) => edit([{ field: 'repeatDelayJitterPct', value: on ? '20' : '' }])}
            />
            <span className="insp-row-label">Vary the gap</span>
            {(step.repeatDelayJitterPct ?? 0) > 0 && (
              <span className="insp-row-end">
                <DraftField stepId={id} field="repeatDelayJitterPct" label="Gap jitter (%)" kind="int" min={1} max={100} prefix="±" unit="%" stored={String(step.repeatDelayJitterPct)} disabled={locked || repeat <= 1} />
              </span>
            )}
          </div>
        </>
      )}
      <p className="insp-summary" aria-live="polite">{summary}</p>
    </>
  );
}

/**
 * ⑧ A Key still being made (Key in the insert row or the catalog): listening from the start, or
 * typed. The step is born with its key at the insertion point it was asked for, and is then the
 * selection; Esc, × or another selection leave nothing behind.
 */
export function DraftKeyEditor({ draft, locked }: { draft: Draft; locked: boolean }) {
  const cmds = useSteps();
  const tt = useTt();
  const [typed, setTyped] = useState('');
  const add = (key: string) => {
    const k = key.trim();
    if (!k) return;
    arrival.expect(draft.at, draft.macro);
    cmds.insertKeystroke({ keystroke: k, insertIndex: draft.at });
    drafts.end();
  };
  const cancel = () => {
    drafts.end();
    arrival.clear();
    focusList();
  };
  return (
    <>
      <Section label="Key">
        <KeyCapture value="" label="Capture a key" autoListen onCapture={add} onCancel={cancel} disabled={locked} />
        <span className="insp-sublabel">Or type it</span>
        <label className="insp-box">
          <input
            type="text"
            className="insp-mono"
            aria-label="Type the key"
            placeholder="F5 · Ctrl+S · {var:name}"
            spellCheck={false}
            autoComplete="off"
            value={typed}
            disabled={locked}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              add(typed);
            }}
          />
        </label>
        <span className="insp-hint">{tt('Typed keys accept tokens, like {var:name}. Enter adds the step.', 'Teclas digitadas aceitam tokens, como {var:name}. Enter adiciona o passo.')}</span>
      </Section>
    </>
  );
}

/** ⑧ Key Down and Key Up — the halves a recording writes with "One step per click or key" off. */
export function KeyHalfEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const id = step.id ?? '';
  const edit = (edits: StepEdit[]) => applyEdits(cmds, id, edits);
  const down = step.actionType === 'KeyDown';
  return (
    <>
      <Section label="Action type">
        <Segmented<'KeyDown' | 'KeyUp'>
          label="Action type"
          value={down ? 'KeyDown' : 'KeyUp'}
          options={[{ value: 'KeyDown', label: 'Key Down' }, { value: 'KeyUp', label: 'Key Up' }]}
          onChange={(v) => edit([{ field: 'actionType', value: v }])}
          disabled={locked}
        />
      </Section>
      <KeyInput step={step} single locked={locked} onKey={(key) => edit([{ field: 'key', value: lastKey(key) }])} />
      <p className="insp-summary" aria-live="polite">
        {!step.key ? 'Press a key, or type one.' : down ? `Presses ${keycaps(step.key)} and keeps it down.` : `Releases ${keycaps(step.key)}.`}
      </p>
    </>
  );
}
