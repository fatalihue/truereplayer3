import { test, expect } from '@playwright/test';

/** Same scenario against the PRODUCTION bundle (dist, served by vite preview on 5176).
 *  No StrictMode double-render, no dev warnings — the bytes that ship inside WebView2. */

const initScript = () => {
  (window as unknown as { __sent: unknown[]; __order: string[] }).__sent = [];
  (window as unknown as { __order: string[] }).__order = [];
  const listeners = new Set<(e: { data: unknown }) => void>();
  const w = window as unknown as { chrome?: Record<string, unknown> };
  w.chrome = w.chrome || {};
  (w.chrome as Record<string, unknown>).webview = {
    postMessage: (m: unknown) => {
      (window as unknown as { __order: string[] }).__order.push('postMessage:' + ((m as { type?: string }).type ?? '?'));
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

async function boot(page: import('@playwright/test').Page) {
  await page.addInitScript(initScript);
  await page.goto('http://127.0.0.1:5176/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: [] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await page.locator('button[data-tip*="Inserir clique"]').first().click();
  await expect(page.getByText('Insert Click', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => {
    const o = (window as unknown as { __order: string[] }).__order;
    document.addEventListener('keydown', (e) => o.push('keydown@' + (e.target as HTMLElement).tagName + ':' + (e as KeyboardEvent).key), true);
    document.addEventListener('focusout', (e) => o.push('focusout@' + (e.target as HTMLElement).tagName), true);
  });
}

async function clearAndEnter(page: import('@playwright/test').Page, label: string) {
  const f = page.getByLabel(label);
  await f.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  console.log('[PROD] field', label, 'shows', JSON.stringify(await f.inputValue()));
  await page.evaluate(() => {
    (window as unknown as { __order: string[] }).__order.length = 0;
    (window as unknown as { __sent: unknown[] }).__sent.length = 0;
  });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  console.log('[PROD] order =', JSON.stringify(await page.evaluate(() => (window as unknown as { __order: string[] }).__order)));
  console.log('[PROD] sent  =', JSON.stringify(await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent)));
}

test('PROD A — Two rows, clear Release Y, Enter', async ({ page }) => {
  await boot(page);
  await page.getByRole('tab', { name: 'Two rows' }).click();
  await page.waitForTimeout(150);
  await page.getByLabel('Press X coordinate').fill('300');
  await page.getByLabel('Press Y coordinate').fill('400');
  await page.getByLabel('Release X coordinate').fill('500');
  await page.getByLabel('Release Y coordinate').fill('600');
  await page.getByLabel('Release Y coordinate').blur();
  await page.waitForTimeout(150);
  await clearAndEnter(page, 'Release Y coordinate');
});

test('PROD B — One row, clear Press X, Enter', async ({ page }) => {
  await boot(page);
  await page.getByLabel('Press X coordinate').fill('300');
  await page.getByLabel('Press Y coordinate').fill('400');
  await page.getByLabel('Press Y coordinate').blur();
  await page.waitForTimeout(150);
  await clearAndEnter(page, 'Press X coordinate');
});
