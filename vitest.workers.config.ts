import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

/**
 * Durable Object integration tests, running inside workerd against the real
 * wrangler config — same bindings, same migrations, same hibernation
 * behaviour as production.
 *
 * The rules-engine unit tests live in `vitest.config.ts` and run in Node.
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['worker/**/*.test.ts'],
    /**
     * These drive real sockets and real Durable Object alarms, so they need
     * more than Vitest's 5s default — otherwise a busy machine kills a test
     * before its own (clearer) wait budget has expired.
     */
    testTimeout: 20_000,
  },
});
