import { test, expect } from '@playwright/test';
import { MACRO, postToBridge, stateInit } from './fixtures';

// Ctrl+K runs the macro's menu from any page. Its settings items (Hotkey…, Hotstring…, Window target…,
// Edit info…) open in the Inspector, which lives on the macros' page: run from another page, they used
// to open there unseen, and the Hotkey's key capture listened behind Settings.
test('a macro setting from Ctrl+K on another page brings the macros page first', async ({ page }) => {
  const sent: string[] = [];
  page.on('console', (m) => { if (m.text().startsWith('[Bridge] → C#:')) sent.push(m.text()); });
  await page.goto('/');
  await postToBridge(page, stateInit());
  await expect(page.locator('.hdr-transport')).toBeVisible();

  await page.getByRole('navigation', { name: 'Destinations' }).getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.hdr-transport')).toBeHidden();

  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder('Search macros, steps and commands');
  await expect(search).toBeVisible();
  await search.fill(`Hotkey… · ${MACRO}`);
  await page.getByRole('option', { name: new RegExp(`^Hotkey… · ${MACRO}`) }).first().click();

  // The macros' page is on screen, with the Trigger's capture armed there.
  await expect(page.locator('.hdr-transport')).toBeVisible();
  await expect.poll(() => sent.some(t => t.includes('hotkey:capture'))).toBe(true);
});
