import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// fileURLToPath pattern works on Node 18+; import.meta.dirname requires Node 22+
const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.ts'],
      exclude: ['lib/server/**'], // server-only modules require the Next.js runtime
    },
  },
  resolve: {
    alias: { '@': path.resolve(rootDir, '.') },
  },
});
