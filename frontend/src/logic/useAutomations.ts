import { useEffect, useMemo } from 'react';
import { useBridge } from '../bridge/BridgeContext';
import { useGetAppState } from '../state/AppStateContext';
import type { TriggerConfig } from '../bridge/messageTypes';

/**
 * The automation triggers (one per macro) and the daemon's master switch, as commands. The state
 * comes back as automation:state, into the store. The answers to testFire, captureImage and
 * cropReference come back on the bridge carrying the requestId these return, so a view can tell
 * its own answer from a late one.
 */
export function useAutomations() {
  const { send } = useBridge();
  const getState = useGetAppState();
  return useMemo(() => ({
    /** Asks for the daemon's state now (see useAutomationRefresh for a view that stays open). */
    request: () => send({ type: 'automation:request', payload: {} }),
    /**
     * Saves a macro's trigger config. Armed is NOT an editor field: the list toggle is the only
     * arming surface (setArmed persists at once), so the saved value is the one the daemon holds
     * now — sending the draft's would silently revert a toggle made after the draft was seeded.
     * imageBase64 is display-only (the PNG on disk is the source) and the backend never parses
     * it, so it travels as null instead of round-tripping a large blob on every save.
     */
    save: (profile: string, trigger: TriggerConfig) => {
      const armed = getState().automation.entries.find((e) => e.profile === profile)?.trigger.armed ?? false;
      send({ type: 'automation:save', payload: { profile, trigger: { ...trigger, imageBase64: null, armed } } });
    },
    /** Deletes a macro's automation. */
    remove: (profile: string) => send({ type: 'automation:save', payload: { profile, trigger: null } }),
    /** Arms or disarms one automation; it persists at once. */
    setArmed: (profile: string, armed: boolean) => send({ type: 'automation:setArmed', payload: { profile, armed } }),
    /** The daemon's master switch. */
    setEnabled: (enabled: boolean) => send({ type: 'automation:setEnabled', payload: { enabled } }),
    /** Zeroes the fire and skip counters. The next fire time is untouched: it anchors the interval. */
    resetCounters: (profile: string) => send({ type: 'automation:resetCounters', payload: { profile } }),
    /**
     * Fires the automation ONCE, now, through the real trigger path, so the answer covers the gates
     * too (busy, unsaved edits, dialog open). Answer: automation:testFireResult with this id.
     */
    testFire: (profile: string) => {
      const requestId = `autofire-${Date.now()}`;
      send({ type: 'automation:testFire', payload: { requestId, profile } });
      return requestId;
    },
    /** Captures a reference image on screen. Answer: automation:imageCaptured with this id. */
    captureImage: (profile: string) => {
      const requestId = `autoimg-${Date.now()}`;
      send({ type: 'automation:captureImage', payload: { requestId, profile } });
      return requestId;
    },
    /** Choose file…: a picture on disk as the reference image. Answer: automation:imageCaptured. */
    chooseImage: (profile: string) => {
      const requestId = `autofile-${Date.now()}`;
      send({ type: 'automation:chooseImage', payload: { requestId, profile } });
      return requestId;
    },
    /**
     * Crops the reference tighter (rect in image pixels). Answer: automation:imageCaptured, like a
     * capture — isCropAnswer tells the two apart.
     */
    cropReference: (profile: string, imagePath: string, rect: { x: number; y: number; w: number; h: number }) => {
      const requestId = `autocrop-${Date.now()}`;
      send({ type: 'automation:cropReference', payload: { requestId, profile, imagePath, ...rect } });
      return requestId;
    },
  }), [send, getState]);
}

/**
 * Whether an automation:imageCaptured answers a crop of the same image (which keeps its location
 * on screen) rather than a fresh capture (which may point at a different target).
 */
export const isCropAnswer = (requestId: string) => requestId.startsWith('autocrop-');

/**
 * Keeps automation:state fresh while a view is open: pushes are change-driven, so a quiet watcher's
 * next-fire countdown would go stale without a poll. 2 s is plenty.
 */
export function useAutomationRefresh() {
  const { send } = useBridge();
  useEffect(() => {
    send({ type: 'automation:request', payload: {} });
    const id = window.setInterval(() => send({ type: 'automation:request', payload: {} }), 2000);
    return () => window.clearInterval(id);
  }, [send]);
}
