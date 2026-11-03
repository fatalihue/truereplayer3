import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppWindow, CornerDownLeft, Zap } from 'lucide-react';
import type { ProfileEntry } from '../../bridge/messageTypes';
import { t } from '../../i18n';
import { useMacro } from '../../logic/useMacro';
import { lastRunKind } from '../../utils/lastRunChip';
import { keycaps, nameTaken, targetLabel } from '../library/model';
import { useApp, useShell } from '../store';
import { nameFocused, useUi } from '../ui';
import { isUntitledName } from '../untitled';
import {
  formatClock, formatDuration, lastRunText, onePassMs, passesOf, runsPerRow, stepCount,
} from './model';
import { Transport } from './Transport';
import { runSeconds, useNow } from './useNow';
import './header.css';

/**
 * ④ The open macro's header: its name, typed where it shows; what fires it; what a run of it costs
 * and how the last one went; and ⑤ the transport — Record ▾, Replay ▾ and the macro's menu.
 */
export function MacroHeader() {
  const open = useApp(a => a.activeProfile);
  const locked = useApp(a => a.status !== 'ready');
  if (!open) return null;
  return (
    <header className="hdr" aria-label={t('header.region')}>
      <MacroTitle name={open} locked={locked} chips={<MacroChips name={open} />} meta={<MacroMeta name={open} />} />
      <Transport name={open} />
    </header>
  );
}

/**
 * The name, an input that reads as the title (biblioteca-064). A new macro arrives as "Untitled
 * macro", saved already, and New macro gives this field the focus with the name selected. Enter or
 * leaving renames; Esc puts the name back. A name another macro has (without case: names are files)
 * is not sent, and the line under the name says why.
 */
function MacroTitle({ name, locked, chips, meta }: { name: string; locked: boolean; chips: ReactNode; meta: ReactNode }) {
  const nameFocus = useUi(s => s.nameFocus);
  const macro = useMacro();
  const field = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  const [draft, setDraft] = useState<{ text: string; of: string; typing: boolean } | null>(null);
  // The other names matter only while one is typed: the title does not follow the library otherwise.
  const profiles = useApp(a => (draft?.typing ? a.profiles : null));
  // Another macro opened (or this one took the new name): what was typed belonged to the old one.
  if (draft && draft.of !== name) setDraft(null);
  useEffect(() => {
    if (!draft || draft.typing) return;
    // Sent, and the engine kept the old name (it said why in a toast): show the name it has.
    const id = setTimeout(() => setDraft(null), 1500);
    return () => clearTimeout(id);
  }, [draft]);

  useEffect(() => {
    if (nameFocus !== name) return;
    nameFocused();
    field.current?.focus({ preventScroll: true });
    field.current?.select();
  }, [nameFocus, name]);

  const typed = draft?.typing ? draft.text : null;
  const taken = typed !== null && profiles !== null && nameTaken(typed, profiles.map(p => p.name), name);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (!draft?.typing) return;
    const next = draft.text.trim();
    if (!next || next === name || taken) {
      setDraft(null);
      return;
    }
    macro.rename(name, next);
    setDraft({ text: next, of: name, typing: false });
  };

  // A new macro's name, the one the app gave it (in either language): the field says it can be typed over.
  const note = taken
    ? <p className="hdr-meta" data-error="">{t('header.name.taken')}</p>
    : isUntitledName(name) && typed === null
      ? <p className="hdr-meta">{t('header.name.untitled')}</p>
      : null;

  return (
    <div className="hdr-title">
      <div className="hdr-line">
        <h1 className="hdr-name">
          <input
            ref={field}
            className="hdr-name-field"
            aria-label={t('header.name.label')}
            spellCheck={false}
            autoComplete="off"
            value={draft ? draft.text : name}
            readOnly={locked}
            aria-invalid={taken || undefined}
            onChange={(e) => setDraft({ text: e.target.value, of: name, typing: true })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape' && draft?.typing) {
                e.preventDefault();
                cancelled.current = true;
                setDraft(null);
                e.currentTarget.blur();
              }
            }}
            onBlur={commit}
          />
        </h1>
        {chips}
      </div>
      {note ?? meta}
    </div>
  );
}

/**
 * What fires the macro, as chips that only show: its hotkey, its hotstring, its window target and
 * its automation. They are changed in the Inspector (phase 2).
 */
