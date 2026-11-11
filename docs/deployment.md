# Deployment and artist onboarding

Use the project-pinned CLI through `npx cf` or npm scripts. The installed global v0.0.5 CLI does not have this project's required commands. Node 24.22.0 is pinned because the available beta CLI requires a current supported Node minor.

## 1. Configure a test deployment

On a fresh checkout, run `cp site.config.json.example site.config.json`. The example is versioned; your working file is ignored by Git and must be backed up separately. Do not repeat the copy over existing settings.

Edit `modes.cloudflare-testnet` in the single `site.config.json` first. Shared branding is at the top level; all mode settings are explicit. Supply:

| Field           | Meaning                                                                                                                             |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `workerName`    | Unique Worker name for this artist and environment.                                                                                 |
| `artist`        | Artist's implicit Tezos wallet; receives payments and owns records.                                                                 |
| `contract`      | Existing shared GAM contract on the chosen test chain.                                                                              |
| `chainId`       | Actual RPC chain identifier, not a network nickname.                                                                                |
| `rpc`           | RPC base URL without a trailing slash.                                                                                              |
| `indexer`       | Matching TzKT API origin without `/v1` or a trailing slash.                                                                         |
| `explorer`      | Matching explorer origin, e.g. the human-facing TzKT site.                                                                          |
| `origin`        | Exact HTTPS website origin, without trailing slash. Local Inventory also uses this public origin for on-chain website registration. |
| `websiteId`     | Unused per-artist website ID, or the existing ID being restored/migrated.                                                           |
| `inventoryPage` | Optional custom Inventory path, such as `/stockroom-blue-42`; empty disables it.                                                    |
| branding        | Name, tagline, and biography.                                                                                                       |

The template does not originate a contract. Confirm its seven entrypoints and two views match the supplied ABI snapshot. Use a currently supported Tezos test network with matching wallet, RPC, and indexer support; the old plan's Ghostnet reference is not an automatic network selection.

Every mode starts with `"inventoryPage": ""`. Missing, `null`, and empty string all disable Inventory and its APIs while keeping the configured shop operational. Set a path only in the modes where the artist wants Inventory. A nonempty path must begin with `/` and contain one segment of 3–80 letters, numbers, hyphens, or underscores; common paths such as `/admin`, `/inventory`, and `/studio` are reserved. Buyer pages never link to it. Wallet authentication and artist checks remain mandatory.

Additional per-mode fields:

| Field                               | Meaning                                                                                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localOrigin`                       | Local browser origin, normally `http://localhost:5173`; its port controls the dev server. Empty in Cloudflare modes.                                |
| `storage`                           | `local` uses simulated D1/R2; `cloudflare` connects real Cloudflare resources, including during a local run. Cloudflare modes require `cloudflare`. |
| `cloudflareAccountId`               | Account owning the deployed Worker and remote storage; empty lets the CLI select the authenticated account.                                         |
| `databaseId`, `databaseName`        | D1 UUID and name. Record the provisioned UUID here; local remote access must target that same database.                                             |
| `originalsBucket`, `previewsBucket` | Exact R2 bucket names for originals and public previews. Originals must remain private.                                                             |

The five modes are `local-dev`, `local-testnet`, `local-mainnet`, `cloudflare-testnet`, and `cloudflare-mainnet`. `cloudflare-dev` is rejected. For local Inventory against a deployed shop, copy its identity and resource settings to the matching local mode, set its public `origin`, and enable Inventory only locally. Authenticate the CLI to the owning Cloudflare account. Remote bindings perform real reads/writes; these are not sandbox copies. If using local simulated storage instead, apply the local migration before starting that mode:

```sh
npm run db:local -- local-testnet
npm run dev -- local-testnet
```

The migration command rejects modes configured for remote storage. The sample seed command is restricted to local simulated storage with no artist configured.

## 2. Validate and deploy

```sh
npm ci
npm run check
npm run deploy:dry-run -- cloudflare-testnet
npx cf auth login
```

For local runs use `.dev.vars.local-dev`, `.dev.vars.local-testnet`, or `.dev.vars.local-mainnet` (the generic ignored `.dev.vars` is also supported). Secrets are the exception to the single-file configuration: never put credentials in JSON.

Generate a fresh strong `SESSION_SECRET` in an ignored dotenv-format file such as `.env.staging-secrets`. Never put it in tracked configuration, logs, or frontend variables.

```sh
npm run deploy -- cloudflare-testnet --secrets-file .env.staging-secrets
```

Bindings with missing resource IDs can be provisioned during deployment. Verify the returned resources and account before serving customers. Configure a custom domain in Cloudflare or add the supported `domains` setting to the Worker config; ensure `origin` matches its actual URL. Testnet and mainnet use separate entries and resource names in `site.config.json`.

The new CLI does not write provisioned IDs back to `cloudflare.config.ts`. Record the actual D1 ID and R2 names in the corresponding entries of `site.config.json`. Do not assume an autogenerated resource name remains identical across fresh accounts.

Apply the database migration to the actual provisioned D1 ID:

```sh
npx cf d1 migrations apply YOUR_D1_DATABASE_ID --dir migrations --mode cloudflare-testnet
```

`YOUR_D1_DATABASE_ID` must be the actual UUID, not `DB` or the database name. The local npm migration command deliberately targets only the local simulation and cannot migrate production. After migration, check `/api/health` and confirm the configured origin, bindings, and session secret.

## 3. Publish a first work

1. Open the custom `inventoryPage` URL you configured on the canonical site and sign in with the artist wallet. Buyer pages do not link to it.
2. Register the website and optionally set the artist display name. Resolve an ID conflict before signing; registrations are artist-scoped upserts, so check any use of the same artist in other deployments.
3. Choose a new listing ID, upload an original, and wait for server-side hash verification. Upload a reduced public preview.
4. Enter title, type, description, independent tier prices, terms, and activity. Zero disables a tier.
5. Approve the transaction in the wallet. Wait for confirmation and sync. The indexer imports blocks two levels behind its/RPC head; an additional block may be needed after confirmation.
6. Optionally create a collection and select works from this site. Creation/opening is a wallet batch.

Use a new buyer wallet to purchase a display license. After confirmation, sign in and compare the downloaded bytes' SHA-256 with the chain value. Repeat with a collection-only work, a later addition, and a removed member.

## Deployment button

Cloudflare's current deployment-button guide documents Wrangler configuration; this project uses the new `cloudflare.config.ts` workflow. Fresh-account button compatibility and database migration orchestration have not been demonstrated. Do not advertise a working one-click button yet. Keep one configuration source of truth; verify an adapter or supported native path before adding the button.

## Production acceptance checklist

- Fresh account deployment, custom domain, secret input, resource provisioning, and migration are reproducible from this guide.
- Real wallet pairing, signature login, artist registration, listing/collection batches, purchase confirmation, and review timing pass on the selected test chain.
- Direct listing and collection licenses deliver matching originals; removal denies collection-derived access; sale closure preserves existing access.
- Wrong-wallet administration, nonce replay, stale membership, RPC failure, missing files, and cross-origin requests fail safely.
- Large uploads/hash verification fit the chosen CPU/memory budget. Browser download behavior works on target desktop and phone browsers.
- Backups restore into a fresh deployment, preserving file keys, catalog metadata, and website identity.
- Shared mainnet contract address and readiness are independently confirmed before setting production configuration.

Then configure `modes.cloudflare-mainnet`, provide a separate production secret, and run `npm run deploy -- cloudflare-mainnet --secrets-file .env.mainnet-secrets`. Production launch and its transaction validation remain a separate step from this local implementation.
