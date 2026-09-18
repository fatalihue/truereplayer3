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

// Opens the Sheet on the UP half (row index 1) of a Down/Up pair.
async function openSheetOnUp(page: import('@playwright/test').Page) {
  await page.addInitScript(initScript);
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: [
    base({ id: 'pre', actionType: 'Keystroke', key: 'A', rowNumber: 1 }),
    base({ id: 'a', actionType: 'LeftClickDown', x: 400, y: 300, rowNumber: 2, comment: '' }),
    base({ id: 'b', actionType: 'LeftClickUp', x: 400, y: 300, delay: 40, rowNumber: 3, comment: '' }),
  ] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await page.locator('tr[data-row-index="2"]').hover();
  await page.locator('tr[data-row-index="2"]').getByRole('button', { name: 'Edit action' }).first().click();
  await page.waitForTimeout(400);
}

test('Sheet on an UP half: note + One row in the SAME Save', async ({ page }) => {
  await openSheetOnUp(page);

  console.log('[REACH] header =', await page.locator('div.font-display.truncate').first().innerText());
  console.log('[REACH] action # =', await page.getByText(/^Action #/).first().innerText());

  const notes = page.getByPlaceholder('Add a note…');
  console.log('[REACH] notes visible  =', await notes.isVisible());
  console.log('[REACH] notes disabled =', await notes.isDisabled());
  console.log('[REACH] notes readonly =', await notes.evaluate((e: HTMLTextAreaElement) => e.readOnly));

  const formAxis = page.getByRole('tablist', { name: 'Click form' });
  console.log('[REACH] form visible =', await formAxis.isVisible());
  console.log('[REACH] form pointer-events =', await formAxis.evaluate((e) => getComputedStyle(e).pointerEvents));
  console.log('[REACH] form active BEFORE =', await formAxis.getByRole('tab', { selected: true }).innerText());

  await notes.fill('soltar aqui');
  await formAxis.getByRole('tab', { name: 'One row' }).click();
  await page.waitForTimeout(250);

  console.log('[REACH] form active AFTER =', await formAxis.getByRole('tab', { selected: true }).innerText());
  // The reserved Form strip text (the "agravante")
  const strip = formAxis.locator('xpath=../following-sibling::*[1]');
  try { console.log('[STRIP] =', await strip.innerText()); } catch { /* ignore */ }
  const anyStrip = await page.locator('text=/Saving (merges|splits)/').allInnerTexts();
  console.log('[STRIP-any] =', JSON.stringify(anyStrip));

  const saveBtn = page.getByRole('button', { name: /^Save$/ }).last();
  console.log('[REACH] Save disabled =', await saveBtn.isDisabled());

  await page.evaluate(() => { (window as unknown as { __sent: unknown[] }).__sent = []; });
  await saveBtn.click();
  await page.waitForTimeout(400);

  const sent = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent);
  console.log('[SENT] ' + JSON.stringify(sent, null, 1));
});
