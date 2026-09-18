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
  copiedCount: 2, ...over,
});

// 0 If  | 1 Click(delay 5000) | 2 EndIf
const rows = (ifSkipped: boolean, bodySkipped = false) => [
  base({ id: 'a', actionType: 'If', rowNumber: 1, isSkipped: ifSkipped }),
  base({ id: 'b', actionType: 'LeftClick', x: 20, y: 20, delay: 5000, rowNumber: 2, isSkipped: bodySkipped }),
  base({ id: 'c', actionType: 'EndIf', rowNumber: 3 }),
];

async function boot(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    (window as any).__out = [];
    const orig = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('C#')) {
        try { (window as any).__out.push(JSON.stringify({ t: args[1], p: args[2] })); } catch { /* ignore */ }
      }
      orig(...args);
    };
  });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'button:states', payload: btnStates({}) });
}

const sent = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('actions:')));

const clearSent = (page: import('@playwright/test').Page) =>
  page.evaluate(() => { (window as any).__out = []; });

async function dumpRow(page: import('@playwright/test').Page, idx: number, tag: string) {
  const tr = page.locator('tr[data-row-index="' + idx + '"]');
  const cls = await tr.getAttribute('class');
  const opacity = await tr.evaluate((el) => getComputedStyle(el).opacity);
  const pillDeco = await tr.locator('span.inline-flex').first().evaluate((el) => getComputedStyle(el).textDecorationLine);
  const svgs = await tr.locator('svg').evaluateAll((els) => els.map((e) => e.getAttribute('class')));
  console.log('ROW' + idx + ' ' + tag + ' :: opacity=' + opacity + ' pillTextDecoration=' + pillDeco + ' hasOpacity40Class=' + /opacity-40/.test(cls ?? ''));
  console.log('ROW' + idx + ' ' + tag + ' :: svg classes = ' + JSON.stringify(svgs));
}

test('A. body row inside a SKIPPED opener: render vs menu offer', async ({ page }) => {
  await boot(page);
  await post(page, { type: 'actions:updated', payload: { actions: rows(true) } });
  await page.waitForTimeout(250);

  await dumpRow(page, 0, '(If, raw isSkipped=TRUE)');
  await dumpRow(page, 1, '(Click, raw isSkipped=FALSE)');
  await dumpRow(page, 2, '(EndIf, raw isSkipped=FALSE)');

  console.log('PAGE TEXT:', (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 500));

  const row1 = page.locator('tr[data-row-index="1"]');
  await row1.click({ button: 'right' });
  const menu = page.locator('div.menu-surface').filter({ hasText: 'Duplicate' }).first();
  await expect(menu).toBeVisible();

  const skipBtn = menu.locator('button').filter({ hasText: /^(Skip|Enable)/ }).first();
  const label = (await skipBtn.innerText()).trim();
  const icon = await skipBtn.locator('svg').first().getAttribute('class');
  const tip = await skipBtn.getAttribute('data-tip');
  console.log('MENU ON BODY ROW :: label = ' + JSON.stringify(label) + ' | icon = ' + JSON.stringify(icon) + ' | tip = ' + JSON.stringify(tip));

  await clearSent(page);
  await skipBtn.click();
  await page.waitForTimeout(300);
  console.log('BRIDGE OUT (menu skip on body row): ' + JSON.stringify(await sent(page)));
  const body = await page.locator('body').innerText();
  console.log('TOAST: ' + JSON.stringify(body.split('\n').filter(l => /action\(s\)/i.test(l))));
});

