// Browser tests (e2e/): forum builds recreated through the planner's own screens, on the desktop
// layout and the phone layout (`npm run e2e`). At home they use the installed Google Chrome, so no
// browser download is needed. Every pull request runs them too (the "Browser tests" check of
// ci.yml), with the differences CHECK makes below.
import { defineConfig } from '@playwright/test';

// its own port, so a dev server already running on 5173 is left alone
const PORT = 5180;
const URL = `http://localhost:${PORT}/HatesCoHPlanner/`;
// running as the pull request check (GitHub sets CI on its runners)
const CHECK = !!process.env.CI;
// ci.yml's word that Playwright's own Chromium could not be downloaded
const FALLBACK = process.env.HCP_E2E_BROWSER === 'chrome';

export default defineConfig({
  testDir: 'e2e',
  // the screenshot check has a config of its own (e2e/screens.config.ts)
  testIgnore: 'screens/**',
  // a `test.only` left in a spec fails the check: it would pass it with one test run
  forbidOnly: CHECK,
  // a whole build (24 powers, 67 slots, ~100 enhancements) is walked screen by screen
  timeout: 10 * 60_000,
  expect: { timeout: 10_000 },
  // the runner has four cores to itself; at home two leave the machine usable
  workers: CHECK ? 4 : 2,
  reporter: [['list']],
  use: {
    baseURL: URL,
    // The check uses Playwright's own Chromium (ci.yml downloads it), which only a change of the
    // Playwright version in package.json moves. The runner's Chrome moves with GitHub's image, and
    // could fail a pull request that changed nothing; the check falls back to it only when the
    // download failed (FALLBACK).
    channel: CHECK && !FALLBACK ? 'chromium' : 'chrome',
    // A whole walk's trace is some 400 MB, too much to keep on a run: the check keeps the picture
    // and the error note of a failed test (test-results/) and records no trace.
    trace: CHECK ? 'off' : 'retain-on-failure',
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
