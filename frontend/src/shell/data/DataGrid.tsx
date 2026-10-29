import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, Copy, Play, Plus, Trash2 } from 'lucide-react';
import { scanRowTokenUsage } from '../../lib/rowTokenUsage';
import { useTt } from '../../state/LanguageContext';
import { useToast } from '../../state/ToastContext';
import { Menu, type MenuEntry } from '../Menu';
import type { MenuAnchor } from '../menuAnchor';
import { useApp, useShell } from '../store';
import {
  lockedNow, matchingRows, nameProblem, refocusTable, shownNow, useDataOps, useDataTab, useShown, validName,
  type Cell, type DataOps, type Editing,
} from './model';

// Rows drawn beyond the ones in view, above and below: a wheel notch lands on rows already there.
const OVERSCAN = 8;

type Nav = 'down' | 'right' | 'left';
type GridMenu = { anchor: MenuAnchor; at: Cell; macro: string; button?: HTMLElement };

interface Metrics { row: number; head: number }

/**
 * The rows in view (rule 7: only the big Data Loop tables are drawn by window): the scroll, the
 * size of the view and the row's height (the density and the zoom move it) decide them. The
 * height comes from a probe one row tall, so it is the stylesheet's, in px.
 */
function useRowWindow(scrollRef: RefObject<HTMLDivElement | null>, headRef: RefObject<HTMLDivElement | null>, probeRef: RefObject<HTMLDivElement | null>, count: number) {
  const [win, setWin] = useState({ first: 0, last: Math.min(count, 48) });
  const metrics = useRef<Metrics>({ row: 27, head: 32 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const probe = probeRef.current;
    const head = headRef.current;
    if (!el || !probe || !head) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const { row, head: top } = metrics.current;
      const first = Math.max(0, Math.floor((el.scrollTop - top) / row) - OVERSCAN);
      const last = Math.min(count, Math.ceil((el.scrollTop + el.clientHeight - top) / row) + OVERSCAN);
      setWin(w => (w.first === first && w.last === last ? w : { first, last }));
    };
    const remeasure = () => {
      metrics.current = { row: probe.getBoundingClientRect().height || metrics.current.row, head: head.offsetHeight };
      measure();
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    remeasure();
    el.addEventListener('scroll', onScroll, { passive: true });
    const watch = new ResizeObserver(remeasure);
    watch.observe(el);
    watch.observe(probe);
    watch.observe(head);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
      watch.disconnect();
    };
  }, [scrollRef, headRef, probeRef, count]);
  return { win, metrics };
}

const cellId = (r: number, c: number) => (r < 0 ? `dl-h-${c < 0 ? 'n' : c}` : `dl-${r}-${c < 0 ? 'n' : c}`);

