import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { readFileSync } from 'node:fs';
import { loadSite } from './configuration/site.ts';
const sandbox = loadSite('local-dev');
const live = process.env.GAM_TEZBOX_TEST === '1';
let bootstrapKey = '';
if (live) {
  const accounts = readFileSync(
    new URL('../tezbox/configuration/accounts.hjson', import.meta.url),
    'utf8',
  );
  bootstrapKey = accounts.match(/alice:[\s\S]*?sk: unencrypted:(\S+)/)?.[1] ?? '';
  if (!bootstrapKey) throw new Error('Local TezBox alice sandbox account was not found.');
}
export default defineConfig({
  plugins: [
    cloudflareTest({
      config: './cloudflare.config.ts',
      miniflare: {
        serviceBindings: live
          ? {
              TEZBOX_RPC: async (request: any) => {
                const response = await fetch(request.url, {
                  method: request.method,
                  headers: Object.fromEntries(request.headers),
                  body:
                    request.method === 'GET' || request.method === 'HEAD'
                      ? undefined
                      : await request.arrayBuffer(),
                });
                return response;
              },
            }
          : {},
        bindings: { SESSION_SECRET: 'testing-secret-that-is-at-least-32-characters-long' },
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
    provide: {
      tezbox: {
        enabled: live,
        bootstrapKey,
        rpc: process.env.TEZBOX_RPC ?? sandbox.rpc,
        contract: process.env.TEZBOX_GAM_ADDRESS ?? sandbox.contract,
      },
    },
  },
});
