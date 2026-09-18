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
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
}

// 0 DoubleClick at-cursor (the accused) · 1 TripleClick at-cursor (control) ·
// 2 MiddleClickHold at-cursor (the comment's own "correctly no rule" example) ·
// 3 LeftClick with a point (both entries render) · 4 Pause (neither renders) ·
// 5 DoubleClick with a point (Copy Coordinates renders).
async function seed(page: import('@playwright/test').Page) {
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'a', actionType: 'DoubleClick',     x: 10, y: 10, rowNumber: 1, atCursor: true }),
    base({ id: 'b', actionType: 'TripleClick',     x: 11, y: 11, rowNumber: 2, atCursor: true }),
    base({ id: 'c', actionType: 'MiddleClickHold', x: 12, y: 12, rowNumber: 3, atCursor: true, holdDurationMs: 500 }),
    base({ id: 'd', actionType: 'LeftClick',       x: 13, y: 13, rowNumber: 4 }),
    base({ id: 'e', actionType: 'Pause',           x: 0,  y: 0,  rowNumber: 5, delay: 100 }),
    base({ id: 'f', actionType: 'DoubleClick',     x: 15, y: 15, rowNumber: 6 }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await expect(page.locator('tr[data-row-index="0"]')).toBeVisible();
}

// Walk the More flyout's item container and label every direct child.
async function moreFlyoutShape(page: import('@playwright/test').Page, rowIndex: number) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await page.locator(`tr[data-row-index="${rowIndex}"]`).click({ button: 'right' });
  await page.waitForTimeout(150);

  const moreBtn = page.locator('button.menu-item').filter({ hasText: /^More$/ }).first();
  await expect(moreBtn).toBeVisible();
  await moreBtn.hover();
  await page.waitForTimeout(200);

  // The flyout's OWN surface: the More button's `relative` wrapper holds it. Filtering
  // `div.menu-surface` by text matches the OUTER menu too, because innerText nests.
  return await moreBtn.evaluate((btn) => {
    const wrapper = btn.parentElement as HTMLElement;
    const el = wrapper.querySelector('div.menu-surface') as HTMLElement;
    if (!el) return [{ tag: 'NO-FLYOUT', divider: false, text: '', top: 0, h: 0 }];
    const out: { tag: string; divider: boolean; text: string; top: number; h: number }[] = [];
    for (const c of Array.from(el.children)) {
      const cls = c.className || '';
      const isDiv = c.tagName === 'DIV' && /border-t/.test(String(cls));
      const r = (c as HTMLElement).getBoundingClientRect();
      out.push({
        tag: c.tagName,
        divider: isDiv,
        text: ((c as HTMLElement).innerText || '').replace(/\n/g, ' | ').trim(),
        top: Math.round(r.top * 100) / 100,
        h: Math.round(r.height * 100) / 100,
      });
    }
    return out;
  });
}

test('at-cursor DoubleClick: does the More flyout draw two dividers with nothing between?', async ({ page }) => {
  await boot(page);
  await seed(page);

  const labels = ['0 DoubleClick@cursor', '1 TripleClick@cursor', '2 MiddleClickHold@cursor',
                  '3 LeftClick point', '4 Pause', '5 DoubleClick point'];

  for (let i = 0; i < labels.length; i++) {
    const shape = await moreFlyoutShape(page, i);
    console.log('==== ROW ' + labels[i] + ' ====');
    for (const s of shape) {
      console.log(`  ${s.divider ? 'DIVIDER' : s.tag.padEnd(7)}  top=${s.top}  h=${s.h}  ${s.divider ? '' : JSON.stringify(s.text)}`);
    }
    // Adjacent-divider detector: two dividers in a row with no rendered item between.
    let adjacent = 0;
    for (let k = 1; k < shape.length; k++) {
      if (shape[k].divider && shape[k - 1].divider) adjacent++;
    }
    console.log(`  >>> ADJACENT DIVIDER PAIRS: ${adjacent}`);
  }
});

// Reachability: can a user actually CREATE an at-cursor DoubleClick row?
test('doors into the at-cursor DoubleClick state', async ({ page }) => {
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
  await boot(page);
  await seed(page);

  // DOOR 1 — the Sheet's Position control on a DoubleClick row (row 5, has a point).
  await page.locator('tr[data-row-index="5"]').dblclick();
  await page.waitForTimeout(400);
  const pos = page.getByRole('button', { name: /At cursor/ });
  console.log('DOOR 1 — Position control on a DoubleClick row:', await pos.count());
  if (await pos.count()) {
    await pos.first().click();
    await page.waitForTimeout(200);
    const save = page.getByRole('button', { name: /^Save$/ });
    console.log('DOOR 1 — Save present:', await save.count());
    if (await save.count()) { await save.first().click(); await page.waitForTimeout(300); }
    console.log('DOOR 1 — WIRE:', JSON.stringify(
      (await page.evaluate(() => (window as any).__out as string[])).filter(s => s.includes('atCursor'))));
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // DOOR 2 — Change click type ▸ Double Click on an at-cursor LeftClick row.
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'g', actionType: 'LeftClick', x: 30, y: 30, rowNumber: 1, atCursor: true }),
  ] } });
  await page.waitForTimeout(250);
  await page.evaluate(() => { (window as any).__out = []; });
  await page.locator('tr[data-row-index="0"]').click({ button: 'right' });
  await page.waitForTimeout(150);
  const parent = page.getByRole('button', { name: /Change click type/ });
  console.log('DOOR 2 — Change click type offered on at-cursor LeftClick:', await parent.count());
  await parent.hover();
  await page.waitForTimeout(200);
  const dbl = page.getByRole('button', { name: /^Double Click/ });
  console.log('DOOR 2 — Double Click chip offered:', await dbl.count());
  await dbl.first().click();
  await page.waitForTimeout(250);
  console.log('DOOR 2 — WIRE:', JSON.stringify(await page.evaluate(() => (window as any).__out as string[])));
});

test('DOOR 1 via sheet:openIndex — Position control on a DoubleClick row', async ({ page }) => {
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
  await boot(page);
  await seed(page);
  await post(page, { type: 'sheet:openIndex', payload: { index: 5 } });   // DoubleClick, has a point
  await page.waitForTimeout(600);
  const sheetText = await page.locator('body').innerText();
  console.log('SHEET OPEN? contains "Position":', /Position/.test(sheetText),
              '| contains "At cursor":', /At cursor/.test(sheetText));
  const seg = page.locator('button', { hasText: /^At cursor$/ });
  console.log('AT-CURSOR SEGMENT COUNT:', await seg.count());
  if (await seg.count()) {
    await seg.first().click();
    await page.waitForTimeout(200);
    const save = page.getByRole('button', { name: /^Save$/ });
    console.log('SAVE COUNT:', await save.count());
    if (await save.count()) { await save.first().click(); await page.waitForTimeout(400); }
    console.log('WIRE:', JSON.stringify(await page.evaluate(() => (window as any).__out as string[])));
  }
});
