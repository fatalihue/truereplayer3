import { test, expect } from '@playwright/test';

function post(page: import('@playwright/test').Page, msg: unknown) {
  return page.evaluate((m) => window.postMessage(m, '*'), msg);
}

// Faithful to WebViewBridge's projection: repeatCount is a non-nullable int defaulting to 1,
// the three repeat extras are int? (null when unset), holdDurationMs is a plain int (0 = default).
const base = (over: Record<string, unknown>) => ({
  id: 'x', actionType: 'LeftClick', key: '', x: 0, y: 0, delay: 0, comment: '',
  rowNumber: 1, isInsertionPoint: false, shouldHighlight: false, imagePath: '',
  timeout: 5000, confidence: 0.8, imageBase64: '', browserText: '', newTab: false,
  isSkipped: false, atCursor: false, repeatCount: 1, repeatDelayMs: null,
  repeatDelayJitterPct: null, repeatPositionJitterPx: null, holdDurationMs: 0, ...over,
});

const btnStates = (over: Record<string, unknown>) => ({
  recordEnabled: true, replayEnabled: true, recordingActive: false, replayActive: false,
  recordButtonText: 'Recording', replayButtonText: 'Replay', canUndo: false, canRedo: false,
  copiedCount: 0, ...over,
});

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

// STEP 1 — is the UI route real? Does "Change click type ▸ Hold Left" exist on a plain
// LeftClick row, and what does it put on the wire?
test('route: row menu offers Hold Left and sends bulkUpdateType', async ({ page }) => {
  await boot(page);
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'a', actionType: 'LeftClick', x: 10, y: 10, rowNumber: 1 }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates({}) });

  const row = page.locator('tr[data-row-index="0"]');
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.getByRole('button', { name: /Change click type/ }).hover();
  const holdLeft = page.getByRole('button', { name: /^Hold Left/ });
  console.log('HOLD LEFT OFFERED:', await holdLeft.count());
  await holdLeft.click();
  await page.waitForTimeout(150);
  const out = await page.evaluate(() => (window as any).__out as string[]);
  console.log('WIRE:', JSON.stringify(out.filter(s => s.includes('bulkUpdateType'))));
});

// STEP 2 — the panel, untouched, on the row that conversion produces (holdDurationMs = 0).
async function probeSheet(page: import('@playwright/test').Page, over: Record<string, unknown>, label: string) {
  await post(page, { type: 'actions:updated', payload: { actions: [base({ id: 'a', x: 10, y: 10, rowNumber: 1, ...over })] } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  const row = page.locator('tr[data-row-index="0"]');
  await expect(row).toBeVisible();
  await row.hover();
  await page.getByRole('button', { name: 'Edit action' }).first().click();
  const panel = page.locator('[data-testid="sheet-panel"], aside, [role="complementary"]').first();
  await page.waitForTimeout(400);

  // Read the footer WITHOUT touching a single field.
  const discard = await page.getByRole('button', { name: 'Discard', exact: true }).count();
  const cancel = await page.getByRole('button', { name: 'Cancel', exact: true }).count();
  const bodyText = await page.locator('body').innerText();
  console.log(`[${label}] CANCEL:${cancel} DISCARD:${discard} UNSAVED_TEXT:${bodyText.includes('Unsaved changes')}`);

  // First Esc: does the panel close, or arm?
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const after = await page.locator('body').innerText();
  const stillOpen = await page.getByRole('button', { name: /^(Save)$/ }).count();
  console.log(`[${label}] AFTER_ESC stillOpen:${stillOpen} armed:${after.includes('Esc again discards')}`);
  if (stillOpen > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(350);
    const t = await page.locator('body').innerText();
    console.log(`[${label}] AFTER_2ND_ESC toast:${t.includes('Changes discarded')} stillOpen:${await page.getByRole('button', { name: /^(Save)$/ }).count()}`);
  }
  await page.waitForTimeout(300);
}

test('sheet on a converted hold row (holdDurationMs=0), untouched', async ({ page }) => {
  await boot(page);
  await probeSheet(page, { actionType: 'LeftClickHold', holdDurationMs: 0 }, 'HOLD_0');
});

test('control: hold row with a real duration (1000), untouched', async ({ page }) => {
  await boot(page);
  await probeSheet(page, { actionType: 'LeftClickHold', holdDurationMs: 1000 }, 'HOLD_1000');
});

test('control: plain LeftClick with holdDurationMs=0, untouched', async ({ page }) => {
  await boot(page);
  await probeSheet(page, { actionType: 'LeftClick', holdDurationMs: 0 }, 'PLAIN_0');
});
