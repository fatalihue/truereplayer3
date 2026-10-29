import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useRovingToolbar } from '../../hooks/useRovingToolbar';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
import { preload, useLoaded } from '../lazyModule';
import { clickerOnNote } from '../library/model';
import { anchorBelow, type MenuAnchor } from '../menuAnchor';
import { useApp } from '../store';
import { loadDataLoop, showMacroTab, useUi, type MacroTab } from '../ui';
import { insertHere, inserts } from './inserts';
import './insert.css';

// The catalog is not part of opening the app (rule 6). Its chunk starts loading when the pointer
// or the focus reaches Add step, so it is there by the press, and drawn on it (lazyModule).
const loadCatalog = () => import('./AddStepCatalog');
const loadNow = () => { void preload(loadCatalog); };
// The Data Loop tab's chunk, the same way: the pointer or the focus on its tab starts it.
const warmData = () => { void preload(loadDataLoop); };
const TABS: MacroTab[] = ['steps', 'data'];

interface Opened {
  anchor: MenuAnchor;
  button: HTMLElement;
  macro: string;
}

/**
 * ⑥ The row over the steps: the tabs — Steps, and the Data Loop table with its row count — and the
 * tools of the one shown. On Steps: Add step, which opens the catalog, then Click, Key, Text and
 * Pause at one click, then Undo and Redo; a new step goes to the insertion point and the list
 * selects it when it lands. On Data Loop: Find in table, Paste or import and the table's ⋯.
 *
 * The tabs are one Tab stop, and so are the tools, with ← → Home End inside (casca-100, D2); a
 * click on a tool leaves the focus where it was. While a recording or a run is on, or the Clicker,
 * the row says it is read-only instead of offering tools that would be refused (casca-021 to
 * casca-026).
 */
