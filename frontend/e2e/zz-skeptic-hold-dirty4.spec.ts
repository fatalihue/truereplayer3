import { test, expect } from '@playwright/test';
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
const btnStates = { recordEnabled: true, replayEnabled: true, recordingActive: false,
  replayActive: false, recordButtonText: 'Recording', replayButtonText: 'Replay',
  canUndo: false, canRedo: false, copiedCount: 0 };

async function run(page: import('@playwright/test').Page, dur: number, label: string) {
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'a', actionType: 'LeftClickHold', holdDurationMs: dur, x: 10, y: 10, rowNumber: 1 }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await page.locator('tr[data-row-index="0"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await page.waitForTimeout(500);

  // The footer's dirty span is the one right before the Cancel/Discard button.
  const footerSpan = page.locator('div.flex.items-center.justify-between span.truncate').last();
  console.log(`[${label}] untouched text="${(await footerSpan.innerText()).trim()}" opacity=${await footerSpan.evaluate(e => getComputedStyle(e).opacity)}`);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const open1 = await page.getByRole('button', { name: /^Save$/ }).count();
  console.log(`[${label}] after 1st Esc: panelOpen=${open1 === 2} footer="${open1 === 2 ? (await footerSpan.innerText()).trim() : 'n/a'}"`);

  if (open1 === 2) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(900);
    const body = await page.locator('body').innerText();
    console.log(`[${label}] after 2nd Esc: panelOpen=${(await page.getByRole('button', { name: /^Save$/ }).count()) === 2} toastEN=${body.includes('Changes discarded')} toastPT=${body.includes('Alterações descartadas')}`);
  }
}

test('hold row with duration 0 — untouched', async ({ page }) => { await run(page, 0, 'DUR_0'); });
test('hold row with duration 1000 — untouched (control)', async ({ page }) => { await run(page, 1000, 'DUR_1000'); });
