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
    proxy: {
      '/api': { target: backend },
      '/matchmake': { target: backend },
      '/socket': { target: backend, ws: true, rewrite: path => path.replace(/^\/socket/, '') },
    },
  },
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 1600 },
});
