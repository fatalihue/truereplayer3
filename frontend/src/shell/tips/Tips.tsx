import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Play, X } from 'lucide-react';
import { useReplay } from '../../logic/useReplay';
import { keycaps } from '../library/model';
import { useApp, useShell } from '../store';
import { focusName, openMacroSettings } from '../ui';
import { endTip, pendingTips } from './tipsState';
import './tips.css';

// The names the engine gives a new macro: after a first recording, its name is the next thing to type.
const UNTITLED = /^Untitled macro( \d+)?$/;

interface After {
  macro: string;
  steps: number;
}

/**
 * The tips shown once, over the steps (phase 5; lista-105). Mounted when a recording starts while
 * they wait (tipsState), and kept for the recordings after it until each has had its turn:
 *   - while recording: "Do the task now, in any app", with the key that stops it;
 *   - when a recording that made steps ends: "Your first macro is saved", with what to do next —
 *     try it (Replay) and run it from any app (a shortcut, in the macro's settings) — each checked
 *     off once done, and the name ready to type.
 * The card stays with its macro (a rename follows it) until it is hidden or another macro opens.
 */
export default function Tips() {
  const status = useApp(a => a.status);
  const profiles = useApp(a => a.profiles);
  const recordKey = useApp(a => a.settings.recordingHotkey);
  const replayKey = useApp(a => a.settings.replayHotkey);
  const replay = useReplay();
  // The recording tip shows only if it was still waiting when this recording began.
  const [recordTip, setRecordTip] = useState(() => pendingTips().includes('recording'));
  const [after, setAfter] = useState<After | null>(null);
  const [tried, setTried] = useState(false);
  // The card as the store's listener sees it: hiding it here must reach the listener too.
  const card = useRef<After | null>(null);
  const show = (next: After | null) => {
    card.current = next;
    setAfter(next);
  };

  // What happens to the macro comes from the store as it happens: a recording that ends turns the
  // recording tip into the card; a run of the card's macro checks "Try it"; a rename takes the card
  // along (it comes in one push, the old name gone and the open one new to the library), and another
  // macro opened — after a delete, too — ends it.
  useEffect(() => {
    let start = useShell.getState().app.actions.length;
    return useShell.subscribe(({ app: now }, { app: was }) => {
      if (now.status === 'recording' && was.status !== 'recording') start = now.actions.length;
      if (was.status === 'recording' && now.status !== 'recording') {
        endTip('recording');
        setRecordTip(false);
        const made = now.actions.length - start;
        if (made > 0 && now.activeProfile && pendingTips().includes('firstMacro')) {
          endTip('firstMacro');
          card.current = { macro: now.activeProfile, steps: made };
          setAfter(card.current);
          setTried(false);
          if (UNTITLED.test(now.activeProfile)) focusName(now.activeProfile);
        }
        return;
      }
      const shown = card.current;
      if (!shown) return;
      if (was.status === 'replaying' && now.status === 'ready' && now.activeProfile === shown.macro) setTried(true);
      if (now.activeProfile === was.activeProfile || now.activeProfile === shown.macro) return;
      const renamed = !!now.activeProfile && !was.profiles.some(p => p.name === now.activeProfile) && !now.profiles.some(p => p.name === shown.macro);
      card.current = renamed && now.activeProfile ? { ...shown, macro: now.activeProfile } : null;
      setAfter(card.current);
    });
  }, []);

  if (status === 'recording' && recordTip) {
    return (
      <div className="tip" data-tone="record" role="status">
        <span className="tip-dot" aria-hidden="true" />
        <span className="tip-text">
          <span className="tip-title">Do the task now, in any app</span>
          <span className="tip-body">
            Each click and key becomes a step below. {recordKey ? <>Press <kbd className="kbd">{keycaps(recordKey)}</kbd> to stop.</> : 'Press Stop to finish.'}
          </span>
        </span>
        <button
          type="button"
          className="tip-hide"
          aria-label="Hide this tip"
          data-tip="Hide this tip"
          onClick={() => { endTip('recording'); setRecordTip(false); }}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (!after || status === 'recording') return null;
  const shortcut = !!profiles.find(p => p.name === after.macro)?.hotkey;
  return (
    <section className="tip tip-card" aria-label="Your first macro is saved">
      <div className="tip-card-head">
        <span className="tip-title">Your first macro is saved</span>
        <button type="button" className="tip-hide" aria-label="Hide these tips" data-tip="Hide these tips" onClick={() => show(null)}>
          <X aria-hidden="true" />
        </button>
      </div>
      <ul className="tip-list">
        <li data-done="">
          <Check aria-hidden="true" />
          <span className="tip-item">Recorded {after.steps === 1 ? '1 step' : `${after.steps} steps`}</span>
        </li>
        <li data-done={tried || undefined}>
          {tried ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
          <span className="tip-item">Try it</span>
          <button type="button" className="tip-action" disabled={status !== 'ready'} onClick={replay.toggle}>
            <Play aria-hidden="true" />
            Replay
            {replayKey && <kbd className="kbd">{keycaps(replayKey)}</kbd>}
          </button>
        </li>
        <li data-done={shortcut || undefined}>
          {shortcut ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
          <span className="tip-item">Run it from any app</span>
          <button type="button" className="tip-action" onClick={() => openMacroSettings(after.macro, 'hotkey')}>
            {shortcut ? 'Change the shortcut' : 'Add a shortcut'}
          </button>
        </li>
      </ul>
    </section>
  );
}
