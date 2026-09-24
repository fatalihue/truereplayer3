import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  Table2, TriangleAlert, Repeat, Plus, Trash2, Wand2, Check, Copy,
  MoreHorizontal, ClipboardPaste, FileUp, Search, X, Bell, ChevronRight,
} from 'lucide-react';
import { DialogShell  } from './common/DialogShell';
import { Button } from './common/Button';
import { SegmentedControl } from './common/SegmentedControl';
import { CheckboxBox } from './Checkbox';
import { useBridge } from '../bridge/BridgeContext';
import { useAppState } from '../state/AppStateContext';
import { useTt } from '../state/LanguageContext';
import { useToast } from '../state/ToastContext';
import { DataPasteSurface, type PasteMode } from './DataPasteSurface';
import { parseTsv, encodeTsv, deepEqualGrid, tokenizeTsvGrid, sniffDelimiter, type Grid } from '../lib/tsv';
import { scanRowTokenUsage, orphanHead } from '../lib/rowTokenUsage';
import { uiZoom, rectToLayout, viewportInLayout } from '../utils/zoomSpace';
import { useEditorClaim } from '../hooks/useEditorClaim';

interface DataPanelProps {
  onClose: () => void;
}

// A header is a {row:…} token name when it holds none of the three characters the token grammar
// spends: '{' and '}' bound the token, ':' starts the modifier chain (RowDataTokenRegex, 2.37.0 —
// spaces, accents and punctuation are fine). Matched trimmed and case-insensitively at replay.
const VALID_HEADER = /^[^{}:]+$/;
// One chip recipe everywhere (SheetPanel / Insert Text parity).
const CHIP_CLASS =
  'h-6 px-2 inline-flex items-center text-[11px] font-mono bg-bg-surface border border-border-subtle rounded text-text-secondary hover:text-warning-ink hover:border-warning-ink/40 transition-colors';
// Read-only render cap: beyond this the grid stays visible but cell editing is
// disabled (the paste surface remains the bulk editor). Keeps typing O(1) without
// speculative virtualization.
const READONLY_ROW_CAP = 2000;
const LARGE_TABLE_WARN = 1000;

// Render a cell value with invisible characters made visible: tab → ⇥, newline → ↵
// (dim glyphs). Without this a quoted multi-line cell reads identically to its
// first line and users can't tell why replay types "more" than they see.
function cellFragments(value: string): React.ReactNode {
  if (!/[\t\n]/.test(value)) return value;
  const parts = value.split(/(\t|\n)/);
  return parts.map((p, i) =>
    p === '\t' ? <span key={i} className="text-text-disabled">⇥</span>
    : p === '\n' ? <span key={i} className="text-text-disabled">↵</span>
    : <React.Fragment key={i}>{p}</React.Fragment>,
  );
}

// Synthesize the next free colN name against the existing headers.
function nextColName(headers: string[]): string {
  const taken = new Set(headers.map((h) => h.trim().toLowerCase()));
  let n = headers.length + 1;
  while (taken.has(`col${n}`)) n++;
  return `col${n}`;
}

// ── Single cell/header editor ───────────────────────────────────────────────
//
// Exactly ONE editor instance exists in the whole grid (the decisive scope trim:
// no roving focus, no selection model). Commit paths: Enter (+move down), Tab
// (+move right/left), blur, Ctrl+Enter (commit, then the event bubbles to the
// card so Ctrl+Enter also saves). Esc reverts. Every commit/revert key checks
// isComposing so IME composition never commits half-typed text.
function CellEditor({
  initial,
  multiline,
  onDone,
}: {
  initial: string;
  multiline: boolean;
  /** value=null → revert (no commit). nav: where to move the editor next. */
  onDone: (value: string | null, nav?: 'down' | 'right' | 'left') => void;
}) {
  const [val, setVal] = useState(initial);
  const doneRef = useRef(false);
  const finish = (commit: boolean, nav?: 'down' | 'right' | 'left') => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(commit ? val : null, nav);
  };

  return (
    <textarea
      autoFocus
      rows={Math.min(4, val.split('\n').length)}
      value={val}
      spellCheck={false}
      onChange={(e) => setVal(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
          return;
        }
        if (e.key === 'Enter') {
          if (e.ctrlKey) {
            // Commit synchronously (gridRef updates in the same tick), do NOT
            // stop propagation — the card's Ctrl+Enter handler saves right after.
            finish(true);
            return;
          }
          if (multiline && (e.altKey || e.shiftKey)) return; // newline in-cell
          e.preventDefault();
          e.stopPropagation();
          finish(true, 'down');
          return;
        }
        if (e.key === 'Tab') {
          // preventDefault BEFORE DialogShell's focus trap walks tabbables.
          e.preventDefault();
          e.stopPropagation();
          finish(true, e.shiftKey ? 'left' : 'right');
        }
      }}
      className="w-full bg-transparent outline-none resize-none font-mono text-xs text-text-primary leading-[1.4] max-h-[88px] overflow-auto"
    />
  );
}

// ── Header ⋯ menu (body portal, NamePromptPopover chrome) ──────────────────
type HeaderMenuAction = 'copy' | 'insert-left' | 'insert-right' | 'move-left' | 'move-right' | 'delete';

function HeaderMenu({
  anchor,
  header,
  colIndex,
  colCount,
  readOnly,
  onAction,
  onClose,
}: {
  anchor: HTMLElement;
  header: string;
  colIndex: number;
  colCount: number;
  /** The large-table state: the grid says it is read-only, so the column edits are off too and
   *  only the token copy is left. */
  readOnly: boolean;
  onAction: (a: HeaderMenuAction) => void;
  onClose: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [armedDelete, setArmedDelete] = useState(false);
  const name = header.trim();
  const valid = name !== '' && VALID_HEADER.test(name);

  useLayoutEffect(() => {
    if (!anchor || !popRef.current) return;
    const place = () => {
      // The anchor rect and the viewport are VISUAL; offsetHeight/offsetWidth are already
      // LAYOUT, which is also the space left/top are written in. Convert only the visual
      // half — see utils/zoomSpace — or the popover detaches from its column as the zoom
      // moves away from 100 %, and the flip/clamp thresholds compare across two spaces.
      const zoom = uiZoom();
      const r = rectToLayout(anchor.getBoundingClientRect(), zoom);
      const vp = viewportInLayout(zoom);
      const popH = popRef.current!.offsetHeight;
      const popW = popRef.current!.offsetWidth;
      let left = r.left;
      let top = r.bottom + 6;
      if (top + popH > vp.height - 8) top = Math.max(8, r.top - popH - 6);
      if (left + popW > vp.width - 8) left = vp.width - popW - 8;
      if (left < 8) left = 8;
      setPos({ left, top });
    };
    place();
    // Coalesced to one placement per frame. place() does three forced layout reads
    // (getBoundingClientRect + offsetHeight + offsetWidth) and then a setState, and the scroll
    // listener is capture-phase, so ANY scrollable ancestor fires it — scrolling the grid with a
    // popover open was one measure-and-render per scroll tick. The direct place() above stays so
    // the first paint is unchanged.
    let raf: number | null = null;
    const onReflow = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => { raf = null; place(); });
    };
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [anchor]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (anchor.contains(t)) return;
      onClose();
    };
    // The menu owns its own Esc (capture) — the panel's router stands down on
    // the [data-popover] marker, same contract as TokenChipPopover.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  const itemCls =
    'w-full flex items-center gap-2 px-3 h-7 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

  const visibilityStyle: React.CSSProperties = pos
    ? { visibility: 'visible', left: pos.left, top: pos.top }
    : { visibility: 'hidden', left: 0, top: 0 };

  return ReactDOM.createPortal(
    <div
      ref={popRef}
      data-popover=""
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        ...visibilityStyle,
        zIndex: 100,
        width: 200,
        background: 'var(--color-bg-elevated, #2d2d2d)',
        border: '1px solid color-mix(in srgb, var(--color-accent-solid) 35%, transparent)',
        boxShadow: 'var(--shadow-dialog)',
      }}
      className="rounded-lg overflow-hidden py-1"
    >
      <button type="button" className={itemCls} disabled={!valid} onClick={() => { onAction('copy'); onClose(); }}>
        <Copy size={12} className="shrink-0" />
        <span className="font-mono truncate">{valid ? `Copy {row:${name}}` : 'Invalid token name'}</span>
      </button>
      <div className="h-px bg-border-subtle my-1" />
      <button type="button" className={itemCls} disabled={readOnly} onClick={() => { onAction('insert-left'); onClose(); }}>
        <Plus size={12} className="shrink-0" /> {'Insert column left'}
      </button>
      <button type="button" className={itemCls} disabled={readOnly} onClick={() => { onAction('insert-right'); onClose(); }}>
        <Plus size={12} className="shrink-0" /> {'Insert column right'}
      </button>
      <button type="button" className={itemCls} disabled={readOnly || colIndex === 0} onClick={() => { onAction('move-left'); onClose(); }}>
        ← {'Move left'}
      </button>
      <button type="button" className={itemCls} disabled={readOnly || colIndex === colCount - 1} onClick={() => { onAction('move-right'); onClose(); }}>
        → {'Move right'}
      </button>
      <div className="h-px bg-border-subtle my-1" />
      <button
        type="button"
        disabled={readOnly}
        // The armed colour has to beat itemCls's `hover:text-text-primary`, which is a more
        // specific selector — and the pointer is NECESSARILY on this item, since arming it took a
        // click. Dropping the old `hover:` half left the confirm state visible only after moving
        // the mouse away, which is the one moment nobody looks. The label change is the second
        // channel; the colour is the first, and both now survive the hover.
        className={`${itemCls} ${armedDelete ? 'text-[color:var(--color-recording-fg)] hover:text-[color:var(--color-recording-fg)]' : ''}`}
        onClick={() => {
          if (!armedDelete) { setArmedDelete(true); return; }
          onAction('delete');
          onClose();
        }}
      >
        <Trash2 size={12} className="shrink-0" />
        {armedDelete ? 'Really delete column?' : 'Delete column'}
      </button>
    </div>,
    document.body,
  );
}

