import { chainHead, licenses, member } from '../chain/rpc';
import { nat, type Catalog, type Kind } from '../shared/model';
import { session } from './auth';
import { catalog, getWork } from './catalog';
import { config, ensure, json, type Env } from './env';
const has = (l: { personal: string; commercial: string }) =>
  BigInt(l.personal) > 0n || BigInt(l.commercial) > 0n;
export async function entitled(data: Catalog, buyer: string, id: string, block: string) {
  if (has(await licenses(data.config, buyer, 'listing', id, block))) return true;
  for (const c of data.works.filter((w) => w.kind === 'collection' && w.members?.includes(id))) {
    if (
      has(await licenses(data.config, buyer, 'collection', c.id, block)) &&
      (await member(data.config, c.id, id, block))
    )
      return true;
  }
  return false;
}
export async function library(req: Request, env: Env) {
  const s = await session(req, env),
    data = await catalog(env),
    head = await chainHead(data.config);
  const entries = [];
  // Bound RPC fan-out and paginate the library, including entitlement checks.
  const start = Number(new URL(req.url).searchParams.get('offset') ?? 0);
  ensure(Number.isSafeInteger(start) && start >= 0, 'Invalid library offset.');
  const page = data.works.slice(start, start + 20);
  for (const w of page) {
    const l = await licenses(data.config, s.address, w.kind, w.id, String(head.level));
    const access =
      has(l) ||
      (w.kind === 'listing' && (await entitled(data, s.address, w.id, String(head.level))));
    if (access) entries.push({ ...w, license: l });
  }
  const markers = await env.DB.prepare('SELECT listing_id FROM downloads WHERE buyer=?')
    .bind(s.address)
    .all<{ listing_id: string }>();
  return json({
    entries,
    downloaded: markers.results.map((m) => m.listing_id),
    next: start + 20 < data.works.length ? start + 20 : null,
  });
}
export async function download(req: Request, env: Env, kind: Kind, id: string, file = false) {
  nat(id);
  const s = await session(req, env),
    data = await catalog(env),
    w = getWork(data, kind, id),
    head = await chainHead(data.config),
    block = String(head.level);
  if (kind === 'collection') {
    ensure(
      has(await licenses(data.config, s.address, 'collection', id, block)),
      'This wallet has no collection license.',
      403,
    );
    const works = [];
    for (const lid of w.members ?? [])
      if (await member(data.config, id, lid, block)) {
        const work = data.works.find((x) => x.kind === 'listing' && x.id === lid);
        if (work) works.push(work);
      }
    const markers = await env.DB.prepare('SELECT listing_id FROM downloads WHERE buyer=?')
      .bind(s.address)
      .all<{ listing_id: string }>();
    return json({ work: w, members: works, downloaded: markers.results.map((x) => x.listing_id) });
  }
  ensure(
    await entitled(data, s.address, id, block),
    'This wallet has no current license for this work.',
    403,
  );
  const stored = await env.DB.prepare('SELECT * FROM files WHERE listing_id=?').bind(id).first<{
    object_key: string;
    name: string;
    content_type: string;
    size: number;
    hash: string;
  }>();
  ensure(stored, 'The original file is unavailable. Contact the artist.', 404);
  ensure(
    stored!.hash === w.file_hash,
    'Stored original does not match the published hash. Contact the artist.',
    503,
  );
  if (!file)
    return json({ work: w, file: { name: stored!.name, size: stored!.size, hash: stored!.hash } });
  // Range is deliberately unsupported in v1; every retry is a fresh authorized stream.
  const object = await env.ART_BUCKET.get(stored!.object_key);
  ensure(object, 'The original file is missing. Contact the artist.', 404);
  ensure(object!.size === stored!.size, 'Stored file size does not match the catalog.', 503);
  if (req.method === 'GET')
    await env.DB.prepare(
      'INSERT INTO downloads(buyer,listing_id,started) VALUES(?,?,?) ON CONFLICT(buyer,listing_id) DO UPDATE SET started=excluded.started',
    )
      .bind(s.address, id, Date.now())
      .run();
  const filename = stored!.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\\r\n]/g, '_');
  return new Response(req.method === 'HEAD' ? null : object!.body, {
    headers: {
      'Content-Type': stored!.content_type,
      'Content-Length': String(object!.size),
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(stored!.name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16))}`,
      'Cache-Control': 'private, no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'none',
    },
  });
}
