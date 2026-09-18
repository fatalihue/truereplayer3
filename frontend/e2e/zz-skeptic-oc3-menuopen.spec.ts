import { test, expect } from '@playwright/test';

// Decisive probe: the More menu's CONTENTS are only observable while the menu is OPEN.
// So the only state in which a "duplicate" could be SEEN is: menu open. Does opening the
// menu change overflowCount? (The w-56 flyout is a descendant of the measured row, and
// fit() uses row.scrollWidth.)

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

const deep = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | null;
  if (!row) return null;
  const bar = row.parentElement as HTMLElement;
  const cs = getComputedStyle(bar);
  const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
  const panel = Array.from(document.querySelectorAll('div.menu-surface'))
    .find(d => (d as HTMLElement).innerText.includes('More actions')) as HTMLElement | undefined;
  const moreBtn = document.querySelector('button[data-tip="More"], button[data-tip="Mais"]') as HTMLElement | null;
  const anchor = moreBtn?.parentElement as HTMLElement | null;
  const a = anchor?.getBoundingClientRect();
  return {
    available: Math.round((bar.clientWidth - pad - parseFloat(cs.columnGap || '0')) * 10) / 10,
    needed_scrollW: row.scrollWidth,
    unit: (row.querySelector('[data-tb-unit]') as HTMLElement | null)?.offsetWidth ?? 0,
    panelOpen: !!panel,
    panelClass: panel ? panel.className.split(' ').filter(c => c === 'left-0' || c === 'right-0').join('|') : null,
    panelW: panel ? Math.round(panel.getBoundingClientRect().width) : null,
    panelRight: panel ? Math.round(panel.getBoundingClientRect().right) : null,
    anchorLeft: a ? Math.round(a.left) : null,
    anchorRight: a ? Math.round(a.right) : null,
    innerWidth: window.innerWidth,
    zoom: (document.documentElement.style as unknown as { zoom?: string }).zoom ?? '(none)',
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

async function bootRailsExpanded(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(500);
  for (let i = 0; i < 4; i++) {
    const exp = page.locator('button[data-tip="Expand panel"], button[data-tip="Expandir painel"]');
    if (await exp.count() === 0) break;
    await exp.first().click();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(600);
}

test.setTimeout(180_000);

test('oc=3 band at REAL widths: open the More menu and look at both lists together', async ({ page }) => {
  await bootRailsExpanded(page, 1008);
  await page.waitForTimeout(1500);

  for (const w of [996, 1004, 1012, 1020]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(1200);
    const before = await rowTips(page);
    const ocBefore = rowOverflow(before);
    const dBefore = await deep(page);

    const more = page.locator('button[data-tip="More"], button[data-tip="Mais"]');
    if (await more.count() === 0) { console.log(`viewport ${w}: no More button (oc=${ocBefore})`); continue; }
    await more.click();
    await page.waitForTimeout(700);

    const after = await rowTips(page);
    const ocAfter = rowOverflow(after);
    const dAfter = await deep(page);
    const menu = await menuItems(page);
    const rowHasRun = has(after, 'Run Profile', 'Executar perfil');
    const menuHasRun = !!menu && menu.some(t => t.startsWith('Run Profile'));

    console.log(`\n=== viewport ${w} ===`);
    console.log(`  CLOSED: oc=${ocBefore}  needed(scrollW)=${dBefore?.needed_scrollW}  available=${dBefore?.available}  unit=${dBefore?.unit}`);
    console.log(`  OPEN  : oc=${ocAfter}  needed(scrollW)=${dAfter?.needed_scrollW}  available=${dAfter?.available}`);
    console.log(`  flyout side=${dAfter?.panelClass}  w=${dAfter?.panelW}  right=${dAfter?.panelRight}  anchor=[${dAfter?.anchorLeft},${dAfter?.anchorRight}]  innerWidth=${dAfter?.innerWidth}  zoom=${dAfter?.zoom}`);
    console.log(`  row  (open) =`, JSON.stringify(after));
    console.log(`  menu        =`, JSON.stringify(menu));
    console.log(`  >>> Run Profile in ROW=${rowHasRun}  in MENU=${menuHasRun}  => DUPLICATE VISIBLE = ${rowHasRun && menuHasRun}`);

    await page.keyboard.press('Escape');
    await page.mouse.click(5, 600);
    await page.waitForTimeout(600);
  }
});

test('the accusers 654px harness width: is the flyout flipped there, and is that width legal?', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 800 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(400);

  for (let w = 1500; w >= 600; w -= 6) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(70);
    const oc = rowOverflow(await rowTips(page));
    if (oc === 3) {
      await page.waitForTimeout(900);
      const t = await rowTips(page);
      if (rowOverflow(t) !== 3) continue;
      const more = page.locator('button[data-tip="More"], button[data-tip="Mais"]');
      await more.click();
      await page.waitForTimeout(600);
      const after = await rowTips(page);
      const d = await deep(page);
      const menu = await menuItems(page);
      console.log(`\n=== accuser-style sweep landed at viewport ${w} (below the 960 DIP window minimum? ${w < 960}) ===`);
      console.log(`  flyout side=${d?.panelClass}  anchorRight=${d?.anchorRight}  innerWidth=${d?.innerWidth}`);
      console.log(`  oc with menu open = ${rowOverflow(after)}`);
      console.log(`  row  =`, JSON.stringify(after));
      console.log(`  menu =`, JSON.stringify(menu));
      console.log(`  >>> DUPLICATE VISIBLE = ${has(after, 'Run Profile', 'Executar perfil') && !!menu && menu.some(x => x.startsWith('Run Profile'))}`);
      break;
    }
  }
});
