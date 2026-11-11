import { bindings, defineConfig, triggers } from 'cf/config';
import productionSite from './site.config.json' with { type: 'json' };
import stagingSite from './site.staging.config.json' with { type: 'json' };
import { inventoryPage } from './src/shared/inventory.ts';
export default defineConfig(({ mode }) => {
  const site = mode === 'staging' ? stagingSite : productionSite;
  const inventory = inventoryPage(site.inventoryPage);
  if ((site.artist || site.contract) && !inventory) {
    throw new Error(
      'Choose a custom inventoryPage in the site configuration before configuring an artist deployment.',
    );
  }
  return {
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
        SITE_CONFIG: bindings.text(JSON.stringify(site)),
        SESSION_SECRET: bindings.secret(),
        DB: bindings.d1({ name: `${site.workerName}-catalog` }),
        ART_BUCKET: bindings.r2({
          name: `${site.workerName}-originals`,
        }),
        PREVIEWS: bindings.r2({
          name: `${site.workerName}-previews`,
        }),
      },
      triggers: [triggers.scheduled({ schedule: '*/5 * * * *' })],
      observability: { enabled: true },
    },
  };
});
