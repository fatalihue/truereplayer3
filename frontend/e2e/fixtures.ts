import type { Page } from '@playwright/test';

// The engine's side of the bridge, played from the test: the Vite dev server has no WebView2, and
// BridgeProvider's DEV-only fallback takes window.postMessage in place of chrome.webview.
export function postToBridge(page: Page, message: unknown) {
  return page.evaluate((msg) => window.postMessage(msg, '*'), message);
}

// One step and one library entry, in the shapes the engine sends (taken from a recorded state:init).
const step = (n: number) => ({
  actionType: 'LeftClick', atCursor: false, browserText: '', comment: '', conditionNegate: false, conditionTimeout: 0,
  confidence: 0.8, daysOfWeek: 0, delay: 50, holdDurationMs: 0, id: `e2e${String(n).padStart(29, '0')}`, imageBase64: '',
  imagePath: '', isFocusClick: false, isInsertionPoint: false, isSkipped: false, key: '', loopMaxIterations: 0, newTab: false,
  pixelClickOnMatch: false, pixelInvert: false, pixelTolerance: 0, randomPercent: 0, repeatCount: 1, restorePosition: false,
  restoreSize: false, rowNumber: n, runOverData: false, shouldHighlight: false, timeout: 5000, typeAppend: false,
  typePaste: false, waitImageClickOnMatch: false, waitImageInvert: false, windowHeight: 0, windowMatchForegroundOnly: false,
  windowWidth: 0, windowX: 0, windowY: 0, x: 100 * n, y: 50 * n,
});

export const MACRO = 'First macro';

/** What the engine sends at launch, with one macro open and two steps in it. */
export function stateInit() {
  return {
    type: 'state:init',
    payload: {
      status: 'ready',
      activeProfile: MACRO,
      actions: [step(1), step(2)],
      profiles: [{
        actionCount: 2, appMinVersion: '2.0.0', bringToFocus: false, createdAt: '2026-10-31T12:00:00.0000000Z', description: '',
        effectiveTargetTitleMatchMode: 'contains', effectiveUseRelativeCoordinates: false, filePath: `C:\\e2e\\Profiles\\${MACRO}.json`,
        hasEffectiveTarget: false, hasTrigger: false, hasWindowTarget: false, hotkey: null, hotstring: null, hotkeyConflict: false,
        hotstringInstant: false, iconEmoji: '', isDisabled: false, name: MACRO, profileVersion: 3, restorePosition: false,
        restoreSize: false, tags: [], triggerArmed: false, triggerMode: 'onPress', updatedAt: '2026-10-31T12:00:00.0000000Z',
        useRelativeCoordinates: false, windowTargetTitleMatchMode: 'contains',
      }],
      profileOrder: { pinned: [], folders: [], ungroupedOrder: [MACRO] },
      buttonStates: {
        recordEnabled: true, replayEnabled: true, recordingActive: false, replayActive: false,
        recordButtonText: 'Record', replayButtonText: 'Replay', canUndo: false, canRedo: false, copiedCount: 0,
      },
      profileLoop: { count: '1', enabled: false, interval: '200', intervalEnabled: false, dirty: false, scoped: true },
    },
  };
}
