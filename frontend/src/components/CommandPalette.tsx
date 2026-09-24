import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, RotateCcw, RefreshCw,
  ClipboardPaste, ClipboardCopy, Files, Replace, Table2,
  Combine, Split, ScrollText, Activity, ListChecks, BookOpen, Info,
} from 'lucide-react';
import { useAppState } from '../state/AppStateContext';
import { useBridge } from '../bridge/BridgeContext';
import { useSelectionRef } from '../state/SelectionContext';
import { useSheetGuard } from '../state/SheetGuardContext';
import { useToast } from '../state/ToastContext';
import { useTt } from '../state/LanguageContext';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  // When true, the row renders greyed-out and clicks no-op. Used for commands that
  // exist conceptually but can't run in the current state (e.g. Duplicate Profile
  // with no active profile — better to show the command + hint than to vanish it,
  // since users searching for "duplicate" otherwise see zero matches and wonder why).
  disabled?: boolean;
  disabledHint?: string;
  // Extra search terms (not displayed) so an entry is findable by what users call
  // it, not just its canonical label — e.g. "Copy as Table" matches "tsv"/"export".
  keywords?: string[];
  onAction: () => void;
}

interface CommandGroup {
  id: string;
  title: string;
  items: CommandItem[];
}

// SCOPE — this palette is deliberately small. An entry earns its place only when the
// capability is buried in a nested right-click menu, keyboard-only, or has no UI control
// at all. Anything reachable from a persistent labelled control (the Toolbar insert row,
// the ActionBar, the ProfilePanel header, a Settings row) is intentionally ABSENT: a
// second door to a visible button is pure noise, and it pushes the genuinely
// hard-to-find commands down the list. The WINDOW and UPDATES groups went first for this
// reason; the ACTIONS insert block (every type has a Toolbar button), the ActionBar trio
// (Record/Replay/Mode), the profile CRUD entries and the view-chrome toggles followed for
// the same one. Before adding a command, find its UI control — if it has a discoverable
// one, it does not belong here.
// The web manual is the app's only documentation and, until 2026-09-05, had no door anywhere in
// the app (window, Settings or tray). The palette is the right door: a capability with no UI
// control at all. The URL is fixed here and allow-listed on the C# side (shell:openUrl).
const MANUAL_URL = 'https://fatalihue.github.io/TrueReplayer-releases/manual.html';

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const { activeProfile, settings, actions, buttonStates } = useAppState();
  const { send } = useBridge();
  const selectionRef = useSelectionRef();
  const [query, setQuery] = useState('');

  // Insert position helper: matches the toolbar's behavior — before the first selected
  // action, or at the end of the list when nothing is selected.
  const computeInsertIndex = useCallback(() => {
    const sel = selectionRef.current;
    return sel.size > 0 ? Math.min(...sel) : actions.length;
  }, [actions.length, selectionRef]);
  // The open Sheet's say over the list rewrites below (see SheetGuardContext): Ctrl+K opens the
  // palette from inside the sheet — even mid-typing — and a paste or a convert re-seeded the
  // editor under it. The palette floats over the sheet's footer warning, so a refusal also says
  // so here, and the palette stays open: choosing the command again is the repeat that discards.
  const sheetGuard = useSheetGuard();
  const { showToast } = useToast();
  const tt = useTt();
  const sheetAllows = useCallback(() => {
    if (sheetGuard.allowListChange()) return true;
    showToast(tt('The open action has unsaved changes — choose the command again to discard them.',
                 'A ação aberta tem alterações não salvas — escolha o comando de novo para descartá-las.'), 'info');
    return false;
  }, [sheetGuard, showToast, tt]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Where the focus was when the palette opened, handed back when it closes (Esc, a command, a
  // click outside). It was left to the browser, which drops it on <body> when the focused input
  // unmounts — and everything keyed on focus went deaf until the next click: the grid's arrows,
  // a dialog's Esc, Ctrl+Enter and Tab trap. A command that moved the focus itself (one that opens
  // a dialog) keeps it: the hand-back only acts while the focus is still nowhere.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (isOpen) {
      const was = document.activeElement;
      returnFocusRef.current = was instanceof HTMLElement && was !== document.body ? was : null;
      inputRef.current?.focus();
      setQuery('');
      setFocusedIndex(0);
      return;
    }
    const back = returnFocusRef.current;
    returnFocusRef.current = null;
    if (back?.isConnected && (!document.activeElement || document.activeElement === document.body)) back.focus();
  }, [isOpen]);

  // Build command groups
  const groups: CommandGroup[] = useMemo(() => {
    // Gate for the entries that mutate the macro list. This claimed to mirror the Toolbar's
    // insertsDisabled and did not: the Toolbar reads recordingActive || replayActive || isClicker,
    // this read only the mode. The palette is the one surface with no run lockout of its own —
    // Ctrl+K opens DURING a run (its branch runs before App's runActive lockout), while the grid's
    // context menu and Ctrl+V are both already dead there.
    // Gating the ITEMS, not the door, is deliberate twice over: the Enter route closes with them
    // (the palette's Enter branch checks !item.disabled), and the door stays open for Run Report,
    // Live Variables and Reload UI — which are exactly what someone wants DURING a run.
    const isClicker = settings.useCursorClick;
    const runActive = buttonStates.recordingActive || buttonStates.replayActive;
    const clickerHint = 'Macro mode only';
    const runHint = 'Not while a run is active';
    const gate = (c: boolean, r: boolean) => ({ disabled: c || r, disabledHint: c ? clickerHint : runHint });

    return [
      {
        // What survives here are whole-list operations with no toolbar button: the
        // clipboard bridge and the four bulk coordinate/pairing rewrites, each of which
        // otherwise lives three clicks deep in a right-click "More" submenu.
        id: 'actions',
        title: 'ACTIONS',
        items: [
          {
            id: 'copyactions', label: 'Copy as Table',
            // Deliberately UNGATED, and the reasoning is worth keeping because it nearly went the
            // other way. This writes the SYSTEM clipboard (Copy Diagnostics does too), and the
            // engine reads that clipboard mid-run, so copying during a run can change what a
            // running macro pastes. That argument proves too much: it applies identically to Copy
            // Diagnostics, which is the one command a user reaches for WHILE something is going
            // wrong. Blocking that to protect a clipboard the user owns is the worse trade, so
            // neither is gated and the two stay consistent.
            keywords: ['tsv', 'export', 'clipboard', 'spreadsheet'],
            icon: <Table2 size={14} className="text-text-secondary" />,
            onAction: () => { send({ type: 'actions:copy', payload: {} }); onClose(); },
          },
          {
            // Ctrl+V works but has no visible control anywhere, so this is the only
            // discoverable route.
            id: 'pasteactions', label: 'Paste Actions',
            ...gate(isClicker, runActive),
            icon: <ClipboardPaste size={14} className="text-text-secondary" />,
            onAction: () => { if (!sheetAllows()) return; send({ type: 'actions:paste', payload: { insertIndex: computeInsertIndex() } }); onClose(); },
          },
          {
            id: 'convertrelative', label: 'Convert Coordinates to Relative',
            ...gate(isClicker, runActive),
            keywords: ['window relative', 'rebase', 'coordinates'],
            icon: <Replace size={14} className="text-text-secondary" />,
            onAction: () => { if (!sheetAllows()) return; send({ type: 'profile:convertCoordinates', payload: { direction: 'toRelative' } }); onClose(); },
          },
          {
            id: 'convertabsolute', label: 'Convert Coordinates to Absolute',
            ...gate(isClicker, runActive),
            keywords: ['screen coordinates', 'rebase'],
            icon: <Replace size={14} className="text-text-secondary" />,
            onAction: () => { if (!sheetAllows()) return; send({ type: 'profile:convertCoordinates', payload: { direction: 'toAbsolute' } }); onClose(); },
          },
          {
            // Convert the whole profile between paired (Down/Up) and combined (Keystroke/Click)
            // representations — the on-demand counterpart to the Combined Actions toggle.
            id: 'converttocombined', label: 'Convert Actions to Combined',
            ...gate(isClicker, runActive),
            keywords: ['merge', 'keystroke', 'click'],
            icon: <Combine size={14} className="text-text-secondary" />,
            onAction: () => { if (!sheetAllows()) return; send({ type: 'actions:convertMode', payload: { direction: 'toCombined' } }); onClose(); },
          },
          {
            id: 'converttopaired', label: 'Convert Actions to Paired',
            ...gate(isClicker, runActive),
            keywords: ['split', 'down up', 'separate'],
            icon: <Split size={14} className="text-text-secondary" />,
            onAction: () => { if (!sheetAllows()) return; send({ type: 'actions:convertMode', payload: { direction: 'toPaired' } }); onClose(); },
          },
        ],
      },
      {
        // New / Save / Load / New Folder all have persistent buttons (ActionBar and the
        // ProfilePanel header), so only the routes with no visible control remain. Import
        // Profiles and Export All Profiles left on 2026-09-05: the ProfilePanel header gained
        // ONE button (ArrowDownUp) that opens the Export dialog — multi-select, "include
        // organisation" toggle, Import link in its footer — so both had a visible door.
        id: 'profiles',
        title: 'PROFILES',
        items: [
          {
            id: 'reset', label: 'Reset Profile',
            // Deliberately NOT gated on isClicker, unlike the grid commands above. The backend
            // command is a settings reset ("Reset Settings", "reset all settings to their default
            // values and clear all actions") and it goes out of its way to keep working here:
            // it preserves the current mode so a reset doesn't bounce a Clicker user back to Macro,
            // restores real Clicker defaults, and keeps the user's presets. Clearing actions is one
            // of its effects, not its purpose. This palette entry is the only door to it.
            // runActive IS the right gate, though: it clears the action list and the undo history
            // out from under a running engine, and Ctrl+Z is refused while the run lives — so there
            // would be no way back. It also covers the Clicker user, whose click loop sets the same
            // replay flag, without ever refusing the reset with the app sitting idle.
            disabled: runActive, disabledHint: runHint,
            keywords: ['clear', 'start over', 'blank'],
            icon: <RotateCcw size={14} className="text-text-secondary" />,
            onAction: () => { if (!sheetAllows()) return; send({ type: 'profile:reset', payload: {} }); onClose(); },
          },
          {
            // Right-click-menu-only otherwise, so it stays searchable by name.
            id: 'duplicateprofile', label: 'Duplicate Profile',
            keywords: ['copy profile', 'clone'],
            icon: <Files size={14} className="text-text-secondary" />,
            disabled: !activeProfile,
            disabledHint: 'Select a profile first',
            onAction: () => { if (activeProfile) { send({ type: 'profile:duplicate', payload: { name: activeProfile } }); onClose(); } },
          },
          {
            // Icon, description and tags. Its only other door is right-click → hover "More" →
            // "Edit info…" — a submenu so hard to reach that a synthetic click cannot open it,
            // for the dialog that owns the description and the #tag search the sidebar runs on.
            id: 'profileinfo', label: 'Edit Profile Info',
            keywords: ['description', 'tags', 'icon', 'emoji', 'metadata', 'descricao'],
            icon: <Info size={14} className="text-text-secondary" />,
            disabled: !activeProfile,
            disabledHint: 'Select a profile first',
            onAction: () => { if (activeProfile) { onClose(); window.dispatchEvent(new CustomEvent('cmd:profileinfo')); } },
          },
        ],
      },
      {
        // Diagnostics — none of these have a UI control anywhere in the app.
        id: 'diagnostics',
        title: 'DIAGNOSTICS',
        items: [
          {
            // Live-variables debug pane — floating card mirroring {var:}/{clip:}/row state.
            // The palette is its ONLY opener; the pane's own button can only close it.
            id: 'livevars', label: 'Toggle Live Variables',
            keywords: ['debug', 'variables', 'slots', 'clip', 'watch', 'row'],
            icon: <Activity size={14} className="text-text-secondary" />,
            onAction: () => { onClose(); window.dispatchEvent(new CustomEvent('cmd:livevars')); },
          },
          {
            // Last-run step timeline. Palette-only for the same reason as Live Variables: it is
            // a diagnostic you reach for AFTER something went wrong, so it earns no permanent
            // toolbar real estate.
            id: 'runreport', label: 'Run Report',
            keywords: ['debug', 'trace', 'timeline', 'selector', 'browser', 'failed', 'why', 'relatorio'],
            icon: <ListChecks size={14} className="text-text-secondary" />,
            onAction: () => { onClose(); window.dispatchEvent(new CustomEvent('cmd:runreport')); },
          },
          {
            // Recovery hatch for a wedged WebView2 UI. It asks the Sheet like the list rewrites
            // above: a reload throws away every editor's typed fields, and a UI that answered
            // Ctrl+K is not wedged. The repeat still goes through, so the hatch stays one gesture
            // away — and the tray's Reload, the door for a UI that cannot answer, asks nothing.
            id: 'reloadui', label: 'Reload UI',
            keywords: ['refresh', 'stuck', 'frozen'],
            icon: <RefreshCw size={14} className="text-text-secondary" />,
            onAction: () => { if (!sheetAllows()) return; send({ type: 'window:reloadUI', payload: {} }); onClose(); },
          },
          {
            // Opens %LocalAppData%\TrueReplayer\Logs in Explorer. Otherwise reachable only
            // from the tray menu — surfaced here so users/support can grab the session log
            // for diagnosing silent hotkey / replay issues without hunting for the folder.
            id: 'openlogs', label: 'Open Logs Folder',
            keywords: ['diagnostics', 'session log', 'support', 'troubleshoot'],
            icon: <ScrollText size={14} className="text-text-secondary" />,
            onAction: () => { send({ type: 'logs:openFolder', payload: {} }); onClose(); },
          },
          {
            // One block of text with what support asks for first (version, OS, WebView2, DPI,
            // mode, Profile Keys / remaps / automation state, profile count, elevation, log
            // folder). The backend gathers it and confirms with a toast.
            id: 'copydiagnostics', label: 'Copy Diagnostics',
            keywords: ['support', 'version', 'bug report', 'system info', 'about'],
            icon: <ClipboardCopy size={14} className="text-text-secondary" />,
            onAction: () => { send({ type: 'diagnostics:copy', payload: {} }); onClose(); },
          },
        ],
      },
      {
        id: 'help',
        title: 'HELP',
        items: [
          {
            id: 'openmanual', label: 'Open Manual',
            keywords: ['help', 'docs', 'documentation', 'guide', 'manual', 'ajuda', 'guia'],
            icon: <BookOpen size={14} className="text-text-secondary" />,
            onAction: () => { send({ type: 'shell:openUrl', payload: { url: MANUAL_URL } }); onClose(); },
          },
        ],
      },
    ];
    // Narrow deps to the exact settings field read above so unrelated settings changes
    // (hotkeys, loop config, movement knobs) don't rebuild every command group.
  }, [
    activeProfile, send, onClose, computeInsertIndex, sheetAllows,
    settings.useCursorClick,
    // The two BOOLEAN fields, never the buttonStates object: it is republished on several
    // unrelated events, and depending on the object would rebuild every group each time.
    buttonStates.recordingActive, buttonStates.replayActive,
  ]);

  // Filter
  const filteredGroups = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return groups;
    return groups.map(g => ({
      ...g,
      items: g.items.filter(item => item.label.toLowerCase().includes(q)
        || item.keywords?.some(k => k.toLowerCase().includes(q))),
    })).filter(g => g.items.length > 0);
  }, [groups, query]);

  // Flat list for keyboard nav
  const flatItems = useMemo(() =>
    filteredGroups.flatMap(g => g.items),
    [filteredGroups]
  );

  // Keyboard nav
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        // Math.max(0, ...) guards the empty-list case: when flatItems is empty,
        // length - 1 is -1, which would otherwise leave focusedIndex at an invalid -1.
        setFocusedIndex(prev => Math.max(0, Math.min(prev + 1, flatItems.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = flatItems[focusedIndex];
        if (item && !item.disabled) item.onAction();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, flatItems, focusedIndex]);

  // Reset focus when filter changes
  useEffect(() => setFocusedIndex(0), [query]);

  // Keep the focused row inside the viewport. The card grew a height cap so the list scrolls, and
  // the arrows moved a highlight that could be anywhere below the fold: holding ArrowDown walked
  // the selection off the bottom of a list that never moved, and Enter then ran a command the user
  // could not see. `block: 'nearest'` scrolls only when it has to, so short lists never jump.
  // Dep is the index alone — adding isOpen/length would be an `unnecessary dependency` under the
  // lint gate, and neither changes where the focused row sits.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[data-cmd-focused="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  if (!isOpen) return null;

  let flatIndex = -1;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[calc(15vh/var(--ui-zoom))]"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="command-enter w-[520px] flex flex-col max-h-[calc(83vh/var(--ui-zoom))] bg-bg-card border border-border-default rounded-dialog overflow-hidden"
        style={{ boxShadow: 'var(--shadow-dialog)' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-border-subtle">
          <Search size={16} className="text-text-tertiary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-disabled"
          />
          <span className="kbd">Esc</span>
        </div>

        {/* Command list — sized by its content, so the whole (deliberately small) command set is
            normally on screen without scrolling. The old px cap (480) was outgrown the moment Run
            Report arrived: 14 rows came to 539px and the last two sat under the footer with no
            scrollbar to hint at them.
            The cap lives on the CARD now, not here: header and footer sit outside a cap set on
            the list, so the card could still end past the bottom of the window. And every
            viewport unit is divided by --ui-zoom, the house idiom (DialogShell, RunReportPanel):
            `zoom` on <html> scales what is painted while vh keeps resolving against the unzoomed
            viewport, so a raw 85vh paints 93.5vh at 110% zoom — which is how the footer went back
            under the window edge above ~105%. With the cap on the card, top (15vh) + card (83vh)
            never exceeds the window at any zoom, and the list scrolls when it has to. */}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-1.5">
          {filteredGroups.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-text-tertiary">
              No results found
            </div>
          )}
          {filteredGroups.map(group => (
            <div key={group.id}>
              <div className="px-3 py-1.5 label-micro text-text-tertiary">
                {group.title}
              </div>
              {group.items.map(item => {
                flatIndex++;
                const isFocused = flatIndex === focusedIndex;
                const idx = flatIndex;
                const isDisabled = !!item.disabled;
                return (
                  <button
                    key={item.id}
                    onClick={isDisabled ? undefined : item.onAction}
                    onMouseEnter={() => setFocusedIndex(idx)}
                    data-cmd-focused={isFocused ? 'true' : undefined}
                    disabled={isDisabled}
                    data-tip={isDisabled ? item.disabledHint : undefined}
                    // menu-item (the menus' own recipe: 32 px, 12 px, elevated hover); the keyboard
                    // focus paints the hover look, and a disabled item explains itself at the right.
                    className={`menu-item gap-2 ${
                      isDisabled
                        ? 'opacity-40 cursor-not-allowed'
                        : isFocused
                          ? 'bg-bg-elevated text-text-primary'
                          : 'text-text-secondary hover:text-text-primary'
                    }`}
                    style={{ borderRadius: 'var(--ui-border-radius)' }}
                  >
                    {item.icon}
                    <span className="flex-1 text-left">{item.label}</span>
                    {isDisabled && item.disabledHint && (
                      <span className="text-[10px] text-text-disabled italic">{item.disabledHint}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border-subtle text-[11px] text-text-disabled">
          {/* No inline fontSize override — the shared .kbd utility's 10px is the app-wide
              minimum for legible text (the old fontSize: 9 was flagged by the type audit). */}
          <span><span className="kbd">↑↓</span> navigate</span>
          <span><span className="kbd">↵</span> select</span>
          <span><span className="kbd">esc</span> close</span>
        </div>
      </div>
    </div>,
    document.body
  );
}
