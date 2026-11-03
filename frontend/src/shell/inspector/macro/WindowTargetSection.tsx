import { useEffect, useRef, useState } from 'react';
import { AppWindow } from 'lucide-react';
import { useBridge } from '../../../bridge/BridgeContext';
import { fmtNum, t } from '../../../i18n';
import { useMacro } from '../../../logic/useMacro';
import { useToast } from '../../../state/ToastContext';
import { targetLabel } from '../../library/model';
import { useShell } from '../../store';
import { openDialog, settingsFocused, type SettingsSection } from '../../ui';
import { Switch } from '../fields';
import type { MacroFacts } from './facts';
import { convertibleSteps, targetProblem, titleCondition, type TargetValue } from './target';
import { TargetFields } from './TargetFields';

type Flags = { relative: boolean; bringToFocus: boolean; restorePosition: boolean; restoreSize: boolean };
type Removed = { label: string; target: TargetValue; flags: Flags };

/**
 * Macro settings › Window target (Macro settings board: "Roblox · RobloxPlayerBeta.exe · title
 * contains “Roblox” · Edit · Bring to focus · Relative coordinates"). Everything applies as it
 * changes, and Ctrl+Z undoes it: the engine keeps the target in the open macro's history. A target
 * the folder gives shows where it comes from, and its switches stay the folder's; a process or a
 * title typed here gives the macro its own, starting from the folder's switches. Removing is at once,
 * with the toast that puts it all back, once the engine confirms it (it refuses a removal that would
 * make two hotkeys collide). Turning Relative coordinates with steps that hold points offers to
 * convert them, the setting already saved (dialogos-044 to 047).
 */
