import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppWindow, CornerDownLeft, Zap } from 'lucide-react';
import type { ProfileEntry } from '../../bridge/messageTypes';
import { useMacro } from '../../logic/useMacro';
import { useLanguage, useTt } from '../../state/LanguageContext';
import { lastRunKind } from '../../utils/lastRunChip';
import { keycaps, nameTaken, targetLabel } from '../library/model';
import { useApp, useShell } from '../store';
import { nameFocused, useUi } from '../ui';
import {
  formatClock, formatDuration, lastRunOutcome, onePassMs, passesOf, runsPerRow, stepCount, timeOfDay,
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
    <header className="hdr" aria-label="Macro">
      <MacroTitle name={open} locked={locked} chips={<MacroChips name={open} />} meta={<MacroMeta name={open} />} />
      <Transport name={open} />
    </header>
  );
}

// The names the engine gives a new macro: the field says it can be typed over.
const UNTITLED = /^Untitled macro( \d+)?$/;

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

  const note = taken
    ? <p className="hdr-meta" data-error="">A macro with that name already exists.</p>
    : UNTITLED.test(name) && typed === null
      ? <p className="hdr-meta">Type a name. It's saved already.</p>
      : null;

  return (
    <div className="hdr-title">
      <div className="hdr-line">
        <h1 className="hdr-name">
          <input
            ref={field}
            className="hdr-name-field"
            aria-label="Macro name"
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
  const tt = useTt();
  if (!entry) return null;
  return (
    <>
      {entry.hotkey && (
        <span
          className="hdr-chip"
          data-kind="hotkey"
          data-conflict={entry.hotkeyConflict || undefined}
          data-tip={entry.hotkeyConflict
            ? tt('Another macro uses this hotkey for the same window — only one fires',
                 'Outro macro usa este hotkey na mesma janela — só um dispara')
            : tt('Hotkey', 'Hotkey')}
        >
          {keycaps(entry.hotkey)}
        </span>
      )}
      {entry.hotstring && (
        <span
          className="hdr-chip"
          data-kind="hotstring"
          data-tip={entry.hotstringInstant
            ? tt('Hotstring — fires as you type it', 'Hotstring — dispara ao digitar')
            : tt('Hotstring — fires on Enter, Space or Tab', 'Hotstring — dispara com Enter, Espaço ou Tab')}
        >
          {entry.hotstringInstant ? <Zap aria-hidden="true" /> : <CornerDownLeft aria-hidden="true" />}
          <bdi>{entry.hotstring}</bdi>
        </span>
      )}
      {entry.hasEffectiveTarget && <TargetChip entry={entry} tt={tt} />}
      {entry.hasTrigger && (
        <span
          className="hdr-chip"
          data-kind="automation"
          data-armed={(entry.triggerArmed && automationsOn) || undefined}
          data-tip={!entry.triggerArmed
            ? tt('Its automation is not armed', 'A automação dele não está armada')
            : automationsOn
              ? tt('Its automation is armed', 'A automação dele está armada')
              : tt('Automations are switched off', 'As automações estão desligadas')}
        >
          <Zap aria-hidden="true" />
          1 automation
        </span>
      )}
    </>
  );
}

/** The window it targets, by the name people know it by: the title it matches, else the app. */
function TargetChip({ entry, tt }: { entry: ProfileEntry; tt: (en: string, pt: string) => string }) {
  const process = entry.effectiveTargetProcessName;
  const title = entry.effectiveTargetWindowTitle;
  const shown = title || (process ? process.replace(/\.exe$/i, '') : '') || 'Window';
  const folder = entry.effectiveTargetSource === 'folder' ? entry.effectiveTargetFolderName : null;
  const what = targetLabel(process, title) + (process && title ? ` · “${title}”` : '');
  return (
    <span
      className="hdr-chip"
      data-kind="target"
      data-inherited={folder != null || undefined}
      data-tip={folder != null
        ? tt(`Window target, from the folder ${folder}: ${what}`, `Janela-alvo, da pasta ${folder}: ${what}`)
        : tt(`Window target: ${what}`, `Janela-alvo: ${what}`)}
    >
      <AppWindow aria-hidden="true" />
      <bdi>{shown}</bdi>
    </span>
  );
}

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
  const tt = useTt();
  const { language } = useLanguage();
  if (status === 'recording') return <RecordingMeta steps={actions.length} />;
  if (actions.length === 0) return <p className="hdr-meta">No steps yet</p>;
  const pass = onePassMs(actions);
  const perRow = runsPerRow(table);
  const passes = passesOf(loop, table);
  const per = perRow ? ' per row' : passes > 1 ? ' per loop' : '';
  const why = tt('Delays + ~30 ms per step, plus holds and × N gaps. Moves and waits are not counted.',
                 'Atrasos + ~30 ms por passo, mais holds e os intervalos do × N. Movimentos e esperas não entram.');
  const estimateTip = passes > 1
    ? tt(`${passes} ${perRow ? 'rows' : 'loops'}: about ${formatDuration(pass * passes, language)} in all. `, `${passes} ${perRow ? 'linhas' : 'loops'}: cerca de ${formatDuration(pass * passes, language)} no total. `) + why
    : why;
  const run = status === 'ready' && lastRun && lastRun.profile === name ? lastRun : null;
  return (
    <p className="hdr-meta">
      {stepCount(actions.length)}
      {' · '}
      <span data-tip={estimateTip}>about {formatDuration(pass, language)}{per}</span>
      {run && (
        <>
          {' · '}
          <span data-run={lastRunKind(run)}>last run {timeOfDay(run.startedAt)}, {lastRunOutcome(run, name)}</span>
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
      Recording · {formatClock(runSeconds(clock, now))} · {stepCount(steps)}
    </p>
  );
}
