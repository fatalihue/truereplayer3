import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRightLeft, BookOpen, Chrome, ClipboardCopy, ClipboardPaste, Combine, CornerDownRight, Keyboard, ListChecks, MousePointerClick, Play, Plus, Redo2, RefreshCw,
  Replace, RotateCcw, ScrollText, Settings, Split, Square, SquareDot, Table2, Undo2, Variable, Zap,
} from 'lucide-react';
import { useAutomations } from '../../logic/useAutomations';
import { useMacro } from '../../logic/useMacro';
import { useRecording } from '../../logic/useRecording';
import { useRemaps } from '../../logic/useRemaps';
import { useReplay } from '../../logic/useReplay';
import { useAppActions, useSettings } from '../../logic/useSettings';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
import { useToast } from '../../state/ToastContext';
import { dock } from '../dock/dockState';
import { ITEMS } from '../insert/catalog';
import { insertHere } from '../insert/inserts';
import { drafts, focusInspector, focusList } from '../inspector/inspectorState';
import { libraryMenus } from '../library/libraryMenus';
import { displayOrder, sectionsOf } from '../library/model';
import { blockMap, insideLoop } from '../list/blocks';
import { insertPoint, selectedIndices, selection, useSelection } from '../list/selection';
import { stepMenuEntries } from '../list/stepMenu';
import { stepIcon } from '../list/stepTypes';
import { macroMenuEntries } from '../macroMenu';
import { MAX_REMAPS } from '../pages/remaps/remapModel';
import { useApp } from '../store';
import { openExamples, openPage, openSettings, setLibraryPeek, useUi } from '../ui';
import { fromMenu, macroItems, macroPhrase, scoreOf, shortcut, stepItems, tokensOf, type PaletteItem } from './commands';
import { palette } from './paletteState';
import './palette.css';

const MANUAL_URL = 'https://fatalihue.github.io/TrueReplayer-releases/manual.html';
const LIMIT = { Macros: 8, Steps: 8, Commands: 60 } as const;
const GROUPS = ['Macros', 'Steps', 'Commands'] as const;

/**
 * ① Ctrl+K (Menus board: "busca tudo: macros, passos e todos os comandos, com atalho"): one field
 * that finds a macro to open, a step of the open macro to go to, and every command, each with the
 * keys that do the same. "> " looks for commands only. ↑ ↓ move, Enter runs, Esc and a press outside
 * close; Tab stays in the field (casca-131). The commands come from the menus that already exist —
 * the macro's, the library's, the step's — plus the ones only the old palette had.
 */
