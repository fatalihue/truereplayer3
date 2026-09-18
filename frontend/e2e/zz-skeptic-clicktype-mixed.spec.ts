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

// Rows 0 = LeftClick, 1 = RightClick. Same form (''), both coordinate clicks.
async function seed(page: import('@playwright/test').Page) {
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'a', actionType: 'LeftClick',  x: 10, y: 10, rowNumber: 1 }),
    base({ id: 'b', actionType: 'RightClick', x: 20, y: 20, rowNumber: 2 }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await expect(page.locator('tr[data-row-index="0"]')).toBeVisible();
}

async function selectBoth(page: import('@playwright/test').Page) {
  await page.locator('tr[data-row-index="0"]').click();
  await page.locator('tr[data-row-index="1"]').click({ modifiers: ['Control'] });
  await page.waitForTimeout(120);
}

test('MIXED selection, chip == clicked row type: does anything go on the wire?', async ({ page }) => {
  await boot(page);
  await seed(page);
  await selectBoth(page);

  // Right-click the LeftClick row, INSIDE the selection.
  await page.locator('tr[data-row-index="0"]').click({ button: 'right' });
  const parent = page.getByRole('button', { name: /Change click type/ });
  await expect(parent).toBeVisible();
  console.log('PARENT LABEL:', JSON.stringify(await parent.innerText()));

  await parent.hover();
  const leftChip = page.getByRole('button', { name: /^Left Click/ });
  await expect(leftChip).toBeVisible();
  // Does the chip claim "the selection is already this"?
  const hasCheck = await leftChip.locator('svg.text-accent-light, .text-accent-light').count();
  console.log('LEFT CHIP CHECKMARK:', hasCheck);

  await leftChip.click();
  await page.waitForTimeout(250);

  const out = await page.evaluate(() => (window as any).__out as string[]);
  console.log('WIRE AFTER CLICK:', JSON.stringify(out.filter(s => s.includes('bulk') || s.includes('convert') || s.includes('actions:'))));
  const body = await page.locator('body').innerText();
  console.log('MENU STILL OPEN:', await page.getByRole('button', { name: /Change click type/ }).count());
  console.log('ANY TOAST TEXT:', JSON.stringify(body.split('\n').filter(l => /cannot|Cannot|already|Changed|action\(s\)/.test(l))));
  console.log('ROW 1 STILL SAYS:', JSON.stringify(await page.locator('tr[data-row-index="1"]').innerText()));
});

test('CONTROL: same selection, chip != clicked row type -> sends both indices', async ({ page }) => {
  await boot(page);
  await seed(page);
  await selectBoth(page);
  await page.locator('tr[data-row-index="0"]').click({ button: 'right' });
  await page.getByRole('button', { name: /Change click type/ }).hover();
  const rightChip = page.getByRole('button', { name: /^Right Click/ });
  await expect(rightChip).toBeVisible();
  const hasCheck = await rightChip.locator('.text-accent-light').count();
  console.log('RIGHT CHIP CHECKMARK:', hasCheck);
  await rightChip.click();
  await page.waitForTimeout(250);
  const out = await page.evaluate(() => (window as any).__out as string[]);
  console.log('CONTROL WIRE:', JSON.stringify(out.filter(s => s.includes('bulkUpdateType'))));
});

test('CONTROL 2: right-click the RightClick row instead, pick Left Click', async ({ page }) => {
  await boot(page);
  await seed(page);
  await selectBoth(page);
  await page.locator('tr[data-row-index="1"]').click({ button: 'right' });
  await page.getByRole('button', { name: /Change click type/ }).hover();
  const leftChip = page.getByRole('button', { name: /^Left Click/ });
  await expect(leftChip).toBeVisible();
  console.log('LEFT CHIP CHECK (clicked row = RightClick):', await leftChip.locator('.text-accent-light').count());
  await leftChip.click();
  await page.waitForTimeout(250);
  const out = await page.evaluate(() => (window as any).__out as string[]);
  console.log('CONTROL2 WIRE:', JSON.stringify(out.filter(s => s.includes('bulkUpdateType'))));
});
