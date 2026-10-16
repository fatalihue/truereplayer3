import { useRef, useState } from 'react';
import { useTt } from '../state/LanguageContext';
import { Clock, Trash2, X, Crosshair, MessageSquare, Eye, EyeOff, ArrowUpToLine, ArrowDownToLine, Eraser } from 'lucide-react';
import { iconButtonClass } from './common/IconButton';
import { Button } from './common/Button';
import { SegmentedControl } from './common/SegmentedControl';

export type BulkEditMode = 'set' | 'add';

interface BulkActionBarProps {
  selectedCount: number;
  allSelectedSkipped: boolean;
  // How many selected rows carry a note (any non-empty text, spaces included). Disables the
  // Notes editor's Clear when there is nothing to clear — same honesty as canMoveUp/Down.
  notedCount: number;
  // True when no selection can move further in that direction (first row selected
  // for Up, last row selected for Down). Disables the corresponding button rather
  // than no-op'ing the click — keeps the bar's affordance honest.
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClearSelection: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSetDelay: (mode: BulkEditMode, delay: number) => void;
  onSetCoord: (axis: 'x' | 'y', mode: BulkEditMode, value: number) => void;
  onSetComment: (comment: string) => void;
  onClearNotes: () => void;
  onToggleSkip: () => void;
}

// Range of the C# `int` the backend reads the value into. The bound is part of the accepted
// grammar rather than a nicety: past it, there is no number to send.
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

// The MODE says what the number does, never its sign. The sign used to be the operator — a
// leading +/- meant "offset" — so "-10" moved every selected click 10 px left and there was no
// way to SET a negative coordinate (a monitor left of the primary) from here at all. Now Set
// takes a signed number as the value and refuses a leading "+" (it can only mean "add", which is
// the other segment); Add takes either sign, and no sign adds.
const coordPattern = (mode: BulkEditMode) => (mode === 'set' ? /^-?\d+$/ : /^[+-]?\d+$/);
const isValidCoordValue = (v: string, mode: BulkEditMode) =>
  coordPattern(mode).test(v) && Number(v) >= INT32_MIN && Number(v) <= INT32_MAX;

// The Delay, under the same two modes. Set takes digits only — a delay is never negative, so a
// sign has nothing to mean there — up to the C# int it becomes (parseInt used to read a PREFIX:
// "5oo" set every row to 5 ms). Add takes either sign; a sum below 0 stops at 0 on the far side,
// and says how many rows it stopped.
const isValidDelayValue = (v: string, mode: BulkEditMode) =>
  (mode === 'set' ? /^\d+$/ : /^[+-]?\d+$/).test(v) && Number(v) >= INT32_MIN && Number(v) <= INT32_MAX;

