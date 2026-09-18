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
  copiedCount: 2, ...over,
});

const rows = () => [
  base({ id: 'a', actionType: 'LeftClick', x: 10, y: 10, rowNumber: 1 }),
  base({ id: 'b', actionType: 'LeftClick', x: 20, y: 20, rowNumber: 2 }),
  base({ id: 'c', actionType: 'LeftClick', x: 30, y: 30, rowNumber: 3 }),
  base({ id: 'd', actionType: 'LeftClick', x: 40, y: 40, rowNumber: 4 }),
];

async function openMenuThenStartRun(page: import('@playwright/test').Page) {
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
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });

  const row2 = page.locator('tr[data-row-index="2"]');
  await expect(row2).toBeVisible();
  await row2.click({ button: 'right' });

  const menu = page.locator('div.menu-surface').filter({ hasText: 'Duplicate' }).first();
  await expect(menu).toBeVisible();

  // A run starts with NO mousedown and NO Escape — the hotkey / tray / automation path.
  // Faithful to the real push order: a hotkey-launched replay pushes actions:updated BEFORE
  // the button states (SheetPanel's comment documents this), plus the per-step highlight.
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'actions:highlight', payload: { index: 1 } });
  await post(page, { type: 'button:states', payload: btnStates({ replayActive: true, replayButtonText: 'Stop' }) });
  await page.waitForTimeout(300);
  return { row2, menu };
}

const sent = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('actions:')));

test('menu survives the run start and Delete still fires', async ({ page }) => {
  const { row2, menu } = await openMenuThenStartRun(page);

  console.log('MENU STILL VISIBLE DURING RUN:', await menu.isVisible());
  console.log('MENU ITEMS DURING RUN:', JSON.stringify(await page.locator('div.menu-surface button').allTextContents()));
  console.log('DISABLED MENU ITEMS DURING RUN:', await page.locator('div.menu-surface button[disabled]').count());

  await page.getByRole('button', { name: /^Delete/ }).click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (delete):', JSON.stringify(await sent(page)));
  console.log('TOAST CONTAINS LOCKED:', (await page.locator('body').innerText()).includes('locked while a run'));

  // CONTROL: a FRESH right-click mid-run must be refused by handleRowContextMenu's gate.
  await row2.click({ button: 'right' });
  await page.waitForTimeout(200);
  console.log('MENU REOPENS MID-RUN (expected false):', await menu.isVisible());
});

test('Skip fires mid-run', async ({ page }) => {
  await openMenuThenStartRun(page);
  await page.getByRole('button', { name: /^Skip/ }).click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (skip):', JSON.stringify(await sent(page)));
});

test('Paste here fires mid-run', async ({ page }) => {
  await openMenuThenStartRun(page);
  await page.getByRole('button', { name: /^More/ }).hover();
  await page.getByRole('button', { name: /^Paste here/ }).click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (paste):', JSON.stringify(await sent(page)));
});

test('Change click type fires mid-run', async ({ page }) => {
  await openMenuThenStartRun(page);
  await page.getByRole('button', { name: /^Change click type/ }).hover();
  await page.waitForTimeout(200);
  const items = await page.locator('div.menu-surface button').allTextContents();
  console.log('CLICKTYPE SUBMENU:', JSON.stringify(items));
  await page.getByRole('button', { name: /Right Click/ }).first().click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (clicktype):', JSON.stringify(await sent(page)));
});
