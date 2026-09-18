import { test, expect } from '@playwright/test';

// Decisive pass: the duplicate is only ON SCREEN while the More menu is OPEN.
// Opening the menu mounts an absolutely-positioned popover INSIDE the row, which can
// inflate row.scrollWidth and therefore bump overflowCount. So row-state and menu-state
// must be read in ONE snapshot, WITH THE MENU OPEN — not before opening it.

test.setTimeout(180_000);

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
  recordButtonText: 'Recording', replayButtonText: 'Replay', canUndo: true, canRedo: true,
  copiedCount: 0, ...over,
});
const rows = () => Array.from({ length: 6 }, (_, i) =>
  base({ id: 'r' + i, x: i * 10, y: i * 10, rowNumber: i + 1 }));

async function boot(page: import('@playwright/test').Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto('/');
  await expect(page.getByText('Ready', { exact: true })).toBeVisible();
  await post(page, { type: 'actions:updated', payload: { actions: rows() } });
  await post(page, { type: 'button:states', payload: btnStates({}) });
  await page.waitForTimeout(500);
}

// ONE snapshot: row buttons + menu items + geometry, all read in the same tick.
// "visible" is a real hit-test: rect inside the bar's client box and non-zero size.
const snapshot = () => {
  const row = document.querySelector('[data-tb-unit]')?.parentElement as HTMLElement | null;
  if (!row) return null;
  const bar = row.parentElement as HTMLElement;
  const barRect = bar.getBoundingClientRect();
  const cs = getComputedStyle(bar);
  const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');

  const panel = Array.from(document.querySelectorAll('div.menu-surface'))
    .find(d => (d.textContent || '').includes('More actions')) as HTMLElement | undefined;

  const rowButtons = Array.from(row.querySelectorAll('button'))
    .filter(b => !(panel && panel.contains(b)))
    .map(b => {
      const r = b.getBoundingClientRect();
      return {
        tip: b.getAttribute('data-tip'),
        w: Math.round(r.width),
        onScreenInBar: r.width > 0 && r.height > 0 && r.left >= barRect.left - 1 && r.right <= barRect.right + 1,
      };
    })
    .filter(b => b.tip);

  const menuItems = panel
    ? Array.from(panel.querySelectorAll('button')).map(b => {
        const r = b.getBoundingClientRect();
        return { label: (b.textContent || '').trim(), w: Math.round(r.width), visible: r.width > 0 && r.height > 0 };
      })
    : null;

  return {
    innerW: window.innerWidth,
    barW: bar.clientWidth,
    available: Math.round((bar.clientWidth - pad - parseFloat(cs.columnGap || '0')) * 10) / 10,
    scrollW: row.scrollWidth,
    offsetW: row.offsetWidth,
    unit: (row.querySelector('[data-tb-unit]') as HTMLElement | null)?.offsetWidth ?? 0,
    rowButtons,
    menuItems,
  };
};

type Snap = NonNullable<ReturnType<typeof snapshot>>;

const hasRow = (s: Snap, en: string, pt: string) =>
  s.rowButtons.filter(b => (b.tip === en || b.tip === pt) && b.onScreenInBar).length;
const hasMenu = (s: Snap, label: string) =>
  (s.menuItems ?? []).filter(m => m.label === label && m.visible).length;

function ocFromRow(s: Snap) {
  const h = (en: string, pt: string) => s.rowButtons.some(b => b.tip === en || b.tip === pt);
  if (!h('Run Profile', 'Executar perfil')) return 4;
  if (!h('Activate Window', 'Ativar janela')) return 3;
  if (!h('Data Loop', 'Data Loop')) return 2;
  if (!h('Clear All', 'Limpar tudo')) return 1;
  return 0;
}

function report(tag: string, s: Snap) {
  const oc = ocFromRow(s);
  const aw = hasRow(s, 'Activate Window', 'Ativar janela') + hasMenu(s, 'Activate Window');
  const rp = hasRow(s, 'Run Profile', 'Executar perfil') + hasMenu(s, 'Run Profile');
  const dl = hasRow(s, 'Data Loop', 'Data Loop') + hasMenu(s, 'Data Loop');
  console.log(
    `${tag} innerW=${s.innerW} bar=${s.barW} avail=${s.available} scrollW=${s.scrollW} offsetW=${s.offsetW} unit=${s.unit}` +
    ` | oc(row)=${oc}` +
    ` | AW=${hasRow(s, 'Activate Window', 'Ativar janela')}+${hasMenu(s, 'Activate Window')}=${aw}` +
    ` | RP=${hasRow(s, 'Run Profile', 'Executar perfil')}+${hasMenu(s, 'Run Profile')}=${rp}` +
    ` | DL=${hasRow(s, 'Data Loop', 'Data Loop')}+${hasMenu(s, 'Data Loop')}=${dl}` +
    ` | menu=[${(s.menuItems ?? []).map(m => m.label).join(' / ')}]`
  );
  return { oc, aw, rp, dl };
}

