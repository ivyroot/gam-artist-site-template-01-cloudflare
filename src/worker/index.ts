import { InputError } from '../shared/model';
import { auth } from './auth';
import { admin } from './admin';
import { catalog, getWork, metadata, sync } from './catalog';
import { download, library } from './delivery';
import { config, ensure, HttpError, json, publicHeaders, type Env } from './env';
export async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url),
    path = url.pathname;
  if (req.method === 'OPTIONS') {
    if (
      path === '/listings.json' ||
      /^\/(listing|collection)\/\d+\/(listing|collection)\.json$/.test(path)
    )
      return new Response(null, {
        status: 204,
        headers: { ...publicHeaders, 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS' },
      });
    return new Response(null, { status: 405 });
  }
  if (path === '/api/session' || path.startsWith('/api/auth/')) {
    ensure(req.method === (path === '/api/session' ? 'GET' : 'POST'), 'Method not allowed.', 405);
    return auth(req, env, path);
  }
  if (path.startsWith('/api/admin/')) {
    ensure(
      req.method === 'POST' || (req.method === 'GET' && path === '/api/admin/status'),
      'Method not allowed.',
      405,
    );
    return admin(req, env, path);
  }
  ensure(req.method === 'GET' || req.method === 'HEAD', 'Method not allowed.', 405);
  if (path === '/api/health') {
    await env.DB.prepare('SELECT id FROM sync WHERE id=1').first();
    const c = config(env);
    return json({
      ok: true,
      configured: c.ready,
      sessionSecret: Boolean(env.SESSION_SECRET && env.SESSION_SECRET.length >= 32),
    });
  }
  if (path === '/api/catalog') return json(await catalog(env));
  if (path === '/api/library') return library(req, env);
  const dl = path.match(/^\/(?:api\/)?download\/(?:collection\/(\d+)|(\d+)(\/file)?)$/);
  if (dl) {
    let response: Response;
    try {
      response = await download(
        req,
        env,
        dl[1] ? 'collection' : 'listing',
        dl[1] ?? dl[2],
        Boolean(dl[3]),
      );
    } catch (e) {
      if (
        e instanceof HttpError &&
        e.status === 401 &&
        !path.startsWith('/api/') &&
        !dl[3] &&
        req.headers.get('Accept')?.includes('text/html')
      ) {
        return Response.redirect(
          new URL(`/library?next=${encodeURIComponent(path)}`, req.url).href,
          302,
        );
      }
      throw e;
    }
    if (path.startsWith('/api/') || dl[3] || !response.ok) return response;
    return shell(req, env);
  }
  if (path.startsWith('/download/') || path.startsWith('/api/download/'))
    throw new HttpError(404, 'Download route not found.');
  const preview = path.match(/^\/previews\/([a-f0-9-]+)$/);
  if (preview) {
    const obj = await env.PREVIEWS.get(preview[1]);
    ensure(obj, 'Preview not found.', 404);
    return new Response(obj!.body, {
      headers: {
        'Content-Type': obj!.httpMetadata?.contentType ?? 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  if (path === '/listings.json') {
    const data = await catalog(env);
    return json(
      {
        schema: 'gam.index.v1',
        artist: data.config.artist,
        listings: data.works
          .filter((w) => w.kind === 'listing')
          .map((w) => ({
            listing_id: w.id,
            url: `${data.config.origin}/listing/${w.id}`,
            metadata: `${data.config.origin}/listing/${w.id}/listing.json`,
          })),
        collections: data.works
          .filter((w) => w.kind === 'collection')
          .map((w) => ({
            collection_id: w.id,
            url: `${data.config.origin}/collection/${w.id}`,
            metadata: `${data.config.origin}/collection/${w.id}/collection.json`,
          })),
      },
      200,
      publicHeaders,
    );
  }
  const work = path.match(/^\/(listing|collection)\/(\d+)(?:\/(listing|collection)\.json)?$/);
  if (work) {
    const data = await catalog(env),
      w = getWork(data, work[1], work[2]);
    if (work[3]) {
      ensure(work[3] === work[1], 'Metadata route not found.', 404);
      return json(metadata(data, w), 200, publicHeaders);
    }
    return shell(req, env, { title: w.title, description: w.description, image: w.preview });
  }
  if (path.startsWith('/api/') || path.startsWith('/listing/') || path.startsWith('/collection/'))
    throw new HttpError(404, 'Route not found.');
  return env.ASSETS.fetch(req);
}
async function shell(
  req: Request,
  env: Env,
  meta?: { title: string; description: string; image?: string },
) {
  const response = await env.ASSETS.fetch(new Request(new URL('/', req.url), req));
  if (!meta)
    return new Response(response.body, {
      status: response.status,
      headers: { ...Object.fromEntries(response.headers), 'Cache-Control': 'private, no-store' },
    });
  const c = config(env);
  const escaped = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
    );
  const title = `${meta.title} · ${c.name}`;
  let html = await response.text();
  html = html
    .replace(/<title>.*?<\/title>/, `<title>${escaped(title)}</title>`)
    .replace(
      /<meta name="description"[^>]*>/,
      `<meta name="description" content="${escaped(meta.description)}"/>`,
    );
  html = html.replace(
    '</head>',
    `<meta property="og:title" content="${escaped(title)}"/><meta property="og:description" content="${escaped(meta.description)}"/><meta property="og:url" content="${escaped(c.origin + new URL(req.url).pathname)}"/>${meta.image ? `<meta property="og:image" content="${escaped(new URL(meta.image, c.origin).href)}"/>` : ''}</head>`,
  );
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(req, env);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof InputError ? 400 : 500;
      if (status === 500)
        console.error(
          JSON.stringify({
            event: 'request_failed',
            path: new URL(req.url).pathname,
            message: e instanceof Error ? e.message : 'Unknown error',
          }),
        );
      response = json(
        {
          error:
            e instanceof HttpError || e instanceof InputError
              ? e.message
              : 'The site could not complete this request. Please retry.',
        },
        status,
      );
    }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Frame-Options', 'DENY');
    return new Response(req.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers,
    });
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (config(env).ready)
      ctx.waitUntil(
        sync(env).catch((e) =>
          console.error(JSON.stringify({ event: 'catalog_sync_failed', message: e.message })),
        ),
      );
    ctx.waitUntil(
      env.DB.batch([
        env.DB.prepare('DELETE FROM challenges WHERE expires<?').bind(
          Math.floor(Date.now() / 1000),
        ),
        env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(Math.floor(Date.now() / 1000)),
        env.DB.prepare('DELETE FROM rate_limits WHERE window<?').bind(
          Math.floor(Date.now() / 60000) - 60,
        ),
      ]),
    );
  },
} satisfies ExportedHandler<Env>;
