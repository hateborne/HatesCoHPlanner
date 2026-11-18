// The browser tests against the built site (`npm run e2e:built`): the same tests as `npm run e2e`,
// served from a production build instead of the dev server. Only a build has the page's
// Content-Security-Policy, the pieces downloaded on demand (the set finder's pane) as files of
// their own, and each server's own page, so run it before a deploy that changes any of those.
import { defineConfig } from '@playwright/test';
import dev, { PORT, URL } from './playwright.config.ts';

export default defineConfig({
  ...dev,
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: false,
    // the type check and the build come first
    timeout: 300_000,
  },
});
