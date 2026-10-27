import { useEffect, useRef, useState } from 'react';
import { AppWindow } from 'lucide-react';
import { useBridge } from '../../../bridge/BridgeContext';
import { useMacro } from '../../../logic/useMacro';
import { useTt } from '../../../state/LanguageContext';
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
  const tt = useTt();
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
    const field = boxRef.current?.querySelector<HTMLElement>('input[aria-label="Process"]');
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
  const live = useRef({ name, macro, showToast, tt, convert });
  useEffect(() => { live.current = { name, macro, showToast, tt, convert }; });
  useEffect(() => subscribe((message) => {
    const l = live.current;
    if (message.type === 'profile:windowTargetRemoved' && message.payload.name === l.name && removing.current) {
      const { label, target, flags: was } = removing.current;
      const { windowX, windowY, windowWidth, windowHeight } = message.payload;
      removing.current = null;
      l.showToast(l.tt(`Removed window target (${label}) from "${l.name}"`, `Janela-alvo (${label}) removida de "${l.name}"`), {
        type: 'success',
        duration: 10000,
        action: {
          label: 'Undo',
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

  const folderTip = inherited
    ? tt(`From the folder ‘${facts.targetFolder}’. Edit it there, or set a process or a title here for this macro's own.`,
      `Da pasta ‘${facts.targetFolder}’. Edite lá, ou defina um processo ou um título aqui para este macro ter o seu.`)
    : undefined;
  const switchesOff = locked || !own;

  return (
    <div ref={boxRef} className="mset-group">
      <span className="mset-title">Window target</span>
      {!editing && (facts.targetSource === null ? (
        <div className="mset-target" data-none="">
          <span className="mset-target-text">
            <span className="mset-target-name">None</span>
            <span className="mset-target-sub">Runs on whatever window is in front.</span>
          </span>
          <button type="button" className="insp-link" disabled={locked} onClick={() => setEditing(true)}>Add</button>
        </div>
      ) : (
        <div className="mset-target" data-inherited={inherited || undefined}>
          {facts.targetIcon
            ? <img className="mset-target-icon" src={`data:image/png;base64,${facts.targetIcon}`} alt="" />
            : <AppWindow className="mset-target-icon" aria-hidden="true" />}
          <span className="mset-target-text">
            <span className="mset-target-name">{value.processName || 'Any process'}</span>
            <span className="mset-target-sub">
              {titleCondition(value)}
              {inherited && <> · from ‘{facts.targetFolder}’</>}
            </span>
          </span>
          <button type="button" className="insp-link" disabled={locked} onClick={() => setEditing(true)}>Edit</button>
        </div>
      ))}
      {editing && (
        <>
          {inherited && (
            <p className="mset-target-note">
              The folder ‘{facts.targetFolder}’ gives this target. A process or a title typed here makes one of this macro's own.{' '}
              <button type="button" className="insp-link" onClick={() => openDialog({ kind: 'folderTarget', name: facts.targetFolder ?? '' })}>Edit the folder's</button>
            </p>
          )}
          <TargetFields id={`macro:${name}`} value={value} disabled={locked} onChange={(patch) => setRefused(save(patch))} />
          {refused && (
            <p className="mset-target-note" data-error="">
              {refused === 'regex'
                ? 'The title is not a valid regular expression, so it stays Contains.'
                : `A window target needs a process or a title.${own ? ' To have none, remove it.' : ''}`}
            </p>
          )}
        </>
      )}
      {facts.targetSource !== null && (
        <>
          <div className="insp-row">
            <Switch
              label="Bring to focus"
              checked={flags.bringToFocus}
              disabled={switchesOff}
              tip={folderTip ?? tt('Brings the window to the front before the run. With it on, the hotkey works from any window.', 'Traz a janela para a frente antes de rodar. Ligado, o atalho funciona de qualquer janela.')}
              onChange={(bringToFocus) => save({ bringToFocus })}
            />
            <span className="insp-row-label">Bring to focus</span>
          </div>
          <div className="insp-row">
            <Switch
              label="Relative coordinates"
              checked={flags.relative}
              disabled={switchesOff}
              tip={folderTip ?? tt('The points of the steps follow the window when it moves', 'Os pontos dos passos acompanham a janela quando ela se move')}
              onChange={turnRelative}
            />
            <span className="insp-row-label">Relative coordinates</span>
          </div>
        </>
      )}
      {convert && (
        <div className="mset-convert" role="status">
          <span>
            {convert.count} step{convert.count === 1 ? '' : 's'} captured in {convert.direction === 'toRelative' ? 'absolute' : 'relative'} coords.{' '}
            {convert.direction === 'toRelative'
              ? 'Convert to relative so they follow this window when it moves.'
              : 'Convert to absolute so they keep their current screen positions.'}
          </span>
          <span className="mset-convert-actions">
            <button
              type="button"
              className="insp-button"
              data-primary=""
              disabled={converting || locked}
              data-tip={locked ? tt('Not while a run is active', 'Não durante uma execução') : undefined}
              onClick={() => {
                setConverting(true);
                macro.convertCoordinates(convert.direction, name);
              }}
            >
              Convert
            </button>
            <button type="button" className="insp-button" onClick={() => { answered.current = true; setConvert(null); }}>Skip</button>
          </span>
        </div>
      )}
      {editing && facts.targetSource !== null && (
        <>
          <div className="insp-row">
            <Switch
              label="Restore position"
              checked={flags.restorePosition}
              disabled={switchesOff}
              tip={folderTip ?? tt('Puts the window back where it was captured, before the run', 'Devolve a janela à posição capturada, antes de rodar')}
              onChange={(restorePosition) => save({ restorePosition })}
            />
            <span className="insp-row-label">Restore position</span>
          </div>
          <div className="insp-row">
            <Switch
              label="Restore size"
              checked={flags.restoreSize}
              disabled={switchesOff}
              tip={folderTip ?? tt('Puts the window back to the captured size, before the run', 'Devolve a janela ao tamanho capturado, antes de rodar')}
              onChange={(restoreSize) => save({ restoreSize })}
            />
            <span className="insp-row-label">Restore size</span>
          </div>
          <button
            type="button"
            className="insp-button"
            disabled={locked || targetProblem(value) !== null}
            data-tip={tt('Reads where the window is now, and its size, for Restore position and Restore size', 'Lê agora onde a janela está e o tamanho dela, para Restore position e Restore size')}
            onClick={() => macro.updateWindowSize({ name, processName: value.processName || undefined, windowTitle: value.windowTitle || undefined, titleMatchMode: value.titleMatchMode })}
          >
            Update window size &amp; position
          </button>
        </>
      )}
      {editing && (
        <span className="mset-target-end">
          {own && <button type="button" className="insp-link" data-danger="" disabled={locked} onClick={remove}>Remove window target</button>}
          <button type="button" className="insp-link" onClick={() => setEditing(false)}>Done</button>
        </span>
      )}
    </div>
  );
}
