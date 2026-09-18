import { test, expect } from '@playwright/test';

// Skeptic run: does a TYPED decimal / out-of-range X survive to the bridge payload?
const initScript = () => {
  (window as unknown as { __sent: unknown[] }).__sent = [];
  const listeners = new Set<(e: { data: unknown }) => void>();
  const w = window as unknown as { chrome?: Record<string, unknown> };
  w.chrome = w.chrome || {};
  (w.chrome as Record<string, unknown>).webview = {
    postMessage: (m: unknown) => {
      // JSON round-trip on purpose: this is what WebView2 does to the object.
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

async function openDialog(page: import('@playwright/test').Page) {
  await page.addInitScript(initScript);
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: [] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await page.locator('button[data-tip*="Inserir clique"]').first().click();
  await expect(page.getByText('Insert Click', { exact: true }).first()).toBeVisible();
}

async function typeInto(page: import('@playwright/test').Page, label: string, s: string) {
  const el = page.getByLabel(label);
  await el.click();
  await el.pressSequentially(s, { delay: 25 });
}

test('typed decimal X reaches the payload', async ({ page }) => {
  await openDialog(page);
  console.log('[REACH] X input type =', await page.getByLabel('Press X coordinate').getAttribute('type'));
  console.log('[REACH] X input step =', await page.getByLabel('Press X coordinate').getAttribute('step'));
  console.log('[REACH] X input min  =', await page.getByLabel('Press X coordinate').getAttribute('min'));

  await typeInto(page, 'Press X coordinate', '300.5');
  await typeInto(page, 'Press Y coordinate', '400');
  console.log('[REACH] X value after typing =', JSON.stringify(await page.getByLabel('Press X coordinate').inputValue()));

  const add = page.getByRole('button', { name: 'Add', exact: true });
  console.log('[REACH] Add enabled =', await add.isEnabled());
  // Semantics strip: what the user is told they are about to insert.
  const strip = await page.locator('div[class*="border-l-2"]').last().innerText();
  console.log('[REACH] strip =', JSON.stringify(strip.trim()));

  await add.click();
  await page.waitForTimeout(200);
  const sent = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent);
  const ins = (sent as Array<{ type: string; payload: unknown }>).filter(m => m.type === 'actions:insertClick');
  console.log('[REACH] insertClick payloads =', JSON.stringify(ins));
  console.log('[REACH] dialog still open? =', await page.getByText('Insert Click', { exact: true }).first().isVisible().catch(() => false));
});

test('typed 11-digit X reaches the payload', async ({ page }) => {
  await openDialog(page);
  await typeInto(page, 'Press X coordinate', '99999999999');
  await typeInto(page, 'Press Y coordinate', '400');
  console.log('[REACH] X value after typing =', JSON.stringify(await page.getByLabel('Press X coordinate').inputValue()));
  const add = page.getByRole('button', { name: 'Add', exact: true });
  console.log('[REACH] Add enabled =', await add.isEnabled());
  await add.click();
  await page.waitForTimeout(200);
  const sent = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent);
  const ins = (sent as Array<{ type: string; payload: unknown }>).filter(m => m.type === 'actions:insertClick');
  console.log('[REACH] insertClick payloads =', JSON.stringify(ins));
});

test('typed decimal on the RELEASE axis (drag upX/upY)', async ({ page }) => {
  await openDialog(page);
  await page.getByRole('tab', { name: 'Two rows' }).click();
  await page.waitForTimeout(150);
  await typeInto(page, 'Press X coordinate', '100');
  await typeInto(page, 'Press Y coordinate', '200');
  await typeInto(page, 'Release X coordinate', '500.25');
  await typeInto(page, 'Release Y coordinate', '600');
  const add = page.getByRole('button', { name: 'Add', exact: true });
  console.log('[REACH] Add enabled =', await add.isEnabled());
  await add.click();
  await page.waitForTimeout(200);
  const sent = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent);
  const ins = (sent as Array<{ type: string; payload: unknown }>).filter(m => m.type === 'actions:insertClick');
  console.log('[REACH] insertClick payloads =', JSON.stringify(ins));
});

test('Enter-to-confirm with a decimal (no mouse blur first)', async ({ page }) => {
  await openDialog(page);
  await typeInto(page, 'Press Y coordinate', '400');
  await typeInto(page, 'Press X coordinate', '300.5');
  // Enter straight from the field — NumberInput blurs itself, then DialogShell confirms.
  await page.getByLabel('Press X coordinate').press('Enter');
  await page.waitForTimeout(200);
  const sent = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent);
  const ins = (sent as Array<{ type: string; payload: unknown }>).filter(m => m.type === 'actions:insertClick');
  console.log('[REACH] insertClick payloads =', JSON.stringify(ins));
  console.log('[REACH] X value after Enter =', JSON.stringify(await page.getByLabel("Press X coordinate").inputValue({ timeout: 1500 }).catch(() => "gone")));
});
