# Catalog sources

Each mode in the ignored `site.config.json` chooses its event source independently. Wallet signing, originals, previews, purchases, reviews, and downloads use the same application flow with either source. Licenses and current collection membership are always checked through RPC views, regardless of the catalog source.

| Setting             | Meaning                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `catalogSource`     | `rpc` scans blockchain operation receipts; `tzkt` queries a TzKT API. Omitted settings retain `tzkt` for compatibility. |
| `indexer`           | Required TzKT API origin for `tzkt`, without `/v1` or a trailing slash. May be empty for `rpc`.                         |
| `catalogStartLevel` | Nonnegative integer, inclusive first block of relevant artist history; defaults to `0`. Applies to both sources.        |

The versioned example explicitly sets `rpc` for local-dev and `tzkt` for local-testnet, local-mainnet, cloudflare-testnet, and cloudflare-mainnet. Every example start level is `0`. Each mode’s contract and chain ID are empty; fill these in your working file using the actual deployment. Do not overwrite existing working settings with the example.

## Local TezBox without TzKT

1. Copy the example to the working JSON if it does not exist.
2. Populate local-dev `artist`, `contract`, and `chainId`. Read the chain ID from `GET /chains/main/chain_id`; identify your deployed GAM contract with `npm run inspect:tezbox` after setting `rpc`.
3. Keep `catalogSource: "rpc"`, `indexer: ""`, and local storage. Use the same origin/hostname/port for `origin`, `localOrigin`, and your browser. Enable an artist-chosen `inventoryPage` if you want Inventory.
4. Keep the default start level for complete history, or supply a known block no later than the artist’s first relevant GAM operation. Never use the current head as a shortcut for an existing artist. A fresh artist can start just before its first operation.
5. Set a strong session secret in the ignored local secrets file. Run `npm run db:local`, then `npm run dev`.
6. Open Inventory and sign in. Watch source, checkpoint, target, completion, and error status. Long imports automatically continue; Sync chain requests an immediate bounded run. Transaction preparation returns a catch-up message until the current safe target has been scanned.

The dev server invokes the same scheduled Worker handler approximately every ten seconds, serially, without requiring Inventory to remain open. Local pages refresh their catalog on the same interval. Local modes using remote Cloudflare bindings perform real remote writes, just as before. Cloudflare deployments keep their existing five-minute schedule.

RPC ingestion needs historical operation metadata. A pruned node that cannot return receipts for the selected range cannot reconstruct complete history; use a suitable node, a trusted database backup, or TzKT. Missing metadata is an error, not an empty event list. Large existing chains take longer to scan than small sandboxes. Runs process at most six RPC blocks (or five TzKT pages of 200 events), with a 30-second work budget checked between blocks/pages.

The template does not change your node configuration. Its browser-side wallet/Taquito requests still need RPC CORS access from the local origin. A successful server-side catalog sync does not prove browser-wallet pairing or CORS is configured.

## Checkpoints, confirmations, and recovery

Both sources leave a two-block safety lag. A confirmed wallet transaction can therefore precede catalog visibility. RPC checkpoint levels represent fully scanned blocks. A TzKT checkpoint anchors a paginated query to a block hash; `complete: false` means further event pages are needed even if its checkpoint already equals the target. “Caught up” means caught up to the last sync’s confirmed target, not necessarily the latest moving head.

RPC scans the chain, including external transactions. Only applied operations and applied events emitted by the configured GAM contract for the configured artist are ingested. Decoding preserves big integers and normalizes review timestamps. Stable receipt provenance and atomic block writes make retries resumable. Failed/backtracked transactions do not enter the catalog.

Reorg detection clears events/provenance and rebuilds from the configured start block. Changing chain, contract, artist, source, starting level, or TzKT endpoint similarly rebuilds derived history. Drafts, file mappings, previews, and originals remain intact. Modes sharing one D1 database must use the same source, starting level, chain, contract, artist, and TzKT endpoint; otherwise their writers will repeatedly rebuild each other’s catalog. Upgrade all such writers together. Use distinct databases for distinct artists/deployments; retaining metadata does not transfer ownership or licenses.

## Upgrade existing installations

Back up D1 and apply `0002_catalog_sources.sql` before serving the updated Worker. For local simulation, `npm run db:local` applies the current idempotent schema files. For remote storage, use the existing deployment migration command against the actual D1 database ID:

```sh
npx cf d1 migrations apply YOUR_D1_DATABASE_ID --dir migrations --mode cloudflare-testnet
```

Use the appropriate deployed mode for the database. No source setting is required in older working configurations: they retain TzKT. Their first sync adopts the existing TzKT cursor; subsequent source/identity changes rebuild. As with the prior schema, never point an existing artist’s database at an unrelated deployment without deliberately configuring the new identity.
