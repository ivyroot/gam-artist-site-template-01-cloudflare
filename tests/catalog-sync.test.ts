import { beforeEach, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { InMemorySigner } from '@taquito/signer';
import { b58Encode, PrefixV2 } from '@taquito/utils';
import { Schema } from '@taquito/michelson-encoder';
import { config, type Env } from '../src/worker/env';
import { sync, syncStatus } from '../src/worker/sync';
import { catalog, project } from '../src/worker/catalog';
import { rpcEvents } from '../src/chain/events';
import worker from '../src/worker/index';
import { utf8Hex } from '../src/shared/model';
import initial from '../migrations/0001_initial.sql?raw';
import migration from '../migrations/0002_catalog_sources.sql?raw';
const artist = 'tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
let live: Env, head: number, blocks: Map<number, any>, calls: string[];
const settings = {
  name: 'Test',
  artist,
  contract: 'KT1gam',
  chainId: 'NetTest',
  rpc: 'https://rpc.example',
  indexer: '',
  catalogSource: 'rpc',
  catalogStartLevel: 1,
  origin: 'https://studio.example',
  websiteId: '0',
};
const field = (prim: string, name: string) => ({ prim, annots: [`%${name}`] });
function event(
  tag = 'website_set',
  payload: any = { artist, website_id: '0', url: settings.origin },
) {
  const fields =
    tag === 'website_set'
      ? [field('address', 'artist'), field('nat', 'website_id'), field('string', 'url')]
      : [
          field('address', 'artist'),
          field('nat', 'listing_id'),
          field('bytes', 'title'),
          field('bytes', 'description'),
          field('bytes', 'item_type'),
          field('mutez', 'personal_price'),
          field('mutez', 'commercial_price'),
          field('nat', 'website_id'),
          field('bool', 'active'),
          field('bytes', 'file_hash'),
        ];
  const type = { prim: 'pair', args: fields };
  return {
    kind: 'event',
    source: settings.contract,
    tag,
    type,
    payload: new Schema(type).Encode(payload),
    result: { status: 'applied' },
  };
}
function block(level: number, events: any[] = []) {
  return {
    hash: `B${level}`,
    header: { level, predecessor: `B${level - 1}` },
    operations: [
      [],
      [],
      [],
      [
        {
          hash: `op${level}`,
          contents: [
            {
              kind: 'transaction',
              metadata: {
                operation_result: { status: 'applied' },
                internal_operation_results: events,
              },
            },
          ],
        },
      ],
    ],
  };
}
function setConfig(extra: any) {
  live.SITE_CONFIG = JSON.stringify({ ...JSON.parse(live.SITE_CONFIG), ...extra });
}
function rpc(input: RequestInfo | URL) {
  const url = String(input);
  calls.push(url);
  if (url.endsWith('/chain_id')) return Response.json('NetTest');
  if (url.endsWith('/head/header')) return Response.json({ level: head, hash: `B${head}` });
  const match = url.match(/\/blocks\/(B?\d+)(\/hash)?(?:\?.*)?$/);
  if (match) {
    const level = Number(match[1].replace('B', ''));
    const value =
      (match[1].startsWith('B')
        ? [...blocks.values()].find((b) => b.hash === match[1])
        : undefined) ??
      blocks.get(level) ??
      block(level);
    return Response.json(match[2] ? value.hash : value);
  }
  throw new Error(`Unexpected fetch ${url}`);
}
beforeEach(async () => {
  live = { ...env, SITE_CONFIG: JSON.stringify(settings) } as Env;
  await live.DB.exec(initial);
  await live.DB.exec(migration);
  await live.DB.batch(
    ['event_origins', 'events', 'catalog_state', 'locks', 'drafts', 'files'].map((t) =>
      live.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
  await live.DB.prepare(
    'UPDATE sync SET cursor=0,level=0,block_hash=NULL,updated=NULL WHERE id=1',
  ).run();
  head = 8;
  blocks = new Map([[1, block(1, [event()])]]);
  calls = [];
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => rpc(input));
});
it('RPC readiness requires no TzKT and legacy configurations still require it', () => {
  expect(config(live).ready).toBe(true);
  setConfig({ catalogSource: 'tzkt' });
  expect(config(live).ready).toBe(false);
  setConfig({ catalogSource: undefined });
  expect(config(live).ready).toBe(false);
  setConfig({ indexer: 'https://indexer.example' });
  expect(config(live).ready).toBe(true);
});
it('scans empty blocks, resumes without duplicates and uses the same normalized projection as TzKT', async () => {
  const payload = {
    artist,
    listing_id: '9007199254740993',
    title: utf8Hex('Original ✓'),
    description: '',
    item_type: utf8Hex('image'),
    personal_price: '9007199254740995',
    commercial_price: '0',
    website_id: '0',
    active: true,
    file_hash: 'ab'.repeat(32),
  };
  blocks.set(2, block(2, [event('listed', payload)]));
  const result = await sync(live);
  expect(result).toMatchObject({
    level: 6,
    targetLevel: 6,
    complete: true,
    source: 'rpc',
    cursor: 2,
  });
  expect(calls.some((c) => c.includes('metadata=always'))).toBe(true);
  const fromRpc = await catalog(live);
  expect(fromRpc.works).toEqual(
    project([{ id: 2, level: 2, tag: 'listed', payload }], '0').works.map((w) => ({
      ...w,
      members: undefined,
      preview: undefined,
      long_description: undefined,
      order: undefined,
      replaces: undefined,
      replaced_by: undefined,
      terms: undefined,
      tags: undefined,
      file_summary: undefined,
    })),
  );
  await sync(live);
  expect((await live.DB.prepare('SELECT COUNT(*) AS n FROM events').first<any>()).n).toBe(2);
  // Rebuild the same catalog using the existing TzKT endpoint contract.
  setConfig({ catalogSource: 'tzkt', indexer: 'https://indexer.example' });
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/v1/head')) return Response.json({ level: head, chainId: 'NetTest' });
    if (url.includes('/v1/contracts/events'))
      return Response.json([{ id: 200, level: 2, tag: 'listed', payload }]);
    return rpc(input);
  });
  expect(await sync(live)).toMatchObject({ source: 'tzkt', complete: true, cursor: 200 });
  expect((await catalog(live)).works).toEqual(fromRpc.works);
});
it('bounds RPC scans and resumes at the next block', async () => {
  head = 20;
  const r = await sync(live);
  expect(r).toMatchObject({ level: 6, targetLevel: 18, complete: false });
  calls = [];
  await sync(live);
  expect(calls.some((url) => url.includes('/blocks/7/hash'))).toBe(true);
  expect(calls.some((url) => url.includes('/blocks/1/hash'))).toBe(false);
  expect(await sync(live)).toMatchObject({ level: 18, complete: true });
});
it('does not consume failed/backtracked operations, other contracts or other artists', () => {
  const b = block(1, [
    event(),
    { ...event(), source: 'KT1other' },
    { ...event(), result: { status: 'backtracked' } },
    event('website_set', {
      artist: 'tz1aSkwEot3L2kmUvcoxzjMomb9mvBNuzFK6',
      website_id: '0',
      url: 'https://other.example',
    }),
  ]);
  b.operations[3].push({
    hash: 'failed',
    contents: [
      {
        kind: 'transaction',
        metadata: {
          operation_result: { status: 'backtracked' },
          internal_operation_results: [event()],
        },
      },
    ],
  });
  expect(rpcEvents(b, config(live), 0)).toHaveLength(1);
});
it('missing receipts or interrupted reads leave an atomic checkpoint and retry safely', async () => {
  const bad = block(3);
  bad.operations[3][0].contents[0].metadata = 'too large';
  blocks.set(3, bad);
  await expect(sync(live)).rejects.toThrow(/receipts are unavailable/);
  expect(await syncStatus(live)).toMatchObject({
    level: 2,
    complete: false,
    error: expect.stringContaining('receipts'),
  });
  blocks.set(3, block(3));
  await sync(live);
  expect((await live.DB.prepare('SELECT COUNT(*) AS n FROM events').first<any>()).n).toBe(1);
  expect(await syncStatus(live)).toMatchObject({ level: 6, complete: true, error: null });
});
it('reorgs rebuild derived events while preserving drafts and originals', async () => {
  await sync(live);
  await live.DB.prepare("INSERT INTO drafts VALUES('listing','0','{}')").run();
  await live.ART_BUCKET.put('preserved', 'original');
  blocks.set(6, { ...block(6), hash: 'B6006' });
  blocks.set(
    1,
    block(1, [
      event('website_set', { artist, website_id: '0', url: 'https://replacement.example' }),
    ]),
  );
  await sync(live);
  const rows = await live.DB.prepare('SELECT payload FROM events').all<any>();
  expect(JSON.parse(rows.results[0].payload).url).toBe('https://replacement.example');
  expect(await live.DB.prepare('SELECT * FROM drafts').first()).toBeTruthy();
  expect(await (await live.ART_BUCKET.get('preserved'))?.text()).toBe('original');
});
it('chain reset to a lower head rebuilds and a wrong chain is rejected', async () => {
  await sync(live);
  head = 5;
  await sync(live);
  expect(await syncStatus(live)).toMatchObject({ level: 3, complete: true });
  setConfig({ chainId: 'NetWrong' });
  await expect(sync(live)).rejects.toThrow(/RPC network/);
});
it('changing source identity hides stale history then rebuilds, retaining off-chain metadata', async () => {
  blocks.set(
    2,
    block(2, [
      event('listed', {
        artist,
        listing_id: '0',
        title: utf8Hex('Old artist'),
        description: '',
        item_type: '',
        personal_price: '1',
        commercial_price: '0',
        website_id: '0',
        active: true,
        file_hash: 'ab'.repeat(32),
      }),
    ]),
  );
  await sync(live);
  expect((await catalog(live)).works).toHaveLength(1);
  setConfig({ artist: 'tz1aSkwEot3L2kmUvcoxzjMomb9mvBNuzFK6' });
  expect((await catalog(live)).works).toEqual([]);
  await sync(live);
  expect((await live.DB.prepare('SELECT COUNT(*) AS n FROM events').first<any>()).n).toBe(0);
});
it('retains existing TzKT cursors on migration and validates the indexer chain', async () => {
  setConfig({ catalogSource: 'tzkt', catalogStartLevel: 0, indexer: 'https://indexer.example' });
  await live.DB.prepare("INSERT INTO events VALUES(123,1,'website_set',?)")
    .bind(JSON.stringify({ artist, website_id: '0', url: settings.origin }))
    .run();
  await live.DB.prepare("UPDATE sync SET cursor=123,level=1,block_hash='B1' WHERE id=1").run();
  let wrong = false;
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/v1/head'))
      return Response.json({ level: head, chainId: wrong ? 'Wrong' : 'NetTest' });
    if (url.includes('/v1/contracts/events')) {
      expect(new URL(url).searchParams.get('id.gt')).toBe('123');
      return Response.json([]);
    }
    return rpc(input);
  });
  await sync(live);
  expect((await live.DB.prepare('SELECT COUNT(*) AS n FROM events').first<any>()).n).toBe(1);
  wrong = true;
  await expect(sync(live)).rejects.toThrow(/indexer network/);
});
it('a full TzKT page remains incomplete and its next request uses the saved cursor', async () => {
  setConfig({ catalogSource: 'tzkt', indexer: 'https://indexer.example' });
  let pages = 0;
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/v1/head')) return Response.json({ level: head, chainId: 'NetTest' });
    if (url.includes('/v1/contracts/events')) {
      const cursor = Number(new URL(url).searchParams.get('id.gt'));
      pages++;
      return Response.json(
        pages <= 5
          ? Array.from({ length: 200 }, (_, i) => ({
              id: cursor + i + 1,
              level: 1,
              tag: 'website_set',
              payload: { artist, website_id: '0', url: settings.origin },
            }))
          : [],
      );
    }
    return rpc(input);
  });
  expect(await sync(live)).toMatchObject({ cursor: 1000, complete: false });
  expect(await sync(live)).toMatchObject({ cursor: 1000, complete: true });
});
it('a mid-scan reorganization invalidates derived history instead of advancing the checkpoint', async () => {
  let changed = false;
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes('/blocks/B1?')) changed = true;
    if (url.endsWith('/blocks/1/hash') && changed) return Response.json('replacement');
    return rpc(input);
  });
  await expect(sync(live)).rejects.toThrow(/reorganized/);
  expect((await live.DB.prepare('SELECT COUNT(*) AS n FROM events').first<any>()).n).toBe(0);
});
it('concurrent sync attempts respect the existing lease', async () => {
  await live.DB.prepare("INSERT INTO locks VALUES('sync','other',?)")
    .bind(Date.now() + 60000)
    .run();
  await expect(sync(live)).rejects.toThrow(/already running/);
});

