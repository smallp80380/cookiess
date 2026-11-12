/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts is DOM wiring exercised by the native-popup browser suite, not unit tests.
      exclude: ['src/main.ts'],
      reporter: ['text', 'html'],
      reportsDirectory: 'test-output/coverage',
      // Floors just under the current numbers: a drop fails `npm run test:coverage`.
      thresholds: { statements: 85, branches: 80, functions: 90, lines: 85 },
    },
  },
});
