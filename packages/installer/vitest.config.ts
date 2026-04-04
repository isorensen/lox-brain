import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15_000, // Windows CI is slower for prerequisite checks
  },
});
