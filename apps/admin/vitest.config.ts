import path from 'node:path';

import { defineConfig } from 'vitest/config';
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
  },
});
