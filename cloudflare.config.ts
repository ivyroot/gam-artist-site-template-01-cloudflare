import { bindings, defineConfig, triggers } from 'cf/config';
import productionSite from './site.config.json' with { type: 'json' };
import stagingSite from './site.staging.config.json' with { type: 'json' };
export default defineConfig(({ mode }) => {
  const site = mode === 'staging' ? stagingSite : productionSite;
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
