import { List, Circle, Type } from 'lucide-react';
import { useAppState } from '../state/AppStateContext';
import { useBridge } from '../bridge/BridgeContext';
import { Button } from './common/Button';
import { useTt } from '../state/LanguageContext';

// Shown inside the ActionTable when the grid has zero actions (Macro mode only —
// Clicker mode swaps the whole table for ClickerDashboard / ClickerEmptyState).
// Mirrors ClickerEmptyState's composition — mode icon, mode name in the mode
// colour, hint line with the relevant hotkey — but in the Macro/replay green and
// with the List icon the ActionBar mode pill uses. No background wash:
// the user asked for the plain theme surface here (the green gradient that
// mirrored ClickerEmptyState read as a stain on the grid).
export function MacroEmptyState() {
  const { settings, status, buttonStates } = useAppState();
  const { send } = useBridge();
  const tt = useTt();
  const isRecording = status === 'recording';

  return (
    <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[200px] select-none">
      <List size={32} style={{ color: 'var(--color-replay-fg)', opacity: 0.7 }} />
      <div className="text-[14px] font-semibold" style={{ color: 'var(--color-replay-fg)' }}>
        Macro mode
      </div>
      <div className="text-[12px] text-text-tertiary text-center max-w-[420px] px-4">
        {/* Instructional prose is bilingual (the app defaults to pt-BR); "Macro mode"
            above stays English because it is a label. Same split as ClickerEmptyState. */}
        {isRecording ? (
          <span className="font-medium text-recording">
            {'Recording — waiting for input…'}
          </span>
        ) : (
          'No actions recorded.'
        )}
      </div>
      {/* An empty grid that acts: the two first steps most macros start with, as real buttons
          instead of a sentence about a hotkey. Record mirrors the ActionBar's enablement (the
          backend owns it) and carries the hotkey so the shortcut is still taught; Send Text goes
          through the same cmd:sendtext event the Command Palette uses. Labels stay English (they
          are labels); the tooltips are the bilingual half. */}
      {!isRecording && (
        <div className="flex items-center gap-2 mt-1">
          <Button
            variant="secondary"
            size="xs"
            disabled={!buttonStates.recordEnabled}
            onClick={() => send({ type: 'recording:toggle', payload: { insertIndex: 0 } })}
            data-tip={tt('Start recording now — the same as the hotkey', 'Começar a gravar agora — o mesmo que o atalho')}
          >
            <Circle size={10} fill="currentColor" style={{ color: 'var(--color-recording-fg)' }} />
            Start recording
            <kbd className="kbd">{settings.recordingHotkey}</kbd>
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => window.dispatchEvent(new CustomEvent('cmd:sendtext'))}
            data-tip={tt('Insert a Send Text action', 'Inserir uma ação Send Text')}
          >
            <Type size={11} />
            Send Text
          </Button>
        </div>
      )}
    </div>
  );
}
