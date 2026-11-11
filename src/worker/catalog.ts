import { fromHex, type Work, type Review, type Catalog } from '../shared/model';
import { config, ensure, type Env } from './env';
import { chainHead, remote } from '../chain/rpc';
interface Event {
  id: number;
  level: number;
  tag: string;
  payload: Record<string, any>;
}
const text = (v: unknown) => (typeof v === 'string' ? fromHex(v) : '');
const option = (v: any) => (v && typeof v === 'object' && 'Some' in v ? v.Some : v);
export function project(
  events: Event[],
  websiteId: string,
): { works: Work[]; reviews: Review[]; websites: Record<string, string> } {
  const works = new Map<string, Work>(),
    reviews = new Map<string, Review>(),
    websites: Record<string, string> = {};
  for (const ev of events) {
    const p = ev.payload;
    if (ev.tag === 'website_set') websites[String(p.website_id)] = p.url;
    if (ev.tag === 'listed' || ev.tag === 'collection_set') {
      const kind = ev.tag === 'listed' ? 'listing' : 'collection';
      const id = String(kind === 'listing' ? p.listing_id : p.collection_id);
      const old = works.get(`${kind}:${id}`);
      works.set(`${kind}:${id}`, {
        id,
        kind,
        title: text(p.title),
        description: text(p.description),
        item_type: kind === 'listing' ? text(p.item_type) : undefined,
        personal_price: String(p.personal_price),
        commercial_price: String(p.commercial_price),
        active: p.active,
        website_id: String(p.website_id),
        file_hash: p.file_hash,
        members: old?.members ?? [],
      });
    }
    if (ev.tag === 'collection_item_set') {
      const w = works.get(`collection:${p.collection_id}`);
      if (w) {
        const set = new Set(w.members ?? []);
        if (p.included) set.add(String(p.listing_id));
        else set.delete(String(p.listing_id));
        w.members = [...set];
      }
    }
    if (ev.tag === 'reviewed') {
      const kind = 'listing' in p.target ? 'listing' : 'collection';
      const id = String(p.target[kind]);
      const r = option(p.rating),
        comment = option(p.comment);
      reviews.set(`${p.buyer}:${kind}:${id}`, {
        buyer: p.buyer,
        kind,
        id,
        rating: r == null ? null : Number(r),
        comment: comment == null ? null : text(comment),
        posted_at: p.posted_at,
        updated_at: p.updated_at,
      });
    }
  }
  return {
    works: [...works.values()].filter((w) => w.website_id === websiteId),
    reviews: [...reviews.values()].sort((a, b) => b.posted_at.localeCompare(a.posted_at)),
    websites,
  };
}
export async function catalog(env: Env): Promise<Catalog> {
  const c = config(env);
  // The artist's chosen Inventory URL must not be advertised in public JSON.
  const { inventoryPage: _inventoryPage, ...publicConfig } = c;
  const rows = await env.DB.prepare('SELECT * FROM events ORDER BY id').all<{
    id: number;
    level: number;
    tag: string;
    payload: string;
  }>();
  const projection = project(
    rows.results.map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
    c.websiteId,
  );
  const metadata = await env.DB.prepare('SELECT * FROM drafts').all<{
    kind: string;
    id: string;
    data: string;
  }>();
  const drafts = new Map(metadata.results.map((r) => [`${r.kind}:${r.id}`, JSON.parse(r.data)]));
  const works = projection.works.map((w) => {
    const d = drafts.get(`${w.kind}:${w.id}`) ?? {};
    return {
      ...w,
      preview: d.preview,
      long_description: d.long_description,
      order: d.order,
      replaces: d.replaces,
      replaced_by: d.replaced_by,
      terms: d.terms,
      tags: d.tags,
      file_summary: d.file_summary,
      members:
        w.kind === 'collection'
          ? [...(w.members ?? [])].sort(
              (a, b) => (d.members ?? []).indexOf(a) - (d.members ?? []).indexOf(b),
            )
          : undefined,
    };
  });
  const s = await env.DB.prepare('SELECT cursor,level,updated FROM sync WHERE id=1').first<
    Catalog['sync']
  >();
  return {
    config: publicConfig,
    works: works.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)),
    reviews: projection.reviews,
    sync: s ?? { cursor: 0, level: 0, updated: null },
  };
}
export async function sync(env: Env) {
  const owner = crypto.randomUUID();
  const lock = await env.DB.prepare(
    "INSERT INTO locks(id,owner,expires) VALUES('sync',?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE locks.expires<? RETURNING owner",
  )
    .bind(owner, Date.now() + 180000, Date.now())
    .first();
  ensure(lock, 'A catalog sync is already running. Retry shortly.', 409);
  try {
    return await syncUnlocked(env);
  } finally {
    await env.DB.prepare("DELETE FROM locks WHERE id='sync' AND owner=?").bind(owner).run();
  }
}
async function syncUnlocked(env: Env) {
  const c = config(env);
  ensure(c.ready, 'Configure a network and contract before synchronizing.', 503);
  const rpc = await chainHead(c);
  const indexer = await remote<{ level: number; chainId: string }>(`${c.indexer}/v1/head`);
  ensure(indexer.chainId === c.chainId, 'The indexer network does not match this site.', 503);
  const safe = Math.max(0, Math.min(rpc.level, indexer.level) - 2);
  const checkpoint = await env.DB.prepare('SELECT * FROM sync WHERE id=1').first<{
    cursor: number;
    level: number;
    block_hash: string | null;
  }>();
  if (checkpoint?.block_hash) {
    const hash = await remote<string>(`${c.rpc}/chains/main/blocks/${checkpoint.level}/hash`);
    if (hash !== checkpoint.block_hash) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM events'),
        env.DB.prepare('UPDATE sync SET cursor=0,level=0,block_hash=NULL WHERE id=1'),
      ]);
    }
  }
  let cursor =
    (await env.DB.prepare('SELECT cursor FROM sync WHERE id=1').first<{ cursor: number }>())
      ?.cursor ?? 0;
  const safeHash = await remote<string>(`${c.rpc}/chains/main/blocks/${safe}/hash`);
  let complete = false;
  for (let page = 0; page < 5; page++) {
    const url = new URL(`${c.indexer}/v1/contracts/events`);
    url.search = new URLSearchParams({
      contract: c.contract,
      'payload.artist': c.artist,
      'id.gt': String(cursor),
      'level.le': String(safe),
      'sort.asc': 'id',
      limit: '200',
    }).toString();
    const events = await remote<Event[]>(url.toString());
    const statements = [];
    for (const ev of events) {
      ensure(
        ev.id > cursor && ev.level <= safe && ev.payload.artist === c.artist,
        'Unexpected indexer event.',
        503,
      );
      statements.push(
        env.DB.prepare('INSERT OR IGNORE INTO events(id,level,tag,payload) VALUES(?,?,?,?)').bind(
          ev.id,
          ev.level,
          ev.tag,
          JSON.stringify(ev.payload),
        ),
      );
      cursor = ev.id;
    }
    statements.push(
      env.DB.prepare('UPDATE sync SET cursor=?,level=?,block_hash=?,updated=? WHERE id=1').bind(
        cursor,
        safe,
        safeHash,
        new Date().toISOString(),
      ),
    );
    await env.DB.batch(statements);
    if (events.length < 200) {
      complete = true;
      break;
    }
  }
  const finalHash = await remote<string>(`${c.rpc}/chains/main/blocks/${safe}/hash`);
  if (finalHash !== safeHash) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM events'),
      env.DB.prepare('UPDATE sync SET cursor=0,level=0,block_hash=NULL WHERE id=1'),
    ]);
    throw new Error('The chain reorganized during catalog sync; retry to rebuild.');
  }
  return { cursor, level: safe, complete };
}
export const getWork = (data: Catalog, kind: string, id: string) => {
  const w = data.works.find((w) => w.kind === kind && w.id === id);
  ensure(w, 'This work has not been published on this site.', 404);
  return w!;
};
export function metadata(data: Catalog, w: Work) {
  return {
    schema: `art-sale/${w.kind}@1`,
    artist: data.config.artist,
    [`${w.kind}_id`]: w.id,
    previews: w.preview
      ? [{ url: new URL(w.preview, data.config.origin).href, kind: 'image', alt: w.title }]
      : [],
    long_description: w.long_description ?? '',
    tags: w.tags ?? [],
    // The public description is not an R2 key, download URL or entitlement.
    ...(w.kind === 'listing'
      ? { file_summary: w.file_summary ?? '', replaces: w.replaces, replaced_by: w.replaced_by }
      : { order: w.members ?? [] }),
    license_terms: `${data.config.origin}/${w.kind}/${w.id}#license-terms`,
    updated_at: data.sync.updated,
  };
}
