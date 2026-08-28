import path from 'node:path';

import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    // @testing-library/react's auto-cleanup between tests only registers when it detects a
    // global afterEach (its Jest-compatible auto-detection) — without this, DOM from earlier
    // tests in the same file accumulates and multi-element queries start failing.
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // Without this, Vitest's default include pattern also picks up the Playwright E2E specs
    // under e2e/ — those use a different test() (from @playwright/test, not Vitest's), which
    // fails immediately when Vitest tries to run them.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
