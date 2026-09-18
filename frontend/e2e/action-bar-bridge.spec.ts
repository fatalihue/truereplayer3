import { test, expect } from '@playwright/test';

// Drives the ActionBar's loop chip and mode toggle by simulating bridge messages from the C#
// side, through BridgeProvider's DEV-only window.postMessage fallback — see
// memory/support-vite-harness-ui-measurement.md ("Dirigir o app REAL sem harness").
function postToBridge(page: import('@playwright/test').Page, message: unknown) {
  return page.evaluate((msg) => window.postMessage(msg, '*'), message);
}

test('profile:loop repaints the loop chip', async ({ page }) => {
  await page.goto('/');

  // Default state has no active profile and no data-loop rows, so the chip shows the raw
  // count (see ActionBar's showsCount derivation) — '1×' until profile:loop says otherwise.
  await expect(page.getByText('1×', { exact: true })).toBeVisible();

  await postToBridge(page, {
    type: 'profile:loop',
    payload: { count: '5', enabled: true, interval: '200', intervalEnabled: false, dirty: false, scoped: false },
  });

  await expect(page.getByText('5×', { exact: true })).toBeVisible();
});

test('settings:loaded flips the mode pill to Clicker', async ({ page }) => {
  await page.goto('/');

  const macroTab = page.getByRole('tab', { name: 'Macro' });
  const clickerTab = page.getByRole('tab', { name: 'Clicker' });
  await expect(macroTab).toHaveAttribute('aria-selected', 'true');
  // Default profileLoop is disabled, so the chip reads '1×' in Macro mode — the baseline the
  // second assertion below needs to prove the chip actually disappeared, not just never showed.
  await expect(page.getByText('1×', { exact: true })).toBeVisible();

  await postToBridge(page, {
    type: 'settings:loaded',
    payload: { settings: { useCursorClick: true } },
  });

  await expect(clickerTab).toHaveAttribute('aria-selected', 'true');
  await expect(macroTab).toHaveAttribute('aria-selected', 'false');
  // The loop chip is Macro-only — switching modes must hide it, not just relabel it.
  await expect(page.getByText('1×', { exact: true })).toHaveCount(0);
});
