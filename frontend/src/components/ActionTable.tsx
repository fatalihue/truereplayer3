import { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo, Fragment, lazy, Suspense } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, closestCenter, pointerWithin } from '@dnd-kit/core';
import type { CollisionDetection, DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { snapCenterToCursor } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { Mouse, MousePointerClick, MousePointer2, Keyboard, ArrowUp, ArrowDown, Zap, Type, Trash2, ChevronRight, ChevronDown, ChevronsDownUp, ChevronsUpDown, Plus, Pencil, ScanSearch, Pipette, Globe, CheckCheck, Check, Code2, Files, Hourglass, Repeat2, ExternalLink, Crosshair, Link, GripVertical, Timer, GitBranch, ArrowRightLeft, Combine, Split, Brackets, MoreHorizontal, Focus, Braces, AppWindow, Clipboard, ClipboardCopy, ClipboardPaste, Eye, EyeOff, RotateCcw, Dice5, Cpu, FileCheck, Clock, ShieldCheck, CircleStop, CornerDownLeft, IterationCw, ChevronUp, ArrowRightFromLine, SkipForward, Table2 } from 'lucide-react';
import { canCollapse, canExpand, expandKeystroke } from '../utils/keyRepeat';
import type { ActionItem, OutgoingMessage } from '../bridge/messageTypes';
import { useAppState } from '../state/AppStateContext';
import { ReplayRowMarker } from './ReplayRowMarker';
import { InsertedRowMarker } from './InsertedRowMarker';
import { useBridge } from '../bridge/BridgeContext';
import { useTt, useLanguage } from '../state/LanguageContext';
import type { Language } from '../state/LanguageContext';
import { useSelectionRef } from '../state/SelectionContext';
import { useToast } from '../state/ToastContext';
import { useEditorClaim } from '../hooks/useEditorClaim';
import { getDisplayKey, getDisplayX, getDisplayY, getActionTypeColors, formatKeyCombo, formatMs, isCombinedClick, isClickHold, isCoordinateClick, isFocusClickEligible, CLICK_FAMILY_TYPES, clickFormOf } from '../utils/displayUtils';
import { snapIndicesToBlocks, hasConditionFields, skippedRowMask, isStructuralRow, armBodyEnd } from '../utils/conditionalBlocks';
import { uiZoom } from '../utils/zoomSpace';
import { tryParseInt32 } from '../utils/int32';
import { parseCoordPair } from '../utils/coordPair';
import { useSingleKeyCapture } from '../hooks/useSingleKeyCapture';
// Deferred: already rendered conditionally, but a static import pulls the whole Lexical editor
// stack and emoji-picker-react (~300 KB minified) into the startup chunk for a dialog most sessions
// never open. Splitting at the DIALOG boundary and not on emoji-picker-react itself is deliberate —
// SendTextDialog uses that package's Theme/EmojiStyle enums as runtime VALUES, so importing those
// statically would keep the package in the entry chunk anyway.
const SendTextDialog = lazy(() => import('./SendTextDialog').then(m => ({ default: m.SendTextDialog })));
import { SendTextPreview } from './SendTextPreview';
import { sendTextDeliveryBadge } from './lexical/deliveryBadge';
import type { SendMode, SendMethod } from '../utils/sendTextTypes';
import { RunProfileDialog } from './RunProfileDialog';
import { KeystrokeCaptureDialog } from './KeystrokeCaptureDialog';
import { PauseDialog } from './PauseDialog';
import { BulkActionBar } from './BulkActionBar';
import { MacroEmptyState } from './MacroEmptyState';
import { Checkbox, CheckboxBox } from './Checkbox';
import type { ColumnVisibility } from './Toolbar';
import { useFlyoutFlip } from '../hooks/useFlyoutFlip';
import { useContextMenuPosition } from '../hooks/useContextMenuPosition';

// ELSE / ENDIF are pure jump markers with NO delay — the grid hides their Delay cell, the validator
// keeps it 0, and bulk "set delay" skips them. The opening IF is deliberately NOT here: it runs a
// probe, so its delay is a meaningful "wait for the condition to settle before checking" knob
// (applied before the probe in the engine) and is editable like any other action's delay.
// Pure jump markers with no replay delay (the load-time validator zeroes them). The
// opening If, the ElseIf arms and the While are NOT here — their delay is the pre-probe settle knob (per
// iteration on a While).
const NO_DELAY_TYPES = new Set(['Else', 'EndIf', 'EndLoop', 'BreakLoop', 'ContinueLoop', 'ForEachRow']);

// The condition families a BRANCH ARM can use — the same ten the toolbar's Conditional ▾
// offers, in the same order and with the same glyphs, so the two entry points can never drift
// on which conditions exist or read differently for the same family. ImageFound and
// PixelColorMatch route through the capture-first overlay on the backend (cancel = zero rows).
const BRANCH_CONDITION_FAMILIES = [
  { ct: 'ImageFound', Icon: ScanSearch, label: 'Image Found' },
  { ct: 'PixelColorMatch', Icon: Pipette, label: 'Pixel Color Match' },
  { ct: 'WindowOpen', Icon: AppWindow, label: 'Window Open' },
  { ct: 'ClipboardMatch', Icon: Clipboard, label: 'Clipboard' },
  { ct: 'BrowserElementState', Icon: Globe, label: 'Browser Element' },
  { ct: 'Random', Icon: Dice5, label: 'Random' },
  { ct: 'Variable', Icon: Braces, label: 'Variable' },
  { ct: 'ProcessRunning', Icon: Cpu, label: 'Process Running' },
  { ct: 'FileExists', Icon: FileCheck, label: 'File Exists' },
  { ct: 'TimeWindow', Icon: Clock, label: 'Time' },
] as const;

// Per-nesting-level colour ("rainbow brackets") so a nested block reads apart from its parent.
// Level 0 keeps the user's configurable IF colour, so a single-level block looks exactly as before;
// deeper levels cycle a fixed, distinct palette (defaults in index.css :root → always resolve, no
// hard-coded hex here). Used for the scope rails (full strength) and the row wash (low opacity).
const BLOCK_LEVEL_COLORS = [
  'var(--color-action-if-fg)',
  'var(--color-block-1)',
  'var(--color-block-2)',
  'var(--color-block-3)',
  'var(--color-block-4)',
];
// Cycle by level; the double-mod keeps it safe for any (even negative) input.
const blockColor = (level: number): string =>
  BLOCK_LEVEL_COLORS[((level % BLOCK_LEVEL_COLORS.length) + BLOCK_LEVEL_COLORS.length) % BLOCK_LEVEL_COLORS.length];

// BLOCK_OPENERS / STRUCTURAL_TYPES lived here for the row menu's "Go to <pair>" and went with it
// on 2026-09-16. Select block, which replaced it, needs neither: it asks conditionalBlocks'
// isStructuralRow and then hands the row to snapSelectionToBlocks, which already knows how to
// walk from ANY marker to its block's two ends. One copy of that knowledge, in the pure module.

export function ActionIcon({ actionType, size = 12 }: { actionType: string; size?: number }) {
  // ShieldCheck (verify-or-fail) before the generic Browser→Globe so Assert reads distinctly.
  if (actionType === 'BrowserAssert') return <ShieldCheck size={size} />;
  // Desktop Assert: the same shield, filled — it states a requirement rather than checking a page.
  if (actionType === 'Assert') return <ShieldCheck size={size} />;
  if (actionType.startsWith('Browser')) return <Globe size={size} />;
  // Before the generic Click→Mouse, for the reason spelled out for HoldKey below: the
  // stopwatch says "timed", and the row keeps its mouse identity through the pill COLOUR
  // (computeActionTypeColors matches any *Click*). Key hold and mouse hold therefore read
  // the same way — family hue, stopwatch glyph.
  if (isClickHold(actionType)) return <Timer size={size} />;
  if (actionType.includes('Click')) return <Mouse size={size} />;
  if (actionType === 'ScrollUp') return <ArrowUp size={size} />;
  if (actionType === 'ScrollDown') return <ArrowDown size={size} />;
  // HoldKey uses Timer (stopwatch) instead of Keyboard so it reads at a glance as
  // "this is a timed key" — matches the dialog/menu/palette icon for the same action.
  if (actionType === 'HoldKey') return <Timer size={size} />;
  if (actionType.startsWith('Key')) return <Keyboard size={size} />;
  if (actionType === 'SendText') return <Type size={size} />;
  // Braces {} — reads as "variable / interpolation", matching the {var:name}
  // token syntax used to read the value back. Clearer than the old Variable glyph.
  if (actionType === 'SetVariable') return <Braces size={size} />;
  // ClipboardCopy — "copy into a clipboard slot"; pairs visually with SetVariable's
  // Braces (both are run-state writers read back via {…} tokens).
  if (actionType === 'CopyToSlot') return <ClipboardCopy size={size} />;
  if (actionType === 'WaitImage') return <ScanSearch size={size} />;
  if (actionType === 'WaitPixelColor') return <Pipette size={size} />;
  // Match the toolbar's redesigned icons so the chip in the table reads the same
  // as the entry that inserts the action: Hourglass (not Pause-glyph) for the
  // delay action, Repeat2 (not Workflow) for sub-macro calls.
  if (actionType === 'RunProfile') return <Repeat2 size={size} />;
  // AppWindow — same glyph the If-Window condition chip uses, so "window-ish"
  // rows share one visual identity across the grid.
  if (actionType === 'ActivateWindow') return <AppWindow size={size} />;
  if (actionType === 'Pause') return <Hourglass size={size} />;
  // Conditional logic — GitBranch is the universal "branch / decision" glyph and
  // matches the toolbar's + If button. Else uses the two-way swap arrows; EndIf
  // closes the block with a ChevronDown.
  if (actionType === 'If') return <GitBranch size={size} />;
  // ElseIf continues the branch, so it reads as a SPLIT (another fork) rather than the
  // two-way swap Else uses -- the glyph says "one more question", not "the other path".
  if (actionType === 'ElseIf') return <Split size={size} />;
  if (actionType === 'Else') return <ArrowRightLeft size={size} />;
  if (actionType === 'EndIf') return <ChevronDown size={size} />;
  // Flow leaves — same glyphs as the Assert ▾ menu entries that insert them, per the
  // "chip reads the same as the entry that inserts it" rule above.
  if (actionType === 'Stop') return <CircleStop size={size} />;
  if (actionType === 'Return') return <CornerDownLeft size={size} />;
  // Loop family — IterationCw matches the Loop ▾ trigger; EndLoop closes upward (the
  // back edge), Break exits rightward, Next skips forward, ForEachRow is the table.
  if (actionType === 'While') return <IterationCw size={size} />;
  if (actionType === 'EndLoop') return <ChevronUp size={size} />;
  if (actionType === 'BreakLoop') return <ArrowRightFromLine size={size} />;
  if (actionType === 'ContinueLoop') return <SkipForward size={size} />;
  if (actionType === 'ForEachRow') return <Table2 size={size} />;
  return <Zap size={size} />;
}

interface EditingCell {
  index: number;
  // The row's Id when the editor opened. Every editor commit sends it next to the index, and
  // the backend refuses the write when the index now holds a different row. '' when the row has
  // none (ActionItem.id is optional) — the backend then skips the check.
  id: string;
  // 'coords' edits the merged "x, y" pair in the Details column — committed as ONE
  // actions:editMany (field x, field y), so it is one undo entry.
  field: 'delay' | 'comment' | 'coords' | 'key';
}

// Pointer sensor that refuses to start a drag from interactive elements —
// inline editors, checkboxes, chip buttons, selects. Combined with the 8 px
// activation distance this keeps single-click-to-edit fully functional: a
// plain click never becomes a drag, and selecting text inside an inline
// editor never moves rows.
// Pointer-first collision detection: "over" is the row under the CURSOR, not
// the row nearest the (chip-sized, offset) DragOverlay rect — closestCenter on
// the overlay drifted the target a couple of rows ahead of where the user was
// pointing. Falls back to closestCenter when the pointer sits outside every
// row (e.g. in the empty area below a short list).
const pointerFirstCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

class RowPointerSensor extends PointerSensor {
  static activators = [{
    eventName: 'onPointerDown' as const,
    handler: ({ nativeEvent }: { nativeEvent: PointerEvent }) => {
      if (nativeEvent.button !== 0) return false;
      const target = nativeEvent.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [contenteditable="true"]')) return false;
      return true;
    },
  }];
}

// Render-prop shell: gives each <tr> its useSortable wiring (hooks can't be
// called inside actions.map directly) while keeping the large row JSX in
// ActionTable's own lexical scope — extracting the whole row into a component
// would mean threading 30+ closure values through props.
function SortableRowShell({ id, disabled, children }: {
  id: string;
  disabled: boolean;
  children: (s: ReturnType<typeof useSortable>) => React.ReactNode;
}) {
  const sortable = useSortable({ id, disabled });
  return <>{children(sortable)}</>;
}

// Friendly pill label — shared between the grid's Action pill and the floating
// drag ghost so the picked-up row reads identically to its in-grid sibling.
// Every explicit case is copied verbatim into ClipboardService.FriendlyActionType (C#), which
// labels the rows "Copy Actions" puts on the clipboard. A label changed here changes there too.
function actionPillLabel(action: ActionItem): string {
  switch (action.actionType) {
    case 'WaitImage': return 'Wait Image';
    case 'WaitPixelColor': return 'Pixel Color';
    // Browser labels carry "Element"/"Text" so they never read as the
    // desktop LeftClick/SendText pills — ambiguity fix (P2).
    case 'BrowserClick': return 'Click Element';
    case 'BrowserRightClick': return 'Right Click Element';
    case 'BrowserType': return 'Type Text';
    case 'BrowserSelectOption': return 'Select Option';
    case 'BrowserAssert': return 'Assert Element';
    case 'Assert': return 'Assert';
    case 'BrowserWaitElement': return 'Wait Element';
    case 'BrowserNavigate': return 'Open URL';
    // The one type whose raw enum name reached the grid as a label. Every other multi-word
    // action here is prose ("Set Variable", "Copy to Slot", "Double Click"), so "SendText" sat
    // in the same column reading like a symbol. The click/scroll/key families still fall
    // through to `default` by deliberate choice — spacing them is a separate, wider change.
    case 'SendText': return 'Send Text';
    case 'RunProfile': return 'Run Profile';
    case 'Pause': return 'Pause';
    case 'HoldKey': return 'Hold Key';
    case 'SetVariable': return 'Set Variable';
    case 'CopyToSlot': return 'Copy to Slot';
    case 'ActivateWindow': return 'Activate Window';
    case 'DoubleClick': return 'Double Click';
    case 'TripleClick': return 'Triple Click';
    // Prose, and the distinguishing word FIRST — "Hold" is what separates these rows from
    // the plain clicks they sit beside, and it echoes "Hold Key" above. The single clicks
    // still fall through to `default` (raw "LeftClick") by the deliberate choice noted
    // above; that is a wider change, and nothing here depends on matching them.
    case 'LeftClickHold': return 'Hold Left Click';
    case 'RightClickHold': return 'Hold Right Click';
    case 'MiddleClickHold': return 'Hold Middle Click';
    // Conditional labels are intentionally lowercase to read as "code keywords".
    // The IF pill is uniform ("if") regardless of probe family — the image-vs-pixel
    // distinction (and its payload) lives in the Details cell via ProbeDetails, so
    // the grid reads as a clean "if … endif" block.
    case 'If': return 'if';
    case 'ElseIf': return 'else if';
    case 'Else': return 'else';
    case 'EndIf': return 'endif';
    // Flow leaves share the keyword register: they are control flow, not gestures.
    case 'Stop': return 'stop';
    case 'Return': return 'return';
    // Loop family — same lowercase keyword register as the conditional block.
    case 'While': return 'while';
    case 'EndLoop': return 'end loop';
    case 'BreakLoop': return 'break';
    case 'ContinueLoop': return 'next';
    case 'ForEachRow': return 'each row';
    default: return action.actionType;
  }
}

// Whether a row is an image/pixel PROBE — the standalone Wait actions or a condition row
// (If/Else If/While/Assert) whose condition uses one of those probes. These share a unified
// Details payload (ProbeDetails) so an image probe looks the same whether it's a Wait, an If, a
// loop guard or an Assert. hasConditionFields, not carriesConditionProbe: an Assert on an image
// fell through BOTH Details branches (isConditionAction does not list the probe types either)
// and showed the bare file key instead of the thumbnail. The insert door refuses an image/pixel
// Assert today, but a hand-edited or imported profile can carry one.
function isProbeAction(action: ActionItem): boolean {
  return action.actionType === 'WaitImage'
    || action.actionType === 'WaitPixelColor'
    || (hasConditionFields(action.actionType)
      && (action.conditionType === 'ImageFound' || action.conditionType === 'PixelColorMatch'));
}

// The Details text of a row — ONE derivation for the grid row and the drag ghost. The ghost used
// to build its own, poorer one (coordinates for clicks, else the raw key), so every type whose
// payload does not live in `key` — Pause, Activate Window, If/While/Each Row, Set Variable —
// dragged as a bare pill, with nothing to tell two of them apart. `dataRows` is the live data
// table's row count (Each Row reads it).
function rowDisplayKey(action: ActionItem, dataRows: number): string {
  return action.actionType === 'WaitImage'
    ? ''
    : action.actionType === 'WaitPixelColor'
      // Standalone pixel-color wait mirrors the "if pixel" row: the hex
      // is the text, the swatch + coords render alongside it in the row.
      ? (action.pixelColor || '')
    : action.actionType === 'RunProfile'
      // ×N moved to the Action pill (see the pill render in the row) so the
      // Key column shows only the profile name and long names no longer
      // truncate the repeat-count badge out of view.
      ? action.key
      : action.actionType === 'Pause'
        ? (() => {
            // Timeout is stored in ms — show it as ms here (was seconds).
            const hasHotkey = !!action.key;
            const ms = action.timeout ?? 0;
            const hasTimeout = ms > 0;
            if (hasHotkey && hasTimeout) return `${action.key} / ${ms} ms`;
            if (hasHotkey) return action.key;
            if (hasTimeout) return `${ms} ms`;
            return '—';
          })()
        : (action.actionType === 'If' || action.actionType === 'ElseIf' || action.actionType === 'Assert')
          // If/Assert share the condition-identifier summary (Assert used to
          // fall through to getDisplayKey(key) and leak the raw selector).
          ? conditionSummary(action)
        : action.actionType === 'While'
          ? (() => {
              // Same condition summary as If, plus the iteration ceiling when
              // one is set — "the loop's shape" reads from the grid.
              const base = conditionSummary(action);
              const cap = action.loopMaxIterations && action.loopMaxIterations > 0
                ? `≤${action.loopMaxIterations}×` : '';
              return base && cap ? `${base} · ${cap}` : (base || cap);
            })()
        : action.actionType === 'ForEachRow'
          // LIVE row count — the Data panel edits while you look, and a stale
          // number here would misstate what the block will do.
          ? `${dataRows} row${dataRows === 1 ? '' : 's'}`
          : action.actionType === 'HoldKey'
            // Hold Key reads like Pause: "<key> / <ms> ms" as plain text in the
            // cell (no separate duration chip) so the two duration-bearing actions
            // share one format. Click-to-edit is handled by the <td> onClick below.
            ? `${getDisplayKey(action.key)} / ${action.holdDurationMs && action.holdDurationMs > 0 ? action.holdDurationMs : 1000} ms`
          : isClickHold(action.actionType)
            // Same "<n> ms" payload as Hold Key, WITHOUT a key prefix — a click
            // hold's subject is its point, and the point already has two columns
            // of its own. renderMsDetail styles the number below.
            ? `${action.holdDurationMs && action.holdDurationMs > 0 ? action.holdDurationMs : 1000} ms`
          : action.actionType === 'SetVariable'
            // "name = value" reads like the assignment it is; a fresh row
            // (no name yet) stays blank like an unconfigured WaitImage.
            // Cycle mode reads "name ⟳ N items" — the value is a list, not
            // one assignment, so showing line 1 would misrepresent it.
            ? (!action.key ? ''
              : action.variableMode === 'cycle'
                ? (() => {
                    const n = (action.variableValue ?? '').split('\n').filter(l => l.trim()).length;
                    return `${action.key} ⟳ ${n} item${n === 1 ? '' : 's'}`;
                  })()
              // Add mode reads "name += step" — the assignment it is NOT is "=".
              : action.variableMode === 'add'
                ? `${action.key} += ${action.variableValue ?? ''}`
                : `${action.key} = ${action.variableValue ?? ''}`)
          : action.actionType === 'CopyToSlot'
            // Show the read-back token — the one thing the user needs to reuse
            // the capture. Fresh row (no slot yet) stays blank like SetVariable.
            // Clear rows read "clear {clip:x}" / "clear all slots".
            ? (action.slotMode === 'clear'
                ? (!action.key ? 'clear all slots' : `clear {clip:${action.key.toLowerCase()}}`)
                : (!action.key ? '' : `selection → {clip:${action.key.toLowerCase()}}`))
          : action.actionType === 'ActivateWindow'
            // Matcher summary "proc · title" (— launch marks launch-capable
            // rows); pure-run rows read "run: <path>". Phase-3 verb prefix +
            // nth-match suffix. Mirrors C# DisplayKey.
            ? (() => {
                const matcher = [action.windowProcessName, action.windowTitle].filter(s => s && s.trim()).join(' · ');
                const verbPrefix = action.windowVerb === 'maximize' ? 'Maximize · '
                  : action.windowVerb === 'minimize' ? 'Minimize · '
                  : action.windowVerb === 'close' ? 'Close · ' : '';
                const nth = action.windowMatchIndex && action.windowMatchIndex > 1 ? ` #${action.windowMatchIndex}` : '';
                // Maximize launches on a miss too; only Minimize and Close never do.
                const launches = !!action.launchPath?.trim() && action.windowVerb !== 'minimize' && action.windowVerb !== 'close';
                if (matcher) return `${verbPrefix}${matcher}${nth}${launches ? ' — launch' : ''}`;
                return action.launchPath ? `run: ${action.launchPath}` : '';
              })()
          : action.actionType === 'Keystroke'
            // Combined keystrokes read as spaced combos ("Ctrl + Alt + F"),
            // matching the ProfilePanel hotkey chips. Single keys are
            // unchanged (no separator to space).
            ? formatKeyCombo(action.key)
          : getDisplayKey(action.key);
}

// The While iteration ceiling as a quiet suffix beside whatever Details payload the row
// renders. ProbeDetails/ConditionDetails WIN the cell for condition-bearing rows, so the
// ceiling rides along here — the displayKey path (which also appends it) is only reached
// by While rows whose condition family carries no Details payload.
function whileCapSuffix(action: ActionItem): ReactNode {
  if (action.actionType !== 'While' || !action.loopMaxIterations || action.loopMaxIterations <= 0) return null;
  return <span className="ml-1.5 text-[10px] text-text-tertiary align-middle">≤{action.loopMaxIterations}×</span>;
}

// The condition's primary identifier for the grid cell — shared by If, While and Assert
// (all three carry the same ConditionType payload). Mirrors the C# DisplayKey getter so a
// backend push and a frontend re-render produce the same string. Color swatch / NOT badge
// are rendered separately as DOM nodes (they're not plain text). State families that carry
// their value in ConditionDetails (Variable, Process, File, Time, Random) return '' here.
function conditionSummary(action: ActionItem): string {
  if (action.conditionType === 'ImageFound') {
    const p = action.imagePath || '';
    if (!p) return '';
    const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return cut >= 0 ? p.slice(cut + 1) : p;
  }
  if (action.conditionType === 'PixelColorMatch') return action.pixelColor || '';
  if (action.conditionType === 'WindowOpen') {
    const proc = action.windowProcessName || '';
    const title = action.windowTitle || '';
    return proc && title ? `${proc} · ${title}` : (proc || title);
  }
  if (action.conditionType === 'ClipboardMatch') return action.clipboardPattern || '';
  if (action.conditionType === 'BrowserElementState') return action.key || '';
  return '';
}

// Render a Details string, styling any "<n> ms" run to MATCH the Delay column:
// the integer picks up locale thousands separators (30000 → "30.000") and the unit
// shrinks to the quiet tertiary "ms" suffix, while any prefix (a Pause hotkey or a
// HoldKey's key + " / ") stays in the cell's primary ink. Applied only to the
// duration-bearing detail types (Pause / HoldKey) whose displayKey embeds "<n> ms";
// the \b after ms avoids matching a stray digit-run that isn't actually a duration.
const MS_RUN = /(\d+)\s*ms\b/g;
function renderMsDetail(text: string, language: Language): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  let matched = false;
  MS_RUN.lastIndex = 0;
  while ((m = MS_RUN.exec(text)) !== null) {
    matched = true;
    if (m.index > last) {
      // The prefix ("F5 / " / "A / ") is a text run whose TRAILING space would be
      // collapsed at the inline-flex boundary, gluing the key to the number. A
      // non-breaking space (same advance width in the mono font) is never trimmed,
      // so the "key / value" gap always renders.
      out.push(text.slice(last, m.index).replace(/\s+$/, ' '));
    }
    out.push(
      <span key={i++} className="text-text-secondary tabular-nums">
        {formatMs(Number(m[1]), language)}
        <span className="text-[10px] text-text-tertiary ml-0.5">ms</span>
      </span>
    );
    last = m.index + m[0].length;
  }
  // No "<n> ms" run (e.g. a hotkey-only Pause, or the "—" placeholder): render the
  // string untouched so nothing about non-duration rows changes.
  if (!matched) return text;
  if (last < text.length) out.push(text.slice(last));
  // Wrap in ONE inline span. The Details cell's parent is inline-flex, so a bare
  // prefix text run ("F5 / ") would have its trailing space trimmed at the flex-
  // item boundary and glue to the number ("F5 /30.000ms"). Inside a single inline
  // span, normal inline layout keeps that separating space.
  return <span>{out}</span>;
}

