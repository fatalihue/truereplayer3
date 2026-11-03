import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { PictureInPicture2,
  ArrowRightLeft, BookOpen, ChevronsDownUp, ChevronsUpDown, Chrome, ClipboardCopy, ClipboardPaste, Combine, CornerDownRight, FolderOpen, Keyboard, ListChecks, MousePointerClick, Play, Plus, Redo2, RefreshCw,
  Replace, RotateCcw, ScrollText, Settings, Split, Square, SquareDot, Table2, Undo2, Variable, Zap,
} from 'lucide-react';
import { useBridge } from '../../bridge/BridgeContext';
import { t, tn } from '../../i18n';
import { useAutomations } from '../../logic/useAutomations';
import { useMacro } from '../../logic/useMacro';
import { useRecording } from '../../logic/useRecording';
import { useRemaps } from '../../logic/useRemaps';
import { useReplay } from '../../logic/useReplay';
import { useAppActions, useSettings } from '../../logic/useSettings';
import { useWindow } from '../../logic/useWindow';
import { useSteps } from '../../logic/useSteps';
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
const LIMIT = { macros: 8, steps: 8, commands: 60 } as const;
const GROUPS = ['macros', 'steps', 'commands'] as const;
const GROUP_NAMES = tn('palette.groups');

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
    if (commandsOnly && group !== 'commands') continue;
    // The steps only answer what was typed: listed whole, they would bury the commands.
    if (group === 'steps' && tokens.length === 0) continue;
    const scored = items.filter(i => i.group === group).map((item, order) => ({ item, order, score: scoreOf(item, tokens) })).filter(x => x.score > 0);
    if (tokens.length > 0) scored.sort((a, b) => b.score - a.score || a.order - b.order);
    const limit = group === 'macros' && tokens.length === 0 ? 5 : LIMIT[group];
    if (scored.length > 0) shown.push({ group, items: scored.slice(0, limit).map(x => x.item) });
  }
  // Nothing matches (EmptyStates board): a macro by the name typed, or the same words in the
  // examples. Enter makes the macro. "> " asked for commands only, so it gets neither.
  const typed = query.trim();
  const none = shown.length === 0 && !commandsOnly && typed !== '';
  const flat = none ? [
    { id: 'none:create', group: 'commands', label: t('palette.createMacro', { name: typed }), icon: Plus, keys: 'Enter', run: () => { macro.create(typed, null); setLibraryPeek(false); } },
    { id: 'none:examples', group: 'commands', label: t('palette.lookInExamples', { query: typed }), icon: BookOpen, run: () => openExamples(typed) },
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
      <div className="pal" role="dialog" aria-modal="true" aria-label={t('palette.search')}>
        <div className="pal-search">
          <span className="step-icon" data-icon="search" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-activedescendant={at >= 0 ? `pal-option-${at}` : undefined}
            aria-label={t('palette.search')}
            placeholder={t('palette.search')}
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHi(0); }}
            onKeyDown={onKeyDown}
          />
          <kbd className="pal-kbd">Esc</kbd>
        </div>
        <div ref={listRef} id="pal-list" className="pal-list" role="listbox" aria-label={t('palette.results')}>
          {none ? (
            <>
              <p className="pal-none">{t('palette.noneMatch', { query: typed })}</p>
              {flat.map(option)}
            </>
          ) : shown.map(({ group, items: rows }) => (
            <div key={group} role="group" aria-label={GROUP_NAMES[group]}>
              <div className="pal-group" aria-hidden="true">{GROUP_NAMES[group]}</div>
              {rows.map(option)}
            </div>
          ))}
          {flat.length === 0 && (
            <p className="pal-none">
              {commandsOnly ? t('palette.noCommandsMatch', { query: typed.slice(1).trim() }) : t('palette.nothingMatches', { query: typed })}
            </p>
          )}
        </div>
        <div className="pal-foot">{none ? t('palette.footNone') : t('palette.foot')}</div>
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
  const win = useWindow();
  const automations = useAutomations();
  const remaps = useRemaps();
  const { showToast } = useToast();
  const { subscribe } = useBridge();

  const locked = status !== 'ready' || clicker;
  const lockHint = clicker ? t('palette.hint.clickerOn') : t('shell.busy');
  // A run or the Clicker is the reason that counts while it lasts.
  const lock = (item: PaletteItem): PaletteItem => (locked ? { ...item, disabled: true, hint: lockHint } : item);
  const out: PaletteItem[] = [];
  const cmd = (id: string, label: string, run: () => void, extra: Partial<PaletteItem> = {}): PaletteItem => ({ id: `cmd:${id}`, group: 'commands', label, run, ...extra });

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

  // Run and record. A recording starts where the header's Record starts it: after the selection.
  if (active && !clicker) {
    const record = () => recording.toggleAt(insertPoint(steps, keys));
    out.push(status === 'replaying'
      ? cmd('stop', t('palette.cmd.stopRun'), replay.toggle, { icon: Square, keys: shortcut(replayKey) })
      : cmd('replay', t('palette.cmd.replay', { name: active }), replay.toggle, { icon: Play, keys: shortcut(replayKey), disabled: status === 'recording', hint: t('palette.hint.stopRecording') }));
    out.push(status === 'recording'
      ? cmd('record', t('palette.cmd.stopRecording'), record, { icon: Square, keys: shortcut(recordKey) })
      : cmd('record', t('palette.cmd.recordInto', { name: active }), record, { icon: SquareDot, keys: shortcut(recordKey), disabled: status === 'replaying', hint: t('palette.hint.stopRun') }));
  }

  // The steps the insert row and Add step make, at the insertion point. Break loop and Next
  // iteration only inside a loop, as in Add step (casca-079 and 080).
  if (active) {
    const inLoop = insideLoop(steps, insertPoint(steps, keys));
    for (const item of ITEMS) {
      if (!item.insert) continue;
      const insert = item.insert;
      const add = cmd(`add:${item.id}`, t('palette.cmd.addStep', { kind: item.name }), () => insertHere(insert, cmds), { stepIcon: stepIcon(item.type), detail: item.desc, words: item.words });
      out.push(lock(item.inLoop && !inLoop ? { ...add, disabled: true, hint: t('palette.hint.onlyInLoop') } : add));
    }
  }

  // The selection: the step menu's own items (its Pick from screen is the list's, on screen; its label
  // comes from the list's catalog, in the build's language, and is compared with the same key).
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
      subscribe,
    });
    const which = sel.length === 1 ? t('palette.detail.stepN', { n: sel[0] + 1 }) : t('palette.detail.steps', { count: sel.length });
    out.push(...fromMenu('step', entries.filter(e => e === 'separator' || e.label !== t('list.menu.pickFromScreen')), () => ({ detail: which })).map(lock));
    // The If block the step is in: its Else If and Else, which the list offers as a row (D2).
    const at = sel[0];
    let owner: number | null = null;
    for (const [o, c] of blocks.closerOf) if (steps[o].actionType === 'If' && o <= at && at <= c && (owner === null || o > owner)) owner = o;
    const ghost = owner === null ? null : [...blocks.ghostBefore.entries()].find(([, g]) => g.opener === owner);
    if (owner !== null && ghost) {
      const [anchor, g] = ghost;
      const opener = owner;
      out.push(lock(cmd('elseif', t('palette.cmd.addElseIf'), () => drafts.start({ kind: 'check', opener: 'ElseIf', at: anchor, macro: active, ifRowIndex: opener }), { stepIcon: 'split', detail: t('palette.detail.ifAt', { n: opener + 1 }) })));
      if (g.canElse) out.push(lock(cmd('else', t('palette.cmd.addElse'), () => cmds.addElseBranch({ ifRowIndex: opener }), { stepIcon: 'split', detail: t('palette.detail.ifAt', { n: opener + 1 }) })));
    }
  }

  // The whole macro's steps.
  if (active) {
    out.push(
      lock(cmd('undo', t('common.actions.undo'), () => cmds.undo({}), { icon: Undo2, keys: 'Ctrl+Z', disabled: !buttons.canUndo, hint: t('palette.hint.nothingToUndo') })),
      lock(cmd('redo', t('common.actions.redo'), () => cmds.redo({}), { icon: Redo2, keys: 'Ctrl+Y', disabled: !buttons.canRedo, hint: t('palette.hint.nothingToRedo') })),
      cmd('selectall', t('palette.cmd.selectAll'), () => { selection.set(steps, steps.map((_, i) => i)); focusList(); }, { icon: ListChecks, keys: 'Ctrl+A', disabled: steps.length === 0 }),
      lock(cmd('paste', t('palette.cmd.paste'), () => cmds.paste({ insertIndex: sel.length > 0 ? sel[sel.length - 1] + 1 : steps.length }), { icon: ClipboardPaste, keys: 'Ctrl+V', words: t('palette.words.paste') })),
      cmd('copytable', t('palette.cmd.copyTable'), () => cmds.copy({}), { icon: Table2, words: t('palette.words.copyTable') }),
      lock(cmd('torelative', t('palette.cmd.toRelative'), () => macro.convertCoordinates('toRelative'), { icon: Replace, words: t('palette.words.toRelative') })),
      lock(cmd('toabsolute', t('palette.cmd.toAbsolute'), () => macro.convertCoordinates('toAbsolute'), { icon: Replace, words: t('palette.words.toAbsolute') })),
      lock(cmd('tocombined', t('palette.cmd.toCombined'), () => cmds.convertMode({ direction: 'toCombined' }), { icon: Combine, words: t('palette.words.toCombined') })),
      lock(cmd('topaired', t('palette.cmd.toPaired'), () => cmds.convertMode({ direction: 'toPaired' }), { icon: Split, words: t('palette.words.toPaired') })),
    );
  }

  // The open macro's menu, said with its name.
  if (active) {
    out.push(...fromMenu('macro', macroMenuEntries({ name: active, profiles, order, active, locked: status !== 'ready', clicker, hasSteps: steps.length > 0, macro }), (item) => ({ label: macroPhrase(item, active), detail: t('palette.detail.macro') })));
  }

  // The library's New ▾ and ⋯. "From an example…" is found by "examples" too.
  const { newEntries, moreEntries } = libraryMenus({ profiles, macro, startImport });
  out.push(...fromMenu('library', [...newEntries, ...moreEntries], (item) => ({ detail: t('palette.detail.library'), words: item.icon === BookOpen ? t('palette.words.examples') : undefined })));
  // The library header's folders button (D29), with its rule: while any folder is open it closes
  // them all, and with every one closed it opens them all.
  const anyFolderOpen = order.folders.some(f => !f.collapsed);
  out.push(cmd('folders', anyFolderOpen ? t('palette.cmd.collapseFolders') : t('palette.cmd.expandFolders'), () => macro.setAllFoldersCollapsed(anyFolderOpen), {
    icon: anyFolderOpen ? ChevronsDownUp : ChevronsUpDown,
    detail: t('palette.detail.library'),
    words: t('palette.words.folders'),
    disabled: order.folders.length === 0,
    hint: t('palette.hint.noFolders'),
  }));

  // The dock, the master switches, and the app's own doors. Run Report, Live Variables and the Dock
  // are glossary names, the same in both languages.
  const settingsName = t('common.pages.settings');
  out.push(
    cmd('runreport', 'Run Report', () => dock.toggle('report'), { icon: ListChecks, detail: 'Dock', words: t('palette.words.runReport') }),
    cmd('livevars', 'Live Variables', () => dock.toggle('vars'), { icon: Variable, detail: 'Dock', words: t('palette.words.liveVariables') }),
    cmd('shortcuts', shortcuts ? t('palette.cmd.shortcutsOff') : t('palette.cmd.shortcutsOn'), () => settings.change('profileKeyEnabled', !shortcuts), { icon: Keyboard, words: t('palette.words.shortcuts') }),
    cmd('automations', automationsOn ? t('palette.cmd.automationsOff') : t('palette.cmd.automationsOn'), () => automations.setEnabled(!automationsOn), { icon: Zap, words: t('palette.words.automations') }),
    cmd('remaps', remapsOn ? t('palette.cmd.remapsOff') : t('palette.cmd.remapsOn'), () => remaps.setEnabled(!remapsOn), { icon: CornerDownRight, words: t('palette.words.remaps') }),
    cmd('clicker-page', t('common.pages.clicker'), () => { if (!clicker) settings.change('useCursorClick', true); openPage('clicker'); }, { icon: MousePointerClick, words: t('palette.words.clicker') }),
    cmd('automations-page', t('common.pages.automations'), () => openPage('automations'), { icon: Zap, words: t('palette.words.automationsPage') }),
    cmd('automation-new', t('palette.cmd.newAutomation'), () => useUi.setState({ page: 'automations', automationAsk: { kind: 'new' }, libraryPeek: false }), { icon: Plus, detail: t('common.pages.automations'), words: t('palette.words.newAutomation'), disabled: !automationLeft, hint: t('palette.hint.automationPerMacro') }),
    cmd('remaps-page', t('common.pages.remaps'), () => openPage('remaps'), { icon: ArrowRightLeft, words: t('palette.words.remapsPage') }),
    cmd('remap-new', t('palette.cmd.newRemap'), () => useUi.setState({ page: 'remaps', remapNew: true, libraryPeek: false }), { icon: Plus, detail: t('common.pages.remaps'), words: t('palette.words.newRemap'), disabled: remapsFull, hint: t('palette.hint.remapLimit', { max: MAX_REMAPS }) }),
    // Settings holds the choice of the language: found by its words in both languages (palette.words.settings).
    cmd('settings', settingsName, () => openSettings(), { icon: Settings, words: t('palette.words.settings') }),
    cmd('settings-hotkeys', t('settings.categories.hotkeys'), () => openSettings('hotkeys'), { icon: Settings, detail: settingsName, words: t('palette.words.hotkeys') }),
    cmd('settings-appearance', t('settings.categories.appearance'), () => openSettings('appearance'), { icon: Settings, detail: settingsName, words: t('palette.words.appearance') }),
    cmd('settings-recording', t('settings.categories.recording'), () => openSettings('recording'), { icon: Settings, detail: settingsName, words: t('palette.words.recording') }),
    cmd('settings-screen', t('settings.categories.screen'), () => openSettings('screen'), { icon: Settings, detail: settingsName, words: t('palette.words.screen') }),
    // casca-139: the reset of today, from the palette too; Settings asks before it resets. Off during
    // a run or a recording, as the row's Reset… is (the engine refuses it then).
    cmd('resetall', t('palette.cmd.resetAll'), () => useUi.setState({ page: 'settings', settingsCategory: 'general', settingsQuery: '', settingsReset: true, libraryPeek: false }), { icon: RotateCcw, detail: settingsName, words: t('palette.words.resetAll'), disabled: status !== 'ready', hint: t('palette.hint.stopRunOrRecording') }),
    cmd('extension', t('palette.cmd.extension'), () => openSettings('browser'), { icon: Chrome, detail: settingsName, words: t('palette.words.extension') }),
    cmd('compact', t('palette.cmd.compact'), () => win.setCompact(true), { icon: PictureInPicture2, words: t('palette.words.compact') }),
    cmd('reload', t('palette.cmd.reload'), app.reloadUI, { icon: RefreshCw, words: t('palette.words.reload') }),
    cmd('data', t('palette.cmd.dataFolder'), app.openDataFolder, { icon: FolderOpen, words: t('palette.words.dataFolder') }),
    cmd('logs', t('palette.cmd.logsFolder'), app.openLogsFolder, { icon: ScrollText, words: t('palette.words.logsFolder') }),
    cmd('diagnostics', t('palette.cmd.diagnostics'), app.copyDiagnostics, { icon: ClipboardCopy, words: t('palette.words.diagnostics') }),
    cmd('manual', t('palette.cmd.manual'), () => app.openUrl(MANUAL_URL), { icon: BookOpen, words: t('palette.words.manual') }),
  );
  return out;
}