/** Brings a cell into view, under the sticky header and right of the row numbers (centred for a search's jump). */
function revealCell(el: HTMLDivElement | null, head: HTMLDivElement | null, m: Metrics, cell: Cell, center = false) {
  if (!el) return;
  if (cell.r >= 0) {
    const top = m.head + cell.r * m.row;
    if (center) el.scrollTop = top - m.head - (el.clientHeight - m.head - m.row) / 2;
    else if (top < el.scrollTop + m.head) el.scrollTop = top - m.head;
    else if (top + m.row > el.scrollTop + el.clientHeight) el.scrollTop = top + m.row - el.clientHeight;
  }
  if (cell.c >= 0 && head) {
    const th = head.querySelector<HTMLElement>(`[data-hc="${cell.c}"]`);
    const numW = head.querySelector<HTMLElement>('[data-hc="n"]')?.offsetWidth ?? 0;
    if (!th) return;
    if (th.offsetLeft < el.scrollLeft + numW) el.scrollLeft = th.offsetLeft - numW;
    else if (th.offsetLeft + th.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = th.offsetLeft + th.offsetWidth - el.clientWidth;
  }
}

/** A value with what it holds and does not show made visible: a tab as ⇥, a line break as ↵. */
function cellText(value: string): ReactNode {
  if (!/[\t\n]/.test(value)) return value;
  return value.split(/(\t|\n)/).map((p, i) => (p === '\t' ? <span key={i} className="dl-glyph">⇥</span>
    : p === '\n' ? <span key={i} className="dl-glyph">↵</span>
    : <Fragment key={i}>{p}</Fragment>));
}

/**
 * ⑥ The Data Loop tab's table. A cell opens on a click, or from the keyboard: the table is one Tab
 * stop with a cell of its own (the arrows, Home, End, Page Up and Down move it; Enter or F2 opens
 * it, typing replaces it, Delete empties it, Shift+F10 opens its menu). In the open cell, Enter
 * confirms and goes down, Tab and Shift+Tab go right and left, Alt+Enter (or Shift+Enter) breaks the
 * line and Esc puts it back (paineis-111, 112). Every confirmed change is saved at once.
 *
 * The headers rename in place, and a name that cannot be a token's is refused as it is typed (D18);
 * their ⋯ holds the column's moves. In the mode that walks the rows, the row numbers move the
 * cursor: the next replay uses the marked row (paineis-113). Every row edits, however big the
 * table: only the rows in view are drawn (D18, paineis-117).
 */
export function DataGrid({ locked }: { locked: boolean }) {
  const shown = useShown();
  const ops = useDataOps();
  const actions = useApp(a => a.actions);
  const macro = useApp(a => a.activeProfile) ?? '';
  const editing = useDataTab(s => s.editing);
  const active = useDataTab(s => s.active);
  const term = useDataTab(s => s.term);
  const hit = useDataTab(s => s.hit);
  const tt = useTt();
  const { showToast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<GridMenu | null>(null);
  const [copied, setCopied] = useState(false);
  const { headers, rows, saved } = shown;
  const cols = headers.length;
  const cursorMode = !shown.loopOverData;
  const { win, metrics } = useRowWindow(scrollRef, headRef, probeRef, rows.length);
  if (menu && (locked || menu.macro !== macro)) setMenu(null);

  const usage = scanRowTokenUsage(actions);
  const seen = new Map<string, number>();
  const heads = headers.map((h) => {
    const name = h.trim();
    const key = name.toLowerCase();
    const dup = name !== '' && (seen.get(key) ?? 0) > 0;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    const valid = validName(name);
    return { name, valid, dup, count: valid ? usage.get(key)?.count ?? 0 : 0 };
  });
  const termLower = term.trim().toLowerCase();
  const matches = matchingRows(rows, term);
  const hitRow = hit >= 0 ? matches[hit] ?? -1 : -1;
  const lastRow = rows.length - 1;

  // Back from the paste surface (its box gone, the focus on the page): the table takes it.
  useLayoutEffect(() => {
    if (document.activeElement === document.body) sheetRef.current?.focus({ preventScroll: true });
  }, []);
  // The cell the keys move comes into view; a search's jump is centred. One set by the focus
  // arriving is already in view (quiet).
  const quiet = useRef(false);
  useLayoutEffect(() => {
    if (quiet.current) {
      quiet.current = false;
      return;
    }
    if (active) revealCell(scrollRef.current, headRef.current, metrics.current, active);
  }, [active, metrics]);
  useLayoutEffect(() => {
    if (hitRow >= 0) revealCell(scrollRef.current, headRef.current, metrics.current, { r: hitRow, c: -1 }, true);
  }, [hitRow, hit, metrics]);

  const setActive = (cell: Cell) => useDataTab.setState({ active: cell });
  const openCell = (r: number, c: number, seed: string | null = null) => {
    if (locked || c < 0 || r < 0 || c >= cols) return;
    useDataTab.setState({ editing: { kind: 'cell', r, c, macro, seed }, active: { r, c } });
  };
  const openHeader = (c: number) => {
    if (locked || c < 0 || c >= cols) return;
    useDataTab.setState({ editing: { kind: 'header', c, macro }, active: { r: -1, c } });
  };
  const moveCursor = (r: number) => {
    if (locked || !cursorMode || r < 0 || r >= saved) return;
    ops.setCursor(r);
  };
  const copyRowToken = () => {
    navigator.clipboard?.writeText('{row}').then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1000);
    }, () => showToast(tt('Could not copy — click inside the window and try again.', 'Não foi possível copiar — clique dentro da janela e tente de novo.'), 'error'));
  };

  // A key that closes an editor gives the table the focus at once (a key right after it is the
  // table's); one closed by a click elsewhere leaves the focus where the click put it.
  const backToTable = (byKey: boolean) => {
    if (byKey) sheetRef.current?.focus({ preventScroll: true });
    else refocusTable();
  };
  // A cell closed from outside with something typed in it (paineis-089 and 090). It is saved when
  // nothing stops it; else the toast says why it was not kept, as today's panel's "— unsaved changes
  // were discarded." did: the engine saves only the open macro's table, and a run is reading it.
  const dropped = (edit: Extract<Editing, { kind: 'cell' }>, value: string) => {
    const app = useShell.getState().app;
    const why = app.activeProfile !== edit.macro ? tt('Another macro was opened', 'Outro macro foi aberto')
      : app.settings.useCursorClick ? tt('The Clicker turned on', 'O Clicker foi ligado')
      : app.status === 'recording' ? tt('A recording started', 'Uma gravação começou')
      : app.status === 'replaying' ? tt('A run started', 'Uma execução começou')
      : null;
    if (why) showToast(`${why} — ${tt('the cell’s edit was discarded.', 'a edição da célula foi descartada.')}`, 'error');
    else ops.setCell(edit.r, edit.c, value);
  };
  const finishCell = (edit: Extract<Editing, { kind: 'cell' }>, value: string | null, nav: Nav | undefined, byKey: boolean) => {
    if (useDataTab.getState().editing !== edit) return;
    if (value !== null && !lockedNow() && edit.macro === useShell.getState().app.activeProfile) ops.setCell(edit.r, edit.c, value);
    const now = shownNow();
    let next: Editing | null = null;
    if (value !== null && nav === 'down' && edit.r + 1 < now.rows.length) next = { ...edit, r: edit.r + 1, seed: null };
    else if (value !== null && nav === 'right' && edit.c + 1 < now.headers.length) next = { ...edit, c: edit.c + 1, seed: null };
    else if (value !== null && nav === 'left' && edit.c > 0) next = { ...edit, c: edit.c - 1, seed: null };
    useDataTab.setState({ editing: next, active: next ? { r: next.r, c: next.c } : { r: edit.r, c: edit.c } });
    if (!next) backToTable(byKey);
  };
  const finishHeader = (edit: Extract<Editing, { kind: 'header' }>, value: string | null, byKey: boolean) => {
    if (useDataTab.getState().editing !== edit) return;
    if (value !== null && !lockedNow() && edit.macro === useShell.getState().app.activeProfile) ops.renameColumn(edit.c, value);
    useDataTab.setState({ editing: null, active: { r: -1, c: edit.c } });
    backToTable(byKey);
  };

  const menuAt = (cell: Cell, anchor: MenuAnchor, button?: HTMLElement) => setMenu({ anchor, at: cell, macro, button });
  const anchorOf = (cell: Cell): MenuAnchor | null => {
    const el = document.getElementById(cellId(cell.r, cell.c));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { kind: 'point', x: r.left + 12, y: r.bottom };
  };

  // ── The table's own keys, while it holds the focus (an open cell has its own) ──
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.metaKey) return;
    const at = active ?? { r: rows.length > 0 ? 0 : -1, c: 0 };
    const page = Math.max(1, Math.floor(((scrollRef.current?.clientHeight ?? 0) - metrics.current.head) / metrics.current.row) - 1);
    const go = (r: number, c: number) => {
      e.preventDefault();
      setActive({ r: Math.max(-1, Math.min(lastRow, r)), c: Math.max(-1, Math.min(cols - 1, c)) });
    };
    switch (e.key) {
      case 'ArrowUp': return go(at.r - 1, at.c);
      case 'ArrowDown': return go(at.r + 1, at.c);
      case 'ArrowLeft': return go(at.r, at.c - 1);
      case 'ArrowRight': return go(at.r, at.c + 1);
      case 'Home': return e.ctrlKey ? go(rows.length > 0 ? 0 : -1, 0) : go(at.r, 0);
      case 'End': return e.ctrlKey ? go(lastRow, cols - 1) : go(at.r, cols - 1);
      case 'PageUp': return go(Math.max(at.r < 0 ? -1 : 0, at.r - page), at.c);
      case 'PageDown': return go(at.r + page, at.c);
    }
    if (e.key === 'F10' && e.shiftKey) {
      e.preventDefault();
      const anchor = anchorOf(at);
      if (anchor && !locked) menuAt(at, anchor);
      return;
    }
    if (e.ctrlKey) return;
    if (e.key === 'Enter' || e.key === 'F2' || (e.key === ' ' && at.c < 0)) {
      e.preventDefault();
      if (at.r < 0 && at.c < 0) copyRowToken();
      else if (at.r < 0) openHeader(at.c);
      else if (at.c < 0) moveCursor(at.r);
      else openCell(at.r, at.c);
      return;
    }
    if (locked || at.c < 0) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && at.r >= 0) {
      e.preventDefault();
      ops.setCell(at.r, at.c, '');
      return;
    }
    // Typing replaces the cell (or names the column), as a spreadsheet does.
    if (e.key.length === 1) {
      e.preventDefault();
      if (at.r < 0) openHeader(at.c);
      else openCell(at.r, at.c, e.key);
    }
  };
  // The table taking the focus with no cell of its own yet: the first row in view, so nothing
  // scrolls — a click that gave the focus would otherwise land on whatever scrolled under it.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || active) return;
    const el = scrollRef.current;
    const first = el ? Math.min(lastRow, Math.ceil(el.scrollTop / metrics.current.row)) : 0;
    quiet.current = true;
    setActive({ r: rows.length > 0 ? first : -1, c: 0 });
  };

  // One click handler for every cell (the table can be thousands of them).
  const cellOf = (target: EventTarget): Cell | null => {
    const el = (target as Element).closest<HTMLElement>('[data-r]');
    return el ? { r: Number(el.dataset.r), c: Number(el.dataset.c) } : null;
  };
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button, textarea, input')) return;
    const cell = cellOf(e.target);
    if (!cell) return;
    if (cell.r >= 0 && cell.c >= 0) openCell(cell.r, cell.c);
    else setActive(cell);
  };
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    const cell = cellOf(e.target);
    if (!cell || (e.target as Element).closest('textarea, input')) return;
    e.preventDefault();
    setActive(cell);
    if (!locked) menuAt(cell, { kind: 'point', x: e.clientX, y: e.clientY });
  };

  // The rows drawn: those in view, and the active and the open ones wherever they are.
  const drawn = new Set<number>();
  for (let r = win.first; r < Math.min(win.last, rows.length); r++) drawn.add(r);
  if (active && active.r >= 0 && active.r < rows.length) drawn.add(active.r);
  if (editing?.kind === 'cell' && editing.r < rows.length) drawn.add(editing.r);

  const template = { '--dl-cols': cols } as CSSProperties;
  const activeId = active && (active.r < rows.length) ? cellId(active.r, active.c) : undefined;

  return (
    <div className="dl-scroll" ref={scrollRef}>
      <div className="dl-canvas" style={template}>
        <div
          ref={sheetRef}
          className="dl-sheet"
          role="grid"
          aria-label="Data Loop table"
          aria-rowcount={rows.length + 1}
          aria-colcount={cols + 1}
          aria-readonly={locked || undefined}
          aria-activedescendant={activeId}
          tabIndex={0}
          data-locked={locked || undefined}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onClick={onClick}
          onContextMenu={onContextMenu}
        >
          <div className="dl-head" role="row" aria-rowindex={1} ref={headRef}>
            <div role="columnheader" id={cellId(-1, -1)} className="dl-num" data-hc="n" data-r={-1} data-c={-1} data-active={active?.r === -1 && active.c === -1 || undefined}>
              <button
                type="button"
                tabIndex={-1}
                className="dl-num-button"
                aria-label="# — copy the {row} token"
                data-tip={tt('{row} is the row number — click to copy the token', '{row} é o número da linha — clique para copiar o token')}
                onClick={copyRowToken}
              >
                {copied ? <span className="step-icon" data-icon="check" /> : '#'}
              </button>
            </div>
            {heads.map((h, c) => (
              <HeaderCell
                key={c}
                c={c}
                head={h}
                headers={headers}
                active={active?.r === -1 && active.c === c}
                editing={editing?.kind === 'header' && editing.c === c ? editing : null}
                locked={locked}
                onRename={() => openHeader(c)}
                onMenu={(button) => {
                  if (menu?.at.r === -1 && menu.at.c === c) setMenu(null);
                  else menuAt({ r: -1, c }, { kind: 'below', rect: button.getBoundingClientRect(), align: 'end' }, button);
                }}
                onDone={finishHeader}
              />
            ))}
            <div className="dl-end" role="columnheader" aria-label="Add column">
              {!locked && (
                <button
                  type="button"
                  className="dl-add"
                  onClick={() => {
                    const c = ops.addColumn();
                    useDataTab.setState({ editing: { kind: 'header', c, macro }, active: { r: -1, c } });
                  }}
                >
                  <span className="step-icon" data-icon="plus" />
                  Column
                </button>
              )}
            </div>
          </div>
          <div className="dl-body" role="rowgroup" style={{ height: `calc(${rows.length} * var(--dl-row-h))` }}>
            {[...drawn].map(r => (
              <GridRow
                key={r}
                r={r}
                row={rows[r]}
                cols={cols}
                blank={r >= saved}
                cursor={cursorMode && r === shown.cursorRow && r < saved}
                cursorMode={cursorMode}
                locked={locked}
                activeC={active?.r === r ? active.c : null}
                edit={editing?.kind === 'cell' && editing.r === r ? editing : null}
                editLabel={editing?.kind === 'cell' && editing.r === r ? `${headers[editing.c]?.trim() || `Column ${editing.c + 1}`}, row ${r + 1}` : ''}
                term={termLower}
                current={r === hitRow}
                onCursor={moveCursor}
                ops={ops}
                onDone={finishCell}
                onDropped={dropped}
              />
            ))}
          </div>
        </div>
        {!locked && cols > 0 && (
          <div className="dl-foot">
            <button
              type="button"
              className="dl-add"
              onClick={() => {
                const r = ops.addRow();
                useDataTab.setState({ editing: { kind: 'cell', r, c: 0, macro, seed: null }, active: { r, c: 0 } });
              }}
            >
              <span className="step-icon" data-icon="plus" />
              Add row
            </button>
          </div>
        )}
        <div className="dl-probe" ref={probeRef} aria-hidden="true" />
      </div>
      {menu && (
        <Menu
          anchor={menu.anchor}
          label={menu.at.r < 0 ? 'Column options' : `Row ${menu.at.r + 1}`}
          entries={menu.at.r < 0 ? columnMenu(menu.at.c, heads[menu.at.c], cols, ops, macro, tt, showToast) : rowMenu(menu.at.r, saved, cursorMode, shown.cursorRow, ops)}
          focusFirst
          toggle={menu.button}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

interface Head { name: string; valid: boolean; dup: boolean; count: number }

/** A column's header: its name (a click renames it), how many steps read it, and its ⋯. */
function HeaderCell({ c, head, headers, active, editing, locked, onRename, onMenu, onDone }: {
  c: number;
  head: Head;
  headers: string[];
  active: boolean;
  editing: Extract<Editing, { kind: 'header' }> | null;
  locked: boolean;
  onRename: () => void;
  onMenu: (button: HTMLElement) => void;
  onDone: (edit: Extract<Editing, { kind: 'header' }>, value: string | null, byKey: boolean) => void;
}) {
  const tt = useTt();
  return (
    <div
      role="columnheader"
      id={cellId(-1, c)}
      className="dl-hcell"
      data-hc={c}
      data-r={-1}
      data-c={c}
      data-active={active || undefined}
      data-invalid={!head.valid || undefined}
      data-editing={editing ? '' : undefined}
    >
      {editing ? (
        <HeaderEditor edit={editing} initial={headers[c] ?? ''} headers={headers} onDone={onDone} />
      ) : (
        <>
          {!head.valid && (
            <span
              className="step-icon dl-warn"
              data-icon="triangle-alert"
              data-tip={tt('Not a token name ({ } and : are not allowed) — Fix it in the Inspector', 'Não serve de nome de token ({ } e : não podem) — corrija no Inspector')}
            />
          )}
          <button
            type="button"
            tabIndex={-1}
            className="dl-hname"
            data-dup={head.dup || undefined}
            disabled={locked}
            data-tip={head.dup ? tt('Duplicate column — the last one wins', 'Coluna duplicada — a última vence') : undefined}
            onClick={onRename}
          >
            {head.name || <span className="dl-empty-name">(empty)</span>}
          </button>
          {head.valid && (
            <span
              className="dl-uses"
              data-used={head.count > 0 || undefined}
              data-tip={head.count > 0 ? tt(`Read ${head.count} time${head.count === 1 ? '' : 's'} by the steps`, `Lida ${head.count} vez${head.count === 1 ? '' : 'es'} pelos passos`) : undefined}
            >
              {head.count > 0 ? `×${head.count}` : 'unused'}
            </span>
          )}
          <button
            type="button"
            tabIndex={-1}
            className="dl-hmenu"
            aria-haspopup="menu"
            aria-label={`Column options for ${head.name || `column ${c + 1}`}`}
            data-tip={tt('Column options', 'Opções da coluna')}
            onClick={(e) => onMenu(e.currentTarget)}
          >
            <span className="step-icon" data-icon="ellipsis" />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Renames a column in place. Enter and Tab confirm, Esc puts the name back. A name that cannot be
 * a token's (empty, { } :) or that another column has is refused as it is typed (D18).
 */
function HeaderEditor({ edit, initial, headers, onDone }: {
  edit: Extract<Editing, { kind: 'header' }>;
  initial: string;
  headers: string[];
  onDone: (edit: Extract<Editing, { kind: 'header' }>, value: string | null, byKey: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  const [tried, setTried] = useState(false);
  const done = useRef(false);
  const ref = useRef<HTMLInputElement>(null);
  const problem = nameProblem(value, headers, edit.c);
  // Said as it is typed; only the empty name waits for a try, so clearing the field to retype it
  // is not met with an error.
  const shownProblem = problem && (tried || value.trim() !== '') ? problem : null;
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);
  const finish = (commit: boolean, byKey: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(edit, commit ? value : null, byKey);
  };
  return (
    <>
      <input
        ref={ref}
        className="dl-input"
        value={value}
        aria-label="Column name"
        aria-invalid={!!shownProblem || undefined}
        aria-describedby={shownProblem ? 'dl-name-problem' : undefined}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(!problem, false)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finish(false, true);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            if (problem) setTried(true);
            else finish(true, true);
          }
        }}
      />
      {shownProblem && <span id="dl-name-problem" className="dl-problem" role="status">{shownProblem}</span>}
    </>
  );
}

/** One row of the table: its number (the cursor's marker, and the way to move it), its cells, and its tools. */
function GridRow({ r, row, cols, blank, cursor, cursorMode, locked, activeC, edit, editLabel, term, current, onCursor, ops, onDone, onDropped }: {
  r: number;
  row: string[];
  cols: number;
  blank: boolean;
  cursor: boolean;
  cursorMode: boolean;
  locked: boolean;
  activeC: number | null;
  edit: Extract<Editing, { kind: 'cell' }> | null;
  editLabel: string;
  term: string;
  current: boolean;
  onCursor: (r: number) => void;
  ops: DataOps;
  onDone: (edit: Extract<Editing, { kind: 'cell' }>, value: string | null, nav: Nav | undefined, byKey: boolean) => void;
  onDropped: (edit: Extract<Editing, { kind: 'cell' }>, value: string) => void;
}) {
  const tt = useTt();
  const cells: ReactNode[] = [];
  for (let c = 0; c < cols; c++) {
    const value = row[c] ?? '';
    const hit = term !== '' && value.toLowerCase().includes(term);
    cells.push(
      <div
        key={c}
        role="gridcell"
        id={cellId(r, c)}
        className="dl-cell"
        data-r={r}
        data-c={c}
        data-active={activeC === c || undefined}
        data-hit={hit || undefined}
        data-current={(hit && current) || undefined}
        data-editing={edit?.c === c ? '' : undefined}
      >
        {edit?.c === c ? <CellEditor edit={edit} initial={value} label={editLabel} onDone={onDone} onDropped={onDropped} /> : cellText(value)}
      </div>,
    );
  }
  return (
    <div
      role="row"
      aria-rowindex={r + 2}
      className="dl-row"
      style={{ top: `calc(${r} * var(--dl-row-h))` }}
      data-odd={r % 2 === 1 || undefined}
      data-cursor={cursor || undefined}
      data-blank={blank || undefined}
      data-editing={edit ? '' : undefined}
    >
      <div role="rowheader" id={cellId(r, -1)} className="dl-num" data-r={r} data-c={-1} data-active={activeC === -1 || undefined}>
        {cursorMode && !blank ? (
          <button
            type="button"
            tabIndex={-1}
            className="dl-num-button"
            disabled={locked}
            aria-label={cursor ? `Row ${r + 1}, the next replay uses it` : `Make row ${r + 1} the next row`}
            aria-current={cursor || undefined}
            data-tip={cursor ? tt('The next replay uses this row', 'A próxima execução usa esta linha') : tt('Make it the next row', 'Tornar a próxima linha')}
            onClick={() => onCursor(r)}
          >
            {cursor && <span className="step-icon" data-icon="play" />}
            {r + 1}
          </button>
        ) : (
          <span className="dl-num-text">{r + 1}</span>
        )}
      </div>
      {cells}
      <div className="dl-end">
        {cursor && <span className="dl-next">next replay</span>}
        {!locked && (
          <span className="dl-acts">
            <button type="button" tabIndex={-1} className="dl-act" aria-label={`Duplicate row ${r + 1}`} data-tip={tt('Duplicate row', 'Duplicar a linha')} onClick={() => ops.duplicateRow(r)}>
              <span className="step-icon" data-icon="copy" />
            </button>
            <button type="button" tabIndex={-1} className="dl-act" data-danger="" aria-label={`Delete row ${r + 1}`} data-tip={tt('Delete row', 'Apagar a linha')} onClick={() => ops.deleteRow(r)}>
              <span className="step-icon" data-icon="trash-2" />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The open cell: confirmed by Enter (and the cell below opens), Tab and Shift+Tab (the next one
 * right or left), Ctrl+Enter and by leaving it; Alt+Enter or Shift+Enter break the line; Esc puts the
 * value back. A composition in progress (IME) keeps every key.
 */
/** The table still has this cell of this macro open. */
const stillOpen = (edit: Extract<Editing, { kind: 'cell' }>) => {
  const now = useDataTab.getState().editing;
  return now?.kind === 'cell' && now.r === edit.r && now.c === edit.c && now.macro === edit.macro;
};

function CellEditor({ edit, initial, label, onDone, onDropped }: {
  edit: Extract<Editing, { kind: 'cell' }>;
  initial: string;
  label: string;
  onDone: (edit: Extract<Editing, { kind: 'cell' }>, value: string | null, nav: Nav | undefined, byKey: boolean) => void;
  /** Closed from outside (a run, the Clicker, another macro) with something typed in it. */
  onDropped: (edit: Extract<Editing, { kind: 'cell' }>, value: string) => void;
}) {
  const [value, setValue] = useState(edit.seed ?? initial);
  const done = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  // What the cell holds now and who to tell, for the close that comes from outside (below).
  const typed = useRef(value);
  const dropped = useRef(onDropped);
  useEffect(() => {
    typed.current = value;
    dropped.current = onDropped;
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (edit.seed === null) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
  }, [edit]);
  // The table moved on without this cell — a run or the Clicker started, or the engine opened
  // another macro — while something was typed in it: the grid keeps it if it still can, or says it
  // was dropped.
  useEffect(() => () => {
    if (done.current || stillOpen(edit)) return;
    done.current = true;
    if (typed.current !== initial) dropped.current(edit, typed.current);
  }, [edit, initial]);
  const finish = (commit: boolean, nav: Nav | undefined, byKey: boolean) => {
    if (done.current) return;
    done.current = true;
    if (!stillOpen(edit)) {
      if (commit && value !== initial) onDropped(edit, value);
      return;
    }
    onDone(edit, commit ? value : null, nav, byKey);
  };
  return (
    <textarea
      ref={ref}
      className="dl-editor"
      rows={1}
      value={value}
      aria-label={label}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true, undefined, false)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(false, undefined, true);
        } else if (e.key === 'Enter') {
          if (e.altKey || e.shiftKey) {
            // A line break in the cell. Alt+Enter is not one a textarea makes on its own: it goes in
            // at the caret as typing would (the field's own Ctrl+Z takes it back), and onChange
            // follows.
            if (e.altKey) {
              e.preventDefault();
              const el = e.currentTarget;
              if (!document.execCommand('insertText', false, '\n')) {
                el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
                setValue(el.value);
              }
            }
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          finish(true, e.ctrlKey ? undefined : 'down', true);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          e.stopPropagation();
          finish(true, e.shiftKey ? 'left' : 'right', true);
        }
      }}
    />
  );
}

type Toast = ReturnType<typeof useToast>['showToast'];
type Tt = ReturnType<typeof useTt>;

/** A column's ⋯: its token, a column beside it, its moves and its deletion (paineis-103 to 108). */
function columnMenu(c: number, head: Head | undefined, cols: number, ops: DataOps, macro: string, tt: Tt, showToast: Toast): MenuEntry[] {
  const locked = lockedNow();
  const insert = (at: number) => {
    const made = ops.addColumn(at);
    useDataTab.setState({ editing: { kind: 'header', c: made, macro }, active: { r: -1, c: made } });
  };
  return [
    {
      label: head?.valid ? `Copy {row:${head.name}}` : 'Not a token name',
      icon: Copy,
      disabled: !head?.valid,
      onSelect: () => {
        navigator.clipboard?.writeText(`{row:${head?.name}}`).then(
          () => showToast(tt('Token copied', 'Token copiado'), 'success'),
          () => showToast(tt('Could not copy — click inside the window and try again.', 'Não foi possível copiar — clique dentro da janela e tente de novo.'), 'error'),
        );
      },
    },
    'separator',
    { label: 'Insert column left', icon: Plus, disabled: locked, onSelect: () => insert(c) },
    { label: 'Insert column right', icon: Plus, disabled: locked, onSelect: () => insert(c + 1) },
    { label: 'Move left', icon: ArrowLeft, disabled: locked || c === 0, onSelect: () => ops.moveColumn(c, c - 1) },
    { label: 'Move right', icon: ArrowRight, disabled: locked || c === cols - 1, onSelect: () => ops.moveColumn(c, c + 1) },
    'separator',
    { label: 'Delete column', icon: Trash2, confirm: 'Really delete column?', disabled: locked, onSelect: () => ops.deleteColumn(c) },
  ];
}

/** A row's menu (right-click, Shift+F10): the cursor, a copy of it, its deletion. */
function rowMenu(r: number, saved: number, cursorMode: boolean, cursorRow: number, ops: DataOps): MenuEntry[] {
  const entries: MenuEntry[] = [];
  if (cursorMode && r < saved) {
    entries.push({ label: r === cursorRow ? 'The next replay uses this row' : 'Make it the next row', icon: Play, disabled: r === cursorRow, onSelect: () => ops.setCursor(r) }, 'separator');
  }
  entries.push(
    { label: 'Duplicate row', icon: Copy, onSelect: () => ops.duplicateRow(r) },
    { label: 'Delete row', icon: Trash2, danger: true, onSelect: () => ops.deleteRow(r) },
  );
  return entries;
}
