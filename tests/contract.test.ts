import { describe, it, expect } from 'vitest';
import { mutez, tez, utf8Hex, fromHex } from '../src/shared/model';
import { purchase, setWork, review, setItem } from '../src/chain/parameters';
import { project } from '../src/worker/catalog';
const work = {
  id: '9007199254740993',
  kind: 'listing' as const,
  title: '夜 ✓',
  description: 'Original',
  item_type: 'image',
  personal_price: '1000000',
  commercial_price: '5000000',
  website_id: '0',
  active: true,
  file_hash: 'ab'.repeat(32),
};
describe('GAM ABI and numeric safety', () => {
  it('converts tez without floating point', () => {
    expect(mutez('0.000001')).toBe('1');
    expect(mutez('10.123456')).toBe('10123456');
    expect(tez('10123456')).toBe('10.123456');
    expect(() => mutez('0.0000001')).toThrow();
  });
  it('encodes listing order from gam.mligo and preserves large nats', () => {
    const tx = setWork(work);
    expect(tx.entrypoint).toBe('list');
    expect(tx.value).toEqual({
      prim: 'Pair',
      args: [
        { int: work.id },
        { bytes: utf8Hex(work.title) },
        { bytes: utf8Hex('image') },
        { bytes: utf8Hex('Original') },
        { int: '1000000' },
        { int: '5000000' },
        { int: '0' },
        { prim: 'True' },
        { bytes: work.file_hash },
      ],
    });
    expect(fromHex(utf8Hex(work.title))).toBe(work.title);
  });
  it('keeps target and tier constructors independent, charges full quantity', () => {
    const p = purchase('tz1artist', 'collection', '9', 'commercial', '3', '5000000');
    expect(p.amount).toBe('15000000');
    expect(p.value).toMatchObject({
      args: [
        { string: 'tz1artist' },
        { prim: 'Right', args: [{ int: '9' }] },
        { prim: 'Right', args: [{ prim: 'Unit' }] },
        { int: '3' },
      ],
    });
    expect(() => purchase('a', 'listing', '0', 'personal', '0', '1')).toThrow();
    expect(() => purchase('a', 'listing', '0', 'personal', '10000000000', '10000000000')).toThrow();
  });
  it('validates review ranges and UTF-8 byte limits', () => {
    expect(() => review('a', 'listing', '0', 11, '')).toThrow();
    expect(() => review('a', 'listing', '0', null, '')).toThrow();
    expect(() => review('a', 'listing', '0', null, '夜'.repeat(101))).toThrow();
    expect(review('a', 'listing', '0', 9, '✓').entrypoint).toBe('review');
    expect(setItem('1', '2', false).value).toMatchObject({
      args: [{ int: '1' }, { int: '2' }, { prim: 'False' }],
    });
  });
});
describe('event reconstruction', () => {
  const common = {
    artist: 'tz1artist',
    artist_name: '',
    title: utf8Hex('Night'),
    description: utf8Hex('A work'),
    item_type: utf8Hex('image'),
    personal_price: 1000000,
    commercial_price: 5000000,
    website_id: 0,
    active: true,
    file_hash: 'ab'.repeat(32),
  };
  const e = (id: number, tag: string, payload: any) => ({ id, level: id, tag, payload });
  it('applies complete snapshots and current membership, retaining review chronology', () => {
    const result = project(
      [
        e(1, 'listed', { ...common, listing_id: 0 }),
        e(2, 'collection_set', { ...common, collection_id: 0 }),
        e(3, 'collection_item_set', { collection_id: 0, listing_id: 0, included: true }),
        e(4, 'listed', { ...common, listing_id: 0, active: false }),
        e(5, 'reviewed', {
          buyer: 'b',
          target: { collection: '0' },
          rating: 9,
          comment: null,
          posted_at: '2026-01-01',
          updated_at: '2026-01-01',
        }),
        e(6, 'reviewed', {
          buyer: 'b',
          target: { collection: '0' },
          rating: 8,
          comment: utf8Hex('Updated'),
          posted_at: '2026-01-01',
          updated_at: '2026-02-01',
        }),
        e(7, 'collection_item_set', { collection_id: 0, listing_id: 0, included: false }),
      ],
      '0',
    );
    expect(result.works.find((w) => w.kind === 'listing')?.active).toBe(false);
    expect(result.works.find((w) => w.kind === 'collection')?.members).toEqual([]);
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({
      rating: 8,
      posted_at: '2026-01-01',
      comment: 'Updated',
    });
  });
  it('does not mix another deployment website into this catalog', () => {
    expect(
      project([e(1, 'listed', { ...common, listing_id: 0, website_id: 1 })], '0').works,
    ).toEqual([]);
  });
});

import parameterSchema from '../src/chain/parameter-schema.json';
import { assertDataValid, type MichelsonType, type MichelsonData } from '@taquito/michel-codec';
import { setName, setWebsite } from '../src/chain/parameters';
describe('compiled contract ABI snapshot', () => {
  const entries = new Map<string, MichelsonType>();
  function walk(t: any) {
    const a = t.annots?.find((a: string) => a.startsWith('%'));
    if (a) entries.set(a.slice(1), t);
    if (t.prim === 'or') t.args.forEach(walk);
  }
  walk(parameterSchema);
  it('typechecks every supported entrypoint against the compiled GAM parameter type', () => {
    const artist = 'tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb';
    const transactions = [
      setName('夜'),
      setWebsite('0', 'https://studio.example'),
      setWork(work),
      setWork({ ...work, kind: 'collection' }),
      setItem('0', '1', true),
      purchase(artist, 'listing', '0', 'personal', '2', '1000000'),
      review(artist, 'collection', '0', 9, 'Great'),
    ];
    for (const tx of transactions)
      expect(() =>
        assertDataValid(
          tx.value as MichelsonData,
          JSON.parse(
            JSON.stringify(entries.get(tx.entrypoint), (key, value) =>
              key === 'annots' ? undefined : value,
            ),
          ),
        ),
      ).not.toThrow();
  });
});

import { vi } from 'vitest';
import { remote } from '../src/chain/rpc';
it('preserves large chain integers without rounding', async () => {
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{"level":100,"price":900719925474099312345}'));
  try {
    expect(await remote('https://rpc.example')).toEqual({
      level: 100,
      price: '900719925474099312345',
    });
  } finally {
    spy.mockRestore();
  }
});
