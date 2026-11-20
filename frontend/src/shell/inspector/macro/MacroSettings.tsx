import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useShell } from '../../store';
import { useUi } from '../../ui';
import { AutomationSection } from './AutomationSection';
import { macroFacts } from './facts';
import { TecladoSection } from '../../mk/TecladoSection';
import { DeckSection } from '../../deck/DeckSection';
import { InfoSection } from './InfoSection';
import { TriggerSection } from './TriggerSection';
import { WindowTargetSection } from './WindowTargetSection';
import '../editors.css';
import './macro.css';

/**
 * ⑧ The Inspector with no step chosen: the open macro's own settings (Macro settings board) —
 * Trigger, Window target, Automation and Info. Each applies as it changes, and Ctrl+Z undoes it: the
 * engine keeps the open macro's hotkey, hotstring, target, automation and info in its history.
 * Hotkey…, Hotstring…, Window target… and Edit info… (the macro's menu, Ctrl+K) bring the focus to
 * their part. A chunk of its own, loaded once the app's state is drawn.
 */
export default function MacroSettings({ name: opened, locked }: { name: string; locked: boolean }) {
  // Another macro's settings come at the first idle moment after the switch: the switch draws the
  // steps, not these (drawn in the same go, they cost the switch a few ms, ~15 with 1,000 steps).
  // Until then the panel is empty rather than showing the macro before.
  const [name, setName] = useState(opened);
  useEffect(() => {
    if (name === opened) return;
    const id = requestIdleCallback(() => setName(opened), { timeout: 500 });
    return () => cancelIdleCallback(id);
  }, [name, opened]);
  // Only what the settings show, in plain values: the library a switch brings does not draw them
  // again when none of it changed.
  const facts = useShell(useShallow(s => macroFacts(s.app.profiles, s.app.profileOrder, name)));
  const want = useUi(s => (s.settingsFocus?.name === name ? s.settingsFocus : null));
  if (name !== opened || !facts) return <div className="insp-body" />;
  const trigger = want?.section === 'hotkey' || want?.section === 'hotstring';
  return (
    // One per macro: what is typed and not sent belongs to the macro it was typed in.
    <div key={name} className="insp-body mset">
      <TriggerSection facts={facts} locked={locked} focus={trigger ? want : null} />
      <div className="insp-rule" />
      <WindowTargetSection facts={facts} locked={locked} focus={want?.section === 'target' ? want : null} />
      <div className="insp-rule" />
      <AutomationSection name={name} />
      <div className="insp-rule" />
      {/* Teclado (branch teclado): the game keys that use this macro. */}
      <TecladoSection name={name} />
      <div className="insp-rule" />
      {/* Deck (branch deck): the deck buttons that run this macro. */}
      <DeckSection name={name} />
      <div className="insp-rule" />
      <InfoSection facts={facts} locked={locked} focus={want?.section === 'info' ? want : null} />
    </div>
  );
}
