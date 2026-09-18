import { test, expect } from '@playwright/test';

function post(page: import('@playwright/test').Page, msg: unknown) {
  return page.evaluate((m) => window.postMessage(m, '*'), msg);
}

const base = (over: Record<string, unknown>) => ({
  id: 'x', actionType: 'LeftClick', key: '', x: 0, y: 0, delay: 0, comment: '',
  rowNumber: 1, isInsertionPoint: false, shouldHighlight: false, imagePath: '',
  timeout: 5000, confidence: 0.8, imageBase64: '', browserText: '', newTab: false,
  isSkipped: false, ...over,
});
const btnStates = (over: Record<string, unknown>) => ({
  recordEnabled: true, replayEnabled: true, recordingActive: false, replayActive: false,
  recordButtonText: 'Recording', replayButtonText: 'Replay', canUndo: false, canRedo: false,
  copiedCount: 0, ...over,
});
const rows = () => Array.from({ length: 6 }, (_, i) =>
  base({ id: 'r' + i, x: i * 10, y: i * 10, rowNumber: i + 1 }));

// 958 device px = the C# window minimum (BaseMinWidthDip 960) inside WebView2, at the
// default 90% UI zoom → 1064 layout px. Both rails auto-collapse there; the user
// re-expands them BY HAND (documented as intentionally reachable in App.tsx).
test('real minimum window + rails re-expanded: armed Clear All survives a hotkey replay', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__out = [];
    const orig = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('→ C#')) {
        try { (window as any).__out.push(JSON.stringify({ t: args[1], p: args[2] })); } catch { /* ignore */ }
      }
      orig(...args);
    };
  });
  await page.setViewportSize({ width: 958, height: 780 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(400);

  // Re-expand BOTH rails by hand (two clicks — both happen before the menu is opened).
  const expanders = page.locator('button[data-tip="Expandir painel"]');
  console.log('EXPANDERS FOUND:', await expanders.count());
  const n = await expanders.count();
  for (let i = 0; i < n; i++) { await expanders.nth(0).click(); await page.waitForTimeout(250); }
  await page.waitForTimeout(400);

  const geom = await page.evaluate(() => {
    const unit = document.querySelector('[data-tb-unit]') as HTMLElement | null;
    const row = unit?.parentElement as HTMLElement | null;
    const bar = row?.parentElement as HTMLElement | null;
    return { centre: (bar?.parentElement as HTMLElement)?.offsetWidth, barW: bar?.clientWidth, rowW: row?.scrollWidth };
  });
  console.log('GEOMETRY AT REAL MINIMUM, RAILS EXPANDED:', JSON.stringify(geom));

  const more = page.locator('button[data-tip="Mais"]');
  console.log('MORE BUTTON PRESENT:', await more.count());
  expect(await more.count()).toBe(1);

  const panel = () => page.locator('div.menu-surface').filter({ hasText: 'More actions' }).first();
  await more.click();
  await expect(panel()).toBeVisible();
  await panel().getByRole('button', { name: /Clear All/ }).click();
  await page.waitForTimeout(150);
  console.log('ARMED:', JSON.stringify(await panel().innerText()));

  // Hotkey replay: no mousedown, no Escape, nothing touched.
  await post(page, { type: 'actions:highlight', payload: { index: 1 } });
  await post(page, { type: 'button:states', payload: btnStates({ replayActive: true, replayButtonText: 'Stop' }) });
  await page.waitForTimeout(400);
  console.log('DURING RUN — panel count:', await panel().count());

  await post(page, { type: 'button:states', payload: btnStates({ replayActive: false }) });
  await page.waitForTimeout(500);
  console.log('AFTER RUN — panel count:', await panel().count());
  if (await panel().count()) {
    console.log('AFTER RUN — text:', JSON.stringify(await panel().innerText()));
    const red = panel().getByRole('button', { name: 'Clear all', exact: true });
    console.log('AFTER RUN — red button disabled:', await red.isDisabled());
    const boxBefore = await red.boundingBox();
    console.log('RED BUTTON BOX:', JSON.stringify(boxBefore));
    await red.click();
    await page.waitForTimeout(250);
    console.log('BRIDGE OUT:', JSON.stringify(await page.evaluate(() => ((window as any).__out as string[]).filter(s => s.includes('actions:')))));
  }
});
