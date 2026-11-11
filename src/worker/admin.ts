import { createHash } from 'node:crypto';
import { validateAddress, ValidationResult } from '@taquito/utils';
import { nat, type Work } from '../shared/model';
import { setItem, setName, setWebsite, setWork } from '../chain/parameters';
import { session } from './auth';
import { catalog, sync } from './catalog';
import { syncStatus } from './sync';
import { body, config, ensure, HttpError, json, rateLimit, sameOrigin, type Env } from './env';
const safeType = (type: string) =>
  /^(image\/(png|jpeg|webp|gif|avif)|video\/(mp4|webm)|audio\/[\w.+-]+|application\/(zip|pdf|octet-stream))$/.test(
    type,
  )
    ? type
    : 'application/octet-stream';
function text(value: unknown, max: number) {
  ensure(
    typeof value === 'string' && new TextEncoder().encode(value).length <= max,
    `Text must fit ${max} UTF-8 bytes.`,
  );
  return value as string;
}
export function validateWork(v: Work): Work {
  ensure(v.kind === 'listing' || v.kind === 'collection', 'Invalid record type.');
  nat(v.id);
  nat(v.website_id);
  nat(v.personal_price);
  nat(v.commercial_price);
  ensure(typeof v.active === 'boolean', 'Choose whether the sale is open.');
  text(v.title, 300);
  ensure(v.title.trim(), 'Add a title.');
  text(v.description, 300);
  text(v.long_description ?? '', 10000);
  text(v.item_type ?? '', 100);
  if (v.preview)
    ensure(/^\/previews\/[a-f0-9-]+$/.test(v.preview), 'Upload a preview through Inventory.');
  if (v.replaces) nat(v.replaces);
  if (v.replaced_by) nat(v.replaced_by);
  if (v.members) {
    ensure(Array.isArray(v.members) && v.members.length <= 50, 'Use at most 50 works per edit.');
    v.members.forEach(nat);
  }
  if (v.terms) text(v.terms, 10000);
  if (v.file_summary) text(v.file_summary, 1000);
  if (v.tags) {
    ensure(Array.isArray(v.tags) && v.tags.length <= 30, 'Use at most 30 tags.');
    v.tags.forEach((t) => text(t, 100));
  }
  // Explicit allowlist: metadata must not carry arbitrary state or private object references.
  return {
    id: v.id,
    kind: v.kind,
    title: v.title.trim(),
    description: v.description,
    item_type: v.item_type,
    personal_price: v.personal_price,
    commercial_price: v.commercial_price,
    website_id: v.website_id,
    active: v.active,
    file_hash: v.file_hash,
    preview: v.preview,
    long_description: v.long_description,
    members: v.members,
    replaces: v.replaces,
    replaced_by: v.replaced_by,
    order: Number.isFinite(v.order) ? v.order : 0,
    terms: v.terms,
    file_summary: v.file_summary,
    tags: v.tags,
  };
}
export async function admin(req: Request, env: Env, path: string) {
  const s = await session(req, env, true);
  if (req.method !== 'GET') sameOrigin(req, env);
  await rateLimit(env, `admin:${s.address}`, 120);
  const c = config(env);
  ensure(
    validateAddress(c.artist) === ValidationResult.VALID,
    'Configure a valid artist address.',
    503,
  );
  if (path === '/api/admin/status') {
    const files = await env.DB.prepare('SELECT listing_id,name,size,hash FROM files').all();
    const drafts = await env.DB.prepare('SELECT kind,id,data FROM drafts').all();
    const operations = await env.DB.prepare(
      'SELECT hash,created FROM operations ORDER BY created DESC LIMIT 20',
    ).all();
    return json({
      files: files.results,
      drafts: drafts.results,
      operations: operations.results,
      config: c,
      sync: await syncStatus(env),
    });
  }
  if (path === '/api/admin/sync') {
    ensure(req.method === 'POST', 'Use POST.', 405);
    return json(await sync(env));
  }
  if (path === '/api/admin/prepare/setup') {
    const v = await body<{ websiteId: string; name: string }>(req);
    nat(v.websiteId);
    text(v.name ?? '', 200);
    ensure(v.websiteId === c.websiteId, 'Use the website ID configured for this deployment.');
    // Reconcile first so an artist sees existing registrations before approving an update.
    const caughtUp = await sync(env);
    ensure(
      caughtUp.complete,
      'Catalog is catching up. Run Sync chain again before preparing this transaction.',
      409,
    );
    const rows = await env.DB.prepare(
      "SELECT payload FROM events WHERE tag='website_set' ORDER BY id DESC",
    ).all<{ payload: string }>();
    const prior = rows.results
      .map((r) => JSON.parse(r.payload))
      .find((p) => String(p.website_id) === v.websiteId);
    ensure(
      !prior || prior.url === c.origin,
      'That website ID already points elsewhere. Use its existing deployment or explicitly configure a new unused ID.',
      409,
    );
    return json({
      transactions: [...(v.name ? [setName(v.name)] : []), setWebsite(v.websiteId, c.origin)],
    });
  }
  if (path === '/api/admin/prepare/work') {
    const caughtUp = await sync(env);
    ensure(
      caughtUp.complete,
      'Catalog is catching up. Run Sync chain again before preparing this transaction.',
      409,
    );
    const w = validateWork(await body<Work>(req));
    ensure(w.website_id === c.websiteId, 'Work must belong to this deployment.');
    const data = await catalog(env);
    const existing = data.works.find((x) => x.id === w.id && x.kind === w.kind);
    if (w.kind === 'listing') {
      const f = await env.DB.prepare('SELECT hash FROM files WHERE listing_id=?')
        .bind(w.id)
        .first<{ hash: string }>();
      ensure(f, 'Upload and verify an original before publishing.');
      w.file_hash = f!.hash;
      ensure(
        !existing || existing.file_hash === w.file_hash,
        'A published original is immutable. Use a new listing ID.',
      );
    }
    const transactions = [];
    if (w.kind === 'collection') {
      const selected = new Set(w.members ?? []);
      for (const id of selected)
        ensure(
          data.works.some(
            (x) => x.kind === 'listing' && x.id === id && x.website_id === c.websiteId,
          ),
          'Every member must be a published work on this site.',
        );
      ensure(!w.active || selected.size > 0, 'A collection must contain a work before opening.');
      if (!existing) transactions.push(setWork({ ...w, active: false }));
      for (const id of existing?.members ?? [])
        if (!selected.has(id)) transactions.push(setItem(w.id, id, false));
      for (const id of selected)
        if (!existing?.members?.includes(id)) transactions.push(setItem(w.id, id, true));
    }
    transactions.push(setWork(w));
    await env.DB.prepare(
      'INSERT INTO drafts(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
    )
      .bind(w.kind, w.id, JSON.stringify(w))
      .run();
    return json({ transactions, work: w });
  }
  if (path === '/api/admin/operation') {
    const { hash } = await body<{ hash: string }>(req);
    ensure(/^o[1-9A-HJ-NP-Za-km-z]{50}$/.test(hash), 'Invalid operation hash.');
    await env.DB.prepare('INSERT OR IGNORE INTO operations(hash,created) VALUES(?,?)')
      .bind(hash, Date.now())
      .run();
    return json({ ok: true });
  }
  if (path === '/api/admin/preview') {
    ensure(req.method === 'POST', 'Use POST.', 405);
    const type = req.headers.get('Content-Type') ?? '';
    ensure(/^image\/(png|jpeg|webp|avif)$/.test(type), 'Preview must be PNG, JPEG, WebP, or AVIF.');
    const blob = await boundedBytes(req, 5 * 1024 * 1024);
    const id = crypto.randomUUID();
    await env.PREVIEWS.put(id, blob, { httpMetadata: { contentType: type } });
    return json({ url: `/previews/${id}` });
  }
  if (path === '/api/admin/upload/start') {
    const v = await body<{ id: string; name: string; type: string }>(req);
    nat(v.id);
    text(v.name, 255);
    ensure(v.name && !/[\r\n\0]/.test(v.name), 'Invalid filename.');
    const published = (await catalog(env)).works.some((w) => w.kind === 'listing' && w.id === v.id);
    const stored = await env.DB.prepare('SELECT listing_id FROM files WHERE listing_id=?')
      .bind(v.id)
      .first();
    ensure(!published && !stored, 'This listing already has an original. Choose a new ID.', 409);
    const token = crypto.randomUUID(),
      objectKey = `originals/${v.id}/${token}`,
      type = safeType(v.type);
    const upload = await env.ART_BUCKET.createMultipartUpload(objectKey, {
      httpMetadata: { contentType: type },
    });
    await env.DB.prepare(
      'INSERT INTO uploads(token,listing_id,object_key,upload_id,name,content_type,created) VALUES(?,?,?,?,?,?,?)',
    )
      .bind(token, v.id, objectKey, upload.uploadId, v.name, type, Date.now())
      .run();
    return json({ token, partSize: 8 * 1024 * 1024 });
  }
  const match = path.match(/^\/api\/admin\/upload\/([a-f0-9-]+)\/(part|complete|abort)$/);
  if (match) {
    const row = await env.DB.prepare('SELECT * FROM uploads WHERE token=? AND created>?')
      .bind(match[1], Date.now() - 86400000)
      .first<{
        listing_id: string;
        object_key: string;
        upload_id: string;
        name: string;
        content_type: string;
      }>();
    ensure(row, 'Upload expired or not found.', 404);
    const upload = env.ART_BUCKET.resumeMultipartUpload(row!.object_key, row!.upload_id);
    if (match[2] === 'abort') {
      await upload.abort();
      await env.DB.prepare('DELETE FROM uploads WHERE token=?').bind(match[1]).run();
      return json({ ok: true });
    }
    if (match[2] === 'part') {
      const n = Number(new URL(req.url).searchParams.get('number'));
      ensure(Number.isInteger(n) && n >= 1 && n <= 128, 'Invalid part number.');
      const bytes = await boundedBytes(req, 8 * 1024 * 1024);
      return json(await upload.uploadPart(n, bytes));
    }
    const { parts } = await body<{ parts: R2UploadedPart[] }>(req);
    ensure(
      Array.isArray(parts) && parts.length > 0 && parts.length <= 128,
      'Invalid upload parts.',
    );
    // A retry after completion may find the object already committed in R2.
    let obj = await env.ART_BUCKET.get(row!.object_key);
    if (!obj) {
      await upload.complete(parts);
      obj = await env.ART_BUCKET.get(row!.object_key);
    }
    ensure(obj, 'Upload could not be verified.', 503);
    const hash = createHash('sha256');
    const reader = obj!.body.getReader();
    let size = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      hash.update(r.value);
    }
    const digest = hash.digest('hex');
    // Insert-only: simultaneous uploads cannot replace an established original.
    const result = await env.DB.prepare(
      'INSERT OR IGNORE INTO files(listing_id,object_key,name,content_type,size,hash,created) VALUES(?,?,?,?,?,?,?)',
    )
      .bind(
        row!.listing_id,
        row!.object_key,
        row!.name,
        row!.content_type,
        size,
        digest,
        Date.now(),
      )
      .run();
    ensure(
      result.meta.changes === 1,
      'Another original already exists for this listing. Use a new ID.',
      409,
    );
    await env.DB.prepare('DELETE FROM uploads WHERE token=?').bind(match[1]).run();
    return json({ id: row!.listing_id, hash: digest, size, name: row!.name });
  }
  throw new HttpError(404, 'Admin route not found.');
}
async function boundedBytes(req: Request, max: number) {
  ensure(req.body, 'Missing upload body.');
  const reader = req.body!.getReader(),
    parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    n += r.value.length;
    if (n > max) {
      await reader.cancel();
      throw new HttpError(413, `Upload part exceeds ${max} bytes.`);
    }
    parts.push(r.value);
  }
  ensure(n > 0, 'Cannot upload an empty part.');
  return Buffer.concat(parts);
}
