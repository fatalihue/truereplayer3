import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { t } from '../../i18n';
import { useEditorClaim } from '../../logic/useEditorClaim';
import { preload, useLoaded } from '../lazyModule';
import { clickerOnNote } from '../library/model';
import { arrival, selectedIndices, selection, useSelection } from '../list/selection';
import { useApp, useShell } from '../store';
import { closeMacroSettings, collapseInspector, loadDataLoop, useUi } from '../ui';
import { useShellBand } from '../useShellBand';
import { drafts, focusList, loadInspectorBody, loadMacroSettings, useDraft, usePendingEdits } from './inspectorState';
import './inspector.css';

/** Drops a step still being made, and the arrival it would have had. */
function cancelDraft() {
  if (!useDraft.getState().draft) return;
  drafts.end();
  arrival.clear();
}

// The column's width, in rem so it follows the scale (rule 9), kept between sessions: one as the
// column is, one for the expanded editor (as wide as the concept's 760 px at first), each dragged
// on its own. The expanded one never takes the list below 22.5 rem (shell.css).
interface WidthRange { key: string; min: number; max: number; def: number }
const NORMAL: WidthRange = { key: 'ui:inspectorWidth', min: 18, max: 40, def: 22.5 };
const EXPANDED: WidthRange = { key: 'ui:inspectorExpandedWidth', min: 30, max: 64, def: 47.5 };
const clampWidth = (rem: number, r: WidthRange) => Math.round(Math.min(r.max, Math.max(r.min, rem)) * 4) / 4;
function readWidth(r: WidthRange): number {
  try {
    const n = Number(localStorage.getItem(r.key));
    return n >= r.min && n <= r.max ? n : r.def;
  } catch { return r.def; }
}
function writeWidth(r: WidthRange, rem: number) {
  try { localStorage.setItem(r.key, String(rem)); } catch { /* storage off: the width lasts the session */ }
}