test('B. after the backend writes isSkipped on the body row, does anything change?', async ({ page }) => {
  await boot(page);
  await post(page, { type: 'actions:updated', payload: { actions: rows(true, false) } });
  await page.waitForTimeout(250);
  const beforeHtml = await page.locator('tr[data-row-index="1"]').innerHTML();
  const beforeStatus = (await page.locator('body').innerText()).replace(/\n+/g, ' | ');

  // exactly what HandleActionsToggleSkip([1]) produces: allSkipped(false) -> newState true
  await post(page, { type: 'actions:updated', payload: { actions: rows(true, true) } });
  await page.waitForTimeout(250);
  const afterHtml = await page.locator('tr[data-row-index="1"]').innerHTML();
  const afterStatus = (await page.locator('body').innerText()).replace(/\n+/g, ' | ');
  console.log('ROW1 HTML IDENTICAL AFTER THE WRITE: ' + (beforeHtml === afterHtml));
  console.log('PAGE TEXT IDENTICAL AFTER THE WRITE: ' + (beforeStatus === afterStatus));

  // now the user re-enables the opener: HandleActionsToggleSkip([0]) -> false
  await post(page, { type: 'actions:updated', payload: { actions: rows(false, true) } });
  await page.waitForTimeout(250);
  await dumpRow(page, 0, '(If re-enabled)');
  await dumpRow(page, 1, '(Click, hidden flag now TRUE)');
  const row1 = page.locator('tr[data-row-index="1"]');
  await row1.click({ button: 'right' });
  const menu = page.locator('div.menu-surface').filter({ hasText: 'Duplicate' }).first();
  const skipBtn = menu.locator('button').filter({ hasText: /^(Skip|Enable)/ }).first();
  console.log('MENU AFTER RE-ENABLE :: label = ' + JSON.stringify((await skipBtn.innerText()).trim()));
});

test('C. CONTROL - reachability: can a LONE opener be skipped from the UI?', async ({ page }) => {
  await boot(page);
  await post(page, { type: 'actions:updated', payload: { actions: rows(false) } });
  await page.waitForTimeout(250);

  await page.locator('tr[data-row-index="0"]').click();
  await page.waitForTimeout(250);
  const selected = await page.locator('tr[aria-selected="true"]').evaluateAll((els) => els.map(e => e.getAttribute('data-row-index')));
  console.log('SELECTED AFTER CLICKING THE IF ROW: ' + JSON.stringify(selected));

  await clearSent(page);
  const bulkSkip = page.locator('button').filter({ hasText: /^(Skip|Enable)$/ }).last();
  console.log('BULK BAR SKIP VISIBLE: ' + (await bulkSkip.isVisible()) + ' | disabled: ' + (await bulkSkip.isDisabled()));
  await bulkSkip.click();
  await page.waitForTimeout(300);
  console.log('BRIDGE OUT (bulk skip on lone If): ' + JSON.stringify(await sent(page)));

  await post(page, { type: 'actions:updated', payload: { actions: rows(false) } });
  await page.waitForTimeout(150);
  await page.locator('tr[data-row-index="0"]').click({ button: 'right' });
  const menu = page.locator('div.menu-surface').filter({ hasText: 'Duplicate' }).first();
  const skipBtn = menu.locator('button').filter({ hasText: /^(Skip|Enable)/ }).first();
  await clearSent(page);
  await skipBtn.click();
  await page.waitForTimeout(300);
  console.log('BRIDGE OUT (ctx skip on lone If): ' + JSON.stringify(await sent(page)));
});

test('D. CONTROL - a plain row outside any block reads its own flag', async ({ page }) => {
  await boot(page);
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'p', actionType: 'LeftClick', rowNumber: 1, isSkipped: true }),
    base({ id: 'q', actionType: 'LeftClick', rowNumber: 2, isSkipped: false }),
  ] } });
  await page.waitForTimeout(250);
  for (const i of [0, 1]) {
    await page.locator('tr[data-row-index="' + i + '"]').click({ button: 'right' });
    const menu = page.locator('div.menu-surface').filter({ hasText: 'Duplicate' }).first();
    const skipBtn = menu.locator('button').filter({ hasText: /^(Skip|Enable)/ }).first();
    console.log('PLAIN ROW' + i + ' menu label = ' + JSON.stringify((await skipBtn.innerText()).trim()));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
});

test('E. the CLOSER row of a skipped block offers the same thing', async ({ page }) => {
  await boot(page);
  await post(page, { type: 'actions:updated', payload: { actions: rows(true) } });
  await page.waitForTimeout(250);
  await page.locator('tr[data-row-index="2"]').click({ button: 'right' });
  const menu = page.locator('div.menu-surface').filter({ hasText: 'Duplicate' }).first();
  const skipBtn = menu.locator('button').filter({ hasText: /^(Skip|Enable)/ }).first();
  console.log('ENDIF ROW menu label = ' + JSON.stringify((await skipBtn.innerText()).trim()));
  await clearSent(page);
  await skipBtn.click();
  await page.waitForTimeout(300);
  console.log('BRIDGE OUT (ctx skip on EndIf of a skipped block): ' + JSON.stringify(await sent(page)));
});
