/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Adds recorded releases to the corpus (tests/recordedcorpus.test.ts says what the corpus is).
// tests/corpus/record.mjs runs it, after it has had each release record what it writes:
//   node tests/corpus/record.mjs <tag>...
// The same test file as `npm test` runs, told to take the records in where it would check them.
// The switch is handed over by this config alone (`provide`), as the golden numbers' is.
export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  base: '/HatesCoHPlanner/',
  test: {
    environment: 'node',
    include: ['tests/recordedcorpus.test.ts'],
    provide: { corpusWrite: true },
    testTimeout: 60 * 60 * 1000,
  },
});
