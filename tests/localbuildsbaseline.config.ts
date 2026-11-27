/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The local build check, writing its baseline (run on main, before the branch is compared):
//   npx vitest run --config tests/localbuildsbaseline.config.ts
// The same file as tests/localbuilds.config.ts runs, told to write the record it takes where it
// would compare it. The switch is handed over by this config alone (`provide`).
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  base: '/HatesCoHPlanner/',
  test: {
    environment: 'node',
    include: ['tests/localbuilds.check.ts'],
    // the run ends in a line that says what it found: let it through
    silent: false,
    reporters: ['verbose'],
    provide: { localBaseline: true },
    testTimeout: 60 * 60 * 1000,
  },
});
