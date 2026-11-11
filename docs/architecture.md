# Architecture

The implementation follows the October 26 GAM plan and the November 10 Cloudflare build plan in the sibling `art-sale-ever-growing-mono-contract-plan` directory. Workers Static Assets replaces the older Pages deployment detail.

## Boundaries

- `src/client`: React storefront, wallet adapter, Inventory, and buyer pages. Taquito/Beacon load on first connection rather than on initial browsing.
- `src/worker`: HTTP routes, sessions, artist actions, event catalog, and gated streaming.
- `src/chain`: lossless RPC decoding, views, and raw Micheline transaction builders. `parameter-schema.json` snapshots the compiled GAM parameter type for tests.
- `src/shared`: public data types, UTF-8 encoding, and exact tez/mutez conversion.
- `migrations`: D1 schema. `scripts`: local-only migration and sample-catalog commands.

Cloudflare configuration declares the Worker, assets, D1, two R2 buckets, session secret, and schedule. The public preview bucket is served through `/previews/{id}`; the originals bucket is never exposed as a public bucket. Native browser downloads are authorized streams from `/download/{id}/file`.

## Trust and data

The chain owns canonical titles, prices, activity flags, file hashes, website references, licenses, membership, and reviews. The selected TzKT or RPC event reader supplies enumeration; the site stores ordered events and reconstructs its artist/website's catalog. D1 metadata adds previews, long text, terms, tags, replacement links, and display order. Neither public metadata nor a session grants a license.

Each private request checks the configured RPC chain ID, reads a block level, and uses GAM views at that level. A listing license is sufficient; otherwise an owned collection must currently contain the work. The local membership mirror supplies candidates only. If it is missing a recent addition, access can be temporarily delayed; stale entries cannot grant removed membership. RPC unavailability returns a retryable error instead of serving a file.

Catalog synchronization is source-aware. TzKT reads up to five 200-event pages; RPC scans up to six consecutive blocks per invocation and decodes applied GAM events from operation receipts using each event’s Michelson type. Both stop taking new work after a 30-second budget, retain the two-block safety lag, and feed the same projection. RPC normalizes big integers and timestamps to the same representation as TzKT. Empty blocks advance the RPC checkpoint. Each RPC block’s events, provenance, and cursor are committed together.

A renewable D1 lease serializes scheduled/manual syncs. Checkpoint hashes and parent continuity detect reorganizations. Rebuilds clear only chain-derived events/provenance, preserving originals and metadata. `catalog_state` binds cursors to chain, contract, artist, source, start block and TzKT endpoint; switching identities rebuilds history. The first migrated TzKT run adopts existing cursors. Inventory preparation refuses incomplete catch-up. Catalog presentation trusts the selected source; delivery still verifies live chain views.

Deployed Workers retain five-minute scheduled sync. A Vite development plugin invokes the local runtime’s scheduled handler serially about every ten seconds after server startup; it uses the pinned Cloudflare Local Explorer API and exposes no application sync endpoint. Its timer stops with the server. Local storefronts refresh catalog data every ten seconds. Source errors appear in Inventory status and Worker logs. See [catalog sources](catalog-sources.md).

## Inventory routing

`site.config.json` holds shared branding and all five explicit execution/network modes. A build-time loader selects one mode and projects only its runtime fields into `SITE_CONFIG`; the Worker never receives the full mode list or Cloudflare resource configuration. Local remote-storage modes use `dev.remote` bindings to the deployed shop’s D1 and R2.

`inventoryPage` is optional per mode. Missing, null, and empty string all disable Inventory and its management APIs; buyer readiness does not depend on Inventory. A nonempty value is an artist-chosen custom path with no common default. Configuration-time validation rejects reserved paths and malformed URLs before constructing the Worker bindings. The Worker reads the validated path from `SITE_CONFIG`; it must not import the configuration's validator, because the Cloudflare Vite plugin blocks configuration dependencies in its dev runner. The Worker serves the Inventory shell only at this configured path and routes its APIs under `<inventoryPage>/api/`; the old `/admin` page and fixed `/api/admin/*` endpoints are disabled. A server-rendered page marker selects the Inventory UI without publishing the configured path in the client bundle. Buyer pages have no Inventory links, and public catalog JSON omits `inventoryPage` and the local request origin. The Inventory shell is non-cacheable and marked `noindex, nofollow`. Knowing the path never bypasses wallet authentication or artist authorization.

## Authentication

The signed challenge binds origin, chain, contract, wallet, role, nonce, and expiry. The origin is the selected local browser origin or deployed public origin; `origin` remains the public shop URL for contract metadata. Verification rejects challenges created for another origin/chain/contract even when local and deployed modes share D1. Verification checks the public key's wallet address and a real Tezos signature, then atomically consumes the challenge. Sessions contain a random token protected by HMAC; D1 stores only its digest and role. Cookies are Secure, HttpOnly, SameSite=Strict, host-only, and expire after one hour. Deleting the session revokes it; rotating the secret invalidates every cookie.

Only the configured artist address can obtain an admin session. An artist using a buyer session still needs to sign in as artist for administration. Origin checks protect mutations; browser wallet approval is required for every on-chain operation. Server sessions hold no signing authority.

## Publication and recovery

Original uploads use unique private keys and R2 multipart APIs. After completion, the Worker reads the original stream to compute SHA-256 and inserts an immutable catalog row. The listing builder takes its hash from that row, not a client claim. Uploading another original to the same established listing ID is rejected. Corrected originals use new IDs.

Off-chain metadata is saved when preparing a transaction; canonical fields become public only through confirmed indexed events. A rejected wallet transaction may therefore leave a recoverable draft/upload. Files are not automatically deleted. A failed confirmation poll does not mean submission failed: the UI displays the operation hash and admin submissions are recorded in D1.

Collection creation batches a closed record, membership changes, and the final open record. Closing a collection or removing its last member is similarly batched. The contract enforces author ownership and site consistency; the template enforces nonempty collections before opening.

## Public JSON

Listing and collection metadata use `art-sale/listing@1` and `art-sale/collection@1`, with string IDs to preserve large nats. Public discovery consumers should accept unknown fields. `order` is display order; chain membership remains authoritative. Public JSON allows CORS `*`; private/session/admin responses do not. Canonical HTML gets server-generated title, description, and Open Graph tags.

## Verification limits

The fast test suite exercises runtime storage and cryptography, transaction types, and positive/negative entitlement responses. The optional live TezBox suite also signs actual operations on the existing GAM deployment and tests Worker downloads against real chain views; see `tezbox-validation.md`. Neither suite proves RPC honesty, audits the contract, certifies browser-wallet compatibility, or verifies Cloudflare account provisioning. Complete the deployment acceptance checklist before production.
