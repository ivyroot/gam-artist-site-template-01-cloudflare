import { nat, utf8Hex, type Kind, type Tier, type Work } from '../shared/model';
export type Micheline =
  { prim: string; args?: Micheline[] } | { int: string } | { string: string } | { bytes: string };
const int = (v: unknown): Micheline => ({ int: nat(v) });
const str = (v: string): Micheline => ({ string: v });
const bytes = (v: string): Micheline => ({ bytes: utf8Hex(v) });
const bool = (v: boolean): Micheline => ({ prim: v ? 'True' : 'False' });
const pair = (...args: Micheline[]): Micheline => ({ prim: 'Pair', args });
export const target = (kind: Kind, id: string): Micheline => ({
  prim: kind === 'listing' ? 'Left' : 'Right',
  args: [int(id)],
});
export const tier = (t: Tier): Micheline => ({
  prim: t === 'personal' ? 'Left' : 'Right',
  args: [{ prim: 'Unit' }],
});
export interface Transaction {
  entrypoint: string;
  value: Micheline;
  amount: string;
}
const tx = (entrypoint: string, value: Micheline, amount = '0'): Transaction => ({
  entrypoint,
  value,
  amount,
});
export const setName = (name: string) => tx('set_name', bytes(name));
export const setWebsite = (id: string, url: string) => tx('set_website', pair(int(id), str(url)));
export const setItem = (cid: string, lid: string, included: boolean) =>
  tx('set_collection_item', pair(int(cid), int(lid), bool(included)));
export function setWork(w: Work): Transaction {
  const prices = [
    int(w.personal_price),
    int(w.commercial_price),
    int(w.website_id),
    bool(w.active),
  ];
  if (w.kind === 'listing') {
    if (!/^[a-f0-9]{64}$/.test(w.file_hash ?? ''))
      throw new Error('A verified SHA-256 original is required.');
    return tx(
      'list',
      pair(
        int(w.id),
        bytes(w.title),
        bytes(w.item_type ?? 'artwork'),
        bytes(w.description),
        ...prices,
        { bytes: w.file_hash! },
      ),
    );
  }
  return tx('set_collection', pair(int(w.id), bytes(w.title), bytes(w.description), ...prices));
}
export const purchase = (
  artist: string,
  kind: Kind,
  id: string,
  t: Tier,
  quantity: string,
  unitPrice: string,
) => {
  if (BigInt(nat(quantity)) < 1n || BigInt(nat(unitPrice)) < 1n)
    throw new Error('Choose an available tier and positive quantity.');
  const amount = (BigInt(unitPrice) * BigInt(quantity)).toString();
  // Taquito represents the transfer amount as a JS number. Refuse imprecise conversion.
  if (BigInt(amount) > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error('This purchase exceeds the supported transaction amount.');
  return tx('purchase', pair(str(artist), target(kind, id), tier(t), int(quantity)), amount);
};
export const review = (
  artist: string,
  kind: Kind,
  id: string,
  rating: number | null,
  comment: string,
) => {
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 10))
    throw new Error('Rating must be 1–10.');
  if (!comment && rating === null) throw new Error('Add a rating or comment.');
  if (new TextEncoder().encode(comment).length > 300)
    throw new Error('Review comments must fit 300 UTF-8 bytes.');
  return tx(
    'review',
    pair(
      str(artist),
      target(kind, id),
      {
        prim: rating === null ? 'None' : 'Some',
        ...(rating === null ? {} : { args: [int(rating)] }),
      },
      { prim: comment ? 'Some' : 'None', ...(comment ? { args: [bytes(comment)] } : {}) },
    ),
  );
};
