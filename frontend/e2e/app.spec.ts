import { test, expect } from '@playwright/test';

// Smoke test for the real app shell against the Vite dev server — no WebView2 needed, since
// BridgeProvider's DEV-only fallback accepts window.postMessage in place of chrome.webview.
// See memory/support-vite-harness-ui-measurement.md for the manual-CDP version this replaces.
test('app shell boots and reaches the Ready state', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('TrueReplayer');
  // TitleBar renders the connection/status badge as soon as AppStateProvider mounts, with
  // no profile or bridge data required — the cheapest signal that React actually rendered.
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
});