// Standardized Details payload for the four probe rows. IMAGE → reference
// thumbnail (never the GUID filename); PIXEL → colour swatch + hex + x,y. IF rows
// additionally get a small type tag, since their pill is the generic "if"; Wait
// rows skip the tag because their own pill already names the type. (The NOT/IFNOT
// modifier and the image confidence % live elsewhere — the Action pill and the
// Sheet panel respectively — to keep this cell to just "what is matched".)
function ProbeDetails({ action }: { action: ActionItem }) {
  // While guards and Asserts carry the same probe payload as If and get the same type tag
  // (their pills are the generic "while" / "assert", so the tag says WHAT the row watches).
  // The same family isProbeAction admits — narrower here, an image Assert rendered as a pixel.
  const isIf = hasConditionFields(action.actionType);
  const isImage = action.actionType === 'WaitImage'
    || (isIf && action.conditionType === 'ImageFound');

  // align-middle sets the inline-flex baseline to the cell's vertical centre; the
  // -2px optical nudge then lands the thumbnail/icon exactly on the Action pill's
  // centre (without align-middle the image sat ~4px high).
  return (
    <span className="inline-flex items-center gap-1.5 align-middle translate-y-[-2px] text-xs min-w-0">
      {isIf && (
        <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] bg-bg-elevated text-text-secondary shrink-0">
          {isImage ? <ScanSearch size={10} /> : <Pipette size={10} />}
          {isImage ? 'image' : 'pixel'}
        </span>
      )}
      {isImage ? (
        <>
          {action.imageBase64 ? (
            <img
              src={`data:image/png;base64,${action.imageBase64}`}
              alt=""
              className="h-4 w-auto max-w-[48px] rounded-sm border border-border-default object-contain pointer-events-none shrink-0"
            />
          ) : (
            <ScanSearch size={13} className="text-text-tertiary shrink-0" />
          )}
        </>
      ) : (
        <>
          {action.pixelColor && (
            // No tooltip: the hex sits immediately to the right of this swatch.
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm border border-[color-mix(in_srgb,var(--color-text-primary)_20%,transparent)] shrink-0"
              style={{ background: action.pixelColor }}
            />
          )}
          <span className="font-mono text-text-secondary truncate">
            {action.pixelColor}
            {action.pixelX != null && action.pixelY != null ? ` · ${action.pixelX}, ${action.pixelY}` : ''}
          </span>
        </>
      )}
    </span>
  );
}

// The state-based If conditions (Window / Clipboard / Browser Element) added alongside
// image/pixel. They carry no thumbnail or swatch, so ProbeDetails doesn't apply — they get
// ConditionDetails below instead, which mirrors ProbeDetails' "type tag + value" shape so
// the grid reads which condition family a row is without opening the Sheet.
function isConditionAction(action: ActionItem): boolean {
  // Desktop Assert carries the same ConditionType payload as an If, so it reuses this exact
  // "type tag + value" summary — the grid then reads WHAT is being checked identically for
  // both, and only the Action pill says whether it branches or requires.
  return hasConditionFields(action.actionType)
    && (action.conditionType === 'WindowOpen'
      || action.conditionType === 'ClipboardMatch'
      || action.conditionType === 'BrowserElementState'
      || action.conditionType === 'Random'
      || action.conditionType === 'Variable'
      || action.conditionType === 'ProcessRunning'
      || action.conditionType === 'FileExists'
      || action.conditionType === 'TimeWindow');
}

// "Select Similar" (More ▸ in the row context menu) groups every row whose actionType AND
// this key match the right-clicked row. key/x/y alone — the old comparator — only identifies
// the plain click/keypress types; several action families keep their REAL identity in other
// fields entirely, and those fields are typically blank/zero across the board (a Wait Image
// row has no meaningful key/x/y), so comparing just key/x/y silently grouped every row of
// that family together: two Wait Image rows probing DIFFERENT reference screenshots, or two
// If-Window checks against different processes, all fell into one selection, and a bulk
// edit/delete aimed at one hit the other too. Dispatches the same way isProbeAction /
// isConditionAction above do (actionType, then conditionType for If/Assert) so every probe/
// condition family stays in sync with those; the string prefixes keep the sub-families apart
// since actionType alone doesn't distinguish them (an If-ImageFound and an If-ClipboardMatch
// share actionType 'If').
function similarActionKey(action: ActionItem): string {
  const conditionType = hasConditionFields(action.actionType) ? action.conditionType : null;
  if (action.actionType === 'WaitImage' || conditionType === 'ImageFound') {
    return `image:${action.imagePath ?? ''}`;
  }
  if (action.actionType === 'WaitPixelColor' || conditionType === 'PixelColorMatch') {
    return `pixel:${action.pixelX ?? ''}:${action.pixelY ?? ''}:${action.pixelColor ?? ''}`;
  }
  // ActivateWindow, If/Assert-WindowOpen and If/Assert-ProcessRunning all key off the same
  // windowProcessName field (ConditionDetails above reads ProcessRunning's value from it too)
  // — windowTitle is simply blank for ProcessRunning rows, which still compares fine.
  if (action.actionType === 'ActivateWindow' || conditionType === 'WindowOpen' || conditionType === 'ProcessRunning') {
    return `window:${action.windowProcessName ?? ''}:${action.windowTitle ?? ''}`;
  }
  if (conditionType === 'ClipboardMatch') {
    return `clipboard:${action.clipboardPattern ?? ''}`;
  }
  // Every other action type — combined clicks, keys, SendText, RunProfile, etc. — is still
  // identified by key/x/y, exactly as before this fix.
  return `default:${action.key}:${action.x}:${action.y}`;
}

// Compact "Mon–Fri 09:00–17:00" style label for an If-Time row (mirrors the C#
// DisplayKey). Days bitmask Sun=1<<0 … Sat=1<<6; 0/all = every day (blank).
function formatTimeWindow(action: ActionItem): string {
  const mask = (action.daysOfWeek ?? 0) & 0x7F;
  let days = '';
  if (mask !== 0 && mask !== 0x7F) {
    if (mask === 0b0111110) days = 'Mon–Fri';
    else if (mask === 0b1000001) days = 'Sat–Sun';
    else days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].filter((_, d) => (mask & (1 << d)) !== 0).join(',');
  }
  const time = action.timeStart && action.timeEnd ? `${action.timeStart}–${action.timeEnd}` : '';
  return [days, time].filter(Boolean).join(' ');
}

// Details payload for the state-based If conditions: an icon + short family label
// (same chip style as ProbeDetails' image/pixel tag) followed by the matched value.
// Icons match the toolbar's Insert-Conditional menu.
function ConditionDetails({ action }: { action: ActionItem }) {
  const meta =
    action.conditionType === 'WindowOpen'
      ? {
          Icon: AppWindow,
          label: 'window',
          value: (() => {
            const p = action.windowProcessName || '';
            const t = action.windowTitle || '';
            return p && t ? `${p} · ${t}` : p || t;
          })(),
        }
      : action.conditionType === 'ClipboardMatch'
        ? { Icon: Clipboard, label: 'clipboard', value: action.clipboardPattern || '' }
      : action.conditionType === 'Random'
        ? { Icon: Dice5, label: 'random', value: `${action.randomPercent ?? 0}%` }
      : action.conditionType === 'Variable'
        ? {
            Icon: Braces,
            label: 'variable',
            value: action.key
              ? `${action.key} ${({ neq: '≠', contains: 'has', gt: '>', lt: '<' } as Record<string, string>)[action.conditionOperator ?? 'eq'] ?? '='} ${action.conditionOperand ?? ''}`
              : '',
          }
      : action.conditionType === 'ProcessRunning'
        ? { Icon: Cpu, label: 'process', value: action.windowProcessName || '' }
      : action.conditionType === 'FileExists'
        ? { Icon: FileCheck, label: 'file', value: action.filePath || '' }
      : action.conditionType === 'TimeWindow'
        ? { Icon: Clock, label: 'time', value: formatTimeWindow(action) }
        : { Icon: Globe, label: 'element', value: action.key || '' };
  const { Icon, label, value } = meta;
  return (
    <span className="inline-flex items-center gap-1.5 align-middle translate-y-[-2px] text-xs min-w-0">
      <span className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] bg-bg-elevated text-text-secondary shrink-0">
        <Icon size={10} />
        {label}
      </span>
      {value && (
        // max-width caps the value so a long selector truncates INSIDE the 280px Details
        // column instead of forcing the cell wider (bare `truncate` needs a bounded width to
        // engage). ~190px = column minus the type chip; matches the displayKey max-w pattern.
        // data-tip-reveal: the tip IS this text, so it only shows when the column clipped it.
        <span className="font-mono text-text-secondary truncate max-w-[190px]" data-tip={value} data-tip-reveal>
          {value}
        </span>
      )}
    </span>
  );
}

interface ActionTableProps {
  columnVisibility: ColumnVisibility;
  // The toggle UI lives in Toolbar now (the grid no longer wastes a 24 px column
  // on a single icon). App still drives the visibility state and passes it down
  // here read-only; the mutator goes to Toolbar instead. ActionTable consumes
  // only the current visibility map.
  onOpenSheet?: (index: number) => void;
  // Context-menu "Pick from screen": App owns the pick round-trip (request, reply,
  // sheet-open-with-seed) because the sheet's own correlation is disarmed on open.
  // This table only says WHICH row asked.
  onPickCoords?: (index: number) => void;
  // The row open in the SheetPanel (null = closed). Its block's rail stays lit while the editor
  // is open — the "bracket match at the caret" — so editing inside a long block keeps its context.
  editorIndex?: number | null;
}

