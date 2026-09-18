import { test, expect } from '@playwright/test';

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

// Five plain LeftClicks; the MIDDLE one (index 2) carries whatever the scenario refuses on.
const profile = (middle: Record<string, unknown>) => [
  base({ id: 'p0', actionType: 'LeftClick', x: 10, y: 10, rowNumber: 1 }),
  base({ id: 'p1', actionType: 'LeftClick', x: 11, y: 11, rowNumber: 2 }),
  base({ id: 'p2', actionType: 'LeftClick', x: 12, y: 12, rowNumber: 3, ...middle }),
  base({ id: 'p3', actionType: 'LeftClick', x: 13, y: 13, rowNumber: 4 }),
  base({ id: 'p4', actionType: 'LeftClick', x: 14, y: 14, rowNumber: 5 }),
];

async function boot(page: import('@playwright/test').Page, middle: Record<string, unknown>) {
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
  await post(page, { type: 'actions:updated', payload: { actions: profile(middle) } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await expect(page.locator('tr[data-row-index="4"]')).toBeVisible();
}

const selectedRows = (page: import('@playwright/test').Page) =>
  page.$$eval('tr[aria-selected="true"]', els => els.map(e => e.getAttribute('data-row-index')));

async function splitAndCapture(page: import('@playwright/test').Page, rowIdx: number) {
  const row = page.locator(`tr[data-row-index="${rowIdx}"]`);
  await row.click({ button: 'right', position: { x: 220, y: 10 } });
  const parent = page.getByRole('button', { name: /^Change click type/ });
  console.log('MENU ENTRY LABEL:', (await parent.innerText()).replace(/\s+/g, ' '));
  await parent.hover();
  await page.waitForTimeout(200);
  await page.evaluate(() => { (window as any).__out = []; });
  const split = page.getByRole('button', { name: /^Split into Down \+ Up/ });
  console.log('SPLIT VISIBLE:', await split.isVisible(), 'DISABLED:', await split.isDisabled());
  await split.click();
  await page.waitForTimeout(200);
  const out = await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('convertMode')));
  console.log('BRIDGE OUT:', JSON.stringify(out));
  return out;
}

test('A: at-cursor row in the MIDDLE of a contiguous 5-row selection reaches the bridge', async ({ page }) => {
  await boot(page, { atCursor: true });
  // The grid really read the flag: the at-cursor row hides its coordinates.
  const cells = await page.locator('tr[data-row-index="2"] td').allTextContents();
  console.log('AT-CURSOR ROW CELLS:', JSON.stringify(cells));
  await page.locator('tr[data-row-index="0"]').click({ position: { x: 220, y: 10 } });
  await page.locator('tr[data-row-index="4"]').click({ position: { x: 220, y: 10 }, modifiers: ['Shift'] });
  await page.waitForTimeout(150);
  console.log('SELECTED:', JSON.stringify(await selectedRows(page)));
  const out = await splitAndCapture(page, 0);
  console.log('RESULT-A', JSON.stringify(out));
  expect(out.join()).toContain('"indices":[0,1,2,3,4]');
});

test('B: x N row in the middle', async ({ page }) => {
  await boot(page, { repeatCount: 5 });
  await page.locator('tr[data-row-index="0"]').click({ position: { x: 220, y: 10 } });
  await page.locator('tr[data-row-index="4"]').click({ position: { x: 220, y: 10 }, modifiers: ['Shift'] });
  await page.waitForTimeout(150);
  console.log('SELECTED:', JSON.stringify(await selectedRows(page)));
  const out = await splitAndCapture(page, 0);
  console.log('RESULT-B', JSON.stringify(out));
});

test('C: DoubleClick row in the middle', async ({ page }) => {
  await boot(page, { actionType: 'DoubleClick' });
  await page.locator('tr[data-row-index="0"]').click({ position: { x: 220, y: 10 } });
  await page.locator('tr[data-row-index="4"]').click({ position: { x: 220, y: 10 }, modifiers: ['Shift'] });
  await page.waitForTimeout(150);
  console.log('SELECTED:', JSON.stringify(await selectedRows(page)));
  const out = await splitAndCapture(page, 0);
  console.log('RESULT-C', JSON.stringify(out));
});

test('D control: only the at-cursor row selected (whole run refuses)', async ({ page }) => {
  await boot(page, { atCursor: true });
  await page.locator('tr[data-row-index="2"]').click({ position: { x: 220, y: 10 } });
  await page.waitForTimeout(150);
  console.log('SELECTED:', JSON.stringify(await selectedRows(page)));
  const out = await splitAndCapture(page, 2);
  console.log('RESULT-D', JSON.stringify(out));
});

test('E: non-contiguous ctrl-selection {0,2,4} with at-cursor at 2', async ({ page }) => {
  await boot(page, { atCursor: true });
  await page.locator('tr[data-row-index="0"]').click({ position: { x: 220, y: 10 } });
  await page.locator('tr[data-row-index="2"]').click({ position: { x: 220, y: 10 }, modifiers: ['Control'] });
  await page.locator('tr[data-row-index="4"]').click({ position: { x: 220, y: 10 }, modifiers: ['Control'] });
  await page.waitForTimeout(150);
  console.log('SELECTED:', JSON.stringify(await selectedRows(page)));
  const out = await splitAndCapture(page, 0);
  console.log('RESULT-E', JSON.stringify(out));
});
