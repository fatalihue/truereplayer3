import { test, expect } from '@playwright/test';

// INDEPENDENT skeptic pass on the claim:
//   Toolbar.tsx row gate  Activate Window = overflowCount < 3   (L1149)
//   Toolbar.tsx menu gate Activate Window = overflowCount >= 2  (L1291)
// => at overflowCount === 2 BOTH render.
// Same shape for Run Profile: row < 4 (L1134) / menu >= 3 (L1282) => duplicate at oc === 3.
// The question this file answers is NOT "are the literals mismatched" (they plainly are)
// but "is overflowCount === 2 (and 3) a REACHABLE RESTING state in the real app".

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
  recordButtonText: 'Recording', replayButtonText: 'Replay', canUndo: true, canRedo: true,
  copiedCount: 0, ...over,
});
const rows = () => Array.from({ length: 6 }, (_, i) =>
  base({ id: 'r' + i, x: i * 10, y: i * 10, rowNumber: i + 1 }));

async function boot(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(500);
}

// data-tip of every direct button inside the tools row (the row is data-tb-unit's parent).
const rowTips = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | null;
    if (!row) return [];
    return Array.from(row.querySelectorAll('button'))
      .map(b => b.getAttribute('data-tip'))
      .filter(Boolean) as string[];
  });

const probe = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | null;
    if (!row) return null;
    const bar = row.parentElement as HTMLElement;
    const cs = getComputedStyle(bar);
    const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
    return {
      barW: bar.clientWidth,
      available: Math.round((bar.clientWidth - pad - parseFloat(cs.columnGap || '0')) * 10) / 10,
      needed: row.scrollWidth,
      unit: (row.querySelector('[data-tb-unit]') as HTMLElement | null)?.offsetWidth ?? 0,
      zoom: getComputedStyle(document.documentElement).zoom,
      innerW: window.innerWidth,
    };
  });

// overflowCount reconstructed from the ROW gates alone (the internally consistent ladder):
//   Clear All gone => >=1, Data Loop gone => >=2, Activate Window gone => >=3, Run Profile gone => >=4
function ocFromRow(tips: string[]) {
  const has = (en: string, pt: string) => tips.includes(en) || tips.includes(pt);
  if (!has('Run Profile', 'Executar perfil')) return 4;
  if (!has('Activate Window', 'Ativar janela')) return 3;
  if (!has('Data Loop', 'Data Loop')) return 2;
  if (!has('Clear All', 'Limpar tudo')) return 1;
  return 0;
}

async function openMoreAndList(page: import('@playwright/test').Page) {
  const more = page.locator('button[data-tip="More"], button[data-tip="Mais"]');
  if (await more.count() === 0) return null;
  await more.first().click();
  await page.waitForTimeout(200);
  const panel = page.locator('div.menu-surface').filter({ hasText: 'More actions' }).first();
  if (await panel.count() === 0) return null;
  const items = (await panel.locator('button').allTextContents()).map(s => s.trim()).filter(Boolean);
  return items;
}

async function closeMore(page: import('@playwright/test').Page) {
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 400);
  await page.waitForTimeout(150);
}

// ─────────────────────────────────────────────────────────────────────────────
test('1. raw width sweep: which overflowCount values are RESTING, and is AW doubled there', async ({ page }) => {
  await boot(page, 1600);
  const seen = new Map<number, number[]>();
  for (let w = 1600; w >= 700; w -= 4) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(120);
    const oc = ocFromRow(await rowTips(page));
    if (!seen.has(oc)) seen.set(oc, []);
    seen.get(oc)!.push(w);
  }
  for (const [oc, ws] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`oc=${oc}  widths: ${ws[ws.length - 1]}..${ws[0]}  (${ws.length} samples)`);
  }
  console.log('RESTING oc values observed:', [...seen.keys()].sort().join(','));
});

test('2. at every resting oc, count Activate Window + Run Profile affordances (row AND menu)', async ({ page }) => {
  await boot(page, 1600);
  const widths = [1600, 1100, 1040, 1000, 960, 900, 860, 820, 780, 740, 700, 680, 660, 640];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(350);
    const tips = await rowTips(page);
    const oc = ocFromRow(tips);
    const p = await probe(page);
    const awRow = tips.filter(t => t === 'Activate Window' || t === 'Ativar janela').length;
    const rpRow = tips.filter(t => t === 'Run Profile' || t === 'Executar perfil').length;
    const items = await openMoreAndList(page);
    const awMenu = (items ?? []).filter(i => i === 'Activate Window').length;
    const rpMenu = (items ?? []).filter(i => i === 'Run Profile').length;
    console.log(
      `w=${w} innerW=${p?.innerW} bar=${p?.barW} avail=${p?.available} needed=${p?.needed} unit=${p?.unit} zoom=${p?.zoom} | oc=${oc}` +
      ` | AW row=${awRow} menu=${awMenu} TOTAL=${awRow + awMenu}` +
      ` | RP row=${rpRow} menu=${rpMenu} TOTAL=${rpRow + rpMenu}` +
      ` | menu=[${(items ?? []).join(' / ')}]`
    );
    await closeMore(page);
  }
});

