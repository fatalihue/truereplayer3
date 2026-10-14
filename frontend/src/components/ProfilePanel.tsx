import { Fragment, useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, lazy, Suspense } from 'react';
import { AlertTriangle, Search, SearchX, X, Pencil, Copy, Trash2, FolderOpen, FolderMinus, Keyboard, AppWindow, ArrowDownUp, Type, Ban, Power, FolderInput, ChevronsLeft, ChevronsRight, ChevronsDownUp, ChevronsUpDown, Pin, PinOff, FolderPlus, FilePlus, Plus, ChevronRight, ChevronDown, Palette, Zap, Repeat, Repeat2, Hourglass, ArrowUpFromDot, ExternalLink, Info, MoreHorizontal, Hash, Upload, Download, Check } from 'lucide-react';
import type { ProfileEntry, ImportPreviewPayload, ImportResultPayload, ImportConflictResolution, TriggerMode } from '../bridge/messageTypes';
import { useAppState } from '../state/AppStateContext';
import { railInitials, glyphCount, cutGlyphs } from '../utils/profileInitials';
import { carriesConditionProbe } from '../utils/conditionalBlocks';
import { useBridge } from '../bridge/BridgeContext';
import { KbdTag, splitCombo } from './common/KbdTag';
import { compactKey } from '../utils/keyNames';
import { RemovableChip } from './common/RemovableChip';
import { CheckboxBox } from './Checkbox';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { FieldError } from './common/FieldError';
import { Button } from './common/Button';
import { iconButtonClass } from './common/IconButton';
import { TargetConfigDialog } from './TargetConfigDialog';
import { SecurityWarningModal } from './SecurityWarningModal';
import { ImportPreviewDialog } from './ImportPreviewDialog';
import { ImportResultDialog } from './ImportResultDialog';
// Deferred: the only other eager consumer of emoji-picker-react, in a dialog opened on demand.
const ProfileInfoDialog = lazy(() => import('./ProfileInfoDialog').then(m => ({ default: m.ProfileInfoDialog })));
import { useToast } from '../state/ToastContext';
import { useTt } from '../state/LanguageContext';
import { useFlyoutFlip } from '../hooks/useFlyoutFlip';
import { useContextMenuPosition } from '../hooks/useContextMenuPosition';
import { uiZoom } from '../utils/zoomSpace';

interface ContextMenuState {
  x: number;
  y: number;
  profileName: string;
}

interface ProfilePanelProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

// A 24-tone spectrum (3 rows of 8) for folder labels — the owner asked for more variety
// than the previous 16, kept muted enough to sit with the quiet palette. Ordered as a
// continuous hue wheel so the picker reads as a spectrum. Picker options only — folders
// keep whatever colour is saved in profile-order.json.
const FOLDER_COLORS = [
  // Reds → golds
  '#f43f5e', '#ff6b6b', '#fb923c', '#f59e0b', '#d4a020', '#ffd93d', '#84cc16', '#9a9a3e',
  // Greens → cyans → blues
  '#22c55e', '#6bcb77', '#4dd0a0', '#14b8a6', '#06b6d4', '#60cdff', '#42a5f5', '#3b82f6',
  // Indigos → pinks → neutrals
  '#5d5fd1', '#a78bfa', '#c084fc', '#e879f9', '#ef5da8', '#f472b6', '#b3814e', '#7a8599',
];

