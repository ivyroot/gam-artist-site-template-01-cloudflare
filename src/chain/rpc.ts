import type { Kind, SiteConfig } from '../shared/model';
import { target, type Micheline } from './parameters';
import { HttpError } from '../worker/env';
export async function remote<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new HttpError(503, 'The chain service is unavailable. Please retry.');
  }
  if (!response.ok)
    throw new HttpError(503, `The chain service returned ${response.status}. Please retry.`);
  // Preserve integer lexemes for nats/mutez above JavaScript's safe range.
  return JSON.parse(await response.text(), (_key, value, context?: { source?: string }) => {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      if (!context?.source)
        throw new HttpError(503, 'The chain returned an integer that cannot be decoded safely.');
      return context.source;
    }
    return value;
  }) as T;
}
export async function chainHead(c: SiteConfig) {
  const chain = await remote<string>(`${c.rpc}/chains/main/chain_id`);
  if (chain !== c.chainId)
    throw new HttpError(503, 'The RPC network does not match this site configuration.');
  return remote<{ level: number; hash: string }>(`${c.rpc}/chains/main/blocks/head/header`);
}
export async function view(c: SiteConfig, name: string, input: Micheline, block = 'head') {
  const result = await remote<{ data: Micheline }>(
    `${c.rpc}/chains/main/blocks/${block}/helpers/scripts/run_script_view`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contract: c.contract,
        view: name,
        input,
        chain_id: c.chainId,
        unparsing_mode: 'Readable',
      }),
    },
  );
  return result.data;
}
const nats = (v: Micheline): string[] =>
  'int' in v ? [v.int] : 'prim' in v ? (v.args ?? []).flatMap(nats) : [];
export async function licenses(
  c: SiteConfig,
  buyer: string,
  kind: Kind,
  id: string,
  block: string,
) {
  const result = await view(
    c,
    'has_license',
    { prim: 'Pair', args: [{ string: buyer }, { string: c.artist }, target(kind, id)] },
    block,
  );
  const values = nats(result);
  if (values.length !== 3) throw new HttpError(503, 'Unexpected GAM license view response.');
  return { personal: values[0], commercial: values[1], purchased_at_level: values[2] };
}
export async function member(c: SiteConfig, cid: string, lid: string, block: string) {
  const r = await view(
    c,
    'in_collection',
    { prim: 'Pair', args: [{ string: c.artist }, { int: cid }, { int: lid }] },
    block,
  );
  if (!('prim' in r) || !['True', 'False'].includes(r.prim))
    throw new HttpError(503, 'Unexpected GAM membership view response.');
  return r.prim === 'True';
}
