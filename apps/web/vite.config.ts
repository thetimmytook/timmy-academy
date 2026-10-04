import { readFileSync } from 'node:fs';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  envDir: false,
  plugins: [
    react(),
    {
      name: 'cloudflare-asset-headers',
      apply: 'build',
      generateBundle(): void {
        this.emitFile({
          type: 'asset',
          fileName: '_headers',

          // Fixed repository path; no request or environment input reaches this filename.
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          source: readFileSync(
            new URL('../../infrastructure/asset-headers', import.meta.url),
            'utf8',
          ),
        });
      },
    },
  ],
  build: { target: 'es2022' },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  test: {
    environment: 'jsdom',
  },
});
