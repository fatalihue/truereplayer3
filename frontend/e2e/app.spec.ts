import { test, expect } from '@playwright/test';
import { MACRO, postToBridge, stateInit } from './fixtures';

// Smoke test for the shell against the Vite dev server, no WebView2 needed (see fixtures.ts). The
// engine's launch message is played from here, as the app's own engine sends it.
test('the shell opens to Ready, with the open macro and its steps', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('TrueReplayer 3');

  await postToBridge(page, stateInit());

  // The title bar's state badge (casca-019) says the engine is ready.
  await expect(page.getByRole('status').filter({ hasText: 'Ready' })).toBeVisible();
  // The library lists the macro, and the list shows its two steps.
  await expect(page.getByText(MACRO, { exact: true }).first()).toBeVisible();
  await expect(page.locator('.step')).toHaveCount(2);
});
