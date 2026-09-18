import { test, expect } from '@playwright/test';

test.describe.configure({ timeout: 180_000 });

function post(page: import('@playwright/test').Page, msg: unknown) {
  return page.evaluate((m) => window.postMessage(m, '*'), msg);
}
const base = (o: Record<string, unknown>) => ({
  id: 'x', actionType: 'LeftClick', key: '', x: 0, y: 0, delay: 0, comment: '',
  rowNumber: 1, isInsertionPoint: false, shouldHighlight: false, imagePath: '',
  timeout: 5000, confidence: 0.8, imageBase64: '', browserText: '', newTab: false,
  isSkipped: false, ...o,
});
const btnStates = (o: Record<string, unknown>) => ({
  recordEnabled: true, replayEnabled: true, recordingActive: false, replayActive: false,
  recordButtonText: 'Recording', replayButtonText: 'Replay', canUndo: false, canRedo: false,
  copiedCount: 0, ...o,
});
const rows = () => Array.from({ length: 6 }, (_, i) => base({ id: 'r' + i, rowNumber: i + 1 }));
const rowTips = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | null;
    return row ? Array.from(row.querySelectorAll(':scope > button, :scope > div > button')).map(b => b.getAttribute('data-tip')) : [];
  });
const has = (t: (string | null)[], en: string, pt: string) => t.includes(en) || t.includes(pt);

// CONTROL first: with NO cmd:clearactions, one Escape closes the Pause dialog.
// Then the same gesture AFTER cmd:clearactions has set a flag whose popover cannot render.
test('does the unrenderable Clear All popover eat an Escape?', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 780 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(400);

  // Narrow until Clear All has left the row and settle there.
  let narrow = -1;
  for (let w = 900; w >= 560; w -= 4) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(110);
    if (!has(await rowTips(page), 'Clear All', 'Limpar tudo')) { narrow = w; break; }
  }
  expect(narrow).toBeGreaterThan(0);
  await page.waitForTimeout(700);
  console.log('settled narrow width =', narrow, 'row:', JSON.stringify((await rowTips(page)).slice(-4)));

  const dialogs = page.locator('[role="dialog"]');

  // ---- CONTROL ----
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cmd:pause')));
  await page.waitForTimeout(400);
  console.log('CONTROL: dialog open =', await dialogs.count());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  console.log('CONTROL: after 1st Escape, dialog count =', await dialogs.count());
  if (await dialogs.count() > 0) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }

  // ---- WITH the stuck flag ----
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cmd:clearactions')));
  await page.waitForTimeout(350);
  const confirm = page.getByText(/Clear all \d+ actions?\?/);
  console.log('after cmd:clearactions -> confirm popovers rendered =', await confirm.count());

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cmd:pause')));
  await page.waitForTimeout(400);
  console.log('STUCK: dialog open =', await dialogs.count());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  console.log('STUCK: after 1st Escape, dialog count =', await dialogs.count(), '  <-- 1 means the Escape was EATEN');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  console.log('STUCK: after 2nd Escape, dialog count =', await dialogs.count());
});