/**
 * ⑧ The Inspector: the selected step's editor, the batch editor for several, and the macro's own
 * settings when nothing is selected. It follows the selection — clicking a step opens it,
 * Enter and Edit put the focus in it — and applies as you type: a field sends when the typing
 * stops, when it is left and on Enter (rule 3), and Ctrl+Z undoes. Esc gives the focus back to the
 * list (D12); Close editor clears the selection.
 *
 * The frame is in the opening bundle; the editors load with the first step (rule 6). The column is
 * as wide as the user drags it, from 18 to 40 rem. While a run or a recording is on, or the Clicker,
 * it is read-only.
 *
 * Expanded (a Send Text's Expand editor, or its reference image being cropped), it is as wide as
 * the window allows beside the list, the library folds into avatars, and Esc or Ctrl+Enter
 * collapse it as they give the focus back to the list (D12). It lasts while the selection stays on
 * what it was opened for.
 *
 * On the Data Loop tab it holds the table's settings ("Data Loop settings"), whatever is selected
 * in the steps; below 1024 px they lie over the table when asked for.
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
  const band = useShellBand();
  const [width, setWidth] = useState(() => readWidth(NORMAL));
  const [wideWidth, setWideWidth] = useState(() => readWidth(EXPANDED));
  const asideRef = useRef<HTMLElement>(null);
  const open = useApp(a => a.activeProfile);
  const draft = useDraft(s => s.draft);
  const sel = selectedIndices(steps, keys);
  const locked = status !== 'ready' || clicker;
  // What the expanded editor is for: a Send Text (or a Text being made), and the step whose image
  // is being cropped, never while it runs. Anything else selected takes the expansion away.
  const expanded = useUi(s => s.expanded);
  const crop = useUi(s => s.crop);
  const dataTab = useUi(s => s.macroTab === 'data') && !!open;
  const dataAsked = useUi(s => s.dataSettings);
  const data = useLoaded(loadDataLoop);
  const DataSettings = data?.DataSettings;
  const one = !draft && sel.length === 1 ? steps[sel[0]] : null;
  const textShown = !dataTab && (draft ? draft.kind === 'text' : one?.actionType === 'SendText');
  const cropShown = !dataTab && crop !== null && !locked && one?.id === crop;
  const wide = (expanded && textShown) || cropShown;
  useEffect(() => {
    if (expanded && !textShown) useUi.setState({ expanded: false });
    if (crop !== null && !cropShown) useUi.setState({ crop: null });
  }, [expanded, textShown, crop, cropShown]);
  // The editors: usually in already (the pointer or the focus reached the list first); a selection
  // that came another way loads them now.
  const editors = useLoaded(loadInspectorBody);
  const showing = sel.length > 0 || !!draft;
  useEffect(() => {
    if (showing && !editors) void preload(loadInspectorBody);
  }, [showing, editors]);
  const Body = editors?.default;
  // The macro's settings (no step chosen) come at the first idle moment once the app's state is
  // drawn, or at once when they are asked for (Hotkey…, Edit info…).
  const settingsOpen = useUi(s => s.settingsOpen);
  const booted = useShell(s => s.booted);
  const settings = useLoaded(loadMacroSettings);
  useEffect(() => {
    if (settings || !booted) return;
    if (settingsOpen) { void preload(loadMacroSettings); return; }
    let idle = 0;
    const frame = requestAnimationFrame(() => { idle = requestIdleCallback(() => { void preload(loadMacroSettings); }); });
    return () => {
      cancelAnimationFrame(frame);
      cancelIdleCallback(idle);
    };
  }, [settings, booted, settingsOpen]);
  const Settings = settings?.default;
  // Another macro opened from the library or Ctrl+K takes the settings away; one opened to show
  // its own settings (Edit info… on a macro that was not open) keeps them.
  const shownFor = useRef(open);
  useEffect(() => {
    if (shownFor.current === open) return;
    shownFor.current = open;
    const ui = useUi.getState();
    if (ui.settingsOpen && ui.settingsFocus?.name !== open) closeMacroSettings();
  }, [open]);
  // A step still being made goes with its macro, when a run or the Clicker starts, and when the
  // selection moves (the step it made arriving, or a click elsewhere) — except a Text that became
  // a step and is still being typed: its editor stays while that step is the one selected.
  const adoptedGone = draft?.kind === 'text' && !!draft.stepId && !steps.some(s => s.id === draft.stepId);
  useEffect(() => {
    if (draft && (draft.macro !== open || locked || adoptedGone || dataTab)) cancelDraft();
  }, [draft, open, locked, adoptedGone, dataTab]);
  useEffect(() => useSelection.subscribe((s, prev) => {
    if (s.keys === prev.keys) return;
    // A step chosen takes the Inspector from the macro's settings.
    if (s.keys.size > 0 && useUi.getState().settingsOpen) closeMacroSettings();
    const d = useDraft.getState().draft;
    if (d?.kind === 'text' && d.stepId && s.keys.size === 1 && s.keys.has(d.stepId)) return;
    cancelDraft();
  }), []);

  const note = clicker
    ? clickerOnNote(modeKey)
    : status === 'recording' ? t('inspector.frame.readOnlyRecording')
    : status === 'replaying' ? t('inspector.frame.readOnlyRunning')
    : null;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // An Esc no field kept for itself gives the focus back to the list (D12), drops a step still
    // being made and collapses the expanded editor; Ctrl+Enter, the "done" of today's dialogs,
    // does the same from any field, the step kept.
    const done = e.key === 'Enter' && e.ctrlKey && !e.altKey && !e.shiftKey;
    if ((e.key !== 'Escape' && !done) || e.defaultPrevented) return;
    e.preventDefault();
    if (!done) cancelDraft();
    collapseInspector();
    if (dataTab) useUi.setState({ dataSettings: false });
    focusList();
  };

  return (
    <aside
      ref={asideRef}
      className="shell-inspector insp"
      aria-label="Inspector"
      data-open={(dataTab ? dataAsked : showing || settingsOpen) || undefined}
      data-expanded={wide || undefined}
      style={{ '--inspector-width': `${width}rem`, '--inspector-expanded-width': `${wideWidth}rem` } as CSSProperties}
      onKeyDown={onKeyDown}
    >
      {wide ? (
        <Grip key="wide" asideRef={asideRef} range={EXPANDED} cssVar="--inspector-expanded-width" width={wideWidth} onWidth={(rem) => { setWideWidth(rem); writeWidth(EXPANDED, rem); }} />
      ) : (
        <Grip key="normal" asideRef={asideRef} range={NORMAL} cssVar="--inspector-width" width={width} onWidth={(rem) => { setWidth(rem); writeWidth(NORMAL, rem); }} />
      )}
      {/* One pane at a time (520–759 px): the Inspector covers the steps (or the table), and this goes back. */}
      {dataTab ? dataAsked && (band === 'single' || band === 'compact') && (
        <button type="button" className="insp-back" onClick={() => { useUi.setState({ dataSettings: false }); focusList(); }}>
          <span className="step-icon" data-icon="chevron-right" />
          {t('inspector.frame.backToTable')}
        </button>
      ) : (showing || settingsOpen) && (band === 'single' || band === 'compact') && (
        <button type="button" className="insp-back" onClick={() => { cancelDraft(); selection.clear(); closeMacroSettings(); focusList(); }}>
          <span className="step-icon" data-icon="chevron-right" />
          {t('inspector.frame.backToSteps')}
        </button>
      )}
      {dataTab ? (
        DataSettings ? <DataSettings locked={locked} note={note} /> : <div className="insp-head" />
      ) : !showing ? (
        <>
          <div className="insp-head">
            {/* With no macro open (every launch, and a macro closed by hand, D29), it says so. */}
            <div className="insp-title">
              <span className="insp-name">{open ? t('inspector.frame.macroSettings') : t('inspector.frame.noMacro')}</span>
              {open && <span className="insp-sub">{t('inspector.frame.noStep')}</span>}
            </div>
            {/* 760–1023 px: asked for, the settings lie over the list until closed. */}
            {settingsOpen && band === 'over' && (
              <button type="button" className="insp-close" aria-label={t('inspector.frame.closeSettings')} onClick={() => { closeMacroSettings(); focusList(); }}>
                <span className="step-icon" data-icon="x" />
              </button>
            )}
          </div>
          {/* The macro's own settings are not its steps: as today's dialogs, they stay editable with
              the Clicker on, and wait only for a run or a recording (biblioteca-014). */}
          {open && Settings ? <Settings name={open} locked={status !== 'ready'} /> : <div className="insp-body" />}
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
 * once, on release. Expanded, it moves the expanded width.
 */
function Grip({ asideRef, range, cssVar, width, onWidth }: {
  asideRef: RefObject<HTMLElement | null>;
  range: WidthRange;
  cssVar: string;
  width: number;
  onWidth: (rem: number) => void;
}) {
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
    const rem = clampWidth(d.startRem + (d.startX - e.clientX) / d.root, range);
    if (rem === d.rem) return;
    d.rem = rem;
    asideRef.current?.style.setProperty(cssVar, `${rem}rem`);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.rem !== width) onWidth(d.rem);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = e.key === 'ArrowLeft' ? width + 1 : e.key === 'ArrowRight' ? width - 1
      : e.key === 'Home' ? range.min : e.key === 'End' ? range.max : null;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onWidth(clampWidth(next, range));
  };

  return (
    <div
      className="insp-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('inspector.frame.width')}
      aria-valuemin={range.min * 16}
      aria-valuemax={range.max * 16}
      aria-valuenow={Math.round(width * 16)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onWidth(range.def)}
      onKeyDown={onKeyDown}
    />
  );
}
