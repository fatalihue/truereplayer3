import { defineConfig } from '@playwright/test';

// The app only ever ships inside WebView2 (evergreen Chromium), so Chromium is the one
// project that matters here — see vite.config.ts's `target: 'chrome114'` comment.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  // Reuses a `vite-dev` server already started via .claude/launch.json instead of
  // spawning a second one on the same port.
  webServer: {
    command: 'npm run dev -- --port 5173 --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