export function WindowTargetSection({ facts, locked, focus }: { facts: MacroFacts; locked: boolean; focus: { section: SettingsSection; seq: number } | null }) {
  const macro = useMacro();
  const { showToast } = useToast();
  const { subscribe } = useBridge();
  const name = facts.name;
  const own = facts.targetSource === 'own';
  const inherited = facts.targetSource === 'folder';
  const value: TargetValue = { processName: facts.targetProcess, windowTitle: facts.targetTitle, titleMatchMode: facts.targetMode };
  const flags: Flags = {
    relative: facts.targetRelative,
    bringToFocus: facts.targetBringToFocus,
    restorePosition: facts.targetRestorePosition,
    restoreSize: facts.targetRestoreSize,
  };

  // Edit opens the fields here (and Window target… from the macro's menu does, with the focus on them).
  const [editing, setEditing] = useState(false);
  if (focus?.section === 'target' && !editing) setEditing(true);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus?.section !== 'target') return;
    const field = boxRef.current?.querySelector<HTMLElement>(`input[aria-label="${t('macroSettings.fields.process')}"]`);
    field?.focus();
    field?.scrollIntoView({ block: 'nearest' });
    settingsFocused();
  }, [focus]);

  /** Applies the change, or answers why it cannot be a target (and sends nothing). */
  const save = (patch: Partial<TargetValue & Flags>): 'empty' | 'regex' | null => {
    const next = { ...value, ...flags, ...patch };
    const target = { processName: next.processName.trim(), windowTitle: next.windowTitle.trim(), titleMatchMode: next.titleMatchMode };
    const problem = targetProblem(target);
    if (problem) return problem;
    macro.setWindowTarget({
      name, ...target,
      relativeCoordinates: next.relative,
      bringToFocus: next.bringToFocus,
      restorePosition: next.restorePosition,
      restoreSize: next.restoreSize,
      keepInheritedTarget: false,
    });
    return null;
  };

  // The conversion offered after Relative coordinates turns (dialogos-044): the steps are still in
  // `space`. Converting or skipping ends the offer for as long as these settings stay open.
  const [convert, setConvert] = useState<{ direction: 'toRelative' | 'toAbsolute'; count: number } | null>(null);
  const [converting, setConverting] = useState(false);
  const space = useRef(facts.targetRelative);
  const answered = useRef(false);
  // Back in the steps' space once the value moves (Ctrl+Z, or turned back): nothing to convert.
  const [seenRelative, setSeenRelative] = useState(facts.targetRelative);
  if (facts.targetRelative !== seenRelative) {
    setSeenRelative(facts.targetRelative);
    if (facts.targetRelative === space.current) setConvert(null);
  }
  // A change that cannot be a target (a process and a title both emptied, Regex over a title that
  // does not compile) is not sent: it says why.
  const [refused, setRefused] = useState<'empty' | 'regex' | null>(null);
  const turnRelative = (on: boolean) => {
    if (save({ relative: on }) || answered.current) return;
    const count = convertibleSteps(useShell.getState().app.actions);
    setConvert(count > 0 && on !== space.current ? { direction: on ? 'toRelative' : 'toAbsolute', count } : null);
  };

  const removing = useRef<Removed | null>(null);
  const live = useRef({ name, macro, showToast, convert });
  useEffect(() => { live.current = { name, macro, showToast, convert }; });
  useEffect(() => subscribe((message) => {
    const l = live.current;
    if (message.type === 'profile:windowTargetRemoved' && message.payload.name === l.name && removing.current) {
      const { label, target, flags: was } = removing.current;
      const { windowX, windowY, windowWidth, windowHeight } = message.payload;
      removing.current = null;
      l.showToast(t('macroSettings.target.removed', { target: label, name: l.name }), {
        type: 'success',
        duration: 10000,
        action: {
          label: t('common.actions.undo'),
          onClick: () => l.macro.setWindowTarget({
            name: l.name, ...target,
            relativeCoordinates: was.relative, bringToFocus: was.bringToFocus, restorePosition: was.restorePosition, restoreSize: was.restoreSize,
            // The captured rect the removal zeroed, from the confirmation: the library has no geometry.
            windowX, windowY, windowWidth, windowHeight,
          }),
        },
      });
    } else if (message.type === 'windowTarget:applyConvertCompleted') {
      setConverting(false);
      // A refusal already said why; the offer stays.
      if (!message.payload.ok || !l.convert) return;
      space.current = l.convert.direction === 'toRelative';
      answered.current = true;
      setConvert(null);
    }
  }), [subscribe]);
  const remove = () => {
    removing.current = { label: targetLabel(value.processName, value.windowTitle), target: value, flags };
    setEditing(false);
    macro.removeWindowTarget(name);
  };

  const folder = facts.targetFolder ?? '';
  const folderTip = inherited ? t('macroSettings.target.folderTip', { folder }) : undefined;
  const switchesOff = locked || !own;

  return (
    <div ref={boxRef} className="mset-group">
      <span className="mset-title">{t('macroSettings.target.title')}</span>
      {!editing && (facts.targetSource === null ? (
        <div className="mset-target" data-none="">
          <span className="mset-target-text">
            <span className="mset-target-name">{t('macroSettings.target.none')}</span>
            <span className="mset-target-sub">{t('macroSettings.target.noneSub')}</span>
          </span>
          <button type="button" className="insp-link" disabled={locked} onClick={() => setEditing(true)}>{t('macroSettings.target.add')}</button>
        </div>
      ) : (
        <div className="mset-target" data-inherited={inherited || undefined}>
          {facts.targetIcon
            ? <img className="mset-target-icon" src={`data:image/png;base64,${facts.targetIcon}`} alt="" />
            : <AppWindow className="mset-target-icon" aria-hidden="true" />}
          <span className="mset-target-text">
            <span className="mset-target-name">{value.processName || t('macroSettings.target.anyProcess')}</span>
            <span className="mset-target-sub">
              {titleCondition(value)}
              {inherited && <> · {t('macroSettings.target.fromFolder', { folder })}</>}
            </span>
          </span>
          <button type="button" className="insp-link" disabled={locked} onClick={() => setEditing(true)}>{t('common.actions.edit')}</button>
        </div>
      ))}
      {editing && (
        <>
          {inherited && (
            <p className="mset-target-note">
              {t('macroSettings.target.folderNote', { folder })}{' '}
              <button type="button" className="insp-link" onClick={() => openDialog({ kind: 'folderTarget', name: folder })}>{t('macroSettings.target.editFolder')}</button>
            </p>
          )}
          <TargetFields id={`macro:${name}`} value={value} disabled={locked} onChange={(patch) => setRefused(save(patch))} />
          {refused && (
            <p className="mset-target-note" data-error="">
              {refused === 'regex'
                ? t('macroSettings.target.invalidRegex')
                : own ? t('macroSettings.target.needsTargetOwn') : t('macroSettings.target.needsTarget')}
            </p>
          )}
        </>
      )}
      {facts.targetSource !== null && (
        <>
          <div className="insp-row">
            <Switch
              label={t('macroSettings.target.focus')}
              checked={flags.bringToFocus}
              disabled={switchesOff}
              tip={folderTip ?? t('macroSettings.target.focusTip')}
              onChange={(bringToFocus) => save({ bringToFocus })}
            />
            <span className="insp-row-label">{t('macroSettings.target.focus')}</span>
          </div>
          <div className="insp-row">
            <Switch
              label={t('macroSettings.target.relative')}
              checked={flags.relative}
              disabled={switchesOff}
              tip={folderTip ?? t('macroSettings.target.relativeTip')}
              onChange={turnRelative}
            />
            <span className="insp-row-label">{t('macroSettings.target.relative')}</span>
          </div>
        </>
      )}
      {convert && (
        <div className="mset-convert" role="status">
          <span>
            {convert.direction === 'toRelative'
              ? t('macroSettings.target.convertToRelative', { count: convert.count, n: fmtNum(convert.count) })
              : t('macroSettings.target.convertToAbsolute', { count: convert.count, n: fmtNum(convert.count) })}
          </span>
          <span className="mset-convert-actions">
            <button
              type="button"
              className="insp-button"
              data-primary=""
              disabled={converting || locked}
              data-tip={locked ? t('macroSettings.target.notWhileRunning') : undefined}
              onClick={() => {
                setConverting(true);
                macro.convertCoordinates(convert.direction, name);
              }}
            >
              {t('macroSettings.target.convert')}
            </button>
            <button type="button" className="insp-button" onClick={() => { answered.current = true; setConvert(null); }}>{t('macroSettings.target.skip')}</button>
          </span>
        </div>
      )}
      {editing && facts.targetSource !== null && (
        <>
          <div className="insp-row">
            <Switch
              label={t('macroSettings.target.restorePosition')}
              checked={flags.restorePosition}
              disabled={switchesOff}
              tip={folderTip ?? t('macroSettings.target.restorePositionTip')}
              onChange={(restorePosition) => save({ restorePosition })}
            />
            <span className="insp-row-label">{t('macroSettings.target.restorePosition')}</span>
          </div>
          <div className="insp-row">
            <Switch
              label={t('macroSettings.target.restoreSize')}
              checked={flags.restoreSize}
              disabled={switchesOff}
              tip={folderTip ?? t('macroSettings.target.restoreSizeTip')}
              onChange={(restoreSize) => save({ restoreSize })}
            />
            <span className="insp-row-label">{t('macroSettings.target.restoreSize')}</span>
          </div>
          <button
            type="button"
            className="insp-button"
            disabled={locked || targetProblem(value) !== null}
            data-tip={t('macroSettings.target.updateTip')}
            onClick={() => macro.updateWindowSize({ name, processName: value.processName || undefined, windowTitle: value.windowTitle || undefined, titleMatchMode: value.titleMatchMode })}
          >
            {t('macroSettings.target.update')}
          </button>
        </>
      )}
      {editing && (
        <span className="mset-target-end">
          {own && <button type="button" className="insp-link" data-danger="" disabled={locked} onClick={remove}>{t('macroSettings.target.remove')}</button>}
          <button type="button" className="insp-link" onClick={() => setEditing(false)}>{t('common.actions.done')}</button>
        </span>
      )}
    </div>
  );
}
