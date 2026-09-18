import { test, expect } from '@playwright/test';

/**
 * SKEPTIC RUN — claim: "Enter right after clearing an X/Y field confirms with the value the user
 * just erased" (ClickDialog.tsx:324 + NumberInput.tsx:239-241).
 *
 * Drives the REAL Insert Click dialog in the REAL app and reads the bridge payload.
 */

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

type Sent = { type: string; payload?: Record<string, unknown> }[];

async function boot(page: import('@playwright/test').Page) {
  await page.addInitScript(initScript);
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: [] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await page.locator('button[data-tip*="Inserir clique"]').first().click();
  await expect(page.getByText('Insert Click', { exact: true }).first()).toBeVisible();
}

const drain = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __sent: Sent }).__sent;
    (window as unknown as { __sent: Sent }).__sent = [];
    return s;
  }) as Promise<Sent>;

test('A — Two rows, clear Release Y with the keyboard, Enter', async ({ page }) => {
  await boot(page);
  await page.getByRole('tab', { name: 'Two rows' }).click();
  await page.waitForTimeout(150);

  await page.getByLabel('Press X coordinate').fill('300');
  await page.getByLabel('Press Y coordinate').fill('400');
  await page.getByLabel('Release X coordinate').fill('500');
  await page.getByLabel('Release Y coordinate').fill('600');
  await page.getByLabel('Release Y coordinate').blur();
  await page.waitForTimeout(150);

  console.log('[SETUP] strip =', await page.locator('[role="dialog"]').getByText(/Two rows:|Pick a point|needs both X and Y/).first().innerText());
  console.log('[SETUP] Add disabled? =', await page.getByRole('button', { name: 'Add', exact: true }).isDisabled());

  // The user's exact gesture: click into Release Y, select all, delete, Enter.
  const relY = page.getByLabel('Release Y coordinate');
  await relY.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  console.log('[BEFORE ENTER] Release Y field shows =', JSON.stringify(await relY.inputValue()));
  console.log('[BEFORE ENTER] strip =', await page.locator('[role="dialog"]').getByText(/Two rows:|Pick a point|needs both X and Y/).first().innerText());
  console.log('[BEFORE ENTER] Add disabled? =', await page.getByRole('button', { name: 'Add', exact: true }).isDisabled());

  await drain(page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const sent = await drain(page);
  console.log('[AFTER ENTER] bridge =', JSON.stringify(sent));
  console.log('[AFTER ENTER] dialog still open? =', await page.locator('[role="dialog"]').count());
  const dlgOpen = await page.locator('[role="dialog"]').count();
  if (dlgOpen) {
    console.log('[AFTER ENTER] Release Y field =', JSON.stringify(await relY.inputValue()));
    console.log('[AFTER ENTER] strip =', await page.locator('[role="dialog"]').getByText(/Two rows:|Pick a point|needs both X and Y/).first().innerText());
  }
});

test('B — One row, clear Press X with the keyboard, Enter', async ({ page }) => {
  await boot(page);

  await page.getByLabel('Press X coordinate').fill('300');
  await page.getByLabel('Press Y coordinate').fill('400');
  await page.getByLabel('Press Y coordinate').blur();
  await page.waitForTimeout(150);
  console.log('[SETUP] strip =', await page.locator('[role="dialog"]').getByText(/Clicks the|Pick a point/).first().innerText());

  const pX = page.getByLabel('Press X coordinate');
  await pX.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  console.log('[BEFORE ENTER] Press X field shows =', JSON.stringify(await pX.inputValue()));
  console.log('[BEFORE ENTER] Add disabled? =', await page.getByRole('button', { name: 'Add', exact: true }).isDisabled());

  await drain(page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const sent = await drain(page);
  console.log('[AFTER ENTER] bridge =', JSON.stringify(sent));
  console.log('[AFTER ENTER] dialog still open? =', await page.locator('[role="dialog"]').count());
});

test('C — control: same as B but Add is clicked with the mouse', async ({ page }) => {
  await boot(page);

  await page.getByLabel('Press X coordinate').fill('300');
  await page.getByLabel('Press Y coordinate').fill('400');
  await page.getByLabel('Press Y coordinate').blur();
  await page.waitForTimeout(150);

  const pX = page.getByLabel('Press X coordinate');
  await pX.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);

  await drain(page);
  await page.getByRole('button', { name: 'Add', exact: true }).click({ force: true });
  await page.waitForTimeout(400);
  const sent = await drain(page);
  console.log('[MOUSE PATH] bridge =', JSON.stringify(sent));
  console.log('[MOUSE PATH] dialog still open? =', await page.locator('[role="dialog"]').count());
});
