import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { useBridge } from '../../bridge/BridgeContext';
import { newRequestId, useEditorTools } from '../../logic/useEditorTools';
import { useMacro } from '../../logic/useMacro';
import { useSteps } from '../../logic/useSteps';
import { useLanguage, useTt } from '../../state/LanguageContext';
import { useToast } from '../../state/ToastContext';
import { skippedRowMask } from '../../utils/conditionalBlocks';
import { Menu } from '../Menu';
import { fromKeyboard, type MenuAnchor } from '../menuAnchor';
import { useApp, useShell } from '../store';
import { loadEmpties, loadStepGhost } from '../ui';
import { blockColor, blockMap, type BlockMap, type GhostRow } from './blocks';
import { drafts, focusInspector, loadInspectorBody } from '../inspector/inspectorState';
import { preload, useLoaded } from '../lazyModule';
import { useArrival, useInsertFlash, useLitBlocks, useRunFollow, useSetSize } from './listEffects';
import { useMacroDrop } from './macroDrop';
import { deleteSteps } from './moves';
import { arrival, insertPoint, selectedIndices, selection, useSelection } from './selection';
import { StepRow } from './StepRow';
import { stepKey, stepName } from './stepTypes';
import { topIn, useStepDrag } from './useStepDrag';
import './stepIcons.css';
import './list.css';

type Tt = (en: string, pt: string) => string;

// The step's menu, with its icons and the tools behind it, is not part of opening the app (rule 6).
const loadStepMenu = () => import('./stepMenu');
type StepMenuKit = Awaited<ReturnType<typeof loadStepMenu>>;

/**
 * ⑦ The steps of the open macro. Clicking selects (Ctrl adds, Shift extends), the number turns
 * into a checkbox, the arrows move, and the insertion point sits after the last selected step:
 * new steps — a recording, a paste, Add step — go there, and a step Add step asked for is selected
 * when it lands. Right-click opens the step's menu, a press that
 * moves drags, and blocks are drawn as rails. During a recording or a run the list is read-only.
 *
 * The rows only draw (StepRow): the pointer and the keys are handled here, once for the list, and
 * the effects that light blocks, flash new steps and follow the run write to the DOM instead of
 * rendering (listEffects).
 */
