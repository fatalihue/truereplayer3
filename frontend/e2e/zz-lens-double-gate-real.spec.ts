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
const rows = () => Array.from({ length: 6 }, (_, i) =>
  base({ id: 'r' + i, x: i * 10, y: i * 10, rowNumber: i + 1 }));

const rowTips = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | null;
    if (!row) return [];
    return Array.from(row.querySelectorAll(':scope > button, :scope > div > button'))
      .map(b => b.getAttribute('data-tip'));
  });
const barW = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | null;
    const bar = row?.parentElement as HTMLElement | null;
    return { bar: bar?.clientWidth ?? -1, rowScroll: row?.scrollWidth ?? -1 };
  });
const has = (t: (string | null)[], en: string, pt: string) => t.includes(en) || t.includes(pt);
function rowOverflow(t: (string | null)[]) {
  if (!has(t, 'Run Profile', 'Executar perfil')) return 4;
  if (!has(t, 'Activate Window', 'Ativar janela')) return 3;
  if (!has(t, 'Data Loop', 'Data Loop')) return 2;
  if (!has(t, 'Clear All', 'Limpar tudo')) return 1;
  return 0;
}
const menuItems = async (page: import('@playwright/test').Page) => {
  const panel = page.locator('div.menu-surface').filter({ hasText: 'More actions' }).first();
  if (await panel.count() === 0) return null;
  return (await panel.locator('button').allTextContents()).map(s => s.trim());
};

// The real shipped minimum: 958 device px (BaseMinWidthDip 960 at 90% UI zoom),
// both rails auto-fold below ~1057 and the user re-expands them BY HAND.
test('REAL widths >= 958, both rails re-expanded: which overflowCount, and is anything doubled?', async ({ page }) => {
  await page.setViewportSize({ width: 1040, height: 780 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(500);

  const expanders = page.locator('button[data-tip="Expandir painel"], button[data-tip="Expand panel"]');
  const n = await expanders.count();
  console.log('rails to re-expand:', n);
  for (let i = 0; i < n; i++) { await expanders.nth(0).click(); await page.waitForTimeout(250); }
  await page.waitForTimeout(500);

  const seen = new Map<number, { w: number; bar: number; menu: string[] | null; row: (string | null)[] }>();
  for (let w = 1240; w >= 958; w -= 2) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(80);
    const tips = await rowTips(page);
    const oc = rowOverflow(tips);
    const g = await barW(page);
    if (w % 20 === 0) console.log(`  w=${w} bar=${g.bar} rowScroll=${g.rowScroll} overflowCount=${oc}`);
    if (seen.has(oc)) continue;
    let menu: string[] | null = null;
    let rowNow = tips;
    const more = page.locator('button[data-tip="More"], button[data-tip="Mais"]');
    if (await more.count() > 0) {
      await more.click();
      await page.waitForTimeout(250);
      menu = await menuItems(page);
      rowNow = await rowTips(page);
      await page.mouse.click(5, 500);
      await page.waitForTimeout(200);
    }
    seen.set(oc, { w, bar: g.bar, menu, row: rowNow });
    console.log(`>>> FIRST SIGHTING overflowCount=${oc} at viewport ${w}px, bar.clientWidth=${g.bar}`);
  }

  for (const oc of [0, 1, 2, 3, 4]) {
    const s = seen.get(oc);
    if (!s) { console.log(`overflowCount=${oc}: not reached at real widths with rails expanded`); continue; }
    console.log(`\n=== overflowCount=${oc} @ viewport ${s.w}px (bar ${s.bar}px) ===`);
    console.log('   row :', JSON.stringify(s.row.slice(-5)));
    console.log('   menu:', JSON.stringify(s.menu));
    for (const [label, en, pt] of [
      ['Run Profile', 'Run Profile', 'Executar perfil'],
      ['Activate Window', 'Activate Window', 'Ativar janela'],
      ['Data Loop', 'Data Loop', 'Data Loop'],
      ['Clear All', 'Clear All', 'Limpar tudo'],
    ] as [string, string, string][]) {
      const inRow = has(s.row, en, pt);
      const inMenu = !!s.menu && s.menu.some(t => t.startsWith(label));
      console.log(`     ${label.padEnd(16)} -> ${inRow && inMenu ? '*** BOTH ***' : inRow ? 'row' : inMenu ? 'menu' : 'NOWHERE'}`);
    }
  }
});

// Does overflowCount ever SETTLE at 1? 1px steps + a long settle.
test('fine sweep: which overflowCount values are stable resting states', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 780 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(400);

  const stable = new Map<number, number[]>();
  for (let w = 900; w >= 560; w -= 1) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(110); // long enough for the fit() cascade to settle
    const oc = rowOverflow(await rowTips(page));
    if (!stable.has(oc)) stable.set(oc, []);
    stable.get(oc)!.push(w);
  }
  for (const oc of [0, 1, 2, 3, 4]) {
    const ws = stable.get(oc);
    if (!ws) { console.log(`overflowCount=${oc}: NEVER a resting state`); continue; }
    console.log(`overflowCount=${oc}: ${ws.length} widths, ${Math.min(...ws)}..${Math.max(...ws)}px`);
  }
});

// Clicking a DOUBLED control: do the two instances do the same thing?
test('at overflowCount=2, the duplicated Activate Window: row instance vs menu instance', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__out = [];
    const orig = console.log.bind(console);
    console.log = (...a: unknown[]) => {
      if (typeof a[0] === 'string' && a[0].includes('→ C#')) {
        try { (window as any).__out.push(JSON.stringify({ t: a[1], p: a[2] })); } catch { /* ignore */ }
      }
      orig(...a);
    };
  });
  await page.setViewportSize({ width: 900, height: 780 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(400);

  let hit = -1;
  for (let w = 900; w >= 560; w -= 2) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(100);
    if (rowOverflow(await rowTips(page)) === 2) { hit = w; break; }
  }
  expect(hit).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  console.log('overflowCount=2 at viewport', hit, JSON.stringify(await barW(page)));

  const rowBtn = page.locator('button[data-tip="Ativar janela"], button[data-tip="Activate Window"]');
  console.log('row instances of Activate Window:', await rowBtn.count());
  const more = page.locator('button[data-tip="Mais"], button[data-tip="More"]');
  await more.click();
  await page.waitForTimeout(300);
  const panel = page.locator('div.menu-surface').filter({ hasText: 'More actions' }).first();
  console.log('menu items:', JSON.stringify(await panel.locator('button').allTextContents()));
  console.log('TOTAL Activate Window affordances on screen:',
    (await rowBtn.count()) + (await panel.getByRole('button', { name: /Activate Window/ }).count()));
  await panel.getByRole('button', { name: /Activate Window/ }).click();
  await page.waitForTimeout(300);
  console.log('menu instance sent:', JSON.stringify(await page.evaluate(() => (window as any).__out)));
  await page.evaluate(() => { (window as any).__out = []; });
  await rowBtn.first().click();
  await page.waitForTimeout(300);
  console.log('row  instance sent:', JSON.stringify(await page.evaluate(() => (window as any).__out)));
});
