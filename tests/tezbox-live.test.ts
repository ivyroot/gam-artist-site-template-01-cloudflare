import { beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { TezosToolkit, OpKind } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { b58Encode, PrefixV2 } from '@taquito/utils';
import { Schema } from '@taquito/michelson-encoder';
import worker from '../src/worker/index';
import {
  purchase,
  review,
  setItem,
  setName,
  setWebsite,
  setWork,
  type Transaction,
} from '../src/chain/parameters';
import { chainHead, licenses, member } from '../src/chain/rpc';
import { type Env } from '../src/worker/env';
import type { Work } from '../src/shared/model';
import migration from '../migrations/0001_initial.sql?raw';
interface Settings {
  enabled: boolean;
  bootstrapKey: string;
  rpc: string;
  contract: string;
}
const settings = inject('tezbox' as never) as Settings;
const origin = 'https://tezbox-studio.example';
let live: Env,
  artist: InMemorySigner,
  buyer: InMemorySigner,
  artistAddress: string,
  buyerAddress: string,
  asArtist: TezosToolkit,
  asBuyer: TezosToolkit,
  artistCookie: string,
  buyerCookie: string,
  work: Work;
let count = 0;
const toolkit = (signer: InMemorySigner) => {
  const t = new TezosToolkit(settings.rpc);
  t.setProvider({ signer });
  return t;
};
const call = (path: string, body?: unknown, cookie?: string) =>
  worker.fetch(
    new Request(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    live,
  );
async function login(signer: InMemorySigner, role = 'buyer') {
  const address = await signer.publicKeyHash(),
    publicKey = await signer.publicKey();
  const challenge = (await (await call('/api/auth/challenge', { address, role })).json()) as any;
  const signature = (await signer.sign(challenge.payload)).prefixSig;
  const response = await call('/api/auth/verify', { id: challenge.id, publicKey, signature });
  expect(response.status).toBe(200);
  return response.headers.get('Set-Cookie')!.split(';')[0];
}
async function transact(t: TezosToolkit, txs: Transaction[]) {
  const op = await t.contract
    .batch(
      txs.map((tx) => ({
        kind: OpKind.TRANSACTION,
        to: settings.contract,
        amount: Number(tx.amount),
        mutez: true,
        parameter: { entrypoint: tx.entrypoint, value: tx.value as any },
      })),
    )
    .send();
  await op.confirmation(1);
  // Feed actual node receipts to the local mirror; no local TzKT indexer is assumed.
  const included = await t.rpc.getBlock({ block: String(op.includedInBlock) });
  const contents =
    included.operations.flat().find((group) => group.hash === op.hash)?.contents ?? [];
  const records = contents
    .flatMap((r) => (r.metadata as any)?.internal_operation_results ?? [])
    .filter((r: any) => r.kind === 'event');
  for (const r of records) {
    const payload = new Schema(r.type).Execute(r.payload);
    const simplify = (v: any): any =>
      v && typeof v === 'object' && v.constructor?.name === 'BigNumber'
        ? v.toFixed()
        : Array.isArray(v)
          ? v.map(simplify)
          : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, simplify(x)]))
            : v;
    await live.DB.prepare('INSERT INTO events(id,level,tag,payload) VALUES(?,?,?,?)')
      .bind(++count, (await t.rpc.getBlockHeader()).level, r.tag, JSON.stringify(simplify(payload)))
      .run();
  }
  return op;
}
async function readLicense(kind: 'listing' | 'collection', id: string) {
  const head = await chainHead(JSON.parse(live.SITE_CONFIG));
  return licenses(JSON.parse(live.SITE_CONFIG), buyerAddress, kind, id, String(head.level));
}
describe.skipIf(!settings.enabled)('live TezBox GAM + actual Worker routes', () => {
  beforeAll(async () => {
    // The Node service binding relays actual RPC requests; no responses are stubbed.
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      (env as any).TEZBOX_RPC.fetch(input, init),
    );
    const rpcUrl = new URL(settings.rpc);
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(rpcUrl.hostname);
    artist = await InMemorySigner.fromSecretKey(
      b58Encode(crypto.getRandomValues(new Uint8Array(32)), PrefixV2.Ed25519Seed),
    );
    buyer = await InMemorySigner.fromSecretKey(
      b58Encode(crypto.getRandomValues(new Uint8Array(32)), PrefixV2.Ed25519Seed),
    );
    artistAddress = await artist.publicKeyHash();
    buyerAddress = await buyer.publicKeyHash();
    asArtist = toolkit(artist);
    asBuyer = toolkit(buyer);
    const bootstrap = toolkit(await InMemorySigner.fromSecretKey(settings.bootstrapKey));
    const chainId = await bootstrap.rpc.getChainId();
    const deployed = await bootstrap.rpc.getScript(settings.contract);
    expect(JSON.stringify(deployed.code)).toContain('set_collection_item');
    const funding = await bootstrap.contract
      .batch([
        { kind: OpKind.TRANSACTION, to: artistAddress, amount: 2 },
        { kind: OpKind.TRANSACTION, to: buyerAddress, amount: 2 },
      ])
      .send();
    await funding.confirmation(1);
    live = {
      ...env,
      SITE_CONFIG: JSON.stringify({
        name: 'Live TezBox studio',
        artist: artistAddress,
        contract: settings.contract,
        chainId,
        rpc: settings.rpc,
        indexer: 'https://unused-indexer.example',
        origin,
        websiteId: '0',
        inventoryPage: '/sandbox-stockroom',
      }),
      SESSION_SECRET: 'sandbox-test-only-session-key-over-32-characters',
    } as Env;
    await live.DB.exec(migration);
    await live.DB.batch(
      ['events', 'drafts', 'files', 'uploads', 'sessions', 'challenges', 'downloads'].map((t) =>
        live.DB.prepare(`DELETE FROM ${t}`),
      ),
    );
    artistCookie = await login(artist, 'admin');
    buyerCookie = await login(buyer);
    console.log(
      `Live GAM ${settings.contract} on ${chainId}; fresh artist ${artistAddress}, buyer ${buyerAddress}`,
    );
  });
  it('registers the site and display name with the template transaction builders', async () => {
    await transact(asArtist, [setName('TezBox Artist ✓'), setWebsite('0', origin)]);
    expect(((await (await call('/api/catalog')).json()) as any).works).toHaveLength(0);
  });
  it('uploads/verifies an original through the Worker, publishes it, and ingests real emitted events', async () => {
    const start = (await (
      await call(
        '/sandbox-stockroom/api/upload/start',
        { id: '0', name: 'tezbox-original.txt', type: 'application/octet-stream' },
        artistCookie,
      )
    ).json()) as any;
    const part = await worker.fetch(
      new Request(`${origin}/sandbox-stockroom/api/upload/${start.token}/part?number=1`, {
        method: 'POST',
        headers: { Origin: origin, Cookie: artistCookie },
        body: 'TezBox original — exact bytes ✓',
      }),
      live,
    );
    expect(part.status).toBe(200);
    const complete = await call(
      `/sandbox-stockroom/api/upload/${start.token}/complete`,
      { parts: [await part.json()] },
      artistCookie,
    );
    expect(complete.status).toBe(200);
    const file = (await complete.json()) as any;
    work = {
      id: '0',
      kind: 'listing',
      title: 'Live TezBox work ✓',
      description: 'An integration test original.',
      item_type: 'text',
      personal_price: '1000',
      commercial_price: '5000',
      website_id: '0',
      active: true,
      file_hash: file.hash,
    };
    await transact(asArtist, [setWork(work)]);
    const catalog = (await (await call('/api/catalog')).json()) as any;
    expect(catalog.works[0]).toMatchObject({ title: work.title, file_hash: file.hash, id: '0' });
    expect((await call('/download/0/file', undefined, buyerCookie)).status).toBe(403);
  });
  it('purchases personal licenses twice at full price, pays artist, and streams matching original bytes', async () => {
    const before = await asArtist.tz.getBalance(artistAddress);
    await transact(asBuyer, [purchase(artistAddress, 'listing', '0', 'personal', '2', '1000')]);
    await transact(asBuyer, [purchase(artistAddress, 'listing', '0', 'personal', '1', '1000')]);
    expect((await asArtist.tz.getBalance(artistAddress)).minus(before).toFixed()).toBe('3000');
    expect((await readLicense('listing', '0')).personal).toBe('3');
    const response = await call('/download/0/file', undefined, buyerCookie);
    expect(response.status).toBe(200);
    const bytes = await response.arrayBuffer();
    expect(new TextDecoder().decode(bytes)).toBe('TezBox original — exact bytes ✓');
    expect(Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')).toBe(
      work.file_hash,
    );
  });
  it('keeps commercial independent, supports review, and preserves access after sale closes', async () => {
    await transact(asBuyer, [purchase(artistAddress, 'listing', '0', 'commercial', '1', '5000')]);
    const l = await readLicense('listing', '0');
    expect([l.personal, l.commercial]).toEqual(['3', '1']);
    const level = (await asBuyer.rpc.getBlockHeader()).level;
    while ((await asBuyer.rpc.getBlockHeader()).level <= level)
      await new Promise((r) => setTimeout(r, 500));
    await transact(asBuyer, [review(artistAddress, 'listing', '0', 9, 'Real local chain ✓')]);
    await transact(asArtist, [setWork({ ...work, active: false })]);
    const response = await call('/download/0/file', undefined, buyerCookie);
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    const data = (await (await call('/api/catalog')).json()) as any;
    expect(data.reviews[0].comment).toBe('Real local chain ✓');
  });
  it('handles a collection-only license, current membership, and on-chain removal', async () => {
    const listing: Work = { ...work, id: '1', title: 'Collection only', active: false };
    const coll: Work = {
      id: '0',
      kind: 'collection',
      title: 'Live collection',
      description: 'Local test',
      personal_price: '2000',
      commercial_price: '0',
      website_id: '0',
      active: false,
    };
    await transact(asArtist, [
      setWork(listing),
      setWork(coll),
      setItem('0', '1', true),
      setWork({ ...coll, active: true }),
    ]);
    // Reuse exact original bytes under a second listing for this isolated fixture.
    const file = await live.DB.prepare('SELECT * FROM files WHERE listing_id=?')
      .bind('0')
      .first<any>();
    await live.ART_BUCKET.put(
      'collection-fixture',
      new TextEncoder().encode('TezBox original — exact bytes ✓'),
    );
    await live.DB.prepare('INSERT INTO files VALUES(?,?,?,?,?,?,?)')
      .bind(
        '1',
        'collection-fixture',
        file.name,
        file.content_type,
        file.size,
        file.hash,
        Date.now(),
      )
      .run();
    await transact(asBuyer, [purchase(artistAddress, 'collection', '0', 'personal', '1', '2000')]);
    expect((await call('/download/1/file', undefined, buyerCookie)).status).toBe(200);
    await transact(asArtist, [setItem('0', '1', false), setWork({ ...coll, active: false })]);
    expect(
      await member(
        JSON.parse(live.SITE_CONFIG),
        '0',
        '1',
        String((await asArtist.rpc.getBlockHeader()).level),
      ),
    ).toBe(false);
    expect((await call('/download/1/file', undefined, buyerCookie)).status).toBe(403);
  });
});