function MacroChips({ name }: { name: string }) {
  const entry = useApp(a => a.profiles.find(p => p.name === name));
  const automationsOn = useApp(a => a.automation.enabled);
  if (!entry) return null;
  return (
    <>
      {entry.hotkey && (
        <span
          className="hdr-chip"
          data-kind="hotkey"
          data-conflict={entry.hotkeyConflict || undefined}
          // "Hotkey" is the same in both languages (glossary).
          data-tip={entry.hotkeyConflict ? t('header.chips.hotkeyConflict') : 'Hotkey'}
        >
          {keycaps(entry.hotkey)}
        </span>
      )}
      {entry.hotstring && (
        <span
          className="hdr-chip"
          data-kind="hotstring"
          data-tip={entry.hotstringInstant ? t('header.chips.hotstringInstant') : t('header.chips.hotstringOnEnd')}
        >
          {entry.hotstringInstant ? <Zap aria-hidden="true" /> : <CornerDownLeft aria-hidden="true" />}
          <bdi>{entry.hotstring}</bdi>
        </span>
      )}
      {entry.hasEffectiveTarget && <TargetChip entry={entry} />}
      {entry.hasTrigger && (
        <span
          className="hdr-chip"
          data-kind="automation"
          data-armed={(entry.triggerArmed && automationsOn) || undefined}
          data-tip={!entry.triggerArmed
            ? t('header.chips.automationNotArmed')
            : automationsOn ? t('header.chips.automationArmed') : t('header.chips.automationsOff')}
        >
          <Zap aria-hidden="true" />
          {t('header.chips.automation')}
        </span>
      )}
    </>
  );
}

/** The window it targets, by the name people know it by: the title it matches, else the app. */
function TargetChip({ entry }: { entry: ProfileEntry }) {
  const process = entry.effectiveTargetProcessName;
  const title = entry.effectiveTargetWindowTitle;
  const shown = title || (process ? process.replace(/\.exe$/i, '') : '') || t('header.chips.window');
  const folder = entry.effectiveTargetSource === 'folder' ? entry.effectiveTargetFolderName : null;
  const what = targetLabel(process, title) + (process && title ? ` · “${title}”` : '');
  return (
    <span
      className="hdr-chip"
      data-kind="target"
      data-inherited={folder != null || undefined}
      data-tip={folder != null
        ? t('header.chips.targetFromFolder', { folder, what })
        : t('header.chips.target', { what })}
    >
      <AppWindow aria-hidden="true" />
      <bdi>{shown}</bdi>
    </span>
  );
}

// Where the user's own text goes in a sentence of the catalog: a character no name has.
const CUT = '\u0001';

/**
 * The line under the name: the steps, what one pass costs, and how the last run of this macro went
 * ("18 steps · about 3.5 s per loop · last run 14:02, no errors"). Recording, it is the recording's
 * own clock and count.
 */
function MacroMeta({ name }: { name: string }) {
  const status = useApp(a => a.status);
  const actions = useApp(a => a.actions);
  const loop = useApp(a => a.profileLoop);
  const table = useApp(a => a.dataTable);
  const lastRun = useShell(s => s.lastRun);
  const dataTab = useUi(s => s.macroTab === 'data');
  if (status === 'recording') return <RecordingMeta steps={actions.length} />;
  // On the Data Loop tab, in the mode that walks the rows one run at a time: the row the next
  // replay uses ("18 steps · next replay uses row 3, João Pereira").
  if (dataTab && !table.loopOverData && table.rows.length > 0) {
    const row = Math.max(0, table.cursorRow ?? 0);
    const first = table.rows[row]?.find(cell => cell.trim() !== '')?.trim();
    if (!first) return <p className="hdr-meta">{t('header.meta.nextRow', { count: actions.length, row: row + 1 })}</p>;
    // The row's first value is the user's: isolated in a <bdi>, where the catalog's sentence puts it.
    const [before, after = ''] = t('header.meta.nextRowNamed', { count: actions.length, row: row + 1, name: CUT }).split(CUT);
    return <p className="hdr-meta">{before}<bdi>{first}</bdi>{after}</p>;
  }
  if (actions.length === 0) return <p className="hdr-meta">{t('header.meta.noSteps')}</p>;
  const pass = onePassMs(actions);
  const perRow = runsPerRow(table);
  const passes = passesOf(loop, table);
  const duration = formatDuration(pass);
  const about = perRow ? t('header.meta.aboutPerRow', { duration })
    : passes > 1 ? t('header.meta.aboutPerLoop', { duration })
    : t('header.meta.about', { duration });
  const estimateTip = passes <= 1 ? t('header.meta.estimateWhy')
    : perRow ? t('header.meta.estimateRows', { count: passes, duration: formatDuration(pass * passes) })
    : t('header.meta.estimateLoops', { count: passes, duration: formatDuration(pass * passes) });
  const run = status === 'ready' && lastRun && lastRun.profile === name ? lastRun : null;
  return (
    <p className="hdr-meta">
      {stepCount(actions.length)}
      {' · '}
      <span data-tip={estimateTip}>{about}</span>
      {run && (
        <>
          {' · '}
          <span data-run={lastRunKind(run)}>{lastRunText(run, name)}</span>
        </>
      )}
    </p>
  );
}

function RecordingMeta({ steps }: { steps: number }) {
  const clock = useShell(s => s.runClock);
  const now = useNow(true);
  return (
    <p className="hdr-meta" data-recording="">
      {t('header.meta.recording', { clock: formatClock(runSeconds(clock, now)), count: steps })}
    </p>
  );
}
