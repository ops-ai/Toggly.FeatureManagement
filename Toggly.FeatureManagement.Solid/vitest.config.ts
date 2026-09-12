import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
export default defineConfig({ plugins: [solid()], test: { environment: 'jsdom', coverage: { provider: 'v8', reporter: ['text', 'lcov'], include: ['src/**/*.{ts,tsx}'], thresholds: { statements: 91, branches: 91, functions: 91, lines: 91 } } } });