export function BulkActionBar({
  selectedCount,
  allSelectedSkipped,
  notedCount,
  canMoveUp,
  canMoveDown,
  onClearSelection,
  onDelete,
  onMoveUp,
  onMoveDown,
  onSetDelay,
  onSetCoord,
  onSetComment,
  onClearNotes,
  onToggleSkip,
}: BulkActionBarProps) {
  const tt = useTt();
  const [activeInput, setActiveInput] = useState<'delay' | 'x' | 'y' | 'notes' | null>(null);
  const [inputValue, setInputValue] = useState('');
  // Set | Add for the Delay and X/Y editors. Opens on Set every time (openInput) — never
  // remembered from the last edit, so the same keystrokes always mean the same thing.
  const [mode, setMode] = useState<BulkEditMode>('set');
  // An OK/Enter refused on an invalid value: the red border alone said "no" without saying why.
  // Cleared on the next keystroke and on a mode switch, like the grid editor's hint.
  const [refused, setRefused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (selectedCount === 0) return null;

  // True only while the delay field holds a non-empty, unparseable/negative value.
  // Drives the invalid-styled border below and blocks confirm so the bad value
  // isn't silently dropped (RELIABILITY: previously handleConfirm just closed the
  // field on invalid input with no feedback). Empty stays valid = an OK/Enter on a
  // blank field is a clean cancel, matching the X/Y branch's no-op-on-blank.
  const delayInvalid =
    activeInput === 'delay' &&
    inputValue.trim() !== '' &&
    !isValidDelayValue(inputValue.trim(), mode);

  // X/Y had NO validation at all — the field accepted any text and handed it straight to the
  // bridge, where a failed int.TryParse falls through to 0. A typo like "5oo" therefore drove
  // every selected click to X=0 across the whole selection, with no red border here and a
  // success toast there. Same contract as delayInvalid: empty stays valid so OK/Enter on a
  // blank field is still a clean cancel.
  const isCoord = activeInput === 'x' || activeInput === 'y';
  const coordInvalid =
    isCoord &&
    inputValue.trim() !== '' &&
    !isValidCoordValue(inputValue.trim(), mode);

  // The invalid shapes with a specific answer, so they speak as soon as they are typed instead of
  // waiting for the refused OK: "+10" under Set is someone who wants Add, and so is "-20" for a
  // delay (a delay can't BE negative, so the minus can only mean "subtract").
  const hasModes = isCoord || activeInput === 'delay';
  const plusUnderSet = hasModes && mode === 'set' && inputValue.trim().startsWith('+');
  const minusDelayUnderSet = activeInput === 'delay' && mode === 'set' && inputValue.trim().startsWith('-');

  const inputInvalid = delayInvalid || coordInvalid;

  // Above the field, not below: the bar sits on the window's bottom edge. Inline text rather than
  // a data-tip for the grid editor's reason — the pointer is on OK or nowhere when Enter is refused.
  const hint = plusUnderSet ? '+ adds — pick Add, or drop the + to set'
    : minusDelayUnderSet ? "A delay can't be negative — pick Add to subtract"
    : !refused ? null
    : delayInvalid ? (mode === 'set' ? 'Use a whole number of ms — 0 or more' : 'Use a whole number — e.g. +50 or -20')
    : coordInvalid ? (mode === 'set' ? 'Use a whole number — e.g. 500 or -10' : 'Use a whole number — e.g. +10 or -5')
    : null;

  const closeInput = () => {
    setActiveInput(null);
    setInputValue('');
    setRefused(false);
  };

  const handleConfirm = () => {
    if (!activeInput) return;
    // EMPTY CANCELS, in all four editors. Notes was the exception — an OK on a blank Notes field
    // wiped the notes off every selected row, the one bar edit where "I typed nothing" destroyed
    // something. Clearing is the Clear button's job now, and says so.
    if (inputValue.trim() === '') { closeInput(); return; }
    if (activeInput === 'delay') {
      // Keep the field open + invalid-styled instead of discarding silently.
      if (delayInvalid) { setRefused(true); return; }
      onSetDelay(mode, Number(inputValue.trim()));
    } else if (activeInput === 'x' || activeInput === 'y') {
      // Same treatment: hold the field open rather than send a value the backend would refuse.
      if (coordInvalid) { setRefused(true); return; }
      onSetCoord(activeInput, mode, Number(inputValue.trim()));
    } else if (activeInput === 'notes') {
      onSetComment(inputValue);
    }
    closeInput();
  };

  const openInput = (type: 'delay' | 'x' | 'y' | 'notes') => {
    setActiveInput(type);
    setInputValue('');
    setMode('set');
    setRefused(false);
  };

  const inputPlaceholder = activeInput === 'delay' ? (mode === 'set' ? 'ms' : '+50 or -20')
    : isCoord ? (mode === 'set' ? '500 or -10' : '+10 or -5')
    : 'Note text';

  // The segment tips name what the number does to THIS editor's field.
  const modeOptions = activeInput === 'delay'
    ? [
        { value: 'set' as const, label: 'Set', tip: tt('Every selected action gets this delay', 'Toda ação selecionada recebe este atraso') },
        { value: 'add' as const, label: 'Add', tip: tt("Added to each action's delay. Negative subtracts, stopping at 0.", 'Somado ao atraso de cada ação. Negativo subtrai, parando em 0.') },
      ]
    : [
        { value: 'set' as const, label: 'Set', tip: tt('Every selected click gets this value', 'Todo clique selecionado recebe este valor') },
        { value: 'add' as const, label: 'Add', tip: tt("Added to each click's current value. Negative subtracts.", 'Somado ao valor atual de cada clique. Negativo subtrai.') },
      ];

  const inputWidth = activeInput === 'notes' ? 'w-40' : 'w-24';

  // Ghost recipe of the bar's own buttons, with the Move Up/Down disabled treatment.
  const ghostButton = 'flex items-center gap-1.5 h-7 px-2 rounded text-minor font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-secondary';

  // bulk-bar-enter: small slide-up on appear (the old floating-bar bulk-bar-in
  // keyframe was orphaned when the bar became docked); gated on the Animations
  // toggle in index.css like every other entrance.
  //
  // 34 px is a FIXED band (28 px controls + 3 px air), not the grid row height it happens to
  // equal by default: --ui-row-height is a user setting (28–48), and two neighbours count on this
  // bar not moving — ActionTable's pb-9 scroll clearance and Toast's BOTTOM_CLEARANCE_PX.
  // It floats over the grid (ActionTable mounts it absolute at the bottom), so it takes the
  // overlay elevation token; the grid's overflow-hidden clips the part that would fall below.
  return (
    <div className="bulk-bar-enter flex items-center h-[34px] px-3 border-t border-accent-solid/30 shrink-0 bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--color-bg-card))] shadow-overlay">
      {/* Left: selection info + clear. shrink-0 + whitespace-nowrap make sure the
          "N selected" text stays on one line even if the right-side button cluster
          grows enough to compress the flex layout — without these, narrow window
          widths would wrap "N" and "selected" onto two lines. */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-minor font-semibold text-accent-hover whitespace-nowrap">{selectedCount} selected</span>
        <button onClick={onClearSelection} className={iconButtonClass('sm')} aria-label="Clear selection">
          <X size={14} />
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: action buttons */}
      <div className="flex items-center gap-1">
        {/* Inline Input (shared for all bulk edit types) */}
        {activeInput ? (
          <div className="flex items-center gap-1">
            {/* Clear sits on the LEFT, behind the bar's own divider: the [OK] [×] tail stays where
                it is in all four editors, Clear is nowhere near OK, and it does not land under
                the spot where the Notes button was (a double-click on Notes must not clear). */}
            {activeInput === 'notes' && (
              <>
                <button
                  onClick={() => { onClearNotes(); closeInput(); }}
                  disabled={notedCount === 0}
                  data-tip={tt('Remove the notes from the selected actions', 'Remove as notas das ações selecionadas')}
                  className={ghostButton}
                >
                  <Eraser size={14} />
                  Clear
                </button>
                <div className="w-px h-4 bg-border-default mx-1" />
              </>
            )}
            <span className="label-micro text-text-tertiary">{activeInput === 'notes' ? 'Notes' : activeInput}</span>
            {hasModes && (
              <SegmentedControl<BulkEditMode>
                ariaLabel="Set or add"
                dense
                value={mode}
                onChange={(m) => { setMode(m); setRefused(false); inputRef.current?.focus(); }}
                options={modeOptions}
              />
            )}
            <span className="relative inline-flex">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setRefused(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); if (e.key === 'Escape') closeInput(); }}
                autoFocus
                placeholder={inputPlaceholder}
                aria-label={activeInput === 'notes' ? 'Notes' : activeInput === 'delay' ? 'Delay (ms)' : activeInput?.toUpperCase()}
                aria-invalid={inputInvalid}
                className={`${inputWidth} h-7 px-2 text-minor font-mono bg-bg-input border rounded text-center text-text-primary outline-none ${
                  inputInvalid ? 'border-recording/60 focus:border-recording' : 'border-border-default focus:border-accent-solid'
                }`}
              />
              {hint && (
                <span role="alert" className="absolute right-0 bottom-full mb-1.5 z-20 px-2 py-1 rounded text-caption whitespace-nowrap bg-bg-card border border-recording/40 text-recording-fg pointer-events-none">
                  {hint}
                </span>
              )}
            </span>
            <Button variant="primary" size="xs" onClick={handleConfirm}>
              OK
            </Button>
            <button
              onClick={closeInput}
              aria-label="Cancel"
              className={iconButtonClass('md')}
            >
              <X size={10} />
            </button>
          </div>
        ) : (
          <>
            {/* Move Up / Move Down — first group, mirrors the reorder gesture users
                already use via Alt+↑/↓. Only enabled when the selection isn't already
                at the start / end of the list. */}
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              aria-label="Move up"
              data-tip={tt('Move up (Alt+Up)', 'Mover para cima (Alt+Up)')}
              className="flex items-center gap-1.5 h-7 px-2 rounded text-minor font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-secondary"
            >
              <ArrowUpToLine size={14} />
            </button>
            <button
              onClick={onMoveDown}
              disabled={!canMoveDown}
              aria-label="Move down"
              data-tip={tt('Move down (Alt+Down)', 'Mover para baixo (Alt+Down)')}
              className="flex items-center gap-1.5 h-7 px-2 rounded text-minor font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-text-secondary"
            >
              <ArrowDownToLine size={14} />
            </button>

            <div className="w-px h-4 bg-border-default mx-1" />

            {/* Set Delay */}
            <button
              onClick={() => openInput('delay')}
              className="flex items-center gap-1.5 h-7 px-2 rounded text-minor font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            >
              <Clock size={14} />
              Delay
            </button>

            {/* Set X / Y — Crosshair icon mirrors the Copy Coordinates entry in the row
                context menu, so coord-related UI uses the same glyph across the app. */}
            <button
              onClick={() => openInput('x')}
              className="flex items-center gap-1.5 h-7 px-2 rounded text-minor font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            >
              <Crosshair size={14} />
              X
            </button>

            <button
              onClick={() => openInput('y')}
              className="flex items-center gap-1.5 h-7 px-2 rounded text-minor font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            >
              <Crosshair size={14} />
              Y
            </button>

            {/* Set Notes */}
            <button
              onClick={() => openInput('notes')}
              className="flex items-center gap-1.5 h-7 px-2 rounded text-minor font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors"
            >
              <MessageSquare size={14} />
              Notes
            </button>

            <div className="w-px h-4 bg-border-default mx-1" />

            {/* Skip / Enable — Eye / EyeOff mirrors the row context menu's Skip toggle
                so the same visual vocabulary travels across both surfaces. Duplicate
                was removed from here; the row context menu still has it, which is the
                more discoverable path for the rare cases users want a copy of a row. */}
            <button
              onClick={onToggleSkip}
              className={`flex items-center gap-1.5 h-7 px-2 rounded text-minor font-medium transition-colors ${
                allSelectedSkipped
                  ? 'text-accent-hover hover:text-accent-hover hover:bg-accent-solid/10'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
              }`}
            >
              {allSelectedSkipped ? <Eye size={14} /> : <EyeOff size={14} />}
              {allSelectedSkipped ? 'Enable' : 'Skip'}
            </button>

            <div className="w-px h-4 bg-border-default mx-1" />

            {/* Delete — destructive group of one (the Del hotkey also deletes the selection). */}
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 h-7 px-2 rounded text-minor font-medium text-recording-fg hover:bg-recording-bg transition-colors"
            >
              <Trash2 size={14} />
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
