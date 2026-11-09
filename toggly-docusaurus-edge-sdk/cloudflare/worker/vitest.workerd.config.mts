import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * Real workerd suite: HTMLRewriter streaming transforms and flag evaluation
 * against the Workers runtime (via @cloudflare/vitest-plugin).
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
    }),
  ],
  test: {
    include: ['tests/workerd/**/*.test.ts'],
  },
});
