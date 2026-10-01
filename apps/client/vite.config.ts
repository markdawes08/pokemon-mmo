import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const backend = `http://127.0.0.1:${process.env.PORT ?? '2567'}`;
export default defineConfig({
  root: import.meta.dirname,
  publicDir: resolve(root, '.local/client-public'),
  server: {
    host: '127.0.0.1',
    port: Number(process.env.CLIENT_PORT ?? '5173'),
    strictPort: true,
    fs: {
      // Retain Vite 8 defaults and exclude operational source/data from @fs.
      deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**',
        '**/tools/**', '**/reports/**', '**/.local/!(client-public)', '**/.local/!(client-public)/**',
        '**/content/generated/server/**', '**/apps/server/**', '**/packages/database/**',
        '**/packages/battle-core/**', '**/packages/content-schema/src/gameplay-server.ts'],
    },
    proxy: {
      '/api': { target: backend },
      '/matchmake': { target: backend },
      '/socket': { target: backend, ws: true, rewrite: path => path.replace(/^\/socket/, '') },
    },
  },
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 1600 },
});
