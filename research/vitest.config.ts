/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The build research (`npm run research`): its own file pattern, so `npm test` never runs it. It
// reads the owner's build folder (HCP_BUILD_CORPUS) and writes public/data/finder/stats.json and
// pipeline/report-finder.md (docs/pipeline.md, "Build research").
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  base: '/HatesCoHPlanner/',
  test: {
    environment: 'node',
    include: ['research/**/*.research.ts'],
    testTimeout: 60 * 60 * 1000,
  },
});