// ── Memoized body row ───────────────────────────────────────────────────────
//
// Re-renders only when its row-array identity changes (setCell replaces one row)
// or the editor enters/leaves one of its cells — a cell commit re-renders one row.
const GridRow = memo(function GridRow({
  row,
  r,
  colCount,
  editingCol,
  readOnly,
  zebra,
  find,
  onEdit,
  onCellDone,
  onDuplicate,
  onDelete,
  isCursor,
  onSetCursor,
}: {
  row: string[];
  r: number;
  colCount: number;
  editingCol: number | null;
  readOnly: boolean;
  zebra: boolean;
  find: string;   // lowercased search term; empty = no highlight
  onEdit: (r: number, c: number) => void;
  onCellDone: (r: number, c: number, value: string | null, nav?: 'down' | 'right' | 'left') => void;
  onDuplicate: (r: number) => void;
  onDelete: (r: number) => void;
  // Cursor mode only. isCursor = the NEXT run starts here; onSetCursor null = not cursor mode
  // (batch runs every row, so there is no "next row" to point at or move).
  isCursor: boolean;
  onSetCursor: ((r: number) => void) | null;
}) {
  const tt = useTt();
  return (
    <tr
      data-row={r}
      className={`group h-row border-b border-border-subtle transition-colors hover:bg-bg-elevated ${
        zebra ? 'bg-[color-mix(in_srgb,var(--color-text-primary)_1%,transparent)]' : ''
      }`}
    >
      {/* Row number, and in cursor mode also the marker + the way to move it. TWO channels for
          the marker, never colour alone (a chevron AND the replay ink), so it survives the
          themes where the two inks land close together. */}
      <td
        onClick={onSetCursor ? () => onSetCursor(r) : undefined}
        className={`sticky left-0 z-[5] bg-bg-surface shadow-[inset_-1px_0_0_var(--color-border-subtle)] text-[10px] tabular-nums text-right pr-2 select-none ${
          onSetCursor ? 'cursor-pointer hover:text-text-primary' : ''
        } ${isCursor ? 'font-semibold text-[color:var(--color-replay-fg)]' : 'text-text-tertiary'}`}
        data-tip={onSetCursor
          ? (isCursor
              ? tt('Next run starts here', 'A próxima execução começa aqui')
              : tt('Start the next run here', 'Começar a próxima execução aqui'))
          : undefined}
      >
        <span className="inline-flex items-center justify-end gap-0.5">
          {isCursor && <ChevronRight size={9} className="shrink-0" />}
          {r + 1}
        </span>
      </td>
      {Array.from({ length: colCount }, (_, c) => {
        const editing = editingCol === c;
        const matched = find !== '' && (row[c] ?? '').toLowerCase().includes(find);
        return (
          <td
            key={c}
            onClick={() => { if (!readOnly && !editing) onEdit(r, c); }}
            className={`px-2 text-xs font-mono text-text-secondary whitespace-nowrap truncate align-middle ${
              readOnly ? '' : 'cursor-text'
            } ${editing ? 'shadow-[inset_0_0_0_1.5px_var(--color-accent-solid)] bg-bg-input' : matched ? 'bg-[color-mix(in_srgb,var(--color-warning)_22%,transparent)]' : ''}`}
          >
            {editing ? (
              <CellEditor
                initial={row[c] ?? ''}
                multiline
                onDone={(value, nav) => onCellDone(r, c, value, nav)}
              />
            ) : (
              cellFragments(row[c] ?? '')
            )}
          </td>
        );
      })}
      <td className="relative">
        {!readOnly && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex gap-0.5">
            <button
              type="button"
              onClick={() => onDuplicate(r)}
              className="w-6 h-6 flex items-center justify-center rounded bg-bg-elevated border border-border-subtle text-text-tertiary hover:text-text-primary transition-colors"
              data-tip="Duplicate row"
            >
              <Copy size={11} />
            </button>
            <button
              type="button"
              onClick={() => onDelete(r)}
              className="w-6 h-6 flex items-center justify-center rounded bg-bg-elevated border border-border-subtle text-text-tertiary hover:text-[color:var(--color-recording-fg)] transition-colors"
              data-tip="Delete row"
            >
              <Trash2 size={11} />
            </button>
          </span>
        )}
      </td>
    </tr>
  );
});

type Editing = { kind: 'cell'; r: number; c: number } | { kind: 'header'; c: number } | null;

