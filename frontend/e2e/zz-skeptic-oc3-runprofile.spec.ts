import { test, expect } from '@playwright/test';

// SKEPTIC probe for: "overflowCount === 3 renders Run Profile in the ROW and in the More menu".
// Independent of the accuser's spec: reconstructs overflowCount from the ROW gates only
// (Clear All out => >=1, Data Loop out => >=2, Activate Window out => >=3, Run Profile out => >=4),
// then checks the MENU separately. Runs at REAL widths (>= the 960 DIP window minimum from
// WindowShellServices.BaseMinWidthDip) with BOTH rails re-expanded by hand, which App.tsx's
// AutoCollapseOnZoom comment says is a supported state.

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

const probe = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | null;
  if (!row) return null;
  const bar = row.parentElement as HTMLElement;
  const cs = getComputedStyle(bar);
  const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
  const available = bar.clientWidth - pad - parseFloat(cs.columnGap || '0');
  const unit = (row.querySelector('[data-tb-unit]') as HTMLElement | null)?.offsetWidth ?? 0;
  return {
    barClientW: bar.clientWidth,
    available: Math.round(available * 10) / 10,
    needed: row.scrollWidth,
    unit,
  };
});

const has = (tips: (string | null)[], en: string, pt: string) => tips.includes(en) || tips.includes(pt);

function rowOverflow(tips: (string | null)[]) {
  if (!has(tips, 'Run Profile', 'Executar perfil')) return 4;
  if (!has(tips, 'Activate Window', 'Ativar janela')) return 3;
  if (!has(tips, 'Data Loop', 'Data Loop')) return 2;
  if (!has(tips, 'Clear All', 'Limpar tudo')) return 1;
  return 0;
}

const menuItems = async (page: import('@playwright/test').Page) => {
  const panel = page.locator('div.menu-surface').filter({ hasText: 'More actions' }).first();
  if (await panel.count() === 0) return null;
  return (await panel.locator('button').allTextContents()).map(s => s.trim());
};

// Boot NARROW (rails auto-collapse on mount), then re-expand BOTH by hand.
async function bootRailsExpanded(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(500);
  // Click every "Expand panel" rail button that exists (left ProfilePanel + right SettingsPanel).
  for (let i = 0; i < 4; i++) {
    const exp = page.locator('button[data-tip="Expand panel"], button[data-tip="Expandir painel"]');
    if (await exp.count() === 0) break;
    await exp.first().click();
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(700);
}

test('REAL widths, rails expanded by hand: is overflowCount=3 a resting state, and is Run Profile in BOTH places?', async ({ page }) => {
  await bootRailsExpanded(page, 1000);

  const railsExpanded = await page.locator('button[data-tip="Collapse panel"], button[data-tip="Colapsar painel"]').count();
  console.log('rails showing a Collapse button (expanded) =', railsExpanded, '(2 = both)');

  // Coarse ladder over the legal window range.
  console.log('\n--- ladder (settle 900ms per width) ---');
  const band: number[] = [];
  for (let w = 960; w <= 1120; w += 4) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(900);
    const tips = await rowTips(page);
    const oc = rowOverflow(tips);
    const p = await probe(page);
    console.log(`  viewport ${w}  oc=${oc}  bar=${p?.barClientW}  avail=${p?.available}  needed=${p?.needed}  unit=${p?.unit}`);
    if (oc === 3) band.push(w);
  }
  console.log('\nwidths resting at oc=3:', JSON.stringify(band));
  expect(band.length, 'oc=3 must be reachable at a legal window width').toBeGreaterThan(0);

  // Park in the middle of the band, settle HARD, then look.
  const w = band[Math.floor(band.length / 2)];
  await page.setViewportSize({ width: w, height: 800 });
  await page.waitForTimeout(2500);

  const tipsBefore = await rowTips(page);
  console.log(`\n=== parked at viewport ${w} (settled 2.5s) ===`);
  console.log('  oc (row gates) =', rowOverflow(tipsBefore));
  console.log('  row            =', JSON.stringify(tipsBefore));

  const runRowBtn = page.locator('button[data-tip="Run Profile"], button[data-tip="Executar perfil"]');
  console.log('  Run Profile buttons in row, count =', await runRowBtn.count(),
    ' visible =', await runRowBtn.first().isVisible().catch(() => false));
  console.log('  row button box =', JSON.stringify(await runRowBtn.first().boundingBox().catch(() => null)));

  // Open More ▾ and re-read BOTH while it is open.
  const more = page.locator('button[data-tip="More"], button[data-tip="Mais"]');
  expect(await more.count(), 'More button must exist at oc=3').toBeGreaterThan(0);
  await more.click();
  await page.waitForTimeout(600);

  const tipsOpen = await rowTips(page);
  const menu = await menuItems(page);
  console.log('\n  --- WITH THE MENU OPEN ---');
  console.log('  oc (row gates) =', rowOverflow(tipsOpen), ' <- did opening the menu change it?');
  console.log('  row            =', JSON.stringify(tipsOpen));
  console.log('  menu           =', JSON.stringify(menu));

  const rowStill = await runRowBtn.count();
  const rowVisible = rowStill > 0 ? await runRowBtn.first().isVisible() : false;
  const menuHasRun = !!menu && menu.some(t => t.startsWith('Run Profile'));
  console.log(`\n  Run Profile in ROW while menu open: ${rowStill} (visible=${rowVisible})`);
  console.log(`  Run Profile in MENU               : ${menuHasRun}`);

  // Are both actually painted on screen at the same time, in different boxes?
  const menuRunBtn = page.locator('div.menu-surface').filter({ hasText: 'More actions' })
    .locator('button', { hasText: 'Run Profile' }).first();
  if (menuHasRun && rowVisible) {
    console.log('  row box  =', JSON.stringify(await runRowBtn.first().boundingBox()));
    console.log('  menu box =', JSON.stringify(await menuRunBtn.boundingBox()));
  }
  await page.screenshot({ path: 'test-results/skeptic-oc3.png', fullPage: false });

  console.log('\n  VERDICT: duplicate simultaneously on screen =', rowVisible && menuHasRun);
});

test('does the same double-open happen at oc=2 for Activate Window? (sibling check)', async ({ page }) => {
  await bootRailsExpanded(page, 1000);
  for (let w = 1000; w <= 1140; w += 4) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(700);
    const tips = await rowTips(page);
    if (rowOverflow(tips) === 2) {
      await page.waitForTimeout(1500);
      const t2 = await rowTips(page);
      if (rowOverflow(t2) !== 2) continue;
      const more = page.locator('button[data-tip="More"], button[data-tip="Mais"]');
      await more.click();
      await page.waitForTimeout(500);
      console.log(`oc=2 at viewport ${w}`);
      console.log('  row  =', JSON.stringify(await rowTips(page)));
      console.log('  menu =', JSON.stringify(await menuItems(page)));
      break;
    }
  }
});
