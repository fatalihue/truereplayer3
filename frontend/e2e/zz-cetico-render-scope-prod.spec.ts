import { test, expect } from '@playwright/test';

// Independent skeptic probe for the "every submenu hover re-renders all N rows" claim.
// Three questions, answered separately:
//   Q1 does the tbody really hold N rows (no virtualization gate)?
//   Q2 does the hover cost scale with N (= the commit is O(N)) or stay flat?
//   Q3 is the NEW trigger (Change click type) different in cost from the OLD one (More)?
// Sizes: the owner's real library tops out at 87 rows (median 6). 500 is the claim's number.

function post(page: import('@playwright/test').Page, msg: unknown) {
  return page.evaluate((m) => (window as unknown as Record<string, (x: unknown) => void>).__emit(m), msg);
}

const base = (over: Record<string, unknown>) => ({
  id: 'x', actionType: 'LeftClick', key: '', x: 0, y: 0, delay: 0, comment: '',
  rowNumber: 1, isInsertionPoint: false, shouldHighlight: false, imagePath: '',
  timeout: 5000, confidence: 0.8, imageBase64: '', browserText: '', newTab: false,
  isSkipped: false, ...over,
});
const btnStates = () => ({
  recordEnabled: true, replayEnabled: true, recordingActive: false, replayActive: false,
  recordButtonText: 'Recording', replayButtonText: 'Replay', canUndo: false, canRedo: false,
  copiedCount: 0,
});

function mixedRows(n: number) {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const m = i % 7;
    let over: Record<string, unknown>;
    if (i === 0 || m === 0) over = { actionType: 'LeftClick', x: 100 + i, y: 200 + i };
    else if (m === 1) over = { actionType: 'Keystroke', key: 'a' };
    else if (m === 2) over = { actionType: 'LeftClickDown', x: 100 + i, y: 200 + i };
    else if (m === 3) over = { actionType: 'LeftClickUp', x: 100 + i, y: 200 + i };
    else if (m === 4) over = { actionType: 'Pause', delay: 100 };
    else if (m === 5) over = { actionType: 'LeftClick', x: 50 + i, y: 60 + i };
    else over = { actionType: 'Keystroke', key: 'b' };
    out.push(base({ id: 'r' + i, rowNumber: i + 1, ...over }));
  }
  return out;
}

const SIZES = [6, 31, 87, 500];

test('PROD build: render scope + hover cost vs row count', async ({ page }) => {
  test.setTimeout(300_000);

  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__commits = 0;
    const listeners = new Set<(e: { data: unknown }) => void>();
    (w as Record<string, unknown>).chrome = { webview: {
      addEventListener: (_t: string, h: (e: { data: unknown }) => void) => { listeners.add(h); },
      removeEventListener: (_t: string, h: (e: { data: unknown }) => void) => { listeners.delete(h); },
      postMessage: () => {},
    } };
    w.__emit = (m: unknown) => { listeners.forEach(h => h({ data: m })); };
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      isDisabled: false,
      supportsFiber: true,
      renderers: new Map(),
      inject(r: unknown) {
        const m = (w.__REACT_DEVTOOLS_GLOBAL_HOOK__ as { renderers: Map<number, unknown> }).renderers;
        const id = m.size + 1; m.set(id, r); return id;
      },
      onCommitFiberRoot() { (w.__commits as number)++; },
      onPostCommitFiberRoot() { },
      onCommitFiberUnmount() { },
      checkDCE() { },
    };
    w.__startTicker = () => {
      w.__maxGap = 0; w.__last = performance.now(); w.__run = true; w.__commits = 0;
      const tick = () => {
        if (!w.__run) return;
        const now = performance.now();
        const gap = now - (w.__last as number);
        if (gap > (w.__maxGap as number)) w.__maxGap = gap;
        w.__last = now;
        setTimeout(tick, 0);
      };
      setTimeout(tick, 0);
    };
    w.__stopTicker = () => { w.__run = false; return { gap: w.__maxGap as number, commits: w.__commits as number }; };
  });

  await page.goto('http://127.0.0.1:5176/');
  await page.getByText('Ready', { exact: true }).waitFor();
  await post(page, { type: 'button:states', payload: btnStates() });

  const out: Record<string, unknown> = {};

  for (const n of SIZES) {
    await post(page, { type: 'actions:updated', payload: { actions: mixedRows(n) } });
    await page.waitForTimeout(800);

    // Q1 — how many <tr> actually exist?
    const rowsInDom = await page.locator('tbody tr').count();

    const measure = async (fn: () => Promise<void>, settle = 500) => {
      await page.evaluate(() => (window as unknown as Record<string, () => void>).__startTicker());
      await fn();
      await page.waitForTimeout(settle);
      return page.evaluate(() => (window as unknown as Record<string, () => { gap: number; commits: number }>).__stopTicker());
    };

    const row0 = page.locator('tbody tr').first();
    const openMenu = await measure(async () => { await row0.click({ button: 'right' }); }, 700);

    const cct = page.getByRole('button', { name: /Change click type/ });
    const dup = page.getByRole('button', { name: /^Duplicate/ });
    const more = page.getByRole('button', { name: /^More/ });
    const cctPresent = await cct.count();

    const plain = await measure(async () => { await dup.first().hover(); });
    const openCct = await measure(async () => { await cct.first().hover(); });
    const closeCct = await measure(async () => { await dup.first().hover(); });
    const openMore = await measure(async () => { await more.first().hover(); });
    const closeMore = await measure(async () => { await dup.first().hover(); });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // negative control: scrolling the grid, no commits expected
    const scroll = await measure(async () => {
      await page.evaluate(() => {
        const sc = document.querySelector('table')?.closest('div[class*="overflow"]') as HTMLElement | null;
        if (sc) sc.scrollTop = 1200;
      });
    }, 400);

    const fmt = (r: { gap: number; commits: number }) => `${r.gap.toFixed(1)} ms / ${r.commits}c`;
    out['N=' + n] = {
      rowsInDom, cctPresent,
      openMenu: fmt(openMenu),
      hoverPlainBailout: fmt(plain),
      openChangeClickType: fmt(openCct),
      closeChangeClickType: fmt(closeCct),
      openMore: fmt(openMore),
      closeMore: fmt(closeMore),
      scrollControl: fmt(scroll),
    };
    console.log('ROW ' + n + ' => ' + JSON.stringify(out['N=' + n]));
    expect(rowsInDom).toBe(n);
  }

  console.log('=== TABLE ===\n' + JSON.stringify(out, null, 2));
});
