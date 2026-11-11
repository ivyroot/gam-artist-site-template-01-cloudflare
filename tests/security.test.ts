import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { InMemorySigner } from '@taquito/signer';
import { b58Encode, PrefixV2 } from '@taquito/utils';
import worker from '../src/worker/index';
import migration from '../migrations/0001_initial.sql?raw';
import type { Env } from '../src/worker/env';
import { utf8Hex } from '../src/shared/model';
let signer: InMemorySigner, address: string, publicKey: string, live: Env;
const origin = 'https://studio.example';
const request = (path: string, body?: unknown, cookie?: string, requestOrigin = origin) =>
  new Request(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: requestOrigin }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const call = (path: string, body?: unknown, cookie?: string) =>
  worker.fetch(request(path, body, cookie), live);
async function signIn(role = 'buyer') {
  const challenge = (await (await call('/api/auth/challenge', { address, role })).json()) as any;
  const sig = await signer.sign(challenge.payload);
  const r = await call('/api/auth/verify', {
    id: challenge.id,
    publicKey,
    signature: sig.prefixSig,
  });
  expect(r.status).toBe(200);
  return { cookie: r.headers.get('Set-Cookie')!.split(';')[0], challenge, sig };
}
beforeAll(async () => {
  signer = await InMemorySigner.fromSecretKey(
    b58Encode(new Uint8Array(32).fill(7), PrefixV2.Ed25519Seed),
  );
  address = await signer.publicKeyHash();
  publicKey = await signer.publicKey();
  live = {
    ...env,
    SESSION_SECRET: 'test-secret-at-least-32-characters-long',
    SITE_CONFIG: JSON.stringify({
      name: 'Test studio',
      artist: address,
      contract: 'KT1test',
      chainId: 'NetTest',
      rpc: 'https://rpc.example',
      indexer: 'https://api.indexer.example',
      origin,
      websiteId: '0',
      inventoryPage: '/private-stockroom',
    }),
  } as Env;
  await live.DB.exec(migration);
});
beforeEach(async () => {
  await live.DB.batch(
    ['challenges', 'sessions', 'events', 'files', 'downloads', 'drafts', 'rate_limits'].map((t) =>
      live.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network disabled in tests'));
});
describe('authentication and routing', () => {
  it('requires authentication before any direct original request', async () => {
    expect((await call('/download/0/file')).status).toBe(401);
    expect((await call('/private-stockroom/api/status')).status).toBe(401);
  });
  it('verifies a real Tezos signature, consumes nonce once and revokes logout', async () => {
    const { cookie, challenge, sig } = await signIn();
    expect(((await (await call('/api/session', undefined, cookie)).json()) as any).address).toBe(
      address,
    );
    expect(
      (await call('/api/auth/verify', { id: challenge.id, publicKey, signature: sig.prefixSig }))
        .status,
    ).toBe(401);
    expect((await call('/api/auth/logout', {}, cookie)).headers.get('Set-Cookie')).toContain(
      'Max-Age=0',
    );
    expect((await call('/api/library', undefined, cookie)).status).toBe(401);
  });
  it('rejects cross-origin sign-in and forged cookies', async () => {
    expect(
      (
        await worker.fetch(
          request(
            '/api/auth/challenge',
            { address, role: 'buyer' },
            undefined,
            'https://other.example',
          ),
          live,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          '/private-stockroom/api/status',
          undefined,
          'gam_session=' + 'a'.repeat(64) + '.' + 'b'.repeat(64),
        )
      ).status,
    ).toBe(401);
  });
  it('rejects a changed signed payload and concurrent nonce replay', async () => {
    const challenge = (await (
      await call('/api/auth/challenge', { address, role: 'buyer' })
    ).json()) as any;
    const bad = await signer.sign(challenge.payload + '00');
    expect(
      (await call('/api/auth/verify', { id: challenge.id, publicKey, signature: bad.prefixSig }))
        .status,
    ).toBe(401);
    const good = await signer.sign(challenge.payload);
    const responses = await Promise.all([
      call('/api/auth/verify', { id: challenge.id, publicKey, signature: good.prefixSig }),
      call('/api/auth/verify', { id: challenge.id, publicKey, signature: good.prefixSig }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
  });
  it('buyer sessions do not confer artist admin, even for the artist address', async () => {
    const { cookie } = await signIn();
    expect((await call('/private-stockroom/api/status', undefined, cookie)).status).toBe(403);
  });
  it('does not allow public route fallback to hide unknown API/download paths', async () => {
    expect((await call('/api/missing')).status).toBe(404);
    expect((await call('/download/not-a-number')).status).toBe(404);
  });
  it('keeps public metadata CORS separate from private routes', async () => {
    const r = await call('/listings.json');
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await call('/api/session')).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
function rpcLicense(personal = '1', commercial = '0') {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/chain_id')) return Response.json('NetTest');
    if (url.endsWith('/header')) return Response.json({ level: 100 });
    if (url.endsWith('/run_script_view'))
      return Response.json({
        data: { prim: 'Pair', args: [{ int: personal }, { int: commercial }, { int: '80' }] },
      });
    throw new Error('Unexpected RPC request ' + url);
  });
}
async function seedWork() {
  const hash = 'ab'.repeat(32);
  await live.DB.prepare('INSERT INTO events(id,level,tag,payload) VALUES(1,1,?,?)')
    .bind(
      'listed',
      JSON.stringify({
        artist: address,
        listing_id: 0,
        title: utf8Hex('Original'),
        description: '',
        item_type: utf8Hex('image'),
        personal_price: 1000000,
        commercial_price: 0,
        website_id: 0,
        active: false,
        file_hash: hash,
      }),
    )
    .run();
  await live.ART_BUCKET.put('private/original', new TextEncoder().encode('the exact original'));
  await live.DB.prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)')
    .bind('0', 'private/original', '夜.png', 'image/png', 18, hash, Date.now())
    .run();
}
describe('private delivery', () => {
  it('serves exact bytes for an existing license even when the listing is closed', async () => {
    await seedWork();
    const { cookie } = await signIn();
    rpcLicense();
    const r = await call('/download/0/file', undefined, cookie);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('the exact original');
    expect(r.headers.get('Cache-Control')).toBe('private, no-store, no-transform');
    expect(r.headers.get('Content-Disposition')).toContain("filename*=UTF-8''");
  });
  it('rejects an unlicensed wallet and keeps object keys out of metadata', async () => {
    await seedWork();
    const { cookie } = await signIn();
    rpcLicense('0');
    expect((await call('/download/0/file', undefined, cookie)).status).toBe(403);
    const r = await call('/listing/0/listing.json');
    expect(await r.text()).not.toContain('private/original');
  });
  it('fails closed when the RPC is unavailable', async () => {
    await seedWork();
    const { cookie } = await signIn();
    expect((await call('/download/0/file', undefined, cookie)).status).toBe(503);
  });
});

describe('collection authorization', () => {
  async function collection() {
    await seedWork();
    await live.DB.prepare('INSERT INTO events VALUES(2,1,?,?)')
      .bind(
        'collection_set',
        JSON.stringify({
          artist: address,
          collection_id: 0,
          title: utf8Hex('Collection'),
          description: '',
          personal_price: 1000,
          commercial_price: 0,
          website_id: 0,
          active: false,
        }),
      )
      .run();
    await live.DB.prepare('INSERT INTO events VALUES(3,1,?,?)')
      .bind(
        'collection_item_set',
        JSON.stringify({ artist: address, collection_id: 0, listing_id: 0, included: true }),
      )
      .run();
  }
  function views(isMember: boolean) {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/chain_id')) return Response.json('NetTest');
      if (url.endsWith('/header')) return Response.json({ level: 100 });
      const req = JSON.parse(String(init?.body));
      if (req.view === 'in_collection')
        return Response.json({ data: { prim: isMember ? 'True' : 'False' } });
      const isCollection = req.input.args[2].prim === 'Right';
      return Response.json({
        data: {
          prim: 'Pair',
          args: [{ int: isCollection ? '1' : '0' }, { int: '0' }, { int: '80' }],
        },
      });
    });
  }
  it('grants a collection holder access to a current member, including a closed collection', async () => {
    await collection();
    const { cookie } = await signIn();
    views(true);
    const r = await call('/download/0/file', undefined, cookie);
    expect(r.status).toBe(200);
    await r.arrayBuffer();
  });
  it('a stale local membership mirror never grants access after on-chain removal', async () => {
    await collection();
    const { cookie } = await signIn();
    views(false);
    expect((await call('/download/0/file', undefined, cookie)).status).toBe(403);
  });
});
describe('artist file publishing', () => {
  it('requires an artist session and checks origin for mutations', async () => {
    const { cookie } = await signIn('admin');
    expect(
      (
        await worker.fetch(
          request('/private-stockroom/api/preview', {}, cookie, 'https://other.example'),
          live,
        )
      ).status,
    ).toBe(403);
  });
  it('uploads multipart originals, computes SHA-256 on the server and prevents replacement', async () => {
    const { cookie } = await signIn('admin');
    const start = (await (
      await call(
        '/private-stockroom/api/upload/start',
        { id: '7', name: 'original.bin', type: 'application/octet-stream' },
        cookie,
      )
    ).json()) as any;
    const bytes = new TextEncoder().encode('original file bytes');
    const part = await worker.fetch(
      new Request(`${origin}/private-stockroom/api/upload/${start.token}/part?number=1`, {
        method: 'POST',
        headers: { Origin: origin, Cookie: cookie },
        body: bytes,
      }),
      live,
    );
    expect(part.status).toBe(200);
    const done = await call(
      `/private-stockroom/api/upload/${start.token}/complete`,
      { parts: [await part.json()] },
      cookie,
    );
    expect(done.status).toBe(200);
    const expected = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
    expect(((await done.json()) as any).hash).toBe(expected);
    expect(
      (
        await call(
          '/private-stockroom/api/upload/start',
          { id: '7', name: 'changed.bin', type: 'application/octet-stream' },
          cookie,
        )
      ).status,
    ).toBe(409);
  });
  it('rejects active preview content and invalid IDs', async () => {
    const { cookie } = await signIn('admin');
    const r = await worker.fetch(
      new Request(origin + '/private-stockroom/api/preview', {
        method: 'POST',
        headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'image/svg+xml' },
        body: '<svg/>',
      }),
      live,
    );
    expect(r.status).toBe(400);
    expect(
      (
        await call(
          '/private-stockroom/api/upload/start',
          { id: '-1', name: 'x', type: 'image/png' },
          cookie,
        )
      ).status,
    ).toBe(400);
  });
  it('redirects an unauthenticated download page to login without exposing private content', async () => {
    const r = await worker.fetch(
      new Request(origin + '/download/0', { headers: { Accept: 'text/html' } }),
      live,
    );
    expect(r.status).toBe(302);
    expect(r.headers.get('Location')).toBe(origin + '/library?next=%2Fdownload%2F0');
  });
});

describe('custom Inventory routing', () => {
  const pageEnv = () =>
    ({
      ...live,
      ASSETS: {
        fetch: async () =>
          new Response(
            '<!doctype html><html><head><title>Shop</title></head><body>Public shop</body></html>',
            { headers: { 'Content-Type': 'text/html' } },
          ),
      },
    }) as unknown as Env;
  it('serves Inventory only at the configured custom page, with no indexing or caching', async () => {
    const response = await worker.fetch(request('/private-stockroom'), pageEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(await response.text()).toContain('name="gam-inventory-page" content="true"');
  });
  it('returns 404 for conventional pages and the old fixed admin APIs', async () => {
    for (const path of ['/admin', '/admin/', '/inventory', '/api/admin/status']) {
      expect((await worker.fetch(request(path), pageEnv())).status).toBe(404);
    }
    expect((await call('/api/admin/sync', {})).status).toBe(404);
  });
  it('does not expose Inventory paths in public catalog, session, index or shop HTML', async () => {
    for (const path of ['/api/catalog', '/api/session', '/listings.json', '/']) {
      const response = await worker.fetch(request(path), pageEnv());
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).not.toContain('/private-stockroom');
      expect(text).not.toContain('inventoryPage');
      expect(text).not.toContain('gam-inventory-page');
    }
  });
  it('changing inventoryPage disables the old page and API routes', async () => {
    const moved = {
      ...pageEnv(),
      SITE_CONFIG: JSON.stringify({
        ...JSON.parse(live.SITE_CONFIG),
        inventoryPage: '/new-stockroom-42',
      }),
    };
    const oldPage = await worker.fetch(request('/private-stockroom'), moved);
    expect(await oldPage.text()).not.toContain('gam-inventory-page');
    expect((await worker.fetch(request('/private-stockroom/api/status'), moved)).status).toBe(404);
    const newPage = await worker.fetch(request('/new-stockroom-42'), moved);
    expect(await newPage.text()).toContain('gam-inventory-page');
    expect((await worker.fetch(request('/new-stockroom-42/api/status'), moved)).status).toBe(401);
  });
  it('requires artist authorization even when someone knows the Inventory path', async () => {
    const { cookie } = await signIn();
    expect((await call('/private-stockroom/api/status', undefined, cookie)).status).toBe(403);
    const admin = await signIn('admin');
    expect((await call('/private-stockroom/api/status', undefined, admin.cookie)).status).toBe(200);
  });
});
