# GAM · Artist site template

An artist-owned storefront and Tezos DApp, built for Cloudflare Workers with Static Assets, D1, and private R2 storage. Each deployment serves one artist and the shared GAM contract. The artist receives purchases directly; this template never stores wallet keys.

**Status:** first implementation, built and tested locally, including five live integration tests against the existing GAM contract on the running TezBox. Network, artist, and contract settings are intentionally blank for artist deployments. No Cloudflare deployment is bundled. Finish browser-wallet and fresh-account deployment checks in [deployment](docs/deployment.md) before selling work.

## Run locally

Use Node **24.22.0** (`nvm install && nvm use`) or another version accepted by `package.json`. This project pins `cf` 1.0.0-beta.29 and the matching Cloudflare Vite 2 beta. Commands run the project CLI, so your old global `cf` can remain installed.

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Generate a secret with `openssl rand -hex 32` and put it in `.dev.vars` as `SESSION_SECRET=...`. Do not commit that file.

```sh
npm run db:local
npm run seed             # optional: three example artworks, local database only
npm run dev
```

Open the printed URL, normally `http://localhost:5173`. Use the same hostname as `site.config.json` when testing authentication. Sample data has no originals or real licenses and cannot enable checkout. `npm run seed -- --clear` removes the sample catalog from the local database; only use it while the template is unconfigured.

## What is implemented

- Responsive catalog, artwork and collection pages, license prices, quantities, reviews, and a wallet-linked library.
- All eight canonical public/metadata/download routes from the GAM whitepaper, plus artist admin and buyer APIs.
- Wallet transactions using the actual GAM parameter layout, integer mutez arithmetic, and UTF-8 bytes.
- One-time signed wallet challenges, host-only signed session cookies, role checks, origin checks, rate limits, and logout revocation.
- Artist registration, multipart original upload, server-side SHA-256 verification, immutable file catalog, previews, metadata, listing edits, and collection membership batches.
- Direct-license or current-collection-license checks through RPC views before private downloads; original file streaming and verification commands.
- Paginated TzKT event ingestion with checkpoints, a sync lock, replay/rebuild on detected reorganization, and a five-minute scheduled sync.
- Local Workers runtime tests, generated binding types, and separate staging configuration/resources.

## Configure an artist

Edit `site.config.json`; use `site.staging.config.json` for staging. Set a unique `workerName`, artist wallet, shared GAM contract, actual chain ID, RPC/indexer base URLs, explorer base URL, canonical origin, and website ID. No mainnet address is guessed. Branding fields are ordinary configuration.

The artist studio is `/admin`. Register the website, upload an original and a reduced public preview, then approve the listing in the artist wallet. Existing IDs edit existing records: choose a new unused ID for a new work or corrected file. Collections are created closed and opened in the same batch that adds their works.

See [deployment](docs/deployment.md), [architecture](docs/architecture.md), and [operations](docs/operations.md).

## Verify

```sh
npm run typecheck        # generates .cloudflare/types before checking TypeScript
npm test                # real Workers runtime, D1/R2, actual signature verification
npm run test:tezbox     # optional: signs real operations on the local sandbox
npm run build           # cf + Vite: Worker bundle and public assets
npm run deploy:dry-run  # validate deployment output without uploading
```

The compiled contract parameter snapshot in `src/chain/parameter-schema.json` comes from the sibling `contracts/gam/out/gam.tz`. Tests validate all seven transaction builders against it. Contract origination, proving, and auditing remain in the contract repository; this template does not deploy contracts.

## Intentional first-version boundaries

- Cloudflare deployment-button support for the new TypeScript configuration has not been verified in a fresh account. The documented CLI path is the current setup path; there is no misleading one-click button.
- Native browser-wallet pairing remains unverified. The optional live TezBox suite runs real registration, publication, purchases, payouts, reviews, and gated downloads against the existing contract; see [validation details](docs/tezbox-validation.md). The default fast suite uses controlled RPC responses.
- Sessions last one hour, with unlimited reauthentication and licensed redownloads. The whitepaper's per-day session-refresh quota is not enforced: its relationship to session expiry needs a product decision before a quota can safely restrict buyers.
- The catalog reconstructs this artist's event history per read. Validate costs/latency for large histories before promoting the template to a high-volume deployment.
- “Download all new” starts separate browser-native downloads. Browsers may require permission for multiple files; individually linked downloads are always available. The marker records a request, not a completed local save.
- Multipart uploads are capped at 128 × 8 MiB; preview images at 5 MiB. Large original hashing needs measurement against your Worker CPU budget. Range/resume delivery is not implemented.

GPL-3.0; see [LICENSE](LICENSE).
