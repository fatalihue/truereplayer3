import { useRef, useState, type MouseEvent } from 'react';
import { useRovingToolbar } from '../../hooks/useRovingToolbar';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
import { preload, useLoaded } from '../lazyModule';
import { keycaps } from '../library/model';
import { anchorBelow, type MenuAnchor } from '../menuAnchor';
import { useApp } from '../store';
import { insertHere, inserts } from './inserts';
import './insert.css';

// The catalog is not part of opening the app (rule 6). Its chunk starts loading when the pointer
// or the focus reaches Add step, so it is there by the press, and drawn on it (lazyModule).
const loadCatalog = () => import('./AddStepCatalog');
const loadNow = () => { void preload(loadCatalog); };

interface Opened {
  anchor: MenuAnchor;
  button: HTMLElement;
  macro: string;
}

/**
 * ⑥ The row over the steps: the Steps tab (the Data Loop tab is phase 2) and the insert tools —
 * Add step, which opens the catalog, then Click, Key, Text and Pause at one click, then Undo and
 * Redo. A new step goes to the insertion point and the list selects it when it lands.
 *
 * The tools are one Tab stop with ← → Home End inside (casca-100, D2), and a click on one leaves
 * the focus where it was. While a recording or a run is on, or the Clicker, the row says it is
 * read-only instead of offering tools that would be refused (casca-021 to casca-026).
 */
export function InsertRow() {
  const open = useApp(a => a.activeProfile);
  const count = useApp(a => a.actions.length);
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
  // The catalog does not outlive its macro, and closes when a run, a recording or the Clicker
  // starts (casca-027).
  if (catalog && (locked || catalog.macro !== open)) setCatalog(null);

  if (!open) return null;

  const openCatalog = (e: MouseEvent<HTMLButtonElement>) => {
    if (catalog) { setCatalog(null); return; }
    const button = e.currentTarget;
    loadNow();
    setCatalog({ anchor: anchorBelow(button, 'end'), button, macro: open });
  };

  const note = clicker
    ? tt(`The Clicker is on — ${keycaps(modeKey || 'ScrollLock')} brings the macros back`,
         `O Clicker está ligado — ${keycaps(modeKey || 'ScrollLock')} traz os macros de volta`)
    : status === 'recording' ? 'Read-only while recording' : 'Read-only while it runs';

  return (
    <div className="ins">
      <div role="tablist" aria-label="Macro views" className="ins-tabs">
        <button type="button" role="tab" id="macro-tab-steps" aria-selected="true" aria-controls="macro-panel-steps" className="ins-tab">
          Steps<span className="ins-count">{count}</span>
        </button>
        {import.meta.env.DEV && (
          <button type="button" role="tab" aria-selected="false" className="ins-tab" tabIndex={-1} disabled>
            Data Loop — not built yet
          </button>
        )}
      </div>
      <span className="ins-spacer" />
      {locked ? (
        <span className="ins-note">{note}</span>
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
            data-tip="Undo (Ctrl+Z)"
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
            data-tip="Redo (Ctrl+Y)"
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