// Selected-swatch check ink: dark on light swatches, white on dark ones (relative luminance).
function isLightFolderColor(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

// Native click action types — used to count coordinates that would benefit from a
// Convert to Relative/Absolute pass. Module-scoped so it isn't rebuilt every render.
const CONVERTIBLE_CLICK_TYPES = new Set([
  'LeftClickDown', 'LeftClickUp',
  'RightClickDown', 'RightClickUp',
  'MiddleClickDown', 'MiddleClickUp',
  // Combined-mode clicks carry coordinates too — single AND multi. Double/Triple were missing
  // here while the backend's clickTypes set has always converted DoubleClick, so this count
  // under-reported on any profile using one; adding both closes that.
  'LeftClick', 'RightClick', 'MiddleClick', 'DoubleClick', 'TripleClick',
  // Holds carry a point like any other click — the button is held AT it.
  'LeftClickHold', 'RightClickHold', 'MiddleClickHold',
]);

// Alphabetical section ordering. Module scope because it closes over nothing — as a function
// declared inside the component it was a new identity every render, which is exactly the kind of
// dependency the memos below could never list truthfully.
const sortByName = (a: ProfileEntry, b: ProfileEntry) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * Collapsed-rail avatar text when the profile has neither an emoji nor an app icon. One letter
 * stops identifying anything once names follow a pattern — the owner's rail showed nine "F" in
 * a row for Fila 2 … Fila 11 — so: a name ending in a number gives letter + number ("F2",
 * "F10"); two or more words give two initials ("TR" for Trade Roblox, "BV" for Boas-vindas,
 * "WA" for WhatsApp via the camel-case seam); anything else keeps the first letter. Short
 * connectives ("da", "de", "e") are skipped when a real word follows.
 */

// Rail tooltip spelling for a hotkey: the keycap names (PgDn, Esc), joined tight.
const railHotkey = (combo: string) => splitCombo(combo).map(compactKey).join('+');

/** The profile description, trimmed to one readable tooltip line. The field accepts 500 chars;
 *  a tooltip is a line, not a paragraph, so the tail is elided rather than wrapped. */
const DESC_TIP_MAX = 110;
const descTip = (d?: string | null): string => {
  const s = (d ?? '').replace(/\s+/g, ' ').trim();
  // By GRAPHEME: slice counts UTF-16 units and cut an emoji in half, leaving a lone surrogate —
  // sixteen lines above the code in this same file that documents exactly that rule.
  return cutGlyphs(s, DESC_TIP_MAX);
};

export function ProfilePanel({ collapsed = false, onToggleCollapse }: ProfilePanelProps) {
  const tt = useTt();
  const { profiles, profileOrder, actions, settings, buttonStates } = useAppState();
  // Clicker-mode coherence: the ActionBar already declares "Profiles are
  // unavailable in Clicker mode" (Save/Load disabled), yet clicking a row here
  // still activated one — third surface, third story. Activation is now gated;
  // organization (drag, folders, context menu) stays available.
  const isClicker = settings.useCursorClick;
  // Mid-run activation gate: switching (or deselecting) the profile yanks the
  // action list from under the engine. The backend HandleProfileClick refuses it
  // too; this keeps the rows from looking clickable at all.
  const runActive = buttonStates.recordingActive || buttonStates.replayActive;

  // Pre-compute the count of actions whose stored coordinates would benefit from a
  // Convert to Relative/Absolute pass. Used by TargetConfigDialog to show its migration
  // hint when the user toggles UseRelativeCoordinates. Kept in sync with the backend's
  // HandleConvertCoordinates filter (clicks + WaitImage with search region + WaitPixel
  // with pixel set) — change both together if the filter ever changes.
  const convertibleActionCount = useMemo(() => actions.reduce((n, a) => {
    // At-cursor clicks COUNT, because the backend converts them. Their x/y is dormant, not
    // absent — it is what comes back when the row is switched to "This point", so it has to
    // move with every other coordinate or that restore hands back a point from the wrong
    // space. This line and the `clickTypes` filter in HandleConvertCoordinates are one rule
    // in two places: change them together, or the dialog's count starts lying.
    if (CONVERTIBLE_CLICK_TYPES.has(a.actionType)) return n + 1;
    // Mirror the backend's HandleConvertCoordinates which translates both WaitImage
    // and IF Image rows with a set search region, and both WaitPixelColor and IF
    // Pixel rows with set coords. Without these branches the dialog under-reports
    // how many rows will actually be converted when the profile uses conditionals.
    // The screen-text family keeps its region in the same four fields, so it converts too.
    const isImageProbe = a.actionType === 'WaitImage' || a.actionType === 'WaitText'
      || (a.actionType === 'SetVariable' && a.variableMode === 'screen')
      || (carriesConditionProbe(a.actionType) && (a.conditionType === 'ImageFound' || a.conditionType === 'ScreenText'));
    if (isImageProbe
      && typeof a.waitImageSearchW === 'number' && a.waitImageSearchW > 0
      && typeof a.waitImageSearchH === 'number' && a.waitImageSearchH > 0) return n + 1;
    const isPixelProbe = a.actionType === 'WaitPixelColor'
      || (carriesConditionProbe(a.actionType) && a.conditionType === 'PixelColorMatch');
    if (isPixelProbe
      && typeof a.pixelX === 'number' && typeof a.pixelY === 'number') return n + 1;
    return n;
  }, 0), [actions]);
  const { send, subscribe } = useBridge();
  // Stable refcount slot for hotkey:capture — assign-hotkey dialog can be triggered
  // while Settings has its hotkey field focused (modal-over-modal isn't blocked at the
  // route layer), and without a per-mount slot, closing one would disable the backend
  // hook from under the other. See InputHookManager.RegisterCapture.
  const captureOwnerIdRef = useRef(`profile-panel-${crypto.randomUUID()}`);
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  // Confirmation gate for the inline ✕ removals (hotkey / hotstring / profile
  // target / folder target). kind drives which handler runs on confirm; label
  // is shown in the prompt. The 10s undo toast is the second safety net.
  const [confirmRemoval, setConfirmRemoval] = useState<{
    kind: 'hotkey' | 'hotstring' | 'profileTarget' | 'folderTarget';
    name: string;
    label: string;
  } | null>(null);
  const [showHotkeyDialog, setShowHotkeyDialog] = useState<string | null>(null);
  const [hotkeyCapture, setHotkeyCapture] = useState('...');
  const [hotkeyTriggerMode, setHotkeyTriggerMode] = useState<TriggerMode>('onPress');
  const [showHotstringDialog, setShowHotstringDialog] = useState<string | null>(null);
  const [hotstringValue, setHotstringValue] = useState('');
  const [hotstringInstant, setHotstringInstant] = useState(false);
  // Window Target dialogs — the inputs/flags/detection state are now owned by
  // <TargetConfigDialog>. ProfilePanel only tracks which profile/folder is being configured.
  const [showWindowTargetDialog, setShowWindowTargetDialog] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportSelection, setExportSelection] = useState<Record<string, boolean>>({});
  const [exportSearch, setExportSearch] = useState('');
  // Whether the export bundles the folder/pin/grouping layout. Was hardcoded true at every
  // call site; now user-controllable via a checkbox in the export dialog. Defaults on.
  const [includeExportOrg, setIncludeExportOrg] = useState(true);
  // NOTE: there is deliberately no "include sub-profiles" toggle. The export ALWAYS pulls in the
  // profiles the selection RunProfile-calls (transitive) — omitting them ships a broken chain that
  // fails silently on the receiver. The dialog discloses what rides along instead (exportDepNames).
  const [dialogValue, setDialogValue] = useState('');
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
  const [folderDialogName, setFolderDialogName] = useState('');
  // Lowercase to match FOLDER_COLORS entries — the picker highlights by exact
  // string equality, so '#60CDFF' would render the default swatch unselected.
  const [folderDialogColor, setFolderDialogColor] = useState('#60cdff');
  const [showRenameFolderDialog, setShowRenameFolderDialog] = useState<string | null>(null);
  const [showFolderTargetDialog, setShowFolderTargetDialog] = useState<string | null>(null);
  const [showMoveToFolderMenu, setShowMoveToFolderMenu] = useState<string | null>(null);
  // Profile context-menu "More ▸" submenu (Edit info / Duplicate / Open in Explorer).
  const [showProfileMoreMenu, setShowProfileMoreMenu] = useState<string | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{ x: number; y: number; folderName: string } | null>(null);
  const [showFolderColorPicker, setShowFolderColorPicker] = useState<string | null>(null);
  const [dragProfile, setDragProfile] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // folder name or '__ungrouped__'
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  const [dropFolderIndex, setDropFolderIndex] = useState<number | null>(null);
  const dialogInputRef = useRef<HTMLInputElement>(null);
  const folderDialogInputRef = useRef<HTMLInputElement>(null);
  const hotkeyInputRef = useRef<HTMLInputElement>(null);
  const hotstringInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const folderMenuRef = useRef<HTMLDivElement>(null);

  // Build profile map for quick lookup. Memoized on `profiles` so the map (and every
  // derived section list below, which all key off it) isn't rebuilt on unrelated re-renders
  // (drag state, dialog toggles, hover submenus). Only changes when the profile set changes.
  const profileMap = useMemo(() => {
    const m = new Map<string, ProfileEntry>();
    profiles.forEach(p => m.set(p.name, p));
    return m;
  }, [profiles]);

  // Search supports two modes detected from the query prefix:
  //   - "#fps"  → tag mode: matches profiles with a tag containing "fps" (substring,
  //              so "#fp" also catches "fps"). Bare "#" shows everything (just typed
  //              the sigil, hasn't entered the tag yet — feels unresponsive otherwise).
  //   - "fps"   → name mode (default): substring match on the profile name.
  // Mode is picked from the leading char so users can switch without a separate UI.
  const trimmedQuery = searchQuery.trim();
  const isTagSearch = trimmedQuery.startsWith('#');
  const tagSearchTerm = isTagSearch ? trimmedQuery.slice(1).toLowerCase() : '';

  // useCallback, not a plain function, so the identity is STABLE while searchQuery is —
  // which is what lets the memos below list it honestly. Listing a fresh-every-render
  // function instead would satisfy the linter and destroy the memoization it is guarding,
  // recomputing all three section lists on every drag, hover and dialog render.
  // isTagSearch/tagSearchTerm are primitives derived from searchQuery, so they compare by
  // value and add no churn.
  const matchesSearch = useCallback((entry: ProfileEntry) => {
    if (!searchQuery) return true;
    if (isTagSearch) {
      if (tagSearchTerm === '') return true;
      return !!entry.tags?.some(t => t.toLowerCase().includes(tagSearchTerm));
    }
    return entry.name.toLowerCase().includes(searchQuery.toLowerCase());
  }, [searchQuery, isTagSearch, tagSearchTerm]);

  // The three section lists all derive from profileMap + profileOrder + the search query.
  // Memoize so they only recompute when one of those changes — not on drag/dialog/hover
  // re-renders. sortByName is hoisted to module scope: it closes over nothing, so it never
  // needed to be a dependency at all.
  const pinnedProfiles = useMemo(() => (profileOrder?.pinned ?? [])
    .filter(n => profileMap.has(n) && matchesSearch(profileMap.get(n)!))
    .map(n => profileMap.get(n)!)
    .sort(sortByName), [profileMap, profileOrder, matchesSearch]);

  const folderSections = useMemo(() => (profileOrder?.folders ?? []).map(f => ({
    ...f,
    profiles: f.items
      .filter(n => profileMap.has(n) && matchesSearch(profileMap.get(n)!))
      .map(n => profileMap.get(n)!)
      .sort(sortByName)
  })), [profileMap, profileOrder, matchesSearch]);

  const ungroupedProfiles = useMemo(() => {
    // Collect all profiles referenced in profileOrder sections
    const allReferenced = new Set<string>([
      ...(profileOrder?.pinned ?? []),
      ...(profileOrder?.folders ?? []).flatMap(f => f.items),
      ...(profileOrder?.ungroupedOrder ?? [])
    ]);

    // Include any profiles not in any section (handles race condition on startup)
    const ungroupedNames = [
      ...(profileOrder?.ungroupedOrder ?? []),
      ...profiles.filter(p => !allReferenced.has(p.name)).map(p => p.name)
    ];

    return ungroupedNames
      .filter(n => profileMap.has(n) && matchesSearch(profileMap.get(n)!))
      .map(n => profileMap.get(n)!)
      .sort(sortByName);
  }, [profileMap, profileOrder, profiles, matchesSearch]);

  // If searching, show flat filtered list instead of sections. Reuses matchesSearch so
  // #tag mode works here too — was previously a separate name-only filter, which silently
  // broke tag-search by returning the unfiltered list when the prefix didn't match a name.
  const isSearching = searchQuery.length > 0;
  const filtered = useMemo(() => isSearching
    ? profiles.filter(matchesSearch)
    : profiles, [profiles, isSearching, matchesSearch]);

  // Collapsed-rail list: the PANEL's display order (pinned → folders → ungrouped), not
  // the raw backend order `filtered` carries. With ~80 profiles and ~14 visible slots
  // the rail shows a prefix, so WHICH prefix matters — pinned lands first and stays
  // reachable. The three section memos are already search-aware, so an active query
  // filters the rail too (the search button's dot signals that). Dedup by name defends
  // against a profile referenced by two sections rendering twice.
  const railProfiles = useMemo(() => {
    const seen = new Set<string>();
    const out: ProfileEntry[] = [];
    for (const p of [...pinnedProfiles, ...folderSections.flatMap(f => f.profiles), ...ungroupedProfiles]) {
      if (!seen.has(p.name)) { seen.add(p.name); out.push(p); }
    }
    return out;
  }, [pinnedProfiles, folderSections, ungroupedProfiles]);

  // Which of the rail's three groups a profile sits in — pinned, a folder, loose. The rail
  // draws a thin divider where the group changes, so the boundaries the panel shows as
  // sections are visible in the strip too (the folder dot says "in a folder", not where the
  // folders start). Pinned wins over folder, matching railProfiles' dedup order.
  type RailGroup = 'pinned' | 'folder' | 'loose';
  const railGroupOf = useMemo(() => {
    const m = new Map<string, RailGroup>();
    for (const p of ungroupedProfiles) m.set(p.name, 'loose');
    for (const f of folderSections) for (const p of f.profiles) m.set(p.name, 'folder');
    for (const p of pinnedProfiles) m.set(p.name, 'pinned');
    return m;
  }, [pinnedProfiles, folderSections, ungroupedProfiles]);
  const railBoundaries = useMemo(() => {
    let n = 0;
    for (let i = 1; i < railProfiles.length; i++) {
      if (railGroupOf.get(railProfiles[i].name) !== railGroupOf.get(railProfiles[i - 1].name)) n++;
    }
    return n;
  }, [railProfiles, railGroupOf]);

  // Off-screen-measure-then-reposition for both menus, one hook call each — the two
  // stay independent, so a folder menu opening never disturbs a profile menu's
  // measurement pass. The hook owns the position state, which is why the dismiss
  // handler below only clears the anchor: with no anchor there is no menu to render,
  // and the hook drops the position on the same commit.
  const menuPos = useContextMenuPosition(contextMenu, contextMenuRef);
  const folderMenuPos = useContextMenuPosition(folderContextMenu, folderMenuRef);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [contextMenu]);

  // Submenu flip — each of the three context-menu submenus (Move to folder, More,
  // and the folder Color picker) opens to the side with `left-full top-0`, which
  // clips when the parent menu sits near the right or bottom edge. useFlyoutFlip
  // measures on open and tells us which way to flip. The open flags mirror the
  // render conditions below so the hook and the JSX stay in lockstep.
  const moveMenuOpen = !!contextMenu && showMoveToFolderMenu === contextMenu.profileName;
  const moveFlyout = useFlyoutFlip(moveMenuOpen, 'side');
  const moreMenuOpen = !!contextMenu && showProfileMoreMenu === contextMenu.profileName;
  const moreFlyout = useFlyoutFlip(moreMenuOpen, 'side');
  const colorMenuOpen = !!folderContextMenu && showFolderColorPicker === folderContextMenu.folderName;
  const colorFlyout = useFlyoutFlip(colorMenuOpen, 'side');

  // Focus dialog input when opened
  useEffect(() => {
    if ((showCreateDialog || showRenameDialog) && dialogInputRef.current) {
      dialogInputRef.current.focus();
      dialogInputRef.current.select();
    }
  }, [showCreateDialog, showRenameDialog]);

  // Focus hotkey input when dialog opens
  useEffect(() => {
    if (showHotkeyDialog && hotkeyInputRef.current) {
      hotkeyInputRef.current.focus();
    }
  }, [showHotkeyDialog]);

  // Focus hotstring input when dialog opens
  useEffect(() => {
    if (showHotstringDialog && hotstringInputRef.current) {
      hotstringInputRef.current.focus();
    }
  }, [showHotstringDialog]);


  const handleExportClick = () => {
    setExportSelection({});
    setExportSearch('');
    setIncludeExportOrg(true);
    setShowExportDialog(true);
  };

  // ── Import flow state ──
  // The flow is: user clicks Import → C# shows file picker + parses envelope →
  // emits profile:importPreview → we set `importPreview` → render security warning
  // (if requiresAcknowledgement) → render ImportPreviewDialog → user picks profiles →
  // we send profile:confirmImport → C# writes + emits alert + profiles:updated.
  //
  // Two separate state slots so the warning can stand alone (canceling it returns
  // to "nothing pending", not "show the preview anyway"). `pendingPreview` holds the
  // preview during the brief moment the warning is on screen.
  const [securityWarningOpen, setSecurityWarningOpen] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<ImportPreviewPayload | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewPayload | null>(null);
  // Post-import result dialog — only pushed by the backend when the import finished
  // with something worth reading; a clean import stays a plain success toast.
  const [importResult, setImportResult] = useState<ImportResultPayload | null>(null);

  // Info dialog — opened from the profile context menu, edits sharing metadata.
  const [showInfoDialog, setShowInfoDialog] = useState<string | null>(null);

  const handleImportClick = () => {
    send({ type: 'profile:import', payload: {} });
  };

  // Listen for the preview message and route through the warning if needed; the
  // post-import result lands here too (its dialog lives in this component). The
  // export toast, by contrast, is composed in ToastContext with the other
  // backend-push toasts — palette exports must not depend on this panel.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'profile:importPreview') {
        if (msg.payload.requiresAcknowledgement) {
          setPendingPreview(msg.payload);
          setSecurityWarningOpen(true);
        } else {
          setImportPreview(msg.payload);
        }
      } else if (msg.type === 'profile:importResult') {
        setImportResult(msg.payload);
      }
    });
  }, [subscribe]);

  const handleSecurityContinue = (dontShowAgain: boolean) => {
    if (dontShowAgain) {
      send({ type: 'settings:acknowledgeImportWarning', payload: {} });
    }
    setSecurityWarningOpen(false);
    if (pendingPreview) {
      setImportPreview(pendingPreview);
      setPendingPreview(null);
    }
  };

  const handleSecurityCancel = () => {
    // Cancelling the warning aborts the whole import. Tell the bridge so the server-side
    // parsed envelope doesn't linger in memory until the next import overwrites it.
    setSecurityWarningOpen(false);
    setPendingPreview(null);
    send({ type: 'profile:cancelImport', payload: {} });
  };

  const handlePreviewConfirm = (
    selectedNames: string[],
    conflictResolutions: Record<string, ImportConflictResolution>
  ) => {
    if (selectedNames.length > 0) {
      send({ type: 'profile:confirmImport', payload: { selectedNames, conflictResolutions } });
    } else {
      // Empty selection with confirm clicked is effectively a cancel — clear server side too.
      send({ type: 'profile:cancelImport', payload: {} });
    }
    setImportPreview(null);
  };

  const handlePreviewCancel = () => {
    // Mirror handleSecurityCancel for the second possible dismissal point.
    setImportPreview(null);
    send({ type: 'profile:cancelImport', payload: {} });
  };

  const handleShowInfo = (name: string) => {
    setContextMenu(null);
    setShowInfoDialog(name);
  };

  // Second door for the Info dialog, from the command palette. The first one is right-click →
  // hover "More" → "Edit info…", a submenu buried deeply enough that a synthetic click cannot
  // even open it — for the dialog that owns the description and the tags the #tag search runs on.
  // Scoped to the ACTIVE profile, like every other profile command in the palette.
  useEffect(() => {
    const open = () => {
      const active = profiles.find(p => p.isActive);
      if (active) setShowInfoDialog(active.name);
    };
    window.addEventListener('cmd:profileinfo', open);
    return () => window.removeEventListener('cmd:profileinfo', open);
  }, [profiles]);

  // Profiles currently visible in the export dialog (after the search filter). Select-All,
  // the count, and confirmExport all scope to these so a filter never touches hidden profiles.
  const visibleExportNames = profiles
    .filter(p => !exportSearch || p.name.toLowerCase().includes(exportSearch.toLowerCase()))
    .map(p => p.name);

  const allExportSelected = visibleExportNames.length > 0 && visibleExportNames.every(n => exportSelection[n]);

  const toggleExportSelectAll = () => {
    const newVal = !allExportSelected;
    // Flip only the visible profiles; preserve any selection made on filtered-out ones.
    setExportSelection(prev => {
      const updated = { ...prev };
      visibleExportNames.forEach(n => { updated[n] = newVal; });
      return updated;
    });
  };

  const toggleExportProfile = (name: string) => {
    setExportSelection(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const toggleExportFolder = (folderItems: string[]) => {
    const allSelected = folderItems.every(n => exportSelection[n]);
    const updated = { ...exportSelection };
    folderItems.forEach(n => { updated[n] = !allSelected; });
    setExportSelection(updated);
  };

  // The EXTRA profiles that ride along with the current selection because it calls them via Run
  // Profile. Sub-profiles are ALWAYS bundled (no opt-out): leaving them out ships a knowingly
  // broken export, and it fails SILENTLY — the receiver's HandleRunProfile finds no such profile
  // and skips the step with no error, so the macro "runs" while quietly doing less. So this is not
  // a choice, it's a disclosure of what's going along. This is a best-effort PREVIEW built from the
  // ON-DISK profiles (runProfileTargets is read when the list loads), so it can lag an unsaved grid
  // edit; the AUTHORITATIVE egress disclosure is the post-export toast, which names what actually
  // shipped after any Save-on-export. Mirrors ExpandWithRunProfileDependenciesAsync over that disk
  // state: refs are trimmed and resolved by EXACT (Ordinal) name to a local profile — a case-
  // differing or dangling ref resolves to nothing and bundles nothing — the walk is transitive, and
  // the seen-set dedups case-INSENSITIVELY. Already-selected profiles never appear (they ship
  // regardless). Returned in discovery order, matching the backend.
  const exportDepNames = useMemo<string[]>(() => {
    const seeds = profiles.map(p => p.name).filter(name => exportSelection[name]);
    if (seeds.length === 0) return [];
    const byExactName = new Map(profiles.map(p => [p.name, p]));
    const seen = new Set(seeds.map(n => n.toLowerCase()));
    const queue = [...seeds];
    const extra: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const raw of byExactName.get(current)?.runProfileTargets ?? []) {
        const ref = (raw ?? '').trim();
        if (!ref) continue;
        const local = byExactName.get(ref);
        if (!local) continue;
        const key = local.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        extra.push(local.name);
        queue.push(local.name);
      }
    }
    return extra;
  }, [profiles, exportSelection]);

  const confirmExport = () => {
    // Export EVERY checked profile, including ones the current search filter hides. Scoping to
    // the visible set silently dropped profiles the user had checked before filtering — they
    // stayed visually ticked but never shipped. The dialog footer surfaces any hidden-but-checked
    // count so the total is never a surprise.
    const selectedNames = profiles.map(p => p.name).filter(name => exportSelection[name]);
    if (selectedNames.length > 0) {
      // includeDependencies is ALWAYS true — a chain exported without its sub-profiles arrives
      // broken and fails silently at replay, so it is never a user choice. A no-op when the
      // selection calls nothing.
      send({ type: 'profile:export', payload: { names: selectedNames, includeOrganization: includeExportOrg, includeDependencies: true } });
    }
    setShowExportDialog(false);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, name: string) => {
    e.preventDefault();
    // Clear any submenu left open from a previous menu. Otherwise, re-right-clicking the
    // same profile would re-satisfy `showXMenu === profileName` and auto-open the submenu
    // *during* the new menu's off-screen measurement pass, so useFlyoutFlip would measure
    // garbage coordinates and never re-flip. Submenus should only open via genuine hover,
    // after the menu has settled at its final position.
    setShowMoveToFolderMenu(null);
    setShowProfileMoreMenu(null);
    setContextMenu({ x: e.clientX, y: e.clientY, profileName: name });
  }, []);

  // WHERE the profile is created is decided by WHICH control was pressed, and nothing else.
  // The toolbar / rail / empty-state buttons pass null (root); a folder's own "+ New profile"
  // row passes its name. It used to come from `selectedFolder` — the folder you last clicked —
  // which nothing ever cleared: one click on a folder header, made for any reason, silently sent
  // every profile created afterwards into it, with the dialog never naming a destination.
  // Callers must pass explicitly, so an onClick handler cannot leak its event in as a folder.
  const [createFolder, setCreateFolder] = useState<string | null>(null);
  const handleCreate = useCallback((folder: string | null) => {
    setContextMenu(null);
    setFolderContextMenu(null);
    setDialogValue('');
    setCreateFolder(folder);
    setShowCreateDialog(true);
  }, []);

  // NOT a command palette trigger — the palette dispatches neither of these. Same finding as
  // 45b7420, which corrected the identical sentence over the five cmd:* listeners in Toolbar.tsx
  // and counted SEVEN in this state overall; these are the two it did not touch, and they were the
  // ones a reader hunting dead code in this file would meet first.
  //
  // They STAY, for the reason recorded there: cmd:* is the deliberate extension point for opening a
  // surface from outside the component that owns it. Wiring a palette entry to either of these is
  // one line in CommandPalette.tsx and needs no change here — the listener IS the interface.
  useEffect(() => {
    const onCmd = () => handleCreate(null);
    window.addEventListener('cmd:newprofile', onCmd);
    return () => window.removeEventListener('cmd:newprofile', onCmd);
  }, [handleCreate]);

  useEffect(() => {
    const handler = () => {
      setFolderDialogName('');
      setFolderDialogColor('#60cdff');
      setShowCreateFolderDialog(true);
    };
    window.addEventListener('cmd:newfolder', handler);
    return () => window.removeEventListener('cmd:newfolder', handler);
  }, []);

  const handleRename = (name: string) => {
    setContextMenu(null);
    setDialogValue(name);
    setShowRenameDialog(name);
  };

  const handleDuplicate = (name: string) => {
    setContextMenu(null);
    send({ type: 'profile:duplicate', payload: { name } });
  };

  const handleToggleDisable = (name: string) => {
    setContextMenu(null);
    send({ type: 'profile:toggleDisable', payload: { name } });
  };

  const handleDelete = (name: string) => {
    setContextMenu(null);
    setShowDeleteConfirm(name);
  };

  const confirmDelete = () => {
    if (showDeleteConfirm) {
      send({ type: 'profile:delete', payload: { name: showDeleteConfirm } });
    }
    setShowDeleteConfirm(null);
  };

  const handleOpenFolder = (name: string) => {
    setContextMenu(null);
    send({ type: 'profile:openFolder', payload: { name } });
  };

  // Header-button variant: opens the Profiles directory itself without selecting any file.
  // Works even when no profile is loaded — the user might be looking to manually drop a
  // .json in there, browse what's saved, or back things up.
  const handleOpenProfilesFolder = () => {
    send({ type: 'profile:openFolder', payload: {} });
  };

  const handleAssignHotkey = (name: string) => {
    setContextMenu(null);
    const existing = profiles.find(p => p.name === name);
    // Pre-fill hotkey with existing so user can change just the trigger mode without re-capturing.
    setHotkeyCapture(existing?.hotkey || '...');
    setHotkeyTriggerMode(existing?.triggerMode || 'onPress');
    setShowHotkeyDialog(name);
    // Capture mode (not just suppress): the backend low-level hook composes each keydown
    // and emits it via 'hotkey:captured'. Without this, the WebView2 JS layer never sees
    // Win+letter combos because the Windows Shell intercepts them at OS level first.
    send({ type: 'hotkey:capture', payload: { enabled: true, ownerId: captureOwnerIdRef.current } });
  };

  const handleRemoveHotkey = (name: string) => {
    setContextMenu(null);
    // Snapshot the previous hotkey + trigger mode BEFORE issuing the remove. The Undo
    // re-sends the original assign payload so the round-trip is exact — same hotkey,
    // same trigger mode. If the profile already had no hotkey somehow, we skip the toast.
    const prev = profiles.find(p => p.name === name);
    const prevHotkey = prev?.hotkey ?? null;
    const prevMode = prev?.triggerMode ?? 'onPress';
    send({ type: 'profile:removeHotkey', payload: { name } });
    if (prevHotkey) {
      showToast(tt(`Removed hotkey ${prevHotkey} from "${name}"`, `Hotkey ${prevHotkey} removido de "${name}"`), {
        type: 'success',
        duration: 10000, // longer undo window for destructive metadata removals (user request)
        action: {
          label: 'Undo',
          onClick: () => send({ type: 'profile:assignHotkey', payload: { name, hotkey: prevHotkey, mode: prevMode } }),
        },
      });
    }
  };

  const handleAssignHotstring = (name: string) => {
    setContextMenu(null);
    const existing = profiles.find(p => p.name === name);
    setHotstringValue(existing?.hotstring ?? '');
    setHotstringInstant(existing?.hotstring ? existing.hotstringInstant : true);
    setShowHotstringDialog(name);
    send({ type: 'hotkey:suppress', payload: { enabled: true } });
  };

  const handleRemoveHotstring = (name: string) => {
    setContextMenu(null);
    const prev = profiles.find(p => p.name === name);
    const prevSeq = prev?.hotstring ?? null;
    const prevInstant = prev?.hotstringInstant ?? true;
    send({ type: 'profile:removeHotstring', payload: { name } });
    if (prevSeq) {
      showToast(tt(`Removed hotstring "${prevSeq}" from "${name}"`, `Hotstring "${prevSeq}" removido de "${name}"`), {
        type: 'success',
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => send({ type: 'profile:assignHotstring', payload: { name, sequence: prevSeq, instant: prevInstant } }),
        },
      });
    }
  };

  const confirmHotstring = () => {
    const seq = hotstringValue.trim().toLowerCase();
    if (showHotstringDialog && seq.length >= 2) {
      send({
        type: 'profile:assignHotstring',
        payload: { name: showHotstringDialog, sequence: seq, instant: hotstringInstant }
      });
      // Closed optimistically, like confirmHotkey and for its reason: waiting on profiles:updated
      // alone left the dialog — and the global hotkey suppression it holds — stuck open on the
      // paths that never push it. Every refusal on the backend speaks through alert:show (a
      // collision, a profile that was renamed or deleted meanwhile), so a closed dialog still
      // says why the sequence did not take.
      setShowHotstringDialog(null);
    }
  };

  const handleSetWindowTarget = (name: string) => {
    setContextMenu(null);
    setShowWindowTargetDialog(name);
  };

  // Folder-target remove with Undo — the same round-trip as handleRemoveWindowTarget below. The
  // toast used to fire the moment the message went out, so a removal the backend REFUSED (a
  // member's hotkey that would collide once the target is gone) still read "Removed" with an Undo,
  // next to the alert saying it was not. And its Undo resent the target alone: the setter reads
  // missing flags as false, so a folder recorded in relative coordinates came back absolute and
  // its members' clicks landed off by the window origin, under a toast that said "restored". Now
  // the toast waits for profile:folderWindowTargetRemoved, which carries EVERYTHING the removal
  // wiped — the flags and the captured rect — and the Undo puts all of it back.
  const pendingFolderRemovalsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== 'profile:folderWindowTargetRemoved') return;
      const r = msg.payload;
      if (!pendingFolderRemovalsRef.current.delete(r.folderName) || !r.hadTarget) return;
      const label = r.processName || r.windowTitle || 'target';
      showToast(tt(`Removed folder target (${label}) from "${r.folderName}"`, `Alvo da pasta (${label}) removido de "${r.folderName}"`), {
        type: 'success',
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => send({
            type: 'profile:setFolderWindowTarget',
            payload: {
              folderName: r.folderName,
              processName: r.processName,
              windowTitle: r.windowTitle,
              titleMatchMode: r.titleMatchMode,
              relativeCoordinates: r.relativeCoordinates,
              bringToFocus: r.bringToFocus,
              restorePosition: r.restorePosition,
              restoreSize: r.restoreSize,
              windowX: r.windowX,
              windowY: r.windowY,
              windowWidth: r.windowWidth,
              windowHeight: r.windowHeight,
            },
          }),
        },
      });
    });
  }, [subscribe, send, showToast, tt]);
  const handleRemoveFolderWindowTarget = (folderName: string) => {
    pendingFolderRemovalsRef.current.add(folderName);
    send({ type: 'profile:removeFolderWindowTarget', payload: { folderName } });
  };

  // Pending window-target removals: stash the prev values keyed by name. When the backend
  // confirms via profile:windowTargetRemoved we look up + show the success toast with the
  // matching Undo payload. Without this round-trip the toast fired optimistically and
  // contradicted the backend's "Cannot remove" alert when the removal was blocked by a
  // hotkey/hotstring collision.
  const pendingRemovalsRef = useRef<Map<string, {
    label: string;
    processName: string;
    windowTitle: string;
    titleMatchMode: string;
    relativeCoordinates: boolean;
    bringToFocus: boolean;
    restorePosition: boolean;
    restoreSize: boolean;
  }>>(new Map());

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== 'profile:windowTargetRemoved') return;
      const { name, windowX, windowY, windowWidth, windowHeight } = msg.payload;
      const prev = pendingRemovalsRef.current.get(name);
      if (!prev) return;  // Not ours, or already handled (defensive)
      pendingRemovalsRef.current.delete(name);
      showToast(tt(`Removed window target (${prev.label}) from "${name}"`, `Janela-alvo (${prev.label}) removida de "${name}"`), {
        type: 'success',
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => send({
            type: 'profile:setWindowTarget',
            payload: {
              name,
              processName: prev.processName,
              windowTitle: prev.windowTitle,
              titleMatchMode: prev.titleMatchMode,
              relativeCoordinates: prev.relativeCoordinates,
              bringToFocus: prev.bringToFocus,
              restorePosition: prev.restorePosition,
              restoreSize: prev.restoreSize,
              // The captured rect the removal zeroed, from the confirmation (the profile list does
              // not carry geometry). Without it a profile that was not the active one came back
              // with Restore Position/Size on over 0,0,0,0 — switches that did nothing.
              windowX, windowY, windowWidth, windowHeight,
            },
          }),
        },
      });
    });
    // `tt` is a dep: it's memoised on [language], and this effect closes over it for the toast.
    // Without it the subscription would freeze tt at the mount-time language and a later language
    // switch would render the "Removed window target" Undo toast in the previous language.
  }, [subscribe, send, showToast, tt]);

  const handleRemoveWindowTarget = (name: string) => {
    setContextMenu(null);
    // Capture all the fields needed to reconstruct the prior target, so the Undo toast
    // (shown after the backend confirms) can restore the exact state. Only profiles with
    // their own target (not folder-inherited) actually go through the remove → confirm
    // round-trip; otherwise the message is a no-op server-side.
    const prev = profiles.find(p => p.name === name);
    const hadOwn = prev?.hasWindowTarget;
    if (!hadOwn) {
      // No own target → backend won't change anything → no confirmation event coming.
      // Still send for symmetry (handler is a no-op when nothing to remove).
      send({ type: 'profile:removeWindowTarget', payload: { name } });
      return;
    }
    const prevProcess = prev?.windowTargetProcessName ?? '';
    const prevTitle = prev?.windowTargetWindowTitle ?? '';
    const label = prevProcess || prevTitle || 'target';
    pendingRemovalsRef.current.set(name, {
      label,
      processName: prevProcess,
      windowTitle: prevTitle,
      titleMatchMode: prev?.windowTargetTitleMatchMode ?? 'contains',
      relativeCoordinates: prev?.useRelativeCoordinates ?? false,
      bringToFocus: prev?.bringToFocus ?? false,
      restorePosition: prev?.restorePosition ?? false,
      restoreSize: prev?.restoreSize ?? false,
    });
    send({ type: 'profile:removeWindowTarget', payload: { name } });
  };

  // Runs the actual removal once the confirmation dialog is accepted. The
  // individual handlers still fire their own 10s undo toast.
  const runConfirmedRemoval = () => {
    if (!confirmRemoval) return;
    const { kind, name } = confirmRemoval;
    setConfirmRemoval(null);
    if (kind === 'hotkey') handleRemoveHotkey(name);
    else if (kind === 'hotstring') handleRemoveHotstring(name);
    else if (kind === 'profileTarget') handleRemoveWindowTarget(name);
    else if (kind === 'folderTarget') handleRemoveFolderWindowTarget(name);
  };

  const confirmHotkey = () => {
    if (showHotkeyDialog && hotkeyCapture && hotkeyCapture !== '...') {
      send({ type: 'profile:assignHotkey', payload: { name: showHotkeyDialog, hotkey: hotkeyCapture, mode: hotkeyTriggerMode } });
      // Close optimistically rather than waiting solely on profiles:updated. The backend
      // doesn't push that message on every path (e.g. a profile that fails to load), which
      // previously left the dialog stuck open with no feedback. On a hotkey conflict the
      // backend emits alert:show, which ToastContext already surfaces as a toast, so the
      // user still sees why the bind didn't take even though the dialog has closed.
      setShowHotkeyDialog(null);
    }
  };

  // Disable backend capture mode when hotkey dialog closes. `send` is a stable useCallback
  // from BridgeContext (deps []), so listing it here doesn't cause extra re-runs — only
  // silences exhaustive-deps without changing behaviour.
  useEffect(() => {
    if (!showHotkeyDialog) {
      send({ type: 'hotkey:capture', payload: { enabled: false, ownerId: captureOwnerIdRef.current } });
    }
  }, [showHotkeyDialog, send]);

  // While the hotkey dialog is open, the backend hook composes every keypress and
  // emits the combo here. The JS layer never sees Win+letter combos directly (Shell
  // intercepts), so the backend round-trip is the only way to capture them.
  useEffect(() => {
    if (!showHotkeyDialog) return;
    return subscribe((msg) => {
      if (msg.type === 'hotkey:captured') {
        setHotkeyCapture(msg.payload.combo);
      }
    });
  }, [showHotkeyDialog, subscribe]);

  // Suppress global hotkeys while hotstring dialog is open. `send` is stable (see note above).
  useEffect(() => {
    if (!showHotstringDialog) {
      send({ type: 'hotkey:suppress', payload: { enabled: false } });
    }
  }, [showHotstringDialog, send]);

  // Auto-close hotstring dialog when profile list updates
  useEffect(() => {
    if (!showHotstringDialog) return;
    return subscribe((msg) => {
      if (msg.type === 'profiles:updated') {
        setShowHotstringDialog(null);
      }
    });
  }, [showHotstringDialog, subscribe]);

  // Window target detection events (windowTarget:detected, windowTarget:detectState) are
  // subscribed by <TargetConfigDialog> itself when one is mounted. Nothing to wire here.

  const confirmCreate = () => {
    const name = dialogValue.trim();
    if (!name) { setShowCreateDialog(false); return; }
    // Block duplicate names client-side (mirrors the backend File.Exists guard, case-insensitive
    // like the Windows file system) so the dialog stays open for a quick fix.
    if (profiles.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
    send({ type: 'profile:create', payload: { name, folder: createFolder || undefined } });
    setShowCreateDialog(false);
  };

  const confirmRename = () => {
    const newName = dialogValue.trim();
    if (!newName || !showRenameDialog || newName === showRenameDialog) {
      setShowRenameDialog(null);
      return;
    }
    // Block collisions with OTHER profiles client-side (mirrors the backend); keep dialog open.
    if (profiles.some(p => p.name !== showRenameDialog && p.name.toLowerCase() === newName.toLowerCase())) return;
    send({ type: 'profile:rename', payload: { oldName: showRenameDialog, newName } });
    setShowRenameDialog(null);
  };

  // Duplicate-name state for the profile dialogs' button-disable + inline hint (mirrors the
  // backend File.Exists guard: case-insensitive, like the file system). Rename excludes the
  // profile being renamed (re-typing its own name / a pure re-casing is allowed).
  const dialogValueLc = dialogValue.trim().toLowerCase();
  const createProfileNameTaken = !!dialogValueLc
    && profiles.some(p => p.name.toLowerCase() === dialogValueLc);
  const renameProfileNameTaken = !!dialogValueLc
    && profiles.some(p => p.name !== showRenameDialog && p.name.toLowerCase() === dialogValueLc);

  // ── Folder handlers ──
  const handleCreateFolder = () => {
    setFolderDialogName('');
    setFolderDialogColor('#60cdff');
    setShowCreateFolderDialog(true);
  };

  const confirmCreateFolder = () => {
    const name = folderDialogName.trim();
    if (!name) { setShowCreateFolderDialog(false); return; }
    // Block duplicate names client-side (mirrors the backend guard) so the dialog stays open
    // for a quick fix instead of closing and surfacing a toast after the round-trip.
    if ((profileOrder?.folders ?? []).some(f => f.name.toLowerCase() === name.toLowerCase())) return;
    send({ type: 'profile:createFolder', payload: { name, color: folderDialogColor } });
    setShowCreateFolderDialog(false);
  };

  const handleRenameFolder = (folderName: string) => {
    setFolderContextMenu(null);
    setFolderDialogName(folderName);
    setShowRenameFolderDialog(folderName);
  };

  const confirmRenameFolder = () => {
    const newName = folderDialogName.trim();
    if (!newName || !showRenameFolderDialog || newName === showRenameFolderDialog) {
      setShowRenameFolderDialog(null);
      return;
    }
    // Block collisions with OTHER folders client-side (mirrors the backend); keep the dialog open.
    if ((profileOrder?.folders ?? []).some(f => f.name !== showRenameFolderDialog && f.name.toLowerCase() === newName.toLowerCase())) return;
    send({ type: 'profile:renameFolder', payload: { oldName: showRenameFolderDialog, newName } });
    setShowRenameFolderDialog(null);
  };

  // Duplicate-name state for the folder dialogs' button-disable + inline hint (mirrors the
  // backend reject: trimmed, case-insensitive). Rename excludes the folder being renamed.
  const folderDialogNameLc = folderDialogName.trim().toLowerCase();
  const createFolderNameTaken = !!folderDialogNameLc
    && (profileOrder?.folders ?? []).some(f => f.name.toLowerCase() === folderDialogNameLc);
  const renameFolderNameTaken = !!folderDialogNameLc
    && (profileOrder?.folders ?? []).some(f => f.name !== showRenameFolderDialog && f.name.toLowerCase() === folderDialogNameLc);

  const handleDeleteFolder = (folderName: string) => {
    setFolderContextMenu(null);
    send({ type: 'profile:deleteFolder', payload: { name: folderName } });
  };

  const handleSetFolderColor = (folderName: string, color: string) => {
    send({ type: 'profile:setFolderColor', payload: { name: folderName, color } });
    setShowFolderColorPicker(null);
    setFolderContextMenu(null);
  };

  const handleToggleFolderCollapse = (folderName: string) => {
    send({ type: 'profile:toggleFolderCollapse', payload: { name: folderName } });
  };

  const handlePinProfile = (name: string) => {
    setContextMenu(null);
    send({ type: 'profile:pin', payload: { name } });
  };

  const handleUnpinProfile = (name: string) => {
    setContextMenu(null);
    send({ type: 'profile:unpin', payload: { name } });
  };

  const handleMoveToFolder = (profileName: string, folderName: string | null) => {
    setContextMenu(null);
    setShowMoveToFolderMenu(null);
    send({ type: 'profile:moveToFolder', payload: { profileName, folderName } });
  };

  const handleFolderContextMenu = (e: React.MouseEvent, folderName: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Clear a stale color-picker submenu so it can't auto-open during the menu's off-screen
    // measurement pass (see handleContextMenu for why that breaks useFlyoutFlip).
    setShowFolderColorPicker(null);
    setFolderContextMenu({ x: e.clientX, y: e.clientY, folderName });
  };

  // Close folder context menu on click outside or Escape
  useEffect(() => {
    if (!folderContextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderContextMenu(null);
        setShowFolderColorPicker(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setFolderContextMenu(null);
        setShowFolderColorPicker(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [folderContextMenu]);

  // Focus folder dialog input
  useEffect(() => {
    if ((showCreateFolderDialog || showRenameFolderDialog) && folderDialogInputRef.current) {
      folderDialogInputRef.current.focus();
      folderDialogInputRef.current.select();
    }
  }, [showCreateFolderDialog, showRenameFolderDialog]);

  const isPinned = (name: string) => profileOrder?.pinned?.includes(name) ?? false;

  // Wrapped in useCallback so the drag-effect below can list it as a dep without
  // re-subscribing window listeners on every render — without the memoisation the
  // identity would change on every parent re-render and the effect would re-mount
  // its mousemove/up listeners constantly during a drag.
  // Also the rail tooltip's folder NAME (the expanded list shows it as the section header, and
  // the tooltip is the rail's only detail read). That was a second, byte-identical copy of this
  // function under another name — one rule about which folder owns a profile, written twice.
  const getProfileFolder = useCallback((name: string): string | null => {
    for (const f of profileOrder?.folders ?? []) {
      if (f.items.includes(name)) return f.name;
    }
    return null;
  }, [profileOrder?.folders]);

  // Window-target tooltip label: show the .exe name (user request). The stored
  // process name may or may not carry the extension depending on what was typed
  // in the target dialog, so normalise to "<name>.exe". Falls back to the window
  // title when there's no process name, and to a generic label otherwise.
  const targetLabel = (procName?: string | null, windowTitle?: string | null): string => {
    if (procName) return /\.exe$/i.test(procName) ? procName : `${procName}.exe`;
    if (windowTitle) return windowTitle;
    return 'Window target';
  };

  // Folder colour for the collapsed rail's avatar dot — tells which folder a
  // profile lives in without expanding the panel. null = ungrouped (no dot).
  const getProfileFolderColor = useCallback((name: string): string | null => {
    for (const f of profileOrder?.folders ?? []) {
      if (f.items.includes(name)) return f.color;
    }
    return null;
  }, [profileOrder?.folders]);

  // Collapsed-rail "search" action: expand the panel with the search field
  // already focused (mirrors the SettingsPanel rail's expand-into-section flow).
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingFocusSearch = useRef(false);
  useEffect(() => {
    if (!collapsed && pendingFocusSearch.current) {
      pendingFocusSearch.current = false;
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [collapsed]);

  // Collapsed-rail capacity: how many 32px avatars (+4px gap = 36px stride) fit
  // in the measured strip height. A ResizeObserver keeps it in sync as the
  // window resizes. When the profile count exceeds capacity the last slot
  // becomes the "+N expand" chip, so the rail always fills the visible space
  // exactly instead of a fixed cap of 10.
  const railRef = useRef<HTMLDivElement>(null);
  const [railHeight, setRailHeight] = useState(356);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const measure = () => setRailHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed]);
  // N avatars take 36N − 4 px (no trailing gap); each group divider takes 9 more (1px line +
  // 4px margins), and comes out of the avatar budget so it never pushes the last slot off the
  // strip → N ≤ (H + 4 − 9·dividers) / 36.
  const railCapacity = Math.max(1, Math.floor((railHeight + 4 - railBoundaries * 9) / 36));

  // ── Drag & Drop handlers (mouse-based, works in WebView2) ──
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragActive = useRef(false);
  const folderRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const ungroupedRef = useRef<HTMLDivElement>(null);
  // Scroll container ref — used to auto-scroll the profile list when dragging near
  // top/bottom edges. Same pattern as ActionTable's DnD: indispensable for long
  // profile lists, otherwise reaching the opposite end mid-drag is impossible.
  const scrollRef = useRef<HTMLDivElement>(null);

  // Show the full-name tooltip ONLY on rows whose name is actually cut. "Is it cut?" is a
  // layout fact — it depends on the row's own gutter, which varies with the width of that
  // row's hotkey chip — so it cannot be answered from the string. Measured after render and
  // written straight onto the DOM node: TooltipLayer resolves data-tip by delegation at
  // hover time, so the attribute only has to be right, not to come from JSX. Doing it here
  // instead of in state also keeps it off the render path — no second pass for 80 rows.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const measure = () => {
      for (const cell of root.querySelectorAll<HTMLElement>('[data-name-cell]')) {
        // Two shapes share this cell: the split head/tail for a long name, and the plain
        // single-span for a short one. Measure the head when there is one, the cell itself
        // otherwise — the question is the same either way.
        const head = cell.firstElementChild as HTMLElement | null;
        const measured = head ?? cell;
        const cut = measured.scrollWidth > measured.clientWidth;
        // The description rides the same tooltip. It is the one thing the Info dialog asks for
        // ("What does this profile do?") that the app never showed back: the only surface that
        // rendered it was the Import Preview, so the author of the text could not read it and
        // whoever imported the profile could. Cut name and description compose; with the name
        // fully visible the tooltip is the description alone, because repeating what is on
        // screen is what the truncation test above exists to avoid.
        const desc = cell.dataset.desc ?? '';
        // In Clicker mode the row is inert, and the reason lives on an ANCESTOR's data-tip.
        // TooltipLayer resolves by `closest`, so the innermost wins — and this cell became
        // innermost the day it started carrying the description: hovering the profile NAME, which
        // is the natural place to ask "why does clicking this do nothing?", answered with the
        // description instead. It goes first because it is the answer to the more urgent question.
        const tip = [
          isClicker ? tt('Macro mode only', 'Só no modo Macro') : null,
          cut ? (cell.dataset.full ?? '') : null,
          desc,
        ].filter(Boolean).join(' — ');
        if (tip) {
          cell.setAttribute('data-tip', tip);
          cell.setAttribute('data-tip-pos', 'below-start');
        } else {
          cell.removeAttribute('data-tip');
          cell.removeAttribute('data-tip-pos');
        }
      }
    };
    measure();
    // Re-measure on every width change, not just on render. Expanding the panel animates
    // w-12 → w-[260px] over 200 ms, and the effect fires on the commit that STARTS that
    // animation — the panel is still ~48 px wide, so every name measures as cut and every
    // long row got a tooltip that was simply wrong until the next render happened to clear
    // it. The observer also covers the cases a render never signals: a font-size change from
    // the Theme Editor, or any future resizable panel.
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
    // profiles/profileOrder/searchQuery are NOT read inside this effect — querySelectorAll
    // walks whatever is in the DOM right now — but they are exactly what CHANGES that DOM:
    // a rename, a new/removed profile, a folder collapse/expand/reorder, or a search filter
    // all swap which `[data-name-cell]` nodes exist (or widen/narrow a row's hotkey gutter),
    // and none of that resizes `root` itself, so the ResizeObserver above would miss it.
    // Same pattern as the railCapacity effect above ([collapsed], also unread in its body).
    // Without ANY array (the previous state of this effect), it instead reran after EVERY
    // render — including every `mousemove` while dragging a profile or folder — which tore
    // down and rebuilt the ResizeObserver and rescanned every row in the list on each pixel
    // of movement.
    // isClicker/tt join them: both change what the tooltip SAYS, and neither resizes root.
  }, [profiles, profileOrder, searchQuery, isClicker, tt]);

  const AUTOSCROLL_ZONE = 40;
  const AUTOSCROLL_MAX_SPEED = 14;
  const autoScrollRaf = useRef<number | null>(null);
  const cursorY = useRef(0);
  // Cursor position in state — drives the floating drag preview chip shared
  // between profile drag (move-to-folder) and folder drag (reorder).
  const [dragCursorPos, setDragCursorPos] = useState<{ x: number; y: number } | null>(null);

  // Auto-scroll loop, shared by both DnD systems. Self-terminates when the cursor
  // leaves the edge zone; canceled on mouseUp / Esc / unmount.
  const tickAutoScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container || (!dragActive.current && !folderDragActiveRef.current)) {
      if (container) delete container.dataset.autoscrolling;
      autoScrollRaf.current = null;
      return;
    }
    const rect = container.getBoundingClientRect();
    const y = cursorY.current;
    let delta = 0;
    if (y < rect.top + AUTOSCROLL_ZONE) {
      const intensity = (rect.top + AUTOSCROLL_ZONE - y) / AUTOSCROLL_ZONE;
      delta = -AUTOSCROLL_MAX_SPEED * Math.min(1, Math.max(0, intensity));
    } else if (y > rect.bottom - AUTOSCROLL_ZONE) {
      const intensity = (y - (rect.bottom - AUTOSCROLL_ZONE)) / AUTOSCROLL_ZONE;
      delta = AUTOSCROLL_MAX_SPEED * Math.min(1, Math.max(0, intensity));
    }
    if (delta !== 0) {
      // Freeze the drop-gap grow animation while auto-scrolling: the gap re-mounts at a
      // new index every frame, and replaying the 120ms grow that fast reads as flicker.
      // Mirrors ActionTable's guard — see [data-autoscrolling] in index.css.
      container.dataset.autoscrolling = 'true';
      container.scrollTop += delta;
      autoScrollRaf.current = requestAnimationFrame(tickAutoScroll);
    } else {
      delete container.dataset.autoscrolling;
      autoScrollRaf.current = null;
    }
  }, []);

  // Forward-declared so tickAutoScroll above can read it before folderDragActive is set up.
  const folderDragActiveRef = useRef(false);

  // Maybe-start the auto-scroll loop if cursor is in an edge zone of the scroll container.
  const maybeKickAutoScroll = useCallback((clientY: number) => {
    if (autoScrollRaf.current !== null) return;
    const container = scrollRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (clientY < rect.top + AUTOSCROLL_ZONE || clientY > rect.bottom - AUTOSCROLL_ZONE) {
      autoScrollRaf.current = requestAnimationFrame(tickAutoScroll);
    }
  }, [tickAutoScroll]);

  // FLIP-on-drop — mirrors ActionTable's grid drag so folder/profile reorders slide
  // into place instead of teleporting. The reorder round-trips through the backend, so
  // the new order lands a frame or two AFTER the drop; the old View-Transition cross-fade
  // tried to bridge that gap by fading the whole panel, which read as an ugly blink. Now:
  // at drop we snapshot every drag item's viewport top, then once the reordered data
  // arrives we slide each one from its old slot to its new slot (translateY delta → 0),
  // exactly like the grid's row reorder (same 180ms / cubic-bezier, same offscreen/maxFly
  // culls, same data-animations gate). Per-kind selector ('folder:' vs 'profile:') because
  // the list is NESTED: a folder reorder animates only the folder wrappers (their child
  // profile rows ride the wrapper's transform), a profile move animates only profile rows —
  // animating both at once would double-transform the nested rows. Timestamped so a stale
  // snapshot (reorder rejected / unrelated update arriving later) is discarded.
  const pendingFlipRects = useRef<{ map: Map<string, number>; at: number; selector: string } | null>(null);

  const snapshotDragItems = useCallback((selector: string) => {
    if (document.documentElement.getAttribute('data-animations') !== 'true') return;
    const container = scrollRef.current;
    if (!container) return;
    // The drop indicator is a REAL layout slot (.drop-gap-slot) that physically
    // pushes every item below it down. If we snapshot with it present, unmoved
    // folders below the gap record a displaced "old" top and then spuriously
    // slide ~one gap-height on drop — the ugly "flicker". The grid never hits
    // this: dnd-kit shifts rows via transforms, so only the rows BETWEEN source
    // and target ever move. To get the same clean baseline, collapse the gap(s)
    // before measuring and restore immediately — all synchronous within this
    // handler, so nothing paints in between (verified: removing the gap yields
    // exactly the post-reorder resting position). scrollTop is pinned because
    // collapsing the gaps can clamp the scroll when dropping near the list end.
    const gaps = Array.from(container.querySelectorAll<HTMLElement>('.drop-gap-slot'));
    const prevDisplay = gaps.map(g => g.style.display);
    const scrollTop = container.scrollTop;
    gaps.forEach(g => { g.style.display = 'none'; });
    container.scrollTop = scrollTop;
    const map = new Map<string, number>();
    container.querySelectorAll<HTMLElement>(selector).forEach(el => {
      const id = el.getAttribute('data-drag-item');
      if (id) map.set(id, el.getBoundingClientRect().top);
    });
    gaps.forEach((g, i) => { g.style.display = prevDisplay[i]; });
    container.scrollTop = scrollTop;
    pendingFlipRects.current = { map, at: performance.now(), selector };
  }, []);

  useLayoutEffect(() => {
    const pending = pendingFlipRects.current;
    if (!pending) return;
    pendingFlipRects.current = null;
    const container = scrollRef.current;
    if (!container) return;
    if (performance.now() - pending.at > 800) return;
    const view = container.getBoundingClientRect();
    const maxFly = view.height || 600;
    const zoom = uiZoom();
    container.querySelectorAll<HTMLElement>(pending.selector).forEach(el => {
      const id = el.getAttribute('data-drag-item');
      if (!id) return;
      const oldTop = pending.map.get(id);
      if (oldTop === undefined) return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < view.top || rect.top > view.bottom) return; // offscreen → no animation
      const delta = oldTop - rect.top;
      if (Math.abs(delta) < 2 || Math.abs(delta) > maxFly) return; // unchanged or too far → snap
      // delta is VISUAL (both tops are rects); a translate length is LAYOUT and gets zoomed
      // again, so the row would start short of where it actually was. The comparisons above
      // stay visual, matching view.height.
      el.animate(
        [{ transform: `translateY(${delta / zoom}px)` }, { transform: 'translateY(0)' }],
        { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    });
  }, [profileOrder, profiles]);

  const handleProfileMouseDown = (e: React.MouseEvent, profileName: string) => {
    if (e.button !== 0) return; // left click only
    if (scrollRef.current) delete scrollRef.current.dataset.autoscrolling; // reset any stale flag from a prior drag
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    dragActive.current = false;
    setDragProfile(profileName);
  };

  useEffect(() => {
    if (!dragProfile) return;

    // Everything expensive about a drag move is coalesced to ONE run per frame. Raw mousemove
    // arrives at the mouse's polling rate (125-1000 Hz for the mice this app targets) and each run
    // does a getBoundingClientRect per folder plus two setStates that re-render this whole panel —
    // including renderProfileRow for every visible profile — to move a single floating ghost. The
    // cheap bookkeeping (threshold, dragActive, cursorY for the autoscroll loop) stays synchronous.
    let moveRaf: number | null = null;
    let pendingPos: { x: number; y: number } | null = null;

    const flushMove = () => {
      moveRaf = null;
      const p = pendingPos;
      if (!p) return;
      // Store the ghost's position in LAYOUT space: clientX/Y are VISUAL, and the transform
      // that consumes them is a CSS length that `zoom` multiplies again — left raw, the ghost
      // trails the cursor by (1 − zoom) × distance from the origin (~120 px at x=1200 on the
      // default 0.90). Converting here keeps the per-frame render free of measurement.
      const gz = uiZoom();
      setDragCursorPos({ x: p.x / gz, y: p.y / gz });

      // Hit-test which folder or ungrouped area the mouse is over
      let foundTarget: string | null = null;
      folderRefs.current.forEach((el, name) => {
        const rect = el.getBoundingClientRect();
        if (p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom) {
          foundTarget = name;
        }
      });
      if (!foundTarget && ungroupedRef.current) {
        const rect = ungroupedRef.current.getBoundingClientRect();
        if (p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom) {
          foundTarget = '__ungrouped__';
        }
      }
      setDropTarget(foundTarget);
      maybeKickAutoScroll(p.y);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartPos.current) return;
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      // Require 5px movement to start drag
      if (!dragActive.current && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!dragActive.current) {
        document.body.style.cursor = 'grabbing';
        // Signal the actions grid that a profile drag began (it shows an insertion rail).
        window.dispatchEvent(new CustomEvent('profiledrag:start', { detail: { profileName: dragProfile } }));
      }
      dragActive.current = true;
      // Read by the autoscroll rAF loop, so it must stay up to date every event, not every frame.
      cursorY.current = e.clientY;

      pendingPos = { x: e.clientX, y: e.clientY };
      if (moveRaf === null) moveRaf = requestAnimationFrame(flushMove);
    };

    const handleMouseUp = (e: MouseEvent) => {
      const wasActive = dragActive.current;
      if (wasActive && dragProfile && dropTarget) {
        const targetFolder = dropTarget === '__ungrouped__' ? null : dropTarget;
        const currentFolder = getProfileFolder(dragProfile);
        if (currentFolder !== targetFolder) {
          snapshotDragItems('[data-drag-item^="profile:"]');
          send({ type: 'profile:moveToFolder', payload: { profileName: dragProfile, folderName: targetFolder } });
        }
      } else if (wasActive && dragProfile) {
        // Not over a folder/ungrouped zone — did we drop on the actions grid? If so, hand off
        // to ActionTable, which opens a pre-filled Run Profile dialog at the drop position.
        // The floating preview is pointer-events:none, so elementFromPoint hits the grid.
        const overGrid = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-actions-grid]');
        if (overGrid) {
          window.dispatchEvent(new CustomEvent('profiledrag:dropOnGrid', { detail: { profileName: dragProfile, clientY: e.clientY } }));
        }
      }
      document.body.style.cursor = '';
      dragStartPos.current = null;
      // Defer clearing dragActive until after the browser dispatches the synthesized click:
      // mouseup → click fire back-to-back, so resetting here would let the row's onClick guard
      // (`if (dragActive.current)`) miss a just-finished drag and spuriously activate the profile.
      setTimeout(() => { dragActive.current = false; }, 0);
      setDragProfile(null);
      setDropTarget(null);
      setDragCursorPos(null);
      if (autoScrollRaf.current !== null) {
        cancelAnimationFrame(autoScrollRaf.current);
        autoScrollRaf.current = null;
      }
      if (wasActive) window.dispatchEvent(new Event('profiledrag:end'));
    };

    // Esc cancels an in-progress profile drag — restores state without moving.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragActive.current) return;
      e.stopPropagation();
      window.dispatchEvent(new Event('profiledrag:end')); // clear the grid's insertion rail
      document.body.style.cursor = '';
      dragStartPos.current = null;
      dragActive.current = false;
      setDragProfile(null);
      setDropTarget(null);
      setDragCursorPos(null);
      if (autoScrollRaf.current !== null) {
        cancelAnimationFrame(autoScrollRaf.current);
        autoScrollRaf.current = null;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown, true);
      if (moveRaf !== null) cancelAnimationFrame(moveRaf);
      if (autoScrollRaf.current !== null) {
        cancelAnimationFrame(autoScrollRaf.current);
        autoScrollRaf.current = null;
      }
    };
  }, [dragProfile, dropTarget, send, snapshotDragItems, maybeKickAutoScroll, getProfileFolder]);

  // ── Folder Drag & Drop (reorder folders) ──
  const folderDragStartPos = useRef<{ x: number; y: number } | null>(null);
  // folderDragActive is mirrored to folderDragActiveRef (declared up-front) so
  // the shared tickAutoScroll can read it without re-deriving on each render.
  const folderDragActive = folderDragActiveRef;

  const handleFolderMouseDown = (e: React.MouseEvent, folderName: string) => {
    if (e.button !== 0) return;
    if (scrollRef.current) delete scrollRef.current.dataset.autoscrolling; // reset any stale flag from a prior drag
    folderDragStartPos.current = { x: e.clientX, y: e.clientY };
    folderDragActive.current = false;
    setDragFolder(folderName);
  };

  useEffect(() => {
    if (!dragFolder) return;

    // Coalesced to one run per frame, same as the profile drag above and for the same reasons:
    // a getBoundingClientRect per folder plus a setState that re-renders the whole panel, on a
    // handler fed by raw mousemove.
    let moveRaf: number | null = null;
    let pendingPos: { x: number; y: number } | null = null;

    const flushMove = () => {
      moveRaf = null;
      const p = pendingPos;
      if (!p) return;
      // Store the ghost's position in LAYOUT space: clientX/Y are VISUAL, and the transform
      // that consumes them is a CSS length that `zoom` multiplies again — left raw, the ghost
      // trails the cursor by (1 − zoom) × distance from the origin (~120 px at x=1200 on the
      // default 0.90). Converting here keeps the per-frame render free of measurement.
      const gz = uiZoom();
      setDragCursorPos({ x: p.x / gz, y: p.y / gz });

      // Map the cursor Y to an insertion slot (0..N) CONTINUOUSLY: the first folder
      // whose vertical midpoint is below the cursor wins; past all of them → the end.
      // Mirrors the grid's computeInsertIndexFromY. The old test only set an index
      // while the cursor was literally inside a folder HEADER's rect, so the margins
      // between headers — and the entire body of an expanded folder — were dead zones
      // where dropFolderIndex fell back to null and the indicator flickered as the
      // cursor crossed a folder boundary. The dragged folder stays in the scan; a drop
      // at or adjacent to its own slot is a no-op (handled in handleMouseUp) and its
      // gap is suppressed by the showDropBefore/showDropAfter source-index guards. The
      // gap is inserted BEFORE the chosen folder, pushing that midpoint away from the
      // cursor, so the choice is self-stabilising rather than oscillating.
      const folders = profileOrder?.folders ?? [];
      let bestIndex = folders.length;
      for (let idx = 0; idx < folders.length; idx++) {
        const el = folderRefs.current.get(folders[idx].name);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (p.y < rect.top + rect.height / 2) { bestIndex = idx; break; }
      }
      setDropFolderIndex(bestIndex);
      maybeKickAutoScroll(p.y);
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!folderDragStartPos.current) return;
      const dx = e.clientX - folderDragStartPos.current.x;
      const dy = e.clientY - folderDragStartPos.current.y;
      if (!folderDragActive.current && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!folderDragActive.current) document.body.style.cursor = 'grabbing';
      folderDragActive.current = true;
      // Read by the autoscroll rAF loop, so it must stay up to date every event, not every frame.
      cursorY.current = e.clientY;

      pendingPos = { x: e.clientX, y: e.clientY };
      if (moveRaf === null) moveRaf = requestAnimationFrame(flushMove);
    };

    const handleMouseUp = () => {
      if (folderDragActive.current && dragFolder && dropFolderIndex !== null) {
        const folders = [...(profileOrder?.folders ?? [])];
        const fromIdx = folders.findIndex(f => f.name === dragFolder);
        if (fromIdx >= 0 && fromIdx !== dropFolderIndex && fromIdx !== dropFolderIndex - 1) {
          const [moved] = folders.splice(fromIdx, 1);
          const toIdx = dropFolderIndex > fromIdx ? dropFolderIndex - 1 : dropFolderIndex;
          folders.splice(toIdx, 0, moved);
          snapshotDragItems('[data-drag-item^="folder:"]');
          send({ type: 'profile:reorder', payload: { folders } });
        }
      }
      document.body.style.cursor = '';
      folderDragStartPos.current = null;
      // Deferred past the synthesized click, exactly as the profile drag above does and for its
      // reason: mouseup → click fire back-to-back, and the header's onClick guard
      // (`if (!folderDragActive.current)`) read the flag already cleared — a drag released over
      // its own header toggled the folder open or shut. The autoscroll loop that also reads the
      // flag is cancelled just below, and the next mousedown resets it anyway.
      setTimeout(() => { folderDragActive.current = false; }, 0);
      setDragFolder(null);
      setDropFolderIndex(null);
      setDragCursorPos(null);
      if (autoScrollRaf.current !== null) {
        cancelAnimationFrame(autoScrollRaf.current);
        autoScrollRaf.current = null;
      }
    };

    // Esc cancels an in-progress folder drag.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !folderDragActive.current) return;
      e.stopPropagation();
      document.body.style.cursor = '';
      folderDragStartPos.current = null;
      folderDragActive.current = false;
      setDragFolder(null);
      setDropFolderIndex(null);
      setDragCursorPos(null);
      if (autoScrollRaf.current !== null) {
        cancelAnimationFrame(autoScrollRaf.current);
        autoScrollRaf.current = null;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown, true);
      if (moveRaf !== null) cancelAnimationFrame(moveRaf);
      if (autoScrollRaf.current !== null) {
        cancelAnimationFrame(autoScrollRaf.current);
        autoScrollRaf.current = null;
      }
    };
  }, [dragFolder, dropFolderIndex, profileOrder, send, snapshotDragItems, maybeKickAutoScroll, folderDragActive]);

  const handleDialogKeyDown = (e: React.KeyboardEvent, onConfirm: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm();
    }
    // Escape is the DialogShell's: it plays the exit animation and then runs the dialog's onClose.
  };

  const profile = contextMenu ? profiles.find(p => p.name === contextMenu.profileName) : null;

  // ── Profile Row Renderer ──
  const renderProfileRow = (p: ProfileEntry) => (
    <div
      key={p.name}
      data-drag-item={`profile:${p.name}`}
      // Keyboard-reachable (Wave 4): rows were click-only divs, so Tab could
      // never reach the sidebar. Enter/Space activate; the global focus ring
      // provides the visible focus (unlayered rule beats the outline-none
      // utility below, same mechanism as the dialog cards).
      tabIndex={0}
      role="button"
      data-tip={isClicker ? tt('Macro mode only', 'Só no modo Macro') : undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (isClicker || runActive) return;
        send({ type: 'profile:click', payload: { name: p.name } });
      }}
      onMouseDown={(e) => handleProfileMouseDown(e, p.name)}
      onClick={(e) => {
        // Don't fire click if we were dragging
        if (dragActive.current) { e.preventDefault(); return; }
        if (isClicker || runActive) return; // activation gated — tooltip explains
        send({ type: 'profile:click', payload: { name: p.name } });
        // Blur the ROW (currentTarget) after dispatching — e.target is usually a
        // child span/img whose blur() is a no-op while the tabIndex=0 row itself
        // holds focus, and a silently-focused row would let a later stray
        // Space/Enter re-toggle the profile.
        e.currentTarget.blur();
      }}
      onContextMenu={(e) => handleContextMenu(e, p.name)}
      // px-1.5 / gap-1 rather than px-2 / gap-1.5: 8 px reclaimed for the name, which is
      // the only elastic thing in a 260 px panel. The chips and the icon keep breathing
      // room because the gutter and the slot are fixed-width anyway.
      className={`relative w-full flex items-center gap-1 px-1.5 py-1.5 rounded text-left transition-colors outline-none select-none cursor-grab active:cursor-grabbing ${
        dragProfile === p.name && dragActive.current ? 'opacity-50 ' : ''
      }${p.isDisabled ? 'opacity-40 ' : ''}${
        p.isActive
          ? 'bg-bg-elevated'
          // hover:bg-bg-elevated, not bg-card: the folder CARD is bg-card now, so a row
          // hovering to bg-card inside it painted #222 over #222 and the rows in folders
          // silently lost their hover while the loose rows kept theirs.
          : 'hover:bg-bg-elevated'
      }`}
    >
        {/* Active marker — ABSOLUTE, deliberately out of the flex flow. As a layout
            child it pushed the icon and the name 4.5 px right, so the one loaded
            profile was the one row whose name never lined up with its siblings. */}
        {p.isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-sm bg-accent-solid" />
        )}

        {/* ── Column 1: the icon slot. Width is RESERVED even when empty, which is the
            whole point: a row with no target must not pull its name left. Everything
            that identifies the target lives here — the .exe icon, the crosshair
            fallback when the icon could not be extracted, and the armed-automation
            dot as a corner badge (a 4th column for 1 row in 80 would indent the 79).

            • Own target      → RemovableChip with a hover ✕, full opacity.
            • Inherited       → plain <img> at 55 %; removal belongs to the folder.
            • Icon missing    → crosshair (UWP host, portable apps off PATH).
            • No target       → empty, and the column still holds its width. */}
        <span className="relative w-3.5 h-3.5 shrink-0 flex items-center justify-center">
          {p.appIconBase64 && p.hasWindowTarget && (
            <RemovableChip
              variant="circle"
              removeTitle={`Remove window target (${targetLabel(p.windowTargetProcessName, p.windowTargetWindowTitle)})`}
              tip={targetLabel(p.windowTargetProcessName, p.windowTargetWindowTitle)}
              onRemove={(e) => { e.stopPropagation(); setConfirmRemoval({ kind: 'profileTarget', name: p.name, label: `window target (${targetLabel(p.windowTargetProcessName, p.windowTargetWindowTitle)})` }); }}
              className="w-3.5 h-3.5"
            >
              {/* No tooltip here — the RemovableChip wrapper carries it. */}
              <span className="flex">
                <img
                  src={`data:image/png;base64,${p.appIconBase64}`}
                  alt=""
                  className="w-3.5 h-3.5 object-contain pointer-events-none"
                />
              </span>
            </RemovableChip>
          )}
          {p.appIconBase64 && !p.hasWindowTarget && (
            // Inherited folder target — no tooltip (user request): the faded icon is a
            // passive "this row inherits a target" cue, managed on the folder.
            <span className="flex">
              <img
                src={`data:image/png;base64,${p.appIconBase64}`}
                alt=""
                className="w-3.5 h-3.5 object-contain pointer-events-none opacity-55"
              />
            </span>
          )}
          {!p.appIconBase64 && p.hasWindowTarget && (
            <RemovableChip
              variant="circle"
              removeTitle={`Remove window target (${targetLabel(p.windowTargetProcessName, p.windowTargetWindowTitle)})`}
              tip={targetLabel(p.windowTargetProcessName, p.windowTargetWindowTitle)}
              onRemove={(e) => { e.stopPropagation(); setConfirmRemoval({ kind: 'profileTarget', name: p.name, label: `window target (${targetLabel(p.windowTargetProcessName, p.windowTargetWindowTitle)})` }); }}
            >
              {/* AppWindow, not Crosshair, for the WINDOW TARGET — here and at the four other sites in
                this file (the folder header chip, the inherited-target chip, both context menus)
                plus TargetConfigDialog's own header icon.

                Why: the label already says "target", so a crosshair spends the icon on the word
                that is written and leaves "window" — the half that separates this from a
                COORDINATE target — undrawn. And Crosshair was carrying both meanings, which
                collided inside SheetPanel: the same cross marked the target window on one row
                and "pick a point on screen" on another.

                Crosshair now means ONLY "pick a point / a coordinate" — ActionTable's Pick from
                screen and Copy Coordinates, BulkActionBar's Set X/Y, SheetPanel's element and
                position pickers, and the Clicker's Target section in Settings, which is a click
                POINT (position jitter / area / fixed), not a window. */}
            <span><AppWindow size={11} className="text-text-tertiary" /></span>
            </RemovableChip>
          )}
          {!p.appIconBase64 && !p.hasWindowTarget && p.hasEffectiveTarget && p.effectiveTargetSource === 'folder' && (
            <span className="opacity-50 flex"><AppWindow size={11} className="text-text-tertiary" /></span>
          )}
          {/* Armed automation — this profile fires with no hotkey. Corner badge rather
              than a column of its own; the ring keeps it readable over the row hover. */}
          {p.triggerArmed && (
            <span
              data-tip={tt('Automation armed', 'Automação armada')}
              data-tip-pos="end"
              className="absolute -right-1 -bottom-1 w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--color-replay)', outline: '1.5px solid var(--color-bg-card)' }}
            />
          )}
        </span>

        {/* ── Column 2: the name. MIDDLE truncation, in pure CSS — the name is split
            into a shrinking head and a fixed tail, so when the row runs out of room
            the ellipsis lands in the middle and the END of the name survives.
            Right-side truncation is the worst possible cut for this library: sibling
            profiles share long prefixes (SET …, REL …, RANK …, Hora - Copy …), so
            cutting the tail keeps the redundant half and drops the half that tells
            them apart. Short names stay a single span — nothing to gain by splitting.
            The tail needs shrink-0 and the head min-w-0, or the ellipsis never fires. */}
        {(() => {
          const cls = `text-ui min-w-0 ${p.isActive ? 'text-accent font-semibold' : 'text-text-primary'}`;
          if (p.name.length <= 14) {
            // Tagged too, even though a short name needs no middle truncation: the effect below
            // is what hangs the description on the row, and most profiles are short — leaving
            // this branch out meant the description reached almost nobody. It also gets the
            // overflow tooltip the long branch has always had, for the narrow-column case.
            return <span className={`${cls} flex-1 truncate`} data-name-cell data-full={p.name} data-desc={descTip(p.description)}>{p.name}</span>;
          }
          // Split by CODE POINT, not UTF-16 unit: slice(-6) on a name ending in an emoji
          // would cut a surrogate pair in half and render two replacement glyphs.
          const cps = Array.from(p.name);
          const head = cps.slice(0, -6).join('');
          const tail = cps.slice(-6).join('');
          return (
            // whitespace-pre, NOT truncate. Each flex child opens its own line box, and CSS
            // trims collapsible whitespace at a line's start and end — `nowrap` is still
            // collapsible, so a name whose split falls on a space lost it: "REL Crit CHANCE"
            // rendered "REL CritCHANCE", 13 of the 81 real profiles, always, even with the
            // column half empty. `pre` is not collapsible, and it still does not wrap, so
            // overflow-hidden + text-ellipsis keep working on the head.
            // No data-tip here on purpose — it is added by the effect below ONLY when the
            // head actually overflows. Whether a name is cut is a layout fact, not a string
            // length: after the gutter was tightened none of the 81 real names truncate, so
            // keying the tooltip off `length > 14` popped it on 23 rows that were showing
            // their name in full.
            <span className={`${cls} flex-1 flex`} data-name-cell data-full={p.name} data-desc={descTip(p.description)}>
              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">{head}</span>
              <span className="shrink-0 whitespace-pre">{tail}</span>
            </span>
          );
        })()}

        {/* ── Column 3: the trigger gutter. A fixed floor so the hotkey/hotstring chips
            land in a column instead of a ragged edge — the panel then reads as the
            keyboard map it actually is. min-w rather than w: on the rare row that also
            carries a trigger-mode icon the gutter may grow, which only shortens the
            name and leaves the two left columns exactly where they were. */}
        {/* 68 px is the widest TWO-part combo after the chip was tightened (Ctrl + Num4 = 68,
            Shift + F1 = 62, Alt + C = 46). Deliberately not sized for three modifiers:
            Win + Ctrl + R is 81, and reserving for it would spend 13 px of name on all the
            rows that never need it. Those rows overflow the floor instead, which only
            shortens their own name — the two left columns stay put either way. */}
        <span className="shrink-0 min-w-[68px] flex items-center justify-end gap-1.5">
        {/* Trigger mode indicator — placed before the hotkey so the visual order
            right-to-left is: hotstring → hotkey → trigger icon → target crosshair.
            Tooltip shows only the mode name; the full description lives in the
            hotkey configuration dialog. */}
        {p.hotkey && p.triggerMode === 'onRelease' && (
          <span data-tip={tt('On Release', 'Ao soltar')} data-tip-pos="end" className="shrink-0 text-text-tertiary flex">
            <ArrowUpFromDot size={10} />
          </span>
        )}
        {p.hotkey && p.triggerMode === 'whilePressed' && (
          <span data-tip={tt('While Pressed', 'Enquanto pressionado')} data-tip-pos="end" className="shrink-0 text-text-tertiary flex">
            <Zap size={10} />
          </span>
        )}
        {p.hotkey && p.triggerMode === 'toggle' && (
          <span data-tip={tt('Toggle', 'Alternar')} data-tip-pos="end" className="shrink-0 text-text-tertiary flex">
            <Repeat size={10} />
          </span>
        )}
        {p.hotkey && p.triggerMode === 'doubleTap' && (
          <span data-tip={tt('Double-tap', 'Toque duplo')} data-tip-pos="end" className="shrink-0 text-text-tertiary flex">
            <Repeat2 size={10} />
          </span>
        )}
        {p.hotkey && p.triggerMode === 'hold' && (
          <span data-tip={tt('Hold (long-press)', 'Segurar (pressão longa)')} data-tip-pos="end" className="shrink-0 text-text-tertiary flex">
            <Hourglass size={10} />
          </span>
        )}

        {p.hotkey && (
          <RemovableChip
            removeTitle={`Remove hotkey ${p.hotkey}`}
            onRemove={(e) => { e.stopPropagation(); setConfirmRemoval({ kind: 'hotkey', name: p.name, label: `hotkey ${p.hotkey}` }); }}
            /* A contested hotkey reads as a warning instead of a plain chip. The backend has
               always computed this — it just never left the toast, so the sidebar showed two
               identical chips for a combo where only one of them can ever fire. */
            tip={p.hotkeyConflict
              ? tt('Another profile uses this hotkey for the same window — only one fires',
                   'Outro profile usa este hotkey na mesma janela — só um dispara')
              : undefined}
            className={p.hotkeyConflict ? 'kbd-conflict' : undefined}
          >
            <KbdTag combo={p.hotkey} unified />
          </RemovableChip>
        )}

        {p.hotstring && (
          // Wears the `kbd` utility itself rather than re-listing its tokens. The old
          // className copied them by hand to make the two trigger chips read as siblings,
          // and then drifted: 11px vs 10px text, py-0.5 vs none, px-1.5 vs px-1, giving a
          // 22.6px chip next to a 20px one. Same class + same px-1 as KbdTag's unified
          // branch means they cannot disagree about height again.
          <RemovableChip
            removeTitle={`Remove hotstring "${p.hotstring}"`}
            onRemove={(e) => { e.stopPropagation(); setConfirmRemoval({ kind: 'hotstring', name: p.name, label: `hotstring "${p.hotstring}"` }); }}
            className="kbd px-1"
          ><span>
            {p.hotstringInstant ? '\u26A1' : '\u21B5'}{p.hotstring}
            </span>
          </RemovableChip>
        )}
        </span>
    </div>
  );

  // ── Section Header Renderer ──
  // Pinned carries the Pin glyph (same icon as the context menu's Pin/Unpin) so the
  // section has a visual identity like folders do (colour + icon); Ungrouped stays
  // bare on purpose — it's the absence of a group, not a group.
  const renderSectionLabel = (label: string) => (
    <div className="px-2.5 pt-2 pb-0.5 flex items-center gap-1.5">
      {label === 'Pinned' && <Pin size={10} className="text-text-tertiary shrink-0" />}
      {/* tertiary, not disabled — category labels are real information; the
          disabled token computes ~1.4:1 on the default theme. */}
      <span className="label-micro text-text-tertiary">{label}</span>
    </div>
  );

  return (
    <>
      {/* No overflow-hidden on the panel root: the data-tip tooltips (pos right/end)
          render outside the strip's box and would be clipped — same fix as the
          SettingsPanel. */}
      {/* width + colors in the transition list: a bare transition-[width] overrides
          the global theme-change fade, so the panel's background/border would snap
          on theme switch while everything around it cross-fades. */}
      <div className={`flex flex-col bg-bg-surface border border-border-subtle border-r-border-default rounded-l-shell shrink-0 transition-[width,background-color,border-color] duration-200 ${collapsed ? 'w-12' : 'w-[260px]'}`}>
        {collapsed ? (
          <>
            {/* Collapsed rail — mirrors the SettingsPanel rail: a 47px header cell
                (collapse), quick actions (new profile / search-and-expand), then
                profile avatars in the PANEL's order — pinned → folders → ungrouped —
                with the active one ringed and always kept in the visible cut. Fills
                the measured strip height; the last slot becomes a "+N expand" chip
                when there are more profiles than fit (no scrolling — a scroll list
                would clip the right-side tooltips). */}
            <div className="h-band w-full flex items-center justify-center border-b border-border-subtle shrink-0">
              <button
                onClick={onToggleCollapse}
                className={iconButtonClass('md')}
                data-tip={tt('Expand panel', 'Expandir painel')}
                data-tip-pos="right"
              >
                <ChevronsRight size={14} />
              </button>
            </div>
            <div className="flex flex-col items-center gap-1 pt-2 pb-2 shrink-0">
              <button
                onClick={() => handleCreate(null)}
                className={iconButtonClass('md')}
                data-tip={tt('New profile', 'Novo profile')}
                data-tip-pos="right"
              >
                <FilePlus size={14} />
              </button>
              <button
                onClick={() => { pendingFocusSearch.current = true; onToggleCollapse?.(); }}
                className={iconButtonClass('md', { className: 'relative' })}
                data-tip={searchQuery.length > 0 ? tt('Search — filter active', 'Buscar — filtro ativo') : tt('Search profiles', 'Buscar profiles')}
                data-tip-pos="right"
              >
                <Search size={14} />
                {/* The rail quietly renders the FILTERED list while a query is active —
                    without this dot there is no sign the strip is a subset. */}
                {searchQuery.length > 0 && (
                  <span
                    className="absolute right-[3px] top-[3px] w-1.5 h-1.5 rounded-full"
                    style={{ background: 'var(--color-accent)', outline: '1.5px solid var(--color-bg-surface)' }}
                  />
                )}
              </button>
              <div className="w-6 my-1 border-t border-border-subtle" />
            </div>
            <div ref={railRef} className="flex-1 flex flex-col items-center gap-1 px-1 pb-2 overflow-hidden">
              {(() => {
                // Show all when they fit; otherwise reserve the last slot for the
                // "+N expand" chip (so visible = capacity − 1). If the ACTIVE profile
                // falls outside the cut it takes the last visible slot — the accent
                // ring is the rail's only "you are here" and must never be off-screen.
                const fitsAll = railProfiles.length <= railCapacity;
                let visible = fitsAll ? railProfiles : railProfiles.slice(0, Math.max(0, railCapacity - 1));
                const active = railProfiles.find(p => p.isActive);
                if (active && visible.length > 0 && !visible.some(p => p.name === active.name)) {
                  visible = [...visible.slice(0, -1), active];
                }
                const overflow = railProfiles.length - visible.length;
                return (
                  <>
                    {visible.map((p, idx) => {
                      const folderColor = getProfileFolderColor(p.name);
                      const initials = railInitials(p.name);
                      // Group boundary (pinned → folders → loose): a hairline, like the settings
                      // rail between its three tabs. Costs 9px, already taken out of railCapacity.
                      const newGroup = idx > 0 && railGroupOf.get(p.name) !== railGroupOf.get(visible[idx - 1].name);
                      return (
                        <Fragment key={p.name}>
                        {newGroup && <div className="w-6 my-0.5 border-t border-border-subtle shrink-0" aria-hidden />}
                        <button
                          // Same activation gate as the expanded row: collapsing the panel must not
                          // hand back a capability the expanded list refuses. It was missing here,
                          // so the rail activated profiles in Clicker mode — and ignored runActive
                          // too, which is the gate with the technical reason behind it.
                          onClick={(e) => {
                            if (isClicker || runActive) return;
                            send({ type: 'profile:click', payload: { name: p.name } });
                            (e.currentTarget as HTMLElement).blur();
                          }}
                          onContextMenu={(e) => handleContextMenu(e, p.name)}
                          className={`relative w-8 h-8 rounded-full flex items-center justify-center text-minor font-semibold transition-colors shrink-0 ${
                            p.isActive
                              ? 'bg-[color-mix(in_srgb,var(--color-accent)_16%,transparent)] text-accent'
                              : 'bg-bg-elevated text-text-secondary hover:bg-bg-card'
                          } ${p.isDisabled ? 'opacity-40' : ''}`}
                          style={p.isActive
                            ? { boxShadow: '0 0 0 2px var(--color-accent)' }
                            // kbd-conflict's hue, translated to a ring — the rail has no
                            // hotkey chip to tint. Active wins: selection outranks warning.
                            : p.hotkeyConflict
                              ? { boxShadow: '0 0 0 1.5px color-mix(in srgb, var(--color-recording) 60%, transparent)' }
                              : undefined}
                          // Everything the expanded row says, in one line: name · trigger (hotkey
                          // in keycap spelling, hotstring with the ⚡/↵ mark the row's chip wears) ·
                          // folder · target · disabled. A hotstring-only profile used to show no
                          // trigger at all, and a disabled one was merely dimmer.
                          // The description closes the line — collapsed, the avatar is ALL the row
                          // shows, so this tooltip is the only place a profile can say what it does.
                          data-tip={[
                            // First, like the expanded row: it answers the more urgent question
                            // ("why did clicking do nothing?") before describing the profile.
                            isClicker ? tt('Macro mode only', 'Só no modo Macro') : null,
                            p.name,
                            p.hotkey ? railHotkey(p.hotkey) : null,
                            p.hotstring ? `${p.hotstringInstant ? '⚡' : '↵'}${p.hotstring}` : null,
                            getProfileFolder(p.name),
                            p.hasEffectiveTarget ? targetLabel(p.effectiveTargetProcessName, p.effectiveTargetWindowTitle) : null,
                            p.isDisabled ? tt('disabled', 'desativado') : null,
                            descTip(p.description) || null,
                          ].filter(Boolean).join(' · ')}
                          data-tip-pos="right"
                        >
                          {/* Identity, best source first: the user's own emoji, the target
                              app's icon (55% when folder-inherited, same as the expanded
                              rows), then initials that distinguish (railInitials) as the
                              fallback of last resort — three or four characters step down a size. */}
                          {p.iconEmoji ? (
                            <span className="text-[15px] leading-none pointer-events-none">{p.iconEmoji}</span>
                          ) : p.appIconBase64 ? (
                            <img
                              src={`data:image/png;base64,${p.appIconBase64}`}
                              alt=""
                              className={`w-[18px] h-[18px] object-contain pointer-events-none ${p.effectiveTargetSource === 'folder' ? 'opacity-55' : ''}`}
                            />
                          ) : (
                            <span className={`pointer-events-none ${glyphCount(initials) > 2 ? 'text-caption tracking-tight' : ''}`}>{initials}</span>
                          )}
                          {folderColor && (
                            <span
                              className="absolute -right-px -bottom-px w-[9px] h-[9px] rounded-full border-2 border-bg-surface"
                              style={{ background: folderColor }}
                            />
                          )}
                          {/* Armed automation — the same 6px replay-green dot the expanded
                              list wears, on the corner opposite the folder dot. */}
                          {p.triggerArmed && (
                            <span
                              className="absolute -right-px -top-px w-1.5 h-1.5 rounded-full"
                              style={{ background: 'var(--color-replay)', outline: '1.5px solid var(--color-bg-surface)' }}
                            />
                          )}
                        </button>
                        </Fragment>
                      );
                    })}
                    {overflow > 0 && (() => {
                      // The cut keeps the ACTIVE profile visible but nothing else — an armed
                      // automation or a hotkey conflict that fell past the fold simply vanished.
                      // The "+N" chip inherits those two cues (same dot, same ring) and its
                      // tooltip counts them, so a state that asks for attention survives the cut.
                      const hidden = railProfiles.filter(p => !visible.some(v => v.name === p.name));
                      const armed = hidden.filter(p => p.triggerArmed).length;
                      const conflicts = hidden.filter(p => p.hotkeyConflict).length;
                      const tip = [
                        tt(`${overflow} more`, `${overflow} a mais`),
                        armed > 0 ? tt(`${armed} armed`, `${armed} armado${armed > 1 ? 's' : ''}`) : null,
                        conflicts > 0 ? tt(`${conflicts} in conflict`, `${conflicts} em conflito`) : null,
                      ].filter(Boolean).join(' · ');
                      return (
                        <button
                          onClick={onToggleCollapse}
                          className="relative w-8 h-8 rounded-full flex items-center justify-center text-caption font-semibold bg-bg-elevated text-text-tertiary hover:bg-bg-card hover:text-text-primary transition-colors shrink-0"
                          style={conflicts > 0 ? { boxShadow: '0 0 0 1.5px color-mix(in srgb, var(--color-recording) 60%, transparent)' } : undefined}
                          data-tip={tip}
                          data-tip-pos="right"
                        >
                          +{overflow}
                          {armed > 0 && (
                            <span
                              className="absolute -right-px -top-px w-1.5 h-1.5 rounded-full"
                              style={{ background: 'var(--color-replay)', outline: '1.5px solid var(--color-bg-surface)' }}
                            />
                          )}
                        </button>
                      );
                    })()}
                  </>
                );
              })()}
            </div>
          </>
        ) : (
          <>
        {/* px-2 not px-3, and the buttons are w-6: SEVEN of them plus two dividers plus
            the PROFILES label share a 260 px panel — the 7th (Import) ate the slack the
            six-button layout had, so the divider margins dropped mx-1 → mx-0.5 to pay
            for it. Estimated, not yet re-measured live (UI is screenshot-masked); if
            PROFILES clips, shorten the label before shrinking the buttons. */}
        <div className="flex items-center justify-between h-band px-2 border-b border-border-subtle shrink-0">
          <span className="label-micro text-text-tertiary">PROFILES</span>
          {/* Grouped by function (2026-07 reorg), Toolbar divider idiom: panel chrome
              (collapse) | library utilities (open folder, import/export) | creation
              (new folder, new profile — hottest spot, at the end).
              ONE button for both directions, because the dialog it opens already does
              both: Export Profiles picks what to ship out AND carries the Import link in
              its footer. Two icons for one dialog was a distinction the UI made and the
              dialog then ignored — this row is short enough that a seventh target has to
              earn itself.
              ArrowDownUp is the union of the two glyphs it replaces (Upload ↑ / Download
              ↓, still the Command Palette's pair for these same two commands), so the
              row reads as the same family; it is also directionless, which a button that
              does both has to be. Not ArrowLeftRight — that was tried here, read as
              "convert/swap", and still means exactly that on the coordinate converters in
              this panel's own context menu. Not a sort glyph by accident either: this
              toolbar has no sort control for ↓↑ to be mistaken for. */}
          <div className="flex items-center">
            <button onClick={onToggleCollapse} className={iconButtonClass('sm')} data-tip={tt('Collapse panel', 'Colapsar painel')}>
              <ChevronsLeft size={14} />
            </button>
            {/* Collapse / expand ALL folders. Promoted out of the folder context menu: it acts
                on every folder, so hiding it behind a right-click on one of them was the wrong
                place to look — and the owner's nine folders live collapsed, so this is the
                switch he actually reaches for. Same flip rule the menu used: collapse while
                anything is open, expand only once everything is shut. */}
            {(() => {
              const folders = profileOrder?.folders ?? [];
              const anyExpanded = folders.some(f => !f.collapsed);
              const Icon = anyExpanded ? ChevronsDownUp : ChevronsUpDown;
              return (
                <button
                  onClick={() => send({ type: 'profile:setAllFoldersCollapsed', payload: { collapsed: anyExpanded } })}
                  disabled={folders.length === 0}
                  className={iconButtonClass('sm')}
                  data-tip={anyExpanded
                    ? tt('Collapse all folders', 'Colapsar todas as pastas')
                    : tt('Expand all folders', 'Expandir todas as pastas')}
                >
                  <Icon size={14} />
                </button>
              );
            })()}
            <div className="w-px h-3.5 bg-border-subtle mx-0.5" />
            <button onClick={handleOpenProfilesFolder} className={iconButtonClass('sm')} data-tip={tt('Open profiles folder', 'Abrir pasta de perfis')}>
              <ExternalLink size={14} />
            </button>
            <button onClick={handleExportClick} className={iconButtonClass('sm')} data-tip={tt('Import / Export', 'Importar / Exportar')}>
              <ArrowDownUp size={14} />
            </button>
            <div className="w-px h-3.5 bg-border-subtle mx-0.5" />
            <button onClick={handleCreateFolder} className={iconButtonClass('sm')} data-tip={tt('New folder', 'Nova pasta')}>
              <FolderPlus size={14} />
            </button>
            <button onClick={() => handleCreate(null)} className={iconButtonClass('sm')} data-tip={tt('New profile', 'Novo perfil')}>
              <FilePlus size={14} />
            </button>
          </div>
        </div>

        {/* Search — supports "#tag" prefix to filter by tag instead of name */}
        <div className="h-row px-1.5 flex items-center border-b border-border-subtle shrink-0">
          <div className={`w-full h-7 flex items-center gap-2 px-2.5 bg-bg-input border rounded transition-colors ${
            isTagSearch ? 'border-accent-solid/50' : 'border-border-default'
          }`}>
            {isTagSearch ? (
              // Visual cue that tag mode is active — distinguishes #fps from "literal hash".
              <Hash size={13} className="text-accent shrink-0" />
            ) : (
              <Search size={13} className="text-text-disabled shrink-0" />
            )}
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search profiles..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent text-minor text-text-primary placeholder:text-text-disabled outline-none flex-1 min-w-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-text-disabled hover:text-text-secondary transition-colors shrink-0"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Profile List - Sectioned */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 pb-1">
          {isSearching ? (
            // Flat search results — with an explicit empty state instead of the
            // silent blank list the panel used to show.
            filtered.length > 0 ? (
              // Same 3 px inset the loose rows carry, so the name column does not jump
              // sideways the moment you start typing.
              <div className="px-[3px]">{filtered.map(renderProfileRow)}</div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center select-none">
                <SearchX size={22} className="text-text-disabled" />
                <span className="text-minor font-medium text-text-secondary">No results for "{trimmedQuery}"</span>
                <button
                  onClick={() => setSearchQuery('')}
                  className="text-caption text-accent hover:text-accent-hover transition-colors"
                >
                  Clear search
                </button>
              </div>
            )
          ) : profiles.length === 0 ? (
            // First-run empty state — mirrors the Macro/Clicker empty-state
            // vocabulary (icon, one-liner, action).
            <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center select-none">
              <FolderOpen size={24} className="text-text-disabled" />
              <span className="text-minor font-medium text-text-secondary">No profiles yet</span>
              <span className="text-caption text-text-tertiary leading-snug">Record a macro and save it, or create an empty profile to start.</span>
              <Button variant="primary" size="xs" className="mt-1" onClick={() => handleCreate(null)}>
                <Plus size={13} />
                New profile
              </Button>
            </div>
          ) : (
            <>
              {/* Pinned Section */}
              {pinnedProfiles.length > 0 && (
                <>
                  {renderSectionLabel('Pinned')}
                  {/* Same inset as Ungrouped — these rows are outside a card too, and the
                      name column has to be one column across the whole panel. */}
                  <div className="px-[3px]">
                    {pinnedProfiles.map(renderProfileRow)}
                  </div>
                </>
              )}

              {/* Folder Sections */}
              {folderSections.map((folder, folderIdx) => {
                const hasVisibleProfiles = folder.profiles.length > 0;
                // No create button while a search is running — and no guard needed for it here:
                // this map only runs when NOT searching (a search renders the flat list above
                // instead). It carried one anyway, `!trimmedQuery`, which could never be false on
                // this branch. The rule still holds for its reason: during a search the folders
                // would be FILTERED, so one with no match would look empty without being empty,
                // and searching is a find mode, not an authoring one.
                const isDragOver = dropTarget === folder.name && dragProfile !== null;
                const isFolderDragging = dragFolder === folder.name && folderDragActive.current;
                // Visually mark the folder as disabled when every profile inside is disabled,
                // matching the dimmed look of disabled profiles. Empty folders stay normal.
                const folderAllDisabled = folder.items.length > 0
                  && folder.items.every(n => profileMap.get(n)?.isDisabled);
                // Suppress the gap at BOTH no-op slots: dropping at the dragged folder's
                // own index OR index+1 leaves it exactly where it is (mirrors handleMouseUp's
                // `fromIdx !== dropFolderIndex && fromIdx !== dropFolderIndex - 1` guard).
                // showDropAfter already excluded both; showDropBefore was missing the +1, so
                // a misleading gap popped in just past the dragged folder even though releasing
                // there did nothing — the residual boundary glitch.
                const showDropBefore = dragFolder && dropFolderIndex === folderIdx && dropFolderIndex !== (profileOrder?.folders ?? []).findIndex(f => f.name === dragFolder) && dropFolderIndex !== (profileOrder?.folders ?? []).findIndex(f => f.name === dragFolder) + 1;
                // showDropAfter is ONLY for the end-of-list slot (after the last
                // folder) — for any middle insertion the gap is rendered by the
                // next folder's showDropBefore. Without the last-folder guard BOTH
                // fired at every interior boundary, stacking two gaps (~64px) and
                // doubling the layout displacement the FLIP snapshot had to undo.
                const showDropAfter = dragFolder && folderIdx === (profileOrder?.folders ?? []).length - 1 && dropFolderIndex === folderIdx + 1 && dropFolderIndex !== (profileOrder?.folders ?? []).findIndex(f => f.name === dragFolder) && dropFolderIndex !== (profileOrder?.folders ?? []).findIndex(f => f.name === dragFolder) + 1;
                return (
                  <div key={folder.name}>
                    {/* Insertion gap — a real (layout-affecting) slot so neighbouring
                        folders physically part to open space, matching the grid's drag
                        language (replaces the old accent rail line). */}
                    {showDropBefore && (
                      <div
                        className="drop-gap-slot mx-1 my-1 rounded border-2 border-dashed overflow-hidden"
                        style={{
                          height: '30px',
                          borderColor: 'color-mix(in srgb, var(--color-accent) 45%, transparent)',
                          background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
                        }}
                      />
                    )}
                    <div
                      ref={(el) => { if (el) folderRefs.current.set(folder.name, el); else folderRefs.current.delete(folder.name); }}
                      data-drag-item={`folder:${folder.name}`}
                      // The group is a CARD now: its own surface plus a border, so a folder
                      // is separated by containment instead of by a hairline its children
                      // could be mistaken for. NO overflow-hidden — the panel root omits it
                      // on purpose so `data-tip` tooltips can escape the box, and clipping
                      // here would swallow them again. The header carries the matching
                      // radius instead.
                      // mx-0 rather than mx-0.5: the .list already pads 4 px on each side, so the
                      // card's own margin was buying nothing and costing 4 px of name.
                      // The background is a TERNARY, not an addition. Listing bg-bg-card
                      // unconditionally and adding bg-accent-solid/20 for the drag state put
                      // both in the same layer at the same specificity, so the one printed
                      // later in the bundle won and the drop fill never appeared — dead class.
                      // The resting look moved to `style` for the same reason, guarded by the
                      // same condition: an inline style would BEAT the drag classes outright,
                      // which is the identical bug one layer up.
                      className={`group/folder border rounded-md my-1 transition-colors ${
                        isDragOver
                          ? 'bg-accent-solid/20 border-accent-solid/50 ring-2 ring-accent-solid/50'
                          : ''
                      } ${isFolderDragging ? 'opacity-50' : ''}`}
                      // Quieter card (owner's call, seen on screen). It should read as a
                      // CONTAINER, not as a highlight: enough separation to find the group's
                      // edges, not enough to compete with the profile names inside it.
                      //
                      // Both halves move, because the fill was never what made these loud. At
                      // the default preset the card/panel gap is 3 points of luminance while the
                      // border is a light hairline at 10 % alpha over a near-black panel — the
                      // edge was doing the shouting, so dropping it to the subtle token is what
                      // the eye actually registers. The fill mix matters for the OTHER presets.
                      //
                      // Proportional, never absolute: across the 37 presets the card-vs-surface
                      // delta runs from -17 to +20 (several make the card DARKER than the panel),
                      // so a fixed nudge would erase the card in one theme and do nothing in
                      // another. A mix keeps the same FRACTION of whatever separation the theme
                      // author chose, in whichever direction they chose it.
                      //
                      // Collapsed stays a step below expanded, as it was. That step is nearly
                      // imperceptible and the chevron already carries the state — but it was a
                      // deliberate choice, so it survives the change instead of being dropped by
                      // accident on the way past.
                      style={isDragOver ? undefined : {
                        background: 'color-mix(in srgb, var(--color-bg-card) 60%, var(--color-bg-surface))',
                        borderColor: folder.collapsed
                          ? 'color-mix(in srgb, var(--color-border-subtle) 55%, transparent)'
                          : 'var(--color-border-subtle)',
                      }}
                    >
                      <div
                        // px-1.5 / gap-1 matches the profile rows. The colour the user already
                        // picked for this folder tints the header and dies out at 55 % of the
                        // width, so it identifies the group without fighting the label.
                        // "Leve" from mockup/profile-panel-gradient-intensity.html: half the ink
                        // of the original 18 %/72 % recipe, so a column of ten folders reads as a
                        // list with coloured anchors instead of ten stacked colour bands. The
                        // 3 px bar and the chevron still carry the folder colour at full strength.
                        style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${folder.color} 10%, transparent), transparent 55%)` }}
                        // border-border-subtle is STATIC; only the WIDTH is conditional. Expanding
                        // used to add `border-b border-border-subtle` together, so the width went
                        // 0 → 1px instantly while the colour changed from the 0-width default
                        // (currentColor — near-white text-primary) to the subtle token. index.css
                        // transitions border-color on EVERY element for 180 ms so theme switches
                        // don't snap, and it caught that change: a bright hairline appeared under
                        // the folder name and faded out on every expand.
                        //
                        // Declaring the colour up front leaves the global rule nothing to animate —
                        // it is already the subtle token while the border is invisible at 0 px, so
                        // the width flip is instant and silent. Fixing it at the class that toggles
                        // rather than by opting this element out of the global transition: that rule
                        // is the theme-change fade, and it should keep applying here.
                        className={`w-full flex items-center gap-1 px-1.5 py-1.5 text-left border-border-subtle group cursor-grab active:cursor-grabbing select-none ${folder.collapsed ? 'rounded-md' : 'rounded-t-md border-b'}`}
                        onMouseDown={(e) => handleFolderMouseDown(e, folder.name)}
                        // The whole header collapses the folder, not just the 12 px chevron —
                        // the convention every file explorer already taught, on a 218 px target
                        // instead of a glyph. This click used to toggle a `selectedFolder` ring
                        // that decided where a new profile was created; now that the destination
                        // comes from the button pressed, nothing read that state and the ring lit
                        // up for nothing, so it went and the click was free.
                        // Safe to put here: every interactive child of the header (the chevron,
                        // the window-target chip's remove) already stops propagation, and the drag
                        // guard below is the same one the chevron uses.
                        onClick={() => { if (!folderDragActive.current) handleToggleFolderCollapse(folder.name); }}
                        onContextMenu={(e) => handleFolderContextMenu(e, folder.name)}
                      >
                        {/* The chevron is the AFFORDANCE for the collapse, not a second handler
                            for it: the header above now owns that click, and this sits inside it.
                            Its own onClick + stopPropagation were what made a 12 px glyph the only
                            way in; keeping both would leave a trap where deleting the
                            stopPropagation silently toggles twice and looks like nothing happened. */}
                        <span
                          style={{ color: folder.color }}
                          className="shrink-0"
                        >
                          {folder.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        </span>
                        <FolderOpen size={12} style={{ color: folder.color }} className={`shrink-0 ${folderAllDisabled ? 'opacity-40' : ''}`} />
                        {/* Folder-target app icon — same resolution rules as the profile row.
                            Wrapped in a group so hover reveals a ✕ overlay that removes the
                            folder's target inline, matching the crosshair fallback below. */}
                        {folder.appIconBase64 && (
                          <RemovableChip
                            variant="circle"
                            removeTitle={`Remove folder target (${targetLabel(folder.windowTargetProcessName, folder.windowTargetWindowTitle)})`}
                            tip={targetLabel(folder.windowTargetProcessName, folder.windowTargetWindowTitle)}
                            onRemove={(e) => { e.stopPropagation(); setConfirmRemoval({ kind: 'folderTarget', name: folder.name, label: `folder target (${targetLabel(folder.windowTargetProcessName, folder.windowTargetWindowTitle)})` }); }}
                            className={`w-3.5 h-3.5 ${folderAllDisabled ? 'opacity-40' : ''}`}
                          >
                            <span className="flex">
                              <img
                                src={`data:image/png;base64,${folder.appIconBase64}`}
                                alt=""
                                className="w-3.5 h-3.5 object-contain pointer-events-none"
                              />
                            </span>
                          </RemovableChip>
                        )}
                        {/* Promoted from 12 px/500 secondary to 650 primary. The folder was
                            typographically WEAKER than the profiles inside it, so the parent
                            dissolved into its own children — backwards for a hierarchy, and
                            worse once the group sits inside a card. */}
                        <span className={`text-minor font-semibold flex-1 truncate ${folderAllDisabled ? 'text-text-disabled' : 'text-text-primary'}`}>{folder.name}</span>
                        {folder.hasWindowTarget && !folder.appIconBase64 && (
                          <RemovableChip
                            variant="circle"
                            removeTitle={`Remove folder target (${targetLabel(folder.windowTargetProcessName, folder.windowTargetWindowTitle)})`}
                            tip={targetLabel(folder.windowTargetProcessName, folder.windowTargetWindowTitle)}
                            onRemove={(e) => { e.stopPropagation(); setConfirmRemoval({ kind: 'folderTarget', name: folder.name, label: `folder target (${targetLabel(folder.windowTargetProcessName, folder.windowTargetWindowTitle)})` }); }}
                          >
                            <span>
                              <AppWindow size={10} className="text-text-tertiary" />
                            </span>
                          </RemovableChip>
                        )}
                      </div>
                      {!folder.collapsed && (
                        // The card border is the containment now, so the old coloured left
                        // rail is gone — two nested separators for one group read as noise.
                        <div className="px-0.5 pb-0.5 pt-px">
                          {folder.profiles.map(renderProfileRow)}
                          {/* The folder's own create button, and the only place that says out
                              loud where a new profile lands.

                              ITS HEIGHT IS ALWAYS RESERVED, its ink is not: the row exists in the
                              layout whenever the folder is open, and only fades in on hover. A row
                              that mounted on hover would shove every folder below it down 24 px
                              the moment the pointer crossed one — with ~90 profiles the list would
                              twitch under the cursor all the way down. At rest the reserved strip
                              reads as the folder's bottom padding.

                              Empty folder: `hasVisibleProfiles` is false, so this row IS the body —
                              and it stays inked (group-hover would leave a blank rectangle, which
                              is exactly what an empty folder used to be). It also gives the folder
                              a body to render at all, which it never had before.

                              Safe against the drag layer without doing anything: profile drops
                              hit-test the WHOLE folder rect (folderRefs), so this adds no new drop
                              target, and reordering walks [data-drag-item^="profile:"], which this
                              row deliberately does not carry. */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleCreate(folder.name); }}
                            aria-label={`New profile in ${folder.name}`}
                            className={`w-full mx-0.5 h-6 px-1.5 flex items-center gap-1.5 rounded text-caption text-left
                              text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated
                              transition-[opacity,color,background-color] duration-150
                              ${hasVisibleProfiles ? 'opacity-0 group-hover/folder:opacity-100 focus-visible:opacity-100' : 'opacity-100'}`}
                          >
                            <Plus size={12} style={{ color: folder.color, opacity: 0.85 }} className="shrink-0" />
                            New profile
                          </button>
                        </div>
                      )}
                    </div>
                    {showDropAfter && (
                      <div
                        className="drop-gap-slot mx-1 my-1 rounded border-2 border-dashed overflow-hidden"
                        style={{
                          height: '30px',
                          borderColor: 'color-mix(in srgb, var(--color-accent) 45%, transparent)',
                          background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
                        }}
                      />
                    )}
                  </div>
                );
              })}

              {/* Ungrouped Section */}
              <div
                ref={ungroupedRef}
                className={`rounded transition-colors ${dropTarget === '__ungrouped__' && dragProfile ? 'bg-accent-solid/20 ring-2 ring-accent-solid/50' : ''}`}
              >
                {ungroupedProfiles.length > 0 && ((profileOrder?.pinned?.length ?? 0) > 0 || (profileOrder?.folders?.length ?? 0) > 0) && (
                  renderSectionLabel('Ungrouped')
                )}
                {/* Loose rows sit OUTSIDE any card, so without a matching inset they start
                    ~6 px left of the rows inside folders — the panel would carry two name
                    columns, and the seam shows exactly at the last folder. */}
                <div className="px-[3px]">
                  {ungroupedProfiles.map(renderProfileRow)}
                </div>
              </div>
            </>
          )}
        </div>
          </>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && menuPos && (
        // Profile row context menu — five groups ordered by setup → state →
        // occasional → destructive, so reading top-to-bottom matches the
        // "create a profile and configure it" flow:
        //
        //   - Identity     → Rename… · Move to folder ▸
        //   - Triggers     → Hotkey… · Hotstring… · Window target…
        //
        // The trigger group is three NOUNS, no verb. "Assign" carried nothing that the
        // menu's own scope and the trailing ellipsis do not already say, and it made the
        // two longest items start with the same word — you had to read past it to tell
        // them apart. The ellipsis is the rule for the whole menu: it marks the items that
        // open a dialog asking for input, which is why Rename has one and Delete, whose
        // dialog only confirms, does not.
        //   - State        → Pin / Unpin · Disable / Enable
        //   - Advanced     → Duplicate · Open in Explorer
        //   - Destructive  → Delete
        //
        // Previous layout put State first and buried Triggers under it; the swap
        // brings the most-relevant-after-create items (rename / hotkey) to the
        // top, and isolates rarely-used items (Duplicate, Open in Explorer) in
        // a dedicated Advanced bucket so they don't crowd the prime real estate.
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[180px] py-1 menu-surface"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          {/* ── Identity ── */}
          <button
            onClick={() => handleRename(contextMenu.profileName)}
            className="menu-item text-text-primary"
          >
            <Pencil size={13} className="text-text-tertiary" />
            Rename…
          </button>

          {/* Move to Folder submenu */}
          <div
            className="relative"
            onMouseEnter={() => setShowMoveToFolderMenu(contextMenu.profileName)}
            onMouseLeave={() => setShowMoveToFolderMenu(null)}
          >
            <button
              className="menu-item text-text-primary"
            >
              {/* FolderInput, not an arrow leaving a line: this puts the profile INTO a folder,
                  and an arrow exiting reads as send-away / export. It also pairs with the
                  FolderMinus on this submenu's own "Remove from folder" — one family, opposite
                  directions, so the pair is legible without reading either label. */}
              <FolderInput size={13} className="text-text-tertiary" />
              Move to folder
              <ChevronRight size={12} className="ml-auto text-text-tertiary" />
            </button>
            {moveMenuOpen && (
              <div
                ref={moveFlyout.ref}
                className={`absolute bg-transparent ${moveFlyout.flipX ? 'right-full' : 'left-full'} ${moveFlyout.flipY ? 'bottom-0' : 'top-0'}`}
                style={moveFlyout.flipX ? { paddingRight: '4px' } : { paddingLeft: '4px' }}
              >
              <div className="py-1 menu-surface z-[60] whitespace-nowrap">
                {(profileOrder?.folders ?? []).map(f => (
                  <button
                    key={f.name}
                    onClick={() => handleMoveToFolder(contextMenu.profileName, f.name)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-minor hover:bg-bg-elevated transition-colors ${
                      getProfileFolder(contextMenu.profileName) === f.name ? 'text-accent' : 'text-text-primary'
                    }`}
                  >
                    <FolderOpen size={12} style={{ color: f.color }} />
                    {f.name}
                  </button>
                ))}
                {(profileOrder?.folders ?? []).length > 0 && getProfileFolder(contextMenu.profileName) && (
                  <>
                    <div className="my-1 border-t border-border-subtle" />
                    <button
                      onClick={() => handleMoveToFolder(contextMenu.profileName, null)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-minor text-text-primary hover:bg-bg-elevated transition-colors"
                    >
                      <FolderMinus size={12} className="text-text-tertiary" />
                      Remove from folder
                    </button>
                  </>
                )}
                {(profileOrder?.folders ?? []).length === 0 && (
                  <span className="block px-3 py-1.5 text-minor text-text-disabled">No folders</span>
                )}
              </div>
              </div>
            )}
          </div>

          <div className="my-1 border-t border-border-subtle" />

          {/* ── Triggers — what makes the profile fire ──
              Trailing ellipsis on the three labels follows the standard
              convention that the label opens a dialog rather than acting
              inline. */}
          <button
            onClick={() => handleAssignHotkey(contextMenu.profileName)}
            className="menu-item text-text-primary"
          >
            <Keyboard size={13} className="text-text-tertiary" />
            Hotkey…
          </button>
          <button
            onClick={() => handleAssignHotstring(contextMenu.profileName)}
            className="menu-item text-text-primary"
          >
            <Type size={13} className="text-text-tertiary" />
            Hotstring…
          </button>
          <button
            onClick={() => handleSetWindowTarget(contextMenu.profileName)}
            className="menu-item text-text-primary"
          >
            <AppWindow size={13} className="text-text-tertiary" />
            Window target…
          </button>

          <div className="my-1 border-t border-border-subtle" />

          {/* ── State ── Duplicate sits above Disable (promoted from the More
              submenu at user request); Pin/Unpin moved INTO More. */}
          <button
            onClick={() => handleDuplicate(contextMenu.profileName)}
            className="menu-item text-text-primary"
          >
            <Copy size={13} className="text-text-tertiary" />
            Duplicate
          </button>

          <button
            onClick={() => handleToggleDisable(contextMenu.profileName)}
            className="menu-item text-text-primary"
          >
            {/* The glyph flips with the label, the way Pin / PinOff two rows down already does.
                A fixed Ban sat next to "Enable" saying the opposite of the word beside it —
                circle-slash means blocked, and the item's whole job there is to unblock.
                Power for the enable side is not a fresh pick: it is already this app's glyph for
                exactly this state, on the Automation panel's master enable. */}
            {profile?.isDisabled
              ? <Power size={13} className="text-text-tertiary" />
              : <Ban size={13} className="text-text-tertiary" />}
            {profile?.isDisabled ? 'Enable' : 'Disable'}
          </button>

          <div className="my-1 border-t border-border-subtle" />

          {/* ── More ▸ — low-frequency entry points tucked into a submenu so the top
              level stays focused on rename / triggers / state. Mirrors the grid context
              menu's "More". Edit info (metadata), Pin/Unpin, Open in Explorer (debug:
              show the .json on disk). */}
          <div
            className="relative"
            onMouseEnter={() => setShowProfileMoreMenu(contextMenu.profileName)}
            onMouseLeave={() => setShowProfileMoreMenu(null)}
          >
            <button
              className="menu-item text-text-primary"
            >
              <MoreHorizontal size={13} className="text-text-tertiary" />
              More
              <ChevronRight size={12} className="ml-auto text-text-tertiary" />
            </button>
            {moreMenuOpen && (
              <div
                ref={moreFlyout.ref}
                className={`absolute bg-transparent ${moreFlyout.flipX ? 'right-full' : 'left-full'} ${moreFlyout.flipY ? 'bottom-0' : 'top-0'}`}
                style={moreFlyout.flipX ? { paddingRight: '4px' } : { paddingLeft: '4px' }}
              >
                <div className="py-1 menu-surface z-[60] whitespace-nowrap">
                  <button
                    onClick={() => handleShowInfo(contextMenu.profileName)}
                    className="menu-item text-text-primary"
                  >
                    <Info size={13} className="text-text-tertiary" />
                    Edit info…
                  </button>
                  {isPinned(contextMenu.profileName) ? (
                    <button
                      onClick={() => handleUnpinProfile(contextMenu.profileName)}
                      className="menu-item text-text-primary"
                    >
                      <PinOff size={13} className="text-text-tertiary" />
                      Unpin
                    </button>
                  ) : (
                    <button
                      onClick={() => handlePinProfile(contextMenu.profileName)}
                      className="menu-item text-text-primary"
                    >
                      <Pin size={13} className="text-text-tertiary" />
                      Pin
                    </button>
                  )}
                  <button
                    onClick={() => { handleOpenFolder(contextMenu.profileName); setContextMenu(null); }}
                    className="menu-item text-text-primary"
                  >
                    <ExternalLink size={13} className="text-text-tertiary" />
                    Open in Explorer
                  </button>
                  {/* Convert coords → Relative/Absolute lived here too and no longer does: it is a
                      whole-profile rewrite that a user reaches for once, and the command palette
                      already carries both directions with the same active-profile gate. Two
                      surfaces for a rare, sweeping action is one surface too many — and this one
                      sat one hover away from Delete. The palette is the single home now. */}
                </div>
              </div>
            )}
          </div>

          <div className="my-1 border-t border-border-subtle" />

          {/* ── Destructive ── */}
          <button
            onClick={() => handleDelete(contextMenu.profileName)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-minor text-recording hover:bg-bg-elevated transition-colors"
          >
            <span className="flex items-center gap-2.5">
              <Trash2 size={13} />
              Delete
            </span>
            <span className="kbd">Del</span>
          </button>
        </div>
      )}

      {/* Folder Context Menu */}
      {folderContextMenu && folderMenuPos && (
        // Folder context menu — grouped top-to-bottom by scope and time:
        //   - Identity (apply to this folder itself)     → Rename · Color ▸
        //   - Triggers (configure children, setup-time)  → Window target…
        //   - State (batch state flip on children)       → Disable / Enable all
        //   - Destructive                                 → Delete folder
        // Every entry here scopes to THIS folder. Collapse/Expand all used to sit in a
        // "View" block and did not — it moved to the panel header, where a bulk action
        // belongs.
        // State got its own block (was bundled into Triggers) so the menu's
        // semantic blocks match the profile context menu's structure:
        // Identity → Triggers → State → … → Delete.
        // Folders are virtual organisation buckets (not file-system folders),
        // so they have no "Open in Explorer" / "Duplicate" equivalent.
        <div
          ref={folderMenuRef}
          className="fixed z-50 min-w-[160px] py-1 menu-surface"
          style={{ left: folderMenuPos.x, top: folderMenuPos.y }}
        >
          {/* ── Identity (this folder) ── */}
          <button
            onClick={() => handleRenameFolder(folderContextMenu.folderName)}
            className="menu-item text-text-primary"
          >
            <Pencil size={13} className="text-text-tertiary" />
            Rename…
          </button>
          <div
            className="relative"
            onMouseEnter={() => setShowFolderColorPicker(folderContextMenu.folderName)}
            onMouseLeave={() => setShowFolderColorPicker(null)}
          >
            <button
              className="menu-item text-text-primary"
            >
              <Palette size={13} className="text-text-tertiary" />
              Color
              <ChevronRight size={12} className="ml-auto text-text-tertiary" />
            </button>
            {colorMenuOpen && (
              <div
                ref={colorFlyout.ref}
                className={`absolute min-w-0 bg-transparent ${colorFlyout.flipX ? 'right-full' : 'left-full'} ${colorFlyout.flipY ? 'bottom-0' : 'top-0'}`}
                style={colorFlyout.flipX ? { paddingRight: '4px' } : { paddingLeft: '4px' }}
              >
              <div className="p-2.5 menu-surface z-[60]">
                {/* Same rounded-tile grid as the New Folder dialog — 8 columns, 3 rows for
                    the 24 tones; the folder's current colour shows a ring + check. */}
                <div className="grid grid-cols-8 gap-1.5" style={{ width: '212px' }}>
                  {FOLDER_COLORS.map(c => {
                    const selected = (profileOrder?.folders ?? []).find(f => f.name === folderContextMenu.folderName)?.color === c;
                    return (
                      <button
                        key={c}
                        onClick={() => handleSetFolderColor(folderContextMenu.folderName, c)}
                        aria-label={`Colour ${c}`}
                        className="relative w-full aspect-square rounded-md transition-transform hover:scale-110"
                        style={{
                          backgroundColor: c,
                          boxShadow: selected ? '0 0 0 2px var(--color-bg-card), 0 0 0 4px var(--color-text-primary)' : undefined,
                        }}
                      >
                        {selected && (
                          <Check
                            size={11}
                            strokeWidth={3}
                            className="absolute inset-0 m-auto"
                            style={{ color: isLightFolderColor(c) ? 'rgba(0,0,0,0.72)' : '#fff' }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              </div>
            )}
          </div>

          <div className="my-1 border-t border-border-subtle" />

          {/* ── Triggers (this folder's children) ──
              "Window target…" is inherited by every profile inside the folder
              unless that profile overrides it. Setup-time configuration of how
              children fire. The trailing ellipsis indicates a dialog opens
              (matches the profile menu's "Hotkey…" etc). */}
          <button
            onClick={() => {
              setShowFolderTargetDialog(folderContextMenu.folderName);
              setFolderContextMenu(null);
            }}
            className="menu-item text-text-primary"
          >
            <AppWindow size={13} className="text-text-tertiary" />
            Window target…
          </button>

          <div className="my-1 border-t border-border-subtle" />

          {/* ── State (batch operation on this folder's children) ──
              Separated from Triggers because Disable-all is a run-time state
              flip, not a configure-once trigger. Matches how the profile menu
              keeps Pin / Disable in its own State block. */}
          <button
            onClick={() => {
              send({ type: 'profile:toggleFolderDisable', payload: { name: folderContextMenu.folderName } });
              setFolderContextMenu(null);
            }}
            className="menu-item text-text-primary"
          >
            {(() => {
              // One computation drives BOTH the glyph and the label — they cannot drift apart
              // into a Ban sitting next to the word "Enable all". Same flip as the profile menu.
              const folder = (profileOrder?.folders ?? []).find(f => f.name === folderContextMenu.folderName);
              const items = folder?.items ?? [];
              const allDisabled = items.length > 0 && items.every(n => profiles.find(p => p.name === n)?.isDisabled);
              return (
                <>
                  {allDisabled
                    ? <Power size={13} className="text-text-tertiary" />
                    : <Ban size={13} className="text-text-tertiary" />}
                  {allDisabled ? 'Enable all' : 'Disable all'}
                </>
              );
            })()}
          </button>

          <div className="my-1 border-t border-border-subtle" />

          {/* Collapse / expand ALL folders used to live here. It moved to the panel header:
              a bulk action on every folder had no business hiding behind a right-click on
              one particular folder, and the header button is always visible with the same
              flip rule. */}

          {/* ── Destructive ── */}
          <button
            onClick={() => handleDeleteFolder(folderContextMenu.folderName)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-minor text-recording hover:bg-bg-elevated transition-colors"
          >
            <Trash2 size={13} />
            Delete folder
          </button>
        </div>
      )}

      {/* Create Dialog */}
      {showCreateDialog && (
        <DialogShell icon={<FilePlus size={14} className="text-accent" />} title={createFolder ? `New profile in ${createFolder}` : 'New profile'} size="sm" onClose={() => setShowCreateDialog(false)}
          footer={<DialogFooter secondary={{ label: 'Cancel', onClick: () => setShowCreateDialog(false) }} primary={{ label: 'Create', onClick: confirmCreate, disabled: !dialogValue.trim() || createProfileNameTaken }} />}>
          <div className="p-4 flex flex-col">
            {/* The destination rides the TITLE rather than a line of its own: it is one fact,
                and a dialog reached from two different buttons has to say which one opened it.
                One name for one action, everywhere — the toolbar tooltip, this title and the
                folder row all read "New profile" (it used to be "New profile" / "Create Profile"
                / nothing, for the same thing). */}
            <input
              ref={dialogInputRef}
              type="text"
              value={dialogValue}
              onChange={(e) => setDialogValue(e.target.value)}
              onKeyDown={(e) => handleDialogKeyDown(e, confirmCreate)}
              placeholder="Profile name..."
              className="input-field font-sans"
            />
            {/* Reserved slot, not a conditional mount — see FieldError. The name is deliberately
                NOT echoed here: it is in the focused input 8 px above, and an interpolated value
                would make the reserved width track what the user types. */}
            <FieldError show={createProfileNameTaken}>A profile with that name already exists.</FieldError>
          </div>
        </DialogShell>
      )}

      {/* Rename Dialog */}
      {showRenameDialog && (
        <DialogShell icon={<Pencil size={14} className="text-accent" />} title="Rename Profile" size="sm" onClose={() => setShowRenameDialog(null)}
          footer={<DialogFooter secondary={{ label: 'Cancel', onClick: () => setShowRenameDialog(null) }} primary={{ label: 'Rename', onClick: confirmRename, disabled: !dialogValue.trim() || renameProfileNameTaken }} />}>
          <div className="p-4 flex flex-col">
            <input
              ref={dialogInputRef}
              type="text"
              value={dialogValue}
              onChange={(e) => setDialogValue(e.target.value)}
              onKeyDown={(e) => handleDialogKeyDown(e, confirmRename)}
              placeholder="New name..."
              className="input-field font-sans"
            />
            <FieldError show={renameProfileNameTaken}>A profile with that name already exists.</FieldError>
          </div>
        </DialogShell>
      )}

      {/* Delete Confirm Dialog */}
      {showDeleteConfirm && (
        <DialogShell icon={<Trash2 size={14} style={{ color: 'var(--color-recording-fg)' }} />} title="Delete Profile" size="sm" onClose={() => setShowDeleteConfirm(null)} onCardKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}
          /* Cancel takes the initial focus: deleting a profile is irreversible (the file and the
             image directory go, with no undo toast), so the destructive action must never be what
             a reflexive Enter runs. The shell already refuses to read Enter-on-a-button as a
             dialog shortcut; this makes the safe button the one that Enter lands on.

             Enter is CONTAINED here, never acted on. A dialog-level Enter rule survived the shell
             guard through the one path it cannot see: the card itself is tabIndex={-1}, so a click
             anywhere that is not a button — the sentence naming the profile, the padding around it
             — moves the focus to the card, and from there e.target is a div and the guard does not
             match. Reading the name before confirming is the most natural thing to do in this
             dialog, and it deleted the profile. Confirmation is the focused button's own native
             activation, which is what the guard already assumes. */
          footer={<DialogFooter danger secondary={{ label: 'Cancel', onClick: () => setShowDeleteConfirm(null), autoFocus: true }} primary={{ label: 'Delete', onClick: confirmDelete }} />}>
          <div className="p-4 flex flex-col">
            <p className="text-body text-text-secondary">
              Delete profile <span className="text-text-primary font-medium">'{showDeleteConfirm}'</span>?
            </p>
          </div>
        </DialogShell>
      )}

      {/* Remove-confirmation Dialog — gate for the inline ✕ removals (hotkey /
          hotstring / profile target / folder target). Same shape as the delete
          dialog; the focused button confirms, Esc cancels. */}
      {confirmRemoval && (
        <DialogShell icon={<AlertTriangle size={14} style={{ color: 'var(--color-warning-ink)' }} />} title="Are you sure?" size="sm" onClose={() => setConfirmRemoval(null)} onCardKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}
          /* Same rule as Delete Profile — "No" holds the focus, and Enter is contained rather than
             acted on (see the note there: a click on the sentence focuses the card and slips past
             the shell's guard). This one is recoverable (each removal posts a 10 s Undo toast),
             but a destructive primary should not be the implicit default either way. */
          footer={<DialogFooter danger secondary={{ label: 'No', onClick: () => setConfirmRemoval(null), autoFocus: true }} primary={{ label: 'Yes, remove', onClick: runConfirmedRemoval }} />}>
          <div className="p-4 flex flex-col">
            <p className="text-body text-text-secondary">
              Remove {confirmRemoval.label} from <span className="text-text-primary font-medium">'{confirmRemoval.name}'</span>?
            </p>
          </div>
        </DialogShell>
      )}

      {/* Assign Hotkey Dialog */}
      {showHotkeyDialog && (
        <DialogShell icon={<Keyboard size={14} className="text-accent" />} title="Assign Hotkey" size="sm" onClose={() => setShowHotkeyDialog(null)}
          footerStart={profiles.find(p => p.name === showHotkeyDialog)?.hotkey ? (
            <Button variant="destructiveText" size="md" onClick={() => { handleRemoveHotkey(showHotkeyDialog!); setShowHotkeyDialog(null); }}>Remove</Button>
          ) : undefined}
          footer={<DialogFooter secondary={{ label: 'Cancel', onClick: () => setShowHotkeyDialog(null) }} primary={{ label: 'Assign', onClick: confirmHotkey, disabled: hotkeyCapture === '...' }} />}>
          <div className="p-4 flex flex-col">
            <p className="text-minor text-text-secondary mb-3">
              Press a key combination for <span className="text-text-primary font-medium">'{showHotkeyDialog}'</span>
            </p>
            {/* Matches the SettingsPanel global-hotkey field: a blinking "New key…"
                placeholder while awaiting a combo (the old literal "..." value was
                a stand-in for this), solid accent once captured. */}
            <input
              ref={hotkeyInputRef}
              type="text"
              readOnly
              value={!hotkeyCapture || hotkeyCapture === '...' ? '' : hotkeyCapture}
              placeholder="New key..."
              className={`w-full h-8 px-2 text-ui font-mono bg-bg-input border border-accent-solid rounded text-center outline-none placeholder:text-accent-light/50 ${
                !hotkeyCapture || hotkeyCapture === '...'
                  ? 'text-accent-light animate-pulse'
                  : 'text-accent'
              }`}
            />

            {/* Trigger Mode */}
            <div className="mt-4">
              <div className="label-micro text-text-tertiary mb-1.5">Trigger Mode</div>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { id: 'onPress', label: 'On Press', help: undefined },
                  { id: 'onRelease', label: 'On Release', help: undefined },
                  { id: 'whilePressed', label: 'While Pressed', help: tt('Loops while held; stops on release', 'Repete enquanto segura; para ao soltar') },
                  { id: 'toggle', label: 'Toggle', help: tt('Press to start looping, press again to stop', 'Aperte para começar o loop, de novo para parar') },
                  { id: 'doubleTap', label: 'Double-tap', help: tt('Two quick taps; a single tap is ignored', 'Dois toques rápidos; toque único é ignorado') },
                  { id: 'hold', label: 'Hold (long-press)', help: tt('Fires once after ~0.6 s held; does not stop on release', 'Dispara uma vez após ~0,6 s segurando; não para ao soltar') },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setHotkeyTriggerMode(opt.id)}
                    className={`h-7 text-caption rounded border transition-colors ${
                      hotkeyTriggerMode === opt.id
                        ? 'bg-accent-solid/15 border-accent-solid/40 text-accent'
                        : 'bg-transparent border-border-default text-text-tertiary hover:text-text-secondary hover:border-border-strong'
                    }`}
                    data-tip={opt.help}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 text-caption text-text-tertiary leading-tight min-h-[14px]">
                {hotkeyTriggerMode === 'whilePressed' && 'Loops while held.'}
                {hotkeyTriggerMode === 'toggle' && 'Loops until pressed again.'}
                {hotkeyTriggerMode === 'doubleTap' && 'Single taps are ignored.'}
                {hotkeyTriggerMode === 'hold' && 'Fires after ~0.6 s held; a tap does nothing.'}
              </div>
            </div>
          </div>
        </DialogShell>
      )}

      {/* Assign Hotstring Dialog */}
      {showHotstringDialog && (
        <DialogShell icon={<Type size={14} className="text-accent" />} title="Assign Hotstring" size="sm" onClose={() => setShowHotstringDialog(null)}
          footerStart={profiles.find(p => p.name === showHotstringDialog)?.hotstring ? (
            <Button variant="destructiveText" size="md" onClick={() => { handleRemoveHotstring(showHotstringDialog!); setShowHotstringDialog(null); }}>Remove</Button>
          ) : undefined}
          footer={<DialogFooter secondary={{ label: 'Cancel', onClick: () => setShowHotstringDialog(null) }} primary={{ label: 'Assign', onClick: confirmHotstring, disabled: hotstringValue.trim().length < 2 }} />}>
          <div className="p-4 flex flex-col">
            <p className="text-minor text-text-secondary mb-3">
              Type a character sequence for <span className="text-text-primary font-medium">'{showHotstringDialog}'</span>
            </p>
            <input
              ref={hotstringInputRef}
              type="text"
              value={hotstringValue}
              onChange={(e) => setHotstringValue(e.target.value.replace(/[^a-zA-Z0-9\-./,;=]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); confirmHotstring(); }
              }}
              placeholder="e.g. /id"
              maxLength={32}
              className="w-full h-8 px-2 text-ui font-mono text-accent bg-bg-input border border-accent-solid rounded outline-none"
            />
            <p className="text-caption text-text-tertiary mt-1.5">
              Min 2 characters.
            </p>

            <button
              type="button"
              onClick={() => setHotstringInstant(!hotstringInstant)}
              className="flex items-center gap-2 mt-3 cursor-pointer text-left"
            >
              <CheckboxBox checked={hotstringInstant} />
              <span className="text-minor text-text-secondary">Instant trigger</span>
              <span className="text-caption text-text-tertiary">(no Enter/Space/Tab needed)</span>
            </button>
          </div>
        </DialogShell>
      )}

      {/* Export Profiles Dialog */}
      {showExportDialog && (() => {
        const matchesExport = (name: string) => !exportSearch || name.toLowerCase().includes(exportSearch.toLowerCase());
        // One lookup table per render — a profiles.find per row was O(n²) over ~81 profiles.
        const profileByName = new Map(profiles.map(p => [p.name, p]));
        // Row anatomy mirrors the Import Preview: emoji identity up front, hotkey +
        // action count as right-aligned metadata. Tertiary, not disabled — disabled
        // ink is for switched-off controls, this is informative text.
        const rowEmoji = (name: string) => (
          <span className="w-4 text-center text-sm leading-none select-none shrink-0">
            {profileByName.get(name)?.iconEmoji || '📄'}
          </span>
        );
        const rowMeta = (name: string) => {
          const p = profileByName.get(name);
          if (!p) return null;
          return (
            <span className="ml-auto shrink-0 flex items-center gap-1.5">
              {p.hotkey && <KbdTag combo={p.hotkey} unified />}
              {p.actionCount !== undefined && (
                <span className="text-caption text-text-tertiary tabular-nums">{p.actionCount} action{p.actionCount === 1 ? '' : 's'}</span>
              )}
            </span>
          );
        };
        // The sections follow the panel's: Pinned lists EVERY pinned profile, a folder lists all of
        // its members, and a pinned folder member sits in both (one checkbox state, since it is
        // keyed by name). Pinned used to leave out any profile that was also in a folder — the
        // opposite of the panel, whose Pinned section leads with it and whose rail puts it first.
        const folders = (profileOrder?.folders ?? []).filter(f => f.items.some(matchesExport));
        const ungrouped = profiles.filter(p => {
          const inFolder = (profileOrder?.folders ?? []).some(f => f.items.includes(p.name));
          const isPinned = (profileOrder?.pinned ?? []).includes(p.name);
          return !inFolder && !isPinned && matchesExport(p.name);
        });
        const pinned = (profileOrder?.pinned ?? []).filter(n => profileByName.has(n) && matchesExport(n));
        // Select-All / per-folder counts scope to the search-visible rows (that's what the
        // control toggles). The FOOTER total, by contrast, spans every checked profile —
        // including ones the filter currently hides — because that's the set confirmExport ships.
        const visibleNames = profiles.filter(p => matchesExport(p.name)).map(p => p.name);
        const selectedCount = visibleNames.filter(n => exportSelection[n]).length;
        const totalSelectedCount = profiles.filter(p => exportSelection[p.name]).length;
        const hiddenSelectedCount = totalSelectedCount
          - profiles.filter(p => exportSelection[p.name] && matchesExport(p.name)).length;

        return (
          <DialogShell
            icon={<Upload size={14} style={{ color: 'var(--color-accent)' }} />}
            title="Export Profiles"
            // 460px: still deliberately narrower than the Import Preview's 640 (export is a
            // light picker, import is a review), but no longer the only dialog UNDER the
            // shell's 440 default while serving the app's longest list (~81 profiles with
            // folder indentation truncating PT-BR names early at 380).
            size="md"
            cardClassName="max-h-[calc(90vh/var(--ui-zoom))]"
            onClose={() => setShowExportDialog(false)}
            // Don't discard a multi-profile selection on a stray outside click, matching the
            // Import Preview dialog.
            closeOnBackdrop={false}
            footerHint={
              // The Import cross-link rides the LEFT slot, far from the Cancel/Export pair
              // — it used to sit flush against them, where a misclick silently discarded a
              // curated multi-profile selection. That distance is what keeps it safe, so it
              // no longer has to be a borderless ghost to stay out of the way: as a ghost it
              // read as loose text in the footer's hint slot, with nothing saying it could be
              // clicked — and this is now the only route to Import from the panel, so it must
              // look like a control. `secondary` is the Cancel weight, one step below the
              // primary Export, plus the same Download glyph the palette uses for importing.
              <span className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => { handleImportClick(); setShowExportDialog(false); }}
                >
                  <Download size={12} />
                  Import…
                </Button>
                <span>
                  {totalSelectedCount} selected
                  {hiddenSelectedCount > 0 && <> · {hiddenSelectedCount} hidden by filter</>}
                </span>
              </span>
            }
            footer={
              <>
                <Button variant="secondary" size="md" className="min-w-[84px]" onClick={() => setShowExportDialog(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  className="min-w-[84px]"
                  onClick={confirmExport}
                  disabled={totalSelectedCount === 0}
                >
                  Export
                </Button>
              </>
            }
          >
            {/* Search — focus ring + aria parity with ProfileSearchList, which this
                hand-rolled field had drifted from. */}
            <div className="px-4 pt-3">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-bg-input border border-border-default rounded focus-within:border-accent-solid transition-colors">
                <Search size={12} className="text-text-disabled shrink-0" />
                <input
                  type="text"
                  placeholder="Filter profiles..."
                  aria-label={'Filter profiles'}
                  value={exportSearch}
                  onChange={(e) => setExportSearch(e.target.value)}
                  className="bg-transparent text-minor text-text-primary placeholder:text-text-disabled outline-none flex-1 min-w-0"
                />
                {exportSearch && (
                  <button
                    onClick={() => setExportSearch('')}
                    aria-label={'Clear filter'}
                    className="text-text-disabled hover:text-text-secondary transition-colors shrink-0"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Select All (visible) */}
            <div className="px-4 pt-2">
              {/* hover is bg-surface, NOT bg-elevated: the DialogShell card is itself
                  bg-elevated, so the old hover painted the same color — no feedback. */}
              <button
                type="button"
                onClick={toggleExportSelectAll}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-surface cursor-pointer border-b border-border-subtle text-left"
              >
                <CheckboxBox checked={allExportSelected} />
                <span className="text-minor font-medium text-text-secondary">Select All</span>
                <span className="ml-auto text-caption text-text-tertiary">{selectedCount}/{visibleNames.length}</span>
              </button>
            </div>

            {/* Scrollable list organized by folders */}
            <div className="flex-1 overflow-y-auto px-4 py-1 min-h-[160px]">
              {/* Empty states — the old dialog rendered mute whitespace here, which read
                  as broken when a filter matched nothing. */}
              {visibleNames.length === 0 && (
                <div className="py-6 flex flex-col items-center gap-2 text-caption text-text-tertiary">
                  <span>
                    {profiles.length === 0 ? 'No profiles to export.' : `No profiles match "${exportSearch}"`}
                  </span>
                  {exportSearch && (
                    <Button variant="ghost" onClick={() => setExportSearch('')}>Clear filter</Button>
                  )}
                </div>
              )}
              {/* Pinned — every pinned profile, folder member or not (see above) */}
              {pinned.length > 0 && (
                <div className="mb-1">
                  <div className="px-2 py-1 label-micro text-text-tertiary">Pinned</div>
                  {pinned.map(name => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleExportProfile(name)}
                      className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-surface cursor-pointer text-left"
                    >
                      <CheckboxBox checked={!!exportSelection[name]} />
                      {rowEmoji(name)}
                      <span className="text-minor text-text-primary truncate">{name}</span>
                      {rowMeta(name)}
                    </button>
                  ))}
                </div>
              )}

              {/* Folders */}
              {folders.map(f => {
                const visibleItems = f.items.filter(matchesExport);
                const folderAllSelected = visibleItems.every(n => exportSelection[n]);
                const folderSomeSelected = visibleItems.some(n => exportSelection[n]);
                return (
                  <div key={f.name} className="mb-1">
                    <button
                      type="button"
                      onClick={() => toggleExportFolder(visibleItems)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-bg-surface cursor-pointer text-left"
                    >
                      <CheckboxBox
                        checked={folderAllSelected}
                        indeterminate={folderSomeSelected && !folderAllSelected}
                      />
                      <FolderOpen size={12} style={{ color: f.color }} className="shrink-0" />
                      <span className="text-minor font-medium text-text-secondary truncate">{f.name}</span>
                      <span className="ml-auto text-caption text-text-tertiary">{visibleItems.filter(n => exportSelection[n]).length}/{visibleItems.length}</span>
                    </button>
                    <div className="ml-5">
                      {visibleItems.map(name => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => toggleExportProfile(name)}
                          className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-surface cursor-pointer text-left"
                        >
                          <CheckboxBox checked={!!exportSelection[name]} />
                          {rowEmoji(name)}
                          <span className="text-minor text-text-primary truncate">{name}</span>
                          {rowMeta(name)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Ungrouped */}
              {ungrouped.length > 0 && (
                <div className="mb-1">
                  {folders.length > 0 && <div className="px-2 py-1 label-micro text-text-tertiary">Ungrouped</div>}
                  {ungrouped.map(p => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => toggleExportProfile(p.name)}
                      className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-surface cursor-pointer text-left"
                    >
                      <CheckboxBox checked={!!exportSelection[p.name]} />
                      {rowEmoji(p.name)}
                      <span className="text-minor text-text-primary truncate">{p.name}</span>
                      {rowMeta(p.name)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Include folder organization — the export bundles pins/folders/grouping AND each
                folder's window target, so the recipient rebuilds the same layout. Was hardcoded on;
                now opt-out, and the ONLY checkbox here: MOSTLY cosmetic (usually the export just
                lands as a flat list), so it is safe to decline — the one caveat is that a profile
                which INHERITS its window target from a folder loses that target without the folder,
                so its clicks resolve differently. Sub-profiles get no such checkbox: declining those
                ships a SILENTLY broken chain, a harder failure than a dropped folder target. */}
            <div className="px-4 py-2.5 border-t border-border-subtle space-y-2">
              <button
                type="button"
                onClick={() => setIncludeExportOrg(v => !v)}
                className="w-full flex items-center gap-2 text-left"
                data-tip={tt('Pins, folders, order and folder targets', 'Pins, pastas, ordem e alvos de pasta')}
              >
                <CheckboxBox checked={includeExportOrg} />
                <span className="text-minor text-text-secondary">Include folder organization</span>
              </button>
              {/* Sub-profiles ride along ALWAYS (no toggle — see exportDepNames). This is the
                  disclosure: it names what the Run Profile chain drags in, so the file size and
                  the contents are never a surprise, and a sub-profile you meant to keep private is
                  visible BEFORE you export. Hidden entirely when the selection calls nothing. */}
              {exportDepNames.length > 0 && (
                <div
                  className="text-caption text-text-tertiary leading-relaxed"
                  data-tip={`${tt('Called via Run Profile:', 'Chamados via Run Profile:')} ${exportDepNames.join(', ')}`}
                >
                  {`+${exportDepNames.length} referenced sub-profile${exportDepNames.length === 1 ? '' : 's'} included`}
                </div>
              )}
            </div>
          </DialogShell>
        );
      })()}

      {/* Create Folder Dialog */}
      {showCreateFolderDialog && (
        <DialogShell icon={<FolderPlus size={14} className="text-accent" />} title="New Folder" size="sm" onClose={() => setShowCreateFolderDialog(false)}
          footer={<DialogFooter secondary={{ label: 'Cancel', onClick: () => setShowCreateFolderDialog(false) }} primary={{ label: 'Create', onClick: confirmCreateFolder, disabled: !folderDialogName.trim() || createFolderNameTaken }} />}>
          <div className="p-4 flex flex-col">
            <input
              ref={folderDialogInputRef}
              type="text"
              value={folderDialogName}
              onChange={(e) => setFolderDialogName(e.target.value)}
              onKeyDown={(e) => handleDialogKeyDown(e, confirmCreateFolder)}
              placeholder="Folder name..."
              className="input-field font-sans"
            />
            {/* Colour picker — a full-width 8×3 grid of rounded tiles. Square cells tile the
                dialog width edge-to-edge (symmetric by construction, no stray gaps); the
                selected tile gets a ring + a check (dark or white ink by luminance). */}
            <div className="grid grid-cols-8 gap-1.5 mt-4">
              {FOLDER_COLORS.map(c => {
                const selected = folderDialogColor === c;
                return (
                  <button
                    key={c}
                    onClick={() => setFolderDialogColor(c)}
                    aria-label={`Colour ${c}`}
                    className="relative w-full aspect-square rounded-md transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      boxShadow: selected ? '0 0 0 2px var(--color-bg-card), 0 0 0 4px var(--color-text-primary)' : undefined,
                    }}
                  >
                    {selected && (
                      <Check
                        size={12}
                        strokeWidth={3}
                        className="absolute inset-0 m-auto"
                        style={{ color: isLightFolderColor(c) ? 'rgba(0,0,0,0.72)' : '#fff' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            {/* Live preview — how the folder will read in the sidebar: icon tinted with the
                chosen colour + the name as you type it. */}
            <div className="flex items-center gap-2 mt-3.5 px-2.5 py-2 rounded-md bg-bg-elevated border border-border-subtle">
              <ChevronDown size={12} className="shrink-0" style={{ color: folderDialogColor }} />
              <FolderOpen size={13} className="shrink-0" style={{ color: folderDialogColor }} />
              <span className="text-minor font-medium text-text-secondary truncate">
                {folderDialogName.trim() || 'Folder name'}
              </span>
              <span className="ml-auto text-caption uppercase tracking-wide text-text-disabled shrink-0">preview</span>
            </div>
            <FieldError show={createFolderNameTaken}>A folder with that name already exists.</FieldError>
          </div>
        </DialogShell>
      )}

      {/* Rename Folder Dialog */}
      {showRenameFolderDialog && (
        <DialogShell icon={<Pencil size={14} className="text-accent" />} title="Rename Folder" size="sm" onClose={() => setShowRenameFolderDialog(null)}
          footer={<DialogFooter secondary={{ label: 'Cancel', onClick: () => setShowRenameFolderDialog(null) }} primary={{ label: 'Rename', onClick: confirmRenameFolder, disabled: !folderDialogName.trim() || renameFolderNameTaken }} />}>
          <div className="p-4 flex flex-col">
            <input
              ref={folderDialogInputRef}
              type="text"
              value={folderDialogName}
              onChange={(e) => setFolderDialogName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); confirmRenameFolder(); }
              }}
              placeholder="New folder name..."
              className="input-field font-sans"
            />
            <FieldError show={renameFolderNameTaken}>A folder with that name already exists.</FieldError>
          </div>
        </DialogShell>
      )}

      {/* Window Target Dialog — profile scope */}
      {showWindowTargetDialog && (() => {
        const name = showWindowTargetDialog;
        const existing = profiles.find(p => p.name === name);
        const hasOwnTarget = existing?.hasWindowTarget ?? false;
        // Resolve effective values: profile's own target > folder-inherited. The dialog uses
        // these as initial input so toggling a flag on an inherited-target profile doesn't
        // require re-typing the target.
        const folder = !hasOwnTarget ? (profileOrder?.folders ?? []).find(f => f.items.includes(name)) : undefined;
        const initial = {
          processName: (hasOwnTarget ? existing?.windowTargetProcessName : folder?.windowTargetProcessName) ?? '',
          windowTitle: (hasOwnTarget ? existing?.windowTargetWindowTitle : folder?.windowTargetWindowTitle) ?? '',
          titleMatchMode: ((hasOwnTarget ? existing?.windowTargetTitleMatchMode : folder?.windowTargetTitleMatchMode) ?? 'contains') as 'contains' | 'regex',
          relativeCoordinates: (hasOwnTarget ? existing?.useRelativeCoordinates : folder?.useRelativeCoordinates) ?? false,
          bringToFocus: (hasOwnTarget ? existing?.bringToFocus : folder?.bringToFocus) ?? false,
          // Same inheritance rule as the other flags: profile's own wins; otherwise show folder.
          restorePosition: (hasOwnTarget ? existing?.restorePosition : folder?.restorePosition) ?? false,
          restoreSize: (hasOwnTarget ? existing?.restoreSize : folder?.restoreSize) ?? false,
        };
        return (
          <TargetConfigDialog
            scope="profile"
            targetLabel={name}
            hasOwnTarget={hasOwnTarget}
            inheritedFromFolder={!hasOwnTarget && !!folder}
            initial={initial}
            onSubmit={(payload, opts) => {
              send({
                type: 'profile:setWindowTarget',
                payload: {
                  name,
                  processName: payload.processName,
                  windowTitle: payload.windowTitle,
                  titleMatchMode: payload.titleMatchMode,
                  relativeCoordinates: payload.relativeCoordinates,
                  bringToFocus: payload.bringToFocus,
                  restorePosition: payload.restorePosition,
                  restoreSize: payload.restoreSize,
                  keepInheritedTarget: payload.keepInheritedTarget,
                  // Forwarded from the "Apply target & convert" path so the backend
                  // chains ExecuteConvertCoordinates after the save completes.
                  convertDirection: payload.convertDirection,
                },
              });
              // Apply target & convert wants the toast to land while the dialog is still
              // visible — opts.keepOpen carries that intent. Plain Set Target / Remove
              // close the dialog as before.
              if (!opts?.keepOpen) setShowWindowTargetDialog(null);
            }}
            onRemove={() => {
              handleRemoveWindowTarget(name);
              setShowWindowTargetDialog(null);
            }}
            onCancel={() => setShowWindowTargetDialog(null)}
            onUpdateGeometry={(fields) => send({
              type: 'profile:updateWindowSize',
              payload: {
                name,
                // Lets the user capture geometry BEFORE saving the target — backend uses these
                // overrides to locate the window if the saved target is stale or empty.
                processName: fields.processName || undefined,
                windowTitle: fields.windowTitle || undefined,
                titleMatchMode: fields.titleMatchMode,
              },
            })}
            /* The name makes the backend refuse when this dialog's profile is no longer the loaded
               one (an automation or a profile hotkey swapped it while the dialog was open) — it
               would otherwise convert whoever is loaded now — and answer the dialog either way. */
            onConvertCoordinates={(direction) => send({
              type: 'profile:convertCoordinates',
              payload: { direction, name },
            })}
            /* convertibleActionCount is derived from the LOADED profile's actions, and the backend
               convert rewrites the loaded profile — but this dialog opens for ANY right-clicked
               row. Feeding the loaded profile's count into another profile's dialog showed the
               wrong number AND armed a Convert / "Apply target & convert" button that rewrites the
               wrong profile. Zero here suppresses the migration hint entirely (the hint is the only
               producer of convertDirection), which is the same gate the two context-menu Convert
               items already apply via profile?.isActive. */
            /* !isClicker for the same reason the palette refuses "Convert Coordinates to
               Relative/Absolute" in Clicker: Convert rewrites every X/Y in the action list, and in
               Clicker that list is off screen but still loaded, so the count came back real and the
               buttons came back armed. The profile context menu stays reachable in Clicker on
               purpose — organisation does — but this dialog is the one item on it that writes to
               the grid, and the collapsed rail opens it too. */
            convertibleActionCount={!isClicker && existing?.isActive ? convertibleActionCount : 0}
          />
        );
      })()}

      {/* Folder Target Dialog */}
      {showFolderTargetDialog && (() => {
        const folderName = showFolderTargetDialog;
        const folder = (profileOrder?.folders ?? []).find(f => f.name === folderName);
        const hasOwnTarget = !!folder?.hasWindowTarget;
        const initial = {
          processName: folder?.windowTargetProcessName ?? '',
          windowTitle: folder?.windowTargetWindowTitle ?? '',
          titleMatchMode: (folder?.windowTargetTitleMatchMode as 'contains' | 'regex') ?? 'contains',
          relativeCoordinates: folder?.useRelativeCoordinates ?? false,
          bringToFocus: folder?.bringToFocus ?? false,
          restorePosition: folder?.restorePosition ?? false,
          restoreSize: folder?.restoreSize ?? false,
        };
        // Members that read their X/Y in the space this folder sets — the ones with no target of
        // their own. The dialog warns before a Relative Coordinates flip reinterprets them.
        const inheritingMemberCount = (folder?.items ?? [])
          .filter(n => { const p = profileMap.get(n); return !!p && !p.hasWindowTarget; }).length;
        return (
          <TargetConfigDialog
            scope="folder"
            targetLabel={folderName}
            hasOwnTarget={hasOwnTarget}
            initial={initial}
            inheritingMemberCount={inheritingMemberCount}
            onSubmit={(payload) => {
              send({
                type: 'profile:setFolderWindowTarget',
                payload: {
                  folderName,
                  processName: payload.processName,
                  windowTitle: payload.windowTitle,
                  titleMatchMode: payload.titleMatchMode,
                  relativeCoordinates: payload.relativeCoordinates,
                  bringToFocus: payload.bringToFocus,
                  restorePosition: payload.restorePosition,
                  restoreSize: payload.restoreSize,
                },
              });
              setShowFolderTargetDialog(null);
            }}
            onRemove={() => {
              // Route through the handler (not a bare send) so this path also gets
              // the 10s undo toast, matching the profile-target dialog's onRemove.
              handleRemoveFolderWindowTarget(folderName);
              setShowFolderTargetDialog(null);
            }}
            onCancel={() => setShowFolderTargetDialog(null)}
            onUpdateGeometry={(fields) => send({
              type: 'profile:updateWindowSize',
              payload: {
                folderName,
                processName: fields.processName || undefined,
                windowTitle: fields.windowTitle || undefined,
                titleMatchMode: fields.titleMatchMode,
              },
            })}
          />
        );
      })()}

      {/* Floating drag ghost — shared by profile drag and folder drag. Centred on
          the cursor with the same lifted-card treatment (tilt, shadow, translucency)
          as the ActionTable's dnd-kit DragOverlay, so both panels speak the same
          drag language. transform-based positioning keeps it on the compositor. */}
      {dragCursorPos !== null && (dragProfile || dragFolder) && (
        <div
          className="fixed pointer-events-none z-50"
          style={{
            top: 0,
            left: 0,
            // dragCursorPos is already in LAYOUT space — converted where it is captured, so
            // this runs no measurement on a path that re-renders on every mousemove. The
            // percentage translate is unaffected: it resolves against the ghost's own size.
            transform: `translate3d(${dragCursorPos.x}px, ${dragCursorPos.y}px, 0) translate(-50%, -50%) rotate(1.5deg)`,
            willChange: 'transform',
          }}
        >
          <div
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-bg-card border border-border-default text-caption font-medium text-text-primary"
            style={{
              opacity: 0.88,
              boxShadow: 'var(--shadow-overlay), 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent)',
            }}
          >
            {dragFolder ? <FolderOpen size={12} className="text-accent shrink-0" /> : <FilePlus size={12} className="text-accent shrink-0" />}
            {dragFolder ?? dragProfile}
          </div>
        </div>
      )}

      {/* ── Sharing-metadata dialogs ──
          Mounted at the panel root so the modal backdrop fills the whole window.
          Render order matters: security warning sits ABOVE the preview when both
          would render (the warning blocks the preview anyway because we don't set
          importPreview until the warning is dismissed). */}
      {securityWarningOpen && (
        <SecurityWarningModal
          fileName={pendingPreview?.fileName}
          profileCount={pendingPreview?.profiles.length}
          onContinue={handleSecurityContinue}
          onCancel={handleSecurityCancel}
        />
      )}
      {importResult && (
        <ImportResultDialog
          result={importResult}
          onClose={() => setImportResult(null)}
        />
      )}
      {importPreview && !securityWarningOpen && (
        <ImportPreviewDialog
          preview={importPreview}
          onConfirm={handlePreviewConfirm}
          onCancel={handlePreviewCancel}
        />
      )}
      {showInfoDialog && (
        <Suspense fallback={null}>
          <ProfileInfoDialog
            profileName={showInfoDialog}
            onClose={() => setShowInfoDialog(null)}
          />
        </Suspense>
      )}
    </>
  );
}