it('authenticated setup and publication cannot prepare against incomplete history', async () => {
  const signer = await InMemorySigner.fromSecretKey(
    b58Encode(new Uint8Array(32).fill(9), PrefixV2.Ed25519Seed),
  );
  const address = await signer.publicKeyHash();
  setConfig({ artist: address, inventoryPage: '/test-stockroom' });
  live.SESSION_SECRET = 'catalog-test-session-secret-at-least-32-characters';
  const call = (path: string, body: any, cookie = '') =>
    worker.fetch(
      new Request(settings.origin + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: settings.origin, Cookie: cookie },
        body: JSON.stringify(body),
      }),
      live,
    );
  const challenge = (await (
    await call('/api/auth/challenge', { address, role: 'admin' })
  ).json()) as any;
  const verified = await call('/api/auth/verify', {
    id: challenge.id,
    publicKey: await signer.publicKey(),
    signature: (await signer.sign(challenge.payload)).prefixSig,
  });
  expect(verified.status).toBe(200);
  const cookie = verified.headers.get('Set-Cookie')!.split(';')[0];
  head = 200;
  for (const action of ['setup', 'work']) {
    const response = await call(
      `/test-stockroom/api/prepare/${action}`,
      { websiteId: '0', name: 'Artist' },
      cookie,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('catching up') });
  }
});
