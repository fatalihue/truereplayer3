import { MousePointerClick } from 'lucide-react';
import { useAppState } from '../state/AppStateContext';
import { describeClickerConfig } from '../utils/clickerFormat';
import { KbdTag } from './common/KbdTag';

// Shown in place of the dashboard before the first run. This is the one surface that has to
// say what the key is about to do BEFORE it is pressed — where the clicks land and when they
// stop — so both halves come from describeClickerConfig, the same reading the dashboard
// recalls after the run. (The sentence used to look at useLoops alone: it said "at cursor"
// with an Area set, and "until you press it again" with only the Time limit armed.)
// Labels and prose are English (decided 2026-09-04); tt() is for tooltips only.
export function ClickerEmptyState() {
  const { settings } = useAppState();
  const summary = describeClickerConfig(settings);
  const startKey = settings.cursorClickStartHotkey;

  return (
    // The plain centre-card surface, like the dashboard and MacroEmptyState: a bordered, rounded
    // box here was a card drawn inside the centre card.
    <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-bg-surface min-h-0">
      <MousePointerClick size={32} style={{ color: 'var(--color-clicker-fg)', opacity: 0.7 }} />
      <div className="text-subtitle font-display font-semibold" style={{ color: 'var(--color-clicker-fg)' }}>
        Clicker mode
      </div>
      {/* A flex row, not inline text: KbdTag spells the key like the keycap (PgDn) and renders
          one cap per key, as block boxes that have to sit on the text baseline. gap-x carries
          the word spacing.
          The start key can be cleared in Settings (stored as ""), and KbdTag renders nothing for
          it — the sentence read "Press to start clicking…". Without a key it names the ActionBar
          button, which reads "Click" in this mode. */}
      <div className="text-minor text-text-tertiary text-center max-w-[460px] px-4 flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
        {startKey ? (
          <>
            <span>{'Recorded actions and profile hotkeys are ignored. Press'}</span>
            <KbdTag combo={startKey} accent />
            <span>{`to start clicking ${summary.where} — ${summary.stop}.`}</span>
          </>
        ) : (
          <span>{`Recorded actions and profile hotkeys are ignored. The Click button starts clicking ${summary.where} — ${summary.stop}.`}</span>
        )}
      </div>
      {/* The same recall line the dashboard shows after a run, so the configuration is
          legible before the key is pressed, not only after. */}
      <div className="text-caption text-text-secondary font-mono text-center max-w-[480px] px-4 mt-1">
        {summary.bits.join('  ·  ')}
      </div>
    </div>
  );
}
