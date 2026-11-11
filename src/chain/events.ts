import { Schema } from '@taquito/michelson-encoder';
import type { SiteConfig } from '../shared/model';
import { ensure } from '../worker/env';

export interface ChainEvent {
  id: number;
  level: number;
  tag: string;
  payload: Record<string, any>;
  sourceKey?: string;
}
const tags = new Set([
  'website_set',
  'listed',
  'collection_set',
  'collection_item_set',
  'purchased',
  'reviewed',
]);
function normalize(value: any): any {
  if (value?.constructor?.name === 'BigNumber') return value.toFixed();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  return value;
}

// Receipts can contain optimized addresses, comb pairs, and integer timestamps.
// Decode against the event's own type, as opposed to assuming readable JSON.
export function rpcEvents(block: any, c: SiteConfig, cursor: number): ChainEvent[] {
  ensure(Array.isArray(block.operations), 'RPC block operations are missing.', 503);
  const events: ChainEvent[] = [];
  for (const [pass, groups] of block.operations.entries()) {
    for (const [groupIndex, group] of groups.entries()) {
      for (const [contentIndex, content] of group.contents.entries()) {
        if (!['transaction', 'origination'].includes(content.kind)) continue;
        const metadata = content.metadata;
        ensure(
          metadata && typeof metadata === 'object' && metadata.operation_result,
          'RPC operation receipts are unavailable. Use a node retaining historical operation metadata, or restore catalog history from a backup.',
          503,
        );
        if (metadata.operation_result.status !== 'applied') continue;
        for (const [internalIndex, result] of (
          metadata.internal_operation_results ?? []
        ).entries()) {
          if (
            result.kind !== 'event' ||
            result.source !== c.contract ||
            result.result?.status !== 'applied'
          )
            continue;
          ensure(tags.has(result.tag), `Unsupported GAM event: ${result.tag}.`, 503);
          const payload = normalize(new Schema(result.type).Execute(result.payload));
          if (payload.artist !== c.artist) continue;
          // TzKT returns ISO dates; explicitly normalize timestamps for projection parity.
          for (const key of ['posted_at', 'updated_at']) {
            if (payload[key] != null) {
              const v = payload[key];
              payload[key] = new Date(/^\d+$/.test(String(v)) ? Number(v) * 1000 : v).toISOString();
            }
          }
          events.push({
            id: ++cursor,
            level: block.header.level,
            tag: result.tag,
            payload,
            sourceKey: `${block.hash}:${pass}:${group.hash ?? groupIndex}:${contentIndex}:${internalIndex}`,
          });
        }
      }
    }
  }
  return events;
}
