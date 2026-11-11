# GAM · Artist site template

An artist-owned storefront and Tezos DApp, built for Cloudflare Workers with Static Assets, D1, and private R2 storage. Each deployment serves one artist and the shared GAM contract. The artist receives purchases directly; this template never stores wallet keys.

**Status:** first implementation, built and tested locally, including five live integration tests against the existing GAM contract on the running TezBox. Artist and canonical network settings are intentionally blank. All contract addresses and chain IDs, including local-dev, are intentionally blank in the example; supply your own sandbox identity in the ignored working file. No Cloudflare deployment is bundled. Finish browser-wallet and fresh-account deployment checks in [deployment](docs/deployment.md) before selling work.

## Run locally

Use Node **24.22.0** (`nvm install && nvm use`) or another version accepted by `package.json`. This project pins `cf` 1.0.0-beta.29 and the matching Cloudflare Vite 2 beta. Commands run the project CLI, so your old global `cf` can remain installed.

```sh
npm ci
cp site.config.json.example site.config.json
cp .dev.vars.example .dev.vars
```

Generate a secret with `openssl rand -hex 32` and put it in `.dev.vars` as `SESSION_SECRET=...`. Do not commit that file.

```sh
npm run db:local
npm run seed             # optional: three example artworks, local database only
npm run dev
```

Open the printed URL, normally `http://localhost:5173`. Use the same hostname as `site.config.json` when testing authentication. Sample data has no originals or real licenses and cannot enable checkout. `npm run seed -- --clear` removes the sample catalog from the local database; only use it while the template is unconfigured.

## Sample artwork exports

The sample artworks have high-resolution JPEG originals for delivery and smaller WebP previews for the website. Editable SVG masters stay outside public assets. Run `npm run samples:export` to regenerate both, or `npm run samples:previews` to rebuild previews from the raster originals. See [sample artwork files](sample-artworks/README.md) for paths and specifications.

## What is implemented

- Responsive catalog, artwork and collection pages, license prices, quantities, reviews, and a wallet-linked library.
- All eight canonical public/metadata/download routes from the GAM whitepaper, plus artist admin and buyer APIs.
- Wallet transactions using the actual GAM parameter layout, integer mutez arithmetic, and UTF-8 bytes.
- One-time signed wallet challenges, host-only signed session cookies, role checks, origin checks, rate limits, and logout revocation.
- Artist registration, multipart original upload, server-side SHA-256 verification, immutable file catalog, previews, metadata, listing edits, and collection membership batches.
- Direct-license or current-collection-license checks through RPC views before private downloads; original file streaming and verification commands.
- Configurable TzKT or direct-RPC event ingestion with checkpoints, a sync lock, replay/rebuild on detected reorganization, deployed five-minute scheduling, and automatic local development sync.
- Local Workers runtime tests, generated binding types, and explicit local and Cloudflare modes with separate testnet/mainnet resources.

## Configure an artist

`site.config.json.example` is the versioned configuration template. Copy it to `site.config.json` once, then edit that working file for this artist website. Git ignores the working file, so template updates cannot overwrite your settings; new settings appear in the example for you to review and copy as needed. Commands explain this setup step if the working file is missing and never create or overwrite it automatically. Shared branding lives at the top; `modes` contains all five supported running modes:

| Mode                 | Runs on                                                 | Default storage                   |
| -------------------- | ------------------------------------------------------- | --------------------------------- |
| `local-dev`          | This computer, with TezBox or another development chain | Local simulation                  |
| `local-testnet`      | This computer, with canonical Tezos testnet             | Cloudflare testnet shop resources |
| `local-mainnet`      | This computer, with Tezos mainnet                       | Cloudflare mainnet shop resources |
| `cloudflare-testnet` | Cloudflare, with canonical Tezos testnet                | Cloudflare testnet shop resources |
| `cloudflare-mainnet` | Cloudflare, with Tezos mainnet                          | Cloudflare mainnet shop resources |

Each example mode explicitly selects `catalogSource`: `rpc` for `local-dev`, `tzkt` for the other four modes. Either source can be selected in any mode. Existing working configurations that omit the setting retain TzKT behavior. `catalogStartLevel` defaults to `0`; it is an inclusive lower bound for event history, not an automatic current-head shortcut.

To use TezBox without TzKT, fill `modes.local-dev.artist`, `contract`, and `chainId` with your actual wallet and sandbox deployment, keep `catalogSource: "rpc"`, and leave `indexer` empty. Enable your custom `inventoryPage` if desired. For a fresh artist you can set `catalogStartLevel` to a block before its first operation; existing artists must include all prior history. RPC history must retain operation receipts. Browser wallets still need a browser-accessible RPC, including CORS for the local shop origin. See [catalog sources](docs/catalog-sources.md) for setup, migration, and limitations.

There is no `cloudflare-dev`. `dev` means a chain outside canonical testnet/mainnet. Each entry explicitly lists its wallet, contract, endpoints, origins, website ID, Worker and storage resources; network settings do not inherit between entries. No official testnet or mainnet GAM address is guessed.

```sh
npm run dev                          # local-dev
npm run dev -- local-testnet
npm run dev -- local-mainnet
npm run build -- cloudflare-testnet
npm run deploy:dry-run -- cloudflare-testnet
npm run deploy -- cloudflare-testnet --secrets-file .env.testnet-secrets
```

Every entry includes `"inventoryPage": ""`. Missing, `null`, and `""` all mean **Inventory disabled**, without disabling buyer sign-in, purchases, or downloads. To enable it in a mode, choose a custom path such as `/stockroom-blue-42`: one segment of 3–80 letters, numbers, hyphens, or underscores, beginning with `/`. Standard names including `/admin` and `/inventory` are reserved. Its management APIs exist only beneath that custom path. Buyer pages never link to it, and public catalog JSON omits it. Artist wallet authentication is still required.

For local-only Inventory, enable the path in `local-mainnet`, leave it empty in `cloudflare-mainnet`, and point both modes at the same artist, chain, contract, website ID, D1 database, and R2 buckets. `origin` is always the public shop URL registered on Tezos. `localOrigin` is the local browser URL used for sign-in and request checks. Remote storage access uses your local Cloudflare credentials. Local testnet/mainnet modes can instead set `storage` to `local` for an isolated simulation.

Secrets stay outside JSON: use ignored `.dev.vars.<mode>` files locally and Cloudflare secrets for deployment. Prefer a different session secret for each running mode. See the field reference and setup steps in the deployment guide.

See [deployment](docs/deployment.md), [architecture](docs/architecture.md), and [operations](docs/operations.md).

## Verify

```sh
npm run typecheck        # generates .cloudflare/types before checking TypeScript
npm test                # real Workers runtime, D1/R2, actual signature verification
npm run test:tezbox     # optional: signs real operations on the local sandbox
npm run build           # cf + Vite: Worker bundle and public assets
npm run deploy:dry-run -- cloudflare-testnet  # validate deployment output without uploading
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
