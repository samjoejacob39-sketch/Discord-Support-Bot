import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Runs before any `src/` module is imported, so the logger and env cache start quiet.
    setupFiles: ['tests/setup.ts'],
    // The suite is I/O-light but every file opens its own in-memory SQLite database.
    pool: 'threads',
    testTimeout: 15_000,
    hookTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/scripts/**', 'src/ai/providers/gemini.ts'],
    },
  },
});
