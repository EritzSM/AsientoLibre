import { defineConfig } from 'vitest/config';
import { nestTypescript } from './test/typescript-transform.js';

export default defineConfig({
  plugins: [nestTypescript()],
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    setupFiles: ['./test/setup.ts'],
    root: './',
    include: ['**/*.spec.ts'],
  },
});
