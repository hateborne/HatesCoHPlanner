/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Writes the golden numbers again (tests/goldennumbers.test.ts says when):
//   npx vitest run --config tests/goldenwrite.config.ts
// The same test file as `npm test` runs, told to write what it would otherwise compare. The switch
// is handed over by this config alone (`provide`), so nothing left set in a shell can turn an
// ordinary test run into one that writes; and the first run of a new game version, which levels and
// slots every build, gets the time it needs.
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  base: '/HatesCoHPlanner/',
  test: {
    environment: 'node',
    include: ['tests/goldennumbers.test.ts'],
    provide: { goldenWrite: true },
    testTimeout: 60 * 60 * 1000,
  },
});
