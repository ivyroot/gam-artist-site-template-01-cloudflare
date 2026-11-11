import { bindings, defineConfig, triggers } from 'cf/config';
import { loadSite, runtimeSite, selectMode } from './configuration/site.ts';
export default defineConfig(({ mode }) => {
  const selected =
    process.env.GAM_SITE_MODE ||
    (mode && !['development', 'production', 'test'].includes(mode) ? mode : 'local-dev');
  const site = loadSite(selectMode(selected));
  const inventory = site.inventoryPage;
  const dev = { remote: site.storage === 'cloudflare' };
  return {
    accountId: site.cloudflareAccountId || undefined,
    worker: {
      name: site.workerName,
      entrypoint: './src/worker/index.ts',
      compatibilityDate: '2026-11-10',
      compatibilityFlags: ['nodejs_compat'],
      assets: {
        notFoundHandling: 'single-page-application',
        runWorkerFirst: [
          '/api/*',
          '/download/*',
          '/listing/*',
          '/collection/*',
          '/listings.json',
          '/previews/*',
          '/library',
          '/admin',
          '/admin/*',
          '/inventory',
          '/inventory/*',
          ...(inventory ? [inventory, `${inventory}/*`] : []),
        ],
      },
      env: {
        ASSETS: bindings.assets(),
        SITE_CONFIG: bindings.text(JSON.stringify(runtimeSite(site))),
        SESSION_SECRET: bindings.secret(),
        DB: bindings.d1({
          id: site.databaseId || undefined,
          name: site.databaseName || undefined,
          dev,
        }),
        ART_BUCKET: bindings.r2({
          name: site.originalsBucket || undefined,
          dev,
        }),
        PREVIEWS: bindings.r2({
          name: site.previewsBucket || undefined,
          dev,
        }),
      },
      triggers: [triggers.scheduled({ schedule: '*/5 * * * *' })],
      observability: { enabled: true },
    },
  };
});
