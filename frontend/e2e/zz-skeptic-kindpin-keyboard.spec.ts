import { test, expect } from '@playwright/test';

const initScript = () => {
  (window as unknown as { __sent: unknown[] }).__sent = [];
  const listeners = new Set<(e: { data: unknown }) => void>();
  const w = window as unknown as { chrome?: Record<string, unknown> };
  w.chrome = w.chrome || {};
  (w.chrome as Record<string, unknown>).webview = {
    postMessage: (m: unknown) => {
      (window as unknown as { __sent: unknown[] }).__sent.push(JSON.parse(JSON.stringify(m)));
    },
    addEventListener: (_t: string, h: (e: { data: unknown }) => void) => { listeners.add(h); },
    removeEventListener: (_t: string, h: (e: { data: unknown }) => void) => { listeners.delete(h); },
  };
  window.addEventListener('message', (e: MessageEvent) => {
    listeners.forEach((h) => h({ data: e.data }));
  });
};

function post(page: import('@playwright/test').Page, msg: unknown) {
  return page.evaluate((m) => window.postMessage(m, '*'), msg);
}

const base = (over: Record<string, unknown>) => ({
  id: 'x', actionType: 'LeftClick', key: '', x: 0, y: 0, delay: 0, comment: '',
  rowNumber: 1, isInsertionPoint: false, shouldHighlight: false, imagePath: '',
  timeout: 5000, confidence: 0.8, imageBase64: '', browserText: '', newTab: false,
  isSkipped: false, atCursor: false, repeatCount: 1, repeatDelayMs: null,
  repeatDelayJitterPct: null, repeatPositionJitterPx: null, holdDurationMs: 0, ...over,
});

const btnStates = {
  recordEnabled: true, replayEnabled: true, recordingActive: false,
  replayActive: false, recordButtonText: 'Recording', replayButtonText: 'Replay',
  canUndo: false, canRedo: false, copiedCount: 0,
};

async function openSheetOnPair(page: import('@playwright/test').Page) {
  await page.addInitScript(initScript);
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'a', actionType: 'LeftClickDown', x: 400, y: 300, rowNumber: 1 }),
    base({ id: 'b', actionType: 'LeftClickUp', x: 400, y: 300, rowNumber: 2 }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await page.locator('tr[data-row-index="0"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await page.waitForTimeout(400);
}

const focusInfo = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return a ? `${a.tagName}[${a.getAttribute('role') ?? ''}] "${(a.innerText || '').trim()}"` : 'none';
  });

test('KIND pin: reachable by TAB and activated by SPACE?', async ({ page }) => {
  await openSheetOnPair(page);

  const kind = page.getByRole('tablist', { name: 'Click kind' });
  const button = page.getByRole('tablist', { name: 'Mouse button' });

  console.log('[STATE] header =', await page.locator('div.font-display.truncate').first().innerText());
  console.log('[STATE] kind pointer-events =', await kind.evaluate(e => getComputedStyle(e).pointerEvents));
  console.log('[STATE] kind class =', await kind.getAttribute('class'));
  console.log('[STATE] kind active BEFORE =', await kind.getByRole('tab', { selected: true }).innerText());
  const holdAttrs = await kind.getByRole('tab', { name: 'Hold' }).evaluate((e: HTMLButtonElement) => ({
    disabled: e.disabled, tabIndex: e.tabIndex, ariaDisabled: e.getAttribute('aria-disabled'),
    pe: getComputedStyle(e).pointerEvents,
  }));
  console.log('[STATE] Hold segment attrs =', JSON.stringify(holdAttrs));

  // Focus the Button axis "Left" (NOT pinned) then walk the real tab order.
  await button.getByRole('tab', { name: 'Left' }).click();
  console.log('[TAB0] focus =', await focusInfo(page));
  for (let i = 1; i <= 4; i++) {
    await page.keyboard.press('Tab');
    console.log(`[TAB${i}] focus =`, await focusInfo(page));
  }

  await page.evaluate(() => { (window as unknown as { __sent: unknown[] }).__sent = []; });
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);

  console.log('[AFTER SPACE] header =', await page.locator('div.font-display.truncate').first().innerText());
  console.log('[AFTER SPACE] kind active =', await kind.getByRole('tab', { selected: true }).innerText());
  console.log('[AFTER SPACE] kind pointer-events =', await kind.evaluate(e => getComputedStyle(e).pointerEvents));
  console.log('[AFTER SPACE] "↓ press" badge still shown =', await page.getByText('↓ press').count());

  const saveBtn = page.getByRole('button', { name: /^Save$/ }).last();
  console.log('[SAVE] disabled =', await saveBtn.isDisabled());
  await saveBtn.click();
  await page.waitForTimeout(400);

  const sent = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent);
  console.log('[SENT] ' + JSON.stringify(sent, null, 1));
});

test('KIND pin: Double via keyboard (Enter instead of Space)', async ({ page }) => {
  await openSheetOnPair(page);
  const kind = page.getByRole('tablist', { name: 'Click kind' });
  await kind.getByRole('tab', { name: 'Double' }).focus();
  console.log('[FOCUS] =', await focusInfo(page));
  await page.evaluate(() => { (window as unknown as { __sent: unknown[] }).__sent = []; });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  console.log('[AFTER ENTER] header =', await page.locator('div.font-display.truncate').first().innerText());
  console.log('[AFTER ENTER] kind active =', await kind.getByRole('tab', { selected: true }).innerText());
  const saveBtn = page.getByRole('button', { name: /^Save$/ }).last();
  console.log('[SAVE] disabled =', await saveBtn.isDisabled());
  await saveBtn.click();
  await page.waitForTimeout(400);
  console.log('[SENT] ' + JSON.stringify(await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent), null, 1));
});

test('CONTROL: mouse click on the pinned Hold does nothing', async ({ page }) => {
  await openSheetOnPair(page);
  const kind = page.getByRole('tablist', { name: 'Click kind' });
  await kind.getByRole('tab', { name: 'Hold' }).click({ force: true, timeout: 3000 }).catch(e => console.log('[MOUSE] click threw:', String(e).slice(0, 120)));
  await page.waitForTimeout(300);
  console.log('[MOUSE AFTER] header =', await page.locator('div.font-display.truncate').first().innerText());
  console.log('[MOUSE AFTER] kind active =', await kind.getByRole('tab', { selected: true }).innerText());
});
