import { test, expect } from '@playwright/test';

// TRACE: does opening the `Change click type` flyout really cost TWO React commits of the
// whole ActionTable, the second one writing nothing to the DOM?

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
  copiedCount: 2, ...over,
});

function makeRows(n: number) {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    // row 2 (index 2) stays a LeftClick; give a Pause somewhere for the control.
    const isPause = i === 5;
    out.push(base({
      id: `r${i}`,
      actionType: isPause ? 'Pause' : 'LeftClick',
      x: 10 + i, y: 20 + i, rowNumber: i + 1,
      timeout: isPause ? 1000 : 5000,
    }));
  }
  return out;
}

async function boot(page: import('@playwright/test').Page, n: number) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__commits = [];
    w.__hooks = 0;
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(),
      supportsFiber: true,
      _id: 0,
      inject(r: unknown) { this._id++; this.renderers.set(this._id, r); return this._id; },
      onCommitFiberRoot(_id: unknown, root: any) {
        try {
          w.__commits.push({
            t: performance.now(),
            d: root?.current?.actualDuration ?? -1,
            html: w.__hashBody ? w.__hashBody() : '',
          });
        } catch { /* ignore */ }
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
      emit() {}, on() {}, off() {}, getFiberRoots() { return new Set(); },
      sub() { return () => {}; },
    };
    // cheap 32-bit hash of body markup
    w.__hashBody = () => {
      const s = document.body.innerHTML;
      let h = 0;
      for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
      return `${h}:${s.length}`;
    };
  });

  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: makeRows(n) } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await expect(page.locator('tr[data-row-index="2"]')).toBeVisible();
  await page.waitForTimeout(400);
}

const mark = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as any).__commits as unknown[]).length);

const since = (page: import('@playwright/test').Page, from: number) =>
  page.evaluate((f) => {
    const all = (window as any).__commits as { t: number; d: number; html: string }[];
    const slice = all.slice(f);
    const prev = f > 0 ? all[f - 1] : null;
    return slice.map((c, i) => ({
      d: Math.round(c.d * 10) / 10,
      noop: i === 0 ? (prev ? prev.html === c.html : false) : slice[i - 1].html === c.html,
    }));
  }, from);

for (const n of [25, 400]) {
  test(`flyout commit cost @ ${n} rows`, async ({ page }) => {
    await boot(page, n);
    const nodes = await page.evaluate(() => document.querySelectorAll('*').length);
    console.log(`\n===== ROWS=${n} DOM NODES=${nodes} =====`);

    const row = page.locator('tr[data-row-index="2"]');
    await row.click({ button: 'right' });
    const menu = page.locator('div.menu-surface').filter({ hasText: 'Duplicate' }).first();
    await expect(menu).toBeVisible();
    await page.waitForTimeout(250);

    // --- CONTROL A: hover a PLAIN item (Edit) — onMouseEnter setActiveSubmenu(null) while
    //     already null should bail out with ZERO commits.
    let m = await mark(page);
    await page.getByRole('button', { name: /^Edit$/ }).hover();
    await page.waitForTimeout(200);
    console.log('HOVER Edit (plain item):', JSON.stringify(await since(page, m)));

    // --- THE CLAIM: hover `Change click type` (opens flyout)
    m = await mark(page);
    await page.getByRole('button', { name: /Change click type/ }).hover();
    await page.waitForTimeout(250);
    const openCommits = await since(page, m);
    console.log('HOVER Change click type (OPEN):', JSON.stringify(openCommits));
    const cls = await page.locator('div.menu-surface').filter({ hasText: 'Duplicate' })
      .locator('div.absolute').first().getAttribute('class');
    console.log('FLYOUT WRAPPER CLASS:', cls);

    // --- close by hovering Duplicate
    m = await mark(page);
    await page.getByRole('button', { name: /^Duplicate/ }).hover();
    await page.waitForTimeout(250);
    console.log('HOVER Duplicate (CLOSE):', JSON.stringify(await since(page, m)));

    // --- CONTROL B: the pre-existing `More` flyout, same mechanism
    m = await mark(page);
    await page.getByRole('button', { name: /^More$/ }).hover();
    await page.waitForTimeout(250);
    console.log('HOVER More (OPEN):', JSON.stringify(await since(page, m)));

    // --- CONTROL C: same sweep on a PAUSE row (no click slot)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const prow = page.locator('tr[data-row-index="5"]');
    await prow.click({ button: 'right' });
    await expect(page.locator('div.menu-surface').filter({ hasText: 'Duplicate' }).first()).toBeVisible();
    await page.waitForTimeout(250);
    console.log('PAUSE ROW HAS CLICK SLOT:',
      await page.getByRole('button', { name: /Change click type/ }).count());
  });
}
