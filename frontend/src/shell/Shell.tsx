import { useEffect } from 'react';
import { TooltipLayer } from '../components/common/TooltipLayer';
import { Toast } from '../components/Toast';
import { Dock } from './dock/Dock';
import { Inspector } from './inspector/Inspector';
import { InsertRow } from './insert/InsertRow';
import { preload, useLoaded } from './lazyModule';
import { Library } from './library/Library';
import { MacroHeader } from './header/MacroHeader';
import { Overlays } from './Overlays';
import { Rail } from './Rail';
import { ShellKeys } from './ShellKeys';
import { StatusBar } from './StatusBar';
import { StepList } from './list/StepList';
import { useApp } from './store';
import { TitleBar } from './TitleBar';
import { inspectorWide, loadDataLoop, useUi } from './ui';
import './shell.css';

/**
 * The new shell (phase 1 of the interface plan). The zones are numbered as in the concept: ① title
 * bar, ② rail, ③ library, ④ macro header with ⑤ its transport, ⑥ the tabs and the insert row,
 * ⑦ steps with ⑨ the dock under them, ⑧ Inspector, ⑩ status bar. Which of them show, and how wide,
 * follows the window in five bands (shell.css). Ctrl+K and "Input needed" open over all of it.
 *
 * The expanded Inspector narrows what is beside it (the insert row, the list): one attribute here,
 * changed only when the mode changes. A :has() on the Inspector restyled the whole body on every
 * key typed anywhere in it (~2,000 elements, ~5 ms a key).
 */
export function Shell() {
  const wide = useUi(inspectorWide);
  return (
    <div className="shell">
      <TitleBar />
      <div className="shell-body" data-wide={wide || undefined}>
        <Rail />
        <Library />
        <main className="shell-main">
          <MacroHeader />
          <InsertRow />
          <MacroViews />
          <Dock />
        </main>
        <Inspector />
      </div>
      <StatusBar />
      <ShellKeys />
      <Overlays />
      <Toast />
      <TooltipLayer />
    </div>
  );
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
        <StepList />
      </div>
      {table && (DataMain
        ? <DataMain />
        : <div className="shell-view-wait" id="macro-panel-data" role="tabpanel" aria-labelledby="macro-tab-data" />)}
    </>
  );
}
