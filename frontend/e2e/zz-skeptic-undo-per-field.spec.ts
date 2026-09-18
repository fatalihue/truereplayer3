import { test, expect } from '@playwright/test';

// Stub WebView2 so outgoing messages are CAPTURED (the dev fallback only console.logs them,
// and Playwright renders object args as JSHandle@object).
async function installBridgeStub(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const handlers: Array<(e: { data: unknown }) => void> = [];
    (window as unknown as { __sent: unknown[] }).__sent = [];
    (window as unknown as { chrome: unknown }).chrome = {
      webview: {
        postMessage: (m: unknown) => { (window as unknown as { __sent: unknown[] }).__sent.push(m); },
        addEventListener: (_t: string, h: (e: { data: unknown }) => void) => { handlers.push(h); },
        removeEventListener: (_t: string, h: (e: { data: unknown }) => void) => {
          const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1);
        },
      },
    };
    (window as unknown as { __feed: (m: unknown) => void }).__feed = (m: unknown) => {
      handlers.forEach(h => h({ data: m }));
    };
  });
}

const feed = (page: import('@playwright/test').Page, msg: unknown) =>
  page.evaluate((m) => (window as unknown as { __feed: (x: unknown) => void }).__feed(m), msg);

const sent = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent as unknown[]);

const base = (over: Record<string, unknown>) => ({
  id: 'x', actionType: 'LeftClick', key: '', x: 0, y: 0, delay: 0, comment: '',
  rowNumber: 1, isInsertionPoint: false, shouldHighlight: false, imagePath: '',
  timeout: 5000, confidence: 0.8, imageBase64: '', browserText: '', newTab: false,
  isSkipped: false, atCursor: false, repeatCount: 1, repeatDelayMs: null,
  repeatDelayJitterPct: null, repeatPositionJitterPx: null, holdDurationMs: 0, ...over,
});

const btnStates = {
  recordEnabled: true, replayEnabled: true, recordingActive: false,
  replayActive: false, recordButtonText: 'Recording', replayButtonText: 'Replay',
  canUndo: false, canRedo: false, copiedCount: 0,
};

async function openSheetOnRow0(page: import('@playwright/test').Page, action: Record<string, unknown>) {
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await feed(page, { type: 'actions:updated', payload: { actions: [action] } });
  await feed(page, { type: 'button:states', payload: btnStates });
  await page.locator('tr[data-row-index="0"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await page.waitForTimeout(400);
}

async function setNum(page: import('@playwright/test').Page, aria: string, val: string) {
  const inp = page.getByLabel(aria, { exact: true }).first();
  await inp.click();
  await inp.press('ControlOrMeta+a');
  await inp.type(val);
  await inp.blur();
  await page.waitForTimeout(150);
}

test('Sheet Save: X + Y changed on a LeftClick row', async ({ page }) => {
  await installBridgeStub(page);
  await openSheetOnRow0(page, base({ id: 'a', actionType: 'LeftClick', x: 100, y: 200, rowNumber: 1 }));

  await page.evaluate(() => { (window as unknown as { __sent: unknown[] }).__sent.length = 0; });

  await setNum(page, 'X coordinate', '800');
  await setNum(page, 'Y coordinate', '900');

  await page.getByRole('button', { name: /^Save$/ }).last().click();
  await page.waitForTimeout(400);

  const out = await sent(page);
  console.log('[XY] total outgoing =', out.length);
  for (const m of out) console.log('[XY]  ->', JSON.stringify(m));
  const edits = out.filter((m) => (m as { type?: string }).type === 'actions:edit');
  console.log('[XY] actions:edit count =', edits.length);
});

test('Sheet Save: ActivateWindow with many fields changed', async ({ page }) => {
  await installBridgeStub(page);
  await openSheetOnRow0(page, base({
    id: 'a', actionType: 'ActivateWindow', rowNumber: 1,
    windowProcessName: '', windowTitle: '', launchPath: '', launchArgs: '',
    restorePosition: false, restoreSize: false,
    windowX: 0, windowY: 0, windowWidth: 0, windowHeight: 0, timeout: 5000,
  }));

  await page.evaluate(() => { (window as unknown as { __sent: unknown[] }).__sent.length = 0; });

  const inputs = page.locator('input[type="text"]');
  const n = await inputs.count();
  console.log('[AW] text inputs in sheet =', n);
  await inputs.nth(0).fill('notepad.exe');
  await inputs.nth(1).fill('Untitled');
  await page.getByRole('button', { name: /^Save$/ }).last().click();
  await page.waitForTimeout(400);

  const out = await sent(page);
  for (const m of out) console.log('[AW]  ->', JSON.stringify(m));
  console.log('[AW] actions:edit count =', out.filter((m) => (m as { type?: string }).type === 'actions:edit').length);
});
