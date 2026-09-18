import { test, expect } from '@playwright/test';

// Capture OUTGOING bridge messages in order by stubbing window.chrome.webview before the
// app boots (BridgeContext prefers it over the dev window.postMessage fallback, so we also
// forward window 'message' events into its listener set to keep the seeding helper working).
const initScript = () => {
  (window as unknown as { __sent: unknown[] }).__sent = [];
  const listeners = new Set<(e: { data: unknown }) => void>();
  const w = window as unknown as { chrome?: Record<string, unknown> };
  w.chrome = w.chrome || {};
  (w.chrome as Record<string, unknown>).webview = {
    postMessage: (m: unknown) => {
      (window as unknown as { __sent: unknown[] }).__sent.push(JSON.parse(JSON.stringify(m)));
    },
    addEventListener: (_t: string, h: (e: { data: unknown }) => void) => { listeners.add(h); },
    removeEventListener: (_t: string, h: (e: { data: unknown }) => void) => { listeners.delete(h); },
  };
  window.addEventListener('message', (e: MessageEvent) => {
    listeners.forEach((h) => h({ data: e.data }));
  });
};

function post(page: import('@playwright/test').Page, msg: unknown) {
  return page.evaluate((m) => window.postMessage(m, '*'), msg);
}

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

async function openSheetOnPair(page: import('@playwright/test').Page) {
  await page.addInitScript(initScript);
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'a', actionType: 'LeftClickDown', x: 400, y: 300, rowNumber: 1 }),
    base({ id: 'b', actionType: 'LeftClickUp', x: 400, y: 300, rowNumber: 2 }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await page.locator('tr[data-row-index="0"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await page.waitForTimeout(400);
}

test('Sheet: change BUTTON + merge to One row in the SAME Save', async ({ page }) => {
  await openSheetOnPair(page);

  const buttonAxis = page.getByRole('tablist', { name: 'Mouse button' });
  const formAxis = page.getByRole('tablist', { name: 'Click form' });

  console.log('[REACH] button axis visible =', await buttonAxis.isVisible());
  console.log('[REACH] form axis visible   =', await formAxis.isVisible());
  console.log('[REACH] button axis pointer-events =',
    await buttonAxis.evaluate((e) => getComputedStyle(e).pointerEvents));
  console.log('[REACH] kind axis pointer-events   =',
    await page.getByRole('tablist', { name: 'Click kind' }).evaluate((e) => getComputedStyle(e).pointerEvents));
  console.log('[REACH] button active BEFORE =',
    await buttonAxis.getByRole('tab', { selected: true }).innerText());
  console.log('[REACH] form active BEFORE   =',
    await formAxis.getByRole('tab', { selected: true }).innerText());

  await buttonAxis.getByRole('tab', { name: 'Right' }).click();
  await formAxis.getByRole('tab', { name: 'One row' }).click();
  await page.waitForTimeout(200);

  console.log('[REACH] button active AFTER =',
    await buttonAxis.getByRole('tab', { selected: true }).innerText());
  console.log('[REACH] form active AFTER   =',
    await formAxis.getByRole('tab', { selected: true }).innerText());
  console.log('[REACH] header title =',
    await page.locator('div.font-display.truncate').first().innerText());

  const saveBtn = page.getByRole('button', { name: /^Save$/ }).last();
  console.log('[REACH] Save disabled =', await saveBtn.isDisabled());

  await page.evaluate(() => { (window as unknown as { __sent: unknown[] }).__sent = []; });
  await saveBtn.click();
  await page.waitForTimeout(400);

  const sent = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent);
  console.log('[SENT] ' + JSON.stringify(sent, null, 1));
  console.log('[SENT] panel closed =', (await page.getByRole('button', { name: /^Save$/ }).count()) === 1);
});

test('control: button UNCHANGED + merge to One row (the intended path)', async ({ page }) => {
  await openSheetOnPair(page);
  const formAxis = page.getByRole('tablist', { name: 'Click form' });
  await formAxis.getByRole('tab', { name: 'One row' }).click();
  await page.waitForTimeout(200);
  await page.evaluate(() => { (window as unknown as { __sent: unknown[] }).__sent = []; });
  await page.getByRole('button', { name: /^Save$/ }).last().click();
  await page.waitForTimeout(400);
  const sent = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent);
  console.log('[CONTROL SENT] ' + JSON.stringify(sent, null, 1));
});
