import { useState } from 'react';
import { AppWindow, Clipboard, Clock, Cpu, Dices, FileCheck, Globe, Image, Pipette, ScanText, Variable, type LucideIcon } from 'lucide-react';
import type { ActionItem } from '../../bridge/messageTypes';
import { useSteps } from '../../logic/useSteps';
import { Menu } from '../Menu';
import { anchorBelow, type MenuAnchor } from '../menuAnchor';
import { checkOf, checksFor, type Check, type ConditionType } from './checks';
import { DraftField, Section, Segmented } from './fields';
import { ImageProbe } from './ImageProbe';
import { applyEdits, type StepEdit } from './inspectorState';
import { BrowserCheck, PixelCheck, ScreenTextCheck } from './screenChecks';
import { ClipboardCheck, FileCheck as FileExistsCheck, ProcessCheck, RandomCheck, TimeCheck, VariableCheck, WindowCheck } from './stateChecks';

const MENU_ICONS: Record<ConditionType, LucideIcon> = {
  ImageFound: Image, PixelColorMatch: Pipette, ScreenText: ScanText, WindowOpen: AppWindow, ProcessRunning: Cpu,
  FileExists: FileCheck, ClipboardMatch: Clipboard, Variable, BrowserElementState: Globe, Random: Dices, TimeWindow: Clock,
};
const MAX_WAIT_MS = 86_400_000;
const MAX_ITERATIONS = 1_000_000;

/**
 * ⑧ If, Else If and While: one condition editor ("Condição — o mesmo editor em If, While, Assert e
 * Automations"; the Assert and the Automations take it in phase 2). The Check, and the change of it
 * — the engine drops the old check's settings in the same edit, so Ctrl+Z brings them back —; when
 * the step passes (found or not, met or not); how long to wait for it; a While's ceiling; what a
 * check that fails to run does; then the check's own fields.
 */
export function ConditionEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const id = step.id ?? '';
  const edit = (edits: StepEdit[]) => applyEdits(cmds, id, edits);
  const check = checkOf(step.conditionType);
  const negate = !!step.conditionNegate;
  const met = !check?.subject;

  return (
    <>
      <CheckSwitch step={step} check={check} locked={locked} onSwitch={(type) => edit([{ field: 'conditionType', value: type }])} />
      {check && (
        <>
          <Section label={met ? 'Passes when the check is' : `Passes when ${check.subject} is`}>
            <Segmented<'yes' | 'not'>
              label="Passes when"
              value={negate ? 'not' : 'yes'}
              disabled={locked}
              options={[{ value: 'yes', label: met ? 'Met' : 'Found' }, { value: 'not', label: met ? 'Not met' : 'Not found' }]}
              onChange={(v) => edit([{ field: 'conditionNegate', value: String(v === 'not') }])}
            />
          </Section>
          {/* A chance re-rolled until it hits is no wait at all. */}
          {check.type !== 'Random' && (
            <Section label="Wait for it" hint="0 = check once.">
              <DraftField stepId={id} field="conditionTimeout" label="Wait for it, in milliseconds" kind="int" step={500} min={0} max={MAX_WAIT_MS} empty="min" unit="ms" stored={String(step.conditionTimeout ?? 0)} disabled={locked} />
            </Section>
          )}
          {step.actionType === 'While' && (
            <Section label="Max iterations" hint="0 = the default, 1,000.">
              <DraftField stepId={id} field="loopMaxIterations" label="Maximum loop iterations" kind="int" min={0} max={MAX_ITERATIONS} empty="min" unit="×" stored={String(step.loopMaxIterations ?? 0)} disabled={locked} />
            </Section>
          )}
          <Section label="If the check itself errors">
            <Segmented<'false' | 'halt'>
              label="If the check itself errors"
              value={step.ifOnProbeError === 'Halt' ? 'halt' : 'false'}
              disabled={locked}
              options={[
                { value: 'false', label: met ? 'Treat as not met' : 'Treat as not found', tip: step.actionType === 'While' ? 'The loop ends' : 'The If goes the other way' },
                { value: 'halt', label: 'Stop the run' },
              ]}
              onChange={(v) => edit([{ field: 'ifOnProbeError', value: v === 'halt' ? 'Halt' : '' }])}
            />
          </Section>
          <div className="insp-rule" />
          <CheckFields check={check} step={step} locked={locked} />
        </>
      )}
    </>
  );
}

function CheckFields({ check, step, locked }: { check: Check; step: ActionItem; locked: boolean }) {
  switch (check.type) {
    case 'ImageFound': return <ImageProbe step={step} locked={locked} reads={step.conditionNegate ? 'not found' : 'found'} />;
    case 'PixelColorMatch': return <PixelCheck step={step} locked={locked} />;
    case 'ScreenText': return <ScreenTextCheck step={step} locked={locked} />;
    case 'WindowOpen': return <WindowCheck step={step} locked={locked} />;
    case 'ProcessRunning': return <ProcessCheck step={step} locked={locked} />;
    case 'FileExists': return <FileExistsCheck step={step} locked={locked} />;
    case 'ClipboardMatch': return <ClipboardCheck step={step} locked={locked} />;
    case 'Variable': return <VariableCheck step={step} locked={locked} />;
    case 'BrowserElementState': return <BrowserCheck step={step} locked={locked} />;
    case 'Random': return <RandomCheck step={step} locked={locked} />;
    case 'TimeWindow': return <TimeCheck step={step} locked={locked} />;
  }
}

/**
 * The Check of a step that has one: its name, and a menu of the others. A change says what it was,
 * since its settings go with it until Ctrl+Z.
 */
function CheckSwitch({ step, check, locked, onSwitch }: { step: ActionItem; check: Check | undefined; locked: boolean; onSwitch: (type: ConditionType) => void }) {
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; keyboard: boolean; button: HTMLButtonElement } | null>(null);
  const [was, setWas] = useState<string | null>(null);
  return (
    <Section label="Check" hint={was ? `Was ${was} · Ctrl+Z brings it back` : undefined}>
      <button
        type="button"
        className="insp-check-button"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        aria-label={`Check: ${check?.name ?? 'none'}`}
        disabled={locked}
        onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'start'), keyboard: e.detail === 0, button: e.currentTarget })}
      >
        {check && <span className="step-icon" data-icon={check.icon} />}
        <span className="insp-check-name">{check?.name ?? 'Choose a check'}</span>
        <span className="step-icon" data-icon="chevron-down" />
      </button>
      {menu && (
        <Menu
          anchor={menu.anchor}
          label="Checks"
          focusFirst={menu.keyboard}
          toggle={menu.button}
          onClose={() => setMenu(null)}
          entries={checksFor(step.actionType).map(c => ({
            label: c.name,
            icon: MENU_ICONS[c.type],
            checked: c.type === check?.type,
            tip: c.desc,
            onSelect: () => {
              if (c.type === check?.type) return;
              setWas(check?.name ?? null);
              onSwitch(c.type);
            },
          }))}
        />
      )}
    </Section>
  );
}