test('3. REAL path: below the 1175*zoom threshold rails auto-collapse; re-expand BOTH by hand', async ({ page }) => {
  // Start WIDE so the rails are expanded and wasNarrowRef starts false.
  await boot(page, 1600);
  const expandedRailState = await page.evaluate(() => ({
    expandBtns: document.querySelectorAll('button[data-tip="Expand panel"], button[data-tip="Expandir painel"]').length,
  }));
  console.log('at 1600, "Expand panel" buttons (0 == both rails expanded):', JSON.stringify(expandedRailState));

  // Cross the threshold downward -> both rails auto-collapse.
  await page.setViewportSize({ width: 958, height: 800 });
  await page.waitForTimeout(500);
  let collapsed = await page.locator('button[data-tip="Expand panel"], button[data-tip="Expandir painel"]').count();
  console.log('at 958, "Expand panel" buttons present (2 == both rails collapsed):', collapsed);
  console.log('   row at 958 with rails COLLAPSED -> oc=', ocFromRow(await rowTips(page)), JSON.stringify(await probe(page)));

  // Re-expand BOTH by hand — the documented supported path (autoCollapsedRef is cleared,
  // so they STAY expanded while narrow).
  for (let i = 0; i < 4; i++) {
    const btn = page.locator('button[data-tip="Expand panel"], button[data-tip="Expandir painel"]');
    if (await btn.count() === 0) break;
    await btn.first().click();
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(600);
  console.log('after manual re-expansion, "Expand panel" buttons left:', await page.locator('button[data-tip="Expand panel"], button[data-tip="Expandir painel"]').count());

  // Now sweep UP from the 960-DIP minimum through the band below the auto-expand threshold.
  for (const w of [958, 966, 974, 982, 990, 998, 1006, 1014, 1022, 1030, 1038, 1046, 1054]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(400);
    const railsExpanded = await page.locator('button[data-tip="Expand panel"], button[data-tip="Expandir painel"]').count() === 0;
    const tips = await rowTips(page);
    const oc = ocFromRow(tips);
    const p = await probe(page);
    const awRow = tips.filter(t => t === 'Activate Window' || t === 'Ativar janela').length;
    const rpRow = tips.filter(t => t === 'Run Profile' || t === 'Executar perfil').length;
    const items = await openMoreAndList(page);
    const awMenu = (items ?? []).filter(i => i === 'Activate Window').length;
    const rpMenu = (items ?? []).filter(i => i === 'Run Profile').length;
    console.log(
      `w=${w} railsExpanded=${railsExpanded} bar=${p?.barW} avail=${p?.available} needed=${p?.needed} unit=${p?.unit} | oc=${oc}` +
      ` | AW TOTAL=${awRow + awMenu} (row ${awRow}/menu ${awMenu}) | RP TOTAL=${rpRow + rpMenu} (row ${rpRow}/menu ${rpMenu})`
    );
    await closeMore(page);
  }
});

test('4. is oc=2 STABLE (a resting state) or does it drift?', async ({ page }) => {
  await boot(page, 1600);
  // find a width that rests at oc=2 by scanning
  let target = -1;
  for (let w = 1100; w >= 640; w -= 2) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(110);
    if (ocFromRow(await rowTips(page)) === 2) { target = w; break; }
  }
  console.log('first width resting at oc=2 (rails auto-collapsed path):', target);
  if (target < 0) { console.log('NO oc=2 FOUND ON THIS PATH'); return; }
  await page.setViewportSize({ width: target, height: 800 });
  await page.waitForTimeout(500);
  for (const t of [0, 500, 1500, 3000]) {
    if (t) await page.waitForTimeout(t === 500 ? 500 : 1000);
    const oc = ocFromRow(await rowTips(page));
    console.log(`  t=+${t}ms  oc=${oc}  probe=${JSON.stringify(await probe(page))}`);
  }
  // Now count both affordances and prove they fire the SAME payload.
  await page.evaluate(() => {
    (window as any).__sent = [];
    const w = window as any;
    if (!w.chrome?.webview) {
      const orig = window.postMessage.bind(window);
      w.__origPost = orig;
    }
    window.addEventListener('message', (e: MessageEvent) => {
      const d: any = e.data;
      if (d && typeof d === 'object' && d.type === 'actions:insertAction') (window as any).__sent.push(JSON.stringify(d));
    });
  });
  const tips = await rowTips(page);
  console.log('row tips at oc=2:', JSON.stringify(tips));
  const items = await openMoreAndList(page);
  console.log('menu items at oc=2:', JSON.stringify(items));
  const awRow = tips.filter(t => t === 'Activate Window' || t === 'Ativar janela').length;
  const awMenu = (items ?? []).filter(i => i === 'Activate Window').length;
  console.log(`TOTAL Activate Window affordances on screen at oc=2: ${awRow + awMenu}`);
});
