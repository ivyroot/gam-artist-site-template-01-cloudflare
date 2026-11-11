import type { SiteConfig } from '../shared/model';
export interface Env {
  DB: D1Database;
  ART_BUCKET: R2Bucket;
  PREVIEWS: R2Bucket;
  ASSETS: Fetcher;
  SITE_CONFIG: string;
  SESSION_SECRET?: string;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function ensure(test: unknown, message: string, status = 400): asserts test {
  if (!test) throw new HttpError(status, message);
}
export function config(env: Env): SiteConfig {
  const c = JSON.parse(env.SITE_CONFIG);
  // cloudflare.config.ts validates this before constructing SITE_CONFIG.
  // Do not import its validator here: the dev plugin blocks config dependencies.
  const page = typeof c.inventoryPage === 'string' && c.inventoryPage ? c.inventoryPage : undefined;
  const catalogSource = c.catalogSource ?? 'tzkt';
  const catalogStartLevel = c.catalogStartLevel ?? 0;
  const validSource = catalogSource === 'rpc' || catalogSource === 'tzkt';
  const validStart = Number.isSafeInteger(catalogStartLevel) && catalogStartLevel >= 0;
  const ready = Boolean(
    c.artist &&
    c.contract &&
    c.chainId &&
    c.rpc &&
    c.origin &&
    validSource &&
    validStart &&
    (catalogSource === 'rpc' || c.indexer),
  );
  return { ...c, catalogSource, catalogStartLevel, inventoryPage: page, ready, demo: !ready };
}
export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
export async function body<T>(req: Request, max = 32768): Promise<T> {
  const reader = req.body?.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  if (reader)
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > max) {
        await reader.cancel();
        throw new HttpError(413, 'Request is too large.');
      }
      parts.push(r.value);
    }
  try {
    const value = JSON.parse(new TextDecoder().decode(Buffer.concat(parts)));
    ensure(value && typeof value === 'object' && !Array.isArray(value), 'Expected a JSON object.');
    return value;
  } catch {
    throw new HttpError(400, 'Expected valid JSON.');
  }
}
export async function rateLimit(env: Env, key: string, limit = 30) {
  const window = Math.floor(Date.now() / 60000);
  const r = await env.DB.prepare(
    'INSERT INTO rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END, window=excluded.window RETURNING count',
  )
    .bind(key, window)
    .first<{ count: number }>();
  ensure(r && r.count <= limit, 'Too many requests. Please try again shortly.', 429);
}
export function sameOrigin(req: Request, env: Env) {
  ensure(
    req.headers.get('Origin') === (config(env).requestOrigin || config(env).origin),
    'This request must come from the configured website.',
    403,
  );
}
export const publicHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=30',
};
