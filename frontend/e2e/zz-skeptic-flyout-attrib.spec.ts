import { test, expect } from '@playwright/test';

// SKEPTIC: the claim is that commit #2 on flyout-open is a full ActionTable render of N rows
// costing 133-535 ms. Measure WHICH fibers actually render in each commit.

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
    const isPause = i === 5;
    out.push(base({
      id: `r${i}`, actionType: isPause ? 'Pause' : 'LeftClick',
      x: 10 + i, y: 20 + i, rowNumber: i + 1, timeout: isPause ? 1000 : 5000,
    }));
  }
  return out;
}

async function boot(page: import('@playwright/test').Page, n: number) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__commits = [];
    w.__lastCommitEnd = 0;
    const nameOf = (f: any): string => {
      const t = f?.type;
      if (typeof t === 'string') return `<${t}>`;
      if (typeof t === 'function') return t.displayName || t.name || 'Anon';
      if (t && typeof t === 'object') return t.displayName || t.name || (t.$$typeof ? String(t.$$typeof).slice(7, -1) : 'Obj');
      if (f?.tag === 3) return 'HostRoot';
      return `tag${f?.tag}`;
    };
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      renderers: new Map(), supportsFiber: true, _id: 0,
      inject(r: unknown) { this._id++; this.renderers.set(this._id, r); return this._id; },
      onCommitFiberRoot(_id: unknown, root: any) {
        try {
          const cutoff = w.__lastCommitEnd;
          const rendered: Record<string, number> = {};
          let count = 0;
          const walk = (f: any, depth: number) => {
            if (!f || depth > 60) return;
            // actualStartTime is stamped when a fiber BEGINS work. A fiber that bailed out
            // keeps the stamp from an earlier pass, so > cutoff == "rendered in this pass".
            if (f.actualStartTime > cutoff) {
              const n2 = nameOf(f);
              rendered[n2] = (rendered[n2] ?? 0) + 1;
              count++;
            }
            walk(f.child, depth + 1);
            walk(f.sibling, depth);
          };
          walk(root?.current, 0);
          w.__commits.push({
            d: Math.round((root?.current?.actualDuration ?? -1) * 10) / 10,
            fibers: count,
            // keep only the busiest names so the log stays readable
            top: Object.entries(rendered).sort((a, b) => b[1] - a[1]).slice(0, 8),
            html: w.__hashBody(),
          });
          w.__lastCommitEnd = performance.now();
        } catch (e) { w.__commits.push({ err: String(e) }); }
      },
      onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {},
      emit() {}, on() {}, off() {}, getFiberRoots() { return new Set(); },
      sub() { return () => {}; },
    };
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
  await page.waitForTimeout(500);
}

const mark = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ((window as any).__commits as unknown[]).length);

const since = (page: import('@playwright/test').Page, from: number) =>
  page.evaluate((f) => {
    const all = (window as any).__commits as any[];
    const prev = f > 0 ? all[f - 1] : null;
    return all.slice(f).map((c, i, sl) => ({
      d: c.d, fibers: c.fibers,
      noop: i === 0 ? (prev ? prev.html === c.html : false) : sl[i - 1].html === c.html,
    }));
  }, from);

for (const n of [3, 25, 400]) {
  test(`ATTRIBUTION @ ${n} rows`, async ({ page }) => {
    await boot(page, n);
    const trs = await page.locator('tbody tr').count();
    console.log(`\n===== ROWS=${n} <tr> IN DOM=${trs} =====`);

    const row = page.locator('tr[data-row-index="2"]');
    await row.click({ button: 'right' });
    const menu = page.locator('div.menu-surface').filter({ hasText: 'Duplicate' }).first();
    await expect(menu).toBeVisible();
    await page.waitForTimeout(400);

    let m = await mark(page);
    await page.getByRole('button', { name: /Change click type/ }).hover();
    await page.waitForTimeout(400);
    console.log('OPEN clicktype:', JSON.stringify(await since(page, m)));

    m = await mark(page);
    await page.getByRole('button', { name: /^Duplicate/ }).hover();
    await page.waitForTimeout(400);
    console.log('CLOSE:', JSON.stringify(await since(page, m)));

    m = await mark(page);
    await page.getByRole('button', { name: /^More$/ }).hover();
    await page.waitForTimeout(400);
    console.log('OPEN more:', JSON.stringify(await since(page, m)));
  });
}
