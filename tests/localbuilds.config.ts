/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The local build check (tests/localbuilds.check.ts says what it is), comparing with the baseline:
//   npx vitest run --config tests/localbuilds.config.ts
// Its own file pattern, so `npm test` never runs it: it reads a folder of builds that only this
// machine has (HCP_BUILD_CORPUS).
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  base: '/HatesCoHPlanner/',
  test: {
    environment: 'node',
    include: ['tests/localbuilds.check.ts'],
    // the run ends in a line that says what it found: let it through
    silent: false,
    reporters: ['verbose'],
    testTimeout: 60 * 60 * 1000,
  },
});
