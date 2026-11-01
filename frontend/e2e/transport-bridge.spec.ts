import { test, expect } from '@playwright/test';
import { postToBridge, stateInit } from './fixtures';

// The transport (④⑤) and the Clicker page answering the engine's messages, played through
// BridgeProvider's DEV-only window.postMessage fallback (see fixtures.ts).

test('profile:loop repaints the count on Replay', async ({ page }) => {
  await page.goto('/');
  await postToBridge(page, stateInit());

  const replay = page.locator('.hdr-transport .hdr-run', { hasText: 'Replay' });
  await expect(replay).toBeVisible();
  // One pass: no count on the button.
  await expect(replay.locator('.hdr-count')).toHaveCount(0);

  await postToBridge(page, {
    type: 'profile:loop',
    payload: { count: '5', enabled: true, interval: '200', intervalEnabled: false, dirty: false, scoped: true },
  });

  await expect(replay.locator('.hdr-count')).toHaveText('×5');
});

test('settings:loaded with the Clicker on opens the Clicker page', async ({ page }) => {
  await page.goto('/');
  await postToBridge(page, stateInit());
  await expect(page.locator('.hdr-transport .hdr-run', { hasText: 'Replay' })).toBeVisible();

  await postToBridge(page, { type: 'settings:loaded', payload: { settings: { useCursorClick: true } } });

  // The page is the mode on screen (casca-101): it shows up when the mode turns on, and the badge says
  // Clicker. The macros' screen stays mounted under it, hidden, so going back is immediate.
  await expect(page.getByRole('region', { name: 'Clicker' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Clicker' })).toBeVisible();
  await expect(page.locator('.hdr-transport')).toBeHidden();
});
