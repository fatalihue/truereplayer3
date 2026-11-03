import { useEffect, useState, type MouseEvent } from 'react';
import { preload, useLoaded } from '../lazyModule';
import { ChevronDown, MoreHorizontal, Play, Square } from 'lucide-react';
import { t } from '../../i18n';
import { useMacro } from '../../logic/useMacro';
import { useRecording } from '../../logic/useRecording';
import { useReplay } from '../../logic/useReplay';
import { keycaps } from '../library/model';
import { insertPoint } from '../list/selection';
import { macroMenuEntries } from '../macroMenu';
import { Menu } from '../Menu';
import { anchorBelow, type MenuAnchor } from '../menuAnchor';
import { useApp, useShell } from '../store';
import { loadRunProgress } from '../ui';
import { passesOf, runsPerRow } from './model';

// Record ▾ and Replay ▾ are not part of opening the app (rule 6). The chunk starts loading when the
// pointer or the focus reaches either ▾, so it is there by the press, and drawn on it (lazyModule).
// Nor is the progress, which shows only while a run is on (ui.ts, loadRunProgress).
const loadRunOptions = () => import('./RunOptions');
const loadNow = () => { void preload(loadRunOptions); };

interface Opened {
  anchor: MenuAnchor;
  button: HTMLElement;
  keyboard: boolean;
}

/**
 * ⑤ The transport. At rest: Record ▾ and Replay ×N ▾. Recording, Record turns into Stop; running,
 * Replay turns into Stop with the progress beside it. The engine says what may start
 * (buttonStates); the macro's menu ⋯ is the library's own.
 */