export function DataPanel({ onClose }: DataPanelProps) {
  const { send } = useBridge();
  const { dataTable, actions, activeProfile, profiles, settings, buttonStates } = useAppState();
  const { showToast } = useToast();
  const isClicker = settings.useCursorClick;
  const runActive = buttonStates.recordingActive || buttonStates.replayActive;
  const tt = useTt();

  // ── Canonical state: arrays, not a TSV string. Quoting exists only in
  // lib/tsv.ts at the paste/copy boundary. gridRef mirrors state synchronously
  // so commit-then-save flows (Ctrl+Enter from the cell editor) read fresh data.
  const gridRef = useRef<Grid>({ headers: [], rows: [] });
  const [grid, setGridState] = useState<Grid>(gridRef.current);
  // Undo stack: snapshots taken at the single updateGrid choke point, so it covers setCell / addRow /
  // delete / paste-apply / clear uniformly. Storing the PRE-update reference is enough because every
  // updater is immutable (returns a fresh {headers, rows} — cells are never mutated in place), so the
  // old reference stays frozen. Bounded so a long editing session can't grow unbounded.
  const undoRef = useRef<Grid[]>([]);
  const UNDO_CAP = 50;
  const updateGrid = useCallback((updater: (g: Grid) => Grid) => {
    undoRef.current.push(gridRef.current);
    if (undoRef.current.length > UNDO_CAP) undoRef.current.shift();
    gridRef.current = updater(gridRef.current);
    setGridState(gridRef.current);
  }, []);

  const loopRef = useRef(false);
  const [loopOverData, setLoopState] = useState(false);
  const setLoop = useCallback((v: boolean) => { loopRef.current = v; setLoopState(v); }, []);

  // Per-row error policy. The TABLE owns it, and three paths walk the table row by row and obey
  // it: Loop over data, a For Each Data Row block in this profile, and another profile's Run
  // Profile with "Run once per data row". Same ref+state pair as loopOverData —
  // dirtyNow()/handleSave read the ref synchronously.
  const onRowErrorRef = useRef<'halt' | 'skip'>('halt');
  const [onRowError, setOnRowErrorState] = useState<'halt' | 'skip'>('halt');
  const setOnRowError = useCallback((v: 'halt' | 'skip') => { onRowErrorRef.current = v; setOnRowErrorState(v); }, []);
  // The two paths that walk the table WITHOUT Loop over data. Either one makes the policy live in
  // cursor mode, so the rail offers it there too — it used to render only with Loop over data on,
  // hiding a setting the For Each block and the caller still obeyed.
  const usesForEach = useMemo(() => actions.some(a => a.actionType === 'ForEachRow'), [actions]);
  // Matched by EXACT name, the way the engine resolves a Run Profile target
  // (ProfileController.LoadProfileByNameAsync); the backend already trimmed the refs.
  const overDataCallers = useMemo(
    () => (activeProfile
      ? profiles
        .filter(p => p.name !== activeProfile && (p.runOverDataTargets ?? []).includes(activeProfile))
        .map(p => p.name)
      : []),
    [profiles, activeProfile],
  );
  // Where the policy applies when Loop over data is off — shown under the control, since there
  // the control appears for a reason the Run section above doesn't state.
  const rowPolicyScope = useMemo(() => {
    const parts: string[] = [];
    if (usesForEach) parts.push('inside For Each Data Row');
    if (overDataCallers.length === 1) parts.push(`when “${overDataCallers[0]}” runs this profile once per data row`);
    else if (overDataCallers.length > 1) parts.push(`when ${overDataCallers.length} profiles run this one once per data row`);
    return parts.length > 0 ? `Applies ${parts.join(', and ')}.` : '';
  }, [usesForEach, overDataCallers]);
  // Lap notice — same ref+state pairing as onRowError so the synchronous dirty check and
  // handleSave can read it without waiting for a re-render. Defaults ON.
  const notifyLapRef = useRef(true);
  const [notifyLap, setNotifyLapState] = useState(true);
  const setNotifyLap = useCallback((v: boolean) => { notifyLapRef.current = v; setNotifyLapState(v); }, []);

  const [editing, setEditing] = useState<Editing>(null);
  const editingRef = useRef<Editing>(null);
  useEffect(() => { editingRef.current = editing; }, [editing]);

  // Pop the last snapshot back into the grid. No-op on an empty stack. Cancels any in-flight cell
  // edit so it can't re-apply over the restored grid.
  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    gridRef.current = prev;
    setGridState(prev);
    setEditing(null);
  }, []);

  const [headerMenu, setHeaderMenu] = useState<{ c: number; anchor: HTMLElement } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);
  const [armedClear, setArmedClear] = useState(false);

  // ── Find + highlight (NOT filter — hiding rows would break the index-keyed grid + the counts that
  // derive from the full table). Highlights every matching cell; next/prev scrolls each hit into view.
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const [find, setFind] = useState('');
  // Debounced like the paste preview below, and for the same reason: the term feeds matchRows AND
  // every GridRow's highlight, so each keystroke re-rendered the whole table — thousands of rows
  // once a big paste has landed (Replace has no row cap; the grid only turns read-only past 2000).
  // Enter and the ✕ flush it, so a jump never runs on a term the user has already changed.
  const [findTerm, setFindTerm] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setFindTerm(find), 120);
    return () => window.clearTimeout(t);
  }, [find]);
  const findLower = findTerm.trim().toLowerCase();
  const [findPos, setFindPos] = useState(0);
  const matchRows = useMemo(() => {
    if (findLower === '') return [];
    const out: number[] = [];
    grid.rows.forEach((row, r) => { if (row.some(cell => cell.toLowerCase().includes(findLower))) out.push(r); });
    return out;
  }, [findLower, grid.rows]);
  const jumpToMatch = (delta: number) => {
    if (matchRows.length === 0) return;
    const next = ((findPos + delta) % matchRows.length + matchRows.length) % matchRows.length;
    setFindPos(next);
    gridScrollRef.current?.querySelector(`[data-row="${matchRows[next]}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  // Keep the cursor in range: reset to 0 on a new term, and clamp when the grid mutates under a
  // live search (a delete can shrink matchRows below findPos) so the "N/M" counter never reads out
  // of range.
  useEffect(() => { setFindPos(0); }, [findLower]);
  useEffect(() => { setFindPos(p => Math.min(p, Math.max(0, matchRows.length - 1))); }, [matchRows.length]);
  const [escArmed, setEscArmed] = useState(false);
  const escArmedRef = useRef(false);
  const escTimer = useRef<number | undefined>(undefined);

  // Paste sub-surface (state lifted here — the swapped shell footer needs it).
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteMode, setPasteMode] = useState<PasteMode>('replace');
  const [pasteFirstRowHeader, setPasteFirstRowHeader] = useState(true);
  const prefillRef = useRef('');

  // ── Seed ONCE from the store at mount (send data:request as a freshness ping).
  // Deliberately NOT re-seeding on later dataTable changes: the backend rides
  // data:table on every actions:updated (recording/browser pushes AND our own
  // save confirm), which would otherwise stomp the user's unsaved edits while
  // the panel is open. Treat any later dataTable dependency as a review defect.
  const seededRef = useRef(false);
  const seedRef = useRef<{ grid: Grid; loopOverData: boolean; onRowError: 'halt' | 'skip'; notifyLap: boolean; wasNonEmpty: boolean } | null>(null);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    send({ type: 'data:request', payload: {} });
    const headers = [...dataTable.headers];
    const rows = dataTable.rows.map((r) => [...r]);
    // Never truncate data: if any stored row is wider than the headers, extend
    // the headers with synthesized colN names instead.
    const width = rows.reduce((m, r) => Math.max(m, r.length), headers.length);
    while (headers.length < width) headers.push(nextColName(headers));
    gridRef.current = { headers, rows };
    setGridState(gridRef.current);
    loopRef.current = dataTable.loopOverData;
    setLoopState(dataTable.loopOverData);
    const seedOnRowError = dataTable.onRowError === 'skip' ? 'skip' : 'halt';
    onRowErrorRef.current = seedOnRowError;
    setOnRowErrorState(seedOnRowError);
    // Only an explicit false turns it off — a table saved before this feature has no such
    // field, and undefined must read as ON, not as "unchecked".
    const seedNotifyLap = dataTable.notifyOnLapComplete !== false;
    notifyLapRef.current = seedNotifyLap;
    setNotifyLapState(seedNotifyLap);
    seedRef.current = {
      grid: { headers: [...headers], rows: rows.map((r) => [...r]) },
      loopOverData: dataTable.loopOverData,
      onRowError: seedOnRowError,
      notifyLap: seedNotifyLap,
      wasNonEmpty: headers.length > 0 || rows.length > 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Profile switch while open → close immediately: stale local state must never save into another
  // profile's table (latent bug in the pre-redesign panel). The EFFECT lives further down, beside
  // the Clicker one, because both go through closeWithNotice and a dep array cannot reference a
  // const declared after it.
  const initialProfileRef = useRef(activeProfile);

  // ── Derived ──
  const dirty = useMemo(() => {
    const seed = seedRef.current;
    if (!seed) return false;
    return !deepEqualGrid(grid, seed.grid) || loopOverData !== seed.loopOverData
      || onRowError !== seed.onRowError || notifyLap !== seed.notifyLap;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, loopOverData, onRowError, notifyLap]);
  // Memoised because the Clicker close-out effect depends on it; every input is a ref, so the
  // empty dep list is exhaustive and the identity is stable for the life of the panel.
  const dirtyNow = useCallback(() => {
    const seed = seedRef.current;
    if (!seed) return false;
    return !deepEqualGrid(gridRef.current, seed.grid) || loopRef.current !== seed.loopOverData
      || onRowErrorRef.current !== seed.onRowError || notifyLapRef.current !== seed.notifyLap;
  }, []);

  const emptyGrid = grid.headers.length === 0 && grid.rows.length === 0;
  const willClear = emptyGrid && !!seedRef.current?.wasNonEmpty;
  const readOnly = grid.rows.length > READONLY_ROW_CAP;

  // Row cursor (cursor mode). Read LIVE from the store, unlike everything the seed-once rule
  // above governs: that rule protects the user's unsaved GRID edits from a backend push, and a
  // marker position is runtime state with nothing to stomp — it has to follow the run that just
  // moved it (data:cursor). -1 from the backend = never cursored, which behaves as row 0, the
  // same fallback StartAsync applies on a missing key.
  const cursorRow = Math.max(0, dataTable.cursorRow ?? 0);
  // Park the cursor on a row. Allowed even in the read-only (row-cap) state: this is not an edit
  // to the table, and a big list is exactly where re-walking from row 1 hurts most.
  // The cursor points into the SAVED table: the backend checks the row against it and ignores
  // anything past its end on purpose (HandleActionsResetRow). A row added here and not saved yet
  // is past that end, so the click did nothing and nothing said why — it says why now.
  const savedRowCount = dataTable.rows.length;
  const handleSetCursor = useCallback((r: number) => {
    if (r >= savedRowCount) {
      showToast(tt(`Row ${r + 1} isn't saved yet — save the table, then move the cursor there.`,
                   `A linha ${r + 1} ainda não foi salva — salve a tabela e depois mova o cursor para ela.`), 'info');
      return;
    }
    send({ type: 'actions:resetRow', payload: { row: r } });
  }, [send, savedRowCount, showToast, tt]);

  const headerMeta = useMemo(() => {
    const seen = new Map<string, number>();
    return grid.headers.map((h) => {
      const name = h.trim();
      const key = name.toLowerCase();
      const dup = name !== '' && (seen.get(key) ?? 0) > 0;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      return { name, valid: name !== '' && VALID_HEADER.test(name), dup };
    });
  }, [grid.headers]);
  const invalidCount = headerMeta.filter((m) => !m.valid).length;

  // One shared scan: where {row:name} AND {rownext:name} tokens are used across the profile's
  // actions — lib/rowTokenUsage owns the rules (both heads read the same column; BuildRowDict key
  // semantics; a modifier tail counts, an empty one does not).
  const usage = useMemo(() => scanRowTokenUsage(actions), [actions]);
  const orphans = useMemo(() => {
    const have = new Set(grid.headers.map((h) => h.trim().toLowerCase()));
    return [...usage.entries()].filter(([k]) => !have.has(k));
  }, [usage, grid.headers]);

  // Paste parse — debounced for the live preview; apply re-parses the CURRENT
  // text so the last keystrokes before Apply are never lost to the debounce.
  const [debouncedPaste, setDebouncedPaste] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedPaste(pasteText), 120);
    return () => window.clearTimeout(t);
  }, [pasteText]);
  const pasteParsed = useMemo(
    () => parseTsv(debouncedPaste, pasteFirstRowHeader),
    [debouncedPaste, pasteFirstRowHeader],
  );

  // ── Grid ops ──
  const handleEdit = useCallback((r: number, c: number) => setEditing({ kind: 'cell', r, c }), []);
  const handleCellDone = useCallback((r: number, c: number, value: string | null, nav?: 'down' | 'right' | 'left') => {
    if (value !== null) {
      updateGrid((g) => {
        const rows = [...g.rows];
        const row = [...(rows[r] ?? [])];
        while (row.length <= c) row.push('');
        row[c] = value;
        rows[r] = row;
        return { ...g, rows };
      });
    }
    const g = gridRef.current;
    if (value !== null && nav === 'down' && r + 1 < g.rows.length) setEditing({ kind: 'cell', r: r + 1, c });
    else if (value !== null && nav === 'right' && c + 1 < g.headers.length) setEditing({ kind: 'cell', r, c: c + 1 });
    else if (value !== null && nav === 'left' && c > 0) setEditing({ kind: 'cell', r, c: c - 1 });
    else setEditing(null);
  }, [updateGrid]);

  const handleHeaderDone = useCallback((c: number, value: string | null) => {
    if (value !== null) {
      // Headers are trimmed on commit (BuildRowDict trims for lookup); cells never are.
      updateGrid((g) => {
        const headers = [...g.headers];
        headers[c] = value.trim();
        return { ...g, headers };
      });
    }
    setEditing(null);
  }, [updateGrid]);

  const handleDuplicateRow = useCallback((r: number) => {
    updateGrid((g) => {
      const rows = [...g.rows];
      rows.splice(r + 1, 0, [...(g.rows[r] ?? [])]);
      return { ...g, rows };
    });
  }, [updateGrid]);
  const handleDeleteRow = useCallback((r: number) => {
    setEditing(null);
    updateGrid((g) => ({ ...g, rows: g.rows.filter((_, i) => i !== r) }));
  }, [updateGrid]);
  const addRow = () => {
    updateGrid((g) => ({ ...g, rows: [...g.rows, Array(Math.max(1, g.headers.length)).fill('')] }));
    // Open the first cell of the new row immediately.
    setEditing({ kind: 'cell', r: gridRef.current.rows.length - 1, c: 0 });
  };
  const addColumn = () => {
    updateGrid((g) => ({ ...g, headers: [...g.headers, nextColName(g.headers)] }));
    setEditing({ kind: 'header', c: gridRef.current.headers.length - 1 });
  };

  const headerMenuAction = (c: number, a: HeaderMenuAction) => {
    if (a === 'copy') {
      copyToken(`{row:${grid.headers[c].trim()}}`, `h${c}`);
      return;
    }
    // The menu disables these in the large-table state; this is the funnel behind it. Every other
    // grid edit already stood down there (cells, rows, the header rename, both "+" buttons) while
    // the strip announced "grid is read-only" — the column menu and the header fix did not.
    if (readOnly) return;
    setEditing(null);
    if (a === 'delete') {
      updateGrid((g) => ({
        headers: g.headers.filter((_, i) => i !== c),
        rows: g.rows.map((r) => r.filter((_, i) => i !== c)),
      }));
      return;
    }
    if (a === 'insert-left' || a === 'insert-right') {
      const at = a === 'insert-left' ? c : c + 1;
      updateGrid((g) => {
        const headers = [...g.headers];
        headers.splice(at, 0, nextColName(g.headers));
        return {
          headers,
          rows: g.rows.map((r) => {
            const row = [...r];
            while (row.length < g.headers.length) row.push('');
            row.splice(at, 0, '');
            return row;
          }),
        };
      });
      setEditing({ kind: 'header', c: at });
      return;
    }
    // move-left / move-right — swap adjacent columns (rows padded first).
    const to = a === 'move-left' ? c - 1 : c + 1;
    updateGrid((g) => {
      const headers = [...g.headers];
      [headers[c], headers[to]] = [headers[to], headers[c]];
      return {
        headers,
        rows: g.rows.map((r) => {
          const row = [...r];
          while (row.length < g.headers.length) row.push('');
          [row[c], row[to]] = [row[to], row[c]];
          return row;
        }),
      };
    });
  };

  const fixHeader = (c: number) => {
    if (readOnly) return;
    updateGrid((g) => {
      const headers = [...g.headers];
      // Only the token grammar's three characters are swapped for '_' — the rest of the header
      // (spaces, accents) IS a valid column name now, and rewriting it would rename the column.
      let base = headers[c].trim().replace(/[{}:]+/g, '_').replace(/^_+|_+$/g, '').trim();
      if (base === '') base = `col${c + 1}`;
      // Dedupe against the OTHER headers (case-insensitive).
      const others = new Set(headers.filter((_, i) => i !== c).map((h) => h.trim().toLowerCase()));
      let name = base;
      let n = 2;
      while (others.has(name.toLowerCase())) name = `${base}_${n++}`;
      headers[c] = name;
      return { ...g, headers };
    });
  };

  const clearTable = () => {
    setEditing(null);
    updateGrid(() => ({ headers: [], rows: [] }));
    setArmedClear(false);
  };

  const seedSample = () => {
    updateGrid(() => ({
      headers: ['name', 'email', 'amount'],
      rows: [
        ['Maria', 'maria@example.com', '89.90'],
        ['João', 'joao@example.com', '149.00'],
        ['Ana', 'ana@example.com', '32.50'],
      ],
    }));
  };

  // The ✓ appears only when the write landed; a refused one (the window without OS focus, a
  // clipboard held by another app) used to be an unhandled rejection with no ✓ and no word.
  const copyFailed = () => showToast(tt('Could not copy — click inside the window and try again.',
                                        'Não foi possível copiar — clique dentro da janela e tente de novo.'), 'error');
  const copyToken = (token: string, key: string) => {
    navigator.clipboard?.writeText(token).then(() => {
      setCopiedKey(key);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopiedKey(null), 1000);
    }, copyFailed);
  };

  // ── Paste surface ──
  const openPaste = () => {
    const g = gridRef.current;
    const prefill = g.headers.length || g.rows.length ? encodeTsv(g.headers, g.rows) : '';
    prefillRef.current = prefill;
    setPasteText(prefill);
    setPasteMode('replace');
    setPasteFirstRowHeader(true);
    setPasteOpen(true);
  };

  // ── CSV/TSV file import ── routes the file through the SAME paste surface (Replace) so its live
  // preview + first-row-header toggle apply. Sniffs the delimiter (Brazilian Excel writes ';') and
  // re-encodes to the TAB-delimited TSV the surface parses; quoting is preserved by tokenizeTsvGrid.
  const csvInputRef = useRef<HTMLInputElement>(null);
  const importCsvFile = (file: File) => {
    const reader = new FileReader();
    // Every other FileReader in the app says so when the read fails (a file held by another
    // process, a drive that went away); this one did nothing at all, so Import CSV looked broken.
    reader.onerror = () => showToast(tt('Could not read that file.', 'Não foi possível ler esse arquivo.'), 'error');
    reader.onload = () => {
      const text = String(reader.result ?? '');
      if (text.trim() === '') return;
      const grid = tokenizeTsvGrid(text, sniffDelimiter(text));
      prefillRef.current = '';
      setPasteMode('replace');
      setPasteFirstRowHeader(true);
      setPasteText(encodeTsv(grid[0] ?? [], grid.slice(1)));
      setPasteOpen(true);
    };
    reader.readAsText(file);
  };
  const handlePasteModeChange = (m: PasteMode) => {
    // Switching to Append clears the box IFF it still equals the prefill —
    // otherwise the user would append the table to itself.
    if (m === 'append' && pasteText === prefillRef.current) setPasteText('');
    setPasteMode(m);
  };
  const applyPaste = () => {
    // Re-parse the LIVE text (the 120ms debounce may lag the preview).
    const parsed = parseTsv(pasteText, pasteFirstRowHeader);
    if (parsed.headers.length === 0) return;
    if (pasteMode === 'replace') {
      // Extend the headers over the widest pasted row, the same way the seed does when a stored
      // table is wider than its headers. Without it the extra cells were kept but invisible — the
      // grid draws headers.length columns — and only surfaced as a synthesised colN the NEXT time
      // the panel opened, which is also what made the paste surface's "extra cells become new
      // columns" read as a lie in the moment it mattered.
      const headers = [...parsed.headers];
      const width = parsed.rows.reduce((m, r) => Math.max(m, r.length), headers.length);
      while (headers.length < width) headers.push(nextColName(headers));
      updateGrid(() => ({ ...parsed, headers }));
    } else {
      // Append: map pasted columns onto existing headers by trimmed,
      // case-insensitive name (BuildRowDict semantics); unmatched pasted
      // columns become new headers; missing cells resolve empty.
      updateGrid((g) => {
        const headers = [...g.headers];
        const keyOf = (h: string) => h.trim().toLowerCase();
        // `headers` is mutated (push) INSIDE this same map, over the pasted headers it is
        // also being matched against. That's fine the FIRST time a given key is seen — but
        // without tracking claimed keys, a SECOND pasted column sharing that key (two "Nome"
        // columns, or "Nome" + "nome") would findIndex its way onto the slot the first one
        // just claimed, existing or freshly pushed. out[idxMap[i]] = cell below then lets
        // whichever row runs last silently overwrite the earlier column's data — not even
        // merged under a visible duplicate header, just gone, no warning.
        //
        // Fix: only the FIRST pasted occurrence of a key may match/reuse a header slot;
        // every repeat is disambiguated with the same "_2", "_3", … suffix fixHeader (above)
        // already uses, so it always lands in its OWN new column. That keeps the outcome
        // self-evident in the grid itself (you see "Nome" and "Nome_2" right after pasting)
        // instead of relying on the quieter dup-underline+tooltip this file uses for headers
        // a user created some other way — no data is ever dropped silently.
        const claimedKeys = new Set<string>();
        const idxMap = parsed.headers.map((h) => {
          const key = keyOf(h);
          if (!claimedKeys.has(key)) {
            claimedKeys.add(key);
            // The LAST existing column with that name, and only among the table's own columns:
            // BuildRowDict keeps the last occurrence of a duplicated header (the header's own
            // tooltip says "the last one wins"), so appending into the first one filled a column
            // {row:Name} never reads — the pasted values were in the grid and invisible to the
            // run. Columns this paste just added are not candidates: a later pasted "nome_2"
            // would otherwise land on the "Nome_2" slot made for a repeated "Nome".
            for (let i = g.headers.length - 1; i >= 0; i--) {
              if (keyOf(g.headers[i]) === key) return i;
            }
          }
          let name = h.trim();
          if (headers.some((eh) => keyOf(eh) === keyOf(name))) {
            const base = name;
            let n = 2;
            while (headers.some((eh) => keyOf(eh) === keyOf(`${base}_${n}`))) n++;
            name = `${base}_${n}`;
          }
          headers.push(name);
          return headers.length - 1;
        });
        // A row LONGER than its own header line grows the table, exactly as the paste dialog
        // promises and as this file's own doctrine demands twice over ("Never truncate data…
        // extend the headers with synthesized colN names", "no data is ever dropped silently").
        // The `i < idxMap.length` guard dropped those cells without a word — in Append only, so
        // the same paste kept its data in Replace and lost it here.
        const widest = parsed.rows.reduce((m, r) => Math.max(m, r.length), 0);
        for (let i = idxMap.length; i < widest; i++) {
          headers.push(nextColName(headers));
          idxMap.push(headers.length - 1);
        }
        const newRows = parsed.rows.map((r) => {
          const out = Array(headers.length).fill('');
          r.forEach((cell, i) => { if (i < idxMap.length) out[idxMap[i]] = cell; });
          return out;
        });
        return { headers, rows: [...g.rows, ...newRows] };
      });
    }
    setPasteOpen(false);
  };

  // ── Save — instant close (DialogShell confirm doctrine: the backend persists
  // synchronously and re-pushes data:table, so the closing dialog IS the feedback).
  // The refusal lives HERE, at the one place `data:save` leaves, and not on the buttons: Save,
  // Clear table and Ctrl+Enter all funnel through handleSave, and Ctrl+Enter reaches it from the
  // card's key handler without ever consulting a button's `disabled`.
  //
  // bb06849 gated the toolbar button that OPENS this panel and said "the toolbar is its ONLY entry
  // point, so this gate is the whole story". That is the whole story for opening it — not for a
  // panel that was already open when the run started or when the mode flipped. Runs begin on a
  // global hotkey and ScrLk flips the mode from inside any app, so "already open" is the ordinary
  // case, not the exotic one.
  const lastRefusalRef = useRef(0);
  const refuseWrite = useCallback(() => {
    if (!isClicker && !runActive) return false;
    const now = Date.now();
    if (now - lastRefusalRef.current > 2000) {
      lastRefusalRef.current = now;
      showToast(isClicker
        ? tt('The data table is unavailable in Clicker mode — only macro rows read it.',
             'A tabela de dados não vale no modo Clicker — só as linhas de macro a leem.')
        : tt('The data table is locked while a run is active.',
             'A tabela de dados está travada enquanto um run está ativo.'), 'error');
    }
    return true;
  }, [isClicker, runActive, showToast, tt]);

  const handleSave = () => {
    if (!dirtyNow()) return;
    // After the dirty check on purpose: with nothing to write there is nothing to refuse, and a
    // toast for a no-op save would be noise.
    if (refuseWrite()) return;
    const g = gridRef.current;
    const rows = [...g.rows];
    // Parity with the old parseTsv: trailing all-empty rows are dropped; kept
    // rows are padded to the header count so the wire shape is rectangular.
    while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
    const padded = rows.map((r) => {
      const row = [...r];
      while (row.length < g.headers.length) row.push('');
      return row.slice(0, Math.max(g.headers.length, row.length));
    });
    send({ type: 'data:save', payload: { headers: g.headers, rows: padded, loopOverData: loopRef.current, onRowError: onRowErrorRef.current, notifyOnLapComplete: notifyLapRef.current } });
    onClose();
  };

  // Is there work the user would miss? The GRID is only half the answer. The paste surface holds
  // its text in local state until Apply writes it to the grid, so a paste or a CSV import that has
  // not been applied yet is invisible to dirtyNow() — and above MAX_EDITABLE rows the grid is
  // read-only and that surface is the ONLY editor, so in exactly the biggest tables 100% of the
  // work lives there. Measured against prefillRef, never against "non-empty": the box opens
  // pre-filled with the current table, and handlePasteModeChange empties it when switching to
  // Append, so both of those are a clean box, not pending work.
  const workPending = useCallback(
    () => dirtyNow() || (pasteOpen && pasteText.trim() !== '' && pasteText !== prefillRef.current),
    [dirtyNow, pasteOpen, pasteText]);
  // The same answer, told to the backend (the render-time twin of workPending: `dirty` is the
  // memo of what dirtyNow reads). Without it the window's close guard and the silent update after
  // a run saw a clean profile and threw the table away without a word — and an automation fire,
  // which swaps the profile and so closes this panel, went ahead over it too.
  useEditorClaim('data-panel', dirty || (pasteOpen && pasteText.trim() !== '' && pasteText !== prefillRef.current));

  // ONE door for every close this panel does not choose, so the next one cannot be born mute.
  // Both callers are events that arrive from OUTSIDE the window — ScrLk and a global profile
  // hotkey — which is why neither can be left silent: the user is not looking at this panel when
  // it happens. Only claims discarded work when there was some; a toast that invents a loss is its
  // own bug. The ref makes it fire once — onClose runs through the parent's state, so this can
  // render again before the unmount lands and each pass would toast anew.
  const forcedCloseRef = useRef(false);
  const closeWithNotice = useCallback((en: string, ptBr: string) => {
    if (forcedCloseRef.current) return;
    forcedCloseRef.current = true;
    const lost = workPending();
    showToast(tt(
      lost ? `${en} — unsaved changes were discarded.` : en,
      lost ? `${ptBr} — as alterações não salvas foram descartadas.` : ptBr), 'error');
    onClose();
  }, [workPending, showToast, tt, onClose]);

  // CLOSE on the mode flip, REFUSE during a run — the split the rest of this release follows.
  // Clicker takes the surface away rather than locking it: the table exists to feed {row:column}
  // tokens, and only macro rows read those, so in Clicker there is nothing left that could consume
  // it. A run is the other case — the table is still the right table, it is just being iterated.
  useEffect(() => {
    if (!isClicker) return;
    closeWithNotice('Clicker mode closed the data table',
                    'O modo Clicker fechou a tabela de dados');
  }, [isClicker, closeWithNotice]);

  // The older sibling of the effect above, and it used to close MUTE. Same shape of event: the
  // profile changes from a global hotkey, the tray menu or an armed automation — never from this
  // dialog, which is modal with a backdrop — so the user is not looking here when the table and
  // everything typed into it disappears. It does NOT save on the way out: the comment on
  // initialProfileRef is right that stale local state must never write another profile's table.
  // Saying so is the part that was missing.
  useEffect(() => {
    if (activeProfile === initialProfileRef.current) return;
    closeWithNotice('Another profile was loaded — the data table was closed',
                    'Outro perfil foi carregado — a tabela de dados foi fechada');
  }, [activeProfile, closeWithNotice]);

  // ── Esc router — ONE capture-phase ladder. Chip/header popovers own their Esc
  // ([data-popover] stand-down); the open cell editor owns its Esc (target-level
  // revert). Below those: paste surface → armed clear → dirty double-press arm →
  // (fall through to DialogShell's card handler = close with exit animation).
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[data-popover]')) return;
      if (editingRef.current) return; // CellEditor reverts + stops propagation itself
      if (pasteOpen) {
        e.preventDefault();
        e.stopPropagation();
        setPasteOpen(false);
        return;
      }
      if (armedClear) {
        e.preventDefault();
        e.stopPropagation();
        setArmedClear(false);
        return;
      }
      if (dirtyNow() && !escArmedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        escArmedRef.current = true;
        setEscArmed(true);
        window.clearTimeout(escTimer.current);
        escTimer.current = window.setTimeout(() => {
          escArmedRef.current = false;
          setEscArmed(false);
        }, 2500);
        return;
      }
      // Clean, or second Esc while armed → let DialogShell close the dialog.
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
    // dirtyNow is a useCallback with an empty dep list (every input is a ref), so naming it here
    // costs no extra re-subscription — the listener is still attached once per pasteOpen/armedClear.
  }, [pasteOpen, armedClear, dirtyNow]);

  // ── Status strip ──
  const stripLeft = (
    <span className="text-[11px] text-text-tertiary tabular-nums whitespace-nowrap">
      {grid.headers.length} {'columns'} · {grid.rows.length} {'rows'}
      {loopOverData && grid.rows.length > 0 && (
        <span style={{ color: 'var(--color-replay-fg)' }}> · {grid.rows.length} {'iterations/run'}</span>
      )}
      {dirty && <span className="text-warning-ink"> · {'unsaved'}</span>}
      {invalidCount > 0 && <span className="text-warning-ink"> · {invalidCount} {'invalid'}</span>}
    </span>
  );
  // Hint ladder — first match wins.
  const stripRight = (() => {
    const cls = 'text-[10px] truncate';
    if (editing) return <span className={`${cls} text-text-tertiary`}>{'Enter commits · Alt+Enter line break · Esc reverts'}</span>;
    if (willClear) return <span className={`${cls} text-warning-ink`}>{'Saving now clears the stored table.'}</span>;
    if (loopOverData && grid.rows.length === 0) return <span className={`${cls} text-warning-ink`}>{'No rows — replay won’t start.'}</span>;
    if (escArmed) return <span className={`${cls} text-warning-ink`}>{'Unsaved changes — press Esc again to discard.'}</span>;
    if (readOnly) return <span className={`${cls} text-warning-ink`}>{'Large table — grid is read-only; edit via Paste / bulk edit.'}</span>;
    if (grid.rows.length >= LARGE_TABLE_WARN) return <span className={`${cls} text-text-tertiary`}>{'Large table — the profile file grows with it.'}</span>;
    if (!loopOverData && !emptyGrid) return <span className={`${cls} text-text-tertiary`}>{`Next run uses row ${cursorRow + 1} · click a row number to move the cursor`}</span>;
    return <span className={`${cls} text-text-tertiary`}>{'Click a cell to edit · Ctrl+Enter saves'}</span>;
  })();

  // ── Find box — sits on the table's own header bar, beside the counts, not in the rail:
  //    it searches the table, so it belongs to the table. Highlights in place, never hides rows.
  const findBox = (
    <div className="flex items-center gap-2 min-w-0">
      <div className="relative flex items-center w-52">
        <Search size={12} className="absolute left-2 text-text-tertiary pointer-events-none" />
        <input
          type="text"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (find !== findTerm) {
              // The term is still in the debounce: apply it now and show its first hit, the
              // "1/N" the counter is about to read.
              setFindTerm(find);
              const lower = find.trim().toLowerCase();
              const first = lower === '' ? -1 : grid.rows.findIndex((row) => row.some((cell) => cell.toLowerCase().includes(lower)));
              if (first >= 0) gridScrollRef.current?.querySelector(`[data-row="${first}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              return;
            }
            jumpToMatch(e.shiftKey ? -1 : 1);
          }}
          placeholder={'Find in table…'}
          className="input-inline pl-7 pr-7 font-sans text-[11px]"
        />
        {find && (
          <button
            type="button"
            onClick={() => { setFind(''); setFindTerm(''); }}
            className="absolute right-1.5 text-text-disabled hover:text-text-secondary"
          >
            <X size={11} />
          </button>
        )}
      </div>
      {findLower !== '' && (
        <span className="flex items-center gap-1 text-[10px] text-text-tertiary tabular-nums whitespace-nowrap">
          <span>{matchRows.length === 0 ? 'No matches' : `${matchRows.length} row${matchRows.length === 1 ? '' : 's'}`}</span>
          {matchRows.length > 0 && (
            <>
              <button type="button" onClick={() => jumpToMatch(-1)} className="px-1 hover:text-text-primary" data-tip={tt('Previous (Shift+Enter)', 'Anterior (Shift+Enter)')}>↑</button>
              <button type="button" onClick={() => jumpToMatch(1)} className="px-1 hover:text-text-primary" data-tip={tt('Next (Enter)', 'Próximo (Enter)')}>↓</button>
              <span>{findPos + 1}/{matchRows.length}</span>
            </>
          )}
        </span>
      )}
    </div>
  );

  // ── Footer (swaps while the paste surface is open) ──
  const footerHint = pasteOpen ? <>{'Tabs, quotes and line breaks survive the paste'}</> : null;

  const applyLabel = pasteMode === 'replace'
    ? 'Replace table'
    : `${'Append'} ${pasteParsed.rows.length} ${'rows'}`;

  return (
    <DialogShell
      icon={<Table2 size={14} className="text-accent-light" />}
      title="Data Loop"
      size="full"
      onClose={onClose}
      closeOnBackdrop={false}
      showClose
      footerHint={footerHint}
      footer={(requestClose) =>
        pasteOpen ? (
          <>
            <Button variant="secondary" size="md" onClick={() => setPasteOpen(false)}>Cancel</Button>
            <Button variant="primary" size="md" onClick={applyPaste} disabled={pasteParsed.headers.length === 0}>
              {applyLabel}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="md" onClick={requestClose}>Cancel</Button>
            {willClear ? (
              <span data-tip={tt("Deletes this profile's data table", 'Apaga a tabela de dados deste profile')}>
                <Button variant="destructive" size="md" onClick={handleSave}>Clear table</Button>
              </span>
            ) : (
              <Button variant="primary" size="md" onClick={handleSave} disabled={!dirty}>Save</Button>
            )}
          </>
        )
      }
      onCardKeyDown={(e) => {
        // Ctrl+Enter routes by layer: paste surface → apply; otherwise save when
        // dirty. A cell editor commits itself on Ctrl+Enter (gridRef is synced
        // synchronously) and lets the event bubble here, so commit+save is one press.
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          if (pasteOpen) applyPaste();
          else handleSave();
        }
        // Ctrl+Z undoes the last grid change — but not while the paste surface is open (its textarea
        // owns undo), while a cell editor is focused, or while any text input (e.g. the Find box) has
        // focus (those own their own text undo). Undo-only: there is no redo stack.
        else if (
          (e.key === 'z' || e.key === 'Z') && e.ctrlKey && !e.shiftKey
          && !pasteOpen && !editingRef.current
          && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
        ) {
          e.preventDefault();
          undo();
        }
      }}
    >
      {/* Body — `relative` is load-bearing: the paste surface overlays inside it. */}
      <div className="relative flex flex-1 min-h-0">
        {/* ── Hero column: header bar (counts + find) · grid · status strip (hints) ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          {!emptyGrid && (
            <div className="h-row shrink-0 px-3 flex items-center justify-between gap-3 bg-bg-card border-b border-border-subtle">
              {stripLeft}
              {findBox}
            </div>
          )}
          {emptyGrid ? (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 bg-bg-surface">
              <Table2 size={24} className="text-text-tertiary" />
              <div className="text-sm text-text-primary">{'No data table'}</div>
              <div className="text-xs text-text-tertiary max-w-[340px] text-center leading-relaxed">
                {'Each row runs the profile once; columns become {row:column} tokens.'}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <Button variant="primary" size="sm" onClick={openPaste}>
                  {'Paste table…'}
                </Button>
                <Button variant="ghost" size="sm" onClick={seedSample}>
                  {'Start with sample data'}
                </Button>
              </div>
            </div>
          ) : (
            <div
              ref={gridScrollRef}
              tabIndex={-1}
              className="flex-1 min-h-0 overflow-auto bg-bg-surface outline-none"
            >
              <table
                className="border-separate border-spacing-0"
                style={{ minWidth: 44 + grid.headers.length * 160 + 36, tableLayout: 'fixed' }}
              >
                <colgroup>
                  <col style={{ width: 44 }} />
                  {grid.headers.map((_, i) => <col key={i} style={{ width: 160 }} />)}
                  <col style={{ width: 36 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th
                      onClick={() => copyToken('{row}', '__rownum')}
                      className="sticky top-0 left-0 z-20 bg-bg-surface shadow-[inset_-1px_0_0_var(--color-border-subtle),inset_0_-1px_0_var(--color-border-subtle)] h-row text-[10px] text-text-tertiary text-right pr-2 select-none cursor-pointer"
                      data-tip={tt('{row} — click to copy the token', '{row} — clique para copiar o token')}
                    >
                      {copiedKey === '__rownum' ? <Check size={11} className="inline text-[color:var(--color-replay-fg)]" /> : '#'}
                    </th>
                    {grid.headers.map((h, c) => {
                      const meta = headerMeta[c];
                      const editingThis = editing?.kind === 'header' && editing.c === c;
                      return (
                        <th
                          key={c}
                          className={`group sticky top-0 z-10 bg-bg-surface shadow-[inset_0_-1px_0_var(--color-border-subtle)] h-row text-left text-xs font-semibold font-mono px-2 whitespace-nowrap ${
                            meta.valid ? 'text-text-tertiary' : 'text-warning-ink'
                          } ${editingThis ? 'shadow-[inset_0_0_0_1.5px_var(--color-accent-solid)] bg-bg-input' : ''}`}
                        >
                          {editingThis ? (
                            <CellEditor
                              initial={h}
                              multiline={false}
                              onDone={(value) => handleHeaderDone(c, value)}
                            />
                          ) : (
                            <span className="flex items-center gap-1.5">
                              {!meta.valid && <TriangleAlert size={11} className="shrink-0" />}
                              <button
                                type="button"
                                onClick={() => { if (!readOnly) setEditing({ kind: 'header', c }); }}
                                className={`truncate ${meta.dup ? 'underline decoration-dotted decoration-warning-ink underline-offset-2' : ''} ${readOnly ? '' : 'cursor-text'}`}
                                data-tip={meta.dup ? tt('Duplicate column — the last one wins', 'Coluna duplicada — a última vence') : undefined}
                              >
                                {meta.name || <span className="text-text-disabled italic">({'empty'})</span>}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => setHeaderMenu({ c, anchor: e.currentTarget })}
                                className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-bg-card text-text-tertiary hover:text-text-primary transition-all shrink-0 ml-auto"
                              >
                                <MoreHorizontal size={12} />
                              </button>
                            </span>
                          )}
                        </th>
                      );
                    })}
                    <th className="sticky top-0 z-10 bg-bg-surface shadow-[inset_0_-1px_0_var(--color-border-subtle)] h-row">
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={addColumn}
                          className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-card transition-colors"
                          data-tip={tt('Add column', 'Adicionar coluna')}
                        >
                          <Plus size={12} />
                        </button>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((row, r) => (
                    <GridRow
                      key={r}
                      row={row}
                      r={r}
                      colCount={grid.headers.length}
                      editingCol={editing?.kind === 'cell' && editing.r === r ? editing.c : null}
                      readOnly={readOnly}
                      zebra={r % 2 === 1}
                      find={findLower}
                      onEdit={handleEdit}
                      onCellDone={handleCellDone}
                      onDuplicate={handleDuplicateRow}
                      onDelete={handleDeleteRow}
                      isCursor={!loopOverData && r === cursorRow}
                      onSetCursor={loopOverData ? null : handleSetCursor}
                    />
                  ))}
                  {!readOnly && (
                    <tr>
                      <td colSpan={grid.headers.length + 2}>
                        <button
                          type="button"
                          onClick={addRow}
                          className="w-full h-row flex items-center gap-1.5 px-3 text-[11px] text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors"
                        >
                          <Plus size={12} />
                          {'Add row'}
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {/* Status strip — the hint ladder; the counts moved up to the header bar. */}
          <div className="h-7 shrink-0 px-4 flex items-center justify-end gap-3 bg-bg-card border-t border-border-subtle">
            {stripRight}
          </div>
        </div>

        {/* ── Rail ── */}
        <div className="w-[300px] shrink-0 border-l border-border-subtle flex flex-col min-h-0 overflow-y-auto">
          {/* RUN */}
          <div className="label-micro text-text-tertiary px-3 pt-2.5 pb-1">Run</div>
          <button
            type="button"
            role="checkbox"
            aria-checked={loopOverData}
            onClick={() => setLoop(!loopOverData)}
            className="flex items-center gap-2 px-3 py-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
            data-tip={tt(
              'Runs the profile once per row. Overrides Loop count and infinite replay.',
              'Roda o perfil uma vez por linha. Sobrepõe o Loop count e o replay infinito.',
            )}
          >
            <CheckboxBox checked={loopOverData} />
            <span className="flex items-center gap-1.5"><Repeat size={13} /> Loop over data</span>
          </button>
          <div className="px-3 pt-1.5 pb-2">
            {loopOverData && grid.rows.length > 0 ? (
              <div
                className="border-l-2 rounded px-2.5 py-2 text-[11px] leading-relaxed"
                style={{
                  background: 'color-mix(in srgb, var(--color-replay) 8%, transparent)',
                  borderColor: 'var(--color-replay-fg)',
                  color: 'var(--color-replay-fg)',
                }}
              >
                {`${grid.rows.length} runs, one per row — overrides Loop count and WhilePressed/Toggle looping.`}
              </div>
            ) : loopOverData ? (
              <div
                className="border-l-2 rounded px-2.5 py-2 text-[11px] leading-relaxed"
                style={{
                  background: 'color-mix(in srgb, var(--color-recording) 8%, transparent)',
                  borderColor: 'var(--color-recording-fg)',
                  color: 'var(--color-recording-fg)',
                }}
              >
                {'No rows — replay won’t start.'}
              </div>
            ) : (
              <div className="border-l-2 border-border-subtle rounded px-2.5 py-2 text-[11px] leading-relaxed text-text-tertiary">
                {'Each run uses the marked row, then advances (wrapping). Click a row number to move the cursor. The advance happens at start, so a stopped run has still consumed its row.'}
              </div>
            )}
            {/* Lap notice — the cursor-mode counterpart of "On row error": it only means
                anything while the cursor is advancing, and a 1-row table would "finish"
                on every run, so it renders under exactly the conditions the engine checks
                (no dead control, no promise the backend won't keep). */}
            {!loopOverData && grid.rows.length > 1 && (
              <button
                type="button"
                role="checkbox"
                aria-checked={notifyLap}
                onClick={() => setNotifyLap(!notifyLap)}
                className="mt-2 flex items-center gap-2 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
                data-tip={tt(
                  'Chime and tray balloon when the list finishes',
                  'Som e balão na bandeja quando a lista acaba',
                )}
              >
                <CheckboxBox checked={notifyLap} />
                <span className="flex items-center gap-1.5"><Bell size={12} /> {'Notify on list complete'}</span>
              </button>
            )}
            {/* Per-row error policy — renders wherever something walks this table row by row and
                so obeys it: Loop over data, a For Each Data Row block here, or a caller's Run once
                per data row. Plain cursor mode with none of those reads nothing, so it stays
                hidden there (no dead control). */}
            {(loopOverData || usesForEach || overDataCallers.length > 0) && (
              <div className="pt-2">
                <div className="label-micro text-text-tertiary pb-1">{'On row error'}</div>
                <SegmentedControl<'halt' | 'skip'>
                  ariaLabel="On row error"
                  grow
                  value={onRowError}
                  onChange={setOnRowError}
                  options={[
                    { value: 'halt', label: 'Halt', tip: tt('Stop at the first failed row', 'Para na primeira linha com erro') },
                    { value: 'skip', label: 'Skip row', tip: tt('Log it and continue; summary at the end', 'Registra e continua; resumo no final') },
                  ]}
                />
                {!loopOverData && (
                  <div
                    className="pt-1.5 text-[11px] leading-relaxed text-text-tertiary"
                    data-tip={overDataCallers.length > 1 ? overDataCallers.join(', ') : undefined}
                  >
                    {rowPolicyScope}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* COLUMNS · TOKENS */}
          {(grid.headers.length > 0 || orphans.length > 0) && (
            <>
              <div className="label-micro text-text-tertiary px-3 pt-2 pb-1">{'Columns · tokens'}</div>
              <div className="flex flex-col">
                {grid.headers.map((_, c) => {
                  const meta = headerMeta[c];
                  const key = meta.name.toLowerCase();
                  const count = meta.valid ? (usage.get(key)?.count ?? 0) : 0;
                  return (
                    <div key={c} className="flex items-center gap-1.5 px-3 py-1 min-w-0">
                      {meta.valid ? (
                        <>
                          <button
                            type="button"
                            onClick={() => copyToken(`{row:${meta.name}}`, `h${c}`)}
                            className={`${CHIP_CLASS} min-w-0`}
                            data-tip={tt(
                              'Copy token',
                              'Copiar token',
                            )}
                          >
                            {copiedKey === `h${c}` ? (
                              <span className="flex items-center gap-1" style={{ color: 'var(--color-replay-fg)' }}>
                                <Check size={11} /> {'Copied'}
                              </span>
                            ) : (
                              <span className="truncate">{`{row:${meta.name}}`}</span>
                            )}
                          </button>
                          <span
                            className={`text-[10px] tabular-nums ml-auto shrink-0 ${count > 0 ? 'text-text-tertiary' : 'text-text-disabled'}`}
                            data-tip={count > 0 ? tt(`Used in ${count} action(s)`, `Usado em ${count} action(s)`) : undefined}
                          >
                            {count > 0 ? `×${count}` : 'unused'}
                          </span>
                        </>
                      ) : (
                        <>
                          <TriangleAlert size={11} className="text-warning-ink shrink-0" />
                          <span className="text-[11px] font-mono text-warning-ink truncate">
                            {meta.name || `(${'empty'})`}
                          </span>
                          <button
                            type="button"
                            onClick={() => fixHeader(c)}
                            disabled={readOnly}
                            className="w-6 h-6 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-card transition-colors ml-auto shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                            data-tip={readOnly
                              ? tt('Not a valid token name ({ } : not allowed) — the grid is read-only, fix it via Paste / bulk edit',
                                   'Nome inválido para token ({ } : não podem) — a grade está só leitura, corrija pelo Paste / bulk edit')
                              : tt(
                                'Not a valid token name ({ } : not allowed) — click to fix',
                                'Nome inválido para token ({ } : não podem) — clique para corrigir',
                              )}
                          >
                            <Wand2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
                {orphans.map(([name, u]) => (
                  <div key={name} className="flex items-center gap-1.5 px-3 py-1 min-w-0">
                    <TriangleAlert size={11} className="text-warning-ink shrink-0" />
                    {/* Drawn with the head the author wrote, so a {rownext:Ghost} reads as itself. */}
                    <span className="text-[11px] font-mono text-warning-ink truncate">{`{${orphanHead(u)}:${name}}`}</span>
                    <span
                      className="text-[10px] text-warning-ink ml-auto shrink-0"
                      data-tip={tt('Referenced by an action, but no such column — types empty text', 'Referenciada por uma action, mas a coluna não existe — digita texto vazio')}
                    >
                      ×{u.count} · {'no column'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-text-tertiary px-3 pt-1 pb-2">
                {'Case-insensitive. {row} = row number. Transforms: type {row:name:trim:upper} or click a {row:…} chip.'}
              </div>
            </>
          )}

          <div className="label-micro text-text-tertiary px-3 pt-2 pb-1 border-t border-border-subtle">Data</div>
          <div className="flex flex-col pb-2">
            <button
              type="button"
              onClick={openPaste}
              className="flex items-center gap-2 px-3 h-7 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors"
            >
              <ClipboardPaste size={12} className="shrink-0" />
              {'Paste / bulk edit…'}
            </button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importCsvFile(f);
                e.target.value = ''; // allow re-picking the same file
              }}
            />
            <button
              type="button"
              onClick={() => csvInputRef.current?.click()}
              className="flex items-center gap-2 px-3 h-7 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors"
            >
              <FileUp size={12} className="shrink-0" />
              {'Import CSV…'}
            </button>
            <button
              type="button"
              onClick={() => {
                const g = gridRef.current;
                navigator.clipboard?.writeText(encodeTsv(g.headers, g.rows)).then(() => {
                  setCopiedKey('__table');
                  window.clearTimeout(copiedTimer.current);
                  copiedTimer.current = window.setTimeout(() => setCopiedKey(null), 1000);
                }, copyFailed);
              }}
              disabled={emptyGrid}
              className="flex items-center gap-2 px-3 h-7 text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors disabled:opacity-40 disabled:cursor-not-allowed"            >
              {copiedKey === '__table' ? <Check size={12} className="shrink-0" style={{ color: 'var(--color-replay-fg)' }} /> : <Copy size={12} className="shrink-0" />}
              {'Copy table (TSV)'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!armedClear) { setArmedClear(true); return; }
                clearTable();
              }}
              disabled={emptyGrid}
              className={`flex items-center gap-2 px-3 h-7 text-[11px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                armedClear ? 'text-[color:var(--color-recording-fg)] hover:bg-[color-mix(in_srgb,var(--color-recording)_15%,transparent)]' : 'text-text-secondary hover:text-text-primary hover:bg-bg-card'
              }`}
            >
              <Trash2 size={12} className="shrink-0" />
              {armedClear ? 'Really clear?' : 'Clear table…'}
            </button>
          </div>
        </div>

        {/* ── Paste sub-surface (overlay; the grid never unmounts) ── */}
        {pasteOpen && (
          <DataPasteSurface
            text={pasteText}
            onTextChange={setPasteText}
            mode={pasteMode}
            onModeChange={handlePasteModeChange}
            firstRowHeader={pasteFirstRowHeader}
            onFirstRowHeaderChange={setPasteFirstRowHeader}
            parsed={pasteParsed}
            hasExistingTable={!emptyGrid}
            onBack={() => setPasteOpen(false)}
          />
        )}
      </div>

      {/* Header ⋯ menu (portal) */}
      {headerMenu && (
        <HeaderMenu
          anchor={headerMenu.anchor}
          header={grid.headers[headerMenu.c] ?? ''}
          colIndex={headerMenu.c}
          colCount={grid.headers.length}
          readOnly={readOnly}
          onAction={(a) => headerMenuAction(headerMenu.c, a)}
          onClose={() => setHeaderMenu(null)}
        />
      )}
    </DialogShell>
  );
}
