// Browser tests (e2e/): forum builds recreated through the planner's own screens, on the desktop
// layout and the phone layout. Local only (`npm run e2e`); they use the installed Google Chrome, so
// no browser download is needed.
import { defineConfig } from '@playwright/test';

// its own port, so a dev server already running on 5173 is left alone
const PORT = 5180;
const URL = `http://localhost:${PORT}/HatesCoHPlanner/`;

export default defineConfig({
  testDir: 'e2e',
  // a whole build (24 powers, 67 slots, ~100 enhancements) is walked screen by screen
  timeout: 10 * 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: URL,
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // the desktop stage (2000 x 1125) at a common monitor size
    { name: 'desktop', use: { viewport: { width: 1920, height: 1080 } } },
    // a portrait phone: the one-panel phone layout, driven by taps
    { name: 'phone', use: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
