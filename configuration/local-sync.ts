import type { Plugin } from 'vite';
import type { loadSite } from './site';

// Invoke the runtime's existing scheduled handler. No application sync endpoint is exposed.
// The timer starts only after this Vite server successfully binds its own port.
export function localSync(site: ReturnType<typeof loadSite>): Plugin {
  return {
    name: 'gam-local-catalog-sync',
    apply: 'serve',
    configureServer(server) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let lastError = '';
      const controller = new AbortController();
      const stop = () => {
        stopped = true;
        clearTimeout(timer);
        controller.abort();
      };
      server.httpServer?.once('close', stop);
      server.httpServer?.once('listening', () => {
        const run = async () => {
          if (stopped) return;
          try {
            if (
              site.artist &&
              site.contract &&
              site.chainId &&
              site.rpc &&
              site.origin &&
              (site.catalogSource === 'rpc' || site.indexer)
            ) {
              const url = new URL('/cdn-cgi/local/explorer/api/local/scheduled', site.localOrigin);
              url.searchParams.set('worker', site.workerName);
              const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cron: '*/5 * * * *' }),
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
              });
              const result = (await response.json()) as {
                success?: boolean;
                result?: { outcome?: string };
              };
              if (!response.ok || !result.success || result.result?.outcome !== 'ok')
                throw new Error(
                  `Local scheduled catalog sync failed (${response.status}). See Worker logs and Inventory sync status.`,
                );
              lastError = '';
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!stopped && message !== lastError) server.config.logger.warn(message);
            lastError = message;
          } finally {
            if (!stopped) timer = setTimeout(run, 10000);
          }
        };
        timer = setTimeout(run, 1500);
      });
    },
  };
}
