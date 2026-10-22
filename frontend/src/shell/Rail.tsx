import { Keyboard, ListChecks, MousePointerClick, Settings, Zap } from 'lucide-react';
import { useTt } from '../state/LanguageContext';

// ② The rail: the five destinations. Only Macros exists in phase 1. The other four come in phase 3,
// and until then they show (disabled) only in the development build.
const DESTINATIONS = [
  { id: 'macros', label: 'Macros', Icon: ListChecks },
  { id: 'clicker', label: 'Clicker', Icon: MousePointerClick },
  { id: 'automations', label: 'Automations', Icon: Zap },
  { id: 'remaps', label: 'Key Remaps', Icon: Keyboard },
  { id: 'settings', label: 'Settings', Icon: Settings },
] as const;

export function Rail() {
  const tt = useTt();
  return (
    <nav className="shell-rail" aria-label="Destinations">
      {DESTINATIONS.filter(d => d.id === 'macros' || import.meta.env.DEV).map(({ id, label, Icon }) => {
        const built = id === 'macros';
        return (
          <button
            key={id}
            type="button"
            className="shell-rail-item"
            aria-current={built ? 'page' : undefined}
            disabled={!built}
            data-tip={built ? label : tt(`${label} — not built yet`, `${label} — ainda não feito`)}
            data-tip-pos="right"
          >
            <Icon aria-hidden="true" />
            <span className="shell-rail-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
