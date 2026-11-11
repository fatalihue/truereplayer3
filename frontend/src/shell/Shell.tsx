import { useEffect, type ComponentType, type ReactNode } from 'react';
import { TooltipLayer } from '../components/common/TooltipLayer';
import { Toast } from '../components/Toast';
import { Dock } from './dock/Dock';
import { Inspector } from './inspector/Inspector';
import { InsertRow } from './insert/InsertRow';
import { preload, useLoaded } from './lazyModule';
import { Library } from './library/Library';
import { MacroHeader } from './header/MacroHeader';
import { Prototype } from './mk/Prototype';
import { TecladoSync } from './mk/TecladoSync';
import { Overlays } from './Overlays';
import { Rail } from './Rail';
import { ShellKeys } from './ShellKeys';
import { StatusBar } from './StatusBar';
import { StepList } from './list/StepList';
import { useApp, useShell } from './store';
import { TitleBar } from './TitleBar';
import { inspectorWide, loadDataLoop, PAGE_CHUNKS, useUi } from './ui';
import './shell.css';

// The first use (phase 5): with no macro at all, the screen that makes the first one. Most launches
// never need it, and the tips of a first recording neither, so each comes in a chunk of its own (rule 6).
const loadFirstRun = () => import('./firstrun/FirstRun');
const loadTips = () => import('./tips/Tips');

/**
 * The new shell (phase 1 of the interface plan). The zones are numbered as in the concept: ① title
 * bar, ② rail, ③ library, ④ macro header with ⑤ its transport, ⑥ the tabs and the insert row,
 * ⑦ steps with ⑨ the dock under them, ⑧ Inspector, ⑩ status bar. Which of them show, and how wide,
 * follows the window in five bands (shell.css). Ctrl+K and "Input needed" open over all of it. The
 * rail's other destinations (phase 3) take the place of ③ to ⑧, and with no macro yet the first-run
 * screen takes the place of ④ to ⑨ (phase 5).
 *
 * The expanded Inspector narrows what is beside it (the insert row, the list): one attribute here,
 * changed only when the mode changes. A :has() on the Inspector restyled the whole body on every
 * key typed anywhere in it (~2,000 elements, ~5 ms a key).
 */
export function Shell() {
  const wide = useUi(inspectorWide);
  const page = useUi(s => s.page);
  const away = page !== 'macros';
  // Only once the engine has said what there is: the library is empty for a moment before that.
  const firstRun = useShell(s => s.booted && s.app.profiles.length === 0);
  return (
    <div className="shell">
      <TitleBar />
      <div className="shell-body" data-wide={wide || undefined} data-page={away ? page : undefined}>
        <Rail />
        {/* The macros' screen stays mounted under another page: coming back finds it as it was. */}
        <div className="shell-macros" hidden={away}>
          <Library />
          {firstRun ? <Chunk load={loadFirstRun} /> : (
            <>
              <main className="shell-main">
                <MacroHeader />
                <InsertRow />
                <MacroViews />
                <Dock />
              </main>
              <Inspector />
            </>
          )}
        </div>
        {/* The page of the destination on screen; a frame holds its place until its chunk comes. */}
        {page !== 'macros' && <Chunk load={PAGE_CHUNKS[page]} wait={<section className="shell-page" />} />}
      </div>
      <StatusBar />
      {/* Teclado (branch teclado): the engine's games into the page's store, and the prototype's card
          (the Key Remaps variant, the game in front simulated until phase 2). */}
      <TecladoSync />
      <Prototype />
      <ShellKeys />
      <Overlays />
      <Toast />
      <TooltipLayer />
    </div>
  );
}

/** A part of the screen in a chunk of its own (rule 6): drawn once it is in, `wait` until then. */
function Chunk({ load, wait = null }: { load: () => Promise<{ default: ComponentType }>; wait?: ReactNode }) {
  const chunk = useLoaded(load);
  useEffect(() => {
    if (!chunk) void preload(load);
  }, [chunk, load]);
  const View = chunk?.default;
  return View ? <View /> : wait;
}

/**
 * ⑦ under the tabs: the steps, or the Data Loop table. The list stays mounted under the table, so
 * coming back finds it as it was (the selection, where it was scrolled to).
 */
function MacroViews() {
  const tab = useUi(s => s.macroTab);
  const open = useApp(a => a.activeProfile);
  const data = useLoaded(loadDataLoop);
  const table = tab === 'data' && !!open;
  useEffect(() => {
    if (table && !data) void preload(loadDataLoop);
  }, [table, data]);
  const DataMain = data?.DataMain;
  return (
    <>
      <div className="shell-view" hidden={table}>
        <Tips />
        <StepList />
      </div>
      {table && (DataMain
        ? <DataMain />
        : <div className="shell-view-wait" id="macro-panel-data" role="tabpanel" aria-labelledby="macro-tab-data" />)}
    </>
  );
}

/** Over the steps, the tips of a first recording, once one has started while they waited (watch.tsx). */
function Tips() {
  const on = useUi(s => s.tips);
  return on ? <Chunk load={loadTips} /> : null;
}
