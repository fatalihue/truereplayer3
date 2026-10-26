import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useEditorClaim } from '../../logic/useEditorClaim';
import { useTt } from '../../state/LanguageContext';
import { preload, useLoaded } from '../lazyModule';
import { keycaps } from '../library/model';
import { arrival, selectedIndices, selection, useSelection } from '../list/selection';
import { NotBuilt } from '../NotBuilt';
import { useApp } from '../store';
import { useShellBand } from '../useShellBand';
import { drafts, focusList, loadInspectorBody, useDraft, usePendingEdits } from './inspectorState';
import './inspector.css';

/** Drops a step still being made, and the arrival it would have had. */
function cancelDraft() {
  if (!useDraft.getState().draft) return;
  drafts.end();
  arrival.clear();
}

// The column's width, in rem so it follows the scale (rule 9), kept between sessions.
const WIDTH_KEY = 'ui:inspectorWidth';
const MIN_REM = 18;
const MAX_REM = 40;
const DEFAULT_REM = 22.5;
const clampWidth = (rem: number) => Math.round(Math.min(MAX_REM, Math.max(MIN_REM, rem)) * 4) / 4;
function readWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= MIN_REM && n <= MAX_REM ? n : DEFAULT_REM;
  } catch { return DEFAULT_REM; }
}
function writeWidth(rem: number) {
  try { localStorage.setItem(WIDTH_KEY, String(rem)); } catch { /* storage off: the width lasts the session */ }
}

/**
 * ⑧ The Inspector: the selected step's editor, the batch editor for several, and the macro's own
 * settings when nothing is selected (phase 2). It follows the selection — clicking a step opens it,
 * Enter and Edit put the focus in it — and applies as you type: a field sends when the typing
 * stops, when it is left and on Enter (rule 3), and Ctrl+Z undoes. Esc gives the focus back to the
 * list (D12); Close editor clears the selection.
 *
 * The frame is in the opening bundle; the editors load with the first step (rule 6). The column is
 * as wide as the user drags it, from 18 to 40 rem. While a run or a recording is on, or the Clicker,
 * it is read-only.
 */
export function Inspector() {
  const steps = useApp(a => a.actions);
  const status = useApp(a => a.status);
  const clicker = useApp(a => a.settings.useCursorClick);
  const modeKey = useApp(a => a.settings.modeToggleHotkey);
  const keys = useSelection(s => s.keys);
  const pending = usePendingEdits(s => s.fields.size > 0);
  // Automations wait only while typing has not reached the engine (D12).
  useEditorClaim('inspector', pending);
  const tt = useTt();
  const band = useShellBand();
  const [width, setWidth] = useState(readWidth);
  const asideRef = useRef<HTMLElement>(null);
  const open = useApp(a => a.activeProfile);
  const draft = useDraft(s => s.draft);
  const sel = selectedIndices(steps, keys);
  const locked = status !== 'ready' || clicker;
  // The editors: usually in already (the pointer or the focus reached the list first); a selection
  // that came another way loads them now.
  const editors = useLoaded(loadInspectorBody);
  const showing = sel.length > 0 || !!draft;
  useEffect(() => {
    if (showing && !editors) void preload(loadInspectorBody);
  }, [showing, editors]);
  const Body = editors?.default;
  // A step still being made goes with its macro, when a run or the Clicker starts, and when the
  // selection moves (the step it made arriving, or a click elsewhere) — except a Text that became
  // a step and is still being typed: its editor stays while that step is the one selected.
  const adoptedGone = draft?.kind === 'text' && !!draft.stepId && !steps.some(s => s.id === draft.stepId);
  useEffect(() => {
    if (draft && (draft.macro !== open || locked || adoptedGone)) cancelDraft();
  }, [draft, open, locked, adoptedGone]);
  useEffect(() => useSelection.subscribe((s, prev) => {
    if (s.keys === prev.keys) return;
    const d = useDraft.getState().draft;
    if (d?.kind === 'text' && d.stepId && s.keys.size === 1 && s.keys.has(d.stepId)) return;
    cancelDraft();
  }), []);

  const note = clicker
    ? tt(`The Clicker is on — ${keycaps(modeKey || 'ScrollLock')} brings the macros back`,
         `O Clicker está ligado — ${keycaps(modeKey || 'ScrollLock')} traz os macros de volta`)
    : status === 'recording' ? 'Read-only while recording'
    : status === 'replaying' ? 'Read-only while it runs'
    : null;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // An Esc no field kept for itself gives the focus back to the list (D12), and drops a step
    // still being made.
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    cancelDraft();
    focusList();
  };

  return (
    <aside
      ref={asideRef}
      className="shell-inspector insp"
      aria-label="Inspector"
      data-open={showing || undefined}
      style={{ '--inspector-width': `${width}rem` } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      <Grip asideRef={asideRef} width={width} onWidth={(rem) => { setWidth(rem); writeWidth(rem); }} />
      {/* One pane at a time (520–759 px): the Inspector covers the steps, and this goes back. */}
      {showing && (band === 'single' || band === 'compact') && (
        <button type="button" className="insp-back" onClick={() => { cancelDraft(); selection.clear(); focusList(); }}>
          <span className="step-icon" data-icon="chevron-right" />
          Steps
        </button>
      )}
      {!showing ? (
        <>
          <div className="insp-head">
            <div className="insp-title">
              <span className="insp-name">Macro settings</span>
              <span className="insp-sub">No step selected</span>
            </div>
          </div>
          <div className="insp-body insp-empty">
            <p>Select a step to edit it here, or several to change them together.</p>
            <NotBuilt what="Macro settings" />
          </div>
        </>
      ) : Body ? (
        // The header, the editors and the footer come with the editors' chunk.
        <Body indices={sel} locked={locked} note={note} draft={draft} />
      ) : (
        <div className="insp-head" />
      )}
    </aside>
  );
}

/**
 * The left edge of the column: a drag widens or narrows it, the arrows do it by 1 rem, and a double
 * click puts the default back. While dragging, the width goes straight to the element; it is kept
 * once, on release.
 */
function Grip({ asideRef, width, onWidth }: { asideRef: RefObject<HTMLElement | null>; width: number; onWidth: (rem: number) => void }) {
  const drag = useRef<{ startX: number; startRem: number; rem: number; root: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    drag.current = { startX: e.clientX, startRem: width, rem: width, root };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const rem = clampWidth(d.startRem + (d.startX - e.clientX) / d.root);
    if (rem === d.rem) return;
    d.rem = rem;
    asideRef.current?.style.setProperty('--inspector-width', `${rem}rem`);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.rem !== width) onWidth(d.rem);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = e.key === 'ArrowLeft' ? width + 1 : e.key === 'ArrowRight' ? width - 1
      : e.key === 'Home' ? MIN_REM : e.key === 'End' ? MAX_REM : null;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onWidth(clampWidth(next));
  };

  return (
    <div
      className="insp-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Inspector width"
      aria-valuemin={MIN_REM * 16}
      aria-valuemax={MAX_REM * 16}
      aria-valuenow={Math.round(width * 16)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onWidth(DEFAULT_REM)}
      onKeyDown={onKeyDown}
    />
  );
}
