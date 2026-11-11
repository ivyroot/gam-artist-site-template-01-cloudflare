import { chainHead, remote } from '../chain/rpc';
import { rpcEvents, type ChainEvent } from '../chain/events';
import { config, ensure, type Env } from './env';
import type { SiteConfig } from '../shared/model';

// Each block needs three RPC reads and two D1 calls; leave room under Worker subrequest limits.
const BLOCKS_PER_RUN = 6;
const PAGES_PER_RUN = 5;
interface Checkpoint {
  cursor: number;
  level: number;
  block_hash: string | null;
}
export function catalogIdentity(c: SiteConfig) {
  return JSON.stringify([
    c.chainId,
    c.contract,
    c.artist,
    c.catalogSource ?? 'tzkt',
    c.catalogStartLevel ?? 0,
    c.catalogSource === 'rpc' ? '' : c.indexer,
  ]);
}
export async function syncStatus(env: Env) {
  const c = config(env);
  const checkpoint = await env.DB.prepare(
    'SELECT cursor,level,updated FROM sync WHERE id=1',
  ).first<{ cursor: number; level: number; updated: string | null }>();
  const state = await env.DB.prepare('SELECT * FROM catalog_state WHERE id=1').first<{
    identity: string;
    source: 'rpc' | 'tzkt';
    target_level: number;
    complete: number;
    error: string | null;
  }>();
  const matches = state?.identity === catalogIdentity(c);
  return {
    ...((state && !matches ? null : checkpoint) ?? {
      cursor: 0,
      level: Math.max(0, (c.catalogStartLevel ?? 0) - 1),
      updated: null,
    }),
    source: c.catalogSource,
    targetLevel: matches ? state.target_level : 0,
    complete: matches ? Boolean(state.complete) : false,
    error: matches ? state.error : null,
  };
}
async function reset(env: Env, start: number) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM event_origins'),
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('UPDATE sync SET cursor=0,level=?,block_hash=NULL,updated=NULL WHERE id=1').bind(
      Math.max(0, start - 1),
    ),
    env.DB.prepare('UPDATE catalog_state SET complete=0,error=NULL WHERE id=1'),
  ]);
}
async function checkpoint(env: Env) {
  return (await env.DB.prepare(
    'SELECT cursor,level,block_hash FROM sync WHERE id=1',
  ).first<Checkpoint>())!;
}
export async function sync(env: Env) {
  const c = config(env);
  ensure(
    c.ready,
    'Configure the artist, network, contract and catalog source before synchronizing.',
    503,
  );
  const owner = crypto.randomUUID();
  const lock = await env.DB.prepare(
    "INSERT INTO locks(id,owner,expires) VALUES('sync',?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE locks.expires<? RETURNING owner",
  )
    .bind(owner, Date.now() + 180000, Date.now())
    .first();
  ensure(lock, 'A catalog sync is already running. Retry shortly.', 409);
  try {
    return await syncUnlocked(env, c, owner);
  } catch (error) {
    await env.DB.prepare('UPDATE catalog_state SET complete=0,error=? WHERE id=1')
      .bind(error instanceof Error ? error.message : 'Catalog sync failed.')
      .run();
    throw error;
  } finally {
    await env.DB.prepare("DELETE FROM locks WHERE id='sync' AND owner=?").bind(owner).run();
  }
}
async function syncUnlocked(env: Env, c: SiteConfig, owner: string) {
  const deadline = Date.now() + 30000;
  const rpc = await chainHead(c);
  const source = c.catalogSource!;
  const start = c.catalogStartLevel!;
  const identity = catalogIdentity(c);
  const state = await env.DB.prepare('SELECT identity FROM catalog_state WHERE id=1').first<{
    identity: string;
  }>();
  if (state?.identity !== identity) {
    // Adopt pre-migration TzKT cursors; RPC and subsequent identity changes rebuild only derived history.
    if (state || source === 'rpc' || start !== 0) await reset(env, start);
    await env.DB.prepare(
      'INSERT INTO catalog_state(id,identity,source) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET identity=excluded.identity,source=excluded.source,complete=0,error=NULL',
    )
      .bind(identity, source)
      .run();
  }
  let cp = await checkpoint(env);
  if (cp.block_hash) {
    if (
      cp.level > rpc.level ||
      (await remote<string>(`${c.rpc}/chains/main/blocks/${cp.level}/hash`)) !== cp.block_hash
    ) {
      await reset(env, start);
      cp = await checkpoint(env);
    }
  }
  let target = Math.max(0, rpc.level - 2);
  if (source === 'tzkt') {
    const head = await remote<{ level: number; chainId: string }>(`${c.indexer}/v1/head`);
    ensure(head.chainId === c.chainId, 'The indexer network does not match this site.', 503);
    target = Math.max(0, Math.min(rpc.level, head.level) - 2);
    ensure(
      !cp.block_hash || target >= cp.level,
      'The indexer is behind the saved catalog checkpoint. Retry when it catches up.',
      503,
    );
  }
  // Never claim a future start block has been scanned.
  ensure(
    start <= target + 1,
    'catalogStartLevel is ahead of the confirmed chain. Wait for more blocks or correct the setting.',
    503,
  );
  await env.DB.prepare('UPDATE catalog_state SET target_level=?,complete=0,error=NULL WHERE id=1')
    .bind(target)
    .run();
  let complete = false;
  const renew = async () => {
    const lease = await env.DB.prepare(
      "UPDATE locks SET expires=? WHERE id='sync' AND owner=? AND expires>=? RETURNING owner",
    )
      .bind(Date.now() + 180000, owner, Date.now())
      .first();
    ensure(lease, 'Catalog sync lock expired; retry.', 409);
  };
  const save = async (events: ChainEvent[], next: Checkpoint) => {
    await renew();
    const writes: D1PreparedStatement[] = [];
    for (const ev of events) {
      writes.push(
        env.DB.prepare('INSERT OR IGNORE INTO events(id,level,tag,payload) VALUES(?,?,?,?)').bind(
          ev.id,
          ev.level,
          ev.tag,
          JSON.stringify(ev.payload),
        ),
      );
      if (ev.sourceKey)
        writes.push(
          env.DB.prepare('INSERT INTO event_origins(source_key,event_id) VALUES(?,?)').bind(
            ev.sourceKey,
            ev.id,
          ),
        );
    }
    writes.push(
      env.DB.prepare('UPDATE sync SET cursor=?,level=?,block_hash=?,updated=? WHERE id=1').bind(
        next.cursor,
        next.level,
        next.block_hash,
        new Date().toISOString(),
      ),
    );
    await env.DB.batch(writes);
    cp = next;
  };
  if (source === 'rpc') {
    let nextLevel = cp.block_hash ? cp.level + 1 : Math.max(1, start);
    for (
      let n = 0;
      nextLevel <= target && n < BLOCKS_PER_RUN && Date.now() < deadline;
      n++, nextLevel++
    ) {
      const hash = await remote<string>(`${c.rpc}/chains/main/blocks/${nextLevel}/hash`);
      const block = await remote<any>(`${c.rpc}/chains/main/blocks/${hash}?metadata=always`);
      ensure(
        block.hash === hash && block.header?.level === nextLevel,
        'Unexpected RPC block.',
        503,
      );
      if (cp.block_hash && block.header.predecessor !== cp.block_hash) {
        await reset(env, start);
        throw new Error('The chain reorganized during catalog sync; retry to rebuild.');
      }
      const events = rpcEvents(block, c, cp.cursor);
      if ((await remote<string>(`${c.rpc}/chains/main/blocks/${nextLevel}/hash`)) !== hash) {
        await reset(env, start);
        throw new Error('The chain reorganized during catalog sync; retry to rebuild.');
      }
      await save(events, {
        cursor: events.at(-1)?.id ?? cp.cursor,
        level: nextLevel,
        block_hash: hash,
      });
    }
    complete = nextLevel > target;
  } else {
    const hash = await remote<string>(`${c.rpc}/chains/main/blocks/${target}/hash`);
    for (let page = 0; page < PAGES_PER_RUN && Date.now() < deadline; page++) {
      const url = new URL(`${c.indexer}/v1/contracts/events`);
      url.search = new URLSearchParams({
        contract: c.contract,
        'payload.artist': c.artist,
        'id.gt': String(cp.cursor),
        'level.ge': String(start),
        'level.le': String(target),
        'sort.asc': 'id',
        limit: '200',
      }).toString();
      const events = await remote<ChainEvent[]>(url.toString());
      ensure(Array.isArray(events) && events.length <= 200, 'Unexpected indexer events.', 503);
      let cursor = cp.cursor;
      for (const ev of events) {
        ensure(
          Number.isSafeInteger(ev.id) &&
            ev.id > cursor &&
            Number.isSafeInteger(ev.level) &&
            ev.level >= start &&
            ev.level <= target &&
            ev.payload.artist === c.artist,
          'Unexpected indexer event.',
          503,
        );
        cursor = ev.id;
      }
      complete = events.length < 200;
      // Anchor every page to this target hash, even when its event cursor is incomplete.
      await save(events, { cursor, level: target, block_hash: hash });
      if (complete) break;
    }
    if ((await remote<string>(`${c.rpc}/chains/main/blocks/${target}/hash`)) !== hash) {
      await reset(env, start);
      throw new Error('The chain reorganized during catalog sync; retry to rebuild.');
    }
  }
  if (
    cp.block_hash &&
    (await remote<string>(`${c.rpc}/chains/main/blocks/${cp.level}/hash`)) !== cp.block_hash
  ) {
    await reset(env, start);
    throw new Error('The chain reorganized during catalog sync; retry to rebuild.');
  }
  await env.DB.prepare('UPDATE catalog_state SET complete=?,error=NULL WHERE id=1')
    .bind(complete ? 1 : 0)
    .run();
  return { cursor: cp.cursor, level: cp.level, targetLevel: target, source, complete };
}
