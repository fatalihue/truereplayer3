import { useEffect } from 'react';
import { useBridge } from '../../../bridge/BridgeContext';
import { isCropAnswer } from '../../../logic/useAutomations';
import { commit, imageAsks, triggerNow, type Cmds } from './automationsStore';

/**
 * The reference images the automations asked for (Capture, Recapture, a crop): each answer lands on
 * the automation it was asked for. A fresh capture may point at another place, so it takes the search
 * region with it; a crop of the same image keeps it. One change, one Ctrl+Z.
 */
export function useAutomationImages(cmds: Cmds) {
  const { subscribe } = useBridge();
  useEffect(() => subscribe((m) => {
    if (m.type !== 'automation:imageCaptured') return;
    const profile = imageAsks.get(m.payload.requestId);
    if (!profile) return;
    imageAsks.delete(m.payload.requestId);
    const now = triggerNow(profile);
    if (m.payload.cancelled || !m.payload.imagePath || !now) return;
    commit(profile, {
      ...now,
      imagePath: m.payload.imagePath,
      imageBase64: m.payload.imageBase64 ?? null,
      ...(isCropAnswer(m.payload.requestId) ? {} : { searchRegion: null }),
    }, cmds);
  }), [subscribe, cmds]);
}
