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
  await page.addInitScript(() => {
    (window as any).__out = [];
    (window as any).__esc = 0;
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') (window as any).__esc++;
    });
    const orig = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('→ C#')) {
        try { (window as any).__out.push(JSON.stringify({ t: args[1], p: args[2] })); } catch { /* ignore */ }
      }
      orig(...args);
    };
  });
  await page.setViewportSize({ width, height: 760 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(400);
}

const moreBtn = (page: import('@playwright/test').Page) => page.locator('button[data-tip="Mais"]');
const panel = (page: import('@playwright/test').Page) =>
  page.locator('div.menu-surface').filter({ hasText: 'More actions' }).first();

test('REPLAY path: More menu + armed Clear All across a hotkey run', async ({ page }) => {
  await boot(page, 700);

  console.log('MORE BUTTON PRESENT (overflowCount>0):', await moreBtn(page).count());
  if (await moreBtn(page).count() === 0) {
    console.log('NO OVERFLOW AT 700');
    return;
  }

  await moreBtn(page).click();
  await expect(panel(page)).toBeVisible();
  console.log('MENU ITEMS:', JSON.stringify(await panel(page).locator('button').allTextContents()));

  await panel(page).getByRole('button', { name: /Clear All/ }).click();
  await page.waitForTimeout(150);
  const armedText = await panel(page).innerText();
  console.log('ARMED PANEL TEXT:', JSON.stringify(armedText));

  // ── the hotkey run starts: NO mousedown, NO Escape ──
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'actions:highlight', payload: { index: 1 } });
  await post(page, { type: 'button:states', payload: btnStates({ replayActive: true, replayButtonText: 'Stop' }) });
  await page.waitForTimeout(400);

  console.log('DURING RUN — panel count:', await panel(page).count(), 'more btn count:', await moreBtn(page).count());
  console.log('DURING RUN — more btn disabled:', await moreBtn(page).first().isDisabled().catch(() => 'n/a'));

  // keyboard-only hotkey scenario: no Escape, no click, nothing touched.

  // ── run ends ──
  await post(page, { type: 'button:states', payload: btnStates({ replayActive: false, replayButtonText: 'Replay' }) });
  await page.waitForTimeout(500);

  const reappeared = await panel(page).count();
  console.log('AFTER RUN — panel reappeared:', reappeared);
  if (reappeared > 0) {
    console.log('AFTER RUN — panel text:', JSON.stringify(await panel(page).innerText()));
    const red = panel(page).getByRole('button', { name: 'Clear all', exact: true });
    console.log('AFTER RUN — red Clear all present:', await red.count(), 'disabled:', await red.count() ? await red.isDisabled() : 'n/a');
    if (await red.count()) {
      await red.click();
      await page.waitForTimeout(250);
      console.log('BRIDGE OUT:', JSON.stringify(await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('actions:')))));
    }
  }
});

test('CLICKER path: ScrLk flips useCursorClick with the menu armed', async ({ page }) => {
  await boot(page, 700);
  if (await moreBtn(page).count() === 0) { console.log('NO OVERFLOW AT 700'); return; }

  await moreBtn(page).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('button', { name: /Clear All/ }).click();
  await page.waitForTimeout(150);
  console.log('ARMED BEFORE SCRLK:', JSON.stringify(await panel(page).innerText()));

  await post(page, { type: 'settings:loaded', payload: { settings: { useCursorClick: true } } });
  await page.waitForTimeout(400);
  console.log('IN CLICKER — panel count:', await panel(page).count(), 'more btn count:', await moreBtn(page).count());

  await post(page, { type: 'settings:loaded', payload: { settings: { useCursorClick: false } } });
  await page.waitForTimeout(500);
  console.log('BACK IN MACRO — panel count:', await panel(page).count());
  if (await panel(page).count()) console.log('BACK IN MACRO — panel text:', JSON.stringify(await panel(page).innerText()));
});
