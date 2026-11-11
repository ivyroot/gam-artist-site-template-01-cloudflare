export type Kind = 'listing' | 'collection';
export type Tier = 'personal' | 'commercial';
export interface Work {
  id: string;
  kind: Kind;
  title: string;
  description: string;
  item_type?: string;
  personal_price: string;
  commercial_price: string;
  active: boolean;
  website_id: string;
  file_hash?: string;
  preview?: string;
  long_description?: string;
  members?: string[];
  replaces?: string;
  replaced_by?: string;
  order?: number;
  terms?: string;
  file_summary?: string;
  tags?: string[];
}
export interface SiteConfig {
  name: string;
  tagline: string;
  bio: string;
  artist: string;
  contract: string;
  chainId: string;
  rpc: string;
  indexer: string;
  explorer?: string;
  workerName?: string;
  origin: string;
  websiteId: string;
  inventoryPage?: string;
  ready: boolean;
  demo: boolean;
}
export interface Catalog {
  config: SiteConfig;
  works: Work[];
  reviews: Review[];
  sync: { cursor: number; level: number; updated: string | null };
}
export interface Review {
  buyer: string;
  kind: Kind;
  id: string;
  rating: number | null;
  comment: string | null;
  posted_at: string;
  updated_at: string;
}
export class InputError extends Error {}
export const nat = (value: unknown): string => {
  const s = String(value ?? '');
  if (!/^(0|[1-9]\d{0,29})$/.test(s)) throw new InputError('Expected a nonnegative integer.');
  return s;
};
export const mutez = (tez: string): string => {
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,6})?$/.test(tez))
    throw new Error('Enter a tez amount with at most six decimal places.');
  const [a, b = ''] = tez.split('.');
  return (BigInt(a) * 1000000n + BigInt(b.padEnd(6, '0'))).toString();
};
export const tez = (value: string): string => {
  const n = BigInt(value);
  return `${n / 1000000n}${n % 1000000n ? '.' + (n % 1000000n).toString().padStart(6, '0').replace(/0+$/, '') : ''}`;
};
export const utf8Hex = (value: string) =>
  Array.from(new TextEncoder().encode(value), (b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (value: string) =>
  new TextDecoder('utf-8', { fatal: true }).decode(
    Uint8Array.from(value.match(/.{2}/g) ?? [], (b) => parseInt(b, 16)),
  );
export const short = (value: string) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'Not configured';
