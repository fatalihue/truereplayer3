import { test, expect } from '@playwright/test';

// Is there a LEGAL configuration (window >= 960 DIP, zoom within the 50-200 slider) where
// overflowCount rests at 3 AND the More flyout flips to `right-0` (so opening it does NOT
// grow row.scrollWidth and does NOT saturate overflowCount to 4)?
// Flip rule (useFlyoutFlip, placement 'below'): flipX <=> a.left + 224 > vw - 8, i.e. the
// space to the RIGHT of the More button must be under ~192 layout px. Right rail expanded
// = w-[224px] (never flips). Right rail COLLAPSED = w-12 (48 px) -> flips.

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

const geom = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | null;
  if (!row) return null;
  const bar = row.parentElement as HTMLElement;
  const cs = getComputedStyle(bar);
  const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
  const moreBtn = document.querySelector('button[data-tip="More"], button[data-tip="Mais"]') as HTMLElement | null;
  const anchor = moreBtn?.parentElement as HTMLElement | null;
  const a = anchor?.getBoundingClientRect();
  // The open flyout: the div.menu-surface whose text starts with "More actions".
  const panels = Array.from(document.querySelectorAll('div.menu-surface')) as HTMLElement[];
  const panel = panels.find(p => p.textContent?.includes('More actions')) ?? null;
  const pr = panel?.getBoundingClientRect();
  return {
    barW: bar.clientWidth,
    available: Math.round((bar.clientWidth - pad - parseFloat(cs.columnGap || '0')) * 10) / 10,
    needed: row.scrollWidth,
    unit: (row.querySelector('[data-tb-unit]') as HTMLElement | null)?.offsetWidth ?? 0,
    zoom: (document.documentElement.style as unknown as { zoom?: string }).zoom ?? '(none)',
    innerWidth: window.innerWidth,
    anchor: a ? [Math.round(a.left), Math.round(a.right)] : null,
    gapRightOfMore: a ? Math.round(window.innerWidth - a.right) : null,
    panelSide: panel && pr && a ? (pr.right <= a.right + 2 ? 'right-0 (FLIPPED, opens LEFT)' : 'left-0 (opens RIGHT)') : null,
    panelBox: pr ? [Math.round(pr.left), Math.round(pr.right)] : null,
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
const menuItems = async (page: import('@playwright/test').Page) => {
  const panel = page.locator('div.menu-surface').filter({ hasText: 'More actions' }).first();
  if (await panel.count() === 0) return null;
  return (await panel.locator('button').allTextContents()).map(s => s.trim());
};

// Left rail EXPANDED, right rail COLLAPSED, at a chosen zoom.
async function bootLeftOpenRightShut(page: import('@playwright/test').Page, width: number, zoomPct: number) {
  await page.setViewportSize({ width, height: 820 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(400);
  // Apply the zoom the ThemeEditor slider writes (root.style.zoom = pct/100).
  await page.evaluate((z) => {
    document.documentElement.style.zoom = String(z / 100);
    document.documentElement.style.setProperty('--ui-zoom', String(z / 100));
  }, zoomPct);
  await page.waitForTimeout(400);
  // Normalize rails: expand the LEFT one, collapse the RIGHT one.
  for (let i = 0; i < 6; i++) {
    const exps = page.locator('button[data-tip="Expand panel"], button[data-tip="Expandir painel"]');
    const n = await exps.count();
    let acted = false;
    for (let k = 0; k < n; k++) {
      const box = await exps.nth(k).boundingBox();
      if (box && box.x < page.viewportSize()!.width / 2) { await exps.nth(k).click(); acted = true; break; }
    }
    if (!acted) break;
    await page.waitForTimeout(300);
  }
  for (let i = 0; i < 6; i++) {
    const cols = page.locator('button[data-tip="Collapse panel"], button[data-tip="Colapsar painel"]');
    const n = await cols.count();
    let acted = false;
    for (let k = 0; k < n; k++) {
      const box = await cols.nth(k).boundingBox();
      if (box && box.x > page.viewportSize()!.width / 2) { await cols.nth(k).click(); acted = true; break; }
    }
    if (!acted) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(600);
}

test.setTimeout(300_000);

test('legal window + slider zoom + right rail collapsed: does oc=3 survive opening the More menu?', async ({ page }) => {
  for (const zoomPct of [100, 110, 125, 150, 175, 200]) {
    await bootLeftOpenRightShut(page, 1000, zoomPct);
    let found = false;
    for (let w = 960; w <= 1600 && !found; w += 8) {
      await page.setViewportSize({ width: w, height: 820 });
      await page.waitForTimeout(260);
      const oc = rowOverflow(await rowTips(page));
      if (oc !== 3) continue;
      await page.waitForTimeout(1200);                       // settle HARD
      const settled = await rowTips(page);
      if (rowOverflow(settled) !== 3) continue;              // not a resting state here
      const gClosed = await geom(page);

      const more = page.locator('button[data-tip="More"], button[data-tip="Mais"]');
      if (await more.count() === 0) continue;
      await more.click();
      await page.waitForTimeout(700);
      const open = await rowTips(page);
      const gOpen = await geom(page);
      const menu = await menuItems(page);
      const rowHas = has(open, 'Run Profile', 'Executar perfil');
      const menuHas = !!menu && menu.some(t => t.startsWith('Run Profile'));

      console.log(`\n### zoom=${zoomPct}%  viewport=${w}px  (>=960 DIP minimum: ${w >= 960})`);
      console.log(`  CLOSED oc=3  bar=${gClosed?.barW} avail=${gClosed?.available} needed=${gClosed?.needed} unit=${gClosed?.unit}`);
      console.log(`  gap right of More = ${gClosed?.gapRightOfMore}px  (flip needs < ~192 layout px)`);
      console.log(`  OPEN   oc=${rowOverflow(open)}  needed=${gOpen?.needed}  avail=${gOpen?.available}`);
      console.log(`  flyout: ${gOpen?.panelSide}  box=${JSON.stringify(gOpen?.panelBox)}  anchor=${JSON.stringify(gOpen?.anchor)}`);
      console.log(`  row  =`, JSON.stringify(open));
      console.log(`  menu =`, JSON.stringify(menu));
      console.log(`  >>> DUPLICATE VISIBLE = ${rowHas && menuHas}`);
      if (rowHas && menuHas) {
        await page.screenshot({ path: `test-results/skeptic-dup-zoom${zoomPct}-w${w}.png` });
        console.log(`  screenshot: test-results/skeptic-dup-zoom${zoomPct}-w${w}.png`);
      }
      found = true;
      await page.keyboard.press('Escape');
      await page.mouse.click(5, 650);
      await page.waitForTimeout(400);
    }
    if (!found) console.log(`\n### zoom=${zoomPct}%: no resting oc=3 anywhere in 960..1600`);
  }
});
