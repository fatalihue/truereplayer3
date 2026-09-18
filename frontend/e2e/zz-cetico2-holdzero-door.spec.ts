import { test, expect } from '@playwright/test';

// Second skeptic pass, written from scratch: drive the REAL row menu, capture the REAL wire
// message, apply the C# rule from HandleBulkUpdateType BY HAND (ActionType = value; the dwell
// reset is skipped because the target ends with "ClickHold"), push the result back, then open
// the row editor the way the pencil does and read the dirty surfaces.

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
    (window as any).__wire = [];
    const orig = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('→ C#')) {
        try { (window as any).__wire.push({ type: args[1], payload: args[2] }); } catch { /* ignore */ }
      }
      orig(...args);
    };
  });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
}

const wire = (page: import('@playwright/test').Page) =>
  page.evaluate(() => JSON.parse(JSON.stringify((window as any).__wire)) as { type: string; payload: any }[]);

function footerSpan(page: import('@playwright/test').Page) {
  return page.locator('div.flex.items-center.justify-between span.truncate').last();
}

// The C# rule, transcribed from Source/WebViewBridge.cs HandleBulkUpdateType.
function applyBulkUpdateType(row: any, value: string) {
  const next = { ...row, actionType: value };
  const isCombined = ['LeftClick', 'RightClick', 'MiddleClick', 'DoubleClick', 'TripleClick',
    'LeftClickHold', 'RightClickHold', 'MiddleClickHold'].includes(value);
  if (!isCombined) next.atCursor = false;
  if (value !== 'HoldKey' && !value.endsWith('ClickHold')) next.holdDurationMs = 0;
  return next;
}

test('door to door: recorded LeftClick -> menu Hold Left -> pencil -> dirty?', async ({ page }) => {
  await boot(page);

  // A row as RECORDING leaves it: HoldDurationMs = 0 (int default, always serialized).
  const recorded = base({ id: 'a', actionType: 'LeftClick', x: 640, y: 480, rowNumber: 1, delay: 100 });
  await post(page, { type: 'actions:updated', payload: { actions: [recorded] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await expect(page.locator('tr[data-row-index="0"]')).toBeVisible();

  // --- the menu door ---
  await page.locator('tr[data-row-index="0"]').click({ button: 'right' });
  const parent = page.getByRole('button', { name: /Change click type/ });
  await expect(parent).toBeVisible();
  await parent.hover();
  const holdChip = page.getByRole('button', { name: /^Hold Left/ });
  await expect(holdChip).toBeVisible();
  await holdChip.click();
  await page.waitForTimeout(250);

  const sent = (await wire(page)).filter(m => m.type === 'actions:bulkUpdateType');
  console.log('WIRE bulkUpdateType:', JSON.stringify(sent));
  expect(sent.length).toBe(1);
  expect(sent[0].payload.actionType).toBe('LeftClickHold');

  // --- what the backend leaves behind, by its own rule ---
  const converted = applyBulkUpdateType(recorded, sent[0].payload.actionType);
  console.log('STORE ROW AFTER CONVERT:', JSON.stringify({ actionType: converted.actionType, holdDurationMs: converted.holdDurationMs }));
  expect(converted.holdDurationMs).toBe(0);

  await post(page, { type: 'actions:updated', payload: { actions: [converted] } });
  await page.waitForTimeout(150);

  // The grid's own reading of that row (the claim says it shows 1000 ms and does not lie).
  const rowText = (await page.locator('tr[data-row-index="0"]').innerText()).replace(/\s+/g, ' ');
  console.log('GRID ROW TEXT:', rowText);

  // --- the pencil door ---
  await page.locator('tr[data-row-index="0"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await expect(page.getByRole('button', { name: /^Save$/ })).toHaveCount(2);
  await page.waitForTimeout(400);

  const span = footerSpan(page);
  const text = (await span.innerText()).trim();
  const opacity = await span.evaluate(e => getComputedStyle(e).opacity);
  const cancelLabel = (await page.locator('button', { hasText: /^(Cancel|Discard)$/ }).last().innerText()).trim();
  const backAria = await page.getByRole('button', { name: /Discard changes|^Back$/ }).first().getAttribute('aria-label');
  console.log(`UNTOUCHED: footer="${text}" opacity=${opacity} secondaryBtn="${cancelLabel}" backAria="${backAria}"`);

  // --- Esc, twice ---
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const open1 = (await page.getByRole('button', { name: /^Save$/ }).count()) === 2;
  const armedText = open1 ? (await footerSpan(page).innerText()).trim() : 'n/a';
  console.log(`AFTER 1st ESC: panelOpen=${open1} footer="${armedText}"`);

  if (open1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    const open2 = (await page.getByRole('button', { name: /^Save$/ }).count()) === 2;
    const body = await page.locator('body').innerText();
    console.log(`AFTER 2nd ESC: panelOpen=${open2} toast=${body.includes('Changes discarded') || body.includes('Altera')}`);
  }
});

test('control A: same door, target LeftClick (non-hold) -> clean', async ({ page }) => {
  await boot(page);
  const recorded = base({ id: 'a', actionType: 'RightClick', x: 640, y: 480, rowNumber: 1, delay: 100 });
  await post(page, { type: 'actions:updated', payload: { actions: [recorded] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await page.locator('tr[data-row-index="0"]').click({ button: 'right' });
  const parent = page.getByRole('button', { name: /Change click type/ });
  await parent.hover();
  await page.getByRole('button', { name: /^Left Click/ }).click();
  await page.waitForTimeout(200);
  const sent = (await wire(page)).filter(m => m.type === 'actions:bulkUpdateType');
  const converted = applyBulkUpdateType(recorded, sent[0].payload.actionType);
  await post(page, { type: 'actions:updated', payload: { actions: [converted] } });
  await page.locator('tr[data-row-index="0"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await expect(page.getByRole('button', { name: /^Save$/ })).toHaveCount(2);
  await page.waitForTimeout(350);
  const span = footerSpan(page);
  console.log(`CONTROL LeftClick: footer="${(await span.innerText()).trim()}" opacity=${await span.evaluate(e => getComputedStyle(e).opacity)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  console.log(`CONTROL LeftClick after 1 Esc: saveButtons=${await page.getByRole('button', { name: /^Save$/ }).count()} (1 = closed)`);
});

test('control B: hold row that already carries 1000 -> clean', async ({ page }) => {
  await boot(page);
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'a', actionType: 'LeftClickHold', holdDurationMs: 1000, x: 640, y: 480, rowNumber: 1, delay: 100 }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await page.locator('tr[data-row-index="0"]').hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  await expect(page.getByRole('button', { name: /^Save$/ })).toHaveCount(2);
  await page.waitForTimeout(350);
  const span = footerSpan(page);
  console.log(`CONTROL 1000: footer="${(await span.innerText()).trim()}" opacity=${await span.evaluate(e => getComputedStyle(e).opacity)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  console.log(`CONTROL 1000 after 1 Esc: saveButtons=${await page.getByRole('button', { name: /^Save$/ }).count()} (1 = closed)`);
});
