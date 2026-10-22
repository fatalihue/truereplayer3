import { useEffect } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import type { EditorClaimOwner } from '../bridge/messageTypes';

// AutomationGuard expires a claim a fixed 10 minutes after it was STAMPED; one renewal a minute
// keeps a live editor well inside that.
const EDITOR_CLAIM_RENEW_MS = 60_000;

/**
 * Tells the backend that an editor holds typed work its own Save has not sent yet
 * (`editor:pendingEdits`, one stamp per owner in AutomationGuard). Three readers act on it: an
 * autonomous fire refuses instead of swapping the profile under the form, the update gate holds a
 * silent restart, and the window's close guard asks before discarding it.
 *
 * One hook for every owner, because the three copies it replaces had to agree on three things and
 * nothing made them: the TRANSITION (the flag changing), the UNMOUNT (not a value change, so the
 * first effect never fires for it) and the RENEWAL. The heartbeat renews off the flag, not off
 * recent keystrokes — see decision-nao-re-sugerir-2-39-0: an idle budget would lapse under the long
 * editor interactions that emit no input event (the cropper, Test match, the selector probe), and
 * what the claim costs while held is visible, while what it costs when it lapses is silent.
 */
export function useEditorClaim(owner: EditorClaimOwner, pending: boolean) {
  const { send } = useBridge();
  useEffect(() => {
    send({ type: 'editor:pendingEdits', payload: { pending, owner } });
  }, [pending, owner, send]);
  useEffect(() => () => {
    send({ type: 'editor:pendingEdits', payload: { pending: false, owner } });
  }, [owner, send]);
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => {
      send({ type: 'editor:pendingEdits', payload: { pending: true, owner } });
    }, EDITOR_CLAIM_RENEW_MS);
    return () => clearInterval(id);
  }, [pending, owner, send]);
}
