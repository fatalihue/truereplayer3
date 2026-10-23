import { TooltipLayer } from '../components/common/TooltipLayer';
import { Toast } from '../components/Toast';
import { Inspector } from './Inspector';
import { Library } from './library/Library';
import { MacroHeader } from './header/MacroHeader';
import { Rail } from './Rail';
import { ShellKeys } from './ShellKeys';
import { StatusBar } from './StatusBar';
import { StepList } from './list/StepList';
import { TitleBar } from './TitleBar';
import './shell.css';

/**
 * The new shell (phase 1 of the interface plan). The zones are numbered as in the concept: ① title
 * bar, ② rail, ③ library, ④ macro header with ⑤ its transport, ⑦ steps, ⑧ Inspector, ⑩ status
 * bar. Which of them show, and how wide, follows the window in five bands (shell.css).
 */
export function Shell() {
  return (
    <div className="shell">
      <TitleBar />
      <div className="shell-body">
        <Rail />
        <Library />
        <main className="shell-main">
          <MacroHeader />
          <StepList />
        </main>
        <Inspector />
      </div>
      <StatusBar />
      <ShellKeys />
      <Toast />
      <TooltipLayer />
    </div>
  );
}