async function expandBothRails(page: import('@playwright/test').Page) {
  for (let i = 0; i < 4; i++) {
    const btn = page.locator('button[data-tip="Expand panel"], button[data-tip="Expandir painel"]');
    if (await btn.count() === 0) break;
    await btn.first().click();
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(400);
}

test('A: does an OPEN More popover inflate row.scrollWidth (and bump overflowCount)?', async ({ page }) => {
  await boot(page, 1600);
  for (const w of [680, 660, 640]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(500);
    const before = (await page.evaluate(snapshot))!;
    report(`w=${w} CLOSED`, before);
    await page.locator('button[data-tip="More"], button[data-tip="Mais"]').first().click();
    await page.waitForTimeout(500);
    const after = (await page.evaluate(snapshot))!;
    report(`w=${w} OPEN  `, after);
    console.log(`   scrollW closed=${before.scrollW} -> open=${after.scrollW}  (delta ${after.scrollW - before.scrollW})`);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 500);
    await page.waitForTimeout(300);
  }
});

test('B: REAL path (min window 960 DIP, BOTH rails re-expanded by hand) — menu OPEN snapshot', async ({ page }) => {
  await boot(page, 1600);
  await page.setViewportSize({ width: 958, height: 800 });
  await page.waitForTimeout(600);
  await expandBothRails(page);

  for (const w of [958, 990, 1000, 1006, 1014, 1022, 1030, 1040, 1050, 1054]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(600);
    const closed = (await page.evaluate(snapshot))!;
    const more = page.locator('button[data-tip="More"], button[data-tip="Mais"]');
    if (await more.count() === 0) { report(`w=${w} NOMENU`, closed); continue; }
    await more.first().click();
    await page.waitForTimeout(500);
    const open = (await page.evaluate(snapshot))!;
    const r = report(`w=${w} OPEN `, open);
    if (r.aw > 1 || r.rp > 1 || r.dl > 1) {
      console.log(`   >>> DUPLICATE ON SCREEN at w=${w}: AW=${r.aw} RP=${r.rp} DL=${r.dl}`);
    }
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 500);
    await page.waitForTimeout(300);
  }
});

test('C: click BOTH affordances of the duplicated control and compare the bridge payloads', async ({ page }) => {
  await boot(page, 1600);
  // Park at a width that rests with a duplicate, via the rails-auto-collapsed path.
  await page.setViewportSize({ width: 680, height: 800 });
  await page.waitForTimeout(700);

  await page.evaluate(() => {
    (window as any).__sent = [];
    window.addEventListener('message', (e: MessageEvent) => {
      const d: any = e.data;
      if (d && typeof d === 'object' && typeof d.type === 'string' && d.type.startsWith('actions:')) {
        (window as any).__sent.push(JSON.stringify(d));
      }
    }, true);
  });

  // 1) click the ROW's Activate Window
  const rowAw = page.locator('button[data-tip="Activate Window"], button[data-tip="Ativar janela"]');
  console.log('row Activate Window buttons:', await rowAw.count());
  await rowAw.first().click();
  await page.waitForTimeout(400);

  // 2) open More and click the MENU's Activate Window
  await page.locator('button[data-tip="More"], button[data-tip="Mais"]').first().click();
  await page.waitForTimeout(400);
  const snapOpen = (await page.evaluate(snapshot))!;
  report('with menu OPEN', snapOpen);
  const menuAw = page.locator('div.menu-surface').filter({ hasText: 'More actions' }).locator('button', { hasText: 'Activate Window' });
  console.log('menu Activate Window buttons:', await menuAw.count());
  if (await menuAw.count() > 0) {
    await menuAw.first().click();
    await page.waitForTimeout(400);
  }

  const sent = await page.evaluate(() => (window as any).__sent as string[]);
  console.log('bridge payloads captured:');
  for (const s of sent) console.log('   ', s);
});
