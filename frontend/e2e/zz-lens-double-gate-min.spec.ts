import { test, expect } from '@playwright/test';

test.describe.configure({ timeout: 180_000 });

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
const geo = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | null;
    const bar = row?.parentElement as HTMLElement | null;
    if (!row || !bar) return null;
    const cs = getComputedStyle(bar);
    const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
    return {
      bar: bar.clientWidth,
      available: Math.round(bar.clientWidth - pad - parseFloat(cs.columnGap || '0')),
      needed: row.scrollWidth,
      unit: (row.querySelector('[data-tb-unit]') as HTMLElement | null)?.offsetWidth ?? 0,
    };
  });
const has = (t: (string | null)[], en: string, pt: string) => t.includes(en) || t.includes(pt);
function rowOverflow(t: (string | null)[]) {
  if (!has(t, 'Run Profile', 'Executar perfil')) return 4;
  if (!has(t, 'Activate Window', 'Ativar janela')) return 3;
  if (!has(t, 'Data Loop', 'Data Loop')) return 2;
  if (!has(t, 'Clear All', 'Limpar tudo')) return 1;
  return 0;
}

async function bootAndExpandRailsAt(page: import('@playwright/test').Page, w: number) {
  await page.setViewportSize({ width: w, height: 780 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(500);
  // Re-expand BOTH rails BY HAND at this (already narrow) width — the documented
  // "a rail the user re-expands while narrow stays expanded" path.
  const exp = page.locator('button[data-tip="Expandir painel"], button[data-tip="Expand panel"]');
  const n = await exp.count();
  for (let i = 0; i < n; i++) { await exp.nth(0).click(); await page.waitForTimeout(280); }
  await page.waitForTimeout(600);
  return n;
}

test('REAL minimum window (958px) + both rails re-expanded BY HAND: what does the user see?', async ({ page }) => {
  const n = await bootAndExpandRailsAt(page, 958);
  console.log('rails re-expanded:', n);
  const g = await geo(page);
  const tips = await rowTips(page);
  const oc = rowOverflow(tips);
  console.log('GEOMETRY:', JSON.stringify(g));
  console.log('overflowCount =', oc);
  console.log('ROW:', JSON.stringify(tips));

  const more = page.locator('button[data-tip="Mais"], button[data-tip="More"]');
  console.log('More button present:', await more.count());
  if (await more.count() > 0) {
    await more.click();
    await page.waitForTimeout(300);
    const panel = page.locator('div.menu-surface').filter({ hasText: 'More actions' }).first();
    const items = (await panel.locator('button').allTextContents()).map(s => s.trim());
    console.log('MENU:', JSON.stringify(items));
    const rowNow = await rowTips(page);
    for (const [label, en, pt] of [
      ['Run Profile', 'Run Profile', 'Executar perfil'],
      ['Activate Window', 'Activate Window', 'Ativar janela'],
      ['Data Loop', 'Data Loop', 'Data Loop'],
      ['Clear All', 'Clear All', 'Limpar tudo'],
    ] as [string, string, string][]) {
      const inRow = has(rowNow, en, pt);
      const inMenu = items.some(t => t.startsWith(label));
      console.log(`  ${label.padEnd(16)} row=${inRow} menu=${inMenu} ${inRow && inMenu ? '  *** DUPLICATE ***' : ''}`);
    }
  }
});

test('sweep UP from the real minimum with rails held expanded: the overflowCount ladder', async ({ page }) => {
  await bootAndExpandRailsAt(page, 958);
  let prev = -1;
  for (let w = 958; w <= 1056; w += 2) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(140);
    const tips = await rowTips(page);
    const oc = rowOverflow(tips);
    const g = await geo(page);
    if (oc !== prev) {
      console.log(`w=${w}  bar=${g?.bar} available=${g?.available} needed=${g?.needed} unit=${g?.unit}  ==> overflowCount=${oc}`);
      prev = oc;
    }
  }
});

test('stable resting states (coarse sweep, long settle)', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 780 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(400);
  const stable = new Map<number, number[]>();
  for (let w = 900; w >= 560; w -= 4) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(150);
    const oc = rowOverflow(await rowTips(page));
    if (!stable.has(oc)) stable.set(oc, []);
    stable.get(oc)!.push(w);
  }
  for (const oc of [0, 1, 2, 3, 4]) {
    const ws = stable.get(oc);
    if (!ws) { console.log(`overflowCount=${oc}: NEVER a resting state in 560..900`); continue; }
    console.log(`overflowCount=${oc}: ${ws.length} widths, ${Math.min(...ws)}..${Math.max(...ws)}px`);
  }
});
