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

async function boot(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: 780 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(400);
}

// What is actually in the ROW (data-tip attributes of the direct buttons).
const rowTips = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | null;
    if (!row) return [];
    return Array.from(row.querySelectorAll(':scope > button, :scope > div > button'))
      .map(b => b.getAttribute('data-tip'));
  });

// What is in the More ▾ panel.
const menuItems = async (page: import('@playwright/test').Page) => {
  const panel = page.locator('div.menu-surface').filter({ hasText: 'More actions' }).first();
  if (await panel.count() === 0) return null;
  return (await panel.locator('button').allTextContents()).map(s => s.trim());
};

const has = (tips: (string | null)[], en: string, pt: string) =>
  tips.includes(en) || tips.includes(pt);

// Reconstruct overflowCount from the ROW gates alone (they are the consistent set):
//   Clear All out => >=1, Data Loop out => >=2, Activate Window out => >=3, Run Profile out => >=4
function rowOverflow(tips: (string | null)[]) {
  if (!has(tips, 'Run Profile', 'Executar perfil')) return 4;
  if (!has(tips, 'Activate Window', 'Ativar janela')) return 3;
  if (!has(tips, 'Data Loop', 'Data Loop')) return 2;
  if (!has(tips, 'Clear All', 'Limpar tudo')) return 1;
  return 0;
}

test('enumerate the 5 overflowCount states: row instance + menu instance of each collapsing control', async ({ page }) => {
  await boot(page, 1500);
  const seen = new Map<number, { w: number; row: (string | null)[]; menu: string[] | null }>();

  for (let w = 1500; w >= 300; w -= 6) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(70);
    const tips = await rowTips(page);
    const oc = rowOverflow(tips);
    if (seen.has(oc)) continue;
    // Open the More menu (when present) and read its items at this exact width.
    let menu: string[] | null = null;
    const more = page.locator('button[data-tip="More"], button[data-tip="Mais"]');
    if (await more.count() > 0) {
      await more.click();
      await page.waitForTimeout(250);
      menu = await menuItems(page);
      // re-read the row WHILE the menu is open, so we catch a control living in both
      const tipsOpen = await rowTips(page);
      seen.set(oc, { w, row: tipsOpen, menu });
      await page.keyboard.press('Escape');
      await page.mouse.click(5, 500);
      await page.waitForTimeout(200);
    } else {
      seen.set(oc, { w, row: tips, menu: null });
    }
  }

  const CANDS: [string, string, string][] = [
    ['Run Profile', 'Run Profile', 'Executar perfil'],
    ['Activate Window', 'Activate Window', 'Ativar janela'],
    ['Data Loop', 'Data Loop', 'Data Loop'],
    ['Clear All', 'Clear All', 'Limpar tudo'],
  ];

  for (const oc of [0, 1, 2, 3, 4]) {
    const s = seen.get(oc);
    if (!s) { console.log(`overflowCount=${oc}: NOT REACHED in sweep`); continue; }
    console.log(`\n=== overflowCount=${oc}  (viewport ${s.w}px) ===`);
    console.log('  row  :', JSON.stringify(s.row));
    console.log('  menu :', JSON.stringify(s.menu));
    for (const [label, en, pt] of CANDS) {
      const inRow = has(s.row, en, pt);
      const inMenu = !!s.menu && s.menu.some(t => t.startsWith(label));
      const where = inRow && inMenu ? '*** BOTH (DUPLICATE) ***'
        : inRow ? 'row'
        : inMenu ? 'menu'
        : '!!! NOWHERE !!!';
      console.log(`    ${label.padEnd(16)} -> ${where}`);
    }
  }
});

// Second half: does cmd:clearactions still reach anything once Clear All has collapsed?
test('cmd:clearactions in a narrow window, then widen', async ({ page }) => {
  await boot(page, 1500);

  // Narrow until Clear All has left the row (overflowCount >= 1), and settle there.
  let narrow = -1;
  for (let w = 1500; w >= 300; w -= 4) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(70);
    const tips = await rowTips(page);
    if (!has(tips, 'Clear All', 'Limpar tudo')) { narrow = w; break; }
  }
  expect(narrow).toBeGreaterThan(0);
  await page.waitForTimeout(600); // let overflowCount SETTLE — no further changes
  const tipsNarrow = await rowTips(page);
  console.log('narrow width =', narrow, 'overflowCount =', rowOverflow(tipsNarrow));

  const confirm = page.getByText(/Clear all \d+ actions?\?/);
  console.log('before cmd: confirm popovers visible =', await confirm.count());

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('cmd:clearactions')));
  await page.waitForTimeout(500);
  console.log('after  cmd: confirm popovers visible =', await confirm.count(),
    ' (nothing rendered => silent no-op)');
  console.log('row now   :', JSON.stringify(await rowTips(page)));

  // Now widen back until Clear All returns to the row. Does the confirm appear unprompted?
  let back = -1;
  for (let w = narrow; w <= narrow + 400; w += 4) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(80);
    const tips = await rowTips(page);
    if (has(tips, 'Clear All', 'Limpar tudo')) { back = w; break; }
  }
  await page.waitForTimeout(800);
  console.log('Clear All button back at width =', back);
  console.log('UNPROMPTED confirm popovers visible =', await confirm.count());
  if (await confirm.count() > 0) {
    console.log('POPOVER TEXT:', JSON.stringify(await confirm.first().innerText()));
  }
});

// Control: the four other cmd:* listeners point at top-level dialogs, not at a
// branch-nested popover. Prove they still reach their surface at overflowCount>=1.
test('cmd:runprofile / cmd:pause / cmd:sendkeystroke / cmd:sendtext in a narrow window', async ({ page }) => {
  await boot(page, 1500);
  let narrow = -1;
  for (let w = 1500; w >= 300; w -= 4) {
    await page.setViewportSize({ width: w, height: 780 });
    await page.waitForTimeout(70);
    const tips = await rowTips(page);
    if (rowOverflow(tips) >= 3) { narrow = w; break; }
  }
  expect(narrow).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  console.log('narrow width =', narrow, 'overflowCount =', rowOverflow(await rowTips(page)));

  for (const ev of ['cmd:runprofile', 'cmd:pause', 'cmd:sendkeystroke', 'cmd:sendtext']) {
    await page.evaluate((e) => window.dispatchEvent(new CustomEvent(e)), ev);
    await page.waitForTimeout(450);
    const dialogs = page.locator('[role="dialog"]');
    const n = await dialogs.count();
    let title = '';
    if (n > 0) title = (await dialogs.first().innerText()).split('\n').slice(0, 2).join(' / ');
    console.log(`${ev.padEnd(20)} -> [role=dialog] count=${n}  ${JSON.stringify(title)}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
  }
});
