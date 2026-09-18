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
const btnStates = (over: Record<string, unknown>) => ({
  recordEnabled: true, replayEnabled: true, recordingActive: false, replayActive: false,
  recordButtonText: 'Recording', replayButtonText: 'Replay', canUndo: false, canRedo: false,
  copiedCount: 0, ...over,
});
async function boot(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    (window as any).__out = [];
    const orig = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('→ C#')) {
        try { (window as any).__out.push(JSON.stringify({ t: args[1], p: args[2] })); } catch { /* ignore */ }
      }
      orig(...args);
    };
  });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
}

test('open + Save, nothing typed: what reaches the profile', async ({ page }) => {
  await boot(page);
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'a', actionType: 'LeftClickHold', holdDurationMs: 0, x: 10, y: 10, rowNumber: 1 }),
    base({ id: 'b', actionType: 'LeftClickHold', holdDurationMs: 1000, x: 20, y: 20, rowNumber: 2 }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  console.log('SAVE BUTTONS WITH NO PANEL:', await page.getByRole('button', { name: /^Save$/ }).count());

  // Row 0 = the converted row (duration 0).
  await page.locator('tr[data-row-index="0"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await page.waitForTimeout(400);
  console.log('SAVE BUTTONS WITH PANEL OPEN:', await page.getByRole('button', { name: /^Save$/ }).count());

  await page.evaluate(() => { (window as any).__out = []; });
  await page.getByRole('button', { name: /^Save$/ }).last().click();
  await page.waitForTimeout(250);
  const out = await page.evaluate(() => (window as any).__out as string[]);
  console.log('ROW0 (dur 0) SAVE WIRE:', JSON.stringify(out));

  // Now the control row 1 (duration 1000) — same untouched open + Save.
  await page.waitForTimeout(300);
  await page.locator('tr[data-row-index="1"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await page.waitForTimeout(400);
  await page.evaluate(() => { (window as any).__out = []; });
  await page.getByRole('button', { name: /^Save$/ }).last().click();
  await page.waitForTimeout(250);
  const out2 = await page.evaluate(() => (window as any).__out as string[]);
  console.log('ROW1 (dur 1000) SAVE WIRE:', JSON.stringify(out2));
});

test('tryLeave: clicking another row while the untouched hold panel is open', async ({ page }) => {
  await boot(page);
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'a', actionType: 'LeftClickHold', holdDurationMs: 0, x: 10, y: 10, rowNumber: 1 }),
    base({ id: 'b', actionType: 'LeftClick', x: 20, y: 20, rowNumber: 2 }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates({}) });

  await page.locator('tr[data-row-index="0"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await page.waitForTimeout(400);

  // Ask for the OTHER row's editor.
  await page.locator('tr[data-row-index="1"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await page.waitForTimeout(350);
  const t = await page.locator('body').innerText();
  console.log('AFTER SWITCH ATTEMPT armed_switch:', t.includes('Click again to discard'));
  // Which row is the panel showing? The hold editor only exists for a hold row.
  console.log('HOLD EDITOR STILL SHOWN:', t.includes('Hold') );
  const toast1 = t.includes('Changes discarded');
  console.log('TOAST AFTER 1ST:', toast1);

  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await page.waitForTimeout(350);
  const t2 = await page.locator('body').innerText();
  console.log('TOAST AFTER 2ND:', t2.includes('Changes discarded'));
});
