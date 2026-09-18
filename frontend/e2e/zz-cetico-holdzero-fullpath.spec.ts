import { test, expect } from '@playwright/test';

// TRACE skeptic: does the row menu's "Change click type -> Hold Left" really leave a
// *ClickHold row whose holdDurationMs is 0, and does the Sheet then open DIRTY on it?

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
  recordEnabled: true, replayEnabled: true, recordingActive: false, replayActive: false,
  recordButtonText: 'Recording', replayButtonText: 'Replay', canUndo: false, canRedo: false,
  copiedCount: 0,
};

async function boot(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    (window as any).__out = [];
    const orig = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('→ C#')) {
        try { (window as any).__out.push(JSON.stringify({ t: args[1], p: args[2] })); } catch { /* ignore */ }
      }
      orig(...args);
    };
  });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
}

const wire = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).__out as string[]);

// STEP 1 — the UI route: a plain LeftClick row, row menu, Hold Left.
test('route: row menu Change click type -> Hold Left sends bulkUpdateType', async ({ page }) => {
  await boot(page);
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'a', actionType: 'LeftClick', x: 10, y: 10, rowNumber: 1 }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await expect(page.locator('tr[data-row-index="0"]')).toBeVisible();

  await page.locator('tr[data-row-index="0"]').click({ button: 'right' });
  const parent = page.getByRole('button', { name: /Change click type/ });
  await expect(parent).toBeVisible();
  await parent.hover();
  const holdChip = page.getByRole('button', { name: /^Hold Left/ });
  await expect(holdChip).toBeVisible();
  await holdChip.click();
  await page.waitForTimeout(250);
  const out = (await wire(page)).filter(s => s.includes('bulkUpdateType'));
  console.log('ROUTE WIRE:', JSON.stringify(out));
  expect(out.join(' ')).toContain('LeftClickHold');
});

// STEP 2 — the resulting store row (exactly what HandleBulkUpdateType leaves behind:
// ActionType rewritten, HoldDurationMs untouched at 0) opened in the Sheet.
async function openSheetOn(page: import('@playwright/test').Page, holdDurationMs: number) {
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'a', actionType: 'LeftClickHold', holdDurationMs, x: 10, y: 10, rowNumber: 1 }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await page.locator('tr[data-row-index="0"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await expect(page.getByRole('button', { name: /^Save$/ })).toHaveCount(2);
  await page.waitForTimeout(400);
}

function footerSpan(page: import('@playwright/test').Page) {
  return page.locator('div.flex.items-center.justify-between span.truncate').last();
}

async function report(page: import('@playwright/test').Page, label: string) {
  const span = footerSpan(page);
  const text = (await span.innerText()).trim();
  const opacity = await span.evaluate(e => getComputedStyle(e).opacity);
  const cancelLabel = await page.locator('button', { hasText: /^(Cancel|Discard)$/ }).last().innerText();
  const backTip = await page.getByRole('button', { name: /Discard changes|^Back$/ }).first().getAttribute('aria-label');
  console.log(`[${label}] footer="${text}" opacity=${opacity} cancelBtn="${cancelLabel.trim()}" backAria="${backTip}"`);
  return { text, opacity, cancelLabel: cancelLabel.trim(), backTip };
}

test('DUR 0 (what the row menu leaves): Sheet opens dirty, Esc does not close', async ({ page }) => {
  await boot(page);
  await openSheetOn(page, 0);
  const r = await report(page, 'DUR_0');
  expect(r.opacity).toBe('1');
  expect(r.cancelLabel).toBe('Discard');
  expect(r.backTip).toBe('Discard changes');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const stillOpen = (await page.getByRole('button', { name: /^Save$/ }).count()) === 2;
  const armed = (await footerSpan(page).innerText()).trim();
  console.log(`[DUR_0] after 1st Esc: panelOpen=${stillOpen} footer="${armed}"`);
  expect(stillOpen).toBe(true);
  expect(armed).toBe('Esc again discards');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const body = await page.locator('body').innerText();
  console.log(`[DUR_0] after 2nd Esc: panelOpen=${await page.getByRole('button', { name: /^Save$/ }).count()} toast=${body.includes('Changes discarded') || body.includes('Altera')}`);
});

test('DUR 1000 (control): Sheet opens clean, first Esc closes', async ({ page }) => {
  await boot(page);
  await openSheetOn(page, 1000);
  const r = await report(page, 'DUR_1000');
  expect(r.opacity).toBe('0');
  expect(r.cancelLabel).toBe('Cancel');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const open = await page.getByRole('button', { name: /^Save$/ }).count();
  console.log(`[DUR_1000] after 1st Esc: saveButtons=${open} (2 = sheet open, 1 = closed)`);
  expect(open).toBe(1);
});

test('DUR 0: an untouched Save writes holdDurationMs on the wire', async ({ page }) => {
  await boot(page);
  await openSheetOn(page, 0);
  await page.getByRole('button', { name: /^Save$/ }).last().click();
  await page.waitForTimeout(300);
  const out = (await wire(page)).filter(s => s.includes('actions:edit'));
  console.log('SAVE WIRE (untouched):', JSON.stringify(out));
  expect(out.join(' ')).toContain('holdDurationMs');
});
