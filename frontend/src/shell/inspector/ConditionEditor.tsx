import { useState } from 'react';
import { AppWindow, Clipboard, Clock, Cpu, Dices, FileCheck, Globe, Image, Pipette, ScanText, Variable, type LucideIcon } from 'lucide-react';
import type { ActionItem } from '../../bridge/messageTypes';
import { fmtNum, t, tn } from '../../i18n';
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
// A While's ceiling when its own is 0 (the engine's default).
const DEFAULT_ITERATIONS = 1000;

/**
 * What a condition passes on, in the words of its subject (the catalog's conditions.verdict): the label
 * over the two answers, the answers, and the answer for a check that errors. One whole phrase per
 * subject, so each language agrees in gender ("Passes when the image is" + "Found", "Passa com o
 * processo" + "Encontrado"); the checks with no subject of their own read "the check is" … "Met".
 */
type Verdict = Readonly<Record<'passesWhen' | 'yes' | 'no' | 'treatAsNo', string>>;
const MET = tn('conditions.verdict.check');
const VERDICTS: Record<ConditionType, Verdict> = {
  ImageFound: tn('conditions.verdict.image'),
  PixelColorMatch: tn('conditions.verdict.color'),
  ScreenText: MET,
  WindowOpen: tn('conditions.verdict.window'),
  ProcessRunning: tn('conditions.verdict.process'),
  FileExists: tn('conditions.verdict.file'),
  ClipboardMatch: MET,
  Variable: MET,
  BrowserElementState: tn('conditions.verdict.element'),
  Random: MET,
  TimeWindow: MET,
};

/**
 * ⑧ If, Else If, While and Assert: one condition editor ("Condição — o mesmo editor em If, While,
 * Assert e Automations"; the Automations take it in phase 3). The Check, and the change of it —
 * the engine drops the old check's settings in the same edit, so Ctrl+Z brings them back —; when
 * the step passes (found or not, met or not); how long to wait for it; a While's ceiling; what a
 * check that fails to run does, or for an Assert what a failure does (the engine treats a check
 * that cannot run as failed there); then the check's own fields.
 */
export function ConditionEditor({ step, locked }: { step: ActionItem; locked: boolean }) {
  const cmds = useSteps();
  const id = step.id ?? '';
  const edit = (edits: StepEdit[]) => applyEdits(cmds, id, edits);
  const check = checkOf(step.conditionType);
  const verdict = check ? VERDICTS[check.type] : undefined;
  const negate = !!step.conditionNegate;
  const assert = step.actionType === 'Assert';

  return (
    <>
      <CheckSwitch step={step} check={check} locked={locked} onSwitch={(type) => edit([{ field: 'conditionType', value: type }])} />
      {check && verdict && (
        <>
          <Section label={verdict.passesWhen}>
            <Segmented<'yes' | 'not'>
              label={t('conditions.passesWhen')}
              value={negate ? 'not' : 'yes'}
              disabled={locked}
              options={[{ value: 'yes', label: verdict.yes }, { value: 'not', label: verdict.no }]}
              onChange={(v) => edit([{ field: 'conditionNegate', value: String(v === 'not') }])}
            />
          </Section>
          {/* A chance re-rolled until it hits is no wait at all. */}
          {check.type !== 'Random' && (
            <Section label={t('conditions.waitFor')} hint={t('conditions.waitForHint')}>
              <DraftField stepId={id} field="conditionTimeout" label={t('conditions.waitForField')} kind="int" step={500} min={0} max={MAX_WAIT_MS} unit="ms" stored={String(step.conditionTimeout ?? 0)} disabled={locked} />
            </Section>
          )}
          {step.actionType === 'While' && (
            <Section label={t('conditions.maxIterations')} hint={t('conditions.maxIterationsHint', { n: fmtNum(DEFAULT_ITERATIONS) })}>
              <DraftField stepId={id} field="loopMaxIterations" label={t('conditions.maxIterationsField')} kind="int" min={0} max={MAX_ITERATIONS} unit="×" stored={String(step.loopMaxIterations ?? 0)} disabled={locked} />
            </Section>
          )}
          {assert ? (
            <Section label={t('conditions.onFailure')} hint={t('conditions.onFailureHint')}>
              <Segmented<'abort' | 'continue' | 'quiet'>
                label={t('conditions.onFailureGroup')}
                value={step.assertOnFail === 'Continue' ? 'continue' : step.assertOnFail === 'StopReplay' ? 'quiet' : 'abort'}
                disabled={locked}
                options={[
                  { value: 'abort', label: t('conditions.abort'), tip: t('conditions.abortTip') },
                  { value: 'continue', label: t('common.actions.continue'), tip: t('conditions.continueTip') },
                  { value: 'quiet', label: t('conditions.stopQuietly'), tip: t('conditions.stopQuietlyTip') },
                ]}
                onChange={(v) => edit([{ field: 'assertOnFail', value: v === 'continue' ? 'Continue' : v === 'quiet' ? 'StopReplay' : '' }])}
              />
            </Section>
          ) : (
            <Section label={t('conditions.onError')}>
              <Segmented<'false' | 'halt'>
                label={t('conditions.onError')}
                value={step.ifOnProbeError === 'Halt' ? 'halt' : 'false'}
                disabled={locked}
                options={[
                  { value: 'false', label: verdict.treatAsNo, tip: step.actionType === 'While' ? t('conditions.loopEnds') : t('conditions.ifOtherWay') },
                  { value: 'halt', label: t('conditions.stopRun') },
                ]}
                onChange={(v) => edit([{ field: 'ifOnProbeError', value: v === 'halt' ? 'Halt' : '' }])}
              />
            </Section>
          )}
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
    case 'PixelColorMatch': return <PixelCheck step={step} locked={locked} reads={step.conditionNegate ? 'not found' : 'found'} />;
    case 'ScreenText': return <ScreenTextCheck step={step} locked={locked} reads={step.conditionNegate ? 'not found' : 'found'} />;
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
    <Section label={t('conditions.check')} hint={was ? t('conditions.was', { name: was }) : undefined}>
      <button
        type="button"
        className="insp-check-button"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        aria-label={check ? t('conditions.checkNamed', { name: check.name }) : t('conditions.checkNone')}
        disabled={locked}
        onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'start'), keyboard: e.detail === 0, button: e.currentTarget })}
      >
        {check && <span className="step-icon" data-icon={check.icon} />}
        <span className="insp-check-name" data-glossary={check ? '' : undefined}>{check?.name ?? t('conditions.choose')}</span>
        <span className="step-icon" data-icon="chevron-down" />
      </button>
      {menu && (
        <Menu
          anchor={menu.anchor}
          label={t('conditions.list')}
          focusFirst={menu.keyboard}
          toggle={menu.button}
          onClose={() => setMenu(null)}
          entries={checksFor(step.actionType).map(c => ({
            label: c.name,
            named: true,
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
