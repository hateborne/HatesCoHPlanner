/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from https://hateborne.github.io/HatesCoHPlanner/ so every asset URL is under this base.
export default defineConfig({
  base: '/HatesCoHPlanner/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
