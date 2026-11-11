import { loadSite } from './configuration/site.ts';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    host: '127.0.0.1',
    port: Number(new URL(loadSite().localOrigin || 'http://localhost:5173').port || 80),
    strictPort: true,
  },
  build: { sourcemap: false },
  environments: { ssr: { build: { sourcemap: true } } },
});
