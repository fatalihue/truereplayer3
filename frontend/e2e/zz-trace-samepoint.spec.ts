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

const btnStates = {
  recordEnabled: true, replayEnabled: true, recordingActive: false,
  replayActive: false, recordButtonText: 'Recording', replayButtonText: 'Replay',
  canUndo: false, canRedo: false, copiedCount: 0,
};

test('Insert Click / Two rows: the "Same point" button fires the screen picker', async ({ page }) => {
  await page.addInitScript(initScript);
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: [] } });
  await post(page, { type: 'button:states', payload: btnStates });

  // Toolbar -> Insert Click
  await page.locator('button[data-tip*="Inserir clique"]').first().click();
  await expect(page.getByText('Insert Click', { exact: true }).first()).toBeVisible();

  // Fresh dialog, One row: the press slot names an ACTION.
  console.log('[REACH] press button (One row) =', await page.getByRole('button', { name: /Pick from screen|Pick again/ }).first().innerText());

  // Form -> Two rows
  await page.getByRole('tab', { name: 'Two rows' }).click();
  await page.waitForTimeout(250);

  const same = page.getByRole('button', { name: 'Same point' });
  await expect(same).toBeVisible();
  await expect(same).toBeEnabled();
  console.log('[REACH] release button (Two rows) =', await same.innerText());
  console.log('[REACH] press twin            =', await page.getByRole('button', { name: /Pick from screen|Pick again/ }).first().innerText());
  console.log('[REACH] note under it         =', await page.getByText(/Leave it empty|this is a drag|needs both X and Y/).first().innerText());
  console.log('[REACH] axes X/Y              =',
    await page.getByLabel('Release X coordinate').inputValue(), '/',
    await page.getByLabel('Release Y coordinate').inputValue());

  // Give the press point a value so the strip can read back (typed, no picker needed).
  await page.getByLabel('Press X coordinate').fill('100');
  await page.getByLabel('Press Y coordinate').fill('200');
  await page.getByLabel('Press Y coordinate').blur();
  await page.waitForTimeout(150);

  // Now press the button that says "Same point".
  await page.evaluate(() => { (window as unknown as { __sent: unknown[] }).__sent = []; });
  await same.click();
  await page.waitForTimeout(200);

  const sent = await page.evaluate(() => (window as unknown as { __sent: { type: string; payload?: Record<string, unknown> }[] }).__sent);
  console.log('[FIRED] bridge messages =', JSON.stringify(sent));
  const pick = sent.find((m) => m.type === 'mouse:pickPosition');
  expect(pick, 'clicking "Same point" must NOT send mouse:pickPosition if the label is honest').toBeTruthy();

  console.log('[FIRED] button now says =', await page.getByRole('button', { name: /Picking/ }).first().innerText());

  // The native side would now minimise + overlay; the next screen click answers.
  const requestId = (pick!.payload as { requestId: string }).requestId;
  await post(page, { type: 'mouse:positionPicked', payload: { requestId, x: 900, y: 640, cancelled: false } });
  await page.waitForTimeout(250);

  const strip = await page.getByText(/Two rows:|Pick a point|needs both X and Y/).first().innerText();
  console.log('[RESULT] semantics strip =', strip);
  console.log('[RESULT] release axes    =',
    await page.getByLabel('Release X coordinate').inputValue(), '/',
    await page.getByLabel('Release Y coordinate').inputValue());
  console.log('[RESULT] button now says =', await page.getByRole('button', { name: /Pick again|Same point/ }).last().innerText());
  console.log('[RESULT] note now says   =', await page.getByText(/Leave it empty|this is a drag|needs both X and Y/).first().innerText());
});