export function Transport({ name }: { name: string }) {
  const status = useApp(a => a.status);
  const buttons = useApp(a => a.buttonStates);
  const settings = useApp(a => a.settings);
  const clicker = settings.useCursorClick;
  const passes = useApp(a => passesOf(a.profileLoop, a.dataTable));
  const loop = useShell(s => s.live.loopProgress);
  const perRow = useApp(a => runsPerRow(a.dataTable));
  const recording = useRecording();
  // The new steps go after the selection, or at the end (the list's insertion point).
  const record = () => recording.toggleAt(insertPoint(useShell.getState().app.actions));
  const replay = useReplay();
  const [panel, setPanel] = useState<(Opened & { kind: 'record' | 'replay' }) | null>(null);
  const [menu, setMenu] = useState<Opened | null>(null);
  const RunOptions = useLoaded(loadRunOptions)?.default;
  const RunProgress = useLoaded(loadRunProgress)?.RunProgress;
  const replaying = status === 'replaying';
  useEffect(() => {
    if (replaying && !RunProgress) void preload(loadRunProgress);
  }, [replaying, RunProgress]);

  const openPanel = (kind: 'record' | 'replay') => (e: MouseEvent<HTMLButtonElement>) => {
    if (panel?.kind === kind) { setPanel(null); return; }
    const button = e.currentTarget;
    loadNow();
    setPanel({ kind, button, anchor: anchorBelow(button, 'end'), keyboard: e.detail === 0 });
  };
  const openMenu = (e: MouseEvent<HTMLButtonElement>) => {
    if (menu) { setMenu(null); return; }
    const button = e.currentTarget;
    setMenu({ button, anchor: anchorBelow(button, 'end'), keyboard: e.detail === 0 });
  };

  const isRecording = status === 'recording';
  const isReplaying = status === 'replaying';
  // In the Clicker mode the engine's Replay starts the Clicker, which has no page yet (phase 3): the
  // button waits for the macros to come back, and says how.
  const clickerTip = settings.modeToggleHotkey
    ? t('header.clickerOnKey', { keys: keycaps(settings.modeToggleHotkey) })
    : t('header.clickerOnRail');
  const count = perRow ? t('header.perRow') : passes > 1 ? `×${passes}` : null;

  return (
    <div className="hdr-transport">
      {isRecording ? (
        <button type="button" className="hdr-run" data-tone="record" data-busy="" onClick={record}>
          <Square aria-hidden="true" />
          {t('common.actions.stop')}
          {settings.recordingHotkey && <kbd className="kbd">{keycaps(settings.recordingHotkey)}</kbd>}
        </button>
      ) : (
        <div className="hdr-split" data-tone="record" data-disabled={!buttons.recordEnabled || undefined}>
          <button
            type="button"
            className="hdr-run"
            disabled={!buttons.recordEnabled}
            onClick={record}
          >
            <span className="hdr-rec-dot" aria-hidden="true" />
            {t('common.actions.record')}
          </button>
          {!isReplaying && (
            <button
              type="button"
              className="hdr-more"
              aria-label={t('header.recordOptions')}
              aria-haspopup="dialog"
              aria-expanded={panel?.kind === 'record'}
              onPointerEnter={loadNow}
              onFocus={loadNow}
              onClick={openPanel('record')}
            >
              <ChevronDown aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {isReplaying ? (
        <>
          <button type="button" className="hdr-run" data-tone={clicker ? 'clicker' : 'replay'} data-busy="" onClick={replay.toggle}>
            <Square aria-hidden="true" />
            {t('common.actions.stop')}
            {settings.replayHotkey && <kbd className="kbd">{keycaps(settings.replayHotkey)}</kbd>}
          </button>
          {RunProgress && <RunProgress />}
        </>
      ) : (
        <div className="hdr-split" data-tone="replay" data-disabled={!buttons.replayEnabled || clicker || isRecording || undefined}>
          <button
            type="button"
            className="hdr-run"
            disabled={!buttons.replayEnabled || clicker || isRecording}
            data-tip={clicker ? clickerTip : perRow ? t('header.perRowTip') : undefined}
            onClick={replay.toggle}
          >
            <Play aria-hidden="true" />
            {t('common.actions.replay')}
            {count && <span className="hdr-count">{count}</span>}
          </button>
          <button
            type="button"
            className="hdr-more"
            aria-label={t('header.runOptions')}
            aria-haspopup="dialog"
            aria-expanded={panel?.kind === 'replay'}
            onPointerEnter={loadNow}
            onFocus={loadNow}
            onClick={openPanel('replay')}
          >
            <ChevronDown aria-hidden="true" />
          </button>
        </div>
      )}
      {/* The last "Loop 3 of 3" stays after the run, until the next one starts, as in today's status bar (casca-122). */}
      {!isReplaying && !clicker && loop.active && (
        <span className="hdr-loop-done">{t('header.loopDone', { current: loop.current, total: loop.total === 0 ? '∞' : loop.total })}</span>
      )}

      <button
        type="button"
        className="hdr-menu"
        aria-label={t('header.macroActions')}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={openMenu}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>

      {panel && RunOptions && (
        <RunOptions kind={panel.kind} anchor={panel.anchor} toggle={panel.button} focusFirst={panel.keyboard} onClose={() => setPanel(null)} />
      )}
      {menu && <MacroActions name={name} opened={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** ⋯ in the header: the macro's own menu, the one its row in the library has. */
function MacroActions({ name, opened, onClose }: { name: string; opened: Opened; onClose: () => void }) {
  const profiles = useApp(a => a.profiles);
  const order = useApp(a => a.profileOrder);
  const locked = useShell(s => s.app.status !== 'ready');
  const clicker = useApp(a => a.settings.useCursorClick);
  const hasSteps = useApp(a => a.actions.length > 0);
  const macro = useMacro();
  return (
    <Menu
      anchor={opened.anchor}
      entries={macroMenuEntries({ name, profiles, order, active: name, locked, clicker, hasSteps, macro })}
      label={t('header.macroActions')}
      focusFirst={opened.keyboard}
      toggle={opened.button}
      onClose={onClose}
    />
  );
}
