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

// 0 LeftClickDown(100,100) · 1 LeftClickUp(100,100) · 2 LeftClickDown(300,300) · 3 LeftClickUp(300,300)
const profile = () => [
  base({ id: 'p0', actionType: 'LeftClickDown', x: 100, y: 100, rowNumber: 1 }),
  base({ id: 'p1', actionType: 'LeftClickUp', x: 100, y: 100, rowNumber: 2 }),
  base({ id: 'p2', actionType: 'LeftClickDown', x: 300, y: 300, rowNumber: 3 }),
  base({ id: 'p3', actionType: 'LeftClickUp', x: 300, y: 300, rowNumber: 4 }),
];

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
  await post(page, { type: 'actions:updated', payload: { actions: profile() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await expect(page.locator('tr[data-row-index="3"]')).toBeVisible();
}

const selectedRows = (page: import('@playwright/test').Page) =>
  page.$$eval('tr[aria-selected="true"]', els => els.map(e => e.getAttribute('data-row-index')));

async function openMergeAndCapture(page: import('@playwright/test').Page, rowIdx: number) {
  const row = page.locator(`tr[data-row-index="${rowIdx}"]`);
  await row.click({ button: 'right', position: { x: 220, y: 10 } });
  const parent = page.getByRole('button', { name: /^Change click type/ });
  console.log('MENU ENTRY LABEL:', (await parent.innerText()).replace(/\s+/g, ' '));
  await parent.hover();
  await page.waitForTimeout(200);
  console.log('SUBMENU ITEMS:', JSON.stringify(await page.locator('div.menu-surface button').allTextContents()));
  await page.evaluate(() => { (window as any).__out = []; });
  const merge = page.getByRole('button', { name: /^Merge Down \+ Up/ });
  console.log('MERGE VISIBLE:', await merge.isVisible(), 'DISABLED:', await merge.isDisabled());
  await merge.click();
  await page.waitForTimeout(200);
  const out = await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('convertMode')));
  console.log('BRIDGE OUT:', JSON.stringify(out));
  return out;
}

test('ctrl-select the two Down halves, right-click one, Merge Down + Up', async ({ page }) => {
  await boot(page);
  await page.locator('tr[data-row-index="0"]').click({ position: { x: 220, y: 10 } });
  await page.locator('tr[data-row-index="2"]').click({ position: { x: 220, y: 10 }, modifiers: ['Control'] });
  await page.waitForTimeout(150);
  console.log('SELECTED:', JSON.stringify(await selectedRows(page)));
  const out = await openMergeAndCapture(page, 0);
  console.log('RESULT-A', JSON.stringify(out));
});

test('select ALL FOUR rows, right-click the first Down half, Merge Down + Up', async ({ page }) => {
  await boot(page);
  await page.locator('tr[data-row-index="0"]').click({ position: { x: 220, y: 10 } });
  await page.locator('tr[data-row-index="3"]').click({ position: { x: 220, y: 10 }, modifiers: ['Shift'] });
  await page.waitForTimeout(150);
  console.log('SELECTED:', JSON.stringify(await selectedRows(page)));
  const out = await openMergeAndCapture(page, 0);
  console.log('RESULT-B', JSON.stringify(out));
});

test('control: no multi-selection at all, right-click the Down half', async ({ page }) => {
  await boot(page);
  console.log('SELECTED:', JSON.stringify(await selectedRows(page)));
  const out = await openMergeAndCapture(page, 0);
  console.log('RESULT-C', JSON.stringify(out));
});

test('select the pair the message asks for (Down + its Up), right-click the Down', async ({ page }) => {
  await boot(page);
  await page.locator('tr[data-row-index="0"]').click({ position: { x: 220, y: 10 } });
  await page.locator('tr[data-row-index="1"]').click({ position: { x: 220, y: 10 }, modifiers: ['Control'] });
  await page.waitForTimeout(150);
  console.log('SELECTED:', JSON.stringify(await selectedRows(page)));
  const out = await openMergeAndCapture(page, 0);
  console.log('RESULT-D', JSON.stringify(out));
});
