import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the shared rules engine. Plain Node — the engine has no
 * runtime dependencies, which is the point of keeping it pure.
 *
 * Durable Object integration tests run in workerd instead, via
 * `vitest.workers.config.ts` (`npm run test:worker`).
 */
export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts'],
    environment: 'node',
  },
});
