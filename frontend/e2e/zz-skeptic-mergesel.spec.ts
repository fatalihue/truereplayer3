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

// 0 top filler · 1 LeftClickDown · 2 LeftClickUp (same point) · 3 SendText SECRET · 4 tail filler
const before = () => [
  base({ id: 'r0', actionType: 'LeftClick', x: 5, y: 5, rowNumber: 1 }),
  base({ id: 'r1', actionType: 'LeftClickDown', x: 50, y: 50, rowNumber: 2 }),
  base({ id: 'r2', actionType: 'LeftClickUp', x: 50, y: 50, rowNumber: 3 }),
  base({ id: 'r3', actionType: 'SendText', browserText: 'SECRET', comment: 'SECRET', rowNumber: 4 }),
  base({ id: 'r4', actionType: 'LeftClick', x: 90, y: 90, rowNumber: 5 }),
];

// Exactly what ActionModeConverter.ToCombined returns for that pair: one row shorter.
const after = () => [
  base({ id: 'r0', actionType: 'LeftClick', x: 5, y: 5, rowNumber: 1 }),
  base({ id: 'r1', actionType: 'LeftClick', x: 50, y: 50, rowNumber: 2 }),
  base({ id: 'r3', actionType: 'SendText', browserText: 'SECRET', comment: 'SECRET', rowNumber: 3 }),
  base({ id: 'r4', actionType: 'LeftClick', x: 90, y: 90, rowNumber: 4 }),
];

const selectedRows = (page: import('@playwright/test').Page) =>
  page.$$eval('tr[aria-selected="true"]', els => els.map(e => e.getAttribute('data-row-index')));

test('merge from the row menu leaves the selection on rows nobody picked', async ({ page }) => {
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
  await post(page, { type: 'actions:updated', payload: { actions: before() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });

  const down = page.locator('tr[data-row-index="1"]');
  const up = page.locator('tr[data-row-index="2"]');
  await expect(down).toBeVisible();

  // The natural way to pick a pair: click the Down half, ctrl-click the Up half.
  await down.click({ position: { x: 220, y: 10 } });
  await up.click({ position: { x: 220, y: 10 }, modifiers: ['Control'] });
  await page.waitForTimeout(150);
  console.log('SELECTED BEFORE:', JSON.stringify(await selectedRows(page)));
  console.log('BULK BAR BEFORE:', await page.locator('body').innerText().then(t => (t.match(/\d+ selected/) ?? ['<none>'])[0]));

  // Right-click the Down half → Change click type ▸ Merge Down + Up
  await down.click({ button: 'right', position: { x: 220, y: 10 } });
  await page.getByRole('button', { name: /^Change click type/ }).hover();
  await page.waitForTimeout(150);
  console.log('SUBMENU:', JSON.stringify(await page.locator('div.menu-surface button').allTextContents()));
  await page.getByRole('button', { name: /^Merge Down \+ Up/ }).click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (merge):', JSON.stringify(
    await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('convertMode')))));

  // Backend answers: the merged list, one row shorter.
  await post(page, { type: 'actions:updated', payload: { actions: after() } });
  await page.waitForTimeout(250);

  console.log('SELECTED AFTER:', JSON.stringify(await selectedRows(page)));
  console.log('BULK BAR AFTER:', await page.locator('body').innerText().then(t => (t.match(/\d+ selected/) ?? ['<none>'])[0]));
  console.log('ROW TYPES AFTER:', JSON.stringify(
    await page.$$eval('tr[data-row-index]', els => els.map(e => (e.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60)))));

  // What a Delete from the bulk bar would now take.
  await page.evaluate(() => { (window as any).__out = []; });
  await page.getByRole('button', { name: /^Delete/ }).first().click();
  await page.waitForTimeout(200);
  console.log('BRIDGE OUT (bulk delete):', JSON.stringify(
    await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('actions:delete')))));
});

// Split, the advertised multi-row form: pick two whole clicks, "Change click type (2) ▸ Split".
test('split of a multi-row selection drags the highlight onto untouched rows', async ({ page }) => {
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

  const pre = [
    base({ id: 's0', actionType: 'SendText', comment: 'header', rowNumber: 1 }),
    base({ id: 's1', actionType: 'LeftClick', x: 11, y: 11, rowNumber: 2 }),   // selected
    base({ id: 's2', actionType: 'SendText', comment: 'SECRET', rowNumber: 3 }),
    base({ id: 's3', actionType: 'LeftClick', x: 33, y: 33, rowNumber: 4 }),   // selected
    base({ id: 's4', actionType: 'SendText', comment: 'tail', rowNumber: 5 }),
  ];
  // What ToPaired returns for indices [1,3]: each click becomes two halves (ids reissued, as
  // ActionItem.Clone does on the C# side).
  const post2 = [
    base({ id: 'n0', actionType: 'SendText', comment: 'header', rowNumber: 1 }),
    base({ id: 'n1', actionType: 'LeftClickDown', x: 11, y: 11, rowNumber: 2 }),
    base({ id: 'n2', actionType: 'LeftClickUp', x: 11, y: 11, rowNumber: 3 }),
    base({ id: 'n3', actionType: 'SendText', comment: 'SECRET', rowNumber: 4 }),
    base({ id: 'n4', actionType: 'LeftClickDown', x: 33, y: 33, rowNumber: 5 }),
    base({ id: 'n5', actionType: 'LeftClickUp', x: 33, y: 33, rowNumber: 6 }),
    base({ id: 'n6', actionType: 'SendText', comment: 'tail', rowNumber: 7 }),
  ];

  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: pre } });
  await post(page, { type: 'button:states', payload: btnStates({}) });

  const a = page.locator('tr[data-row-index="1"]');
  const b = page.locator('tr[data-row-index="3"]');
  await a.click({ position: { x: 220, y: 10 } });
  await b.click({ position: { x: 220, y: 10 }, modifiers: ['Control'] });
  await page.waitForTimeout(150);
  console.log('SPLIT SELECTED BEFORE:', JSON.stringify(await selectedRows(page)));

  await a.click({ button: 'right', position: { x: 220, y: 10 } });
  await page.getByRole('button', { name: /^Change click type/ }).hover();
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: /^Split into Down \+ Up/ }).click();
  await page.waitForTimeout(150);
  console.log('SPLIT BRIDGE OUT:', JSON.stringify(
    await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('convertMode')))));

  await page.evaluate(() => { (window as any).__out = []; });
  await post(page, { type: 'actions:updated', payload: { actions: post2 } });
  await page.waitForTimeout(250);

  console.log('SPLIT SELECTED AFTER:', JSON.stringify(await selectedRows(page)));
  console.log('SPLIT ROWS AFTER:', JSON.stringify(
    await page.$$eval('tr[data-row-index]', els => els.map(e => (e.textContent ?? '').replace(/\s+/g, ' ').slice(0, 40)))));
  console.log('selection:changed RE-EMITTED AFTER THE SHAPE CHANGE:', JSON.stringify(
    await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('selection:changed')))));

  // And what a bulk edit would now hit.
  await page.evaluate(() => { (window as any).__out = []; });
  await page.getByRole('button', { name: /^Delete/ }).first().click();
  await page.waitForTimeout(200);
  console.log('SPLIT BULK DELETE:', JSON.stringify(
    await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('actions:delete')))));
});
