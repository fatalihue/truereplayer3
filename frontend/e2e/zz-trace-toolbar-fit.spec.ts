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

const rows = () => [
  base({ id: 'a', actionType: 'LeftClick', x: 10, y: 10, rowNumber: 1 }),
  base({ id: 'b', actionType: 'LeftClick', x: 20, y: 20, rowNumber: 2 }),
  base({ id: 'c', actionType: 'LeftClick', x: 30, y: 30, rowNumber: 3 }),
  base({ id: 'd', actionType: 'LeftClick', x: 40, y: 40, rowNumber: 4 }),
];

async function boot(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: 760 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(400);
}

// Mirrors fit() exactly: available = bar.clientWidth - padding - columnGap.
const probe = () => {
  const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | undefined;
  if (!row) return null;
  const bar = row.parentElement as HTMLElement;
  const cs = getComputedStyle(bar);
  const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
  const available = bar.clientWidth - pad - parseFloat(cs.columnGap || '0');
  const unit = (row.querySelector('[data-tb-unit]') as HTMLElement | null)?.offsetWidth ?? 0;
  return {
    scrollW: row.scrollWidth,
    offsetW: row.offsetWidth,
    rectW: Math.round(row.getBoundingClientRect().width * 100) / 100,
    available: Math.round(available * 100) / 100,
    unit,
    slack: Math.round((available - row.offsetWidth) * 100) / 100,
    kids: row.children.length,
  };
};

const clearBtn = (page: import('@playwright/test').Page) =>
  page.locator('button[data-tip="Clear All"], button[data-tip="Limpar tudo"]');
const moreBtn = (page: import('@playwright/test').Page) =>
  page.locator('button[data-tip="More"], button[data-tip="Mais"]');
const confirm = (page: import('@playwright/test').Page) => page.getByText(/Clear all \d+ actions?\?/);

test('A: does an open Clear All popover inflate row.scrollWidth?', async ({ page }) => {
  await boot(page, 1500);
  console.log('WIDE, closed :', JSON.stringify(await page.evaluate(probe)));
  await expect(clearBtn(page)).toHaveCount(1);
  await clearBtn(page).click();
  await page.waitForTimeout(250);
  console.log('confirm visible:', await confirm(page).count());
  console.log('WIDE, popover open:', JSON.stringify(await page.evaluate(probe)));
  console.log('popover geometry:', JSON.stringify(await page.evaluate(() => {
    const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement;
    const pop = document.querySelector('div.menu-surface.w-60') as HTMLElement | null;
    if (!pop) return 'NO POPOVER';
    const r = row.getBoundingClientRect(), p = pop.getBoundingClientRect();
    return { rowRight: r.right, popRight: p.right, popLeft: p.left, popW: p.width, overhangRight: p.right - r.right };
  })));
});

test('B: sweep widths, find slack band, then click Clear All there', async ({ page }) => {
  await boot(page, 1000);
  const first = await page.evaluate(probe);
  console.log('at 1000:', JSON.stringify(first), 'more=', await moreBtn(page).count());

  // Walk down until slack falls under one unit while overflowCount is still 0.
  let target = -1;
  for (let w = 1000; w >= 560; w -= 2) {
    await page.setViewportSize({ width: w, height: 760 });
    await page.waitForTimeout(90);
    const p = await page.evaluate(probe);
    const more = await moreBtn(page).count();
    if (p && more === 0 && p.slack >= 4 && p.slack < 28) {
      console.log('CANDIDATE w=', w, JSON.stringify(p), 'more=', more);
      target = w;
      break;
    }
    if (more > 0) { console.log('overflow already at w=', w, JSON.stringify(p)); break; }
  }
  expect(target).toBeGreaterThan(0);

  console.log('--- before click ---');
  console.log('clearBtn=', await clearBtn(page).count(), 'moreBtn=', await moreBtn(page).count(),
    JSON.stringify(await page.evaluate(probe)));

  await clearBtn(page).click();
  await page.waitForTimeout(400);

  console.log('--- after click on Clear All ---');
  console.log('confirm popover visible:', await confirm(page).count());
  console.log('clearBtn=', await clearBtn(page).count(), 'moreBtn=', await moreBtn(page).count());
  console.log('probe:', JSON.stringify(await page.evaluate(probe)));

  // Does it ever come back on its own?
  await page.waitForTimeout(1200);
  console.log('--- 1.2s later (idle) ---');
  console.log('clearBtn=', await clearBtn(page).count(), 'moreBtn=', await moreBtn(page).count(),
    JSON.stringify(await page.evaluate(probe)));
});