export function InsertRow() {
  const open = useApp(a => a.activeProfile);
  const count = useApp(a => a.actions.length);
  const rows = useApp(a => a.dataTable.rows.length);
  const hasTable = useApp(a => a.dataTable.headers.length > 0 || a.dataTable.rows.length > 0);
  const tab = useUi(s => s.macroTab);
  const data = useLoaded(loadDataLoop);
  const DataTools = data?.DataTools;
  const status = useApp(a => a.status);
  const clicker = useApp(a => a.settings.useCursorClick);
  const modeKey = useApp(a => a.settings.modeToggleHotkey);
  const canUndo = useApp(a => a.buttonStates.canUndo);
  const canRedo = useApp(a => a.buttonStates.canRedo);
  const cmds = useSteps();
  const tt = useTt();
  const toolsRef = useRef<HTMLDivElement>(null);
  const roving = useRovingToolbar(toolsRef);
  const [catalog, setCatalog] = useState<Opened | null>(null);
  const AddStepCatalog = useLoaded(loadCatalog)?.default;
  const locked = status !== 'ready' || clicker;
  // The catalog does not outlive its macro or its tab, and closes when a run, a recording or the
  // Clicker starts (casca-027).
  if (catalog && (locked || catalog.macro !== open || tab === 'data')) setCatalog(null);

  if (!open) return null;

  const openCatalog = (e: MouseEvent<HTMLButtonElement>) => {
    if (catalog) { setCatalog(null); return; }
    const button = e.currentTarget;
    loadNow();
    setCatalog({ anchor: anchorBelow(button, 'end'), button, macro: open });
  };

  const note = clicker
    ? clickerOnNote(modeKey)
    : status === 'recording' ? 'Read-only while recording' : 'Read-only while it runs';

  // ← → Home End choose a tab, as they move to it (the panel draws at once).
  const onTabsKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const at = TABS.indexOf(tab);
    const next = TABS[e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    if (next === 'data') warmData();
    showMacroTab(next);
    e.currentTarget.querySelector<HTMLElement>(`#macro-tab-${next}`)?.focus();
  };

  return (
    <div className="ins">
      <div role="tablist" aria-label="Macro views" className="ins-tabs" onKeyDown={onTabsKey}>
        <button
          type="button"
          role="tab"
          id="macro-tab-steps"
          aria-selected={tab === 'steps'}
          aria-controls="macro-panel-steps"
          tabIndex={tab === 'steps' ? 0 : -1}
          className="ins-tab"
          onClick={() => showMacroTab('steps')}
        >
          Steps<span className="ins-count">{count}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="macro-tab-data"
          aria-selected={tab === 'data'}
          aria-controls="macro-panel-data"
          tabIndex={tab === 'data' ? 0 : -1}
          className="ins-tab"
          onPointerEnter={warmData}
          onFocus={warmData}
          onClick={() => { warmData(); showMacroTab('data'); }}
        >
          Data Loop{hasTable && <span className="ins-count">{rows === 1 ? '1 row' : `${rows} rows`}</span>}
        </button>
      </div>
      <span className="ins-spacer" />
      {locked ? (
        <span className="ins-note">{note}</span>
      ) : tab === 'data' ? (
        DataTools && <DataTools />
      ) : (
        <div
          ref={toolsRef}
          role="toolbar"
          aria-label="Insert steps"
          className="ins-tools"
          onKeyDown={roving.onKeyDown}
          onFocus={roving.onFocus}
          // A click on a tool leaves the focus where it was: the list keeps its arrows.
          onMouseDown={(e) => { if ((e.target as Element).closest('button')) e.preventDefault(); }}
        >
          <button
            type="button"
            className="ins-add"
            tabIndex={-1}
            aria-haspopup="dialog"
            aria-expanded={!!catalog}
            onPointerEnter={loadNow}
            onFocus={loadNow}
            onClick={openCatalog}
          >
            <span className="step-icon" data-icon="plus" />
            Add step
          </button>
          <span className="ins-gap" />
          <button
            type="button"
            className="ins-quick"
            tabIndex={-1}
            data-tip={tt('A left click at the cursor', 'Um clique esquerdo no cursor')}
            onClick={() => insertHere(inserts.click, cmds)}
          >
            <span className="step-icon" data-icon="mouse" />
            Click
          </button>
          {/* Key and Text are born in the Inspector, which captures the key and holds the text: the
              engine keeps neither step empty. */}
          <button
            type="button"
            className="ins-quick"
            tabIndex={-1}
            data-tip={tt('Opens in the Inspector, listening for the key', 'Abre no Inspector, escutando a tecla')}
            onClick={() => insertHere(inserts.key, cmds)}
          >
            <span className="step-icon" data-icon="keyboard" />
            Key
          </button>
          <button
            type="button"
            className="ins-quick"
            tabIndex={-1}
            data-tip={tt('Opens in the Inspector: the step is added with its first text', 'Abre no Inspector: o passo entra com o primeiro texto')}
            onClick={() => insertHere(inserts.text, cmds)}
          >
            <span className="step-icon" data-icon="type" />
            Text
          </button>
          <button
            type="button"
            className="ins-quick"
            tabIndex={-1}
            data-tip={tt('Waits 1 s', 'Espera 1 s')}
            onClick={() => insertHere(inserts.pause, cmds)}
          >
            <span className="step-icon" data-icon="hourglass" />
            Pause
          </button>
          <span className="ins-sep" />
          <button
            type="button"
            className="ins-icon"
            tabIndex={-1}
            aria-label="Undo"
            aria-keyshortcuts="Control+Z"
            data-tip={tt('Undo (Ctrl+Z)', 'Desfazer (Ctrl+Z)')}
            disabled={!canUndo}
            onClick={() => cmds.undo({})}
          >
            <span className="step-icon" data-icon="undo-2" />
          </button>
          <button
            type="button"
            className="ins-icon"
            tabIndex={-1}
            aria-label="Redo"
            aria-keyshortcuts="Control+Y"
            data-tip={tt('Redo (Ctrl+Y)', 'Refazer (Ctrl+Y)')}
            disabled={!canRedo}
            onClick={() => cmds.redo({})}
          >
            <span className="step-icon" data-icon="redo-2" />
          </button>
        </div>
      )}
      {catalog && AddStepCatalog && (
        <AddStepCatalog anchor={catalog.anchor} toggle={catalog.button} onClose={() => setCatalog(null)} />
      )}
    </div>
  );
}