export function StepList() {
  const steps = useApp(a => a.actions);
  const open = useApp(a => a.activeProfile);
  const status = useApp(a => a.status);
  const dataRows = useApp(a => a.dataTable.rows.length);
  const { language } = useLanguage();
  const tt = useTt();
  const cmds = useSteps();
  const macro = useMacro();
  const tools = useEditorTools();
  const { subscribe } = useBridge();
  const { showToast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<{ requestId: string; id: string } | null>(null);
  const locked = status !== 'ready';
  const blocks = blockMap(steps);
  const skipped = skippedRowMask(steps);
  const tips = tipsOf(steps, blocks, tt);
  const owners = blocks.rows.map(r => r.owner);
  const [menu, setMenu] = useState<{ row: number; anchor: MenuAnchor; keyboard: boolean; macro: string | null } | null>(null);
  const [menuKit, setMenuKit] = useState<StepMenuKit | null>(null);
  // A menu does not outlive its macro, nor survive a run starting (lista-054).
  if (menu && (locked || menu.macro !== open || menu.row >= steps.length)) setMenu(null);

  const drag = useStepDrag({
    scrollRef,
    bodyRef,
    steps,
    locked,
    onDrop: (indices, targetIndex) => cmds.reorder({ indices, targetIndex }),
  });
  // A macro dragged from the library over the steps: the line where its Run Macro would land.
  const macroSlot = useMacroDrop(s => s.slot);
  const dropLine = drag.slot ?? macroSlot;
  const lit = useLitBlocks(bodyRef, steps, owners);
  useInsertFlash(bodyRef, steps, status === 'recording');
  useArrival(bodyRef, steps, open);
  useSetSize(bodyRef, steps, open);
  useRunFollow(scrollRef, bodyRef);
  // The empty list's Record is in a chunk of its own (phase 5): the first idle moment brings it, and
  // an empty macro before that, at once.
  const empties = useLoaded(loadEmpties);
  const empty = !!open && steps.length === 0;
  useEffect(() => {
    if (empty && !empties) void preload(loadEmpties);
  }, [empty, empties]);
  // The card that follows a drag, likewise (ui.ts, loadStepGhost).
  const ghost = useLoaded(loadStepGhost);
  const dragging = !!drag.drag;
  useEffect(() => {
    if (dragging && !ghost) void preload(loadStepGhost);
  }, [dragging, ghost]);

  // Another macro: nothing selected, and the list from its top (lista-112).
  useLayoutEffect(() => {
    selection.clear();
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [open]);

  // A recording that ends clears the selection, so the next one goes to the end (lista-032). One
  // that starts drops a step still on its way: what arrives now is the recording's.
  const wasRecording = useRef(false);
  useEffect(() => {
    if (wasRecording.current && status !== 'recording') selection.clear();
    if (status === 'recording') arrival.clear();
    wasRecording.current = status === 'recording';
  }, [status]);

  // Recording into the end: the list follows the steps as they arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (status === 'recording' && el && useSelection.getState().keys.size === 0) el.scrollTop = el.scrollHeight;
  }, [steps.length, status]);

  // The engine starts a recording by hotkey where the insertion point is: it reads the first index
  // of selection:changed as "insert before", so it gets the insertion point itself.
  const insertAt = useSelection(s => insertPoint(steps, s.keys));
  const cursorKey = useSelection(s => s.cursor);
  // Sent when it changes: -1 is the end, which is also where the engine starts.
  const reported = useRef(-1);
  useEffect(() => {
    const at = insertAt < steps.length ? insertAt : -1;
    if (at === reported.current) return;
    reported.current = at;
    cmds.reportSelection(at < 0 ? [] : [at]);
  }, [insertAt, steps.length, cmds]);

  // Pick from screen: the point goes onto the step at once, and Undo puts it back. And a step the
  // engine wants opened (sheet:openIndex, after a capture insert) is selected: the Inspector shows it.
  useEffect(() => subscribe((message) => {
    if (message.type === 'sheet:openIndex') {
      const now = useShell.getState().app.actions;
      if (now[message.payload.index]) selection.only(now, message.payload.index);
      return;
    }
    if (message.type !== 'mouse:positionPicked') return;
    const pending = pickRef.current;
    if (!pending || message.payload.requestId !== pending.requestId) return;
    pickRef.current = null;
    const { cancelled, refused, x, y } = message.payload;
    if (refused) {
      showToast(tt('Another pick is open — finish it first.', 'Outra captura está aberta — termine-a primeiro.'), 'error');
      return;
    }
    if (cancelled || x == null || y == null) return;
    const now = useShell.getState().app.actions;
    const index = now.findIndex(s => s.id === pending.id);
    if (index < 0) return;
    cmds.editMany({ index, id: pending.id, edits: [{ field: 'x', value: String(x) }, { field: 'y', value: String(y) }] });
    showToast(tt(`Point set to ${x}, ${y}`, `Ponto definido em ${x}, ${y}`), { type: 'success', action: { label: 'Undo', onClick: () => cmds.undo({}) } });
  }), [subscribe, cmds, showToast, tt]);

  if (!open) return <p className="shell-steps-empty">Open a macro from the library.</p>;
  // The Steps tab's panel (InsertRow has the tab).
  const panel = { id: 'macro-panel-steps', role: 'tabpanel', 'aria-labelledby': 'macro-tab-steps' } as const;
  if (steps.length === 0) {
    const EmptySteps = empties?.EmptySteps;
    return (
      <div className="steps-empty" data-drop={macroSlot ? '' : undefined} {...panel}>
        {status === 'recording' ? <p>Waiting for the first click or key…</p> : EmptySteps && <EmptySteps />}
      </div>
    );
  }

  const rowOf = (target: EventTarget) => (target as Element).closest<HTMLElement>('.step');

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (drag.justDragged()) return;
    const row = rowOf(e.target);
    if (!row) return;
    const index = Number(row.dataset.index);
    // The checkbox only adds or removes, and works during a run too (it changes nothing in the macro).
    if ((e.target as Element).closest('.step-check')) {
      selection.toggle(steps, index);
      return;
    }
    if (locked) return;
    if (e.ctrlKey || e.metaKey) selection.toggle(steps, index);
    else if (e.shiftKey) selection.range(steps, index, true);
    else {
      // Clicking the one selected step again clears the selection (lista-027).
      const { keys } = useSelection.getState();
      if (keys.size === 1 && keys.has(stepKey(steps[index], index))) selection.clear();
      else selection.only(steps, index);
    }
  };

  const openMenu = (row: HTMLElement, keyboard: boolean, x: number, y: number) => {
    const r = row.getBoundingClientRect();
    const next = {
      row: Number(row.dataset.index),
      anchor: keyboard ? { kind: 'point', x: r.left + 12, y: r.bottom } as const : { kind: 'point', x, y } as const,
      keyboard,
      macro: open,
    };
    if (menuKit) setMenu(next);
    else loadStepMenu().then((kit) => { setMenuKit(kit); setMenu(next); });
  };
  /** The cursor's step, for the menu opened from the keyboard: the list itself has the focus then. */
  const cursorRow = () => {
    const { cursor } = useSelection.getState();
    return cursor ? bodyRef.current?.querySelector<HTMLElement>(`.step[data-key="${CSS.escape(cursor)}"]`) ?? null : null;
  };

  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (locked) return;
    const keyboard = fromKeyboard(e);
    const row = rowOf(e.target) ?? (keyboard ? cursorRow() : null);
    if (row) openMenu(row, keyboard, e.clientX, e.clientY);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey) return;
    const { keys, cursor } = useSelection.getState();
    // Shift+F10 and the Menu key open the cursor step's menu (lista-054), handled here because
    // the list is a focused div, where the browser does not always fire contextmenu for them.
    if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
      e.preventDefault();
      const row = cursorRow();
      if (row && !locked) openMenu(row, true, 0, 0);
      return;
    }
    if (e.key === 'Delete') {
      const sel = selectedIndices(steps, keys);
      if (sel.length === 0) return;
      e.preventDefault();
      if (locked) {
        showToast(tt('Not deleted — the steps are locked while a run is on.', 'Nada apagado — os passos ficam travados durante uma execução.'), 'error');
        return;
      }
      remove(sel);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      // Quiet during a run: a macro's own Ctrl+A must not reshape the selection either.
      if (!locked) selection.all(steps);
      return;
    }
    if (e.key === 'Escape' && keys.size > 0) {
      e.preventDefault();
      selection.clear();
      return;
    }
    // Enter opens the selection in the Inspector (lista-037): the cursor's step when nothing is selected.
    if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      if (keys.size === 0) {
        const at = cursor ? steps.findIndex((s, i) => stepKey(s, i) === cursor) : -1;
        if (at < 0) return;
        selection.only(steps, at);
      }
      focusInspector();
      return;
    }
    if (locked || e.ctrlKey || e.metaKey) return;
    const at = cursor ? steps.findIndex((s, i) => stepKey(s, i) === cursor) : -1;
    const moveTo = (to: number) => {
      e.preventDefault();
      const i = Math.max(0, Math.min(steps.length - 1, to));
      if (e.shiftKey && at >= 0) selection.range(steps, i, false);
      else selection.only(steps, i);
      bodyRef.current?.querySelector(`.step[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    switch (e.key) {
      // The first arrow lands on the first step.
      case 'ArrowDown': moveTo(at < 0 ? 0 : at + 1); break;
      case 'ArrowUp': moveTo(at < 0 ? 0 : at - 1); break;
      case 'Home': moveTo(0); break;
      case 'End': moveTo(steps.length - 1); break;
      case ' ':
        e.preventDefault();
        if (at >= 0) selection.toggle(steps, at);
        else selection.only(steps, 0);
        break;
    }
  };

  const remove = (sel: number[]) => deleteSteps(steps, sel, blocks, cmds, (text) => showToast(text, 'info'), tt);

  const menuEntries = !menu || !menuKit ? [] : (() => {
    const sel = selectedIndices(steps);
    return menuKit.stepMenuEntries({
      steps,
      blocks,
      row: menu.row,
      targets: sel.includes(menu.row) ? sel : [menu.row],
      cmds: { ...cmds, removeSteps: (intent) => { cmds.removeSteps(intent); selection.clear(); } },
      convertCoordinates: (direction) => macro.convertCoordinates(direction, open),
      pick: (row) => {
        const id = steps[row]?.id;
        if (!id) return;
        const requestId = newRequestId();
        pickRef.current = { requestId, id };
        tools.pickPosition({ requestId, captureFor: `for step ${row + 1}, ${stepName(steps[row].actionType)}` });
      },
      edit: (row) => {
        // The step menu's Edit: the step is the selection, and the Inspector takes the focus.
        if (!selectedIndices(steps).includes(row)) selection.only(steps, row);
        focusInspector();
      },
      openMacro: (name) => macro.open(name),
      select: (indices) => selection.set(steps, indices),
      toast: (text, kind) => showToast(text, kind ?? 'info'),
      subscribe,
      tt,
    });
  })();

  return (
    <div className="steps" data-locked={locked || undefined} {...panel}>
      <div className="steps-scroll" ref={scrollRef}>
        <div className="steps-head">
          <SelectAll steps={steps} />
          <span>Step</span>
          <span>Details</span>
          <span className="steps-head-delay">Delay</span>
          <span>Note</span>
        </div>
        <div
          ref={bodyRef}
          className="steps-body"
          role="listbox"
          aria-label="Steps"
          aria-multiselectable="true"
          aria-activedescendant={cursorKey ? `step-${cursorKey}` : undefined}
          tabIndex={0}
          onMouseDown={(e) => { const row = rowOf(e.target); if (row) drag.press(e, Number(row.dataset.index)); }}
          onClick={onClick}
          onContextMenu={onContextMenu}
          onKeyDown={onKeyDown}
          onMouseOver={(e) => { if (!drag.drag) lit.over(e.target); }}
          onMouseLeave={lit.leave}
          // The step menu and the Inspector's editors load before they are asked for: the pointer
          // or the focus on the list starts them.
          onMouseEnter={() => { void loadStepMenu(); void preload(loadInspectorBody); }}
          onFocus={() => { void loadStepMenu(); void preload(loadInspectorBody); }}
        >
          {chunked(steps, blocks, (step, i) => {
            const k = stepKey(step, i);
            const b = blocks.rows[i];
            const ghost = blocks.ghostBefore.get(i);
            return (
              <Fragment key={k}>
                {ghost && (
                  <Ghost
                    ghost={ghost}
                    anchor={i}
                    locked={locked}
                    onAddElse={() => cmds.addElseBranch({ ifRowIndex: ghost.opener })}
                    onAddElseIf={() => {
                      drafts.start({ kind: 'check', opener: 'ElseIf', at: i, macro: open, ifRowIndex: ghost.opener });
                      void preload(loadInspectorBody);
                    }}
                  />
                )}
                <StepRow
                  step={step}
                  index={i}
                  k={k}
                  depth={b.depth}
                  kind={b.kind}
                  owner={b.owner}
                  rails={b.rails}
                  broken={b.broken}
                  tip={tips[i]}
                  skipped={skipped[i]}
                  dataRows={dataRows}
                  language={language}
                  tt={tt}
                />
              </Fragment>
            );
          })}
          <InsertLine steps={steps} bodyRef={bodyRef} />
          {dropLine && <div className="steps-drop" style={{ top: dropLine.top }} aria-hidden="true" />}
        </div>
      </div>
      {drag.drag && steps[drag.drag.lead] && ghost && (
        <ghost.StepGhost step={steps[drag.drag.lead]} more={drag.drag.indices.length - 1} x={drag.drag.x} y={drag.drag.y} />
      )}
      {menu && menuEntries.length > 0 && (
        <Menu anchor={menu.anchor} entries={menuEntries} label={`Step ${menu.row + 1}`} focusFirst={menu.keyboard} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}

/** Steps per block of the list (see chunked). */
const CHUNK = 50;

/**
 * The rows in blocks of 50 steps. A block off screen skips layout and paint as one (rule 7,
 * content-visibility), so a scroll lays out the body again only when a block comes into view. One
 * box per step made it lay out its thousand children on every frame: ~7 ms, 75 frames a second in
 * the app. A block's size before it is drawn is its rows' (--chunk-rows, the If's ghost rows too).
 */
function chunked(steps: ActionItem[], blocks: BlockMap, row: (step: ActionItem, index: number) => React.ReactNode) {
  const out: React.ReactNode[] = [];
  for (let at = 0; at < steps.length; at += CHUNK) {
    const end = Math.min(at + CHUNK, steps.length);
    const rows: React.ReactNode[] = [];
    let ghosts = 0;
    for (let i = at; i < end; i++) {
      if (blocks.ghostBefore.has(i)) ghosts++;
      rows.push(row(steps[i], i));
    }
    out.push(
      <div key={at} className="steps-chunk" role="none" style={{ '--chunk-rows': end - at + ghosts } as CSSProperties}>
        {rows}
      </div>,
    );
  }
  return out;
}

/** The header's checkbox: all steps, or none; a dash when some are selected. Works during a run too. */
function SelectAll({ steps }: { steps: ActionItem[] }) {
  const count = useSelection(s => selectedIndices(steps, s.keys).length);
  const all = count === steps.length;
  return (
    <span className="steps-head-num">
      <button
        type="button"
        role="checkbox"
        className="step-check step-check-all"
        aria-label="Select all steps"
        aria-checked={all ? true : count > 0 ? 'mixed' : false}
        onClick={() => (all ? selection.clear() : selection.all(steps))}
      />
    </span>
  );
}

/**
 * The insertion point: a line after the last selected step, where new steps go (lista-032). It
 * finds that step's row and is placed on the DOM after each render, so moving it redraws nothing else.
 */
function InsertLine({ steps, bodyRef }: { steps: ActionItem[]; bodyRef: React.RefObject<HTMLDivElement | null> }) {
  const last = useSelection(s => {
    const sel = selectedIndices(steps, s.keys);
    return sel.length > 0 ? sel[sel.length - 1] : -1;
  });
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const line = ref.current;
    const row = last < 0 ? null : bodyRef.current?.querySelector<HTMLElement>(`.step[data-index="${last}"]`);
    if (!line) return;
    line.style.display = row ? '' : 'none';
    if (row && bodyRef.current) line.style.top = `${topIn(bodyRef.current, row) + row.offsetHeight - 1}px`;
  });
  return (
    <div ref={ref} className="steps-insert" style={{ display: 'none' }} aria-hidden="true">
      <span className="steps-insert-dot"><span className="step-icon" data-icon="plus" /></span>
    </div>
  );
}

/**
 * "+ Add Else If" and "+ Add Else" inside an If block, where the arm will land (lista-026): the
 * Else If's check is chosen in the Inspector; the Else, while the block has none, lands at once.
 * Off the Tab order (D2: Tab goes between the zones, the arrows inside them); from the keyboard,
 * Ctrl+K offers both for the block of the selected step.
 */
function Ghost({ ghost, anchor, locked, onAddElse, onAddElseIf }: { ghost: GhostRow; anchor: number; locked: boolean; onAddElse: () => void; onAddElseIf: () => void }) {
  const rails = ghost.rails.split(',');
  return (
    <div
      className="step-ghost"
      data-anchor={anchor}
      data-block-open={ghost.opener}
      style={{ '--row-block-color': blockColor(ghost.depth), '--step-indent': `${(ghost.depth + 1) * 0.875 + 0.5}rem` } as CSSProperties}
    >
      <span />
      <span className="step-type">
        {rails.map((opener, i) => (
          <span key={i} className="step-rail" data-rail-block={opener} style={{ left: `${i * 0.875}rem`, '--rail-color': blockColor(i) } as CSSProperties} />
        ))}
        <span className="step-ghost-actions">
          <button type="button" className="step-ghost-button" tabIndex={-1} disabled={locked} onClick={onAddElseIf}>
            <span className="step-icon" data-icon="plus" />
            Add Else If
          </button>
          {ghost.canElse && (
            <button type="button" className="step-ghost-button" tabIndex={-1} disabled={locked} onClick={onAddElse}>
              <span className="step-icon" data-icon="plus" />
              Add Else
            </button>
          )}
        </span>
      </span>
    </div>
  );
}

/** A marker's orientation in its tooltip: where its block ends, what it closes, or what it is missing. */
function tipsOf(steps: ActionItem[], blocks: BlockMap, tt: Tt): (string | undefined)[] {
  return blocks.rows.map((b, i) => {
    if (!b.kind) return undefined;
    const t = steps[i].actionType;
    if (b.broken) {
      if (b.kind === 'opener') return t === 'If' ? tt('No matching End If', 'Sem End If correspondente') : tt('No matching End Loop', 'Sem End Loop correspondente');
      return t === 'EndLoop' ? tt('No matching loop', 'Sem loop correspondente') : tt('No matching If', 'Sem If correspondente');
    }
    const owner = b.owner as number;
    if (b.kind === 'opener') {
      const end = blocks.closerOf.get(i) as number;
      return tt(`Ends at step ${end + 1}`, `Termina no passo ${end + 1}`);
    }
    if (b.kind === 'closer') {
      const inside = i - owner - 1;
      const name = stepName(steps[owner].actionType);
      return tt(`Closes ${name} · step ${owner + 1} · ${inside === 1 ? '1 step' : `${inside} steps`}`,
                `Fecha ${name} · passo ${owner + 1} · ${inside === 1 ? '1 passo' : `${inside} passos`}`);
    }
    return tt(`Branch of If · step ${owner + 1}`, `Ramo do If · passo ${owner + 1}`);
  });
}
