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

// Row list: 0 = Keystroke, 1 = LeftClickDown, 2 = LeftClickUp, 3 = RightClick (a real
// neighbour AFTER the pair, so "the half after it" names something concrete), 4 = DoubleClick.
const ROWS = [
  base({ id: 'pre', actionType: 'Keystroke', key: 'A', rowNumber: 1 }),
  base({ id: 'down', actionType: 'LeftClickDown', x: 400, y: 300, rowNumber: 2 }),
  base({ id: 'up', actionType: 'LeftClickUp', x: 400, y: 300, delay: 40, rowNumber: 3 }),
  base({ id: 'after', actionType: 'RightClick', x: 900, y: 700, rowNumber: 4 }),
  base({ id: 'dbl', actionType: 'DoubleClick', x: 120, y: 120, rowNumber: 5 }),
];

async function openSheet(page: import('@playwright/test').Page, rowIndex: number) {
  await page.addInitScript(initScript);
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: ROWS } });
  await post(page, { type: 'button:states', payload: btnStates });
  const row = page.locator(`tr[data-row-index="${rowIndex}"]`);
  await row.hover();
  await row.getByRole('button', { name: 'Edit action' }).first().click();
  await page.waitForTimeout(400);
}

async function flipFormAndSave(page: import('@playwright/test').Page, to: 'One row' | 'Two rows') {
  const formAxis = page.getByRole('tablist', { name: 'Click form' });
  console.log('[FORM] visible =', await formAxis.isVisible(),
    '| pointer-events =', await formAxis.evaluate((e) => getComputedStyle(e).pointerEvents),
    '| active BEFORE =', await formAxis.getByRole('tab', { selected: true }).innerText());
  console.log('[STRIP at rest] =', JSON.stringify(
    await page.locator('text=/^(Saving|One row:|Two rows:)/').allInnerTexts()));

  await formAxis.getByRole('tab', { name: to, exact: true }).click();
  await page.waitForTimeout(250);

  console.log('[FORM] active AFTER =', await formAxis.getByRole('tab', { selected: true }).innerText());
  const warn = await page.locator('text=/^Saving /').allInnerTexts();
  console.log('[STRIP pending Save] =', JSON.stringify(warn));

  const saveBtn = page.getByRole('button', { name: /^Save$/ }).last();
  console.log('[SAVE] disabled =', await saveBtn.isDisabled());
  await page.evaluate(() => { (window as unknown as { __sent: unknown[] }).__sent = []; });
  await saveBtn.click();
  await page.waitForTimeout(400);
  const sent = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent) as Array<{ type: string; payload?: unknown }>;
  console.log('[SENT] ' + JSON.stringify(sent));
  return { warn, sent };
}

test('UP half + One row: the strip names the half AFTER, the Save takes the one BEFORE', async ({ page }) => {
  await openSheet(page, 2); // the LeftClickUp
  console.log('[HDR] =', await page.getByText(/^Action #/).first().innerText());
  const { warn, sent } = await flipFormAndSave(page, 'One row');
  const conv = sent.find(m => m.type === 'actions:convertMode');
  console.log('[VERDICT] warn=', JSON.stringify(warn), ' convert=', JSON.stringify(conv));
});

test('DOWN half + One row (contrast): strip and Save agree', async ({ page }) => {
  await openSheet(page, 1); // the LeftClickDown
  const { warn, sent } = await flipFormAndSave(page, 'One row');
  const conv = sent.find(m => m.type === 'actions:convertMode');
  console.log('[VERDICT] warn=', JSON.stringify(warn), ' convert=', JSON.stringify(conv));
});

test('DoubleClick + Two rows: strip promises a split the backend refuses', async ({ page }) => {
  await openSheet(page, 4); // the DoubleClick
  const { warn, sent } = await flipFormAndSave(page, 'Two rows');
  const conv = sent.find(m => m.type === 'actions:convertMode');
  console.log('[VERDICT] warn=', JSON.stringify(warn), ' convert=', JSON.stringify(conv));
});
