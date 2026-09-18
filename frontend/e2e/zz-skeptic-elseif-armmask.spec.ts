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

// 0 If(ImageFound) | 1 Click(100) | 2 ElseIf | 3 SendText(5000) | 4 Else | 5 Click(100) | 6 EndIf
const rows = (o: { elseIfSkip?: boolean; ifSkip?: boolean; bodySkip?: boolean } = {}) => [
  base({ id: 'a', actionType: 'If', rowNumber: 1, isSkipped: !!o.ifSkip, conditionType: 'ImageFound' }),
  base({ id: 'b', actionType: 'LeftClick', x: 20, y: 20, delay: 100, rowNumber: 2 }),
  base({ id: 'c', actionType: 'ElseIf', rowNumber: 3, isSkipped: !!o.elseIfSkip, conditionType: 'WindowOpen' }),
  base({ id: 'd', actionType: 'SendText', key: 'hello', delay: 5000, rowNumber: 4, isSkipped: !!o.bodySkip }),
  base({ id: 'e', actionType: 'Else', rowNumber: 5 }),
  base({ id: 'f', actionType: 'LeftClick', x: 30, y: 30, delay: 100, rowNumber: 6 }),
  base({ id: 'g', actionType: 'EndIf', rowNumber: 7 }),
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

async function paint(page: import('@playwright/test').Page, idx: number) {
  const tr = page.locator('tr[data-row-index="' + idx + '"]');
  const cls = (await tr.getAttribute('class')) ?? '';
  const opacity = await tr.evaluate((el) => getComputedStyle(el).opacity);
  const deco = await tr.locator('span.inline-flex').first().evaluate((el) => getComputedStyle(el).textDecorationLine);
  const eyeOff = await tr.locator('svg.lucide-eye-off').count();
  return { dimClass: /opacity-40/.test(cls), opacity, deco, eyeOff };
}

async function estimate(page: import('@playwright/test').Page) {
  const txt = await page.locator('body').innerText();
  const m = txt.match(/~\s*([0-9hmsp.,  ]+)/);
  return m ? m[1].trim() : '(no estimate chip)';
}

test('1. ElseIf marked Skip: does the ARM BODY dim, and does the estimate drop?', async ({ page }) => {
  await boot(page);

  await post(page, { type: 'actions:updated', payload: { actions: rows({}) } });
  await page.waitForTimeout(300);
  const estBaseline = await estimate(page);
  console.log('BASELINE (nothing skipped)      estimate = ' + estBaseline);

  await post(page, { type: 'actions:updated', payload: { actions: rows({ elseIfSkip: true }) } });
  await page.waitForTimeout(300);
  const estArmSkipped = await estimate(page);
  console.log('ELSEIF SKIPPED                  estimate = ' + estArmSkipped);
  console.log('ROW2 (the ElseIf marker)  paint = ' + JSON.stringify(await paint(page, 2)));
  console.log('ROW3 (SendText 5000, ARM BODY) paint = ' + JSON.stringify(await paint(page, 3)));
  console.log('ROW5 (Else arm body, control)  paint = ' + JSON.stringify(await paint(page, 5)));

  await post(page, { type: 'actions:updated', payload: { actions: rows({ ifSkip: true }) } });
  await page.waitForTimeout(300);
  console.log('CONTROL: IF SKIPPED             estimate = ' + await estimate(page));
  console.log('CONTROL ROW3 paint = ' + JSON.stringify(await paint(page, 3)));

  await post(page, { type: 'actions:updated', payload: { actions: rows({ bodySkip: true }) } });
  await page.waitForTimeout(300);
  console.log('CONTROL: SENDTEXT ROW SKIPPED   estimate = ' + await estimate(page));

  console.log('VERDICT-INPUT: baseline=' + estBaseline + ' armSkipped=' + estArmSkipped
    + ' identical=' + (estBaseline === estArmSkipped));
});

test('2. REACHABILITY: can one click mark a lone ElseIf as Skip?', async ({ page }) => {
  await boot(page);
  await post(page, { type: 'actions:updated', payload: { actions: rows({}) } });
  await page.waitForTimeout(300);

  // right-click the ElseIf row WITHOUT selecting anything first
  await page.locator('tr[data-row-index="2"]').click({ button: 'right' });
  const menu = page.locator('div.menu-surface').filter({ hasText: 'Duplicate' }).first();
  await expect(menu).toBeVisible();
  const skipBtn = menu.locator('button').filter({ hasText: /^(Skip|Enable)/ }).first();
  const present = await skipBtn.count();
  console.log('CTX MENU ON ELSEIF :: Skip entry present = ' + present
    + ' | label = ' + (present ? JSON.stringify((await skipBtn.innerText()).trim()) : 'n/a'));

  await page.evaluate(() => { (window as any).__out = []; });
  await skipBtn.click();
  await page.waitForTimeout(400);
  const outs = await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('toggleSkip')));
  console.log('BRIDGE OUT (ctx Skip on lone ElseIf): ' + JSON.stringify(outs));
});
