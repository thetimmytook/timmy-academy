import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('../../apps/web/auth-poc', import.meta.url)),
  publicDir: fileURLToPath(new URL('../../apps/web/public', import.meta.url)),
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: { '/src': fileURLToPath(new URL('../../apps/web/src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5190,
    strictPort: true,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  },
  build: { target: 'es2022' },
});
