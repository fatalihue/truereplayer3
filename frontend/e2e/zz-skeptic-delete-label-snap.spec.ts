import { test, expect } from '@playwright/test';

// TRACE skeptic run: does the row menu's Delete/Duplicate LABEL (and its (N)) disagree with
// what handleContextDelete / handleDuplicate actually send after snapSelectionToBlocks?

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

const mk = (types: string[]) =>
  types.map((t, i) => base({ id: 'r' + i, actionType: t, x: i * 10, y: i * 10, rowNumber: i + 1 }));

async function boot(page: import('@playwright/test').Page, types: string[]) {
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
  await post(page, { type: 'actions:updated', payload: { actions: mk(types) } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await expect(page.locator('tr[data-row-index="0"]')).toBeVisible();
}

const sent = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as any).__out as string[])
    .filter(s => s.includes('actions:delete') || s.includes('actions:duplicate')));

async function menuOf(page: import('@playwright/test').Page, row: number) {
  await page.locator(`tr[data-row-index="${row}"]`).click({ button: 'right' });
  const menu = page.locator('div.menu-surface').filter({ hasText: 'Duplicate' }).first();
  await expect(menu).toBeVisible();
  return menu;
}

const LIST = ['LeftClick', 'If', 'LeftClick', 'LeftClick', 'LeftClick', 'EndIf', 'LeftClick'];

test('(a) selection 3,4,5 + right-click 4 — label vs rows actually deleted', async ({ page }) => {
  await boot(page, LIST);

  await page.locator('tr[data-row-index="3"]').click();
  await page.locator('tr[data-row-index="5"]').click({ modifiers: ['Shift'] });
  const selected = await page.locator('tr[aria-selected="true"]').count();
  console.log('SELECTED ROWS (aria-selected):', selected);
  console.log('BULK BAR TEXT:', (await page.locator('body').innerText()).split('\n').filter(l => /selected/i.test(l)).join(' | '));

  const menu = await menuOf(page, 4);
  const del = menu.getByRole('button', { name: /^Delete/ });
  console.log('DELETE LABEL:', JSON.stringify((await del.innerText()).replace(/\s+/g, ' ').trim()));
  console.log('DELETE TOOLTIP:', JSON.stringify(await del.getAttribute('data-tip')));
  const dup = menu.getByRole('button', { name: /^Duplicate/ });
  console.log('DUPLICATE LABEL:', JSON.stringify((await dup.innerText()).replace(/\s+/g, ' ').trim()));

  await del.click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (a):', JSON.stringify(await sent(page)));
});

test('(b) no selection, right-click the EndIf — Delete and Duplicate', async ({ page }) => {
  await boot(page, LIST);
  await menuOf(page, 5);
  const del = page.getByRole('button', { name: /^Delete/ });
  console.log('ENDIF DELETE LABEL:', JSON.stringify((await del.innerText()).replace(/\s+/g, ' ').trim()));
  console.log('ENDIF DELETE TOOLTIP:', JSON.stringify(await del.getAttribute('data-tip')));
  const dup = page.getByRole('button', { name: /^Duplicate/ });
  console.log('ENDIF DUPLICATE LABEL:', JSON.stringify((await dup.innerText()).replace(/\s+/g, ' ').trim()));
  console.log('MENU ITEMS ON ENDIF:', JSON.stringify(await page.locator('div.menu-surface button').allTextContents()));
  await del.click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (b delete):', JSON.stringify(await sent(page)));
});

test('(b2) no selection, right-click the EndIf — Duplicate path', async ({ page }) => {
  await boot(page, LIST);
  await menuOf(page, 5);
  await page.getByRole('button', { name: /^Duplicate/ }).click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (b duplicate):', JSON.stringify(await sent(page)));
});

test('(b3) CONTROL — right-click the If opener', async ({ page }) => {
  await boot(page, LIST);
  await menuOf(page, 1);
  const del = page.getByRole('button', { name: /^Delete/ });
  console.log('IF DELETE LABEL:', JSON.stringify((await del.innerText()).replace(/\s+/g, ' ').trim()));
  console.log('IF DELETE TOOLTIP:', JSON.stringify(await del.getAttribute('data-tip')));
  await del.click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (b3):', JSON.stringify(await sent(page)));
});

test('(c) orphan EndLoop inside an If block', async ({ page }) => {
  await boot(page, ['If', 'EndLoop', 'LeftClick', 'EndIf']);
  await menuOf(page, 1);
  const del = page.getByRole('button', { name: /^Delete/ });
  console.log('ORPHAN ENDLOOP DELETE LABEL:', JSON.stringify((await del.innerText()).replace(/\s+/g, ' ').trim()));
  console.log('ORPHAN ENDLOOP DELETE TOOLTIP:', JSON.stringify(await del.getAttribute('data-tip')));
  console.log('MENU ITEMS:', JSON.stringify(await page.locator('div.menu-surface button').allTextContents()));
  await del.click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (c):', JSON.stringify(await sent(page)));
});

test('(d) no selection, right-click an Else', async ({ page }) => {
  await boot(page, ['LeftClick', 'If', 'LeftClick', 'Else', 'LeftClick', 'EndIf', 'LeftClick']);
  await menuOf(page, 3);
  const del = page.getByRole('button', { name: /^Delete/ });
  console.log('ELSE DELETE LABEL:', JSON.stringify((await del.innerText()).replace(/\s+/g, ' ').trim()));
  console.log('ELSE DELETE TOOLTIP:', JSON.stringify(await del.getAttribute('data-tip')));
  await del.click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (d):', JSON.stringify(await sent(page)));
});
