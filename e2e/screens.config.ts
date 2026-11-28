// The screenshot check (e2e/screens/screens.spec.ts says what it is): the planner's screens on the
// desktop and the phone layout, compared pixel for pixel with pictures taken before a change.
//   npx playwright test --config e2e/screens.config.ts --update-snapshots   on main: takes the pictures
//   npx playwright test --config e2e/screens.config.ts                      on the branch: compares
// A config of its own, so `npm run e2e` never runs it: a picture only means something beside one
// taken on the same machine, and the pictures (.screens/) are not committed.
import { defineConfig } from '@playwright/test';

// its own port, so a dev server on 5173 and the browser tests' on 5180 are left alone
const PORT = 5181;
const URL = `http://localhost:${PORT}/HatesCoHPlanner/`;

export default defineConfig({
  testDir: 'screens',
  // throws the old pictures away and notes what the new ones are of, or checks that note (screens/taken.ts)
  globalSetup: './screens/taken.ts',
  // only --update-snapshots writes a picture: a comparison that wrote the ones it misses would pass
  // the next time against the branch's own
  updateSnapshots: 'none',
  // a picture differs or it does not: nothing is gained by trying again
  retries: 0,
  timeout: 5 * 60_000,
  // one at a time: two pages drawing at once can take a frame longer to settle
  workers: 1,
  reporter: [['list']],
  // where the pictures are kept: .screens/<layout>/<name>.png at the repository's root, ignored by git
  snapshotPathTemplate: '../.screens/{projectName}/{arg}{ext}',
  expect: {
    timeout: 15_000,
    // pixel for pixel, with no tolerance: the page's own animations held still, the caret hidden,
    // in the device's own pixels (a phone's picture scaled down to CSS pixels blurs its thin lines).
    // Every picture is taken of a page made to draw itself again (screens.spec.ts, redraw): drawn
    // that way a screen comes out the same to the last bit every time (three full runs of 178
    // pictures against pictures taken just before, not one pixel off). The comparison itself
    // leaves out the pixels it takes for a smoothed edge; nothing here can change that.
    toHaveScreenshot: { maxDiffPixels: 0, threshold: 0, animations: 'disabled', caret: 'hide', scale: 'device' },
  },
  use: {
    baseURL: URL,
    channel: 'chrome',
    // a press on something that is not there fails in seconds, not at the walk's five minutes
    actionTimeout: 15_000,
    // drawn by the processor, not the graphics card: a card rounds a blended pixel one step up or
    // down as it pleases, and two runs of one screen then differ in a few pixels by one step
    launchOptions: { args: ['--disable-gpu', '--force-color-profile=srgb'] },
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
