import { test, expect } from '@playwright/test';

// Does the row menu really offer Split on a short *ClickHold, and Merge on the halves it
// produces? The C# side (ActionModeConverter, probed against the published DLL) turns that
// pair back into a plain LeftClick whenever the dwell is under 200 ms. This spec proves the
// two menu clicks that feed it are reachable and carry the indices the bridge acts on.

function post(page: import('@playwright/test').Page, msg: unknown) {
  return page.evaluate((m) => window.postMessage(m, '*'), msg);
}

const base = (over: Record<string, unknown>) => ({
  id: 'x', actionType: 'LeftClick', key: '', x: 0, y: 0, delay: 0, comment: '',
  rowNumber: 1, isInsertionPoint: false, shouldHighlight: false, imagePath: '',
  timeout: 5000, confidence: 0.8, imageBase64: '', browserText: '', newTab: false,
  isSkipped: false, ...over,
});

const btnStates = (over: Record<string, unknown>) => ({
  recordEnabled: true, replayEnabled: true, recordingActive: false, replayActive: false,
  recordButtonText: 'Recording', replayButtonText: 'Replay', canUndo: false, canRedo: false,
  copiedCount: 0, ...over,
});

// One hold row, 100 ms — the FIRST chip of DURATION_PRESETS in the Insert Click dialog.
const withHold = () => [
  base({ id: 'h0', actionType: 'LeftClickHold', x: 400, y: 300, delay: 50, holdDurationMs: 100, rowNumber: 1 }),
];

// Exactly what ActionModeConverter.ToPaired returned for that row when invoked on the
// published DLL: the dwell rides on the Up's delay.
const afterSplit = () => [
  base({ id: 'h0', actionType: 'LeftClickDown', x: 400, y: 300, delay: 50, rowNumber: 1 }),
  base({ id: 'h1', actionType: 'LeftClickUp', x: 400, y: 300, delay: 100, rowNumber: 2 }),
];

test('a 100 ms hold can be split and re-merged from the row menu', async ({ page }) => {
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
  await post(page, { type: 'actions:updated', payload: { actions: withHold() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });

  const hold = page.locator('tr[data-row-index="0"]');
  await expect(hold).toBeVisible();
  console.log('ROW TEXT:', (await hold.innerText()).replace(/\s+/g, ' '));

  // Right-click the hold row → Change click type ▸ Split into Down + Up
  await hold.click({ button: 'right', position: { x: 220, y: 10 } });
  await page.getByRole('button', { name: /^Change click type/ }).hover();
  await page.waitForTimeout(150);
  console.log('SUBMENU ON HOLD:', JSON.stringify(await page.locator('div.menu-surface button').allTextContents()));
  await page.getByRole('button', { name: /^Split into Down \+ Up/ }).click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (split):', JSON.stringify(
    await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('convertMode')))));

  // Backend answers with the two halves.
  await post(page, { type: 'actions:updated', payload: { actions: afterSplit() } });
  await page.waitForTimeout(200);

  const down = page.locator('tr[data-row-index="0"]');
  await expect(down).toBeVisible();
  console.log('DOWN ROW:', (await down.innerText()).replace(/\s+/g, ' '));
  console.log('UP ROW:', (await page.locator('tr[data-row-index="1"]').innerText()).replace(/\s+/g, ' '));

  await down.click({ position: { x: 220, y: 10 } });
  await down.click({ button: 'right', position: { x: 220, y: 10 } });
  await page.getByRole('button', { name: /^Change click type/ }).hover();
  await page.waitForTimeout(150);
  console.log('SUBMENU ON DOWN:', JSON.stringify(await page.locator('div.menu-surface button').allTextContents()));
  await page.getByRole('button', { name: /^Merge Down \+ Up/ }).click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (merge):', JSON.stringify(
    await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('convertMode')))));
});
