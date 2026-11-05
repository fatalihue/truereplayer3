import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Play, X } from 'lucide-react';
import { APP_NAME } from '../../appIdentity';
import { t } from '../../i18n';
import { useReplay } from '../../logic/useReplay';
import { keycaps } from '../library/model';
import { useApp, useShell } from '../store';
import { focusName, openMacroSettings } from '../ui';
import { isUntitledName } from '../untitled';
import { endTip, pendingTips } from './tipsState';
import './tips.css';

// Where the key goes in "Press {{key}} to stop.": the sentence comes whole from the catalog with this
// mark in the key's place, and is cut there, so the key is drawn as a key cap wherever the language
// puts it. A private-use character: no text has one.
const KEY_MARK = '\uE000';

interface After {
  macro: string;
  steps: number;
}

/**
 * The tips shown once, over the steps (phase 5; lista-105). Mounted when a recording starts while
 * they wait (tipsState), and kept for the recordings after it until each has had its turn:
 *   - while recording: "Do the task now, in any app", with the key that stops it;
 *   - when a recording that made steps ends: "Your first macro is saved", with what to do next —
 *     try it (Replay) and run it without coming back to the app (a shortcut, in the macro's
 *     settings) — each checked off once done, and the name ready to type.
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
          // The name the app gave it (in either language) is the next thing to type.
          if (isUntitledName(now.activeProfile)) focusName(now.activeProfile);
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
    const [keyBefore, keyAfter = ''] = t('tips.recording.pressKey', { key: KEY_MARK }).split(KEY_MARK);
    return (
      <div className="tip" data-tone="record" role="status">
        <span className="tip-dot" aria-hidden="true" />
        <span className="tip-text">
          <span className="tip-title">{t('tips.recording.title')}</span>
          <span className="tip-body">
            {t('tips.recording.body')} {recordKey ? <>{keyBefore}<kbd className="kbd">{keycaps(recordKey)}</kbd>{keyAfter}</> : t('tips.recording.pressStop')}
          </span>
        </span>
        <button
          type="button"
          className="tip-hide"
          aria-label={t('tips.recording.hide')}
          data-tip={t('tips.recording.hide')}
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
    <section className="tip tip-card" aria-label={t('tips.card.title')}>
      <div className="tip-card-head">
        <span className="tip-title">{t('tips.card.title')}</span>
        <button type="button" className="tip-hide" aria-label={t('tips.card.hide')} data-tip={t('tips.card.hide')} onClick={() => show(null)}>
          <X aria-hidden="true" />
        </button>
      </div>
      <ul className="tip-list">
        <li data-done="">
          <Check aria-hidden="true" />
          <span className="tip-item">{t('tips.card.recorded', { count: after.steps })}</span>
        </li>
        <li data-done={tried || undefined}>
          {tried ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
          <span className="tip-item">{t('tips.card.tryIt')}</span>
          <button type="button" className="tip-action" disabled={status !== 'ready'} onClick={replay.toggle}>
            <Play aria-hidden="true" />
            {t('common.actions.replay')}
            {replayKey && <kbd className="kbd">{keycaps(replayKey)}</kbd>}
          </button>
        </li>
        <li data-done={shortcut || undefined}>
          {shortcut ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
          <span className="tip-item">{t('tips.card.runWithShortcut', { app: APP_NAME })}</span>
          <button type="button" className="tip-action" onClick={() => openMacroSettings(after.macro, 'hotkey')}>
            {shortcut ? t('tips.card.changeShortcut') : t('tips.card.addShortcut')}
          </button>
        </li>
      </ul>
    </section>
  );
}
