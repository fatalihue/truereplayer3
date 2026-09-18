import { test, expect } from '@playwright/test';

/** SKEPTIC RUN 2 — prove the ORDERING, not just the symptom. */

const initScript = () => {
  (window as unknown as { __sent: unknown[]; __order: string[] }).__sent = [];
  (window as unknown as { __order: string[] }).__order = [];
  const listeners = new Set<(e: { data: unknown }) => void>();
  const w = window as unknown as { chrome?: Record<string, unknown> };
  w.chrome = w.chrome || {};
  (w.chrome as Record<string, unknown>).webview = {
    postMessage: (m: unknown) => {
      const t = (m as { type?: string }).type ?? '?';
      (window as unknown as { __order: string[] }).__order.push('postMessage:' + t);
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
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: [] } });
  await post(page, { type: 'button:states', payload: btnStates });
  await page.locator('button[data-tip*="Inserir clique"]').first().click();
  await expect(page.getByText('Insert Click', { exact: true }).first()).toBeVisible();
}

const note = (page: import('@playwright/test').Page) =>
  page.getByText(/Leave it empty|this is a drag|needs both X and Y/).first().innerText();

test('D — mirror case: the clear COMMITS inside the Enter, but the confirm read the PRE-clear snapshot', async ({ page }) => {
  await boot(page);
  await page.getByRole('tab', { name: 'Two rows' }).click();
  await page.waitForTimeout(150);

  await page.getByLabel('Press X coordinate').fill('300');
  await page.getByLabel('Press Y coordinate').fill('400');
  await page.getByLabel('Release X coordinate').fill('500');   // release HALF filled on purpose
  await page.getByLabel('Release X coordinate').blur();
  await page.waitForTimeout(150);

  console.log('[SETUP] note =', await note(page));
  console.log('[SETUP] Add disabled? =', await page.getByRole('button', { name: 'Add', exact: true }).isDisabled(), '(expect true: half a release)');

  // Clear the ONLY filled release axis and hit Enter.
  const relX = page.getByLabel('Release X coordinate');
  await relX.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  console.log('[BEFORE ENTER] Release X shows =', JSON.stringify(await relX.inputValue()));
  console.log('[BEFORE ENTER] note =', await note(page), '(state NOT committed yet)');

  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const open = await page.locator('[role="dialog"]').count();
  const sent = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent);
  console.log('[AFTER ENTER] dialog open? =', open);
  console.log('[AFTER ENTER] bridge =', JSON.stringify(sent));
  if (open) {
    console.log('[AFTER ENTER] note =', await note(page), '<-- if this flipped to "Leave it empty", the clear DID commit during the Enter');
    console.log('[AFTER ENTER] Add disabled? =', await page.getByRole('button', { name: 'Add', exact: true }).isDisabled(), '<-- false means the POST-clear state was confirmable, yet Enter refused');
  }
});

test('E — event order inside one Enter: keydown -> focusout (clear) -> postMessage (confirm)', async ({ page }) => {
  await boot(page);

  await page.getByLabel('Press X coordinate').fill('300');
  await page.getByLabel('Press Y coordinate').fill('400');
  await page.getByLabel('Press Y coordinate').blur();
  await page.waitForTimeout(150);

  // Native capture listeners on the document: they see the real DOM order.
  await page.evaluate(() => {
    const o = (window as unknown as { __order: string[] }).__order;
    document.addEventListener('keydown', (e) => {
      o.push('keydown@' + (e.target as HTMLElement).tagName + ':' + (e as KeyboardEvent).key);
    }, true);
    document.addEventListener('focusout', (e) => {
      o.push('focusout@' + (e.target as HTMLElement).tagName);
    }, true);
  });

  const pX = page.getByLabel('Press X coordinate');
  await pX.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(120);
  await page.evaluate(() => { (window as unknown as { __order: string[] }).__order.length = 0; });

  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const order = await page.evaluate(() => (window as unknown as { __order: string[] }).__order);
  console.log('[ORDER] =', JSON.stringify(order));
  const sent = await page.evaluate(() => (window as unknown as { __sent: unknown[] }).__sent);
  console.log('[SENT] =', JSON.stringify(sent));
});