test('C: open the More menu in the collapsed regime', async ({ page }) => {
  await boot(page, 1000);
  let found = -1;
  for (let w = 1000; w >= 520; w -= 4) {
    await page.setViewportSize({ width: w, height: 760 });
    await page.waitForTimeout(90);
    if (await moreBtn(page).count() > 0) { found = w; break; }
  }
  console.log('More appears at w=', found, JSON.stringify(await page.evaluate(probe)));
  expect(found).toBeGreaterThan(0);
  const tipsBefore = await page.locator('[data-tb-unit]').first().evaluate((el) =>
    Array.from((el.parentElement as HTMLElement).querySelectorAll('button')).map(b => b.getAttribute('data-tip')));
  console.log('row buttons before:', JSON.stringify(tipsBefore));

  await moreBtn(page).click();
  await page.waitForTimeout(400);
  const tipsAfter = await page.locator('[data-tb-unit]').first().evaluate((el) =>
    Array.from((el.parentElement as HTMLElement).querySelectorAll('button')).map(b => b.getAttribute('data-tip')));
  console.log('row buttons after :', JSON.stringify(tipsAfter));
  console.log('probe after open:', JSON.stringify(await page.evaluate(probe)));
  const panel = page.locator('div.menu-surface').filter({ hasText: 'More actions' }).first();
  console.log('panel visible:', await panel.count(),
    'items:', JSON.stringify(await panel.locator('button').allTextContents()));
  console.log('panel geometry:', JSON.stringify(await page.evaluate(() => {
    const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement;
    const pop = document.querySelector('div.menu-surface.w-56') as HTMLElement | null;
    if (!pop) return 'NO PANEL';
    const r = row.getBoundingClientRect(), p = pop.getBoundingClientRect();
    return { rowRight: r.right, popRight: p.right, popW: p.width, overhangRight: p.right - r.right };
  })));

  // close it again and see where the row settles
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 400);
  await page.waitForTimeout(600);
  const tipsClosed = await page.locator('[data-tb-unit]').first().evaluate((el) =>
    Array.from((el.parentElement as HTMLElement).querySelectorAll('button')).map(b => b.getAttribute('data-tip')));
  console.log('row buttons after close:', JSON.stringify(tipsClosed));
});

// The shipped window cannot go below 960 DIP (WindowShellServices.BaseMinWidthDip),
// so the only widths that matter are >= ~960. Both rails start EXPANDED above the
// auto-collapse threshold (innerWidth < 1175*0.9 = 1057.5 folds them).
test('D: is the slack band reachable at REAL window widths (>=960)?', async ({ page }) => {
  await boot(page, 1200);
  const hits: number[] = [];
  for (let w = 1200; w >= 962; w -= 2) {
    await page.setViewportSize({ width: w, height: 760 });
    await page.waitForTimeout(70);
    const p = await page.evaluate(probe);
    const more = await moreBtn(page).count();
    const clear = await clearBtn(page).count();
    if (!p) continue;
    if (more === 0 && p.slack >= 0 && p.slack < 30) {
      hits.push(w);
      console.log('BAND HIT w=', w, JSON.stringify(p), 'clear=', clear, 'more=', more);
    }
    if (w % 20 === 0) console.log('   w=', w, 'slack=', p.slack, 'rowW=', p.offsetW, 'avail=', p.available, 'more=', more, 'clear=', clear);
  }
  console.log('BAND WIDTHS:', JSON.stringify(hits));
  expect(hits.length).toBeGreaterThan(0);

  const w = hits[Math.floor(hits.length / 2)];
  await page.setViewportSize({ width: w, height: 760 });
  await page.waitForTimeout(300);
  console.log('=== acting at REAL width', w, JSON.stringify(await page.evaluate(probe)));
  console.log('before: clear=', await clearBtn(page).count(), 'more=', await moreBtn(page).count());
  await clearBtn(page).click();
  await page.waitForTimeout(400);
  console.log('after : confirm=', await confirm(page).count(), 'clear=', await clearBtn(page).count(),
    'more=', await moreBtn(page).count(), JSON.stringify(await page.evaluate(probe)));
  await page.waitForTimeout(1000);
  console.log('idle  : confirm=', await confirm(page).count(), 'clear=', await clearBtn(page).count(),
    'more=', await moreBtn(page).count());
});

// Same band, a different rail configuration: collapse ONLY the left sidebar (App.tsx's
// cmd:togglesidebar), which slides `available` by the rail's width and moves the band to a
// wide, ordinary window size where nothing auto-collapses.
test('E: band with the left rail collapsed', async ({ page }) => {
  await boot(page, 1400);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cmd:togglesidebar')));
  await page.waitForTimeout(300);
  console.log('after toggle @1400:', JSON.stringify(await page.evaluate(probe)));
  let hit = -1;
  for (let w = 1400; w >= 1060; w -= 1) {
    await page.setViewportSize({ width: w, height: 760 });
    await page.waitForTimeout(60);
    const p = await page.evaluate(probe);
    if (!p) continue;
    const more = await moreBtn(page).count();
    if (more === 0 && p.slack >= 0 && p.slack < 30) { hit = w; console.log('BAND w=', w, JSON.stringify(p)); break; }
    if (w % 40 === 0) console.log('   w=', w, 'slack=', p.slack, 'avail=', p.available, 'more=', more);
  }
  expect(hit).toBeGreaterThan(0);
  console.log('before: clear=', await clearBtn(page).count(), 'more=', await moreBtn(page).count());
  await clearBtn(page).click();
  await page.waitForTimeout(400);
  console.log('after : confirm=', await confirm(page).count(), 'clear=', await clearBtn(page).count(),
    'more=', await moreBtn(page).count(), JSON.stringify(await page.evaluate(probe)));
  // How much widening does it take to get the button back?
  let back = -1;
  for (let w = hit; w <= hit + 90; w += 2) {
    await page.setViewportSize({ width: w, height: 760 });
    await page.waitForTimeout(70);
    if (await clearBtn(page).count() > 0) { back = w; break; }
  }
  console.log('Clear All returns at w=', back, '(from', hit, ') => widened by', back - hit, 'px');
});

