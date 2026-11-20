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
          let delay = 10000;
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
              // Only the simulated local RPC store gets accelerated catch-up. Remote
              // bindings retain normal polling and its existing request/cost profile.
              if (site.storage === 'local' && site.catalogSource === 'rpc') {
                const catalog = await fetch(new URL('/api/catalog', site.localOrigin), {
                  signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
                });
                if (!catalog.ok) throw new Error('Could not read local catalog sync progress.');
                const { sync } = (await catalog.json()) as {
                  sync?: { complete?: boolean; error?: string | null };
                };
                if (typeof sync?.complete !== 'boolean')
                  throw new Error('Local catalog returned invalid sync progress.');
                if (sync.error) throw new Error(sync.error);
                // Keep one run in flight. Pause briefly to yield to foreground work;
                // never move the checkpoint ourselves or omit unscanned history.
                if (!sync.complete) delay = 100;
              }
              lastError = '';
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!stopped && message !== lastError) server.config.logger.warn(message);
            lastError = message;
          } finally {
            if (!stopped) timer = setTimeout(run, delay);
          }
        };
        timer = setTimeout(run, 1500);
      });
    },
  };
}
