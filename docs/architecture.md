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

The chain owns canonical titles, prices, activity flags, file hashes, website references, licenses, membership, and reviews. TzKT supplies enumeration; the site stores ordered events and reconstructs its artist/website's catalog. D1 metadata adds previews, long text, terms, tags, replacement links, and display order. Neither public metadata nor a session grants a license.

Each private request checks the configured RPC chain ID, reads a block level, and uses GAM views at that level. A listing license is sufficient; otherwise an owned collection must currently contain the work. The local membership mirror supplies candidates only. If it is missing a recent addition, access can be temporarily delayed; stale entries cannot grant removed membership. RPC unavailability returns a retryable error instead of serving a file.

The indexer is a trust dependency for catalog presentation. Sync verifies network identity, imports up to five 200-event pages, stores checkpoints transactionally, and compares RPC checkpoint hashes to detect reorganizations. A D1 lease serializes scheduled/manual syncs. A detected reorganization clears chain-derived events and rebuilds them, leaving originals and metadata intact. Manual sync continues long imports; the next scheduled run also continues.

## Inventory routing

`inventoryPage` is a required artist-chosen path for artist deployments, with no common default. Configuration-time validation rejects reserved paths and malformed URLs before constructing the Worker bindings. The Worker reads the validated path from `SITE_CONFIG`; it must not import the configuration's validator, because the Cloudflare Vite plugin blocks configuration dependencies in its dev runner. The Worker serves the Inventory shell only at this configured path and routes its APIs under `<inventoryPage>/api/`; the old `/admin` page and fixed `/api/admin/*` endpoints are disabled. A server-rendered page marker selects the Inventory UI without publishing the configured path in the client bundle. Buyer pages have no Inventory links, and public catalog JSON omits `inventoryPage`. The Inventory shell is non-cacheable and marked `noindex, nofollow`. Knowing the path never bypasses wallet authentication or artist authorization.

## Authentication

The signed challenge binds origin, chain, contract, wallet, role, nonce, and expiry. Verification checks the public key's wallet address and a real Tezos signature, then atomically consumes the challenge. Sessions contain a random token protected by HMAC; D1 stores only its digest and role. Cookies are Secure, HttpOnly, SameSite=Strict, host-only, and expire after one hour. Deleting the session revokes it; rotating the secret invalidates every cookie.

Only the configured artist address can obtain an admin session. An artist using a buyer session still needs to sign in as artist for administration. Origin checks protect mutations; browser wallet approval is required for every on-chain operation. Server sessions hold no signing authority.

## Publication and recovery

Original uploads use unique private keys and R2 multipart APIs. After completion, the Worker reads the original stream to compute SHA-256 and inserts an immutable catalog row. The listing builder takes its hash from that row, not a client claim. Uploading another original to the same established listing ID is rejected. Corrected originals use new IDs.

Off-chain metadata is saved when preparing a transaction; canonical fields become public only through confirmed indexed events. A rejected wallet transaction may therefore leave a recoverable draft/upload. Files are not automatically deleted. A failed confirmation poll does not mean submission failed: the UI displays the operation hash and admin submissions are recorded in D1.

Collection creation batches a closed record, membership changes, and the final open record. Closing a collection or removing its last member is similarly batched. The contract enforces author ownership and site consistency; the template enforces nonempty collections before opening.

## Public JSON

Listing and collection metadata use `art-sale/listing@1` and `art-sale/collection@1`, with string IDs to preserve large nats. Public discovery consumers should accept unknown fields. `order` is display order; chain membership remains authoritative. Public JSON allows CORS `*`; private/session/admin responses do not. Canonical HTML gets server-generated title, description, and Open Graph tags.

## Verification limits

The fast test suite exercises runtime storage and cryptography, transaction types, and positive/negative entitlement responses. The optional live TezBox suite also signs actual operations on the existing GAM deployment and tests Worker downloads against real chain views; see `tezbox-validation.md`. Neither suite proves RPC honesty, audits the contract, certifies browser-wallet compatibility, or verifies Cloudflare account provisioning. Complete the deployment acceptance checklist before production.
