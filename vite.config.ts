import { localSync } from './configuration/local-sync';
import { loadSite } from './configuration/site.ts';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
const site = loadSite();
// The pinned runtime exposes scheduled dispatch through its local-only Explorer API.
process.env.X_LOCAL_EXPLORER = 'true';
export default defineConfig({
  plugins: [react(), cloudflare(), localSync(site)],
  server: {
    host: '127.0.0.1',
    port: Number(new URL(loadSite().localOrigin || 'http://localhost:5173').port || 80),
    strictPort: true,
  },
  build: { sourcemap: false },
  environments: { ssr: { build: { sourcemap: true } } },
});