// The path App.tsx documents as supported: the window crosses below 1057.5 so BOTH rails
// auto-fold, and the user re-expands them by hand ("a rail the user re-expands while narrow
// stays expanded"). That puts the band over a ~25px range of ordinary window widths.
test('F: user re-expands both rails while narrow, then clicks Clear All', async ({ page }) => {
  await boot(page, 1400);
  await page.setViewportSize({ width: 1040, height: 760 });
  await page.waitForTimeout(400);
  console.log('narrow, rails auto-folded:', JSON.stringify(await page.evaluate(probe)));
  const expand = page.locator('button[data-tip="Expand panel"], button[data-tip="Expandir painel"]');
  console.log('expand buttons found:', await expand.count());
  const n = await expand.count();
  for (let i = 0; i < n; i++) { await expand.nth(0).click(); await page.waitForTimeout(250); }
  await page.waitForTimeout(400);
  const p = await page.evaluate(probe);
  console.log('both rails re-expanded @1040:', JSON.stringify(p),
    'clear=', await clearBtn(page).count(), 'more=', await moreBtn(page).count());

  let hit = -1;
  for (let w = 1040; w >= 962; w -= 1) {
    await page.setViewportSize({ width: w, height: 760 });
    await page.waitForTimeout(70);
    const q = await page.evaluate(probe);
    if (!q) continue;
    if (await moreBtn(page).count() === 0 && q.slack >= 0 && q.slack < 30) { hit = w; console.log('BAND w=', w, JSON.stringify(q)); break; }
  }
  expect(hit).toBeGreaterThan(0);
  console.log('before: clear=', await clearBtn(page).count(), 'more=', await moreBtn(page).count());
  await clearBtn(page).click();
  await page.waitForTimeout(400);
  console.log('after : confirm=', await confirm(page).count(), 'clear=', await clearBtn(page).count(),
    'more=', await moreBtn(page).count(), JSON.stringify(await page.evaluate(probe)));
  let back = -1;
  for (let w = hit; w <= hit + 100; w += 2) {
    await page.setViewportSize({ width: w, height: 760 });
    await page.waitForTimeout(70);
    if (await clearBtn(page).count() > 0) { back = w; break; }
  }
  console.log('Clear All returns at w=', back, 'i.e. after widening', back - hit, 'px');
});

// Root cause is not specific to Clear All: any toolbar popover whose box lands right of the
// row's right edge inflates row.scrollWidth. The w-56 dropdowns open left-0 (no flip) whenever
// the viewport still has room to their right — which is exactly what an expanded right rail is.
test('G: a plain dropdown in the same layout', async ({ page }) => {
  await boot(page, 1400);
  await page.setViewportSize({ width: 1040, height: 760 });
  await page.waitForTimeout(400);
  const expand = page.locator('button[data-tip="Expand panel"], button[data-tip="Expandir painel"]');
  const n = await expand.count();
  for (let i = 0; i < n; i++) { await expand.nth(0).click(); await page.waitForTimeout(250); }
  await page.waitForTimeout(300);
  console.log('start:', JSON.stringify(await page.evaluate(probe)));
  const tipsOf = () => page.locator('[data-tb-unit]').first().evaluate((el) =>
    Array.from((el.parentElement as HTMLElement).querySelectorAll('button')).map(b => b.getAttribute('data-tip')));
  console.log('row before:', JSON.stringify(await tipsOf()));

  for (const tip of ['Ações de navegador', 'Browser actions', 'Loop', 'Condicional', 'Conditional']) {
    const b = page.locator(`button[data-tip="${tip}"]`);
    if (await b.count() === 0) continue;
    await b.first().click();
    await page.waitForTimeout(350);
    const geo = await page.evaluate(() => {
      const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement;
      const pops = Array.from(document.querySelectorAll('div.menu-surface')) as HTMLElement[];
      const r = row.getBoundingClientRect();
      return { rowRight: r.right, pops: pops.map(p => ({ w: p.getBoundingClientRect().width, overhang: p.getBoundingClientRect().right - r.right })) };
    });
    console.log(tip, '=> probe', JSON.stringify(await page.evaluate(probe)), 'geo', JSON.stringify(geo));
    console.log(tip, '=> row now:', JSON.stringify(await tipsOf()));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    console.log(tip, '=> after close:', JSON.stringify(await tipsOf()));
  }
});
