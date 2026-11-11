# Operations and recovery

## Storage and secrets

Back up original R2 objects, the public preview bucket, and D1. Chain-derived events can be rebuilt; original artwork, private catalog keys, and off-chain metadata cannot. Keep a separate local copy of every original before publishing. Preserve filenames, MIME types, sizes, and hashes along with objects.

Use Cloudflare's supported D1 export/restore and R2 object-copy tools for your account. Test restoration in a separate Worker with separate bindings before relying on the backup. Never point a preview build at production resources. Do not include cookies, session tokens, private object keys, signing secrets, or wallet signatures in log exports.

Rotate `SESSION_SECRET` using Cloudflare's runtime secrets mechanism or `cf deploy --secrets-file` with an ignored file. Rotation invalidates all current cookies. Existing on-chain licenses remain valid; buyers sign in again. Clean up the old ignored secret file when no longer needed.

## Failure recovery

| Symptom                                     | Action                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty catalog after a confirmed transaction | Run artist admin sync; check RPC/indexer network and lag. Scheduled sync continues every five minutes.                                                        |
| Sync says another run is active             | Retry after the active run finishes; the lease expires after three minutes if interrupted.                                                                    |
| Reorganization detected                     | Sync clears chain-derived events and rebuilds from history; retain all artwork and metadata.                                                                  |
| Wallet confirmation polling failed          | Use the displayed operation hash and chain explorer before resubmitting. Admin hashes are retained in D1 `operations`.                                        |
| Upload finished but publication failed      | Original is retained. Use the same listing ID to prepare publication again. Do not upload a different original over that ID.                                  |
| Upload part failed                          | The browser aborts that multipart attempt; retry the upload. R2 also expires incomplete multipart uploads. No published originals are auto-deleted.           |
| Worker crashed after multipart completion   | The completion handler can hash the already committed object on retry while its upload record exists. Inspect admin status/file catalog before starting over. |
| Download denied after collection change     | Verify current membership and the buyer's direct or collection license; local metadata cannot override the chain.                                             |
| Missing object or hash/catalog mismatch     | Restore the exact original and catalog row from backup. Do not change the on-chain hash or silently serve another export.                                     |
| Expired buyer session                       | Sign in again. Version 1 allows unlimited reauthentication and licensed redownloads.                                                                          |

## Domain migration

Copy R2 objects/previews and restore D1 into the replacement infrastructure. Keep the artist wallet, contract, chain, website ID, and private file mapping. Set the new canonical origin, deploy with a fresh secret, and verify an existing licensed buyer can download exact matching bytes. Update `set_website` with the existing website ID and new URL using the artist wallet. Cookies do not migrate; users sign in on the new host.

A new artist wallet is a new on-chain identity and requires a separate deployment. Changing configuration does not transfer listings or licenses.

## Costs and limits

Measure request counts, RPC/indexer latency, D1 rows read, R2 storage/operations, upload hashing CPU, and observability volume with representative artwork. Free-tier limits and prices change; check current Cloudflare terms before publishing a cost claim. Streaming avoids loading an entire original into Worker memory, but hashing still consumes CPU proportional to file size.

The current multipart path buffers at most one 8 MiB part per upload request and accepts at most 128 parts (1 GiB total). Public previews are limited to 5 MiB. Original downloads stream directly from R2 and ignore range requests; retries transfer the entire file. Browser-native multi-download requests can be blocked by browser policy, so retain individual links.

The initial catalog replay reads all retained events for one artist. Profile larger histories before scaling; replace it with transactional materialized projections while retaining replayable events if needed. Download/library entitlement checks intentionally prioritize correctness over caching.

## Template updates

Preserve each deployment's site configuration, resource IDs, secrets, database, and R2 objects. Read migration notes, back up, run checks, apply new D1 migrations, and validate in staging before upgrading production. Keep the shared GAM contract address under careful review: an unintended change redirects all future purchase calls.

Run `npm run check` and `npm run deploy:dry-run` locally before deploying to Cloudflare. This template has no GitHub Actions or code execution on GitHub; GitHub is only a source repository. Deployment runs through Cloudflare.