export function ActionTable({ columnVisibility, onOpenSheet, onPickCoords, editorIndex = null }: ActionTableProps) {
  // pauseState is not read here any more: its only use was the paused-here row treatment,
  // which needs the replay index to be meaningful — both now live in ReplayRowMarker.
  const { actions, buttonStates, activeProfile, dataTable } = useAppState();
  // The replay highlight is deliberately NOT read here. It advances once per executed action,
  // and this grid is an inline actions.map() with no memo boundary, so subscribing to it made
  // every push re-render all ~2300 grid nodes (19.5 ms median at 87 rows) to change three of
  // them. ReplayRowMarker owns it instead: it marks the row with data-replay and index.css
  // paints it, at a cost that no longer scales with row count.
  const { send } = useBridge();
  const tt = useTt();
  const { language } = useLanguage();
  const selectionRef = useSelectionRef();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  // When the pointer went down on an editable Details span (coords / KeyDown-KeyUp key). A press
  // held past LONG_PRESS_MS without moving was someone about to drag who changed their mind —
  // the release must not then open an editor under them.
  const spanPressAtRef = useRef(0);
  const lastClickedIndex = useRef<number | null>(null);
  const prevActionsLength = useRef(actions.length);
  const prevProfileRef = useRef(activeProfile);
  const wasRecording = useRef(false);
  // Every row editor below carries its row's Id beside the index — see EditingCell.id.
  const [sendTextEdit, setSendTextEdit] = useState<{ index: number; id: string; text: string; html?: string | null; mode?: SendMode; method?: SendMethod; charDelayMs?: number | null } | null>(null);
  const [runProfileEdit, setRunProfileEdit] = useState<{ index: number; id: string; profileName: string; repeatCount: number; runOverData: boolean } | null>(null);
  // Editing a Keystroke OR HoldKey row reopens the unified KeystrokeCaptureDialog —
  // these two ActionTypes share the same edit surface now that Press/Hold is a mode
  // toggle inside the dialog. `index` is all we need; the dialog reads the row's
  // ActionType + key + duration / repeat fields directly from the action item to
  // pick the starting mode.
  const [keystrokeEdit, setKeystrokeEdit] = useState<{ index: number; id: string } | null>(null);
  // Editing a Pause row reopens the PauseDialog (the same config-first window used
  // to insert one) instead of the generic Sheet — the capture pad + timeout presets
  // are a far better fit than the Sheet's flat field list. `index` is all we need;
  // the dialog seeds its pad/timeout from the row's key + timeout.
  const [pauseEdit, setPauseEdit] = useState<{ index: number; id: string } | null>(null);
  const [dragIndices, setDragIndices] = useState<number[] | null>(null);
  // Derived Set for O(1) membership checks inside the per-row render. The dragIndices
  // array stays as-is so the rest of the file (drag-preview chip, count display, payload
  // sent to the bridge) keeps using ordered access. Only the hot-path includes() lookups
  // in the actions.map switch to has() — drag of 100+ selected rows in a 1000-row table
  // was doing 200k Array.includes() per re-render before this.
  const dragIndexSet = useMemo(
    () => dragIndices ? new Set(dragIndices) : null,
    [dragIndices]
  );
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  // Bracket-match probe. Hovering a STRUCTURAL marker lights its whole block span — the rail at
  // that block's own nesting level runs full strength from opener to closer and the rows in
  // between take a wash: the affordance a code editor gives when the caret touches a brace.
  // Since 2026-09-05 (B1) it is no state at all: a delegated mouseover on the tbody toggles a
  // data-lit attribute on the rails of the block under the pointer — any row of it, body rows
  // included — and CSS does the rest (see .block-rail). The old probe was wired to structural
  // rows' mouseenter because a handler on every row re-rendered the grid on each move; with the
  // DOM toggled directly there is nothing to re-render. See litBlock / handleRailHover below.

  // ── Conditional logic block map ────────────────────────────────────
  // Single-pass O(n) walk over the action list produces 4 parallel structures used
  // by every per-row decision below (rails, indentation, structural bg tint, skip
  // propagation, "+ Add Else" ghost-row injection):
  //   depth[i]      — nesting level of row i. Top-level IF / Else / EndIf are 0;
  //                   their direct body rows are 1; a nested IF is 1 (the row that
  //                   opens depth 2 for its own body), etc.
  //   blockIfOf[i]  — index of the IF that contains row i. Self-references on IF
  //                   rows. null on top-level non-conditional rows.
  //   endIfOf       — IF index → matching ENDIF index. Used to detect "ENDIF without
  //                   ELSE between" so we can render the inline ghost button.
  //   hasElse       — Set of IF indices that already have an ELSE in their block.
  //                   Drives whether the ghost button renders.
  //
  // Orphan ELSE / ENDIF rows (stack empty at the time they're seen) get depth=0 and
  // a null blockIfOf — the load-time validator should have stripped them, but the
  // grid stays graceful if a hand-edited profile bypassed validation. Cost: ~32 B
  // per IF row in dictionary overhead, negligible at the action-counts users hit.
  // Rows the engine will not run — the Skip marks plus everything inside a skipped block, walked
  // transitively. Shared with the status bar's duration estimate so the grid and the number agree.
  const skippedMask = useMemo(() => skippedRowMask(actions), [actions]);

  const blockInfo = useMemo(() => {
    const n = actions.length;
    const depth = new Array<number>(n).fill(0);
    // blockOpenerOf (né blockIfOf): the containing block may now be a loop, so the name
    // says what it holds. TYPED stack: Else/EndIf only pair with an If on top, EndLoop
    // only with a loop opener — a crossed hand-edited pair can't mis-nest the rails.
    // Depth stays FAMILY-BLIND on purpose: rails encode nesting, not block kind.
    const blockOpenerOf = new Array<number | null>(n).fill(null);
    const closerOf = new Map<number, number>();
    const hasElse = new Set<number>();
    // ifIdx -> index of its TERMINAL Else, when it has one. The "+ Add Else If" affordance
    // anchors on this: a new arm must land BEFORE the Else (nothing after an unconditional
    // branch is reachable), so the ghost row renders above it rather than above the EndIf.
    const elseOf = new Map<number, number>();
    // railOpeners[i][level] — the opener whose rail is drawn at that level on row i (one entry
    // per rail the row renders). Rails carry it as data-rail-block so the lit states can find
    // every rail of one block with a single attribute query, whatever the row.
    const railOpeners = new Array<number[]>(n);
    const stack: { kind: 'If' | 'Loop'; idx: number }[] = [];
    const openersOnStack = () => stack.map(s => s.idx);
    for (let i = 0; i < n; i++) {
      const t = actions[i].actionType;
      if (t === 'If') {
        railOpeners[i] = [...openersOnStack(), i];
        stack.push({ kind: 'If', idx: i });
        depth[i] = stack.length - 1;
        blockOpenerOf[i] = i; // opener rows self-reference for skip propagation
      } else if (t === 'While' || t === 'ForEachRow') {
        railOpeners[i] = [...openersOnStack(), i];
        stack.push({ kind: 'Loop', idx: i });
        depth[i] = stack.length - 1;
        blockOpenerOf[i] = i;
      } else if (t === 'ElseIf') {
        // Another arm on the innermost open If. Like Else it PEEKS — never pushes, never
        // pops — so it renders at the depth of the block itself and the rails are unchanged.
        // Deliberately does NOT feed hasElse: that set means "this If already owns its
        // TERMINAL Else" and is what hides the "+ Add Else" button. An ElseIf must not hide
        // it, because a chain can still be closed off with a plain Else afterwards.
        if (stack.length && stack[stack.length - 1].kind === 'If') {
          const ifIdx = stack[stack.length - 1].idx;
          depth[i] = stack.length - 1;
          blockOpenerOf[i] = ifIdx;
          railOpeners[i] = openersOnStack();
        } else railOpeners[i] = [i]; // orphan: its single rail answers to nobody but itself
      } else if (t === 'Else') {
        if (stack.length && stack[stack.length - 1].kind === 'If') {
          const ifIdx = stack[stack.length - 1].idx;
          depth[i] = stack.length - 1;
          blockOpenerOf[i] = ifIdx;
          hasElse.add(ifIdx);
          elseOf.set(ifIdx, i);
          railOpeners[i] = openersOnStack();
        } else railOpeners[i] = [i];
      } else if (t === 'EndIf') {
        if (stack.length && stack[stack.length - 1].kind === 'If') {
          const ifIdx = stack[stack.length - 1].idx;
          depth[i] = stack.length - 1;
          blockOpenerOf[i] = ifIdx;
          closerOf.set(ifIdx, i);
          railOpeners[i] = openersOnStack();
          stack.pop();
        } else railOpeners[i] = [i];
      } else if (t === 'EndLoop') {
        if (stack.length && stack[stack.length - 1].kind === 'Loop') {
          const openIdx = stack[stack.length - 1].idx;
          depth[i] = stack.length - 1;
          blockOpenerOf[i] = openIdx;
          closerOf.set(openIdx, i);
          railOpeners[i] = openersOnStack();
          stack.pop();
        } else railOpeners[i] = [i];
      } else {
        // Non-structural body row — depth equals the number of currently-open blocks,
        // and the containing block is the innermost open opener (top of stack).
        depth[i] = stack.length;
        if (stack.length) blockOpenerOf[i] = stack[stack.length - 1].idx;
        railOpeners[i] = openersOnStack();
      }
    }
    return { depth, blockOpenerOf, closerOf, hasElse, elseOf, railOpeners };
  }, [actions]);

  // ── Bracket-match lighting: attribute + CSS, no React state ──
  // Every rail carries data-rail-block=<opener index>; every row (ghost rows included) carries
  // data-block-open=<the block it belongs to>. Lighting a block is one attribute query on the
  // tbody, so the pointer crossing rows costs no render. Two independent channels:
  //   data-lit      — the block under the pointer (cleared when it leaves the tbody / on drag)
  //   data-lit-sel  — the block of the row open in the SheetPanel, else of a single selected row
  // React never writes these attributes (they are not in the JSX), so a re-render leaves them be.
  const litBlockRef = useRef<string | null>(null);
  const setLitBlock = useCallback((open: string | null, attr: 'data-lit' | 'data-lit-sel', ref: { current: string | null }) => {
    if (ref.current === open) return;
    const tb = tbodyRef.current;
    if (!tb) return;
    if (ref.current !== null) tb.querySelectorAll(`[${attr}]`).forEach(el => el.removeAttribute(attr));
    ref.current = open;
    if (open !== null) tb.querySelectorAll(`[data-rail-block="${open}"]`).forEach(el => el.setAttribute(attr, ''));
  }, []);
  // Suppressed during a row drag: dnd-kit moves rows under a stationary pointer, so the lit span
  // would strobe across whatever slid beneath it.
  const dragIndicesRef = useRef(dragIndices);
  dragIndicesRef.current = dragIndices;
  const handleRailHover = useCallback((e: React.MouseEvent<HTMLTableSectionElement>) => {
    if (dragIndicesRef.current !== null) return;
    const tr = (e.target as Element).closest?.('tr');
    setLitBlock(tr?.getAttribute('data-block-open') ?? null, 'data-lit', litBlockRef);
  }, [setLitBlock]);
  const clearRailHover = useCallback(() => setLitBlock(null, 'data-lit', litBlockRef), [setLitBlock]);
  useEffect(() => { if (dragIndices !== null) setLitBlock(null, 'data-lit', litBlockRef); }, [dragIndices, setLitBlock]);
  // Indices address the list as it was when the pointer entered; a delete, reorder or undo would
  // leave the wrong rails lit until the pointer happens to move.
  useEffect(() => { setLitBlock(null, 'data-lit', litBlockRef); }, [actions, setLitBlock]);
  // Persistent channel (B2): the row open in the editor wins; else a lone selected row. Runs after
  // every commit (no deps on purpose: a row that re-mounts must get its attribute back) — the
  // early return in setLitBlock makes the unchanged case a string compare.
  const litSelRef = useRef<string | null>(null);
  const editorRow = editorIndex ?? null;
  // Drop the marks whenever the LIST changes, before the persistent effect below re-applies them.
  // Without this, the early return in setLitBlock ("same opener, nothing to do") skipped the
  // re-apply after an insert/duplicate/paste, so the new row's rails never got the attribute and
  // the 3 px bracket had a gap; and a row dragged OUT of the block kept a mark that now lights a
  // block it no longer belongs to. Declared BEFORE the persistent effect so both run in the same
  // commit with no paint in between — no flicker.
  useEffect(() => { setLitBlock(null, 'data-lit-sel', litSelRef); }, [actions, setLitBlock]);
  useEffect(() => {
    const row = editorRow !== null ? editorRow : selectedIndices.size === 1 ? [...selectedIndices][0] : null;
    const open = row !== null && row < actions.length ? blockInfo.blockOpenerOf[row] : null;
    setLitBlock(open === null || open === undefined ? null : String(open), 'data-lit-sel', litSelRef);
  });

  // Block-snap a selection ONLY when it includes a structural marker (If/Else/EndIf): a selection
  // touching a marker expands to whole IF…EndIf blocks so the marker can't be orphaned; a PURE
  // body-row selection is returned untouched, so deleting/moving plain actions inside a block stays
  // granular (removing body rows never unbalances the markers). Delegates to the shared pure
  // snapIndicesToBlocks so the grid and the Toolbar Alt+↑/↓ reorder handler use one source of truth.
  const snapSelectionToBlocks = useCallback(
    (sel: number[]): number[] => snapIndicesToBlocks(sel, actions),
    [actions],
  );

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowIndex: number } | null>(null);
  // "+ Add Else If" family picker — which IF the arm will join, and where to draw the menu.
  // x/y are VISUAL px (a getBoundingClientRect bottom-left) -- exactly what MenuAnchor wants.
  // useContextMenuPosition converts to LAYOUT once, on the way out; never pre-convert here.
  const [elseIfPicker, setElseIfPicker] = useState<{ x: number; y: number; ifRowIndex: number } | null>(null);
  const elseIfPickerRef = useRef<HTMLDivElement>(null);
  // 'more' is the drawer of rarities; 'clicktype' is the click-form picker, which sits at TOP
  // level in the type slot rather than inside More — it changes what the row DOES, which is the
  // line the whole menu is organised on. One state, so opening either closes the other.
  const [activeSubmenu, setActiveSubmenu] = useState<'more' | 'clicktype' | null>(null);
  // The "More ▸" submenu opens to the side; flip it left/up when the context menu sits
  // near the right/bottom edge so it isn't clipped. Measured on open by useFlyoutFlip,
  // which replaced an earlier right-edge-only heuristic computed in the menu-position pass.
  const moreFlyout = useFlyoutFlip(activeSubmenu === 'more', 'side');
  const clickTypeFlyout = useFlyoutFlip(activeSubmenu === 'clicktype', 'side');
  const contextMenuRef = useRef<HTMLDivElement>(null);
  // Two-pass off-screen-measure-then-reposition, shared with ProfilePanel's two menus
  // (declared after the ref it measures, which the hook reads). The hook owns the
  // position state, so closing the menu means clearing the anchor and nothing else —
  // the position follows on the same commit.
  const menuPos = useContextMenuPosition(contextMenu, contextMenuRef);
  // Same two-pass measure-and-clamp as the row context menu. It is what converts the chip rect
  // from VISUAL px (getBoundingClientRect) to the LAYOUT px an inline left/top needs -- writing
  // the raw rect would let the root CSS zoom multiply it a SECOND time (0.90 by default) -- and
  // what flips the 10-item menu up when it would otherwise paint past the viewport bottom, which
  // body overflow:hidden makes unreachable.
  const elseIfPickerPos = useContextMenuPosition(elseIfPicker, elseIfPickerRef);
  // Drives the RunProfile insert dialog. Opened by dragging a profile onto the grid
  // (the 'profiledrag:dropOnGrid' handler) — pre-filled with the dropped profile's name.
  const [runProfileInsert, setRunProfileInsert] = useState<{ insertIndex: number; profileName?: string } | null>(null);
  // Columns-toggle dropdown — moved here from the global Toolbar because columns
  // are a property of the grid, not a global preference. The dropdown opens
  // anchored to the header's right edge; click-outside closes it via the effect
  // below (mirrors the same pattern the Toolbar used).
  // Column-visibility STATE flows through props from App down to ActionTable; the
  // toggle UI (button + dropdown) moved to the Toolbar (see Toolbar.tsx) so the
  // grid no longer burns a dedicated 24 px column on a single icon. ActionTable
  // just consumes columnVisibility now and renders accordingly.
  const { showToast } = useToast();
  const contextMenuEnabled = !buttonStates.recordingActive && !buttonStates.replayActive;

  // The funnel the row-edit DIALOGS were missing. openEditorForRow sends five row types to their
  // own dialogs instead of the Sheet (SendText, RunProfile, Keystroke, HoldKey, Pause), and each
  // of those Save handlers wrote the collection with a fixed index and no run term at all — while
  // the Toolbar mounts the SAME components in 'add' mode behind refuseInsert(), and the Sheet,
  // the SettingsPanel and the DataPanel each have their own. Four files had the pattern and the
  // grid's own dialogs did not.
  //
  // Refused at Save, not at open: unlike the one-field inline editor, these hold a whole form, and
  // a run that starts while the user is halfway through a Send Keystroke must not throw the typing
  // away — it must decline to write it. Throttled for the same reason Toolbar's is: error toasts
  // last eight seconds.
  // The SAME kind of claim the SheetPanel holds, for the five row types that never reach the
  // Sheet — under its own owner, 'row-dialog', so closing one of these no longer releases a Sheet
  // that still holds unsaved fields (AutomationGuard keeps one stamp per owner).
  //
  // AutomationGuard's doc says the claim exists because "the SheetPanel's fields live in React
  // state and only become actions:edit on Save, so HasUnsavedChanges — which an autonomous fire
  // DOES respect — is still false while a half-filled form is on screen". That is true of these
  // dialogs word for word, and editor:pendingEdits had exactly one sender in the whole frontend.
  //
  // Two of the five were protected by ACCIDENT, through the keyboard hook's capture refcount —
  // and that refcount is dropped precisely when it starts to matter: KeystrokeCaptureDialog and
  // PauseDialog both send {enabled:false} on focus of any <input>, so clicking into Times or Gap
  // released the only thing standing between a due automation and a profile swap under an open
  // dialog. SendText and RunProfile never had even that: neither file calls send() at all, and
  // SendText is the longest edit session in the app.
  //
  // The one-field inline editor rides the same claim. It was the third editor and the only one
  // with no claim at all: a due automation swapped the profile under a half-typed Delay, and the
  // Enter that followed wrote it into the new profile's row. One owner covers all of them because
  // they all live here and the claim is one boolean — any of them open.
  const rowDialogOpen = !!(sendTextEdit || keystrokeEdit || pauseEdit || runProfileEdit || runProfileInsert || editingCell);
  // Transition, unmount and the Sheet's heartbeat, in one place (useEditorClaim).
  useEditorClaim('row-dialog', rowDialogOpen);

  // The mode flip takes this whole table away — App renders the Clicker dashboard in its place —
  // and every row editor with it. App says so for the Sheet (discardAndClose); these closed in
  // silence, a SendText mid-sentence included, and the flip is a global hotkey that can land
  // while the user is typing. Nothing can refuse it (it is the backend's), so the unmount SAYS it,
  // the way the profile-switch effect below does. Read through a ref: the cleanup runs once, on
  // the way out, and must see the editors as they were then.
  const unmountNoticeRef = useRef<(() => void) | null>(null);
  unmountNoticeRef.current = rowDialogOpen
    ? () => showToast(tt('Clicker mode closed the open row editor without saving.',
                         'O modo Clicker fechou o editor de linha aberto sem salvar.'), 'info')
    : null;
  useEffect(() => {
    const notice = unmountNoticeRef;
    return () => { notice.current?.(); };
  }, []);

  /**
   * Which delete a selection MEANS: the message to send and how many rows it will actually take.
   *
   * Four surfaces ask this — the Delete key, the row menu, the bulk bar and the drag — and each
   * wrote the answer out by hand. Three of them grew the lone-marker branches as the If, the loop
   * and then the Else If arm arrived; the bulk bar kept only the snap. So one Else If row selected
   * on its own took its whole If…EndIf when deleted from the bar and only its arm when deleted by
   * keyboard, from the same selection, with the bar reading "1 selected" either way.
   *
   * Derived once, here. The callers keep their own toasts, which is the part that legitimately
   * differs between a menu with a label, a bar with a count and a bare keypress.
   */
  const deleteIntentFor = useCallback((sel: number[]): { message: OutgoingMessage; count: number } => {
    if (sel.length === 1) {
      const t = actions[sel[0]]?.actionType;
      if (t === 'If') {
        const end = blockInfo.closerOf.get(sel[0]);
        return {
          message: { type: 'actions:deleteConditional', payload: { ifRowIndex: sel[0] } },
          count: end != null ? end - sel[0] + 1 : 1,
        };
      }
      if (t === 'While' || t === 'ForEachRow') {
        const end = blockInfo.closerOf.get(sel[0]);
        return {
          message: { type: 'actions:deleteLoop', payload: { loopRowIndex: sel[0] } },
          count: end != null ? end - sel[0] + 1 : 1,
        };
      }
      if (t === 'ElseIf') {
        return {
          message: { type: 'actions:deleteElseIfArm', payload: { elseIfRowIndex: sel[0] } },
          count: armBodyEnd(actions, sel[0]) - sel[0] + 1,
        };
      }
    }
    const snapped = snapSelectionToBlocks(sel);
    return { message: { type: 'actions:delete', payload: { indices: snapped } }, count: snapped.length };
  }, [actions, blockInfo, snapSelectionToBlocks]);

  const lastRunRefusalRef = useRef(0);
  const refuseDuringRun = useCallback(() => {
    if (contextMenuEnabled) return false;
    const now = Date.now();
    if (now - lastRunRefusalRef.current > 2000) {
      lastRunRefusalRef.current = now;
      showToast(tt('Not saved — the action list is locked while a run is active.',
                   'Não salvo — a lista de ações está travada enquanto um run está ativo.'), 'error');
    }
    return true;
  }, [contextMenuEnabled, showToast, tt]);

  // Row action button handler (opens context menu at button position)
  // Suppress hotkeys while SendText edit dialog or inline key editing is active

  // Clear selection when recording stops so next recording appends normally
  useEffect(() => {
    if (wasRecording.current && !buttonStates.recordingActive) {
      setSelectedIndices(new Set());
    }
    wasRecording.current = buttonStates.recordingActive;
  }, [buttonStates.recordingActive]);

  // Sync selection to shared ref and push to C# bridge
  useEffect(() => {
    selectionRef.current = selectedIndices;
    send({ type: 'selection:changed', payload: { indices: Array.from(selectedIndices) } });
  }, [selectedIndices, selectionRef, send]);

  // Scroll to top when replay starts
  useEffect(() => {
    if (buttonStates.replayActive && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [buttonStates.replayActive]);

  // Auto-scroll to the highlighted row lives in ReplayRowMarker now — it is the only thing
  // that knows the index, and keeping the scroll next to the mark is what lets this component
  // stay off the per-action re-render path entirely.

  // Preserve scroll position across action list updates (undo/redo, edits, bulk ops)
  const savedScrollTop = useRef(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => { savedScrollTop.current = el.scrollTop; };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!buttonStates.recordingActive && !buttonStates.replayActive && scrollRef.current) {
      const saved = savedScrollTop.current;
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = saved;
      });
    }
  }, [actions, buttonStates.recordingActive, buttonStates.replayActive]);

  // Auto-scroll when new actions are added during recording
  // In append mode (no selection): scroll to bottom
  // In insert mode (has selection): keep viewport stable
  useEffect(() => {
    if (buttonStates.recordingActive && actions.length > prevActionsLength.current && scrollRef.current) {
      if (selectionRef.current.size === 0) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
    prevActionsLength.current = actions.length;
  }, [actions.length, selectionRef, buttonStates.recordingActive]);

  // Scroll to top only on profile switch (not on edits or manual additions)
  useEffect(() => {
    if (activeProfile !== prevProfileRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    prevProfileRef.current = activeProfile;
  }, [activeProfile]);

  // A profile switch replaces the list wholesale, and everything here that points INTO it by
  // index points at the new profile's rows afterwards. The selection survived it: it stayed lit
  // on rows nobody picked, the bridge kept its insert index — so the next recording by hotkey
  // landed in the middle of the new profile — and the Settings delay chip wrote those rows. The
  // row editors and the row menu survived it too, and their commit wrote the new profile's
  // same-index row. A switch arrives by global hotkey or automation, so it can land with any of
  // them open: the selection clears (the sync effect pushes selection:changed) and every
  // index-addressed surface closes, saying so when it held an editor. The Ids the editors send
  // are the backstop — a duplicated profile repeats its source's Ids, so they cannot be the
  // whole answer.
  const profileForEditorsRef = useRef(activeProfile);
  useEffect(() => {
    if (activeProfile === profileForEditorsRef.current) return;
    profileForEditorsRef.current = activeProfile;
    setSelectedIndices(prev => (prev.size === 0 ? prev : new Set()));
    lastClickedIndex.current = null;
    kbCursorRef.current = null;
    setContextMenu(null);
    const hadEditor = !!(editingCell || sendTextEdit || runProfileEdit || keystrokeEdit || pauseEdit || runProfileInsert);
    if (!hadEditor) return;
    setEditingCell(null);
    setEditInvalid(false);
    setSendTextEdit(null);
    setRunProfileEdit(null);
    setKeystrokeEdit(null);
    setPauseEdit(null);
    setRunProfileInsert(null);
    showToast(tt('The profile changed — the open row editor closed without saving.',
                 'O perfil mudou — o editor de linha aberto fechou sem salvar.'), 'info');
  }, [activeProfile, editingCell, sendTextEdit, runProfileEdit, keystrokeEdit, pauseEdit, runProfileInsert, showToast, tt]);

  // Focus edit input when entering edit mode. No auto-select — the user asked
  // for the caret to land at the end of the existing value instead of the whole
  // text being selected (a stray keystroke was wiping values).
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      const el = editInputRef.current;
      el.focus();
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch { /* non-text input types */ }
    }
  }, [editingCell]);

  // Clear invalid selection indices when actions change
  useEffect(() => {
    setSelectedIndices(prev => {
      const valid = new Set<number>();
      prev.forEach(i => { if (i < actions.length) valid.add(i); });
      return valid.size === prev.size ? prev : valid;
    });
  }, [actions.length]);

  // Listen for external selection updates (e.g. Move Up/Down from Toolbar)
  useEffect(() => {
    const handler = (e: Event) => {
      const indices = (e as CustomEvent).detail as number[];
      setSelectedIndices(new Set(indices));
      lastClickedIndex.current = indices[0] ?? null;
      // Keep the keyboard cursor in step so a follow-up Arrow continues from
      // the externally-selected row (kbCursorRef declared with the keyboard
      // block; runs post-render).
      kbCursorRef.current = indices[0] ?? null;
    };
    window.addEventListener('selection:set', handler);
    return () => window.removeEventListener('selection:set', handler);
  }, []);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)
      ) {
        setContextMenu(null);
        setActiveSubmenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu(null);
        setActiveSubmenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [contextMenu]);

  // A run starting CLOSES the menu. contextMenuEnabled only ever decided whether the menu OPENS
  // (handleRowContextMenu reads it and returns), and the dismissal above listens for mousedown and
  // Escape — neither of which a run start produces: replays begin on a GLOBAL hotkey, from the
  // tray, or from an armed automation. So a menu opened a moment earlier stayed painted, with
  // every item live and none of them disabled, over a grid the engine was already walking. Delete,
  // Skip, Paste here, Change click type and Split/Merge all rewrite the list the run is reading,
  // and the backend has no net of its own for them.
  //
  // Same shape as the effect Toolbar mounts for its popovers and as DataPanel's refuseWrite: a
  // gate on opening is not a gate on something already open, and "already open when the run
  // started" is the ordinary case, not the exotic one.
  useEffect(() => {
    if (contextMenuEnabled) return;
    setContextMenu(null);
    setActiveSubmenu(null);
    // The "+ Add Else If" family picker closes on the same edge, and for a stronger reason than
    // the menu above: its items do not merely rewrite the grid, two of them (Image, Pixel) open a
    // FULL-SCREEN capture overlay. Over a live run that covers the grid, swallows the Stop key and
    // lets the run's own injected click commit a region the user never drew. Its opener button was
    // already gated on the run — which is precisely the gate that does nothing for a picker that
    // was open BEFORE the run started, and runs start from a global key, the tray or an armed
    // automation, producing neither the mousedown nor the Escape its own dismissal listens for.
    setElseIfPicker(null);
  }, [contextMenuEnabled]);

  // Close the "+ Add Else If" family picker on click outside or Escape — same contract as
  // the row context menu above. Kept as its own effect (not merged) so the two menus can be
  // open-and-closed independently without one clobbering the other's state.
  useEffect(() => {
    if (!elseIfPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (elseIfPickerRef.current && !elseIfPickerRef.current.contains(e.target as Node)) {
        setElseIfPicker(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setElseIfPicker(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [elseIfPicker]);

  // Handle row click with selection logic
  const handleRowClick = useCallback((idx: number, e: React.MouseEvent) => {
    if (editingCell) return;
    if (dragOccurred.current) { dragOccurred.current = false; return; }
    // Mutating the selection mid-run is blocked at App level for body focus; mirror
    // that here, same as handleGridKeyDown — a click during a run must not reshape
    // the selection that the bulk bar/Delete gate reads the instant the run ends.
    if (buttonStates.recordingActive || buttonStates.replayActive) return;

    // Mouse clicks reposition the keyboard cursor so a follow-up Arrow/Space
    // continues from the clicked row (kbCursorRef is declared with the keyboard
    // navigation block below; assignment happens at click time, post-render).
    kbCursorRef.current = idx;

    setSelectedIndices(prev => {
      if (e.ctrlKey || e.metaKey) {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        lastClickedIndex.current = idx;
        return next;
      }

      if (e.shiftKey && lastClickedIndex.current !== null) {
        const start = Math.min(lastClickedIndex.current, idx);
        const end = Math.max(lastClickedIndex.current, idx);
        const next = new Set(prev);
        for (let i = start; i <= end; i++) next.add(i);
        return next;
      }

      // Toggle: clicking an already-selected row (single selection) deselects it
      if (prev.size === 1 && prev.has(idx)) {
        lastClickedIndex.current = null;
        return new Set();
      }

      lastClickedIndex.current = idx;
      return new Set([idx]);
    });
  }, [editingCell, buttonStates.recordingActive, buttonStates.replayActive]);

  // ── Keyboard row navigation (UI Wave 3) ──
  // The scroll container is the focus target (tabIndex=0); keys act on a cursor
  // ref that mouse clicks keep in sync via lastClickedIndex. Arrow = move + select,
  // Shift+Arrow = extend from the anchor, Space = toggle, Enter = open the row's
  // editor (same routing the context menu's Edit uses), Home/End = jump.
  const kbCursorRef = useRef<number | null>(null);

  // One editor-routing function shared by the context menu's Edit and Enter —
  // specialized dialogs for the single-payload actions, generic Sheet otherwise.
  const openEditorForRow = useCallback((idx: number) => {
    const rowAction = actions[idx];
    if (!rowAction) return;
    if (rowAction.actionType === 'SendText') {
      // Every axis is seeded from the row. Omitting one is not a cosmetic miss: the dialog would
      // reopen showing the DEFAULT, and the next Save writes that default back over the row's
      // real choice (the failure WebViewBridge's projection comment warns about).
      setSendTextEdit({
        index: idx,
        id: rowAction.id ?? '',
        text: rowAction.key,
        html: rowAction.keyHtml,
        mode: rowAction.sendMode ?? 'rich',
        method: rowAction.sendMethod ?? 'paste',
        charDelayMs: rowAction.sendCharDelay ?? null,
      });
    } else if (rowAction.actionType === 'RunProfile') {
      setRunProfileEdit({
        index: idx,
        id: rowAction.id ?? '',
        profileName: rowAction.key,
        repeatCount: rowAction.repeatCount ?? 1,
        runOverData: rowAction.runOverData ?? false,
      });
    } else if (rowAction.actionType === 'Keystroke' || rowAction.actionType === 'HoldKey') {
      // Both share the unified Send Keystroke dialog — it seeds Press / Hold
      // mode from the row's ActionType.
      setKeystrokeEdit({ index: idx, id: rowAction.id ?? '' });
    } else if (rowAction.actionType === 'Pause') {
      // Pause reopens its own capture-pad dialog, not the Sheet.
      setPauseEdit({ index: idx, id: rowAction.id ?? '' });
    } else {
      onOpenSheet?.(idx);
    }
  }, [actions, onOpenSheet]);

  const scrollRowIntoView = useCallback((idx: number) => {
    const id = actions[idx]?.id;
    if (id == null || !scrollRef.current) return;
    const rowEl = scrollRef.current.querySelector(`[data-row-id="${window.CSS.escape(String(id))}"]`);
    rowEl?.scrollIntoView({ block: 'nearest' });
  }, [actions]);

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    // Only when the CONTAINER itself is focused — keys typed into inline edit
    // inputs (or any nested control) keep their normal behavior.
    if (e.target !== e.currentTarget) return;
    if (actions.length === 0) return;
    // Alt+Arrow belongs to the Toolbar's reorder shortcut (window listener) —
    // bail so the grid cursor never fights the reorder.
    if (e.altKey) return;
    // Mutating the selection mid-run is blocked at App level for body focus;
    // mirror that here since the container is an interactive element.
    if (buttonStates.recordingActive || buttonStates.replayActive) return;

    const last = actions.length - 1;
    // "No cursor yet" ≠ "cursor at 0": the first ArrowDown on a freshly focused
    // grid should land on row 0, not skip to row 1.
    const hasCursor = kbCursorRef.current !== null || lastClickedIndex.current !== null;
    const cursor = kbCursorRef.current ?? lastClickedIndex.current ?? 0;

    const moveTo = (next: number, extend: boolean) => {
      e.preventDefault();
      const clamped = Math.max(0, Math.min(last, next));
      kbCursorRef.current = clamped;
      if (extend && lastClickedIndex.current !== null) {
        // Clamp the anchor too — after deletions it can point past the end and
        // a range built from it would select phantom indices.
        const anchor = Math.min(lastClickedIndex.current, last);
        const start = Math.min(anchor, clamped);
        const end = Math.max(anchor, clamped);
        const next2 = new Set<number>();
        for (let i = start; i <= end; i++) next2.add(i);
        setSelectedIndices(next2);
      } else {
        lastClickedIndex.current = clamped;
        setSelectedIndices(new Set([clamped]));
      }
      scrollRowIntoView(clamped);
    };

    switch (e.key) {
      case 'ArrowDown': moveTo(hasCursor ? cursor + 1 : 0, e.shiftKey); break;
      case 'ArrowUp': moveTo(cursor - 1, e.shiftKey); break;
      case 'Home': moveTo(0, e.shiftKey); break;
      case 'End': moveTo(last, e.shiftKey); break;
      case ' ': {
        e.preventDefault();
        const at = Math.max(0, Math.min(last, cursor));
        lastClickedIndex.current = at;
        setSelectedIndices(prev => {
          const next = new Set(prev);
          if (next.has(at)) next.delete(at);
          else next.add(at);
          return next;
        });
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (!editingCell) openEditorForRow(Math.max(0, Math.min(last, cursor)));
        break;
      }
    }
  }, [actions.length, buttonStates.recordingActive, buttonStates.replayActive, editingCell, openEditorForRow, scrollRowIntoView]);

  // When the bulk bar FIRST appears, keep a freshly single-selected row clear of it.
  // The bar is an overlay (it no longer shrinks the scroll viewport), but a row in the
  // bottom strip the bar floats over would be partly hidden — scrollIntoView lifts it
  // (the grid's scroll-padding-bottom makes it land above the bar; the matching
  // padding-bottom gives the very last row room to clear it).
  //
  // Crucially this drives off the SELECTION itself, not lastClickedIndex: checkbox /
  // Ctrl+A / range / "select similar" never update lastClickedIndex, so the old code
  // scrolled to a stale, often off-screen row — the list "jumped to an old position".
  // Only a single-row selection scrolls (there's one unambiguous row to reveal);
  // multi-selects leave the scroll exactly where it is. A row that's already visible
  // is a no-op (block: 'nearest'), so middle-of-list clicks never move the list.
  const prevBulkBarVisible = useRef(false);
  useEffect(() => {
    const visible = selectedIndices.size > 0 && !buttonStates.recordingActive && !buttonStates.replayActive;
    if (visible && !prevBulkBarVisible.current && selectedIndices.size === 1) {
      const idx = selectedIndices.values().next().value;
      const grid = scrollRef.current;
      const id = idx != null ? actions[idx]?.id : null;
      if (grid && id != null) {
        const rowEl = grid.querySelector(`[data-row-id="${window.CSS.escape(String(id))}"]`);
        if (rowEl) requestAnimationFrame(() => rowEl.scrollIntoView({ block: 'nearest' }));
      }
    }
    prevBulkBarVisible.current = visible;
  }, [selectedIndices, buttonStates.recordingActive, buttonStates.replayActive, actions]);

  // Start editing a cell
  // The inline cell editor was the last unguarded route to actions:edit. The ActionTable already
  // refuses the context menu, the drag, the bulk bar and keyboard navigation during a run
  // (contextMenuEnabled and friends), but a single click on Delay or Notes opened an editor whose
  // blur wrote straight into the list the engine is stepping through.
  // Refused at the door rather than at the commit: this editor holds one field, so not letting it
  // open costs nothing, while letting someone type and then refusing would cost them the typing.
  // commitEdit carries the same term anyway, for an editor already open when the run starts.
  //
  // editOriginRef is the text the editor opened with. commitEdit compares against it: clicking
  // into a cell to read it and clicking away sent the same value back as an edit, and the backend
  // cannot tell — it pushed an undo entry and marked the profile unsaved, which parks every armed
  // automation in SkippedDirty until a Save of nothing. The Keystroke and Pause dialogs already
  // send only what changed.
  const editOriginRef = useRef('');
  const startEdit = useCallback((index: number, field: EditingCell['field'], currentValue: string) => {
    if (buttonStates.recordingActive || buttonStates.replayActive) {
      showToast(tt('The action list is locked while a run is active.',
                   'A lista de ações está travada enquanto um run está ativo.'), 'error');
      return;
    }
    setEditingCell({ index, field, id: actions[index]?.id ?? '' });
    setEditValue(currentValue);
    editOriginRef.current = currentValue;
    setEditInvalid(false);
  }, [actions, buttonStates.recordingActive, buttonStates.replayActive, showToast, tt]);

  // A single click on the TEXT of a click's "x, y" or a KeyDown/KeyUp's key opens its inline
  // editor — the Delay/Notes guard chain: an editor already open, the click a drop leaves
  // behind, and Ctrl/Shift (a selection gesture) all fall through to the row and select. So
  // does a press held past LONG_PRESS_MS without moving: that was a drag that never started.
  const LONG_PRESS_MS = 400;
  const markSpanPress = useCallback(() => { spanPressAtRef.current = performance.now(); }, []);
  const openSpanEditor = useCallback((e: React.MouseEvent, index: number, field: 'coords' | 'key', value: string) => {
    if (editingCell) return;
    if (dragOccurred.current) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (performance.now() - spanPressAtRef.current > LONG_PRESS_MS) return;
    e.stopPropagation();
    startEdit(index, field, value);
  }, [editingCell, startEdit]);

  // Invalid-input flag for the coords editor — drives the red border below.
  // Cleared on every keystroke and on every startEdit.
  const [editInvalid, setEditInvalid] = useState(false);

  // Commit the edit. `source` decides what an invalid value does: an explicit
  // Enter keeps the editor OPEN with a red border (visible rejection, same
  // pattern as the BulkActionBar delay field); a blur can't sensibly hold
  // focus hostage, so it cancels as before.
  const commitEdit = useCallback((source: 'key' | 'blur' = 'blur') => {
    if (!editingCell) return;
    // Unchanged text writes nothing, so it just closes — ahead of the run gate below, whose
    // refusal would announce "Not saved" for an edit nobody made. See editOriginRef.
    if (editValue === editOriginRef.current) {
      setEditingCell(null);
      setEditInvalid(false);
      return;
    }
    // FIRST of the writes. This gate used to sit below the coords branch, so the one editor
    // that writes two fields was the one editor that could write into a list the engine was
    // walking — the exact case the comment below describes, reachable because startEdit only
    // guards OPENING and a run starts from a global hotkey with the editor already up.
    if (buttonStates.recordingActive || buttonStates.replayActive) {
      showToast(tt('Not saved — the action list is locked while a run is active.',
                   'Não salvo — a lista de ações está travada enquanto um run está ativo.'), 'error');
      setEditingCell(null);
      setEditInvalid(false);
      return;
    }
    if (editingCell.field === 'coords') {
      // Merged "x, y" editor — the Sheet's Paste coordinates reads the same shapes (one helper).
      // Both numbers are required so a typo can't half-update one axis, and both must fit an
      // Int32 — past it the backend refuses the whole edit.
      const pair = parseCoordPair(editValue);
      if (pair) {
        // ONE message, so ONE undo entry. As two actions:edit this was two snapshots, and a single
        // Ctrl+Z left the row at the NEW x with the OLD y — a point that existed at no moment of
        // the edit, which the next replay would click. Same rule the Sheet's Save follows.
        send({
          type: 'actions:editMany',
          payload: {
            index: editingCell.index,
            id: editingCell.id,
            edits: [{ field: 'x', value: String(pair.x) }, { field: 'y', value: String(pair.y) }],
          },
        });
      } else if (source === 'key') {
        setEditInvalid(true);
        return; // stay open — the red border says why nothing happened
      }
      setEditingCell(null);
      setEditInvalid(false);
      return;
    }
    // A delay is a whole number of ms, 0 or more. "-50" used to save as 0 in silence (the
    // backend floored it); now Enter holds the editor open with the red border, and a blur
    // sends it on so the backend's refusal says why nothing changed.
    if (editingCell.field === 'delay' && source === 'key') {
      const n = tryParseInt32(editValue);
      if (n == null || n < 0) {
        setEditInvalid(true);
        return;
      }
    }
    send({
      type: 'actions:edit',
      payload: { index: editingCell.index, id: editingCell.id, field: editingCell.field, value: editValue },
    });
    setEditingCell(null);
    setEditInvalid(false);
  }, [editingCell, editValue, send, buttonStates.recordingActive, buttonStates.replayActive, showToast, tt]);

  // Cancel the edit
  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditInvalid(false);
  }, []);

  // Handle keyboard on the table container
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (editingCell || sendTextEdit) return;

    // Don't hijack grid shortcuts (Ctrl+A select-all, Delete, Escape) while the user is typing in
    // an input/textarea that lives inside the grid container — notably the BulkActionBar's
    // delay/x/y/notes fields. Those don't set editingCell, so without this guard their keydowns
    // bubble here and Ctrl+A selected every row (and Delete could delete rows) instead of acting on
    // the field's own text. Mirrors the editable-target guard in App.tsx's global shortcut handler.
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;

    // A run doesn't take the grid away, so the grid stays and REFUSES — and the refusal lives here,
    // where the send happens. App.tsx's run lockout swallows only Tab/Space/Enter/arrows, so Delete
    // and Ctrl+A reached this handler mid-run; and a replay with no target window types into
    // whatever is in front, this window included, so a macro's own Ctrl+A, Delete selected and
    // deleted every row of the list the engine was stepping through.
    const runActive = buttonStates.recordingActive || buttonStates.replayActive;

    if (e.key === 'Delete' && selectedIndices.size > 0) {
      e.preventDefault();
      if (runActive) {
        showToast(tt('Not deleted — the action list is locked while a run is active.',
                     'Nada apagado — a lista de ações está travada enquanto um run está ativo.'), 'error');
        return;
      }
      // Lone-IF selection routes through actions:deleteConditional so the whole block goes
      // with it. A selection that TOUCHES a marker snaps to whole IF…EndIf blocks so a
      // straddling multi-select can't orphan block rows; a PURE body-row selection deletes
      // just those rows (snapSelectionToBlocks) — removing body rows can't unbalance the markers.
      const sel = Array.from(selectedIndices);
      // One source for the routing — see deleteIntentFor. A lone If, loop opener or Else If each
      // take their own scope; anything else snaps to whole blocks.
      const { message, count } = deleteIntentFor(sel);
      // Say so when the SNAP widened a multi-row selection. This path has no menu label to read
      // and no toast of its own, so the only number on screen was the bulk bar's raw "N selected".
      // Kept to the snap case: a lone marker taking its own block is what the user asked for by
      // selecting the marker, and does not need to be announced as a surprise.
      if (message.type === 'actions:delete' && count > sel.length) {
        showToast(tt(`Deleted ${count} rows — the selection touched a block marker, so whole blocks went with it.`,
                     `${count} linhas apagadas — a seleção tocou um marcador de bloco, então blocos inteiros foram junto.`));
      }
      send(message);
      setSelectedIndices(new Set());
    }

    if (e.key === 'a' && (e.ctrlKey || e.metaKey) && actions.length > 0) {
      e.preventDefault();
      // Silent: selecting is not a write, but a macro's Ctrl+A must not reshape the selection either.
      if (runActive) return;
      setSelectedIndices(new Set(actions.map((_, i) => i)));
    }

    if (e.key === 'Escape' && selectedIndices.size > 0) {
      e.preventDefault();
      setSelectedIndices(new Set());
    }
  }, [editingCell, sendTextEdit, selectedIndices, send, actions, deleteIntentFor, showToast, tt,
      buttonStates.recordingActive, buttonStates.replayActive]);

  // Handle edit input key events
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commitEdit('key');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  }, [commitEdit, cancelEdit]);

  // KeyDown / KeyUp: the key arrives from the low-level hook (useSingleKeyCapture), named the
  // way recording names it. The first key commits — through the same run lock as commitEdit,
  // which the old browser-keydown capture skipped — and the same key writes nothing.
  const commitKeyCapture = useCallback((key: string) => {
    if (!editingCell || editingCell.field !== 'key') return;
    if (buttonStates.recordingActive || buttonStates.replayActive) {
      showToast(tt('Not saved — the action list is locked while a run is active.',
                   'Não salvo — a lista de ações está travada enquanto um run está ativo.'), 'error');
      setEditingCell(null);
      return;
    }
    if (key !== editOriginRef.current) {
      send({
        type: 'actions:edit',
        payload: { index: editingCell.index, id: editingCell.id, field: 'key', value: key },
      });
    }
    setEditingCell(null);
  }, [editingCell, send, buttonStates.recordingActive, buttonStates.replayActive, showToast, tt]);
  // Armed exactly while the key editor is open; closing it by ANY route releases the hook.
  useSingleKeyCapture(editingCell?.field === 'key', commitKeyCapture, cancelEdit);
  // A run that starts under an armed capture (an automation, a hotkey from another window)
  // would leave the hook swallowing every key, the Stop hotkey included — close it.
  useEffect(() => {
    if ((buttonStates.recordingActive || buttonStates.replayActive) && editingCell?.field === 'key') {
      setEditingCell(null);
    }
  }, [buttonStates.recordingActive, buttonStates.replayActive, editingCell]);

  // Drag & drop via dnd-kit (sortable preset): neighbours slide live while the
  // row is dragged, the ghost rides in a DragOverlay, and the drop commits the
  // same actions:reorder payload the old mouse-event implementation produced.
  const isDraggable = !buttonStates.recordingActive && !buttonStates.replayActive && !editingCell;
  const dragOccurred = useRef(false);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  // FLIP-on-drop: at mouseup (before the reorder round-trips through the
  // backend) we snapshot every row's viewport top keyed by action id. When the
  // reordered actions array lands, the layout effect below inverts each moved
  // row's delta and plays it back to zero — rows visibly slide into their new
  // slots instead of teleporting. Timestamped so a stale snapshot (reorder
  // rejected / unrelated update arriving much later) is discarded.
  const pendingFlipRects = useRef<{ map: Map<string, number>; at: number } | null>(null);

  useLayoutEffect(() => {
    const pending = pendingFlipRects.current;
    if (!pending) return;
    pendingFlipRects.current = null;
    if (!tbodyRef.current) return;
    if (performance.now() - pending.at > 800) return;
    // Tame the settle on big grids (user feedback: "many actions → animation too
    // aggressive"). Two culls, dnd-kit-style: rows outside the visible scroll
    // area never animate (nobody sees them, but dozens of simultaneous WAAPI
    // animations make the visible ones feel chaotic), and rows whose delta
    // exceeds the viewport height snap into place instead of flying across it.
    const view = scrollRef.current?.getBoundingClientRect();
    const maxFly = view ? view.height : 600;
    const zoom = uiZoom();
    tbodyRef.current.querySelectorAll<HTMLTableRowElement>('tr[data-row-id]').forEach(tr => {
      const id = tr.getAttribute('data-row-id');
      if (!id) return;
      const oldTop = pending.map.get(id);
      if (oldTop === undefined) return;
      const rect = tr.getBoundingClientRect();
      if (view && (rect.bottom < view.top || rect.top > view.bottom)) return;
      const delta = oldTop - rect.top;
      if (Math.abs(delta) < 2 || Math.abs(delta) > maxFly) return;
      // delta is a VISUAL distance (both tops come from getBoundingClientRect), but a
      // translate length is LAYOUT and `zoom` scales it again — writing delta straight in
      // starts the row short of where it actually was (10 % short at the default 0.90,
      // double the distance at zoom 2), so the settle ends with a visible jump. The
      // comparisons above stay in visual space, where view.height already is.
      tr.animate(
        [{ transform: `translateY(${delta / zoom}px)` }, { transform: 'translateY(0)' }],
        { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      );
    });
  }, [actions]);

  // Row measurement: maps a cursor Y to an insertion index (0..N) across the action rows,
  // skipping injected "Add Else" ghost rows. Used by the profile→Run Profile drag-drop only.
  // It was shared with the row reorder before that moved to dnd-kit: the reorder's target
  // comes from dnd-kit's collision detection and sortableIds (handleDragEnd), so a fix to a
  // reorder landing spot does not belong here.
  const computeInsertIndexFromY = useCallback((clientY: number): number | null => {
    if (!tbodyRef.current) return null;
    // Skip injected non-action rows: "+ Add Else" ghosts AND the animated
    // drop-gap slot (a layout-affecting row — including it would offset every
    // index below the gap by one and make the target oscillate as the gap moves).
    const rows = Array.from(tbodyRef.current.querySelectorAll('tr')).filter(
      tr => !tr.hasAttribute('data-drop-gap')
        && !tr.querySelector('button[data-add-else]')
    );
    let target: number | null = null;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) { target = i; break; }
      if (i === rows.length - 1) target = i + 1;
    }
    return target;
  }, []);
  // Auto-scroll zone for the PROFILE drag only (row reorder now uses dnd-kit's
  // built-in auto-scroll): when the cursor is within this many pixels of the
  // scroll container's top or bottom edge, scroll the container automatically.
  const AUTOSCROLL_ZONE = 40;
  const AUTOSCROLL_MAX_SPEED = 14; // px per animation frame

  // ── dnd-kit row reorder ──────────────────────────────────────────────
  // Sortable ids are the backend action ids (stable across reorders); the
  // index fallback only exists for the brief pre-migration window where an
  // old profile's rows have no id yet.
  const sortableIds = useMemo(() => actions.map((a, i) => a.id ?? `row-${i}`), [actions]);
  const sensors = useSensors(useSensor(RowPointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const handleDragStart = useCallback((ev: DragStartEvent) => {
    const idx = sortableIds.indexOf(String(ev.active.id));
    if (idx < 0) return;
    let indices = selectedIndices.has(idx)
      ? Array.from(selectedIndices).sort((a, b) => a - b)
      : [idx];
    // Snap the drag set to whole conditional blocks ONLY when it touches a marker: any selected
    // IF/ELSE/ENDIF (a solo IF drag, or a multi-select that straddles a block boundary) pulls in
    // its block's full span — for nested blocks, every enclosing IF span. Without this a partial-
    // block move orphans markers: the reorder backend (HandleActionsReorder) renumbers but does
    // NOT run ConditionalBlockValidator, so the imbalance only surfaces on the next profile load.
    //
    // A PURE body-row selection (no markers, ANY count) drags freely, in OR out of a block —
    // symmetric with drag-in and consistent with the granular delete/duplicate paths. Safe because
    // moving body rows never reorders the IF/ELSE/ENDIF rows relative to each other, so the list
    // stays balanced (no orphans → the load validator is a no-op); block membership is purely
    // positional and recomputed after the move; an emptied IF…ENDIF is handled by both the replay
    // engine (BuildBlockMap: empty body runs to the EndIf) and the frontend blockInfo. The backend
    // (HandleActionsReorder) reinserts a non-contiguous selection contiguously at the target, so the
    // dragged body rows land together regardless of gaps. The bulk Move Up/Down buttons + Alt+↑/↓ now
    // apply the same marker snap (snapSelectionToBlocks / snapIndicesToBlocks), so every mutating op is consistent.
    indices = snapSelectionToBlocks(indices);
    // Suppress the click that fires after the drop — handleRowClick consumes and
    // resets the flag (same contract as the old mouse-event implementation).
    dragOccurred.current = true;
    setActiveDragId(String(ev.active.id));
    setDragIndices(indices);
  }, [sortableIds, selectedIndices, snapSelectionToBlocks]);

  const handleDragEnd = useCallback((ev: DragEndEvent) => {
    const indices = dragIndices ?? [];
    setActiveDragId(null);
    setDragIndices(null);
    const { active, over } = ev;
    if (!over || indices.length === 0) return;
    const a = sortableIds.indexOf(String(active.id));
    const o = sortableIds.indexOf(String(over.id));
    if (a < 0 || o < 0 || a === o) return;
    // Dropping onto a row that's part of the dragged set is a no-op (the slot
    // is inside the moving block).
    if (indices.includes(o)) return;
    // dnd-kit sortable semantics: the active row lands AT `over`'s position
    // (arrayMove). The backend expects the insertion slot measured against the
    // ORIGINAL array (0..N): moving down → the slot after `over`; moving up →
    // the slot at `over`.
    const target = a < o ? o + 1 : o;
    // FLIP "first" snapshot — capture where every row sits NOW (transforms
    // included, i.e. exactly where the user sees them); the useLayoutEffect on
    // [actions] plays the inverted deltas once the reordered array lands, so
    // the brief transform-reset frame between drop and backend push never
    // reads as a teleport.
    if (tbodyRef.current && document.documentElement.getAttribute('data-animations') === 'true') {
      const map = new Map<string, number>();
      tbodyRef.current.querySelectorAll<HTMLTableRowElement>('tr[data-row-id]').forEach(tr => {
        const id = tr.getAttribute('data-row-id');
        if (id) map.set(id, tr.getBoundingClientRect().top);
      });
      pendingFlipRects.current = { map, at: performance.now() };
    }
    send({ type: 'actions:reorder', payload: { indices, targetIndex: target } });
    setSelectedIndices(new Set());
  }, [dragIndices, sortableIds, send]);

  // Esc (handled natively by dnd-kit) cancels the drag — clear the visual state;
  // dragOccurred stays set so the click fired on pointer release is suppressed.
  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setDragIndices(null);
  }, []);

  // DEV-only test hook: the preview harness flips page visibility at every async
  // boundary, which makes dnd-kit cancel any synthetic drag mid-flight — real
  // pointer drags in the app are unaffected, but it makes the end-to-end path
  // untestable from eval scripts. Exposing the handlers lets tests drive the
  // start/end contract (drag-set expansion + drop-index math) deterministically.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__dndTest = { handleDragStart, handleDragEnd, handleDragCancel };
  }, [handleDragStart, handleDragEnd, handleDragCancel]);

  // ── Drag a profile from the ProfilePanel onto the grid → Run Profile action ──
  // ProfilePanel owns the (mouse-based) drag and signals via window events. While a profile is
  // dragged we reuse the row-reorder insertion gap (driven by dropTarget); on drop we open a
  // pre-filled Run Profile dialog at the drop index. Subscribed once — volatile values are read
  // from a ref so an in-flight drag isn't dropped by a re-subscribe.
  const profileDragCtx = useRef({ recording: false, replaying: false, activeProfile: null as string | null, actionCount: 0 });
  profileDragCtx.current = {
    recording: buttonStates.recordingActive,
    replaying: buttonStates.replayActive,
    activeProfile,
    actionCount: actions.length,
  };
  // Dedicated RAF for the profile-drag auto-scroll — decoupled from the row-reorder's
  // autoScrollRaf so the two can never cancel each other.
  const profileScrollRaf = useRef<number | null>(null);
  useEffect(() => {
    let dragging = false;
    let lastY = 0;
    const stopScroll = () => {
      if (scrollRef.current) delete scrollRef.current.dataset.autoscrolling;
      if (profileScrollRaf.current !== null) {
        cancelAnimationFrame(profileScrollRaf.current);
        profileScrollRaf.current = null;
      }
    };
    // Mirror the row-reorder auto-scroll: while the cursor sits in the top/bottom edge zone,
    // scroll the list (ramping by proximity) and keep the insertion gap in sync — so dropping
    // into a long, already-scrolled list works without scrolling by hand first.
    const tick = () => {
      const container = scrollRef.current;
      if (!container || !dragging) { profileScrollRaf.current = null; return; }
      const rect = container.getBoundingClientRect();
      let delta = 0;
      if (lastY < rect.top + AUTOSCROLL_ZONE) {
        const intensity = (rect.top + AUTOSCROLL_ZONE - lastY) / AUTOSCROLL_ZONE;
        delta = -AUTOSCROLL_MAX_SPEED * Math.min(1, Math.max(0, intensity));
      } else if (lastY > rect.bottom - AUTOSCROLL_ZONE) {
        const intensity = (lastY - (rect.bottom - AUTOSCROLL_ZONE)) / AUTOSCROLL_ZONE;
        delta = AUTOSCROLL_MAX_SPEED * Math.min(1, Math.max(0, intensity));
      }
      if (delta !== 0) {
        // Same flicker guard as the row-reorder auto-scroll: the gap re-mounts at
        // a new index every tick, so its grow animation is frozen until the
        // scroll settles (see [data-autoscrolling] in index.css).
        container.dataset.autoscrolling = 'true';
        container.scrollTop += delta;
        setDropTarget(computeInsertIndexFromY(lastY));
        profileScrollRaf.current = requestAnimationFrame(tick);
      } else {
        delete container.dataset.autoscrolling;
        profileScrollRaf.current = null;
      }
    };
    // The measure-and-render half of onMove, coalesced to one run per frame. Raw mousemove arrives
    // at the mouse's polling rate, and each run costs a querySelectorAll over the tbody, a nested
    // querySelector plus a getBoundingClientRect per row, and a setDropTarget that re-renders every
    // row. lastY stays updated on every event because the auto-scroll tick reads it.
    let moveRaf: number | null = null;
    const flushMove = () => {
      moveRaf = null;
      setDropTarget(computeInsertIndexFromY(lastY));
    };
    const onMove = (e: MouseEvent) => {
      lastY = e.clientY;
      if (moveRaf === null) moveRaf = requestAnimationFrame(flushMove);
      if (profileScrollRaf.current === null) {
        const container = scrollRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          if (e.clientY < rect.top + AUTOSCROLL_ZONE || e.clientY > rect.bottom - AUTOSCROLL_ZONE) {
            profileScrollRaf.current = requestAnimationFrame(tick);
          }
        }
      }
    };
    const onStart = () => {
      const c = profileDragCtx.current;
      if (c.recording || c.replaying) return; // don't reshape the list mid-capture/replay
      dragging = true;
      window.addEventListener('mousemove', onMove);
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('mousemove', onMove);
      // Drop the pending frame BEFORE clearing the target, or a queued flushMove would set it
      // straight back and leave the insertion rail on screen after the drag ended.
      if (moveRaf !== null) { cancelAnimationFrame(moveRaf); moveRaf = null; }
      stopScroll();
      setDropTarget(null);
    };
    const onDrop = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { profileName?: string; clientY?: number } | undefined;
      if (!detail?.profileName || typeof detail.clientY !== 'number') return;
      const c = profileDragCtx.current;
      if (c.recording || c.replaying) return;
      if (detail.profileName === c.activeProfile) {
        showToast(tt("A profile can't run itself", 'Um perfil não pode executar a si mesmo'), 'error');
        return;
      }
      const insertIndex = computeInsertIndexFromY(detail.clientY) ?? c.actionCount;
      setRunProfileInsert({ insertIndex, profileName: detail.profileName });
    };
    window.addEventListener('profiledrag:start', onStart);
    window.addEventListener('profiledrag:end', onEnd);
    window.addEventListener('profiledrag:dropOnGrid', onDrop as EventListener);
    return () => {
      window.removeEventListener('profiledrag:start', onStart);
      window.removeEventListener('profiledrag:end', onEnd);
      window.removeEventListener('profiledrag:dropOnGrid', onDrop as EventListener);
      window.removeEventListener('mousemove', onMove);
      if (moveRaf !== null) cancelAnimationFrame(moveRaf);
      stopScroll();
    };
  }, [computeInsertIndexFromY, showToast, tt]);

  const isMouseAction = (actionType: string) =>
    actionType.includes('Click');

  // Context menu: right-click on a row.
  //
  // Right-click OPENS THE MENU AND NOTHING ELSE — it never changes the selection. Selecting is the
  // left button's job. It used to select the right-clicked row whenever that row was outside the
  // current selection, which meant a right-click could silently discard a multi-row selection the
  // user had just built, and moved the keyboard cursor and the shift-click anchor with it.
  //
  // Nothing downstream needs the selection moved here: every menu action resolves its target as
  // "the selection if it contains the right-clicked row, otherwise just that row" — see
  // contextSelectionIndices and the same guard inlined in handleDuplicate, handleContextDelete and
  // the flyout items. So right-clicking an unselected row still acts on exactly that row, and
  // right-clicking inside a selection still acts on the whole selection.
  //
  // lastClickedIndex / kbCursorRef are deliberately NOT touched either: they are the shift-click
  // anchor and the keyboard cursor, i.e. selection state, and they are read only by the keyboard
  // navigation block and the shift-range builder — never by a menu item.
  const handleRowContextMenu = useCallback((idx: number, e: React.MouseEvent) => {
    if (!contextMenuEnabled) return;
    e.preventDefault();
    setActiveSubmenu(null);
    setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: idx });
  }, [contextMenuEnabled]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setActiveSubmenu(null);
  }, []);




  const handleDuplicate = useCallback(() => {
    if (!contextMenu) return;
    const sel = selectedIndices.size > 0 && selectedIndices.has(contextMenu.rowIndex)
      ? Array.from(selectedIndices)
      : [contextMenu.rowIndex];
    // Block-aware duplicate (mirrors the delete/drag/bulk "never orphan a marker" rule):
    //   • a lone IF → clone exactly ITS OWN block, [if..endIfOf(if)]. endIfOf is the
    //     stack-built map, so a nested inner IF stays inner and never pulls the outer block.
    //   • any other selection → snapSelectionToBlocks: a marker-touch snaps to whole blocks so we
    //     can't clone an unbalanced half-block into an orphan; a pure body-row selection clones
    //     as-is, so duplicating a single action (a click, a keystroke) still copies just that row.
    // The backend inserts the clones right after the last source row — i.e. immediately after
    // the block's EndIf — yielding a valid SIBLING block (still inside any enclosing block).
    let indices = sel;
    const loneType = sel.length === 1 ? actions[sel[0]]?.actionType : undefined;
    if (loneType === 'If' || loneType === 'While' || loneType === 'ForEachRow') {
      // A lone opener of EITHER family clones exactly its own block, [opener..closerOf].
      const end = blockInfo.closerOf.get(sel[0]);
      if (end != null) indices = Array.from({ length: end - sel[0] + 1 }, (_, k) => sel[0] + k);
    } else if (loneType === 'ElseIf') {
      // A lone ARM clones the arm, the same scope its own Delete removes. It used to fall into
      // snapSelectionToBlocks below, which widens any marker touch to the whole If…EndIf — so
      // right-clicking ONE Else If and pressing Duplicate cloned the entire conditional, while
      // the menu label promised "1". Delete on the same row takes only the arm; the two have to
      // mean the same scope or the label cannot be right for both.
      indices = Array.from({ length: armBodyEnd(actions, sel[0]) - sel[0] + 1 }, (_, k) => sel[0] + k);
    } else {
      indices = snapSelectionToBlocks(sel);
    }
    send({ type: 'actions:duplicate', payload: { indices } });
    closeContextMenu();
  }, [contextMenu, selectedIndices, send, closeContextMenu, actions, blockInfo, snapSelectionToBlocks]);


  const handleContextDelete = useCallback(() => {
    if (!contextMenu) return;
    const indices = selectedIndices.size > 0 && selectedIndices.has(contextMenu.rowIndex)
      ? Array.from(selectedIndices)
      : [contextMenu.rowIndex];
    // Special case: deleting an IF row alone removes the whole block (body +
    // optional Else + matching EndIf) via the dedicated bridge message. Without
    // this, the orphaned body rows would silently execute unconditionally.
    // One source for "what does deleting THIS selection mean" — see deleteIntentFor. A lone If,
    // loop opener or Else If each take their own scope; anything else snaps to whole blocks so a
    // straddling multi-select cannot orphan a marker.
    send(deleteIntentFor(indices).message);
    setSelectedIndices(new Set());
    closeContextMenu();
  }, [contextMenu, selectedIndices, send, closeContextMenu, deleteIntentFor]);

  // What Delete will actually take, for the menu label. A lone marker row deletes its own SCOPE —
  // a block, a loop, or now a single arm — and one flat "Delete" gave no hint which of the three,
  // nor that a right-click on one row can take seven. Mirrors handleContextDelete's effective-
  // selection rule exactly (whole selection when the clicked row is in it, otherwise that row
  // alone); if the two ever disagree the label starts lying, which is worse than no label.
  //
  // The four dedicated routes are only the OPENERS. Every other structural row — Else, EndIf,
  // EndLoop, and an ElseIf caught inside a multi-select — reaches the backend through the plain
  // delete, and snapSelectionToBlocks widens it to the enclosing block first. Those used to read
  // a bare "Delete" with no tooltip while taking the whole block, so they are named here by
  // asking the snap itself whether it widens, rather than by growing a second list of types that
  // would drift from conditionalBlocks the way this one already had.
  const deleteScope = useMemo<'block' | 'loop' | 'arm' | 'rows'>(() => {
    if (!contextMenu) return 'rows';
    const indices = selectedIndices.size > 0 && selectedIndices.has(contextMenu.rowIndex)
      ? Array.from(selectedIndices)
      : [contextMenu.rowIndex];
    if (indices.length !== 1) return 'rows';
    const t = actions[indices[0]]?.actionType;
    if (t === 'If') return 'block';
    if (t === 'While' || t === 'ForEachRow') return 'loop';
    if (t === 'ElseIf') return 'arm';
    // A lone closer / Else: named by what the snap is about to do to it.
    if (snapSelectionToBlocks(indices).length > 1) {
      return t === 'EndLoop' ? 'loop' : 'block';
    }
    return 'rows';
  }, [contextMenu, selectedIndices, actions, snapSelectionToBlocks]);

  // Resolve the "effective selection" for context-menu operations the same way
  // Duplicate/Delete do: if the right-clicked row is part of the multi-select,
  // operate on the whole selection; otherwise, just the right-clicked row. This
  // keeps right-click and bulk-action behaviours consistent across the menu.
  const contextSelectionIndices = useCallback((): number[] => {
    if (!contextMenu) return [];
    return selectedIndices.size > 0 && selectedIndices.has(contextMenu.rowIndex)
      ? Array.from(selectedIndices).sort((a, b) => a - b)
      : [contextMenu.rowIndex];
  }, [contextMenu, selectedIndices]);

  // How many rows the menu's selection-scoped entries will touch. One derivation for every label
  // that shows "(N)", so the number a user reads on Duplicate is the number Skip and Copy act on
  // — three inline `.length`s would be three chances for one of them to drift.
  //
  // RAW indices, and that is right for Skip and Copy: those two act on exactly what is selected.
  // Delete and Duplicate do NOT — see contextEffectiveCount below.
  const contextCount = useMemo(() => contextSelectionIndices().length, [contextSelectionIndices]);

  // What Delete and Duplicate will actually touch. They both run the effective selection through
  // snapSelectionToBlocks, which widens EVERY selected index to the innermost enclosing pair as
  // soon as ONE of them is structural — body rows included, even ones that alone would never
  // widen. So selecting rows 3,4,5 where 5 is an EndIf sent "(3)" to the label and five rows to
  // the backend, with the If and the untouched row between them going too. Derived from the same
  // call the handlers make, so the number cannot drift from the act again; the lone-opener cases
  // take dedicated routes and are counted through their own block span, exactly as handleDuplicate
  // resolves them.
  const contextEffectiveCount = useMemo(() => {
    const sel = contextSelectionIndices();
    if (sel.length === 0) return 0;
    if (sel.length === 1) {
      const t = actions[sel[0]]?.actionType;
      if (t === 'If' || t === 'While' || t === 'ForEachRow') {
        const end = blockInfo.closerOf.get(sel[0]);
        return end != null ? end - sel[0] + 1 : 1;
      }
      // A lone ElseIf is an ARM on both routes: Delete removes the arm, Duplicate clones it.
      // Counted through its own span for the same reason the openers above are — the label has
      // to name what the act takes, and the arm carries its body.
      if (t === 'ElseIf') return armBodyEnd(actions, sel[0]) - sel[0] + 1;
    }
    return snapSelectionToBlocks(sel).length;
  }, [contextSelectionIndices, actions, blockInfo, snapSelectionToBlocks]);

  // Collapse: gather the contiguous-validated selection of Down/Up pairs and
  // splice them into a single Keystroke × N row. Selection collapses to the
  // resulting row index so the user sees the transformation result highlighted.
  const handleCollapseToRepeat = useCallback(() => {
    if (!contextMenu) return;
    const indices = contextSelectionIndices();
    // Contiguity is required so we can pass a single (start, count) range to
    // replaceRange — gaps would force multiple operations and a confusing undo.
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) return;
    }
    const rows = indices.map(i => actions[i]);
    const result = canCollapse(rows);
    if (!result) return;
    const replacement: Partial<ActionItem>[] = [{
      actionType: 'Keystroke',
      key: result.key,
      delay: result.delay,
      repeatCount: result.count,
      repeatDelayMs: result.repeatDelayMs,
      comment: result.comment,
    }];
    send({ type: 'actions:replaceRange', payload: {
      startIndex: indices[0],
      count: indices.length,
      replacement,
    }});
    // Pin selection on the new single row. The actions:updated round-trip will
    // re-render with the new layout in the next tick.
    setSelectedIndices(new Set([indices[0]]));
    closeContextMenu();
  }, [contextMenu, contextSelectionIndices, actions, send, closeContextMenu]);

  // Expand: only meaningful for a single-row selection of a Keystroke × N. The
  // resulting N pairs become the new selection so the user can immediately
  // operate on the expanded form (drag, edit, delete).
  const handleExpandRepeat = useCallback(() => {
    if (!contextMenu) return;
    const indices = contextSelectionIndices();
    if (indices.length !== 1) return;
    const idx = indices[0];
    const row = actions[idx];
    if (!canExpand(row)) return;
    const replacement = expandKeystroke(row);
    send({ type: 'actions:replaceRange', payload: {
      startIndex: idx,
      count: 1,
      replacement,
    }});
    const newSel = new Set<number>();
    for (let i = 0; i < replacement.length; i++) newSel.add(idx + i);
    setSelectedIndices(newSel);
    closeContextMenu();
  }, [contextMenu, contextSelectionIndices, actions, send, closeContextMenu]);

  // The bulk bar floats over the grid (see the overlay render below). Drives the
  // scroll-area padding so a selection never hides the bottom rows behind it.
  const bulkBarVisible = selectedIndices.size > 0 && !buttonStates.recordingActive && !buttonStates.replayActive;
  // Guard on actions.length > 0 so an EMPTY grid is never treated as "all
  // selected" (0 === 0 would otherwise be true, giving a no-op deselect + a
  // wrong "Deselect all" tooltip on a fresh grid).
  const allSelected = actions.length > 0 && selectedIndices.size === actions.length;

  return (
    <div
      className="relative flex-1 bg-bg-surface overflow-hidden flex flex-col outline-none"
      // -1: click-focusable for the bubbled Delete/Ctrl+A/Escape handling below,
      // but OUT of the tab order — the inner scroll container (tabIndex=0, the
      // keyboard-navigation target) is the grid's single tab stop.
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      // Reset the post-drag click-suppression flag at the START of every new pointer
      // interaction (capture phase → runs before dnd-kit activates and before any click).
      // Without this, a drag that ends via Escape-cancel or a drop outside any row — or even
      // a normal drop, since dnd-kit suppresses the trailing click — leaves dragOccurred stuck
      // true and silently swallows the user's NEXT click. handleDragStart re-sets it true once
      // a real drag activates, so trailing-click suppression after a genuine drop still works.
      // Mirrors the old mousedown-based reset that the dnd-kit migration dropped.
      onPointerDownCapture={() => { dragOccurred.current = false; }}
    >
      {/* Header now lives INSIDE the table as a sticky <thead> (see below) — the
          old standalone div-grid duplicated the column map (gridTemplateColumns
          vs colgroup) and the two could drift out of alignment; a real thead
          shares the colgroup by construction AND stays visible when the grid
          scrolls. */}

      {/* Body — DndContext/SortableContext drive the live-sliding row reorder.
          Default measuring (rects captured once at drag start) is REQUIRED here:
          MeasuringStrategy.Always re-measures rows mid-slide with their live
          transforms applied, which makes the `over` target drift ahead of the
          cursor and corrupts the drop index. */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerFirstCollision}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      <div
        ref={scrollRef}
        data-actions-grid
        // Focusable: the container is the keyboard-navigation target (Tab reaches
        // it; Arrows/Space/Enter act on the row cursor — see handleGridKeyDown).
        tabIndex={0}
        role="region"
        aria-label="Recorded actions"
        onKeyDown={handleGridKeyDown}
        // scroll-padding-top = one row height: the sticky thead occupies the top
        // of the viewport, so every upward scrollIntoView target (keyboard cursor,
        // exec-row follow, bulk-bar reveal) must land BELOW it, not under it.
        style={{ scrollPaddingTop: 'var(--ui-row-height)' }}
        // pb-9 / scroll-pb-9 only while the floating bulk bar is shown: gives the
        // last row room to scroll above the bar and makes scrollIntoView respect it.
        className={`flex-1 overflow-y-auto ${bulkBarVisible ? 'pb-9 scroll-pb-9' : ''}`}
      >
        {/* aria-selected rides on the rows (valid on the implicit row role); the
            table itself keeps its native role — aria-multiselectable isn't valid
            there and a full role="grid" retrofit needs cell-level focus (wave 4). */}
        <table className="w-full table-fixed">
          <colgroup>
            <col style={{ width: 28 }} />
            <col style={{ width: 50 }} />
            {/* Action 152 + Details 280 match the header's gridTemplateColumns.
                Details holds what used to be Key + X + Y, so chips and coord
                strings share the same 280 px lane (was 240). */}
            {columnVisibility.action && <col style={{ width: 152 }} />}
            {columnVisibility.details && <col style={{ width: 280 }} />}
            {/* 80 (was 70) so a thousands-separated delay — up to "999.999 ms" —
                fits without bleeding left into Details. Steals ~10 px from the
                flexible Notes column (width:100%), which is a non-issue. */}
            {columnVisibility.delay && <col style={{ width: 80 }} />}
            {/* Notes column claims 100% of the remaining table width. In `table-fixed`,
                a <col> without an explicit width gets ~0 and the leftover space sits
                outside any cell — invisible for plain body rows (their bg is close to
                the table container's bg) but very visible for conditional structural
                rows where the tr's amber tint can't paint past the last filled td.
                Forcing 100% here makes the cell expand to fill, so the row's bg covers
                the full row width and the block reads as one continuous amber band. */}
            {columnVisibility.notes && <col style={{ width: '100%' }} />}
          </colgroup>
          {/* Sticky header — sticky sits on the THs (not the thead: Chromium only
              reliably sticks table CELLS). Each th needs an OPAQUE bg (rows scroll
              underneath) and the bottom border is an inset shadow because
              border-collapse borders don't travel with sticky cells. z-10 clears
              the rows' absolutely-positioned block rails. */}
          {/* Header row is suppressed on an empty grid: with zero rows the sticky
              thead's own height was the sole thing overflowing the scroll container
              (empty state is h-full = container), forcing a pointless scrollbar. No
              rows also means the column labels have nothing to label. */}
          {actions.length > 0 && (
          <thead>
            <tr className="h-row">
              <th className="sticky top-0 z-10 bg-bg-surface shadow-[inset_0_-1px_0_var(--color-border-subtle)]">
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      if (allSelected) {
                        setSelectedIndices(new Set());
                      } else {
                        setSelectedIndices(new Set(actions.map((_, i) => i)));
                      }
                    }}
                    className="flex items-center justify-center cursor-pointer"
                  >
                    <CheckboxBox checked={allSelected} />
                  </button>
                </div>
              </th>
              <th className="sticky top-0 z-10 bg-bg-surface shadow-[inset_0_-1px_0_var(--color-border-subtle)] text-left label-micro text-text-tertiary pl-3">#</th>
              {columnVisibility.action && <th className="sticky top-0 z-10 bg-bg-surface shadow-[inset_0_-1px_0_var(--color-border-subtle)] text-left label-micro text-text-tertiary pl-1">Action</th>}
              {columnVisibility.details && <th className="sticky top-0 z-10 bg-bg-surface shadow-[inset_0_-1px_0_var(--color-border-subtle)] text-left label-micro text-text-tertiary pl-1">Details</th>}
              {columnVisibility.delay && <th className="sticky top-0 z-10 bg-bg-surface shadow-[inset_0_-1px_0_var(--color-border-subtle)] text-right label-micro text-text-tertiary pl-2 pr-2">Delay</th>}
              {columnVisibility.notes && <th className="sticky top-0 z-10 bg-bg-surface shadow-[inset_0_-1px_0_var(--color-border-subtle)] text-left label-micro text-text-tertiary pl-2 pr-2">Notes</th>}
            </tr>
          </thead>
          )}
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          <tbody ref={tbodyRef} onMouseOver={handleRailHover} onMouseLeave={clearRailHover}>
            {actions.map((action, idx) => {
              const colors = getActionTypeColors(action.actionType);
              // No isHighlighted / isPausedHere here on purpose. Both used to be derived per
              // row from the replay index, which is what dragged the whole map onto the
              // per-action re-render path. ReplayRowMarker writes data-replay="running" |
              // "paused" on the one row that needs it and index.css does the rest.
              const isSelected = selectedIndices.has(idx);
              const displayKey = rowDisplayKey(action, dataTable.rows.length);
              const displayX = getDisplayX(action);
              const displayY = getDisplayY(action);
              // The two Details texts a single click edits in place (see openSpanEditor).
              const isKeyHalf = action.actionType === 'KeyDown' || action.actionType === 'KeyUp';
              const coordsEditable = isCoordinateClick(action.actionType) && !action.atCursor;

              const isDragged = dragIndexSet?.has(idx) ?? false;
              // Skip propagation: when an opener row (If / While / ForEachRow) carries
              // IsSkipped, every row inside its block renders dimmed (opacity-40) too.
              // One transitive walk shared with the status bar's estimate: blockOpenerOf only
              // knows the INNERMOST opener, so an enabled If nested inside a disabled If used to
              // paint as if it would run, while the engine elides the whole outer block.
              const isSkipped = skippedMask[idx] === true;
              // Profile-drag insertion preview — rows at/below the drop position
              // slide down one row height (transform, not layout) so the list
              // physically parts to open space, matching the dnd-kit row-reorder
              // language. dropTarget is only ever set by the profile-drag flow.
              const profileShift = dropTarget !== null && idx >= dropTarget;
              const profileDragTransition = dropTarget !== null
                ? 'transform 150ms cubic-bezier(0.2, 0, 0, 1)'
                : undefined;

              // Structural rows of BOTH families (If/Else/EndIf and While/ForEachRow/EndLoop)
              // carry their own scope rail in addition to any outer-block rails, get a subtle
              // tinted bg, and (If only) anchor the "+ Add Else" ghost row injected below.
              // Rails keep encoding DEPTH, not family — BLOCK_LEVEL_COLORS untouched.
              const isStructural = action.actionType === 'If' || action.actionType === 'ElseIf' || action.actionType === 'Else' || action.actionType === 'EndIf'
                || action.actionType === 'While' || action.actionType === 'ForEachRow' || action.actionType === 'EndLoop';
              // The two ENDS of a block, split out of isStructural because only they cap a rail:
              // an ElseIf / Else sits mid-block and its rail has to run straight through. Both
              // families share the treatment — a loop is bracketed exactly like a conditional.
              const isBlockOpener = action.actionType === 'If' || action.actionType === 'While' || action.actionType === 'ForEachRow';
              const isBlockCloser = action.actionType === 'EndIf' || action.actionType === 'EndLoop';
              const depth = blockInfo.depth[idx] || 0;
              // The block this row belongs to (its own for structural rows, the enclosing one for
              // body rows) — what the tbody's mouseover reads to light the rails, and what the
              // tooltips below describe.
              const rowOwner = blockInfo.blockOpenerOf[idx];
              const rowCloser = rowOwner !== null ? blockInfo.closerOf.get(rowOwner) : undefined;
              // A marker with nothing to pair with: an else/endif/end loop the walk could not attach
              // (orphan) or an opener with no closer. The load-time validator strips these, but a
              // paste or a hand-edited file can leave one — it used to render as an ordinary
              // depth-0 row. Now its own rail and wash go recording-red and the pill says why.
              const broken = isStructural && (rowOwner === null || (isBlockOpener && rowCloser === undefined));
              const blockTip = !isStructural ? undefined
                : broken
                  ? (isBlockOpener
                      ? tt(`No matching ${action.actionType === 'If' ? 'endif' : 'end loop'}`, `Sem ${action.actionType === 'If' ? 'endif' : 'end loop'} correspondente`)
                      : tt(`No matching ${action.actionType === 'EndLoop' ? 'loop' : 'if'}`, `Sem ${action.actionType === 'EndLoop' ? 'loop' : 'if'} correspondente`))
                  : isBlockOpener
                    ? tt(`Ends at row ${(rowCloser as number) + 1}`, `Termina na linha ${(rowCloser as number) + 1}`)
                    : isBlockCloser
                      ? tt(`Closes ${actionPillLabel(actions[rowOwner as number])} · row ${(rowOwner as number) + 1} · ${idx - (rowOwner as number) - 1} ${idx - (rowOwner as number) - 1 === 1 ? 'row' : 'rows'}`,
                           `Fecha ${actionPillLabel(actions[rowOwner as number])} · linha ${(rowOwner as number) + 1} · ${idx - (rowOwner as number) - 1} linha${idx - (rowOwner as number) - 1 === 1 ? '' : 's'}`)
                      : tt(`Branch of if · row ${(rowOwner as number) + 1}`, `Ramo do if · linha ${(rowOwner as number) + 1}`);
              // Body rows of a conditional block (depth ≥ 1, non-structural) get a
              // softer wash of the same IF hue so the whole block reads as one band,
              // not just its If/Else/EndIf brackets.
              const isInBlock = !isStructural && depth > 0;
              // Rail count = depth (= rails for outer blocks) + 1 extra rail for the
              // structural row's own scope. A top-level IF (depth=0, structural) renders
              // 1 rail. A nested IF (depth=1, structural) renders 2 (outer + its own).
              // Body rows render `depth` rails (no extra for self).
              const railCount = isStructural ? depth + 1 : depth;
              // Indent rule (user-requested):
              //  • Body rows inside a TOP-LEVEL IF (depth=1) stay aligned with rows
              //    outside the block — a single IF doesn't visually push its content
              //    to the right. The rail to the left already conveys "this row is
              //    in a block", so the extra indent felt redundant.
              //  • Body rows inside a NESTED IF (depth ≥ 2) DO indent so the user
               //   can see the nesting at a glance.
              //  • Structural rows (If / Else / EndIf themselves) still indent per
              //    depth so a nested IF/Else/EndIf sits past its outer rail (otherwise
              //    the pill would overlap the rail visually).
              const indentPx = isStructural ? depth * 14 : Math.max(0, depth - 1) * 14;

              // Colour for THIS row's own block level (rainbow-bracket scheme): a structural
              // If/Else/EndIf belongs to its own level (= depth); a body row belongs to the
              // block that encloses it (= depth − 1). Exposed via the --row-block-color custom
              // prop so the row's bg AND its hover variant can both reference it. Level 0 resolves
              // to the user's IF colour, so a single-level block looks exactly as it did before.
              const rowBlockColor = broken ? 'var(--color-recording)' : blockColor(isStructural ? depth : depth - 1);

              // Ghost "+ Add Else If / + Add Else" row — rendered just BEFORE the ANCHOR of
              // the block's branch chain: the terminal ELSE when the block has one, otherwise
              // the ENDIF. That is exactly where a new arm has to land — every arm must precede
              // the unconditional ELSE, because nothing after it is reachable — so the
              // affordance sits where the row it creates will appear. For a block with no ELSE
              // this is byte-identical to the old "before the EndIf" placement. Disabled during
              // recording/replay to avoid mid-run mutations.
              const enclosingOpener = blockInfo.blockOpenerOf[idx];
              const chainOpener = enclosingOpener !== null && actions[enclosingOpener]?.actionType === 'If'
                ? enclosingOpener            // typed stack makes this a tautology; belt for hand-fed lists
                : null;
              const chainAnchor = chainOpener !== null
                ? (blockInfo.elseOf.get(chainOpener) ?? blockInfo.closerOf.get(chainOpener) ?? null)
                : null;
              const showAddElseBefore = chainAnchor === idx;
              const addElseDepth = showAddElseBefore && chainOpener !== null ? blockInfo.depth[chainOpener] : 0;
              // A block may gain arms forever, but only ONE terminal Else — once it has one the
              // second button disappears while "+ Add Else If" stays.
              const canAddPlainElse = showAddElseBefore && chainOpener !== null && !blockInfo.hasElse.has(chainOpener);

              // ElseIf / Else / EndIf / EndLoop rows cannot be dragged on their own — structural
              // markers bound to their opener; moving one in isolation would orphan the
              // block. (Dragging the opener row carries the whole block instead.)
              const rowSortDisabled = !isDraggable
                || action.actionType === 'ElseIf'
                || action.actionType === 'Else'
                || action.actionType === 'EndIf'
                || action.actionType === 'EndLoop';

              return (
                <SortableRowShell key={action.id ?? idx} id={action.id ?? `row-${idx}`} disabled={rowSortDisabled}>
                {(sortable) => (
                <Fragment>
                {/* Stays mounted during a row drag — sortable rects are measured once
                    at drag start, so unmounting it mid-drag would leave every rect
                    below it stale by one row height. It isn't a sortable item, so it
                    won't slide with its neighbours; a minor cosmetic trade-off. */}
                {showAddElseBefore && chainOpener !== null && (
                  <tr
                    // Same amber tint AND height as structural rows so the block reads as
                    // one uniform band. Earlier attempts used h-7 (28 px) for a thinner
                    // "ghost feel", but that broke the visual rhythm — the user perceived
                    // it as an incomplete row even though the color was identical. Matching
                    // h-row makes the Add Else slot sit naturally inside the block strip.
                    // Shifts with its neighbours during a profile-drag insert preview —
                    // it isn't a sortable item, so it needs the transform applied by hand.
                    style={{
                      // Tint the ghost slot with the colour of the block it belongs to so it
                      // sits inside that block's coloured band, not a generic IF-hued strip.
                      ['--row-block-color' as string]: blockColor(addElseDepth),
                      transform: profileShift ? 'translateY(var(--ui-row-height))' : undefined,
                      transition: profileDragTransition,
                    } as React.CSSProperties}
                    // No pointer-events-none on the TR: it carries data-block-open, and the
                    // delegated mouseover looks for the nearest tr. With the row inert, the hit
                    // test fell through to the tbody outside the two buttons, closest('tr') was
                    // null, and the block rail went DARK as the pointer crossed this band — then
                    // lit again on the EndIf. Nothing here is clickable: the row has no onClick,
                    // no context menu and no sortable listeners, and .block-rail sets its own
                    // pointer-events: none. The inert td below keeps the cell itself out of the
                    // way; the tr stays the hit target underneath it.
                    className="h-row border-b border-border-subtle relative bg-[color-mix(in_srgb,var(--row-block-color)_6%,transparent)]"
                    data-block-open={chainOpener ?? undefined}
                  >
                    <td colSpan={99} className="p-0 relative pointer-events-none">
                      {/* The ghost slot used to render NO rails, so every block with an Add-Else row
                          had its bracket cut in two just above the endif — a gap that now reads as
                          "one block ended, another began". It sits at BODY position inside the block
                          whose opener is at addElseDepth, so it draws that block's rail plus every
                          enclosing one: addElseDepth + 1 rails, all at wash strength, never capped.
                          Anchors to this td rather than the tr, but the colSpan=99 td starts at the
                          row's left edge, so the same left = 78 + i*14 lands in the same place. */}
                      {Array.from({ length: addElseDepth + 1 }, (_, i) => (
                        <div
                          key={`rail-${i}`}
                          className="block-rail"
                          // The ghost sits at body position right before the anchor (Else / EndIf),
                          // so it draws exactly the anchor's rails and answers to the same blocks.
                          data-rail-block={chainAnchor !== null ? blockInfo.railOpeners[chainAnchor]?.[i] : undefined}
                          style={{ left: `${78 + i * 14}px`, ['--rail-color' as string]: blockColor(i) } as React.CSSProperties}
                        />
                      ))}
                      <span
                        className="inline-flex items-center gap-1.5"
                        style={{
                          // Anchor the chips past the rails of the containing block so they
                          // visually sit inside that block's scope at the same indent the
                          // body rows use. 78 (col-2 boundary) + addElseDepth*14 (depth indent)
                          // + 4 (default pl-1) lands the first button just past the IF's rail.
                          marginLeft: `${78 + addElseDepth * 14 + 4}px`,
                        }}
                      >
                        {/* Else If comes FIRST: it is the repeatable one (a chain can grow
                            without limit) while "+ Add Else" closes the block off for good. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setElseIfPicker({ x: r.left, y: r.bottom + 2, ifRowIndex: chainOpener });
                          }}
                          disabled={buttonStates.recordingActive || buttonStates.replayActive}
                          className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-medium rounded border border-dashed transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            // Plain text-primary, NOT a mix toward the block hue. The old 72% mix
                            // was inherited from the W1 pill recipe, but a pill supplies its own
                            // tinted background to sit on and these chips are transparent on the
                            // ghost band — measured across 37 themes x 5 nesting levels x rest /
                            // hover / bracket-lit, it bottomed out at 2.37:1 and missed AA in 328
                            // of 740 samples. Every partial tint down to 15% still misses. The hue
                            // stays on the dashed border, which carries no reading load.
                            color: 'var(--color-text-primary)',
                            borderColor: 'color-mix(in srgb, var(--row-block-color) 35%, transparent)',
                            background: 'transparent',
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                          data-add-else
                        >
                          <Plus size={11} />
                          Add Else If
                        </button>
                        {canAddPlainElse && (
                          <button
                            type="button"
                            onClick={() => send({ type: 'actions:addElseBranch', payload: { ifRowIndex: chainOpener } })}
                            disabled={buttonStates.recordingActive || buttonStates.replayActive}
                            className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-medium rounded border border-dashed transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{
                              // Same measured recipe as the sibling chip above.
                              color: 'var(--color-text-primary)',
                              borderColor: 'color-mix(in srgb, var(--row-block-color) 35%, transparent)',
                              background: 'transparent',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            data-add-else
                          >
                            <Plus size={11} />
                            Add Else branch
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                )}
                <tr
                  // Prefer action.id for React reconciliation — without it, drag-reorder
                  // and undo/redo end up with the wrong DOM nodes mapped to actions,
                  // breaking highlight state and replaying entrance animations on rows
                  // that didn't actually change. Falls back to idx for the brief window
                  // between an old-profile backend push (no id yet) and the next refresh
                  // after migration runs. It also keeps the replay mark honest: the
                  // data-replay attribute rides the DOM node, so a keyed row carries it
                  // to wherever the row moved instead of stranding it on a stale slot.
                  //
                  // setNodeRef passed straight through rather than wrapped in an arrow: a
                  // fresh closure each render makes React detach (ref(null)) and reattach
                  // dnd-kit's node on EVERY row render, which is work for nothing.
                  ref={sortable.setNodeRef}
                  // data-row-id feeds the FLIP-on-drop measurement (see the
                  // pendingFlipRects layout effect). Only rows with a real backend
                  // id participate — index-keyed fallbacks can't be tracked across
                  // a reorder.
                  data-row-id={action.id ?? undefined}
                  // data-row-index is how ReplayRowMarker finds the executing row without this
                  // component ever knowing which one it is. It has to be an attribute and not a
                  // positional lookup: the tbody also holds the "+ Add Else" ghost rows and the
                  // drag drop-gap row, so nth-child would drift off by one inside any block.
                  data-row-index={idx}
                  aria-selected={isSelected}
                  {...sortable.listeners}
                  onClick={(e) => handleRowClick(idx, e)}
                  onContextMenu={(e) => handleRowContextMenu(idx, e)}
                  // Which block the tbody's delegated mouseover lights when the pointer is on this
                  // row — its own block for a marker, the enclosing one for a body row. Absent
                  // outside any block, so the lighting clears there.
                  data-block-open={rowOwner ?? undefined}
                  // The transform/transition pair is dnd-kit's live slide for row reorder;
                  // the profileShift branch reuses the same language for profiles dragged
                  // over the grid (rows at/below the insert point slide down one slot to
                  // open space).
                  style={{
                    // Per-level block colour, consumed by the bg + hover classes below and
                    // inherited by the scope rails' container. Level 0 === the IF colour.
                    ['--row-block-color' as string]: rowBlockColor,
                    transform: sortable.transform
                      ? CSS.Translate.toString(sortable.transform)
                      : (profileShift ? 'translateY(var(--ui-row-height))' : undefined),
                    transition: sortable.transition ?? profileDragTransition,
                  } as React.CSSProperties}
                  className={`group h-row border-b border-border-subtle transition-colors relative ${
                    // Cursor signals draggability: grabbing during an active drag, grab on
                    // hover when THIS row can be dragged (per-row — Else/EndIf are pinned
                    // to their block), default otherwise (recording/replaying/editing).
                    dragIndices !== null
                      ? 'cursor-grabbing'
                      : !rowSortDisabled
                        ? 'cursor-grab'
                        : 'cursor-default'
                  } ${
                    isDragged ? 'opacity-40' : ''
                  } ${
                    isSkipped ? 'opacity-40' : ''
                  } ${
                    // The executing row (replay-green wash + inset bar) and the paused-here row
                    // (pause colour + pulse) used to sit at the head of this cascade. They moved
                    // to index.css under tr[data-replay=...], written by ReplayRowMarker — the
                    // rules there are specific enough to override whichever branch below wins,
                    // hover variants included. See the note above the row map.
                    isSelected
                      ? 'bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)] hover:bg-bg-elevated'
                      : isStructural
                        // Structural row tint replaces the odd/even striping so the
                        // whole IF / ELSE / ENDIF row group reads as a cohesive scope
                        // marker, distinct from the body rows it brackets. The hue comes
                        // from --row-block-color (per nesting level), so a nested block
                        // reads in a different colour from its parent. Hovering mixes that
                        // hue into the elevated colour so the block tint survives the hover.
                        ? 'bg-[color-mix(in_srgb,var(--row-block-color)_6%,transparent)] hover:bg-[color-mix(in_srgb,var(--row-block-color)_10%,var(--color-bg-elevated))]'
                        : isInBlock
                          ? 'bg-[color-mix(in_srgb,var(--row-block-color)_3%,transparent)] hover:bg-[color-mix(in_srgb,var(--row-block-color)_7%,var(--color-bg-elevated))]'
                          : idx % 2 === 0
                            ? 'bg-bg-surface hover:bg-bg-elevated'
                            // Odd-row stripe: a whisper of text-primary instead of a
                            // fixed white overlay — follows the theme (darkens on
                            // light themes) and keeps the zebra extra-subtle (1%).
                            : 'bg-[color-mix(in_srgb,var(--color-text-primary)_1%,transparent)] hover:bg-bg-elevated'
                  }`}
                >
                  {/* Checkbox — the entire row is the drag target (handleRowMouseDown);
                      the cursor switches to grab/grabbing on hover/drag, which is
                      affordance enough. An earlier draft swapped in a GripVertical icon
                      on hover but it competed visually with the checkbox and added
                      noise to a dense grid.
                      Also hosts the conditional-block rails as absolutely-positioned
                      siblings of the Checkbox. They anchor to the <tr> (the nearest
                      position:relative ancestor — see the row's className above) rather
                      than this td, so `left: 78px` is measured from the row's left edge.
                      Placing the rails INSIDE an existing td (vs a separate colSpan=99
                      overlay td) is mandatory: an absolute-positioned td still consumes
                      a column slot in `table-fixed` layout, which would shift every
                      subsequent td (checkbox / # / Action / Key / X / Y / Delay / Notes)
                      one column to the right — the alignment bug we hit before this fix. */}
                  <td className="w-7">
                    {railCount > 0 && Array.from({ length: railCount }, (_, i) => {
                      const isInnermost = i === railCount - 1;
                      const strong = isStructural && isInnermost;
                      // CAPS — what turns a rail into a BRACKET. Only the row's own (innermost)
                      // rail caps, and only at the end it actually is: an opener rounds off at the
                      // top, a closer at the bottom, each inset 4 px. Two adjacent SIBLING blocks
                      // therefore break apart with ~9 px of clear air between the endif's foot and
                      // the next if's head, instead of the seamless line they used to share.
                      // ElseIf/Else never cap — their rail runs through the block they belong to.
                      const capTop = isBlockOpener && isInnermost;
                      const capBottom = isBlockCloser && isInnermost;
                      // Bracket-match: the lit block's rail goes full strength AND 3px wide along
                      // its WHOLE span, body rows included, so the pair reads as one solid bracket
                      // (.block-rail[data-lit] / [data-lit-sel], toggled on the DOM by the tbody
                      // handler and the selection effect — never by this render). It deliberately
                      // does not wash the rows: a translucent tint behind text demotes whatever
                      // already sits near the contrast floor, and measured over 37 themes x 5
                      // nesting levels a 12% wash pushed 522 samples of grid text from >=4.5:1 to
                      // below it in 14 themes. Dimming the wash does not fix it — at 6% it is still
                      // 175 demotions and the lit state becomes INVISIBLE on structural rows, which
                      // already carry a 6% band of the same hue. A neutral bg-elevated wash was
                      // worse still (1254). The rail carries no text, so widening and saturating it
                      // costs nothing. It grows rightward from a fixed `left`, so nothing moves.
                      //
                      // Rail i sits at nesting level i, so it takes that level's colour — each
                      // enclosing block contributes its own coloured rail (rainbow brackets); a
                      // broken marker's own rail goes recording-red instead. data-rail-block names
                      // the block whose rail this is, so lighting one block finds all of its rails.
                      return (
                        <div
                          key={`rail-${i}`}
                          className="block-rail"
                          data-rail-block={blockInfo.railOpeners[idx]?.[i]}
                          data-strong={strong ? '' : undefined}
                          style={{
                            left: `${78 + i * 14}px`,
                            ['--rail-color' as string]: broken && isInnermost ? 'var(--color-recording)' : blockColor(i),
                            // Undefined leaves the utility's top/bottom in force; only a capped end
                            // overrides, so an uncapped rail still meets its neighbour exactly.
                            top: capTop ? '4px' : undefined,
                            bottom: capBottom ? '4px' : undefined,
                            borderRadius: capTop ? '2px 2px 0 0' : capBottom ? '0 0 2px 2px' : undefined,
                          } as React.CSSProperties}
                        />
                      );
                    })}
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={isSelected}
                        stopPropagation
                        onChange={() => {
                          setSelectedIndices(prev => {
                            const next = new Set(prev);
                            if (next.has(idx)) next.delete(idx);
                            else next.add(idx);
                            return next;
                          });
                        }}
                      />
                    </div>
                  </td>

                  {/* Row number — gives way to the program-counter glyph while the replay
                      engine is ON this row (▶ running / ❚❚ paused-here), the second
                      channel that keeps the executing row from reading as a selection.

                      Both halves are always rendered: the number carries data-rownum-value
                      so index.css can hide it under tr[data-replay], and the empty slot is
                      where ReplayRowMarker portals the glyph. A dedicated slot rather than
                      portalling into this <td> directly — the slot has no React children of
                      its own, so nothing the marker appends can collide with this cell's
                      reconciliation. */}
                  <td className="pl-3">
                    <span data-rownum-value className="inline-block text-[11px] font-mono text-text-tertiary leading-none translate-y-[-2px]">{action.rowNumber}</span>
                    <span data-replay-slot />
                  </td>

                  {/* Action type pill */}
                  {columnVisibility.action && (
                  <td
                    className="pl-1"
                    // Extra left padding per nesting level pushes the pill to the right
                    // of all rails. 14 px per level matches the rail spacing so the pill
                    // always sits just past its innermost rail.
                    style={indentPx > 0 ? { paddingLeft: `${4 + indentPx}px` } : undefined}
                  >
                    <span
                      // Skipped rows get a second channel beyond the opacity dim:
                      // strike the pill label (the EyeOff badge below is the third) so
                      // the state survives light themes and grayscale.
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${isSkipped ? 'line-through' : ''}`}
                      style={{ background: colors.bg, color: colors.fg }}
                      // Structural rows only: where the block ends / what it closes / that it has
                      // no pair — the orientation a long block with scrolling otherwise lacks.
                      data-tip={blockTip}
                    >
                      <ActionIcon actionType={action.actionType} />
                      {actionPillLabel(action)}
                      {/* NOT badge — negated IF (IFNOT). Lives in the Action pill next
                          to "if" so the pill reads "if NOT"; the Details cell stays
                          focused on the probe payload. Solid fill (if-fg on the row's
                          surface) so it reads as an emphatic modifier on the keyword. */}
                      {/* Assert carries the same conditionNegate and it matters MORE there: an If
                          shows both outcomes in the block below it, but "require X" and "require
                          NOT X" are opposite guards that would otherwise render identically. */}
                      {hasConditionFields(action.actionType) && action.conditionNegate && (
                        // No tooltip: the badge reads NOT next to the condition it negates, which
                        // is the whole of what the tip used to spell out.
                        <span
                          className="ml-0.5 px-1 rounded text-[10px] font-bold tracking-wider"
                          style={{ background: 'var(--color-action-if-fg)', color: 'var(--color-bg-surface)' }}
                        >
                          NOT
                        </span>
                      )}
                      {/* Repeat indicator — Keystroke press-cycles, click × N (single + multi),
                          and RunProfile sub-call counts. Lives inside the Action pill instead of
                          the Key column because long profile names used to push "×N" past the Key
                          col's truncation point and hide the repetition from the user. Paired
                          halves (LeftClickDown/Up) don't repeat, so they're excluded. Only renders
                          when count > 1 (default 1 = no badge). */}
                      {(action.actionType === 'Keystroke' || action.actionType === 'RunProfile'
                        || isCombinedClick(action.actionType))
                        && (action.repeatCount ?? 1) > 1 && !action.runOverData && (
                          <span className="ml-0.5 opacity-75">×{action.repeatCount}</span>
                        )}
                      {/* Phase C indicator — the sub-profile runs once per row of ITS data
                          table (Repeat is ignored, so the ×N badge above yields to this). */}
                      {action.actionType === 'RunProfile' && action.runOverData && (
                        <span className="ml-0.5 opacity-75">{'· per row'}</span>
                      )}
                      {/* Focus-click indicator — a small icon inside the Action pill (never a new
                          column) marking combined clicks that replay twice to focus a small
                          target. Only renders when the per-action flag is on, so off-rows stay
                          clean. Toggled from the row context menu ("Focus click"). */}
                      {action.isFocusClick
                        && isFocusClickEligible(action.actionType) && (
                          <Focus size={11} className="ml-0.5 opacity-80" />
                        )}
                      {/* At-cursor indicator — same treatment as the focus-click icon (inside the
                          pill, never a new column). It carries real weight here: the Details cell
                          has no COORDINATES for these rows, so without the icon a coordinate-less
                          click is indistinguishable from one whose coords just aren't set. Two
                          channels: the icon AND the conspicuous absence of the numbers. (A hold
                          still prints its "<n> ms" there — that is the duration, not a point,
                          so the absence it has to be read against is still total.) */}
                      {action.atCursor
                        && isCombinedClick(action.actionType) && (
                          <MousePointer2
                            size={11}
                            className="ml-0.5 opacity-80"
                            data-tip={tt('Clicks at the cursor position', 'Clica na posição do cursor')}
                          />
                        )}
                    </span>
                    {isSkipped && (
                      <EyeOff
                        size={11}
                        className="inline-block ml-1.5 text-text-tertiary translate-y-[-1px]"
                      />
                    )}
                  </td>
                  )}

                  {/* Details — the merged Key + X + Y column. Keyboard-ish actions
                      render their key/text/combo chip, mouse actions render the
                      "x, y" coordinate pair, If-pixel rows render both (hex chip +
                      probe coords). */}
                  {columnVisibility.details && (() => {
                    return (
                  <td
                    // No onClick on the CELL: a click on Details selects the row like any
                    // other cell (owner decision, 07-03 — the hover pencil / Enter / context
                    // menu are the editor). The narrow exception is the TEXT of two fields,
                    // which edits in place on a single click: a click's "x, y" and a
                    // KeyDown/KeyUp's key (the spans below, via openSpanEditor). Everything
                    // else in the cell, padding included, still selects; press-and-drag from
                    // the text still reorders (the sensor needs 8 px of movement first).
                    // `relative` anchors the hover-edit pencil to THIS cell's right
                    // edge (moved here from Notes so it sits nearer the middle).
                    className="pl-1 relative"
                  >
                    {editingCell?.index === idx && editingCell.field === 'coords' ? (
                      <span className="relative inline-block">
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editValue}
                          onChange={(e) => { setEditValue(e.target.value); setEditInvalid(false); }}
                          onKeyDown={handleEditKeyDown}
                          onBlur={() => commitEdit('blur')}
                          placeholder="x, y"
                          className={`w-[100px] h-6 px-1 text-xs font-mono text-text-primary bg-bg-input border rounded outline-none ${editInvalid ? 'border-recording' : 'border-accent-solid'}`}
                        />
                        {/* Inline hint, not data-tip: TooltipLayer is mouseover-driven
                            and the pointer is rarely over the input at rejection time
                            (the user just pressed Enter). Clears on the next keystroke. */}
                        {editInvalid && (
                          <span className="absolute left-0 top-full mt-1 z-20 px-2 py-1 rounded text-[10px] whitespace-nowrap bg-bg-card border border-recording/40 text-recording pointer-events-none">
                            {'Needs both coordinates — e.g. 960, 540'}
                          </span>
                        )}
                      </span>
                    ) : editingCell?.index === idx && editingCell.field === 'key' ? (
                      <input
                        ref={editInputRef}
                        type="text"
                        value=""
                        readOnly
                        placeholder="New key..."
                        // The key arrives from the hook (useSingleKeyCapture), which swallows the
                        // keyboard while armed — this field only holds focus, so a click anywhere
                        // else cancels. preventDefault is for a key that reaches the page anyway
                        // (the hook stands down when the app is not in front).
                        onKeyDown={(e) => e.preventDefault()}
                        onBlur={cancelEdit}
                        className="w-[220px] h-6 px-1 text-xs font-mono text-accent-light bg-bg-input border border-accent-solid rounded outline-none placeholder:text-accent-light/50 animate-pulse"
                      />
                    ) : isProbeAction(action) ? (
                      // Image/pixel probe (Wait* or If/While) — unified payload, no GUID.
                      <><ProbeDetails action={action} />{whileCapSuffix(action)}</>
                    ) : isConditionAction(action) ? (
                      // Window / Clipboard / Browser-Element If/While — icon tag + value.
                      <><ConditionDetails action={action} />{whileCapSuffix(action)}</>
                    ) : (<>
                    {displayKey ? (
                      <span
                        // A KeyDown/KeyUp's key edits in place on a single click (captured
                        // through the hook — see commitKeyCapture). Every other type's text
                        // is display only (editing is the hover pencil); Keystroke and
                        // HoldKey keep their dialog. data-tip still surfaces the full string
                        // for truncated content.
                        className={`inline-flex items-center translate-y-[-2px] text-xs font-mono text-text-primary max-w-[220px] truncate ${isKeyHalf ? 'cursor-text' : ''}`}
                        onPointerDown={isKeyHalf ? markSpanPress : undefined}
                        onClick={isKeyHalf ? (e) => openSpanEditor(e, idx, 'key', action.key) : undefined}
                        // Tighten the " + " separators of a combined keystroke ("Ctrl + Alt + A")
                        // WITHOUT gluing the keys together, matching the ProfilePanel hotkey chips.
                        // wordSpacing is the only lever that works here: this cell is font-mono, so
                        // a Unicode thin/hair space would occupy the same cell as a normal one (the
                        // same reason KbdTag's unified branch uses wordSpacing). The chips sit at
                        // 10px where -1.5px leaves a ~4.5px gap; this cell is text-xs (12px), so the
                        // equivalent shave is -2.5px. Keystroke only — every other action type puts
                        // prose in this cell ("Maximize · notepad", "name = value") whose ordinary
                        // spaces must stay ordinary.
                        style={action.actionType === 'Keystroke' ? { wordSpacing: '-2.5px' } : undefined}
                        // REVEAL tips only (see TooltipLayer): each one carries this cell's own
                        // value, so it shows only when the 220 px cap actually clipped it. What
                        // reaches here is what a column cannot hold — a paragraph of SendText, a
                        // long CSS selector or URL, a variable value — and reading it on hover
                        // beats opening the editor. ActivateWindow was dropped: its summary
                        // ("Maximize · notepad") is short and already fully drawn in the cell.
                        data-tip-reveal
                        data-tip={
                          action.actionType === 'SendText' ? action.key
                          : action.actionType.startsWith('Browser') ? action.key
                          // Cycle rows list the items (· separated — the tip layer collapses
                          // newlines) instead of asserting an "=" assignment that never happens.
                          : action.actionType === 'SetVariable' && action.key
                            ? (action.variableMode === 'cycle'
                                ? `${action.key} ⟳ ${(action.variableValue ?? '').split('\n').filter(l => l.trim()).join(' · ')}`
                                : action.variableMode === 'add'
                                  ? `${action.key} += ${action.variableValue ?? ''}`
                                  : `${action.key} = ${action.variableValue ?? ''}`)
                          : undefined
                        }
                        // dblclick handler lives on the parent <td> (see above) so
                        // empty Key cells (WaitImage, WaitPixelColor with no value)
                        // also respond. Events bubble from this span to the td.
                      >
                        {/* Probe rows (Wait Image / Pixel, If image / pixel) render via
                            ProbeDetails above — the NOT badge + swatch live there now. */}
                        {/* SendText payloads can contain `{Enter}` / `{delay:500}` /
                            `{Clipboard:...}` tokens. Render them as the same pink chips
                            used in the Lexical-based Edit Text dialog so the cell mirrors
                            what the editor shows. Other action types keep the plain
                            displayKey text — they don't have token syntax. */}
                        {action.actionType === 'SendText'
                          ? <SendTextPreview
                              text={action.key}
                              badge={sendTextDeliveryBadge(action)}
                              badgeTips={{
                                'rich-split': tt(
                                  'Rich, but a key or delay token splits the text, so replay pastes it as plain. Move the token to an end, split the action, or use Markdown/Discord.',
                                  'Rich, mas um token de tecla ou delay divide o texto, então o replay cola como texto puro. Mova o token para uma ponta, divida a ação ou use Markdown/Discord.',
                                ),
                                'type-drops-rich': tt(
                                  'Type sends keystrokes, no clipboard, so the formatting is not sent. It stays saved: use Paste, or Markdown/Discord to type the marks.',
                                  'Type envia teclas, sem área de transferência, então a formatação não é enviada. Ela fica salva: use Paste, ou Markdown/Discord para digitar as marcas.',
                                ),
                              }}
                            />
                          // Pause / HoldKey / *ClickHold embed a "<n> ms" duration in
                          // displayKey; render it in the Delay column's format
                          // (thousands-separated number + quiet "ms" suffix). All other
                          // types stay plain.
                          : (action.actionType === 'Pause' || action.actionType === 'HoldKey'
                             || isClickHold(action.actionType))
                            ? renderMsDetail(displayKey, language)
                            : displayKey}
                        {/* The Keystroke × N badge that used to live here moved to
                            the Action pill so it stays visible even when the Key
                            column is narrow. The original badge was clickable to
                            reopen the recapture dialog; that affordance is now
                            covered by double-clicking the Key chip (line above),
                            which already routes to setKeystrokeEdit for Keystroke /
                            HoldKey rows. */}
                        {/* Hold-duration now renders inline in displayKey ("<key> / <ms> ms",
                            Pause-style) instead of a separate chip; click-to-edit is the
                            <td> onClick (HoldKey → setKeystrokeEdit). */}
                      </span>
                    ) : null}
                    {/* Coordinate pair — a click row's "x, y", edited in place by a single
                        click on the TEXT (one editMany, one undo). Only coordinate clicks
                        with a point of their own: an at-cursor click shows no pair, and a
                        pixel probe's pair is pixelX/Y (edited in the Sheet), which this
                        editor — it writes x/y — must never be offered. */}
                    {displayX !== '' && (
                      <span
                        className={`text-xs font-mono text-text-secondary tabular-nums ${displayKey ? 'ml-1.5' : ''} ${coordsEditable ? 'cursor-text hover:text-text-primary' : ''}`}
                        onPointerDown={coordsEditable ? markSpanPress : undefined}
                        onClick={coordsEditable ? (e) => openSpanEditor(e, idx, 'coords', `${action.x}, ${action.y}`) : undefined}
                      >
                        {displayX}, {displayY}
                      </span>
                    )}
                    </>)}
                    {/* Hover-reveal Edit pencil — anchored to the DETAILS cell's
                        right edge (the `relative` above). Moved here from the Notes
                        column so it sits nearer the grid's middle and is easier to
                        reach. Opaque fill floats over the cell's rightmost content
                        on hover; routes through openEditorForRow like the context
                        menu's Edit and keyboard Enter. Hidden mid-run and while an
                        inline editor is open; tabIndex -1 (Enter covers keyboard). */}
                    {contextMenuEnabled && !editingCell && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditorForRow(idx); }}
                        tabIndex={-1}
                        // NO data-tip, and this is a standing decision — do not "fix" it again.
                        // It was pruned on purpose in the tooltip audit that cut 65 of 142 tips, which
                        // names this one in its own message ("keyboard-shortcut tips … Edit Enter").
                        // It was restored on 2026-09-12 on the argument that an icon-only control with
                        // no label anywhere deserves one, and the owner reverted it the same day after
                        // SEEING it: the pencil only exists while the row is hovered, so its tooltip
                        // fires on the same pointer motion that scans the grid — a tip on a control
                        // that appears under the cursor reads as noise, not as help.
                        // aria-label stays: it names the button for a screen reader and paints nothing.
                        aria-label="Edit action"
                        className="hidden group-hover:flex absolute right-1.5 top-1/2 -translate-y-1/2 items-center justify-center w-6 h-6 rounded bg-bg-elevated border border-border-subtle text-text-tertiary hover:text-text-primary hover:border-border-default transition-colors"
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                  </td>
                    );
                  })()}

                  {/* Delay — single click anywhere in the cell opens the editor
                      (same guard chain as the Details cell). */}
                  {columnVisibility.delay && (
                  <td
                    // Else/EndIf have no delay — blank cell, not editable. The If shows + edits its
                    // delay (a "wait before the probe" knob), so it's not in NO_DELAY_TYPES.
                    className={`pl-2 ${NO_DELAY_TYPES.has(action.actionType) ? '' : 'cursor-text'}`}
                    onClick={NO_DELAY_TYPES.has(action.actionType) ? undefined : (e) => {
                      if (editingCell) return;
                      if (dragOccurred.current) return;
                      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
                      e.stopPropagation();
                      startEdit(idx, 'delay', String(action.delay >= 0 ? action.delay : 0));
                    }}
                  >
                    {NO_DELAY_TYPES.has(action.actionType) ? null
                      : editingCell?.index === idx && editingCell.field === 'delay' ? (
                      <span className="relative inline-block">
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editValue}
                          onChange={(e) => { setEditValue(e.target.value); setEditInvalid(false); }}
                          onKeyDown={handleEditKeyDown}
                          onBlur={() => commitEdit('blur')}
                          className={`w-16 h-6 px-1 text-xs font-mono text-right text-text-primary bg-bg-input border rounded outline-none ${editInvalid ? 'border-recording' : 'border-accent-solid'}`}
                        />
                        {/* Same inline hint as the coords editor, for the same reason. */}
                        {editInvalid && (
                          <span className="absolute right-0 top-full mt-1 z-20 px-2 py-1 rounded text-[10px] whitespace-nowrap bg-bg-card border border-recording/40 text-recording pointer-events-none">
                            {'Use a whole number of ms — 0 or more'}
                          </span>
                        )}
                      </span>
                    ) : (
                      // Right-aligned + tabular-nums so a column of delays reads as
                      // one number ladder; the quiet "ms" suffix answers the unit
                      // question the bare integer used to leave open.
                      <span className={`text-xs font-mono tabular-nums block text-right pr-2 ${action.delay > 0 ? 'text-text-secondary hover:text-text-primary' : 'text-text-disabled hover:text-text-tertiary'}`}>
                        {formatMs(action.delay >= 0 ? action.delay : 0, language)}
                        <span className={`text-[10px] ml-0.5 ${action.delay > 0 ? 'text-text-tertiary' : 'text-text-disabled'}`}>ms</span>
                      </span>
                    )}
                  </td>
                  )}

                  {/* Notes \u2014 single click anywhere in the cell opens the editor
                      (same guard chain as the Details cell). */}
                  {columnVisibility.notes && (
                  <td
                    className="pl-2 pr-2 cursor-text"
                    onClick={(e) => {
                      if (editingCell) return;
                      if (dragOccurred.current) return;
                      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
                      e.stopPropagation();
                      startEdit(idx, 'comment', action.comment);
                    }}
                  >
                    {editingCell?.index === idx && editingCell.field === 'comment' ? (
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        onBlur={() => commitEdit('blur')}
                        className="w-full h-6 px-1 text-xs text-text-primary bg-bg-input border border-accent-solid rounded outline-none"
                      />
                    ) : (
                      // No group-hover padding shift here \u2014 a hover-only padding
                      // change shoved the note text sideways and read as the row
                      // "jumping". The row stays static; the edit pencil lives in the
                      // Details cell now.
                      <span className="text-xs text-text-tertiary truncate block hover:text-text-secondary">
                        {action.comment || '\u00A0'}
                      </span>
                    )}
                  </td>
                  )}

                </tr>
                </Fragment>
                )}
                </SortableRowShell>
              );
            })}
            {/* Trailing insertion gap — drop position past the last row
                (profile drag only — row reorder slides live via dnd-kit). */}
            {dropTarget === actions.length && actions.length > 0
              && !(dragIndexSet?.has(actions.length - 1)) && (
              <tr data-drop-gap className="pointer-events-none">
                <td colSpan={99} className="p-0">
                  <div
                    className="drop-gap-slot mx-2 my-[3px] rounded border-2 border-dashed overflow-hidden"
                    style={{
                      height: 'calc(var(--ui-row-height) - 6px)',
                      borderColor: 'color-mix(in srgb, var(--color-accent) 45%, transparent)',
                      background: 'color-mix(in srgb, var(--color-accent) 6%, transparent)',
                    }}
                  />
                </td>
              </tr>
            )}
          </tbody>
          </SortableContext>
        </table>

        {/* Empty state */}
        {actions.length === 0 && <MacroEmptyState />}
      </div>

      {/* The replay highlight, as a leaf. Mounted AFTER the table on purpose: layout effects
          run in tree order, so by the time the marker looks for tr[data-row-index] the tbody
          it queries is already in the DOM. Renders null (or one portalled glyph), so a
          re-render at replay cadence costs nothing here — which is the whole point. */}
      <ReplayRowMarker tbodyRef={tbodyRef} />
      {/* Same attribute-and-CSS doctrine, for the rows that just landed (paste / insert / undo). */}
      <InsertedRowMarker tbodyRef={tbodyRef} />

      {/* Drag ghost — a translucent replica of the grabbed row with a lifted-card
          shadow and a slight tilt, Sortable style. Multi-row drags add a "+N"
          count badge. DragOverlay tracks the pointer (and survives auto-scroll);
          dropAnimation is null because the FLIP-on-drop settle handles the
          landing — the default overlay animation would fly the ghost back to the
          row's OLD slot, since the array only reorders after the backend push. */}
      <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
        {dragIndices !== null && activeDragId !== null && (() => {
          const primary = actions[sortableIds.indexOf(activeDragId)];
          if (!primary) return null;
          const ghostColors = getActionTypeColors(primary.actionType);
          // The row's own Details text (rowDisplayKey); clicks keep their point, which is what
          // tells two of them apart.
          const ghostDetail = (isMouseAction(primary.actionType) && !primary.actionType.startsWith('Browser'))
            ? `${primary.x}, ${primary.y}`
            : rowDisplayKey(primary, dataTable.rows.length);
          return (
            <div className="pointer-events-none" style={{ transform: 'rotate(1.5deg)' }}>
              <div
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-bg-card border border-border-default w-[300px]"
                style={{
                  opacity: 0.88,
                  boxShadow: 'var(--shadow-overlay), 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent)',
                }}
              >
                <GripVertical size={12} className="text-text-disabled shrink-0" />
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium shrink-0"
                  style={{ background: ghostColors.bg, color: ghostColors.fg }}
                >
                  <ActionIcon actionType={primary.actionType} />
                  {actionPillLabel(primary)}
                </span>
                {ghostDetail && (
                  <span className="text-xs font-mono text-text-secondary truncate flex-1">
                    {ghostDetail}
                  </span>
                )}
                {dragIndices.length > 1 && (
                  <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-accent-solid text-[color:var(--color-accent-ink)]">
                    +{dragIndices.length - 1}
                  </span>
                )}
              </div>
            </div>
          );
        })()}
      </DragOverlay>
      </DndContext>

      {sendTextEdit && (
        <Suspense fallback={null}>
          <SendTextDialog
            mode="edit"
            initialText={sendTextEdit.text}
            initialHtml={sendTextEdit.html}
            initialMode={sendTextEdit.mode}
            initialMethod={sendTextEdit.method}
            initialCharDelayMs={sendTextEdit.charDelayMs}
            actionIndex={sendTextEdit.index}
            onConfirm={(r) => {
              if (refuseDuringRun()) return;
              send({
                type: 'actions:editSendText',
                payload: {
                  index: sendTextEdit.index,
                  id: sendTextEdit.id,
                  text: r.text,
                  html: r.html ?? undefined,
                  markdown: r.markdown ?? undefined,
                  mode: r.mode,
                  method: r.method,
                  charDelayMs: r.charDelayMs,
                },
              });
              setSendTextEdit(null);
            }}
            onClose={() => setSendTextEdit(null)}
          />
        </Suspense>
      )}


      {/* Unified edit dialog for both Keystroke and HoldKey rows. Seeds Mode from
          the row's ActionType so the dialog opens already showing the right fields.
          On Save the dialog tells us which ActionType the result is; if it differs
          from the original (user toggled Press↔Hold), we emit an actionType edit
          first so the backend has the right shape when subsequent field edits land. */}
      {keystrokeEdit && (() => {
        const editing = actions[keystrokeEdit.index];
        const isHold = editing?.actionType === 'HoldKey';
        const curRepeat = editing?.repeatCount ?? 1;
        const curDelay = editing?.repeatDelayMs ?? 30;
        const curJitter = editing?.repeatDelayJitterPct ?? 0;
        const curDuration = editing?.holdDurationMs && editing.holdDurationMs > 0 ? editing.holdDurationMs : 1000;
        return (
          <KeystrokeCaptureDialog
            initialActionType={isHold ? 'HoldKey' : 'Keystroke'}
            initialKey={editing?.key}
            initialRepeat={curRepeat}
            initialRepeatDelayMs={curDelay}
            initialRepeatDelayJitterPct={curJitter}
            initialHoldDurationMs={isHold ? curDuration : undefined}
            onConfirm={(result) => {
              if (refuseDuringRun()) return;
              const idx = keystrokeEdit.index;
              // ONE message, so ONE undo entry. These used to be up to five separate actions:edit,
              // and the bridge snapshots per call — so undoing a single Save took five Ctrl+Z and
              // walked BACKWARDS through states nobody authored: the first undo left HoldKey with
              // holdDurationMs 0, which the engine reads as "use the shared default", handing the
              // row a duration the user never asked for; the second left the hold on the OLD key.
              // The order inside the batch still matters and is preserved: actionType first, so
              // the later fields land on the right shape.
              const edits: { field: string; value: string }[] = [];
              if (result.actionType !== editing?.actionType) edits.push({ field: 'actionType', value: result.actionType });
              if (result.key !== editing?.key) edits.push({ field: 'key', value: result.key });
              if (result.actionType === 'Keystroke') {
                if (result.repeat !== curRepeat) edits.push({ field: 'repeat', value: String(result.repeat) });
                if (result.repeatDelayMs !== curDelay) edits.push({ field: 'repeatDelayMs', value: String(result.repeatDelayMs) });
                if (result.repeatDelayJitterPct !== curJitter) edits.push({ field: 'repeatDelayJitterPct', value: String(result.repeatDelayJitterPct) });
              } else if (result.holdDurationMs !== curDuration) {
                edits.push({ field: 'holdDurationMs', value: String(result.holdDurationMs) });
              }
              if (edits.length > 0) send({ type: 'actions:editMany', payload: { index: idx, id: keystrokeEdit.id, edits } });
              setKeystrokeEdit(null);
            }}
            onClose={() => setKeystrokeEdit(null)}
          />
        );
      })()}

      {/* Pause edit dialog — same window as the toolbar's Insert Pause, seeded from
          the row. The dialog hands back the resume hotkey + timeout in ms; we diff
          against the current row and emit only the changed fields as actions:edit. */}
      {pauseEdit && (() => {
        const editing = actions[pauseEdit.index];
        return (
          <PauseDialog
            initialKey={editing?.key ?? ''}
            initialTimeoutMs={editing?.timeout ?? 0}
            onConfirm={(key, timeoutMs) => {
              if (refuseDuringRun()) return;
              const idx = pauseEdit.index;
              // One Save, one undo entry — same reason as the keystroke dialog above.
              const edits: { field: string; value: string }[] = [];
              if (key !== (editing?.key ?? '')) edits.push({ field: 'key', value: key });
              if (timeoutMs !== (editing?.timeout ?? 0)) edits.push({ field: 'timeout', value: String(Math.round(timeoutMs)) });
              if (edits.length > 0) send({ type: 'actions:editMany', payload: { index: idx, id: pauseEdit.id, edits } });
              setPauseEdit(null);
            }}
            onClose={() => setPauseEdit(null)}
          />
        );
      })()}

      {runProfileEdit && (
        <RunProfileDialog
          mode="edit"
          initial={{ profileName: runProfileEdit.profileName, repeatCount: runProfileEdit.repeatCount, runOverData: runProfileEdit.runOverData }}
          excludeProfileName={activeProfile ?? undefined}
          onConfirm={(profileName, repeatCount, runOverData) => {
            if (refuseDuringRun()) return;
            send({ type: 'actions:editRunProfile', payload: { index: runProfileEdit.index, id: runProfileEdit.id, profileName, repeatCount, runOverData } });
            setRunProfileEdit(null);
          }}
          onClose={() => setRunProfileEdit(null)}
        />
      )}

      {/* RunProfile insert dialog — opened by dragging a profile onto the grid
          (pre-filled with the dropped profile). The context-menu insert path was
          removed, but drag-to-insert still uses this. */}
      {runProfileInsert && (
        <RunProfileDialog
          mode="add"
          excludeProfileName={activeProfile ?? undefined}
          initial={runProfileInsert.profileName ? { profileName: runProfileInsert.profileName, repeatCount: 1 } : undefined}
          onConfirm={(profileName, repeatCount, runOverData) => {
            if (refuseDuringRun()) return;
            send({ type: 'actions:addRunProfile', payload: { profileName, repeatCount, runOverData, insertIndex: runProfileInsert.insertIndex } });
            setRunProfileInsert(null);
          }}
          onClose={() => setRunProfileInsert(null)}
        />
      )}

      {/* Bulk Action Bar — FLOATS over the grid (absolute, bottom) instead of being
          an inline flex child. As a flex child it shrank the scroll viewport every
          time a selection appeared/cleared, reflowing the list and hiding the just-
          clicked bottom row behind the bar. As an overlay the list never moves; the
          scroll area's pb-9/scroll-pb-9 (above) + the scrollIntoView effect keep the
          bottom rows reachable above it. Reordering (Move Up / Move Down) lives here
          because it requires a selection by definition; canMoveUp/Down disable the
          buttons at the list edges, mirroring the Alt+↑/↓ hotkey's no-op-at-edges. */}
      {bulkBarVisible && (() => {
        const selSorted = Array.from(selectedIndices).sort((a, b) => a - b);
        // Reorder (Move Up/Down) operates on the block-snapped set so moving a selection that
        // touches an If/Else/EndIf marker carries the whole block — never orphaning it — while a
        // pure body-row selection moves as-is. Delete snaps inside its own handler; the other bulk
        // ops (delay/coord/comment/skip) act on the raw selection, so keep selSorted for those.
        const moveSet = snapSelectionToBlocks(selSorted);
        const canMoveUp = moveSet.length > 0 && moveSet[0] > 0;
        const canMoveDown = moveSet.length > 0 && moveSet[moveSet.length - 1] < actions.length - 1;
        // "Has a note" = any non-empty text, a note of only spaces included — Clear takes those too.
        const notedSorted = selSorted.filter(i => (actions[i]?.comment ?? '') !== '');
        return (
        <div className="absolute inset-x-0 bottom-0 z-20">
        <BulkActionBar
          selectedCount={selectedIndices.size}
          allSelectedSkipped={selSorted.every(i => actions[i]?.isSkipped)}
          notedCount={notedSorted.length}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onClearSelection={() => setSelectedIndices(new Set())}
          onDelete={() => {
            // Routed through deleteIntentFor, the same answer the Delete key and the row menu
            // get. This used to snap unconditionally, which was right for every selection EXCEPT
            // a lone marker — and a lone Else If is exactly the case where snapping takes the
            // whole conditional while the bar still reads "1 selected".
            const { message, count } = deleteIntentFor(selSorted);
            send(message);
            showToast(tt(`Deleted ${count} action(s)`, `${count} ação(ões) excluída(s)`), 'success');
            setSelectedIndices(new Set());
          }}
          onMoveUp={() => {
            // Mirror the Alt+↑ hotkey: shift the block-snapped set one slot up and re-emit
            // selection:set so the highlighted rows follow their new positions. Guarded by
            // canMoveUp (derived from the snapped set) so a block already at the top no-ops.
            if (!canMoveUp) return;
            const minIdx = moveSet[0];
            send({ type: 'actions:reorder', payload: { indices: moveSet, targetIndex: minIdx - 1 } });
            // HandleActionsReorder reinserts the removed rows CONTIGUOUSLY at the adjusted
            // target — landing at [minIdx-1 .. minIdx-1+count-1] regardless of whether the
            // (snapped) selection was contiguous. Emit that contiguous landing range so the
            // highlight follows, rather than a per-index i-1 map.
            window.dispatchEvent(new CustomEvent('selection:set', {
              detail: moveSet.map((_, i) => minIdx - 1 + i),
            }));
          }}
          onMoveDown={() => {
            if (!canMoveDown) return;
            const maxIdx = moveSet[moveSet.length - 1];
            // targetIndex = maxIdx + 2 because the reorder API treats the target as the
            // pre-shift insertion point (mirrors the Alt+↓ hotkey behaviour exactly).
            send({ type: 'actions:reorder', payload: { indices: moveSet, targetIndex: maxIdx + 2 } });
            // As in onMoveUp: rows land contiguously. All moved indices are < the target so the
            // backend's adjustedTarget = maxIdx + 2 - count, landing at [maxIdx+2-count .. maxIdx+1].
            const count = moveSet.length;
            window.dispatchEvent(new CustomEvent('selection:set', {
              detail: moveSet.map((_, i) => maxIdx + 2 - count + i),
            }));
          }}
          onSetDelay={(mode, delay) => {
            // ELSE/ENDIF carry no delay — exclude them from the bulk set (their cell is blank). The
            // IF keeps its delay (pre-probe wait), so it's included like any normal action.
            const targets = selSorted.filter(i => !NO_DELAY_TYPES.has(actions[i]?.actionType ?? ''));
            if (targets.length === 0) return;
            // No toast here — HandleBulkUpdateDelay confirms it, as HandleBulkUpdateCoord does for
            // X/Y: only it knows how many rows an Add stopped at 0 ms, and whether anything changed.
            send({ type: 'actions:bulkUpdateDelay', payload: { indices: targets, mode, delay } });
          }}
          onSetCoord={(axis, mode, value) => {
            // No toast here, unlike the three siblings — on purpose. HandleBulkUpdateCoord
            // confirms it itself ("Set X to 500 on N action(s)") because only it knows N: rows that
            // are not coordinate clicks, and at-cursor clicks, are skipped, so a count taken here
            // would overstate it, and a second toast would stack on the backend's.
            send({ type: 'actions:bulkUpdateCoord', payload: { indices: selSorted, axis, mode, value } });
          }}
          onSetComment={(comment) => {
            send({ type: 'actions:bulkUpdateComment', payload: { indices: selSorted, comment } });
            showToast(tt(`Set notes for ${selectedIndices.size} action(s)`, `Notas definidas para ${selectedIndices.size} ação(ões)`), 'success');
          }}
          onClearNotes={() => {
            // The existing message with an empty comment — the backend still takes '' (blank
            // CANCELS is the field's rule, not the message's). Only the rows that had a note are
            // sent, so N in the toast is the rows that actually changed.
            if (notedSorted.length === 0) return;
            send({ type: 'actions:bulkUpdateComment', payload: { indices: notedSorted, comment: '' } });
            showToast(tt(`Cleared notes on ${notedSorted.length} action(s)`, `Notas removidas de ${notedSorted.length} ação(ões)`), 'success');
          }}
          onToggleSkip={() => {
            const allSkipped = selSorted.every(i => actions[i]?.isSkipped);
            send({ type: 'actions:toggleSkip', payload: { indices: selSorted } });
            showToast(
              allSkipped
                ? tt(`Enabled ${selectedIndices.size} action(s)`, `${selectedIndices.size} ação(ões) ativada(s)`)
                : tt(`Skipped ${selectedIndices.size} action(s)`, `${selectedIndices.size} ação(ões) ignorada(s)`),
              'success'
            );
          }}
        />
        </div>
        );
      })()}

      {/* Context Menu — rendered via portal to escape overflow:hidden */}
      {/* Condition-family picker for "+ Add Else If". Portal + fixed positioning, the same
          mould as the row context menu, so it escapes the table's overflow clipping. The
          backend owns WHERE the arm lands (FindBranchChainAnchor) — the UI only says which
          family, exactly like the Conditional ▾ menu. Image / Pixel run the capture overlay
          first, so Esc there inserts nothing. */}
      {/* contextMenuEnabled in the RENDER, not only in the effect above: render wins over effect,
          and this portal must not exist for even one frame while a run is walking the grid. */}
      {contextMenuEnabled && elseIfPicker && elseIfPickerPos && createPortal(
        <div
          ref={elseIfPickerRef}
          className="fixed z-50 min-w-[180px] py-1 menu-surface"
          style={{ left: elseIfPickerPos.x, top: elseIfPickerPos.y }}
        >
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-text-tertiary">
            Else If — condition
          </div>
          {BRANCH_CONDITION_FAMILIES.map(({ ct, Icon, label }) => (
            <button
              key={ct}
              type="button"
              onClick={() => {
                send({ type: 'actions:addElseIfBranch', payload: { ifRowIndex: elseIfPicker.ifRowIndex, conditionType: ct } });
                setElseIfPicker(null);
              }}
              className="menu-item text-text-primary"
            >
              <Icon size={13} className="text-text-tertiary" />
              {label}
            </button>
          ))}
        </div>,
        document.body,
      )}
      {/* contextMenuEnabled is in the RENDER condition, not only in the effect above that clears
          the state. Render beats effect: the effect runs after the commit that already painted a
          live menu over a running grid, and that frame is long enough for a click. */}
      {contextMenu && menuPos && contextMenuEnabled && createPortal(
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[180px] py-1 menu-surface"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          {/* Edit — specialized dialogs for SendText / RunProfile / Keystroke
              (which all carry a single primary payload that has its own capture flow);
              others fall back to the generic sheet panel which edits delay / comment /
              X / Y / key as separate fields. */}
          <button
            onMouseEnter={() => setActiveSubmenu(null)}
            onClick={() => {
              // Shared routing with keyboard Enter — see openEditorForRow.
              openEditorForRow(contextMenu.rowIndex);
              closeContextMenu();
            }}
            className="menu-item text-text-primary"
          >
            <Pencil size={13} className="text-text-tertiary" />
            Edit
          </button>

          {/* Select block — the structural row's type slot, and what replaced "Go to <pair>" on
              2026-09-16. The jump restated what the rail already draws; this hands the block to
              the BULK BAR, which is where skip / move / duplicate live. Until now Delete was the
              only operation that understood a block at all (via the same snap), so "disable this
              whole If" meant dragging a range by hand.

              It selects exactly what snapSelectionToBlocks would take, because it IS that call —
              not a reimplementation of it. That makes "what Select block gives you" and "what the
              block operations act on" the same sentence rather than two that happen to agree.
              From any marker the snap walks to the INNERMOST enclosing pair, so an ElseIf or an
              Else selects its whole If…EndIf, and a nested If selects itself, not its parent.

              Hidden when the snap does not actually widen: a hand-edited orphan EndIf has no
              entry in closerOf, so the call returns the row alone — offering "Select block" there
              would select one row and call it a block. */}
          {(() => {
            const row = actions[contextMenu.rowIndex];
            if (!row || !isStructuralRow(row.actionType)) return null;
            const block = snapSelectionToBlocks([contextMenu.rowIndex]);
            if (block.length < 2) return null;
            return (
              <button
                onMouseEnter={() => setActiveSubmenu(null)}
                onClick={() => {
                  setSelectedIndices(new Set(block));
                  // The keyboard cursor follows the opener: handleGridKeyDown reads kbCursorRef
                  // first, so leaving it behind would make the next Arrow key jump the selection
                  // back to wherever the user last clicked. Same rule the old jump entry followed.
                  lastClickedIndex.current = block[0];
                  kbCursorRef.current = block[0];
                  showToast(tt(`Selected ${block.length} row(s)`, `${block.length} linha(s) selecionada(s)`), 'success');
                  closeContextMenu();
                }}
                data-tip={tt('Selects the whole block, both markers included',
                             'Seleciona o bloco inteiro, com os dois marcadores')}
                className="menu-item text-text-primary"
              >
                {/* Brackets: the caps the rail already draws at a block's two ends (2.28.0), so
                    the glyph names the thing the user is looking at. */}
                <Brackets size={13} className="text-text-tertiary" />
                Select block
              </button>
            );
          })()}

          {/* Pick from screen — click rows only, same gate as the sheet's own Pick button
              (isClickHalf, DoubleClick included). Starts the SAME native pick the sheet
              uses, but BEFORE the sheet exists: App runs the round-trip and then opens
              the sheet with the picked point seeded into the X/Y draft — the user tweaks
              whatever else and Saves, or Cancels and nothing was written. Esc during the
              overlay cancels the whole thing (no sheet), like the capture-first inserts.
              Sits right under Edit per user request. */}
          {(() => {
            const row = actions[contextMenu.rowIndex];
            if (!row || !isCoordinateClick(row.actionType ?? '')) return null;
            // An at-cursor row has nowhere to put a picked point — the replay resolves its own.
            // Offering the pick would run the whole overlay round-trip and write nothing.
            if (row.atCursor) return null;
            return (
              <button
                onMouseEnter={() => setActiveSubmenu(null)}
                onClick={() => {
                  onPickCoords?.(contextMenu.rowIndex);
                  closeContextMenu();
                }}
                className="menu-item text-text-primary"
              >
                <Crosshair size={13} className="text-text-tertiary" />
                Pick from screen
              </button>
            );
          })()}

          {/* Change click type ▸ — the click row's SECOND type slot, and the answer to the thing
              that had no route at all: a click's FORM. The Sheet's picker changes which BUTTON a
              row uses and carefully PRESERVES the Down/Up suffix; the palette's convert rewrites
              the WHOLE profile. Between them there was no way to make one click paired, which is
              why a hand-built drag was impossible (a drag IS a Down and an Up on different points).

              The eight chips come from CLICK_FAMILY_TYPES — the Sheet's own list, shared since
              2026-09-16 — in the Sheet's order, which IS the grouping (buttons · the same three
              held · the left-button multi-clicks).

              SUFFIX IS PRESERVED, exactly as the Sheet does it: on a Down row the chips read
              "Left Click" and write LeftClickDown. The five combined-only entries (Double, Triple,
              the three Holds) are filtered out there, because converting one half into a whole
              press would orphan its twin — a lone LeftClickUp releasing a button nobody pressed.

              Split / Merge are NOT gated here beyond the row's form. Their real rules live in
              ActionModeConverter (× N, at-cursor, Double/Triple, and a drag that must stay
              paired), and the backend now SPEAKS them — restating them in TS would be a second
              copy of four conditions that must agree forever. Let it refuse out loud. */}
          {(() => {
            const row = actions[contextMenu.rowIndex];
            if (!row || !isCoordinateClick(row.actionType ?? '')) return null;
            const form = clickFormOf(row.actionType ?? '');
            const options = form
              ? CLICK_FAMILY_TYPES.filter(o => isFocusClickEligible(o.value))
              : CLICK_FAMILY_TYPES;
            // Rows of the SAME form as the clicked one. A mixed selection has no single answer to
            // "what should Double Click mean for a Down half?", and one message per distinct
            // target would put the per-row undo back that this whole entry exists to remove.
            const targets = contextSelectionIndices()
              .filter(i => isCoordinateClick(actions[i]?.actionType ?? '')
                        && clickFormOf(actions[i]?.actionType ?? '') === form);
            return (
              <div
                className="relative"
                onMouseEnter={() => setActiveSubmenu('clicktype')}
                onMouseLeave={() => setActiveSubmenu(null)}
              >
                <button className="menu-item justify-between text-text-primary">
                  <span className="flex items-center gap-2.5">
                    <MousePointerClick size={13} className="text-text-tertiary" />
                    Change click type
                    {targets.length > 1 && <span className="text-text-disabled">({targets.length})</span>}
                  </span>
                  <ChevronRight size={12} className="text-text-disabled" />
                </button>
                {activeSubmenu === 'clicktype' && (
                  <div ref={clickTypeFlyout.ref} className={`absolute min-w-[210px] bg-transparent ${clickTypeFlyout.flipX ? 'right-full' : 'left-full'} ${clickTypeFlyout.flipY ? 'bottom-0' : 'top-0'}`} style={clickTypeFlyout.flipX ? { paddingRight: '4px' } : { paddingLeft: '4px' }}>
                    <div className="py-1 menu-surface z-[60]">
                      {options.map(opt => {
                        const target = opt.value + form;
                        // Over the whole SELECTION, not the clicked row. The check says "this is
                        // what these rows already are", and the entry acts on `targets` — so
                        // reading one row made both lie at once whenever the selection was mixed:
                        // with a LeftClick and a RightClick selected and the right-click on the
                        // Left one, "Left Click" drew a tick (claiming both were already Left) and
                        // then swallowed the send, leaving the RightClick untouched with no toast,
                        // no undo and no hint — while the submenu header promised "(2)".
                        // The backend is already safe for the redundant case: HandleBulkUpdateType
                        // filters to rows whose type actually differs and pushes no undo for a
                        // no-op, so suppressing the send here is an affordance, not a guard.
                        const current = targets.length > 0 && targets.every(i => actions[i]?.actionType === target);
                        return (
                          <button
                            key={opt.value}
                            onClick={() => {
                              // ONE message for N rows = one undo entry. The old Convert to
                              // Double Click looped actions:edit, and the bridge pushes an undo
                              // state per call, so ten rows cost ten Ctrl+Z.
                              if (!current) send({ type: 'actions:bulkUpdateType', payload: { indices: targets, actionType: target } });
                              closeContextMenu();
                            }}
                            className="menu-item justify-between text-text-primary"
                          >
                            <span className="flex items-center gap-2.5">
                              <MousePointerClick size={13} className="text-text-tertiary" />
                              {opt.label}
                            </span>
                            {current && <Check size={12} className="text-accent-light" />}
                          </button>
                        );
                      })}

                      <div className="my-1 border-t border-border-subtle" />

                      {form === '' ? (
                        <button
                          onClick={() => {
                            send({ type: 'actions:convertMode', payload: { direction: 'toPaired', indices: targets } });
                            closeContextMenu();
                          }}
                          data-tip={tt('Two rows: press, then release — a drag needs this',
                                       'Duas linhas: aperta e solta — um arrasto precisa disto')}
                          className="menu-item text-text-primary"
                        >
                          <Split size={13} className="text-text-tertiary" />
                          Split into Down + Up
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            // A lone half means "merge THIS pair" — reach for the twin rather than
                            // refusing with "select both", which is a menu asking the user to
                            // restate what the click already said.
                            //
                            // And EVERY half means that, not just a lone one. `targets` is filtered
                            // to the clicked row's own form, so a multi-select is all Downs or all
                            // Ups; sending it raw handed the backend a list with no twin in it, it
                            // grouped those into contiguous runs of ONE row each, ToCombined had no
                            // i+1 to fold, and the refusal that came back — "Select a click's Down
                            // half and the Up half that follows it" — asked for exactly what the
                            // user had done. One row worked, any multi-selection failed every time.
                            // Reaching for each twin is the same rule the lone case already states,
                            // applied per index; the Set collapses the overlap when both halves of
                            // one pair are selected.
                            const idx = contextMenu.rowIndex;
                            const seeds = targets.length > 1 ? targets : [idx];
                            const pair = Array.from(new Set(
                              seeds.flatMap(i => (form === 'Down' ? [i, i + 1] : [i - 1, i])),
                            )).sort((a, b) => a - b);
                            send({ type: 'actions:convertMode', payload: { direction: 'toCombined', indices: pair.filter(i => i >= 0 && i < actions.length) } });
                            closeContextMenu();
                          }}
                          data-tip={tt('One row that owns the whole press', 'Uma linha que carrega a pressão inteira')}
                          className="menu-item text-text-primary"
                        >
                          <Combine size={13} className="text-text-tertiary" />
                          Merge Down + Up
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Reset cycle position — SetVariable cycle rows only. Clears the in-memory
              cursor so the next run starts at the first list item again (editing the
              list keeps the position on purpose; this is the explicit "start over" the
              list can't trigger itself). Sits right under Edit per user request. */}
          {(() => {
            const row = actions[contextMenu.rowIndex];
            if (!row || row.actionType !== 'SetVariable' || row.variableMode !== 'cycle') return null;
            return (
              <button
                onMouseEnter={() => setActiveSubmenu(null)}
                onClick={() => {
                  send({ type: 'actions:resetCycle', payload: { index: contextMenu.rowIndex } });
                  closeContextMenu();
                }}
                className="menu-item text-text-primary"
              >
                <RotateCcw size={13} className="text-text-tertiary" />
                Reset cycle position
              </button>
            );
          })()}

          {/* "Reset row position" (the data-loop cursor) lived here until 2026-09-16 and was
              REMOVED as redundant. It read as a sibling of Reset cycle position above, but the two
              are not siblings at all: that one takes an `index` and belongs to the row you clicked,
              this one was PROFILE-level and therefore rendered on EVERY row's menu. And the Data
              panel is already its door, with strictly more reach — clicking a row number there
              parks the cursor on ANY row (actions:resetRow with a `row`), while this sent `{}`,
              which the backend reads as "back to row 1". A worse copy of a visible control. */}

          {/* Type-specific quick action — only ONE of these renders, based on the
              right-clicked row's actionType. Keeps the menu height predictable
              regardless of what was clicked. */}
          {(() => {
            const row = actions[contextMenu.rowIndex];
            if (!row) return null;
            const onMouse = () => setActiveSubmenu(null);
            // `menu-item text-text-primary`, like every other entry in this menu. These four
            // used to carry a hand-rolled copy of the utility's tokens, and it was not a copy:
            // `py-1.5` with no min-height renders 28 px, while `menu-item` pins 32 px. So the
            // one slot whose occupant changes with the row was also the one slot 4 px shorter
            // than its neighbours — the menu twitched depending on what you right-clicked.
            const cls = "menu-item text-text-primary";

            // Entries are gated on actionType ONLY (no truthy check on row.key /
            // row.x / row.y). Earlier the gate also required the payload to be
            // populated, but that meant a freshly-inserted browser action with
            // no selector yet — or a click action that somehow had null coords —
            // would silently skip its menu entry. Users reported "Copy Selector
            // doesn't appear for some Browser rows" because of this. Now the
            // entry is always present for the right action type; copying an
            // empty value to clipboard is a non-issue (worst case: toast says
            // "Selector copied" with empty string).

            // BrowserNavigate: row.key holds the URL (not a CSS selector). Must come
            // BEFORE the generic Browser* branch below so it wins the dispatch — both
            // would match otherwise and the user would see "Copy Selector" copying a URL.
            if (row.actionType === 'BrowserNavigate') {
              return (
                <button
                  onMouseEnter={onMouse}
                  onClick={() => {
                    navigator.clipboard.writeText(row.key ?? '')
                      .then(() => showToast(tt('URL copied', 'URL copiada'), 'success'))
                      .catch(() => showToast(tt('Copy failed', 'Falha ao copiar'), 'error'));
                    closeContextMenu();
                  }}
                  className={cls}
                >
                  <Link size={13} className="text-text-tertiary" />
                  Copy URL
                </button>
              );
            }

            // Other Browser*: copy the CSS selector. Covers BrowserClick / BrowserRightClick
            // / BrowserType / BrowserSelectOption / BrowserWaitElement.
            if (row.actionType?.startsWith('Browser')) {
              return (
                <button
                  onMouseEnter={onMouse}
                  onClick={() => {
                    navigator.clipboard.writeText(row.key ?? '')
                      .then(() => showToast(tt('Selector copied', 'Seletor copiado'), 'success'))
                      .catch(() => showToast(tt('Copy failed', 'Falha ao copiar'), 'error'));
                    closeContextMenu();
                  }}
                  className={cls}
                >
                  <Code2 size={13} className="text-text-tertiary" />
                  Copy Selector
                </button>
              );
            }

            // SendText: copy the text body (placeholders + tokens included verbatim).
            if (row.actionType === 'SendText') {
              return (
                <button
                  onMouseEnter={onMouse}
                  onClick={() => {
                    navigator.clipboard.writeText(row.key ?? '')
                      .then(() => showToast(tt('Text copied', 'Texto copiado'), 'success'))
                      .catch(() => showToast(tt('Copy failed', 'Falha ao copiar'), 'error'));
                    closeContextMenu();
                  }}
                  className={cls}
                >
                  <Code2 size={13} className="text-text-tertiary" />
                  Copy Text
                </button>
              );
            }

            // Clicks intentionally have no entry HERE any more: their quick slot is now
            // "Pick from screen" up under Edit, and Copy Coordinates moved into More ▸
            // (first item) per user request — copying is the rarer of the two gestures.

            // KeyDown / KeyUp intentionally have no quick-copy entry. Copying just
            // the key name (e.g. "Enter") was added in the first pass but provides
            // no meaningful workflow — the key is already visible in the table cell
            // and there's nowhere useful to paste a bare key name. Removed after
            // user feedback that the option felt purposeless.

            // Keystroke intentionally has no type-specific entry. Edit IS recapture
            // (opens the same dialog as insert), so there's nothing to surface in this
            // slot. An earlier draft added Copy Keystroke here but it didn't earn its
            // place — the combo string is already visible in the Key cell.

            // RunProfile: jump to the referenced profile. Reuses profile:click which
            // toggles selection on click; since we're targeting a DIFFERENT profile
            // than the active one, this loads that profile (with the unsaved-changes
            // guard from HandleProfileClick). Only show when row.key is set — a
            // RunProfile pointing at no profile has nothing to open.
            if (row.actionType === 'RunProfile' && row.key) {
              return (
                <button
                  onMouseEnter={onMouse}
                  onClick={() => {
                    send({ type: 'profile:click', payload: { name: row.key } });
                    closeContextMenu();
                  }}
                  className={cls}
                >
                  <ExternalLink size={13} className="text-text-tertiary" />
                  Open Profile
                </button>
              );
            }

            return null;
          })()}

          {/* ── Row actions — the fixed spine every row gets, in this order ──
              Everything above is a type SLOT (at most two render); everything from here down is
              the same for a Pause, a Browser row and an If. That is the point: the entries whose
              position you can learn are the ones you stop reading, and the menu is now at most
              seven items for any row. Focus click and Convert to Double/Left Click live in More ▸
              — both are click-only tools and rarer than these. */}

          {/* Duplicate and Skip both act on the EFFECTIVE selection (contextSelectionIndices:
              the clicked row, or the whole multi-select when the clicked row is inside it), so
              both carry the count. Right-clicking inside a 12-row selection and reading a bare
              "Duplicate" was the menu understating what the click was about to do.
              Duplicate reads contextEffectiveCount, not contextCount: it snaps to whole blocks
              before sending, so the raw selection size understates it again whenever a marker is
              caught in the selection. Skip below keeps contextCount — it really does act on the
              raw indices. */}
          <button
            onMouseEnter={() => setActiveSubmenu(null)}
            onClick={handleDuplicate}
            className="menu-item text-text-primary"
            data-tip={contextEffectiveCount > contextCount
              ? tt('The selection touches a block marker, so whole blocks are duplicated',
                   'A seleção toca um marcador de bloco, então blocos inteiros são duplicados')
              : undefined}
          >
            <Files size={13} className="text-text-tertiary" />
            Duplicate
            {contextEffectiveCount > 1 && <span className="text-text-disabled">({contextEffectiveCount})</span>}
          </button>

          {/* Skip / Enable — promoted from the bulk bar on 2026-09-16. The bar only exists while
              something is selected, and a right-click deliberately does NOT select (see
              handleRowContextMenu), so toggling skip on ONE row with the mouse was impossible
              without selecting it first — for what is the most frequent per-row operation there
              is. Same message, same raw indices and same Eye/EyeOff vocabulary as the bar; no
              block snap, matching it exactly (a skipped opener already propagates to its block,
              see conditionalBlocks). The label follows the selection: all skipped → Enable. */}
          {(() => {
            const indices = contextSelectionIndices();
            if (indices.length === 0) return null;
            const allSkipped = indices.every(i => actions[i]?.isSkipped);
            return (
              <button
                onMouseEnter={() => setActiveSubmenu(null)}
                onClick={() => {
                  send({ type: 'actions:toggleSkip', payload: { indices } });
                  showToast(
                    allSkipped
                      ? tt(`Enabled ${indices.length} action(s)`, `${indices.length} ação(ões) ativada(s)`)
                      : tt(`Skipped ${indices.length} action(s)`, `${indices.length} ação(ões) ignorada(s)`),
                    'success',
                  );
                  closeContextMenu();
                }}
                data-tip={allSkipped
                  ? tt('Puts these rows back in the run', 'Devolve estas linhas ao run')
                  : tt('Keeps the rows, skips them at run time', 'Mantém as linhas, pula na execução')}
                className="menu-item text-text-primary"
              >
                {allSkipped
                  ? <Eye size={13} className="text-text-tertiary" />
                  : <EyeOff size={13} className="text-text-tertiary" />}
                {allSkipped ? 'Enable' : 'Skip'}
                {indices.length > 1 && <span className="text-text-disabled">({indices.length})</span>}
              </button>
            );
          })()}

          <div className="my-1 border-t border-border-subtle" />

          {/* More ▸ — lower-frequency tools tucked into a submenu so the top level stays
              short. Grouped by purpose: select-similar, paired↔combined conversion, and
              Down/Up repeat collapse. (Skip lives in the bulk bar; Insert in the toolbar.) */}
          <div
            className="relative"
            onMouseEnter={() => setActiveSubmenu('more')}
            onMouseLeave={() => setActiveSubmenu(null)}
          >
            <button className="menu-item justify-between text-text-primary">
              <span className="flex items-center gap-2.5">
                <MoreHorizontal size={13} className="text-text-tertiary" />
                More
              </span>
              <ChevronRight size={12} className="text-text-disabled" />
            </button>
            {activeSubmenu === 'more' && (
              <div ref={moreFlyout.ref} className={`absolute min-w-[210px] bg-transparent ${moreFlyout.flipX ? 'right-full' : 'left-full'} ${moreFlyout.flipY ? 'bottom-0' : 'top-0'}`} style={moreFlyout.flipX ? { paddingRight: '4px' } : { paddingLeft: '4px' }}>
                <div className="py-1 menu-surface z-[60]">
                  {/* Copy / Paste here — added 2026-09-16, and Copy is the reason this pair
                      exists: actions:copyInternal had exactly ONE door in the whole app, the
                      Ctrl+C keybinding, with no button, no menu and no palette entry. Its twin
                      actions:paste got a palette entry years ago on the written argument that
                      "Ctrl+V works but has no visible control anywhere" — nobody ever applied the
                      same sentence to Ctrl+C.
                      NO kbd chip, deliberately: both context menus in this app carry exactly one,
                      on Delete, where it means "this is what the bare Del key does" rather than
                      cataloguing shortcuts. The shortcut rides in the tooltip instead — the same
                      channel Delete already uses to explain its scope.
                      Neither needs a run gate of its own — but the reason is no longer the one
                      this comment used to give. "The menu does not OPEN during record/replay"
                      was true and beside the point: contextMenuEnabled was read only by
                      handleRowContextMenu, so a menu already up when a run started stayed up,
                      fully live, and Paste here rewrote the list under the engine. The menu now
                      carries contextMenuEnabled in its own render condition and an effect clears
                      it on the falling edge, so every item in here — not just this pair — is
                      covered by the menu ceasing to exist. Clicker mode is still covered by
                      construction: the whole grid is unmounted (the Toolbar's insertsDisabled). */}
                  <button
                    onClick={() => {
                      const indices = contextSelectionIndices();
                      send({ type: 'actions:copyInternal', payload: { indices } });
                      showToast(tt(`Copied ${indices.length} action(s)`, `${indices.length} ação(ões) copiada(s)`), 'success');
                      closeContextMenu();
                    }}
                    data-tip={tt('Copies the selected rows (Ctrl+C)', 'Copia as linhas selecionadas (Ctrl+C)')}
                    className="menu-item text-text-primary"
                  >
                    <ClipboardCopy size={13} className="text-text-tertiary" />
                    Copy
                    {contextCount > 1 && <span className="text-text-disabled">({contextCount})</span>}
                  </button>
                  {/* "here" is the whole point, and it is the one thing the Toolbar and the palette
                      cannot say: they paste at min(selection) because a keystroke has no position.
                      A right-click does. The rows land BEFORE the clicked row — the same direction
                      every other insert in the app goes, so Ctrl+V and this land the same way up. */}
                  <button
                    onClick={() => {
                      send({ type: 'actions:paste', payload: { insertIndex: contextMenu.rowIndex } });
                      closeContextMenu();
                    }}
                    data-tip={tt('Pastes above this row (Ctrl+V)', 'Cola acima desta linha (Ctrl+V)')}
                    className="menu-item text-text-primary"
                  >
                    <ClipboardPaste size={13} className="text-text-tertiary" />
                    Paste here
                  </button>

                  <div className="my-1 border-t border-border-subtle" />

                  {/* Select Similar sits alone between the clipboard pair and the click tools
                      because it is the only entry here that CHANGES THE SELECTION rather than
                      acting on it — the thing you run before reaching for the bulk bar. */}
                  <button
                    onClick={() => {
                      const ref = actions[contextMenu.rowIndex];
                      if (!ref) { closeContextMenu(); return; }
                      // See similarActionKey above for why actionType+key+x+y alone
                      // over-selects probe/condition rows (WaitImage, WaitPixelColor,
                      // ActivateWindow, If/Assert) whose real identity lives elsewhere.
                      const refKey = similarActionKey(ref);
                      const similar = new Set<number>();
                      actions.forEach((a, i) => {
                        if (a.actionType === ref.actionType && similarActionKey(a) === refKey)
                          similar.add(i);
                      });
                      setSelectedIndices(similar);
                      showToast(tt(`Selected ${similar.size} similar action(s)`, `${similar.size} ação(ões) semelhante(s) selecionada(s)`), 'success');
                      closeContextMenu();
                    }}
                    className="menu-item text-text-primary"
                  >
                    <CheckCheck size={13} className="text-text-tertiary" />
                    Select Similar
                  </button>

                  {/* ── Click tools ── Copy Coordinates · Focus click.
                      The divider is conditional because the whole GROUP is: on an If, a Pause or
                      a Browser row both entries return null, and an unconditional rule would sit
                      directly on top of the next one. (Two adjacent dividers is exactly what this
                      grouping produced the first time it was measured.) The predicate is the union
                      of the TWO gates below — a coordinate click that is not at-cursor (Copy
                      Coordinates) or a focus-eligible click — so a MiddleClickHold pinned to the
                      cursor, which satisfies neither, correctly draws no rule at all.
                      It used to carry a third term, `t === 'DoubleClick'`, for a "Convert to
                      Double/Left Click" entry that was ABSORBED into Change click type ▸ and no
                      longer exists here. Left behind, it made a DoubleClick pinned to the cursor
                      the one row that drew the rule with an empty group under it: Copy Coordinates
                      returns null on at-cursor, Focus click returns null on a non-focus-eligible
                      type, and the unconditional divider below landed straight on top of this one.
                      A term in a union has to name an entry that is still in the union. */}
                  {(() => {
                    const t = actions[contextMenu.rowIndex]?.actionType ?? '';
                    const atCur = !!actions[contextMenu.rowIndex]?.atCursor;
                    const hasClickTools = (isCoordinateClick(t) && !atCur) || isFocusClickEligible(t);
                    return hasClickTools ? <div className="my-1 border-t border-border-subtle" /> : null;
                  })()}

                  {/* Copy Coordinates — click rows only, FIRST item per user request.
                      Lived at top level in the type-specific slot until "Pick from
                      screen" took that spot. Paired-mode clicks are DOWN/UP pairs
                      (LeftClickDown, …); the optional-suffix regex matches both shapes
                      — an earlier draft missed every paired row by checking only the
                      unsuffixed names. Gated on actionType ONLY (no truthy x/y check;
                      see the type-specific slot's note on why that gate misfired). */}
                  {(() => {
                    const row = actions[contextMenu.rowIndex];
                    if (!row || !isCoordinateClick(row.actionType ?? '')) return null;
                    // Nothing worth copying off an at-cursor row: its stored x/y is dormant, so
                    // the clipboard would carry a point the run never uses.
                    if (row.atCursor) return null;
                    return (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${row.x ?? 0}, ${row.y ?? 0}`)
                            .then(() => showToast(tt(`Copied ${row.x ?? 0}, ${row.y ?? 0}`, `Copiado ${row.x ?? 0}, ${row.y ?? 0}`), 'success'))
                            .catch(() => showToast(tt('Copy failed', 'Falha ao copiar'), 'error'));
                          closeContextMenu();
                        }}
                        className="menu-item text-text-primary"
                      >
                        <Crosshair size={13} className="text-text-tertiary" />
                        Copy Coordinates
                      </button>
                    );
                  })()}

                  {/* Focus click — combined clicks only. Toggles the per-action flag that replays the
                      click TWICE a few pixels apart so a small target (e.g. a Roblox text field at the
                      window's minimum size) actually receives focus. The state shows as a small icon in
                      the Action pill (no grid column). Acts on the effective selection (the right-clicked
                      row, or the whole multi-selection when the row is part of it), filtered to clicks.
                      NOTE: no onMouseEnter={() => setActiveSubmenu(null)} on this or any sibling below —
                      inside the flyout that handler would close the very submenu they live in. */}
                  {(() => {
                    const row = actions[contextMenu.rowIndex];
                    if (!row || !isFocusClickEligible(row.actionType ?? '')) return null;
                    // The shared resolver, not a fourth inlined copy of its body — the comment on
                    // contextSelectionIndices says this menu keeps one answer to "what am I acting on".
                    const clickIdx = contextSelectionIndices()
                      .filter(i => isFocusClickEligible(actions[i]?.actionType ?? ''));
                    const allOn = clickIdx.length > 0 && clickIdx.every(i => actions[i]?.isFocusClick);
                    return (
                      <button
                        onClick={() => {
                          send({ type: 'actions:toggleFocusClick', payload: { indices: clickIdx } });
                          closeContextMenu();
                        }}
                        className="menu-item justify-between text-text-primary"
                      >
                        <span className="flex items-center gap-2.5">
                          <Focus size={13} className="text-text-tertiary" />
                          Focus click
                          {clickIdx.length > 1 && <span className="text-text-disabled">({clickIdx.length})</span>}
                        </span>
                        {allOn && <Check size={12} className="text-accent-light" />}
                      </button>
                    );
                  })()}

                  {/* Two entries left this submenu on 2026-09-16, for opposite reasons.
                      "Convert all to Combined / Paired" went to the command palette ALONE, where
                      they always also lived — same message, same payload. They were a duplicate
                      door (the palette earns an entry by being "buried in a nested right-click
                      menu" — this WAS that menu), and they are WHOLE-PROFILE operations in a menu
                      otherwise entirely about the row under the cursor: right-clicking row 7
                      rewrote all 400 rows and cleared the selection.
                      "Convert to Double/Left Click" was ABSORBED by Change click type ▸ at top
                      level. It offered two of the eight click types through a label that had to
                      name its own direction, and it looped actions:edit per row — ten selected
                      clicks cost ten Ctrl+Z, which the bulk message it moved to now fixes. */}

                  <div className="my-1 border-t border-border-subtle" />

                  {/* Collapse to × N / Expand × N — fold consecutive Down/Up pairs of the same
                      key into one Keystroke × N row (and back). Disabled (greyed) when the
                      current selection wouldn't qualify, so the feature stays discoverable —
                      and since 2026-09-16 the greyed state SAYS WHY. Two permanently dead rows
                      with no explanation is not discoverability, it is furniture; the palette
                      already had the right pattern in its disabledHint. */}
                  {(() => {
                    const indices = contextSelectionIndices();
                    let contiguous = true;
                    for (let i = 1; i < indices.length; i++) {
                      if (indices[i] !== indices[i - 1] + 1) { contiguous = false; break; }
                    }
                    const rows = indices.map(i => actions[i]);
                    const collapseOk = contiguous && canCollapse(rows) !== null;
                    const expandOk = indices.length === 1 && canExpand(rows[0]);
                    return (
                      <>
                        <button
                          onClick={collapseOk ? handleCollapseToRepeat : undefined}
                          disabled={!collapseOk}
                          data-tip={collapseOk
                            ? tt(`Folds ${indices.length / 2} presses into one row`, `Junta ${indices.length / 2} pressões numa linha`)
                            : tt('Select adjacent Key Down + Key Up pairs of the same key',
                                 'Selecione pares Key Down + Key Up adjacentes da mesma tecla')}
                          // menu-item already owns the disabled look (text-disabled + default
                          // cursor, hover only :not(:disabled)), so the enabled half is all that
                          // is left to say here.
                          className={`menu-item ${collapseOk ? 'text-text-primary cursor-pointer' : ''}`}
                        >
                          <ChevronsDownUp size={13} className={collapseOk ? 'text-text-tertiary' : 'text-text-disabled'} />
                          Collapse to × N
                        </button>
                        <button
                          onClick={expandOk ? handleExpandRepeat : undefined}
                          disabled={!expandOk}
                          data-tip={expandOk
                            ? tt('Splits it back into one row per press', 'Divide de volta numa linha por pressão')
                            : tt('Select one Keystroke × N row with a single key (no combo)',
                                 'Selecione uma linha Keystroke × N de tecla única (sem combo)')}
                          className={`menu-item ${expandOk ? 'text-text-primary cursor-pointer' : ''}`}
                        >
                          <ChevronsUpDown size={13} className={expandOk ? 'text-text-tertiary' : 'text-text-disabled'} />
                          Expand × N
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          <div className="my-1 border-t border-border-subtle" />

          {/* Delete */}
          <button
            onMouseEnter={() => setActiveSubmenu(null)}
            onClick={handleContextDelete}
            data-tip={
              deleteScope === 'block'
                ? tt('Deletes the whole If block, End If included',
                     'Apaga o bloco If inteiro, com o End If')
                : deleteScope === 'loop'
                  ? tt('Deletes the whole loop, End Loop included',
                       'Apaga o loop inteiro, com o End Loop')
                  : deleteScope === 'arm'
                    ? tt('Deletes only this Else If arm',
                         'Apaga só este braço Else If')
                    : contextEffectiveCount > contextCount
                      ? tt('The selection touches a block marker, so whole blocks go',
                           'A seleção toca um marcador de bloco, então blocos inteiros vão junto')
                      : undefined
            }
            className="menu-item justify-between text-recording"
          >
            <span className="flex items-center gap-2.5">
              <Trash2 size={13} />
              {deleteScope === 'block' ? 'Delete block'
                : deleteScope === 'loop' ? 'Delete loop'
                  : deleteScope === 'arm' ? 'Delete arm'
                    : 'Delete'}
              {/* Only on the plain 'rows' scope: the other three labels already NAME what goes
                  (a block, a loop, an arm), and a count beside them would be read as a row count
                  for something that deletes more rows than the selection holds.
                  The number is the POST-SNAP one — what the backend is about to receive — for the
                  same reason the label names a scope at all: a count that undershoots is worse
                  than no count, because it reads as a promise. */}
              {deleteScope === 'rows' && contextEffectiveCount > 1 && (
                <span className="text-text-disabled">({contextEffectiveCount})</span>
              )}
            </span>
            <span className="kbd">Del</span>
          </button>

        </div>,
        document.body
      )}
    </div>
  );
}