export default function CommandPalette() {
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const listRef = useRef<HTMLDivElement>(null);
  const items = useItems();
  const macro = useMacro();

  const commandsOnly = query.trimStart().startsWith('>');
  const tokens = tokensOf(commandsOnly ? query.trimStart().slice(1) : query);
  const shown: { group: (typeof GROUPS)[number]; items: PaletteItem[] }[] = [];
  for (const group of GROUPS) {
    if (commandsOnly && group !== 'Commands') continue;
    // The steps only answer what was typed: listed whole, they would bury the commands.
    if (group === 'Steps' && tokens.length === 0) continue;
    const scored = items.filter(i => i.group === group).map((item, order) => ({ item, order, score: scoreOf(item, tokens) })).filter(x => x.score > 0);
    if (tokens.length > 0) scored.sort((a, b) => b.score - a.score || a.order - b.order);
    const limit = group === 'Macros' && tokens.length === 0 ? 5 : LIMIT[group];
    if (scored.length > 0) shown.push({ group, items: scored.slice(0, limit).map(x => x.item) });
  }
  // Nothing matches (EmptyStates board): a macro by the name typed, or the same words in the
  // examples. Enter makes the macro. "> " asked for commands only, so it gets neither.
  const typed = query.trim();
  const none = shown.length === 0 && !commandsOnly && typed !== '';
  const flat = none ? [
    { id: 'none:create', group: 'Commands', label: `Create macro “${typed}”`, icon: Plus, keys: 'Enter', run: () => { macro.create(typed, null); setLibraryPeek(false); } },
    { id: 'none:examples', group: 'Commands', label: `Look for “${typed}” in the examples`, icon: BookOpen, run: () => openExamples(typed) },
  ] satisfies PaletteItem[] : shown.flatMap(g => g.items);
  const at = flat.length === 0 ? -1 : Math.min(hi, flat.length - 1);

  useLayoutEffect(() => {
    listRef.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  // Closing gives the focus back to what had it, unless what ran took it somewhere.
  useLayoutEffect(() => () => {
    setTimeout(() => {
      const active = document.activeElement;
      if ((!active || active === document.body) && opener?.isConnected) opener.focus({ preventScroll: true });
    }, 0);
  }, [opener]);

  const run = (item: PaletteItem | undefined) => {
    if (!item || item.disabled) return;
    palette.close();
    setTimeout(item.run, 0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length > 0) setHi((at + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(flat[at]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      palette.close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  };

  let index = -1;
  const option = (item: PaletteItem) => {
    index += 1;
    const i = index;
    const Icon = item.icon;
    return (
      <div
        key={item.id}
        id={`pal-option-${i}`}
        role="option"
        aria-selected={i === at}
        aria-disabled={item.disabled || undefined}
        className="pal-option"
        data-index={i}
        data-tip={item.disabled ? item.hint : undefined}
        onMouseMove={() => { if (i !== at) setHi(i); }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => run(item)}
      >
        <span className="pal-icon">
          {item.stepIcon !== undefined
            ? (item.stepIcon && <span className="step-icon" data-icon={item.stepIcon} />)
            : Icon ? <Icon aria-hidden="true" /> : null}
        </span>
        <span className="pal-label">{item.label}</span>
        {item.detail && <span className="pal-detail">{item.detail}</span>}
        {item.keys && <span className="pal-keys">{item.keys.split('+').map((k, n) => <kbd key={n} className="pal-kbd">{k}</kbd>)}</span>}
      </div>
    );
  };
  return createPortal(
    <div className="pal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) palette.close(); }}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Search macros, steps and commands">
        <div className="pal-search">
          <span className="step-icon" data-icon="search" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant={at >= 0 ? `pal-option-${at}` : undefined}
            aria-label="Search macros, steps and commands"
            placeholder="Search macros, steps and commands"
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHi(0); }}
            onKeyDown={onKeyDown}
          />
          <kbd className="pal-kbd">Esc</kbd>
        </div>
        <div ref={listRef} id="pal-list" className="pal-list" role="listbox" aria-label="Results">
          {none ? (
            <>
              <p className="pal-none">No macros, steps or commands match “{typed}”.</p>
              {flat.map(option)}
            </>
          ) : shown.map(({ group, items: rows }) => (
            <div key={group} role="group" aria-label={group}>
              <div className="pal-group" aria-hidden="true">{group}</div>
              {rows.map(option)}
            </div>
          ))}
          {flat.length === 0 && <p className="pal-none">{commandsOnly ? 'No commands match' : 'Nothing matches'} “{commandsOnly ? typed.slice(1).trim() : typed}”.</p>}
        </div>
        <div className="pal-foot">{none ? 'Search looks in macro names, step notes and every command.' : <>↑↓ move · Enter opens · type &gt; for commands only</>}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Everything Ctrl+K can find, as it stands now. */
function useItems(): PaletteItem[] {
  const status = useApp(a => a.status);
  const clicker = useApp(a => a.settings.useCursorClick);
  const steps = useApp(a => a.actions);
  const profiles = useApp(a => a.profiles);
  const order = useApp(a => a.profileOrder);
  const active = useApp(a => a.activeProfile);
  const buttons = useApp(a => a.buttonStates);
  const shortcuts = useApp(a => a.settings.profileKeyEnabled);
  const automationsOn = useApp(a => a.automation.enabled);
  // One automation per macro: New automation has a macro to give one to.
  const automationLeft = useApp(a => a.profiles.some(p => !a.automation.entries.some(e => e.profile === p.name)));
  const remapsOn = useApp(a => a.settings.remaps.enabled);
  const remapsFull = useApp(a => a.settings.remaps.entries.length >= MAX_REMAPS);
  const recordKey = useApp(a => a.settings.recordingHotkey);
  const replayKey = useApp(a => a.settings.replayHotkey);
  const keys = useSelection(s => s.keys);
  const startImport = useUi(s => s.startImport);
  const macro = useMacro();
  const cmds = useSteps();
  const replay = useReplay();
  const recording = useRecording();
  const settings = useSettings();
  const app = useAppActions();
  const automations = useAutomations();
  const remaps = useRemaps();
  const { showToast } = useToast();
  const tt = useTt();

  const locked = status !== 'ready' || clicker;
  const lockHint = clicker ? tt('The Clicker is on', 'O Clicker está ligado') : tt('Not while a run or a recording is on', 'Não durante uma execução ou gravação');
  // A run or the Clicker is the reason that counts while it lasts.
  const lock = (item: PaletteItem): PaletteItem => (locked ? { ...item, disabled: true, hint: lockHint } : item);
  const out: PaletteItem[] = [];
  const cmd = (id: string, label: string, run: () => void, extra: Partial<PaletteItem> = {}): PaletteItem => ({ id: `cmd:${id}`, group: 'Commands', label, run, ...extra });

  // Macros, in the library's order.
  out.push(...macroItems(order, displayOrder(sectionsOf(profiles, order)), active, (name) => macro.open(name)));

  // The open macro's steps: Enter selects it in the list.
  if (active) {
    out.push(...stepItems(steps, active, (i) => {
      const all = steps;
      selection.only(all, i);
      document.querySelector(`.step[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' });
      focusList();
    }).map((item, i) => ({ ...item, stepIcon: stepIcon(steps[i].actionType) })));
  }

  // Run and record.
  if (active && !clicker) {
    out.push(status === 'replaying'
      ? cmd('stop', 'Stop the run', replay.toggle, { icon: Square, keys: shortcut(replayKey) })
      : cmd('replay', `Replay ${active}`, replay.toggle, { icon: Play, keys: shortcut(replayKey), disabled: status === 'recording', hint: tt('Stop the recording first', 'Pare a gravação antes') }));
    out.push(status === 'recording'
      ? cmd('record', 'Stop recording', recording.toggle, { icon: Square, keys: shortcut(recordKey) })
      : cmd('record', `Record into ${active}`, recording.toggle, { icon: SquareDot, keys: shortcut(recordKey), disabled: status === 'replaying', hint: tt('Stop the run first', 'Pare a execução antes') }));
  }

  // The steps the insert row and Add step make, at the insertion point. Break loop and Next
  // iteration only inside a loop, as in Add step (casca-079 and 080).
  if (active) {
    const inLoop = insideLoop(steps, insertPoint(steps, keys));
    for (const item of ITEMS) {
      if (!item.insert) continue;
      const insert = item.insert;
      const add = cmd(`add:${item.id}`, `Add ${item.name}`, () => insertHere(insert, cmds), { stepIcon: stepIcon(item.type), detail: item.desc, words: item.words });
      out.push(lock(item.inLoop && !inLoop ? { ...add, disabled: true, hint: tt('Only inside a loop', 'Só dentro de um laço') } : add));
    }
  }

  // The selection: the step menu's own items (its Pick from screen is the list's, on screen).
  const sel = selectedIndices(steps, keys);
  const blocks = blockMap(steps);
  if (active && sel.length > 0) {
    const entries = stepMenuEntries({
      steps, blocks, row: sel[0], targets: sel, cmds,
      convertCoordinates: macro.convertCoordinates,
      pick: () => {},
      edit: (row) => { selection.only(steps, row); focusInspector(); },
      openMacro: (name) => macro.open(name),
      select: (indices) => selection.set(steps, indices),
      toast: showToast,
      tt,
    });
    const which = sel.length === 1 ? `Step ${sel[0] + 1}` : `${sel.length} steps`;
    out.push(...fromMenu('step', entries.filter(e => e === 'separator' || e.label !== 'Pick from screen'), () => ({ detail: which })).map(lock));
    // The If block the step is in: its Else If and Else, which the list offers as a row (D2).
    const at = sel[0];
    let owner: number | null = null;
    for (const [o, c] of blocks.closerOf) if (steps[o].actionType === 'If' && o <= at && at <= c && (owner === null || o > owner)) owner = o;
    const ghost = owner === null ? null : [...blocks.ghostBefore.entries()].find(([, g]) => g.opener === owner);
    if (owner !== null && ghost) {
      const [anchor, g] = ghost;
      const opener = owner;
      out.push(lock(cmd('elseif', 'Add Else If to this If…', () => drafts.start({ kind: 'check', opener: 'ElseIf', at: anchor, macro: active, ifRowIndex: opener }), { stepIcon: 'split', detail: `If at step ${opener + 1}` })));
      if (g.canElse) out.push(lock(cmd('else', 'Add Else to this If', () => cmds.addElseBranch({ ifRowIndex: opener }), { stepIcon: 'split', detail: `If at step ${opener + 1}` })));
    }
  }

  // The whole macro's steps.
  if (active) {
    out.push(
      lock(cmd('undo', 'Undo', () => cmds.undo({}), { icon: Undo2, keys: 'Ctrl+Z', disabled: !buttons.canUndo, hint: tt('Nothing to undo', 'Nada para desfazer') })),
      lock(cmd('redo', 'Redo', () => cmds.redo({}), { icon: Redo2, keys: 'Ctrl+Y', disabled: !buttons.canRedo, hint: tt('Nothing to redo', 'Nada para refazer') })),
      cmd('selectall', 'Select all steps', () => { selection.set(steps, steps.map((_, i) => i)); focusList(); }, { icon: ListChecks, keys: 'Ctrl+A', disabled: steps.length === 0 }),
      lock(cmd('paste', 'Paste steps', () => cmds.paste({ insertIndex: sel.length > 0 ? sel[sel.length - 1] + 1 : steps.length }), { icon: ClipboardPaste, keys: 'Ctrl+V', words: 'clipboard' })),
      cmd('copytable', 'Copy all steps as a table', () => cmds.copy({}), { icon: Table2, words: 'tsv export spreadsheet clipboard' }),
      lock(cmd('torelative', 'Convert coordinates to relative', () => macro.convertCoordinates('toRelative'), { icon: Replace, words: 'window rebase' })),
      lock(cmd('toabsolute', 'Convert coordinates to absolute', () => macro.convertCoordinates('toAbsolute'), { icon: Replace, words: 'screen rebase' })),
      lock(cmd('tocombined', 'Convert steps to combined', () => cmds.convertMode({ direction: 'toCombined' }), { icon: Combine, words: 'merge keystroke click' })),
      lock(cmd('topaired', 'Convert steps to paired', () => cmds.convertMode({ direction: 'toPaired' }), { icon: Split, words: 'split down up' })),
    );
  }

  // The open macro's menu, said with its name.
  if (active) {
    out.push(...fromMenu('macro', macroMenuEntries({ name: active, profiles, order, active, locked: status !== 'ready', clicker, hasSteps: steps.length > 0, macro, tt }), (item, path) => ({ label: macroPhrase(item.label, path, active), detail: 'Macro' })));
  }

  // The library's New ▾ and ⋯. "From an example…" is found by "examples" too.
  const { newEntries, moreEntries } = libraryMenus({ profiles, order, macro, startImport });
  out.push(...fromMenu('library', [...newEntries, ...moreEntries], (item) => ({ detail: 'Library', words: item.icon === BookOpen ? 'browse examples sample starter' : undefined })));

  // The dock, the master switches, and the app's own doors.
  out.push(
    cmd('runreport', 'Run Report', () => dock.toggle('report'), { icon: ListChecks, detail: 'Dock', words: 'debug trace timeline failed why last run' }),
    cmd('livevars', 'Live Variables', () => dock.toggle('vars'), { icon: Variable, detail: 'Dock', words: 'debug variables slots clip row' }),
    cmd('shortcuts', shortcuts ? 'Turn Shortcuts off' : 'Turn Shortcuts on', () => settings.change('profileKeyEnabled', !shortcuts), { icon: Keyboard, words: 'profile keys hotkeys hotstrings pause' }),
    cmd('automations', automationsOn ? 'Turn Automations off' : 'Turn Automations on', () => automations.setEnabled(!automationsOn), { icon: Zap, words: 'triggers armed' }),
    cmd('remaps', remapsOn ? 'Turn Key Remaps off' : 'Turn Key Remaps on', () => remaps.setEnabled(!remapsOn), { icon: CornerDownRight, words: 'remap keys' }),
    cmd('clicker-page', 'Clicker', () => { if (!clicker) settings.change('useCursorClick', true); openPage('clicker'); }, { icon: MousePointerClick, words: 'autoclicker auto clicker click mode presets cps rate' }),
    cmd('automations-page', 'Automations', () => openPage('automations'), { icon: Zap, words: 'automation triggers trigger schedule timer interval every condition watch armed run by itself' }),
    cmd('automation-new', 'New automation', () => useUi.setState({ page: 'automations', automationAsk: { kind: 'new' }, libraryPeek: false }), { icon: Plus, detail: 'Automations', words: 'add automation trigger schedule timer interval condition', disabled: !automationLeft, hint: tt('Every macro has its automation: one per macro', 'Todo macro já tem a sua automação: uma por macro') }),
    cmd('remaps-page', 'Key Remaps', () => openPage('remaps'), { icon: ArrowRightLeft, words: 'remap remaps keys rebind swap caps disable mouse button' }),
    cmd('remap-new', 'New remap', () => useUi.setState({ page: 'remaps', remapNew: true, libraryPeek: false }), { icon: Plus, detail: 'Key Remaps', words: 'add remap rebind key swap disable', disabled: remapsFull, hint: tt(`${MAX_REMAPS} is the limit`, `${MAX_REMAPS} é o limite`) }),
    cmd('settings', 'Settings', () => openSettings(), { icon: Settings, words: 'preferences options configuration' }),
    cmd('settings-hotkeys', 'Hotkeys', () => openSettings('hotkeys'), { icon: Settings, detail: 'Settings', words: 'shortcut keys global record replay foreground clicker conflict suggested' }),
    cmd('settings-appearance', 'Appearance', () => openSettings('appearance'), { icon: Settings, detail: 'Settings', words: 'theme themes dark light accent color colour density text size font zoom motion animations corner' }),
    cmd('settings-recording', 'Recording and playback', () => openSettings('recording'), { icon: Settings, detail: 'Settings', words: 'delay timing jitter game mode return cursor fast approach' }),
    cmd('settings-screen', 'Screen Text', () => openSettings('screen'), { icon: Settings, detail: 'Settings', words: 'ocr language install read text' }),
    // casca-139: the reset of today, from the palette too; Settings asks before it resets. Off during
    // a run or a recording, as the row's Reset… is (the engine refuses it then).
    cmd('resetall', 'Reset all settings…', () => useUi.setState({ page: 'settings', settingsCategory: 'general', settingsQuery: '', settingsReset: true, libraryPeek: false }), { icon: RotateCcw, detail: 'Settings', words: 'defaults restore factory', disabled: status !== 'ready', hint: tt('Stop the run or the recording first', 'Pare a execução ou a gravação antes') }),
    cmd('extension', 'Connect browser extension', () => openSettings('browser'), { icon: Chrome, detail: 'Settings', words: 'chrome edge brave extension unpacked install disconnected' }),
    cmd('reload', 'Reload UI', app.reloadUI, { icon: RefreshCw, words: 'refresh stuck frozen' }),
    cmd('logs', 'Open logs folder', app.openLogsFolder, { icon: ScrollText, words: 'diagnostics session log support' }),
    cmd('diagnostics', 'Copy diagnostics', app.copyDiagnostics, { icon: ClipboardCopy, words: 'support version bug report system info about' }),
    cmd('manual', 'Open manual', () => app.openUrl(MANUAL_URL), { icon: BookOpen, words: 'help docs documentation guide ajuda' }),
  );
  return out;
}

